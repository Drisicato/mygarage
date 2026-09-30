"""Which field and column names hold money.

Shared by the response contract (no response bounds a money field) and the
money column registry. It goes by name so a new money field is covered the day
it lands, without anyone remembering to register it.

A name is money when one of its words is a money word, or it is one of the few
money names with no money word in them (a spot rental's `electric`). A unit word
anywhere wins over a money word: `mileage_limit_km` is a distance, and
`cost_per_km` is a rate per distance, not a stored amount.
"""

#: A word that makes a name money (`tax_amount`, `premium_share`, `msrp_base`).
MONEY_WORDS = frozenset(
    {
        "amount",
        "charge",
        "cost",
        "deductible",
        "fees",
        "limit",
        "msrp",
        "premium",
        "price",
        "rate",
        "rebate",
        "share",
        "spent",
        "subtotal",
        "tax",
        "taxes",
        "total",
    }
)

#: Money names with no money word in them.
MONEY_NAMES = frozenset({"electric", "shop_supplies", "waste", "water"})

#: A word that makes a name a measurement, whatever else it holds.
UNIT_WORDS = frozenset(
    {
        "100km",
        "c",
        "hours",
        "hr",
        "kg",
        "km",
        "kmh",
        "kpa",
        "kwh",
        "l",
        "liter",
        "liters",
        "m",
        "mb",
        "meters",
        "mm",
        "mpg",
        "nm",
        "pct",
        "percent",
        "seconds",
    }
)


def is_money_name(name: str) -> bool:
    """True when a field or column called `name` holds an amount of money."""
    words = set(name.lower().split("_"))
    if words & UNIT_WORDS:
        return False
    return name in MONEY_NAMES or bool(words & MONEY_WORDS)
