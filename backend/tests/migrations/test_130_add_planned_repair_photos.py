import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "app" / "migrations"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, MIGRATIONS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_repairs(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE planned_repairs (id INTEGER PRIMARY KEY)"))


def test_130_creates_photos_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_repairs(engine)
    _load("130_add_planned_repair_photos").upgrade(engine)

    cols = {c["name"]: c for c in inspect(engine).get_columns("planned_repair_photos")}
    assert set(cols) == {"id", "repair_id", "file_path", "created_at"}
    assert cols["repair_id"]["nullable"] is False
    assert cols["file_path"]["nullable"] is False


def test_130_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_repairs(engine)
    mod = _load("130_add_planned_repair_photos")
    mod.upgrade(engine)
    mod.upgrade(engine)  # must not raise
    assert inspect(engine).has_table("planned_repair_photos")


def test_130_skips_when_repairs_table_missing(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("130_add_planned_repair_photos").upgrade(engine)  # must not raise
    assert not inspect(engine).has_table("planned_repair_photos")
