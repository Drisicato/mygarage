"""Pydantic schemas for tax/registration records."""

from datetime import date as date_type
from datetime import datetime as datetime_type
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._money import Money, OptionalMoney
from app.schemas._nullability import reject_null

TaxType = Literal["Registration", "Inspection", "Property Tax", "Tolls"]


class TaxRecordBase(BaseModel):
    """Base tax record schema."""

    date: date_type = Field(..., description="Date the fee was paid")
    tax_type: TaxType | None = Field(None, description="Type of tax/fee")
    amount: Money = Field(..., description="Amount paid")
    renewal_date: date_type | None = Field(None, description="Next renewal date")
    notes: str | None = None


class TaxRecordCreate(TaxRecordBase):
    """Schema for creating a tax record."""

    vin: str = Field(..., max_length=17)

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "vin": "ML32A5HJ9KH009478",
                    "date": "2025-01-15",
                    "tax_type": "Registration",
                    "amount": 85.50,
                    "renewal_date": "2026-01-15",
                    "notes": "Annual vehicle registration renewal",
                }
            ]
        }
    }


class TaxRecordUpdate(BaseModel):
    """Schema for updating a tax record."""

    date: date_type | None = None
    tax_type: TaxType | None = None
    amount: OptionalMoney = None
    renewal_date: date_type | None = None
    notes: str | None = None

    # NOT NULL columns: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("date", "amount")


class TaxRecordResponse(TaxRecordBase):
    """Schema for tax record response."""

    # Money without the input bounds, so a stored amount past today's rules
    # still reads instead of 500ing (test_response_contract).
    amount: Decimal = Field(..., description="Amount paid")
    id: int
    vin: str
    created_at: datetime_type

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "examples": [
                {
                    "id": 1,
                    "vin": "ML32A5HJ9KH009478",
                    "date": "2025-01-15",
                    "tax_type": "Registration",
                    "amount": 85.50,
                    "renewal_date": "2026-01-15",
                    "notes": "Annual vehicle registration renewal",
                    "created_at": "2025-01-15T10:30:00",
                }
            ]
        },
    }


class TaxRecordListResponse(BaseModel):
    """Schema for list of tax records."""

    records: list[TaxRecordResponse]
    total: int

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "records": [
                        {
                            "id": 1,
                            "vin": "ML32A5HJ9KH009478",
                            "date": "2025-01-15",
                            "tax_type": "Registration",
                            "amount": 85.50,
                            "renewal_date": "2026-01-15",
                            "notes": "Annual vehicle registration renewal",
                            "created_at": "2025-01-15T10:30:00",
                        }
                    ],
                    "total": 1,
                }
            ]
        }
    }
