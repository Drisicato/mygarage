"""OIDC constants shared by the admin routes and the operator tool."""

# How long an admin-armed SSO relink stays open. The admin route always arms for
# this long, and tools/oidc_allow_relink.py won't go past it.
SSO_RELINK_WINDOW_MINUTES: int = 30

# What a disabled account's SSO login or account link is told. Tests pin this
# string, so it's the wire contract, not just wording.
SSO_ACCOUNT_DISABLED: str = "User account is disabled"
