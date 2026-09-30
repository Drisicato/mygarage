"""Tests for PDF chart generation functions."""

from collections.abc import Callable
from decimal import Decimal
from typing import Any, TypedDict

import pytest

from app.utils.pdf_charts import (
    render_donut_chart,
    render_garage_monthly_trends,
    render_monthly_spending_chart,
    render_projection_bars,
)

PNG_MAGIC = b"\x89PNG"


class _Currency(TypedDict):
    currency_code: str
    locale: str


#: The charts take the reader's currency; these tests are about shape, not money.
USD: _Currency = {"currency_code": "USD", "locale": "en-US"}


class TestRenderMonthlySpendingChart:
    """Tests for render_monthly_spending_chart."""

    def test_returns_valid_png(self) -> None:
        data = [
            {
                "month_name": "January",
                "year": 2025,
                "total_service_cost": Decimal("500.00"),
                "total_fuel_cost": Decimal("200.00"),
            },
            {
                "month_name": "February",
                "year": 2025,
                "total_service_cost": Decimal("300.00"),
                "total_fuel_cost": Decimal("180.00"),
            },
        ]
        buf = render_monthly_spending_chart(data, **USD)
        content = buf.read()
        assert content[:4] == PNG_MAGIC
        assert len(content) > 1000  # Real chart image should be substantial

    def test_empty_data_returns_png(self) -> None:
        buf = render_monthly_spending_chart([], **USD)
        content = buf.read()
        assert content[:4] == PNG_MAGIC

    def test_single_month(self) -> None:
        data = [
            {
                "month_name": "March",
                "year": 2025,
                "total_service_cost": Decimal("100.00"),
                "total_fuel_cost": Decimal("50.00"),
            },
        ]
        buf = render_monthly_spending_chart(data, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_handles_zero_costs(self) -> None:
        data = [
            {
                "month_name": "April",
                "year": 2025,
                "total_service_cost": Decimal("0.00"),
                "total_fuel_cost": Decimal("0.00"),
            },
        ]
        buf = render_monthly_spending_chart(data, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_handles_none_values(self) -> None:
        data = [
            {
                "month_name": "May",
                "year": 2025,
                "total_service_cost": None,
                "total_fuel_cost": None,
            },
        ]
        buf = render_monthly_spending_chart(data, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_year_labels_change(self) -> None:
        """Year suffix should appear on labels when year changes."""
        data = [
            {
                "month_name": "November",
                "year": 2024,
                "total_service_cost": Decimal("100"),
                "total_fuel_cost": Decimal("50"),
            },
            {
                "month_name": "December",
                "year": 2024,
                "total_service_cost": Decimal("100"),
                "total_fuel_cost": Decimal("50"),
            },
            {
                "month_name": "January",
                "year": 2025,
                "total_service_cost": Decimal("100"),
                "total_fuel_cost": Decimal("50"),
            },
        ]
        buf = render_monthly_spending_chart(data, **USD)
        content = buf.read()
        assert content[:4] == PNG_MAGIC
        assert len(content) > 1000


class TestRenderDonutChart:
    """Tests for render_donut_chart."""

    def test_returns_valid_png(self) -> None:
        categories = [
            ("Oil Change", 500.0),
            ("Brake Service", 300.0),
            ("Tire Rotation", 200.0),
        ]
        buf = render_donut_chart(categories, total=1000.0, **USD)
        content = buf.read()
        assert content[:4] == PNG_MAGIC
        assert len(content) > 1000

    def test_empty_categories(self) -> None:
        buf = render_donut_chart([], total=0.0, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_single_category(self) -> None:
        buf = render_donut_chart([("Service", 100.0)], total=100.0, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_zero_total(self) -> None:
        buf = render_donut_chart([("Service", 0.0)], total=0.0, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_many_categories(self) -> None:
        """Test with more categories than colors in the palette."""
        cats = [(f"Category {i}", float(100 - i * 10)) for i in range(10)]
        buf = render_donut_chart(cats, total=550.0, **USD)
        assert buf.read()[:4] == PNG_MAGIC


class TestRenderProjectionBars:
    """Tests for render_projection_bars."""

    def test_returns_valid_png(self) -> None:
        buf = render_projection_bars(
            current_amount=5000.0,
            six_month=3000.0,
            twelve_month=6000.0,
            months_tracked=12,
            **USD,
        )
        content = buf.read()
        assert content[:4] == PNG_MAGIC
        assert len(content) > 1000

    def test_zero_values(self) -> None:
        buf = render_projection_bars(
            current_amount=0.0,
            six_month=0.0,
            twelve_month=0.0,
            months_tracked=0,
            **USD,
        )
        assert buf.read()[:4] == PNG_MAGIC

    def test_large_values(self) -> None:
        buf = render_projection_bars(
            current_amount=50000.0,
            six_month=25000.0,
            twelve_month=50000.0,
            months_tracked=36,
            **USD,
        )
        assert buf.read()[:4] == PNG_MAGIC


class TestRenderGarageMonthlyTrends:
    """Tests for render_garage_monthly_trends."""

    def test_returns_valid_png(self) -> None:
        data = [
            {
                "month": "Jan 25",
                "service": Decimal("400"),
                "fuel": Decimal("200"),
                "def_cost": Decimal("30"),
            },
            {
                "month": "Feb 25",
                "service": Decimal("300"),
                "fuel": Decimal("180"),
                "def_cost": Decimal("25"),
            },
        ]
        buf = render_garage_monthly_trends(data, **USD)
        content = buf.read()
        assert content[:4] == PNG_MAGIC
        assert len(content) > 1000

    def test_empty_data(self) -> None:
        buf = render_garage_monthly_trends([], **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_single_month(self) -> None:
        data = [
            {
                "month": "Mar 25",
                "service": Decimal("100"),
                "fuel": Decimal("50"),
                "def_cost": Decimal("0"),
            },
        ]
        buf = render_garage_monthly_trends(data, **USD)
        assert buf.read()[:4] == PNG_MAGIC

    def test_handles_missing_fields(self) -> None:
        """Fields default to 0 when missing."""
        data = [{"month": "Apr 25"}]
        buf = render_garage_monthly_trends(data, **USD)
        assert buf.read()[:4] == PNG_MAGIC


class TestChartsLabelMoneyInTheReadersCurrency:
    """Every chart wrote "$" into its axis ticks and value labels, whatever the
    reader's currency. These read the text a chart actually drew."""

    MONTHLY = [
        {
            "month_name": "January",
            "year": 2025,
            "total_service_cost": Decimal("17500.00"),
            "total_fuel_cost": Decimal("2000.00"),
        },
    ]
    GARAGE_MONTHLY = [
        {"month": "Jan 25", "service": Decimal("17500.00"), "fuel": Decimal("300.00")},
    ]
    CHARTS: dict[str, tuple[Callable[..., Any], tuple[Any, ...], dict[str, Any]]] = {
        "monthly spending axis": (render_monthly_spending_chart, (MONTHLY,), {}),
        "donut total": (render_donut_chart, ([("Service", 17500.0)],), {"total": 17500.0}),
        "projection labels": (render_projection_bars, (17500.0, 500.0, 1000.0, 12), {}),
        "garage trends axis": (render_garage_monthly_trends, (GARAGE_MONTHLY,), {}),
    }

    @pytest.mark.parametrize("chart", sorted(CHARTS))
    def test_huf_renders_ft_not_dollars(
        self, chart: str, chart_texts: Callable[[], list[list[str]]]
    ) -> None:
        render, args, kwargs = self.CHARTS[chart]
        render(*args, **kwargs, currency_code="HUF", locale="hu-HU")

        (texts,) = chart_texts()
        assert any("Ft" in t for t in texts), texts
        assert not any("$" in t for t in texts), texts

    @pytest.mark.parametrize("chart", sorted(CHARTS))
    def test_usd_still_renders_dollars(
        self, chart: str, chart_texts: Callable[[], list[list[str]]]
    ) -> None:
        """The control: the same label reads "$" when the reader is in dollars."""
        render, args, kwargs = self.CHARTS[chart]
        render(*args, **kwargs, **USD)

        (texts,) = chart_texts()
        assert any("$" in t for t in texts), texts
