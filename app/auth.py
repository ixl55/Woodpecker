import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .db import get_db
from .models import User

# "Remember me": a sign-in lasts 30 days after the last visit. Each visit renews it (at most once an
# hour, so the cookie is not rewritten on every request); 30 days without a visit means signing in again.
REMEMBER_SECONDS = 30 * 24 * 60 * 60
RENEW_AFTER_SECONDS = 60 * 60

_hasher = PasswordHasher()
# verified against when the username does not exist, so a miss costs as much time as a wrong password
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


def start_session(request: Request, user: User) -> None:
    """Fresh session for `user` (clearing first prevents session fixation)."""
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["sv"] = user.session_version or 0
    request.session["seen"] = int(time.time())


def _session_user(session: dict, db: Session) -> User | None:
    user_id = session.get("user_id")
    seen = session.get("seen")
    if seen is not None and time.time() - seen > REMEMBER_SECONDS:
        return None  # away too long (the signed cookie also expires on its own)
    user = db.get(User, user_id) if user_id else None
    if user is None or session.get("sv", 0) != (user.session_version or 0):
        return None
    return user


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = _session_user(request.session, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    now = int(time.time())
    if now - request.session.get("seen", 0) >= RENEW_AFTER_SECONDS:
        request.session["seen"] = now  # a changed session is re-signed: 30 fresh days from this visit
    return user


def ws_user(websocket, db: Session) -> User | None:
    """Session user for a WebSocket (SessionMiddleware fills websocket.session too)."""
    return _session_user(websocket.session, db) if "session" in websocket.scope else None
