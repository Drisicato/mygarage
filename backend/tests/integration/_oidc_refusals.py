"""What an SSO refusal says, the code it sends the login page, and the check for that redirect.

The sentences and codes are the tests' own copies, never imported from ``app``,
so a change to one in the app fails a test instead of quietly moving with it.
Only the cookie name comes from ``app.config.settings``, since it's config, not
something under test.
"""

from urllib.parse import parse_qs, urlsplit

from httpx import Response

from app.config import settings

DISABLED = "User account is disabled"
EMAIL_LINKED_ELSEWHERE = (
    "This email belongs to an account that is linked to a different sign-in. "
    "Ask an administrator to allow an SSO relink for it."
)
EMAIL_NO_PASSWORD = (
    "An account with this email exists but has no password to confirm it. "
    "Ask an administrator to allow an SSO relink for it."
)
USERNAME_LINKED_ELSEWHERE = (
    "This username belongs to an account that is linked to a different sign-in. "
    "Ask an administrator to allow an SSO relink for it."
)
USERNAME_NO_PASSWORD = (
    "An account with this username exists but has no password to confirm it. "
    "Ask an administrator to allow an SSO relink for it."
)
NO_ACCOUNT = (
    "No MyGarage account matches this sign-in, and automatic account creation is off. "
    "Ask an administrator to create your account."
)

# The code each refusal sends the login page, as the frontend matches it.
CODES: dict[str, str] = {
    DISABLED: "account_disabled",
    EMAIL_LINKED_ELSEWHERE: "email_linked_elsewhere",
    EMAIL_NO_PASSWORD: "email_no_password",
    USERNAME_LINKED_ELSEWHERE: "username_linked_elsewhere",
    USERNAME_NO_PASSWORD: "username_no_password",
    NO_ACCOUNT: "no_account",
}

# Every code a refusal can send the login page.
REFUSAL_CODES: tuple[str, ...] = tuple(CODES.values())


def sets_auth_cookie(response: Response) -> bool:
    """Whether the response sets the session cookie."""
    return any(
        cookie.startswith(f"{settings.jwt_cookie_name}=")
        for cookie in response.headers.get_list("set-cookie")
    )


def assert_sent_to_login(response: Response, code: str) -> None:
    """A 302 to the login page carrying the code and nothing else, and no auth cookie."""
    assert response.status_code == 302, response.text
    location = urlsplit(response.headers["location"])
    assert location.path == "/login"
    assert parse_qs(location.query) == {"sso_error": [code]}
    assert not sets_auth_cookie(response)
