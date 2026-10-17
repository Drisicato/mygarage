from __future__ import annotations

"""Vehicle inspection models: a multi-point checklist logged against a vehicle."""

import datetime as dt
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base

if TYPE_CHECKING:
    from app.models.planned_repair import PlannedRepair

#: The CHECK body shared by every status column.
_STATUS_VALUES = "('green', 'yellow', 'red', 'not_inspected')"


class VehicleInspection(Base):
    """One multi-point inspection: a checklist, tire pressures, per-wheel readings and notes."""

    __tablename__ = "vehicle_inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vin: Mapped[str] = mapped_column(
        String(17), ForeignKey("vehicles.vin", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    odometer_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    inspector: Mapped[str | None] = mapped_column(String(100))
    tire_pressure_front_kpa: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    tire_pressure_rear_kpa: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    notes_interior: Mapped[str | None] = mapped_column(Text)
    notes_under_hood: Mapped[str | None] = mapped_column(Text)
    notes_under_vehicle: Mapped[str | None] = mapped_column(Text)
    notes_battery: Mapped[str | None] = mapped_column(Text)
    notes_tires: Mapped[str | None] = mapped_column(Text)
    notes_brakes: Mapped[str | None] = mapped_column(Text)
    recommendations: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, onupdate=func.now())

    # Relationships
    vehicle: Mapped[Vehicle] = relationship("Vehicle", back_populates="inspections")
    items: Mapped[list[VehicleInspectionItem]] = relationship(
        "VehicleInspectionItem",
        back_populates="inspection",
        cascade="all, delete-orphan",
        order_by="VehicleInspectionItem.id",
    )
    corners: Mapped[list[VehicleInspectionCorner]] = relationship(
        "VehicleInspectionCorner",
        back_populates="inspection",
        cascade="all, delete-orphan",
        order_by="VehicleInspectionCorner.id",
    )
    photos: Mapped[list[VehicleInspectionPhoto]] = relationship(
        "VehicleInspectionPhoto",
        back_populates="inspection",
        cascade="all, delete-orphan",
        order_by="VehicleInspectionPhoto.id",
    )

    __table_args__ = (Index("idx_vehicle_inspections_vin", "vin"),)


class VehicleInspectionItem(Base):
    """One checklist point. The key list is fixed by the API, not the database,
    so adding a point later needs no migration."""

    __tablename__ = "vehicle_inspection_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("vehicle_inspections.id", ondelete="CASCADE"), nullable=False
    )
    item_key: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="not_inspected")
    note: Mapped[str | None] = mapped_column(String(500))
    #: The planned repair created from this item, if any.
    planned_repair_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("planned_repairs.id", ondelete="SET NULL")
    )

    inspection: Mapped[VehicleInspection] = relationship(
        "VehicleInspection", back_populates="items"
    )
    planned_repair: Mapped[PlannedRepair | None] = relationship("PlannedRepair")

    __table_args__ = (
        CheckConstraint(
            f"status IN {_STATUS_VALUES}", name="check_vehicle_inspection_items_status"
        ),
        UniqueConstraint("inspection_id", "item_key", name="uq_vehicle_inspection_items_key"),
        Index("idx_vehicle_inspection_items_inspection_id", "inspection_id"),
        Index("idx_vehicle_inspection_items_planned_repair_id", "planned_repair_id"),
    )


class VehicleInspectionCorner(Base):
    """One wheel's tread depth and brake pad readings."""

    __tablename__ = "vehicle_inspection_corners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("vehicle_inspections.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[str] = mapped_column(String(2), nullable=False)
    tread_status: Mapped[str] = mapped_column(String(15), nullable=False, default="not_inspected")
    tread_depth_mm: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    brake_status: Mapped[str] = mapped_column(String(15), nullable=False, default="not_inspected")
    brake_pad_mm: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    #: Planned repairs created from a red tire or brake pad on this wheel.
    tread_repair_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("planned_repairs.id", ondelete="SET NULL")
    )
    brake_repair_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("planned_repairs.id", ondelete="SET NULL")
    )

    inspection: Mapped[VehicleInspection] = relationship(
        "VehicleInspection", back_populates="corners"
    )

    __table_args__ = (
        CheckConstraint(
            "position IN ('lf', 'rf', 'lr', 'rr')",
            name="check_vehicle_inspection_corners_position",
        ),
        CheckConstraint(
            f"tread_status IN {_STATUS_VALUES}",
            name="check_vehicle_inspection_corners_tread_status",
        ),
        CheckConstraint(
            f"brake_status IN {_STATUS_VALUES}",
            name="check_vehicle_inspection_corners_brake_status",
        ),
        UniqueConstraint(
            "inspection_id", "position", name="uq_vehicle_inspection_corners_position"
        ),
        Index("idx_vehicle_inspection_corners_inspection_id", "inspection_id"),
        Index("idx_vehicle_inspection_corners_tread_repair_id", "tread_repair_id"),
        Index("idx_vehicle_inspection_corners_brake_repair_id", "brake_repair_id"),
    )


class VehicleInspectionPhoto(Base):
    """A photo taken during the inspection, stored as a JPEG under the photos directory."""

    __tablename__ = "vehicle_inspection_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("vehicle_inspections.id", ondelete="CASCADE"), nullable=False
    )
    #: Relative to settings.photos_dir (``<VIN>/inspections/<id>-<token>.jpg``), so
    #: deleting the vehicle's photo directory takes these with it.
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    inspection: Mapped[VehicleInspection] = relationship(
        "VehicleInspection", back_populates="photos"
    )

    __table_args__ = (Index("idx_vehicle_inspection_photos_inspection_id", "inspection_id"),)


from app.models.vehicle import Vehicle
