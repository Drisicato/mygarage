"""Create warranty_documents for files attached to warranty records.

Normally created earlier by Base.metadata.create_all, so the has_table guard skips it.
Non-FATAL: a failure only disables warranty documents; warranties themselves are unaffected.
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
    if not inspector.has_table("warranty_records") or inspector.has_table("warranty_documents"):
        return

    is_pg = engine.dialect.name == "postgresql"
    pk_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    ts_type = "TIMESTAMP" if is_pg else "DATETIME"

    with engine.begin() as conn:
        conn.execute(
            text(f"""
            CREATE TABLE warranty_documents (
                id {pk_type},
                warranty_id INTEGER NOT NULL REFERENCES warranty_records(id) ON DELETE CASCADE,
                file_path VARCHAR(255) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                file_type VARCHAR(100),
                file_size INTEGER,
                created_at {ts_type} DEFAULT CURRENT_TIMESTAMP
            )
        """)
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_warranty_documents_warranty_id "
                "ON warranty_documents (warranty_id)"
            )
        )


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 131 is forward-only.")


if __name__ == "__main__":
    upgrade()
