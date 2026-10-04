"""Add planned_repair_parts.supply_id and supply_quantity: plan a repair with supplies on hand.

Normally created earlier by Base.metadata.create_all, so the column guards skip it.
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


def upgrade(engine=None):
    if engine is None:
        engine = _get_fallback_engine()

    inspector = inspect(engine)
    if not inspector.has_table("planned_repair_parts") or not inspector.has_table("supplies"):
        return
    columns = {c["name"] for c in inspector.get_columns("planned_repair_parts")}

    with engine.begin() as conn:
        if "supply_id" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE planned_repair_parts ADD COLUMN supply_id INTEGER "
                    "REFERENCES supplies(id) ON DELETE SET NULL"
                )
            )
        if "supply_quantity" not in columns:
            conn.execute(
                text("ALTER TABLE planned_repair_parts ADD COLUMN supply_quantity NUMERIC(12,3)")
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_planned_repair_parts_supply_id "
                "ON planned_repair_parts (supply_id)"
            )
        )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 126 is forward-only.")


if __name__ == "__main__":
    upgrade()
