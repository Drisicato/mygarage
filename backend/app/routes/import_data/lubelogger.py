"""The LubeLogger CSV import, and the backups every import takes before it writes."""

# pyright: reportPrivateUsage=false

import json
import logging
from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, cast

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import ServiceLineItem, ServiceVisit
from app.models.supply import Supply, SupplyPurchase, SupplyVehicle
from app.models.user import User
from app.routes.import_data._common import (
    ImportResult,
    _begin_import,
    _end_import,
    _import_response,
    _RowError,
    _within_api_bounds,
    limiter,
    router,
)
from app.routes.import_data._matching import _last_id_before_import, _odometer_matches
from app.routes.import_data.third_party import _write_parsed_fuel
from app.schemas.service_visit import ServiceLineItemCreate, ServiceVisitCreate
from app.schemas.supply import SupplyPurchaseCreate
from app.services import maintenance_service
from app.services.auth import get_vehicle_or_403, require_auth
from app.utils.file_validation import validate_csv_upload
from app.utils.logging_utils import sanitize_for_log
from app.utils.maintenance_types import classify

logger = logging.getLogger(__name__)

#: Files one LubeLogger import takes at once (it exports one CSV per record type).
_LUBELOGGER_MAX_FILES = 10
_LUBELOGGER_KINDS = ("auto", "fuel", "service", "repair", "upgrade", "supply")
_LUBELOGGER_BACKUP_REASON = "before-lubelogger-import"


def _lubelogger_options(
    distance_unit: str, fuel_unit: str, date_order: str, decimal_separator: str
):
    """LubeLoggerOptions from form input, rejecting anything off-vocabulary."""
    from app.services.import_adapters.lubelogger import LubeLoggerOptions

    allowed = {
        "distance_unit": (distance_unit, ("mi", "km")),
        "fuel_unit": (fuel_unit, ("gal_us", "gal_uk", "l")),
        "date_order": (date_order, ("mdy", "dmy", "ymd")),
        "decimal_separator": (decimal_separator, ("dot", "comma")),
    }
    for name, (value, choices) in allowed.items():
        if value not in choices:
            raise HTTPException(
                status_code=400, detail=f"{name} must be one of {', '.join(choices)}"
            )
    return LubeLoggerOptions(
        distance_unit=cast(Any, distance_unit),
        fuel_unit=cast(Any, fuel_unit),
        date_order=cast(Any, date_order),
        decimal_separator=cast(Any, decimal_separator),
    )


def _preview_value(value: Any) -> Any:
    if isinstance(value, date_type):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


async def _write_lubelogger_service(
    vin: str,
    rows: list[dict[str, Any]],
    skip_duplicates: bool,
    db: AsyncSession,
    import_result: ImportResult,
    *,
    odometer_converted: bool,
    last_id: int,
) -> int:
    """Write one service visit with one line item per LubeLogger row, without
    committing. Returns how many visits it wrote.

    A duplicate is the same date, the same odometer and the same description:
    LubeLogger keeps each job a separate record, so two jobs on one day at one
    reading are two rows, not one repeated.
    """
    written = 0
    for row in rows:
        row_num = row["_row"]
        try:
            odometer_km = row["odometer_km"]
            cost = row["cost"]
            _within_api_bounds(ServiceVisitCreate, odometer_km=odometer_km)
            _within_api_bounds(ServiceLineItemCreate, cost=cost)
            if skip_duplicates:
                existing = await db.execute(
                    select(ServiceVisit.id)
                    .join(ServiceLineItem, ServiceLineItem.visit_id == ServiceVisit.id)
                    .where(
                        ServiceVisit.vin == vin,
                        ServiceVisit.date == row["date"],
                        _odometer_matches(
                            ServiceVisit,
                            odometer_km,
                            converted=odometer_converted,
                            last_id_before_import=last_id,
                        ),
                        ServiceLineItem.description == row["description"],
                    )
                    .limit(1)
                )
                if existing.scalars().first():
                    import_result.add_skip()
                    continue
            async with db.begin_nested():
                visit = ServiceVisit(
                    vin=vin,
                    date=row["date"],
                    odometer_km=odometer_km,
                    service_category=row["category"],
                    notes=row["notes"],
                    total_cost=cost or Decimal("0"),
                )
                db.add(visit)
                await db.flush()
                db.add(
                    ServiceLineItem(
                        visit_id=visit.id,
                        description=row["description"],
                        category=row["category"],
                        maintenance_type=classify(row["description"]),
                        cost=cost or Decimal("0"),
                    )
                )
                await db.flush()
            import_result.add_success()
            written += 1
        except _RowError as e:
            import_result.add_error(row_num, e.reason)
        except Exception as e:
            logger.error(
                "LubeLogger service import row %d failed: %s", row_num, sanitize_for_log(e)
            )
            import_result.add_error(row_num, "Invalid service record data")
    return written


def _lubelogger_supply_units(raw: str | None) -> dict[str, str]:
    """The per-supply unit picks (``{supply key: unit}``), rejecting anything off-vocabulary."""
    from app.services.supply_import import SUPPLY_UNITS

    if not raw:
        return {}
    try:
        units = json.loads(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="supply_units must be a JSON object") from e
    if not isinstance(units, dict) or not all(
        isinstance(k, str) and v in SUPPLY_UNITS for k, v in units.items()
    ):
        raise HTTPException(
            status_code=400,
            detail=f"supply_units must map each supply to one of {', '.join(SUPPLY_UNITS)}",
        )
    return units


def _lubelogger_supply_unit(match: Supply | None, chosen: str | None) -> str:
    """What an imported supply's quantity counts.

    A count supply already in MyGarage stays a count whatever was picked (its
    ledger can't hold litres); a volume one takes the picked volume unit, else
    its own. A new supply is what was picked, else a count.
    """
    from app.services.supply_import import SUPPLY_LITRES_PER, unit_of

    if match is None:
        return chosen or "count"
    if match.unit_type == "count":
        return "count"
    return chosen if chosen in SUPPLY_LITRES_PER else unit_of(match)


def _lubelogger_supply_preview(
    rows: list[dict[str, Any]], candidates: list[Supply]
) -> list[dict[str, Any]]:
    """Each supply a Supplies file holds, what it joins, and the unit it would import in."""
    from app.services.supply_import import match_supply, supply_key

    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = supply_key(row["name"], row["part_number"])
        group = groups.get(key)
        if group is None:
            match = match_supply(candidates, row["name"], row["part_number"])
            group = groups[key] = {
                "key": key,
                "name": row["name"],
                "part_number": row["part_number"],
                "row_count": 0,
                "quantity": Decimal("0"),
                "existing_supply_id": match.id if match else None,
                "existing_supply_name": match.name if match else None,
                "existing_unit_type": match.unit_type if match else None,
                "unit": _lubelogger_supply_unit(match, None),
            }
        group["row_count"] += 1
        group["quantity"] += row["quantity"]
    return [{k: _preview_value(v) for k, v in g.items()} for g in groups.values()]


async def _write_lubelogger_supplies(
    vin: str,
    rows: list[dict[str, Any]],
    skip_duplicates: bool,
    db: AsyncSession,
    import_result: ImportResult,
    *,
    candidates: list[Supply],
    units: dict[str, str],
    created: dict[str, Supply],
    current_user: User | None,
    last_id: int,
) -> None:
    """Write one supply purchase per LubeLogger row, without committing.

    A row joins the supply it matches (``match_supply``) or one this import
    creates, linked to this vehicle as LubeLogger's per-vehicle supplies were.
    ``created`` carries those across files, so a supply in two exports is
    created once. A duplicate is a purchase stored before this import (id at
    most ``last_id``) of the same supply, on the same date, of the same
    quantity, for the same cost: two identical rows in one export are two
    purchases.
    """
    from app.services.supply_import import match_supply, supply_key, to_canonical

    for row in rows:
        row_num = row["_row"]
        try:
            key = supply_key(row["name"], row["part_number"])
            supply = created.get(key) or match_supply(candidates, row["name"], row["part_number"])
            unit = _lubelogger_supply_unit(supply, units.get(key))
            quantity = to_canonical(row["quantity"], unit)
            if quantity == 0:
                raise _RowError("the quantity is below the smallest storable amount (0.001)")
            cost = row["cost"]
            # LubeLogger takes a used share off the cost, leaving fractions of a cent.
            if cost is not None:
                cost = cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            _within_api_bounds(SupplyPurchaseCreate, quantity=quantity, total_cost=cost)

            if supply is None:
                supply = Supply(
                    name=row["name"],
                    part_number=row["part_number"],
                    unit_type="count" if unit == "count" else "volume",
                    volume_unit=None if unit == "count" else unit,
                    created_by_user_id=current_user.id if current_user else None,
                    vehicle_links=[SupplyVehicle(vin=vin)],
                )
                async with db.begin_nested():
                    db.add(supply)
                    await db.flush()
                created[key] = supply
            elif skip_duplicates:
                existing = await db.execute(
                    select(SupplyPurchase.id)
                    .where(
                        SupplyPurchase.id <= last_id,
                        SupplyPurchase.supply_id == supply.id,
                        SupplyPurchase.date == row["date"],
                        SupplyPurchase.quantity == quantity,
                        SupplyPurchase.total_cost.is_(None)
                        if cost is None
                        else SupplyPurchase.total_cost == cost,
                    )
                    .limit(1)
                )
                if existing.scalars().first():
                    import_result.add_skip()
                    continue
            async with db.begin_nested():
                db.add(
                    SupplyPurchase(
                        supply_id=supply.id,
                        date=row["date"],
                        quantity=quantity,
                        total_cost=cost,
                        part_number=row["part_number"],
                        notes=row["notes"],
                    )
                )
                await db.flush()
            import_result.add_success()
        except _RowError as e:
            import_result.add_error(row_num, e.reason)
        except Exception as e:
            logger.error("LubeLogger supply import row %d failed: %s", row_num, sanitize_for_log(e))
            import_result.add_error(row_num, "Invalid supply record data")


@router.post("/vehicles/{vin}/lubelogger")
@limiter.limit(settings.rate_limit_uploads)
async def import_lubelogger_csv(
    request: Request,
    vin: str,
    file: list[UploadFile] = File(...),
    record_type: list[str] | None = Form(None),
    distance_unit: str = Form("mi"),
    fuel_unit: str = Form("gal_us"),
    date_order: str = Form("mdy"),
    decimal_separator: str = Form("dot"),
    supply_units: str | None = Form(None),
    skip_duplicates: bool = Form(True),
    dry_run: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(require_auth),
):
    """Import LubeLogger CSV exports: Fuel, Service / Repair / Upgrade, and Supplies.

    One or more files (LubeLogger exports one per record type). ``record_type``,
    one per file in the same order, says which of service, repair or upgrade a
    service-like file is (they share one header); ``auto`` or leaving it out
    reads fuel as fuel, supplies as supplies and the rest as service. The
    export carries no units and follows its server's locale, so the four
    options declare how to read it. A supply's quantity has no unit either:
    ``supply_units`` is a JSON object of each supply's ``key`` (from the
    preview's ``supplies``) to ``count`` or a supply volume unit; a supply
    left out imports as a count, or in the unit of the supply it joins.

    Every file is read first (a file that isn't a supported export fails the
    request before anything is written). Then, like every import, the vehicle
    is locked and, unless ``dry_run``, backed up; the rows are written, all
    files in one transaction, and committed, or for ``dry_run`` rolled back,
    so a preview reports what the import would.
    """
    from app.services.import_adapters.lubelogger import LubeLoggerFileError, parse_lubelogger
    from app.services.supply_import import supplies_usable_on

    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    opts = _lubelogger_options(distance_unit, fuel_unit, date_order, decimal_separator)
    units = _lubelogger_supply_units(supply_units)
    if len(file) > _LUBELOGGER_MAX_FILES:
        raise HTTPException(
            status_code=400, detail=f"At most {_LUBELOGGER_MAX_FILES} files per import"
        )
    kinds = list(record_type or [])
    if kinds and len(kinds) != len(file):
        raise HTTPException(status_code=400, detail="Give one record_type per file, or none")
    if any(k not in _LUBELOGGER_KINDS for k in kinds):
        raise HTTPException(
            status_code=400, detail=f"record_type must be one of {', '.join(_LUBELOGGER_KINDS)}"
        )

    parsed_files = []
    for index, upload in enumerate(file):
        name = upload.filename or f"file {index + 1}"
        csv_data = await validate_csv_upload(upload)
        kind = kinds[index] if kinds else "auto"
        try:
            parsed = parse_lubelogger(csv_data, opts, None if kind == "auto" else cast(Any, kind))
        except LubeLoggerFileError as e:
            raise HTTPException(status_code=400, detail=f"{name}: {e.reason}") from e
        parsed_files.append((name, parsed))

    backup = await _begin_import(db, vin, current_user, dry_run, _LUBELOGGER_BACKUP_REASON)

    has_supplies = any(parsed.kind == "supply" for _name, parsed in parsed_files)
    candidates = await supplies_usable_on(db, vin) if has_supplies else []
    created_supplies: dict[str, Supply] = {}
    odometer_converted = opts.distance_unit == "mi"
    service_last_id = await _last_id_before_import(db, ServiceVisit)
    supply_last_id = await _last_id_before_import(db, SupplyPurchase)
    results = []
    wrote_services = False
    for name, parsed in parsed_files:
        result = ImportResult()
        for row_num, reason in parsed.errors:
            result.add_error(row_num, reason)
        if parsed.kind == "fuel":
            await _write_parsed_fuel(vin, parsed.rows, skip_duplicates, db, result)
        elif parsed.kind == "supply":
            await _write_lubelogger_supplies(
                vin,
                parsed.rows,
                skip_duplicates,
                db,
                result,
                candidates=candidates,
                units=units,
                created=created_supplies,
                current_user=current_user,
                last_id=supply_last_id,
            )
        else:
            written = await _write_lubelogger_service(
                vin,
                parsed.rows,
                skip_duplicates,
                db,
                result,
                odometer_converted=odometer_converted,
                last_id=service_last_id,
            )
            wrote_services = wrote_services or written > 0
        date_range = parsed.date_range
        results.append(
            {
                "filename": name,
                "record_type": parsed.kind,
                **result.to_dict(),
                "row_count": len(parsed.rows),
                "electric": parsed.electric,
                "ignored_count": parsed.ignored,
                "date_from": date_range[0].isoformat() if date_range else None,
                "date_to": date_range[1].isoformat() if date_range else None,
                "sample": [
                    {k: _preview_value(v) for k, v in row.items() if not k.startswith("_")}
                    for row in parsed.rows[:3]
                ],
                "supplies": (
                    _lubelogger_supply_preview(parsed.rows, candidates)
                    if parsed.kind == "supply"
                    else []
                ),
            }
        )

    await _end_import(db, dry_run)
    if not dry_run and wrote_services:
        # Imported services may be the newest of a rule's type: reconcile once
        # per upload (own lock, own commit), never per row.
        await maintenance_service.reconcile_vehicle(db, vin)

    totals = {
        key: sum(int(r[key]) for r in results)
        for key in ("success_count", "error_count", "skipped_count", "total_processed")
    }
    return _import_response(
        {**totals, "files": results, "supplies_created": len(created_supplies)}, dry_run, backup
    )


@router.get("/vehicles/{vin}/backups")
async def list_vehicle_import_backups(
    vin: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(require_auth),
):
    """The backups imports took of this vehicle before writing, newest first."""
    from app.services.vehicle_backup import list_vehicle_backups

    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    return {"backups": list_vehicle_backups(vin)}


@router.get("/vehicles/{vin}/backups/{filename}")
async def download_vehicle_import_backup(
    vin: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(require_auth),
):
    """Download one of this vehicle's pre-import backups."""
    from fastapi.responses import FileResponse

    from app.services.vehicle_backup import vehicle_backup_path

    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    path = vehicle_backup_path(vin, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(path, media_type="application/json", filename=path.name)
