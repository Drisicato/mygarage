"""The anomaly `message` is deprecated, and still sent.

It's an English-only sentence (#131), so the app builds its own from `amount`,
`baseline` and `deviation_percent`. The flag lands in the OpenAPI schema, where
openapi-typescript turns it into `@deprecated` on the generated type. The field
stays required until the next API version, so no client reading it breaks.
"""

from typing import Any

from app.main import app


def _anomaly_schema() -> dict[str, Any]:
    """The AnomalyAlert component as the app publishes it."""
    return app.openapi()["components"]["schemas"]["AnomalyAlert"]


def test_the_anomaly_message_is_marked_deprecated() -> None:
    """The published schema flags the message so generated clients warn on it."""
    assert _anomaly_schema()["properties"]["message"].get("deprecated") is True


def test_the_anomaly_message_is_still_sent() -> None:
    """Guard, true before the change: deprecated isn't removed.

    Mutant that kills it: `message: str | None = None` on AnomalyAlert.
    """
    assert "message" in _anomaly_schema()["required"]
