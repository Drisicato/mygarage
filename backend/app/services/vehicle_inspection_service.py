"""Vehicle inspection business logic: the checklist, wheel readings, photos and repair hand-off."""

import logging
import uuid
from collections import Counter
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.vehicle_inspection import (
    VehicleInspection,
    VehicleInspectionCorner,
    VehicleInspectionItem,
    VehicleInspectionPhoto,
)
from app.schemas.planned_repair import PlannedRepairCreate
from app.schemas.vehicle_inspection import (
    InspectionCornerInput,
    InspectionItemInput,
    InspectionStatusCounts,
    VehicleInspectionCreate,
    VehicleInspectionResponse,
    VehicleInspectionUpdate,
)
from app.services.planned_repair_service import PlannedRepairService
from app.utils.logging_utils import sanitize_for_log
from app.utils.path_validation import validate_path_within_base
from app.utils.photo_encoding import encode_photo

logger = logging.getLogger(__name__)

MAX_PHOTOS_PER_INSPECTION = 12

#: Planned repair priority for each status that warrants one.
_REPAIR_PRIORITY = {"red": "high", "yellow": "medium"}

#: English wheel names for a planned repair's description.
_WHEEL_NAMES = {"lf": "left front", "rf": "right front", "lr": "left rear", "rr": "right rear"}

_CORNER_FIELDS = (
    "tread_status",
    "tread_depth_mm",
    "brake_status",
    "brake_pad_mm",
)


def _load_options():
    return (
        selectinload(VehicleInspection.items),
        selectinload(VehicleInspection.corners),
        selectinload(VehicleInspection.photos),
    )


def _unlink_photo(file_path: str) -> None:
    """Best-effort removal of a stored photo; call only after the DB commit."""
    try:
        VehicleInspectionService.photo_file(file_path).unlink(missing_ok=True)
    except OSError, HTTPException:
        logger.warning("Could not remove inspection photo %s", sanitize_for_log(file_path))


class VehicleInspectionService:
    """Reads and writes one vehicle's inspections. Access is checked by the route."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_inspections(self, vin: str) -> list[VehicleInspection]:
        result = await self.db.execute(
            select(VehicleInspection)
            .where(VehicleInspection.vin == vin)
            .options(*_load_options())
            .order_by(VehicleInspection.date.desc(), VehicleInspection.id.desc())
        )
        return list(result.scalars().all())

    async def get_inspection(self, vin: str, inspection_id: int) -> VehicleInspection:
        result = await self.db.execute(
            select(VehicleInspection)
            .where(VehicleInspection.id == inspection_id, VehicleInspection.vin == vin)
            .options(*_load_options())
            .execution_options(populate_existing=True)
        )
        inspection = result.scalar_one_or_none()
        if inspection is None:
            raise HTTPException(status_code=404, detail="Inspection not found")
        return inspection

    async def create_inspection(self, vin: str, data: VehicleInspectionCreate) -> VehicleInspection:
        inspection = VehicleInspection(
            vin=vin,
            **data.model_dump(exclude={"items", "corners"}),
            items=[VehicleInspectionItem(**i.model_dump()) for i in data.items],
            corners=[VehicleInspectionCorner(**c.model_dump()) for c in data.corners],
        )
        self.db.add(inspection)
        await self.db.flush()
        inspection_id = inspection.id
        await self.db.commit()
        return await self.get_inspection(vin, inspection_id)

    async def update_inspection(
        self, vin: str, inspection_id: int, data: VehicleInspectionUpdate
    ) -> VehicleInspection:
        inspection = await self.get_inspection(vin, inspection_id)
        # An omitted field keeps its value and an explicit null clears it.
        for field, value in data.model_dump(
            exclude_unset=True, exclude={"items", "corners"}
        ).items():
            setattr(inspection, field, value)
        if "items" in data.model_fields_set:
            self._replace_items(inspection, data.items or [])
        if "corners" in data.model_fields_set:
            self._replace_corners(inspection, data.corners or [])
        await self.db.commit()
        return await self.get_inspection(vin, inspection_id)

    @staticmethod
    def _replace_items(inspection: VehicleInspection, items: list[InspectionItemInput]) -> None:
        """Make the stored items exactly ``items``. A key that stays keeps its row,
        so its planned repair link survives an edit; rows are updated in place
        rather than swapped, which the (inspection, key) unique would refuse."""
        existing = {item.item_key: item for item in inspection.items}
        wanted = {i.item_key: i for i in items}
        inspection.items = [item for item in inspection.items if item.item_key in wanted]
        for key, given in wanted.items():
            row = existing.get(key)
            if row is None:
                inspection.items.append(VehicleInspectionItem(**given.model_dump()))
            else:
                row.status = given.status
                row.note = given.note

    @staticmethod
    def _replace_corners(
        inspection: VehicleInspection, corners: list[InspectionCornerInput]
    ) -> None:
        """Make the stored corners exactly ``corners``, updating rows in place by position."""
        existing = {corner.position: corner for corner in inspection.corners}
        wanted = {c.position: c for c in corners}
        inspection.corners = [c for c in inspection.corners if c.position in wanted]
        for position, given in wanted.items():
            row = existing.get(position)
            if row is None:
                inspection.corners.append(VehicleInspectionCorner(**given.model_dump()))
            else:
                for field in _CORNER_FIELDS:
                    setattr(row, field, getattr(given, field))

    async def delete_inspection(self, vin: str, inspection_id: int) -> None:
        """Delete an inspection and its photos. Planned repairs made from it stay."""
        inspection = await self.get_inspection(vin, inspection_id)
        photo_paths = [p.file_path for p in inspection.photos]
        await self.db.delete(inspection)
        await self.db.commit()
        for path in photo_paths:
            _unlink_photo(path)

    async def create_repair_from_item(
        self, vin: str, inspection_id: int, item_key: str, title: str
    ) -> VehicleInspection:
        """Turn a red or yellow checklist point into a planned repair and link it.

        409 when the point already has one; deleting that repair clears the link
        (ON DELETE SET NULL), so a new one can be made then.
        """
        inspection = await self.get_inspection(vin, inspection_id)
        item = next((i for i in inspection.items if i.item_key == item_key), None)
        if item is None:
            raise HTTPException(status_code=404, detail="Inspection item not found")
        if item.planned_repair_id is not None:
            raise HTTPException(
                status_code=409, detail="A planned repair was already created for this item"
            )
        priority = _REPAIR_PRIORITY.get(item.status)
        if priority is None:
            raise HTTPException(
                status_code=400,
                detail="Only items needing attention (red or yellow) become planned repairs",
            )

        lines = [item.note] if item.note else []
        lines.append(f"From the inspection on {inspection.date.isoformat()}.")
        repair = await PlannedRepairService(self.db).create_repair(
            vin,
            PlannedRepairCreate(
                title=title,
                description="\n\n".join(lines),
                priority=priority,
                service_category="Inspection",
            ),
        )

        inspection = await self.get_inspection(vin, inspection_id)
        item = next(i for i in inspection.items if i.item_key == item_key)
        item.planned_repair_id = repair.id
        await self.db.commit()
        return await self.get_inspection(vin, inspection_id)

    async def create_repair_from_corner(
        self, vin: str, inspection_id: int, position: str, reading: str, title: str
    ) -> VehicleInspection:
        """Turn a red tire (tread) or brake pad on one wheel into a planned repair and link it.

        409 when that reading already has one, 400 unless it's red, 404 when the
        wheel has no readings. Deleting the repair clears the link.
        """
        inspection = await self.get_inspection(vin, inspection_id)
        corner = next((c for c in inspection.corners if c.position == position), None)
        if corner is None:
            raise HTTPException(status_code=404, detail="No readings for that wheel")
        link = f"{reading}_repair_id"
        if getattr(corner, link) is not None:
            raise HTTPException(
                status_code=409, detail="A planned repair was already created for this reading"
            )
        status = corner.tread_status if reading == "tread" else corner.brake_status
        if status != "red":
            raise HTTPException(
                status_code=400,
                detail="Only a tire or brake pad needing immediate attention becomes a planned repair",
            )

        measured = corner.tread_depth_mm if reading == "tread" else corner.brake_pad_mm
        what = "Tread depth" if reading == "tread" else "Brake pad"
        wheel = _WHEEL_NAMES.get(position, position)
        lines = [f"{what} at the {wheel}" + (f": {measured} mm." if measured is not None else ".")]
        lines.append(f"From the inspection on {inspection.date.isoformat()}.")
        repair = await PlannedRepairService(self.db).create_repair(
            vin,
            PlannedRepairCreate(
                title=title,
                description="\n\n".join(lines),
                priority="high",
                service_category="Inspection",
            ),
        )

        inspection = await self.get_inspection(vin, inspection_id)
        corner = next(c for c in inspection.corners if c.position == position)
        setattr(corner, link, repair.id)
        await self.db.commit()
        return await self.get_inspection(vin, inspection_id)

    # ---- photos ---------------------------------------------------------------

    @staticmethod
    def photo_file(file_path: str) -> Path:
        """Absolute, validated location of a stored inspection photo."""
        return validate_path_within_base(
            settings.photos_dir / file_path, settings.photos_dir, raise_error=True
        )

    async def add_photo(
        self, vin: str, inspection_id: int, contents: bytes
    ) -> VehicleInspectionPhoto:
        """Store ``contents`` as a size-capped JPEG on the inspection."""
        inspection = await self.get_inspection(vin, inspection_id)
        if len(inspection.photos) >= MAX_PHOTOS_PER_INSPECTION:
            raise HTTPException(
                status_code=400,
                detail=f"An inspection holds at most {MAX_PHOTOS_PER_INSPECTION} photos",
            )
        image = encode_photo(contents)

        relative = f"{vin}/inspections/{inspection_id}-{uuid.uuid4().hex[:8]}.jpg"
        destination = self.photo_file(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, format="JPEG", quality=88)

        photo = VehicleInspectionPhoto(inspection_id=inspection_id, file_path=relative)
        self.db.add(photo)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            _unlink_photo(relative)
            raise
        await self.db.refresh(photo)
        return photo

    async def get_photo(
        self, vin: str, inspection_id: int, photo_id: int
    ) -> VehicleInspectionPhoto:
        await self.get_inspection(vin, inspection_id)  # 404 unless it's this vehicle's
        result = await self.db.execute(
            select(VehicleInspectionPhoto).where(
                VehicleInspectionPhoto.id == photo_id,
                VehicleInspectionPhoto.inspection_id == inspection_id,
            )
        )
        photo = result.scalar_one_or_none()
        if photo is None:
            raise HTTPException(status_code=404, detail="Photo not found")
        return photo

    async def delete_photo(self, vin: str, inspection_id: int, photo_id: int) -> None:
        photo = await self.get_photo(vin, inspection_id, photo_id)
        file_path = photo.file_path
        await self.db.delete(photo)
        await self.db.commit()
        _unlink_photo(file_path)


def _counts(inspection: VehicleInspection) -> InspectionStatusCounts:
    """Tally every checklist point plus each wheel's tread and brake bands."""
    statuses = Counter(item.status for item in inspection.items)
    for corner in inspection.corners:
        statuses[corner.tread_status] += 1
        statuses[corner.brake_status] += 1
    return InspectionStatusCounts(
        green=statuses["green"],
        yellow=statuses["yellow"],
        red=statuses["red"],
        not_inspected=statuses["not_inspected"],
    )


def to_response(inspection: VehicleInspection) -> VehicleInspectionResponse:
    response = VehicleInspectionResponse.model_validate(inspection)
    response.counts = _counts(inspection)
    return response
