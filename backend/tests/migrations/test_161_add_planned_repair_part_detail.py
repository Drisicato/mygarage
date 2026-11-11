"""Tests for migration 161 (planned repair part detail and vehicle-system tags)."""

import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

import app.migrations as _m


def _load(name):
    path = Path(_m.__file__).parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_126_install(engine):
    """An install with 125 and 126 applied: parts without the detail columns."""
    is_pg = engine.dialect.name == "postgresql"
    pk = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(text(f"CREATE TABLE vendors (id {pk}, name VARCHAR(200))"))
        conn.execute(text(f"CREATE TABLE service_visits (id {pk}, vin VARCHAR(17))"))
        conn.execute(text(f"CREATE TABLE supplies (id {pk}, name VARCHAR(120))"))
    _load("125_add_planned_repairs").upgrade(engine)
    _load("126_add_planned_repair_part_supplies").upgrade(engine)


def test_161_adds_the_part_columns_and_systems_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_126_install(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO vehicles (vin) VALUES ('1HGCM82633A004352')"))
        conn.execute(
            text(
                "INSERT INTO planned_repairs (vin, title, status, priority, position) "
                "VALUES ('1HGCM82633A004352', 'Pads', 'planning', 'medium', 0)"
            )
        )
        conn.execute(
            text("INSERT INTO planned_repair_parts (repair_id, description, cost) VALUES (1, 'Pads', 40)")
        )

    _load("161_add_planned_repair_part_detail").upgrade(engine)

    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("planned_repair_parts")}
    assert {"part_number", "quantity", "url"} <= cols
    assert insp.has_table("planned_repair_systems")
    assert insp.get_pk_constraint("planned_repair_systems")["constrained_columns"] == [
        "repair_id",
        "system",
    ]
    fks = {fk["referred_table"] for fk in insp.get_foreign_keys("planned_repair_systems")}
    assert fks == {"planned_repairs"}

    with engine.begin() as conn:
        # The existing part keeps its cost and reads as quantity one (NULL).
        row = conn.execute(text("SELECT cost, quantity FROM planned_repair_parts")).one()
        assert float(row.cost) == 40 and row.quantity is None
        conn.execute(
            text("INSERT INTO planned_repair_systems (repair_id, system) VALUES (1, 'brakes')")
        )


def test_161_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_126_install(engine)
    mod = _load("161_add_planned_repair_part_detail")
    mod.upgrade(engine)
    mod.upgrade(engine)
    cols = [c["name"] for c in inspect(engine).get_columns("planned_repair_parts")]
    assert cols.count("part_number") == 1


def test_161_skips_without_the_planned_repair_tables(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("161_add_planned_repair_part_detail").upgrade(engine)
    assert not inspect(engine).has_table("planned_repair_systems")
