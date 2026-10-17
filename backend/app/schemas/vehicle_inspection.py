"""Pydantic schemas for vehicle inspection operations."""

import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas._nullability import reject_null

InspectionStatus = Literal["green", "yellow", "red", "not_inspected"]
CornerPosition = Literal["lf", "rf", "lr", "rr"]
#: Which wear reading on a wheel a planned repair is made from.
CornerReading = Literal["tread", "brake"]

#: The fixed checklist. Only input is held to it: the column has no CHECK, so a
#: point added here later needs no migration, and responses carry a plain str.
InspectionItemKey = Literal[
    # Interior / exterior
    "exterior_lights",
    "wipers",
    "rear_lights",
    "cabin_filter",
    # Under hood
    "engine_oil",
    "coolant",
    "power_steering_fluid",
    "brake_fluid",
    "washer_fluid",
    "transmission_fluid",
    "cooling_system",
    "ac_system",
    "engine_air_filter",
    "drive_belts",
    # Under vehicle
    "front_suspension",
    "rear_suspension",
    "differential",
    "drive_shaft",
    "exhaust",
    "axles",
    "fluid_leaks",
    # Battery
    "battery",
    # Tires
    "tire_rotation",
]

_NOTE_MAX = 5000


class InspectionItemInput(BaseModel):
    """One checklist point's result."""

    item_key: InspectionItemKey = Field(..., description="Which checklist point")
    status: InspectionStatus = Field("not_inspected", description="Result of the check")
    note: str | None = Field(None, description="What was found", max_length=500)


class InspectionCornerInput(BaseModel):
    """One wheel's tread depth and brake pad readings."""

    position: CornerPosition = Field(..., description="Which wheel")
    tread_status: InspectionStatus = Field("not_inspected", description="Tread band")
    tread_depth_mm: Decimal | None = Field(None, description="Tread depth", ge=0, le=99.9)
    brake_status: InspectionStatus = Field("not_inspected", description="Brake pad band")
    brake_pad_mm: Decimal | None = Field(None, description="Brake pad thickness", ge=0, le=99.9)


def _unique_items(items: list[InspectionItemInput] | None) -> list[InspectionItemInput] | None:
    if items is not None:
        keys = [i.item_key for i in items]
        if len(keys) != len(set(keys)):
            raise ValueError("each item_key appears once")
    return items


def _unique_corners(
    corners: list[InspectionCornerInput] | None,
) -> list[InspectionCornerInput] | None:
    if corners is not None:
        positions = [c.position for c in corners]
        if len(positions) != len(set(positions)):
            raise ValueError("each position appears once")
    return corners


class VehicleInspectionCreate(BaseModel):
    """Schema for logging an inspection."""

    date: dt.date = Field(..., description="When the inspection was done")
    odometer_km: Decimal | None = Field(
        None, description="Odometer reading at the inspection", ge=0, le=99999999.99
    )
    inspector: str | None = Field(None, description="Who inspected it", max_length=100)
    tire_pressure_front_kpa: Decimal | None = Field(
        None, description="Front tire pressure", ge=0, le=9999.9
    )
    tire_pressure_rear_kpa: Decimal | None = Field(
        None, description="Rear tire pressure", ge=0, le=9999.9
    )
    notes_interior: str | None = Field(
        None, description="Interior/exterior comments", max_length=_NOTE_MAX
    )
    notes_under_hood: str | None = Field(
        None, description="Under-hood comments", max_length=_NOTE_MAX
    )
    notes_under_vehicle: str | None = Field(
        None, description="Under-vehicle comments", max_length=_NOTE_MAX
    )
    notes_battery: str | None = Field(None, description="Battery comments", max_length=_NOTE_MAX)
    notes_tires: str | None = Field(None, description="Tire comments", max_length=_NOTE_MAX)
    notes_brakes: str | None = Field(None, description="Brake comments", max_length=_NOTE_MAX)
    recommendations: str | None = Field(None, description="Recommendations", max_length=_NOTE_MAX)
    items: list[InspectionItemInput] = Field(
        default_factory=list, description="Checklist results, one per item_key"
    )
    corners: list[InspectionCornerInput] = Field(
        default_factory=list, description="Tire and brake readings, one per wheel"
    )

    _items_unique = field_validator("items")(_unique_items)
    _corners_unique = field_validator("corners")(_unique_corners)


class VehicleInspectionUpdate(BaseModel):
    """Schema for updating an inspection. Items and corners are replaced whole when given."""

    date: dt.date | None = Field(None, description="When the inspection was done")
    odometer_km: Decimal | None = Field(
        None, description="Odometer reading at the inspection", ge=0, le=99999999.99
    )
    inspector: str | None = Field(None, description="Who inspected it", max_length=100)
    tire_pressure_front_kpa: Decimal | None = Field(
        None, description="Front tire pressure", ge=0, le=9999.9
    )
    tire_pressure_rear_kpa: Decimal | None = Field(
        None, description="Rear tire pressure", ge=0, le=9999.9
    )
    notes_interior: str | None = Field(
        None, description="Interior/exterior comments", max_length=_NOTE_MAX
    )
    notes_under_hood: str | None = Field(
        None, description="Under-hood comments", max_length=_NOTE_MAX
    )
    notes_under_vehicle: str | None = Field(
        None, description="Under-vehicle comments", max_length=_NOTE_MAX
    )
    notes_battery: str | None = Field(None, description="Battery comments", max_length=_NOTE_MAX)
    notes_tires: str | None = Field(None, description="Tire comments", max_length=_NOTE_MAX)
    notes_brakes: str | None = Field(None, description="Brake comments", max_length=_NOTE_MAX)
    recommendations: str | None = Field(None, description="Recommendations", max_length=_NOTE_MAX)
    items: list[InspectionItemInput] | None = Field(
        None, description="Replaces every checklist result when given"
    )
    corners: list[InspectionCornerInput] | None = Field(
        None, description="Replaces every wheel's readings when given"
    )

    _items_unique = field_validator("items")(_unique_items)
    _corners_unique = field_validator("corners")(_unique_corners)

    # NOT NULL columns: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("date")


class InspectionItemRepairCreate(BaseModel):
    """Create a planned repair from a checklist point. The client sends the
    point's label, since the labels are translated on the frontend."""

    title: str = Field(..., description="The planned repair's title", min_length=1, max_length=200)


class InspectionItemResponse(BaseModel):
    """A stored checklist result."""

    id: int
    item_key: str = Field(..., description="Which checklist point")
    status: InspectionStatus = Field(..., description="Result of the check")
    note: str | None = Field(None, description="What was found")
    planned_repair_id: int | None = Field(
        None, description="The planned repair created from this point"
    )

    model_config = {"from_attributes": True}


class InspectionCornerResponse(BaseModel):
    """A stored wheel's readings."""

    id: int
    position: CornerPosition = Field(..., description="Which wheel")
    tread_status: InspectionStatus = Field(..., description="Tread band")
    tread_depth_mm: Decimal | None = Field(None, description="Tread depth")
    brake_status: InspectionStatus = Field(..., description="Brake pad band")
    brake_pad_mm: Decimal | None = Field(None, description="Brake pad thickness")
    tread_repair_id: int | None = Field(
        None, description="The planned repair created from this tire"
    )
    brake_repair_id: int | None = Field(
        None, description="The planned repair created from this brake pad"
    )

    model_config = {"from_attributes": True}


class VehicleInspectionPhotoResponse(BaseModel):
    """A stored photo; the image itself is served by the photo endpoint."""

    id: int
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class InspectionStatusCounts(BaseModel):
    """How many checklist points, tread bands and brake bands landed in each status."""

    green: int = 0
    yellow: int = 0
    red: int = 0
    not_inspected: int = 0


class VehicleInspectionResponse(BaseModel):
    """Schema for an inspection response."""

    id: int
    vin: str
    date: dt.date = Field(..., description="When the inspection was done")
    odometer_km: Decimal | None = Field(None, description="Odometer reading at the inspection")
    inspector: str | None = Field(None, description="Who inspected it")
    tire_pressure_front_kpa: Decimal | None = Field(None, description="Front tire pressure")
    tire_pressure_rear_kpa: Decimal | None = Field(None, description="Rear tire pressure")
    notes_interior: str | None = None
    notes_under_hood: str | None = None
    notes_under_vehicle: str | None = None
    notes_battery: str | None = None
    notes_tires: str | None = None
    notes_brakes: str | None = None
    recommendations: str | None = None
    created_at: dt.datetime
    updated_at: dt.datetime | None = None
    items: list[InspectionItemResponse] = Field(default_factory=list)
    corners: list[InspectionCornerResponse] = Field(default_factory=list)
    photos: list[VehicleInspectionPhotoResponse] = Field(default_factory=list)
    counts: InspectionStatusCounts = Field(
        default_factory=InspectionStatusCounts, description="Results tallied by status"
    )

    model_config = {"from_attributes": True}


class VehicleInspectionListResponse(BaseModel):
    """Schema for an inspection list response."""

    inspections: list[VehicleInspectionResponse]
    total: int
