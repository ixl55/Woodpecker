"""Explain a puzzle's solution in plain words, move by move.

Nothing here is free text about the position: every sentence states something python-chess checks on
the board (a capture, a check, the pieces a fork hits, the mate a quiet move threatens, which piece a
recapture pulls away...), using the same detectors as the themes (app/themes.py). Book 2's ideas come
from its reviewed themes (data/themes2.json) plus the same kind of board facts about the key move.

    python -m app.explain      # writes data/explanations.json for both books
"""
import json

import chess

from .themes import (POSITIONAL, THEMES, VALUE, _balance, _fork_targets, _pinned, _settled, _skewered, _threat,
                     _unveiled, _won_later)

NAMES = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook", chess.QUEEN: "queen",
         chess.KING: "king"}
COLOR = {chess.WHITE: "White", chess.BLACK: "Black"}


def _piece(board: chess.Board, square: int) -> str:
    return NAMES[board.piece_type_at(square)]


def _at(board: chess.Board, square: int) -> str:
    return f"the {_piece(board, square)} on {chess.square_name(square)}"


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _mate_threat(board: chess.Board) -> str | None:
    """With the opponent to move after a quiet move: the mate the solver threatens next, in SAN."""
    if board.is_check():
        return None
    probe = board.copy(stack=False)
    probe.push(chess.Move.null())
    for move in probe.legal_moves:
        probe.push(move)
        mate = probe.is_checkmate()
        probe.pop()
        if mate:
            return probe.san(move)
    return None


def _passed_turn(board: chess.Board) -> chess.Board:
    """`board` with the other side to move (a null move), for asking what the side to move threatened."""
    probe = board.copy(stack=False)
    probe.push(chess.Move.null())
    return probe


def _win_threat(board: chess.Board, solver: bool) -> str | None:
    """With the opponent to move: an enemy piece the solver threatens to win (two points or more)."""
    if board.is_check():
        return None
    from .themes import _capture
    probe = board.copy(stack=False)
    probe.push(chess.Move.null())
    base = _balance(probe, solver)
    best = None
    for move in probe.legal_moves:
        if probe.is_capture(move) and not probe.is_en_passant(move):
            gain = _capture(probe, move, solver) - base
            if gain >= 2 and (best is None or gain > best[0]):
                best = (gain, move.to_square)
    return _at(board, best[1]) if best else None


def _material_words(start: chess.Board, end: chess.Board, solver: bool) -> str | None:
    """'a rook for a knight', 'a queen', 'two pawns': what changed hands over the whole line."""
    def counts(board, color):
        return {t: len(board.pieces(t, color)) for t in NAMES if t != chess.KING}
    won = {t: counts(start, not solver)[t] - counts(end, not solver)[t] for t in NAMES if t != chess.KING}
    lost = {t: counts(start, solver)[t] - counts(end, solver)[t] for t in NAMES if t != chess.KING}
    # a promotion turns a lost pawn into a new piece
    for t in won:
        won[t], lost[t] = max(won[t], 0), max(lost[t], 0)

    def words(d):
        parts = []
        for t in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN):
            n = d[t]
            if n == 1:
                parts.append(f"a {NAMES[t]}")
            elif n > 1:
                parts.append(f"{['', '', 'two', 'three', 'four', 'five', 'six'][min(n, 6)]} {NAMES[t]}s")
        return _join(parts)
    got, gave = words(won), words(lost)
    if not got:
        return None
    return f"{got} for {gave}" if gave else got


def _next_win(board: chess.Board, solver: bool) -> str | None:
    """The line stops with the opponent to move and material still to collect: the enemy piece the
    solver wins against the opponent's best reply (checked over every legal reply)."""
    from .themes import _capture
    if board.turn == solver or board.is_game_over():
        return None
    worst = None
    for reply in board.legal_moves:
        b = board.copy(stack=False)
        b.push(reply)
        best = (_balance(b, solver), None)
        for cap in b.legal_moves:
            if b.is_capture(cap) and not b.is_en_passant(cap):
                score = _capture(b, cap, solver)
                if score > best[0]:
                    best = (score, cap.to_square, b.piece_type_at(cap.to_square))
        if worst is None or best[0] < worst[0]:
            worst = best
    if worst is None or worst[1] is None:
        return None
    # only name a piece that is still where it stands now: one that got away is not "the piece on X" any more
    if board.piece_type_at(worst[1]) != worst[2] or board.color_at(worst[1]) == solver:
        return None
    return f"the {NAMES[worst[2]]} on {chess.square_name(worst[1])}"


def _promoting(board: chess.Board, solver: bool) -> int | None:
    """A solver pawn one step from promoting that the opponent can't take right away."""
    rank = 6 if solver == chess.WHITE else 1
    for sq in board.pieces(chess.PAWN, solver):
        if chess.square_rank(sq) == rank and not board.is_attacked_by(not solver, sq):
            return sq
    return None


class _Line:
    """The solution line with a board before every ply (boards[i] is the position before ply i)."""

    def __init__(self, fen: str, moves: list[str]):
        self.plies = [chess.Move.from_uci(u) for u in moves]
        self.boards = [chess.Board(fen)]
        for move in self.plies:
            board = self.boards[-1].copy(stack=False)
            board.push(move)
            self.boards.append(board)
        self.solver = self.boards[0].turn

    def balance(self, i: int) -> int:
        return _balance(self.boards[i], self.solver)


def _solver_note(line: _Line, i: int) -> list[str]:
    """What the solver's move at ply i does, as short facts (first one is the main one)."""
    before, after, move = line.boards[i], line.boards[i + 1], line.plies[i]
    solver = line.solver
    mover = NAMES[before.piece_type_at(move.from_square)]
    last = i == len(line.plies) - 1
    notes = []

    if after.is_checkmate():
        checkers = after.checkers()
        if len(checkers) >= 2:
            notes.append("Checkmate with a double check: the king can't escape both pieces.")
        else:
            notes.append("Checkmate.")
        return notes

    if move.promotion:
        notes.append(f"The pawn promotes to a {NAMES[move.promotion]}.")

    # a sacrifice: the opponent takes the piece and the next move does not simply win it back
    if i + 2 < len(line.boards) and line.plies[i + 1].to_square == move.to_square \
            and line.balance(i + 2) <= line.balance(i) - 2:
        regained = i + 3 < len(line.boards) and line.balance(i + 3) > line.balance(i) - 2
        mates = i + 3 < len(line.boards) and line.boards[i + 3].is_checkmate()
        if not regained or mates:
            reply = line.plies[i + 1]
            taker = line.boards[i + 1].piece_type_at(reply.from_square)
            if taker == chess.KING:
                why = f"to drag the king to {chess.square_name(move.to_square)}"
            else:
                why = f"to pull the {NAMES[taker]} away from {chess.square_name(reply.from_square)}"
            notes.append(f"A {mover} sacrifice {why}.")

    if before.is_capture(move) and not notes:
        victim = before.piece_type_at(move.to_square) or chess.PAWN  # en passant
        notes.append(f"Takes the {NAMES[victim]} on {chess.square_name(move.to_square)}.")

    checkers = after.checkers()
    if len(checkers) >= 2:
        notes.append(f"Double check from the {_join([_piece(after, s) for s in checkers])}: only a king move helps.")
    elif checkers and move.to_square not in checkers:
        slider = next(iter(checkers))
        notes.append(f"Discovered check: the {mover} steps aside and the {_piece(after, slider)} on "
                     f"{chess.square_name(slider)} checks the king.")
    elif checkers:
        notes.append("Check.")

    forked = _fork_targets(after, move.to_square, solver)
    if forked and (_won_later(line.boards, line.plies, i, forked, move.to_square)
                   or (last and _threat(after, solver, forked, move.to_square))):
        notes.append(f"Fork: the {mover} hits {_join([_at(after, s) for s in sorted(forked)])} at the same time.")

    for sq in sorted(_pinned(after, move.to_square, solver)):
        if _won_later(line.boards, line.plies, i, {sq}) or (last and _threat(after, solver, {sq})):
            king = after.king(not solver)
            if sq in after.attacks(move.to_square) and move.to_square in after.pin(not solver, sq):
                notes.append(f"Pin: {_at(after, sq)} can't move, or the king on {chess.square_name(king)} would be "
                             f"in check.")
            else:
                notes.append(f"{_at(after, sq).capitalize()} is pinned to its king and now attacked again.")
            break

    behind, fronts = _skewered(after, move.to_square, solver)
    if behind and (_won_later(line.boards, line.plies, i, behind, move.to_square, at_once=True)
                   or (last and _threat(after, solver, behind | fronts, move.to_square))):
        sq = min(behind)
        front = next(s for s in after.attacks(move.to_square) if after.piece_type_at(s) in (chess.KING, chess.QUEEN)
                     and after.color_at(s) != solver and sq in chess.SquareSet(chess.ray(move.to_square, s)))
        notes.append(f"Skewer: the {_piece(after, front)} has to step aside, and {_at(after, sq)} behind it falls.")

    for slider, target in _unveiled(before, after, move, solver):
        if after.piece_type_at(target) == chess.KING:
            continue  # said above as a discovered check
        if _won_later(line.boards, line.plies, i, {target}, slider) \
                or (last and _threat(after, solver, {target}, slider)):
            notes.append(f"Discovered attack: moving the {mover} opens the {_piece(after, slider)}'s line to "
                         f"{_at(after, target)}.")
            break

    if not before.is_capture(move) and not move.promotion and not checkers and not before.is_check():
        mate = _mate_threat(after)
        if mate and _mate_threat(_passed_turn(before)) == mate:
            mate = None  # the mate was already there before this move
        if mate:
            notes.append(f"A quiet move that threatens mate with {mate}.")
        else:
            prize = _win_threat(after, solver)
            # only a threat this move creates: the same win must not have been there before it
            earlier = before.copy(stack=False)
            earlier.push(chess.Move.null())
            if prize and prize != _win_threat(earlier, solver)                     and not any(n.startswith(("Fork", "Pin", "Skewer", "Discovered")) for n in notes):
                notes.append(f"Threatens to win {prize}.")
    if not notes and not before.is_check():
        hit = [s for s in after.attacks(move.to_square) if after.color_at(s) == (not solver)
               and after.piece_type_at(s) != chess.KING and s not in before.attacks(move.from_square)]
        if hit:
            notes.append(f"Attacks {_join([_at(after, s) for s in sorted(hit, key=lambda s: -VALUE[after.piece_type_at(s)])[:2]])}.")
    return notes


def _reply_note(line: _Line, j: int) -> str:
    """A factual word about the opponent's reply at ply j (empty when there is nothing certain to say)."""
    before, move = line.boards[j], line.plies[j]
    options = before.legal_moves.count()
    if options == 1:
        return "The only legal move."
    after = line.boards[j + 1]
    check = ", with check" if after.is_check() else ""
    if before.is_capture(move):
        victim = before.piece_type_at(move.to_square) or chess.PAWN
        taker = NAMES[before.piece_type_at(move.from_square)]
        return f"The {taker} takes the {NAMES[victim]}{check}."
    if before.is_check():
        return "Gets out of check."
    if check:
        return "Checks."
    return ""


def explain_line(fen: str, moves: list[str], solver_plies: int | None = None) -> dict:
    """Steps and a result for a solution line. `solver_plies`: how many plies are the puzzle's answer
    (the rest, in book 2, is the book's continuation)."""
    line = _Line(fen, moves)
    steps = []
    for i, move in enumerate(line.plies):
        san = line.boards[i].san(move)
        if i % 2 == 0:
            steps.append({"san": san, "side": "solver", "notes": _solver_note(line, i)})
        else:
            note = _reply_note(line, i)
            steps.append({"san": san, "side": "reply", "notes": [note] if note else []})
    end = line.boards[-1]
    start_balance = line.balance(0)
    if end.is_checkmate():
        result = f"{COLOR[line.solver]} gives checkmate."
    else:
        now = line.balance(len(line.plies)) - start_balance
        gain = max(now, _settled(end, line.solver) - start_balance)
        swap = _material_words(line.boards[0], end, line.solver)
        prize = _next_win(end, line.solver) if gain > now else None
        if now >= 2 and swap:
            result = f"{COLOR[line.solver]} comes out ahead in material: {swap}."
        elif gain >= 2 and prize:
            result = (f"Even against {COLOR[not line.solver]}'s best reply, {COLOR[line.solver]} then takes {prize} "
                      f"and comes out ahead in material.")
        elif gain >= 2:
            result = f"Whatever {COLOR[not line.solver]} plays, {COLOR[line.solver]} wins material on the next move."
        elif _promoting(end, line.solver):
            result = f"{COLOR[line.solver]}'s pawn on {chess.square_name(_promoting(end, line.solver))} is about to promote."
        elif gain == 1 and now < 1 and prize:
            result = f"{COLOR[line.solver]} then takes {prize} and comes out a pawn up."
        elif now == 1:
            result = f"{COLOR[line.solver]} comes out a pawn up."
        else:
            result = ""
    return {"steps": steps, "result": result, "answer_plies": solver_plies or len(moves)}


def _summary(steps: list[dict], result: str) -> str:
    """The idea in one sentence: the solver's main facts in order, then the result."""
    parts = []
    for step in steps:
        if step["side"] != "solver" or not step["notes"]:
            continue
        # the move's most telling fact: the tactic before a plain capture or check
        ranked = sorted(step["notes"], key=lambda n: next(
            (i for i, lead in enumerate(("Checkmate", "A ", "Double", "Discovered", "Fork", "Pin", "Skewer",
                                         "The pawn promotes", "Threatens", "Takes", "Attacks", "Check"))
             if n.startswith(lead)), 99))
        note = ranked[0].rstrip(".")
        if note in ("Check", "Checkmate"):
            note = f"{step['san']} {'mates' if note == 'Checkmate' else 'checks'}"
        else:
            note = f"{step['san']}: {note[0].lower()}{note[1:]}"
        parts.append(note)
    return "; ".join(parts[:4]) + ("." if parts else "")


# ---------------------------------------------------------------- book 2: positional ideas
def _pawn_attacks_pawns(board: chess.Board, square: int) -> list[int]:
    color = board.color_at(square)
    return [s for s in board.attacks(square) if board.piece_type_at(s) == chess.PAWN and board.color_at(s) != color]


def _safe_from_pawns(board: chess.Board, square: int, color: bool) -> bool:
    """No enemy pawn can ever attack `square` (none left on the neighbouring files in front of it)."""
    f, r = chess.square_file(square), chess.square_rank(square)
    for sq in board.pieces(chess.PAWN, not color):
        pf, pr = chess.square_file(sq), chess.square_rank(sq)
        if abs(pf - f) == 1 and ((color == chess.WHITE and pr > r) or (color == chess.BLACK and pr < r)):
            return False
    return True


def _passed(board: chess.Board, color: bool) -> set[int]:
    out = set()
    for sq in board.pieces(chess.PAWN, color):
        f, r = chess.square_file(sq), chess.square_rank(sq)
        blocked = any(abs(chess.square_file(o) - f) <= 1 and ((color == chess.WHITE and chess.square_rank(o) > r)
                                                             or (color == chess.BLACK and chess.square_rank(o) < r))
                      for o in board.pieces(chess.PAWN, not color))
        if not blocked:
            out.add(sq)
    return out


def _structure(board: chess.Board, color: bool) -> dict[str, set[int]]:
    pawns = board.pieces(chess.PAWN, color)
    files = [chess.square_file(s) for s in pawns]
    doubled = {s for s in pawns if files.count(chess.square_file(s)) > 1}
    isolated = {s for s in pawns if not any(abs(f - chess.square_file(s)) == 1 for f in files)}
    return {"doubled": doubled, "isolated": isolated}


def positional_facts(fen: str, line: list[str], themes: list[str]) -> list[str]:
    """Board facts about the key move (and, where it matters, the book's line) for each reviewed theme."""
    board = chess.Board(fen)
    solver = board.turn
    them = COLOR[not solver]
    key = chess.Move.from_uci(line[0])
    moved = board.piece_type_at(key.from_square)
    after = board.copy(stack=False)
    after.push(key)
    end = board.copy(stack=False)
    for u in line:
        end.push(chess.Move.from_uci(u))
    facts = []
    to = chess.square_name(key.to_square)
    for theme in themes:
        if theme == "pawn_break" and moved == chess.PAWN:
            hit = _pawn_attacks_pawns(after, key.to_square)
            if board.is_capture(key) and board.piece_type_at(key.to_square) == chess.PAWN:
                facts.append(f"The pawn takes on {to}, breaking into {them}'s pawn chain.")
            elif hit:
                facts.append(f"The pawn on {to} strikes at {_join([_at(after, s) for s in hit])}: {them} has to "
                             f"exchange or let it advance.")
        elif theme == "outpost" and moved != chess.PAWN and _safe_from_pawns(after, key.to_square, solver):
            facts.append(f"The {NAMES[moved]} on {to} can't be chased away by any {them.lower()} pawn.")
        elif theme == "passed_pawn":
            new = _passed(end, solver) - _passed(board, solver)
            mine = _passed(end, solver)
            if new:
                facts.append(f"The line leaves you with a passed pawn on {_join([chess.square_name(s) for s in sorted(new)])}.")
            elif moved == chess.PAWN and key.to_square in _passed(after, solver):
                facts.append(f"The passed pawn moves on to {to}.")
            elif mine:
                facts.append(f"Your passed pawn on {_join([chess.square_name(s) for s in sorted(mine)])} is the trump.")
        elif theme == "pawn_weakness":
            was, now = _structure(board, not solver), _structure(end, not solver)
            for kind in ("isolated", "doubled"):
                fresh = now[kind] - was[kind]
                if fresh:
                    facts.append(f"{them} is left with {'an isolated' if kind == 'isolated' else 'doubled'} "
                                 f"pawn{'s' if kind == 'doubled' else ''} on "
                                 f"{_join([chess.square_name(s) for s in sorted(fresh)])}.")
                    break
        elif theme == "bishops":
            mine, theirs = len(end.pieces(chess.BISHOP, solver)), len(end.pieces(chess.BISHOP, not solver))
            if mine == 2 and theirs < 2:
                facts.append(f"After the line you keep the bishop pair; {them} has {'one bishop' if theirs == 1 else 'no bishop'}.")
        elif theme == "open_file":
            for f in range(8):
                pawns = [s for s in chess.SquareSet(chess.BB_FILES[f]) if end.piece_type_at(s) == chess.PAWN]
                was = [s for s in chess.SquareSet(chess.BB_FILES[f]) if board.piece_type_at(s) == chess.PAWN]
                if len(pawns) < len(was) and not any(end.color_at(s) == solver for s in pawns):
                    facts.append(f"The {'abcdefgh'[f]}-file opens up for your rooks.")
                    break
        elif theme == "exchange_sacrifice" and board.is_capture(key) and moved == chess.ROOK:
            facts.append(f"The rook is given for {_at(board, key.to_square)}.")
        elif theme == "right_exchange" and board.is_capture(key):
            facts.append(f"The {NAMES[moved]} is traded for {_at(board, key.to_square)}.")
        elif theme == "space" and moved == chess.PAWN:
            rank = chess.square_rank(key.to_square) + 1
            if (solver == chess.WHITE and rank >= 5) or (solver == chess.BLACK and rank <= 4):
                facts.append(f"The pawn on {to} takes space and takes squares away from {them}'s pieces.")
        elif theme == "centre" and key.to_square in (chess.D4, chess.E4, chess.D5, chess.E5):
            facts.append(f"{NAMES[moved].capitalize()} to {to}: straight into the centre.")
        elif theme == "king_attack":
            king = board.king(not solver)
            if king is not None and moved != chess.KING and \
                    chess.square_distance(key.to_square, king) < chess.square_distance(key.from_square, king):
                facts.append(f"The {NAMES[moved]} comes closer to {them}'s king on {chess.square_name(king)}.")
        elif theme == "piece_improvement" and moved != chess.PAWN:
            gain = len(after.attacks(key.to_square)) - len(board.attacks(key.from_square))
            if gain > 0:
                facts.append(f"On {to} the {NAMES[moved]} controls {len(after.attacks(key.to_square))} squares, "
                             f"{gain} more than before.")
    return facts


def explain(puzzle: dict, positional: list[str] | None = None) -> dict:
    """The explanation shown after a puzzle. Book 2 uses the whole book line (`line`, SAN)."""
    if puzzle.get("book", 1) == 2:
        board = chess.Board(puzzle["fen"])
        uci = []
        for san in puzzle.get("line") or puzzle["san"]:
            move = board.parse_san(san)
            uci.append(move.uci())
            board.push(move)
        out = explain_line(puzzle["fen"], uci, solver_plies=1)
        ideas = [key for key in THEMES if key in POSITIONAL and key in (positional or [])]
        out["ideas"] = [{"key": k, "name": THEMES[k][0], "text": THEMES[k][1]} for k in ideas]
        out["facts"] = positional_facts(puzzle["fen"], uci, ideas)
        out["summary"] = " ".join(out["facts"][:2]) or " ".join(f"{i['name']}: {i['text']}" for i in out["ideas"][:2])
        return out
    out = explain_line(puzzle["fen"], puzzle["moves"])
    out["ideas"] = [{"key": k, "name": THEMES[k][0], "text": THEMES[k][1]} for k in puzzle.get("themes", [])
                    if k in THEMES and k not in ("endgame", "long_combination", "material")]
    out["summary"] = _summary(out["steps"], out["result"])
    return out


def main() -> None:
    from .db import ROOT
    data = ROOT / "data"
    reviewed = json.loads((data / "themes2.json").read_text(encoding="utf-8"))
    out = {}
    for name in ("puzzles.json", "puzzles2.json"):
        for p in json.loads((data / name).read_text(encoding="utf-8")):
            out[str(p["id"])] = explain(p, reviewed.get(str(p.get("number"))) if p.get("book") == 2 else None)
    (data / "explanations.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} explanations written to data/explanations.json")


if __name__ == "__main__":
    main()
