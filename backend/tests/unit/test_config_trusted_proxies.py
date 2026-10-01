"""MYGARAGE_TRUSTED_PROXIES and MYGARAGE_CLIENT_IP_HEADER, read the way a deployment reads them."""

from ipaddress import IPv4Network, IPv6Network

import pytest
from pydantic import ValidationError

from app.config import Settings

PROXIES_ENV = "MYGARAGE_TRUSTED_PROXIES"
HEADER_ENV = "MYGARAGE_CLIENT_IP_HEADER"


@pytest.fixture(autouse=True)
def _secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep Settings() from going after /data for a secret key, which only spams the log here."""
    monkeypatch.setenv("MYGARAGE_SECRET_KEY", "test-secret")


def test_trusted_proxies_default_to_nobody(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unset trusts nobody."""
    monkeypatch.delenv(PROXIES_ENV, raising=False)

    assert Settings().trusted_proxies == ()


def test_trusted_proxies_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Comma-separated, stripped, empty entries dropped, bare IPs become single-host networks."""
    monkeypatch.setenv(PROXIES_ENV, "10.0.0.0/8, 172.19.0.5 ,::1,,")

    assert Settings().trusted_proxies == (
        IPv4Network("10.0.0.0/8"),
        IPv4Network("172.19.0.5/32"),
        IPv6Network("::1/128"),
    )


def test_trusted_proxies_mask_host_bits(monkeypatch: pytest.MonkeyPatch) -> None:
    """A CIDR with host bits set is masked down, like MYGARAGE_TRUSTED_HOSTS."""
    monkeypatch.setenv(PROXIES_ENV, "172.19.0.1/16")

    assert Settings().trusted_proxies == (IPv4Network("172.19.0.0/16"),)


@pytest.mark.parametrize(
    ("raw", "entry"),
    [
        ("*", "*"),
        ("0.0.0.0/0", "0.0.0.0/0"),
        ("::/0", "::/0"),
        ("10.0.0.0/8, *", "*"),
        ("::ffff:0:0/96", "::ffff:0:0/96"),
    ],
)
def test_trusted_proxies_refuse_trusting_everyone(
    monkeypatch: pytest.MonkeyPatch, raw: str, entry: str
) -> None:
    """Anything that trusts every client is refused, named as written."""
    monkeypatch.setenv(PROXIES_ENV, raw)

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert f"can't include {entry!r}" in str(excinfo.value)


@pytest.mark.parametrize(
    "raw",
    [
        "10.0.0.300",
        "proxy.example.com",
        "10.0.0.0/33",
        "10.0.0.1-10.0.0.9",
        "10.0.0.0/8;172.19.0.0/16",
    ],
)
def test_trusted_proxies_name_a_bad_entry(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    """An entry that isn't an IP or network is refused, and the message says which one."""
    monkeypatch.setenv(PROXIES_ENV, raw)

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert f"has {raw!r}, which isn't an IP address or network" in str(excinfo.value)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("::ffff:10.0.0.2", (IPv4Network("10.0.0.2/32"),)),
        ("::ffff:10.0.0.0/104", (IPv4Network("10.0.0.0/8"),)),
    ],
)
def test_trusted_proxies_map_ipv4_mapped_entries_to_ipv4(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: tuple[IPv4Network, ...]
) -> None:
    """IPv4-mapped entries become IPv4, so they match mapped peers once those turn into IPv4."""
    monkeypatch.setenv(PROXIES_ENV, raw)

    assert Settings().trusted_proxies == expected


def test_trusted_proxies_refuse_a_network_covering_the_mapped_range(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An IPv6 network that swallows the whole mapped range is refused."""
    monkeypatch.setenv(PROXIES_ENV, "::/64")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "has '::/64', which covers IPv4-mapped addresses" in str(excinfo.value)


def test_client_ip_header_defaults_to_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unset means no client-IP header is read."""
    monkeypatch.delenv(HEADER_ENV, raising=False)

    assert Settings().client_ip_header == ""


def test_client_ip_header_is_stored_lowercase(monkeypatch: pytest.MonkeyPatch) -> None:
    """The name is stripped and lowercased, the way ASGI hands headers over."""
    monkeypatch.setenv(HEADER_ENV, " CF-Connecting-IP ")

    assert Settings().client_ip_header == "cf-connecting-ip"


@pytest.mark.parametrize("raw", ["CF Connecting IP", "x-real-ip:", "X-Réal-IP"])
def test_client_ip_header_refuses_a_bad_name(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    """Anything outside the RFC 9110 token characters is refused."""
    monkeypatch.setenv(HEADER_ENV, raw)

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert f"{raw!r} isn't a valid header name" in str(excinfo.value)


@pytest.mark.parametrize("raw", ["X-Forwarded-For", "x-forwarded-for"])
def test_client_ip_header_refuses_x_forwarded_for(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """X-Forwarded-For is already read from trusted proxies, so naming it here is refused."""
    monkeypatch.setenv(HEADER_ENV, raw)

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "can't be X-Forwarded-For" in str(excinfo.value)
