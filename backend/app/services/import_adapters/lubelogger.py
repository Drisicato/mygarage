"""LubeLogger CSV exports: Fuel, and Service / Repair / Upgrade records.

LubeLogger (github.com/hargata/lubelog) exports one CSV per record type per
vehicle, under a random file name, so the type is read from the headers:

    Fuel:                      Date,Odometer,FuelConsumed,Cost,FuelEconomy,IsFillToFull,
                               MissedFuelUp,[StartingSoc,EndingSoc,]Notes,Tags
    Service, Repair, Upgrade:  Date,Description,Cost,Notes,Odometer,Tags

plus one ``extrafield_<Name>`` column per custom field. Older versions (1.2)
wrote the same columns in another order, so columns are matched by name,
case-insensitively, with LubeLogger's own import aliases, never by position.
Service, Repair and Upgrade files share one header, so which of the three a
file is comes from the caller.

Nothing in the file says what units or locale it was written in:

- Distance is whatever the user typed, miles or km (an integer).
- Fuel is US gallons, UK gallons or litres, by the user's LubeLogger settings.
  An electric vehicle's export (it has StartingSoc/EndingSoc) is in kWh.
- Dates and money follow the LubeLogger server's culture: ``10/6/2026`` and
  ``$1,234.56`` on en-US, ``06.10.2026`` and ``1.234,56 €`` on de-DE.

so the caller declares them in ``LubeLoggerOptions``. FuelEconomy is derived
and never imported (LubeLogger recomputes it on its own import too); tags and
extra fields have no MyGarage column and are kept in the notes rather than
dropped.

These parsers only read: they return metric rows and per-row problems, and
write nothing. Fuel rows come out in the same shape the other fuel adapters
produce, so the route persists them through the same path.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from app.utils.units import UnitConverter

RecordKind = Literal["fuel", "service", "repair", "upgrade"]
#: The MyGarage service category each service-like kind becomes.
SERVICE_CATEGORY: dict[str, str] = {
    "service": "Maintenance",
    "repair": "Repair",
    "upgrade": "Upgrades",
}

DistanceUnit = Literal["mi", "km"]
FuelUnit = Literal["gal_us", "gal_uk", "l"]
DateOrder = Literal["mdy", "dmy", "ymd"]
DecimalSeparator = Literal["dot", "comma"]

MI_TO_KM = Decimal("1.609344")
LITRES_PER: dict[str, Decimal] = {
    "gal_us": UnitConverter.US_GALLONS_TO_LITERS,
    "gal_uk": Decimal("4.54609"),
    "l": Decimal("1"),
}

# LubeLogger's own import aliases (MapProfile/ImportMappers.cs), lower-cased.
_DATE = ("date", "fuelup_date")
_ODOMETER = ("odometer", "odo")
_FUEL = ("fuelconsumed", "gallons", "liters", "litres", "consumption", "quantity", "qty")
_COST = ("cost", "total cost", "totalcost", "total price")
_PRICE = ("price",)
_NOTES = ("notes", "note")
_FILL_FULL = ("isfilltofull", "filled up")
_PARTIAL = ("partial_fuelup", "partial tank", "partial_fill")
_MISSED = ("missed_fuelup", "missedfuelup", "missed fill up", "missed_fill")
_DESCRIPTION = ("description",)
_TAGS = ("tags",)
_SOC = ("startingsoc", "endingsoc")
_EXTRA_PREFIX = "extrafield_"

#: Headers that mark a LubeLogger export this importer doesn't take, and what it is.
_UNSUPPORTED: tuple[tuple[str, str], ...] = (
    ("initialodometer", "Odometer"),
    ("partnumber", "Supplies"),
    ("datecreated", "Plan"),
    ("isequipped", "Equipment"),
)


@dataclass(frozen=True)
class LubeLoggerOptions:
    """How to read the values the export doesn't label."""

    distance_unit: DistanceUnit = "mi"
    fuel_unit: FuelUnit = "gal_us"
    date_order: DateOrder = "mdy"
    decimal_separator: DecimalSeparator = "dot"


class LubeLoggerFileError(ValueError):
    """The file as a whole can't be read as a supported LubeLogger export."""

    @property
    def reason(self) -> str:
        return str(self.args[0]) if self.args else "Unreadable LubeLogger export"


class LubeLoggerRowError(ValueError):
    """One row can't be read. ``reason`` is written for the user; anything else
    a row raises is reported generically, never as its exception text."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class ParsedFile:
    """One export, read: its kind, the rows that parsed, and the ones that didn't."""

    kind: RecordKind
    rows: list[dict[str, Any]] = field(default_factory=list)
    #: (CSV row number, reason). The header is row 1.
    errors: list[tuple[int, str]] = field(default_factory=list)
    #: Rows LubeLogger itself would skip (a fill-up with no fuel), counted, not errors.
    ignored: int = 0
    electric: bool = False

    @property
    def date_range(self) -> tuple[date, date] | None:
        dates = [r["date"] for r in self.rows]
        return (min(dates), max(dates)) if dates else None


# ---------------------------------------------------------------------------
# Reading the file
# ---------------------------------------------------------------------------


def _delimiter(csv_data: str) -> str:
    """The header line's separator: comma, tab or semicolon.

    LubeLogger writes commas, but a file opened and saved again in a
    spreadsheet comes back tab-separated (Excel's "Text" format) or, in a
    comma-decimal locale, semicolon-separated. LubeLogger's headers hold
    none of the three, so the most frequent one on the header line is it.
    """
    header = csv_data.lstrip("﻿").splitlines()[0] if csv_data.strip() else ""
    counts = {sep: header.count(sep) for sep in (",", "\t", ";")}
    best = max(counts, key=lambda sep: counts[sep])
    return best if counts[best] else ","


def _read(csv_data: str) -> tuple[set[str], list[tuple[int, dict[str, str]]]]:
    """Headers (lower-cased, trimmed) and each data row keyed by them, with its row number.

    RFC 4180 throughout: LubeLogger quotes notes holding commas, quotes or
    line breaks, so a row's number is counted by records, not lines.
    """
    reader = csv.reader(io.StringIO(csv_data), delimiter=_delimiter(csv_data))
    try:
        header = next(reader)
    except StopIteration as exc:
        raise LubeLoggerFileError("The file is empty") from exc
    # Lower-cased for matching, except an extra field's own name, which the
    # notes show as the user wrote it ("extrafield_" + "Shop").
    keys = [
        _EXTRA_PREFIX + h.strip()[len(_EXTRA_PREFIX) :]
        if h.strip().lower().startswith(_EXTRA_PREFIX)
        else h.strip().lower()
        for h in header
    ]
    rows: list[tuple[int, dict[str, str]]] = []
    for number, values in enumerate(reader, start=2):
        if not any(v.strip() for v in values):
            continue
        rows.append(
            (
                number,
                {k: (values[i].strip() if i < len(values) else "") for i, k in enumerate(keys)},
            )
        )
    return set(keys), rows


def detect_kind(headers: set[str]) -> Literal["fuel", "service"]:
    """Fuel, or one of the three service-like types (which one is the caller's)."""
    for marker, name in _UNSUPPORTED:
        if marker in headers:
            raise LubeLoggerFileError(
                f"This looks like a LubeLogger {name} export; only Fuel and "
                "Service / Repair / Upgrade exports can be imported"
            )
    if not any(h in headers for h in _DATE):
        raise LubeLoggerFileError("No Date column: this isn't a LubeLogger export")
    if any(h in headers for h in _FUEL):
        return "fuel"
    if "description" in headers and any(h in headers for h in _ODOMETER):
        return "service"
    if "description" in headers:
        raise LubeLoggerFileError(
            "This looks like a LubeLogger Tax export; only Fuel and "
            "Service / Repair / Upgrade exports can be imported"
        )
    raise LubeLoggerFileError("The columns don't match a LubeLogger Fuel or Service export")


def _first(row: dict[str, str], names: tuple[str, ...]) -> str:
    for name in names:
        value = row.get(name)
        if value:
            return value
    return ""


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------


_DATE_PARTS = re.compile(r"^\s*(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})")


def parse_date(raw: str, order: DateOrder) -> date:
    """A culture-formatted short date. ISO (yyyy-mm-dd) is read as such whatever
    the order; a time after the date (Plan exports, ``ToString("G")``) is ignored."""
    match = _DATE_PARTS.match(raw)
    if not match:
        raise LubeLoggerRowError(f"unreadable date {raw!r}")
    a, b, c = match.groups()
    if len(a) == 4:
        year, month, day = int(a), int(b), int(c)
    elif order == "mdy":
        month, day, year = int(a), int(b), int(c)
    elif order == "dmy":
        day, month, year = int(a), int(b), int(c)
    else:
        raise LubeLoggerRowError(f"date {raw!r} doesn't start with a 4-digit year")
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError as exc:
        raise LubeLoggerRowError(f"impossible date {raw!r} (check the date order)") from exc


_NUMBER_JUNK = re.compile(r"[^\d.,\-]")


def parse_number(raw: str, separator: DecimalSeparator) -> Decimal | None:
    """A culture-formatted number or amount: ``$1,234.56``, ``1.234,56 €``, ``(12.00)``.

    Currency symbols, spaces and letters are dropped; the group separator is
    the other one of dot and comma.
    """
    text = raw.strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = _NUMBER_JUNK.sub("", text)
    if separator == "dot":
        text = text.replace(",", "")
    else:
        text = text.replace(".", "").replace(",", ".")
    if text in ("", "-", "."):
        raise LubeLoggerRowError(f"unreadable number {raw!r}")
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise LubeLoggerRowError(f"unreadable number {raw!r}") from exc
    return -value if negative else value


def _truthy(raw: str, *, also: tuple[str, ...] = ()) -> bool:
    return raw.strip().lower() in ("1", "true", *also)


def _odometer_km(row: dict[str, str], opts: LubeLoggerOptions) -> Decimal | None:
    value = parse_number(_first(row, _ODOMETER), opts.decimal_separator)
    # LubeLogger stores an unknown reading as 0, never a real odometer.
    if value is None or value == 0:
        return None
    if value < 0:
        raise LubeLoggerRowError("the odometer can't be negative")
    km = value * MI_TO_KM if opts.distance_unit == "mi" else value
    return km.quantize(Decimal("0.01"))


def _notes(row: dict[str, str]) -> str | None:
    """Notes, then tags, then each extra field: kept rather than dropped."""
    parts = [_first(row, _NOTES)]
    tags = _first(row, _TAGS)
    if tags:
        parts.append(f"Tags: {tags}")
    for key, value in row.items():
        if key.startswith(_EXTRA_PREFIX) and value:
            parts.append(f"{key[len(_EXTRA_PREFIX) :]}: {value}")
    text = "\n".join(p for p in parts if p)
    return text or None


# ---------------------------------------------------------------------------
# Record types
# ---------------------------------------------------------------------------


def _fuel_row(
    row: dict[str, str], opts: LubeLoggerOptions, electric: bool
) -> dict[str, Any] | None:
    """One fill-up in the fuel adapters' metric shape, or None for one LubeLogger skips."""
    sep = opts.decimal_separator
    quantity = parse_number(_first(row, _FUEL), sep)
    if quantity is None or quantity <= 0:
        return None
    cost = parse_number(_first(row, _COST), sep)
    if cost is None:
        price = parse_number(_first(row, _PRICE), sep)
        cost = (price * quantity).quantize(Decimal("0.01")) if price is not None else None

    if _first(row, _FILL_FULL):
        full = _truthy(_first(row, _FILL_FULL), also=("full",))
    elif _first(row, _PARTIAL):
        full = _first(row, _PARTIAL).strip() != "1"
    else:
        full = True

    liters = kwh = None
    if electric:
        kwh = quantity.quantize(Decimal("0.001"))
    else:
        liters = (quantity * LITRES_PER[opts.fuel_unit]).quantize(Decimal("0.001"))
    unit_amount = kwh if electric else liters
    price_per_unit = (
        (cost / unit_amount).quantize(Decimal("0.001"))
        if cost is not None and unit_amount
        else None
    )

    soc: dict[str, int | None] = {}
    if electric:
        for key, name in (("soc_start_pct", "startingsoc"), ("soc_end_pct", "endingsoc")):
            value = parse_number(row.get(name, ""), sep)
            soc[key] = int(value) if value is not None else None

    return {
        "date": parse_date(_first(row, _DATE), opts.date_order),
        "filled_at": None,
        "odometer_km": _odometer_km(row, opts),
        "liters": liters,
        "kwh": kwh,
        "cost": cost,
        "price_per_unit": price_per_unit,
        "price_basis": (
            None if price_per_unit is None else ("per_kwh" if electric else "per_volume")
        ),
        "is_full_tank": full,
        "missed_fillup": _truthy(_first(row, _MISSED)),
        "notes": _notes(row),
        "fuel_type_used": None,
        **soc,
    }


def _service_row(row: dict[str, str], opts: LubeLoggerOptions, kind: str) -> dict[str, Any]:
    description = (
        _first(row, _DESCRIPTION)
        or {
            "service": "Service",
            "repair": "Repair",
            "upgrade": "Upgrade",
        }[kind]
    )
    return {
        "date": parse_date(_first(row, _DATE), opts.date_order),
        "odometer_km": _odometer_km(row, opts),
        # A line item holds 200 characters; the whole text stays in the notes.
        "description": description[:200],
        "cost": parse_number(_first(row, _COST), opts.decimal_separator),
        "category": SERVICE_CATEGORY[kind],
        "notes": _join_long_description(description, _notes(row)),
    }


def _join_long_description(description: str, notes: str | None) -> str | None:
    if len(description) <= 200:
        return notes
    return "\n".join(p for p in (description, notes) if p)


def parse_lubelogger(
    csv_data: str,
    opts: LubeLoggerOptions | None = None,
    kind: RecordKind | None = None,
) -> ParsedFile:
    """Read one LubeLogger export.

    ``kind`` is the caller's choice for a service-like file (service, repair or
    upgrade); left out, such a file reads as service. Passing ``fuel`` for a
    service file, or a service kind for a fuel file, is refused: the columns
    say which it is.
    """
    opts = opts or LubeLoggerOptions()
    headers, rows = _read(csv_data)
    detected = detect_kind(headers)
    if kind is None:
        kind = "fuel" if detected == "fuel" else "service"
    elif (kind == "fuel") != (detected == "fuel"):
        found = "Fuel" if detected == "fuel" else "Service / Repair / Upgrade"
        raise LubeLoggerFileError(f"This is a LubeLogger {found} export, not {kind}")

    parsed = ParsedFile(kind=kind, electric=detected == "fuel" and any(h in headers for h in _SOC))
    for number, row in rows:
        try:
            if kind == "fuel":
                result = _fuel_row(row, opts, parsed.electric)
                if result is None:
                    parsed.ignored += 1
                    continue
            else:
                result = _service_row(row, opts, kind)
            parsed.rows.append({**result, "_row": number})
        except LubeLoggerRowError as exc:
            parsed.errors.append((number, exc.reason))
        except ValueError, ArithmeticError:
            parsed.errors.append((number, "Unreadable row"))
    return parsed
