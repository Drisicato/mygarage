"""Vehicle inspection routes for MyGarage API."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.vehicle_inspection import (
    CornerPosition,
    CornerReading,
    InspectionItemKey,
    InspectionItemRepairCreate,
    VehicleInspectionCreate,
    VehicleInspectionListResponse,
    VehicleInspectionPhotoResponse,
    VehicleInspectionResponse,
    VehicleInspectionUpdate,
)
from app.services.auth import get_vehicle_or_403, require_auth
from app.services.vehicle_inspection_service import VehicleInspectionService, to_response
from app.utils.file_validation import validate_image_upload

router = APIRouter(prefix="/api/vehicles/{vin}/inspections", tags=["Vehicle Inspections"])


@router.get("", response_model=VehicleInspectionListResponse)
async def list_vehicle_inspections(
    vin: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionListResponse:
    """List a vehicle's inspections, newest first."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    inspections = await VehicleInspectionService(db).list_inspections(vin)
    return VehicleInspectionListResponse(
        inspections=[to_response(i) for i in inspections], total=len(inspections)
    )


@router.post("", response_model=VehicleInspectionResponse, status_code=201)
async def create_vehicle_inspection(
    vin: str,
    data: VehicleInspectionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionResponse:
    """Log an inspection."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(await VehicleInspectionService(db).create_inspection(vin, data))


@router.get("/{inspection_id}", response_model=VehicleInspectionResponse)
async def get_vehicle_inspection(
    vin: str,
    inspection_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionResponse:
    """Get an inspection."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    return to_response(await VehicleInspectionService(db).get_inspection(vin, inspection_id))


@router.put("/{inspection_id}", response_model=VehicleInspectionResponse)
async def update_vehicle_inspection(
    vin: str,
    inspection_id: int,
    data: VehicleInspectionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionResponse:
    """Update an inspection. Items and corners, when given, replace the stored ones."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(
        await VehicleInspectionService(db).update_inspection(vin, inspection_id, data)
    )


@router.delete("/{inspection_id}", status_code=204)
async def delete_vehicle_inspection(
    vin: str,
    inspection_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> None:
    """Delete an inspection and its photos. Planned repairs made from it stay."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    await VehicleInspectionService(db).delete_inspection(vin, inspection_id)


@router.post(
    "/{inspection_id}/photos", response_model=VehicleInspectionPhotoResponse, status_code=201
)
async def upload_vehicle_inspection_photo(
    vin: str,
    inspection_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionPhotoResponse:
    """Add a photo to an inspection. Re-encoded to a size-capped JPEG."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    contents = await validate_image_upload(file)
    photo = await VehicleInspectionService(db).add_photo(vin, inspection_id, contents)
    return VehicleInspectionPhotoResponse.model_validate(photo)


@router.get("/{inspection_id}/photos/{photo_id}")
async def get_vehicle_inspection_photo(
    vin: str,
    inspection_id: int,
    photo_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> FileResponse:
    """The photo's image."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db)
    service = VehicleInspectionService(db)
    photo = await service.get_photo(vin, inspection_id, photo_id)
    path = service.photo_file(photo.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo file not found")
    return FileResponse(path, media_type="image/jpeg")


@router.delete("/{inspection_id}/photos/{photo_id}", status_code=204)
async def delete_vehicle_inspection_photo(
    vin: str,
    inspection_id: int,
    photo_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> None:
    """Remove a photo from an inspection."""
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    await VehicleInspectionService(db).delete_photo(vin, inspection_id, photo_id)


@router.post(
    "/{inspection_id}/items/{item_key}/planned-repair",
    response_model=VehicleInspectionResponse,
    status_code=201,
)
async def create_planned_repair_from_inspection_item(
    vin: str,
    inspection_id: int,
    item_key: InspectionItemKey,
    data: InspectionItemRepairCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionResponse:
    """Create a planned repair from a red or yellow checklist point and link it.

    409 when the point already has one.
    """
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(
        await VehicleInspectionService(db).create_repair_from_item(
            vin, inspection_id, item_key, data.title
        )
    )


@router.post(
    "/{inspection_id}/corners/{position}/{reading}/planned-repair",
    response_model=VehicleInspectionResponse,
    status_code=201,
)
async def create_planned_repair_from_inspection_corner(
    vin: str,
    inspection_id: int,
    position: CornerPosition,
    reading: CornerReading,
    data: InspectionItemRepairCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: User | None = Depends(require_auth),
) -> VehicleInspectionResponse:
    """Create a planned repair from a red tire (tread) or brake pad on one wheel and link it.

    409 when that reading already has one.
    """
    vin = vin.upper().strip()
    await get_vehicle_or_403(vin, current_user, db, require_write=True)
    return to_response(
        await VehicleInspectionService(db).create_repair_from_corner(
            vin, inspection_id, position, reading, data.title
        )
    )
