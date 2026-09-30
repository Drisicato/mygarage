"""Checks for money the server computes, run before it is written.

Every money input is bounded to fit its column, but a sum of inputs can still
run past it: a visit's line items, a supply's cost for a quantity, a rental's
first bill, a policy's premium grown by a vehicle's share. Past the column that
was a 500 on PostgreSQL and stored silently on SQLite. These turn it into a 422
that says which total and why.
"""

from decimal import Decimal

from fastapi import HTTPException, status

from app.schemas._money import MONEY_MAX


def too_large(what: str, limit: Decimal = MONEY_MAX) -> str:
    """The reason a computed amount was refused, for a 422 or an import row error."""
    return f"{what} would exceed the largest amount MyGarage can store ({limit})"


def ensure_fits(value: Decimal | None, what: str, limit: Decimal = MONEY_MAX) -> None:
    """Refuse a computed amount its column can't hold, before anything is flushed.

    Args:
        value: The computed amount. None is nothing to store, so it fits.
        what: What the amount is, as the start of a sentence ("The visit total").
        limit: The largest value its column holds.

    Raises:
        HTTPException: 422 with the reason, when the amount is past the limit.
    """
    if value is not None and value > limit:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=too_large(what, limit)
        )
