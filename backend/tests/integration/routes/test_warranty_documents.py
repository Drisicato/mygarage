"""Integration tests for warranty documents: upload, serve, delete, and file cleanup."""

import io

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings
from app.services import warranty_service

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"


def _base(vin: str) -> str:
    return f"/api/vehicles/{vin}/warranties"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


async def _warranty(client: AsyncClient, headers, vin: str) -> int:
    response = await client.post(
        _base(vin),
        json={"warranty_type": "Extended", "start_date": "2026-01-01"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["documents"] == []
    return response.json()["id"]


async def _upload(
    client: AsyncClient, headers, vin: str, warranty_id: int, name="contract.pdf", data=PDF, mime="application/pdf"
):
    return await client.post(
        f"{_base(vin)}/{warranty_id}/documents",
        files={"file": (name, data, mime)},
        headers=headers,
    )


def _stored(vin: str, warranty_id: int) -> list:
    folder = settings.documents_dir / vin / "warranties" / str(warranty_id)
    return [p for p in folder.glob("*") if p.is_file()] if folder.exists() else []


@pytest.mark.integration
@pytest.mark.asyncio
class TestWarrantyDocuments:
    async def test_upload_serve_and_list(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        warranty_id = await _warranty(client, auth_headers, vin)

        up = await _upload(client, auth_headers, vin, warranty_id)
        assert up.status_code == 201, up.text
        body = up.json()
        assert body["file_name"] == "contract.pdf"
        assert body["file_type"] == "application/pdf"
        assert body["file_size"] == len(PDF)

        got = await client.get(
            f"{_base(vin)}/{warranty_id}/documents/{body['id']}", headers=auth_headers
        )
        assert got.status_code == 200
        assert got.content == PDF
        assert got.headers["content-type"] == "application/pdf"
        assert got.headers["content-disposition"].startswith("inline")
        assert "contract.pdf" in got.headers["content-disposition"]

        listed = (await client.get(_base(vin), headers=auth_headers)).json()
        mine = next(w for w in listed if w["id"] == warranty_id)
        assert [d["id"] for d in mine["documents"]] == [body["id"]]
        one = (await client.get(f"{_base(vin)}/{warranty_id}", headers=auth_headers)).json()
        assert [d["file_name"] for d in one["documents"]] == ["contract.pdf"]

    async def test_documents_survive_an_edit(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        warranty_id = await _warranty(client, auth_headers, vin)
        await _upload(client, auth_headers, vin, warranty_id)
        await _upload(client, auth_headers, vin, warranty_id, "photo.png", _png(), "image/png")

        edited = await client.put(
            f"{_base(vin)}/{warranty_id}", json={"provider": "Docs Edit Co"}, headers=auth_headers
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["provider"] == "Docs Edit Co"
        assert [d["file_name"] for d in edited.json()["documents"]] == ["contract.pdf", "photo.png"]

    async def test_delete_document_removes_file(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        warranty_id = await _warranty(client, auth_headers, vin)
        doc_id = (await _upload(client, auth_headers, vin, warranty_id)).json()["id"]
        assert len(_stored(vin, warranty_id)) == 1

        response = await client.delete(
            f"{_base(vin)}/{warranty_id}/documents/{doc_id}", headers=auth_headers
        )
        assert response.status_code == 204
        assert not _stored(vin, warranty_id)
        again = await client.get(
            f"{_base(vin)}/{warranty_id}/documents/{doc_id}", headers=auth_headers
        )
        assert again.status_code == 404

    async def test_deleting_warranty_removes_documents(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        warranty_id = await _warranty(client, auth_headers, vin)
        await _upload(client, auth_headers, vin, warranty_id)
        await _upload(client, auth_headers, vin, warranty_id, "b.pdf")
        assert len(_stored(vin, warranty_id)) == 2

        response = await client.delete(f"{_base(vin)}/{warranty_id}", headers=auth_headers)
        assert response.status_code == 204
        assert not _stored(vin, warranty_id)

    async def test_rejects_disallowed_type(self, client: AsyncClient, auth_headers, test_vehicle):
        vin = test_vehicle["vin"]
        warranty_id = await _warranty(client, auth_headers, vin)
        response = await _upload(
            client, auth_headers, vin, warranty_id, "run.exe", b"MZ\x90\x00", "application/x-msdownload"
        )
        assert response.status_code == 400
        assert not _stored(vin, warranty_id)

    async def test_document_limit(self, client: AsyncClient, auth_headers, test_vehicle, monkeypatch):
        monkeypatch.setattr(warranty_service, "MAX_DOCUMENTS_PER_WARRANTY", 2)
        vin = test_vehicle["vin"]
        warranty_id = await _warranty(client, auth_headers, vin)
        for _ in range(2):
            assert (await _upload(client, auth_headers, vin, warranty_id)).status_code == 201
        assert (await _upload(client, auth_headers, vin, warranty_id)).status_code == 400
        assert len(_stored(vin, warranty_id)) == 2

    async def test_unknown_warranty_or_document_is_404(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        assert (await _upload(client, auth_headers, vin, 999999)).status_code == 404
        warranty_id = await _warranty(client, auth_headers, vin)
        response = await client.get(
            f"{_base(vin)}/{warranty_id}/documents/999999", headers=auth_headers
        )
        assert response.status_code == 404

    async def test_requires_auth(self, client: AsyncClient, test_vehicle):
        vin = test_vehicle["vin"]
        assert (await client.get(f"{_base(vin)}/1/documents/1")).status_code == 401
