from __future__ import annotations

"""Planned repair models: a per-vehicle board of repairs not yet in service history."""

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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base

if TYPE_CHECKING:
    from app.models.service_visit import ServiceVisit
    from app.models.supply import Supply
    from app.models.vendor import Vendor


class PlannedRepair(Base):
    """A repair moving through planning -> in_progress -> done.

    Completing one writes a service visit and links it here, so moving the card
    back out of done and in again reuses that visit instead of logging another.
    """

    __tablename__ = "planned_repairs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vin: Mapped[str] = mapped_column(
        String(17), ForeignKey("vehicles.vin", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planning")
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    target_date: Mapped[dt.date | None] = mapped_column(Date)
    target_odometer_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    vendor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("vendors.id", ondelete="SET NULL")
    )
    service_category: Mapped[str | None] = mapped_column(String(30))
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    service_visit_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("service_visits.id", ondelete="SET NULL")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, onupdate=func.now())

    # Relationships
    vehicle: Mapped[Vehicle] = relationship("Vehicle", back_populates="planned_repairs")
    vendor: Mapped[Vendor | None] = relationship("Vendor")
    service_visit: Mapped[ServiceVisit | None] = relationship("ServiceVisit")
    parts: Mapped[list[PlannedRepairPart]] = relationship(
        "PlannedRepairPart",
        back_populates="repair",
        cascade="all, delete-orphan",
        order_by="PlannedRepairPart.id",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('planning', 'in_progress', 'done')",
            name="check_planned_repairs_status",
        ),
        CheckConstraint(
            "priority IN ('low', 'medium', 'high', 'urgent')",
            name="check_planned_repairs_priority",
        ),
        CheckConstraint(
            "service_category IN ('Maintenance', 'Inspection', 'Collision', 'Repair', "
            "'Upgrades', 'Detailing')",
            name="check_planned_repairs_category",
        ),
        Index("idx_planned_repairs_vin", "vin"),
        Index("idx_planned_repairs_vin_status", "vin", "status"),
        Index("idx_planned_repairs_vendor_id", "vendor_id"),
        Index("idx_planned_repairs_service_visit_id", "service_visit_id"),
    )


class PlannedRepairPart(Base):
    """A part or job on a planned repair; becomes a line item when completed."""

    __tablename__ = "planned_repair_parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repair_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("planned_repairs.id", ondelete="CASCADE"), nullable=False
    )
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    #: A part taken from the supplies inventory (migration 126). Nothing is
    #: consumed while the repair is planned; completing it logs the usage on
    #: the service visit's line item, like one picked in the service form.
    supply_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("supplies.id", ondelete="SET NULL")
    )
    #: Canonical units (L or count), the same as a supply usage.
    supply_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    repair: Mapped[PlannedRepair] = relationship("PlannedRepair", back_populates="parts")
    supply: Mapped[Supply | None] = relationship("Supply")

    @property
    def supply_name(self) -> str | None:
        return self.supply.name if self.supply is not None else None

    @property
    def unit_type(self) -> str | None:
        """The linked supply's unit type (volume or count)."""
        return self.supply.unit_type if self.supply is not None else None

    @property
    def volume_unit(self) -> str | None:
        """The linked supply's display unit; null means the legacy binary pick."""
        return self.supply.volume_unit if self.supply is not None else None

    __table_args__ = (
        Index("idx_planned_repair_parts_repair_id", "repair_id"),
        Index("idx_planned_repair_parts_supply_id", "supply_id"),
    )


from app.models.vehicle import Vehicle
