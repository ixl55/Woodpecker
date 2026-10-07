"""The puzzle catalogue is fixed while the server runs (app.seed loads it at startup), so the columns that
pages scan on every request are read from the database once and then kept in memory. On a free database
that sleeps when idle, every query saved is a round trip saved."""
import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Puzzle


@dataclass(frozen=True)
class Entry:
    id: int
    difficulty: str
    themes: frozenset[str]
    mates: bool  # the solution ends in checkmate
    solver_moves: int


_entries: list[Entry] | None = None


def entries(db: Session) -> list[Entry]:
    """Every puzzle in book order, with what the pages need to know about it."""
    global _entries
    if _entries is None:
        rows = db.execute(select(Puzzle.id, Puzzle.difficulty, Puzzle.themes, Puzzle.san, Puzzle.moves)
                          .order_by(Puzzle.id))
        _entries = [Entry(pid, difficulty, frozenset(t for t in (themes or "").split(",") if t),
                          bool(san) and san[-1].endswith("#"), math.ceil(len(moves) / 2))
                    for pid, difficulty, themes, san, moves in rows]
    return _entries


def reset() -> None:
    """Forget the cached catalogue (after the puzzles table has been reseeded)."""
    global _entries
    _entries = None
