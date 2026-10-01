"""Recall Pydantic schemas for validation and serialization."""

import datetime as dt

from pydantic import BaseModel, Field

from app.schemas._nullability import reject_null


class RecallBase(BaseModel):
    """Base recall schema with common fields."""

    nhtsa_campaign_number: str | None = Field(
        None, description="NHTSA campaign number", max_length=50
    )
    component: str = Field(
        ..., description="Component affected by recall", min_length=1, max_length=200
    )
    summary: str = Field(..., description="Summary of the recall issue", min_length=1)
    consequence: str | None = Field(None, description="Potential consequences")
    remedy: str | None = Field(None, description="Remedy for the recall")
    date_announced: dt.date | None = Field(None, description="Date recall was announced")
    notes: str | None = Field(None, description="User notes about the recall")


class RecallCreate(RecallBase):
    """Schema for creating a new recall."""

    vin: str = Field(..., description="Vehicle VIN", min_length=17, max_length=17)
    is_resolved: bool = Field(default=False, description="Whether recall has been resolved")


class RecallUpdate(BaseModel):
    """Schema for updating an existing recall."""

    nhtsa_campaign_number: str | None = Field(
        None, description="NHTSA campaign number", max_length=50
    )
    component: str | None = Field(
        None, description="Component affected by recall", min_length=1, max_length=200
    )
    summary: str | None = Field(None, description="Summary of the recall issue", min_length=1)
    consequence: str | None = Field(None, description="Potential consequences")
    remedy: str | None = Field(None, description="Remedy for the recall")
    date_announced: dt.date | None = Field(None, description="Date recall was announced")
    notes: str | None = Field(None, description="User notes about the recall")
    is_resolved: bool | None = Field(None, description="Whether recall has been resolved")

    # NOT NULL column: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("is_resolved")


class RecallResponse(RecallBase):
    """Schema for recall response."""

    # Text without the input rules, so a stored string past today's limits
    # still reads instead of 500ing (test_response_contract).
    nhtsa_campaign_number: str | None = Field(None, description="NHTSA campaign number")
    component: str = Field(..., description="Component affected by recall")
    summary: str = Field(..., description="Summary of the recall issue")
    id: int
    vin: str
    is_resolved: bool
    resolved_at: dt.datetime | None = None
    created_at: dt.datetime

    class Config:
        from_attributes = True


class RecallListResponse(BaseModel):
    """Schema for list of recalls."""

    recalls: list[RecallResponse]
    total: int
    active_count: int
    resolved_count: int
