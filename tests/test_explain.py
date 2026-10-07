import json
from pathlib import Path

from app.explain import explain, explain_line

ROOT = Path(__file__).resolve().parent.parent
BOOK1 = {p["id"]: p for p in json.loads((ROOT / "data" / "puzzles.json").read_text(encoding="utf-8"))}


def notes(ex):
    return [" ".join(s["notes"]) for s in ex["steps"]]


def test_sacrifice_and_mate():
    # exercise 1: Rxh2+ Kxh2 Rh8#
    ex = explain(BOOK1[1])
    assert notes(ex)[0].startswith("A rook sacrifice to drag the king to h2")
    assert notes(ex)[1] == "The only legal move."
    assert notes(ex)[2] == "Checkmate."
    assert ex["result"] == "Black gives checkmate."


def test_fork_names_its_targets_and_the_prize():
    ex = explain(BOOK1[59])  # Nxf5+ exf5 Nxd5+ forks the king and the queen
    assert "Fork: the knight hits the queen on f6 and the king on e7" in notes(ex)[2]
    assert "takes the queen on f6" in ex["result"]


def test_pin_and_material_tally():
    ex = explain(BOOK1[348])
    assert notes(ex)[4].startswith("Pin: the queen on f4 can't move, or the king on f7 would be in check")
    assert ex["result"] == "White comes out ahead in material: a queen, a knight and a pawn for two rooks."


def test_quiet_threats_are_only_the_ones_the_move_creates():
    # the knight check that hits the rook: the fork is the point, no separate "threat" note
    ex = explain_line("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", ["d5c7"])
    assert notes(ex)[0].startswith("Check. Fork: the knight hits")
    # Rd8 is mate already before g3, so g3 must not be credited with the threat
    ex = explain_line("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", ["g2g3", "g8h8", "d1d8"])
    assert notes(ex)[0] == ""  # g3 creates no threat of its own
    assert notes(ex)[2] == "Checkmate."


def test_every_puzzle_has_an_explanation():
    data = json.loads((ROOT / "data" / "explanations.json").read_text(encoding="utf-8"))
    assert len(data) == 2127
    book2 = [e for pid, e in data.items() if int(pid) > 2000]
    assert all(e["ideas"] for e in book2)  # every exercise has its reviewed ideas
    assert all(e["steps"] and e["steps"][0]["side"] == "solver" for e in data.values())
