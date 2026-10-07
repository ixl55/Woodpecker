"""Side-by-side HTML (book diagram vs. extracted FEN) for a random sample of puzzles.

    python -m extract.preview [count] [--ids 1,2,3]
"""
import base64
import json
import random
import sys

import chess
import chess.svg
import fitz

from .common import DATA, PDF_PATH


def main() -> None:
    args = sys.argv[1:]
    puzzles = {p["id"]: p for p in json.loads((DATA / "puzzles.json").read_text(encoding="utf-8"))}
    if "--ids" in args:
        ids = [int(x) for x in args[args.index("--ids") + 1].split(",")]
    else:
        count = int(args[0]) if args else 15
        ids = sorted(random.sample(sorted(puzzles), count))

    doc = fitz.open(PDF_PATH)
    rows = []
    for pid in ids:
        p = puzzles[pid]
        page = doc[p["page"] - 1]
        # locate the diagram on its page to crop it
        boxes = [b for b in page.search_for(str(pid)) if b.width < 30]
        clip = fitz.Rect(boxes[0].x0, boxes[0].y0 - 30, boxes[0].x0 + 240, boxes[0].y0 + 190) if boxes else page.rect
        png = base64.b64encode(page.get_pixmap(dpi=110, clip=clip).tobytes("png")).decode()
        board = chess.Board(p["fen"])
        svg = chess.svg.board(board, size=260, orientation=board.turn)
        rows.append(f"<tr><td><b>#{pid}</b><br>{p['white']} – {p['black']}<br>{' '.join(p['san'])}</td>"
                    f"<td><img src='data:image/png;base64,{png}'></td><td>{svg}</td></tr>")

    out = DATA / "preview.html"
    out.write_text("<meta charset=utf-8><table border=1 cellpadding=6>" + "".join(rows) + "</table>",
                   encoding="utf-8")
    print("wrote", out, "for ids", ids)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
