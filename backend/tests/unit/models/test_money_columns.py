"""Every money column has exactly the type the policy gives it.

Money is Numeric(12,2), a unit price Numeric(12,3), and the supply unit-cost
snapshot Numeric(15,4). Migration 122 widens an existing PostgreSQL database to
these, so a fresh create_all has to land on the same types or the two drift.

The registry (`MONEY_COLUMNS`) holds the list, and a scan of every Numeric
column keeps it complete: a money-named column the registry lacks fails here the
day it's added. A column with money's decimal places and no money word in its
name (a `surcharge`) is caught by the second scan: it's registered, or it's
listed in `NOT_MONEY_COLUMNS` with a reason. No database needed.
"""

from decimal import Decimal
from typing import Any

from sqlalchemy import Column, Numeric

import app.main  # noqa: F401 (registers every model on Base.metadata)
from app.database import Base
from app.schemas._money import MONEY_MAX, UNIT_COST_MAX, UNIT_PRICE_MAX
from tests.unit.schemas._money_names import (
    MONEY_COLUMNS,
    MONEY_TYPE,
    UNIT_COST_TYPE,
    UNIT_PRICE_TYPE,
    UNIT_WORDS,
    is_money_name,
)

#: Decimal places a money column has: cents, a unit price's tenth of a cent,
#: the unit-cost snapshot's four.
MONEY_SCALES = frozenset({2, 3, 4})

#: Columns with money's decimal places that aren't money.
NOT_MONEY_COLUMNS = frozenset(
    {
        "address_book.rating",  # a star rating
        "def_records.fill_level",  # a tank fraction, 0 to 1
        "location_points.speed",  # a GPS fix's speed
        "supply_purchases.quantity",  # a supply amount, Numeric(12,3)
        "supply_usages.quantity",  # same
        "vehicles.window_sticker_confidence_score",  # the OCR parser's score
    }
)


def _numeric_columns() -> dict[str, Column[Any]]:
    """table.column -> column, for every Numeric (and Float) column."""
    return {
        f"{table.name}.{column.name}": column
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, Numeric)
    }


def test_the_column_scan_sees_the_models():
    # A floor on the scan, so an import change can't make the verdicts below a
    # pass over nothing.
    assert len(_numeric_columns()) >= 120


def test_every_numeric_column_is_money_exactly_when_registered():
    columns = _numeric_columns()
    called_money = {
        qualified for qualified, column in columns.items() if is_money_name(column.name)
    }
    assert sorted(called_money - MONEY_COLUMNS.keys()) == [], "money by name, not registered"
    assert sorted(MONEY_COLUMNS.keys() - called_money) == [], "registered, missed by name"


def _money_shaped(column: Column[Any]) -> bool:
    """Money's decimal places, and no unit word in the name."""
    words = set(column.name.lower().split("_"))
    return column.type.scale in MONEY_SCALES and not words & UNIT_WORDS


def test_every_money_shaped_column_is_registered_or_excused():
    # The name check only sees money words. A `surcharge` has none, so it would
    # pass there as not money and never get the policy type.
    columns = _numeric_columns()
    unclaimed = sorted(
        qualified
        for qualified, column in columns.items()
        if _money_shaped(column)
        and qualified not in MONEY_COLUMNS
        and qualified not in NOT_MONEY_COLUMNS
    )
    assert unclaimed == [], "money-shaped: register it, or add it to NOT_MONEY_COLUMNS"
    # Each excuse still has to be needed, so the list can't collect dead rows.
    stale = sorted(
        qualified
        for qualified in NOT_MONEY_COLUMNS
        if qualified not in columns or not _money_shaped(columns[qualified])
    )
    assert stale == [], "in NOT_MONEY_COLUMNS but not a money-shaped column"
    assert NOT_MONEY_COLUMNS.isdisjoint(MONEY_COLUMNS)


def test_every_money_column_has_its_policy_type():
    columns = _numeric_columns()
    missing = sorted(MONEY_COLUMNS.keys() - columns.keys())
    assert missing == [], "registered but not a Numeric column in the models"
    wrong = {
        qualified: f"{type(column.type).__name__}({column.type.precision}, {column.type.scale})"
        for qualified, column in columns.items()
        if qualified in MONEY_COLUMNS
        # Exactly Numeric: a Float passes isinstance and stores a double.
        and (
            type(column.type) is not Numeric
            or (column.type.precision, column.type.scale) != MONEY_COLUMNS[qualified]
        )
    }
    assert wrong == {}


def test_the_registry_gives_each_kind_its_type():
    # A unit price and the unit-cost snapshot carry extra places; every other
    # amount is plain money.
    special = {"price_per_unit": UNIT_PRICE_TYPE, "unit_cost_snapshot": UNIT_COST_TYPE}
    wrong = {
        qualified: registered
        for qualified, registered in MONEY_COLUMNS.items()
        if registered != special.get(qualified.split(".", 1)[1], MONEY_TYPE)
    }
    assert wrong == {}


def test_each_type_holds_exactly_its_input_max():
    # The input bound is the column's own largest value, no more and no less.
    for (precision, scale), maximum in [
        (MONEY_TYPE, MONEY_MAX),
        (UNIT_PRICE_TYPE, UNIT_PRICE_MAX),
        (UNIT_COST_TYPE, UNIT_COST_MAX),
    ]:
        assert Decimal(10) ** (precision - scale) - Decimal(10) ** -scale == maximum
