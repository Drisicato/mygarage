"""Tests for migration 162 (planned_repair_parts.image_path)."""

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


def _make_install(engine):
    """An install with the planned repair tables but no part images."""
    is_pg = engine.dialect.name == "postgresql"
    pk = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(text(f"CREATE TABLE vendors (id {pk}, name VARCHAR(200))"))
        conn.execute(text(f"CREATE TABLE service_visits (id {pk}, vin VARCHAR(17))"))
        conn.execute(text(f"CREATE TABLE supplies (id {pk}, name VARCHAR(120))"))
    _load("125_add_planned_repairs").upgrade(engine)
    _load("126_add_planned_repair_part_supplies").upgrade(engine)
    _load("161_add_planned_repair_part_detail").upgrade(engine)


def test_162_adds_image_path(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_install(engine)
    _load("162_add_planned_repair_part_images").upgrade(engine)
    cols = {c["name"] for c in inspect(engine).get_columns("planned_repair_parts")}
    assert "image_path" in cols


def test_162_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_install(engine)
    mod = _load("162_add_planned_repair_part_images")
    mod.upgrade(engine)
    mod.upgrade(engine)
    cols = [c["name"] for c in inspect(engine).get_columns("planned_repair_parts")]
    assert cols.count("image_path") == 1


def test_162_skips_without_the_parts_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("162_add_planned_repair_part_images").upgrade(engine)
    assert not inspect(engine).has_table("planned_repair_parts")
