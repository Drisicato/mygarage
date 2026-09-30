"""The admin user list names each SSO user's provider.

The Edit User dialog says "Identity managed by {provider}". It read
`oidc_provider` off the user, but `UserResponse` never carried it, so every SSO
user was "managed by external provider" whatever the IdP was called.
"""

import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

# argon2id of "testpassword123", as in tests/conftest.py.
_HASH = "$argon2id$v=19$m=102400,t=2,p=8$NNbLa8SMLODWY2Es68EvLw$hiGLA+DtO213EMAMi8D8gXvvyjP8EVMFIHWp7SlUVnI"


@pytest_asyncio.fixture
async def made_users(db_session: AsyncSession) -> AsyncIterator[list[int]]:
    """Collects users a test creates and deletes them afterwards."""
    ids: list[int] = []
    yield ids
    await db_session.rollback()
    await db_session.execute(delete(User).where(User.id.in_(ids)))
    await db_session.commit()


async def _user(db_session: AsyncSession, made_users: list[int], *, sso: bool) -> int:
    """An SSO-only account linked through "Rauthy", or a plain local one."""
    tag = uuid.uuid4().hex[:10]
    user = User(
        username=f"provider_{tag}",
        email=f"provider_{tag}@example.com",
        hashed_password=None if sso else _HASH,
        is_active=True,
        is_admin=False,
        oidc_subject=f"sub-{tag}" if sso else None,
        oidc_provider="Rauthy" if sso else None,
        auth_method="oidc" if sso else "local",
    )
    db_session.add(user)
    await db_session.commit()
    made_users.append(user.id)
    return user.id


async def _listed(client: AsyncClient, headers: dict[str, str], user_id: int) -> dict[str, object]:
    """The user's row in the list the Family Management page loads."""
    response = await client.get("/api/auth/users", params={"limit": 500}, headers=headers)
    assert response.status_code == 200, response.text
    return next(u for u in response.json() if u["id"] == user_id)


async def test_an_sso_user_is_listed_with_its_provider(
    client: AsyncClient,
    made_users: list[int],
    db_session: AsyncSession,
    auth_headers: dict[str, str],
):
    user_id = await _user(db_session, made_users, sso=True)

    row = await _listed(client, auth_headers, user_id)

    assert row["oidc_provider"] == "Rauthy"


async def test_a_local_user_is_listed_with_no_provider(
    client: AsyncClient,
    made_users: list[int],
    db_session: AsyncSession,
    auth_headers: dict[str, str],
):
    user_id = await _user(db_session, made_users, sso=False)

    row = await _listed(client, auth_headers, user_id)

    assert "oidc_provider" in row
    assert row["oidc_provider"] is None
