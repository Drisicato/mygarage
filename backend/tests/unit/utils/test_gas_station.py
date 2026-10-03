"""Unit tests for the one definition of a gas station (utils/gas_station.py).

The Address Book page saves a station as category "Gas Station" with no
poi_category, and the fill-up picker only asked poi_category, so those stations
never showed up there (#194).
"""

import pytest

from app.models import AddressBookEntry
from app.utils.gas_station import is_gas_station


def _entry(*, poi_category: str | None = None, category: str | None = None) -> AddressBookEntry:
    """A loaded-looking row, never added to a session."""
    return AddressBookEntry(
        business_name="Corner Fuel", poi_category=poi_category, category=category
    )


@pytest.mark.parametrize(
    ("poi_category", "category"),
    [
        ("gas_station", None),
        (None, "Gas Station"),
        (None, "  gas station "),
    ],
    ids=["poi-category", "address-book-category", "padded-lowercase-category"],
)
def test_either_field_makes_it_a_gas_station(
    poi_category: str | None, category: str | None
) -> None:
    """POI discovery's tag and the Address Book page's category both count."""
    assert is_gas_station(_entry(poi_category=poi_category, category=category)) is True


@pytest.mark.parametrize(
    ("poi_category", "category"),
    [
        (None, "Service"),
        ("auto_shop", None),
        (None, None),
    ],
    ids=["service-category", "auto-shop-poi", "neither-field"],
)
def test_other_entries_are_not_gas_stations(poi_category: str | None, category: str | None) -> None:
    """A shop, another POI kind or a bare contact stays out of the station picker."""
    assert is_gas_station(_entry(poi_category=poi_category, category=category)) is False
