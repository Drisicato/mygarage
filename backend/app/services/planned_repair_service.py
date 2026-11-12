"""Planned repair business logic: the board's ordering and completion into service history."""

import logging
import shutil
import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.planned_repair import (
    PlannedRepair,
    PlannedRepairPart,
    PlannedRepairPhoto,
    PlannedRepairSystem,
)
from app.models.service_visit import ServiceVisit
from app.models.supply import Supply, SupplyPurchase, SupplyVehicle
from app.models.user import User
from app.schemas.planned_repair import (
    VEHICLE_SYSTEMS,
    CompletedPartInput,
    PlannedRepairComplete,
    PlannedRepairCreate,
    PlannedRepairMove,
    PlannedRepairPartInput,
    PlannedRepairResponse,
    PlannedRepairUpdate,
)
from app.schemas.service_visit import ServiceVisitCreate
from app.schemas.supply import SupplyUsageInput
from app.services import maintenance_service
from app.services.service_visit_service import ServiceVisitService
from app.services.supply_service import SupplyService
from app.services.vehicle_lock import lock_vehicle_for_write
from app.utils.logging_utils import sanitize_for_log
from app.utils.path_validation import validate_path_within_base
from app.utils.photo_encoding import PHOTO_MAX_SIDE  # noqa: F401 (re-exported)
from app.utils.photo_encoding import encode_photo as _encode_photo

logger = logging.getLogger(__name__)

MAX_PHOTOS_PER_REPAIR = 12

#: Board column order, so a list reads left to right.
_STATUS_ORDER = {"planning": 0, "in_progress": 1, "done": 2}


def _load_options():
    return (
        selectinload(PlannedRepair.parts).selectinload(PlannedRepairPart.supply),
        selectinload(PlannedRepair.vendor),
        selectinload(PlannedRepair.photos),
        selectinload(PlannedRepair.system_rows),
    )


_PART_FIELDS = (
    "kind",
    "description",
    "cost",
    "part_number",
    "quantity",
    "url",
    "supply_id",
    "supply_quantity",
)


def _parts(items: list[PlannedRepairPartInput]) -> list[PlannedRepairPart]:
    return [PlannedRepairPart(**{f: getattr(p, f) for f in _PART_FIELDS}) for p in items]


def _merge_parts(
    current: list[PlannedRepairPart], items: list[PlannedRepairPartInput]
) -> tuple[list[PlannedRepairPart], list[str]]:
    """The repair's parts after an update, and the pictures of the parts it drops.

    An item naming one of ``current`` by id updates that row in place, so its
    picture stays; any other item is a new part. A stored part no item names is
    dropped (delete-orphan), and its picture is returned for removal once the
    commit lands.
    """
    by_id = {part.id: part for part in current}
    kept: list[PlannedRepairPart] = []
    dropped: list[str] = []
    for item in items:
        part = by_id.pop(item.id, None) if item.id is not None else None
        if part is None:
            part = PlannedRepairPart()
        for field in _PART_FIELDS:
            setattr(part, field, getattr(item, field))
        if part.kind == "job" and part.image_path:
            # A job has no picture: a part moved to the jobs loses its own.
            dropped.append(part.image_path)
            part.image_path = None
        kept.append(part)
    dropped += [p.image_path for p in by_id.values() if p.image_path]
    return kept, dropped


def _systems(systems: list[str]) -> list[PlannedRepairSystem]:
    return [PlannedRepairSystem(system=s) for s in systems]


def _unlink_photos(file_paths: list[str]) -> None:
    for path in file_paths:
        _unlink_photo(path)


def _unlink_photo(file_path: str) -> None:
    """Best-effort removal of a stored photo; call only after the DB commit."""
    try:
        PlannedRepairService.photo_file(file_path).unlink(missing_ok=True)
    except OSError, HTTPException:
        logger.warning("Could not remove repair photo %s", sanitize_for_log(file_path))


class PlannedRepairService:
    """Reads and writes one vehicle's planned repairs. Access is checked by the route."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_repairs(self, vin: str) -> list[PlannedRepair]:
        result = await self.db.execute(
            select(PlannedRepair)
            .where(PlannedRepair.vin == vin)
            .options(*_load_options())
            .order_by(PlannedRepair.position, PlannedRepair.id)
        )
        repairs = list(result.scalars().all())
        repairs.sort(key=lambda r: _STATUS_ORDER.get(r.status, 99))
        return repairs

    async def get_repair(self, vin: str, repair_id: int) -> PlannedRepair:
        result = await self.db.execute(
            select(PlannedRepair)
            .where(PlannedRepair.id == repair_id, PlannedRepair.vin == vin)
            .options(*_load_options())
            .execution_options(populate_existing=True)
        )
        repair = result.scalar_one_or_none()
        if repair is None:
            raise HTTPException(status_code=404, detail="Planned repair not found")
        return repair

    async def _next_position(self, vin: str, status: str) -> int:
        result = await self.db.execute(
            select(func.max(PlannedRepair.position)).where(
                PlannedRepair.vin == vin, PlannedRepair.status == status
            )
        )
        current = result.scalar()
        return 0 if current is None else current + 1

    async def _linked_visit_exists(self, vin: str, repair: PlannedRepair) -> bool:
        if repair.service_visit_id is None:
            return False
        result = await self.db.execute(
            select(ServiceVisit.id).where(
                ServiceVisit.id == repair.service_visit_id, ServiceVisit.vin == vin
            )
        )
        return result.scalar_one_or_none() is not None

    async def _check_supplies(
        self, vin: str, items: list[PlannedRepairPartInput], already_linked: set[int]
    ) -> None:
        """A newly linked supply must be usable on this vehicle: active, and
        shared or pinned to it. One the repair already holds is left alone, so
        archiving a supply never blocks editing the rest of the repair; the
        completion checks it again before anything is consumed."""
        supply_service = SupplyService(self.db)
        for supply_id in {p.supply_id for p in items if p.supply_id is not None}:
            if supply_id not in already_linked:
                await supply_service.get_supply_for_use(supply_id, vin)

    async def create_repair(self, vin: str, data: PlannedRepairCreate) -> PlannedRepair:
        await self._check_supplies(vin, data.parts, set())
        repair = PlannedRepair(
            vin=vin,
            title=data.title,
            description=data.description,
            status="planning",
            priority=data.priority,
            estimated_cost=data.estimated_cost,
            target_date=data.target_date,
            target_odometer_km=data.target_odometer_km,
            vendor_id=data.vendor_id,
            service_category=data.service_category,
            position=await self._next_position(vin, "planning"),
            parts=_parts(data.parts),
            system_rows=_systems(data.systems),
        )
        self.db.add(repair)
        await self.db.flush()
        repair_id = repair.id
        await self.db.commit()
        return await self.get_repair(vin, repair_id)

    async def update_repair(
        self, vin: str, repair_id: int, data: PlannedRepairUpdate
    ) -> PlannedRepair:
        repair = await self.get_repair(vin, repair_id)
        # An omitted field keeps its value and an explicit null clears it.
        changes = data.model_dump(exclude_unset=True, exclude={"parts", "systems"})
        for field, value in changes.items():
            setattr(repair, field, value)
        dropped_images: list[str] = []
        if "parts" in data.model_fields_set:
            linked = {p.supply_id for p in repair.parts if p.supply_id is not None}
            await self._check_supplies(vin, data.parts or [], linked)
            repair.parts, dropped_images = _merge_parts(repair.parts, data.parts or [])
        if "systems" in data.model_fields_set:
            await self._replace_systems(repair, data.systems or [])
        await self.db.commit()
        _unlink_photos(dropped_images)
        return await self.get_repair(vin, repair_id)

    async def _replace_systems(self, repair: PlannedRepair, systems: list[str]) -> None:
        """Swap the repair's tags. The old rows are flushed away first: a kept
        key would otherwise insert a duplicate (repair_id, system) before the
        delete-orphan removal runs."""
        repair.system_rows = []
        await self.db.flush()
        repair.system_rows = _systems(systems)

    async def delete_repair(self, vin: str, repair_id: int) -> None:
        """Delete a repair. A service visit it logged stays in service history."""
        repair = await self.get_repair(vin, repair_id)
        photo_paths = [p.file_path for p in repair.photos]
        photo_paths += [p.image_path for p in repair.parts if p.image_path]
        await self.db.delete(repair)
        await self.db.commit()
        _unlink_photos(photo_paths)

    # ---- photos ---------------------------------------------------------------

    @staticmethod
    def photo_file(file_path: str) -> Path:
        """Absolute, validated location of a stored repair photo."""
        return validate_path_within_base(
            settings.photos_dir / file_path, settings.photos_dir, raise_error=True
        )

    async def add_photo(self, vin: str, repair_id: int, contents: bytes) -> PlannedRepairPhoto:
        """Store ``contents`` as a size-capped JPEG on the repair."""
        repair = await self.get_repair(vin, repair_id)
        if len(repair.photos) >= MAX_PHOTOS_PER_REPAIR:
            raise HTTPException(
                status_code=400,
                detail=f"A repair holds at most {MAX_PHOTOS_PER_REPAIR} photos",
            )
        image = _encode_photo(contents)

        relative = f"{vin}/planned_repairs/{repair_id}-{uuid.uuid4().hex[:8]}.jpg"
        destination = self.photo_file(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, format="JPEG", quality=88)

        photo = PlannedRepairPhoto(repair_id=repair_id, file_path=relative)
        self.db.add(photo)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            _unlink_photo(relative)
            raise
        await self.db.refresh(photo)
        return photo

    async def get_photo(self, vin: str, repair_id: int, photo_id: int) -> PlannedRepairPhoto:
        await self.get_repair(vin, repair_id)  # 404 unless the repair is this vehicle's
        result = await self.db.execute(
            select(PlannedRepairPhoto).where(
                PlannedRepairPhoto.id == photo_id, PlannedRepairPhoto.repair_id == repair_id
            )
        )
        photo = result.scalar_one_or_none()
        if photo is None:
            raise HTTPException(status_code=404, detail="Photo not found")
        return photo

    async def delete_photo(self, vin: str, repair_id: int, photo_id: int) -> None:
        photo = await self.get_photo(vin, repair_id, photo_id)
        file_path = photo.file_path
        await self.db.delete(photo)
        await self.db.commit()
        _unlink_photo(file_path)

    # ---- part pictures ----------------------------------------------------------

    async def get_part(self, vin: str, repair_id: int, part_id: int) -> PlannedRepairPart:
        """One part of this vehicle's repair; 404 otherwise."""
        repair = await self.get_repair(vin, repair_id)
        part = next((p for p in repair.parts if p.id == part_id), None)
        if part is None:
            raise HTTPException(status_code=404, detail="Part not found")
        return part

    async def set_part_image(
        self, vin: str, repair_id: int, part_id: int, contents: bytes
    ) -> PlannedRepairPart:
        """Store ``contents`` as the part's picture (a size-capped JPEG), replacing any."""
        part = await self.get_part(vin, repair_id, part_id)
        image = _encode_photo(contents)

        relative = f"{vin}/planned_repairs/parts/{part_id}-{uuid.uuid4().hex[:8]}.jpg"
        destination = self.photo_file(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, format="JPEG", quality=88)

        old_path = part.image_path
        part.image_path = relative
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            _unlink_photo(relative)
            raise
        if old_path:
            _unlink_photo(old_path)
        return await self.get_part(vin, repair_id, part_id)

    async def clear_part_image(self, vin: str, repair_id: int, part_id: int) -> None:
        """Remove the part's picture; 404 when it has none."""
        part = await self.get_part(vin, repair_id, part_id)
        old_path = part.image_path
        if not old_path:
            raise HTTPException(status_code=404, detail="This part has no picture")
        part.image_path = None
        await self.db.commit()
        _unlink_photo(old_path)

    async def move_repair(self, vin: str, repair_id: int, move: PlannedRepairMove) -> PlannedRepair:
        """Move a repair to a stage and position, renumbering the columns it touches.

        Entering done needs a service visit. One the repair already logged is
        reused; without one the client must go through ``complete``, which
        writes it, so this answers 409.
        """
        await lock_vehicle_for_write(self.db, vin)
        repair = await self.get_repair(vin, repair_id)
        if (
            move.status == "done"
            and repair.status != "done"
            and not await self._linked_visit_exists(vin, repair)
        ):
            raise HTTPException(
                status_code=409,
                detail="Completing a repair logs a service visit: use the complete endpoint",
            )

        source_status = repair.status
        await self._place(vin, repair, move.status, move.position)
        if move.status == "done" and source_status != "done":
            repair.completed_at = datetime.now(UTC).replace(tzinfo=None)
        elif move.status != "done":
            repair.completed_at = None
        await self.db.commit()
        return await self.get_repair(vin, repair_id)

    async def _place(self, vin: str, repair: PlannedRepair, status: str, position: int) -> None:
        """Put the repair at `position` in `status`, closing the gap it leaves."""
        result = await self.db.execute(
            select(PlannedRepair)
            .where(PlannedRepair.vin == vin, PlannedRepair.id != repair.id)
            .order_by(PlannedRepair.position, PlannedRepair.id)
        )
        others = list(result.scalars().all())

        if repair.status != status:
            source = [r for r in others if r.status == repair.status]
            for index, item in enumerate(source):
                item.position = index

        target = [r for r in others if r.status == status]
        target.insert(min(position, len(target)), repair)
        repair.status = status
        for index, item in enumerate(target):
            item.position = index

    async def _parts_to_supplies(
        self,
        vin: str,
        repair: PlannedRepair,
        parts: list[CompletedPartInput],
        visit: ServiceVisitCreate,
        current_user: User | None,
    ) -> tuple[list[SupplyUsageInput], list[str]]:
        """Add each completed part to supplies, bought on the visit's date. No commit.

        Returns the usages that consume them, and the picture files copied to
        the new supplies (for removal if the transaction fails).
        """
        typed = {p.id: p for p in repair.parts if p.kind == "part" and p.supply_id is None}
        usages: list[SupplyUsageInput] = []
        copied: list[str] = []
        for item in parts:
            part = typed.get(item.part_id)
            if part is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Part {item.part_id} is not a typed-in part of this repair",
                )
            notes = [f"Added from the planned repair {repair.title!r}."]
            if part.url:
                notes.append(f"Link: {part.url}")
            supply = Supply(
                name=part.description[:120],
                part_number=part.part_number,
                unit_type="count",
                notes="\n".join(notes),
                created_by_user_id=current_user.id if current_user else None,
                vehicle_links=[SupplyVehicle(vin=vin)],
            )
            self.db.add(supply)
            await self.db.flush()
            total = None
            if item.cost is not None:
                total = (item.cost * item.quantity).quantize(Decimal("0.01"), ROUND_HALF_UP)
            self.db.add(
                SupplyPurchase(
                    supply_id=supply.id,
                    date=visit.date,
                    quantity=item.quantity,
                    total_cost=total,
                    part_number=part.part_number,
                )
            )
            if part.image_path:
                relative = f"supplies/{supply.id}-{uuid.uuid4().hex[:8]}.jpg"
                try:
                    destination = self.photo_file(relative)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(self.photo_file(part.image_path), destination)
                except OSError:
                    logger.warning("Could not copy the picture of part %s", part.id)
                else:
                    supply.image_path = relative
                    copied.append(relative)
            usages.append(SupplyUsageInput(supply_id=supply.id, quantity=item.quantity))
        await self.db.flush()
        return usages, copied

    async def complete_repair(
        self,
        vin: str,
        repair_id: int,
        visit_data: ServiceVisitCreate,
        current_user: User | None = None,
    ) -> PlannedRepair:
        """Mark a repair done and log its service visit, in one transaction.

        A repair that already logged a visit (moved back out of done, then in
        again) reuses it, so service history never gets a duplicate.
        """
        await lock_vehicle_for_write(self.db, vin)
        repair = await self.get_repair(vin, repair_id)

        created_visit = False
        copied_images: list[str] = []
        if not await self._linked_visit_exists(vin, repair):
            parts = visit_data.parts if isinstance(visit_data, PlannedRepairComplete) else []
            line_item_index = (
                visit_data.parts_line_item if isinstance(visit_data, PlannedRepairComplete) else 0
            )
            visit_data = ServiceVisitCreate.model_validate(
                visit_data.model_dump(exclude={"parts", "parts_line_item"})
            )
            if parts:
                usages, copied_images = await self._parts_to_supplies(
                    vin, repair, parts, visit_data, current_user
                )
                line_item = visit_data.line_items[line_item_index]
                line_item.supplies_used = [*line_item.supplies_used, *usages]
            # A real visit: its readings feed the odometer/hours history like
            # one logged from the service form.
            try:
                visit, _items = await ServiceVisitService(self.db).persist_visit_rows(
                    vin, visit_data, sync_readings=True
                )
            except Exception:
                _unlink_photos(copied_images)
                raise
            repair.service_visit_id = visit.id
            created_visit = True

        if repair.status != "done":
            await self._place(vin, repair, "done", await self._next_position(vin, "done"))
            repair.completed_at = datetime.now(UTC).replace(tzinfo=None)

        if created_visit:
            # The new line items are services like any other, so the vehicle's
            # maintenance rules reconcile against them in this transaction.
            await maintenance_service.reconcile_vehicle_unlocked(self.db, vin)

        visit_id = repair.service_visit_id
        try:
            await self.db.commit()
        except Exception:
            _unlink_photos(copied_images)
            raise
        logger.info(
            "Completed planned repair %s for %s (visit %s)",
            repair_id,
            sanitize_for_log(vin),
            visit_id,
        )
        return await self.get_repair(vin, repair_id)


def to_response(repair: PlannedRepair) -> PlannedRepairResponse:
    """The repair as the API returns it.

    planned_repair_systems has no CHECK, so a key the API no longer knows (a
    restored backup, a downgrade) is dropped here rather than failing the
    PlannedRepairResponse systems Literal.
    """
    response = PlannedRepairResponse.model_validate(repair)
    stored = {row.system for row in repair.system_rows}
    return response.model_copy(update={"systems": [s for s in VEHICLE_SYSTEMS if s in stored]})
