from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import catalog
from ..auth import current_user
from ..db import get_db
from ..models import Attempt, Puzzle, ReviewCard, User, utcnow
from ..themes import POSITIONAL, THEMES

router = APIRouter(prefix="/api/puzzles", tags=["puzzles"])
Difficulty = Literal["easy", "intermediate", "advanced"]
Theme = Literal[tuple(THEMES)]  # type: ignore[valid-type]


def has_theme(theme: str):
    return Puzzle.themes.like(f"%,{theme},%")


def last_results(db: Session, user_id: int) -> dict[int, bool]:
    """puzzle_id -> whether the user's most recent attempt was solved."""
    last_ids = (select(func.max(Attempt.id)).where(Attempt.user_id == user_id)
                .group_by(Attempt.puzzle_id))
    rows = db.execute(select(Attempt.puzzle_id, Attempt.solved).where(Attempt.id.in_(last_ids)))
    return {pid: solved for pid, solved in rows}


def _status(results: dict[int, bool], pid: int) -> str:
    if pid not in results:
        return "new"
    return "solved" if results[pid] else "failed"


def puzzle_out(p: Puzzle, status: str, card: ReviewCard | None = None) -> dict:
    return {
        "id": p.id, "difficulty": p.difficulty, "fen": p.fen, "moves": p.moves, "san": p.san,
        "white": p.white, "black": p.black, "event": p.event, "year": p.year, "status": status,
        "themes": p.theme_list, "book": p.book or 1, "number": p.number or p.id, "line": p.line,
        "review": {"box": card.box, "due_at": card.due_at.isoformat() + "Z"} if card else None,
    }


@router.get("/themes")
def list_themes(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every theme with how many puzzles carry it and how many of those the user has solved."""
    results = last_results(db, user.id)
    puzzles = catalog.entries(db)
    out = []
    for key, (name, description) in THEMES.items():
        ids = [p.id for p in puzzles if key in p.themes]
        out.append({"key": key, "name": name, "description": description, "total": len(ids),
                    "group": "positional" if key in POSITIONAL else "tactics",
                    "solved": sum(1 for pid in ids if results.get(pid))})
    return out


@router.get("")
def list_puzzles(
    difficulty: Difficulty | None = None,
    theme: Theme | None = None,
    book: int | None = Query(None, ge=1, le=2),
    status: Literal["all", "new", "solved", "failed"] = "all",
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = select(Puzzle.id, Puzzle.book, Puzzle.number, Puzzle.difficulty, Puzzle.white, Puzzle.black,
               Puzzle.event, Puzzle.year).order_by(Puzzle.id)
    if difficulty:
        q = q.where(Puzzle.difficulty == difficulty)
    if book:
        q = q.where(Puzzle.book == book)
    if theme:
        q = q.where(has_theme(theme))
    results = last_results(db, user.id)
    rows = [dict(r._mapping, status=_status(results, r.id)) for r in db.execute(q)]
    if status != "all":
        rows = [r for r in rows if r["status"] == status]
    return {"total": len(rows), "items": rows[offset:offset + limit]}


@router.get("/next")
def next_puzzle(
    mode: Literal["new", "review", "theme"] = "new",
    difficulty: Difficulty | None = None,
    theme: Theme | None = None,
    after: int = 0,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if mode == "theme":
        # practise one theme: every puzzle with it that isn't solved yet (new or missed), in book order
        if theme is None:
            raise HTTPException(400, "Pick a theme to practise.")
        results = last_results(db, user.id)
        ids = [p.id for p in catalog.entries(db) if theme in p.themes and not results.get(p.id)]
        pick = next((pid for pid in ids if pid > after), ids[0] if ids else None)
        if pick is None:
            return {"done": True}
        puzzle = db.get(Puzzle, pick)
        return {**puzzle_out(puzzle, _status(results, pick)), "theme_left": len(ids)}
    if mode == "review":
        q = (select(ReviewCard, Puzzle).join(Puzzle, Puzzle.id == ReviewCard.puzzle_id)
             .where(ReviewCard.user_id == user.id, ReviewCard.due_at <= utcnow())
             .order_by(ReviewCard.due_at, Puzzle.id))
        if difficulty:
            q = q.where(Puzzle.difficulty == difficulty)
        row = db.execute(q.limit(1)).first()
        if row is None:
            return {"done": True}
        card, puzzle = row
        return puzzle_out(puzzle, "failed", card)

    # the Woodpecker method says: solve the exercises in order
    attempted = select(Attempt.puzzle_id).where(Attempt.user_id == user.id)
    q = select(Puzzle).where(Puzzle.id.not_in(attempted)).order_by(Puzzle.id)
    if difficulty:
        q = q.where(Puzzle.difficulty == difficulty)
    puzzle = db.scalars(q.where(Puzzle.id > after).limit(1)).first() or db.scalars(q.limit(1)).first()
    if puzzle is None:
        return {"done": True}
    return puzzle_out(puzzle, "new")


@router.get("/{puzzle_id}")
def get_puzzle(puzzle_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    puzzle = db.get(Puzzle, puzzle_id)
    if puzzle is None:
        raise HTTPException(404, "Puzzle not found.")
    card = db.scalars(select(ReviewCard).where(ReviewCard.user_id == user.id,
                                               ReviewCard.puzzle_id == puzzle_id)).first()
    prev_id = db.scalar(select(func.max(Puzzle.id)).where(Puzzle.id < puzzle_id))
    next_id = db.scalar(select(func.min(Puzzle.id)).where(Puzzle.id > puzzle_id))
    out = puzzle_out(puzzle, _status(last_results(db, user.id), puzzle_id), card)
    return {**out, "prev_id": prev_id, "next_id": next_id}
