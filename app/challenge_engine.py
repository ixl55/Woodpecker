"""Rules for friend challenges. Framework-free so the rules can be tested directly.

Set challenge (async): N puzzles, a deadline, one pass each; score = solved, tie-break = total time.
Live duel: a timed race over the same rising sequence; a wrong move costs a life and skips the
puzzle; the first player to lose 3 lives loses; at time-out more solved wins, then fewer mistakes.
The server validates every move, so solutions never reach the client before a challenge ends.
"""
import math
import random
from datetime import datetime, timedelta

import chess
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Challenge, ChallengePlayer, ChallengeResult, Puzzle, User, utcnow

LIVES = 3
LIVE_POOL = 80
COUNTDOWN_S = 3
GRACE_S = 30
LIVE_INVITE_MINUTES = 10
LEVELS = ("easy", "intermediate", "advanced")


class ChallengeError(Exception):
    """A rule violation the API reports as 400/409."""


# ---------------------------------------------------------------- puzzles and moves
def pick_puzzles(db: Session, mode: str, level: str, count: int | None, seed: int) -> list[int]:
    rng = random.Random(seed)
    # races use book 1's forced tactics; book 2's positional key moves need calm thinking, not a clock
    by_level = {lvl: [pid for (pid,) in db.execute(select(Puzzle.id).where(
        Puzzle.difficulty == lvl, Puzzle.book == 1).order_by(Puzzle.id))]
                for lvl in LEVELS}
    if mode == "live":
        if level != "mixed":
            ids = by_level[level][:]
            rng.shuffle(ids)
            return ids[:LIVE_POOL]
        # a rising ladder, like a puzzle storm: easy first, then intermediate, then advanced
        plan = [("easy", 15), ("intermediate", 35), ("advanced", LIVE_POOL - 50)]
        return [pid for lvl, k in plan for pid in rng.sample(by_level[lvl], k)]
    n = count or 10
    if level != "mixed":
        return rng.sample(by_level[level], min(n, len(by_level[level])))
    per = [n // 3 + (1 if i < n % 3 else 0) for i in range(3)]
    return [pid for lvl, k in zip(LEVELS, per) for pid in sorted(rng.sample(by_level[lvl], k))]


def board_at(fen: str, moves: list[str], ply: int) -> chess.Board:
    board = chess.Board(fen)
    for uci in moves[:ply]:
        board.push(chess.Move.from_uci(uci))
    return board


def check_move(fen: str, moves: list[str], ply: int, uci: str) -> dict:
    """Judge the solver's move at `ply`. Any other move that mates is accepted too."""
    board = board_at(fen, moves, ply)
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return {"result": "wrong", "expected": moves[ply]}
    if move not in board.legal_moves:
        return {"result": "wrong", "expected": moves[ply]}
    san = board.san(move)
    board.push(move)
    if uci != moves[ply] and not board.is_checkmate():
        return {"result": "wrong", "expected": moves[ply], "san": san}
    if board.is_checkmate() or ply + 1 >= len(moves):
        return {"result": "solved", "san": san}
    reply = moves[ply + 1]
    reply_san = board.san(chess.Move.from_uci(reply))
    return {"result": "correct", "san": san, "reply": reply, "reply_san": reply_san, "next_ply": ply + 2}


# ---------------------------------------------------------------- state changes
def players_of(db: Session, ch: Challenge) -> list[ChallengePlayer]:
    return list(db.scalars(select(ChallengePlayer).where(ChallengePlayer.challenge_id == ch.id)
                           .order_by(ChallengePlayer.id)))


def player_for(db: Session, ch: Challenge, user_id: int) -> ChallengePlayer:
    p = db.scalars(select(ChallengePlayer).where(ChallengePlayer.challenge_id == ch.id,
                                                 ChallengePlayer.user_id == user_id)).first()
    if p is None:
        raise ChallengeError("You are not part of this challenge.")
    return p


def finalize(ch: Challenge, winner_id: int | None, reason: str, now: datetime) -> None:
    if ch.status == "finished":
        return
    ch.status = "finished"
    ch.winner_id = winner_id
    ch.result_reason = reason
    ch.finished_at = now


def decide(ch: Challenge, players: list[ChallengePlayer]) -> tuple[int | None, str]:
    """Winner and reason once a challenge is over (both finished, time-out or deadline)."""
    a, b = players
    if ch.mode == "live":
        out = [p for p in players if p.status == "out"]
        if len(out) == 1:
            return (b if out[0] is a else a).user_id, "mistakes"
        key = lambda p: (p.solved, -p.mistakes)  # noqa: E731
        if key(a) == key(b):
            return None, "draw"
        return max(players, key=key).user_id, "time"
    started = [p for p in players if p.started_at is not None]
    if len(started) == 1:
        return started[0].user_id, "deadline"
    key = lambda p: (p.solved, -p.time_ms)  # noqa: E731
    if key(a) == key(b):
        return None, "draw"
    return max(players, key=key).user_id, "score"


def refresh(db: Session, ch: Challenge, now: datetime | None = None) -> bool:
    """Apply time-based transitions (expired invites, live time-out, async deadline). Returns True if changed."""
    now = now or utcnow()
    if ch.status in ("pending", "lobby") and ch.invite_expires_at and now >= ch.invite_expires_at:
        ch.status = "expired"
        ch.finished_at = now
        return True
    if ch.status == "active" and ch.mode == "live" and ch.ends_at and now >= ch.ends_at:
        players = players_of(db, ch)
        for p in players:
            if p.status == "playing":
                p.status, p.finished_at = "done", ch.ends_at
        winner, reason = decide(ch, players)
        finalize(ch, winner, reason, ch.ends_at)
        return True
    if ch.status == "active" and ch.mode == "async" and ch.deadline_at and now >= ch.deadline_at:
        players = players_of(db, ch)
        if not any(p.started_at for p in players):
            ch.status, ch.finished_at = "expired", now
            return True
        for p in players:
            if p.status in ("waiting", "playing"):
                p.status, p.finished_at = "done", now
        winner, reason = decide(ch, players)
        finalize(ch, winner, reason, now)
        return True
    return False


def start_live(ch: Challenge, players: list[ChallengePlayer], now: datetime) -> None:
    ch.status = "active"
    ch.started_at = now + timedelta(seconds=COUNTDOWN_S)
    ch.ends_at = ch.started_at + timedelta(minutes=ch.minutes)
    for p in players:
        p.status, p.started_at, p.puzzle_started_at = "playing", ch.started_at, ch.started_at


def start_async(p: ChallengePlayer, now: datetime) -> None:
    if p.status == "waiting":
        p.status, p.started_at, p.puzzle_started_at = "playing", now, now


def _advance(db: Session, ch: Challenge, p: ChallengePlayer, puzzle_id: int, solved: bool, now: datetime) -> None:
    spent = int(max(0, (now - (p.puzzle_started_at or now)).total_seconds() * 1000))
    p.time_ms += spent
    db.add(ChallengeResult(challenge_id=ch.id, user_id=p.user_id, index=p.index, puzzle_id=puzzle_id,
                           solved=solved, time_ms=spent))
    if solved:
        p.solved += 1
    else:
        p.mistakes += 1
    p.index += 1
    p.ply = 0
    p.puzzle_started_at = now
    if ch.mode == "live" and p.mistakes >= LIVES:
        p.status, p.finished_at = "out", now
    elif p.index >= len(ch.puzzle_ids):
        p.status, p.finished_at = "done", now


def play_move(db: Session, ch: Challenge, p: ChallengePlayer, uci: str, now: datetime | None = None) -> dict:
    now = now or utcnow()
    refresh(db, ch, now)
    if ch.status != "active":
        raise ChallengeError("This challenge is not in play.")
    if ch.mode == "live" and ch.started_at and now < ch.started_at:
        raise ChallengeError("The duel has not started yet.")
    if p.status != "playing":
        raise ChallengeError("You have no puzzle to play right now.")
    puzzle = db.get(Puzzle, ch.puzzle_ids[p.index])
    verdict = check_move(puzzle.fen, puzzle.moves, p.ply, uci)
    if verdict["result"] == "correct":
        p.ply = verdict.pop("next_ply")
    else:
        _advance(db, ch, p, puzzle.id, verdict["result"] == "solved", now)
    # the challenge may end on this move
    players = players_of(db, ch)
    over = (ch.mode == "live" and any(x.status == "out" for x in players)) or all(x.status in ("done", "out") for x in players)
    if over:
        winner, reason = decide(ch, players)
        finalize(ch, winner, reason, now)
    return verdict


# ---------------------------------------------------------------- views
def public_user(u: User, profile) -> dict:
    return {"id": u.id, "username": u.username,
            "display_name": (profile.display_name if profile and profile.display_name else u.username),
            "avatar": {"piece": profile.avatar_piece, "color": profile.avatar_color, "bg": profile.avatar_bg,
                       "pattern": profile.avatar_pattern, "frame": profile.frame,
                       "set": profile.piece_set or "classic"} if profile else
                      {"piece": "n", "color": "w", "bg": "ink", "pattern": "plain", "frame": "none", "set": "classic"}}


def current_puzzle(db: Session, ch: Challenge, p: ChallengePlayer) -> dict | None:
    """What the player needs to play the next move: position only, never the solution."""
    if p.status != "playing" or p.index >= len(ch.puzzle_ids):
        return None
    puzzle = db.get(Puzzle, ch.puzzle_ids[p.index])
    board = board_at(puzzle.fen, puzzle.moves, p.ply)
    return {
        "index": p.index,
        "puzzle_id": puzzle.id,
        "difficulty": puzzle.difficulty,
        "fen": board.fen(),
        "start_fen": puzzle.fen,
        "played": puzzle.moves[:p.ply],  # moves already made in this puzzle (for the scoresheet)
        "last_move": puzzle.moves[p.ply - 1] if p.ply else None,
        "steps_total": math.ceil(len(puzzle.moves) / 2),
        "steps_done": p.ply // 2,
    }


def state(db: Session, ch: Challenge, users: dict[int, dict], now: datetime | None = None) -> dict:
    now = now or utcnow()
    players = players_of(db, ch)
    out = {
        "id": ch.id, "mode": ch.mode, "status": ch.status, "level": ch.level,
        "count": ch.count if ch.mode == "async" else None, "minutes": ch.minutes,
        "total": len(ch.puzzle_ids) if ch.mode == "async" else None,
        "creator_id": ch.creator_id, "opponent_id": ch.opponent_id,
        "deadline_at": _iso(ch.deadline_at), "invite_expires_at": _iso(ch.invite_expires_at),
        "started_at": _iso(ch.started_at), "ends_at": _iso(ch.ends_at), "server_now": _iso(now),
        "winner_id": ch.winner_id, "result_reason": ch.result_reason,
        "created_at": _iso(ch.created_at), "finished_at": _iso(ch.finished_at),
        "players": [{**users[p.user_id], "ready": p.ready, "status": p.status, "index": p.index,
                     "solved": p.solved, "mistakes": p.mistakes, "time_ms": p.time_ms,
                     "lives_left": max(0, LIVES - p.mistakes) if ch.mode == "live" else None} for p in players],
    }
    if ch.status == "finished":
        rows = db.scalars(select(ChallengeResult).where(ChallengeResult.challenge_id == ch.id)
                          .order_by(ChallengeResult.index)).all()
        ids = sorted({r.puzzle_id for r in rows})
        meta = {pz.id: pz for pz in db.scalars(select(Puzzle).where(Puzzle.id.in_(ids)))} if ids else {}
        out["results"] = [{"user_id": r.user_id, "index": r.index, "puzzle_id": r.puzzle_id,
                           "solved": r.solved, "time_ms": r.time_ms} for r in rows]
        out["puzzles"] = {pid: {"fen": m.fen, "san": m.san, "white": m.white, "black": m.black, "year": m.year}
                          for pid, m in meta.items()}
    return out


def _iso(d: datetime | None) -> str | None:
    return d.isoformat(timespec="milliseconds") + "Z" if d else None
