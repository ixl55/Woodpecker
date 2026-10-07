"""The Woodpecker Method 2 (positional play): exercises, board images and solutions.

Book 2 is laid out differently from book 1: each exercise is a bold header ("51. Vesterinen – Smyslov,
Amsterdam (Ol) 1954"), a 360x360 board image, "Show/Hide Solution" and the solution text, where the
main line is bold. Boards are images, so the position is read square by square (see board_image.py).

The exercises are positional: the answer is the key move; the bold continuation is shown afterwards.
Themes: the positional ones come from data/themes2.json (every exercise's explanation read and
classified by hand); the tactical ones are detected in the whole bold line.

    python -m extract.book2          # writes data/puzzles2.json and data/review2.csv
"""
import csv
import json
import os
import re
from pathlib import Path

import chess
import fitz

from app.themes import exercise_themes, text_themes

from .board_image import SEEDS, BoardReader
from .build import _castling, _parse
from .common import DATA
from .diagrams import parse_title
from .solutions import TOKEN_RE, _tokens

PDF_PATH = Path(os.environ.get(
    "WOODPECKER2_PDF", r"C:\Users\AL-SERAJ\Desktop\chess\The Woodpecker Method 2 -  Axel Smith.pdf"))
PAGES = range(28, 721)  # 0-based: first exercise page .. the epilogue
ID_OFFSET = 2000  # book 2 exercise n is puzzle 2000 + n, clear of book 1's 1..1128
BOARD_SIZE = 360
# "51. Vesterinen \u2013 Smyslov, ...", also the book's typos "154..Kramnik" and "273 Karpov", and the exam
# chapter's opening names ("297. Queen's Gambit Accepted")
HEADER_RE = re.compile(r"^(\d+)\.*\s*([A-Z].+)$")
MOVE_START_RE = re.compile(r"^(?:O-O|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8])")


def difficulty(n: int) -> str:
    """Chapters 1-2 (Public Education + exam) easy, 3-4 intermediate, 5-6 (Hard, Expert) advanced."""
    if n <= 339:
        return "easy"
    if n <= 739:
        return "intermediate"
    return "advanced"


def _items(page):
    """Headers, board images and text spans of one page, in reading order."""
    items = []
    for info in page.get_image_info(xrefs=True):
        if info["width"] == BOARD_SIZE and info["height"] == BOARD_SIZE:
            items.append((info["bbox"][1], 0, ("board", info["xref"])))
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            text = "".join(s["text"] for s in spans).strip()
            y = line["bbox"][1]
            m = HEADER_RE.match(text)
            if m and "Bold" in spans[0]["font"] and not MOVE_START_RE.match(m.group(2)):
                items.append((y, 1, ("header", int(m.group(1)), m.group(2).strip())))
                continue
            if text == "Show/Hide Solution":
                items.append((y, 1, ("solution",)))
                continue
            for s in spans:
                if s["text"].strip():
                    items.append((y, 2, ("text", s["text"], "Bold" in s["font"])))
    items.sort(key=lambda t: (t[0], t[1]))
    return [it for _, _, it in items]


def extract_all(pdf_path=PDF_PATH) -> list[dict]:
    """[{'number', 'title', 'page', 'xref', 'moves'}] in book order."""
    doc = fitz.open(pdf_path)
    out: list[dict] = []
    cur = None
    def start(number, title, page):
        ex = {"number": number, "title": title, "page": page, "xref": None, "in_solution": False, "segments": []}
        out.append(ex)
        return ex

    for p in PAGES:
        for item in _items(doc[p]):
            kind = item[0]
            if kind == "header":
                # exercises come in order; anything else is a quoted title inside a solution
                expected = cur["number"] + 1 if cur else 1
                if expected <= item[1] <= expected + 2:
                    cur = start(item[1], item[2], p + 1)
                continue
            if cur is None:
                continue
            if kind == "board":
                if cur["xref"] is None and not cur["in_solution"]:
                    cur["xref"] = item[1]
                elif cur["in_solution"] and cur["number"] < 1000:
                    # a board after a solution started: the next exercise lost its header (202)
                    cur = start(cur["number"] + 1, "", p + 1)
                    cur["xref"] = item[1]
            elif kind == "solution":
                cur["in_solution"] = True
            elif kind == "text" and cur["in_solution"]:
                _, text, bold = item
                cur["text"] = cur.get("text", "") + text  # the explanation, used for positional themes
                segs = cur["segments"]
                if bold:
                    if segs and segs[-1][1] == "open":
                        segs[-1][0] += text
                    else:
                        segs.append([text, "open"])
                elif segs and segs[-1][1] == "open":
                    # roman text only closes the main line when it holds moves (a sideline)
                    if TOKEN_RE.search(text) and re.search(r"\d+\.", text):
                        segs[-1][1] = "closed"
                    else:
                        segs[-1][0] += " "
    for ex in out:
        ex["moves"] = _tokens([s for s, _ in ex.pop("segments")])
        ex["text"] = " ".join(ex.get("text", "").split())
        ex.pop("in_solution")
    return out


def _position(placement: str, mv: dict) -> chess.Board:
    board = chess.Board(f"{placement} {'b' if mv['black'] else 'w'} - - 0 {mv['num']}")
    board.set_castling_fen(_castling(board))
    return board


def _legal(board: chess.Board, san: str) -> chess.Board | None:
    """The board (with an en passant square if that is what makes `san` legal), or None."""
    for ep in [None, *chess.SQUARES]:  # the diagram cannot show an en passant square
        trial = board.copy()
        trial.ep_square = ep
        try:
            _parse(trial, san)
            return trial
        except ValueError:
            continue
    return None


def _follows(a: dict, b: dict) -> bool:
    return b["num"] == (a["num"] + 1 if a["black"] else a["num"]) and b["black"] != a["black"]


def build_puzzle(ex: dict, placement: str) -> dict:
    """Validate one exercise: the key move must be legal in the position read from the image."""
    moves = ex["moves"]
    if not moves or moves[0]["num"] is None:
        raise ValueError("solution has no numbered first move")
    first = moves[0]
    board = _position(placement, first)
    if not board.is_valid():
        raise ValueError(f"invalid position: {board.status()!r}")
    found = _legal(board, first["san"])
    if found is None and len(moves) > 1 and _follows(first, moves[1]):
        # the text opens with the move that led to the diagram ("Black's last move was 15...e5");
        # the answer is the next one, and a two-square pawn push allows en passant
        played, moves = first, moves[1:]
        first = moves[0]
        board = _position(placement, first)
        push = re.fullmatch(r"([a-h])([45])", played["san"])
        if push:
            board.ep_square = chess.parse_square(push.group(1) + ("6" if push.group(2) == "5" else "3"))
        found = _legal(board, first["san"])
    if found is not None:
        board = found
    fen = board.fen()
    # the key move, then the book's bold continuation for as long as it is one continuous, legal line
    line = []
    for i, mv in enumerate(moves):
        if i and mv["num"] is not None and (mv["num"] != board.fullmove_number or mv["black"] != (board.turn == chess.BLACK)):
            break
        try:
            move = _parse(board, mv["san"])
        except ValueError as e:
            if i == 0:
                raise ValueError(f"key move {first['num']}{'...' if first['black'] else '.'}{first['san']} is illegal") from e
            break
        line.append((move.uci(), board.san(move)))
        board.push(move)
    title = ex["title"]
    meta = parse_title(title) if "–" in title else {"white": "", "black": "", "event": title, "year": None}
    return {
        "id": ID_OFFSET + ex["number"],
        "book": 2,
        "number": ex["number"],
        "difficulty": difficulty(ex["number"]),
        "fen": fen,
        "moves": [line[0][0]],
        "san": [line[0][1]],
        "line": [san for _, san in line],
        **meta,
        "page": ex["page"],
    }


def load_reviewed_themes() -> dict[int, list[str]]:
    """Exercise number -> positional themes, as read from the book's explanation (data/themes2.json)."""
    path = DATA / "themes2.json"
    if not path.exists():
        return {}
    return {int(n): themes for n, themes in json.loads(path.read_text(encoding="utf-8")).items()}


def _line_uci(fen: str, line: list[str]) -> list[str]:
    board = chess.Board(fen)
    moves = []
    for san in line:
        move = board.parse_san(san)
        moves.append(move.uci())
        board.push(move)
    return moves


def main() -> int:
    doc = fitz.open(PDF_PATH)
    reviewed = load_reviewed_themes()
    print("reading exercises ...")
    exs = extract_all()
    by_number = {e["number"]: e for e in exs}
    reader = BoardReader(doc, {n: by_number[n]["xref"] for n in SEEDS})
    puzzles, failures = [], []
    for ex in exs:
        placement, lead = reader.read(ex["xref"])
        try:
            p = build_puzzle(ex, placement)
            positional = reviewed.get(ex["number"])
            if positional is None:
                print(f"  exercise {ex['number']} has no entry in data/themes2.json: using keywords")
                positional = text_themes(ex["text"])
            p["themes"] = exercise_themes(p["fen"], _line_uci(p["fen"], p["line"]), set(positional))
            puzzles.append(p)
        except Exception as e:  # noqa: BLE001 - collect every failure for review
            failures.append({"number": ex["number"], "page": ex["page"], "title": ex["title"],
                             "placement": placement, "lead": lead, "error": str(e)})
        if lead < 20:
            print(f"  doubtful board: exercise {ex['number']} (closest call: lead {lead})")
    (DATA / "puzzles2.json").write_text(json.dumps(puzzles, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(DATA / "review2.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["number", "page", "title", "placement", "lead", "error"])
        w.writeheader()
        w.writerows(failures)
    counts = {k: sum(p["difficulty"] == k for p in puzzles) for k in ("easy", "intermediate", "advanced")}
    print(f"{len(puzzles)} puzzles written to data/puzzles2.json {counts}; {len(failures)} need review (data/review2.csv)")
    return 0 if not failures else 1


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
