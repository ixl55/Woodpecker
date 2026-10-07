from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import catalog, progress
from ..auth import current_user
from ..db import get_db
from ..models import Attempt, Puzzle, ReviewCard, User, utcnow
from ..themes import THEMES
from .puzzles import last_results

router = APIRouter(prefix="/api/stats", tags=["stats"])
LEVELS = ("easy", "intermediate", "advanced")
MIN_THEME_ATTEMPTS = 3  # below this a theme's accuracy is too noisy to call it a weakness
HEATMAP_DAYS = 182
WEEKS = 12
# (label, upper bound in ms) for the solve-time histogram
TIME_BUCKETS = [("<10s", 10_000), ("10–30s", 30_000), ("30–60s", 60_000),
                ("1–2m", 120_000), ("2–5m", 300_000), (">5m", None)]


def _accuracy(rows) -> int | None:
    return round(100 * sum(1 for a in rows if a.solved) / len(rows)) if rows else None


@router.get("")
def stats(
    days: int = Query(14, alias="range"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    span = days if days in (14, 30, 90) else 14
    now = utcnow()
    today = now.date()
    puzzles = catalog.entries(db)
    difficulty_of = {p.id: p.difficulty for p in puzzles}
    attempts = db.execute(
        select(Attempt.puzzle_id, Attempt.solved, Attempt.time_ms, Attempt.created_at)
        .where(Attempt.user_id == user.id).order_by(Attempt.id)
    ).all()
    last = last_results(db, user.id)

    levels = {}
    for level in LEVELS:
        mine = [a for a in attempts if difficulty_of.get(a.puzzle_id) == level]
        solved_times = [a.time_ms for a in mine if a.solved]
        levels[level] = {
            "total": sum(1 for d in difficulty_of.values() if d == level),
            "attempted": len({a.puzzle_id for a in mine}),
            "solved": sum(1 for pid, ok in last.items() if ok and difficulty_of.get(pid) == level),
            "failed": sum(1 for pid, ok in last.items() if not ok and difficulty_of.get(pid) == level),
            "attempts": len(mine),
            "accuracy": _accuracy(mine),
            "avg_time_ms": round(sum(solved_times) / len(solved_times)) if solved_times else None,
        }

    by_day: dict[date, list] = {}
    for a in attempts:
        by_day.setdefault(a.created_at.date(), []).append(a)

    def day_row(d: date) -> dict:
        rows = by_day.get(d, [])
        solved = sum(1 for a in rows if a.solved)
        return {"date": d.isoformat(), "attempts": len(rows), "solved": solved, "failed": len(rows) - solved}

    def last_days(n: int) -> list[date]:
        return [today - timedelta(days=i) for i in range(n - 1, -1, -1)]

    activity = [day_row(d) for d in last_days(span)]
    heatmap = [{"date": d.isoformat(), "attempts": len(by_day.get(d, []))} for d in last_days(HEATMAP_DAYS)]
    spark = [day_row(d) for d in last_days(7)]

    weekly = []  # weeks end today
    for w in range(WEEKS - 1, -1, -1):
        end = today - timedelta(days=7 * w)
        start = end - timedelta(days=6)
        rows = [a for a in attempts if start <= a.created_at.date() <= end]
        weekly.append({"start": start.isoformat(), "end": end.isoformat(), "attempts": len(rows),
                       "accuracy": _accuracy(rows)})

    histogram = [{"label": label, "count": 0} for label, _ in TIME_BUCKETS]
    for a in attempts:
        if not a.solved or not a.time_ms:
            continue
        for i, (_, upper) in enumerate(TIME_BUCKETS):
            if upper is None or a.time_ms < upper:
                histogram[i]["count"] += 1
                break

    def window(back_from: int, back_to: int) -> list:
        lo, hi = today - timedelta(days=back_from), today - timedelta(days=back_to)
        return [a for a in attempts if lo <= a.created_at.date() <= hi]

    this_week, last_week = window(6, 0), window(13, 7)
    deltas = {
        "attempts": {"now": len(this_week), "before": len(last_week)},
        "solved": {"now": sum(1 for a in this_week if a.solved), "before": sum(1 for a in last_week if a.solved)},
        "accuracy": {"now": _accuracy(this_week), "before": _accuracy(last_week)},
    }

    boxes = dict(db.execute(
        select(ReviewCard.box, func.count()).where(ReviewCard.user_id == user.id).group_by(ReviewCard.box)
    ).all())
    due = db.scalar(select(func.count()).select_from(ReviewCard)
                    .where(ReviewCard.user_id == user.id, ReviewCard.due_at <= now))
    next_due = db.scalar(select(func.min(ReviewCard.due_at))
                         .where(ReviewCard.user_id == user.id, ReviewCard.due_at > now))

    fails: dict[int, int] = {}
    for a in attempts:
        if not a.solved:
            fails[a.puzzle_id] = fails.get(a.puzzle_id, 0) + 1
    hardest_ids = [pid for pid, _ in sorted(fails.items(), key=lambda kv: (-kv[1], kv[0]))[:6]]
    fens = dict(db.execute(select(Puzzle.id, Puzzle.fen).where(Puzzle.id.in_(hardest_ids))).all()) if hardest_ids else {}

    # per theme: how the user does on puzzles that carry it (weakest first once there is enough data)
    themes_of = {p.id: p.themes for p in puzzles}
    by_theme: dict[str, list] = {}
    for a in attempts:
        for t in themes_of.get(a.puzzle_id, []):
            by_theme.setdefault(t, []).append(a)
    theme_rows = []
    for key, (name, _) in THEMES.items():
        rows = by_theme.get(key, [])
        theme_rows.append({"key": key, "name": name, "attempts": len(rows), "accuracy": _accuracy(rows),
                           "puzzles": sum(1 for ths in themes_of.values() if key in ths)})
    theme_rows.sort(key=lambda r: (r["attempts"] < MIN_THEME_ATTEMPTS, r["accuracy"] if r["accuracy"] is not None else 101, -r["attempts"]))

    summary = progress.compute(db, user.id)
    return {
        "range": span,
        "rank": summary["rank"],
        "solved": summary["solved"],
        "attempted": summary["attempted"],
        "total": summary["total"],
        "accuracy": summary["accuracy"],
        "streak_days": summary["streak_days"],
        "best_streak": summary["best_streak"],
        "records": summary["records"],
        "levels": levels,
        "total_attempts": len(attempts),
        "review_due": due,
        "review_total": sum(boxes.values()),
        "review_boxes": [{"box": b, "count": boxes.get(b, 0)} for b in range(1, 7)],
        "next_due": next_due.isoformat() + "Z" if next_due else None,
        "activity": activity,
        "heatmap": heatmap,
        "weekly_accuracy": weekly,
        "time_histogram": histogram,
        "deltas": deltas,
        "spark": spark,
        "hardest": [{"id": pid, "fails": fails[pid], "fen": fens.get(pid)} for pid in hardest_ids],
        "themes": theme_rows,
        "min_theme_attempts": MIN_THEME_ATTEMPTS,
    }
