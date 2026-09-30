"""An SSO email match used to link into the matching account with no password.

That was an account takeover three ways: an IdP that lets users set an unverified
email, a local user setting their email to a colleague's unused address, and a
second IdP identity with the same email overwriting the first one's link.

Now an email match only picks which account to offer. A password account goes to
the password-link page for its own username; everything else is refused. Every
refusal leaves the matched row alone, in memory and in the database.
"""

import datetime as dt
import uuid
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import OIDCLoginRefusedError, PendingLinkRequiredError
from app.models.settings import Setting
from app.models.user import User
from app.services.oidc import create_or_update_user_from_oidc

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

# argon2id of "testpassword123", as in tests/conftest.py.
_HASH = "$argon2id$v=19$m=102400,t=2,p=8$NNbLa8SMLODWY2Es68EvLw$hiGLA+DtO213EMAMi8D8gXvvyjP8EVMFIHWp7SlUVnI"
_LAST_LOGIN = dt.datetime(2024, 1, 2, 3, 4, 5)
_WATCHED = ("oidc_subject", "oidc_provider", "auth_method", "last_login", "full_name")

_DISABLED = "User account is disabled"
_EMAIL_LINKED_ELSEWHERE = (
    "This email belongs to an account that is linked to a different sign-in. "
    "Ask an administrator to allow an SSO relink for it."
)
_EMAIL_NO_PASSWORD = (
    "An account with this email exists but has no password to confirm it. "
    "Ask an administrator to allow an SSO relink for it."
)
_USERNAME_LINKED_ELSEWHERE = (
    "This username belongs to an account that is linked to a different sign-in. "
    "Ask an administrator to allow an SSO relink for it."
)
_USERNAME_NO_PASSWORD = (
    "An account with this username exists but has no password to confirm it. "
    "Ask an administrator to allow an SSO relink for it."
)


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


@pytest_asyncio.fixture
async def made_users(db_session: AsyncSession):
    """Collects users a test creates and deletes them afterwards."""
    ids: list[int] = []
    yield ids
    await db_session.rollback()
    for user_id in ids:
        user = await db_session.get(User, user_id)
        if user is not None:
            await db_session.delete(user)
    await db_session.commit()


async def _account(
    db_session: AsyncSession,
    made_users: list[int],
    *,
    password: bool = True,
    subject: str | None = None,
    active: bool = True,
) -> User:
    """A MyGarage account with a fixed past last_login, so any write to it shows."""
    tag = uuid.uuid4().hex[:10]
    user = User(
        username=f"acct_{tag}",
        email=f"acct_{tag}@example.com",
        hashed_password=_HASH if password else None,
        full_name="Original Name",
        is_active=active,
        is_admin=False,
        oidc_subject=subject,
        oidc_provider="Old IdP" if subject else None,
        auth_method="oidc" if subject else "local",
        last_login=_LAST_LOGIN,
    )
    db_session.add(user)
    await db_session.commit()
    made_users.append(user.id)
    return user


def _claims(
    *, sub: str | None = None, email: str | None = None, username: str | None = None, **extra: Any
) -> dict[str, Any]:
    """ID token claims; anything not given is unique, so it matches nothing."""
    tag = uuid.uuid4().hex[:10]
    return {
        "sub": sub or f"sub-{tag}",
        "email": email or f"sso_{tag}@example.com",
        "preferred_username": username or f"sso_{tag}",
        "name": "Claimed Name",
        **extra,
    }


async def _login(db_session: AsyncSession, claims: dict[str, Any]) -> object:
    """Run the SSO resolution and hand back whatever came out, raised or returned."""
    try:
        return await create_or_update_user_from_oidc(db_session, claims, None, {})
    except Exception as exc:
        return exc


def _snapshot(user: User) -> dict[str, Any]:
    return {field: getattr(user, field) for field in _WATCHED}


async def _assert_untouched(db_session: AsyncSession, user: User, before: dict[str, Any]) -> None:
    """The row is unchanged in memory, then again after a flush and a re-read."""
    assert _snapshot(user) == before, "the matched row changed in memory"
    # autoflush is off, so a bare refresh() would throw away a pending change.
    await db_session.flush()
    await db_session.refresh(user)
    assert _snapshot(user) == before, "the matched row changed in the database"


def _assert_refused(outcome: object, message: str, username: str) -> None:
    assert isinstance(outcome, OIDCLoginRefusedError), f"expected a refusal, got {outcome!r}"
    assert outcome.message == message
    assert outcome.username == username


# 1. Email matches a password account: the password page, for that account.
async def test_email_match_with_password_goes_to_that_accounts_password_page(
    db_session: AsyncSession, made_users: list[int]
):
    account = await _account(db_session, made_users)
    before = _snapshot(account)
    claims = _claims(email=account.email)
    assert claims["preferred_username"] != account.username

    outcome = await _login(db_session, claims)

    await _assert_untouched(db_session, account, before)
    assert isinstance(outcome, PendingLinkRequiredError), f"got {outcome!r}"
    assert outcome.username == account.username
    assert outcome.claims == claims


# 2. Email matches an account linked to another subject: refused, old link kept.
@pytest.mark.parametrize("password", [True, False], ids=["with-password", "sso-only"])
async def test_email_match_linked_elsewhere_is_refused(
    db_session: AsyncSession, made_users: list[int], password: bool
):
    old_sub = f"old-{uuid.uuid4().hex[:10]}"
    account = await _account(db_session, made_users, password=password, subject=old_sub)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(email=account.email))

    await _assert_untouched(db_session, account, before)
    assert account.oidc_subject == old_sub
    _assert_refused(outcome, _EMAIL_LINKED_ELSEWHERE, account.username)


# 3. Email matches an account with no password and no link: nothing to prove it with.
async def test_email_match_without_password_is_refused(
    db_session: AsyncSession, made_users: list[int]
):
    account = await _account(db_session, made_users, password=False)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(email=account.email))

    await _assert_untouched(db_session, account, before)
    _assert_refused(outcome, _EMAIL_NO_PASSWORD, account.username)


# 4. Email matches an inactive account: disabled wins over every other state.
@pytest.mark.parametrize(
    ("password", "linked"),
    [(True, False), (False, False), (True, True)],
    ids=["with-password", "no-password", "linked-elsewhere"],
)
async def test_email_match_on_inactive_account_is_refused_as_disabled(
    db_session: AsyncSession, made_users: list[int], password: bool, linked: bool
):
    subject = f"old-{uuid.uuid4().hex[:10]}" if linked else None
    account = await _account(
        db_session, made_users, password=password, subject=subject, active=False
    )
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(email=account.email))

    await _assert_untouched(db_session, account, before)
    _assert_refused(outcome, _DISABLED, account.username)


# 5. email_verified is never read: case 1 again, same answer either way.
@pytest.mark.parametrize("verified", [True, False])
async def test_email_verified_changes_nothing(
    db_session: AsyncSession, made_users: list[int], verified: bool
):
    account = await _account(db_session, made_users)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(email=account.email, email_verified=verified))

    await _assert_untouched(db_session, account, before)
    assert isinstance(outcome, PendingLinkRequiredError), f"got {outcome!r}"
    assert outcome.username == account.username


# 6. Subject matches an inactive user: refused before last_login is touched.
async def test_subject_match_on_inactive_user_is_refused(
    db_session: AsyncSession, made_users: list[int]
):
    sub = f"sub-{uuid.uuid4().hex[:10]}"
    account = await _account(db_session, made_users, subject=sub, active=False)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(sub=sub))

    await _assert_untouched(db_session, account, before)
    _assert_refused(outcome, _DISABLED, account.username)


async def test_subject_match_on_active_user_still_logs_in(
    db_session: AsyncSession, made_users: list[int]
):
    """Guard: the normal SSO login still refreshes the row."""
    sub = f"sub-{uuid.uuid4().hex[:10]}"
    account = await _account(db_session, made_users, subject=sub)

    outcome = await _login(db_session, _claims(sub=sub))

    assert outcome is account
    assert account.oidc_subject == sub
    assert account.full_name == "Claimed Name"
    assert account.oidc_provider == "OIDC Provider"
    assert account.last_login is not None and account.last_login > _LAST_LOGIN


# 7. The username step: its two conflicts and an inactive account are refusals.
async def test_username_match_sso_only_is_refused(db_session: AsyncSession, made_users: list[int]):
    account = await _account(db_session, made_users, password=False)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(username=account.username))

    await _assert_untouched(db_session, account, before)
    _assert_refused(outcome, _USERNAME_NO_PASSWORD, account.username)


async def test_username_match_linked_elsewhere_is_refused(
    db_session: AsyncSession, made_users: list[int]
):
    old_sub = f"old-{uuid.uuid4().hex[:10]}"
    account = await _account(db_session, made_users, subject=old_sub)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(username=account.username))

    await _assert_untouched(db_session, account, before)
    _assert_refused(outcome, _USERNAME_LINKED_ELSEWHERE, account.username)


@pytest.mark.parametrize("password", [True, False], ids=["with-password", "sso-only"])
async def test_username_match_on_inactive_account_is_refused_as_disabled(
    db_session: AsyncSession, made_users: list[int], password: bool
):
    account = await _account(db_session, made_users, password=password, active=False)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(username=account.username))

    await _assert_untouched(db_session, account, before)
    _assert_refused(outcome, _DISABLED, account.username)


async def test_clean_username_match_still_goes_to_password_page(
    db_session: AsyncSession, made_users: list[int]
):
    """Guard: an active, unlinked password account matched by username is unchanged."""
    account = await _account(db_session, made_users)
    before = _snapshot(account)

    outcome = await _login(db_session, _claims(username=account.username))

    await _assert_untouched(db_session, account, before)
    assert isinstance(outcome, PendingLinkRequiredError), f"got {outcome!r}"
    assert outcome.username == account.username


# 8. No match at all: auto-create, as before.
async def test_no_match_auto_creates_the_user(db_session: AsyncSession, made_users: list[int]):
    claims = _claims()

    outcome = await _login(db_session, claims)

    assert isinstance(outcome, User), f"got {outcome!r}"
    made_users.append(outcome.id)
    assert outcome.username == claims["preferred_username"]
    assert outcome.email == claims["email"]
    assert outcome.oidc_subject == claims["sub"]
    assert outcome.auth_method == "oidc"
    assert outcome.hashed_password is None
    assert outcome.is_active is True
    assert outcome.full_name == "Claimed Name"
