"""Read the board images of The Woodpecker Method 2 into FEN placements.

Every diagram is the same 360x360 rendering: a frame, then 8x8 squares of 36.5 px starting at pixel 34,
light squares white and dark squares hatched with thin diagonal lines. Each square is:
  1. thresholded to black/white,
  2. stripped of the hatching (one-pixel diagonal lines with white on both sides), so a piece looks the
     same on light and dark squares,
  3. matched against templates taken from two boards read by hand (all 12 pieces and empty squares),
     allowing a shift of up to three pixels.
The best match beats the runner-up by a wide margin on practically every square; `read` reports the
closest call so doubtful boards can be reviewed.
"""
import fitz
import numpy as np

EDGE0, STEP, SIZE = 34, 36.5, 32
# exercise number -> placement, read by eye from the book's diagrams
SEEDS = {
    1: "1r1n1rk1/b1p1qppp/p2p1n2/4pP2/P3P3/2PPNB2/6PP/R1BQK2R",
    51: "r3k2r/1pqbbpp1/p1npp2p/8/4PP1P/1NN4R/PPP2QP1/2KR1B2",
}
SHIFTS = [(dy, dx) for dy in range(-3, 4) for dx in range(-3, 4)]  # pieces sit up to 3 px off-centre


def dehatch(c: np.ndarray) -> np.ndarray:
    """Drop pixels of one-pixel diagonal lines (and stray single pixels) with white on both sides."""
    c = c.copy()
    for _ in range(2):
        p = np.pad(c, 1)
        left, right, up, down = p[1:-1, :-2], p[1:-1, 2:], p[:-2, 1:-1], p[2:, 1:-1]
        up_right, down_left = p[:-2, 2:], p[2:, :-2]
        lonely = c & ~left & ~right & ~up & ~down
        diagonal = c & ~left & ~right & (up_right | down_left)
        c &= ~(diagonal | lonely)
    return c


def _shifted(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    out = np.zeros_like(a)
    h, w = a.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


def _grid(placement: str) -> list[list[str]]:
    rows = []
    for row in placement.split("/"):
        cells: list[str] = []
        for ch in row:
            cells.extend(["."] * int(ch) if ch.isdigit() else [ch])
        rows.append(cells)
    return rows


class BoardReader:
    def __init__(self, doc: fitz.Document, seed_xrefs: dict[int, int]):
        self.doc = doc
        self.templates: dict[str, list[np.ndarray]] = {}
        for number, placement in SEEDS.items():
            squares = self.squares(seed_xrefs[number])
            for r, row in enumerate(_grid(placement)):
                for f, piece in enumerate(row):
                    self.templates.setdefault(piece, []).append(squares[r][f])
        self._cache: dict[bytes, tuple[str, int, int]] = {}

    def squares(self, xref: int) -> list[list[np.ndarray]]:
        pix = fitz.Pixmap(self.doc, xref)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3].mean(axis=2)
        black = img < 128
        return [[dehatch(black[int(EDGE0 + r * STEP) + 2:int(EDGE0 + r * STEP) + 2 + SIZE,
                               int(EDGE0 + f * STEP) + 2:int(EDGE0 + f * STEP) + 2 + SIZE])
                 for f in range(8)] for r in range(8)]

    def classify(self, cell: np.ndarray) -> tuple[str, int, int]:
        """(piece or '.', distance to the best template, lead over the runner-up)."""
        key = cell.tobytes()
        if key not in self._cache:
            scores = sorted(
                (min(int((_shifted(t, dy, dx) != cell).sum()) for t in variants for dy, dx in SHIFTS), piece)
                for piece, variants in self.templates.items())
            self._cache[key] = (scores[0][1], scores[0][0], scores[1][0] - scores[0][0])
        return self._cache[key]

    def read(self, xref: int) -> tuple[str, int]:
        """FEN placement of the diagram and the smallest lead of any square (low = doubtful)."""
        rows, lead = [], 10**9
        for row in self.squares(xref):
            fen, empty = "", 0
            for cell in row:
                piece, _, margin = self.classify(cell)
                lead = min(lead, margin)
                if piece == ".":
                    empty += 1
                    continue
                fen += (str(empty) if empty else "") + piece
                empty = 0
            rows.append(fen + (str(empty) if empty else ""))
        return "/".join(rows), lead
