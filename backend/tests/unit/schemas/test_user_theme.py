"""The account theme accepts exactly the themes the frontend offers.

``SUPPORTED_THEMES`` mirrors the frontend's ``Theme`` union
(``src/contexts/ThemeContext.tsx``), and both self-service and admin updates
validate against it.
"""

import pytest
from pydantic import ValidationError

from app.schemas.user import AdminUserUpdate, UserSelfUpdate


@pytest.mark.parametrize("schema", [UserSelfUpdate, AdminUserUpdate])
@pytest.mark.parametrize("theme", ["light", "dark", "grey"])
def test_update_accepts_every_supported_theme(schema, theme):
    assert schema(theme=theme).theme == theme


@pytest.mark.parametrize("schema", [UserSelfUpdate, AdminUserUpdate])
def test_update_refuses_an_unknown_theme(schema):
    with pytest.raises(ValidationError, match="Unsupported theme"):
        schema(theme="purple")
