"""A picture on each planned repair part: planned_repair_parts.image_path.

Relative to settings.photos_dir (``<VIN>/planned_repairs/parts/<id>-<token>.jpg``),
so deleting the vehicle's photo directory takes the files with it. NULL = no
picture.

FATAL: the PlannedRepairPart model maps the column, so an old DB without it
fails every planned repair query.
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
    if not inspector.has_table("planned_repair_parts"):
        return

    columns = {c["name"] for c in inspector.get_columns("planned_repair_parts")}
    if "image_path" not in columns:
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE planned_repair_parts ADD COLUMN image_path VARCHAR(255)")
            )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 162 is forward-only.")


if __name__ == "__main__":
    upgrade()
