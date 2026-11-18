"""Edit lock: an optional password asked by the card before its editors open, enforced on every write of the API.

It guards against changes made by mistake on a shared screen where an administrator account stays logged in (the
writes are already refused to the other users). The password is kept salted and hashed in the options of the config
entry; a correct password gives a token, kept in memory, that expires after a while without any write.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections.abc import Callable
from typing import Any

from .const import UNLOCK_MAX_FAILURES, UNLOCK_PENALTY, UNLOCK_TTL

ITERATIONS = 200_000
MIN_LENGTH = 4


def hash_password(password: str, salt: str | None = None, iterations: int = ITERATIONS) -> dict[str, Any]:
    """Salted PBKDF2 hash, as stored in the options (slow on purpose: call it from the executor)."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), iterations)
    return {"salt": salt, "hash": digest.hex(), "iterations": iterations}


def verify_password(lock: dict[str, Any], password: str) -> bool:
    """True when the password matches the stored hash (a damaged record never matches)."""
    try:
        expected = hash_password(password, lock["salt"], int(lock["iterations"]))["hash"]
        return hmac.compare_digest(expected, lock["hash"])
    except (KeyError, TypeError, ValueError):
        return False


class Unlocks:
    """Tokens handed out after a correct password. They live in memory: a restart asks for the password again."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._tokens: dict[str, float] = {}  # token -> expiry
        self._failures = 0
        self._blocked_until = 0.0

    def blocked(self) -> int:
        """Seconds to wait before the next try, after too many wrong passwords (0 = go ahead)."""
        return max(0, round(self._blocked_until - self._clock()))

    def fail(self) -> None:
        self._failures += 1
        if self._failures >= UNLOCK_MAX_FAILURES:
            self._failures = 0
            self._blocked_until = self._clock() + UNLOCK_PENALTY

    def grant(self) -> str:
        now = self._clock()
        self._failures = 0
        self._tokens = {t: end for t, end in self._tokens.items() if end > now}
        token = secrets.token_urlsafe(24)
        self._tokens[token] = now + UNLOCK_TTL
        return token

    def valid(self, token: str | None) -> bool:
        """True for a live token, whose life is extended: the lock comes back after UNLOCK_TTL without any use."""
        now = self._clock()
        if not token or self._tokens.get(token, 0.0) <= now:
            return False
        self._tokens[token] = now + UNLOCK_TTL
        return True

    def revoke(self, token: str | None) -> None:
        self._tokens.pop(token or "", None)

    def clear(self) -> None:
        """Forget every token (the password was changed or removed)."""
        self._tokens.clear()
        self._failures = 0
        self._blocked_until = 0.0
