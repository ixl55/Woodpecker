from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import progress
from ..auth import current_user
from ..db import get_db
from ..models import Attempt, Puzzle, ReviewCard, User, utcnow

router = APIRouter(prefix="/api/attempts", tags=["attempts"])

# Leitner boxes: a failed puzzle starts in box 1 (due now); each success moves it up.
# Succeeding from the last box retires the card.
BOX_INTERVAL_DAYS = {1: 0, 2: 1, 3: 3, 4: 7, 5: 14, 6: 30}
LAST_BOX = max(BOX_INTERVAL_DAYS)


class AttemptIn(BaseModel):
    puzzle_id: int
    solved: bool
    mistakes: int = Field(0, ge=0, le=100)
    time_ms: int = Field(0, ge=0, le=6 * 3600 * 1000)


def update_card(db: Session, user_id: int, puzzle_id: int, solved: bool) -> ReviewCard | None:
    card = db.scalars(select(ReviewCard).where(ReviewCard.user_id == user_id,
                                               ReviewCard.puzzle_id == puzzle_id)).first()
    now = utcnow()
    if not solved:
        if card is None:
            card = ReviewCard(user_id=user_id, puzzle_id=puzzle_id)
            db.add(card)
        card.box, card.due_at = 1, now
        return card
    if card is None:
        return None
    if card.box >= LAST_BOX:
        db.delete(card)
        return None
    card.box += 1
    card.due_at = now + timedelta(days=BOX_INTERVAL_DAYS[card.box])
    return card


@router.post("")
def record_attempt(body: AttemptIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(Puzzle, body.puzzle_id) is None:
        raise HTTPException(404, "Puzzle not found.")
    before = progress.compute(db, user.id)
    db.add(Attempt(user_id=user.id, puzzle_id=body.puzzle_id, solved=body.solved,
                   mistakes=body.mistakes, time_ms=body.time_ms))
    card = update_card(db, user.id, body.puzzle_id, body.solved)
    db.commit()
    after = progress.compute(db, user.id)
    had = {a["key"] for a in before["achievements"] if a["earned"]}
    return {
        "ok": True,
        "review": {"box": card.box, "due_at": card.due_at.isoformat() + "Z"} if card else None,
        # lets the page celebrate unlocks right away
        "new_achievements": [a for a in after["achievements"] if a["earned"] and a["key"] not in had],
        "rank_up": after["rank"] if after["rank"]["level"] > before["rank"]["level"] else None,
    }
