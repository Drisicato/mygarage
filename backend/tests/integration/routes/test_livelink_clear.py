"""Clearing a device label or a parameter's display fields clears them.

Both routes skipped every null: the device route handed each field to a
service whose parameters default to None, and the parameter route guarded each
field with `is not None`. So a cleared label or display name said saved and
stayed. Omitted still keeps, and the device's documented sentinels (`''`
unlinks the VIN or clears the odometer key, `'auto'` resets the unit, null
leaves those three alone) are unchanged.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.livelink_device import LiveLinkDevice
from app.models.livelink_parameter import LiveLinkParameter

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

_PREFIX = "LLCLEAR_"
DEVICE = f"{_PREFIX}dev"
PARAM = f"{_PREFIX}RPM"


@pytest_asyncio.fixture(autouse=True)
async def _rows(db_session: AsyncSession):
    async def _wipe():
        await db_session.execute(
            delete(LiveLinkDevice).where(LiveLinkDevice.device_id.like(f"{_PREFIX}%"))
        )
        await db_session.execute(
            delete(LiveLinkParameter).where(LiveLinkParameter.param_key.like(f"{_PREFIX}%"))
        )
        await db_session.commit()

    await _wipe()
    db_session.add(
        LiveLinkDevice(
            device_id=DEVICE,
            kind="generic_mqtt",
            label="Garage WiCAN",
            enabled=True,
            device_status="unknown",
            odometer_unit="mi",
            odometer_param_key="ODO",
        )
    )
    db_session.add(
        LiveLinkParameter(
            param_key=PARAM,
            display_name="Engine RPM",
            category="engine",
            icon="gauge",
            show_on_dashboard=True,
            archive_only=False,
        )
    )
    await db_session.commit()
    yield
    await _wipe()


async def _device(db_session: AsyncSession) -> LiveLinkDevice:
    db_session.expire_all()
    stmt = select(LiveLinkDevice).where(LiveLinkDevice.device_id == DEVICE)
    return (await db_session.execute(stmt)).scalar_one()


async def _param(db_session: AsyncSession) -> LiveLinkParameter:
    db_session.expire_all()
    stmt = select(LiveLinkParameter).where(LiveLinkParameter.param_key == PARAM)
    return (await db_session.execute(stmt)).scalar_one()


class TestDeviceLabel:
    async def test_null_clears(self, client: AsyncClient, auth_headers, db_session):
        r = await client.put(
            f"/api/livelink/devices/{DEVICE}", json={"label": None}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        assert (await _device(db_session)).label is None

    async def test_empty_string_still_clears(self, client: AsyncClient, auth_headers, db_session):
        r = await client.put(
            f"/api/livelink/devices/{DEVICE}", json={"label": ""}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        assert not (await _device(db_session)).label

    async def test_omitted_keeps_and_sentinels_hold(
        self, client: AsyncClient, auth_headers, db_session
    ):
        r = await client.put(
            f"/api/livelink/devices/{DEVICE}",
            json={"enabled": False, "vin": None, "odometer_unit": None, "odometer_param_key": None},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        device = await _device(db_session)
        assert device.label == "Garage WiCAN"
        assert device.enabled is False
        assert (device.odometer_unit, device.odometer_param_key) == ("mi", "ODO")


class TestParameterDisplay:
    @pytest.mark.parametrize("field", ["display_name", "category", "icon"])
    async def test_null_clears(self, client: AsyncClient, auth_headers, db_session, field):
        r = await client.put(
            f"/api/livelink/parameters/{PARAM}", json={field: None}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        assert getattr(await _param(db_session), field) is None

    async def test_omitted_keeps(self, client: AsyncClient, auth_headers, db_session):
        r = await client.put(
            f"/api/livelink/parameters/{PARAM}", json={"display_order": 3}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        param = await _param(db_session)
        assert (param.display_name, param.category, param.icon) == ("Engine RPM", "engine", "gauge")
        assert param.display_order == 3
