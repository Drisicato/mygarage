"""What counts as a gas station in the address book.

Two fields say it: POI discovery and the fill-up's quick add set
``poi_category='gas_station'``, and the Address Book page (since 3.0.0) sets the
category "Gas Station" and never touches poi_category. Every reader asks here,
so neither kind goes missing.
"""

from sqlalchemy import ColumnElement, func, or_

from app.models import AddressBookEntry

GAS_STATION_POI = "gas_station"
GAS_STATION_CATEGORY = "Gas Station"


def gas_station_clause() -> ColumnElement[bool]:
    """SQL test for a gas station entry, either field."""
    return or_(
        AddressBookEntry.poi_category == GAS_STATION_POI,
        func.lower(func.trim(AddressBookEntry.category)) == GAS_STATION_CATEGORY.lower(),
    )


def is_gas_station(entry: AddressBookEntry) -> bool:
    """Python twin of ``gas_station_clause`` for a loaded row."""
    if entry.poi_category == GAS_STATION_POI:
        return True
    return (entry.category or "").strip().lower() == GAS_STATION_CATEGORY.lower()
