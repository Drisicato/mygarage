"""LubeLogger import: preview, the backup taken first, and the rows written."""

import json
import uuid
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.models import FuelRecord, ServiceLineItem, ServiceVisit

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

FUEL = (
    "Date,Odometer,FuelConsumed,Cost,FuelEconomy,IsFillToFull,MissedFuelUp,Notes,Tags\n"
    "10/6/2026,71700,10.5,42.00,0,True,False,Costco,road trip\n"
    "10/20/2026,72000,12,48.12,28.57,False,True,,\n"
)
REPAIRS = (
    "Date,Description,Cost,Notes,Odometer,Tags\n"
    '9/1/2026,Front bumper,"$1,234.56",Body shop,71000,\n'
    "9/1/2026,Headlight,$80.00,,71000,\n"
)


def _unique_repairs() -> tuple[str, str]:
    """Two jobs on one day at one reading, named for this test alone: the test
    vehicle is shared and not rolled back between tests."""
    tag = uuid.uuid4().hex[:8]
    return tag, (
        "Date,Description,Cost,Notes,Odometer,Tags\n"
        f"9/2/2026,Bumper {tag},$100.00,,71100,\n"
        f"9/2/2026,Headlight {tag},$80.00,,71100,\n"
    )


@pytest.fixture(autouse=True)
def _reset_import_rate_limit():
    from app.routes.import_data import limiter

    storage = limiter._storage
    storage.storage.clear()
    storage.expirations.clear()


def _url(vin: str) -> str:
    return f"/api/import/vehicles/{vin}/lubelogger"


async def _post(client, headers, vin, files, **form):
    return await client.post(
        _url(vin),
        headers=headers,
        files=[("file", (name, body.encode(), "text/csv")) for name, body in files],
        data={"distance_unit": "mi", "fuel_unit": "gal_us", "date_order": "mdy", **form},
    )


class TestPreview:
    async def test_a_dry_run_reads_every_file_and_writes_nothing(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        vin = test_vehicle["vin"]
        before = len((await db_session.execute(select(FuelRecord.id))).all())
        response = await _post(
            client,
            auth_headers,
            vin,
            [("a.csv", FUEL), ("b.csv", REPAIRS)],
            record_type=["auto", "repair"],
            dry_run="true",
        )
        assert response.status_code == 200, response.text
        fuel, repairs = response.json()["files"]
        assert (fuel["record_type"], fuel["row_count"]) == ("fuel", 2)
        assert (fuel["date_from"], fuel["date_to"]) == ("2026-10-06", "2026-10-20")
        assert fuel["sample"][0]["liters"] == pytest.approx(39.747)
        assert (repairs["record_type"], repairs["row_count"]) == ("repair", 2)
        assert repairs["sample"][0]["category"] == "Repair"
        assert len((await db_session.execute(select(FuelRecord.id))).all()) == before

    async def test_an_unsupported_export_is_refused_by_name(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        response = await _post(
            client,
            auth_headers,
            test_vehicle["vin"],
            [("odo.csv", "Date,InitialOdometer,Odometer,Notes,Tags\n1/1/2026,1,2,,\n")],
            dry_run="true",
        )
        assert response.status_code == 400
        assert "Odometer export" in response.json()["detail"]

    async def test_bad_options_are_refused(self, client: AsyncClient, auth_headers, test_vehicle):
        response = await _post(
            client, auth_headers, test_vehicle["vin"], [("a.csv", FUEL)], fuel_unit="barrels"
        )
        assert response.status_code == 400


class TestImport:
    async def test_writes_both_files_after_saving_a_backup(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        vin = test_vehicle["vin"]
        response = await _post(
            client,
            auth_headers,
            vin,
            [("a.csv", FUEL), ("b.csv", REPAIRS)],
            record_type=["auto", "repair"],
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["success_count"] == 4
        assert [f["success_count"] for f in body["files"]] == [2, 2]

        # The backup is on disk, under the vehicle's own name, and is the
        # vehicle's JSON export as it stood before the rows were written.
        backup = settings.data_dir / "backups" / "vehicles" / body["backup_filename"]
        assert body["backup_filename"].startswith(f"{vin}-before-lubelogger-import-")
        saved = json.loads(backup.read_text(encoding="utf-8"))
        assert saved["vehicle"]["vin"] == vin
        assert saved["backup_reason"] == "before-lubelogger-import"
        assert not any(r.get("notes") == "Costco\nTags: road trip" for r in saved["fuel_records"])

        fuel = (
            (await db_session.execute(select(FuelRecord).where(FuelRecord.vin == vin)))
            .scalars()
            .all()
        )
        costco = next(r for r in fuel if r.notes == "Costco\nTags: road trip")
        assert costco.liters == pytest.approx(Decimal("39.747"))
        assert costco.odometer_km == pytest.approx(Decimal("115389.96"))
        missed = next(r for r in fuel if r.missed_fillup)
        assert missed.is_full_tank is False

        items = (
            await db_session.execute(
                select(ServiceLineItem.description, ServiceVisit.service_category)
                .join(ServiceVisit, ServiceVisit.id == ServiceLineItem.visit_id)
                .where(ServiceVisit.vin == vin, ServiceVisit.notes.is_not(None))
            )
        ).all()
        assert ("Front bumper", "Repair") in items

    async def test_two_jobs_the_same_day_are_kept_and_a_reimport_skips_them(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        _tag, repairs = _unique_repairs()
        first = await _post(client, auth_headers, vin, [("b.csv", repairs)], record_type=["repair"])
        assert first.json()["success_count"] == 2
        again = await _post(client, auth_headers, vin, [("b.csv", repairs)], record_type=["repair"])
        assert (again.json()["success_count"], again.json()["skipped_count"]) == (0, 2)

    async def test_the_backup_can_be_listed_and_downloaded(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        vin = test_vehicle["vin"]
        imported = await _post(client, auth_headers, vin, [("a.csv", FUEL)])
        name = imported.json()["backup_filename"]

        listed = await client.get(f"/api/import/vehicles/{vin}/backups", headers=auth_headers)
        assert name in [b["filename"] for b in listed.json()["backups"]]

        download = await client.get(
            f"/api/import/vehicles/{vin}/backups/{name}", headers=auth_headers
        )
        assert download.status_code == 200
        assert download.json()["vehicle"]["vin"] == vin

    @pytest.mark.parametrize("name", ["../secret.key", "OTHERVIN-x-20260101-000000.json"])
    async def test_a_name_outside_this_vehicles_backups_is_not_found(
        self, client: AsyncClient, auth_headers, test_vehicle, name
    ):
        response = await client.get(
            f"/api/import/vehicles/{test_vehicle['vin']}/backups/{name}", headers=auth_headers
        )
        assert response.status_code == 404

    async def test_nothing_is_imported_when_the_backup_fails(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session, monkeypatch
    ):
        from app.services import vehicle_backup

        async def failing_backup(*_args, **_kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(vehicle_backup, "write_vehicle_backup", failing_backup)
        vin = test_vehicle["vin"]
        tag, repairs = _unique_repairs()
        response = await _post(
            client, auth_headers, vin, [("b.csv", repairs)], record_type=["repair"]
        )
        assert response.status_code == 500
        assert "nothing was imported" in response.json()["detail"]
        await db_session.rollback()
        visits = (
            await db_session.execute(
                select(ServiceLineItem.description)
                .join(ServiceVisit, ServiceVisit.id == ServiceLineItem.visit_id)
                .where(ServiceVisit.vin == vin, ServiceLineItem.description.like(f"%{tag}"))
            )
        ).all()
        assert visits == []
