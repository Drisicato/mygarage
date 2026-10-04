"""
Integration tests for planned repair routes.

Covers CRUD, moving between stages, and completion into service history,
including that a repair moved out of done and back never logs a second visit.
"""

import pytest
from httpx import AsyncClient


def _base(vin: str) -> str:
    return f"/api/vehicles/{vin}/planned-repairs"


async def _create(client: AsyncClient, headers, vin: str, **overrides) -> dict:
    body = {"title": "Replace brake pads", **overrides}
    response = await client.post(_base(vin), json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _visit_count(client: AsyncClient, headers, vin: str) -> int:
    response = await client.get(f"/api/vehicles/{vin}/service-visits", headers=headers)
    assert response.status_code == 200
    return response.json()["total"]


async def _supply(client: AsyncClient, headers, vin: str | None = None) -> int:
    """A volume supply with 10 L on hand at 8.00 a litre, optionally pinned to `vin`."""
    if vin:
        await client.post(
            "/api/vehicles",
            json={"vin": vin, "nickname": "Other Vehicle", "vehicle_type": "Car"},
            headers=headers,
        )
    body = {"name": "Oil", "unit_type": "volume", **({"vin": vin} if vin else {})}
    created = await client.post("/api/supplies", json=body, headers=headers)
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    await client.post(
        f"/api/supplies/{sid}/purchases",
        json={"date": "2026-01-01", "quantity": "10", "total_cost": "80.00"},
        headers=headers,
    )
    return sid


async def _on_hand(client: AsyncClient, headers, supply_id: int) -> float:
    response = await client.get(f"/api/supplies/{supply_id}", headers=headers)
    return float(response.json()["on_hand"])


_VISIT = {
    "date": "2026-10-01",
    "service_category": "Maintenance",
    "line_items": [
        {"description": "Brake pads", "cost": 80.00},
        {"description": "Labor", "cost": 120.00},
    ],
}


@pytest.mark.integration
@pytest.mark.asyncio
class TestPlannedRepairRoutes:
    """Test planned repair API endpoints."""

    async def test_create_starts_in_planning(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _create(
            client,
            auth_headers,
            vin,
            priority="high",
            estimated_cost=200.00,
            parts=[{"description": "Brake pads", "cost": 80.00}],
        )
        assert repair["status"] == "planning"
        assert repair["priority"] == "high"
        assert repair["service_visit_id"] is None
        assert [p["description"] for p in repair["parts"]] == ["Brake pads"]

    async def test_list(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        await _create(client, auth_headers, vin)
        response = await client.get(_base(vin), headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == len(data["repairs"]) >= 1

    async def test_update_replaces_parts(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin, parts=[{"description": "Old"}])
        response = await client.put(
            f"{_base(vin)}/{repair['id']}",
            json={"title": "Renamed", "parts": [{"description": "New", "cost": 5}]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Renamed"
        assert [p["description"] for p in data["parts"]] == ["New"]

    async def test_update_rejects_null_title(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        response = await client.put(
            f"{_base(vin)}/{repair['id']}", json={"title": None}, headers=auth_headers
        )
        assert response.status_code == 422

    async def test_delete(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        response = await client.delete(f"{_base(vin)}/{repair['id']}", headers=auth_headers)
        assert response.status_code == 204
        response = await client.get(f"{_base(vin)}/{repair['id']}", headers=auth_headers)
        assert response.status_code == 404

    async def test_move_to_in_progress(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        response = await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "in_progress", "position": 0},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "in_progress"
        assert response.json()["position"] == 0

    async def test_move_reorders_within_column(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        first = await _create(client, auth_headers, vin, title="First")
        second = await _create(client, auth_headers, vin, title="Second")
        response = await client.post(
            f"{_base(vin)}/{second['id']}/move",
            json={"status": "planning", "position": 0},
            headers=auth_headers,
        )
        assert response.status_code == 200
        listing = (await client.get(_base(vin), headers=auth_headers)).json()["repairs"]
        planning = [r for r in listing if r["status"] == "planning"]
        order = [r["id"] for r in sorted(planning, key=lambda r: r["position"])]
        assert order.index(second["id"]) < order.index(first["id"])

    async def test_move_to_done_without_visit_is_409(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        response = await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "done", "position": 0},
            headers=auth_headers,
        )
        assert response.status_code == 409

    async def test_complete_logs_one_service_visit(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        before = await _visit_count(client, auth_headers, vin)

        response = await client.post(
            f"{_base(vin)}/{repair['id']}/complete", json=_VISIT, headers=auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == "done"
        assert data["completed_at"] is not None
        assert data["service_visit_id"] is not None
        assert await _visit_count(client, auth_headers, vin) == before + 1

        visit = (
            await client.get(
                f"/api/vehicles/{vin}/service-visits/{data['service_visit_id']}",
                headers=auth_headers,
            )
        ).json()
        assert {item["description"] for item in visit["line_items"]} == {"Brake pads", "Labor"}
        assert float(visit["total_cost"]) == 200.0

    async def test_back_out_of_done_and_in_again_reuses_visit(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        done = (
            await client.post(
                f"{_base(vin)}/{repair['id']}/complete", json=_VISIT, headers=auth_headers
            )
        ).json()
        visits = await _visit_count(client, auth_headers, vin)

        back = await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "in_progress", "position": 0},
            headers=auth_headers,
        )
        assert back.status_code == 200
        assert back.json()["service_visit_id"] == done["service_visit_id"]
        assert back.json()["completed_at"] is None

        # A plain move is enough now: the visit already exists.
        again = await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "done", "position": 0},
            headers=auth_headers,
        )
        assert again.status_code == 200
        assert again.json()["status"] == "done"

        # And /complete is idempotent too.
        once_more = await client.post(
            f"{_base(vin)}/{repair['id']}/complete", json=_VISIT, headers=auth_headers
        )
        assert once_more.status_code == 200
        assert once_more.json()["service_visit_id"] == done["service_visit_id"]
        assert await _visit_count(client, auth_headers, vin) == visits

    async def test_deleting_the_visit_unlinks_it(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        done = (
            await client.post(
                f"{_base(vin)}/{repair['id']}/complete", json=_VISIT, headers=auth_headers
            )
        ).json()
        response = await client.delete(
            f"/api/vehicles/{vin}/service-visits/{done['service_visit_id']}", headers=auth_headers
        )
        assert response.status_code in (200, 204)

        # Out of done and back in needs a new completion, since the visit is gone.
        await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "planning", "position": 0},
            headers=auth_headers,
        )
        response = await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "done", "position": 0},
            headers=auth_headers,
        )
        assert response.status_code == 409

    async def test_complete_requires_a_line_item(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _create(client, auth_headers, vin)
        response = await client.post(
            f"{_base(vin)}/{repair['id']}/complete",
            json={"date": "2026-10-01", "line_items": []},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_part_from_supplies_is_planned_not_consumed(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        sid = await _supply(client, auth_headers)
        repair = await _create(
            client,
            auth_headers,
            vin,
            parts=[{"description": "Oil", "supply_id": sid, "supply_quantity": "4.5"}],
        )
        part = repair["parts"][0]
        assert part["supply_id"] == sid
        assert float(part["supply_quantity"]) == 4.5
        assert part["supply_name"] == "Oil"
        assert part["unit_type"] == "volume"
        # Planning reserves nothing: the stock only moves on completion.
        assert await _on_hand(client, auth_headers, sid) == 10.0

    async def test_quantity_without_a_supply_is_422(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        response = await client.post(
            _base(test_vehicle["vin"]),
            json={"title": "Oil change", "parts": [{"description": "Oil", "supply_quantity": 4}]},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_supply_pinned_to_another_vehicle_is_refused(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        sid = await _supply(client, auth_headers, vin="2HGBH41JXMN109187")
        response = await client.post(
            _base(test_vehicle["vin"]),
            json={
                "title": "Oil change",
                "parts": [{"description": "Oil", "supply_id": sid, "supply_quantity": 4}],
            },
            headers=auth_headers,
        )
        assert response.status_code == 400

    async def test_completing_consumes_the_supply_on_the_visit(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        sid = await _supply(client, auth_headers)
        repair = await _create(
            client,
            auth_headers,
            vin,
            parts=[{"description": "Oil", "supply_id": sid, "supply_quantity": "4"}],
        )
        visit_body = {
            "date": "2026-10-01",
            "line_items": [
                {"description": "Oil", "supplies_used": [{"supply_id": sid, "quantity": "4"}]},
                {"description": "Labor", "cost": "30.00"},
            ],
        }
        done = (
            await client.post(
                f"{_base(vin)}/{repair['id']}/complete", json=visit_body, headers=auth_headers
            )
        ).json()
        assert await _on_hand(client, auth_headers, sid) == 6.0

        visit = (
            await client.get(
                f"/api/vehicles/{vin}/service-visits/{done['service_visit_id']}",
                headers=auth_headers,
            )
        ).json()
        assert float(visit["parts_supplies_cost"]) == 32.0  # 4 L at 8.00
        assert float(visit["calculated_total_cost"]) == 62.0

        # Back out of done and in again: the stock is not drawn twice.
        await client.post(
            f"{_base(vin)}/{repair['id']}/move",
            json={"status": "in_progress", "position": 0},
            headers=auth_headers,
        )
        await client.post(
            f"{_base(vin)}/{repair['id']}/complete", json=visit_body, headers=auth_headers
        )
        assert await _on_hand(client, auth_headers, sid) == 6.0

    async def test_archived_supply_stays_on_an_edited_repair(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        sid = await _supply(client, auth_headers)
        part = {"description": "Oil", "supply_id": sid, "supply_quantity": "4"}
        repair = await _create(client, auth_headers, vin, parts=[part])
        await client.put(f"/api/supplies/{sid}", json={"is_active": False}, headers=auth_headers)

        response = await client.put(
            f"{_base(vin)}/{repair['id']}",
            json={"title": "Oil change", "parts": [part]},
            headers=auth_headers,
        )
        assert response.status_code == 200

    async def test_unauthorized(self, client: AsyncClient, test_vehicle):
        response = await client.get(_base(test_vehicle["vin"]))
        assert response.status_code == 401

    async def test_unknown_repair_is_404(self, client: AsyncClient, auth_headers, test_vehicle):
        response = await client.get(f"{_base(test_vehicle['vin'])}/999999", headers=auth_headers)
        assert response.status_code == 404
