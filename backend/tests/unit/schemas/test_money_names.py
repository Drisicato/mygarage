"""The money-name predicate, on names that have no column of their own.

Its verdict on every Numeric column in the models is checked against the column
registry in tests/unit/models/test_money_columns.py. These are the response and
request field names the column scan can't see.
"""

import pytest

from tests.unit.schemas._money_names import is_money_name


@pytest.mark.parametrize(
    "name",
    [
        # Response and request fields with no column of their own.
        "average_cost",
        "avg_unit_cost",
        "calculated_total_cost",
        "change_amount",
        "def_cost",
        "effective_share",
        "parts_supplies_cost",
        "premium_change",
        "sale_price",
        "spent_this_year",
        "subtotal",
        "total_amount",
        "total_garage_value",
        "total_spent",
    ],
)
def test_money_without_a_column(name: str):
    assert is_money_name(name)


@pytest.mark.parametrize(
    "name",
    [
        # A unit beats a money word.
        "avg_cost_per_liter",
        "average_cost_per_hr",
        "cost_change_percent",
        "cost_per_km",
        "mileage_limit_km",
        "total_km_driven",
        "total_liters",
        # Numbers that are not money at all.
        "database_size_mb",
        "on_hand",
        "quantity",
        "running_balance",
        "uptime_seconds",
        "window_sticker_confidence_score",
    ],
)
def test_not_money(name: str):
    assert not is_money_name(name)
