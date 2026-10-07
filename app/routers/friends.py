from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .. import challenge_engine as engine
from .. import progress
from ..auth import current_user
from ..db import get_db
from ..models import Challenge, Friendship, Profile, User, utcnow
from ..security import FRIEND_REQUESTS_PER_USER, MAX_PENDING_SENT, SEARCHES_PER_USER, enforce

router = APIRouter(prefix="/api", tags=["friends"])


# ---------------------------------------------------------------- helpers shared with challenges
def public_users(db: Session, ids) -> dict[int, dict]:
    ids = list(set(ids))
    if not ids:
        return {}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))}
    profiles = {p.user_id: p for p in db.scalars(select(Profile).where(Profile.user_id.in_(ids)))}
    return {uid: engine.public_user(u, profiles.get(uid)) for uid, u in users.items()}


def pair_row(db: Session, a: int, b: int) -> Friendship | None:
    return db.scalars(select(Friendship).where(or_(
        and_(Friendship.requester_id == a, Friendship.addressee_id == b),
        and_(Friendship.requester_id == b, Friendship.addressee_id == a),
    ))).first()


def are_friends(db: Session, a: int, b: int) -> bool:
    row = pair_row(db, a, b)
    return row is not None and row.status == "accepted"


def pair_challenges(db: Session, a: int, b: int):
    return db.scalars(select(Challenge).where(or_(
        and_(Challenge.creator_id == a, Challenge.opponent_id == b),
        and_(Challenge.creator_id == b, Challenge.opponent_id == a),
    )).order_by(Challenge.id.desc())).all()


def record(challenges, me: int) -> dict:
    """Win/loss/draw from `me`'s side, overall and per mode (finished challenges only)."""
    def empty():
        return {"wins": 0, "losses": 0, "draws": 0}
    out = {"all": empty(), "async": empty(), "live": empty()}
    for ch in challenges:
        if ch.status != "finished":
            continue
        key = "wins" if ch.winner_id == me else "draws" if ch.winner_id is None else "losses"
        out["all"][key] += 1
        out[ch.mode][key] += 1
    return out


# ---------------------------------------------------------------- endpoints
class FriendRequestIn(BaseModel):
    username: str = Field(max_length=40)


@router.get("/users/search")
def search_users(q: str = Query(..., min_length=1, max_length=40), user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    enforce(f"search:{user.id}", SEARCHES_PER_USER, "searches")
    needle = q.strip().lower()
    rows =db.scalars(select(User).where(func.lower(User.username).startswith(needle, autoescape=True),
                                         User.id != user.id).order_by(User.username).limit(10)).all()
    people = public_users(db, [u.id for u in rows])
    out = []
    for u in rows:
        rel = pair_row(db, user.id, u.id)
        relation = ("friend" if rel.status == "accepted" else
                    "sent" if rel.requester_id == user.id else "received") if rel else "none"
        out.append({**people[u.id], "relation": relation, "request_id": rel.id if rel else None})
    return out


@router.get("/friends")
def list_friends(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Friendship).where(or_(Friendship.requester_id == user.id,
                                                   Friendship.addressee_id == user.id))).all()
    other = lambda f: f.addressee_id if f.requester_id == user.id else f.requester_id  # noqa: E731
    people = public_users(db, [other(f) for f in rows])
    friends = []
    for f in rows:
        if f.status != "accepted":
            continue
        uid = other(f)
        summary = progress.compute(db, uid)
        friends.append({**people[uid], "since": f.responded_at.isoformat() + "Z" if f.responded_at else None,
                        "rank": summary["rank"]["title"], "solved": summary["solved"],
                        "record": record(pair_challenges(db, user.id, uid), user.id)["all"]})
    friends.sort(key=lambda x: x["display_name"].lower())
    return {
        "friends": friends,
        "incoming": [{**people[f.requester_id], "request_id": f.id} for f in rows
                     if f.status == "pending" and f.addressee_id == user.id],
        "outgoing": [{**people[f.addressee_id], "request_id": f.id} for f in rows
                     if f.status == "pending" and f.requester_id == user.id],
    }


@router.post("/friends/requests")
def send_request(body: FriendRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    target = db.scalars(select(User).where(func.lower(User.username) == body.username.strip().lower())).first()
    if target is None:
        raise HTTPException(404, "No player has that username. Check the spelling and try again.")
    if target.id == user.id:
        raise HTTPException(400, "You can't add yourself as a friend.")
    row = pair_row(db, user.id, target.id)
    if row and row.status == "accepted":
        raise HTTPException(409, "You are already friends.")
    if row and row.requester_id == user.id:
        raise HTTPException(409, "You already sent a request. It's waiting for their answer.")
    if row:  # they asked first: sending back means yes
        row.status, row.responded_at = "accepted", utcnow()
        db.commit()
        return {"status": "accepted"}
    pending = db.scalar(select(func.count()).select_from(Friendship).where(
        Friendship.requester_id == user.id, Friendship.status == "pending"))
    if pending >= MAX_PENDING_SENT:
        raise HTTPException(429, "You have too many requests waiting for an answer. Cancel some before sending more.")
    enforce(f"friend-request:{user.id}", FRIEND_REQUESTS_PER_USER, "friend requests")
    db.add(Friendship(requester_id=user.id, addressee_id=target.id))
    db.commit()
    return {"status": "pending"}


def _incoming(db: Session, request_id: int, user: User) -> Friendship:
    row = db.get(Friendship, request_id)
    if row is None or row.addressee_id != user.id or row.status != "pending":
        raise HTTPException(404, "That friend request no longer exists.")
    return row


@router.post("/friends/requests/{request_id}/accept")
def accept_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _incoming(db, request_id, user)
    row.status, row.responded_at = "accepted", utcnow()
    db.commit()
    return {"status": "accepted"}


@router.post("/friends/requests/{request_id}/decline")
def decline_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_incoming(db, request_id, user))
    db.commit()
    return {"status": "declined"}


@router.delete("/friends/requests/{request_id}")
def cancel_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(Friendship, request_id)
    if row is None or row.requester_id != user.id or row.status != "pending":
        raise HTTPException(404, "That friend request no longer exists.")
    db.delete(row)
    db.commit()
    return {"status": "cancelled"}


@router.delete("/friends/{friend_id}")
def remove_friend(friend_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = pair_row(db, user.id, friend_id)
    if row is None or row.status != "accepted":
        raise HTTPException(404, "This player is not on your friends list.")
    db.delete(row)
    db.commit()
    return {"status": "removed"}


@router.get("/friends/{friend_id}")
def friendship_page(friend_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = pair_row(db, user.id, friend_id)
    if row is None or row.status != "accepted":
        raise HTTPException(404, "This player is not on your friends list.")
    people = public_users(db, [user.id, friend_id])
    challenges = pair_challenges(db, user.id, friend_id)
    now = utcnow()
    changed = [ch for ch in challenges if engine.refresh(db, ch, now)]
    if changed:
        db.commit()

    def summary(uid: int) -> dict:
        g = progress.compute(db, uid)
        return {"solved": g["solved"], "accuracy": g["accuracy"], "streak_days": g["streak_days"],
                "best_streak": g["best_streak"], "rank": g["rank"]["title"]}

    history = []
    for ch in challenges:
        if ch.status in ("declined", "cancelled"):
            continue
        players = {p.user_id: p for p in engine.players_of(db, ch)}
        mine, theirs = players.get(user.id), players.get(friend_id)
        history.append({
            "id": ch.id, "mode": ch.mode, "status": ch.status, "level": ch.level,
            "minutes": ch.minutes, "count": ch.count, "reason": ch.result_reason,
            "outcome": (None if ch.status != "finished" else
                        "win" if ch.winner_id == user.id else "draw" if ch.winner_id is None else "loss"),
            "score": [mine.solved if mine else 0, theirs.solved if theirs else 0],
            "date": (ch.finished_at or ch.created_at).isoformat() + "Z",
        })
    return {
        "me": {**people[user.id], **summary(user.id)},
        "friend": {**people[friend_id], **summary(friend_id)},
        "since": row.responded_at.isoformat() + "Z" if row.responded_at else None,
        "record": record(challenges, user.id),
        "history": history,
    }
