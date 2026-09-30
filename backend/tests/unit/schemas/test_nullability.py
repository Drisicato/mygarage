"""Unit tests for the reject_null helper.

The update contract rests on one pydantic property: a ``mode="before"``
validator never runs for an omitted field, so omitted keeps the stored value
while an explicit null is refused.
"""

import pytest
from pydantic import BaseModel, ValidationError

from app.schemas._nullability import reject_null
from app.schemas.external_vehicle import ExternalVehicleUpdate


class _Update(BaseModel):
    name: str | None = None
    kind: str | None = None
    notes: str | None = None

    _no_null = reject_null("name", "kind")


def test_omitted_fields_are_not_validated():
    data = _Update.model_validate({})
    assert data.model_fields_set == set()


def test_explicit_null_is_refused_at_that_field():
    with pytest.raises(ValidationError) as exc:
        _Update.model_validate({"name": None})
    errors = exc.value.errors()
    assert [e["loc"] for e in errors] == [("name",)]
    assert "name cannot be null" in errors[0]["msg"]


def test_every_named_field_is_guarded():
    with pytest.raises(ValidationError) as exc:
        _Update.model_validate({"kind": None})
    assert [e["loc"] for e in exc.value.errors()] == [("kind",)]


def test_unnamed_fields_still_accept_null():
    data = _Update.model_validate({"notes": None})
    assert data.notes is None
    assert data.model_fields_set == {"notes"}


def test_values_pass_through_unchanged():
    data = _Update.model_validate({"name": "Shop", "kind": "fuel"})
    assert (data.name, data.kind) == ("Shop", "fuel")


def test_external_vehicle_nickname_uses_the_helper():
    # The one existing precedent now goes through the shared helper.
    with pytest.raises(ValidationError) as exc:
        ExternalVehicleUpdate.model_validate({"nickname": None})
    assert [e["loc"] for e in exc.value.errors()] == [("nickname",)]
    assert "nickname cannot be null" in exc.value.errors()[0]["msg"]
    assert not hasattr(ExternalVehicleUpdate, "reject_null_nickname")
