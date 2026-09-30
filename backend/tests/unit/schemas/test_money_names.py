"""The money-name predicate, checked against every numeric column there is.

The response contract and the column registry both trust `is_money_name`, so a
money column it misses goes unchecked in both. The column test below gives a
verdict for every Numeric column in the models, not a sample, so a new column
fails here until someone decides which side it is on.
"""

import pytest
from sqlalchemy import Numeric

import app.main  # noqa: F401 (registers every model on Base.metadata)
from app.database import Base
from tests.unit.schemas._money_names import is_money_name

#: Every stored amount of money, as table.column.
EXPECTED_MONEY_COLUMNS = frozenset(
    {
        "def_records.cost",
        "def_records.price_per_unit",
        "financing_records.amount",
        "fuel_records.cost",
        "fuel_records.price_per_unit",
        "fuel_records.rebate",
        "insurance_coverages.deductible",
        "insurance_coverages.limit_primary",
        "insurance_coverages.limit_secondary",
        "insurance_coverages.premium",
        "insurance_policies.premium_amount",
        "insurance_policy_vehicles.deductible",
        "insurance_policy_vehicles.premium_share",
        "service_line_items.cost",
        "service_visits.misc_fees",
        "service_visits.shop_supplies",
        "service_visits.tax_amount",
        "service_visits.total_cost",
        "spot_rental_billings.electric",
        "spot_rental_billings.monthly_rate",
        "spot_rental_billings.total",
        "spot_rental_billings.waste",
        "spot_rental_billings.water",
        "spot_rentals.electric",
        "spot_rentals.monthly_rate",
        "spot_rentals.nightly_rate",
        "spot_rentals.total_cost",
        "spot_rentals.waste",
        "spot_rentals.water",
        "spot_rentals.weekly_rate",
        "supply_purchases.total_cost",
        "supply_usages.cost_snapshot",
        "supply_usages.unit_cost_snapshot",
        "tax_records.amount",
        "toll_transactions.amount",
        "vehicles.archive_sale_price",
        "vehicles.destination_charge",
        "vehicles.msrp_base",
        "vehicles.msrp_options",
        "vehicles.msrp_total",
        "vehicles.purchase_price",
        "vehicles.sold_price",
    }
)


def _numeric_columns() -> dict[str, str]:
    """table.column -> column name, for every Numeric (and Float) column."""
    return {
        f"{table.name}.{column.name}": column.name
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, Numeric)
    }


def test_the_column_scan_sees_the_models():
    # A floor on the scan, so an import change can't make the verdict below a
    # pass over nothing.
    assert len(_numeric_columns()) >= 120


def test_every_numeric_column_is_money_exactly_when_expected():
    columns = _numeric_columns()
    called_money = {qualified for qualified, name in columns.items() if is_money_name(name)}
    assert sorted(called_money - EXPECTED_MONEY_COLUMNS) == [], "money by name, not expected"
    assert sorted(EXPECTED_MONEY_COLUMNS - called_money) == [], "expected money, missed by name"


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
