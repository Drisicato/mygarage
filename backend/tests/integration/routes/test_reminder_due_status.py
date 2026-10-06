"""The reminders list in due order, each row saying where it stands (#192).

A row's colour and the hero's counts come from one function
(reminder_service.reminder_due_status), so they can't disagree. The invariant
test below is the property D1 exists for.
"""

from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HoursRecord, OdometerRecord, Reminder, Vehicle
from app.utils.household_time import household_today, household_zone

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def _created_on_day(day: date) -> datetime:
    """A naive-UTC ``created_at`` that falls on ``day`` in the household zone (local noon)."""
    return (
        datetime.combine(day, time(12), tzinfo=household_zone())
        .astimezone(UTC)
        .replace(tzinfo=None)
    )


async def _seed_vehicle(db_session: AsyncSession, owner_id, vin: str) -> str:
    db_session.add(
        Vehicle(
            vin=vin,
            user_id=owner_id,
            nickname="Due Rig",
            vehicle_type="Car",
            year=2020,
            make="Test",
            model="Rig",
        )
    )
    await db_session.commit()
    return vin


async def _list(client: AsyncClient, headers: dict, vin: str, status: str = "pending") -> list:
    r = await client.get(
        f"/api/vehicles/{vin}/reminders", params={"status": status}, headers=headers
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_rows_come_in_due_order_with_their_status(
    client: AsyncClient, non_admin_headers, non_admin_user, db_session: AsyncSession
):
    vin = await _seed_vehicle(db_session, non_admin_user["id"], "5NPE24AF0FH192001")
    today = household_today()
    # Inserted in an order that is neither the expected one nor its reverse.
    db_session.add_all(
        [
            Reminder(
                vin=vin,
                title="On track",
                reminder_type="date",
                status="pending",
                due_date=today + timedelta(days=90),
            ),
            Reminder(
                vin=vin,
                title="Snoozed",
                reminder_type="date",
                status="pending",
                due_date=today - timedelta(days=1),
                snoozed_until=today + timedelta(days=5),
            ),
            Reminder(
                vin=vin,
                title="Overdue",
                reminder_type="date",
                status="pending",
                due_date=today - timedelta(days=3),
            ),
            Reminder(
                vin=vin,
                title="Due soon",
                reminder_type="date",
                status="pending",
                due_date=today + timedelta(days=10),
            ),
            Reminder(
                vin=vin,
                title="Done",
                reminder_type="date",
                status="done",
                due_date=today - timedelta(days=30),
                completed_date=today - timedelta(days=2),
            ),
        ]
    )
    await db_session.commit()

    rows = await _list(client, non_admin_headers, vin)
    assert [r["title"] for r in rows] == ["Overdue", "Due soon", "On track", "Snoozed"]
    assert [r["due_status"] for r in rows] == ["overdue", "due_soon", "on_track", "snoozed"]
    assert [r["days_until_due"] for r in rows] == [-3, 10, 90, -1]

    every = await _list(client, non_admin_headers, vin, "all")
    assert [r["title"] for r in every] == ["Overdue", "Due soon", "On track", "Snoozed", "Done"]

    (done,) = await _list(client, non_admin_headers, vin, "done")
    for key in (
        "due_status",
        "progress",
        "progress_basis",
        "distance_progress",
        "days_until_due",
        "km_until_due",
        "hours_until_due",
    ):
        assert done[key] is None, key


async def test_the_list_and_the_hero_count_the_same_reminders(
    client: AsyncClient, non_admin_headers, non_admin_user, db_session: AsyncSession
):
    vin = await _seed_vehicle(db_session, non_admin_user["id"], "5NPE24AF0FH192002")
    today = household_today()
    db_session.add_all(
        [
            OdometerRecord(vin=vin, date=today - timedelta(days=100), odometer_km=Decimal("50000")),
            OdometerRecord(vin=vin, date=today, odometer_km=Decimal("59500")),
            HoursRecord(vin=vin, date=today, engine_hours=Decimal("150.0"), source="manual"),
            Reminder(
                vin=vin,
                title="Overdue",
                reminder_type="date",
                status="pending",
                due_date=today - timedelta(days=3),
            ),
            Reminder(
                vin=vin,
                title="Due soon by date",
                reminder_type="date",
                status="pending",
                due_date=today + timedelta(days=10),
            ),
            Reminder(
                vin=vin,
                title="On track",
                reminder_type="date",
                status="pending",
                due_date=today + timedelta(days=90),
            ),
            Reminder(
                vin=vin,
                title="Snoozed",
                reminder_type="date",
                status="pending",
                due_date=today - timedelta(days=1),
                snoozed_until=today + timedelta(days=5),
            ),
            # D2: 95% of the way by mileage, and one reading in 90 days means no rate.
            Reminder(
                vin=vin,
                title="Timing belt",
                reminder_type="mileage",
                status="pending",
                due_mileage_km=Decimal("60000"),
                created_at=_created_on_day(today - timedelta(days=100)),
            ),
            # Anchored, half way by hours, no hours rate: on track.
            Reminder(
                vin=vin,
                title="Hydraulics",
                reminder_type="hours",
                status="pending",
                due_hours=Decimal("200.0"),
                anchor_kind="baseline",
                anchor_date=today - timedelta(days=30),
                anchor_hours=Decimal("100.0"),
            ),
            Reminder(
                vin=vin,
                title="Done",
                reminder_type="date",
                status="done",
                due_date=today - timedelta(days=30),
            ),
        ]
    )
    await db_session.commit()

    r = await client.get(f"/api/vehicles/{vin}/detail-stats", headers=non_admin_headers)
    assert r.status_code == 200, r.text
    stats = r.json()
    rows = await _list(client, non_admin_headers, vin)
    by_status = Counter(row["due_status"] for row in rows)

    assert stats["overdue_count"] == by_status["overdue"] == 1
    assert stats["due_soon_count"] == by_status["due_soon"] == 2
    assert stats["upcoming_count"] == by_status["due_soon"] + by_status["on_track"] == 4

    belt = next(row for row in rows if row["title"] == "Timing belt")
    assert belt["due_status"] == "due_soon"
    assert belt["progress_basis"] == "distance"
    assert belt["progress"] == pytest.approx(0.95)
    assert belt["distance_progress"] == pytest.approx(0.95)
    assert Decimal(belt["km_until_due"]) == Decimal("500")


async def test_a_one_off_counts_from_the_reading_it_was_created_at(
    client: AsyncClient, non_admin_headers, non_admin_user, db_session: AsyncSession
):
    """The start is frozen when the reminder is made. Before, it was the reading
    nearest the creation day, looked up on every read, so correcting that day's
    reading moved the start with it: the bar sat at 0% and vanished once over."""
    vin = await _seed_vehicle(db_session, non_admin_user["id"], "5NPE24AF0FH192004")
    today = household_today().isoformat()
    base = f"/api/vehicles/{vin}"
    reading = await client.post(
        f"{base}/odometer",
        json={"vin": vin, "date": today, "odometer_km": "115388.00"},
        headers=non_admin_headers,
    )
    assert reading.status_code == 201, reading.text
    created = await client.post(
        f"{base}/reminders",
        json={"title": "Oil", "reminder_type": "mileage", "due_mileage_km": "115390.00"},
        headers=non_admin_headers,
    )
    assert created.status_code == 201, created.text

    async def correct_reading_to(km: str) -> dict:
        r = await client.put(
            f"{base}/odometer/{reading.json()['id']}",
            json={"odometer_km": km},
            headers=non_admin_headers,
        )
        assert r.status_code == 200, r.text
        (row,) = await _list(client, non_admin_headers, vin)
        return row

    halfway = await correct_reading_to("115389.00")
    assert halfway["distance_progress"] == pytest.approx(0.5)

    over = await correct_reading_to("115391.00")
    assert over["due_status"] == "overdue"
    assert over["distance_progress"] == pytest.approx(1.5)
    assert Decimal(over["km_until_due"]) == Decimal("-1")


async def test_distance_progress_follows_the_odometer_when_the_date_leads(
    client: AsyncClient, non_admin_headers, non_admin_user, db_session: AsyncSession
):
    """A date-and-mileage reminder whose date is nearer still reports its mileage share,
    which is what the list's bar shows for any reminder with a due mileage."""
    vin = await _seed_vehicle(db_session, non_admin_user["id"], "5NPE24AF0FH192003")
    today = household_today()
    db_session.add_all(
        [
            OdometerRecord(vin=vin, date=today, odometer_km=Decimal("12500")),
            # Counted from 10,000 km and 90 days ago: 25% of the way by mileage
            # (2,500 of 10,000 km), 90% by date (90 of 100 days).
            Reminder(
                vin=vin,
                title="Oil change",
                reminder_type="both",
                status="pending",
                due_date=today + timedelta(days=10),
                due_mileage_km=Decimal("20000"),
                anchor_kind="baseline",
                anchor_date=today - timedelta(days=90),
                anchor_odometer_km=Decimal("10000"),
            ),
            # Date only: no mileage share at all.
            Reminder(
                vin=vin,
                title="Registration",
                reminder_type="date",
                status="pending",
                due_date=today + timedelta(days=30),
            ),
        ]
    )
    await db_session.commit()

    rows = {row["title"]: row for row in await _list(client, non_admin_headers, vin)}
    oil = rows["Oil change"]
    assert oil["progress_basis"] == "date"
    assert oil["progress"] == pytest.approx(0.9)
    assert oil["distance_progress"] == pytest.approx(0.25)
    assert rows["Registration"]["distance_progress"] is None
