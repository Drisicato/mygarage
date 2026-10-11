"""Create planned_repair_photos for photos attached to planned repairs.

Normally created earlier by Base.metadata.create_all, so the has_table guard skips it.
Non-FATAL: a failure only disables repair photos; the board itself is unaffected.
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
    if not inspector.has_table("planned_repairs") or inspector.has_table("planned_repair_photos"):
        return

    is_pg = engine.dialect.name == "postgresql"
    pk_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    ts_type = "TIMESTAMP" if is_pg else "DATETIME"

    with engine.begin() as conn:
        conn.execute(
            text(f"""
            CREATE TABLE planned_repair_photos (
                id {pk_type},
                repair_id INTEGER NOT NULL REFERENCES planned_repairs(id) ON DELETE CASCADE,
                file_path VARCHAR(255) NOT NULL,
                created_at {ts_type} DEFAULT CURRENT_TIMESTAMP
            )
        """)
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_planned_repair_photos_repair_id "
                "ON planned_repair_photos (repair_id)"
            )
        )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 130 is forward-only.")


if __name__ == "__main__":
    upgrade()
