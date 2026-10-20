"""What the supplies imports share: units, matching, and the supplies a vehicle can use.

Supplies are household-wide, but every import runs for one vehicle (it locks
and backs up that vehicle), so an imported supply joins an existing one this
vehicle can use, or is created linked to it (or shared, when the file says so).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supply import Supply
from app.utils.units import UnitConverter

_GAL_US = UnitConverter.US_GALLONS_TO_LITERS
_GAL_UK = Decimal("4.54609")

#: Litres per supply volume unit (the tokens of ``SupplyVolumeUnit``); supplies
#: store volume in litres and a count as itself.
SUPPLY_LITRES_PER: dict[str, Decimal] = {
    "mL": Decimal("0.001"),
    "L": Decimal("1"),
    "fl_oz_us": _GAL_US / 128,
    "fl_oz_uk": _GAL_UK / 160,
    "qt_us": _GAL_US / 4,
    "qt_uk": _GAL_UK / 4,
    "gal_us": _GAL_US,
    "gal_uk": _GAL_UK,
}
#: What an imported quantity can count: items, or one of the volume units.
SUPPLY_UNITS: tuple[str, ...] = ("count", *SUPPLY_LITRES_PER)

_QUANTITY_STEP = Decimal("0.001")


def to_canonical(quantity: Decimal, unit: str) -> Decimal:
    """A quantity in ``unit`` as the ledger stores it, at the ledger's 0.001 grain."""
    litres = quantity * SUPPLY_LITRES_PER.get(unit, Decimal("1"))
    return litres.quantize(_QUANTITY_STEP, rounding=ROUND_HALF_UP)


def from_canonical(quantity: Decimal, unit: str) -> Decimal:
    """The ledger's quantity in ``unit`` (exports write it the way the supply shows it)."""
    return quantity / SUPPLY_LITRES_PER.get(unit, Decimal("1"))


def unit_of(supply: Supply) -> str:
    """The unit a supply's quantities are shown in: count, its own volume unit, or litres."""
    if supply.unit_type == "count":
        return "count"
    return supply.volume_unit if supply.volume_unit in SUPPLY_LITRES_PER else "L"


async def supplies_usable_on(db: AsyncSession, vin: str) -> list[Supply]:
    """The active supplies an import into ``vin`` can join: shared ones and this vehicle's."""
    result = await db.execute(select(Supply).where(Supply.is_active.is_(True)).order_by(Supply.id))
    return [s for s in result.scalars().all() if s.usable_on(vin)]


def match_supply(candidates: list[Supply], name: str, part_number: str | None) -> Supply | None:
    """The supply an imported row is: the same part number, else the same name (case-blind)."""
    part = (part_number or "").casefold()
    if part:
        for supply in candidates:
            if (supply.part_number or "").casefold() == part:
                return supply
    wanted = name.casefold()
    for supply in candidates:
        if supply.name.casefold() == wanted:
            return supply
    return None


def supply_key(name: str, part_number: str | None) -> str:
    """One supply's rows across a file: its part number and name, case-blind."""
    return f"{(part_number or '').casefold()}|{name.casefold()}"
