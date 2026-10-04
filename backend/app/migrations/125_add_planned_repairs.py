"""Create planned_repairs and planned_repair_parts for the per-vehicle repair board.

Normally created earlier by Base.metadata.create_all, so the has_table guards skip it.
Non-FATAL by design.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

_STATUSES = ("planning", "in_progress", "done")
_PRIORITIES = ("low", "medium", "high", "urgent")
_CATEGORIES = ("Maintenance", "Inspection", "Collision", "Upgrades", "Detailing")


def _get_fallback_engine():
    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        return create_engine(f"sqlite:///{db_path}")
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    return create_engine(f"sqlite:///{data_dir / 'mygarage.db'}")


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade(engine=None):
    if engine is None:
        engine = _get_fallback_engine()

    inspector = inspect(engine)
    if not inspector.has_table("vehicles"):
        return

    is_pg = engine.dialect.name == "postgresql"
    pk_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    ts_type = "TIMESTAMP" if is_pg else "DATETIME"

    with engine.begin() as conn:
        if not inspector.has_table("planned_repairs"):
            conn.execute(
                text(f"""
                CREATE TABLE planned_repairs (
                    id {pk_type},
                    vin VARCHAR(17) NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
                    title VARCHAR(200) NOT NULL,
                    description TEXT,
                    status VARCHAR(20) NOT NULL,
                    priority VARCHAR(10) NOT NULL,
                    estimated_cost NUMERIC(12,2),
                    target_date DATE,
                    target_odometer_km NUMERIC(10,2),
                    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
                    service_category VARCHAR(30),
                    position INTEGER NOT NULL,
                    service_visit_id INTEGER REFERENCES service_visits(id) ON DELETE SET NULL,
                    completed_at {ts_type},
                    created_at {ts_type} DEFAULT CURRENT_TIMESTAMP,
                    updated_at {ts_type},
                    CONSTRAINT check_planned_repairs_status
                        CHECK (status IN ({_in_list(_STATUSES)})),
                    CONSTRAINT check_planned_repairs_priority
                        CHECK (priority IN ({_in_list(_PRIORITIES)})),
                    CONSTRAINT check_planned_repairs_category
                        CHECK (service_category IN ({_in_list(_CATEGORIES)}))
                )
            """)
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_planned_repairs_vin ON planned_repairs (vin)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_planned_repairs_vin_status "
                    "ON planned_repairs (vin, status)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_planned_repairs_vendor_id "
                    "ON planned_repairs (vendor_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_planned_repairs_service_visit_id "
                    "ON planned_repairs (service_visit_id)"
                )
            )

        if not inspector.has_table("planned_repair_parts"):
            conn.execute(
                text(f"""
                CREATE TABLE planned_repair_parts (
                    id {pk_type},
                    repair_id INTEGER NOT NULL REFERENCES planned_repairs(id) ON DELETE CASCADE,
                    description VARCHAR(200) NOT NULL,
                    cost NUMERIC(12,2),
                    created_at {ts_type} DEFAULT CURRENT_TIMESTAMP
                )
            """)
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_planned_repair_parts_repair_id "
                    "ON planned_repair_parts (repair_id)"
                )
            )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 125 is forward-only.")


if __name__ == "__main__":
    upgrade()
