from datetime import timedelta

import chess

from app import challenge_engine as engine
from app.db import SessionLocal
from app.models import Challenge, ChallengePlayer, Puzzle, utcnow


# ---------------------------------------------------------------- helpers
def solution(cid: int, index: int) -> list[str]:
    with SessionLocal() as db:
        ch = db.get(Challenge, cid)
        return db.get(Puzzle, ch.puzzle_ids[index]).moves


def solve_current(client, cid: int) -> dict:
    cur = client.get(f"/api/challenges/{cid}").json()["current"]
    moves = solution(cid, cur["index"])
    r = None
    for ply in range(cur["steps_done"] * 2, len(moves), 2):
        r = client.post(f"/api/challenges/{cid}/move", json={"uci": moves[ply]}).json()
        if r["result"] == "solved":
            break
    assert r["result"] == "solved", r
    return r


def miss_current(client, cid: int) -> dict:
    cur = client.get(f"/api/challenges/{cid}").json()["current"]
    expected = solution(cid, cur["index"])[cur["steps_done"] * 2]
    board = chess.Board(cur["fen"])
    for m in board.legal_moves:
        board.push(m)
        mate = board.is_checkmate()
        board.pop()
        if m.uci() != expected and not mate:
            r = client.post(f"/api/challenges/{cid}/move", json={"uci": m.uci()}).json()
            assert r["result"] == "wrong", r
            return r
    raise AssertionError("no wrong move available")


def edit(cid: int, **fields) -> None:
    with SessionLocal() as db:
        ch = db.get(Challenge, cid)
        for k, v in fields.items():
            setattr(ch, k, v)
        if "started_at" in fields:
            for p in db.query(ChallengePlayer).filter_by(challenge_id=cid):
                p.started_at = p.puzzle_started_at = fields["started_at"]
        db.commit()


def new_live(a, b, minutes=3) -> int:
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live", "minutes": minutes}).json()["id"]
    assert b.post(f"/api/challenges/{cid}/accept").json()["status"] == "lobby"
    a.post(f"/api/challenges/{cid}/ready")
    assert b.post(f"/api/challenges/{cid}/ready").json()["status"] == "active"
    edit(cid, started_at=utcnow() - timedelta(seconds=1))  # skip the 3-2-1 countdown
    return cid


# ---------------------------------------------------------------- engine
def test_check_move_correct_wrong_and_alternative_mate():
    fen = "r6r/1pp3k1/1b6/p2P1p2/P1N1pn2/2P2PP1/BP5P/4RR1K b - - 0 30"
    line = ["h8h2", "h1h2", "a8h8"]
    first = engine.check_move(fen, line, 0, "h8h2")
    assert first["result"] == "correct" and first["reply"] == "h1h2" and first["next_ply"] == 2
    assert engine.check_move(fen, line, 0, "a8a7")["result"] == "wrong"
    assert engine.check_move(fen, line, 0, "zzzz")["result"] == "wrong"
    assert engine.check_move(fen, line, 2, "a8h8")["result"] == "solved"
    # another mating move is accepted
    two_mates = "6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1"
    assert engine.check_move(two_mates, ["a1a8"], 0, "e1e8")["result"] == "solved"


def test_decide_rules():
    def pl(uid, **kw):
        base = {"status": "done", "solved": 0, "mistakes": 0, "time_ms": 0, "started_at": utcnow()}
        return ChallengePlayer(user_id=uid, **{**base, **kw})
    live = Challenge(mode="live")
    assert engine.decide(live, [pl(1, status="out", mistakes=3, solved=9), pl(2, solved=1)]) == (2, "mistakes")
    assert engine.decide(live, [pl(1, solved=5), pl(2, solved=4)]) == (1, "time")
    assert engine.decide(live, [pl(1, solved=4, mistakes=2), pl(2, solved=4, mistakes=1)]) == (2, "time")
    assert engine.decide(live, [pl(1, solved=4, mistakes=1), pl(2, solved=4, mistakes=1)]) == (None, "draw")
    group = Challenge(mode="async")
    assert engine.decide(group, [pl(1, solved=3), pl(2, solved=2)]) == (1, "score")
    assert engine.decide(group, [pl(1, solved=3, time_ms=9000), pl(2, solved=3, time_ms=5000)]) == (2, "score")
    assert engine.decide(group, [pl(1, solved=3, time_ms=5), pl(2, solved=3, time_ms=5)]) == (None, "draw")
    assert engine.decide(group, [pl(1, solved=0), pl(2, started_at=None)]) == (1, "deadline")


# ---------------------------------------------------------------- permissions
def test_only_friends_and_participants(friends, make_player):
    a, b = friends
    c = make_player()
    assert a.post("/api/challenges", json={"opponent_id": c.user["id"], "mode": "async"}).status_code == 400
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async"}).json()["id"]
    assert c.get(f"/api/challenges/{cid}").status_code == 404
    assert a.post(f"/api/challenges/{cid}/accept").status_code == 409  # only the invited player accepts


# ---------------------------------------------------------------- set challenge (async)
def test_async_challenge_end_to_end(friends):
    a, b = friends
    created = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async", "count": 5,
                                              "level": "easy", "deadline_hours": 24}).json()
    cid = created["id"]
    assert created["status"] == "pending" and created["total"] == 5
    assert b.get("/api/notifications").json()["challenge_invites"] == 1
    assert b.post(f"/api/challenges/{cid}/accept").json()["status"] == "active"
    assert a.get("/api/notifications").json()["your_turn"] == 1

    st = a.post(f"/api/challenges/{cid}/start").json()
    cur = st["current"]
    assert set(cur) >= {"fen", "index", "steps_total"} and "moves" not in cur and "san" not in cur
    assert "results" not in st and "puzzles" not in st  # nothing revealed while in play

    for _ in range(5):
        solve_current(a, cid)
    after_a = a.get(f"/api/challenges/{cid}").json()
    assert after_a["status"] == "active" and after_a["current"] is None
    assert after_a["players"][0]["solved"] == 5

    b.post(f"/api/challenges/{cid}/start")
    solve_current(b, cid)
    solve_current(b, cid)
    for _ in range(3):
        miss_current(b, cid)
    done = b.get(f"/api/challenges/{cid}").json()
    assert done["status"] == "finished" and done["winner_id"] == a.user["id"] and done["result_reason"] == "score"
    assert len(done["results"]) == 10 and len(done["puzzles"]) == 5  # solutions revealed after the end

    page = a.get(f"/api/friends/{b.user['id']}").json()
    assert page["record"]["all"] == {"wins": 1, "losses": 0, "draws": 0}
    assert page["record"]["async"]["wins"] == 1
    assert page["history"][0]["outcome"] == "win" and page["history"][0]["score"] == [5, 2]
    assert b.get(f"/api/friends/{a.user['id']}").json()["record"]["all"]["losses"] == 1
    earned = {x["key"] for x in a.get("/api/profile").json()["progress"]["achievements"] if x["earned"]}
    assert "first_win" in earned


def test_async_deadline(friends):
    a, b = friends
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async", "count": 5}).json()["id"]
    b.post(f"/api/challenges/{cid}/accept")
    a.post(f"/api/challenges/{cid}/start")
    miss_current(a, cid)
    edit(cid, deadline_at=utcnow() - timedelta(seconds=1))
    st = a.get(f"/api/challenges/{cid}").json()
    assert st["status"] == "finished" and st["winner_id"] == a.user["id"] and st["result_reason"] == "deadline"


# ---------------------------------------------------------------- live duel
def test_live_three_mistakes_lose(friends):
    a, b = friends
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live", "minutes": 5}).json()["id"]
    b.post(f"/api/challenges/{cid}/accept")
    assert a.post(f"/api/challenges/{cid}/move", json={"uci": "e2e4"}).status_code == 409  # still in the lobby
    a.post(f"/api/challenges/{cid}/ready")
    active = b.post(f"/api/challenges/{cid}/ready").json()
    assert active["status"] == "active" and active["ends_at"] and active["current"]
    # the 3-2-1 countdown blocks moves
    assert a.post(f"/api/challenges/{cid}/move", json={"uci": "e2e4"}).status_code == 409
    edit(cid, started_at=utcnow() - timedelta(seconds=1))

    solve_current(b, cid)
    miss_current(a, cid)
    miss_current(a, cid)
    st = a.get(f"/api/challenges/{cid}").json()
    me = next(p for p in st["players"] if p["id"] == a.user["id"])
    assert st["status"] == "active" and me["lives_left"] == 1
    last = miss_current(a, cid)
    assert last["state"]["status"] == "finished"
    assert last["state"]["winner_id"] == b.user["id"] and last["state"]["result_reason"] == "mistakes"
    assert a.post(f"/api/challenges/{cid}/move", json={"uci": "e2e4"}).status_code == 409


def test_live_time_out_and_draw(friends):
    a, b = friends
    cid = new_live(a, b)
    solve_current(a, cid)
    edit(cid, ends_at=utcnow() - timedelta(seconds=1))
    st = b.get(f"/api/challenges/{cid}").json()
    assert st["status"] == "finished" and st["winner_id"] == a.user["id"] and st["result_reason"] == "time"

    cid2 = new_live(a, b)
    edit(cid2, ends_at=utcnow() - timedelta(seconds=1))
    st2 = a.get(f"/api/challenges/{cid2}").json()
    assert st2["winner_id"] is None and st2["result_reason"] == "draw"
    record = a.get(f"/api/friends/{b.user['id']}").json()["record"]
    assert record["live"] == {"wins": 1, "losses": 0, "draws": 1}


def test_resign_and_cancel(friends):
    a, b = friends
    cid = new_live(a, b)
    assert b.post(f"/api/challenges/{cid}/resign").json()["winner_id"] == a.user["id"]
    pending = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live"}).json()["id"]
    assert a.post(f"/api/challenges/{pending}/cancel").json()["status"] == "cancelled"
    declined = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async"}).json()["id"]
    assert b.post(f"/api/challenges/{declined}/decline").json()["status"] == "declined"
    lists = a.get("/api/challenges").json()
    assert any(c["id"] == cid for c in lists["finished"])


def test_live_invite_expires(friends):
    a, b = friends
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live"}).json()["id"]
    edit(cid, invite_expires_at=utcnow() - timedelta(seconds=1))
    assert b.get(f"/api/challenges/{cid}").json()["status"] == "expired"


def test_websocket_pushes_state(friends):
    a, b = friends
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live", "minutes": 3}).json()["id"]
    with a.websocket_connect(f"/ws/challenges/{cid}") as ws:
        first = ws.receive_json()
        assert first["type"] == "state" and first["state"]["status"] == "pending" and first["state"]["you"] == a.user["id"]
        b.post(f"/api/challenges/{cid}/accept")
        pushed = ws.receive_json()
        assert pushed["state"]["status"] == "lobby"
        ws.send_text("ping")
        assert ws.receive_json()["type"] == "pong"


def test_websocket_rejects_strangers(friends, make_player):
    a, b = friends
    c = make_player()
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live"}).json()["id"]
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect(f"/ws/challenges/{cid}") as ws:
            ws.receive_json()
