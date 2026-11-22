"""Dashboard security primitives: PBKDF2 password hashing, JWT sessions, rate limiting."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque

import jwt

PBKDF2_ITERATIONS = 390_000


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    if len(password) < 12:
        raise ValueError("password must be at least 12 characters")
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, it, salt_b64, dk_b64 = encoded.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(it))
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except (ValueError, TypeError):
        return False


class TokenService:
    def __init__(self, secret: str, ttl_minutes: int = 60) -> None:
        if len(secret) < 32:
            raise ValueError("JWT secret must be at least 32 characters")
        self.secret = secret
        self.ttl = ttl_minutes * 60

    def issue(self, subject: str, role: str = "operator") -> str:
        now = int(time.time())
        return jwt.encode({"sub": subject, "role": role, "iat": now, "exp": now + self.ttl,
                           "jti": secrets.token_hex(8)}, self.secret, algorithm="HS256")

    def verify(self, token: str) -> dict:
        return jwt.decode(token, self.secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})


class RateLimiter:
    """Sliding-window limiter keyed by (bucket, client)."""

    def __init__(self) -> None:
        self.hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, bucket: str, client: str, limit: int, window_s: float = 60.0) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[(bucket, client)]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True
