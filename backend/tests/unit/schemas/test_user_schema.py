"""The local account create schemas keep the username rule.

It used to sit on the shared base, where it ran on every stored user a response
read. SSO usernames come from the identity provider and are deliberately not
held to it, so it lives on the inputs that make a local account.
"""

import pytest
from pydantic import ValidationError

from app.schemas.user import AdminUserCreate, UserCreate

ACCOUNT = {"email": "a.b@example.com", "password": "Str0ng!Pass"}


@pytest.mark.parametrize("schema", [UserCreate, AdminUserCreate])
def test_create_refuses_a_username_with_a_dot(schema):
    """A guard: true today.

    Mutant: delete the base's validator without adding it to the create.
    """
    with pytest.raises(ValidationError, match="Username can only contain"):
        schema(username="a.b", **ACCOUNT)
