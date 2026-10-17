import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "app" / "migrations"

TABLES = (
    "vehicle_inspections",
    "vehicle_inspection_items",
    "vehicle_inspection_corners",
    "vehicle_inspection_photos",
)


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, MIGRATIONS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_parents(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE planned_repairs (id INTEGER PRIMARY KEY)"))


def test_132_creates_inspection_tables(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_parents(engine)
    _load("132_add_vehicle_inspections").upgrade(engine)

    inspector = inspect(engine)
    for table in TABLES:
        assert inspector.has_table(table)

    cols = {c["name"]: c for c in inspector.get_columns("vehicle_inspections")}
    assert cols["date"]["nullable"] is False
    assert cols["odometer_km"]["nullable"] is True
    assert {"tire_pressure_front_kpa", "tire_pressure_rear_kpa"} <= set(cols)

    item_cols = {c["name"] for c in inspector.get_columns("vehicle_inspection_items")}
    assert item_cols == {"id", "inspection_id", "item_key", "status", "note", "planned_repair_id"}

    corner_cols = {c["name"] for c in inspector.get_columns("vehicle_inspection_corners")}
    assert {"position", "tread_depth_mm", "brake_pad_mm"} <= corner_cols
    assert "pressure_in_kpa" not in corner_cols
    assert {"tread_repair_id", "brake_repair_id"} <= corner_cols


def test_132_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_parents(engine)
    mod = _load("132_add_vehicle_inspections")
    mod.upgrade(engine)
    mod.upgrade(engine)  # must not raise
    for table in TABLES:
        assert inspect(engine).has_table(table)


def test_132_finishes_a_partial_run(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_parents(engine)
    with engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE vehicle_inspections (id INTEGER PRIMARY KEY, vin VARCHAR(17))")
        )
    _load("132_add_vehicle_inspections").upgrade(engine)
    for table in TABLES:
        assert inspect(engine).has_table(table)


def test_132_skips_when_parent_tables_missing(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("132_add_vehicle_inspections").upgrade(engine)  # must not raise
    assert not inspect(engine).has_table("vehicle_inspections")
