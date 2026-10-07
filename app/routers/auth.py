import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..auth import current_user, hash_password, start_session, verify_password
from ..db import get_db
from ..models import (Attempt, Challenge, ChallengePlayer, ChallengeResult, Friendship, Profile, ReviewCard, SprintRun,
                      User)
from ..security import (LOGIN_PER_ACCOUNT, LOGIN_PER_IP, PASSWORD_MAX, REGISTER_PER_IP, check_password, client_ip,
                        enforce, limiter, too_many)

router = APIRouter(prefix="/api/auth", tags=["auth"])
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")


class Credentials(BaseModel):
    username: str = Field(max_length=40)
    password: str = Field(max_length=PASSWORD_MAX)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=PASSWORD_MAX)
    new_password: str = Field(max_length=PASSWORD_MAX)


class AccountDeletion(BaseModel):
    password: str = Field(max_length=PASSWORD_MAX)
    confirm: str = Field(max_length=40)  # the username, typed out


def _me(user: User, db: Session) -> dict:
    from .profile import get_or_create, profile_out  # local import: profile imports auth helpers
    return {"id": user.id, **profile_out(user, get_or_create(db, user))}


@router.post("/register")
def register(body: Credentials, request: Request, db: Session = Depends(get_db)):
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "That username won't work. Use 3–40 letters or digits; dots, dashes and underscores are fine.")
    check_password(body.password, username)
    enforce(f"register:{client_ip(request)}", REGISTER_PER_IP, "new accounts from this network")
    if db.query(User).filter(func.lower(User.username) == username.lower()).first():
        raise HTTPException(409, "That username is already taken. Try another one.")
    user = User(username=username, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    start_session(request, user)
    return _me(user, db)


@router.post("/login")
def login(body: Credentials, request: Request, db: Session = Depends(get_db)):
    name = body.username.strip().lower()
    account_key, ip_key = f"login-user:{name}", f"login-ip:{client_ip(request)}"
    # locked out? (only failures count, so a signed-in user is never slowed down)
    wait = max(limiter.check(account_key, *LOGIN_PER_ACCOUNT), limiter.check(ip_key, *LOGIN_PER_IP))
    if wait:
        raise too_many(wait, "sign-in attempts")
    user = db.query(User).filter(func.lower(User.username) == name).first()
    if not verify_password(user.password_hash if user else None, body.password):
        limiter.hit(account_key, *LOGIN_PER_ACCOUNT)
        limiter.hit(ip_key, *LOGIN_PER_IP)
        raise HTTPException(401, "The username or password is incorrect. Check both and try again.")
    limiter.reset(account_key)
    start_session(request, user)
    return _me(user, db)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.post("/password")
def change_password(body: PasswordChange, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Change the password and sign out every other device."""
    key = f"password:{user.id}"
    wait = limiter.check(key, *LOGIN_PER_ACCOUNT)
    if wait:
        raise too_many(wait, "password attempts")
    if not verify_password(user.password_hash, body.current_password):
        limiter.hit(key, *LOGIN_PER_ACCOUNT)
        raise HTTPException(400, "Your current password is incorrect.")
    if body.new_password == body.current_password:
        raise HTTPException(400, "Pick a new password that differs from the current one.")
    check_password(body.new_password, user.username)
    user.password_hash = hash_password(body.new_password)
    user.session_version = (user.session_version or 0) + 1
    db.commit()
    limiter.reset(key)
    start_session(request, user)  # this device stays signed in with the new version
    return {"ok": True}


@router.post("/delete-account")
def delete_account(body: AccountDeletion, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    """Erase the account and everything tied to it. Needs the password and the username typed out."""
    key = f"password:{user.id}"
    wait = limiter.check(key, *LOGIN_PER_ACCOUNT)
    if wait:
        raise too_many(wait, "password attempts")
    if body.confirm.strip().lower() != user.username.lower():
        raise HTTPException(400, "Type your username exactly to confirm.")
    if not verify_password(user.password_hash, body.password):
        limiter.hit(key, *LOGIN_PER_ACCOUNT)
        raise HTTPException(400, "Your password is incorrect.")
    erase_user(db, user.id)
    request.session.clear()
    return {"ok": True}


def erase_user(db: Session, user_id: int) -> None:
    """Delete a user and all their rows explicitly (SQLite does not enforce ON DELETE CASCADE by default)."""
    mine = select(Challenge.id).where(or_(Challenge.creator_id == user_id, Challenge.opponent_id == user_id))
    for model, condition in (
        (ChallengeResult, ChallengeResult.challenge_id.in_(mine)),
        (ChallengePlayer, ChallengePlayer.challenge_id.in_(mine)),
        (Challenge, or_(Challenge.creator_id == user_id, Challenge.opponent_id == user_id)),
        (Friendship, or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id)),
        (SprintRun, SprintRun.user_id == user_id),
        (ReviewCard, ReviewCard.user_id == user_id),
        (Attempt, Attempt.user_id == user_id),
        (Profile, Profile.user_id == user_id),
        (User, User.id == user_id),
    ):
        db.execute(delete(model).where(condition))
    db.commit()


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _me(user, db)
