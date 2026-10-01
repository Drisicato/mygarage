from __future__ import annotations

"""Audit log model for tracking sensitive operations."""

from datetime import datetime
from typing import Any, cast

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.sql import func

from app.database import Base


class AuditLog(Base):
    """Audit log for tracking sensitive system operations."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )  # Null for system operations
    username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)  # IPv6 max length
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    success: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False
    )  # SQLite uses INTEGER for boolean
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    @validates("details")
    def _validate_details(self, _key: str, value: object) -> dict[str, Any] | None:
        """Details is a dict or nothing, never a bare string.

        It runs on assignment only, so old rows that hold a string still load.
        """
        if value is None:
            return None
        if not isinstance(value, dict):
            raise TypeError(f"AuditLog.details must be a dict or None, not {type(value).__name__}")
        return cast(dict[str, Any], value)

    def __repr__(self) -> str:
        return f"<AuditLog(id={self.id}, action={self.action}, user={self.username}, timestamp={self.timestamp})>"


# The longest user agent the column holds. PostgreSQL refuses a longer one, which
# fails the insert and everything committing with it.
USER_AGENT_MAX_LENGTH: int = AuditLog.user_agent.type.length
