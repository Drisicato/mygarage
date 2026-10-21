"""Every import previews (dry_run) and backs the vehicle up before it writes;
the supplies CSV export/import and LubeLogger supplies."""

import csv
import io
import json
import uuid
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.models import Note
from app.models.supply import Supply, SupplyPurchase

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest.fixture(autouse=True)
def _reset_import_rate_limit():
    from app.routes.export import limiter as export_limiter
    from app.routes.import_data import limiter

    for each in (limiter, export_limiter):
        storage = each._storage
        storage.storage.clear()
        storage.expirations.clear()


async def _upload(client, headers, vin, route, body, **form):
    return await client.post(
        f"/api/import/vehicles/{vin}/{route}",
        headers=headers,
        files={"file": ("upload.csv", body.encode(), "text/csv")},
        data={"skip_duplicates": "true", **form},
    )


def _backup_file(name: str):
    return settings.data_dir / "backups" / "vehicles" / name


class TestPreviewAndBackup:
    async def test_a_preview_reports_the_import_and_writes_nothing(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        vin = test_vehicle["vin"]
        title = f"Preview {uuid.uuid4().hex[:8]}"
        body = f"Date,Title,Content\n2027-01-01,{title},x\nnot a date,Bad,y\n"
        response = await _upload(client, auth_headers, vin, "notes/csv", body, dry_run="true")
        assert response.status_code == 200, response.text
        data = response.json()
        assert (data["dry_run"], data["backup_filename"]) == (True, None)
        assert (data["success_count"], data["error_count"]) == (1, 1)
        stored = await db_session.execute(select(Note).where(Note.title == title))
        assert stored.scalars().first() is None

    async def test_an_import_saves_a_backup_first(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        vin = test_vehicle["vin"]
        title = f"Backed up {uuid.uuid4().hex[:8]}"
        body = f"Date,Title,Content\n2027-01-02,{title},x\n"
        response = await _upload(client, auth_headers, vin, "notes/csv", body)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["dry_run"] is False
        assert data["backup_filename"].startswith(f"{vin}-before-import-")

        saved = json.loads(_backup_file(data["backup_filename"]).read_text(encoding="utf-8"))
        assert saved["vehicle"]["vin"] == vin
        assert "supplies" in saved
        # Taken before the rows were written.
        assert not any(n.get("title") == title for n in saved.get("notes", []))
        stored = await db_session.execute(select(Note).where(Note.title == title))
        assert stored.scalars().first() is not None

    async def test_nothing_is_imported_when_the_backup_fails(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session, monkeypatch
    ):
        from app.services import vehicle_backup

        async def failing_backup(*_args, **_kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(vehicle_backup, "write_vehicle_backup", failing_backup)
        title = f"Never {uuid.uuid4().hex[:8]}"
        response = await _upload(
            client,
            auth_headers,
            test_vehicle["vin"],
            "notes/csv",
            f"Date,Title,Content\n2027-01-03,{title},x\n",
        )
        assert response.status_code == 500
        await db_session.rollback()
        stored = await db_session.execute(select(Note).where(Note.title == title))
        assert stored.scalars().first() is None


class TestSuppliesCsv:
    async def test_import_creates_supplies_with_opening_stock_and_export_reads_them_back(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        vin = test_vehicle["vin"]
        tag = uuid.uuid4().hex[:8]
        body = (
            "Name,Part Number,Brand,Part Source,Barcode,Category,Unit,Shared,On Hand,"
            "Total Cost,Notes\n"
            f"Oil {tag},OIL-{tag},Mobil 1,Aftermarket,,Fluids,qt_us,no,5,30.00,synthetic\n"
            f"Filter {tag},FLT-{tag},,,,Filters,count,yes,2,,\n"
            f"Bad {tag},,,,,,barrels,no,1,,\n"
            f"Odd source {tag},,,used,,,count,no,1,,\n"
        )
        response = await _upload(client, auth_headers, vin, "supplies/csv", body)
        assert response.status_code == 200, response.text
        data = response.json()
        assert (data["success_count"], data["error_count"]) == (2, 2)

        oil = (
            await db_session.execute(select(Supply).where(Supply.name == f"Oil {tag}"))
        ).scalar_one()
        assert (oil.unit_type, oil.volume_unit, oil.vins) == ("volume", "qt_us", [vin])
        assert (oil.brand, oil.part_source) == ("Mobil 1", "aftermarket")
        filter_ = (
            await db_session.execute(select(Supply).where(Supply.name == f"Filter {tag}"))
        ).scalar_one()
        assert filter_.vins == []  # shared
        (purchase,) = (
            (
                await db_session.execute(
                    select(SupplyPurchase).where(SupplyPurchase.supply_id == oil.id)
                )
            )
            .scalars()
            .all()
        )
        # 5 US quarts is 4.732 L.
        assert (purchase.quantity, purchase.total_cost) == (Decimal("4.732"), Decimal("30.00"))

        again = await _upload(client, auth_headers, vin, "supplies/csv", body)
        assert (again.json()["success_count"], again.json()["skipped_count"]) == (0, 2)

        exported = await client.get(
            f"/api/export/vehicles/{vin}/supplies/csv", headers=auth_headers
        )
        assert exported.status_code == 200
        rows = {r["Name"]: r for r in csv.DictReader(io.StringIO(exported.text))}
        assert rows[f"Oil {tag}"]["Unit"] == "qt_us"
        assert Decimal(rows[f"Oil {tag}"]["On Hand"]) == pytest.approx(Decimal("5"), abs=0.001)
        assert rows[f"Oil {tag}"]["Shared"] == "no"
        assert rows[f"Oil {tag}"]["Total Cost"] == "30.00"
        assert rows[f"Oil {tag}"]["Brand"] == "Mobil 1"
        assert rows[f"Oil {tag}"]["Part Source"] == "aftermarket"
        assert rows[f"Filter {tag}"]["Part Source"] == ""
        assert rows[f"Filter {tag}"]["Shared"] == "yes"


def _lubelogger_supplies(tag: str) -> str:
    return (
        "Date,PartNumber,PartSupplier,PartQuantity,Description,Cost,Notes,Tags\n"
        f"9/19/2025,OIL-{tag},Costco,5,Oil {tag},$27.99,,\n"
        f"9/19/2025,OIL-{tag},Costco,5,Oil {tag},$27.99,,\n"
        f"10/2/2025,FLT-{tag},RockAuto,2,Filter {tag},$12.333,,\n"
        f"10/3/2025,,,0,Used up {tag},$5.00,,\n"
    )


class TestLubeLoggerSupplies:
    async def _post(self, client, headers, vin, body, **form):
        return await client.post(
            f"/api/import/vehicles/{vin}/lubelogger",
            headers=headers,
            files=[("file", ("supplies.csv", body.encode(), "text/csv"))],
            data={"distance_unit": "mi", "fuel_unit": "gal_us", "date_order": "mdy", **form},
        )

    async def test_the_preview_lists_each_supply_and_writes_nothing(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        tag = uuid.uuid4().hex[:8]
        response = await self._post(
            client, auth_headers, test_vehicle["vin"], _lubelogger_supplies(tag), dry_run="true"
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["dry_run"] is True
        (file,) = data["files"]
        assert (file["record_type"], file["success_count"], file["ignored_count"]) == (
            "supply",
            3,
            1,
        )
        oil, filter_ = file["supplies"]
        assert (oil["name"], oil["row_count"], oil["quantity"], oil["unit"]) == (
            f"Oil {tag}",
            2,
            10,
            "count",
        )
        assert filter_["key"] == f"flt-{tag}|filter {tag}"
        found = await db_session.execute(select(Supply).where(Supply.name.like(f"%{tag}")))
        assert found.scalars().first() is None

    async def test_imports_in_the_picked_units_and_a_reimport_skips(
        self, client: AsyncClient, auth_headers, test_vehicle, db_session
    ):
        vin = test_vehicle["vin"]
        tag = uuid.uuid4().hex[:8]
        units = json.dumps({f"oil-{tag}|oil {tag}": "qt_us"})
        response = await self._post(
            client, auth_headers, vin, _lubelogger_supplies(tag), supply_units=units
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert (data["success_count"], data["supplies_created"]) == (3, 2)
        assert data["backup_filename"].startswith(f"{vin}-before-lubelogger-import-")

        oil = (
            await db_session.execute(select(Supply).where(Supply.name == f"Oil {tag}"))
        ).scalar_one()
        assert (oil.unit_type, oil.volume_unit, oil.vins) == ("volume", "qt_us", [vin])
        purchases = (
            (
                await db_session.execute(
                    select(SupplyPurchase).where(SupplyPurchase.supply_id == oil.id)
                )
            )
            .scalars()
            .all()
        )
        # Two identical rows in one export are two purchases.
        assert [p.quantity for p in purchases] == [Decimal("4.732"), Decimal("4.732")]
        assert purchases[0].notes == "Supplier: Costco"

        again = await self._post(
            client, auth_headers, vin, _lubelogger_supplies(tag), supply_units=units
        )
        assert (again.json()["success_count"], again.json()["skipped_count"]) == (0, 3)

    async def test_an_unknown_unit_is_refused(
        self, client: AsyncClient, auth_headers, test_vehicle
    ):
        response = await self._post(
            client,
            auth_headers,
            test_vehicle["vin"],
            _lubelogger_supplies("x"),
            supply_units=json.dumps({"x": "barrels"}),
        )
        assert response.status_code == 400
