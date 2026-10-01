"""A stored number reads back, whatever bound the API puts on new input.

The money suite's sibling, for every other number. LiveLink, the webhooks and
the importers write some of these columns without the input schema, and legacy
rows predate today's bounds: a state of charge over 100%, a negative odometer, a
model year before 1900. A response that inherits an input bound turns every
read of such a record, and every list it's in, into a 500. So each record is
written straight through the ORM, past the schemas, and read back through its
real routes.

Every value fits its column on both dialects; only the schema bound refuses it.
`station_address_book_id` and `driver_user_id` are left out: they're foreign
keys, so the database itself refuses a 0.
"""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import delete

from app.models.attachment import Attachment
from app.models.def_record import DEFRecord
from app.models.fuel import FuelRecord
from app.models.hours import HoursRecord
from app.models.odometer import OdometerRecord
from app.models.service_visit import ServiceVisit
from app.models.tire import Tire
from app.models.vehicle import TrailerDetails
from app.models.warranty import WarrantyRecord
from tests.integration.routes._legacy_reads import read_ok

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

NEGATIVE = Decimal(-1)
DAY = date(2020, 1, 1)

FUEL: dict[str, Decimal | int] = {
    "odometer_km": NEGATIVE,
    "engine_hours": NEGATIVE,
    "liters": NEGATIVE,
    "propane_liters": NEGATIVE,
    "tank_size_kg": NEGATIVE,
    "tank_quantity": 0,
    "kwh": NEGATIVE,
    "soc_start_pct": Decimal(150),
    "soc_end_pct": Decimal(-5),
    "battery_soh_pct": Decimal(101),
    "outside_temp_c": Decimal(80),
    "obc_l_per_100km": NEGATIVE,
    "obc_avg_speed_kmh": NEGATIVE,
    "obc_trip_duration_s": -1,
}
# fill_level is a Numeric(3,2), so 1.5 fits where the schema stops at 1.00.
DEF: dict[str, Decimal | int] = {
    "odometer_km": NEGATIVE,
    "liters": NEGATIVE,
    "fill_level": Decimal("1.5"),
}
VISIT: dict[str, Decimal | int] = {"odometer_km": NEGATIVE, "engine_hours": NEGATIVE}
TIRE: dict[str, Decimal | int] = {
    "tread_depth_mm": Decimal(31),
    "pressure_kpa": Decimal(1500),
    "min_tread_mm": Decimal(11),
}
VEHICLE: dict[str, Decimal | int] = {
    "current_hours": NEGATIVE,
    "year": 1850,
    "def_tank_capacity_liters": NEGATIVE,
    "oil_capacity_liters": NEGATIVE,
    "lug_nut_torque_nm": NEGATIVE,
}


def _assert_values(body: dict[str, Any], values: dict[str, Decimal | int]) -> None:
    for name, value in values.items():
        assert body[name] is not None, name
        assert Decimal(str(body[name])) == value, f"{name}: {body[name]}"


# A fresh vehicle each, so no interval math runs against a neighbour record.


async def test_fuel(client, auth_headers, db_session, own_vehicle):
    record = FuelRecord(vin=own_vehicle.vin, date=DAY, **FUEL)
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/fuel"

    _assert_values(await read_ok(client, auth_headers, f"{base}/{record.id}"), FUEL)
    listed = await read_ok(client, auth_headers, base)
    _assert_values(listed["records"][0], FUEL)


async def test_def(client, auth_headers, db_session, own_vehicle):
    record = DEFRecord(vin=own_vehicle.vin, date=DAY, **DEF)
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/def"

    _assert_values(await read_ok(client, auth_headers, f"{base}/{record.id}"), DEF)
    listed = await read_ok(client, auth_headers, base)
    _assert_values(listed["records"][0], DEF)


async def test_service_visit(client, auth_headers, db_session, own_vehicle):
    visit = ServiceVisit(vin=own_vehicle.vin, date=DAY, **VISIT)
    db_session.add(visit)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/service-visits"

    _assert_values(await read_ok(client, auth_headers, f"{base}/{visit.id}"), VISIT)
    listed = await read_ok(client, auth_headers, base)
    _assert_values(listed["visits"][0], VISIT)


async def test_odometer(client, auth_headers, db_session, own_vehicle):
    record = OdometerRecord(vin=own_vehicle.vin, date=DAY, odometer_km=NEGATIVE)
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/odometer"
    values: dict[str, Decimal | int] = {"odometer_km": NEGATIVE}

    _assert_values(await read_ok(client, auth_headers, f"{base}/{record.id}"), values)
    listed = await read_ok(client, auth_headers, base)
    _assert_values(listed["records"][0], values)


async def test_hours(client, auth_headers, db_session, own_vehicle):
    record = HoursRecord(vin=own_vehicle.vin, date=DAY, engine_hours=NEGATIVE)
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/hours"
    values: dict[str, Decimal | int] = {"engine_hours": NEGATIVE}

    _assert_values(await read_ok(client, auth_headers, f"{base}/{record.id}"), values)
    listed = await read_ok(client, auth_headers, base)
    _assert_values(listed["records"][0], values)


async def test_warranty(client, auth_headers, db_session, own_vehicle):
    record = WarrantyRecord(
        vin=own_vehicle.vin,
        warranty_type="Manufacturer",
        start_date=DAY,
        mileage_limit_km=NEGATIVE,
    )
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/warranties"
    values: dict[str, Decimal | int] = {"mileage_limit_km": NEGATIVE}

    _assert_values(await read_ok(client, auth_headers, f"{base}/{record.id}"), values)
    listed = await read_ok(client, auth_headers, base)
    _assert_values(listed[0], values)


async def test_tire(client, auth_headers, db_session, own_vehicle):
    db_session.add(Tire(vin=own_vehicle.vin, **TIRE))
    await db_session.commit()

    listed = await read_ok(client, auth_headers, f"/api/vehicles/{own_vehicle.vin}/tires")
    _assert_values(listed["tires"][0], TIRE)


async def test_vehicle(client, auth_headers, db_session, own_vehicle):
    for name, value in VEHICLE.items():
        setattr(own_vehicle, name, value)
    await db_session.commit()

    _assert_values(await read_ok(client, auth_headers, f"/api/vehicles/{own_vehicle.vin}"), VEHICLE)
    listed = await read_ok(client, auth_headers, "/api/vehicles?limit=500")
    (mine,) = [v for v in listed["vehicles"] if v["vin"] == own_vehicle.vin]
    _assert_values(mine, VEHICLE)


async def test_trailer(client, auth_headers, db_session, own_vehicle):
    own_vehicle.vehicle_type = "Trailer"
    db_session.add(TrailerDetails(vin=own_vehicle.vin, axle_count=12))
    await db_session.commit()

    body = await read_ok(client, auth_headers, f"/api/vehicles/{own_vehicle.vin}/trailer")
    _assert_values(body, {"axle_count": 12})


async def test_attachment(client, auth_headers, db_session, own_vehicle):
    visit = ServiceVisit(vin=own_vehicle.vin, date=DAY)
    db_session.add(visit)
    await db_session.flush()
    visit_id = visit.id
    attachment = Attachment(
        record_type="service_visit",
        record_id=visit_id,
        file_path="/data/attachments/service_visit/20200101_120000_legacy.pdf",
        file_type="application/pdf",
        file_size=-1,
    )
    db_session.add(attachment)
    await db_session.commit()
    attachment_id = attachment.id
    try:
        listed = await read_ok(client, auth_headers, f"/api/service-visits/{visit_id}/attachments")
        _assert_values(listed["attachments"][0], {"file_size": -1})
    finally:
        # Not the vehicle's: an attachment points at its record by id, with no
        # foreign key, so deleting the visit would leave it behind.
        await db_session.rollback()
        await db_session.execute(delete(Attachment).where(Attachment.id == attachment_id))
        await db_session.commit()
