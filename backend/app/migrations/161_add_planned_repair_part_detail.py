"""Planned repair part detail and vehicle-system tags.

planned_repair_parts gains part_number, quantity (manual parts only; a supply
part keeps supply_quantity) and url. cost now reads as the price of one, so
the line total is cost x quantity, and an old row (quantity NULL = 1) keeps
its total.

planned_repair_systems tags a repair with the vehicle systems it touches
(engine, brakes, ...). No CHECK on the value: the list lives in the API, the
same as the inspection checklist keys, so adding one needs no migration.

FATAL: the models map the new columns and table. The table is normally
created earlier by Base.metadata.create_all, so the CREATE is guarded.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

FATAL = True


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
    with engine.begin() as conn:
        if inspector.has_table("planned_repair_parts"):
            columns = {c["name"] for c in inspector.get_columns("planned_repair_parts")}
            for name, sql_type in (
                ("part_number", "VARCHAR(60)"),
                ("quantity", "NUMERIC(12, 3)"),
                ("url", "VARCHAR(2000)"),
            ):
                if name not in columns:
                    conn.execute(
                        text(f"ALTER TABLE planned_repair_parts ADD COLUMN {name} {sql_type}")
                    )

        if inspector.has_table("planned_repairs"):
            if not inspector.has_table("planned_repair_systems"):
                conn.execute(
                    text("""
                    CREATE TABLE planned_repair_systems (
                        repair_id INTEGER NOT NULL
                            REFERENCES planned_repairs(id) ON DELETE CASCADE,
                        system VARCHAR(30) NOT NULL,
                        PRIMARY KEY (repair_id, system)
                    )
                """)
                )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_planned_repair_systems_system "
                    "ON planned_repair_systems (system)"
                )
            )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 161 is forward-only.")


if __name__ == "__main__":
    upgrade()
