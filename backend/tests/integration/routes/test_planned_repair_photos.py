"""Integration tests for planned repair photos: upload, serve, delete, and file cleanup."""

import io

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings
from app.services import planned_repair_service


def _base(vin: str) -> str:
    return f"/api/vehicles/{vin}/planned-repairs"


def _png(mode: str = "RGB", size: tuple[int, int] = (3000, 2000)) -> bytes:
    buf = io.BytesIO()
    color = (200, 30, 30) if mode == "RGB" else (200, 30, 30, 0)
    Image.new(mode, size, color).save(buf, format="PNG")
    return buf.getvalue()


async def _repair(client: AsyncClient, headers, vin: str) -> int:
    response = await client.post(_base(vin), json={"title": "Fix rust"}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _upload(client: AsyncClient, headers, vin: str, repair_id: int, **kwargs):
    return await client.post(
        f"{_base(vin)}/{repair_id}/photos",
        files={"file": ("rust.png", kwargs.get("data", _png()), "image/png")},
        headers=headers,
    )


def _stored(vin: str, repair_id: int) -> list:
    return list((settings.photos_dir / vin / "planned_repairs").glob(f"{repair_id}-*"))


@pytest.mark.integration
@pytest.mark.asyncio
class TestPlannedRepairPhotos:
    async def test_upload_serve_and_list(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair_id = await _repair(client, auth_headers, vin)

        up = await _upload(client, auth_headers, vin, repair_id)
        assert up.status_code == 201, up.text
        photo_id = up.json()["id"]

        got = await client.get(f"{_base(vin)}/{repair_id}/photos/{photo_id}", headers=auth_headers)
        assert got.status_code == 200
        assert got.headers["content-type"] == "image/jpeg"
        stored = Image.open(io.BytesIO(got.content))
        assert max(stored.size) <= planned_repair_service.PHOTO_MAX_SIDE[0]

        repair = (await client.get(f"{_base(vin)}/{repair_id}", headers=auth_headers)).json()
        assert [p["id"] for p in repair["photos"]] == [photo_id]

    async def test_transparent_png_is_accepted(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair_id = await _repair(client, auth_headers, vin)
        up = await _upload(
            client, auth_headers, vin, repair_id, data=_png("RGBA", (100, 100))
        )
        assert up.status_code == 201, up.text

    async def test_delete_photo_removes_file(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair_id = await _repair(client, auth_headers, vin)
        photo_id = (await _upload(client, auth_headers, vin, repair_id)).json()["id"]
        assert _stored(vin, repair_id)

        response = await client.delete(
            f"{_base(vin)}/{repair_id}/photos/{photo_id}", headers=auth_headers
        )
        assert response.status_code == 204
        assert not _stored(vin, repair_id)
        again = await client.get(f"{_base(vin)}/{repair_id}/photos/{photo_id}", headers=auth_headers)
        assert again.status_code == 404

    async def test_deleting_repair_removes_photos(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        repair_id = await _repair(client, auth_headers, vin)
        await _upload(client, auth_headers, vin, repair_id)
        await _upload(client, auth_headers, vin, repair_id)
        assert len(_stored(vin, repair_id)) == 2

        response = await client.delete(f"{_base(vin)}/{repair_id}", headers=auth_headers)
        assert response.status_code == 204
        assert not _stored(vin, repair_id)

    async def test_rejects_non_image(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        repair_id = await _repair(client, auth_headers, vin)
        response = await _upload(client, auth_headers, vin, repair_id, data=b"not a png")
        assert response.status_code == 400
        assert not _stored(vin, repair_id)

    async def test_photo_limit(
        self, client: AsyncClient, auth_headers, test_vehicle, monkeypatch
    ):
        monkeypatch.setattr(planned_repair_service, "MAX_PHOTOS_PER_REPAIR", 2)
        vin = test_vehicle["vin"]
        repair_id = await _repair(client, auth_headers, vin)
        small = _png(size=(20, 20))
        for _ in range(2):
            assert (await _upload(client, auth_headers, vin, repair_id, data=small)).status_code == 201
        response = await _upload(client, auth_headers, vin, repair_id, data=small)
        assert response.status_code == 400
        assert len(_stored(vin, repair_id)) == 2

    async def test_unknown_repair_or_photo_is_404(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        assert (await _upload(client, auth_headers, vin, 999999)).status_code == 404
        repair_id = await _repair(client, auth_headers, vin)
        response = await client.get(f"{_base(vin)}/{repair_id}/photos/999999", headers=auth_headers)
        assert response.status_code == 404

    async def test_requires_auth(self, client: AsyncClient, test_vehicle):
        vin = test_vehicle["vin"]
        response = await client.get(f"{_base(vin)}/1/photos/1")
        assert response.status_code == 401
