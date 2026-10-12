import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "app" / "migrations"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, MIGRATIONS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_warranties(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE warranty_records (id INTEGER PRIMARY KEY)"))


def test_131_creates_documents_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_warranties(engine)
    _load("131_add_warranty_documents").upgrade(engine)

    cols = {c["name"]: c for c in inspect(engine).get_columns("warranty_documents")}
    assert set(cols) == {
        "id",
        "warranty_id",
        "file_path",
        "file_name",
        "file_type",
        "file_size",
        "created_at",
    }
    assert cols["warranty_id"]["nullable"] is False
    assert cols["file_name"]["nullable"] is False


def test_131_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_warranties(engine)
    mod = _load("131_add_warranty_documents")
    mod.upgrade(engine)
    mod.upgrade(engine)  # must not raise
    assert inspect(engine).has_table("warranty_documents")


def test_131_skips_when_warranties_table_missing(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("131_add_warranty_documents").upgrade(engine)  # must not raise
    assert not inspect(engine).has_table("warranty_documents")
