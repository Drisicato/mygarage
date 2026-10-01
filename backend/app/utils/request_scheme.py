"""Request scheme resolution utilities for cookie security and redirect URLs.

Centralizes scheme detection from proxy headers and request context.
Used by auth routes (cookie Secure flag) and OIDC routes (redirect URLs).
"""

import logging
import os

from fastapi import Request

from app.config import settings

logger = logging.getLogger(__name__)


def get_request_scheme(request: Request) -> str:
    """Resolve the effective scheme (http/https) from request context.

    Checks X-Forwarded-Proto first (set by reverse proxies like Traefik/nginx),
    then falls back to request.url.scheme from the ASGI server.

    Trust model:
        With MYGARAGE_TRUSTED_PROXIES set, TrustedProxyMiddleware drops
        X-Forwarded-Proto from any peer outside it before this runs. Unset,
        it's read from anyone, as before: spoofing it on a direct HTTP
        connection can only cause self-denial-of-service (cookie gets
        Secure=True, browser drops it). It cannot weaken security because
        setting the Secure flag too high never exposes cookies, it only
        prevents them from being stored.

    Defensive parsing:
        - Lowercased and stripped
        - Comma-separated values: first value wins (leftmost = client-facing proxy)
        - Only "https" is accepted as truthy; everything else resolves to "http"

    Args:
        request: The incoming FastAPI/Starlette request.

    Returns:
        "https" if HTTPS is detected, "http" otherwise.
    """
    forwarded_proto = request.headers.get("x-forwarded-proto")

    if forwarded_proto:
        # Take first value if comma-separated (multi-proxy chains)
        scheme = forwarded_proto.split(",")[0].strip().lower()
        if scheme == "https":
            return "https"
        return "http"

    # Fall back to ASGI server's reported scheme
    return str(request.url.scheme).lower()


def get_external_base_url(request: Request) -> str:
    """Absolute origin (+ root_path) the outside world reaches this app on.

    For URLs that must be usable *outside* the browser session that fetched
    them — an OIDC redirect the IdP will call back, or an ingest URL a user
    pastes into Torque Pro or a WiCAN dongle. Those cannot be relative.

    Mirrors the OIDC resolution (#107): X-Forwarded-Proto/Host first, since
    behind Cloudflare Tunnel or Traefik the request's own URL is the internal
    one, then the Host header, then whatever the ASGI server reports.

    Trust model: `Host`/`X-Forwarded-Host` are attacker-influenceable in
    principle, so callers with an operator-configured base URL should prefer
    that and treat this as the fallback. With MYGARAGE_TRUSTED_PROXIES set,
    TrustedProxyMiddleware drops X-Forwarded-Proto and X-Forwarded-Host from
    any peer outside it before this runs; unset, they're read from anyone, as
    before. The LiveLink pages show it to a signed-in user for copy-paste. SSO
    sends it to the IdP as the redirect_uri, which the IdP checks against its
    registered list, so a forged host gets refused there.

    Returns:
        e.g. "https://garage.example.com" — no trailing slash unless
        `root_path` supplies one.
    """
    scheme = get_request_scheme(request)
    host = request.headers.get("x-forwarded-host", request.headers.get("host")) or str(
        request.base_url.hostname
    )
    # Multi-proxy chains send a comma-separated list; leftmost is client-facing.
    host = host.split(",")[0].strip()
    return f"{scheme}://{host}{settings.root_path}"


def get_cookie_secure(request: Request) -> bool:
    """Determine the cookie Secure flag for the current request.

    Priority:
        1. Explicit JWT_COOKIE_SECURE env var — operator override, no auto-detection.
        2. Auto-detect via get_request_scheme() — True if HTTPS detected.

    The env var is read directly (not via settings.jwt_cookie_secure) to cleanly
    distinguish "operator explicitly chose" from "auto-detect from request".
    settings.jwt_cookie_secure conflates both into a single bool with no way
    to tell which path produced the value.

    Args:
        request: The incoming FastAPI/Starlette request.

    Returns:
        True if the cookie should have the Secure flag, False otherwise.
    """
    env_value = os.getenv("JWT_COOKIE_SECURE")

    if env_value is not None:
        normalized = env_value.strip().lower()
        if normalized in ("true", "1", "yes"):
            logger.debug("Cookie secure flag: True (explicit env override)")
            return True
        if normalized in ("false", "0", "no"):
            logger.debug("Cookie secure flag: False (explicit env override)")
            return False
        # Unrecognized value (including "auto") falls through to detection

    scheme = get_request_scheme(request)
    secure = scheme == "https"
    logger.debug("Cookie secure flag: %s (auto-detected scheme=%s)", secure, scheme)
    return secure
