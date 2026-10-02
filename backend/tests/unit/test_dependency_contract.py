"""SQLAlchemy 2.1 ships greenlet only with its [asyncio] extra.

The app imports sqlalchemy.ext.asyncio (app/database.py), and on 2.1 that import
raises without greenlet. So the dependency has to name the extra: a lock that
only happens to carry greenlet for some other reason isn't a contract.
"""

import tomllib
from pathlib import Path

from packaging.requirements import Requirement

PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def _requirement(name: str) -> Requirement:
    """The one runtime requirement for ``name`` in pyproject.toml."""
    deps = tomllib.loads(PYPROJECT.read_text())["project"]["dependencies"]
    matches = [r for r in (Requirement(d) for d in deps) if r.name == name]
    assert len(matches) == 1, f"expected one {name} requirement, got {matches}"
    return matches[0]


def test_sqlalchemy_is_required_with_its_asyncio_extra() -> None:
    assert "asyncio" in _requirement("sqlalchemy").extras
