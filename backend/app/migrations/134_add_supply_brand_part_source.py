"""Add supplies.brand and supplies.part_source (OEM or aftermarket).

FATAL: the Supply model maps both columns, so an old DB without them fails
every supplies query. Both are nullable; part_source has no CHECK, the API
reads an odd stored value as null (the same as volume_unit).
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
    if not inspector.has_table("supplies"):
        return

    columns = {c["name"] for c in inspector.get_columns("supplies")}
    with engine.begin() as conn:
        for name, sql_type in (("brand", "VARCHAR(60)"), ("part_source", "VARCHAR(12)")):
            if name not in columns:
                conn.execute(text(f"ALTER TABLE supplies ADD COLUMN {name} {sql_type}"))


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 134 is forward-only.")


if __name__ == "__main__":
    upgrade()
