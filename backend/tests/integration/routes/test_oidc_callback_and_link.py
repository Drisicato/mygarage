"""The SSO callback and the Link Account step, driven over HTTP.

The service refuses an SSO login it can't confirm (`OIDCLoginRefusedError`),
and the callback used to let that escape as a 500. Now it's a 403 carrying the
message, an audit row that survives the request, and no auth cookie.

The link step used to link a disabled account and only then 403. It now refuses
a disabled account before it looks at the password, and burns the pending link
like every other refusal there.

A relink an admin armed is audited when it's used, with the callback request's
IP and user agent.

A password link is audited in the link's own commit, so a link can't land
without its row, and the row's details are a dict like every other writer's. A
user agent longer than the audit column is cut to fit, since PostgreSQL refuses
the insert otherwise.

The IdP round trip (state, discovery, token exchange, ID token check) is mocked
at the service boundary the route calls; everything after that is real.
"""

import datetime as dt
import uuid
from collections.abc import AsyncIterator, Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest
import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import delete, event, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.exceptions import OIDCLoginRefusedError
from app.models.audit_log import AuditLog
from app.models.csrf_token import CSRFToken
from app.models.oidc_pending_link import OIDCPendingLink
from app.models.settings import Setting
from app.models.user import User
from app.routes.oidc import limiter as oidc_route_limiter
from app.services.oidc import create_pending_link_token
from app.services.oidc import linking as oidc_linking
from app.utils.datetime_utils import utc_now

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

# argon2id of "testpassword123", as in tests/conftest.py.
_HASH = "$argon2id$v=19$m=102400,t=2,p=8$NNbLa8SMLODWY2Es68EvLw$hiGLA+DtO213EMAMi8D8gXvvyjP8EVMFIHWp7SlUVnI"
_PASSWORD = "testpassword123"
_LAST_LOGIN = dt.datetime(2024, 1, 2, 3, 4, 5)
_DISABLED = "User account is disabled"
_WATCHED = ("oidc_subject", "oidc_provider", "auth_method", "last_login", "full_name")

_STATE = {
    "redirect_uri": "http://test/api/auth/oidc/callback",
    "code_verifier": "verifier",
    "nonce": "nonce",
}
_METADATA = {
    "issuer": "https://idp.example",
    "authorization_endpoint": "https://idp.example/authorize",
    "token_endpoint": "https://idp.example/token",
    "jwks_uri": "https://idp.example/jwks",
}


@pytest_asyncio.fixture(autouse=True)
async def _oidc_rows(db_session: AsyncSession):
    """Start with no oidc_* settings and put the originals back afterwards."""
    rows = (await db_session.execute(select(Setting).where(Setting.key.like("oidc_%")))).scalars()
    saved = [(r.key, r.value, r.category, r.description, r.encrypted) for r in rows]
    await db_session.execute(delete(Setting).where(Setting.key.like("oidc_%")))
    await db_session.commit()
    yield
    await db_session.rollback()
    await db_session.execute(delete(Setting).where(Setting.key.like("oidc_%")))
    for key, value, category, description, encrypted in saved:
        db_session.add(
            Setting(
                key=key,
                value=value,
                category=category,
                description=description,
                encrypted=encrypted,
            )
        )
    await db_session.commit()


@pytest.fixture(autouse=True)
def _fresh_link_limit() -> Iterator[None]:
    """/link-account allows 5 a minute per address, and every request here is one address."""
    oidc_route_limiter.reset()
    yield
    oidc_route_limiter.reset()


@dataclass(frozen=True)
class _Account:
    """Plain values of a created user. A 403 rolls the shared session back and expires the ORM object."""

    id: int
    username: str
    email: str
    row: dict[str, Any]


@pytest_asyncio.fixture
async def made_users(db_session: AsyncSession) -> AsyncIterator[list[_Account]]:
    """Collects users a test creates and deletes them, and what hangs off them, afterwards."""
    accounts: list[_Account] = []
    yield accounts
    await db_session.rollback()
    ids = [a.id for a in accounts]
    names = [a.username for a in accounts]
    # Core deletes: a linked user owns CSRF tokens, and an ORM delete would null their FK.
    await db_session.execute(delete(OIDCPendingLink).where(OIDCPendingLink.username.in_(names)))
    await db_session.execute(delete(CSRFToken).where(CSRFToken.user_id.in_(ids)))
    await db_session.execute(delete(User).where(User.id.in_(ids)))
    await db_session.commit()


@pytest_asyncio.fixture
async def user_agent(db_session: AsyncSession) -> AsyncIterator[str]:
    """A user agent no other test sends, so this test's audit rows are its own."""
    ua = f"o2-test/{uuid.uuid4().hex}"
    yield ua
    await db_session.rollback()
    await db_session.execute(delete(AuditLog).where(AuditLog.user_agent == ua))
    await db_session.commit()


@pytest_asyncio.fixture
async def long_user_agent(db_session: AsyncSession) -> AsyncIterator[str]:
    """A unique 2,000-character user agent, four times what the audit column holds."""
    prefix = f"o2-test/{uuid.uuid4().hex} "
    ua = prefix + "x" * (2000 - len(prefix))
    yield ua
    await db_session.rollback()
    await db_session.execute(
        delete(AuditLog).where(AuditLog.user_agent.startswith(prefix, autoescape=True))
    )
    await db_session.commit()


async def _account(
    db_session: AsyncSession,
    made_users: list[_Account],
    *,
    active: bool = True,
    relink_until: dt.datetime | None = None,
) -> _Account:
    """A local password account with a fixed past last_login, so any write to it shows."""
    tag = uuid.uuid4().hex[:10]
    user = User(
        username=f"acct_{tag}",
        email=f"acct_{tag}@example.com",
        hashed_password=_HASH,
        full_name="Original Name",
        is_active=active,
        is_admin=False,
        auth_method="local",
        last_login=_LAST_LOGIN,
        oidc_relink_until=relink_until,
    )
    db_session.add(user)
    await db_session.commit()
    account = _Account(user.id, user.username, user.email, _snapshot(user))
    made_users.append(account)
    return account


def _claims(**given: Any) -> dict[str, Any]:
    """ID token claims; anything not given is unique, so it matches nothing."""
    tag = uuid.uuid4().hex[:10]
    return {
        "sub": f"sub-{tag}",
        "email": f"sso_{tag}@example.com",
        "preferred_username": f"sso_{tag}",
        "name": "Claimed Name",
        **given,
    }


@contextmanager
def _idp(claims: dict[str, Any]) -> Generator[None]:
    """A valid state, discovery, a token exchange with no access token, and these claims."""
    with (
        patch(
            "app.services.oidc.validate_and_consume_state",
            new_callable=AsyncMock,
            return_value=dict(_STATE),
        ),
        patch(
            "app.services.oidc.get_provider_metadata",
            new_callable=AsyncMock,
            return_value=dict(_METADATA),
        ),
        patch(
            "app.services.oidc.exchange_code_for_tokens",
            new_callable=AsyncMock,
            return_value={"id_token": "id-token"},
        ),
        patch("app.services.oidc.verify_id_token", new_callable=AsyncMock, return_value=claims),
    ):
        yield


async def _callback(client: AsyncClient, user_agent: str) -> Response:
    return await client.get(
        "/api/auth/oidc/callback",
        params={"code": "code", "state": "state"},
        headers={"user-agent": user_agent},
        follow_redirects=False,
    )


async def _link(client: AsyncClient, token: str, password: str, user_agent: str) -> Response:
    return await client.post(
        "/api/auth/oidc/link-account",
        json={"token": token, "password": password},
        headers={"user-agent": user_agent},
    )


def _sets_auth_cookie(response: Response) -> bool:
    return any(
        cookie.startswith(f"{settings.jwt_cookie_name}=")
        for cookie in response.headers.get_list("set-cookie")
    )


def _snapshot(user: User) -> dict[str, Any]:
    return {field: getattr(user, field) for field in _WATCHED}


async def _stored_user(sessionmaker: async_sessionmaker[AsyncSession], user_id: int) -> User:
    """The committed row, read over a second session so nothing in the test's identity map leaks in."""
    async with sessionmaker() as fresh:
        user = await fresh.get(User, user_id)
        assert user is not None
        return user


async def _stored_pending_link(
    sessionmaker: async_sessionmaker[AsyncSession], token: str
) -> OIDCPendingLink | None:
    async with sessionmaker() as fresh:
        return await fresh.get(OIDCPendingLink, token)


async def _audit_rows(
    sessionmaker: async_sessionmaker[AsyncSession], user_agent: str
) -> list[AuditLog]:
    """Every committed audit row this test's requests wrote, oldest first."""
    async with sessionmaker() as fresh:
        rows = await fresh.execute(
            select(AuditLog).where(AuditLog.user_agent == user_agent).order_by(AuditLog.id)
        )
        return list(rows.scalars())


async def _refusal_rows(
    sessionmaker: async_sessionmaker[AsyncSession], user_agent: str
) -> list[AuditLog]:
    """Committed `oidc_login_refused` rows this test's requests wrote."""
    async with sessionmaker() as fresh:
        rows = await fresh.execute(
            select(AuditLog).where(
                AuditLog.user_agent == user_agent, AuditLog.action == "oidc_login_refused"
            )
        )
        return list(rows.scalars())


class _AuditInsertError(Exception):
    """Raised in place of an audit row's INSERT."""


@contextmanager
def _failing_audit_insert(action: str) -> Generator[None]:
    """Fail the flush that would insert an audit row with this action."""

    def refuse(_mapper: Any, _connection: Any, target: AuditLog) -> None:
        if target.action == action:
            raise _AuditInsertError(action)

    event.listen(AuditLog, "before_insert", refuse)
    try:
        yield
    finally:
        event.remove(AuditLog, "before_insert", refuse)


def _assert_refusal_row(rows: list[AuditLog], *, reason: str, username: str | None) -> None:
    assert len(rows) == 1, f"expected one oidc_login_refused row, got {len(rows)}"
    row = rows[0]
    assert row.username == username
    assert row.details == {"reason": reason}
    assert row.success == 0
    assert row.ip_address == "127.0.0.1"


class TestCallbackRefusal:
    @pytest.mark.parametrize("matched", [False, True], ids=["no-match", "matched-account"])
    async def test_a_refused_login_is_a_403_with_the_message_and_no_cookie(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        user_agent: str,
        matched: bool,
    ):
        username = f"refused_{uuid.uuid4().hex[:10]}" if matched else None
        refusal = OIDCLoginRefusedError("x", username=username)

        with (
            _idp(_claims()),
            patch(
                "app.services.oidc.create_or_update_user_from_oidc",
                new_callable=AsyncMock,
                side_effect=refusal,
            ),
        ):
            response = await _callback(client, user_agent)

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == "x"
        assert not _sets_auth_cookie(response)
        # get_db rolls back on the 403, so the row is only here if the route committed it.
        _assert_refusal_row(
            await _refusal_rows(test_sessionmaker, user_agent), reason="x", username=username
        )

    async def test_a_refusal_commits_the_audit_row_and_nothing_else(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        """The audit commit must not carry a link the refused step had half applied."""
        target = await _account(db_session, made_users)

        async def half_applied_then_refused(db: AsyncSession, *_: Any, **__: Any) -> None:
            user = await db.get(User, target.id)
            assert user is not None
            user.oidc_subject = "sub-half-applied"
            user.auth_method = "oidc"
            raise OIDCLoginRefusedError(_DISABLED, username=target.username)

        with (
            _idp(_claims()),
            patch(
                "app.services.oidc.create_or_update_user_from_oidc",
                new=half_applied_then_refused,
            ),
        ):
            response = await _callback(client, user_agent)

        assert response.status_code == 403, response.text
        assert _snapshot(await _stored_user(test_sessionmaker, target.id)) == target.row
        _assert_refusal_row(
            await _refusal_rows(test_sessionmaker, user_agent),
            reason=_DISABLED,
            username=target.username,
        )

    async def test_the_callback_backstop_refuses_a_disabled_user_and_audits_it(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        """The service refuses a disabled account itself, so this is an admin disable mid-login."""
        target = await _account(db_session, made_users, active=False)
        disabled = await db_session.get(User, target.id)

        with (
            _idp(_claims()),
            patch(
                "app.services.oidc.create_or_update_user_from_oidc",
                new_callable=AsyncMock,
                return_value=disabled,
            ),
        ):
            response = await _callback(client, user_agent)

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == _DISABLED
        assert not _sets_auth_cookie(response)
        _assert_refusal_row(
            await _refusal_rows(test_sessionmaker, user_agent),
            reason=_DISABLED,
            username=target.username,
        )


class TestLinkStepInactiveTarget:
    @pytest.mark.parametrize(
        "password", [_PASSWORD, "not-the-password"], ids=["right-password", "wrong-password"]
    )
    async def test_a_disabled_target_is_refused_before_the_password_and_links_nothing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
        password: str,
    ):
        target = await _account(db_session, made_users, active=False)
        token = await create_pending_link_token(
            db_session, target.username, _claims(email=target.email), None, {}
        )

        response = await _link(client, token, password, user_agent)

        # 403, never 401: a wrong password would only 401 if the password were checked first.
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == _DISABLED
        assert not _sets_auth_cookie(response)

        stored = await _stored_user(test_sessionmaker, target.id)
        assert stored.oidc_subject is None
        assert stored.auth_method == "local"
        assert _snapshot(stored) == target.row, "the disabled account's row changed"

        # The refusal burns the pending link, like every other refusal in the link step.
        assert await _stored_pending_link(test_sessionmaker, token) is None
        _assert_refusal_row(
            await _refusal_rows(test_sessionmaker, user_agent),
            reason=_DISABLED,
            username=target.username,
        )

    async def test_a_user_disabled_mid_link_keeps_the_link_row_and_gets_the_refusal(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        """An admin disable that lands after the link step's check, before the route's backstop."""
        target = await _account(db_session, made_users)
        token = await create_pending_link_token(
            db_session, target.username, _claims(email=target.email), None, {}
        )
        real_link = oidc_linking.validate_and_consume_pending_link

        async def link_then_disable(
            db: AsyncSession, *args: Any, **kwargs: Any
        ) -> tuple[User | None, str | None]:
            user, error = await real_link(db, *args, **kwargs)
            assert user is not None, error
            async with test_sessionmaker() as admin:
                await admin.execute(update(User).where(User.id == user.id).values(is_active=False))
                await admin.commit()
            await db.refresh(user)
            return user, error

        with patch("app.services.oidc.validate_and_consume_pending_link", new=link_then_disable):
            response = await _link(client, token, _PASSWORD, user_agent)

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == _DISABLED
        assert not _sets_auth_cookie(response)
        # The link committed with its row, then the backstop refused the login.
        rows = await _audit_rows(test_sessionmaker, user_agent)
        assert [r.action for r in rows] == ["oidc_account_linked", "oidc_login_refused"]
        _assert_refusal_row(rows[1:], reason=_DISABLED, username=target.username)


class TestLinkAudit:
    async def test_a_link_writes_one_row_with_the_username_and_dict_details(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        target = await _account(db_session, made_users)
        claims = _claims(email=target.email)
        token = await create_pending_link_token(
            db_session, target.username, claims, None, {"provider_name": "Rauthy"}
        )

        response = await _link(client, token, _PASSWORD, user_agent)

        assert response.status_code == 200, response.text
        rows = await _audit_rows(test_sessionmaker, user_agent)
        assert [r.action for r in rows] == ["oidc_account_linked"]
        row = rows[0]
        assert row.user_id == target.id
        assert row.username == target.username
        assert row.details == {"provider": "Rauthy", "oidc_subject": claims["sub"]}
        assert row.success == 1
        assert row.ip_address == "127.0.0.1"

    async def test_a_wrong_password_is_audited_with_the_reason_in_a_dict(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        target = await _account(db_session, made_users)
        token = await create_pending_link_token(
            db_session, target.username, _claims(email=target.email), None, {}
        )

        response = await _link(client, token, "not-the-password", user_agent)

        assert response.status_code == 401, response.text
        reason = "Invalid password. 2 attempt(s) remaining."
        assert response.json()["detail"] == reason
        rows = await _audit_rows(test_sessionmaker, user_agent)
        assert [(r.action, r.details) for r in rows] == [("oidc_link_failed", {"reason": reason})]

    async def test_a_failed_audit_insert_commits_neither_the_link_nor_the_token(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        """No link without its audit row, and the token is still there to try again."""
        target = await _account(db_session, made_users)
        token = await create_pending_link_token(
            db_session, target.username, _claims(email=target.email), None, {}
        )

        with _failing_audit_insert("oidc_account_linked"), pytest.raises(_AuditInsertError):
            await _link(client, token, _PASSWORD, user_agent)

        stored = await _stored_user(test_sessionmaker, target.id)
        assert stored.oidc_subject is None, "the link committed without its audit row"
        assert _snapshot(stored) == target.row
        assert await _stored_pending_link(test_sessionmaker, token) is not None
        assert await _audit_rows(test_sessionmaker, user_agent) == []

    async def test_an_overlong_user_agent_is_cut_to_the_column(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        long_user_agent: str,
    ):
        """PostgreSQL refuses a value past String(500), which would fail the link with it."""
        target = await _account(db_session, made_users)
        claims = _claims(email=target.email)
        token = await create_pending_link_token(db_session, target.username, claims, None, {})

        response = await _link(client, token, _PASSWORD, long_user_agent)

        assert response.status_code == 200, response.text
        assert (await _stored_user(test_sessionmaker, target.id)).oidc_subject == claims["sub"]
        async with test_sessionmaker() as fresh:
            rows = list(
                (
                    await fresh.execute(
                        select(AuditLog).where(
                            AuditLog.user_id == target.id,
                            AuditLog.action == "oidc_account_linked",
                        )
                    )
                ).scalars()
            )
        assert len(rows) == 1, f"expected one oidc_account_linked row, got {len(rows)}"
        stored_ua = rows[0].user_agent
        assert stored_ua is not None
        assert len(stored_ua) == 500
        assert stored_ua == long_user_agent[:500]


class TestEmailStepEndToEnd:
    async def test_an_email_match_links_that_account_after_its_password(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        target = await _account(db_session, made_users)
        # The claimed username matches nothing, so only the email step can find the account.
        claims = _claims(email=target.email)

        with _idp(claims):
            response = await _callback(client, user_agent)

        assert response.status_code == 302, response.text
        assert not _sets_auth_cookie(response)
        location = urlsplit(response.headers["location"])
        assert location.path == "/auth/link-account"
        token = parse_qs(location.query)["token"][0]

        pending = await _stored_pending_link(test_sessionmaker, token)
        assert pending is not None
        assert pending.username == target.username
        untouched = await _stored_user(test_sessionmaker, target.id)
        assert untouched.oidc_subject is None, "the callback linked before the password"

        response = await _link(client, token, _PASSWORD, user_agent)

        assert response.status_code == 200, response.text
        assert _sets_auth_cookie(response)
        linked = await _stored_user(test_sessionmaker, target.id)
        assert linked.oidc_subject == claims["sub"]
        assert linked.auth_method == "oidc"
        assert await _stored_pending_link(test_sessionmaker, token) is None
        assert await _refusal_rows(test_sessionmaker, user_agent) == []


class TestArmedRelinkThroughTheCallback:
    async def test_a_used_relink_is_audited_with_the_requests_ip_and_user_agent(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[_Account],
        user_agent: str,
    ):
        """The service has no request, so the callback hands it where the sign-in came from."""
        target = await _account(
            db_session, made_users, relink_until=utc_now() + dt.timedelta(minutes=30)
        )
        claims = _claims(email=target.email)

        with _idp(claims):
            response = await _callback(client, user_agent)

        assert response.status_code == 302, response.text
        assert urlsplit(response.headers["location"]).path == "/auth/oidc/success"
        assert _sets_auth_cookie(response)
        linked = await _stored_user(test_sessionmaker, target.id)
        assert linked.oidc_subject == claims["sub"]
        assert linked.oidc_relink_until is None

        async with test_sessionmaker() as fresh:
            rows = list(
                (
                    await fresh.execute(
                        select(AuditLog).where(
                            AuditLog.user_agent == user_agent,
                            AuditLog.action == "oidc_relink_used",
                        )
                    )
                ).scalars()
            )
        assert len(rows) == 1, f"expected one oidc_relink_used row, got {len(rows)}"
        assert rows[0].user_id == target.id
        assert rows[0].username == target.username
        assert rows[0].ip_address == "127.0.0.1"
        assert rows[0].details == {"old_subject": None, "new_subject": claims["sub"]}
