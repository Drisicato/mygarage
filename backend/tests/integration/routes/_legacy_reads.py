"""Reading a legacy row back through its real route, for the legacy-read suites."""

from typing import Any

from httpx import AsyncClient


async def read_ok(client: AsyncClient, headers: dict[str, str], url: str) -> Any:
    """GET `url` and return its JSON, failing the test unless it answers 200."""
    response = await client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()
