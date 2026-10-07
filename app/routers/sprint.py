"""Sprint: a solo race against the clock with the live-duel rules (rising puzzles, 3 lives).

Moves are judged on the server like in challenges, so a personal best can't be faked from the browser.
Time-outs are applied lazily: whenever a run is read or played after its end time, it is closed.
"""
import secrets
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import challenge_engine as engine
from ..auth import current_user
from ..db import get_db
from ..models import Puzzle, SprintRun, User, utcnow

router = APIRouter(prefix="/api/sprint", tags=["sprint"])
LIVES = engine.LIVES
LATE_MOVE_GRACE = timedelta(seconds=1)  # a move sent just before the buzzer may land a moment after it


class SprintIn(BaseModel):
    minutes: Literal[3, 5] = 3


class MoveIn(BaseModel):
    uci: str = Field(max_length=5)


def _iso(d):
    return d.isoformat(timespec="milliseconds") + "Z" if d else None


def best_for(db: Session, user_id: int, minutes: int) -> int | None:
    return db.scalar(select(func.max(SprintRun.solved)).where(
        SprintRun.user_id == user_id, SprintRun.minutes == minutes, SprintRun.status == "finished"))


def finish(run: SprintRun, reason: str, when) -> None:
    if run.status != "finished":
        run.status, run.reason, run.finished_at = "finished", reason, when


def refresh(run: SprintRun, now=None) -> bool:
    now = now or utcnow()
    if run.status == "active" and now >= run.ends_at + LATE_MOVE_GRACE:
        finish(run, "time", run.ends_at)
        return True
    return False


def load(db: Session, run_id: int, user: User) -> SprintRun:
    run = db.get(SprintRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "Sprint not found.")
    if refresh(run):
        db.commit()
    return run


def current(db: Session, run: SprintRun) -> dict | None:
    """The position to play now; never the solution."""
    if run.status != "active" or run.index >= len(run.puzzle_ids):
        return None
    puzzle = db.get(Puzzle, run.puzzle_ids[run.index])
    board = engine.board_at(puzzle.fen, puzzle.moves, run.ply)
    return {"index": run.index, "puzzle_id": puzzle.id, "difficulty": puzzle.difficulty, "fen": board.fen(),
            "last_move": puzzle.moves[run.ply - 1] if run.ply else None,
            "steps_total": -(-len(puzzle.moves) // 2), "steps_done": run.ply // 2}


def state(db: Session, run: SprintRun) -> dict:
    out = {
        "id": run.id, "minutes": run.minutes, "status": run.status, "reason": run.reason,
        "solved": run.solved, "mistakes": run.mistakes, "lives_left": max(0, LIVES - run.mistakes),
        "started_at": _iso(run.started_at), "ends_at": _iso(run.ends_at), "server_now": _iso(utcnow()),
        "current": current(db, run),
    }
    if run.status == "finished":
        best = best_for(db, run.user_id, run.minutes)
        out["best"] = best
        # a new record when no earlier run of this length scored as much
        earlier = db.scalar(select(func.max(SprintRun.solved)).where(
            SprintRun.user_id == run.user_id, SprintRun.minutes == run.minutes,
            SprintRun.status == "finished", SprintRun.id != run.id))
        out["new_best"] = run.solved > 0 and (earlier is None or run.solved > earlier)
        ids = [r["puzzle_id"] for r in run.results]
        meta = {p.id: p for p in db.scalars(select(Puzzle).where(Puzzle.id.in_(ids)))} if ids else {}
        out["results"] = [{"puzzle_id": r["puzzle_id"], "solved": r["solved"], "fen": meta[r["puzzle_id"]].fen,
                           "san": meta[r["puzzle_id"]].san, "difficulty": meta[r["puzzle_id"]].difficulty}
                          for r in run.results if r["puzzle_id"] in meta]
    return out


@router.get("")
def overview(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Personal bests per length and the latest finished runs."""
    active = db.scalars(select(SprintRun).where(SprintRun.user_id == user.id, SprintRun.status == "active")).all()
    if any(refresh(run) for run in active):
        db.commit()
    recent = db.scalars(select(SprintRun).where(SprintRun.user_id == user.id, SprintRun.status == "finished")
                        .order_by(SprintRun.id.desc()).limit(10)).all()
    runs = db.scalar(select(func.count()).select_from(SprintRun).where(
        SprintRun.user_id == user.id, SprintRun.status == "finished"))
    return {
        "best": {str(m): best_for(db, user.id, m) for m in (3, 5)},
        "runs": runs,
        "recent": [{"id": r.id, "minutes": r.minutes, "solved": r.solved, "mistakes": r.mistakes,
                    "reason": r.reason, "finished_at": _iso(r.finished_at)} for r in recent],
    }


@router.post("")
def start(body: SprintIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    now = utcnow()
    for old in db.scalars(select(SprintRun).where(SprintRun.user_id == user.id, SprintRun.status == "active")):
        finish(old, "ended", now)  # one run at a time
    run = SprintRun(user_id=user.id, minutes=body.minutes, started_at=now,
                    ends_at=now + timedelta(minutes=body.minutes), results=[],
                    puzzle_ids=engine.pick_puzzles(db, "live", "mixed", None, secrets.randbits(32)))
    db.add(run)
    db.commit()
    return state(db, run)


@router.get("/{run_id}")
def read(run_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return state(db, load(db, run_id, user))


@router.post("/{run_id}/move")
def move(run_id: int, body: MoveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = load(db, run_id, user)
    if run.status != "active":
        raise HTTPException(409, "This sprint is over.")
    now = utcnow()
    puzzle = db.get(Puzzle, run.puzzle_ids[run.index])
    verdict = engine.check_move(puzzle.fen, puzzle.moves, run.ply, body.uci.strip())
    if verdict["result"] == "correct":
        run.ply = verdict.pop("next_ply")
    else:
        solved = verdict["result"] == "solved"
        run.results = [*run.results, {"puzzle_id": puzzle.id, "solved": solved}]  # new list so the JSON column saves
        run.solved += solved
        run.mistakes += not solved
        run.index, run.ply = run.index + 1, 0
        if run.mistakes >= LIVES:
            finish(run, "lives", now)
        elif run.index >= len(run.puzzle_ids):
            finish(run, "done", now)
    db.commit()
    return {**verdict, "state": state(db, run)}


@router.post("/{run_id}/end")
def end(run_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = load(db, run_id, user)
    finish(run, "ended", utcnow())
    db.commit()
    return state(db, run)
