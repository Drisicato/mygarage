"""A null on a NOT NULL field is a 422 on its real route.

The schema meta-test (`tests/unit/schemas/test_update_null_contract.py`) proves
each update body refuses the null. This proves the route answers 422 for it
rather than a 500 from the database, a misleading 409, or a 200 that quietly
skipped the field. Every NOT NULL pair in that test's floor gets a case, on the
route it was discovered from.
"""

import re
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.auth import create_access_token
from tests.unit.schemas.test_update_null_contract import DISCOVERED, EXPECTED_NOT_NULL, REGISTRY

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

_SCHEMAS = {schema.__name__: schema for schema in REGISTRY}

# Path params that aren't the vehicle or the user: ids no row has, so a
# regression that lets the null through can't write to anyone's data.
_PARAMS = {
    "key": "null_contract_probe",
    "param_key": "NULL_CONTRACT_PROBE",
    "device_id": "null-contract-probe",
}

CASES = [
    pytest.param(schema, field, route, id=f"{schema}.{field}")
    for schema, fields in sorted(EXPECTED_NOT_NULL.items())
    for field in sorted(fields)
    for route in DISCOVERED[_SCHEMAS[schema]]
]


@pytest_asyncio.fixture
async def owner(db_session: AsyncSession):
    """A throwaway admin with a vehicle of their own, both deleted afterwards."""
    tag = uuid.uuid4().hex[:10]
    user = User(
        username=f"nn_{tag}",
        email=f"nn_{tag}@example.com",
        hashed_password="$argon2id$v=19$m=102400,t=2,p=8$NNbLa8SMLODWY2Es68EvLw$hiGLA+DtO213EMAMi8D8gXvvyjP8EVMFIHWp7SlUVnI",
        is_active=True,
        is_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    vehicle = Vehicle(
        vin="NNC" + uuid.uuid4().hex[:14].upper(),
        user_id=user.id,
        nickname="Null Contract",
        vehicle_type="Car",
        year=2020,
        make="Honda",
        model="Civic",
    )
    db_session.add(vehicle)
    await db_session.commit()
    yield user, vehicle.vin
    await db_session.delete(vehicle)
    await db_session.delete(user)
    await db_session.commit()


def _path(template: str, user_id: int, vin: str) -> str:
    def fill(match: re.Match[str]) -> str:
        name = match.group(1)
        if name == "vin":
            return vin
        if name == "user_id":
            return str(user_id)
        return _PARAMS.get(name, "999999999")

    return re.sub(r"\{(\w+)\}", fill, template)


@pytest.mark.parametrize(("schema", "field", "route"), CASES)
async def test_null_on_a_not_null_field_is_a_422(
    client: AsyncClient, owner, schema: str, field: str, route: str
):
    user, vin = owner
    method, template = route.split(" ", 1)
    headers = {
        "Authorization": "Bearer "
        + create_access_token(data={"sub": str(user.id), "username": user.username})
    }
    body = {**REGISTRY[_SCHEMAS[schema]].baseline, field: None}

    r = await client.request(method, _path(template, user.id, vin), json=body, headers=headers)

    assert r.status_code == 422, r.text
    # The body validator refused it, not a hand-rolled 422 further in.
    assert ["body", field] in [err["loc"] for err in r.json()["details"]], r.text
