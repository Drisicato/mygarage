"""Tests for migration 127 (vehicle_reminders.start_odometer_km, start_hours)."""

import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

import app.migrations as _m

_VIN = "1FT0000000000000X"


def _load(name):
    path = Path(_m.__file__).parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_tables(engine):
    is_pg = engine.dialect.name == "postgresql"
    pk = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    ts = "TIMESTAMP" if is_pg else "DATETIME"
    with engine.begin() as conn:
        conn.execute(
            text(f"""
            CREATE TABLE vehicle_reminders (
                id {pk}, vin VARCHAR(17), status VARCHAR(20), anchor_kind VARCHAR(12),
                due_mileage_km NUMERIC(10,2), due_hours NUMERIC(10,1), created_at {ts}
            )
        """)
        )
        conn.execute(
            text(
                f"CREATE TABLE odometer_records (id {pk}, vin VARCHAR(17), date DATE, "
                f"odometer_km NUMERIC(10,2), created_at {ts})"
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE hours_records (id {pk}, vin VARCHAR(17), date DATE, "
                f"engine_hours NUMERIC(10,1), created_at {ts})"
            )
        )


def _reminder(conn, **row):
    values = {
        "vin": _VIN,
        "status": "pending",
        "anchor_kind": None,
        "due_mileage_km": None,
        "due_hours": None,
        "created_at": "2026-10-05 12:00:00",
        **row,
    }
    conn.execute(
        text(
            "INSERT INTO vehicle_reminders (vin, status, anchor_kind, due_mileage_km, due_hours, "
            "created_at) VALUES (:vin, :status, :anchor_kind, :due_mileage_km, :due_hours, "
            ":created_at)"
        ),
        values,
    )


def _starts(engine) -> list[tuple]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT start_odometer_km, start_hours FROM vehicle_reminders ORDER BY id")
        ).all()
    return [
        (float(km) if km is not None else None, float(h) if h is not None else None)
        for km, h in rows
    ]


def test_127_backfills_the_reading_on_record_when_each_reminder_was_made(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_tables(engine)
    with engine.begin() as conn:
        # Entered before the reminders: one is the start.
        conn.execute(
            text(
                "INSERT INTO odometer_records (vin, date, odometer_km, created_at) VALUES "
                "(:vin, '2026-10-01', 1000, '2026-10-01 09:00:00'), "
                "(:vin, '2026-10-05', 1200, '2026-10-05 11:00:00'), "
                # Entered after them, though dated the same day: never a start.
                "(:vin, '2026-10-05', 1500, '2026-10-05 13:00:00')"
            ),
            {"vin": _VIN},
        )
        conn.execute(
            text(
                "INSERT INTO hours_records (vin, date, engine_hours, created_at) VALUES "
                "(:vin, '2026-10-05', 40.5, '2026-10-05 10:00:00')"
            ),
            {"vin": _VIN},
        )
        _reminder(conn, due_mileage_km=2000)  # gets 1200
        _reminder(conn, due_hours=100)  # gets 40.5
        _reminder(conn, due_mileage_km=2000, anchor_kind="service")  # anchored: left alone
        _reminder(conn, due_mileage_km=2000, status="done")  # closed: left alone
        _reminder(conn, due_mileage_km=2000, created_at="2026-09-01 00:00:00")  # nothing before

    _load("127_add_reminder_start_readings").upgrade(engine)

    assert _starts(engine) == [
        (1200.0, None),
        (None, 40.5),
        (None, None),
        (None, None),
        (None, None),
    ]


def test_127_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_tables(engine)
    mod = _load("127_add_reminder_start_readings")
    mod.upgrade(engine)
    mod.upgrade(engine)
    cols = [c["name"] for c in inspect(engine).get_columns("vehicle_reminders")]
    assert cols.count("start_odometer_km") == 1
    assert cols.count("start_hours") == 1


def test_127_skips_without_the_reminders_table(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("127_add_reminder_start_readings").upgrade(engine)
    assert not inspect(engine).has_table("vehicle_reminders")
