"""Add 'Repair' to the service_category CHECK on service_visits and planned_repairs.

'Repair' is a new service category beside 'Collision'. Both tables carry a CHECK on
service_category, so an existing install rejects the new value until the list is
widened.

Dialect-aware:
  * PostgreSQL: the CHECK is found by definition, dropped and re-added with the new list.
  * SQLite: no in-place CHECK alter exists, so the table is rebuilt via live-DDL-swap:
    the existing ``CREATE TABLE`` is read from sqlite_master, the service_category
    IN-list is rewritten, and the table is rebuilt (create, copy, drop, rename),
    preserving every column, default and FK. Both tables are FK parents, so the
    rebuild runs with ``foreign_keys=OFF`` inside an explicit transaction and
    re-verifies with ``foreign_key_check`` before commit.

Idempotent: a table whose CHECK already lists 'Repair' (a fresh create_all install,
or a re-run) is skipped. Forward-only.

Non-FATAL: a failure only rejects the new category at insert; everything else keeps
working.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

_TABLES = ("service_visits", "planned_repairs")
_CATEGORIES = ("Maintenance", "Inspection", "Collision", "Repair", "Upgrades", "Detailing")
_NEW_LIST = ", ".join(f"'{c}'" for c in _CATEGORIES)

# The service_category CHECK, named or inline. The IN-list has one paren level.
_CHECK_RE = re.compile(
    r"(CHECK\s*\(\s*\(?\s*service_category\s+IN\s*)\([^)]*\)(\s*\))",
    re.IGNORECASE | re.DOTALL,
)


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
    for table in _TABLES:
        if not inspector.has_table(table):
            continue
        if engine.dialect.name == "postgresql":
            _upgrade_pg(engine, table)
        else:
            _upgrade_sqlite(engine, table)


def _upgrade_pg(engine, table):
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT conname, pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = CAST(:table AS regclass) AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%service_category%'
                """
            ),
            {"table": table},
        ).fetchone()
        if row and "'Repair'" in row[1]:
            return
        if row:
            conn.execute(text(f'ALTER TABLE {table} DROP CONSTRAINT "{row[0]}"'))
            name = row[0]
        else:
            name = (
                "check_service_visit_category"
                if table == "service_visits"
                else "check_planned_repairs_category"
            )
        conn.execute(
            text(
                f"ALTER TABLE {table} ADD CONSTRAINT {name} "
                f"CHECK (service_category IN ({_NEW_LIST}))"
            )
        )


def _upgrade_sqlite(engine, table):
    with engine.connect() as conn:
        ddl = conn.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).scalar()
        if not ddl:
            return
        match = _CHECK_RE.search(ddl)
        if not match or "'Repair'" in match.group(0):
            return  # no CHECK to widen, or already widened
        index_sqls = [
            r[0]
            for r in conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='index' "
                "AND tbl_name=? AND sql IS NOT NULL",
                (table,),
            ).fetchall()
        ]

    new_ddl = _CHECK_RE.sub(lambda m: f"{m.group(1)}({_NEW_LIST}){m.group(2)}", ddl, count=1)
    new_ddl = re.sub(
        rf'CREATE\s+TABLE\s+"?{table}"?',
        f'CREATE TABLE "{table}_new"',
        new_ddl,
        count=1,
        flags=re.IGNORECASE,
    )

    raw = engine.raw_connection()
    try:
        dbapi = raw.driver_connection  # underlying sqlite3.Connection
        prev_iso = dbapi.isolation_level
        dbapi.isolation_level = None  # autocommit: the transaction is driven explicitly
        cur = dbapi.cursor()
        # foreign_keys can only be toggled outside a transaction. With FKs off,
        # DROP TABLE will not cascade-delete the child rows.
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("BEGIN")
        try:
            cur.execute(f"DROP TABLE IF EXISTS {table}_new")
            cur.execute(new_ddl)
            cur.execute(f"INSERT INTO {table}_new SELECT * FROM {table}")
            cur.execute(f"DROP TABLE {table}")
            cur.execute(f"ALTER TABLE {table}_new RENAME TO {table}")
            for isql in index_sqls:
                cur.execute(isql)
            violations = cur.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError(f"FK violations after {table} rebuild: {violations}")
            cur.execute("COMMIT")
        except Exception:
            cur.execute("ROLLBACK")
            raise
        finally:
            cur.execute("PRAGMA foreign_keys=ON")
            dbapi.isolation_level = prev_iso
    finally:
        raw.close()


def downgrade():  # pragma: no cover
    raise NotImplementedError("Migration 128 is forward-only.")


if __name__ == "__main__":
    upgrade()
