"""Fixtures shared by the tests in `tests/unit/utils`."""

from collections.abc import Callable
from typing import Any

import matplotlib.pyplot as plt
import pytest
from matplotlib.figure import Figure
from matplotlib.text import Text


@pytest.fixture
def chart_texts(monkeypatch: pytest.MonkeyPatch) -> Callable[[], list[list[str]]]:
    """Read back the text each PDF chart drew, tick labels included.

    Returns a function that gives one list of strings per figure drawn so far,
    in order. The charts close their figure once it's saved, so the close is
    where the finished figure can be caught.
    """
    figures: list[Figure] = []
    real_close = plt.close

    def keep(fig: Any = None) -> None:
        figures.append(fig)
        real_close(fig)

    monkeypatch.setattr(plt, "close", keep)

    def texts() -> list[list[str]]:
        return [[t.get_text() for t in fig.findobj(Text) if t.get_text()] for fig in figures]

    return texts
