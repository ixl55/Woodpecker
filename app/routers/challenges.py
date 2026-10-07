import secrets
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import challenge_engine as engine
from ..auth import current_user, ws_user
from ..db import SessionLocal, get_db
from ..models import Challenge, ChallengePlayer, Friendship, User, utcnow
from ..realtime import hub
from ..security import CHALLENGES_PER_USER, MAX_OPEN_CHALLENGES, enforce, same_origin
from .friends import are_friends, public_users

router = APIRouter(tags=["challenges"])

Level = Literal["mixed", "easy", "intermediate", "advanced"]


class ChallengeIn(BaseModel):
    opponent_id: int
    mode: Literal["async", "live"]
    level: Level = "mixed"
    count: Literal[5, 10, 20] = 10
    deadline_hours: Literal[24, 72, 168] = 72
    minutes: Literal[3, 5, 10] = 5


class MoveIn(BaseModel):
    uci: str = Field(max_length=5)  # e2e4, or e7e8q for a promotion


# ---------------------------------------------------------------- helpers
def load(db: Session, cid: int, user: User) -> Challenge:
    ch = db.get(Challenge, cid)
    if ch is None or user.id not in (ch.creator_id, ch.opponent_id):
        raise HTTPException(404, "Challenge not found.")
    if engine.refresh(db, ch):
        db.commit()
    return ch


def view(db: Session, ch: Challenge, me: User | None = None) -> dict:
    out = engine.state(db, ch, public_users(db, [ch.creator_id, ch.opponent_id]))
    if me is not None:
        mine = engine.player_for(db, ch, me.id)
        out["you"] = me.id
        out["current"] = engine.current_puzzle(db, ch, mine) if ch.status == "active" else None
    return out


async def push(cid: int) -> None:
    """Send the fresh state to everyone watching this challenge (each gets their own 'current')."""
    with SessionLocal() as db:
        ch = db.get(Challenge, cid)
        if ch is None:
            return
        base = engine.state(db, ch, public_users(db, [ch.creator_id, ch.opponent_id]))
        for ws, uid in list(hub.rooms.get(cid, {}).items()):
            player = engine.player_for(db, ch, uid)
            payload = {**base, "you": uid,
                       "current": engine.current_puzzle(db, ch, player) if ch.status == "active" else None}
            try:
                await ws.send_json({"type": "state", "state": payload})
            except Exception:  # noqa: BLE001
                hub.leave(cid, ws)


def guard(fn):
    try:
        return fn()
    except engine.ChallengeError as e:
        raise HTTPException(409, str(e)) from e


# ---------------------------------------------------------------- endpoints
@router.post("/api/challenges")
async def create(body: ChallengeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.opponent_id == user.id or not are_friends(db, user.id, body.opponent_id):
        raise HTTPException(400, "You can only challenge players on your friends list.")
    waiting = db.scalar(select(func.count()).select_from(Challenge).where(
        Challenge.creator_id == user.id, Challenge.status.in_(("pending", "lobby"))))
    if waiting >= MAX_OPEN_CHALLENGES:
        raise HTTPException(429, "You have too many invitations waiting. Cancel some before sending more.")
    enforce(f"challenge:{user.id}", CHALLENGES_PER_USER, "challenges")
    now = utcnow()
    ch = Challenge(mode=body.mode, creator_id=user.id, opponent_id=body.opponent_id, level=body.level,
                   status="pending", created_at=now)
    ch.puzzle_ids = engine.pick_puzzles(db, body.mode, body.level, body.count, secrets.randbits(32))
    if body.mode == "async":
        ch.count = len(ch.puzzle_ids)
        ch.deadline_at = now + timedelta(hours=body.deadline_hours)
        ch.invite_expires_at = ch.deadline_at
    else:
        ch.minutes = body.minutes
        ch.invite_expires_at = now + timedelta(minutes=engine.LIVE_INVITE_MINUTES)
    db.add(ch)
    db.flush()
    db.add_all([ChallengePlayer(challenge_id=ch.id, user_id=user.id),
                ChallengePlayer(challenge_id=ch.id, user_id=body.opponent_id)])
    db.commit()
    return view(db, ch, user)


@router.get("/api/challenges")
def list_challenges(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Challenge).where(or_(Challenge.creator_id == user.id, Challenge.opponent_id == user.id))
                      .order_by(Challenge.id.desc()).limit(60)).all()
    if any([engine.refresh(db, ch) for ch in rows]):
        db.commit()
    people = public_users(db, [uid for ch in rows for uid in (ch.creator_id, ch.opponent_id)])
    items = [engine.state(db, ch, people) for ch in rows]
    return {
        "incoming": [c for c in items if c["status"] == "pending" and c["opponent_id"] == user.id],
        "sent": [c for c in items if c["status"] == "pending" and c["creator_id"] == user.id],
        "active": [c for c in items if c["status"] in ("lobby", "active")],
        "finished": [c for c in items if c["status"] in ("finished", "expired")][:20],
    }


@router.get("/api/challenges/{cid}")
def read(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return view(db, load(db, cid, user), user)


@router.post("/api/challenges/{cid}/accept")
async def accept(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    if ch.status != "pending" or ch.opponent_id != user.id:
        raise HTTPException(409, "This invitation can no longer be accepted.")
    if ch.mode == "async":
        ch.status = "active"
    else:
        ch.status = "lobby"
        ch.invite_expires_at = utcnow() + timedelta(minutes=engine.LIVE_INVITE_MINUTES)
    db.commit()
    await push(cid)
    return view(db, ch, user)


@router.post("/api/challenges/{cid}/decline")
async def decline(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    if ch.status != "pending" or ch.opponent_id != user.id:
        raise HTTPException(409, "This invitation can no longer be declined.")
    ch.status, ch.finished_at = "declined", utcnow()
    db.commit()
    await push(cid)
    return view(db, ch, user)


@router.post("/api/challenges/{cid}/cancel")
async def cancel(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    if ch.status not in ("pending", "lobby"):
        raise HTTPException(409, "Only a challenge that hasn't started can be cancelled.")
    ch.status, ch.finished_at = "cancelled", utcnow()
    db.commit()
    await push(cid)
    return view(db, ch, user)


@router.post("/api/challenges/{cid}/ready")
async def ready(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    if ch.mode != "live" or ch.status != "lobby":
        raise HTTPException(409, "This duel is not waiting in the lobby.")
    engine.player_for(db, ch, user.id).ready = True
    players = engine.players_of(db, ch)
    if all(p.ready for p in players):
        engine.start_live(ch, players, utcnow())
        db.commit()
        hub.schedule_end(ch.id, ch.ends_at, push)
    else:
        db.commit()
    await push(cid)
    return view(db, ch, user)


@router.post("/api/challenges/{cid}/start")
async def start(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    if ch.mode != "async" or ch.status != "active":
        raise HTTPException(409, "This set challenge is not open for play.")
    engine.start_async(engine.player_for(db, ch, user.id), utcnow())
    db.commit()
    await push(cid)
    return view(db, ch, user)


@router.post("/api/challenges/{cid}/move")
async def move(cid: int, body: MoveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    player = guard(lambda: engine.player_for(db, ch, user.id))
    verdict = guard(lambda: engine.play_move(db, ch, player, body.uci.strip()))
    db.commit()
    await push(cid)
    return {**verdict, "state": view(db, ch, user)}


@router.post("/api/challenges/{cid}/resign")
async def resign(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = load(db, cid, user)
    if ch.status != "active":
        raise HTTPException(409, "Only a challenge in play can be resigned.")
    other = ch.opponent_id if user.id == ch.creator_id else ch.creator_id
    engine.finalize(ch, other, "forfeit", utcnow())
    db.commit()
    await push(cid)
    return view(db, ch, user)


@router.get("/api/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    friend_requests = len(db.scalars(select(Friendship.id).where(
        Friendship.addressee_id == user.id, Friendship.status == "pending")).all())
    rows = db.scalars(select(Challenge).where(
        or_(Challenge.creator_id == user.id, Challenge.opponent_id == user.id),
        Challenge.status.in_(("pending", "lobby", "active")))).all()
    if any([engine.refresh(db, ch) for ch in rows]):
        db.commit()
    invites = sum(1 for ch in rows if ch.status == "pending" and ch.opponent_id == user.id)
    lobby = sum(1 for ch in rows if ch.status == "lobby")
    your_turn = 0
    for ch in rows:
        if ch.status == "active" and ch.mode == "async":
            if engine.player_for(db, ch, user.id).status in ("waiting", "playing"):
                your_turn += 1
    # details for the "you've been challenged" banner: live invites and open lobbies need a quick answer
    urgent = [ch for ch in rows if ch.mode == "live" and (
        (ch.status == "pending" and ch.opponent_id == user.id) or ch.status == "lobby")]
    people = public_users(db, [ch.creator_id for ch in urgent] + [ch.opponent_id for ch in urgent])
    live = [{"id": ch.id, "status": ch.status, "minutes": ch.minutes,
             "from": people[ch.opponent_id if ch.creator_id == user.id else ch.creator_id]} for ch in urgent]
    return {"friend_requests": friend_requests, "challenge_invites": invites, "lobby": lobby,
            "your_turn": your_turn, "total": friend_requests + invites + lobby + your_turn, "live": live}


@router.websocket("/ws/challenges/{cid}")
async def socket(websocket: WebSocket, cid: int):
    # browsers always send Origin on WebSocket handshakes; refuse pages from other sites
    origin = websocket.headers.get("origin")
    if origin and not same_origin(origin, websocket.headers.get("host", ""), websocket.headers.get("x-forwarded-host")):
        await websocket.close(code=4403)
        return
    with SessionLocal() as db:
        user = ws_user(websocket, db)
        ch = db.get(Challenge, cid)
        allowed = user is not None and ch is not None and user.id in (ch.creator_id, ch.opponent_id)
        user_id = user.id if user else None
    if not allowed:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    await hub.join(cid, websocket, user_id)
    await push(cid)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong", "server_now": utcnow().isoformat() + "Z"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.leave(cid, websocket)
        with SessionLocal() as db:
            ch = db.get(Challenge, cid)
            live_now = ch is not None and ch.mode == "live" and ch.status == "active"
        if live_now and user_id not in hub.users_in(cid):
            hub.schedule_grace(cid, user_id, push)
