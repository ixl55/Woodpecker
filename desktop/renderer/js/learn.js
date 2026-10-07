// Learn: the lesson map, the lesson player and the practice drills. The curriculum is in lessons.js and
// the drills are generated in drills.js; every move is judged by chess.js through learn-rules.js.
import { Chessground } from '../vendor/chessground.js';
import { api } from './api.js';
import { ALL_SQUARES, DRILLS, makeRound, maxScore } from './drills.js';
import { icons, ring } from './icons.js';
import { LESSONS, UNITS } from './lessons.js';
import {
  defenderMove, dests, guardedBy, keepTurn, load, passes, play, squaresOf,
} from './learn-rules.js';
import { burst, fillRings, pingSquare, shake, stagger } from './motion.js';
import { esc, figurine, toast } from './ui.js';

const view = () => document.getElementById('view');
const REPLY_DELAY = 450;
const NEXT_ROUND_DELAY = 750;
const colorName = (c) => (c === 'w' ? 'white' : 'black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const iconFor = (item, size = 22) => (item.icon.length === 1 ? figurine('w', item.icon) : icons[item.icon](size));
const starsHtml = (n, size = 16) => `<span class="learn-stars" aria-label="${n} of 3 stars">${[1, 2, 3].map((i) =>
  `<i class="${i <= n ? 'on' : ''}">${icons.star(size)}</i>`).join('')}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// what to say after a move that does not reach the goal
const MISS = {
  check: 'That move is not check. Find a move that attacks the king.',
  mate: 'Not checkmate: the king still has a way out.',
  free: 'That is not a free piece: either it can be taken back, or it was not a capture.',
  safe: 'Your piece is still under attack there.',
  protect: 'Your piece is still undefended.',
  castle: 'Castle: move the king two squares towards the rook.',
  enpassant: 'Take the pawn en passant: diagonally, onto the square it skipped.',
  promote: 'Push the pawn to the last rank.',
  accept: 'That move does not follow the idea. Try again.',
  fork: 'That does not attack two valuable targets at once, or your piece can simply be taken.',
  pin: 'No pin yet. Put a piece in front of something more valuable on one line.',
  skewer: 'No skewer yet. Attack a valuable piece that has another piece behind it on the same line.',
  discovered: 'Nothing new is attacked. Move the piece that blocks the line.',
  escape: { king: 'Use the king itself this time.', block: 'Put a piece between the checking piece and your king.', capture: 'Take the piece that gives check.' },
};
const missText = (step) => {
  const [name, arg] = Array.isArray(step.goal) ? step.goal : [step.goal];
  const text = MISS[name];
  return step.miss ?? (typeof text === 'object' ? text[arg] : text);
};

/** Lessons open in order: the first one, then each one after a finished one. */
const openIndex = (done) => {
  const i = LESSONS.findIndex((l) => !done[l.id]);
  return i === -1 ? LESSONS.length : i;
};
const lessonTitle = (id) => LESSONS.find((l) => l.id === id)?.title ?? id;

// ---------------------------------------------------------------- the map
export async function renderLearn(nav, ctx) {
  ctx.setNav('learn');
  const info = await ctx.load(api.learn());
  const { done, drills, achievements } = info;
  const open = openIndex(done);
  const finished = LESSONS.filter((l) => done[l.id]).length;
  const current = LESSONS[open];
  let n = 0;

  const units = UNITS.map((unit, u) => {
    const tiles = unit.lessons.map((lesson) => {
      const i = n;
      n += 1;
      const state = done[lesson.id] ? 'done' : i === open ? 'current' : 'locked';
      const foot = state === 'done' ? starsHtml(done[lesson.id])
        : state === 'current' ? `<span class="learn-go">Start ${icons.next(14)}</span>`
          : `<span class="learn-lock">${icons.lock(14)} Locked</span>`;
      const inner = `<span class="learn-icon">${iconFor(lesson)}</span>
        <span class="learn-tile-text"><strong>${esc(lesson.title)}</strong><span>${esc(lesson.summary)}</span></span>${foot}`;
      return state === 'locked'
        ? `<div class="surface learn-tile locked" aria-disabled="true" title="Finish the lesson before to open this one">${inner}</div>`
        : `<a class="surface learn-tile ${state} lift" href="#/learn/${lesson.id}">${inner}</a>`;
    }).join('');
    const count = unit.lessons.filter((l) => done[l.id]).length;
    return `<section class="section learn-unit">
      <div class="section-head">
        <h2><span class="unit-no">${u + 1}</span>${esc(unit.title)}</h2>
        <span class="muted">${count} of ${unit.lessons.length} done</span>
      </div>
      <p class="muted learn-unit-text">${esc(unit.text)}</p>
      <div class="learn-grid stagger">${tiles}</div>
    </section>`;
  }).join('');

  const drillCards = DRILLS.map((d) => {
    const unlocked = Boolean(done[d.after]);
    const best = drills[d.id];
    const foot = !unlocked ? `<span class="learn-lock">${icons.lock(14)} After ${esc(lessonTitle(d.after))}</span>`
      : best == null ? `<span class="learn-go">Play ${icons.next(14)}</span>`
        : `<span class="drill-best">${icons.trophy(14)} Best ${best}${d.timed ? '' : ` / ${maxScore(d)}`}</span>`;
    const inner = `<span class="learn-icon">${iconFor(d)}</span>
      <span class="learn-tile-text"><strong>${esc(d.title)}</strong><span>${esc(d.summary)}</span></span>${foot}`;
    return unlocked
      ? `<a class="surface learn-tile drill ${best != null ? 'played' : 'current'} lift" href="#/learn/drill/${d.id}">${inner}</a>`
      : `<div class="surface learn-tile locked" aria-disabled="true">${inner}</div>`;
  }).join('');

  const earned = achievements.filter((a) => a.earned).length;
  const ok = await ctx.paint(nav, `
    <header class="page-head learn-head">
      <div>
        <h1>Learn chess</h1>
        ${learnTabs('basics')}
        <p>From how the pieces move to your first tactics. Every exercise is checked on the board, and each lesson opens when you finish the one before.</p>
        <div class="learn-jumps">
          <a class="chip" href="#learn-practice">${icons.target(14)} Practice drills</a>
          <a class="chip" href="#learn-badges">${icons.medal(14)} Badges ${earned} / ${achievements.length}</a>
        </div>
      </div>
      <div class="surface learn-overall">
        ${ring(finished / LESSONS.length, 64, 6)}
        <div><strong>${finished} of ${LESSONS.length}</strong><span class="muted">lessons done</span></div>
        ${current ? `<a class="btn btn-primary" href="#/learn/${current.id}">${finished ? 'Continue' : 'Start'} ${icons.next(16)}</a>`
    : `<a class="btn btn-primary" href="#/solve/new">Solve puzzles ${icons.next(16)}</a>`}
      </div>
    </header>
    ${units}
    <section class="section learn-unit" id="learn-practice">
      <div class="section-head"><h2><span class="unit-no">${icons.target(16)}</span>Practice drills</h2>
        <span class="muted">New rounds every time</span></div>
      <p class="muted learn-unit-text">Short games to make the basics automatic. Each drill opens with the lesson it trains.</p>
      <div class="learn-grid stagger">${drillCards}</div>
    </section>
    <section class="section" id="learn-badges">
      <div class="section-head"><h2>Badges</h2><span class="muted">${earned} of ${achievements.length} earned</span></div>
      <ul class="badges stagger">${achievements.map(ctx.badgeHtml).join('')}</ul>
    </section>`, () => {
    view().querySelectorAll('.stagger').forEach((g) => stagger(g));
    fillRings(view());
  });
  if (!ok) return;
  // the in-page jumps must not be read as routes
  view().querySelector('.learn-jumps').addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#learn-"]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  view().querySelector('#learn-badges').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reward]');
    if (!btn) return;
    const a = achievements.find((x) => x.key === btn.dataset.reward);
    ctx.rewardDialog(a.reward, a, ctx.avatar());
  });
}

/** Marked squares, stars and arrows, drawn over the board and turned with it. */
export function overlayHtml(orientation, { marks = [], stars = [], arrows = [], faint = false } = {}) {
  const cell = (sq) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    return orientation === 'white' ? [f, 7 - r] : [7 - f, r];
  };
  const at = (sq) => { const [x, y] = cell(sq); return `left:${x * 12.5}%;top:${y * 12.5}%`; };
  const out = [
    ...marks.map((sq) => `<span class="learn-mark" style="${at(sq)}"></span>`),
    ...stars.map((sq) => `<span class="learn-star" style="${at(sq)}">${icons.star(28)}</span>`),
  ];
  if (arrows.length) {
    const lines = arrows.map(([a, b]) => {
      const [x1, y1] = cell(a).map((v) => v + 0.5);
      const [x2, y2] = cell(b).map((v) => v + 0.5);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = (len - 0.32) / len; // stop short so the head sits inside the target square
      return `<line x1="${x1}" y1="${y1}" x2="${x1 + (x2 - x1) * k}" y2="${y1 + (y2 - y1) * k}"/>`;
    }).join('');
    out.push(`<svg class="learn-arrows ${faint ? 'faint' : ''}" viewBox="0 0 8 8" preserveAspectRatio="none">
      <defs><marker id="learn-head-${faint ? 'f' : 'n'}" viewBox="0 0 10 10" refX="3" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">
        <path d="M0 0L10 5L0 10z"/></marker></defs><g style="marker-end:url(#learn-head-${faint ? 'f' : 'n'})">${lines}</g></svg>`);
  }
  return out.join('');
}

/** The Basics / Openings switch at the top of the Learn pages. */
export function learnTabs(active) {
  const tab = (key, href, icon, label) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icons[icon](16)} ${label}</a>`;
  return `<nav class="segmented learn-tabs" aria-label="Learn sections">${tab('basics', '#/learn', 'book', 'Basics')}${tab('openings', '#/learn/openings', 'layers', 'Openings')}</nav>`;
}

export function boardPage(label) {
  return `
    <section class="solve learn-solve">
      <div class="board-col">
        <div class="board-wrap" id="board-wrap"><div class="board" id="board"></div><div class="learn-marks" id="marks" aria-hidden="true"></div><div id="coords-slot"></div></div>
      </div>
      <aside class="surface panel enter learn-panel" id="panel" aria-label="${label}"></aside>
    </section>`;
}

// ---------------------------------------------------------------- one lesson
export async function renderLesson(nav, ctx, id) {
  ctx.setNav('learn');
  const index = LESSONS.findIndex((l) => l.id === id);
  const { done } = await ctx.load(api.learn());
  if (index === -1 || index > openIndex(done)) {
    const current = LESSONS[openIndex(done)];
    await ctx.paint(nav, `<div class="surface empty">${icons.lock(40)}
      <h2>${index === -1 ? 'This lesson does not exist' : 'This lesson is still locked'}</h2>
      <p>Lessons open one after another. ${current ? `Your next lesson is ${esc(current.title)}.` : ''}</p>
      <a class="btn btn-primary" href="#/learn${current ? `/${current.id}` : ''}">${current ? 'Go to it' : 'All lessons'}</a></div>`);
    return;
  }
  if (!await ctx.paint(nav, boardPage('Lesson'))) return;
  const player = new Player({ lesson: LESSONS[index] }, ctx);
  ctx.onLeave(() => player.destroy());
}

// ---------------------------------------------------------------- one drill
export async function renderDrill(nav, ctx, id) {
  ctx.setNav('learn');
  const drill = DRILLS.find((d) => d.id === id);
  const { done, drills } = await ctx.load(api.learn());
  if (!drill || !done[drill.after]) {
    await ctx.paint(nav, `<div class="surface empty">${icons.lock(40)}
      <h2>${drill ? 'This drill is still locked' : 'This drill does not exist'}</h2>
      <p>${drill ? `It opens when you finish the lesson ${esc(lessonTitle(drill.after))}.` : ''}</p>
      <a class="btn btn-primary" href="#/learn">All lessons</a></div>`);
    return;
  }
  if (!await ctx.paint(nav, boardPage('Drill'))) return;
  const player = new Player({ drill, best: drills[id] ?? null }, ctx);
  ctx.onLeave(() => player.destroy());
}

/**
 * Plays a lesson (fixed steps, stars for few mistakes) or a drill (generated rounds, a score).
 * In a drill a round counts when it is solved without a mistake (and within par for star courses).
 */
class Player {
  constructor({ lesson, drill, best }, ctx) {
    this.ctx = ctx;
    this.lesson = lesson;
    this.drill = drill;
    this.best = best;
    this.steps = lesson ? lesson.steps : [];
    this.stepNo = 0;
    this.mistakes = 0;
    this.score = 0;
    this.timers = [];
    this.wrap = document.getElementById('board-wrap');
    this.panel = document.getElementById('panel');
    this.cg = Chessground(document.getElementById('board'), {
      coordinates: false,
      trustAllEvents: Boolean(window.__drive), // set only by the development snapshot script
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      drawable: { enabled: false },
      movable: { free: false, showDests: true, events: { after: (o, d) => this.onMove(o, d) } },
      events: { select: (key) => this.onSelect(key) },
    });
    this.keys = (e) => {
      if (e.key === 'Enter' && !e.target.closest('input, textarea, button, a')) this.panel.querySelector('#continue')?.click();
    };
    document.addEventListener('keydown', this.keys);
    this.panel.addEventListener('click', (e) => this.onPanel(e));
    if (drill) this.newRun();
    else this.start();
  }

  destroy() {
    this.clearTimers();
    clearInterval(this.clock);
    document.removeEventListener('keydown', this.keys);
    this.cg.destroy();
  }

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  get step() {
    return this.steps[this.stepNo];
  }

  get total() {
    return this.drill ? (this.drill.rounds ?? 1) : this.steps.length;
  }

  // ------------------------------------------------------------ drills
  newRun() {
    clearInterval(this.clock);
    this.score = 0;
    this.stepNo = 0;
    this.mistakes = 0;
    this.finished = false;
    this.steps = [makeRound(this.drill.id)];
    this.prepare();
    if (this.drill.timed) {
      this.endsAt = performance.now() + this.drill.timed * 1000;
      this.clock = setInterval(() => this.tick(), 200);
    }
    this.start();
  }

  /** Make the next round while this one is played, so moving on is instant. */
  prepare() {
    if (this.drill.timed || this.steps.length >= this.total) return;
    this.later(() => { this.steps.push(makeRound(this.drill.id)); }, 60);
  }

  tick() {
    const left = Math.max(0, this.endsAt - performance.now());
    const el = this.panel.querySelector('#drill-clock');
    if (el) el.textContent = `${Math.ceil(left / 1000)}s`;
    if (!left) {
      clearInterval(this.clock);
      this.finishDrill();
    }
  }

  // ------------------------------------------------------------ step setup
  start() {
    const s = this.step;
    this.clearTimers();
    if (this.drill) this.prepare();
    this.failed = false;
    this.solved = s.type === 'show';
    this.feedback = null;
    this.moves = 0;
    this.ply = 0;
    this.target = 0;
    this.clean = true;
    this.stars = [...(s.stars ?? [])];
    this.busy = false;
    this.replying = false;
    this.chess = s.fen ? load(s.fen) : null;
    this.color = s.fen ? s.fen.split(' ')[1] : 'w';
    // demonstrations are shown from White's side; exercises from the side you play
    this.orientation = s.orient ?? (['show', 'quiz', 'squares'].includes(s.type) ? 'white' : colorName(this.color));
    if (s.type === 'coords') this.coordTarget = this.randomSquare();
    this.sync();
    this.drawPanel();
  }

  randomSquare() {
    let sq;
    do sq = ALL_SQUARES[Math.floor(Math.random() * 64)]; while (sq === this.coordTarget);
    return sq;
  }

  /** Put the position on the board and allow moves when the step takes them. */
  sync(lastMove) {
    const s = this.step;
    const moving = ['stars', 'goal', 'line', 'play'].includes(s.type) && !this.solved && !this.busy && !this.finished;
    const turn = this.chess?.turn() ?? 'w';
    this.cg.set({
      fen: this.chess ? this.chess.fen() : '8/8/8/8/8/8/8/8',
      orientation: this.orientation,
      turnColor: colorName(turn),
      lastMove,
      check: this.chess?.inCheck() ? colorName(turn) : false,
      selected: undefined,
      movable: { color: moving ? colorName(this.color) : undefined, dests: moving ? dests(this.chess) : new Map() },
    });
    const slot = document.getElementById('coords-slot');
    if (slot) slot.innerHTML = this.ctx.coordsHtml(this.orientation);
    this.drawMarks();
  }

  drawMarks() {
    const s = this.step;
    document.getElementById('marks').innerHTML = overlayHtml(this.orientation, { marks: s.marks, stars: this.stars, arrows: s.arrows });
  }

  // ------------------------------------------------------------ input
  onSelect(key) {
    const s = this.step;
    if (s.type === 'coords') { this.coordClick(key); return; }
    if (s.type !== 'squares' || this.solved) return;
    const [want] = s.targets[this.target];
    if (want.split('|').includes(key)) {
      pingSquare(this.wrap, key, this.orientation, 'ok');
      this.target += 1;
      this.feedback = null;
      if (this.target === s.targets.length) this.succeed();
      else this.drawPanel();
    } else {
      pingSquare(this.wrap, key, this.orientation, 'bad');
      this.mistakes += 1;
      this.feedback = { kind: 'bad', text: `That is ${key}.` };
      this.drawPanel();
    }
    this.cg.set({ selected: undefined });
  }

  coordClick(key) {
    this.cg.set({ selected: undefined });
    if (this.finished) return;
    if (key === this.coordTarget) {
      pingSquare(this.wrap, key, this.orientation, 'ok');
      this.score += 1;
      this.coordTarget = this.randomSquare();
      this.feedback = null;
    } else {
      pingSquare(this.wrap, key, this.orientation, 'bad');
      this.feedback = { kind: 'bad', text: `That was ${key}.` };
    }
    this.drawPanel();
  }

  onMove(orig, dest) {
    const s = this.step;
    const before = load(this.chess.fen());
    const move = play(this.chess, orig, dest);
    if (!move) { this.sync(); return; }
    if (s.type === 'stars') this.starMove(move, before);
    else if (s.type === 'goal') this.goalMove(move, before);
    else if (s.type === 'line') this.lineMove(move, before);
    else if (s.type === 'play') this.playMove(move);
  }

  starMove(move, before) {
    const s = this.step;
    if (s.guarded && guardedBy(this.chess, move.to, other(this.color))) {
      this.mistake();
      this.miss(before, move, 'A black piece guards that square: your piece would be taken there.');
      return;
    }
    this.moves += 1;
    keepTurn(this.chess, this.color);
    this.stars = this.stars.filter((sq) => sq !== move.to);
    this.sync([move.from, move.to]);
    const left = this.stars.length + (s.captureAll ? squaresOf(this.chess, other(this.color)).length : 0);
    if (!left) {
      const over = this.moves > s.par;
      if (over) this.mistake();
      this.succeed(over
        ? `Done in ${this.moves} moves. It can be done in ${s.par}: look for the shorter way next time.`
        : `Done in ${this.moves} moves, the shortest way.`);
    } else {
      pingSquare(this.wrap, move.to, this.orientation, 'ok');
      this.drawPanel();
    }
  }

  goalMove(move, before) {
    const s = this.step;
    if (passes(s.goal, this.chess, move, before)) {
      this.sync([move.from, move.to]);
      this.succeed();
      return;
    }
    this.mistake();
    if (this.drill) {
      // in a drill a miss shows the answer and moves on
      this.busy = true;
      this.sync([move.from, move.to]);
      shake(this.wrap);
      this.later(() => this.showMe(`${missText(s)} One answer: ${s.solution}.`), 700);
      return;
    }
    this.miss(before, move, missText(s));
  }

  lineMove(move, before) {
    const s = this.step;
    const expected = load(before.fen()).move(s.moves[this.ply]);
    const last = this.ply === s.moves.length - 1;
    const right = (move.from === expected.from && move.to === expected.to) || (last && this.chess.isCheckmate());
    if (!right) {
      this.mistake();
      this.miss(before, move, s.miss ?? 'Not this move. Look at the checks first.');
      return;
    }
    this.ply += 1;
    if (this.ply >= s.moves.length) {
      this.sync([move.from, move.to]);
      this.succeed();
      return;
    }
    this.reply([move.from, move.to], () => this.chess.move(s.moves[this.ply]), (reply) => {
      this.ply += 1;
      if (this.ply >= s.moves.length) this.succeed();
      else this.drawPanel();
      return reply;
    });
  }

  playMove(move) {
    const s = this.step;
    this.moves += 1;
    if (this.chess.isCheckmate()) {
      this.sync([move.from, move.to]);
      if (this.moves > s.par) this.mistake();
      this.succeed(`Checkmate in ${this.moves} moves.${this.moves > s.par ? ` Strong players need about ${s.par}.` : ' A clean finish.'}`);
      return;
    }
    if (this.chess.isStalemate()) {
      this.sync([move.from, move.to]);
      this.fail('Stalemate: the black king has no move but is not in check. That is a draw. Leave it a square until you can mate.');
      return;
    }
    if (this.moves >= s.limit) {
      this.sync([move.from, move.to]);
      this.fail(`You used ${s.limit} moves without mating. Push the king to the edge first, then mate.`);
      return;
    }
    this.reply([move.from, move.to], () => {
      const r = defenderMove(this.chess);
      return this.chess.move(r.san);
    }, (reply) => {
      if (reply.captured) this.fail('The king took a piece you left unprotected. Keep your pieces away from the king, or protected.');
      else if (this.chess.isInsufficientMaterial()) this.fail('No mating material left. Start again.');
      else this.drawPanel();
    });
  }

  /** The opponent answers after a short pause. */
  reply(last, make, then) {
    this.busy = true;
    this.replying = true;
    this.sync(last);
    this.drawPanel();
    this.later(() => {
      const r = make();
      this.busy = false;
      this.replying = false;
      this.sync([r.from, r.to]);
      then(r);
    }, REPLY_DELAY);
  }

  mistake() {
    this.mistakes += 1;
    this.clean = false;
  }

  /** Show the wrong move for a moment, then put the position back. */
  miss(before, move, text) {
    this.busy = true;
    this.sync([move.from, move.to]);
    shake(this.wrap);
    pingSquare(this.wrap, move.to, this.orientation, 'bad');
    this.feedback = { kind: 'bad', text };
    this.drawPanel();
    this.later(() => {
      this.chess = before;
      this.busy = false;
      this.sync();
      this.drawPanel();
    }, 650);
  }

  fail(text) {
    this.mistake();
    this.failed = true;
    this.busy = true;
    this.feedback = { kind: 'bad', text };
    this.sync();
    this.drawPanel();
  }

  succeed(text) {
    this.solved = true;
    this.busy = false;
    if (this.drill) {
      if (this.clean) this.score += 1;
      this.feedback = { kind: this.clean ? 'ok' : 'bad', text: text ?? (this.clean ? 'Correct.' : 'Solved, but not first time.') };
      this.sync(this.cg.state.lastMove);
      this.drawPanel();
      this.later(() => this.next(), this.clean ? NEXT_ROUND_DELAY : NEXT_ROUND_DELAY * 2);
      return;
    }
    this.feedback = { kind: 'ok', text: [text, this.step.after].filter(Boolean).join(' ') || 'Well done.' };
    this.sync(this.cg.state.lastMove);
    this.drawPanel();
    this.panel.querySelector('#continue')?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ panel
  onPanel(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'continue') this.next();
    else if (btn.id === 'restart') this.start();
    else if (btn.id === 'show-me') { this.mistake(); this.showMe(); }
    else if (btn.id === 'skip') { this.clean = false; this.mistakes += 1; this.showMe('Skipped.'); }
    else if (btn.id === 'again') { if (this.drill) this.newRun(); else { this.stepNo = 0; this.mistakes = 0; this.start(); } }
    else if (btn.dataset.choice !== undefined) this.answer(Number(btn.dataset.choice), btn);
  }

  answer(choice, btn) {
    const s = this.step;
    if (this.solved) return;
    if (choice === s.answer) {
      btn.classList.add('right');
      this.succeed();
    } else {
      this.mistake();
      shake(btn);
      btn.classList.add('wrong');
      btn.disabled = true;
      this.feedback = { kind: 'bad', text: 'Not quite. Try another answer.' };
      this.drawPanel(true);
    }
  }

  /** Play the reference answer (a star course shows nothing to play and just moves on). */
  showMe(text) {
    const s = this.step;
    this.clearTimers();
    if (s.type === 'goal' || s.type === 'line') {
      this.chess = load(s.fen);
      const moves = s.type === 'goal' ? [s.solution] : s.moves;
      let last;
      for (const san of moves) last = this.chess.move(san);
      this.succeed(text ?? `The answer: ${moves.join(' ')}.`);
      this.sync([last.from, last.to]);
    } else {
      this.succeed(text);
    }
  }

  next() {
    this.clearTimers();
    if (this.stepNo < this.total - 1) {
      this.stepNo += 1;
      if (this.drill && !this.steps[this.stepNo]) this.steps.push(makeRound(this.drill.id));
      this.start();
    } else if (this.drill) {
      this.finishDrill();
    } else {
      this.finishLesson();
    }
  }

  async finishLesson() {
    const stars = this.mistakes === 0 ? 3 : this.mistakes <= 2 ? 2 : 1;
    let result = null;
    try { result = await api.learnDone(this.lesson.id, stars); } catch { toast('Your progress was not saved.', 'bad', icons.x(18)); }
    const nextLesson = LESSONS[LESSONS.indexOf(this.lesson) + 1];
    const drill = DRILLS.find((d) => d.after === this.lesson.id);
    this.finished = true;
    this.sync(this.cg.state.lastMove);
    burst(this.wrap);
    this.panel.innerHTML = `
      <section class="panel-head learn-done">
        <span class="eyebrow">Lesson complete</span>
        <h2>${esc(this.lesson.title)}</h2>
        ${starsHtml(stars, 30)}
        <p class="muted">${stars === 3 ? 'Perfect: no mistakes.' : `${plural(this.mistakes, 'mistake')}. Repeat the lesson any time for three stars.`}</p>
      </section>
      ${drill ? `<section><p>New drill unlocked: <strong>${esc(drill.title)}</strong>.</p>
        <a class="btn wide" href="#/learn/drill/${drill.id}">${icons.target(18)} Play ${esc(drill.title)}</a></section>` : ''}
      ${this.lesson.theme ? `<section><p>Now find this pattern in real games.</p>
        <a class="btn wide" href="#/solve/theme/${this.lesson.theme}">${icons.target(18)} Practise with puzzles</a></section>` : ''}
      <section class="actions-grid">
        ${nextLesson && result ? `<a class="btn btn-primary wide" id="continue-next" href="#/learn/${nextLesson.id}">Next: ${esc(nextLesson.title)} ${icons.next(16)}</a>`
    : !nextLesson ? `<a class="btn btn-primary wide" href="#/solve/new">You finished every lesson. Solve puzzles ${icons.next(16)}</a>` : ''}
        <button type="button" id="again">${icons.retry(18)} Repeat</button>
        <a class="btn" href="#/learn">${icons.grid(18)} All lessons</a>
      </section>`;
    this.panel.querySelector('#continue-next')?.focus({ preventScroll: true });
    if (result) this.ctx.celebrate(result);
  }

  async finishDrill() {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.clock);
    this.clearTimers();
    this.sync(this.cg.state.lastMove);
    let result = null;
    try { result = await api.drillDone(this.drill.id, this.score); } catch { toast('Your score was not saved.', 'bad', icons.x(18)); }
    const prev = result?.previous_best;
    const record = result && (prev == null || this.score > prev);
    this.best = result?.drills?.[this.drill.id] ?? this.best;
    if (record && this.score > 0) burst(this.wrap);
    const out = this.drill.timed ? `${plural(this.score, 'square')} in ${this.drill.timed} seconds` : `${this.score} of ${this.total} rounds right first time`;
    this.panel.innerHTML = `
      <section class="panel-head learn-done">
        <span class="eyebrow">${esc(this.drill.title)}</span>
        <h2 class="drill-score">${this.score}${this.drill.timed ? '' : `<small> / ${this.total}</small>`}</h2>
        <p>${out}.</p>
        <p class="muted">${record && prev != null ? `${icons.trophy(14)} New best. Your old best was ${prev}.` : this.best != null ? `Your best: ${this.best}.` : ''}</p>
      </section>
      <section class="actions-grid">
        <button type="button" class="btn-primary wide" id="again">${icons.retry(18)} Play again</button>
        <a class="btn wide" href="#/learn">${icons.grid(18)} All lessons and drills</a>
      </section>`;
    this.panel.querySelector('#again').focus({ preventScroll: true });
    if (result) this.ctx.celebrate(result);
  }

  drawPanel(keepChoices = false) {
    const s = this.step;
    if (keepChoices && s.type === 'quiz') {
      // keep the disabled wrong answers; only refresh the feedback
      this.panel.querySelector('.learn-feedback').outerHTML = this.feedbackHtml(this.feedback);
      return;
    }
    const total = this.total;
    const head = this.drill ? this.drillHead() : this.lessonHead();
    const moving = ['goal', 'line', 'stars', 'play'].includes(s.type);
    let actions = '';
    if (this.drill) {
      actions = this.solved || this.drill.timed ? '' : `<button type="button" id="skip">${icons.next(18)} Skip</button>`;
    } else if (this.solved) {
      actions = `<button type="button" class="btn-primary wide" id="continue">${this.stepNo < total - 1 ? 'Continue' : 'Finish lesson'} ${icons.next(16)}</button>`;
    } else {
      actions = [
        this.failed || (moving && s.type !== 'goal') ? `<button type="button" id="restart">${icons.retry(18)} Start again</button>` : '',
        ['goal', 'line'].includes(s.type) ? `<button type="button" id="show-me">${icons.eye(18)} Show me</button>` : '',
      ].join('');
    }
    const side = this.chess && moving ? `<div class="to-move"><span class="swatch ${this.replying ? colorName(other(this.color)) : colorName(this.color)}"></span>${
      this.replying ? 'Opponent to move' : `You play ${colorName(this.color)}`}</div>` : '';
    this.panel.innerHTML = `
      ${head}
      <section class="learn-task">
        ${side}
        <p class="learn-text">${esc(s.text)}</p>
        ${this.taskHtml()}
      </section>
      ${this.feedbackHtml(this.feedback)}
      ${actions ? `<section class="actions-grid">${actions}</section>` : ''}`;
  }

  lessonHead() {
    const total = this.total;
    const dots = this.steps.map((_, i) => `<i class="${i < this.stepNo || (i === this.stepNo && this.solved) ? 'done' : ''} ${i === this.stepNo ? 'now' : ''}"></i>`).join('');
    return `<section class="panel-head">
        <div class="top"><span class="eyebrow">Unit ${this.lesson.unitNo} · ${esc(this.lesson.unit.title)}</span><span class="muted">Step ${this.stepNo + 1} of ${total}</span></div>
        <h2 class="learn-title">${esc(this.lesson.title)}</h2>
        <div class="steps learn-dots" role="img" aria-label="Step ${this.stepNo + 1} of ${total}">${dots}</div>
      </section>`;
  }

  drillHead() {
    const d = this.drill;
    const right = d.timed
      ? `<span class="drill-clock">${icons.clock(16)} <span id="drill-clock">${Math.ceil(Math.max(0, this.endsAt - performance.now()) / 1000)}s</span></span>`
      : `<span class="muted">Round ${this.stepNo + 1} of ${this.total}</span>`;
    return `<section class="panel-head">
        <div class="top"><span class="eyebrow">Practice drill</span>${right}</div>
        <h2 class="learn-title">${esc(d.title)}</h2>
        <div class="drill-meta"><span>${icons.check(14)} Score <strong>${this.score}</strong></span>${this.best != null ? `<span class="muted">${icons.trophy(14)} Best ${this.best}</span>` : ''}</div>
      </section>`;
  }

  feedbackHtml(fb) {
    return `<section class="learn-feedback ${fb ? fb.kind : ''}" aria-live="polite">${fb
      ? `${fb.kind === 'ok' ? icons.check(18) : icons.x(18)}<p>${esc(fb.text)}</p>` : ''}</section>`;
  }

  taskHtml() {
    const s = this.step;
    if (s.type === 'coords') {
      return `<p class="coord-target" aria-live="polite">${this.coordTarget}</p>`;
    }
    if (s.type === 'squares') {
      if (this.solved) return '';
      return `<p class="learn-prompt">${icons.target(18)} ${esc(s.targets[this.target][1])} <span class="muted">(${this.target + 1} of ${s.targets.length})</span></p>`;
    }
    if (s.type === 'stars') {
      const enemies = s.captureAll ? squaresOf(this.chess, other(this.color)).length : 0;
      const left = s.captureAll ? `${plural(enemies, 'piece')} left` : `${plural(this.stars.length, 'star')} left`;
      return `<p class="learn-count">${icons.star(16)} ${left} <span class="muted">· ${plural(this.moves, 'move')}, best is ${s.par}</span></p>`;
    }
    if (s.type === 'play') {
      return `<p class="learn-count">${icons.clock(16)} ${plural(this.moves, 'move')} <span class="muted">· mate within ${s.limit}</span></p>`;
    }
    if (s.type === 'quiz') {
      return `<div class="learn-choices">${s.choices.map((c, i) =>
        `<button type="button" data-choice="${i}" class="${this.solved && i === s.answer ? 'right' : ''}" ${this.solved ? 'disabled' : ''}>${esc(c)}</button>`).join('')}</div>`;
    }
    return '';
  }
}
