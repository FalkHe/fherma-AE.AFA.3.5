"""Schemas for the authentication endpoints.

`/auth/*` is plain JSON and exempt from JSON:API, but it keeps the camelCase
attribute convention of the rest of the API: Python stays snake_case and the
alias generator does the translation on the wire.

The username and password rules are field validators rather than checks inside
the endpoints, so a rejected value produces FastAPI's default 422 body with the
offending field in `loc`.
"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 32
# Applied after normalisation: uppercase input is folded, not rejected.
USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]+$")

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


class AuthSchema(BaseModel):
    """Base for the auth payloads: camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _CredentialsRequest(AuthSchema):
    """A username/password pair carrying the pinned validation rules."""

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        """Fold the username to its stored form and reject unusable ones."""
        normalized = value.strip().lower()

        if not USERNAME_MIN_LENGTH <= len(normalized) <= USERNAME_MAX_LENGTH:
            raise ValueError(
                f"Username must be between {USERNAME_MIN_LENGTH} and "
                f"{USERNAME_MAX_LENGTH} characters long."
            )
        if USERNAME_PATTERN.match(normalized) is None:
            raise ValueError(
                "Username may only contain lowercase letters, digits, "
                "underscores, dots and hyphens."
            )
        return normalized

    @field_validator("password")
    @classmethod
    def check_password_length(cls, value: str) -> str:
        """Enforce the length bounds; there is deliberately no other policy."""
        if not PASSWORD_MIN_LENGTH <= len(value) <= PASSWORD_MAX_LENGTH:
            raise ValueError(
                f"Password must be between {PASSWORD_MIN_LENGTH} and "
                f"{PASSWORD_MAX_LENGTH} characters long."
            )
        return value


class RegisterRequest(_CredentialsRequest):
    """Credentials for a new account."""


class LoginRequest(_CredentialsRequest):
    """Credentials for an existing account, plus the cookie lifetime choice."""

    remember_me: bool = False


class UserResponse(AuthSchema):
    """The authenticated account, as every `/auth/*` success body returns it."""

    id: str
    username: str
    role: Literal["user", "admin"]
