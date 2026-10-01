"""The line item create schema keeps the rules its response can't share.

A rule on the shared base runs on every stored row a response reads, so one a
legacy row breaks lives on the create instead.
"""

import pytest
from pydantic import ValidationError

from app.schemas.service_visit import ServiceLineItemCreate


def test_create_refuses_a_maintenance_type_that_is_not_a_code():
    """A guard: true today.

    Mutant: delete the base's validator without adding it to the create.
    """
    with pytest.raises(ValidationError, match="maintenance_type"):
        ServiceLineItemCreate(description="Oil change", maintenance_type="Oil Change")
