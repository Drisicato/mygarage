"""Integration tests for shop discovery recommendations.

The Address Book page stores the category chip as "Service", and this route
compared against an exact lowercase "service", so no shop added there was ever
recommended. Same family as #194.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.address_book import AddressBookEntry

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def test_a_service_shop_from_the_address_book_is_recommended(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """A used shop saved with the "Service" chip shows up in the recommendations."""
    name = f"ZZ Shop Rec {uuid.uuid4().hex[:8]}"
    try:
        # Far above any other row's usage, so the limit can't push it out.
        db_session.add(AddressBookEntry(business_name=name, category="Service", usage_count=10_000))
        await db_session.commit()

        response = await client.get(
            "/api/shop-discovery/recommendations", headers=auth_headers, params={"limit": 50}
        )

        assert response.status_code == 200, response.text
        names = [r["business_name"] for r in response.json()["recommendations"]]
        assert name in names
    finally:
        await db_session.rollback()
        await db_session.execute(
            delete(AddressBookEntry).where(AddressBookEntry.business_name == name)
        )
        await db_session.commit()
