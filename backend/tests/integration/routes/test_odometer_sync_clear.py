"""Clearing a source record's odometer removes the reading it synced.

Until the edit forms posted null for a cleared field, nothing could clear a
source's odometer, and `sync_odometer_from_record` simply skips a None. Once
clearing worked, the synced row stayed behind: a typo'd 724,200 km visit,
cleared on edit, left 724,200 as the vehicle's highest reading for reminders
to project from. The hours track has always deleted its row on a clear.
"""

import pytest
from httpx import AsyncClient

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def _odometer_rows(client: AsyncClient, headers: dict, vin: str) -> list[dict]:
    r = await client.get(f"/api/vehicles/{vin}/odometer", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["records"]


def _marked(rows: list[dict], source_type: str, source_id: int) -> list[dict]:
    marker = f"[AUTO-SYNC from {source_type} #{source_id}]"
    return [r for r in rows if r.get("notes") == marker]


async def _visit(
    client: AsyncClient, headers: dict, vin: str, *, on: str, odometer_km: float
) -> dict:
    r = await client.post(
        f"/api/vehicles/{vin}/service-visits",
        json={"date": on, "odometer_km": odometer_km, "line_items": [{"description": "Oil"}]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


class TestServiceVisitClear:
    async def test_clearing_the_odometer_removes_the_synced_reading(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        visit = await _visit(client, auth_headers, vin, on="2031-08-10", odometer_km=724200)
        rows = await _odometer_rows(client, auth_headers, vin)
        assert len(_marked(rows, "service_visit", visit["id"])) == 1

        r = await client.put(
            f"/api/vehicles/{vin}/service-visits/{visit['id']}",
            json={"odometer_km": None},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

        assert r.json()["odometer_km"] is None
        rows = await _odometer_rows(client, auth_headers, vin)
        assert _marked(rows, "service_visit", visit["id"]) == []

    async def test_a_manual_reading_on_the_same_day_survives(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        r = await client.post(
            f"/api/vehicles/{vin}/odometer",
            json={"vin": vin, "date": "2031-08-11", "odometer_km": 724000, "notes": "dash photo"},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        manual_id = r.json()["id"]
        visit = await _visit(client, auth_headers, vin, on="2031-08-11", odometer_km=724100)

        r = await client.put(
            f"/api/vehicles/{vin}/service-visits/{visit['id']}",
            json={"odometer_km": None},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

        rows = await _odometer_rows(client, auth_headers, vin)
        assert any(row["id"] == manual_id for row in rows)

    async def test_an_edit_that_leaves_the_odometer_alone_keeps_the_reading(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        visit = await _visit(client, auth_headers, vin, on="2031-08-12", odometer_km=724300)

        r = await client.put(
            f"/api/vehicles/{vin}/service-visits/{visit['id']}",
            json={"notes": "edited"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

        rows = _marked(
            await _odometer_rows(client, auth_headers, vin), "service_visit", visit["id"]
        )
        assert len(rows) == 1 and float(rows[0]["odometer_km"]) == 724300
