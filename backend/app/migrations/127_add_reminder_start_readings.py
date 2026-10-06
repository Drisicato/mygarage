"""Add vehicle_reminders.start_odometer_km and start_hours: freeze a one-off's progress start.

An unanchored reminder counted its progress from the reading nearest the day it
was created, looked up on every read. A reading entered or corrected that same
day moved the start with the odometer, so the bar sat at zero and vanished once
the odometer passed due. New reminders store their starting readings when
created; this backfills pending unanchored ones from the latest reading on
record when each was created (odometer/hours rows created at or before it).
A reminder with no reading before it keeps NULL and the old lookup.

Idempotent: columns are added only when missing, and only NULL starts are filled.
Non-FATAL by design.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text


def _get_fallback_engine():
    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        return create_engine(f"sqlite:///{db_path}")
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    return create_engine(f"sqlite:///{data_dir / 'mygarage.db'}")


_UNANCHORED_PENDING = "status = 'pending' AND anchor_kind IS NULL"


def upgrade(engine=None):
    if engine is None:
        engine = _get_fallback_engine()

    inspector = inspect(engine)
    if not inspector.has_table("vehicle_reminders"):
        return
    columns = {c["name"] for c in inspector.get_columns("vehicle_reminders")}

    with engine.begin() as conn:
        if "start_odometer_km" not in columns:
            conn.execute(
                text("ALTER TABLE vehicle_reminders ADD COLUMN start_odometer_km NUMERIC(10,2)")
            )
        if "start_hours" not in columns:
            conn.execute(text("ALTER TABLE vehicle_reminders ADD COLUMN start_hours NUMERIC(10,1)"))

        if inspector.has_table("odometer_records"):
            conn.execute(
                text(f"""
                UPDATE vehicle_reminders SET start_odometer_km = (
                    SELECT o.odometer_km FROM odometer_records o
                    WHERE o.vin = vehicle_reminders.vin
                      AND o.created_at <= vehicle_reminders.created_at
                    ORDER BY o.date DESC, o.odometer_km DESC, o.id DESC
                    LIMIT 1
                )
                WHERE {_UNANCHORED_PENDING}
                  AND due_mileage_km IS NOT NULL
                  AND start_odometer_km IS NULL
            """)
            )
        if inspector.has_table("hours_records"):
            conn.execute(
                text(f"""
                UPDATE vehicle_reminders SET start_hours = (
                    SELECT h.engine_hours FROM hours_records h
                    WHERE h.vin = vehicle_reminders.vin
                      AND h.created_at <= vehicle_reminders.created_at
                    ORDER BY h.date DESC, h.engine_hours DESC, h.id DESC
                    LIMIT 1
                )
                WHERE {_UNANCHORED_PENDING}
                  AND due_hours IS NOT NULL
                  AND start_hours IS NULL
            """)
            )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 127 is forward-only.")


if __name__ == "__main__":
    upgrade()
