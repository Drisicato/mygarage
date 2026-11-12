"""Tests for migration 163 (planned_repair_parts.kind)."""

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
    is_pg = engine.dialect.name == "postgresql"
    pk = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(text(f"CREATE TABLE vendors (id {pk}, name VARCHAR(200))"))
        conn.execute(text(f"CREATE TABLE service_visits (id {pk}, vin VARCHAR(17))"))
        conn.execute(text(f"CREATE TABLE supplies (id {pk}, name VARCHAR(120))"))
    for name in (
        "125_add_planned_repairs",
        "126_add_planned_repair_part_supplies",
        "161_add_planned_repair_part_detail",
        "162_add_planned_repair_part_images",
    ):
        _load(name).upgrade(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO vehicles (vin) VALUES ('1HGCM82633A004352')"))
        conn.execute(text("INSERT INTO supplies (name) VALUES ('Oil')"))
        conn.execute(
            text(
                "INSERT INTO planned_repairs (vin, title, status, priority, position) "
                "VALUES ('1HGCM82633A004352', 'Pump', 'planning', 'medium', 0)"
            )
        )
        rows = [
            ("Labor", "NULL", "NULL", "NULL", "NULL"),
            ("Water pump", "'WP-1'", "NULL", "NULL", "NULL"),
            ("Gasket", "NULL", "'https://x.test'", "NULL", "NULL"),
            ("Thermostat", "NULL", "NULL", "'V/planned_repairs/parts/4-a.jpg'", "NULL"),
            ("Oil", "NULL", "NULL", "NULL", "1"),
        ]
        for desc, number, url, image, supply in rows:
            conn.execute(
                text(
                    "INSERT INTO planned_repair_parts "
                    "(repair_id, description, part_number, url, image_path, supply_id, supply_quantity) "
                    f"VALUES (1, '{desc}', {number}, {url}, {image}, {supply}, "
                    f"{'4' if supply != 'NULL' else 'NULL'})"
                )
            )


def _kinds(engine) -> dict[str, str]:
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT description, kind FROM planned_repair_parts")).all()
    return {r.description: r.kind for r in rows}


def test_163_classifies_existing_rows(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_install(engine)
    _load("163_planned_repair_part_kind").upgrade(engine)
    assert _kinds(engine) == {
        "Labor": "job",
        "Water pump": "part",
        "Gasket": "part",
        "Thermostat": "part",
        "Oil": "part",
    }


def test_163_rerun_keeps_later_edits(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_install(engine)
    mod = _load("163_planned_repair_part_kind")
    mod.upgrade(engine)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE planned_repair_parts SET kind = 'part' WHERE description = 'Labor'")
        )
    mod.upgrade(engine)
    assert _kinds(engine)["Labor"] == "part"
    cols = [c["name"] for c in inspect(engine).get_columns("planned_repair_parts")]
    assert cols.count("kind") == 1


def test_163_skips_without_the_parts_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("163_planned_repair_part_kind").upgrade(engine)
    assert not inspect(engine).has_table("planned_repair_parts")
