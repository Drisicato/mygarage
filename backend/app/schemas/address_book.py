"""Address book schemas for validation."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas._nullability import reject_null


class AddressBookEntryBase(BaseModel):
    """Base address book entry schema."""

    business_name: str = Field(..., max_length=150)
    name: str | None = Field(None, max_length=100)
    address: str | None = None
    city: str | None = Field(None, max_length=100)
    state: str | None = Field(None, max_length=50)
    zip_code: str | None = Field(None, max_length=20)
    phone: str | None = Field(None, max_length=20)
    email: EmailStr | None = None
    website: str | None = Field(None, max_length=200)
    category: str | None = Field(None, max_length=50)
    notes: str | None = None

    # Geolocation fields for shop discovery
    latitude: Decimal | None = None
    longitude: Decimal | None = None

    # Shop discovery metadata
    source: str | None = Field(default="manual", max_length=20)
    external_id: str | None = Field(None, max_length=100)

    # Ratings
    rating: Decimal | None = None
    user_rating: int | None = None

    # POI categorization (e.g. 'gas_station' for gas-station entries created
    # from the fuel-record form). 'gas_station' entries are excluded from
    # vendor sync — see routes/address_book.py::_sync_to_vendor.
    poi_category: str | None = Field(None, max_length=50)
    poi_metadata: str | None = None

    @field_validator("email", "website", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: str) -> str | None:
        """Convert empty strings to None for optional fields."""
        if v == "":
            return None
        return v


class AddressBookEntryCreate(AddressBookEntryBase):
    """Schema for creating an address book entry."""

    pass


class AddressBookEntryUpdate(BaseModel):
    """Schema for updating an address book entry."""

    business_name: str | None = Field(None, max_length=150)
    name: str | None = Field(None, max_length=100)
    address: str | None = None
    city: str | None = Field(None, max_length=100)
    state: str | None = Field(None, max_length=50)
    zip_code: str | None = Field(None, max_length=20)
    phone: str | None = Field(None, max_length=20)
    email: EmailStr | None = None
    website: str | None = Field(None, max_length=200)
    category: str | None = Field(None, max_length=50)
    notes: str | None = None

    # Geolocation fields for shop discovery
    latitude: Decimal | None = None
    longitude: Decimal | None = None

    # Shop discovery metadata
    source: str | None = Field(None, max_length=20)
    external_id: str | None = Field(None, max_length=100)

    # Ratings
    rating: Decimal | None = None
    user_rating: int | None = None

    # POI categorization (see AddressBookEntryBase docstring)
    poi_category: str | None = Field(None, max_length=50)
    poi_metadata: str | None = None

    @field_validator("email", "website", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: str) -> str | None:
        """Convert empty strings to None for optional fields."""
        if v == "":
            return None
        return v

    # NOT NULL columns: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("business_name", "source")


class AddressBookEntryResponse(AddressBookEntryBase):
    """Schema for address book entry response."""

    # Text without the input rules, so a stored string past today's limits
    # still reads instead of 500ing (test_response_contract). The email too:
    # one at a local domain is a real address that EmailStr refuses.
    business_name: str
    name: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    category: str | None = None
    source: str | None = "manual"
    external_id: str | None = None
    poi_category: str | None = None
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AddressBookListResponse(BaseModel):
    """Schema for list of address book entries."""

    entries: list[AddressBookEntryResponse]
    total: int
