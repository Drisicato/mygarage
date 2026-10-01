"""Custom exceptions for MyGarage application."""

from typing import Any

from app.constants.oidc import SSOError


class SSRFProtectionError(Exception):
    """Raised when a URL fails SSRF (Server-Side Request Forgery) validation.

    This exception indicates that a URL was blocked for security reasons,
    either because it points to a private/internal resource (localhost, private IPs,
    cloud metadata endpoints) or violates other SSRF protection policies.

    Used by url_validation.py to prevent attackers from using the application
    to access internal services or sensitive endpoints.
    """

    pass


class PendingLinkRequiredError(Exception):
    """Raised when OIDC linking requires the matched account's password.

    This exception is raised during OIDC authentication when no account has the
    login's OIDC subject and either:
    - The email claim matches an active account that has a password and no
      OIDC link, or
    - The username claim matches an active account that has a password and is
      not linked to a different OIDC subject
    and no admin-armed relink is open on that account (an open one links it).

    ``username`` is always the matched account's username, which for an email
    match can differ from the claim's. The pending link finds its target by it.

    The exception carries the necessary data to create a pending link token
    and redirect the user to the password verification flow.
    """

    def __init__(
        self,
        username: str,
        claims: dict[str, Any],
        userinfo: dict[str, Any] | None,
        config: dict[str, str],
    ):
        """Initialize the exception with OIDC authentication data.

        Args:
            username: The matched username that requires verification
            claims: ID token claims from the OIDC provider
            userinfo: Optional userinfo endpoint claims
            config: OIDC provider configuration
        """
        self.username = username
        self.claims = claims
        self.userinfo = userinfo
        self.config = config
        super().__init__(f"Username '{username}' requires password verification for OIDC linking")


class OIDCLoginRefusedError(Exception):
    """Raised when an SSO login matches an account it may not sign into.

    Raised during OIDC login resolution when the matched account is disabled,
    is already linked to a different OIDC subject, or has no password to confirm
    ownership with, and when nothing matched and automatic account creation is
    off. Nothing on the matched account has been changed when it is raised.

    ``message`` is written for the person signing in. It's the audit row's
    reason and the log line, and the link step shows it as its 403 detail.
    ``code`` is what the callback sends the login page, which shows its own
    sentence for it. ``username`` is the matched MyGarage account, for the audit
    trail, or None when no account was matched. ``details`` goes into the audit
    row next to the reason, like the identity a sign-in claimed when no account
    matched it.
    """

    def __init__(
        self,
        message: str,
        *,
        code: SSOError,
        username: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        """Initialize the refusal.

        Args:
            message: Why the login was refused, safe to show the user
            code: The reason code the login page gets for it
            username: The matched account's username, if an account was matched
            details: Extra keys for the audit row's details, never shown to the user
        """
        self.message = message
        self.code = code
        self.username = username
        self.details = details
        super().__init__(message)
