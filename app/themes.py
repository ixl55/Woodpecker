"""Tactical themes, detected automatically from each puzzle's solution line.

The detectors are heuristics over python-chess positions, played from the solver's side: they look at
what each of the solver's moves does (fork, pin, discovered attack...) and at how the line ends
(mate patterns, material won). They label the typical case well; they are not an engine.

    python -m app.themes      # (re)write the "themes" field of data/puzzles.json
"""
import json
import math

import chess

# key -> (name, one-line description); the order is the order shown in the interface
THEMES: dict[str, tuple[str, str]] = {
    "mate_in_1": ("Mate in 1", "Deliver checkmate in one move."),
    "mate_in_2": ("Mate in 2", "A forced checkmate in two moves."),
    "mate_in_3": ("Mate in 3", "A forced checkmate in three moves."),
    "long_mate": ("Long mate", "A forced checkmate in four moves or more."),
    "back_rank_mate": ("Back-rank mate", "Mate on the back rank, where the king is boxed in by its own pawns."),
    "smothered_mate": ("Smothered mate", "A knight mates a king surrounded by its own pieces."),
    "fork": ("Fork", "One piece attacks two valuable targets at once."),
    "pin": ("Pin", "A piece can't move because the king would be exposed behind it."),
    "skewer": ("Skewer", "A valuable piece is attacked and must move, exposing the piece behind it."),
    "discovered_attack": ("Discovered attack", "Moving one piece unveils an attack by another."),
    "double_check": ("Double check", "Two pieces give check at once, so the king must move."),
    "sacrifice": ("Sacrifice", "Give up material to get something bigger."),
    "quiet_move": ("Quiet move", "A calm move, with no check, capture or direct threat, that sets up the win."),
    "promotion": ("Promotion", "A pawn reaches the last rank."),
    "material": ("Win material", "The line ends with you ahead in material."),
    "endgame": ("Endgame", "Few pieces left on the board."),
    "long_combination": ("Long combination", "A line of five moves or more."),
    # positional themes (book 2): what the book's explanation of the key move is about
    "pawn_break": ("Pawn break", "Push a pawn to challenge the opponent's pawn chain."),
    "prophylaxis": ("Prophylaxis", "Stop the opponent's plan before it starts."),
    "piece_improvement": ("Improve a piece", "Reroute or activate a badly placed piece."),
    "right_exchange": ("The right exchange", "Trade the pieces that make your position better."),
    "outpost": ("Outpost", "Plant a piece on a strong square the opponent can't easily challenge."),
    "open_file": ("Open file", "Open a file or take it over with the rooks."),
    "bishops": ("Good and bad bishops", "Keep the bishop pair, lose your bad bishop, or exploit the opponent's."),
    "pawn_weakness": ("Pawn weaknesses", "Create or target weak pawns: isolated, doubled, backward or hanging."),
    "passed_pawn": ("Passed pawn", "Create, push or stop a passed pawn."),
    "king_attack": ("Attack on the king", "Start or strengthen an attack against the king."),
    "space": ("Space", "Gain space and restrict the opponent's pieces."),
    "centre": ("Centre", "Fight for the centre or strike at it."),
    "exchange_sacrifice": ("Exchange sacrifice", "Give a rook for a minor piece for a lasting advantage."),
}
POSITIONAL = {"pawn_break", "prophylaxis", "piece_improvement", "right_exchange", "outpost", "open_file", "bishops",
              "pawn_weakness", "passed_pawn", "king_attack", "space", "centre", "exchange_sacrifice"}
# keywords of the explanation -> theme (only its opening, which is about the key move itself); a fallback,
# as every exercise's positional themes were read from the book and are stored in data/themes2.json
TEXT_PATTERNS: dict[str, str] = {
    "pawn_break": r"\bpawn break|\bbreak(s|ing)? (open|through|with)|\blever\b",
    "prophylaxis": r"prophyla|\bprevent|\bstop(s|ping)?\b|\bpre-?empt|\bagainst (the|black.s|white.s) (threat|plan|idea)"
                   r"|\bdefend(s|ing)? against",
    "piece_improvement": r"\bimprov|\bre-?rout|\bactiv|\bregroup|\bworst piece|\bmanoeuv|\bmaneuv|\btransfer"
                         r"|\brelocat|\bredirect|\bheading (for|to)|\bjourney|\breposition|\bon (its|the) way to",
    "right_exchange": r"\bexchang(e|es|ing)\b(?! sac)|\btrad(e|es|ing)\b|\bget(ting)? rid of",
    "outpost": r"\boutpost|\bstrong square|\bhole\b|\bweak square|\bstrong knight|\bcan.t be challenged",
    "open_file": r"\bopen(s|ing)? (up )?(the |a )?[a-h]-file|\bopen file|\bsemi-open|\bdoubl(e|ing) (the )?rooks",
    "bishops": r"\bbishop pair|\btwo bishops|\bpair of bishops|\bbad bishop|\bgood bishop",
    "pawn_weakness": r"\bweak (pawn|point)|\bisolated|\bdoubled|\bbackward|\bhanging pawns|\bweaken|\bweakness"
                     r"|\bfix(es|ing)? the (pawn|[a-h]\d)",
    "passed_pawn": r"\bpassed pawn|\bpasser|\bpawn majority|\bqueenside majority|\bkingside majority",
    "king_attack": r"\battack(ing)? (on|against) the (black |white )?king|\bkingside attack|\bmating attack|"
                   r"\battack on the king|\bking.s (safety|cover|shelter)|\blaunch\w* (an |the )?attack|\bpawn storm"
                   r"|\bagainst the (black |white )?king|\battack the (black |white )?king",
    "space": r"\bgain(s|ing)? space|\bmore space|\brestrict|\bcramp|\bexpansion|\btake space",
    "centre": r"\bcent(re|er)\b|\bcentral",
    "exchange_sacrifice": r"\bexchange sac|\bfor the exchange|\bsacrific\w* the exchange",
}
TEXT_WINDOW = 320  # characters of the explanation that speak about the key move
VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
SLIDERS = (chess.BISHOP, chess.ROOK, chess.QUEEN)


def _material(board: chess.Board, color: bool) -> int:
    return sum(VALUE[p.piece_type] for p in board.piece_map().values() if p.color == color and p.piece_type != chess.KING)


def _balance(board: chess.Board, color: bool) -> int:
    return _material(board, color) - _material(board, not color)


def _exchange(board: chess.Board, square: int, solver: bool) -> int:
    """The balance once both sides have recaptured on `square` for as long as it pays (each may stop),
    always taking back with the cheapest piece."""
    stand = _balance(board, solver)
    takes = [m for m in board.legal_moves if m.to_square == square]
    if not takes:
        return stand
    move = min(takes, key=lambda m: VALUE[board.piece_type_at(m.from_square)])
    after = board.copy(stack=False)
    after.push(move)
    score = _exchange(after, square, solver)
    return max(stand, score) if board.turn == solver else min(stand, score)


def _capture(board: chess.Board, move: chess.Move, solver: bool) -> int:
    """The balance after `move` (a capture) and the exchanges that follow on its square."""
    after = board.copy(stack=False)
    after.push(move)
    return _exchange(after, move.to_square, solver)


# Each motif is first spotted in the position right after one of the solver's moves, then *proved* by
# the rest of the solution line (the fork really wins one of its targets, the pinned piece really
# falls...). A pattern the line never cashes in is not what the puzzle is about, so it is not tagged.
# The book often stops on the move that sets the trap (the fork itself, with the capture left to the
# reader); then the proof is that no reply saves the target (see _threat).

def _fork_targets(board: chess.Board, to: int, solver: bool) -> set[int]:
    """Squares of two or more targets hit by the piece that just moved: the king, pieces worth more
    than it, or undefended pieces."""
    mover = board.piece_at(to)
    if mover is None or mover.piece_type == chess.KING:
        return set()
    targets = set()
    for sq in board.attacks(to):
        piece = board.piece_at(sq)
        if piece is None or piece.color == solver or piece.piece_type == chess.PAWN:
            continue
        if piece.piece_type == chess.KING or VALUE[piece.piece_type] > VALUE[mover.piece_type] \
                or not board.is_attacked_by(not solver, sq):
            targets.add(sq)
    return targets if len(targets) >= 2 else set()


def _pinned(board: chess.Board, to: int, solver: bool) -> set[int]:
    """Enemy pieces pinned to their king that the moved piece attacks (as the pinner, or piling on)."""
    return {sq for sq, piece in board.piece_map().items()
            if piece.color != solver and piece.piece_type not in (chess.KING, chess.PAWN)
            and board.is_pinned(not solver, sq) and sq in board.attacks(to)}


def _skewered(board: chess.Board, to: int, solver: bool) -> tuple[set[int], set[int]]:
    """Pieces standing behind a king or queen that the moved slider attacks along a line (a queen in
    front must be worth more than the slider, or be undefended, so that it really has to step aside),
    and the queens in front of them."""
    mover = board.piece_at(to)
    if mover is None or mover.piece_type not in SLIDERS:
        return set(), set()
    behind_squares, fronts = set(), set()
    for sq in board.attacks(to):
        front = board.piece_at(sq)
        if front is None or front.color == solver or front.piece_type not in (chess.KING, chess.QUEEN):
            continue
        if front.piece_type == chess.QUEEN and mover.piece_type == chess.QUEEN and board.is_attacked_by(not solver, to):
            continue
        step_file = (chess.square_file(sq) > chess.square_file(to)) - (chess.square_file(sq) < chess.square_file(to))
        step_rank = (chess.square_rank(sq) > chess.square_rank(to)) - (chess.square_rank(sq) < chess.square_rank(to))
        f, r = chess.square_file(sq) + step_file, chess.square_rank(sq) + step_rank
        while 0 <= f < 8 and 0 <= r < 8:
            behind = board.piece_at(chess.square(f, r))
            if behind is not None:
                if behind.color != solver and 3 <= VALUE[behind.piece_type] < VALUE[front.piece_type]:
                    behind_squares.add(chess.square(f, r))
                    if front.piece_type == chess.QUEEN:
                        fronts.add(sq)
                break
            f, r = f + step_file, r + step_rank
    return behind_squares, fronts


def _unveiled(before: chess.Board, board: chess.Board, move: chess.Move, solver: bool) -> list[tuple[int, int]]:
    """(slider square, target square): another of our sliders now hits an enemy piece (not a pawn)
    through the square the moved piece left."""
    found = []
    for sq, piece in board.piece_map().items():
        if piece.color != solver or piece.piece_type not in SLIDERS or sq == move.to_square:
            continue
        for target in board.attacks(sq) & ~before.attacks(sq):
            victim = board.piece_at(target)
            if victim and victim.color != solver and victim.piece_type != chess.PAWN \
                    and move.from_square in chess.SquareSet(chess.between(sq, target)):
                found.append((sq, target))
    return found


def _hanging(board: chess.Board, square: int) -> bool:
    """Is the piece on `square` attacked and either undefended or attacked by something cheaper?"""
    piece = board.piece_at(square)
    attackers = board.attackers(not piece.color, square)
    if not attackers:
        return False
    return not board.is_attacked_by(piece.color, square) \
        or min(VALUE[board.piece_type_at(a)] for a in attackers) < VALUE[piece.piece_type]


def _quiet(before: chess.Board, after: chess.Board, move: chess.Move, solver: bool) -> bool:
    """No check, capture or promotion, not a way out of check or away from an attack, and no direct
    threat: the moved piece hits nothing worth taking and is not a pawn about to promote."""
    if before.is_capture(move) or move.promotion or after.is_check() or before.is_check() \
            or _hanging(before, move.from_square):
        return False
    mover = after.piece_at(move.to_square)
    if mover.piece_type == chess.PAWN and chess.square_rank(move.to_square) in (1, 6):
        return False
    for sq in after.attacks(move.to_square):
        piece = after.piece_at(sq)
        if piece and piece.color != solver and piece.piece_type != chess.KING \
                and (VALUE[piece.piece_type] > VALUE[mover.piece_type] or not after.is_attacked_by(not solver, sq)):
            return False
    return True


def _gains(boards: list[chess.Board], plies: list[chess.Move], j: int) -> bool:
    """Ply j takes a piece and keeps the profit: the victim is worth more than the taker, or the
    taker is not taken back."""
    board, move = boards[j], plies[j]
    victim, taker = board.piece_at(move.to_square), board.piece_at(move.from_square)
    if victim is None or taker is None:
        return False
    if VALUE[victim.piece_type] > VALUE[taker.piece_type]:
        return True
    if j + 1 < len(plies):
        return plies[j + 1].to_square != move.to_square
    solver = boards[0].turn
    return _exchange(boards[j + 1], move.to_square, solver) > _balance(board, solver)


def _won_later(boards: list[chess.Board], plies: list[chess.Move], i: int, squares: set[int],
               by: int | None = None, at_once: bool = False) -> bool:
    """Does a later move of the solver win (see _gains) the enemy piece standing on one of `squares`
    after ply i? With `by`, it must be our piece on that square that takes it (followed as it moves,
    until the opponent takes it) and a target that moves has got away. Without it (a pin), the target
    may take a cheaper piece (its pinner) and must then be taken back on the very next move.
    `at_once`: only the solver's next move counts."""
    for sq in squares:
        target, attacker, moved = sq, by, False
        for j in range(i + 1, min(len(plies), i + 3) if at_once else len(plies)):
            move = plies[j]
            if j % 2:  # the opponent's move
                if move.to_square == attacker:
                    break
                if move.from_square == target:
                    taken = boards[j].piece_type_at(move.to_square)
                    if by is not None or taken is None or VALUE[taken] >= VALUE[boards[j].piece_type_at(target)]:
                        break
                    target, moved = move.to_square, True
                continue
            if move.to_square == target:
                if (attacker is None or move.from_square == attacker) and _gains(boards, plies, j):
                    return True
                break
            if moved:
                break  # the piece got away
            if move.from_square == attacker:
                attacker = move.to_square
    return False


def _threat(board: chess.Board, solver: bool, targets: set[int], by: int | None = None) -> bool:
    """The line ends here with the opponent to move: whatever the reply, the solver takes one of
    `targets` (with the piece on `by`, if given) and is still two points up after the recapture.
    Taking our attacker only saves the opponent when it costs nothing; a pinned target
    may take its (cheaper) pinner and is then taken where it lands; a reply that just gives a piece
    away (a desperado check) is answered by taking it."""
    base = _balance(board, solver)
    replies = list(board.legal_moves)
    if not replies or board.turn == solver:
        return False
    for reply in replies:
        b = board.copy(stack=False)
        b.push(reply)
        if by is not None and reply.to_square == by:
            if _exchange(b, by, solver) < base + 2:
                return False  # the attacker was taken, and not at a loss
            continue
        aims = targets
        if reply.from_square in targets:
            taken = board.piece_type_at(reply.to_square)
            if by is None and taken is not None and VALUE[taken] < VALUE[board.piece_type_at(reply.from_square)]:
                aims = {reply.to_square}
            else:
                aims = targets - {reply.from_square}  # it got away
        aims = aims | {reply.to_square}
        best = None
        for cap in b.legal_moves:
            if cap.to_square not in aims or b.color_at(cap.to_square) != (not solver) \
                    or (by is not None and cap.from_square != by and cap.to_square != reply.to_square):
                continue
            score = _capture(b, cap, solver)
            best = score if best is None else max(best, score)
        if best is None or best < base + 2:
            return False
    return True


def _mate_patterns(board: chess.Board, mating: chess.Move) -> set[str]:
    tags = set()
    king_sq = board.king(board.turn)
    piece = board.piece_at(mating.to_square)
    home_rank = 0 if board.turn == chess.WHITE else 7
    if piece and piece.piece_type in (chess.ROOK, chess.QUEEN) and chess.square_rank(king_sq) == home_rank \
            and chess.square_rank(mating.to_square) == home_rank:
        # the king is boxed in on its first rank: every square in front of it is its own piece or covered,
        # and at least one is its own piece (usually the pawns it castled behind)
        ahead = home_rank + (1 if board.turn == chess.WHITE else -1)
        kf = chess.square_file(king_sq)
        front = [chess.square(f, ahead) for f in (kf - 1, kf, kf + 1) if 0 <= f < 8]
        own = [sq for sq in front if board.color_at(sq) == board.turn]
        if own and all(board.color_at(sq) == board.turn or board.is_attacked_by(not board.turn, sq) for sq in front):
            tags.add("back_rank_mate")
    if piece and piece.piece_type == chess.KNIGHT:
        around = chess.SquareSet(chess.BB_KING_ATTACKS[king_sq])
        if all(board.color_at(sq) == board.turn for sq in around):
            tags.add("smothered_mate")
    return tags


def text_themes(text: str) -> set[str]:
    """Positional themes named in the opening of the book's explanation. Only a fallback for an
    exercise that has no reviewed entry in data/themes2.json: keywords alone are right about 60% of
    the time."""
    import re
    head = text[:TEXT_WINDOW].lower()
    return {key for key, pattern in TEXT_PATTERNS.items() if re.search(pattern, head)}


def detect_themes(fen: str, moves: list[str]) -> list[str]:
    """Tactical themes of a solution line."""
    tags = _tactics(fen, moves)
    return [key for key in THEMES if key in tags]


# A positional line is quiet and long by nature; those two tags would say nothing about it.
NOT_POSITIONAL_LINE = {"quiet_move", "long_combination"}


def exercise_themes(fen: str, line: list[str], positional: set[str]) -> list[str]:
    """Book 2: the positional themes of the key move (read from the book's explanation) plus the
    tactics found in the book's whole main line, not only in the key move."""
    tags = (_tactics(fen, line) - NOT_POSITIONAL_LINE) | (set(positional) & POSITIONAL)
    return [key for key in THEMES if key in tags]


def _settled(board: chess.Board, solver: bool) -> int:
    """The material balance once the captures left hanging at the end of the line are played out:
    the opponent's best reply, then the solver's best capture and the best recapture."""
    if board.turn == solver or board.is_game_over():
        return _balance(board, solver)

    def exchange(b: chess.Board) -> int:  # the solver to move: stand pat or capture once
        return max([_balance(b, solver)] + [_capture(b, cap, solver) for cap in b.legal_moves if b.is_capture(cap)])

    worst = None
    for reply in board.legal_moves:
        b = board.copy(stack=False)
        b.push(reply)
        score = exchange(b)
        worst = score if worst is None else min(worst, score)
    return worst


def _tactics(fen: str, moves: list[str]) -> set[str]:
    plies = [chess.Move.from_uci(u) for u in moves]
    boards = [chess.Board(fen)]  # boards[i] is the position before ply i
    for move in plies:
        nxt = boards[-1].copy(stack=False)
        nxt.push(move)
        boards.append(nxt)
    solver = boards[0].turn

    def balance(b: chess.Board) -> int:
        return _balance(b, solver)

    def proved(i: int, targets: set[int], by: int | None = None, at_once: bool = False,
               threat: set[int] | None = None) -> bool:
        """The line wins one of the targets, or ends right here with the threat unanswerable."""
        if _won_later(boards, plies, i, targets, by, at_once):
            return True
        return i == len(plies) - 1 and _threat(boards[i + 1], solver, targets if threat is None else threat, by)

    tags: set[str] = set()
    quiet: list[int] = []
    for i in range(0, len(plies), 2):  # the solver's moves
        before, after, move = boards[i], boards[i + 1], plies[i]
        if move.promotion:
            tags.add("promotion")
        if len(after.checkers()) >= 2:
            tags.add("double_check")
        if after.is_checkmate():
            break
        if _quiet(before, after, move, solver):
            quiet.append(i)
        forked = _fork_targets(after, move.to_square, solver)
        if forked and proved(i, forked, by=move.to_square):
            tags.add("fork")
        pinned = _pinned(after, move.to_square, solver)
        if pinned and proved(i, pinned):
            tags.add("pin")
        behind, fronts = _skewered(after, move.to_square, solver)
        if behind and proved(i, behind, by=move.to_square, at_once=True, threat=behind | fronts):
            tags.add("skewer")  # taken as soon as the front piece steps aside
        for slider, target in _unveiled(before, after, move, solver):
            if (after.piece_type_at(target) == chess.KING and slider in after.checkers()) \
                    or proved(i, {target}, by=slider):
                tags.add("discovered_attack")
        # a real sacrifice: after the reply we are at least two points down, and the next move
        # does not simply take it back (unless it mates)
        if i + 2 < len(boards) and plies[i + 1].to_square == move.to_square \
                and balance(boards[i + 2]) <= balance(before) - 2:
            regained = i + 3 < len(boards) and balance(boards[i + 3]) > balance(before) - 2
            mates = i + 3 < len(boards) and boards[i + 3].is_checkmate()
            if not regained or mates:
                tags.add("sacrifice")

    end = boards[-1]
    final = max(balance(end), _settled(end, solver))  # the book stops once the result is clear
    solver_moves = math.ceil(len(plies) / 2)
    if end.is_checkmate():
        tags.add({1: "mate_in_1", 2: "mate_in_2", 3: "mate_in_3"}.get(solver_moves, "long_mate"))
        tags |= _mate_patterns(end, plies[-1])
    elif final - balance(boards[0]) >= 2:
        tags.add("material")
    # the key move, or a later one while the win is still to come (not tidying up once it is in)
    if any(i == 0 or end.is_checkmate() or balance(boards[i]) < final for i in quiet):
        tags.add("quiet_move")
    if solver_moves >= 5:
        tags.add("long_combination")
    if sum(1 for p in boards[0].piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING)) <= 4:
        tags.add("endgame")
    return tags


def main() -> None:
    """Store book 1's tactical themes in data/puzzles.json (book 2's are written by extract.book2)."""
    from .db import ROOT
    path = ROOT / "data" / "puzzles.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    counts: dict[str, int] = {}
    for item in data:
        item["themes"] = detect_themes(item["fen"], item["moves"])
        for t in item["themes"]:
            counts[t] = counts.get(t, 0) + 1
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for key in THEMES:
        print(f"{THEMES[key][0]:<22} {counts.get(key, 0)}")


if __name__ == "__main__":
    main()
