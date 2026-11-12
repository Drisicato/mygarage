"""Split a planned repair's parts from its jobs: planned_repair_parts.kind.

'part' is something bought (it becomes a supply when the repair is
completed); 'job' is work (it becomes a line item's labor). Existing rows
read as parts when they have a part number, link, picture or supply, and as
jobs otherwise. No CHECK: the API reads an odd value as a part.

FATAL: the PlannedRepairPart model maps the column.
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
    if "kind" in columns:
        return
    detail = [c for c in ("part_number", "url", "image_path", "supply_id") if c in columns]
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE planned_repair_parts "
                "ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'part'"
            )
        )
        # Only on the first run (the column was just added), so a later
        # edit that makes a detail-less row a part is never undone.
        if detail:
            no_detail = " AND ".join(f"{c} IS NULL" for c in detail)
            conn.execute(text(f"UPDATE planned_repair_parts SET kind = 'job' WHERE {no_detail}"))
        else:
            conn.execute(text("UPDATE planned_repair_parts SET kind = 'job'"))


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 163 is forward-only.")


if __name__ == "__main__":
    upgrade()
