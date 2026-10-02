"""`sqlite_database_path` names the file the engine opens, not the URL's string form.

A guard on the helper, not a RED: it went in with the helper. Its teeth are two
mutants, each applied once and seen to fail here: `Path(url.database or "")`
(both in-memory cases come back as a path) and
`Path(str(url).removeprefix("sqlite+aiosqlite:///"))`, the old settings.py shape
(the `%25` and `#` cases come back escaped, and in-memory isn't None). That one
gets `%41` right by luck: `str(url)` renders the decoded `A` unescaped.

The `is_sqlite_url` tests at the bottom are the dialect check `is_sqlite` runs on.
"""

from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.database import is_sqlite_url, sqlite_database_path


@pytest.mark.unit
def test_an_escaped_percent_stays_a_literal_percent() -> None:
    """`%25` is how a URL spells a real `%` in the file name."""
    url = make_url("sqlite+aiosqlite:////data/my%2541garage.db")

    assert sqlite_database_path(url) == Path("/data/my%41garage.db")


@pytest.mark.unit
def test_a_percent_escape_is_decoded_the_way_the_engine_opens_it() -> None:
    """Pins SQLAlchemy 2.1's decode: on 2.0.54 the database stays `my%41garage.db`."""
    url = make_url("sqlite+aiosqlite:////data/my%41garage.db")

    assert sqlite_database_path(url) == Path("/data/myAgarage.db")


@pytest.mark.unit
def test_a_hash_in_the_file_name_is_not_escaped() -> None:
    """`str(url)` renders `#` as `%23`; the engine opens the `#`."""
    url = make_url("sqlite+aiosqlite:////data/my#garage.db")

    assert sqlite_database_path(url) == Path("/data/my#garage.db")


@pytest.mark.unit
@pytest.mark.parametrize("raw", ["sqlite+aiosqlite://", "sqlite+aiosqlite:///:memory:"])
def test_in_memory_has_no_file(raw: str) -> None:
    """Nothing on disk to size or snapshot."""
    assert sqlite_database_path(make_url(raw)) is None


@pytest.mark.unit
def test_postgresql_has_no_file() -> None:
    """Only SQLite opens a file."""
    url = make_url("postgresql+asyncpg://u:p@h/mygarage")

    assert sqlite_database_path(url) is None


@pytest.mark.unit
@pytest.mark.parametrize(
    "url",
    ["postgresql+asyncpg://u:p@h/sqlite_db", "postgresql+asyncpg://u:sqlite@h/mygarage"],
)
def test_a_postgresql_url_that_mentions_sqlite_is_not_sqlite(url: str) -> None:
    """The dialect decides, not the word turning up in a database name or password.

    The old substring test called these SQLite, so the app ran SQLite pragmas on PostgreSQL.
    """
    assert is_sqlite_url(url) is False


@pytest.mark.unit
def test_the_default_sqlite_url_is_sqlite() -> None:
    """A guard: passes at t=0.

    `make_url(url).drivername == "sqlite"` kills it, since the driver name is `sqlite+aiosqlite`.
    """
    assert is_sqlite_url("sqlite+aiosqlite:////data/mygarage.db") is True
