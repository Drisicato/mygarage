"""Integration tests for planned repair part pictures, and parts keeping their id on update."""

import io

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings


def _base(vin: str) -> str:
    return f"/api/vehicles/{vin}/planned-repairs"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (30, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


async def _repair(client: AsyncClient, headers, vin: str, parts: list[dict]) -> dict:
    response = await client.post(
        _base(vin), json={"title": "Water pump", "parts": parts}, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _upload(client: AsyncClient, headers, vin: str, repair_id: int, part_id: int):
    return await client.post(
        f"{_base(vin)}/{repair_id}/parts/{part_id}/image",
        files={"file": ("pump.png", _png(), "image/png")},
        headers=headers,
    )


def _stored(vin: str, *part_ids: int) -> list:
    """The stored pictures of these parts (the photos folder is shared across tests)."""
    folder = settings.photos_dir / vin / "planned_repairs" / "parts"
    return [f for part_id in part_ids for f in folder.glob(f"{part_id}-*.jpg")]


@pytest.mark.integration
@pytest.mark.asyncio
class TestPlannedRepairPartImages:
    async def test_upload_serve_replace_and_delete(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _repair(client, auth_headers, vin, [{"description": "Water pump"}])
        part = repair["parts"][0]
        assert part["has_image"] is False and part["image_version"] is None
        url = f"{_base(vin)}/{repair['id']}/parts/{part['id']}/image"

        up = await _upload(client, auth_headers, vin, repair["id"], part["id"])
        assert up.status_code == 200, up.text
        first_version = up.json()["image_version"]
        assert up.json()["has_image"] is True and first_version

        got = await client.get(url, headers=auth_headers)
        assert got.status_code == 200
        assert got.headers["content-type"] == "image/jpeg"

        # Replacing swaps the file, so the version changes and the old file goes.
        again = await _upload(client, auth_headers, vin, repair["id"], part["id"])
        assert again.json()["image_version"] != first_version
        assert len(_stored(vin, part["id"])) == 1

        assert (await client.delete(url, headers=auth_headers)).status_code == 204
        assert _stored(vin, part["id"]) == []
        assert (await client.get(url, headers=auth_headers)).status_code == 404
        assert (await client.delete(url, headers=auth_headers)).status_code == 404

    async def test_rejects_non_image(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _repair(client, auth_headers, vin, [{"description": "Water pump"}])
        response = await client.post(
            f"{_base(vin)}/{repair['id']}/parts/{repair['parts'][0]['id']}/image",
            files={"file": ("notes.txt", b"not an image", "text/plain")},
            headers=auth_headers,
        )
        assert response.status_code in (400, 415, 422)
        assert _stored(vin, repair["parts"][0]["id"]) == []

    async def test_unknown_part_is_404(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair = await _repair(client, auth_headers, vin, [{"description": "Water pump"}])
        other = await _repair(client, auth_headers, vin, [{"description": "Belt"}])
        # A part of another repair is not this repair's part.
        response = await _upload(client, auth_headers, vin, repair["id"], other["parts"][0]["id"])
        assert response.status_code == 404
        response = await _upload(client, auth_headers, vin, repair["id"], 999999)
        assert response.status_code == 404

    async def test_update_keeps_parts_by_id_and_their_pictures(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _repair(
            client, auth_headers, vin, [{"description": "Water pump"}, {"description": "Belt"}]
        )
        pump, belt = repair["parts"]
        await _upload(client, auth_headers, vin, repair["id"], pump["id"])
        await _upload(client, auth_headers, vin, repair["id"], belt["id"])

        # Keep and edit the pump, drop the belt, add a thermostat.
        response = await client.put(
            f"{_base(vin)}/{repair['id']}",
            json={
                "parts": [
                    {"id": pump["id"], "description": "Water pump (OEM)", "cost": "90"},
                    {"description": "Thermostat"},
                ]
            },
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        parts = response.json()["parts"]
        assert [p["id"] for p in parts][0] == pump["id"]
        assert parts[0]["description"] == "Water pump (OEM)"
        assert parts[0]["has_image"] is True
        assert parts[1]["id"] not in (pump["id"], belt["id"])
        assert parts[1]["has_image"] is False
        # The dropped belt's picture is gone from disk; the pump's stays.
        assert _stored(vin, belt["id"]) == []
        assert len(_stored(vin, pump["id"])) == 1

    async def test_another_repairs_part_id_adds_a_new_part(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _repair(client, auth_headers, vin, [{"description": "Water pump"}])
        other = await _repair(client, auth_headers, vin, [{"description": "Belt"}])
        belt_id = other["parts"][0]["id"]

        response = await client.put(
            f"{_base(vin)}/{repair['id']}",
            json={"parts": [{"id": belt_id, "description": "Belt"}]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["parts"][0]["id"] != belt_id
        # The other repair keeps its own part.
        kept = await client.get(f"{_base(vin)}/{other['id']}", headers=auth_headers)
        assert [p["id"] for p in kept.json()["parts"]] == [belt_id]

    async def test_deleting_the_repair_removes_part_pictures(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _repair(client, auth_headers, vin, [{"description": "Water pump"}])
        part_id = repair["parts"][0]["id"]
        await _upload(client, auth_headers, vin, repair["id"], part_id)
        assert len(_stored(vin, part_id)) == 1

        response = await client.delete(f"{_base(vin)}/{repair['id']}", headers=auth_headers)
        assert response.status_code == 204
        assert _stored(vin, part_id) == []

    async def test_a_part_moved_to_the_jobs_loses_its_picture(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair = await _repair(client, auth_headers, vin, [{"description": "Cover"}])
        part = repair["parts"][0]
        await _upload(client, auth_headers, vin, repair["id"], part["id"])

        response = await client.put(
            f"{_base(vin)}/{repair['id']}",
            json={"parts": [{"id": part["id"], "kind": "job", "description": "Cover"}]},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        [job] = response.json()["parts"]
        assert job["id"] == part["id"] and job["kind"] == "job" and job["has_image"] is False
        assert _stored(vin, part["id"]) == []
