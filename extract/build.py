"""Merge diagrams + solutions into validated puzzles (data/puzzles.json).

Every puzzle is verified with python-chess: the side to move from the diagram's
triangle must match the solution, and every main-line move must be legal.
"""
import csv
import json
import re
import sys
import unicodedata

import chess

from . import diagrams as diagrams_mod
from . import solutions as solutions_mod
from .common import DATA


def _surnames(title: str) -> tuple[str, str]:
    players = title.split(",")[0]
    white, _, black = players.partition("–")

    def last(name):
        name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
        words = re.findall(r"[a-z]+", name)
        return words[-1] if words else ""
    return last(white), last(black)


def _fix_misnumbered(diags: list[dict], sols: dict[int, dict]) -> None:
    """The book misprints a few diagram numbers; re-assign them by matching the players."""
    by_id: dict[int, list[dict]] = {}
    for d in diags:
        by_id.setdefault(d["id"], []).append(d)
    missing = sorted(set(sols) - set(by_id))
    for did, group in by_id.items():
        if len(group) == 1:
            continue
        for d in group:
            if _surnames(d["title"]) == _surnames(sols[did]["title"]):
                continue
            match = [m for m in missing if _surnames(sols[m]["title"]) == _surnames(d["title"])]
            if len(match) != 1:
                raise ValueError(f"cannot re-number diagram {did} {d['title']!r}: {match}")
            print(f"  renumbered diagram {did} -> {match[0]} ({d['title']})")
            d["id"] = match[0]
            missing.remove(match[0])


def _castling(board: chess.Board) -> str:
    rights = ""
    for color, rank, k, q in ((chess.WHITE, 0, "K", "Q"), (chess.BLACK, 7, "k", "q")):
        king = board.piece_at(chess.square(4, rank))
        if king != chess.Piece(chess.KING, color):
            continue
        if board.piece_at(chess.square(7, rank)) == chess.Piece(chess.ROOK, color):
            rights += k
        if board.piece_at(chess.square(0, rank)) == chess.Piece(chess.ROOK, color):
            rights += q
    return rights or "-"


def _parse(board: chess.Board, san: str) -> chess.Move:
    try:
        return board.parse_san(san)
    except ValueError:
        # the book omits '=' in promotions sometimes, python-chess wants it
        m = re.match(r"^(.*[a-h][18])([QRBN])$", san)
        if m:
            return board.parse_san(f"{m.group(1)}={m.group(2)}")
        raise


def build_puzzle(diag: dict, sol: dict) -> dict:
    moves = sol["moves"]
    if not moves:
        raise ValueError("solution has no moves")
    first = moves[0]
    turn = "b" if first["black"] else "w"
    if first["num"] is None:
        raise ValueError("first solution move has no move number")
    if turn != diag["turn"]:
        raise ValueError(f"side to move mismatch: diagram {diag['turn']} vs solution {turn}")

    placement = diag["placement"]
    board = chess.Board(f"{placement} {turn} - - 0 {first['num']}")
    board.set_castling_fen(_castling(board))
    if not board.is_valid():
        raise ValueError(f"invalid position: {board.status()!r}")

    # allow an en passant first move (the diagram cannot show the ep square)
    try:
        _parse(board, first["san"])
    except ValueError:
        for sq in chess.SQUARES:
            trial = board.copy()
            trial.ep_square = sq
            try:
                _parse(trial, first["san"])
                board = trial
                break
            except ValueError:
                pass

    start_fen = board.fen()
    uci, sans = [], []
    for i, mv in enumerate(moves):
        if mv["num"] is not None and (mv["num"] != board.fullmove_number or mv["black"] != (board.turn == chess.BLACK)):
            break  # the bold text jumped to a different line; stop at the continuous part
        try:
            move = _parse(board, mv["san"])
        except ValueError as e:
            raise ValueError(f"move {i + 1} ({mv['num']}{'...' if mv['black'] else '.'}{mv['san']}) illegal") from e
        sans.append(board.san(move))
        uci.append(move.uci())
        board.push(move)

    # the line must end with the solver's move
    if len(uci) % 2 == 0:
        uci, sans = uci[:-1], sans[:-1]

    meta = diagrams_mod.parse_title(diag["title"])
    return {
        "id": diag["id"],
        "difficulty": diag["difficulty"],
        "fen": start_fen,
        "moves": uci,
        "san": sans,
        **meta,
        "page": diag["page"],
    }


def main() -> int:
    print("extracting diagrams ...")
    diags = diagrams_mod.extract_all()
    print("extracting solutions ...")
    sols = solutions_mod.extract_all()
    _fix_misnumbered(diags, sols)

    overrides_path = DATA / "overrides.json"
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}

    puzzles, failures, excluded = [], [], []
    for d in sorted(diags, key=lambda d: d["id"]):
        override = overrides.get(str(d["id"]), {})
        if override.get("exclude"):
            excluded.append(d["id"])
            continue
        d = {**d, **{k: override[k] for k in ("placement", "turn") if k in override}}
        sol = sols[d["id"]]
        if "solution" in override:
            # corrected SAN main line; keep the book's starting move number
            first = sol["moves"][0]
            sol = {**sol, "moves": [{"num": first["num"] if i == 0 else None, "black": first["black"], "san": s}
                                    for i, s in enumerate(override["solution"])]}
        try:
            puzzles.append(build_puzzle(d, sol))
        except Exception as e:  # noqa: BLE001 - collect every failure for review
            failures.append({"id": d["id"], "page": d["page"], "title": d["title"], "error": str(e)})

    DATA.mkdir(exist_ok=True)
    (DATA / "puzzles.json").write_text(json.dumps(puzzles, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(DATA / "review.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "page", "title", "error"])
        w.writeheader()
        w.writerows(failures)

    counts = {k: sum(p["difficulty"] == k for p in puzzles) for k in ("easy", "intermediate", "advanced")}
    print(f"{len(puzzles)} puzzles written {counts}; excluded {excluded}; "
          f"{len(failures)} need review (data/review.csv)")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
