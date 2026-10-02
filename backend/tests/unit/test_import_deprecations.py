"""The app imports with SQLAlchemy deprecations turned into errors.

export.py builds its loader options at import time, so a deprecated loader there
warns once, during conftest's import, where pytest's filter may not reach. A fresh
interpreter sees it every time.
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
