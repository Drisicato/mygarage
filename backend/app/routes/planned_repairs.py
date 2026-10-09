"""Planned repair routes for MyGarage API."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.planned_repair import (
    PlannedRepairCreate,
    PlannedRepairListResponse,
    PlannedRepairMove,
    PlannedRepairResponse,
    PlannedRepairUpdate,
)
from app.schemas.service_visit import ServiceVisitCreate
from app.services.auth import get_vehicle_or_403, require_auth
from app.services.planned_repair_service import PlannedRepairService, to_response

router = APIRouter(prefix="/api/vehicles/{vin}/planned-repairs", tags=["Planned Repairs"])


@router.get("", response_model=PlannedRepairListResponse)
async def list_planned_repairs(
    vin: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> PlannedRepairListResponse:
    """List a vehicle's planned repairs, by stage then position."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    repairs = await PlannedRepairService(db).list_repairs(vin)
    return PlannedRepairListResponse(repairs=[to_response(r) for r in repairs], total=len(repairs))


@router.post("", response_model=PlannedRepairResponse, status_code=201)
async def create_planned_repair(
    vin: str,
    data: PlannedRepairCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> PlannedRepairResponse:
    """Create a planned repair in the planning stage."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(await PlannedRepairService(db).create_repair(vin, data))


@router.get("/{repair_id}", response_model=PlannedRepairResponse)
async def get_planned_repair(
    vin: str,
    repair_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> PlannedRepairResponse:
    """Get a planned repair."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    return to_response(await PlannedRepairService(db).get_repair(vin, repair_id))


@router.put("/{repair_id}", response_model=PlannedRepairResponse)
async def update_planned_repair(
    vin: str,
    repair_id: int,
    data: PlannedRepairUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> PlannedRepairResponse:
    """Update a planned repair's details. Stage changes go through /move."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(await PlannedRepairService(db).update_repair(vin, repair_id, data))


@router.delete("/{repair_id}", status_code=204)
async def delete_planned_repair(
    vin: str,
    repair_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> None:
    """Delete a planned repair. A service visit it logged stays in history."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    await PlannedRepairService(db).delete_repair(vin, repair_id)


@router.post("/{repair_id}/move", response_model=PlannedRepairResponse)
async def move_planned_repair(
    vin: str,
    repair_id: int,
    move: PlannedRepairMove,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> PlannedRepairResponse:
    """Move a repair to a stage and position.

    Moving into done answers 409 unless the repair already logged a service
    visit; use /complete to log one.
    """
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(await PlannedRepairService(db).move_repair(vin, repair_id, move))


@router.post("/{repair_id}/complete", response_model=PlannedRepairResponse)
async def complete_planned_repair(
    vin: str,
    repair_id: int,
    visit: ServiceVisitCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> PlannedRepairResponse:
    """Mark a repair done and log the service visit for it.

    A repair that already logged a visit keeps it and the body is ignored, so
    service history never gets a duplicate.
    """
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(await PlannedRepairService(db).complete_repair(vin, repair_id, visit))
