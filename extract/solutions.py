"""Extract the main solution line of every exercise.

Solution text mixes the main line (bold) with sidelines and commentary (roman).
A Wingdings check mark (U+F0FC) after a move marks "part of the solution".
Only moves are kept; the authors' commentary is deliberately discarded.
"""
import re

import fitz

from .common import PDF_PATH, SOLUTION_PAGES

FIGURINES = str.maketrans({"¦": "R", "¢": "K", "£": "Q", "¥": "B", "¤": "N", "†": "+"})
CHECK_MARK = ""
HEADER_RE = re.compile(r"^(\d+)\.\s+(.+–.+)$")
RESULT_RE = re.compile(r"1–0|0–1|½–½")
TOKEN_RE = re.compile(
    r"(?P<num>\d+)\.(?P<dots>\.\.)?\s*"
    r"|(?P<san>(?:O-O-O|O-O|0-0-0|0-0)|[KQRBN]?[a-h]?[1-8]?x?(?:[a-h][18]=?[QRBN]|[a-h][1-8]))"
)


def _is_bold(font: str) -> bool:
    return "Bold" in font


def _stream(doc):
    """Yield ('header', id, title) and ('text', text, bold) / ('mark', bold) items in reading order."""
    for p in SOLUTION_PAGES:
        for block in doc[p].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = line["spans"]
                line_text = "".join(s["text"] for s in spans).strip()
                m = HEADER_RE.match(line_text)
                if m and _is_bold(spans[0]["font"]) and not re.match(r"^\d+\.\s*[a-h1-8KQRBNO¦¢£¥¤]", m.group(2)):
                    yield "header", int(m.group(1)), m.group(2).strip()
                    continue
                last_bold = False
                for s in spans:
                    text = s["text"]
                    if CHECK_MARK in text:
                        yield "mark", last_bold
                        text = text.replace(CHECK_MARK, "")
                    if text.strip():
                        bold = _is_bold(s["font"])
                        last_bold = bold
                        yield "text", text, bold


def _tokens(chunks: list[str]) -> list[dict]:
    """Chunks of contiguous bold text -> [{'num', 'black', 'san'}]; a new chunk may restart numbering."""
    moves = []
    for chunk in chunks:
        num, black = None, False
        chunk = RESULT_RE.sub(" ", chunk)  # '0–1' glued to the next move number reads as '137.'
        for m in TOKEN_RE.finditer(chunk.translate(FIGURINES)):
            if m.group("num"):
                num, black = int(m.group("num")), bool(m.group("dots"))
            elif m.group("san"):
                san = m.group("san").replace("0", "O")
                moves.append({"num": num, "black": black, "san": san})
                if num is not None:
                    if black:
                        num, black = num + 1, False
                    else:
                        black = True
    return moves


def extract_all(pdf_path=PDF_PATH) -> dict[int, dict]:
    doc = fitz.open(pdf_path)
    solutions: dict[int, dict] = {}
    current = None
    for item in _stream(doc):
        if item[0] == "header":
            current = {"id": item[1], "title": item[2], "segments": [], "marks": []}
            solutions.setdefault(item[1], current)
            continue
        if current is None:
            continue
        if item[0] == "mark":
            if item[1]:
                current["marks"].append(len(current["segments"]))
            continue
        _, text, bold = item
        segs = current["segments"]
        if bold:
            if segs and segs[-1][1] == "bold-open":
                segs[-1][0] += text
            else:
                segs.append([text, "bold-open"])
        elif segs and segs[-1][1] == "bold-open":
            # a roman span only interrupts the main line if it contains moves (a sideline)
            if TOKEN_RE.search(text.translate(FIGURINES)) and re.search(r"\d+\.", text):
                segs[-1][1] = "bold"
            else:
                segs[-1][0] += " "

    out = {}
    for sid, sol in solutions.items():
        segments = [s for s, _ in sol["segments"]]
        # keep the main line up to (and including) the segment holding the last bold check mark
        if sol["marks"]:
            segments = segments[:max(sol["marks"])]
        out[sid] = {"id": sid, "title": sol["title"], "moves": _tokens(segments),
                    "has_mark": bool(sol["marks"])}
    return out


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    sols = extract_all()
    print(len(sols), "solutions")
    for i in (1, 2, 3, 7, 9, 11, 14):
        s = sols[i]
        print(i, s["title"], [(m["num"], "..." if m["black"] else ".", m["san"]) for m in s["moves"]])
