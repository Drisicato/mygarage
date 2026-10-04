"""Tests for migration 126 (planned_repair_parts.supply_id, supply_quantity)."""

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


def _make_125_install(engine):
    """An install with 125 applied: the parts table without the supply columns."""
    is_pg = engine.dialect.name == "postgresql"
    pk = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(text(f"CREATE TABLE vendors (id {pk}, name VARCHAR(200))"))
        conn.execute(text(f"CREATE TABLE service_visits (id {pk}, vin VARCHAR(17))"))
        conn.execute(text(f"CREATE TABLE supplies (id {pk}, name VARCHAR(120))"))
    _load("125_add_planned_repairs").upgrade(engine)


def test_126_adds_the_supply_columns(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_125_install(engine)
    _load("126_add_planned_repair_part_supplies").upgrade(engine)

    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("planned_repair_parts")}
    assert {"supply_id", "supply_quantity"} <= cols
    fks = {fk["referred_table"] for fk in insp.get_foreign_keys("planned_repair_parts")}
    assert "supplies" in fks
    index_cols = {tuple(ix["column_names"]) for ix in insp.get_indexes("planned_repair_parts")}
    assert ("supply_id",) in index_cols


def test_126_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_125_install(engine)
    mod = _load("126_add_planned_repair_part_supplies")
    mod.upgrade(engine)
    mod.upgrade(engine)
    cols = [c["name"] for c in inspect(engine).get_columns("planned_repair_parts")]
    assert cols.count("supply_id") == 1


def test_126_skips_without_the_parts_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("126_add_planned_repair_part_supplies").upgrade(engine)
    assert not inspect(engine).has_table("planned_repair_parts")
