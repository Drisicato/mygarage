"""Custom exceptions for MyGarage application."""

from typing import Any


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
    ownership with. Nothing on the matched account has been changed when it is
    raised.

    ``message`` is written for the person signing in and is meant to be shown as
    the 403 detail. ``username`` is the matched MyGarage account, for the audit
    trail, or None when no account was matched.
    """

    def __init__(self, message: str, username: str | None = None):
        """Initialize the refusal.

        Args:
            message: Why the login was refused, safe to show the user
            username: The matched account's username, if an account was matched
        """
        self.message = message
        self.username = username
        super().__init__(message)
