from datetime import timedelta

import chess

from app.db import SessionLocal
from app.models import Puzzle, SprintRun, utcnow


def line(run_id: int, index: int) -> list[str]:
    with SessionLocal() as db:
        return db.get(Puzzle, db.get(SprintRun, run_id).puzzle_ids[index]).moves


def solve(client, run_id: int) -> dict:
    cur = client.get(f"/api/sprint/{run_id}").json()["current"]
    moves = line(run_id, cur["index"])
    for ply in range(cur["steps_done"] * 2, len(moves), 2):
        r = client.post(f"/api/sprint/{run_id}/move", json={"uci": moves[ply]}).json()
        if r["result"] == "solved":
            return r
    raise AssertionError("line did not end in 'solved'")


def miss(client, run_id: int) -> dict:
    cur = client.get(f"/api/sprint/{run_id}").json()["current"]
    expected = line(run_id, cur["index"])[cur["steps_done"] * 2]
    board = chess.Board(cur["fen"])
    for m in board.legal_moves:
        board.push(m)
        mate = board.is_checkmate()
        board.pop()
        if m.uci() != expected and not mate:
            return client.post(f"/api/sprint/{run_id}/move", json={"uci": m.uci()}).json()
    raise AssertionError("no wrong move available")


def test_sprint_run_and_personal_best(client, user):
    assert client.get("/api/sprint").json() == {"best": {"3": None, "5": None}, "runs": 0, "recent": []}
    s = client.post("/api/sprint", json={"minutes": 3}).json()
    assert s["status"] == "active" and s["lives_left"] == 3 and s["current"]["index"] == 0
    assert "moves" not in str(s["current"]) and "san" not in s["current"]  # no solution before the end
    rid = s["id"]

    assert solve(client, rid)["state"]["solved"] == 1
    assert solve(client, rid)["state"]["solved"] == 2
    miss(client, rid)
    miss(client, rid)
    r = miss(client, rid)
    assert r["result"] == "wrong" and r["expected"]
    end = r["state"]
    assert end["status"] == "finished" and end["reason"] == "lives" and end["lives_left"] == 0
    assert end["solved"] == 2 and end["best"] == 2 and end["new_best"] is True
    assert [x["solved"] for x in end["results"]] == [True, True, False, False, False]
    assert client.post(f"/api/sprint/{rid}/move", json={"uci": "e2e4"}).status_code == 409

    over = client.get("/api/sprint").json()
    assert over["best"]["3"] == 2 and over["runs"] == 1 and over["recent"][0]["reason"] == "lives"

    # a weaker second run is not a new record
    second = client.post("/api/sprint", json={"minutes": 3}).json()["id"]
    done = client.post(f"/api/sprint/{second}/end").json()
    assert done["status"] == "finished" and done["reason"] == "ended" and done["new_best"] is False and done["best"] == 2


def test_sprint_times_out_on_the_server(client, user):
    rid = client.post("/api/sprint", json={"minutes": 5}).json()["id"]
    solve(client, rid)
    with SessionLocal() as db:
        run = db.get(SprintRun, rid)
        run.ends_at = utcnow() - timedelta(seconds=5)
        db.commit()
    s = client.get(f"/api/sprint/{rid}").json()
    assert s["status"] == "finished" and s["reason"] == "time" and s["solved"] == 1 and s["current"] is None


def test_new_sprint_closes_the_old_one(client, user):
    first = client.post("/api/sprint", json={"minutes": 3}).json()["id"]
    client.post("/api/sprint", json={"minutes": 3})
    assert client.get(f"/api/sprint/{first}").json()["reason"] == "ended"


def test_sprint_is_private(client, user, make_player):
    rid = client.post("/api/sprint", json={"minutes": 3}).json()["id"]
    other = make_player()
    assert other.get(f"/api/sprint/{rid}").status_code == 404
    assert other.post(f"/api/sprint/{rid}/move", json={"uci": "e2e4"}).status_code == 404
    assert client.post("/api/sprint", json={"minutes": 7}).status_code == 422
