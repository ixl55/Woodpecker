"""Derived progress for a user: rank, streaks, records and achievements.

Everything is computed from the attempts table, so nothing here can drift out of sync.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from . import catalog
from .models import Attempt, Challenge, ChallengePlayer, Friendship, utcnow

# (solved puzzles needed, title)
RANKS = [
    (0, "Novice"),
    (25, "Amateur"),
    (100, "Club Player"),
    (300, "Advanced"),
    (600, "Expert"),
    (900, "Master"),
    (1400, "International Master"),
    (2000, "Grandmaster"),  # both books: 1,127 tactics + 1,000 positional exercises
]
GOLD_FRAME_SOLVED = 100
FAST_MS = 10_000
LIGHTNING_MS = 5_000
LONG_LINE = 5  # solver moves that make a puzzle a "deep" one

# What each achievement unlocks in the profile editor: achievement key -> (kind, item).
# kind is one of bg | pattern | frame | pieces; anything not listed here is free for everyone.
REWARDS: dict[str, tuple[str, str]] = {
    "first": ("bg", "meadow"),
    "warm_up": ("pattern", "zigzag"),
    "ten": ("bg", "ocean"),
    "hat_trick": ("frame", "bronze"),
    "hot_hand": ("bg", "sunset"),
    "lightning": ("pattern", "sunburst"),
    "bounce_back": ("pattern", "scales"),
    "good_company": ("pattern", "argyle"),
    "game_on": ("pieces", "bauhaus"),
    "first_win": ("frame", "laurel"),
    "fifty": ("frame", "silver"),
    "week": ("frame", "ember"),
    "mate_hunter": ("bg", "aurora"),
    "deep": ("pattern", "stars"),
    "sharp_eye": ("pattern", "knights"),
    "clean": ("frame", "frost"),
    "fast": ("pieces", "ice"),
    "comeback": ("pieces", "jade"),
    "five_wins": ("frame", "aurora"),
    "duelist": ("pieces", "neon"),
    "untouchable": ("pieces", "ruby"),
    "clean_sheet": ("pieces", "gilded"),
    "hundred": ("frame", "gold"),
    "easy_done": ("bg", "nebula"),
    "five_hundred": ("frame", "royal"),
    "mid_done": ("bg", "volcano"),
    "adv_done": ("frame", "prism"),
    "month": ("pieces", "marble"),
}
LOCKED: dict[tuple[str, str], str] = {reward: key for key, reward in REWARDS.items()}


@dataclass
class Achievement:
    key: str
    title: str
    detail: str
    icon: str
    goal: int
    value: int
    tier: str = "bronze"  # bronze (quick wins) | silver | gold (the long haul)

    @property
    def earned(self) -> bool:
        return self.value >= self.goal

    def as_dict(self) -> dict:
        reward = REWARDS.get(self.key)
        return {"key": self.key, "title": self.title, "detail": self.detail, "icon": self.icon, "tier": self.tier,
                "goal": self.goal, "value": min(self.value, self.goal), "earned": self.earned,
                "reward": {"kind": reward[0], "item": reward[1]} if reward else None}


def longest_streak(days: set[date]) -> int:
    best = run = 0
    prev = None
    for d in sorted(days):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    return best


def current_streak(days: set[date], today: date) -> int:
    day = today if today in days else today - timedelta(days=1)
    streak = 0
    while day in days:
        streak += 1
        day -= timedelta(days=1)
    return streak


def rank_for(solved: int) -> dict:
    current, nxt = RANKS[0], None
    for i, r in enumerate(RANKS):
        if solved >= r[0]:
            current = r
            nxt = RANKS[i + 1] if i + 1 < len(RANKS) else None
    return {
        "title": current[1],
        "level": RANKS.index(current) + 1,
        "floor": current[0],
        "next_title": nxt[1] if nxt else None,
        "next_at": nxt[0] if nxt else None,
    }


def compute(db: Session, user_id: int) -> dict:
    # per puzzle: level, ends in mate, number of solver moves
    meta = {p.id: (p.difficulty, p.mates, p.solver_moves) for p in catalog.entries(db)}
    difficulty_of = {pid: m[0] for pid, m in meta.items()}
    level_totals: dict[str, int] = {}
    for d in difficulty_of.values():
        level_totals[d] = level_totals.get(d, 0) + 1

    attempts = db.execute(
        select(Attempt.puzzle_id, Attempt.solved, Attempt.time_ms, Attempt.created_at)
        .where(Attempt.user_id == user_id).order_by(Attempt.id)
    ).all()

    last: dict[int, bool] = {}
    failed_before: set[int] = set()
    comebacks = fast = lightning = clean_run = best_clean_run = 0
    fastest = None
    for a in attempts:
        if a.solved:
            if a.puzzle_id in failed_before:
                comebacks += 1
            if a.time_ms:
                if a.time_ms <= FAST_MS:
                    fast += 1
                if a.time_ms <= LIGHTNING_MS:
                    lightning += 1
                if fastest is None or a.time_ms < fastest["time_ms"]:
                    fastest = {"puzzle_id": a.puzzle_id, "time_ms": a.time_ms}
            clean_run += 1
            best_clean_run = max(best_clean_run, clean_run)
        else:
            failed_before.add(a.puzzle_id)
            clean_run = 0
        last[a.puzzle_id] = a.solved

    solved = sum(1 for ok in last.values() if ok)
    solved_ids = [pid for pid, ok in last.items() if ok and pid in meta]
    mates = sum(1 for pid in solved_ids if meta[pid][1])
    deep = sum(1 for pid in solved_ids if meta[pid][2] >= LONG_LINE)
    advanced_solved = sum(1 for pid in solved_ids if meta[pid][0] == "advanced")
    attempted_by_level: dict[str, int] = {}
    for pid in last:
        lvl = difficulty_of.get(pid)
        attempted_by_level[lvl] = attempted_by_level.get(lvl, 0) + 1

    per_day: dict[date, int] = {}
    for a in attempts:
        per_day[a.created_at.date()] = per_day.get(a.created_at.date(), 0) + 1
    days = set(per_day)
    best_day = max(per_day.items(), key=lambda kv: (kv[1], kv[0])) if per_day else None
    total = len(difficulty_of)
    streak_best = longest_streak(days)

    finished = db.execute(select(Challenge.mode, Challenge.winner_id).where(
        or_(Challenge.creator_id == user_id, Challenge.opponent_id == user_id), Challenge.status == "finished")).all()
    wins = sum(1 for c in finished if c.winner_id == user_id)
    duels = sum(1 for c in finished if c.mode == "live")
    my_wins = db.execute(
        select(Challenge.mode, Challenge.puzzle_ids, ChallengePlayer.solved, ChallengePlayer.mistakes)
        .join(ChallengePlayer, and_(ChallengePlayer.challenge_id == Challenge.id, ChallengePlayer.user_id == user_id))
        .where(Challenge.status == "finished", Challenge.winner_id == user_id)).all()
    flawless_duels = sum(1 for w in my_wins if w.mode == "live" and w.mistakes == 0)
    perfect_sets = sum(1 for w in my_wins
                       if w.mode == "async" and len(w.puzzle_ids) >= 10 and w.solved == len(w.puzzle_ids))
    friends = db.scalar(select(func.count()).select_from(Friendship).where(
        Friendship.status == "accepted",
        or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id))) or 0

    def tried(level: str) -> int:
        return attempted_by_level.get(level, 0)

    achievements = [
        # solving
        Achievement("first", "First Step", "Solve your first puzzle", "flag", 1, solved),
        Achievement("warm_up", "Warm-Up", "Solve 5 puzzles", "sun", 5, solved),
        Achievement("ten", "Ten Down", "Solve 10 puzzles", "target", 10, solved),
        Achievement("fifty", "Fifty Strong", "Solve 50 puzzles", "layers", 50, solved, "silver"),
        Achievement("hundred", "Centurion", "Solve 100 puzzles", "crown", GOLD_FRAME_SOLVED, solved, "gold"),
        Achievement("five_hundred", "Five Hundred", "Solve 500 puzzles", "medal", 500, solved, "gold"),
        # habits
        Achievement("hat_trick", "Hat Trick", "Train 3 days in a row", "spark", 3, streak_best),
        Achievement("busy_day", "Marathon Day", "Make 30 attempts in one day", "clock", 30,
                    best_day[1] if best_day else 0, "silver"),
        Achievement("week", "Seven-Day Streak", "Train 7 days in a row", "calendar", 7, streak_best, "silver"),
        Achievement("month", "Thirty-Day Streak", "Train 30 days in a row", "mountain", 30, streak_best, "gold"),
        # skill
        Achievement("hot_hand", "Hot Hand", "Solve 5 puzzles in a row without a mistake", "flame", 5, best_clean_run),
        Achievement("lightning", "Lightning", "Solve a puzzle in under 5 seconds", "hourglass", 1, lightning),
        Achievement("bounce_back", "Bounce Back", "Solve 3 puzzles you once got wrong", "retry", 3, comebacks),
        Achievement("mate_hunter", "Mate Hunter", "Solve 25 puzzles that end in checkmate", "crosshair", 25, mates, "silver"),
        Achievement("deep", "Deep Calculation", f"Solve 10 puzzles with a line of {LONG_LINE}+ moves", "compass", 10,
                    deep, "silver"),
        Achievement("sharp_eye", "Sharp Eye", "Solve 25 advanced puzzles", "eye", 25, advanced_solved, "silver"),
        Achievement("clean", "Flawless Run", "Solve 20 puzzles in a row without a mistake", "shield", 20,
                    best_clean_run, "silver"),
        Achievement("fast", "Quick Sight", "Solve 10 puzzles in under 10 seconds each", "bolt", 10, fast, "silver"),
        Achievement("comeback", "Never Give Up", "Solve 10 puzzles you once got wrong", "repeat", 10, comebacks, "silver"),
        # the books
        Achievement("easy_done", "Easy Cleared", "Try every easy puzzle in both books", "pawn",
                    level_totals.get("easy", 0), tried("easy"), "silver"),
        Achievement("mid_done", "Intermediate Cleared", "Try every intermediate puzzle in both books", "knight",
                    level_totals.get("intermediate", 0), tried("intermediate"), "gold"),
        Achievement("adv_done", "Advanced Cleared", "Try every advanced puzzle in both books", "king",
                    level_totals.get("advanced", 0), tried("advanced"), "gold"),
        Achievement("book", "Cover to Cover", "Try every puzzle in both books", "book", total, len(last), "gold"),
        # friends
        Achievement("good_company", "Good Company", "Add your first friend", "users", 1, friends),
        Achievement("game_on", "Game On", "Finish your first challenge", "dice", 1, len(finished)),
        Achievement("first_win", "First Win", "Win a challenge against a friend", "trophy", 1, wins),
        Achievement("five_wins", "Rival", "Win 5 challenges against friends", "star", 5, wins, "silver"),
        Achievement("duelist", "Duelist", "Finish 10 live duels", "swords", 10, duels, "silver"),
        Achievement("clean_sheet", "Clean Sheet", "Win a set challenge of 10+ puzzles without a miss", "laurel", 1,
                    perfect_sets, "gold"),
        Achievement("untouchable", "Untouchable", "Win a live duel without a single mistake", "gem", 1,
                    flawless_duels, "gold"),
    ]

    return {
        "solved": solved,
        "attempted": len(last),
        "total": total,
        "attempts": len(attempts),
        "accuracy": round(100 * sum(1 for a in attempts if a.solved) / len(attempts)) if attempts else None,
        "streak_days": current_streak(days, utcnow().date()),
        "best_streak": streak_best,
        "rank": rank_for(solved),
        "achievements": [a.as_dict() for a in achievements],
        "unlocked": sorted(f"{REWARDS[a.key][0]}:{REWARDS[a.key][1]}" for a in achievements
                           if a.earned and a.key in REWARDS),
        "challenges": {"finished": len(finished), "wins": wins, "duels": duels},
        "records": {
            "fastest": fastest,
            "best_clean_run": best_clean_run,
            "best_day": {"date": best_day[0].isoformat(), "attempts": best_day[1]} if best_day else None,
            "best_streak": streak_best,
        },
    }
