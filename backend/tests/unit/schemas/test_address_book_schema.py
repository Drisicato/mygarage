"""An address-book email fits its column, and a category is stored stripped.

EmailStr takes up to 254 characters and `address_book.email` holds 100, so on
PostgreSQL a valid longer one answered 500 at the insert. The inputs refuse it
as a 422 instead. The response keeps no rule (test_response_contract).
"""

from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas.address_book import (
    AddressBookEntryCreate,
    AddressBookEntryResponse,
    AddressBookEntryUpdate,
)

# A valid address one character past the column, and one that just fits.
TOO_LONG = "a" * 64 + "@" + "b" * 32 + ".com"
FITS = "a" * 64 + "@" + "b" * 31 + ".com"
assert (len(TOO_LONG), len(FITS)) == (101, 100)


@pytest.mark.parametrize(
    ("schema", "body"),
    [(AddressBookEntryCreate, {"business_name": "Corner Garage"}), (AddressBookEntryUpdate, {})],
)
def test_an_email_past_the_column_is_refused(schema, body):
    """Mutant: `max_length=101` on either model lets the 101-character one through."""
    with pytest.raises(ValidationError, match="email"):
        schema(**body, email=TOO_LONG)
    assert schema(**body, email=FITS).email == FITS


@pytest.mark.parametrize(
    ("schema", "body"),
    [(AddressBookEntryCreate, {"business_name": "Corner Garage"}), (AddressBookEntryUpdate, {})],
)
def test_a_category_is_stripped_and_a_blank_one_is_none(schema, body):
    """SQL trim() strips spaces only, so a tab or NBSP kept a station off the fill-up."""
    assert schema(**body, category="\u00a0Gas Station\t").category == "Gas Station"
    assert schema(**body, category=" \t").category is None


def test_a_response_reads_a_padded_category_as_stored():
    """Create and Update strip the category; the response leaves a row saved before
    that as it is. Mutant: the strip on AddressBookEntryBase strips here too."""
    stamp = datetime(2026, 10, 2)
    row = AddressBookEntryResponse.model_validate(
        {
            "id": 1,
            "business_name": "Corner Garage",
            "category": "Gas Station\t",
            "created_at": stamp,
            "updated_at": stamp,
        }
    )
    assert row.category == "Gas Station\t"
