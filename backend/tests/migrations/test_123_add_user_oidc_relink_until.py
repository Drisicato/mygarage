"""Migration 123: users.oidc_relink_until, the admin-approved SSO relink window.

Nullable with no backfill: NULL means no relink is armed, so every existing
account behaves exactly as before. FATAL, because every `select(User)` names the
column. Parameterised over SQLite and PostgreSQL via `engine_for_migration`.
"""

import datetime as dt
import importlib.util
from pathlib import Path

from sqlalchemy import DateTime, bindparam, inspect, text

import app.migrations as _m

_NAME = "123_add_user_oidc_relink_until"


def _load(name: str = _NAME):
    path = Path(_m.__file__).parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_users(engine) -> None:
    """A pre-123 users table with one account in it."""
    with engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(100) NOT NULL)")
        )
        conn.execute(text("INSERT INTO users (id, username) VALUES (1, 'existing')"))


def test_123_adds_a_nullable_timestamp_and_leaves_rows_unarmed(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_users(engine)

    _load().upgrade(engine)

    cols = {c["name"]: c for c in inspect(engine).get_columns("users")}
    assert "oidc_relink_until" in cols
    assert cols["oidc_relink_until"]["nullable"] is True
    # DATETIME on SQLite, TIMESTAMP on PostgreSQL; both reflect as a DateTime.
    assert isinstance(cols["oidc_relink_until"]["type"], DateTime), cols["oidc_relink_until"]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT oidc_relink_until FROM users")).scalar_one() is None


def test_123_column_holds_a_naive_utc_timestamp(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_users(engine)
    _load().upgrade(engine)

    until = dt.datetime(2026, 9, 30, 12, 34, 56)
    # Bound as a DateTime so SQLAlchemy formats it, not sqlite3's deprecated adapter.
    stmt = text("UPDATE users SET oidc_relink_until = :u WHERE id = 1").bindparams(
        bindparam("u", type_=DateTime())
    )
    with engine.begin() as conn:
        conn.execute(stmt, {"u": until})
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT oidc_relink_until FROM users WHERE id = 1")).scalar_one()
    # SQLite hands back text, PostgreSQL a datetime; either way it's the same instant.
    if isinstance(stored, str):
        stored = dt.datetime.fromisoformat(stored)
    assert stored == until


def test_123_is_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_users(engine)
    mod = _load()

    mod.upgrade(engine)
    mod.upgrade(engine)  # must not raise "duplicate column"

    cols = [c["name"] for c in inspect(engine).get_columns("users")]
    assert cols.count("oidc_relink_until") == 1


def test_123_missing_users_table_skips(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load().upgrade(engine)  # no table: nothing to do, no raise
    assert not inspect(engine).has_table("users")


def test_123_is_fatal():
    assert _load().FATAL is True
