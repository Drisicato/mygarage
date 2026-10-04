"""Pydantic schemas for planned repair operations."""

import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas._money import OptionalMoney
from app.schemas._nullability import reject_null
from app.schemas.service_visit import ServiceCategory, VendorSummary
from app.schemas.supply import SUPPLY_QUANTITY_MAX, LenientSupplyVolumeUnit, SupplyUnitType

RepairStatus = Literal["planning", "in_progress", "done"]
RepairPriority = Literal["low", "medium", "high", "urgent"]


class PlannedRepairPartInput(BaseModel):
    """A part or job on a planned repair, optionally taken from supplies on hand."""

    description: str = Field(..., description="Part or job", min_length=1, max_length=200)
    cost: OptionalMoney = Field(None, description="Estimated cost of this part or job")
    supply_id: int | None = Field(
        None, description="Supply to consume when the repair is completed"
    )
    supply_quantity: Decimal | None = Field(
        None,
        gt=0,
        le=SUPPLY_QUANTITY_MAX,
        description="How much of the supply, in canonical units (L or count)",
    )

    @model_validator(mode="after")
    def supply_and_quantity_together(self) -> "PlannedRepairPartInput":
        if (self.supply_id is None) != (self.supply_quantity is None):
            raise ValueError("supply_id and supply_quantity are given together")
        return self


class PlannedRepairPartResponse(BaseModel):
    """A stored part or job on a planned repair."""

    id: int
    description: str = Field(..., description="Part or job")
    cost: Decimal | None = Field(None, description="Estimated cost of this part or job")
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

    # NOT NULL columns: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("title", "priority")


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

    model_config = {"from_attributes": True}


class PlannedRepairListResponse(BaseModel):
    """Schema for planned repair list response."""

    repairs: list[PlannedRepairResponse]
    total: int
