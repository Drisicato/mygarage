"""Per-vehicle JSON backups an import takes before it writes.

The file is the vehicle's JSON export (``build_vehicle_export``), the same one
the vehicle page downloads, so it can be inspected or re-imported through
``POST /api/import/vehicles/{vin}/json``. Like that export it is not a full
restore: a service visit keeps its first line item, and tax, warranties,
reminders and media are not in it. The whole-instance backups in Settings >
Backup are. It also carries a ``supplies`` key: the supplies the vehicle can
use, with their purchase and usage ledgers, because supplies imports write
to them and the vehicle export doesn't include them.

They live in ``<data_dir>/backups/vehicles/``, a folder of their own: the
settings-backup routes treat every ``.json`` in ``<data_dir>/backups`` as a
settings backup, and would offer to restore one of these as instance settings.
Read and written per vehicle, by anyone who can access the vehicle, not only
admins.
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.supply import Supply
from app.models.vehicle import Vehicle

#: ``<VIN>-<reason>-<UTC yyyymmdd-hhmmss>[-n].json``
_NAME = re.compile(
    r"^(?P<vin>[A-Za-z0-9]{1,17})-(?P<reason>[a-z0-9-]+?)-\d{8}-\d{6}(?:-\d+)?\.json$"
)


def backup_dir() -> Path:
    """Read on each call: the tests point ``settings.data_dir`` elsewhere."""
    return settings.data_dir / "backups" / "vehicles"


async def write_vehicle_backup(db: AsyncSession, vehicle: Vehicle, reason: str) -> str:
    """Write the vehicle's JSON export to disk and return the file name.

    Written to a temporary name and moved into place, so a file under the final
    name is always complete. Raises on any failure; the caller must not go on
    to write the data it was protecting.
    """
    # Imported here: export.py's routes import from app.services.
    from app.routes.export import build_vehicle_export

    data: dict[str, Any] = await build_vehicle_export(db, vehicle)
    data["backup_reason"] = reason
    data["supplies"] = await supplies_snapshot(db, vehicle.vin)
    folder = backup_dir()
    folder.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    name = f"{vehicle.vin}-{reason}-{stamp}.json"
    n = 1
    while (folder / name).exists():
        n += 1
        name = f"{vehicle.vin}-{reason}-{stamp}-{n}.json"

    target = folder / name
    partial = folder / f".{name}.partial"
    try:
        with open(partial, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(partial, target)
    finally:
        if partial.exists():
            partial.unlink()
    return name


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


async def supplies_snapshot(db: AsyncSession, vin: str) -> list[dict[str, Any]]:
    """The supplies this vehicle can use (its own and the shared ones), with
    their ledgers, as they stand. Supplies aren't part of the vehicle export,
    and a supplies import writes to them, so the backup carries them too."""
    supplies = (
        (
            await db.execute(
                select(Supply)
                .options(selectinload(Supply.purchases), selectinload(Supply.usages))
                .order_by(Supply.id)
            )
        )
        .scalars()
        .all()
    )
    columns = (
        "id",
        "name",
        "part_number",
        "brand",
        "part_source",
        "barcode",
        "category",
        "unit_type",
        "volume_unit",
        "is_active",
        "notes",
    )
    return [
        {
            **{c: _plain(getattr(s, c)) for c in columns},
            "vins": s.vins,
            "purchases": [
                {
                    c: _plain(getattr(p, c))
                    for c in ("id", "date", "quantity", "total_cost", "part_number", "notes")
                }
                for p in s.purchases
            ],
            "usages": [
                {
                    c: _plain(getattr(u, c))
                    for c in ("id", "quantity", "cost_snapshot", "service_line_item_id")
                }
                for u in s.usages
            ],
        }
        for s in supplies
        if s.usable_on(vin)
    ]


def list_vehicle_backups(vin: str) -> list[dict[str, Any]]:
    """This vehicle's backups, newest first."""
    folder = backup_dir()
    if not folder.is_dir():
        return []
    found = []
    for path in folder.glob(f"{vin}-*.json"):
        match = _NAME.match(path.name)
        if not match or match["vin"] != vin:
            continue
        stat = path.stat()
        found.append(
            {
                "filename": path.name,
                "reason": match["reason"],
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
            }
        )
    return sorted(found, key=lambda b: b["filename"], reverse=True)


def vehicle_backup_path(vin: str, filename: str) -> Path | None:
    """The backup's path, or None for a name that isn't one of this vehicle's backups.

    The name must match the pattern and name this VIN, and the file must sit
    directly in the backup folder: no path in the name reaches anything else.
    """
    match = _NAME.match(filename)
    if not match or match["vin"] != vin:
        return None
    path = backup_dir() / filename
    if path.parent != backup_dir() or not path.is_file():
        return None
    return path
