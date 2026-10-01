"""Admins arm and cancel a one-time SSO relink on an account.

An SSO email or username match never links an account by itself any more, so
when an IdP account is re-created and its subject changes, its owner is locked
out of SSO. `POST /auth/users/{id}/oidc-relink` opens a 30-minute window in
which the next matching SSO login links the account; `DELETE` closes it. Both
are admin-only and both leave an audit row.

Every assertion on the column reads the committed row over a second session.
"""

import datetime as dt
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.audit_log import AuditLog
from app.models.user import User
from app.utils.datetime_utils import utc_now

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

_WINDOW = dt.timedelta(minutes=30)
_ACTIONS = ("oidc_relink_allowed", "oidc_relink_revoked")


@dataclass(frozen=True)
class _Target:
    """Plain values of a created user, safe to hold across a rolled-back request."""

    id: int
    username: str


@pytest_asyncio.fixture
async def made_users(db_session: AsyncSession) -> AsyncIterator[list[int]]:
    """Collects users a test creates, and deletes them and their relink audit rows afterwards."""
    ids: list[int] = []
    yield ids
    await db_session.rollback()
    await db_session.execute(
        delete(AuditLog).where(
            AuditLog.action.in_(_ACTIONS), AuditLog.resource_id.in_([str(i) for i in ids])
        )
    )
    await db_session.execute(delete(User).where(User.id.in_(ids)))
    await db_session.commit()


async def _oidc_user(
    db_session: AsyncSession, made_users: list[int], *, relink_until: dt.datetime | None = None
) -> _Target:
    """An SSO-only account, linked to a subject its IdP may since have re-created."""
    tag = uuid.uuid4().hex[:10]
    user = User(
        username=f"relink_{tag}",
        email=f"relink_{tag}@example.com",
        hashed_password=None,
        is_active=True,
        is_admin=False,
        oidc_subject=f"sub-{tag}",
        oidc_provider="Rauthy",
        auth_method="oidc",
        oidc_relink_until=relink_until,
    )
    db_session.add(user)
    await db_session.commit()
    made_users.append(user.id)
    return _Target(user.id, user.username)


async def _stored_until(
    sessionmaker: async_sessionmaker[AsyncSession], user_id: int
) -> dt.datetime | None:
    """The committed oidc_relink_until, read over a second session."""
    async with sessionmaker() as fresh:
        user = await fresh.get(User, user_id)
        assert user is not None
        return user.oidc_relink_until


async def _audit_rows(
    sessionmaker: async_sessionmaker[AsyncSession], action: str, user_id: int
) -> list[AuditLog]:
    async with sessionmaker() as fresh:
        rows = await fresh.execute(
            select(AuditLog).where(AuditLog.action == action, AuditLog.resource_id == str(user_id))
        )
        return list(rows.scalars())


def _url(user_id: int) -> str:
    return f"/api/auth/users/{user_id}/oidc-relink"


class TestArm:
    async def test_admin_arms_a_relink_30_minutes_ahead(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        db_session: AsyncSession,
        auth_headers: dict[str, str],
        test_user: dict[str, object],
    ):
        target = await _oidc_user(db_session, made_users)
        before = utc_now()

        response = await client.post(_url(target.id), headers=auth_headers)

        after = utc_now()
        assert response.status_code == 200, response.text
        stored = await _stored_until(test_sessionmaker, target.id)
        assert stored is not None
        assert before + _WINDOW <= stored <= after + _WINDOW
        body = response.json()
        assert body["id"] == target.id
        assert dt.datetime.fromisoformat(body["oidc_relink_until"]) == stored

        rows = await _audit_rows(test_sessionmaker, "oidc_relink_allowed", target.id)
        assert len(rows) == 1
        assert rows[0].user_id == test_user["id"]
        assert rows[0].resource_type == "user"
        assert rows[0].details is not None
        assert rows[0].details["username"] == target.username

    async def test_arming_again_restarts_the_window(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        db_session: AsyncSession,
        auth_headers: dict[str, str],
    ):
        target = await _oidc_user(
            db_session, made_users, relink_until=utc_now() + dt.timedelta(minutes=2)
        )
        before = utc_now()

        response = await client.post(_url(target.id), headers=auth_headers)

        assert response.status_code == 200, response.text
        stored = await _stored_until(test_sessionmaker, target.id)
        assert stored is not None and stored >= before + _WINDOW

    async def test_an_overlong_user_agent_is_cut_to_the_column(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        db_session: AsyncSession,
        auth_headers: dict[str, str],
    ):
        """PostgreSQL refuses a value past String(500), which would fail the arm with it."""
        target = await _oidc_user(db_session, made_users)
        user_agent = f"o2-test/{uuid.uuid4().hex} ".ljust(2000, "x")

        response = await client.post(
            _url(target.id), headers={**auth_headers, "user-agent": user_agent}
        )

        assert response.status_code == 200, response.text
        assert await _stored_until(test_sessionmaker, target.id) is not None
        rows = await _audit_rows(test_sessionmaker, "oidc_relink_allowed", target.id)
        assert len(rows) == 1
        stored_ua = rows[0].user_agent
        assert stored_ua is not None
        assert len(stored_ua) == 500
        assert stored_ua == user_agent[:500]


class TestDisarm:
    async def test_admin_cancels_an_armed_relink(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        db_session: AsyncSession,
        auth_headers: dict[str, str],
        test_user: dict[str, object],
    ):
        target = await _oidc_user(db_session, made_users, relink_until=utc_now() + _WINDOW)

        response = await client.delete(_url(target.id), headers=auth_headers)

        assert response.status_code == 200, response.text
        assert response.json()["oidc_relink_until"] is None
        assert await _stored_until(test_sessionmaker, target.id) is None

        rows = await _audit_rows(test_sessionmaker, "oidc_relink_revoked", target.id)
        assert len(rows) == 1
        assert rows[0].user_id == test_user["id"]
        assert rows[0].details is not None
        assert rows[0].details["username"] == target.username


@pytest.mark.parametrize("method", ["post", "delete"])
class TestRefused:
    async def test_a_non_admin_gets_403_and_nothing_changes(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        db_session: AsyncSession,
        non_admin_headers: dict[str, str],
        method: str,
    ):
        armed = utc_now() + dt.timedelta(minutes=10)
        target = await _oidc_user(db_session, made_users, relink_until=armed)

        response = await getattr(client, method)(_url(target.id), headers=non_admin_headers)

        assert response.status_code == 403, response.text
        assert await _stored_until(test_sessionmaker, target.id) == armed
        for action in _ACTIONS:
            assert await _audit_rows(test_sessionmaker, action, target.id) == []

    async def test_an_unknown_user_is_404(
        self, client: AsyncClient, auth_headers: dict[str, str], method: str
    ):
        response = await getattr(client, method)(_url(2_000_000_000), headers=auth_headers)

        assert response.status_code == 404, response.text
        assert response.json()["detail"] == "User not found"


@pytest.mark.parametrize(
    ("method", "action"), [("post", "oidc_relink_allowed"), ("delete", "oidc_relink_revoked")]
)
async def test_with_auth_off_the_audit_row_has_no_actor(
    client: AsyncClient,
    test_sessionmaker: async_sessionmaker[AsyncSession],
    made_users: list[int],
    db_session: AsyncSession,
    set_auth_mode: Callable[[str], Awaitable[None]],
    method: str,
    action: str,
):
    """auth_mode=none hands the route no current user, which must not crash the audit."""
    target = await _oidc_user(db_session, made_users)
    await set_auth_mode("none")

    response = await getattr(client, method)(_url(target.id))

    assert response.status_code == 200, response.text
    rows = await _audit_rows(test_sessionmaker, action, target.id)
    assert len(rows) == 1
    assert rows[0].user_id is None


async def test_the_user_list_says_who_signs_in_with_sso_and_whether_a_relink_is_open(
    client: AsyncClient,
    made_users: list[int],
    db_session: AsyncSession,
    auth_headers: dict[str, str],
):
    """The admin card offers the relink to SSO users only and badges an open one."""
    armed = utc_now() + _WINDOW
    target = await _oidc_user(db_session, made_users, relink_until=armed)

    response = await client.get("/api/auth/users", params={"limit": 500}, headers=auth_headers)

    assert response.status_code == 200, response.text
    row = next(u for u in response.json() if u["id"] == target.id)
    assert row["auth_method"] == "oidc"
    assert dt.datetime.fromisoformat(row["oidc_relink_until"]) == armed
