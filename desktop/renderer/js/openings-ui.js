// Learn -> Openings: the repertoire map, and a player that walks a line move by move (Learn) or asks for
// it from memory (Practice). Lines played with a mistake come back at once for review; clean runs push
// the next review further away (the engine keeps the schedule).
import { Chessground } from '../vendor/chessground.js';
import { Chess } from '../vendor/chess.js';
import { api } from './api.js';
import { icons, ring } from './icons.js';
import { boardPage, learnTabs, overlayHtml } from './learn.js';
import { OPENINGS, learnerPlies } from './openings.js';
import { burst, fillRings, pingSquare, shake, stagger } from './motion.js';
import { esc, sanToHtml, toast } from './ui.js';

const view = () => document.getElementById('view');
const REPLY_DELAY = 420;
const MASTERED_AT = 3;
const SIDES = {
  w: { label: 'White', title: 'White repertoire' },
  b: { label: 'Black', title: 'Black repertoire' },
  traps: { label: 'Traps', title: 'Opening traps' },
};
const colorName = (c) => (c === 'w' ? 'white' : 'black');
const groupOf = (o) => (o.kind === 'trap' ? 'traps' : o.side);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where a line stands: new, learning, mastered; and whether it is due for review. */
function lineState(rec, now) {
  if (!rec) return { runs: 0, streak: 0, mastered: false, due: false };
  const [streak, due, runs, mastered] = rec;
  return { runs, streak, mastered: Boolean(mastered), due: runs > 0 && due <= now };
}

/** "1.e4 e5 2.Nf3 Nc6 3.Bc4" for the first `plies` moves. */
function movesText(moves, plies = moves.length) {
  return moves.slice(0, plies).map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

/** The position a card shows: the end of the main line, or just before the mate for a trap. */
function cardFen(o) {
  const c = new Chess();
  const moves = o.lines[0].moves;
  moves.slice(0, o.kind === 'trap' ? moves.length - 1 : moves.length).forEach((san) => c.move(san));
  return c.fen();
}

function dueLines(lines, now) {
  return OPENINGS.flatMap((o) => o.lines.filter((l) => lineState(lines[l.id], now).due).map((l) => l.id));
}

// ---------------------------------------------------------------- the map
export async function renderOpenings(nav, ctx, params) {
  ctx.setNav('learn');
  const group = SIDES[params.get('side')] ? params.get('side') : 'w';
  const { lines, now, achievements } = await ctx.load(api.openings());
  const all = OPENINGS.flatMap((o) => o.lines);
  const mastered = all.filter((l) => lineState(lines[l.id], now).mastered).length;
  const due = dueLines(lines, now);
  const shown = OPENINGS.filter((o) => groupOf(o) === group);
  const count = (g) => OPENINGS.filter((o) => groupOf(o) === g).length;

  const cards = shown.map((o) => {
    const states = o.lines.map((l) => lineState(lines[l.id], now));
    const done = states.filter((s) => s.mastered).length;
    const dueHere = states.filter((s) => s.due).length;
    const started = states.some((s) => s.runs);
    return `<a class="surface opening-card lift" href="#/learn/opening/${o.id}">
      <div class="board-mini" data-fen="${cardFen(o)}" data-orient="${colorName(o.side)}" role="img" aria-label="${esc(o.name)}"></div>
      <div class="opening-card-body">
        <div class="opening-card-top"><strong>${esc(o.name)}</strong>${dueHere ? `<span class="chip failed">${icons.repeat(12)} ${dueHere} due</span>` : ''}</div>
        <span class="opening-moves">${esc(movesText(o.lines[0].moves, o.kind === 'trap' ? Math.min(4, o.lines[0].moves.length - 1) : 6))}</span>
        <div class="opening-card-foot">
          ${o.kind === 'trap'
    ? `<span class="chip ${o.proof === 'mate' ? 'rank' : 'solved'}">${esc(o.result)}</span><span class="muted"><span class="swatch-mini ${colorName(o.side)}"></span> You play ${o.side === 'w' ? 'White' : 'Black'}</span>`
    : `<span class="chip">${o.eco}</span><span class="muted">${plural(o.lines.length, 'line')}</span>`}
          ${started ? `<span class="opening-progress" title="${done} of ${o.lines.length} mastered">${o.lines.map((_, i) =>
    `<i class="${states[i].mastered ? 'on' : states[i].runs ? 'half' : ''}"></i>`).join('')}</span>` : ''}
        </div>
      </div>
    </a>`;
  }).join('');

  const earned = achievements.filter((a) => a.earned).length;
  const ok = await ctx.paint(nav, `
    <header class="page-head learn-head">
      <div>
        <h1>Learn chess</h1>
        ${learnTabs('openings')}
        <p>Learn the main lines move by move, then play them from memory. A line you get wrong comes back for review; three clean runs master it.</p>
      </div>
      <div class="surface learn-overall">
        ${ring(mastered / all.length, 64, 6)}
        <div><strong>${mastered} of ${all.length}</strong><span class="muted">lines mastered</span></div>
        ${due.length ? `<a class="btn btn-primary" href="#/learn/openings/review">${icons.repeat(16)} Review ${due.length}</a>`
    : '<span class="muted learn-nothing-due">Nothing due</span>'}
      </div>
    </header>
    <div class="opening-filter">
      <nav class="segmented" aria-label="Which openings">
        ${Object.entries(SIDES).map(([key, s]) => `<a href="#/learn/openings?side=${key}" class="${key === group ? 'active' : ''}" ${key === group ? 'aria-current="page"' : ''}>
          ${key === 'traps' ? icons.crosshair(15) : `<span class="swatch-mini ${colorName(key)}"></span>`} ${s.label} <span class="count-mini">${count(key)}</span></a>`).join('')}
      </nav>
      <p class="muted">${group === 'traps' ? 'Short tricks for both colours that win fast. Know them so you can play them, and so you never fall for them.'
    : `Openings where you play ${group === 'w' ? 'White' : 'Black'}. Each card shows the main line; open it to see every line.`}</p>
    </div>
    <div class="opening-grid stagger">${cards}</div>
    <section class="section" id="opening-badges">
      <div class="section-head"><h2>Opening badges</h2><span class="muted">${earned} of ${achievements.length} earned</span></div>
      <ul class="badges stagger">${achievements.map(ctx.badgeHtml).join('')}</ul>
    </section>`, () => {
    view().querySelectorAll('.stagger').forEach((g) => stagger(g));
    fillRings(view());
    view().querySelectorAll('.opening-card .board-mini').forEach((el) => ctx.miniBoard(el, el.dataset.fen, { orientation: el.dataset.orient }));
  });
  if (!ok) return;
  view().querySelector('#opening-badges').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reward]');
    if (!btn) return;
    const a = achievements.find((x) => x.key === btn.dataset.reward);
    ctx.rewardDialog(a.reward, a, ctx.avatar());
  });
}

// ---------------------------------------------------------------- one opening, or the review queue
export async function renderOpening(nav, ctx, id, params) {
  ctx.setNav('learn');
  const o = OPENINGS.find((x) => x.id === id);
  if (!o) {
    await ctx.paint(nav, `<div class="surface empty">${icons.info(40)}<h2>This opening does not exist</h2>
      <a class="btn btn-primary" href="#/learn/openings">All openings</a></div>`);
    return;
  }
  const { lines, now } = await ctx.load(api.openings());
  if (!await ctx.paint(nav, boardPage('Opening'))) return;
  const index = Math.min(o.lines.length - 1, Math.max(0, Number(params.get('line') ?? 0) || 0));
  const player = new LinePlayer(ctx, { queue: o.lines.map((l) => l.id), opening: o, index, mode: params.get('mode') === 'practice' ? 'practice' : 'learn', lines, now });
  ctx.onLeave(() => player.destroy());
}

export async function renderOpeningReview(nav, ctx) {
  ctx.setNav('learn');
  const { lines, now } = await ctx.load(api.openings());
  const queue = dueLines(lines, now);
  if (!queue.length) {
    await ctx.paint(nav, `<div class="surface empty">${icons.check(40)}<h2>No lines are due</h2>
      <p>Lines you get wrong come back here. Practise new lines to fill your repertoire.</p>
      <a class="btn btn-primary" href="#/learn/openings">All openings</a></div>`);
    return;
  }
  if (!await ctx.paint(nav, boardPage('Review'))) return;
  const first = OPENINGS.find((o) => o.lines.some((l) => l.id === queue[0]));
  const player = new LinePlayer(ctx, { queue, review: true, opening: first, index: first.lines.findIndex((l) => l.id === queue[0]), mode: 'practice', lines, now });
  ctx.onLeave(() => player.destroy());
}

const openingOf = (lineId) => OPENINGS.find((o) => o.lines.some((l) => l.id === lineId));

class LinePlayer {
  constructor(ctx, { queue, review = false, opening, index, mode, lines, now }) {
    this.ctx = ctx;
    this.queue = queue;
    this.review = review;
    this.pos = review ? 0 : index;
    this.records = lines;
    this.now = now;
    this.opening = opening;
    this.index = index;
    this.mode = mode;
    this.timers = [];
    this.wrap = document.getElementById('board-wrap');
    this.panel = document.getElementById('panel');
    this.cg = Chessground(document.getElementById('board'), {
      coordinates: false,
      trustAllEvents: Boolean(window.__drive), // set only by the development snapshot script
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      drawable: { enabled: false },
      movable: { free: false, showDests: true, events: { after: (o, d) => this.onMove(o, d) } },
    });
    this.keys = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
      if (this.mode === 'learn') {
        if (e.key === 'ArrowRight') { e.preventDefault(); this.goto(this.ply + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.goto(this.ply - 1); }
        if (e.key === 'Home') { e.preventDefault(); this.goto(0); }
        if (e.key === 'End') { e.preventDefault(); this.goto(this.line.moves.length); }
      }
      if (e.key === 'Enter' && !e.target.closest('button, a')) this.panel.querySelector('.btn-primary')?.click();
    };
    document.addEventListener('keydown', this.keys);
    this.panel.addEventListener('click', (e) => this.onPanel(e));
    this.load();
  }

  destroy() {
    this.clear();
    document.removeEventListener('keydown', this.keys);
    this.cg.destroy();
  }

  clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  get line() {
    return this.opening.lines[this.index];
  }

  get side() {
    return this.opening.side;
  }

  /** Is ply `i` a move of the learner? */
  mine(i) {
    return (i % 2 === 0) === (this.side === 'w');
  }

  /** Start the current line in the current mode. */
  load() {
    this.clear();
    this.chess = new Chess();
    this.ply = 0;
    this.mistakes = 0;
    this.tries = 0; // wrong tries on the current move
    this.hint = false;
    this.waiting = false;
    this.done = false;
    this.result = null;
    this.feedback = null;
    this.orientation = colorName(this.side);
    if (!this.review) {
      const url = `#/learn/opening/${this.opening.id}?line=${this.index}&mode=${this.mode}`;
      history.replaceState(null, '', url);
    }
    this.sync();
    this.draw();
    if (this.mode === 'practice' && !this.mine(0)) this.opponent();
  }

  /** Show the position after `ply` moves of the line. */
  positionAt(ply) {
    const c = new Chess();
    let last;
    for (const san of this.line.moves.slice(0, ply)) last = c.move(san);
    return { chess: c, last: last && [last.from, last.to] };
  }

  sync(last) {
    const yourTurn = !this.done && this.ply < this.line.moves.length && this.mine(this.ply) && !this.waiting;
    this.cg.set({
      fen: this.chess.fen(),
      orientation: this.orientation,
      turnColor: colorName(this.chess.turn()),
      lastMove: last,
      check: this.chess.inCheck() ? colorName(this.chess.turn()) : false,
      selected: undefined,
      movable: { color: yourTurn ? colorName(this.side) : undefined, dests: yourTurn ? this.dests() : new Map() },
    });
    const slot = document.getElementById('coords-slot');
    if (slot) slot.innerHTML = this.ctx.coordsHtml(this.orientation);
    this.drawArrow();
  }

  dests() {
    const map = new Map();
    for (const m of this.chess.moves({ verbose: true })) {
      if (!map.has(m.from)) map.set(m.from, []);
      map.get(m.from).push(m.to);
    }
    return map;
  }

  /** In Learn mode the next move is always shown; in Practice only after a hint. */
  drawArrow() {
    const next = this.line.moves[this.ply];
    let arrows = [];
    let faint = false;
    if (next && !this.done && (this.mode === 'learn' || this.hint)) {
      const m = new Chess(this.chess.fen()).move(next);
      arrows = [[m.from, m.to]];
      faint = this.mode === 'learn' && !this.mine(this.ply);
    }
    document.getElementById('marks').innerHTML = overlayHtml(this.orientation, { arrows, faint });
  }

  // ------------------------------------------------------------ moves
  goto(ply) {
    if (this.mode !== 'learn') return;
    const target = Math.max(0, Math.min(this.line.moves.length, ply));
    const { chess, last } = this.positionAt(target);
    this.chess = chess;
    this.ply = target;
    this.done = target >= this.line.moves.length;
    this.feedback = null;
    this.sync(last);
    this.draw();
  }

  onMove(from, to) {
    const expected = new Chess(this.chess.fen()).move(this.line.moves[this.ply]);
    let move;
    try { move = this.chess.move({ from, to, promotion: 'q' }); } catch { this.sync(); return; }
    if (move.from === expected.from && move.to === expected.to) {
      pingSquare(this.wrap, move.to, this.orientation, 'ok');
      this.ply += 1;
      this.tries = 0;
      this.hint = false;
      this.feedback = null;
      if (this.ply >= this.line.moves.length) { this.finish([move.from, move.to]); return; }
      this.sync([move.from, move.to]);
      this.draw();
      if (this.mode === 'practice') this.opponent();
      else this.later(() => this.goto(this.ply + 1), REPLY_DELAY); // Learn mode plays the answer too
      return;
    }
    // a different move: put it back
    this.chess.undo();
    shake(this.wrap);
    pingSquare(this.wrap, to, this.orientation, 'bad');
    if (this.mode === 'learn') {
      this.feedback = { kind: 'bad', text: `The line continues with ${expected.san}. Follow the arrow.` };
    } else {
      this.mistakes += 1;
      this.tries += 1;
      if (this.tries >= 2) this.hint = true;
      this.feedback = { kind: 'bad', text: this.hint ? `Not in this line. The arrow shows the move: ${expected.san}.` : 'Not the move in this line. Try again.' };
    }
    this.sync();
    this.draw();
  }

  opponent() {
    this.waiting = true;
    this.sync(this.cg.state.lastMove);
    this.draw();
    this.later(() => {
      const m = this.chess.move(this.line.moves[this.ply]);
      this.ply += 1;
      this.waiting = false;
      if (this.ply >= this.line.moves.length) { this.finish([m.from, m.to]); return; }
      this.sync([m.from, m.to]);
      this.draw();
    }, REPLY_DELAY);
  }

  async finish(last) {
    this.done = true;
    this.sync(last);
    if (this.mode === 'learn') {
      this.feedback = { kind: 'ok', text: 'That is the whole line. Now try it from memory in Practice.' };
      this.draw();
      return;
    }
    if (!this.mistakes) burst(this.wrap);
    try {
      const r = await api.linePlayed(this.line.id, this.mistakes);
      this.records = r.lines;
      this.now = r.now;
      this.result = r;
      this.ctx.celebrate(r);
    } catch {
      toast('Your result was not saved.', 'bad', icons.x(18));
    }
    this.draw();
  }

  // ------------------------------------------------------------ panel
  onPanel(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.line !== undefined) { this.index = Number(btn.dataset.line); this.load(); return; }
    if (btn.dataset.mode) { this.mode = btn.dataset.mode; this.load(); return; }
    if (btn.dataset.ply !== undefined) { this.goto(Number(btn.dataset.ply)); return; }
    switch (btn.id) {
      case 'first': this.goto(0); break;
      case 'prev': this.goto(this.ply - 1); break;
      case 'next': this.goto(this.ply + 1); break;
      case 'last': this.goto(this.line.moves.length); break;
      case 'hint': this.mistakes += 1; this.hint = true; this.sync(this.cg.state.lastMove); this.draw(); break;
      case 'restart': this.load(); break;
      case 'practise': this.mode = 'practice'; this.load(); break;
      case 'next-line': this.nextLine(); break;
      default:
    }
  }

  nextLine() {
    if (this.review) {
      this.pos += 1;
      const id = this.queue[this.pos];
      if (!id) { location.hash = '#/learn/openings'; return; }
      this.opening = openingOf(id);
      this.index = this.opening.lines.findIndex((l) => l.id === id);
    } else if (this.index < this.opening.lines.length - 1) {
      this.index += 1;
    } else {
      const list = OPENINGS.filter((o) => groupOf(o) === groupOf(this.opening));
      const next = list[list.indexOf(this.opening) + 1];
      if (!next) { location.hash = `#/learn/openings?side=${groupOf(this.opening)}`; return; }
      this.opening = next;
      this.index = 0;
    }
    this.load();
  }

  draw() {
    const o = this.opening;
    const total = this.line.moves.length;
    const mine = learnerPlies(this.line, this.side);
    const head = `
      <section class="panel-head">
        <span class="eyebrow">${this.review ? `Review · line ${this.pos + 1} of ${this.queue.length}` : `${SIDES[groupOf(o)].title} · ${o.eco}`}</span>
        <h2 class="learn-title">${esc(o.name)}</h2>
      </section>`;
    const lineChips = !this.review && o.lines.length > 1 ? `<div class="line-chips" role="group" aria-label="Lines">${o.lines.map((l, i) => {
      const st = lineState(this.records[l.id], this.now);
      return `<button type="button" data-line="${i}" aria-pressed="${i === this.index}">${st.mastered ? icons.check(13) : ''}${esc(l.name)}</button>`;
    }).join('')}</div>` : this.review || o.lines.length > 1 ? `<p class="line-name">${esc(this.line.name)}</p>` : '';
    const modes = this.review ? '' : `<div class="segmented mode-switch" role="group" aria-label="Mode">
        <button type="button" data-mode="learn" aria-pressed="${this.mode === 'learn'}">${icons.eye(15)} Learn</button>
        <button type="button" data-mode="practice" aria-pressed="${this.mode === 'practice'}">${icons.target(15)} Practice</button>
      </div>`;
    const body = this.mode === 'learn' ? this.learnBody(total) : this.practiceBody(mine);
    this.panel.innerHTML = `${head}
      <section class="opening-controls">${lineChips}${modes}</section>
      ${body}`;
    this.panel.querySelector('.sheet-wrap .current')?.scrollIntoView({ block: 'nearest' });
  }

  moveList(upto, clickable) {
    const moves = this.line.moves.slice(0, upto);
    const rows = [];
    for (let i = 0; i < moves.length; i += 2) {
      const cell = (j) => {
        if (j >= moves.length) return '<td></td>';
        const cls = `${this.mine(j) ? 'mine' : ''} ${j === this.ply - 1 ? 'current' : ''}`;
        const html = sanToHtml(moves[j], j % 2 === 0 ? 'w' : 'b');
        return `<td>${clickable ? `<button type="button" class="mv ${cls}" data-ply="${j + 1}">${html}</button>` : `<span class="mv ${cls}">${html}</span>`}</td>`;
      };
      rows.push(`<tr><td class="no">${i / 2 + 1}.</td>${cell(i)}${cell(i + 1)}</tr>`);
    }
    return rows.length ? `<div class="sheet-wrap opening-sheet"><table class="sheet"><tbody>${rows.join('')}</tbody></table></div>` : '';
  }

  learnBody(total) {
    const moveHtml = (ply) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}${sanToHtml(this.line.moves[ply], ply % 2 ? 'b' : 'w')}`;
    const next = this.line.moves[this.ply];
    let note;
    if (this.ply === 0) {
      note = `<p class="opening-idea">${esc(this.opening.idea)}</p>
        <p class="note-lead">${this.mine(0) ? 'You start. Follow the arrow, or press Next.' : 'Your opponent starts. Press Next.'}</p>`;
    } else {
      // the reason for your latest move stays in view, with the opponent's answer under it
      let yours = this.ply - 1;
      while (yours >= 0 && !this.mine(yours)) yours -= 1;
      const reply = this.mine(this.ply - 1) ? null : this.ply - 1;
      note = yours >= 0 ? `<p class="note-move"><span class="chip rank">You</span><span class="mv-big">${moveHtml(yours)}</span></p>
        <p class="note-why">${esc(this.line.notes[yours])}</p>` : '';
      if (reply !== null) {
        note += `<p class="note-reply"><span class="chip">Opponent</span><span class="mv-mid">${moveHtml(reply)}</span>${
          this.line.notes[reply] ? `<span class="muted">${esc(this.line.notes[reply])}</span>` : ''}</p>`;
      }
    }
    const upNext = next && this.mine(this.ply) && !this.done && this.ply > 0 ? `<p class="help help-row">${icons.bulb(14)} Your move next: play it on the board, or press Next.</p>` : '';
    return `
      <section class="opening-note" aria-live="polite">${note}${upNext}
        ${this.feedback ? `<p class="note-bad">${icons.x(15)} ${esc(this.feedback.text)}</p>` : ''}</section>
      <section>${this.moveList(total, true) || '<p class="sheet-empty">No moves yet.</p>'}
        <div class="stepper" role="group" aria-label="Move through the line">
          <button type="button" id="first" aria-label="Start" ${this.ply === 0 ? 'disabled' : ''}>${icons.prev(16)}${icons.prev(16)}</button>
          <button type="button" id="prev" aria-label="Previous move" ${this.ply === 0 ? 'disabled' : ''}>${icons.prev(18)}</button>
          <span class="mono">${this.ply} / ${total}</span>
          <button type="button" id="next" aria-label="Next move" ${this.ply >= total ? 'disabled' : ''}>${icons.next(18)}</button>
          <button type="button" id="last" aria-label="End" ${this.ply >= total ? 'disabled' : ''}>${icons.next(16)}${icons.next(16)}</button>
        </div>
      </section>
      <section class="actions-grid"><button type="button" class="${this.done ? 'btn-primary ' : ''}wide" id="practise">${icons.target(18)} Practise this line from memory</button></section>`;
  }

  practiceBody(mine) {
    const found = mine.filter((i) => i < this.ply).length;
    const dots = mine.map((i) => `<i class="${i < this.ply ? 'done' : ''}"></i>`).join('');
    if (this.done) return this.resultBody();
    const status = this.waiting ? 'Opponent is moving...' : `Your move ${found + 1} of ${mine.length}. Play it from memory.`;
    return `
      <section class="opening-note">
        <div class="to-move"><span class="swatch ${this.waiting ? colorName(this.side === 'w' ? 'b' : 'w') : colorName(this.side)}"></span>${esc(status)}</div>
        <div class="steps" role="img" aria-label="${found} of ${mine.length} moves">${dots}</div>
        ${this.feedback ? `<p class="note-bad">${icons.x(15)} ${esc(this.feedback.text)}</p>` : ''}
        <p class="help">${this.mistakes ? plural(this.mistakes, 'mistake') : 'No mistakes yet.'}</p>
      </section>
      <section>${this.moveList(this.ply, false)}</section>
      <section class="actions-grid">
        <button type="button" id="hint" ${this.hint || this.waiting ? 'disabled' : ''}>${icons.bulb(18)} Hint</button>
        <button type="button" id="restart">${icons.retry(18)} Restart</button>
      </section>`;
  }

  resultBody() {
    const st = lineState(this.records[this.line.id], this.now);
    const rec = this.records[this.line.id];
    const days = rec ? Math.round((rec[1] - this.now) / 86_400_000) : 0;
    const clean = !this.mistakes;
    const progress = st.mastered ? `${icons.check(14)} Mastered` : `${Math.min(st.streak, MASTERED_AT)} of ${MASTERED_AT} clean runs to master it`;
    const back = !this.result ? '' : clean ? `Comes back for review in ${plural(days, 'day')}.` : 'It stays in your review list until you play it cleanly.';
    const more = this.review ? (this.queue[this.pos + 1] ? 'Next due line' : 'Finish review')
      : this.index < this.opening.lines.length - 1 ? 'Next line' : 'Next opening';
    return `
      <section class="opening-note learn-done">
        <span class="eyebrow">${esc(this.line.name)}</span>
        <h2>${clean ? 'Clean run' : `Done with ${plural(this.mistakes, 'mistake')}`}</h2>
        <p class="opening-streak ${st.mastered ? 'on' : ''}">${progress}</p>
        <p class="muted">${back}</p>
      </section>
      <section>${this.moveList(this.ply, false)}</section>
      <section class="actions-grid">
        <button type="button" class="btn-primary wide" id="next-line">${more} ${icons.next(16)}</button>
        <button type="button" id="restart">${icons.retry(18)} Again</button>
        ${this.review ? '' : `<button type="button" data-mode="learn">${icons.eye(18)} Learn</button>`}
      </section>`;
  }
}
