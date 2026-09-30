from collections.abc import Callable
from datetime import date
from decimal import Decimal

import pytest
from pydantic import BaseModel, ValidationError
from sqlalchemy import Column, Numeric

from app.models.supply import SupplyPurchase, SupplyUsage
from app.schemas.supply import (
    SupplyAdjustmentCreate,
    SupplyCreate,
    SupplyPurchaseCreate,
    SupplyUpdate,
    SupplyUsageInput,
)


def test_supply_create_requires_valid_unit_type():
    ok = SupplyCreate(name="Mobil 1 5W-30", unit_type="volume")
    assert ok.unit_type == "volume"
    with pytest.raises(ValidationError):
        SupplyCreate(name="x", unit_type="gallons")


def test_supply_update_has_no_unit_type_field():
    # unit_type is immutable after creation.
    assert "unit_type" not in SupplyUpdate.model_fields


def test_usage_input_quantity_must_be_positive():
    SupplyUsageInput(supply_id=1, quantity=Decimal("0.5"))
    with pytest.raises(ValidationError):
        SupplyUsageInput(supply_id=1, quantity=Decimal("0"))


def test_adjustment_quantity_positive():
    SupplyAdjustmentCreate(quantity=Decimal("1"))
    with pytest.raises(ValidationError):
        SupplyAdjustmentCreate(quantity=Decimal("-1"))


def _column_max(column: Column) -> Decimal:
    """The largest value a Numeric(p, s) column holds."""
    numeric = column.type
    assert isinstance(numeric, Numeric) and numeric.precision and numeric.scale is not None
    return Decimal(10) ** (numeric.precision - numeric.scale) - Decimal(10) ** -numeric.scale


# A quantity is bounded by what its column holds, and no tighter: a household
# product cap would be invented. Past it, PostgreSQL refuses the row with a 500.
@pytest.mark.parametrize(
    ("build", "column"),
    [
        pytest.param(
            lambda q: SupplyUsageInput(supply_id=1, quantity=q),
            SupplyUsage.__table__.c.quantity,
            id="usage-on-a-line-item",
        ),
        pytest.param(
            lambda q: SupplyAdjustmentCreate(quantity=q),
            SupplyUsage.__table__.c.quantity,
            id="adjustment",
        ),
        pytest.param(
            lambda q: SupplyPurchaseCreate(date=date(2026, 1, 1), quantity=q),
            SupplyPurchase.__table__.c.quantity,
            id="purchase",
        ),
    ],
)
def test_a_quantity_takes_what_its_column_holds(
    build: Callable[[Decimal], BaseModel], column: Column
):
    top = _column_max(column)
    assert top == Decimal("999999999.999")
    assert build(top).model_dump()["quantity"] == top

    with pytest.raises(ValidationError) as refused:
        build(top + Decimal("0.001"))
    assert [e["type"] for e in refused.value.errors()] == ["less_than_equal"]
