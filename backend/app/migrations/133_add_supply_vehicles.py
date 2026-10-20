"""Share a supply with several vehicles: supply_vehicles replaces supplies.vin.

A supply used to be shared with every vehicle (vin NULL) or pinned to one.
Each pinned vin becomes a supply_vehicles row and the old column is cleared,
so deleting that vehicle no longer cascades the supply away with it. The
column itself stays (nullable, unmapped): dropping it on SQLite means a table
rebuild for nothing. No rows still means shared with every vehicle.

The table is normally created earlier by Base.metadata.create_all, so the
CREATE is guarded; the copy is guarded by NOT EXISTS, so a rerun is a no-op.
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
    if not inspector.has_table("supplies"):
        return

    with engine.begin() as conn:
        if not inspector.has_table("supply_vehicles"):
            conn.execute(
                text("""
                CREATE TABLE supply_vehicles (
                    supply_id INTEGER NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
                    vin VARCHAR(17) NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
                    PRIMARY KEY (supply_id, vin)
                )
            """)
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_supply_vehicles_vin ON supply_vehicles (vin)"
            )
        )

        columns = {c["name"] for c in inspector.get_columns("supplies")}
        if "vin" not in columns:
            return
        # Only vins that still name a vehicle: the FK would refuse the rest.
        conn.execute(
            text("""
            INSERT INTO supply_vehicles (supply_id, vin)
            SELECT s.id, s.vin FROM supplies s
            WHERE s.vin IS NOT NULL
              AND EXISTS (SELECT 1 FROM vehicles v WHERE v.vin = s.vin)
              AND NOT EXISTS (
                  SELECT 1 FROM supply_vehicles sv
                  WHERE sv.supply_id = s.id AND sv.vin = s.vin
              )
        """)
        )
        conn.execute(text("UPDATE supplies SET vin = NULL WHERE vin IS NOT NULL"))


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 133 is forward-only.")


if __name__ == "__main__":
    upgrade()
