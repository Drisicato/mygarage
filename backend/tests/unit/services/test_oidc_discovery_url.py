"""Discovery asks the provider for exactly <issuer>/.well-known/openid-configuration."""

from unittest.mock import patch

import httpx
import pytest

from app.services.oidc.config import get_provider_metadata

# An IP literal on a documentation range, so the real validator passes it without a DNS lookup.
_ISSUER = "https://203.0.113.10/realms/home"


@pytest.mark.parametrize(
    "issuer",
    [f"{_ISSUER}/", "https://203.0.113.10/realms\t/home"],
    ids=["trailing-slash", "tab-in-path"],
)
async def test_discovery_fetches_the_well_known_document_under_the_issuer(
    issuer: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The real validator runs. A trailing slash doesn't double up, and a tab urllib strips
    doesn't reach httpx, which used to raise InvalidURL on it (a 500).
    """
    monkeypatch.delenv("MYGARAGE_TRUSTED_HOSTS", raising=False)
    sent: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"issuer": _ISSUER})

    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(answer)
    with patch.object(httpx, "AsyncClient", lambda *_a, **_kw: real_client(transport=transport)):
        metadata = await get_provider_metadata(issuer)

    assert [(r.method, str(r.url)) for r in sent] == [
        ("GET", f"{_ISSUER}/.well-known/openid-configuration")
    ]
    assert metadata == {"issuer": _ISSUER}
