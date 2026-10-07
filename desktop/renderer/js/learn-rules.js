// Rules for the Learn lessons: loading positions, free moves, goal checks and the practice opponent.
// No DOM here, so the lesson tests can run every goal against its reference solution in Node.
import { Chess } from '../vendor/chess.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const FILES = 'abcdefgh';
const other = (c) => (c === 'w' ? 'b' : 'w');

/**
 * Build a FEN from piece lists. 'Ke1 Qd1 e2 f2' -> king e1, queen d1, pawns e2 and f2.
 * turn: 'w' | 'b'; castling like 'KQkq' or '-'; ep: en passant square or '-'.
 */
export function fen(white = '', black = '', { turn = 'w', castling = '-', ep = '-' } = {}) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(''));
  const place = (list, color) => list.split(/\s+/).filter(Boolean).forEach((token) => {
    const [, letter, sq] = token.match(/^([KQRBN]?)([a-h][1-8])$/) ?? [];
    if (!sq) throw new Error(`Bad piece: ${token}`);
    const piece = letter || 'P';
    const f = FILES.indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    if (grid[r][f]) throw new Error(`Two pieces on ${sq}`);
    grid[r][f] = color === 'w' ? piece : piece.toLowerCase();
  });
  place(white, 'w');
  place(black, 'b');
  const rows = grid.map((row) => {
    let out = '';
    let gap = 0;
    for (const cell of row) {
      if (!cell) { gap += 1; continue; }
      if (gap) out += gap;
      gap = 0;
      out += cell;
    }
    return out + (gap || '');
  });
  return `${rows.join('/')} ${turn} ${castling} ${ep} 0 1`;
}

export const load = (f) => new Chess(f, { skipValidation: true });

/** Legal destinations for chessground: Map(from -> [to, ...]). */
export function dests(chess) {
  const map = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!map.has(m.from)) map.set(m.from, []);
    map.get(m.from).push(m.to);
  }
  return map;
}

/** Play from-to (pawns become queens). Returns the move, or null if it is not legal. */
export function play(chess, from, to) {
  try {
    return chess.move({ from, to, promotion: 'q' });
  } catch {
    return null;
  }
}

/** Free movement: the same side moves again (the other side's pieces never move). */
export function keepTurn(chess, color) {
  const parts = chess.fen().split(' ');
  parts[1] = color;
  parts[3] = '-';
  chess.load(parts.join(' '), { skipValidation: true });
}

export function squaresOf(chess, color, types = 'kqrbnp') {
  const out = [];
  chess.board().forEach((row) => row.forEach((cell) => {
    if (cell && cell.color === color && types.includes(cell.type)) out.push(cell);
  }));
  return out;
}

export function kingSquare(chess, color) {
  return squaresOf(chess, color, 'k')[0]?.square;
}

/** Enemy pieces the piece on `from` attacks. */
function targetsOf(chess, from) {
  const piece = chess.get(from);
  if (!piece) return [];
  return squaresOf(chess, other(piece.color)).filter((t) => chess.attackers(t.square, piece.color).includes(from));
}

/**
 * A line piece on `from` attacks `front`; with `front` gone it would also hit something behind it.
 * Returns [{front, behind}] pairs.
 */
function linesThrough(chess, from) {
  const piece = chess.get(from);
  if (!piece || !'brq'.includes(piece.type)) return [];
  const pairs = [];
  for (const front of targetsOf(chess, from)) {
    const probe = load(chess.fen());
    probe.remove(front.square);
    const before = new Set(targetsOf(chess, from).map((t) => t.square));
    for (const behind of targetsOf(probe, from)) {
      if (!before.has(behind.square) && onLine(from, front.square, behind.square)) pairs.push({ front, behind });
    }
  }
  return pairs;
}

function onLine(a, b, c) {
  const xy = (s) => [FILES.indexOf(s[0]), Number(s[1])];
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  const [cx, cy] = xy(c);
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  return Math.sign(cx - bx) === dx && Math.sign(cy - by) === dy;
}

const defended = (chess, square, color) => chess.attackers(square, color).length > 0;
const clean = (san) => san.replace(/[+#?!]/g, '');

/**
 * Goal checks. Each gets (after, move, before, arg) where `after` is the position after the move,
 * `move` is chess.js's verbose move and `before` the position before it.
 */
export const TESTS = {
  any: () => true,
  check: (after) => after.inCheck(),
  mate: (after) => after.isCheckmate(),
  capture: (after, m, before, arg) => Boolean(m.captured) && (!arg || m.captured === arg),
  // took something that can't be taken back, or that is worth at least as much as the piece that took it
  free: (after, m) => Boolean(m.captured) && !defended(after, m.to, other(m.color)),
  // the piece that was attacked is now on a square where nothing attacks it
  safe: (after, m, before, arg) => (!arg || m.from === arg) && !defended(after, m.to, other(m.color)),
  // the piece on `arg` is still there and one of its own pieces now guards it
  protect: (after, m, before, arg) => after.get(arg)?.color === m.color && defended(after, arg, m.color),
  escape: (after, m, before, arg) => {
    if (!before.inCheck()) return false;
    if (arg === 'king') return m.piece === 'k' && !m.captured;
    if (arg === 'capture') return Boolean(m.captured);
    if (arg === 'block') return m.piece !== 'k' && !m.captured;
    return true;
  },
  castle: (after, m, before, arg) => m.flags.includes(arg === 'queen' ? 'q' : 'k'),
  enpassant: (after, m) => m.flags.includes('e'),
  promote: (after, m) => Boolean(m.promotion),
  accept: (after, m, before, arg) => arg.map(clean).includes(clean(m.san)),
  fork: (after, m) => {
    const us = m.color;
    const safe = !defended(after, m.to, other(us)) || defended(after, m.to, us);
    const hits = targetsOf(after, m.to).filter((t) =>
      t.type === 'k' || VALUE[t.type] > VALUE[m.piece] || (!defended(after, t.square, other(us)) && t.type !== 'p'));
    return safe && hits.length >= 2;
  },
  pin: (after, m) => linesThrough(after, m.to).some(({ front, behind }) =>
    front.type !== 'k' && (behind.type === 'k' || VALUE[behind.type] > VALUE[front.type])),
  skewer: (after, m) => linesThrough(after, m.to).some(({ front, behind }) =>
    behind.type !== 'k' && (front.type === 'k' || VALUE[front.type] > VALUE[behind.type])),
  // a different piece, uncovered by the move, now attacks the king or the queen
  discovered: (after, m, before) => {
    const us = m.color;
    return squaresOf(after, other(us), 'kq').some((t) => {
      const was = new Set(before.attackers(t.square, us));
      return after.attackers(t.square, us).some((s) => s !== m.to && !was.has(s));
    });
  },
};

export function passes(goal, after, move, before) {
  const [name, arg] = Array.isArray(goal) ? goal : [goal];
  const test = TESTS[name];
  if (!test) throw new Error(`Unknown goal: ${name}`);
  return test(after, move, before, arg);
}

/** Try a goal move given in SAN on a copy of the position: {ok, move, after}. */
export function tryGoal(startFen, san, goal) {
  const before = load(startFen);
  const after = load(startFen);
  const move = after.move(san);
  return { ok: passes(goal, after, move, before), move, after };
}

/**
 * The practice opponent for the basic mates: a lone king that takes anything left hanging and
 * otherwise runs for the centre, keeping as many squares as it can. Deterministic.
 */
export function defenderMove(chess) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const hanging = moves.find((m) => m.captured && !defended(chess, m.to, other(m.color)));
  if (hanging) return hanging;
  const score = (m) => {
    const probe = load(chess.fen());
    probe.move(m.san);
    keepTurn(probe, m.color);
    const room = probe.moves().length;
    const f = FILES.indexOf(m.to[0]);
    const r = Number(m.to[1]) - 1;
    const centre = -(Math.abs(3.5 - f) + Math.abs(3.5 - r));
    return room * 2 + centre;
  };
  return moves.reduce((best, m) => (score(m) > score(best) ? m : best));
}

/**
 * Fewest moves to collect every star (and, when `captureAll`, take every enemy piece),
 * moving only the side to move and never stopping on a guarded square when `guarded`.
 * Used by the tests to prove each exercise's `par`.
 */
export function shortest(startFen, { stars = [], captureAll = false, guarded = false }, limit = 12) {
  const color = startFen.split(' ')[1];
  const them = other(color);
  const tail = ` ${color} - - 0 1`;
  const enemy = them === 'b' ? /[a-z]/ : /[A-Z]/;
  const place = (f) => f.split(' ')[0];
  let frontier = [[place(startFen), stars]];
  const seen = new Set([`${frontier[0][0]}|${stars.join()}`]);
  for (let depth = 0; depth <= limit; depth += 1) {
    const next = [];
    for (const [board, left] of frontier) {
      if (!left.length && (!captureAll || !enemy.test(board))) return depth;
      const c = load(board + tail);
      for (const m of c.moves({ verbose: true })) {
        c.move({ from: m.from, to: m.to, promotion: 'q' });
        const unsafe = guarded && defended(c, m.to, them);
        const after = place(c.fen());
        c.undo();
        if (unsafe) continue;
        const rest = left.filter((sq) => sq !== m.to);
        const key = `${after}|${rest.join()}`;
        if (!seen.has(key)) { seen.add(key); next.push([after, rest]); }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export const guardedBy = (chess, square, color) => defended(chess, square, color);
