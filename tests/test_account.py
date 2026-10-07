from sqlalchemy import func, or_, select

from app.db import SessionLocal
from app.models import Attempt, Challenge, Friendship, Profile, SprintRun, User

PASSWORD = "Secret-pass-42"


def test_delete_account_needs_password_and_username(friends):
    a, b = friends
    name = a.user["username"]
    assert a.post("/api/auth/delete-account", json={"password": PASSWORD, "confirm": "someone-else"}).status_code == 400
    assert a.post("/api/auth/delete-account", json={"password": "Wrong-pass-00", "confirm": name}).status_code == 400
    assert a.get("/api/auth/me").status_code == 200  # nothing happened


def test_delete_account_erases_everything(friends):
    a, b = friends
    uid, name = a.user["id"], a.user["username"]
    a.post("/api/attempts", json={"puzzle_id": 1, "solved": False, "time_ms": 5000})
    a.get("/api/profile")
    a.post("/api/sprint", json={"minutes": 3})
    a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async", "count": 5})

    r = a.post("/api/auth/delete-account", json={"password": PASSWORD, "confirm": name.upper()})
    assert r.status_code == 200
    assert a.get("/api/auth/me").status_code == 401
    assert a.post("/api/auth/login", json={"username": name, "password": PASSWORD}).status_code == 401

    with SessionLocal() as db:
        assert db.get(User, uid) is None
        for model, cond in ((Attempt, Attempt.user_id == uid), (Profile, Profile.user_id == uid),
                            (SprintRun, SprintRun.user_id == uid),
                            (Friendship, or_(Friendship.requester_id == uid, Friendship.addressee_id == uid)),
                            (Challenge, or_(Challenge.creator_id == uid, Challenge.opponent_id == uid))):
            assert db.scalar(select(func.count()).select_from(model).where(cond)) == 0

    # the friend's account is intact and no longer lists them
    assert b.get("/api/friends").json()["friends"] == []
    assert b.get("/api/challenges").status_code == 200
    # and the name is free again
    assert a.post("/api/auth/register", json={"username": name, "password": PASSWORD}).status_code == 200
