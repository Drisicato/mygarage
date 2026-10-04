"""Planned repair business logic: the board's ordering and completion into service history."""

import logging
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.planned_repair import PlannedRepair, PlannedRepairPart
from app.models.service_visit import ServiceVisit
from app.schemas.planned_repair import (
    PlannedRepairCreate,
    PlannedRepairMove,
    PlannedRepairPartInput,
    PlannedRepairResponse,
    PlannedRepairUpdate,
)
from app.schemas.service_visit import ServiceVisitCreate
from app.services import maintenance_service
from app.services.service_visit_service import ServiceVisitService
from app.services.supply_service import SupplyService
from app.services.vehicle_lock import lock_vehicle_for_write
from app.utils.cache import invalidate_cache_for_vehicle
from app.utils.logging_utils import sanitize_for_log

logger = logging.getLogger(__name__)

#: Board column order, so a list reads left to right.
_STATUS_ORDER = {"planning": 0, "in_progress": 1, "done": 2}


def _load_options():
    return (
        selectinload(PlannedRepair.parts).selectinload(PlannedRepairPart.supply),
        selectinload(PlannedRepair.vendor),
    )


def _parts(items: list[PlannedRepairPartInput]) -> list[PlannedRepairPart]:
    return [
        PlannedRepairPart(
            description=p.description,
            cost=p.cost,
            supply_id=p.supply_id,
            supply_quantity=p.supply_quantity,
        )
        for p in items
    ]


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
        for field, value in data.model_dump(exclude_unset=True, exclude={"parts"}).items():
            setattr(repair, field, value)
        if "parts" in data.model_fields_set:
            linked = {p.supply_id for p in repair.parts if p.supply_id is not None}
            await self._check_supplies(vin, data.parts or [], linked)
            repair.parts = _parts(data.parts or [])
        await self.db.commit()
        return await self.get_repair(vin, repair_id)

    async def delete_repair(self, vin: str, repair_id: int) -> None:
        """Delete a repair. A service visit it logged stays in service history."""
        repair = await self.get_repair(vin, repair_id)
        await self.db.delete(repair)
        await self.db.commit()

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

    async def complete_repair(
        self, vin: str, repair_id: int, visit_data: ServiceVisitCreate
    ) -> PlannedRepair:
        """Mark a repair done and log its service visit, in one transaction.

        A repair that already logged a visit (moved back out of done, then in
        again) reuses it, so service history never gets a duplicate.
        """
        await lock_vehicle_for_write(self.db, vin)
        repair = await self.get_repair(vin, repair_id)

        created_visit = False
        if not await self._linked_visit_exists(vin, repair):
            # A real visit: its readings feed the odometer/hours history like
            # one logged from the service form.
            visit, _items = await ServiceVisitService(self.db).persist_visit_rows(
                vin, visit_data, sync_readings=True
            )
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
        await self.db.commit()
        await invalidate_cache_for_vehicle(vin)
        logger.info(
            "Completed planned repair %s for %s (visit %s)",
            repair_id,
            sanitize_for_log(vin),
            visit_id,
        )
        return await self.get_repair(vin, repair_id)


def to_response(repair: PlannedRepair) -> PlannedRepairResponse:
    return PlannedRepairResponse.model_validate(repair)
