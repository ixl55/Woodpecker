"""Security helpers: rate limiting, password rules, client IP, and the HTTP hardening middleware.

The limiter keeps its counters in memory. That matches the single-process deployment (the live-duel
hub has the same constraint); running several workers would need a shared store such as Redis.
"""
import base64
import hashlib
import os
import re
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------- rate limiting
class RateLimiter:
    """Sliding-window counters keyed by any string (IP, username, user id...)."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _window(self, key: str, window: float, now: float) -> deque[float]:
        q = self._hits[key]
        while q and q[0] <= now - window:
            q.popleft()
        return q

    def check(self, key: str, limit: int, window: float) -> int:
        """Seconds to wait before `key` may act again (0 = allowed). Does not record anything."""
        now = time.monotonic()
        with self._lock:
            q = self._window(key, window, now)
            return int(q[0] + window - now) + 1 if len(q) >= limit else 0

    def hit(self, key: str, limit: int, window: float) -> int:
        """Record one action if allowed; returns seconds to wait when the limit is already reached."""
        now = time.monotonic()
        with self._lock:
            q = self._window(key, window, now)
            if len(q) >= limit:
                return int(q[0] + window - now) + 1
            q.append(now)
            if len(self._hits) > 50_000:  # drop idle keys so memory stays bounded
                for k in [k for k, v in self._hits.items() if not v or v[-1] <= now - 3600]:
                    del self._hits[k]
            return 0

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()

# (limit, window in seconds)
LOGIN_PER_ACCOUNT = (5, 15 * 60)  # failed sign-ins on one username
LOGIN_PER_IP = (30, 15 * 60)  # failed sign-ins from one address, across usernames
REGISTER_PER_IP = (5, 60 * 60)
API_PER_IP = (600, 60)
API_WRITES_PER_IP = (150, 60)
FRIEND_REQUESTS_PER_USER = (20, 60 * 60)
CHALLENGES_PER_USER = (30, 60 * 60)
SEARCHES_PER_USER = (60, 60)
MAX_PENDING_SENT = 50  # outgoing friend requests waiting for an answer
MAX_OPEN_CHALLENGES = 10  # invitations one player can have waiting at once


def too_many(wait: int, what: str = "requests") -> HTTPException:
    minutes = max(1, round(wait / 60))
    when = f"{minutes} minute{'s' if minutes != 1 else ''}" if wait >= 60 else f"{wait} seconds"
    return HTTPException(429, f"Too many {what}. Wait {when} and try again.", headers={"Retry-After": str(wait)})


def enforce(key: str, limit_window: tuple[int, int], what: str = "requests") -> None:
    wait = limiter.hit(key, *limit_window)
    if wait:
        raise too_many(wait, what)


def client_ip(request: Request) -> str:
    """The caller's address. Behind a proxy, trust only the entries our own proxies appended
    (the right-most PROXY_HOPS of X-Forwarded-For); anything further left is client-supplied."""
    hops = int(os.environ.get("PROXY_HOPS", "1") or 0)
    forwarded = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    if hops and forwarded:
        return forwarded[-min(hops, len(forwarded))]
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------- passwords
PASSWORD_MIN, PASSWORD_MAX = 10, 128
COMMON_PASSWORDS = {
    "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword1",
    "qwerty", "qwerty123", "qwertyuiop", "qwerty1234", "1q2w3e4r", "1q2w3e4r5t", "zaq12wsx", "asdfghjkl",
    "123456", "1234567", "12345678", "123456789", "1234567890", "0123456789", "987654321", "111111", "000000",
    "abc123", "abcd1234", "iloveyou", "letmein", "welcome", "welcome1", "welcome123", "admin", "admin123",
    "administrator", "monkey", "dragon", "football", "baseball", "sunshine", "princess", "shadow", "master",
    "superman", "trustno1", "chess", "chess123", "chessmaster", "checkmate", "checkmate1", "woodpecker",
    "woodpecker1", "grandmaster", "magnus", "kasparov", "fischer",
}
PASSWORD_RULES = [
    ("length", f"at least {PASSWORD_MIN} characters"),
    ("lower", "a lowercase letter"),
    ("upper", "an uppercase letter"),
    ("digit", "a number"),
    ("symbol", "a symbol such as ! ? # or @"),
]


def password_problems(password: str) -> list[str]:
    """Every rule the password breaks, as short phrases for one friendly message."""
    missing = []
    if len(password) < PASSWORD_MIN:
        missing.append(PASSWORD_RULES[0][1])
    if not re.search(r"[a-z]", password):
        missing.append(PASSWORD_RULES[1][1])
    if not re.search(r"[A-Z]", password):
        missing.append(PASSWORD_RULES[2][1])
    if not re.search(r"\d", password):
        missing.append(PASSWORD_RULES[3][1])
    if not re.search(r"[^A-Za-z0-9]", password):
        missing.append(PASSWORD_RULES[4][1])
    return missing


def check_password(password: str, username: str = "") -> None:
    """Raise a 400 that says exactly what to fix."""
    if len(password) > PASSWORD_MAX:
        raise HTTPException(400, f"That password is too long. Use at most {PASSWORD_MAX} characters.")
    missing = password_problems(password)
    if missing:
        raise HTTPException(400, "Your password needs " + _join(missing) + ".")
    lowered = password.lower()
    if username and len(username) >= 3 and username.lower() in lowered:
        raise HTTPException(400, "Your password can't contain your username.")
    core = re.sub(r"[^a-z]", "", lowered)
    if lowered in COMMON_PASSWORDS or core in COMMON_PASSWORDS:
        raise HTTPException(400, "That password is too common and easy to guess. Pick something less predictable.")
    if len(set(password)) < 5:
        raise HTTPException(400, "That password repeats too few characters. Mix in more variety.")


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


# ---------------------------------------------------------------- HTTP hardening
MAX_BODY = 32 * 1024  # every JSON body in this API is tiny
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def inline_script_hashes(html: str) -> list[str]:
    """CSP hashes for the inline <script> blocks of index.html (the pre-paint theme script)."""
    blocks = re.findall(r"<script>(.*?)</script>", html, flags=re.S)
    return [f"'sha256-{base64.b64encode(hashlib.sha256(b.encode()).digest()).decode()}'" for b in blocks]


def content_security_policy(script_hashes: list[str]) -> str:
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' {' '.join(script_hashes)}",
        # style attributes carry per-item colours (swatches, board previews)
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        # older Safari does not count ws(s) as 'self'; {host} is filled in per request
        "connect-src 'self' wss://{host} ws://{host}",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


def same_origin(origin: str, request_host: str, forwarded_host: str | None) -> bool:
    netloc = urlparse(origin).netloc.lower()
    return netloc in {h.lower() for h in (request_host, forwarded_host) if h}


def security_middleware(csp: str, https_only: bool):
    async def middleware(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/"):
            # 1. oversized bodies
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BODY:
                return JSONResponse({"detail": "That request is too large."}, status_code=413)
            # 2. cross-site writes (defence in depth on top of SameSite cookies)
            origin = request.headers.get("origin")
            if request.method in UNSAFE and origin and not same_origin(
                    origin, request.headers.get("host", ""), request.headers.get("x-forwarded-host")):
                return JSONResponse({"detail": "Cross-site requests are not allowed."}, status_code=403)
            # 3. general flood control per address
            ip = client_ip(request)
            wait = limiter.hit(f"api:{ip}", *API_PER_IP)
            if not wait and request.method in UNSAFE:
                wait = limiter.hit(f"api-write:{ip}", *API_WRITES_PER_IP)
            if wait:
                return JSONResponse({"detail": too_many(wait).detail}, status_code=429, headers={"Retry-After": str(wait)})
        response = await call_next(request)
        h = response.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "same-origin"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
        h["Content-Security-Policy"] = csp.replace("{host}", re.sub(r"[^A-Za-z0-9.:\[\]-]", "", host))
        if https_only:
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if path.startswith("/api/"):
            h["Cache-Control"] = "no-store"
        return response

    return middleware
