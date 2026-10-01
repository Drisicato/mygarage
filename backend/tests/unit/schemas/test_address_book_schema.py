"""An address-book email fits its column.

EmailStr takes up to 254 characters and `address_book.email` holds 100, so on
PostgreSQL a valid longer one answered 500 at the insert. The inputs refuse it
as a 422 instead. The response keeps no rule (test_response_contract).
"""

import pytest
from pydantic import ValidationError

from app.schemas.address_book import AddressBookEntryCreate, AddressBookEntryUpdate

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
