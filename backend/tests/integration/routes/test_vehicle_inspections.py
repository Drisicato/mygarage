"""Integration tests for vehicle inspection routes.

Covers CRUD with whole-replace items and corners, validation of the fixed
checklist, scoping to the vehicle, read-only shares, photos, and the hand-off
of a red or yellow point to a planned repair.
"""

import io

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import delete

from app.config import settings
from app.models.vehicle_share import VehicleShare


def _base(vin: str) -> str:
    return f"/api/vehicles/{vin}/inspections"


_BODY = {
    "date": "2026-10-01",
    "odometer_km": "85000.5",
    "inspector": "Self",
    "tire_pressure_front_kpa": "240",
    "tire_pressure_rear_kpa": "220",
    "notes_tires": "Fronts wearing on the outside",
    "items": [
        {"item_key": "wipers", "status": "green"},
        {"item_key": "engine_oil", "status": "yellow", "note": "Due in 1,000 km"},
        {"item_key": "exhaust", "status": "red", "note": "Rusted through at the flex pipe"},
        {"item_key": "battery", "status": "not_inspected"},
    ],
    "corners": [
        {
            "position": "lf",
            "tread_status": "yellow",
            "tread_depth_mm": "4.0",
            "brake_status": "green",
            "brake_pad_mm": "8.0",
        },
        {"position": "rf", "tread_status": "green", "tread_depth_mm": "6.5"},
    ],
}


async def _create(client: AsyncClient, headers, vin: str, **overrides) -> dict:
    response = await client.post(_base(vin), json={**_BODY, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (2400, 1800), (30, 120, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _item(inspection: dict, key: str) -> dict:
    return next(i for i in inspection["items"] if i["item_key"] == key)


@pytest.mark.integration
@pytest.mark.asyncio
class TestVehicleInspectionRoutes:
    async def test_create_and_read(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        assert created["inspector"] == "Self"
        assert float(created["tire_pressure_front_kpa"]) == 240
        assert float(created["odometer_km"]) == 85000.5
        assert {i["item_key"] for i in created["items"]} == {
            "wipers",
            "engine_oil",
            "exhaust",
            "battery",
        }
        lf = next(c for c in created["corners"] if c["position"] == "lf")
        assert float(lf["tread_depth_mm"]) == 4.0
        assert "pressure_in_kpa" not in lf
        # 4 items + 2 corners x (tread, brake)
        assert created["counts"] == {"green": 3, "yellow": 2, "red": 1, "not_inspected": 2}

        got = await client.get(f"{_base(vin)}/{created['id']}", headers=auth_headers)
        assert got.status_code == 200
        assert got.json()["counts"] == created["counts"]

        listed = await client.get(_base(vin), headers=auth_headers)
        assert listed.status_code == 200
        assert created["id"] in [i["id"] for i in listed.json()["inspections"]]

    async def test_list_is_newest_first(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        older = await _create(client, auth_headers, vin, date="2020-01-01")
        newer = await _create(client, auth_headers, vin, date="2030-01-01")
        ids = [
            i["id"]
            for i in (await client.get(_base(vin), headers=auth_headers)).json()["inspections"]
        ]
        assert ids.index(newer["id"]) < ids.index(older["id"])

    async def test_update_replaces_items_and_corners_whole(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        response = await client.put(
            f"{_base(vin)}/{created['id']}",
            json={
                "inspector": "Corner Garage",
                "items": [
                    {"item_key": "wipers", "status": "red", "note": "Streaking"},
                    {"item_key": "coolant", "status": "green"},
                ],
                "corners": [{"position": "rr", "brake_status": "red", "brake_pad_mm": "2.0"}],
            },
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["inspector"] == "Corner Garage"
        assert float(body["tire_pressure_rear_kpa"]) == 220  # omitted keeps its value
        assert {i["item_key"]: i["status"] for i in body["items"]} == {
            "wipers": "red",
            "coolant": "green",
        }
        assert [c["position"] for c in body["corners"]] == ["rr"]

    async def test_update_without_children_keeps_them(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        response = await client.put(
            f"{_base(vin)}/{created['id']}", json={"notes_tires": None}, headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["notes_tires"] is None
        assert len(response.json()["items"]) == len(created["items"])
        assert len(response.json()["corners"]) == len(created["corners"])

    async def test_null_date_is_refused(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        response = await client.put(
            f"{_base(vin)}/{created['id']}", json={"date": None}, headers=auth_headers
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "items",
        [
            [{"item_key": "flux_capacitor", "status": "green"}],
            [{"item_key": "horn", "status": "green"}],  # removed from the checklist
            [{"item_key": "wipers", "status": "purple"}],
            [{"item_key": "wipers", "status": "green"}, {"item_key": "wipers", "status": "red"}],
        ],
    )
    async def test_bad_items_are_422(self, client: AsyncClient, auth_headers, test_vehicle, items):
        response = await client.post(
            _base(test_vehicle["vin"]),
            json={"date": "2026-10-01", "items": items},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_duplicate_corner_is_422(self, client: AsyncClient, auth_headers, test_vehicle):
        response = await client.post(
            _base(test_vehicle["vin"]),
            json={"date": "2026-10-01", "corners": [{"position": "lf"}, {"position": "lf"}]},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_delete(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        response = await client.delete(f"{_base(vin)}/{created['id']}", headers=auth_headers)
        assert response.status_code == 204
        got = await client.get(f"{_base(vin)}/{created['id']}", headers=auth_headers)
        assert got.status_code == 404

    async def test_another_vehicles_inspection_is_404(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        other = "2HGBH41JXMN109187"
        made = await client.post(
            "/api/vehicles",
            json={"vin": other, "nickname": "Other", "vehicle_type": "Car"},
            headers=auth_headers,
        )
        # Another test may have made it already; either way it exists now.
        assert made.status_code in (200, 201, 400, 409), made.text
        response = await client.get(f"{_base(other)}/{created['id']}", headers=auth_headers)
        assert response.status_code == 404

    async def test_read_only_share_cannot_write(
        self,
        client: AsyncClient,
        auth_headers,
        test_vehicle,
        db_session,
        test_user,
        non_admin_user,
        non_admin_headers,
    ):
        vin = test_vehicle["vin"]
        created = await _create(client, auth_headers, vin)
        db_session.add(
            VehicleShare(
                vehicle_vin=vin,
                user_id=non_admin_user["id"],
                permission="read",
                shared_by=test_user["id"],
            )
        )
        await db_session.commit()
        try:
            base = _base(vin)
            assert (await client.get(base, headers=non_admin_headers)).status_code == 200
            writes = [
                client.post(base, json=_BODY, headers=non_admin_headers),
                client.put(
                    f"{base}/{created['id']}", json={"inspector": "x"}, headers=non_admin_headers
                ),
                client.delete(f"{base}/{created['id']}", headers=non_admin_headers),
                client.post(
                    f"{base}/{created['id']}/items/exhaust/planned-repair",
                    json={"title": "Exhaust"},
                    headers=non_admin_headers,
                ),
            ]
            for write in writes:
                assert (await write).status_code == 403
        finally:
            await db_session.execute(
                delete(VehicleShare).where(
                    VehicleShare.vehicle_vin == vin,
                    VehicleShare.user_id == non_admin_user["id"],
                )
            )
            await db_session.commit()


@pytest.mark.integration
@pytest.mark.asyncio
class TestVehicleInspectionPhotos:
    async def test_upload_serve_delete(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        inspection_id = (await _create(client, auth_headers, vin))["id"]
        up = await client.post(
            f"{_base(vin)}/{inspection_id}/photos",
            files={"file": ("tire.png", _png(), "image/png")},
            headers=auth_headers,
        )
        assert up.status_code == 201, up.text
        photo_id = up.json()["id"]
        stored = list((settings.photos_dir / vin / "inspections").glob(f"{inspection_id}-*"))
        assert len(stored) == 1

        got = await client.get(
            f"{_base(vin)}/{inspection_id}/photos/{photo_id}", headers=auth_headers
        )
        assert got.status_code == 200
        assert got.headers["content-type"] == "image/jpeg"
        assert max(Image.open(io.BytesIO(got.content)).size) <= 1600

        listed = (await client.get(f"{_base(vin)}/{inspection_id}", headers=auth_headers)).json()
        assert [p["id"] for p in listed["photos"]] == [photo_id]

        gone = await client.delete(
            f"{_base(vin)}/{inspection_id}/photos/{photo_id}", headers=auth_headers
        )
        assert gone.status_code == 204
        assert not stored[0].exists()

    async def test_deleting_inspection_removes_photo_files(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection_id = (await _create(client, auth_headers, vin))["id"]
        await client.post(
            f"{_base(vin)}/{inspection_id}/photos",
            files={"file": ("tire.png", _png(), "image/png")},
            headers=auth_headers,
        )
        stored = list((settings.photos_dir / vin / "inspections").glob(f"{inspection_id}-*"))
        assert stored
        await client.delete(f"{_base(vin)}/{inspection_id}", headers=auth_headers)
        assert not any(p.exists() for p in stored)


@pytest.mark.integration
@pytest.mark.asyncio
class TestInspectionToPlannedRepair:
    async def test_red_item_becomes_a_high_priority_repair(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection = await _create(client, auth_headers, vin)
        url = f"{_base(vin)}/{inspection['id']}/items/exhaust/planned-repair"
        response = await client.post(url, json={"title": "Exhaust system"}, headers=auth_headers)
        assert response.status_code == 201, response.text
        repair_id = _item(response.json(), "exhaust")["planned_repair_id"]
        assert repair_id is not None

        repair = (
            await client.get(
                f"/api/vehicles/{vin}/planned-repairs/{repair_id}", headers=auth_headers
            )
        ).json()
        assert repair["title"] == "Exhaust system"
        assert repair["priority"] == "high"
        assert repair["service_category"] == "Inspection"
        assert "Rusted through" in repair["description"]
        assert "2026-10-01" in repair["description"]

        again = await client.post(url, json={"title": "Exhaust system"}, headers=auth_headers)
        assert again.status_code == 409

    async def test_yellow_item_is_medium_priority(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection = await _create(client, auth_headers, vin)
        response = await client.post(
            f"{_base(vin)}/{inspection['id']}/items/engine_oil/planned-repair",
            json={"title": "Engine oil"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        repair_id = _item(response.json(), "engine_oil")["planned_repair_id"]
        repair = (
            await client.get(
                f"/api/vehicles/{vin}/planned-repairs/{repair_id}", headers=auth_headers
            )
        ).json()
        assert repair["priority"] == "medium"

    async def test_green_or_missing_items_are_refused(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection = await _create(client, auth_headers, vin)
        base = f"{_base(vin)}/{inspection['id']}/items"
        green = await client.post(
            f"{base}/wipers/planned-repair", json={"title": "Wipers"}, headers=auth_headers
        )
        assert green.status_code == 400
        missing = await client.post(
            f"{base}/coolant/planned-repair", json={"title": "Coolant"}, headers=auth_headers
        )
        assert missing.status_code == 404
        unknown = await client.post(
            f"{base}/flux_capacitor/planned-repair", json={"title": "x"}, headers=auth_headers
        )
        assert unknown.status_code == 422

    async def test_link_survives_an_edit_and_clears_when_repair_deleted(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection = await _create(client, auth_headers, vin)
        made = await client.post(
            f"{_base(vin)}/{inspection['id']}/items/exhaust/planned-repair",
            json={"title": "Exhaust"},
            headers=auth_headers,
        )
        repair_id = _item(made.json(), "exhaust")["planned_repair_id"]

        edited = await client.put(
            f"{_base(vin)}/{inspection['id']}", json={"items": _BODY["items"]}, headers=auth_headers
        )
        assert _item(edited.json(), "exhaust")["planned_repair_id"] == repair_id

        deleted = await client.delete(
            f"/api/vehicles/{vin}/planned-repairs/{repair_id}", headers=auth_headers
        )
        assert deleted.status_code == 204
        got = (await client.get(f"{_base(vin)}/{inspection['id']}", headers=auth_headers)).json()
        assert _item(got, "exhaust")["planned_repair_id"] is None


@pytest.mark.integration
@pytest.mark.asyncio
class TestCornerToPlannedRepair:
    async def _inspection(self, client, headers, vin):
        return await _create(
            client,
            headers,
            vin,
            corners=[
                {"position": "lf", "tread_status": "red", "tread_depth_mm": "2.4"},
                {
                    "position": "rr",
                    "brake_status": "red",
                    "brake_pad_mm": "2.0",
                    "tread_status": "green",
                    "tread_depth_mm": "7.1",
                },
            ],
        )

    async def test_red_tire_and_brake_become_linked_repairs(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection = await self._inspection(client, auth_headers, vin)
        base = f"{_base(vin)}/{inspection['id']}/corners"

        tire = await client.post(
            f"{base}/lf/tread/planned-repair", json={"title": "Replace tire"}, headers=auth_headers
        )
        assert tire.status_code == 201, tire.text
        lf = next(c for c in tire.json()["corners"] if c["position"] == "lf")
        assert lf["tread_repair_id"] is not None and lf["brake_repair_id"] is None
        repair = (
            await client.get(
                f"/api/vehicles/{vin}/planned-repairs/{lf['tread_repair_id']}", headers=auth_headers
            )
        ).json()
        assert repair["title"] == "Replace tire"
        assert repair["priority"] == "high"
        assert "left front" in repair["description"] and "2.4 mm" in repair["description"]

        brake = await client.post(
            f"{base}/rr/brake/planned-repair", json={"title": "Brake pads"}, headers=auth_headers
        )
        assert brake.status_code == 201
        rr = next(c for c in brake.json()["corners"] if c["position"] == "rr")
        assert rr["brake_repair_id"] is not None

        again = await client.post(
            f"{base}/lf/tread/planned-repair", json={"title": "Replace tire"}, headers=auth_headers
        )
        assert again.status_code == 409

        # The links survive an edit that sends the corners again.
        edited = await client.put(
            f"{_base(vin)}/{inspection['id']}",
            json={"corners": [{"position": "lf", "tread_status": "red", "tread_depth_mm": "2.4"}]},
            headers=auth_headers,
        )
        lf = next(c for c in edited.json()["corners"] if c["position"] == "lf")
        assert lf["tread_repair_id"] == repair["id"]

        await client.delete(
            f"/api/vehicles/{vin}/planned-repairs/{repair['id']}", headers=auth_headers
        )
        got = (await client.get(f"{_base(vin)}/{inspection['id']}", headers=auth_headers)).json()
        assert next(c for c in got["corners"] if c["position"] == "lf")["tread_repair_id"] is None

    async def test_only_red_readings_on_recorded_wheels(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        inspection = await self._inspection(client, auth_headers, vin)
        base = f"{_base(vin)}/{inspection['id']}/corners"
        body = {"json": {"title": "x"}, "headers": auth_headers}
        assert (await client.post(f"{base}/rr/tread/planned-repair", **body)).status_code == 400
        assert (await client.post(f"{base}/rf/tread/planned-repair", **body)).status_code == 404
        assert (await client.post(f"{base}/xx/tread/planned-repair", **body)).status_code == 422
        assert (await client.post(f"{base}/lf/wiper/planned-repair", **body)).status_code == 422
