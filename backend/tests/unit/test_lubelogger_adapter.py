"""The LubeLogger CSV adapter: reading its exports, writing nothing.

Sample files follow LubeLogger's own writers (Helper/StaticHelper.cs,
`Write*ExportModel`): fuel cost as a plain number, other costs as currency
strings, short dates in the server's culture, odometers as integers.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.services.import_adapters.lubelogger import (
    LubeLoggerFileError,
    LubeLoggerOptions,
    detect_kind,
    parse_date,
    parse_lubelogger,
    parse_number,
)

US = LubeLoggerOptions(distance_unit="mi", fuel_unit="gal_us", date_order="mdy")
METRIC_DE = LubeLoggerOptions(
    distance_unit="km", fuel_unit="l", date_order="dmy", decimal_separator="comma"
)

FUEL_US = (
    "Date,Odometer,FuelConsumed,Cost,FuelEconomy,IsFillToFull,MissedFuelUp,Notes,Tags\n"
    "10/6/2026,71700,10.5,42.00,0,True,False,Costco,road trip\n"
    "10/20/2026,72000,12,48.12,28.5714285714,False,True,,\n"
    "10/21/2026,72010,0,0,0,True,False,zero gallons,\n"
)

SERVICE_US = (
    "Date,Description,Cost,Notes,Odometer,Tags,extrafield_Shop\n"
    '9/1/2026,Oil change,"$1,234.56","Synthetic, 5 qt",71000,oil,Jiffy\n'
    "13/1/2026,Bad date,$10.00,,71001,,\n"
)


class TestDetect:
    def test_fuel_and_service_headers(self):
        assert detect_kind({"date", "odometer", "fuelconsumed", "cost"}) == "fuel"
        assert detect_kind({"date", "description", "cost", "odometer"}) == "service"

    @pytest.mark.parametrize(
        ("headers", "name"),
        [
            ({"date", "initialodometer", "odometer"}, "Odometer"),
            ({"date", "partnumber", "description"}, "Supplies"),
            ({"datecreated", "description"}, "Plan"),
            ({"date", "description", "cost", "notes", "tags"}, "Tax"),
        ],
    )
    def test_other_exports_are_named_and_refused(self, headers, name):
        with pytest.raises(LubeLoggerFileError, match=name):
            detect_kind(headers)

    def test_headers_match_case_insensitively_and_by_alias(self):
        parsed = parse_lubelogger("DATE , ODO , Gallons , Total Cost\n10/6/2026,100,5,20\n", US)
        assert parsed.kind == "fuel"
        assert parsed.rows[0]["liters"] == Decimal("18.927")

    @pytest.mark.parametrize("sep", ["\t", ";"])
    def test_a_file_saved_again_by_a_spreadsheet_reads_the_same(self, sep):
        """LubeLogger writes commas; Excel saves tab- or semicolon-separated."""
        csv_data = FUEL_US.replace(",", sep)
        assert parse_lubelogger(csv_data, US).rows == parse_lubelogger(FUEL_US, US).rows

    def test_a_fuel_file_cannot_be_imported_as_service(self):
        with pytest.raises(LubeLoggerFileError, match="Fuel"):
            parse_lubelogger(FUEL_US, US, "repair")


class TestValues:
    @pytest.mark.parametrize(
        ("raw", "order", "expected"),
        [
            ("10/6/2026", "mdy", date(2026, 10, 6)),
            ("06.10.2026", "dmy", date(2026, 10, 6)),
            ("2026-10-06", "mdy", date(2026, 10, 6)),
            ("10/6/2026 4:28:00 PM", "mdy", date(2026, 10, 6)),
            ("6/10/26", "dmy", date(2026, 10, 6)),
        ],
    )
    def test_dates(self, raw, order, expected):
        assert parse_date(raw, order) == expected

    def test_an_impossible_date_names_the_order(self):
        with pytest.raises(ValueError, match="date order"):
            parse_date("13/1/2026", "mdy")

    @pytest.mark.parametrize(
        ("raw", "sep", "expected"),
        [
            ("$1,234.56", "dot", Decimal("1234.56")),
            ("1.234,56 €", "comma", Decimal("1234.56")),
            ("12,5", "comma", Decimal("12.5")),
            ("($12.00)", "dot", Decimal("-12.00")),
            ("", "dot", None),
        ],
    )
    def test_numbers(self, raw, sep, expected):
        assert parse_number(raw, sep) == expected


class TestFuel:
    def test_us_export_converts_to_metric(self):
        parsed = parse_lubelogger(FUEL_US, US)
        assert parsed.kind == "fuel"
        assert parsed.ignored == 1  # zero gallons: LubeLogger skips it too
        assert parsed.errors == []
        first, second = parsed.rows
        assert first["date"] == date(2026, 10, 6)
        assert first["odometer_km"] == Decimal("115389.96")  # 71,700 mi
        assert first["liters"] == Decimal("39.747")  # 10.5 US gal
        assert first["cost"] == Decimal("42.00")
        assert first["price_per_unit"] == Decimal("1.057")
        assert first["is_full_tank"] is True
        assert first["missed_fillup"] is False
        assert first["notes"] == "Costco\nTags: road trip"
        assert second["is_full_tank"] is False
        assert second["missed_fillup"] is True
        assert second["_row"] == 3

    def test_uk_gallons(self):
        opts = LubeLoggerOptions(distance_unit="mi", fuel_unit="gal_uk")
        parsed = parse_lubelogger(FUEL_US, opts)
        assert parsed.rows[0]["liters"] == Decimal("47.734")  # 10.5 x 4.54609

    def test_german_metric_export(self):
        csv_data = (
            "Date,Odometer,FuelConsumed,Cost,FuelEconomy,IsFillToFull,MissedFuelUp,Notes,Tags\n"
            '06.10.2026,115391,"40,5","62,37",0,True,False,,\n'
        )
        (row,) = parse_lubelogger(csv_data, METRIC_DE).rows
        assert row["odometer_km"] == Decimal("115391.00")
        assert row["liters"] == Decimal("40.500")
        assert row["cost"] == Decimal("62.37")

    def test_an_electric_export_is_kwh_with_its_charge_levels(self):
        csv_data = (
            "Date,Odometer,FuelConsumed,Cost,FuelEconomy,IsFillToFull,MissedFuelUp,"
            "StartingSoc,EndingSoc,Notes,Tags\n"
            "10/6/2026,1000,30.5,9.15,0,True,False,20,80,,\n"
        )
        parsed = parse_lubelogger(csv_data, US)
        assert parsed.electric is True
        (row,) = parsed.rows
        assert row["kwh"] == Decimal("30.500")
        assert row["liters"] is None
        assert (row["soc_start_pct"], row["soc_end_pct"]) == (20, 80)

    def test_price_fills_a_missing_cost(self):
        parsed = parse_lubelogger("Date,Odometer,Gallons,Price\n10/6/2026,100,10,3.459\n", US)
        assert parsed.rows[0]["cost"] == Decimal("34.59")

    def test_a_zero_odometer_is_unknown(self):
        parsed = parse_lubelogger("Date,Odometer,FuelConsumed\n10/6/2026,0,5\n", US)
        assert parsed.rows[0]["odometer_km"] is None


class TestService:
    @pytest.mark.parametrize(
        ("kind", "category"),
        [("service", "Maintenance"), ("repair", "Repair"), ("upgrade", "Upgrades")],
    )
    def test_kind_sets_the_category(self, kind, category):
        parsed = parse_lubelogger(SERVICE_US, US, kind)
        assert parsed.kind == kind
        assert parsed.rows[0]["category"] == category

    def test_a_service_row_with_its_notes_tags_and_extra_fields(self):
        parsed = parse_lubelogger(SERVICE_US, US)
        (row,) = parsed.rows
        assert row["date"] == date(2026, 9, 1)
        assert row["description"] == "Oil change"
        assert row["cost"] == Decimal("1234.56")
        assert row["odometer_km"] == Decimal("114263.42")
        assert row["notes"] == "Synthetic, 5 qt\nTags: oil\nShop: Jiffy"

    def test_an_unreadable_row_is_reported_by_its_line(self):
        parsed = parse_lubelogger(SERVICE_US, US)
        assert parsed.errors == [(3, "impossible date '13/1/2026' (check the date order)")]

    def test_a_long_description_keeps_its_whole_text_in_the_notes(self):
        long = "x" * 250
        parsed = parse_lubelogger(
            f"Date,Description,Cost,Notes,Odometer\n1/1/2026,{long},,,5\n", US
        )
        row = parsed.rows[0]
        assert len(row["description"]) == 200
        assert row["notes"] == long
