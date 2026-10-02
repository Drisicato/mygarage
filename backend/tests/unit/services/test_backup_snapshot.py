"""Backup snapshot consistency tests (audit finding F2).

``create_full_backup`` must produce a SELF-CONTAINED ``mygarage.db``
member: every committed transaction present in that single file, with no
dependency on ``-wal``/``-shm`` sidecars. A raw file copy of a live
WAL-mode database fails this - committed rows that still live only in
the WAL are missing from the copied main file, and copying db/wal/shm
sequentially while a writer runs risks a torn, unrestorable archive.

The restore side has a matching hazard: restoring a self-contained db
member while stale live ``-wal``/``-shm`` files remain next to the
target would let SQLite replay the OLD wal over the NEW database.
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
import tarfile
from pathlib import Path
from urllib.parse import quote

import pytest
from sqlalchemy.engine import make_url

from app.services.backup_service import BackupService


def _make_wal_db_with_pending_frames(db_path: Path) -> sqlite3.Connection:
    """Create a WAL-mode DB where the newest committed row lives only in the WAL.

    Row 1 is checkpointed into the main file; row 2 is committed but NOT
    checkpointed. The returned connection is left open so closing does not
    checkpoint the WAL - the caller must close it.
    """
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")  # never auto-checkpoint
    conn.execute("CREATE TABLE audit_rows (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO audit_rows (id, v) VALUES (1, 'checkpointed')")
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("INSERT INTO audit_rows (id, v) VALUES (2, 'wal-only')")
    conn.commit()
    return conn


def _service(tmp_path: Path, db_path: Path | None) -> BackupService:
    data_dir = tmp_path / "data"
    for sub in ("photos", "documents", "attachments"):
        (data_dir / sub).mkdir(parents=True, exist_ok=True)
    return BackupService(
        backup_dir=tmp_path / "backups",
        database_path=db_path,
        data_dir=data_dir,
        is_sqlite=True,
    )


def _extract_member(archive: Path, member: str, dest: Path) -> Path:
    with tarfile.open(archive, "r:gz") as tar:
        info = tar.getmember(member)
        extracted = tar.extractfile(info)
        assert extracted is not None
        target = dest / member
        with extracted, open(target, "wb") as fh:
            fh.write(extracted.read())
    return target


@pytest.mark.unit
@pytest.mark.asyncio
async def test_full_backup_db_member_is_self_contained(tmp_path: Path) -> None:
    """F2: the archived mygarage.db must contain ALL committed rows on its own.

    With the raw file-copy approach, row 2 (committed, un-checkpointed)
    exists only in the -wal sidecar and is missing from the db member.
    """
    db_path = tmp_path / "mygarage.db"
    writer = _make_wal_db_with_pending_frames(db_path)
    try:
        service = _service(tmp_path, db_path)
        meta = await service.create_full_backup()
        archive = service.backup_dir / meta["filename"]

        extracted_db = _extract_member(archive, "mygarage.db", tmp_path)
        check = sqlite3.connect(f"file:{extracted_db}?mode=ro", uri=True)
        try:
            rows = check.execute("SELECT id, v FROM audit_rows ORDER BY id").fetchall()
        finally:
            check.close()

        assert rows == [(1, "checkpointed"), (2, "wal-only")], (
            "backup db member is missing committed WAL-resident rows - the "
            "backup is a raw file copy, not a consistent snapshot "
            f"(audit finding F2); got {rows!r}"
        )

        with tarfile.open(archive, "r:gz") as tar:
            names = tar.getnames()
        assert "mygarage.db-wal" not in names and "mygarage.db-shm" not in names, (
            "snapshot backups must be self-contained; wal/shm sidecars in the "
            "archive indicate the live-file-copy path is still in use"
        )
    finally:
        writer.close()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_restore_removes_stale_wal_sidecars(tmp_path: Path) -> None:
    """F2 restore hygiene: stale live -wal/-shm must not survive a restore.

    If they do, SQLite can replay the OLD wal frames over the freshly
    restored database on next open, corrupting it.
    """
    db_path = tmp_path / "mygarage.db"

    # Build the "new" self-contained database we will archive and restore.
    source_db = tmp_path / "source.db"
    src = sqlite3.connect(source_db)
    src.execute("CREATE TABLE audit_rows (id INTEGER PRIMARY KEY, v TEXT)")
    src.execute("INSERT INTO audit_rows (id, v) VALUES (99, 'restored')")
    src.commit()
    src.close()

    service = _service(tmp_path, db_path)
    service.ensure_backup_dir()
    archive = service.backup_dir / "mygarage-full-restoretest.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(source_db, arcname="mygarage.db")

    # Live target: an older DB plus stale wal/shm sidecars on disk. Closing a
    # connection checkpoints and removes the real wal, so plant sidecar files
    # explicitly - the restore target must genuinely have leftovers to clean.
    stale = _make_wal_db_with_pending_frames(db_path)
    stale.close()
    wal_path = Path(str(db_path) + "-wal")
    shm_path = Path(str(db_path) + "-shm")
    wal_path.write_bytes(b"stale wal bytes")
    shm_path.write_bytes(b"stale shm bytes")

    await service.restore_full_backup("mygarage-full-restoretest.tar.gz", create_safety=False)

    assert not wal_path.exists() and not shm_path.exists(), (
        "stale -wal/-shm sidecars survived restore; SQLite may replay the old "
        "WAL over the restored database (audit finding F2, restore side)"
    )

    check = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = check.execute("SELECT id, v FROM audit_rows ORDER BY id").fetchall()
    finally:
        check.close()
    assert rows == [(99, "restored")], f"restored db has wrong content: {rows!r}"


def _read_rows(db_path: Path) -> list[tuple[int, str]]:
    """Read audit_rows read-only. Quoted, so a # in the name stays part of the path."""
    check = sqlite3.connect(f"file:{quote(str(db_path))}?mode=ro", uri=True)
    try:
        return check.execute("SELECT id, v FROM audit_rows ORDER BY id").fetchall()
    finally:
        check.close()


def _write_one_row_db(db_path: Path, row_id: int, value: str) -> None:
    """A plain rollback-journal database holding a single audit row."""
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE audit_rows (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO audit_rows (id, v) VALUES (?, ?)", (row_id, value))
    conn.commit()
    conn.close()


def _plant_live_wal_db(db_path: Path) -> None:
    """Leave a closed WAL database at db_path whose newest row lives only in its -wal.

    Closing the writer checkpoints and deletes the WAL, so the writer works in a
    scratch folder and its db, -wal and -shm get copied over while it's still open.
    """
    scratch = db_path.parent / "writer"
    scratch.mkdir()
    source = scratch / "live.db"
    writer = _make_wal_db_with_pending_frames(source)
    try:
        shutil.copyfile(source, db_path)
        for suffix in ("-wal", "-shm"):
            shutil.copyfile(f"{source}{suffix}", f"{db_path}{suffix}")
    finally:
        writer.close()


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["garage.db", "my#garage.db", "mygarage.db"])
async def test_restore_writes_the_configured_database_file(tmp_path: Path, name: str) -> None:
    """The archive's mygarage.db lands in the file the app opens, whatever it's called.

    It used to land at `mygarage.db` beside the configured file, and the WAL
    hygiene then deleted the live file's -wal: the app kept its old data, minus
    every row that hadn't been checkpointed. The `mygarage.db` case passes at
    t=0: it's the guard for the default deployment, and extracting the database
    members to `self.data_dir` instead of the database's own folder kills it.
    """
    db_path = tmp_path / name
    _plant_live_wal_db(db_path)
    assert Path(f"{db_path}-wal").stat().st_size > 0, "the live WAL frame wasn't planted"

    source_db = tmp_path / "source.db"
    _write_one_row_db(source_db, 99, "restored")
    service = _service(tmp_path, db_path)
    service.ensure_backup_dir()
    with tarfile.open(service.backup_dir / "mygarage-full-configured.tar.gz", "w:gz") as tar:
        tar.add(source_db, arcname="mygarage.db")

    await service.restore_full_backup("mygarage-full-configured.tar.gz", create_safety=False)

    assert not Path(f"{db_path}-wal").exists() and not Path(f"{db_path}-shm").exists()
    assert _read_rows(db_path) == [(99, "restored")], f"{name!r} wasn't the file restored"
    if name != "mygarage.db":
        assert not (tmp_path / "mygarage.db").exists(), "the restore wrote a stray mygarage.db"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_an_old_archives_wal_member_follows_the_configured_file(tmp_path: Path) -> None:
    """A pre-snapshot archive's -wal member restores beside the configured file.

    Those archives were raw copies of db and -wal, so the newest rows only exist
    in the -wal member. It used to land at `mygarage.db-wal`, next to nothing.
    """
    db_path = tmp_path / "garage.db"
    _write_one_row_db(db_path, 7, "live")

    service = _service(tmp_path, db_path)
    service.ensure_backup_dir()
    old_dir = tmp_path / "old"
    old_dir.mkdir()
    writer = _make_wal_db_with_pending_frames(old_dir / "old.db")
    try:
        with tarfile.open(service.backup_dir / "mygarage-full-old.tar.gz", "w:gz") as tar:
            tar.add(old_dir / "old.db", arcname="mygarage.db")
            tar.add(old_dir / "old.db-wal", arcname="mygarage.db-wal")
    finally:
        writer.close()

    await service.restore_full_backup("mygarage-full-old.tar.gz", create_safety=False)

    assert not (tmp_path / "mygarage.db-wal").exists(), "the WAL member landed at mygarage.db-wal"
    assert _read_rows(db_path) == [(1, "checkpointed"), (2, "wal-only")]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_in_memory_sqlite_stays_on_the_sqlite_side(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """In-memory SQLite has no file to size or snapshot, but it's still SQLite.

    With no path it fell through to the PostgreSQL branches: stats said
    "PostgreSQL" and a full backup ran pg_dump.
    """
    service = _service(tmp_path, None)
    (service.data_dir / "photos" / "car.jpg").write_bytes(b"not really a jpeg")

    def _no_pg_dump(output_path: Path) -> None:
        raise AssertionError("pg_dump ran for an in-memory SQLite database")

    monkeypatch.setattr(service, "_pg_dump", _no_pg_dump)

    assert service.get_database_stats() == {
        "path": "in-memory",
        "size_mb": 0,
        "last_modified": None,
        "exists": False,
    }

    with caplog.at_level(logging.WARNING, logger="app.services.backup_service"):
        meta = await service.create_full_backup()

    with tarfile.open(service.backup_dir / meta["filename"], "r:gz") as tar:
        names = tar.getnames()
    assert not set(names) & BackupService._SAFE_FILE_ENTRIES, f"archived a database: {names!r}"
    assert "photos/car.jpg" in names
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["in-memory SQLite has no file to back up"]


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["my#garage.db", "my?garage.db", "my%41garage.db"])
async def test_full_backup_snapshots_a_path_with_uri_characters(tmp_path: Path, name: str) -> None:
    """`#`, `?` and `%` in the database path stay part of the path.

    The snapshot opens a `file:` URI. Unescaped, `#garage.db?mode=ro` read as
    the fragment, so SQLite opened (and created) `.../my` read-write and the
    archive held an empty database. `%41` decoded to a file that isn't there.
    """
    db_path = tmp_path / name
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE audit_rows (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO audit_rows (id, v) VALUES (1, 'kept')")
    conn.commit()
    conn.close()

    service = _service(tmp_path, db_path)
    meta = await service.create_full_backup()
    archive = service.backup_dir / meta["filename"]

    extracted_db = _extract_member(archive, "mygarage.db", tmp_path)
    check = sqlite3.connect(extracted_db)
    try:
        tables = [
            row[0] for row in check.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        ]
        rows = check.execute("SELECT id, v FROM audit_rows").fetchall() if tables else []
    finally:
        check.close()

    assert tables == ["audit_rows"], f"archived an empty database for {name!r}"
    assert rows == [(1, "kept")]
    assert not (tmp_path / "my").exists(), "the snapshot created a stray database file"


@pytest.mark.unit
def test_pg_dump_names_the_database_the_engine_opens() -> None:
    """SQLAlchemy 2.1 decodes the URL's database name, so pg_dump has to as well."""
    url = "postgresql+asyncpg://u:p@h/my%41db"
    service = BackupService(
        backup_dir=Path("/nonexistent/backups"),
        database_path=None,
        data_dir=Path("/nonexistent"),
        database_url=url,
        is_sqlite=False,
    )

    assert service._parse_pg_url()["dbname"] == make_url(url).database == "myAdb"
