"""OIDC constants shared by the SSO routes, the admin routes and the operator tool."""

from enum import StrEnum

# How long an admin-armed SSO relink stays open. The admin route always arms for
# this long, and tools/oidc_allow_relink.py won't go past it.
SSO_RELINK_WINDOW_MINUTES: int = 30

# What a disabled account's SSO login or account link is told. Tests pin this
# string, so it's the wire contract, not just wording.
SSO_ACCOUNT_DISABLED: str = "User account is disabled"


class SSOError(StrEnum):
    """Why an SSO sign-in sent the browser back to the login page.

    The value goes out as ``/login?sso_error=<value>`` and the login page matches
    it against its own list, so these strings are the wire contract.
    """

    ACCOUNT_DISABLED = "account_disabled"
    EMAIL_LINKED_ELSEWHERE = "email_linked_elsewhere"
    EMAIL_NO_PASSWORD = "email_no_password"
    USERNAME_LINKED_ELSEWHERE = "username_linked_elsewhere"
    USERNAME_NO_PASSWORD = "username_no_password"
    NO_ACCOUNT = "no_account"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    FAILED = "failed"
    RATE_LIMITED = "rate_limited"
