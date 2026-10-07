from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    """Naive UTC: SQLite drops tz info, so keep every stored timestamp naive."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # bumped on password change; sessions signed with an older value stop working
    session_version: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)


class Puzzle(Base):
    __tablename__ = "puzzles"

    # book 1: the exercise number (1..1128); book 2: 2000 + the exercise number
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    book: Mapped[int] = mapped_column(Integer, default=1, index=True)
    number: Mapped[int | None] = mapped_column(Integer, nullable=True)  # the exercise number inside its book
    difficulty: Mapped[str] = mapped_column(String(16), index=True)
    fen: Mapped[str] = mapped_column(String(100))
    moves: Mapped[list] = mapped_column(JSON)  # UCI main line, starting and ending with the solver's move
    san: Mapped[list] = mapped_column(JSON)
    white: Mapped[str] = mapped_column(String(120))
    black: Mapped[str] = mapped_column(String(120))
    event: Mapped[str] = mapped_column(String(160))
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # book 2 (positional): the answer is the key move alone; `line` is the book's continuation (SAN) to show after
    line: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # tactical themes as ",fork,pin," so a plain LIKE '%,fork,%' filters on SQLite and Postgres alike
    themes: Mapped[str] = mapped_column(String(300), default="")

    @property
    def theme_list(self) -> list[str]:
        return [t for t in (self.themes or "").split(",") if t]


class Attempt(Base):
    __tablename__ = "attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"), index=True)
    solved: Mapped[bool] = mapped_column(Boolean)
    mistakes: Mapped[int] = mapped_column(Integer, default=0)
    time_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, index=True)


class ReviewCard(Base):
    """Leitner box for a puzzle the user has failed at least once."""
    __tablename__ = "review_cards"
    __table_args__ = (UniqueConstraint("user_id", "puzzle_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"))
    box: Mapped[int] = mapped_column(Integer, default=1)
    due_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, index=True)


class Profile(Base):
    """Cosmetic account settings. The avatar is a chess piece on a coloured tile; no uploads."""
    __tablename__ = "profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(40), default="")
    bio: Mapped[str] = mapped_column(String(160), default="")
    avatar_piece: Mapped[str] = mapped_column(String(1), default="n")
    avatar_color: Mapped[str] = mapped_column(String(1), default="w")
    avatar_bg: Mapped[str] = mapped_column(String(16), default="ink")
    avatar_pattern: Mapped[str] = mapped_column(String(16), default="plain")
    frame: Mapped[str] = mapped_column(String(16), default="none")
    piece_set: Mapped[str] = mapped_column(String(16), default="classic")
    board_theme: Mapped[str] = mapped_column(String(16), default="slate")
    # appearance: named light/dark shades and an accent colour
    theme_mode: Mapped[str] = mapped_column(String(8), default="system")
    light_palette: Mapped[str] = mapped_column(String(16), default="porcelain")
    dark_palette: Mapped[str] = mapped_column(String(16), default="midnight")
    accent: Mapped[str] = mapped_column(String(16), default="cobalt")
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, onupdate=utcnow)


class Friendship(Base):
    """A friend request; accepted requests are friendships. One row per pair, whoever asked first."""
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    addressee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | accepted
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class Challenge(Base):
    """A 1-vs-1 challenge: 'async' (set of puzzles + deadline) or 'live' (timed duel, 3 lives)."""
    __tablename__ = "challenges"

    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(8))  # async | live
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opponent_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # pending | declined | cancelled | expired | lobby | active | finished
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    level: Mapped[str] = mapped_column(String(16), default="mixed")
    puzzle_ids: Mapped[list] = mapped_column(JSON, default=list)
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    winner_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_reason: Mapped[str | None] = mapped_column(String(12), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class ChallengePlayer(Base):
    """One participant's run through a challenge's puzzle list."""
    __tablename__ = "challenge_players"
    __table_args__ = (UniqueConstraint("challenge_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    challenge_id: Mapped[int] = mapped_column(ForeignKey("challenges.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ready: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(8), default="waiting")  # waiting | playing | done | out
    index: Mapped[int] = mapped_column(Integer, default=0)
    ply: Mapped[int] = mapped_column(Integer, default=0)
    solved: Mapped[int] = mapped_column(Integer, default=0)
    mistakes: Mapped[int] = mapped_column(Integer, default=0)
    time_ms: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    puzzle_started_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class SprintRun(Base):
    """A solo race against the clock: as many puzzles as possible in 3 or 5 minutes, 3 lives."""
    __tablename__ = "sprint_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    minutes: Mapped[int] = mapped_column(Integer)
    puzzle_ids: Mapped[list] = mapped_column(JSON, default=list)
    index: Mapped[int] = mapped_column(Integer, default=0)
    ply: Mapped[int] = mapped_column(Integer, default=0)
    solved: Mapped[int] = mapped_column(Integer, default=0)
    mistakes: Mapped[int] = mapped_column(Integer, default=0)
    results: Mapped[list] = mapped_column(JSON, default=list)  # [{"puzzle_id", "solved"}] in play order
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | finished
    reason: Mapped[str | None] = mapped_column(String(10), nullable=True)  # time | lives | done | ended
    started_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    ends_at: Mapped[datetime] = mapped_column(DateTime())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class ChallengeResult(Base):
    """Outcome of one puzzle inside a challenge, for the side-by-side comparison."""
    __tablename__ = "challenge_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    challenge_id: Mapped[int] = mapped_column(ForeignKey("challenges.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    index: Mapped[int] = mapped_column(Integer)
    puzzle_id: Mapped[int] = mapped_column(Integer)
    solved: Mapped[bool] = mapped_column(Boolean)
    time_ms: Mapped[int] = mapped_column(Integer, default=0)
