from __future__ import annotations

"""Warranty record database model."""

from datetime import date, datetime
from decimal import Decimal

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


class WarrantyRecord(Base):
    """Warranty coverage record model."""

    __tablename__ = "warranty_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vin: Mapped[str] = mapped_column(
        String(17), ForeignKey("vehicles.vin", ondelete="CASCADE"), nullable=False
    )
    warranty_type: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    mileage_limit_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    coverage_details: Mapped[str | None] = mapped_column(Text)
    policy_number: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Relationships
    vehicle: Mapped[Vehicle] = relationship("Vehicle", back_populates="warranty_records")
    # selectin: the response schema reads these outside any lazy-load context.
    documents: Mapped[list[WarrantyDocument]] = relationship(
        "WarrantyDocument",
        back_populates="warranty",
        cascade="all, delete-orphan",
        order_by="WarrantyDocument.id",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint(
            "warranty_type IN ('Manufacturer', 'Powertrain', 'Extended', 'Bumper-to-Bumper', 'Emissions', 'Corrosion', 'Other')",
            name="check_warranty_type",
        ),
        Index("idx_warranty_records_vin", "vin"),
        Index("idx_warranty_records_end_date", "end_date"),
    )


class WarrantyDocument(Base):
    """A contract, certificate, or claim paper attached to a warranty."""

    __tablename__ = "warranty_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    warranty_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("warranty_records.id", ondelete="CASCADE"), nullable=False
    )
    #: Relative to settings.documents_dir (``<VIN>/warranties/<id>/<name>``), so deleting
    #: the vehicle's document directory takes these with it.
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    #: The name the file had when uploaded; the stored name is made unique.
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(100))
    file_size: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    warranty: Mapped[WarrantyRecord] = relationship("WarrantyRecord", back_populates="documents")

    __table_args__ = (Index("idx_warranty_documents_warranty_id", "warranty_id"),)


from app.models.vehicle import Vehicle
