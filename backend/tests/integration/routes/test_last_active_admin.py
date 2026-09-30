"""The last active admin can't be disabled, demoted or deleted.

`PUT /auth/users/{id}` had no last-admin check at all, so an admin could
disable or demote the only admin left and lock everyone out of the admin
pages. `DELETE` counted every admin, disabled ones included, and took no
lock, so "disable yourself" racing "delete the other admin" left none.

The guard is one locked pre-read of the active admins, a re-read of the
target under its own lock, then the write and a flush, then a plain
re-count. The race tests hand the pre-read a stale count and lean on the
re-count; the stale re-count tests do the opposite, so each half has a test
that fails without it. The target is judged from the re-read, never the
route's first read, because a disabled admin can be enabled in between.

The shared database already holds active admins (`testuser`, `family_admin`),
so `sole_admin` switches every other active admin off, checks the target is
the only one left, and `flags_restored` puts every user's flags back.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
import pytest_asyncio
from fastapi import Depends
from httpx import AsyncClient, Response
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.database import get_db
from app.main import app
from app.models.user import User
from app.routes import auth as auth_routes
from app.services.auth import create_access_token, get_current_admin_user

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

# argon2id of "testpassword123", as in tests/conftest.py.
_HASH = "$argon2id$v=19$m=102400,t=2,p=8$NNbLa8SMLODWY2Es68EvLw$hiGLA+DtO213EMAMi8D8gXvvyjP8EVMFIHWp7SlUVnI"
_NAME = "Original Name"
_REFUSED = {
    "disable": "Cannot disable or demote the last active admin",
    "demote": "Cannot disable or demote the last active admin",
    "delete": "Cannot delete the last active admin",
}


@dataclass(frozen=True)
class _Account:
    """Plain values of a created user. A 400 rolls the shared session back and expires the ORM object."""

    id: int
    headers: dict[str, str]


@dataclass(frozen=True)
class _Stored:
    """The committed flags and name of a user row."""

    is_active: bool
    is_admin: bool
    full_name: str | None


@pytest_asyncio.fixture
async def made_users(db_session: AsyncSession) -> AsyncIterator[list[int]]:
    """Collects users a test creates and deletes them afterwards."""
    ids: list[int] = []
    yield ids
    await db_session.rollback()
    await db_session.execute(delete(User).where(User.id.in_(ids)))
    await db_session.commit()


async def _user(
    db_session: AsyncSession, made_users: list[int], *, active: bool, admin: bool = True
) -> _Account:
    """A user with a known name, an admin unless told otherwise, with a bearer token of its own."""
    tag = uuid.uuid4().hex[:10]
    user = User(
        username=f"lastadmin_{tag}",
        email=f"lastadmin_{tag}@example.com",
        hashed_password=_HASH,
        full_name=_NAME,
        is_active=active,
        is_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    made_users.append(user.id)
    token = create_access_token(data={"sub": str(user.id), "username": user.username})
    return _Account(user.id, {"Authorization": f"Bearer {token}"})


async def _stored(sessionmaker: async_sessionmaker[AsyncSession], user_id: int) -> _Stored | None:
    """The committed row, read over a second session so nothing in the test's identity map leaks in."""
    async with sessionmaker() as fresh:
        user = await fresh.get(User, user_id)
        if user is None:
            return None
        return _Stored(user.is_active, user.is_admin, user.full_name)


async def _active_admin_ids(sessionmaker: async_sessionmaker[AsyncSession]) -> list[int]:
    """The committed active admins, read over a second session."""
    async with sessionmaker() as fresh:
        rows = await fresh.execute(
            select(User.id).where(User.is_admin.is_(True), User.is_active.is_(True))
        )
        return sorted(rows.scalars())


async def _others_commit(
    sessionmaker: async_sessionmaker[AsyncSession], *, enable: int, disable: int
) -> None:
    """Two other admins' requests land: one enables `enable`, one disables `disable`."""
    async with sessionmaker() as other:
        await other.execute(update(User).where(User.id == enable).values(is_active=True))
        await other.execute(update(User).where(User.id == disable).values(is_active=False))
        await other.commit()


@pytest_asyncio.fixture
async def flags_restored(
    db_session: AsyncSession, test_user: dict[str, object]
) -> AsyncIterator[None]:
    """Snapshot every user's flags and put them back afterwards.

    Takes `test_user` so `testuser` exists before the snapshot. The restore is
    this fixture's teardown, so it still runs when a fixture built on it fails
    its precondition; otherwise `family_admin` and friends would stay disabled
    for the rest of the run.
    """
    rows = await db_session.execute(select(User.id, User.is_active, User.is_admin))
    snapshot = {uid: (active, admin) for uid, active, admin in rows.all()}
    yield
    await db_session.rollback()
    rows = await db_session.execute(select(User.id, User.is_active, User.is_admin))
    for uid, active, admin in rows.all():
        saved = snapshot.get(uid)
        if saved is not None and saved != (active, admin):
            await db_session.execute(
                update(User).where(User.id == uid).values(is_active=saved[0], is_admin=saved[1])
            )
    await db_session.commit()


async def _disable_active_admins(db_session: AsyncSession, *, keep: int | None) -> None:
    """Switch off every active admin except `keep`."""
    query = update(User).where(User.is_admin.is_(True), User.is_active.is_(True))
    if keep is not None:
        query = query.where(User.id != keep)
    await db_session.execute(query.values(is_active=False))
    await db_session.commit()


@pytest_asyncio.fixture
async def sole_admin(
    db_session: AsyncSession,
    test_sessionmaker: async_sessionmaker[AsyncSession],
    flags_restored: None,
    made_users: list[int],
) -> _Account:
    """A new admin who is the only active one."""
    target = await _user(db_session, made_users, active=True)
    await _disable_active_admins(db_session, keep=target.id)
    assert await _active_admin_ids(test_sessionmaker) == [target.id]
    return target


@pytest_asyncio.fixture
async def no_active_admin(
    db_session: AsyncSession,
    test_sessionmaker: async_sessionmaker[AsyncSession],
    flags_restored: None,
) -> None:
    """Nobody is an active admin, the state the recovery path starts from."""
    await _disable_active_admins(db_session, keep=None)
    assert await _active_admin_ids(test_sessionmaker) == []


@pytest_asyncio.fixture
async def disabled_caller(
    db_session: AsyncSession, made_users: list[int]
) -> AsyncIterator[_Account]:
    """The caller is an admin whose row is already disabled.

    That's the state a delete sees when the caller's own disable committed after
    this request got past auth. The caller is never the target, so this is the
    only way a delete can take out the last active admin.
    """
    caller = await _user(db_session, made_users, active=False)

    async def admin_who_was_just_disabled(db: AsyncSession = Depends(get_db)) -> User | None:
        return await db.get(User, caller.id)

    app.dependency_overrides[get_current_admin_user] = admin_who_was_just_disabled
    yield caller
    app.dependency_overrides.pop(get_current_admin_user, None)


async def _put(client: AsyncClient, target: _Account, body: dict[str, object]) -> Response:
    """The target edits itself, like an admin saving their own Edit User dialog."""
    return await client.put(f"/api/auth/users/{target.id}", json=body, headers=target.headers)


async def _reduce(client: AsyncClient, op: str, target: _Account) -> Response:
    """Disable, demote or delete the target, as whoever `get_current_admin_user` resolves to."""
    if op == "disable":
        return await client.put(f"/api/auth/users/{target.id}", json={"is_active": False})
    if op == "demote":
        return await client.put(f"/api/auth/users/{target.id}", json={"is_admin": False})
    return await client.delete(f"/api/auth/users/{target.id}")


class TestUpdate:
    @pytest.mark.parametrize(
        "change", [{"is_active": False}, {"is_admin": False}], ids=["disable", "demote"]
    )
    async def test_the_last_active_admin_is_refused_and_nothing_is_written(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        sole_admin: _Account,
        change: dict[str, object],
    ):
        # A name change rides along, so "nothing written" covers the whole request.
        response = await _put(client, sole_admin, {**change, "full_name": "Changed"})

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED["disable"]
        assert await _stored(test_sessionmaker, sole_admin.id) == _Stored(True, True, _NAME)

    async def test_an_inactive_admin_does_not_count(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        sole_admin: _Account,
    ):
        spare = await _user(db_session, made_users, active=False)
        assert await _stored(test_sessionmaker, spare.id) == _Stored(False, True, _NAME)

        response = await _put(client, sole_admin, {"is_active": False})

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED["disable"]
        assert await _stored(test_sessionmaker, sole_admin.id) == _Stored(True, True, _NAME)

    async def test_resending_the_flags_unchanged_is_allowed(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        sole_admin: _Account,
    ):
        """What the Edit User dialog sends when the flags weren't touched."""
        response = await _put(
            client, sole_admin, {"is_active": True, "is_admin": True, "full_name": "Resaved"}
        )

        assert response.status_code == 200, response.text
        assert await _stored(test_sessionmaker, sole_admin.id) == _Stored(True, True, "Resaved")

    @pytest.mark.parametrize(
        ("other_active", "change", "after"),
        [
            (True, {"is_active": False}, _Stored(False, True, _NAME)),
            (False, {"is_admin": False}, _Stored(False, False, _NAME)),
        ],
        ids=["disable-a-second-active-admin", "demote-an-inactive-admin"],
    )
    async def test_allowed_while_another_active_admin_remains(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        sole_admin: _Account,
        other_active: bool,
        change: dict[str, object],
        after: _Stored,
    ):
        other = await _user(db_session, made_users, active=other_active)
        expected_active = sorted([sole_admin.id, other.id]) if other_active else [sole_admin.id]
        assert await _active_admin_ids(test_sessionmaker) == expected_active
        assert await _stored(test_sessionmaker, other.id) == _Stored(other_active, True, _NAME)

        response = await client.put(
            f"/api/auth/users/{other.id}", json=change, headers=sole_admin.headers
        )

        assert response.status_code == 200, response.text
        assert await _stored(test_sessionmaker, other.id) == after


class TestDelete:
    async def test_a_disabled_caller_cannot_delete_the_last_active_admin(
        self,
        client: AsyncClient,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        sole_admin: _Account,
        disabled_caller: _Account,
    ):
        """The old count included disabled admins, so this was a 204 and left none."""
        assert await _stored(test_sessionmaker, disabled_caller.id) == _Stored(False, True, _NAME)

        response = await client.delete(f"/api/auth/users/{sole_admin.id}")

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED["delete"]
        assert await _stored(test_sessionmaker, sole_admin.id) == _Stored(True, True, _NAME)

    @pytest.mark.parametrize(
        "other_active", [True, False], ids=["a-second-active-admin", "an-inactive-admin"]
    )
    async def test_allowed_while_another_active_admin_remains(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        sole_admin: _Account,
        other_active: bool,
    ):
        other = await _user(db_session, made_users, active=other_active)
        assert await _stored(test_sessionmaker, other.id) == _Stored(other_active, True, _NAME)

        response = await client.delete(f"/api/auth/users/{other.id}", headers=sole_admin.headers)

        assert response.status_code == 204, response.text
        assert await _stored(test_sessionmaker, other.id) is None
        assert await _active_admin_ids(test_sessionmaker) == [sole_admin.id]


@pytest.mark.parametrize("op", ["disable", "delete"])
class TestEachHalfOfTheGuardHoldsAlone:
    async def test_the_recount_catches_a_stale_pre_read(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        sole_admin: _Account,
        disabled_caller: _Account,
        op: str,
    ):
        """A competitor committed between the pre-read and the write.

        The pre-read says two active admins, the database really has one. Only the
        re-count after the flush can see it.
        """
        pre_reads: list[AsyncSession] = []

        async def stale_count(db: AsyncSession) -> int:
            pre_reads.append(db)
            return 2

        monkeypatch.setattr(auth_routes, "_locked_active_admin_count", stale_count)

        response = await _reduce(client, op, sole_admin)

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED[op]
        # The patched pre-read is the only one; a second, unpatched one would have
        # refused first and this test would prove nothing about the re-count.
        assert len(pre_reads) == 1
        assert await _stored(test_sessionmaker, sole_admin.id) == _Stored(True, True, _NAME)

    async def test_the_pre_read_refuses_before_anything_is_written(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        sole_admin: _Account,
        disabled_caller: _Account,
        op: str,
    ):
        """With a re-count that would wave it through, the locked pre-read still says no."""
        recounts: list[AsyncSession] = []

        async def stale_recount(db: AsyncSession) -> int:
            recounts.append(db)
            return 1

        monkeypatch.setattr(auth_routes, "_active_admin_count", stale_recount)

        response = await _reduce(client, op, sole_admin)

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED[op]
        assert recounts == []
        assert await _stored(test_sessionmaker, sole_admin.id) == _Stored(True, True, _NAME)


class TestTheTargetIsJudgedUnderTheLock:
    """The target's flags come from a re-read under the lock, not the route's first read.

    The race: T is a disabled admin and A the only active one. One request
    demotes (or deletes) T and reads it as disabled, so it used to skip the
    guard. Before it writes, another admin enables T and a third disables A.
    The demote then took the last active admin with it.
    """

    @pytest.mark.parametrize("op", ["demote", "delete"])
    async def test_a_target_enabled_after_the_first_read_is_still_guarded(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        sole_admin: _Account,
        disabled_caller: _Account,
        op: str,
    ):
        target = await _user(db_session, made_users, active=False)
        assert await _stored(test_sessionmaker, target.id) == _Stored(False, True, _NAME)
        real_pre_read = auth_routes._locked_active_admin_count
        landed: list[bool] = []

        async def others_commit_first(db: AsyncSession) -> int:
            # After the route's first read of T, before its lock.
            await _others_commit(test_sessionmaker, enable=target.id, disable=sole_admin.id)
            landed.append(True)
            return await real_pre_read(db)

        monkeypatch.setattr(auth_routes, "_locked_active_admin_count", others_commit_first)

        response = await _reduce(client, op, target)

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED[op]
        assert landed == [True]
        assert await _stored(test_sessionmaker, target.id) == _Stored(True, True, _NAME)
        assert await _active_admin_ids(test_sessionmaker) == [target.id]

    @pytest.mark.parametrize("op", ["demote", "delete"])
    async def test_a_target_enabled_just_before_the_re_read_is_judged_on_its_fresh_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        no_active_admin: None,
        disabled_caller: _Account,
        op: str,
    ):
        """The pre-read found no active admin, so there's no re-count to fall back on.

        T is enabled between the pre-read and the re-read, which makes it the only
        active admin. Only the re-read can see that; a stale row would let the
        write take the last active admin.
        """
        target = await _user(db_session, made_users, active=False)
        real_re_read = auth_routes._locked_target
        landed: list[bool] = []

        async def enabled_first(db: AsyncSession, user_id: int) -> User:
            async with test_sessionmaker() as other:
                await other.execute(update(User).where(User.id == target.id).values(is_active=True))
                await other.commit()
            landed.append(True)
            return await real_re_read(db, user_id)

        monkeypatch.setattr(auth_routes, "_locked_target", enabled_first)

        response = await _reduce(client, op, target)

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED[op]
        assert landed == [True]
        assert await _stored(test_sessionmaker, target.id) == _Stored(True, True, _NAME)

    @pytest.mark.parametrize("op", ["demote", "delete"])
    async def test_on_sqlite_the_recount_catches_a_target_enabled_after_the_re_read(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        test_engine: AsyncEngine,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        sole_admin: _Account,
        disabled_caller: _Account,
        op: str,
    ):
        """SQLite has no row lock, so T can still move between the re-read and the write.

        The flush takes the write lock, so the re-count after it sees the move:
        there was an active admin at the pre-read and none after this write.
        """
        if test_engine.dialect.name != "sqlite":
            pytest.skip("PostgreSQL holds the target's row lock; the next test covers that")
        target = await _user(db_session, made_users, active=False)
        real_re_read = auth_routes._locked_target
        landed: list[bool] = []

        async def others_commit_after(db: AsyncSession, user_id: int) -> User:
            user = await real_re_read(db, user_id)
            await _others_commit(test_sessionmaker, enable=target.id, disable=sole_admin.id)
            landed.append(True)
            return user

        monkeypatch.setattr(auth_routes, "_locked_target", others_commit_after)

        response = await _reduce(client, op, target)

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == _REFUSED[op]
        assert landed == [True]
        assert await _stored(test_sessionmaker, target.id) == _Stored(True, True, _NAME)
        assert await _active_admin_ids(test_sessionmaker) == [target.id]

    @pytest.mark.parametrize(
        ("op", "status", "after"),
        [("demote", 200, _Stored(False, False, _NAME)), ("delete", 204, None)],
        ids=["demote", "delete"],
    )
    async def test_on_postgresql_the_target_row_lock_holds_it_still(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        test_engine: AsyncEngine,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        sole_admin: _Account,
        disabled_caller: _Account,
        op: str,
        status: int,
        after: _Stored | None,
    ):
        """After the re-read nobody can enable T until this write commits."""
        if test_engine.dialect.name != "postgresql":
            pytest.skip("SQLite has no row locks; the test above covers it")
        target = await _user(db_session, made_users, active=False)
        real_re_read = auth_routes._locked_target
        blocked: list[bool] = []

        async def others_try_after(db: AsyncSession, user_id: int) -> User:
            user = await real_re_read(db, user_id)
            async with test_sessionmaker() as other:
                await other.execute(text("SET LOCAL lock_timeout = '200ms'"))
                try:
                    await other.execute(
                        update(User).where(User.id == target.id).values(is_active=True)
                    )
                except DBAPIError:
                    blocked.append(True)
                await other.rollback()
            return user

        monkeypatch.setattr(auth_routes, "_locked_target", others_try_after)

        response = await _reduce(client, op, target)

        assert blocked == [True]
        assert response.status_code == status, response.text
        assert await _stored(test_sessionmaker, target.id) == after
        assert await _active_admin_ids(test_sessionmaker) == [sole_admin.id]


class TestTheRecoveryPath:
    @pytest.mark.parametrize(
        ("op", "status", "after"),
        [("demote", 200, _Stored(False, False, _NAME)), ("delete", 204, None)],
        ids=["demote", "delete"],
    )
    async def test_with_no_active_admin_a_disabled_admin_can_still_be_changed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        no_active_admin: None,
        disabled_caller: _Account,
        op: str,
        status: int,
        after: _Stored | None,
    ):
        """There's no active admin left to protect, so the re-count mustn't refuse this."""
        target = await _user(db_session, made_users, active=False)
        assert await _stored(test_sessionmaker, target.id) == _Stored(False, True, _NAME)

        response = await _reduce(client, op, target)

        assert response.status_code == status, response.text
        assert await _stored(test_sessionmaker, target.id) == after


class TestAuthModeNone:
    """With auth off, `get_current_admin_user` is None: there's no caller to compare or log."""

    async def test_an_update_works_without_a_caller(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        set_auth_mode,
    ):
        member = await _user(db_session, made_users, active=True, admin=False)
        await set_auth_mode("none")

        response = await client.put(f"/api/auth/users/{member.id}", json={"full_name": "Renamed"})

        assert response.status_code == 200, response.text
        assert await _stored(test_sessionmaker, member.id) == _Stored(True, False, "Renamed")

    async def test_a_delete_works_without_a_caller(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_sessionmaker: async_sessionmaker[AsyncSession],
        made_users: list[int],
        set_auth_mode,
    ):
        member = await _user(db_session, made_users, active=True, admin=False)
        assert await _stored(test_sessionmaker, member.id) is not None
        await set_auth_mode("none")

        response = await client.delete(f"/api/auth/users/{member.id}")

        assert response.status_code == 204, response.text
        assert await _stored(test_sessionmaker, member.id) is None
