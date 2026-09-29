"""Shared validator for update payloads.

The update contract: an omitted key keeps the stored value, an explicit null
clears a nullable column, and an explicit null on a NOT NULL column is a 422.
Without this a null on a NOT NULL column reaches the database and comes back
as a 500 or a misleading 409.
"""

from typing import Any

from pydantic import field_validator


def _refuse_null(value: Any, info: Any) -> Any:
    if value is None:
        raise ValueError(f"{info.field_name} cannot be null")
    return value


def reject_null(*fields: str) -> Any:
    """Refuse an explicit null on the named fields, leaving omitted ones alone.

    A ``mode="before"`` validator never runs for an omitted field, because
    pydantic does not validate defaults, so an update that leaves a field out
    still keeps the stored value. Assign the result to a class attribute:

        _no_null = reject_null("name", "title")
    """
    return field_validator(*fields, mode="before")(_refuse_null)
