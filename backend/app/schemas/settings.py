"""Settings Pydantic schemas for validation and serialization."""

import datetime as dt

from pydantic import BaseModel, Field

from app.schemas._nullability import reject_null


class SettingBase(BaseModel):
    """Base setting schema."""

    value: str | None = Field(None, description="Setting value")
    category: str = Field("general", description="Setting category")
    description: str | None = Field(None, description="Setting description")
    encrypted: bool = Field(
        False,
        description=(
            "Whether the value is sensitive and therefore masked as '********' in "
            "API responses. Values are NOT encrypted at rest."
        ),
    )


class SettingCreate(SettingBase):
    """Schema for creating a setting."""

    key: str = Field(..., description="Setting key", min_length=1, max_length=50)


class SettingUpdate(BaseModel):
    """Schema for updating a setting."""

    value: str | None = Field(None, description="Setting value")
    category: str | None = Field(None, description="Setting category")
    description: str | None = Field(None, description="Setting description")
    encrypted: bool | None = Field(
        None, description="Whether the value is sensitive (masked in API responses)"
    )

    # NOT NULL columns: omitted keeps the stored value, null is a 422.
    _no_null = reject_null("category", "encrypted")


class SettingResponse(SettingBase):
    """Schema for setting response."""

    key: str
    created_at: dt.datetime
    updated_at: dt.datetime

    class Config:
        from_attributes = True


class SettingsListResponse(BaseModel):
    """Schema for list of settings."""

    settings: list[SettingResponse]
    total: int


class SettingsBatchUpdate(BaseModel):
    """Schema for batch updating settings."""

    settings: dict[str, str] = Field(..., description="Dictionary of key-value pairs to update")


class SystemInfoResponse(BaseModel):
    """Schema for system information."""

    app_name: str
    app_version: str
    python_version: str
    database_url: str
    data_directory: str
    total_vehicles: int
    database_size_mb: float
    uptime_seconds: float
