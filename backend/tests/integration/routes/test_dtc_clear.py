"""Clearing a DTC's note or description clears it.

The route passed each field into a service whose parameters default to None
and skipped every None, so the DTC tab toasted "notes saved" and the old note
stayed. The service now takes only the fields the request actually sent.
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vehicle import Vehicle
from app.models.vehicle_dtc import VehicleDTC

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def own_dtc(db_session: AsyncSession, test_user: dict[str, object]) -> dict:
    """A fresh vehicle with one annotated DTC, so nothing leaks between tests."""
    vin = "DTC" + uuid.uuid4().hex[:14].upper()
    db_session.add(
        Vehicle(
            vin=vin,
            user_id=test_user["id"],
            nickname="DTC Test",
            vehicle_type="Car",
            year=2020,
            make="Honda",
            model="Civic",
        )
    )
    await db_session.flush()
    dtc = VehicleDTC(
        vin=vin,
        device_id="dtc-test-dev",
        code="P0420",
        description="Catalyst below threshold",
        severity="critical",
        user_notes="Dealer says O2 sensor",
    )
    db_session.add(dtc)
    await db_session.commit()
    return {"vin": vin, "id": dtc.id}


def _url(dtc: dict) -> str:
    return f"/api/vehicles/{dtc['vin']}/livelink/dtcs/{dtc['id']}"


async def _stored(db_session: AsyncSession, dtc_id: int) -> VehicleDTC:
    db_session.expire_all()
    return (
        await db_session.execute(select(VehicleDTC).where(VehicleDTC.id == dtc_id))
    ).scalar_one()


@pytest.mark.parametrize("field", ["user_notes", "description"])
async def test_null_clears_the_field(client: AsyncClient, auth_headers, db_session, own_dtc, field):
    r = await client.put(_url(own_dtc), json={field: None}, headers=auth_headers)
    assert r.status_code == 200, r.text
    stored = await _stored(db_session, own_dtc["id"])
    assert getattr(stored, field) is None


async def test_omitted_fields_are_kept(client: AsyncClient, auth_headers, db_session, own_dtc):
    r = await client.put(
        _url(own_dtc), json={"user_notes": "Replaced sensor"}, headers=auth_headers
    )
    assert r.status_code == 200, r.text
    stored = await _stored(db_session, own_dtc["id"])
    assert stored.user_notes == "Replaced sensor"
    assert stored.description == "Catalyst below threshold"
    assert stored.severity == "critical"


async def test_null_severity_is_a_422(client: AsyncClient, auth_headers, db_session, own_dtc):
    r = await client.put(_url(own_dtc), json={"severity": None}, headers=auth_headers)
    assert r.status_code == 422, r.text
    assert (await _stored(db_session, own_dtc["id"])).severity == "critical"
