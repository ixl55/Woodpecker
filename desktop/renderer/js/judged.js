// Sprint play: a board whose moves are judged by the app's engine, which keeps the solution to itself.
import { Chessground } from '../vendor/chessground.js';
import { Chess } from '../vendor/chess.js';

const colorName = (c) => (c === 'w' ? 'white' : 'black');

/**
 * Board for judged puzzles (sprints). The page never sees the solution: each move goes to the engine,
 * which answers correct (with the reply), solved or wrong (with the expected move).
 * `send` is a function (uci) => Promise<verdict>.
 */
export class RemoteSolver {
  constructor(el, send, { onVerdict, onError }) {
    this.el = el;
    this.send = send;
    this.onVerdict = onVerdict;
    this.onError = onError;
    this.busy = false;
    this.cg = Chessground(el, {
      coordinates: false,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      movable: { free: false, showDests: true, events: { after: (o, d) => this.userMove(o, d) } },
    });
  }

  /** Show a puzzle position (`current` from the sprint state). */
  load(current) {
    this.current = current;
    this.index = current.index;
    this.chess = new Chess(current.fen);
    this.solverColor = colorName(this.chess.turn());
    const last = current.last_move;
    this.cg.set({
      fen: current.fen,
      orientation: this.solverColor,
      lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined,
    });
    this.cg.setAutoShapes([]);
    this.unlock();
  }

  get orientation() { return this.cg.state.orientation; }

  dests() {
    const dests = new Map();
    for (const m of this.chess.moves({ verbose: true })) {
      if (!dests.has(m.from)) dests.set(m.from, []);
      dests.get(m.from).push(m.to);
    }
    return dests;
  }

  lock() { this.cg.set({ movable: { color: undefined, dests: new Map() } }); }

  unlock() {
    this.busy = false;
    this.cg.set({
      turnColor: colorName(this.chess.turn()),
      check: this.chess.inCheck(),
      movable: { color: this.solverColor, dests: this.dests() },
    });
  }

  play(uci) {
    const move = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    this.cg.move(move.from, move.to);
    this.cg.set({ fen: this.chess.fen(), check: this.chess.inCheck(), lastMove: [move.from, move.to] });
    return move;
  }

  async userMove(orig, dest) {
    if (this.busy) return;
    this.busy = true;
    const piece = this.chess.get(orig);
    const promotion = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
    const uci = orig + dest + promotion;
    const before = this.chess.fen();
    this.lock();
    let verdict;
    try {
      verdict = await this.send(uci);
    } catch (err) {
      this.cg.set({ fen: before });
      this.unlock();
      this.onError?.(err);
      return;
    }
    if (verdict.result === 'wrong') {
      this.cg.set({ fen: before });
      const exp = verdict.expected;
      this.cg.setAutoShapes([{ orig: exp.slice(0, 2), dest: exp.slice(2, 4), brush: 'green' }]);
    } else {
      this.chess.move({ from: orig, to: dest, promotion: promotion || undefined });
      this.cg.set({ fen: this.chess.fen(), lastMove: [orig, dest], check: this.chess.inCheck() });
      if (verdict.result === 'correct') {
        setTimeout(() => {
          if (this.destroyed) return;
          this.play(verdict.reply);
          this.current = { ...this.current, fen: this.chess.fen() };
          this.unlock();
        }, 320);
      }
    }
    this.onVerdict?.(verdict, dest);
  }

  destroy() {
    this.destroyed = true;
    this.cg.destroy();
  }
}

/** Milliseconds to add to Date.now() to get the engine's clock. */
export const clockOffset = (serverNowIso) => Date.parse(serverNowIso) - Date.now();
