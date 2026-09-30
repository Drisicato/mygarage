"""The spending-anomaly message names the reader's currency, never "$".

The frontend builds its own sentence from `amount` and `baseline` (#131), but
`message` is still on the API, and it said "$" to every user. Tests share one
database, so the users and vehicle here are this module's own and go in
`finally`.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fuel import FuelRecord
from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.auth import create_access_token

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

# Copied from tests/conftest.py: hashing here would need threads these
# containers don't always have.
_PASSWORD_HASH = "$argon2id$v=19$m=102400,t=2,p=8$NNbLa8SMLODWY2Es68EvLw$hiGLA+DtO213EMAMi8D8gXvvyjP8EVMFIHWp7SlUVnI"

# Twelve quiet months of forint fuel and one spike, enough for the detector.
_QUIET = Decimal("10000.00")
_SPIKE = Decimal("80000.00")
_MONTHS = [(2025, m) for m in range(1, 13)] + [(2026, 1)]
_SPIKE_MONTH = (2025, 7)


async def _make_user(db: AsyncSession, currency_code: str, *, is_admin: bool) -> tuple[int, str]:
    """A fresh user in `currency_code`, as plain (id, username)."""
    suffix = uuid.uuid4().hex[:8]
    user = User(
        username=f"anom{currency_code.lower()}_{suffix}",
        email=f"anom{currency_code.lower()}_{suffix}@example.com",
        hashed_password=_PASSWORD_HASH,
        is_active=True,
        is_admin=is_admin,
        currency_code=currency_code,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user.id, user.username


async def _anomaly_messages(
    client: AsyncClient, vin: str, user_id: int, username: str
) -> list[str]:
    """The anomaly messages one user reads for `vin`; exactly the spike month."""
    token = create_access_token(data={"sub": str(user_id), "username": username})
    response = await client.get(
        f"/api/analytics/vehicles/{vin}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text
    anomalies = response.json()["cost_analysis"]["anomalies"]
    assert [a["month"] for a in anomalies] == ["2025-07"]
    return [a["message"] for a in anomalies]


async def test_a_forint_user_reads_forints_not_dollars(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A USD admin reads the vehicle first, so a cost-analysis cache entry keyed
    without the currency would hand the forint owner the dollar text."""
    vin = "ANOMHUF" + uuid.uuid4().hex[:10].upper()
    user_ids: list[int] = []
    try:
        owner_id, owner_name = await _make_user(db_session, "HUF", is_admin=False)
        user_ids.append(owner_id)
        admin_id, admin_name = await _make_user(db_session, "USD", is_admin=True)
        user_ids.append(admin_id)
        db_session.add(
            Vehicle(vin=vin, user_id=owner_id, nickname="Forint Anomaly", vehicle_type="Car")
        )
        await db_session.commit()
        for year, month in _MONTHS:
            db_session.add(
                FuelRecord(
                    vin=vin,
                    date=date(year, month, 10),
                    cost=_SPIKE if (year, month) == _SPIKE_MONTH else _QUIET,
                )
            )
        await db_session.commit()

        (usd,) = await _anomaly_messages(client, vin, admin_id, admin_name)
        (huf,) = await _anomaly_messages(client, vin, owner_id, owner_name)

        assert "$" not in usd
        assert "was 80000.00 USD," in usd
        assert "$" not in huf
        assert "was 80000.00 HUF," in huf
    finally:
        await db_session.rollback()
        await db_session.execute(delete(FuelRecord).where(FuelRecord.vin == vin))
        await db_session.execute(delete(Vehicle).where(Vehicle.vin == vin))
        await db_session.execute(delete(User).where(User.id.in_(user_ids)))
        await db_session.commit()
