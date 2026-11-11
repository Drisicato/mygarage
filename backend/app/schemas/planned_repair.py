"""Pydantic schemas for planned repair operations."""

import datetime as dt
from decimal import Decimal
from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas._money import OptionalMoney
from app.schemas._nullability import reject_null
from app.schemas.service_visit import ServiceCategory, VendorSummary
from app.schemas.supply import SUPPLY_QUANTITY_MAX, LenientSupplyVolumeUnit, SupplyUnitType

RepairStatus = Literal["planning", "in_progress", "done"]
RepairPriority = Literal["low", "medium", "high", "urgent"]
#: The part of the vehicle a repair works on. Stored without a CHECK
#: (planned_repair_systems), so a key added here needs no migration.
VehicleSystem = Literal[
    "engine",
    "transmission",
    "differential",
    "drivetrain",
    "suspension",
    "steering",
    "brakes",
    "tires_wheels",
    "cooling",
    "exhaust",
    "fuel",
    "electrical",
    "hvac",
    "body",
    "interior",
    "other",
]
VEHICLE_SYSTEMS: tuple[str, ...] = get_args(VehicleSystem)

PART_URL_MAX = 2000


def _dedupe_systems(value: list[str] | None) -> list[str] | None:
    """Each system once, in the vocabulary's order."""
    if value is None:
        return None
    chosen = set(value)
    return [s for s in VEHICLE_SYSTEMS if s in chosen]


class PlannedRepairPartInput(BaseModel):
    """A part or job on a planned repair, optionally taken from supplies on hand."""

    description: str = Field(..., description="Part or job", min_length=1, max_length=200)
    cost: OptionalMoney = Field(
        None, description="Estimated price of one; the line total is cost x quantity"
    )
    part_number: str | None = Field(None, description="Part number", max_length=60)
    quantity: Decimal | None = Field(
        None,
        gt=0,
        le=SUPPLY_QUANTITY_MAX,
        description="How many are needed, for a part not taken from supplies; null means one",
    )
    url: str | None = Field(
        None, description="Where the part was found online", max_length=PART_URL_MAX
    )
    supply_id: int | None = Field(
        None, description="Supply to consume when the repair is completed"
    )
    supply_quantity: Decimal | None = Field(
        None,
        gt=0,
        le=SUPPLY_QUANTITY_MAX,
        description="How much of the supply, in canonical units (L or count)",
    )

    @field_validator("part_number", "url", mode="before")
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("url")
    @classmethod
    def web_address(cls, value: str | None) -> str | None:
        if value is not None and not value.lower().startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return value

    @model_validator(mode="after")
    def supply_and_quantity_together(self) -> PlannedRepairPartInput:
        if (self.supply_id is None) != (self.supply_quantity is None):
            raise ValueError("supply_id and supply_quantity are given together")
        if self.supply_id is not None and self.quantity is not None:
            raise ValueError("a supply part takes supply_quantity, not quantity")
        return self


class PlannedRepairPartResponse(BaseModel):
    """A stored part or job on a planned repair."""

    id: int
    description: str = Field(..., description="Part or job")
    cost: Decimal | None = Field(
        None, description="Estimated price of one; the line total is cost x quantity"
    )
    part_number: str | None = Field(None, description="Part number")
    quantity: Decimal | None = Field(
        None,
        description="How many are needed, for a part not taken from supplies; null means one",
    )
    url: str | None = Field(None, description="Where the part was found online")
    supply_id: int | None = Field(
        None, description="Supply to consume when the repair is completed"
    )
    supply_quantity: Decimal | None = Field(
        None, description="How much of the supply, in canonical units (L or count)"
    )
    supply_name: str | None = Field(None, description="The supply's name")
    unit_type: SupplyUnitType | None = Field(
        None, description="The supply's unit type, for converting the quantity to display units"
    )
    volume_unit: LenientSupplyVolumeUnit = Field(
        None, description="Per-supply display unit; null means the legacy binary pick"
    )

    model_config = {"from_attributes": True}


class PlannedRepairPhotoResponse(BaseModel):
    """A stored photo; the image itself is served by the photo endpoint."""

    id: int
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class PlannedRepairCreate(BaseModel):
    """Schema for creating a planned repair. New repairs start in planning."""

    title: str = Field(..., description="What the repair is", min_length=1, max_length=200)
    description: str | None = Field(None, description="Details", max_length=5000)
    priority: RepairPriority = Field("medium", description="How urgent the repair is")
    estimated_cost: OptionalMoney = Field(None, description="Estimated total cost")
    target_date: dt.date | None = Field(None, description="When the repair is planned for")
    target_odometer_km: Decimal | None = Field(
        None, description="Odometer reading the repair is planned for", ge=0, le=99999999.99
    )
    vendor_id: int | None = Field(None, description="Shop doing the repair")
    service_category: ServiceCategory | None = Field(
        None, description="Category the service visit gets when completed"
    )
    parts: list[PlannedRepairPartInput] = Field(
        default_factory=list, description="Parts and jobs; each becomes a line item"
    )
    systems: list[VehicleSystem] = Field(
        default_factory=list, description="Vehicle systems the repair works on"
    )

    _systems = field_validator("systems")(_dedupe_systems)


class PlannedRepairUpdate(BaseModel):
    """Schema for updating a planned repair. Stage changes go through /move."""

    title: str | None = Field(None, description="What the repair is", min_length=1, max_length=200)
    description: str | None = Field(None, description="Details", max_length=5000)
    priority: RepairPriority | None = Field(None, description="How urgent the repair is")
    estimated_cost: OptionalMoney = Field(None, description="Estimated total cost")
    target_date: dt.date | None = Field(None, description="When the repair is planned for")
    target_odometer_km: Decimal | None = Field(
        None, description="Odometer reading the repair is planned for", ge=0, le=99999999.99
    )
    vendor_id: int | None = Field(None, description="Shop doing the repair")
    service_category: ServiceCategory | None = Field(
        None, description="Category the service visit gets when completed"
    )
    parts: list[PlannedRepairPartInput] | None = Field(
        None, description="Replaces every part when given"
    )
    systems: list[VehicleSystem] | None = Field(
        None, description="Replaces every vehicle-system tag when given; [] clears them"
    )

    _systems = field_validator("systems")(_dedupe_systems)

    # NOT NULL columns: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("title", "priority", "systems")


class PlannedRepairMove(BaseModel):
    """Move a repair to a stage, at a position within that stage."""

    status: RepairStatus = Field(..., description="Target stage")
    position: int = Field(0, description="Zero-based index within the stage", ge=0)


class PlannedRepairResponse(BaseModel):
    """Schema for planned repair response."""

    id: int
    vin: str
    title: str = Field(..., description="What the repair is")
    description: str | None = Field(None, description="Details")
    status: RepairStatus = Field(..., description="Current stage")
    priority: RepairPriority = Field(..., description="How urgent the repair is")
    estimated_cost: Decimal | None = Field(None, description="Estimated total cost")
    target_date: dt.date | None = Field(None, description="When the repair is planned for")
    target_odometer_km: Decimal | None = Field(
        None, description="Odometer reading the repair is planned for"
    )
    vendor_id: int | None = Field(None, description="Shop doing the repair")
    vendor: VendorSummary | None = Field(None, description="Shop details, if set")
    service_category: ServiceCategory | None = Field(
        None, description="Category the service visit gets when completed"
    )
    position: int
    service_visit_id: int | None = Field(
        None, description="The service visit logged when this repair was completed"
    )
    completed_at: dt.datetime | None = None
    created_at: dt.datetime
    updated_at: dt.datetime | None = None
    parts: list[PlannedRepairPartResponse] = Field(default_factory=list)
    photos: list[PlannedRepairPhotoResponse] = Field(default_factory=list)
    #: Filled by planned_repair_service.to_response, which drops a stored key
    #: outside the vocabulary (the column has no CHECK).
    systems: list[VehicleSystem] = Field(
        default_factory=list, description="Vehicle systems the repair works on"
    )

    model_config = {"from_attributes": True}


class PlannedRepairListResponse(BaseModel):
    """Schema for planned repair list response."""

    repairs: list[PlannedRepairResponse]
    total: int
