"""A stored word outside today's input vocabulary reads back.

The money and number suites' sibling, for validators. One on a shared base runs
on every response built from it, so a stored value it refuses turns every read
of the record, and every list it's in, into a 500. None of these columns has a
CHECK, and the importers, the fuel webhook and SSO sign-in write some of them
without the input schema. So each row is written straight through the ORM and
read back through its real routes.
"""

import uuid
from datetime import date
from typing import Any

import pytest
from sqlalchemy import delete

from app.models.fuel import FuelRecord
from app.models.livelink_topic_map import LiveLinkTopicMap
from app.models.service_line_item import ServiceLineItem
from app.models.service_visit import ServiceVisit
from app.models.toll import TollTag
from app.models.user import User
from app.services.auth import create_access_token
from tests.integration.routes._legacy_reads import read_ok

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

DAY = date(2020, 1, 1)
FUEL = {"charge_level": "Level 2", "charge_location": "work", "price_basis": "per_gal"}


def _assert_words(body: dict[str, Any], values: dict[str, str]) -> None:
    for name, value in values.items():
        assert body[name] == value, f"{name}: {body[name]}"


async def test_fuel_vocabulary(client, auth_headers, db_session, own_vehicle):
    record = FuelRecord(vin=own_vehicle.vin, date=DAY, **FUEL)
    db_session.add(record)
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/fuel"

    _assert_words(await read_ok(client, auth_headers, f"{base}/{record.id}"), FUEL)
    listed = await read_ok(client, auth_headers, base)
    _assert_words(listed["records"][0], FUEL)


async def test_line_item_maintenance_type(client, auth_headers, db_session, own_vehicle):
    visit = ServiceVisit(vin=own_vehicle.vin, date=DAY)
    db_session.add(visit)
    await db_session.flush()
    db_session.add(
        ServiceLineItem(visit_id=visit.id, description="Legacy", maintenance_type="Oil Change")
    )
    await db_session.commit()
    base = f"/api/vehicles/{own_vehicle.vin}/service-visits"

    one = await read_ok(client, auth_headers, f"{base}/{visit.id}")
    assert one["line_items"][0]["maintenance_type"] == "Oil Change"
    listed = await read_ok(client, auth_headers, base)
    assert listed["visits"][0]["line_items"][0]["maintenance_type"] == "Oil Change"


async def test_toll_tag_status(client, auth_headers, db_session, own_vehicle):
    db_session.add(
        TollTag(vin=own_vehicle.vin, toll_system="EZ TAG", tag_number="LEG-1", status="lost")
    )
    await db_session.commit()

    listed = await read_ok(client, auth_headers, f"/api/vehicles/{own_vehicle.vin}/toll-tags")
    assert [tag["status"] for tag in listed["toll_tags"]] == ["lost"]


async def test_topic_map(client, auth_headers, db_session):
    # A random suffix keeps the row this run's own: the suite shares one file,
    # and a leftover wildcard row would sit in every later topic-map list.
    topic = f"wican/+/{uuid.uuid4().hex[:8]}"
    row = LiveLinkTopicMap(device_id="legacy", topic=topic, role="telemetry", param_key=None)
    db_session.add(row)
    await db_session.commit()
    row_id = row.id
    try:
        listed = await read_ok(client, auth_headers, "/api/livelink/topic-maps")
        (mine,) = [entry for entry in listed if entry["id"] == row_id]
        assert mine["topic"] == topic
        assert mine["param_key"] is None
    finally:
        await db_session.rollback()
        await db_session.execute(delete(LiveLinkTopicMap).where(LiveLinkTopicMap.id == row_id))
        await db_session.commit()


async def test_sso_username_with_a_dot(client, db_session):
    """SSO auto-create keeps the identity provider's username, dots and all."""
    name = f"sso.user.{uuid.uuid4().hex[:8]}"
    user = User(
        username=name,
        email=f"{name}@example.com",
        hashed_password=None,
        auth_method="oidc",
        is_active=True,
        is_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    user_id = user.id
    try:
        token = create_access_token(data={"sub": str(user_id), "username": name})
        me = await read_ok(client, {"Authorization": f"Bearer {token}"}, "/api/auth/me")
        assert me["username"] == name
    finally:
        await db_session.rollback()
        await db_session.execute(delete(User).where(User.id == user_id))
        await db_session.commit()
