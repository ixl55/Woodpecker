from datetime import timedelta

from app.db import SessionLocal
from app.models import ReviewCard, utcnow


def test_requires_login(client):
    client.post("/api/auth/logout")
    assert client.get("/api/puzzles/1").status_code == 401
    assert client.get("/api/stats").status_code == 401


def test_register_login_logout(client, user):
    assert client.get("/api/auth/me").json()["username"] == user
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"username": user, "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": user.upper(), "password": "Secret-pass-42"}).status_code == 200
    assert client.post("/api/auth/register", json={"username": user, "password": "Secret-pass-42"}).status_code == 409


def test_puzzles_seeded_and_filtered(client, user):
    all_ = client.get("/api/puzzles", params={"limit": 200}).json()
    assert all_["total"] == 1127 + 1000  # book 1 (tactics) + book 2 (positional)
    assert client.get("/api/puzzles", params={"book": 1}).json()["total"] == 1127
    assert client.get("/api/puzzles", params={"book": 2}).json()["total"] == 1000
    easy = client.get("/api/puzzles", params={"difficulty": "easy", "book": 1}).json()
    assert easy["total"] == 221 and easy["items"][0]["id"] == 1
    assert client.get("/api/puzzles", params={"difficulty": "easy", "book": 2}).json()["total"] == 339
    p = client.get("/api/puzzles/1").json()
    assert p["moves"] == ["h8h2", "h1h2", "a8h8"] and p["fen"].split()[1] == "b"
    assert p["next_id"] == 2 and p["prev_id"] is None and p["book"] == 1 and p["number"] == 1
    assert client.get("/api/puzzles/11").status_code == 404  # excluded book erratum


def test_book_two_is_positional(client, user):
    p = client.get("/api/puzzles/2001").json()  # book 2, exercise 1: Steinitz – Robey, 16.g4!
    assert (p["book"], p["number"], p["white"], p["black"]) == (2, 1, "Steinitz", "Robey")
    assert p["moves"] == ["g2g4"] and p["san"] == ["g4"]  # the key move is the whole answer
    assert p["line"][:4] == ["g4", "Nd7", "h4", "c6"]  # the book's continuation, shown afterwards
    assert p["themes"] and p["prev_id"] == 1128 and p["next_id"] == 2002  # the books follow each other
    # solving it records like any other puzzle
    r = client.post("/api/attempts", json={"puzzle_id": 2001, "solved": True, "time_ms": 30000})
    assert r.status_code == 200
    assert client.get("/api/puzzles/2001").json()["status"] == "solved"


def test_races_use_book_one_only(friends):
    a, b = friends
    ids = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async", "count": 20}).json()
    from app.db import SessionLocal
    from app.models import Challenge
    with SessionLocal() as db:
        assert all(pid < 2000 for pid in db.get(Challenge, ids["id"]).puzzle_ids)
    run = a.post("/api/sprint", json={"minutes": 3}).json()
    assert run["current"]["puzzle_id"] < 2000


def test_new_mode_goes_in_book_order(client, user):
    assert client.get("/api/puzzles/next").json()["id"] == 1
    client.post("/api/attempts", json={"puzzle_id": 1, "solved": True, "time_ms": 5000})
    assert client.get("/api/puzzles/next").json()["id"] == 2
    assert client.get("/api/puzzles/next", params={"difficulty": "advanced"}).json()["difficulty"] == "advanced"


def test_failed_puzzle_enters_review_and_climbs_boxes(client, user):
    assert client.get("/api/puzzles/next", params={"mode": "review"}).json() == {"done": True}
    r = client.post("/api/attempts", json={"puzzle_id": 5, "solved": False, "mistakes": 2}).json()
    assert r["review"]["box"] == 1
    due = client.get("/api/puzzles/next", params={"mode": "review"}).json()
    assert due["id"] == 5 and due["status"] == "failed"
    assert client.get("/api/puzzles", params={"status": "failed"}).json()["items"][0]["id"] == 5

    r = client.post("/api/attempts", json={"puzzle_id": 5, "solved": True}).json()
    assert r["review"]["box"] == 2  # due tomorrow, so nothing is due now
    assert client.get("/api/puzzles/next", params={"mode": "review"}).json() == {"done": True}

    # a card succeeding from the last box is retired
    with SessionLocal() as db:
        card = db.query(ReviewCard).filter_by(puzzle_id=5).order_by(ReviewCard.id.desc()).first()
        card.box, card.due_at = 6, utcnow() - timedelta(minutes=1)
        db.commit()
    assert client.post("/api/attempts", json={"puzzle_id": 5, "solved": True}).json()["review"] is None


def test_stats(client, user):
    client.post("/api/attempts", json={"puzzle_id": 1, "solved": True, "time_ms": 4000})
    client.post("/api/attempts", json={"puzzle_id": 2, "solved": False})
    client.post("/api/attempts", json={"puzzle_id": 300, "solved": True, "time_ms": 8000})
    s = client.get("/api/stats").json()
    assert s["levels"]["easy"]["attempted"] == 2
    assert s["levels"]["easy"]["accuracy"] == 50
    assert s["levels"]["intermediate"]["avg_time_ms"] == 8000
    assert s["streak_days"] == 1 and s["review_due"] == 1
    assert [(h["id"], h["fails"]) for h in s["hardest"]] == [(2, 1)] and s["hardest"][0]["fen"]
    assert s["activity"][-1]["attempts"] == 3


def test_stats_payload_shape(client, user):
    client.post("/api/attempts", json={"puzzle_id": 1, "solved": True, "time_ms": 4000})
    client.post("/api/attempts", json={"puzzle_id": 3, "solved": True, "time_ms": 45000})
    client.post("/api/attempts", json={"puzzle_id": 4, "solved": False})
    s = client.get("/api/stats", params={"range": 30}).json()
    assert s["range"] == 30 and len(s["activity"]) == 30
    assert len(s["heatmap"]) == 182 and s["heatmap"][-1]["attempts"] == 3
    assert len(s["weekly_accuracy"]) == 12 and s["weekly_accuracy"][-1]["accuracy"] == 67
    assert [b["count"] for b in s["time_histogram"]] == [1, 0, 1, 0, 0, 0]
    assert [b["count"] for b in s["review_boxes"]] == [1, 0, 0, 0, 0, 0]
    assert s["deltas"]["attempts"] == {"now": 3, "before": 0}
    assert len(s["spark"]) == 7
    assert client.get("/api/stats", params={"range": 5}).json()["range"] == 14  # unsupported range falls back
