import { Chessground } from '../vendor/chessground.js';
import { Chess } from '../vendor/chess.js';

const OPPONENT_DELAY = 450;
const colorName = (c) => (c === 'w' ? 'white' : 'black');

/**
 * Plays one puzzle on a chessground board.
 * The solver plays moves[0], moves[2], ...; replies moves[1], moves[3], ... are played automatically.
 * A different move that gives checkmate is accepted too.
 */
export class Solver {
  constructor(el, puzzle, { onChange, onRecord, onEvent }) {
    this.el = el;
    this.puzzle = puzzle;
    this.onChange = onChange;
    this.onRecord = onRecord;
    this.onEvent = onEvent; // ('correct' | 'wrong' | 'reply' | 'solved' | 'hint', detail) for animations
    this.recorded = false;
    this.startedAt = performance.now();
    this.solverColor = colorName(puzzle.fen.split(' ')[1]);
    this.cg = Chessground(el, {
      fen: puzzle.fen, // otherwise the board animates in from the initial position
      orientation: this.solverColor,
      coordinates: false, // coordinates are drawn by the page to follow the board theme
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: { free: false, showDests: true, events: { after: (o, d) => this.userMove(o, d) } },
    });
    this.reset();
  }

  reset() {
    this.chess = new Chess(this.puzzle.fen);
    this.ply = 0;
    this.history = []; // {san, by: 'user' | 'auto' | 'reveal'}
    this.mistakes = 0;
    this.assisted = false;
    this.revealed = false;
    this.finished = false;
    this.run = (this.run ?? 0) + 1; // invalidates pending opponent replies / reveal loops
    this.message = { kind: '', text: 'Find the strongest move.' };
    this.cg.set({ fen: this.puzzle.fen, lastMove: undefined, check: false });
    this.cg.setAutoShapes([]);
    this.sync();
  }

  get elapsedMs() {
    return Math.round((this.finishedAt ?? performance.now()) - this.startedAt);
  }

  dests() {
    const dests = new Map();
    for (const m of this.chess.moves({ verbose: true })) {
      if (!dests.has(m.from)) dests.set(m.from, []);
      dests.get(m.from).push(m.to);
    }
    return dests;
  }

  sync() {
    const userTurn = !this.finished && colorName(this.chess.turn()) === this.solverColor;
    this.cg.set({
      fen: this.chess.fen(),
      turnColor: colorName(this.chess.turn()),
      check: this.chess.inCheck(),
      movable: { color: userTurn ? this.solverColor : undefined, dests: userTurn ? this.dests() : new Map() },
    });
    this.onChange?.(this);
  }

  apply(uci, by) {
    const move = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    this.history.push({ san: move.san, by, color: move.color });
    this.cg.set({ lastMove: [move.from, move.to] });
    return move;
  }

  record(solved) {
    if (this.recorded) return;
    this.recorded = true;
    this.onRecord?.({ solved, mistakes: this.mistakes, time_ms: this.elapsedMs });
  }

  flash(kind) {
    this.el.classList.add(`flash-${kind}`);
    setTimeout(() => this.el.classList.remove(`flash-${kind}`), 600);
  }

  userMove(orig, dest) {
    if (this.finished) return;
    const expected = this.puzzle.moves[this.ply];
    const piece = this.chess.get(orig);
    let promotion;
    if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      promotion = expected.slice(0, 4) === orig + dest && expected[4] ? expected[4] : 'q';
    }
    const uci = orig + dest + (promotion ?? '');

    const trial = new Chess(this.chess.fen());
    let givesMate = false;
    try {
      trial.move({ from: orig, to: dest, promotion });
      givesMate = trial.isCheckmate();
    } catch {
      /* illegal: chessground only offers legal destinations, so this should not happen */
    }

    if (uci !== expected && !givesMate) {
      this.mistakes += 1;
      this.assisted = true;
      this.record(false);
      this.flash('bad');
      this.onEvent?.('wrong', { square: dest });
      this.message = { kind: 'bad', text: 'Not this one. Try another move.' };
      this.cg.setAutoShapes([]);
      this.sync(); // puts the piece back
      return;
    }

    this.cg.setAutoShapes([]);
    this.apply(uci, 'user');
    this.ply += 1;
    this.onEvent?.('correct', { square: dest });
    if (givesMate || this.ply >= this.puzzle.moves.length) {
      this.finish();
      return;
    }
    this.message = { kind: 'ok', text: 'Correct. Keep going.' };
    this.sync();
    const run = this.run;
    setTimeout(() => run === this.run && this.playOpponent(), OPPONENT_DELAY);
  }

  playOpponent() {
    if (this.finished || this.ply >= this.puzzle.moves.length) return;
    const move = this.apply(this.puzzle.moves[this.ply], 'auto');
    this.ply += 1;
    this.sync();
    this.onEvent?.('reply', { square: move.to });
  }

  finish() {
    this.finished = true;
    this.finishedAt = performance.now();
    const clean = !this.assisted;
    this.record(clean);
    this.flash(clean ? 'ok' : 'bad');
    this.onEvent?.('solved', { clean });
    this.message = clean
      ? { kind: 'ok', text: 'Solved without a mistake.' }
      : { kind: 'bad', text: this.revealed ? 'Here is the full solution.' : 'Solved with help. It goes to your review queue.' };
    this.sync();
  }

  hint() {
    if (this.finished) return;
    const expected = this.puzzle.moves[this.ply];
    this.assisted = true;
    this.record(false);
    this.cg.setAutoShapes([{ orig: expected.slice(0, 2), brush: 'blue' }]);
    this.onEvent?.('hint', { square: expected.slice(0, 2) });
    this.message = { kind: 'hint', text: 'Hint: the highlighted piece moves next.' };
    this.onChange?.(this);
  }

  async reveal() {
    if (this.finished) return;
    this.assisted = true;
    this.revealed = true;
    this.record(false);
    this.cg.setAutoShapes([]);
    this.cg.set({ movable: { color: undefined, dests: new Map() } });
    const run = this.run;
    while (this.ply < this.puzzle.moves.length) {
      if (this.destroyed || run !== this.run) return;
      const isUser = this.ply % 2 === 0;
      this.apply(this.puzzle.moves[this.ply], isUser ? 'reveal' : 'auto');
      this.ply += 1;
      this.cg.set({ fen: this.chess.fen(), check: this.chess.inCheck() });
      this.onChange?.(this);
      await new Promise((r) => setTimeout(r, 650));
    }
    if (!this.destroyed && run === this.run) this.finish();
  }

  /** Solver moves in the line, and how many are already played (for the progress dots). */
  get steps() {
    const total = Math.ceil(this.puzzle.moves.length / 2);
    const mine = this.history.filter((h, i) => i % 2 === 0);
    return { total, done: mine.filter((h) => h.by === 'user').length, revealed: mine.filter((h) => h.by === 'reveal').length };
  }

  get orientation() {
    return this.cg.state.orientation;
  }

  flip() {
    this.cg.toggleOrientation();
    this.onChange?.(this);
  }

  destroy() {
    this.destroyed = true;
    this.cg.destroy();
  }
}
