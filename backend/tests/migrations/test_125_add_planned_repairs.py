"""Tests for migration 125 (planned_repairs, planned_repair_parts)."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import app.migrations as _m

_VIN = "1FT0000000000000X"


def _load(name):
    path = Path(_m.__file__).parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_deps(engine):
    is_pg = engine.dialect.name == "postgresql"
    pk = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(text(f"CREATE TABLE vendors (id {pk}, name VARCHAR(200))"))
        conn.execute(text(f"CREATE TABLE service_visits (id {pk}, vin VARCHAR(17))"))
        # The model's parts table references supplies since migration 126.
        conn.execute(text(f"CREATE TABLE supplies (id {pk}, name VARCHAR(120))"))
        conn.execute(text("INSERT INTO vehicles (vin) VALUES (:vin)"), {"vin": _VIN})


def _insert(conn, **overrides):
    row = {"vin": _VIN, "title": "Brakes", "status": "planning", "priority": "medium"}
    row.update(overrides)
    conn.execute(
        text(
            "INSERT INTO planned_repairs (vin, title, status, priority, position) "
            "VALUES (:vin, :title, :status, :priority, 0)"
        ),
        row,
    )


def test_125_creates_tables(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_deps(engine)
    _load("125_add_planned_repairs").upgrade(engine)

    insp = inspect(engine)
    assert insp.has_table("planned_repairs")
    assert insp.has_table("planned_repair_parts")
    cols = {c["name"] for c in insp.get_columns("planned_repairs")}
    assert {
        "id",
        "vin",
        "title",
        "description",
        "status",
        "priority",
        "estimated_cost",
        "target_date",
        "target_odometer_km",
        "vendor_id",
        "service_category",
        "position",
        "service_visit_id",
        "completed_at",
        "created_at",
        "updated_at",
    } <= cols
    fk_targets = {fk["referred_table"] for fk in insp.get_foreign_keys("planned_repairs")}
    assert {"vehicles", "vendors", "service_visits"} <= fk_targets
    index_cols = {tuple(ix["column_names"]) for ix in insp.get_indexes("planned_repairs")}
    assert ("vin",) in index_cols
    assert ("vin", "status") in index_cols


@pytest.mark.parametrize(
    "overrides",
    [{"status": "archived"}, {"priority": "whenever"}],
    ids=["status", "priority"],
)
def test_125_checks_reject_invalid_values(engine_for_migration, overrides):
    _dialect, engine, _url = engine_for_migration
    _make_deps(engine)
    _load("125_add_planned_repairs").upgrade(engine)

    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            _insert(conn, **overrides)


def test_125_checks_accept_valid_values(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_deps(engine)
    _load("125_add_planned_repairs").upgrade(engine)

    with engine.begin() as conn:
        for status in ("planning", "in_progress", "done"):
            for priority in ("low", "medium", "high", "urgent"):
                _insert(conn, status=status, priority=priority)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM planned_repairs")).scalar() == 12


def test_125_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_deps(engine)
    mod = _load("125_add_planned_repairs")
    mod.upgrade(engine)
    mod.upgrade(engine)
    assert inspect(engine).has_table("planned_repairs")


def test_125_missing_vehicles_table_skips(engine_for_migration):
    """Skips, without raising, when the vehicles table is absent."""
    _dialect, engine, _url = engine_for_migration
    _load("125_add_planned_repairs").upgrade(engine)
    assert not inspect(engine).has_table("planned_repairs")


def test_125_model_create_all_matches_migration_shape(engine_for_migration):
    """The ORM-declared tables carry the migration's columns, FKs and CHECKs."""
    from app.models.planned_repair import PlannedRepair, PlannedRepairPart

    _dialect, engine, _url = engine_for_migration
    _make_deps(engine)
    PlannedRepair.metadata.create_all(
        engine, tables=[PlannedRepair.__table__, PlannedRepairPart.__table__]
    )

    insp = inspect(engine)
    fk_targets = {fk["referred_table"] for fk in insp.get_foreign_keys("planned_repairs")}
    assert {"vehicles", "vendors", "service_visits"} <= fk_targets
    part_cols = {c["name"] for c in insp.get_columns("planned_repair_parts")}
    assert {"id", "repair_id", "description", "cost", "created_at"} <= part_cols

    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            _insert(conn, status="archived")
