import json
from pathlib import Path

import chess

from extract.diagrams import parse_title, rank_to_fen, rows_to_placement
from extract.solutions import _tokens

PUZZLES = json.loads((Path(__file__).resolve().parent.parent / "data" / "puzzles.json").read_text(encoding="utf-8"))


def test_rank_glyphs():
    # Merida: lower case on light squares, upper case on dark; o m v t w l are black
    assert rank_to_fen("t+ + + T") == "r6r"
    assert rank_to_fen("+ + Rr+k") == "4RR1K"
    assert rank_to_fen("oOvVwWlL") == "ppbbqqkk"


def test_rows_to_placement():
    rows = [chr(0xC0 + r) + " + + + +" + "5" for r in range(7, -1, -1)]
    assert rows_to_placement(rows) == "8/8/8/8/8/8/8/8"


def test_figurine_tokens():
    moves = _tokens(["30...¦xh2†! 31.¢xh2 ¦h8 mate", "36.g4 £f2† 0–1"])
    assert [m["san"] for m in moves] == ["Rxh2", "Kxh2", "Rh8", "g4", "Qf2"]  # check signs dropped; SAN parsing re-adds them
    assert (moves[0]["num"], moves[0]["black"]) == (30, True)
    assert (moves[1]["num"], moves[1]["black"]) == (31, False)


def test_parse_title():
    assert parse_title("Hamppe – Steinitz, Vienna 1860") == {
        "white": "Hamppe", "black": "Steinitz", "event": "Vienna", "year": 1860}


def test_every_puzzle_replays():
    assert len(PUZZLES) == 1127
    assert len({p["id"] for p in PUZZLES}) == len(PUZZLES)
    for p in PUZZLES:
        board = chess.Board(p["fen"])
        assert board.is_valid(), p["id"]
        assert len(p["moves"]) % 2 == 1, p["id"]  # ends with the solver's move
        for uci in p["moves"]:
            move = chess.Move.from_uci(uci)
            assert move in board.legal_moves, p["id"]
            board.push(move)


def test_every_book_two_puzzle_replays():
    from app.themes import THEMES
    book2 = json.loads((Path(__file__).resolve().parent.parent / "data" / "puzzles2.json").read_text(encoding="utf-8"))
    assert [p["number"] for p in book2] == list(range(1, 1001))
    assert {p["id"] for p in book2} == set(range(2001, 3001))
    assert {p["id"] for p in book2}.isdisjoint(p["id"] for p in PUZZLES)
    for p in book2:
        board = chess.Board(p["fen"])
        assert board.is_valid(), p["number"]
        assert len(p["moves"]) == 1 and p["line"][0] == p["san"][0], p["number"]  # the key move is the answer
        for san in p["line"]:  # the whole continuation replays from the position read off the image
            board.push_san(san)
        assert p["themes"] and set(p["themes"]) <= set(THEMES), p["number"]
    assert {p["difficulty"] for p in book2 if p["number"] <= 339} == {"easy"}
    assert {p["difficulty"] for p in book2 if p["number"] >= 740} == {"advanced"}


def test_board_image_dehatch():
    import numpy as np

    from extract.board_image import dehatch
    hatch = np.zeros((12, 12), dtype=bool)
    for y in range(12):
        for x in range(12):
            hatch[y, x] = (x + y) % 5 == 0  # thin '/' lines, as on the dark squares
    assert not dehatch(hatch).any()
    block = np.zeros((12, 12), dtype=bool)
    block[3:9, 3:9] = True  # a solid piece survives
    assert dehatch(block | hatch)[3:9, 3:9].all()
