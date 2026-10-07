"""Extract the exercise diagrams (as FEN piece placement) from the book.

Diagrams are typeset with the Chess Merida font, so every board is eight lines of
text. Glyphs (after `plain`): ' ' / '+' empty light / dark square,
pnbrqk white piece on light square, PNBRQK white piece on dark square,
omvtwl black piece on light square, OMVTWL black piece on dark square.
"""
import re

import fitz

from .common import EXERCISE_PAGES, PDF_PATH, difficulty_for_page, plain

PIECES = {
    "p": "P", "n": "N", "b": "B", "r": "R", "q": "Q", "k": "K",
    "o": "p", "m": "n", "v": "b", "t": "r", "w": "q", "l": "k",
}
TOP_BORDER = "1222222223"


def rank_to_fen(row: str) -> str:
    """`row` is the 8 cells of one rank, without border glyphs."""
    out, empty = [], 0
    for cell in row:
        if cell in " +":
            empty += 1
            continue
        piece = PIECES.get(cell.lower())
        if piece is None:
            raise ValueError(f"unknown glyph {cell!r} in {row!r}")
        if empty:
            out.append(str(empty))
            empty = 0
        out.append(piece)
    if empty:
        out.append(str(empty))
    return "".join(out)


def rows_to_placement(rows: list[str]) -> str:
    """`rows` are the 8 raw rank lines (rank label + 8 cells + right border)."""
    ranks = []
    for expected, row in zip(range(7, -1, -1), rows):
        if ord(row[0]) != 0xC0 + expected or len(row) != 10:
            raise ValueError(f"bad rank line {row!r}")
        ranks.append(rank_to_fen(row[1:9]))
    return "/".join(ranks)


def _spans(page):
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            line_text = "".join(c["c"] for s in line["spans"] for c in s["chars"])
            for span in line["spans"]:
                span["text"] = "".join(c["c"] for c in span["chars"])
                yield span, line, line_text


def _grid(chars, x0, y0, cell_w, cell_h) -> list[list[str]]:
    """Place Merida glyphs on a 10x10 grid (border + 8x8) by position.

    Some diagrams are typeset in fragments that simply omit empty squares, so the
    text order cannot be trusted; the glyph coordinates can.
    """
    grid = [[" "] * 10 for _ in range(10)]
    for (cx, cy), ch in chars:
        col = round((cx - x0) / cell_w)
        row = round((cy - y0) / cell_h)
        if 0 <= row < 10 and 0 <= col < 10:
            grid[row][col] = ch
    return grid


def _rows_in_reading_order(chars, x0, y0, cell_w, cell_h) -> list[str] | None:
    """The 8 rank lines in text order, or None if any rank is incomplete.

    Some pages carry broken glyph x-coordinates (several glyphs stacked at one x
    with zero width) while their text order is still right, so text order wins
    whenever every rank has all 10 glyphs. Diagrams typeset with omitted empty
    squares fall back to the positional grid.
    """
    rows = [[] for _ in range(8)]
    for (cx, cy), ch, _ in chars:
        row = round((cy - y0) / cell_h) - 1
        if 0 <= row < 8 and -0.5 <= (cx - x0) / cell_w < 9.5:
            rows[row].append(ch)
    out = []
    for r in rows:
        text = "".join(r)
        half = len(text) // 2
        if len(text) == 20 and text[:half] == text[half:]:  # duplicated text layer
            text = text[:half]
        if len(text) != 10:
            return None
        out.append(text)
    return out


def extract_page(page, page_index: int) -> list[dict]:
    merida, numbers, triangles, titles = [], [], [], []
    for span, line, line_text in _spans(page):
        font, bbox = span["font"], span["bbox"]
        text = plain(span["text"]).rstrip("\n")
        if "Merida" in font:
            for c in span["chars"]:
                if c["c"] != "\n":
                    merida.append(((c["bbox"][0], c["bbox"][1]), plain(c["c"]), c["bbox"]))
        elif "Tunga" in font and text.strip().isdigit():
            numbers.append((bbox, int(text.strip())))
        elif "Wingdings3" in font and text.strip() in ("q", "r"):
            triangles.append((bbox, "b" if text.strip() == "q" else "w"))
        elif "Bold" in font and "Garamond" in font and "–" in line_text:
            if (line["bbox"], line_text.strip()) not in titles:
                titles.append((line["bbox"], line_text.strip()))

    # top-left corner glyph '1' starts each board
    boards = []
    for (cx, cy), ch, cb in merida:
        if ch != "1" or any(abs(b["x0"] - cx) < 1 and abs(b["y0"] - cy) < 1 for b in boards):
            continue
        cell_w, cell_h = cb[2] - cb[0], cb[3] - cb[1]
        grid = _grid([(pos, c) for pos, c, _ in merida], cx, cy, cell_w, cell_h)
        if "".join(grid[0]) != TOP_BORDER:
            raise ValueError(f"page {page_index + 1}: bad top border {grid[0]!r}")
        rows = _rows_in_reading_order(merida, cx, cy, cell_w, cell_h) or ["".join(r) for r in grid[1:9]]
        boards.append({"x0": cx, "y0": cy, "x1": cx + 10 * cell_w, "y1": cy + 10 * cell_h,
                       "placement": rows_to_placement(rows)})

    results = []
    for b in boards:
        def near(items, cond):
            found = list({(tuple(round(x) for x in bb), v): v for bb, v in items if cond(bb)}.values())
            if len(found) != 1:
                raise ValueError(f"page {page_index + 1}: expected 1 match, got {found!r}")
            return found[0]

        number = near(numbers, lambda bb: b["x0"] - 30 < bb[0] < b["x0"] and b["y0"] - 5 < bb[1] < b["y0"] + 40)
        turn = near(triangles, lambda bb: b["x0"] < bb[0] < b["x1"] + 30 and b["y0"] <= bb[1] <= b["y1"])
        title = near(titles, lambda bb: bb[0] < b["x1"] and bb[2] > b["x0"] and b["y0"] - 30 < bb[1] < b["y0"])
        results.append({
            "id": number,
            "difficulty": difficulty_for_page(page_index),
            "placement": b["placement"],
            "turn": turn,
            "title": title,
            "page": page_index + 1,
        })
    return results


def parse_title(title: str) -> dict:
    """'Hamppe – Steinitz, Vienna 1860' -> players / event / year.

    Also copes with the book's typos: a leading '301. ', a '.' instead of the comma,
    or no separator at all ('Smyslov – Botvinnik Moscow (4) 1957').
    """
    title = re.sub(r"^\d+\.\s*", "", title.strip())
    if "," not in title:
        m = re.fullmatch(r"(.+?–\s*\S+?)[.]?\s+(.+\d{4})", title)
        if m:
            title = f"{m.group(1)}, {m.group(2)}"
    players, _, rest = title.partition(",")
    white, _, black = players.partition("–")
    m = re.search(r"(\d{4})\s*$", rest)
    year = int(m.group(1)) if m else None
    event = rest[:m.start()].strip() if m else rest.strip()
    return {"white": white.strip(), "black": black.strip(), "event": event, "year": year}


def extract_all(pdf_path=PDF_PATH) -> list[dict]:
    doc = fitz.open(pdf_path)
    out = []
    for p in EXERCISE_PAGES:
        out.extend(extract_page(doc[p], p))
    out.sort(key=lambda d: d["id"])
    return out


if __name__ == "__main__":
    diagrams = extract_all()
    ids = [d["id"] for d in diagrams]
    print(len(diagrams), "diagrams; ids", ids[0], "..", ids[-1],
          "contiguous" if ids == list(range(1, len(ids) + 1)) else "NOT contiguous")
