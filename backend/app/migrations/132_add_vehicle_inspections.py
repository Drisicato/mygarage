"""Create the vehicle inspection tables: inspections, checklist items, wheel corners, photos.

Normally created earlier by Base.metadata.create_all, so the has_table guards skip them.
Each table is created on its own guard, so a run interrupted part way finishes next time.
Non-FATAL: a failure only disables inspections; the rest of the app is unaffected.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

_STATUS_VALUES = "('green', 'yellow', 'red', 'not_inspected')"


def _get_fallback_engine():
    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        return create_engine(f"sqlite:///{db_path}")
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    return create_engine(f"sqlite:///{data_dir / 'mygarage.db'}")


def upgrade(engine=None):
    if engine is None:
        engine = _get_fallback_engine()

    inspector = inspect(engine)
    if not inspector.has_table("vehicles") or not inspector.has_table("planned_repairs"):
        return

    is_pg = engine.dialect.name == "postgresql"
    pk_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    ts_type = "TIMESTAMP" if is_pg else "DATETIME"

    with engine.begin() as conn:
        if not inspector.has_table("vehicle_inspections"):
            conn.execute(
                text(f"""
                CREATE TABLE vehicle_inspections (
                    id {pk_type},
                    vin VARCHAR(17) NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
                    date DATE NOT NULL,
                    odometer_km NUMERIC(10, 2),
                    inspector VARCHAR(100),
                    tire_pressure_front_kpa NUMERIC(5, 1),
                    tire_pressure_rear_kpa NUMERIC(5, 1),
                    notes_interior TEXT,
                    notes_under_hood TEXT,
                    notes_under_vehicle TEXT,
                    notes_battery TEXT,
                    notes_tires TEXT,
                    notes_brakes TEXT,
                    recommendations TEXT,
                    created_at {ts_type} DEFAULT CURRENT_TIMESTAMP,
                    updated_at {ts_type}
                )
            """)
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_vin "
                "ON vehicle_inspections (vin)"
            )
        )

        if not inspector.has_table("vehicle_inspection_items"):
            conn.execute(
                text(f"""
                CREATE TABLE vehicle_inspection_items (
                    id {pk_type},
                    inspection_id INTEGER NOT NULL
                        REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
                    item_key VARCHAR(50) NOT NULL,
                    status VARCHAR(15) NOT NULL DEFAULT 'not_inspected',
                    note VARCHAR(500),
                    planned_repair_id INTEGER REFERENCES planned_repairs(id) ON DELETE SET NULL,
                    CONSTRAINT check_vehicle_inspection_items_status
                        CHECK (status IN {_STATUS_VALUES}),
                    CONSTRAINT uq_vehicle_inspection_items_key UNIQUE (inspection_id, item_key)
                )
            """)
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_items_inspection_id "
                "ON vehicle_inspection_items (inspection_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_items_planned_repair_id "
                "ON vehicle_inspection_items (planned_repair_id)"
            )
        )

        if not inspector.has_table("vehicle_inspection_corners"):
            conn.execute(
                text(f"""
                CREATE TABLE vehicle_inspection_corners (
                    id {pk_type},
                    inspection_id INTEGER NOT NULL
                        REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
                    position VARCHAR(2) NOT NULL,
                    tread_status VARCHAR(15) NOT NULL DEFAULT 'not_inspected',
                    tread_depth_mm NUMERIC(4, 1),
                    brake_status VARCHAR(15) NOT NULL DEFAULT 'not_inspected',
                    brake_pad_mm NUMERIC(4, 1),
                    tread_repair_id INTEGER REFERENCES planned_repairs(id) ON DELETE SET NULL,
                    brake_repair_id INTEGER REFERENCES planned_repairs(id) ON DELETE SET NULL,
                    CONSTRAINT check_vehicle_inspection_corners_position
                        CHECK (position IN ('lf', 'rf', 'lr', 'rr')),
                    CONSTRAINT check_vehicle_inspection_corners_tread_status
                        CHECK (tread_status IN {_STATUS_VALUES}),
                    CONSTRAINT check_vehicle_inspection_corners_brake_status
                        CHECK (brake_status IN {_STATUS_VALUES}),
                    CONSTRAINT uq_vehicle_inspection_corners_position
                        UNIQUE (inspection_id, position)
                )
            """)
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_corners_inspection_id "
                "ON vehicle_inspection_corners (inspection_id)"
            )
        )
        for column in ("tread_repair_id", "brake_repair_id"):
            conn.execute(
                text(
                    f"CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_corners_{column} "
                    f"ON vehicle_inspection_corners ({column})"
                )
            )

        if not inspector.has_table("vehicle_inspection_photos"):
            conn.execute(
                text(f"""
                CREATE TABLE vehicle_inspection_photos (
                    id {pk_type},
                    inspection_id INTEGER NOT NULL
                        REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
                    file_path VARCHAR(255) NOT NULL,
                    created_at {ts_type} DEFAULT CURRENT_TIMESTAMP
                )
            """)
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_photos_inspection_id "
                "ON vehicle_inspection_photos (inspection_id)"
            )
        )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 132 is forward-only.")


if __name__ == "__main__":
    upgrade()
