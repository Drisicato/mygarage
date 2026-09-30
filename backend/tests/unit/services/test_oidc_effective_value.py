"""effective_oidc_value: a blank OIDC setting means its default."""

import pytest

from app.services.oidc.config import OIDC_DEFAULTS, effective_oidc_value


@pytest.mark.parametrize("key", list(OIDC_DEFAULTS))
@pytest.mark.parametrize("stored", [None, "", "   "])
def test_unset_or_blank_is_the_default(key: str, stored: str | None):
    config = {} if stored is None else {key: stored}
    assert effective_oidc_value(config, key) == OIDC_DEFAULTS[key]


def test_a_set_value_is_stripped():
    assert effective_oidc_value({"email_claim": " mail "}, "email_claim") == "mail"


class TestFullNameClaim:
    """Resolves full_name_claim, then the seeded name_claim, then "name"."""

    def test_full_name_claim_wins(self):
        config = {"full_name_claim": "display_name", "name_claim": "legacy"}
        assert effective_oidc_value(config, "full_name_claim") == "display_name"

    def test_then_the_seeded_name_claim(self):
        config = {"full_name_claim": " ", "name_claim": "legacy"}
        assert effective_oidc_value(config, "full_name_claim") == "legacy"

    def test_then_name(self):
        config = {"full_name_claim": "", "name_claim": ""}
        assert effective_oidc_value(config, "full_name_claim") == "name"


def test_the_defaults():
    assert OIDC_DEFAULTS == {
        "scopes": "openid profile email",
        "username_claim": "preferred_username",
        "email_claim": "email",
        "full_name_claim": "name",
    }
