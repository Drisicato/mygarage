"""Convert an async SQLAlchemy URL to the sync driver equivalent.

The app runs on async drivers (`asyncpg`, `aiosqlite`), but two things need a
sync engine: the migration runner, and the maintenance tools under
`backend/tools/`. This conversion was written inline in `init_db` and nowhere
else, so the tools each hardcoded `sqlite:///{path}` instead. On a PostgreSQL
instance that silently created an empty SQLite file and then failed with
`no such table`, leaving PostgreSQL deployments with no repair path.

Matching is an exact match on the scheme, the part before "://". The original
inline version used an unanchored substring test, which would also rewrite a
driver name appearing in a password, and a prefix test can't tell a bare
``postgresql`` from ``postgresql+psycopg2``.
"""

from __future__ import annotations

#: URL scheme -> the sync driver the migration runner and tools use. A bare
#: ``postgresql`` is pinned too: SQLAlchemy 2.1 made it mean psycopg 3, and we
#: only ship psycopg2.
_SYNC_SCHEME: dict[str, str] = {
    "postgresql+asyncpg": "postgresql+psycopg2",
    "postgresql": "postgresql+psycopg2",
    "sqlite+aiosqlite": "sqlite",
}


def to_sync_url(url: str) -> str:
    """Return ``url`` with any async driver replaced by its sync counterpart.

    Idempotent: a URL that already names a sync driver is returned unchanged,
    so callers may apply it without first checking. It also pins a driverless
    PostgreSQL URL to psycopg2.

    Args:
        url: A SQLAlchemy database URL, async or sync.

    Returns:
        The same URL with a sync driver.

    Raises:
        ValueError: If ``url`` is empty or whitespace. Passing one on to
            ``create_engine`` produces a failure that names neither the caller
            nor the missing configuration.
    """
    if not url or not url.strip():
        raise ValueError("database URL is empty; nothing to connect to")

    scheme, sep, rest = url.partition("://")
    if scheme in _SYNC_SCHEME:
        return _SYNC_SCHEME[scheme] + sep + rest
    return url
