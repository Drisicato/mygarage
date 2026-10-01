"""TrustedProxyMiddleware finds the client behind a trusted proxy and believes nobody else about it."""

import logging
from collections.abc import Sequence

import pytest
from starlette.types import Message, Receive, Scope, Send

from app.config import parse_client_ip_header, parse_trusted_proxies, settings
from app.middleware import TrustedProxyMiddleware, log_proxy_settings

LOGGER = "app.middleware"
TRUSTED = "10.0.0.0/8"
TRUSTED_PEER = "10.0.0.2"
OUTSIDER = "192.0.2.10"
FROM_TRUSTED = (TRUSTED_PEER, 5000)
FROM_OUTSIDER = (OUTSIDER, 5000)

Header = tuple[bytes, bytes]


@pytest.fixture(autouse=True)
def _capture_middleware_logs(caplog: pytest.LogCaptureFixture) -> None:
    """Catch everything the middleware logs, so "no warning" can't pass on a filtered level."""
    caplog.set_level(logging.DEBUG, logger=LOGGER)


def _trust(monkeypatch: pytest.MonkeyPatch, networks: str, header: str = "") -> None:
    """Set the two proxy settings the way their env vars would."""
    monkeypatch.setattr(settings, "trusted_proxies", parse_trusted_proxies(networks))
    monkeypatch.setattr(settings, "client_ip_header", parse_client_ip_header(header))


def _xff(value: str) -> Header:
    return (b"x-forwarded-for", value.encode("latin-1"))


class _Downstream:
    """The app behind the middleware. Keeps what it was handed and answers 200."""

    def __init__(self) -> None:
        self.scope: Scope | None = None
        self.client: object = None
        self.headers: list[Header] = []

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        self.scope = scope
        self.client = scope.get("client")
        self.headers = list(scope.get("headers", []))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"OK"})


async def _receive() -> Message:
    return {"type": "http.request", "body": b"", "more_body": False}


async def _send(message: Message) -> None:
    """The response isn't what's under test."""


def _scope(
    headers: Sequence[Header], client: tuple[str, int] | None, scope_type: str = "http"
) -> Scope:
    return {"type": scope_type, "path": "/api/health", "client": client, "headers": list(headers)}


def _middleware() -> tuple[TrustedProxyMiddleware, _Downstream]:
    downstream = _Downstream()
    return TrustedProxyMiddleware(downstream), downstream


async def _through(
    headers: Sequence[Header],
    client: tuple[str, int] | None = FROM_TRUSTED,
    scope_type: str = "http",
) -> _Downstream:
    """Send one request through a fresh middleware and return what the app saw."""
    middleware, downstream = _middleware()
    await middleware(_scope(headers, client, scope_type), _receive, _send)
    return downstream


def _logged(caplog: pytest.LogCaptureFixture, level: int) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == LOGGER and r.levelno == level]


# Not configured


async def test_unconfigured_changes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nobody's trusted, so nobody's headers or address get touched."""
    _trust(monkeypatch, "")
    headers = [_xff("198.51.100.7"), (b"x-forwarded-proto", b"https")]

    seen = await _through(headers, FROM_OUTSIDER)

    assert seen.headers == headers
    assert seen.client == FROM_OUTSIDER


async def test_unconfigured_warns_once_naming_the_peer(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """An XFF nobody's listening to probably means a proxy that isn't configured yet."""
    _trust(monkeypatch, "")
    middleware, _ = _middleware()

    for _ in range(2):
        await middleware(_scope([_xff("198.51.100.7")], FROM_OUTSIDER), _receive, _send)

    warnings = _logged(caplog, logging.WARNING)
    assert len(warnings) == 1
    assert OUTSIDER in warnings[0]
    assert "MYGARAGE_TRUSTED_PROXIES" in warnings[0]


async def test_unconfigured_without_forwarded_for_stays_quiet(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The complement: no XFF, nothing to warn about."""
    _trust(monkeypatch, "")

    await _through([(b"x-forwarded-proto", b"https")], FROM_OUTSIDER)

    assert _logged(caplog, logging.WARNING) == []


# Configured, untrusted peer


async def test_untrusted_peer_keeps_its_address(monkeypatch: pytest.MonkeyPatch) -> None:
    """An outsider can't pick its own address with XFF."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("198.51.100.7")], FROM_OUTSIDER)

    assert seen.client == FROM_OUTSIDER


async def test_untrusted_peer_loses_forwarding_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only the forwarding headers go; everything else reaches the app."""
    _trust(monkeypatch, TRUSTED, header="CF-Connecting-IP")
    headers = [
        _xff("198.51.100.7"),
        (b"x-forwarded-proto", b"https"),
        (b"x-forwarded-host", b"garage.example.com"),
        (b"cf-connecting-ip", b"203.0.113.50"),
        (b"user-agent", b"curl/8"),
    ]

    seen = await _through(headers, FROM_OUTSIDER)

    assert seen.headers == [(b"user-agent", b"curl/8")]


@pytest.mark.parametrize("client", [None, ("testclient", 50000)], ids=["no-client", "testclient"])
async def test_missing_or_non_ip_peer_is_untrusted(
    monkeypatch: pytest.MonkeyPatch, client: tuple[str, int] | None
) -> None:
    """A peer we can't read is an outsider."""
    _trust(monkeypatch, TRUSTED)
    headers = [_xff("198.51.100.7"), (b"x-forwarded-proto", b"https"), (b"user-agent", b"curl/8")]

    seen = await _through(headers, client)

    assert seen.headers == [(b"user-agent", b"curl/8")]
    assert seen.client == client


async def test_untrusted_peer_warns_once_naming_it(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Dropping headers gets said once, with who sent them."""
    _trust(monkeypatch, TRUSTED)
    middleware, _ = _middleware()

    for _ in range(2):
        await middleware(_scope([_xff("198.51.100.7")], FROM_OUTSIDER), _receive, _send)

    warnings = _logged(caplog, logging.WARNING)
    assert len(warnings) == 1
    assert OUTSIDER in warnings[0]
    assert "MYGARAGE_TRUSTED_PROXIES" in warnings[0]


# Configured, trusted peer, X-Forwarded-For


async def test_single_forwarded_for_is_the_client(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("198.51.100.7")])

    assert seen.client == ("198.51.100.7", 0)


async def test_walks_right_to_left_past_trusted_hops(monkeypatch: pytest.MonkeyPatch) -> None:
    """The first untrusted hop from the right wins; the client wrote the leftmost itself."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("203.0.113.9, 198.51.100.7, 10.0.0.5")])

    assert seen.client == ("198.51.100.7", 0)


async def test_repeated_forwarded_for_lines_are_joined(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("203.0.113.9"), _xff("198.51.100.7, 10.0.0.5")])

    assert seen.client == ("198.51.100.7", 0)


async def test_all_trusted_takes_the_leftmost(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("10.0.0.7, 10.0.0.5")])

    assert seen.client == ("10.0.0.7", 0)


@pytest.mark.parametrize(
    "value",
    [
        "unknown",
        "198.51.100.7, evil",
        "198.51.100.7:http",
        "1.2.3",
        "300.1.1.1",
        "[2001:db8::7",
        "[]:1",
        "1.2.3.4:",
        ":",
        "1.2.3.4:123456",
    ],
)
async def test_junk_entry_keeps_the_peer(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """Junk ends the walk instead of being skipped past, and never blows up the request."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff(value)])

    assert seen.client == FROM_TRUSTED


async def test_empty_elements_and_whitespace_are_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff(" , 198.51.100.7 ,  , 10.0.0.5 ")])

    assert seen.client == ("198.51.100.7", 0)


@pytest.mark.parametrize(
    ("value", "address"),
    [
        ("198.51.100.7:4711", "198.51.100.7"),
        ("[2001:db8::7]:4711", "2001:db8::7"),
        ("[2001:db8::7]", "2001:db8::7"),
        ("2001:db8::7", "2001:db8::7"),
    ],
)
async def test_ports_and_brackets_are_dropped(
    monkeypatch: pytest.MonkeyPatch, value: str, address: str
) -> None:
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff(value)])

    assert seen.client == (address, 0)


async def test_zone_id_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """A zone only means something on the proxy's host, and a long one won't fit the audit log."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("fe80::7%eth0")])

    assert seen.client == ("fe80::7", 0)


async def test_ipv4_mapped_value_becomes_ipv4(monkeypatch: pytest.MonkeyPatch) -> None:
    """Otherwise one client gets two limiter buckets."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("::ffff:198.51.100.7")])

    assert seen.client == ("198.51.100.7", 0)


async def test_ipv4_mapped_peer_matches_an_ipv4_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """A dual-stack bind hands us mapped peers, and they still have to match 10.0.0.0/8."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("198.51.100.7")], ("::ffff:10.0.0.2", 5000))

    assert seen.client == ("198.51.100.7", 0)


@pytest.mark.parametrize("peer", ["10.0.0.2", "::ffff:10.0.0.2"])
async def test_mapped_trusted_entry_matches_plain_and_mapped_peers(
    monkeypatch: pytest.MonkeyPatch, peer: str
) -> None:
    """Config and peer both come out IPv4, so a mapped entry matches either way."""
    _trust(monkeypatch, "::ffff:10.0.0.0/104")

    seen = await _through([_xff("198.51.100.7")], (peer, 5000))

    assert seen.client == ("198.51.100.7", 0)


async def test_trusted_peer_with_nothing_forwarded_keeps_its_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No answer from the headers means the peer stays, not some placeholder."""
    _trust(monkeypatch, TRUSTED)

    seen = await _through([(b"user-agent", b"curl/8")])

    assert seen.client == FROM_TRUSTED


async def test_trusted_peer_with_nothing_forwarded_warns_once_naming_it(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A trusted proxy that forwards nothing is probably missing its XFF config."""
    _trust(monkeypatch, TRUSTED)
    middleware, _ = _middleware()

    for _ in range(2):
        await middleware(_scope([(b"user-agent", b"curl/8")], FROM_TRUSTED), _receive, _send)

    warnings = _logged(caplog, logging.WARNING)
    assert len(warnings) == 1
    assert TRUSTED_PEER in warnings[0]
    assert "X-Forwarded-For" in warnings[0]


@pytest.mark.parametrize(
    ("header", "headers"),
    [
        ("", [_xff("198.51.100.7")]),
        ("CF-Connecting-IP", [(b"cf-connecting-ip", b"203.0.113.50")]),
        ("CF-Connecting-IP", [(b"cf-connecting-ip", b"not-an-ip")]),
    ],
    ids=["forwarded-for", "client-ip-header", "unusable-client-ip-header"],
)
async def test_trusted_peer_that_forwards_stays_quiet(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    header: str,
    headers: list[Header],
) -> None:
    """Sending either header, even a broken one, isn't the forwarded-nothing case."""
    _trust(monkeypatch, TRUSTED, header=header)

    await _through(headers)

    assert _logged(caplog, logging.WARNING) == []


async def test_trusted_peer_keeps_forwarding_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    """request_scheme still needs the trusted proxy's Proto and Host."""
    _trust(monkeypatch, TRUSTED)
    headers = [
        _xff("198.51.100.7"),
        (b"x-forwarded-proto", b"https"),
        (b"x-forwarded-host", b"garage.example.com"),
    ]

    seen = await _through(headers)

    assert seen.headers == headers


# Client-IP header


async def test_client_ip_header_beats_forwarded_for(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED, header="CF-Connecting-IP")

    seen = await _through([(b"cf-connecting-ip", b"203.0.113.50"), _xff("10.0.0.9")])

    assert seen.client == ("203.0.113.50", 0)


async def test_client_ip_header_name_is_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED, header="CF-Connecting-IP")

    seen = await _through([(b"CF-Connecting-IP", b"203.0.113.50")])

    assert seen.client == ("203.0.113.50", 0)


async def test_missing_client_ip_header_falls_back_to_forwarded_for(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A LAN client that skipped Cloudflare still gets named by the proxy's XFF."""
    _trust(monkeypatch, TRUSTED, header="CF-Connecting-IP")

    seen = await _through([_xff("192.168.1.50")])

    assert seen.client == ("192.168.1.50", 0)


@pytest.mark.parametrize(
    "client_ip_lines",
    [
        [(b"cf-connecting-ip", b"not-an-ip")],
        [(b"cf-connecting-ip", b"203.0.113.50"), (b"cf-connecting-ip", b"203.0.113.51")],
        [(b"cf-connecting-ip", b"203.0.113.50, 203.0.113.51")],
    ],
    ids=["junk", "two-lines", "a-list"],
)
async def test_unusable_client_ip_header_falls_back_to_forwarded_for(
    monkeypatch: pytest.MonkeyPatch, client_ip_lines: list[Header]
) -> None:
    """Junk, repeated or a list: no telling which one the trusted layer wrote."""
    _trust(monkeypatch, TRUSTED, header="CF-Connecting-IP")

    seen = await _through([*client_ip_lines, _xff("198.51.100.7")])

    assert seen.client == ("198.51.100.7", 0)


# Scope handling and the startup log


async def test_lifespan_is_passed_through_untouched(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Real lifespan scopes have no client or headers; they're here so http handling would show."""
    _trust(monkeypatch, TRUSTED)
    middleware, downstream = _middleware()
    scope: Scope = {
        "type": "lifespan",
        "client": ("192.0.2.10", 1),
        "headers": [(b"x-forwarded-for", b"198.51.100.7")],
    }

    await middleware(scope, _receive, _send)

    assert downstream.scope is scope
    assert downstream.headers == [(b"x-forwarded-for", b"198.51.100.7")]
    assert downstream.client == ("192.0.2.10", 1)
    assert _logged(caplog, logging.WARNING) == []


async def test_websocket_is_resolved_too(monkeypatch: pytest.MonkeyPatch) -> None:
    _trust(monkeypatch, TRUSTED)

    seen = await _through([_xff("198.51.100.7")], scope_type="websocket")

    assert seen.client == ("198.51.100.7", 0)


async def test_caller_scope_carries_the_client_afterwards(monkeypatch: pytest.MonkeyPatch) -> None:
    """Granian's access log reads the client off its own scope dict after the app returns."""
    _trust(monkeypatch, TRUSTED)
    middleware, _ = _middleware()
    scope = _scope([_xff("198.51.100.7")], FROM_TRUSTED)

    await middleware(scope, _receive, _send)

    assert scope["client"] == ("198.51.100.7", 0)


def test_startup_log_names_networks_and_header(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _trust(monkeypatch, "10.0.0.0/8, 172.19.0.0/16", header="CF-Connecting-IP")

    log_proxy_settings()

    infos = _logged(caplog, logging.INFO)
    assert len(infos) == 1
    assert "10.0.0.0/8, 172.19.0.0/16" in infos[0]
    assert "cf-connecting-ip" in infos[0]


def test_startup_warns_about_a_header_without_proxies(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _trust(monkeypatch, "", header="CF-Connecting-IP")

    log_proxy_settings()

    warnings = _logged(caplog, logging.WARNING)
    assert len(warnings) == 1
    assert "MYGARAGE_CLIENT_IP_HEADER" in warnings[0]


def test_startup_says_nothing_when_unconfigured(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The default setup shouldn't log a line about proxies it doesn't have."""
    _trust(monkeypatch, "")

    log_proxy_settings()

    assert [r for r in caplog.records if r.name == LOGGER and r.levelno >= logging.INFO] == []
