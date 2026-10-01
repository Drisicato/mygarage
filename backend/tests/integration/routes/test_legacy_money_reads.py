"""A stored amount reads back, whatever bound the API puts on new input.

Legacy rows hold amounts today's input rules refuse: a negative vehicle price
from before `ge=0`, a nightly rate past the old 9,999.99 cap, or, on SQLite,
which ignores declared precision, a number past any column's width. A response
that inherits an input bound turns every read of such a record into a 500. So
each record is written straight through the ORM, past the schemas, and read back
through its real routes.

A value past MONEY_MAX only fits on SQLite; PostgreSQL's numeric columns never
held one, so that case is skipped there. Spot rentals refuse a negative in the
database itself (CHECK constraints), so theirs is a value past the old cap.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.def_record import DEFRecord
from app.models.financing import FinancingRecord
from app.models.fuel import FuelRecord
from app.models.insurance import InsuranceCoverage, InsurancePolicy, InsurancePolicyVehicle
from app.models.service_line_item import ServiceLineItem
from app.models.service_visit import ServiceVisit
from app.models.spot_rental import SpotRental
from app.models.spot_rental_billing import SpotRentalBilling
from app.models.tax import TaxRecord
from app.schemas._money import MONEY_MAX
from app.utils.household_time import household_today
from tests.integration.routes._legacy_reads import read_ok

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

NEGATIVE = Decimal("-5.25")
# Past every old spot-rental cap (9,999.99 and 99,999.99), inside a Numeric(8,2).
PAST_OLD_CAP = Decimal("123456.78")
PAST_MAX = Decimal("12345678901.23")
assert PAST_MAX > MONEY_MAX

LEGACY_VALUES = [
    pytest.param(NEGATIVE, id="negative"),
    pytest.param(PAST_MAX, id="past-money-max"),
]
RENTAL_VALUES = [
    pytest.param(PAST_OLD_CAP, id="past-old-cap"),
    pytest.param(PAST_MAX, id="past-money-max"),
]


def _skip_unless_storable(db: AsyncSession, value: Decimal) -> None:
    if value > MONEY_MAX and db.get_bind().dialect.name != "sqlite":
        pytest.skip("only SQLite ever stored an amount past MONEY_MAX")


def _assert_amounts(body: dict[str, Any], names: tuple[str, ...], value: Decimal) -> None:
    for name in names:
        assert body[name] is not None, name
        assert Decimal(str(body[name])) == value, f"{name}: {body[name]}"


FUEL = ("cost", "rebate", "price_per_unit")
DEF = ("cost", "price_per_unit")
RENTAL = ("nightly_rate", "weekly_rate", "monthly_rate", "electric", "water", "waste", "total_cost")
BILLING = ("monthly_rate", "electric", "water", "waste", "total")
VISIT = ("total_cost", "tax_amount", "shop_supplies", "misc_fees")
VEHICLE = (
    "purchase_price",
    "sold_price",
    "msrp_base",
    "msrp_options",
    "msrp_total",
    "destination_charge",
    "archive_sale_price",
)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_fuel(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    record = FuelRecord(vin=own_vehicle.vin, date=date(2020, 1, 1), **dict.fromkeys(FUEL, value))
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/fuel"

    _assert_amounts(await read_ok(client, auth_headers, f"{base}/{record.id}"), FUEL, value)
    listed = await read_ok(client, auth_headers, base)
    _assert_amounts(listed["records"][0], FUEL, value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_def(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    record = DEFRecord(vin=own_vehicle.vin, date=date(2020, 1, 1), **dict.fromkeys(DEF, value))
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/def"

    _assert_amounts(await read_ok(client, auth_headers, f"{base}/{record.id}"), DEF, value)
    listed = await read_ok(client, auth_headers, base)
    _assert_amounts(listed["records"][0], DEF, value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_financing(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    record = FinancingRecord(
        vin=own_vehicle.vin, date=date(2020, 1, 1), amount=value, category="loan_payment"
    )
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/financing-records"

    _assert_amounts(await read_ok(client, auth_headers, f"{base}/{record.id}"), ("amount",), value)
    listed = await read_ok(client, auth_headers, base)
    _assert_amounts(listed["financing_records"][0], ("amount",), value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_tax(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    record = TaxRecord(vin=own_vehicle.vin, date=date(2020, 1, 1), amount=value)
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/tax-records"

    _assert_amounts(await read_ok(client, auth_headers, f"{base}/{record.id}"), ("amount",), value)
    listed = await read_ok(client, auth_headers, base)
    _assert_amounts(listed["records"][0], ("amount",), value)


@pytest.mark.parametrize("value", RENTAL_VALUES)
async def test_spot_rental(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    rental = SpotRental(
        vin=own_vehicle.vin, check_in_date=date(2020, 1, 1), **dict.fromkeys(RENTAL, value)
    )
    db_session.add(rental)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/spot-rentals"

    _assert_amounts(await read_ok(client, auth_headers, f"{base}/{rental.id}"), RENTAL, value)
    listed = await read_ok(client, auth_headers, base)
    _assert_amounts(listed["spot_rentals"][0], RENTAL, value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_spot_rental_billing(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    rental = SpotRental(vin=own_vehicle.vin, check_in_date=date(2020, 1, 1))
    db_session.add(rental)
    await db_session.flush()
    db_session.add(
        SpotRentalBilling(
            spot_rental_id=rental.id,
            billing_date=date(2020, 2, 1),
            **dict.fromkeys(BILLING, value),
        )
    )
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/spot-rentals/{rental.id}"

    one = await read_ok(client, auth_headers, base)
    _assert_amounts(one["billings"][0], BILLING, value)
    billings = await read_ok(client, auth_headers, f"{base}/billings")
    _assert_amounts(billings["billings"][0], BILLING, value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_service_visit_and_line_item(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    visit = ServiceVisit(vin=own_vehicle.vin, date=date(2020, 1, 1), **dict.fromkeys(VISIT, value))
    db_session.add(visit)
    await db_session.flush()
    db_session.add(ServiceLineItem(visit_id=visit.id, description="Legacy", cost=value))
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/service-visits"

    one = await read_ok(client, auth_headers, f"{base}/{visit.id}")
    _assert_amounts(one, VISIT, value)
    _assert_amounts(one["line_items"][0], ("cost",), value)
    listed = await read_ok(client, auth_headers, base)
    _assert_amounts(listed["visits"][0], VISIT, value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_vehicle(client, auth_headers, db_session, own_vehicle, value):
    _skip_unless_storable(db_session, value)
    for name in VEHICLE:
        setattr(own_vehicle, name, value)
    await db_session.commit()

    body = await read_ok(client, auth_headers, f"/api/vehicles/{own_vehicle.vin}")
    _assert_amounts(body, VEHICLE, value)


@pytest.mark.parametrize("value", LEGACY_VALUES)
async def test_insurance(client, auth_headers, db_session, own_vehicle, test_user, value):
    _skip_unless_storable(db_session, value)
    today = household_today()
    policy = InsurancePolicy(
        provider="Legacy Mutual",
        policy_number="LEG-" + uuid.uuid4().hex[:8],
        start_date=today - timedelta(days=30),
        end_date=today + timedelta(days=150),
        premium_amount=value,
        premium_frequency="Annual",
        created_by_user_id=test_user["id"],
    )
    db_session.add(policy)
    await db_session.flush()
    policy_id = policy.id
    link = InsurancePolicyVehicle(
        policy_id=policy_id,
        vin=own_vehicle.vin,
        policy_type="Full Coverage",
        premium_share=value,
        deductible=value,
    )
    db_session.add(link)
    await db_session.flush()
    db_session.add_all(
        [
            InsuranceCoverage(
                policy_vehicle_id=link.id,
                coverage_key="bodily_injury",
                limit_primary=value,
                limit_secondary=value,
                premium=value,
            ),
            InsuranceCoverage(
                policy_vehicle_id=link.id,
                coverage_key="comprehensive",
                deductible=value,
                premium=value,
            ),
        ]
    )
    await db_session.commit()
    try:
        one = await read_ok(client, auth_headers, f"/api/insurance/policies/{policy_id}")
        by_vehicle = await read_ok(
            client, auth_headers, f"/api/vehicles/{own_vehicle.vin}/insurance"
        )
        history = await read_ok(
            client, auth_headers, f"/api/insurance/policies/{policy_id}/history"
        )
        for body in (one, by_vehicle[0], history[0]):
            _assert_amounts(body, ("premium_amount",), value)
            vehicle = body["vehicles"][0]
            _assert_amounts(vehicle, ("premium_share", "deductible"), value)
            injury, comprehensive = vehicle["coverages"]
            _assert_amounts(injury, ("limit_primary", "limit_secondary", "premium"), value)
            _assert_amounts(comprehensive, ("deductible", "premium"), value)
    finally:
        # Not the vehicle's: a policy outlives its vehicles, and a leftover one
        # changes other suites' household totals.
        await db_session.rollback()
        await db_session.execute(delete(InsurancePolicy).where(InsurancePolicy.id == policy_id))
        await db_session.commit()


async def test_insurance_renew_carries_a_legacy_coverage(
    client, auth_headers, db_session, own_vehicle, test_user
):
    """Renewing copies each coverage as stored, the way it copies the vehicle's
    own deductible. It used to run them through the input rules, so one legacy
    negative answered 500 and left the household with no next term."""
    today = household_today()
    policy = InsurancePolicy(
        provider="Legacy Mutual",
        policy_number="LEG-" + uuid.uuid4().hex[:8],
        start_date=today - timedelta(days=30),
        end_date=today + timedelta(days=150),
        premium_amount=Decimal("600.00"),
        premium_frequency="Annual",
        created_by_user_id=test_user["id"],
    )
    db_session.add(policy)
    await db_session.flush()
    policy_id = policy.id
    link = InsurancePolicyVehicle(
        policy_id=policy_id, vin=own_vehicle.vin, policy_type="Full Coverage"
    )
    db_session.add(link)
    await db_session.flush()
    db_session.add(
        InsuranceCoverage(
            policy_vehicle_id=link.id,
            coverage_key="comprehensive",
            deductible=NEGATIVE,
            premium=NEGATIVE,
        )
    )
    await db_session.commit()
    renewed_id = None
    try:
        response = await client.post(
            f"/api/insurance/policies/{policy_id}/renew", json={}, headers=auth_headers
        )
        assert response.status_code == 201, response.text
        renewed = response.json()
        renewed_id = renewed["id"]
        assert renewed_id != policy_id
        (coverage,) = renewed["vehicles"][0]["coverages"]
        assert coverage["coverage_key"] == "comprehensive"
        _assert_amounts(coverage, ("deductible", "premium"), NEGATIVE)
    finally:
        await db_session.rollback()
        ids = [policy_id] + ([renewed_id] if renewed_id is not None else [])
        await db_session.execute(delete(InsurancePolicy).where(InsurancePolicy.id.in_(ids)))
        await db_session.commit()
