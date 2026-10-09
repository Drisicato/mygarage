"""Add supplies.image_path, the relative path of a supply's product image.

A nullable VARCHAR(255) holding a path under the photos directory
(``supplies/<id>-<token>.jpg``). NULL means the supply has no image, so every
existing row behaves exactly as before. No backfill and no CHECK.

FATAL: the model declares the column and every supply query selects it, so a
silent failure would boot the app against a missing column (124's precedent).
Idempotent: the column is added only when absent. A VARCHAR is identical on
SQLite and PostgreSQL, so there is no per-dialect type.
"""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import Engine, create_engine, inspect, text

FATAL = True


def _get_fallback_engine() -> Engine:
    """Build a SQLite engine from environment for standalone execution."""
    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        return create_engine(f"sqlite:///{db_path}")
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    return create_engine(f"sqlite:///{data_dir / 'mygarage.db'}")


def upgrade(engine: Engine | None = None) -> None:
    """Add supplies.image_path (nullable VARCHAR(255), no backfill)."""
    if engine is None:
        engine = _get_fallback_engine()

    if not inspect(engine).has_table("supplies"):
        return

    with engine.begin() as conn:
        existing = {col["name"] for col in inspect(engine).get_columns("supplies")}
        if "image_path" not in existing:
            conn.execute(text("ALTER TABLE supplies ADD COLUMN image_path VARCHAR(255)"))
            print("  ✓ Added supplies.image_path (nullable)")
        else:
            print("  → image_path already exists, skipping")


def downgrade() -> None:
    """Rollback not supported."""
    print("Downgrade not supported for ALTER TABLE ADD COLUMN")


if __name__ == "__main__":
    upgrade()
