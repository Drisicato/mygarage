"""A staged full restore is in place before anything opens the database.

The integration client never runs the lifespan, so this drives it through TestClient (as
test_trusted_proxy_lifespan.py does) and stops startup at init_db: its create_all is the first
thing that opens the database, and the migrations run inside it. The staging is planted by hand
in its on-disk layout, since that layout is a contract between two processes, and the one that
applies it can be a newer version.
"""

import json
import logging
import sqlite3
from pathlib import Path
from urllib.parse import quote

import pytest
from starlette.testclient import TestClient

from app import main as app_main
from app.config import settings
from app.routes import backup as backup_routes

MEDIA = ("photos", "documents", "attachments")
PRERESTORE = "mygarage-full-safety-prerestore-2026-10-02-120000.tar.gz"


class _StopStartupError(Exception):
    """Raised in place of init_db, so startup ends there."""


def _one_row_db(path: Path, value: str) -> None:
    """A rollback-journal database holding one audit row."""
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE audit_rows (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO audit_rows (id, v) VALUES (1, ?)", (value,))
    conn.commit()
    conn.close()


def _plant(tmp_path: Path, killed_mid_swap: bool) -> tuple[Path, Path, Path]:
    """A staged restore as the restore request leaves it, or as a start killed mid-swap does."""
    data_dir = tmp_path / "data"
    backups = tmp_path / "backups"
    staging = data_dir / ".restore-pending"
    for name in MEDIA:
        (data_dir / name).mkdir(parents=True)
        (staging / name).mkdir(parents=True)
    (data_dir / "photos" / "old.jpg").write_bytes(b"old photo")
    (staging / "photos" / "new.jpg").write_bytes(b"new photo")
    db = tmp_path / "garage.db"
    if killed_mid_swap:
        # Killed after the safety archive, the marker and the database swap, with the live photos set aside.
        backups.mkdir()
        (backups / PRERESTORE).write_bytes(b"written before the kill")
        marker = {
            "database": str(db.resolve()),
            "source_backup": "x",
            "prerestore_backup": PRERESTORE,
        }
        (staging / "applying").write_text(json.dumps(marker))
        _one_row_db(db, "restored")
        (staging / "previous").mkdir()
        (data_dir / "photos").rename(staging / "previous" / "photos")
    else:
        _one_row_db(db, "live")
        _one_row_db(tmp_path / "garage.db.restore-pending", "restored")
    manifest = {
        "format": 1,
        "source_backup": "mygarage-full-2026-10-02-120000.tar.gz",
        "staged_at": "2026-10-02T12:00:00+00:00",
        "database": str(db.resolve()),
        "prerestore_backup": PRERESTORE,
    }
    (staging / "manifest.json").write_text(json.dumps(manifest))
    return data_dir, db, backups


def _point_the_app_at(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, db: Path, backups: Path
) -> None:
    """Settings and the backup routes' paths, as a container with these folders would have them."""
    monkeypatch.setattr(settings, "data_dir", data_dir)
    for name in MEDIA:
        monkeypatch.setattr(settings, f"{name}_dir", data_dir / name)
    monkeypatch.setattr(backup_routes, "DATABASE_PATH", db)
    monkeypatch.setattr(backup_routes, "BACKUP_DIR", backups)


@pytest.mark.parametrize("maintenance_mode", [False, True], ids=["normal", "maintenance"])
@pytest.mark.parametrize("killed_mid_swap", [False, True], ids=["staged", "killed_mid_swap"])
def test_a_staged_restore_is_in_place_before_init_db(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, maintenance_mode: bool, killed_mid_swap: bool
) -> None:
    data_dir, db, backups = _plant(tmp_path, killed_mid_swap)
    monkeypatch.setattr(settings, "maintenance_mode", maintenance_mode)
    _point_the_app_at(monkeypatch, data_dir, db, backups)
    seen: dict[str, object] = {}

    async def _init_db_probe() -> None:
        conn = sqlite3.connect(f"file:{quote(str(db))}?mode=ro", uri=True)
        try:
            seen["rows"] = conn.execute("SELECT v FROM audit_rows").fetchall()
        finally:
            conn.close()
        seen["photos"] = sorted(p.name for p in (data_dir / "photos").iterdir())
        seen["staged"] = (data_dir / ".restore-pending").exists()
        seen["safety"] = sorted(p.name for p in backups.glob("*.tar.gz"))
        raise _StopStartupError

    monkeypatch.setattr(app_main, "init_db", _init_db_probe)

    with pytest.raises(_StopStartupError):
        with TestClient(app_main.app):
            pass

    assert seen == {
        "rows": [("restored",)],
        "photos": ["new.jpg"],
        "staged": False,
        "safety": [PRERESTORE],
    }


def test_a_half_applied_restore_that_cannot_finish_stops_the_start(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The marker is down and the app now opens another database: the start fails before init_db.

    A guard; mutant: catch the refusal in the lifespan and start anyway.
    """
    data_dir, _, backups = _plant(tmp_path, killed_mid_swap=True)
    other = tmp_path / "other.db"
    _one_row_db(other, "other")
    _point_the_app_at(monkeypatch, data_dir, other, backups)
    reached: list[bool] = []

    async def _init_db_probe() -> None:
        reached.append(True)
        raise _StopStartupError

    monkeypatch.setattr(app_main, "init_db", _init_db_probe)

    with pytest.raises(RuntimeError, match="can't finish it"):
        with TestClient(app_main.app):
            pass

    assert reached == []
    assert (data_dir / ".restore-pending" / "previous" / "photos" / "old.jpg").exists()


def test_a_staged_database_with_no_staging_in_the_data_folder_waits(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """MYGARAGE_DATA_DIR changed between the restore and the restart: the start goes on, says so, keeps the file.

    The data folder is made before the apply, which takes its lock there. A guard; mutant:
    make the data folder after the apply (the lock file can't be opened, and every start fails).
    """
    _, db, backups = _plant(tmp_path, killed_mid_swap=False)
    _point_the_app_at(monkeypatch, tmp_path / "moved-data", db, backups)
    reached: list[bool] = []

    async def _init_db_probe() -> None:
        reached.append(True)
        raise _StopStartupError

    monkeypatch.setattr(app_main, "init_db", _init_db_probe)

    with caplog.at_level(logging.ERROR, logger="app.services.restore_staging"):
        with pytest.raises(_StopStartupError):
            with TestClient(app_main.app):
                pass

    assert reached == [True]
    assert (tmp_path / "garage.db.restore-pending").exists()
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("MYGARAGE_DATA_DIR" in message for message in errors), errors
