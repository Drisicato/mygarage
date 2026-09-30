"""OIDC constants shared by the admin routes and the operator tool."""

# How long an admin-armed SSO relink stays open. The admin route always arms for
# this long, and tools/oidc_allow_relink.py won't go past it.
SSO_RELINK_WINDOW_MINUTES: int = 30
