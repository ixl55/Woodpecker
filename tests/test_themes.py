import json
from pathlib import Path

import pytest

from app.themes import POSITIONAL, THEMES, detect_themes, exercise_themes

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.parametrize("fen, moves, expected", [
    # book exercise 1: Rxh2+ Kxh2 Rh8#
    ("r6r/1pp3k1/1b6/p2P1p2/P1N1pn2/2P2PP1/BP5P/4RR1K b - - 0 30", ["h8h2", "h1h2", "a8h8"], {"sacrifice", "mate_in_2"}),
    # knight check that also hits the rook, then takes it
    ("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", ["d5c7", "e8d7", "c7a8"], {"fork", "material"}),
    # bishop pins the knight to the king, then wins it
    ("4k3/p7/2n5/8/8/8/8/4KB2 w - - 0 1", ["f1b5", "a7a6", "b5c6"], {"pin", "material"}),
    ("6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", ["g5f7"], {"mate_in_1", "smothered_mate"}),
    ("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", ["a1a8"], {"mate_in_1", "back_rank_mate"}),
])
def test_detectors(fen, moves, expected):
    assert expected <= set(detect_themes(fen, moves))


def test_patterns_the_line_never_cashes_in_are_not_tagged():
    # the bishop pins the knight, but the solution goes elsewhere: not a pin puzzle
    assert "pin" not in detect_themes("4k3/p7/2n5/8/8/8/8/4KB2 w - - 0 1", ["f1b5", "a7a6", "e1e2"])
    # a knight check that hits the rook, but the line never takes it: not a fork
    assert "fork" not in detect_themes("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", ["d5c7", "e8d7", "c7d5"])
    # a piece given and taken straight back is a trade, not a sacrifice
    assert "sacrifice" not in detect_themes("4k3/8/4p3/3p4/8/1BN5/8/4K3 w - - 0 1", ["c3d5", "e6d5", "b3d5"])


def test_skewer():
    # Ra5+ skewers the king on the fifth rank against the queen behind it
    tags = detect_themes("8/8/8/2k2q2/8/8/8/R5K1 w - - 0 1", ["a1a5", "c5d4", "a5f5"])
    assert "skewer" in tags


def test_every_book_puzzle_gets_themes():
    data = json.loads((ROOT / "data" / "puzzles.json").read_text(encoding="utf-8"))
    tagged = [detect_themes(p["fen"], p["moves"]) for p in data]
    # motifs must be proved by the line, so some quiet or small-gain puzzles carry no tactic tag
    assert sum(1 for t in tagged if t) / len(tagged) > 0.8
    seen = {t for ts in tagged for t in ts}
    assert {"fork", "pin", "sacrifice", "mate_in_2", "discovered_attack", "quiet_move"} <= seen
    assert seen <= set(THEMES)


def test_theme_api(client, user):
    themes = client.get("/api/puzzles/themes").json()
    assert [t["key"] for t in themes] == list(THEMES)
    fork = next(t for t in themes if t["key"] == "fork")
    assert fork["total"] > 0 and fork["solved"] == 0 and fork["name"] == "Fork"

    items = client.get("/api/puzzles", params={"theme": "fork", "limit": 200}).json()["items"]
    assert items and len(items) == min(fork["total"], 200)
    assert "fork" in client.get(f"/api/puzzles/{items[0]['id']}").json()["themes"]
    assert client.get("/api/puzzles", params={"theme": "nonsense"}).status_code == 422


def test_theme_training_and_stats(client, user):
    first = client.get("/api/puzzles/next", params={"mode": "theme", "theme": "pin"}).json()
    assert "pin" in first["themes"] and first["theme_left"] > 0
    client.post("/api/attempts", json={"puzzle_id": first["id"], "solved": True, "time_ms": 9000})
    second = client.get("/api/puzzles/next", params={"mode": "theme", "theme": "pin", "after": first["id"]}).json()
    assert second["id"] != first["id"] and second["theme_left"] == first["theme_left"] - 1
    assert client.get("/api/puzzles/next", params={"mode": "theme"}).status_code == 400

    rows = {r["key"]: r for r in client.get("/api/stats").json()["themes"]}
    assert rows["pin"]["attempts"] == 1 and rows["pin"]["accuracy"] == 100


def test_line_that_stops_on_the_fork_is_still_a_fork():
    # the book often ends on the forking move itself: no reply saves both the king and the rook
    tags = detect_themes("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", ["d5c7"])
    assert "fork" in tags and "material" in tags


def test_pinned_piece_that_takes_its_pinner_is_won_on_the_spot():
    # Rf1 pins the queen to the king; it can only take the rook and is taken back
    tags = detect_themes("5k2/8/8/8/5q2/3B4/8/K6R w - - 0 1", ["h1f1", "f4f1", "d3f1"])
    assert "pin" in tags


def test_quiet_move_is_not_a_plain_threat():
    # Nd5 attacks the queen: a threat, not a quiet move
    assert "quiet_move" not in detect_themes("4k3/2q5/8/8/8/2N5/8/4K3 w - - 0 1", ["c3d5", "c7c6", "d5b6"])
    # a calm rook lift that sets up mate is
    assert "quiet_move" in detect_themes("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", ["g2g3", "g8f8", "d1d8"])


def test_book2_positional_themes_come_from_the_review():
    reviewed = json.loads((ROOT / "data" / "themes2.json").read_text(encoding="utf-8"))
    book2 = json.loads((ROOT / "data" / "puzzles2.json").read_text(encoding="utf-8"))
    assert set(reviewed) == {str(p["number"]) for p in book2}
    for p in book2:
        assert [t for t in p["themes"] if t in POSITIONAL] == [t for t in THEMES if t in reviewed[str(p["number"])]]
        # positional lines are quiet and long by nature, so those two tags are left out
        assert not {"quiet_move", "long_combination"} & set(p["themes"])


def test_book2_tactics_come_from_the_whole_line():
    # exercise 322: 11...Bh6 12.Bxh6 Qh4+ 13.Ng3 Qxh6 - the fork only appears after the key move
    fen = "r1bq1rk1/1ppn1pbp/n2p2p1/p2Pp3/2P1P3/P1NBBP2/1PQ1N1PP/R3K2R b KQ - 0 11"
    line = ["g7h6", "e3h6", "d8h4", "e2g3", "h4h6"]
    assert "fork" in exercise_themes(fen, line, {"right_exchange"})
    assert "fork" not in exercise_themes(fen, line[:1], {"right_exchange"})
