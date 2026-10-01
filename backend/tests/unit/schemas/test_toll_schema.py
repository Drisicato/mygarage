"""The toll tag create schema keeps the rules its response can't share.

A rule on the shared base runs on every stored row a response reads, so one a
legacy row breaks lives on the create instead.
"""

import pytest
from pydantic import ValidationError

from app.schemas.toll import TollTagCreate


def test_create_refuses_a_status_outside_the_vocabulary():
    """A guard: true today.

    Mutant: delete the base's validator without adding it to the create.
    """
    with pytest.raises(ValidationError, match="Status must be one of"):
        TollTagCreate(
            vin="1HGBH41JXMN109186", toll_system="EZ TAG", tag_number="0012345678", status="lost"
        )
