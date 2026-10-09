import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "app" / "migrations"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, MIGRATIONS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_supplies(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE supplies (id INTEGER PRIMARY KEY, name VARCHAR(120))"))
        conn.execute(text("INSERT INTO supplies (id, name) VALUES (1, 'Oil Filter')"))


def test_129_adds_nullable_image_path(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_supplies(engine)
    _load("129_add_supply_image").upgrade(engine)

    cols = {c["name"]: c for c in inspect(engine).get_columns("supplies")}
    assert cols["image_path"]["nullable"] is True
    with engine.connect() as conn:
        assert conn.execute(text("SELECT image_path FROM supplies WHERE id = 1")).scalar() is None


def test_129_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_supplies(engine)
    mod = _load("129_add_supply_image")
    mod.upgrade(engine)
    mod.upgrade(engine)  # must not raise
    assert "image_path" in {c["name"] for c in inspect(engine).get_columns("supplies")}


def test_129_skips_when_table_missing(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("129_add_supply_image").upgrade(engine)  # must not raise
    assert not inspect(engine).has_table("supplies")
