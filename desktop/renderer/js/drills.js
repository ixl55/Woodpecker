// Practice drills for the basics: every round is generated at random and then proved on the board
// (a star course gets its par from a shortest-path search, a goal round keeps a move that passes the goal
// and must also have moves that fail it), so no round is unsolvable or accepts a wrong idea.
import { fen, load, shortest, squaresOf, tryGoal } from './learn-rules.js';

export const DRILLS = [
  { id: 'coords', title: 'Coordinates', summary: 'Click as many named squares as you can in 30 seconds.', icon: 'board', after: 'squares', timed: 30 },
  { id: 'knight', title: 'Knight routes', summary: 'Take the knight to the star in the fewest jumps.', icon: 'n', after: 'knight', rounds: 10 },
  { id: 'routes', title: 'Star hunt', summary: 'A random piece, three stars, the shortest route.', icon: 'star', after: 'pawn', rounds: 10 },
  { id: 'captures', title: 'Safe captures', summary: 'Take every piece without landing on a guarded square.', icon: 'q', after: 'queen', rounds: 8 },
  { id: 'free', title: 'Free pieces', summary: 'Spot the piece nobody defends and take it.', icon: 'target', after: 'free', rounds: 10 },
  { id: 'check', title: 'Give check', summary: 'Find a check in a random position.', icon: 'crosshair', after: 'give-check', rounds: 10 },
  { id: 'mate1', title: 'Mate in one', summary: 'Find the checkmate in one move.', icon: 'crown', after: 'mate-queen', rounds: 10 },
];
export const DRILL_IDS = DRILLS.map((d) => d.id);

const FILES = 'abcdefgh';
export const ALL_SQUARES = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[rnd(list.length)];
const xy = (sq) => [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
const near = (a, b) => { const [ax, ay] = xy(a); const [bx, by] = xy(b); return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 1; };
const light = (sq) => { const [x, y] = xy(sq); return (x + y) % 2 === 1; };

/** k distinct random squares, avoiding `taken` and passing `ok`. */
function squares(k, taken = [], ok = () => true) {
  const out = [];
  let guard = 0;
  while (out.length < k && guard < 500) {
    guard += 1;
    const sq = pick(ALL_SQUARES);
    if (!taken.includes(sq) && !out.includes(sq) && ok(sq)) out.push(sq);
  }
  return out;
}
const pawnSquare = (sq) => sq[1] !== '1' && sq[1] !== '8';

/** Kings that don't touch, and the side not to move is not in check. */
function legal(f) {
  const c = load(f);
  const them = c.turn() === 'w' ? 'b' : 'w';
  const king = squaresOf(c, them, 'k')[0];
  return !king || !c.isAttacked(king.square, c.turn());
}

function retry(make, tries = 4000) {
  for (let i = 0; i < tries; i += 1) {
    const step = make();
    if (step) return step;
  }
  throw new Error('No round found');
}

// ---------------------------------------------------------------- generators
const GEN = {
  coords: () => ({ type: 'coords', text: 'Click the square named below. Wrong clicks cost nothing but time.' }),

  knight: () => retry(() => {
    const [from, to] = squares(2);
    const f = fen(`N${from}`);
    const par = shortest(f, { stars: [to] }, 6);
    if (par < 3 || par > 5) return null;
    return { type: 'stars', fen: f, stars: [to], par, text: `Take the knight to the star in ${par} jumps.` };
  }),

  routes: () => retry(() => {
    const piece = pick(['R', 'B', 'Q', 'K', 'N']);
    const [from] = squares(1);
    const stars = squares(3, [from], (sq) => piece !== 'B' || light(sq) === light(from));
    const f = fen(`${piece}${from}`);
    const par = shortest(f, { stars }, 7);
    if (par < 3 || par > 6) return null;
    return { type: 'stars', fen: f, stars, par, text: `Collect the three stars in ${par} moves.` };
  }, 400),

  captures: () => retry(() => {
    const piece = pick(['Q', 'R', 'Q']);
    const [from] = squares(1);
    const enemies = squares(3, [from], pawnSquare);
    const kinds = enemies.map((sq) => `${pick(['N', 'B', 'R', ''])}${sq}`);
    const f = fen(`${piece}${from}`, kinds.join(' '));
    const c = load(f);
    if (c.isAttacked(from, 'b')) return null;
    const par = shortest(f, { captureAll: true, guarded: true }, 6);
    if (par < 3 || par > 5) return null;
    return { type: 'stars', fen: f, stars: [], captureAll: true, guarded: true, par,
      text: 'Capture every black piece. Never stop on a square a black piece guards.' };
  }, 600),

  free: () => retry(() => {
    const [wk, bk, q] = squares(3);
    if (near(wk, bk)) return null;
    const others = squares(4, [wk, bk, q], pawnSquare);
    const black = [`K${bk}`, ...others.map((sq, i) => `${['N', 'B', 'R', ''][i]}${sq}`)].join(' ');
    const f = fen(`K${wk} Q${q}`, black);
    if (!legal(f)) return null;
    const c = load(f);
    if (c.inCheck()) return null;
    const captures = c.moves({ verbose: true }).filter((m) => m.captured);
    const good = captures.filter((m) => tryGoal(f, m.san, 'free').ok);
    // exactly one free piece, and at least one capture that is a trap
    if (good.length !== 1 || captures.length < 2) return null;
    return { type: 'goal', fen: f, goal: 'free', solution: good[0].san, text: 'One black piece is free. Take it.' };
  }),

  check: () => retry(() => {
    const [wk, bk, a, b] = squares(4);
    if (near(wk, bk)) return null;
    const pawns = squares(2, [wk, bk, a, b], pawnSquare);
    const f = fen(`K${wk} ${pick(['Q', 'R', 'B', 'N'])}${a} ${pick(['R', 'B', 'N'])}${b}`, `K${bk} ${pawns.join(' ')}`);
    if (!legal(f)) return null;
    const c = load(f);
    if (c.inCheck()) return null;
    const moves = c.moves();
    const checks = moves.filter((san) => tryGoal(f, san, 'check').ok);
    if (!checks.length || checks.length > 3) return null;
    return { type: 'goal', fen: f, goal: 'check', solution: checks[0], text: 'Give check.' };
  }),

  mate1: () => retry(() => {
    const edge = ALL_SQUARES.filter((sq) => /[ah]/.test(sq[0]) || /[18]/.test(sq[1]));
    const bk = pick(edge);
    const [wk, a] = squares(2, [bk]);
    if (near(wk, bk)) return null;
    const extra = Math.random() < 0.5 ? ` ${pick(['R', 'B', 'N'])}${squares(1, [bk, wk, a])[0]}` : '';
    const f = fen(`K${wk} ${pick(['Q', 'R'])}${a}${extra}`, `K${bk}`);
    if (!legal(f)) return null;
    const c = load(f);
    if (c.inCheck() || c.isGameOver()) return null;
    const mates = c.moves().filter((san) => tryGoal(f, san, 'mate').ok);
    if (!mates.length) return null;
    return { type: 'goal', fen: f, goal: 'mate', solution: mates[0], text: 'Checkmate in one move.' };
  }, 20000),
};

/** One new round of a drill. */
export const makeRound = (id) => GEN[id]();

/** All the rounds of one run at once (the tests use this; the page makes them one at a time). */
export function makeRounds(id) {
  const drill = DRILLS.find((d) => d.id === id);
  return Array.from({ length: drill.timed ? 1 : drill.rounds }, () => makeRound(id));
}

/** The best score a drill can have (for the timed one: a practical target). */
export const maxScore = (drill) => drill.rounds ?? 30;
