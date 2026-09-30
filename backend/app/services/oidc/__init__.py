"""OIDC/OpenID Connect authentication service.

This package handles OAuth2/OIDC authentication flow with support for:
- Generic OIDC provider support (Authentik, Keycloak, Auth0, Okta, etc.)
- Password-confirmed account linking (an email or username match links an
  existing account only after its password is entered, or through a one-time
  relink an admin armed on it)
- Automatic user creation from OIDC claims
- Group-based admin role mapping
- Provider metadata discovery
- Token validation and user info retrieval

All public functions are re-exported here so that existing imports like
``from app.services.oidc import get_oidc_config`` continue to work.
"""

from .config import get_oidc_config, get_provider_metadata, write_oidc_config
from .diagnostics import test_oidc_connection
from .linking import (
    create_pending_link_token,
    validate_and_consume_pending_link,
)
from .state import store_oidc_state, validate_and_consume_state
from .tokens import (
    MASKED_SECRET_PLACEHOLDER,
    display_mask_secret,
    exchange_code_for_tokens,
    get_userinfo,
    is_masked_secret,
    mask_secret,
    verify_id_token,
)
from .users import (
    create_authorization_url,
    create_or_update_user_from_oidc,
    generate_state,
)

__all__ = [
    # config
    "get_oidc_config",
    "get_provider_metadata",
    "write_oidc_config",
    # state
    "store_oidc_state",
    "validate_and_consume_state",
    # tokens
    "exchange_code_for_tokens",
    "verify_id_token",
    "get_userinfo",
    "mask_secret",
    "display_mask_secret",
    "is_masked_secret",
    "MASKED_SECRET_PLACEHOLDER",
    # users
    "create_authorization_url",
    "create_or_update_user_from_oidc",
    "generate_state",
    # linking
    "create_pending_link_token",
    "validate_and_consume_pending_link",
    # diagnostics
    "test_oidc_connection",
]
