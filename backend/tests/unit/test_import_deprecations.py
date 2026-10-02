"""The app imports with SQLAlchemy deprecations turned into errors.

pytest.ini already covers import time: its filter applies while conftest loads, so a
deprecated loader in export.py's module-level options stops the whole session (exit 4).
This probe is the backstop for when that stops holding: the ini entry gets narrowed or
removed, or conftest's import order changes. A fresh interpreter sees the import every time.

Guard: passes at t=0. Mutant that kills it: `noload` back in export.py's
`_INSURANCE_LINK_LOADS`, run with `-p no:warnings` so conftest still loads.
"""

import subprocess
import sys

_PROBE = (
    "import warnings\n"
    "from sqlalchemy.exc import SADeprecationWarning\n"
    "warnings.simplefilter('error', SADeprecationWarning)\n"
    "import app.main\n"
)


def test_the_app_imports_without_sqlalchemy_deprecations() -> None:
    result = subprocess.run(
        [sys.executable, "-c", _PROBE], capture_output=True, text=True, timeout=120
    )
    assert result.returncode == 0, result.stderr[-2000:]
