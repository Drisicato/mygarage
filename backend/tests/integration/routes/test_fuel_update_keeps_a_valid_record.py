"""An edit can't leave a fill-up that create would refuse.

Create requires a reading (odometer, or engine hours) and a fuel amount,
bar the propane-refill and missed-fill-up exemptions. Update never checked
the merged record, which went unnoticed while the forms couldn't clear a
field. Once they could, an emptied propane refill vanished from the only
list that shows it. Only an edit that touches those fields is held to the
rule, so a legacy record can still have its notes fixed.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fuel import FuelRecord
from app.models.vehicle import Vehicle

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def own_vehicle(db_session: AsyncSession, test_user: dict[str, object]) -> dict:
    vin = "UPD" + uuid.uuid4().hex[:14].upper()
    db_session.add(
        Vehicle(
            vin=vin,
            user_id=test_user["id"],
            nickname="Update Rule",
            vehicle_type="Truck",
            year=2020,
            make="Ram",
            model="2500",
            fuel_type="diesel",
        )
    )
    await db_session.commit()
    return {"vin": vin}


async def _create(client: AsyncClient, headers: dict, vin: str, **fields) -> dict:
    r = await client.post(
        f"/api/vehicles/{vin}/fuel",
        json={"vin": vin, "date": "2032-01-10", **fields},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _put(client: AsyncClient, headers: dict, vin: str, record_id: int, body: dict):
    return await client.put(f"/api/vehicles/{vin}/fuel/{record_id}", json=body, headers=headers)


class TestUpdateKeepsAValidFillUp:
    async def test_emptying_a_propane_refill_is_refused(
        self, client: AsyncClient, auth_headers, own_vehicle
    ):
        vin = own_vehicle["vin"]
        record = await _create(client, auth_headers, vin, propane_liters=30.0)

        r = await _put(client, auth_headers, vin, record["id"], {"propane_liters": None})

        assert r.status_code == 422, r.text
        reread = await client.get(f"/api/vehicles/{vin}/fuel/{record['id']}", headers=auth_headers)
        assert float(reread.json()["propane_liters"]) == 30.0

    async def test_clearing_the_volume_of_a_fill_up_is_refused(
        self, client: AsyncClient, auth_headers, own_vehicle
    ):
        vin = own_vehicle["vin"]
        record = await _create(client, auth_headers, vin, odometer_km=5000, liters=40.0)

        r = await _put(client, auth_headers, vin, record["id"], {"liters": None})

        assert r.status_code == 422, r.text

    async def test_clearing_the_only_reading_is_refused(
        self, client: AsyncClient, auth_headers, own_vehicle
    ):
        vin = own_vehicle["vin"]
        record = await _create(client, auth_headers, vin, odometer_km=5000, liters=40.0)

        r = await _put(client, auth_headers, vin, record["id"], {"odometer_km": None})

        assert r.status_code == 422, r.text

    async def test_clearing_the_odometer_with_engine_hours_left_is_fine(
        self, client: AsyncClient, auth_headers, own_vehicle
    ):
        vin = own_vehicle["vin"]
        record = await _create(
            client, auth_headers, vin, odometer_km=5000, engine_hours=120.5, liters=40.0
        )

        r = await _put(client, auth_headers, vin, record["id"], {"odometer_km": None})

        assert r.status_code == 200, r.text
        assert r.json()["odometer_km"] is None

    async def test_a_legacy_record_can_still_have_its_notes_edited(
        self, client: AsyncClient, auth_headers, own_vehicle, db_session: AsyncSession
    ):
        """Already short of create's rule (an old import), and the edit doesn't touch it."""
        vin = own_vehicle["vin"]
        legacy = FuelRecord(vin=vin, date=date(2032, 1, 11), cost=Decimal("20.00"))
        db_session.add(legacy)
        await db_session.commit()

        r = await _put(client, auth_headers, vin, legacy.id, {"notes": "found the receipt"})

        assert r.status_code == 200, r.text
