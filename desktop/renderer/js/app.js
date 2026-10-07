import { Chessground } from '../vendor/chessground.js';
import { Chess } from '../vendor/chess.js';
import { api, ApiError } from './api.js';
import { accuracyLine, attachTips, columns, dailyBars, heatmap, sparkline } from './charts.js';
import { icons, logo, ring, themeToggleSvg } from './icons.js';
import { burst, countUp, fillRings, pingSquare, shake, stagger, transition } from './motion.js';
import { CUSTOM_VARS, DEFAULT_CUSTOM, GRADIENTS, PRESETS, contrast, customTheme } from './custom-theme.js';
import { PALETTES } from './palettes.js';
import { Solver } from './solver.js';
import { renderSprint } from './sprint.js';
import { renderDrill, renderLearn, renderLesson } from './learn.js';
import { renderOpening, renderOpeningReview, renderOpenings } from './openings-ui.js';
import { OPENINGS } from './openings.js';
import {
  AVATAR, THEMES, avatarHtml, awardToast, count, esc, figurine, fmtDay, fmtDuration, fmtMonth, fmtTime, playersText,
  puzzleName, rewardName, sanToHtml, toast,
} from './ui.js';

const view = document.getElementById('view');
const root = document.documentElement;
const LEVELS = {
  easy: { name: 'Easy', pips: 1 },
  intermediate: { name: 'Intermediate', pips: 2 },
  advanced: { name: 'Advanced', pips: 3 },
};
const STATUS = { new: 'Unsolved', solved: 'Solved', failed: 'In review' };
const BOARD_COLORS = {
  slate: ['#dce3ea', '#8497ab'], walnut: ['#ecd6b3', '#a87c56'], olive: ['#eeeed2', '#769656'],
  marble: ['#e6e7e8', '#9fa4a9'], sand: ['#f1e4c7', '#c9a877'],
};
const DEFAULT_APPEARANCE = { mode: 'system', light: 'porcelain', dark: 'midnight', accent: 'cobalt', custom: null };
const PAGE_SIZE = 120;
// Exercise 1 (Hamppe – Steinitz, Vienna 1860): shown on the sign-in page and in the board preview
const SAMPLE_FEN = 'r6r/1pp3k1/1b6/p2P1p2/P1N1pn2/2P2PP1/BP5P/4RR1K b - - 0 30';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let me = null;
let rankTitle = '';
let appearance = { ...DEFAULT_APPEARANCE };
let activeSolver = null;
let timerHandle = null;
let keyHandler = null;
let boards = [];
let leaveFns = [];
const onLeave = (fn) => leaveFns.push(fn);
let navId = 0;
let statsRange = 14;

const pct = (a, b) => (b ? (100 * a) / b : 0);
const pips = (n) => `<span class="pips" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const levelTag = (key) => `<span class="level-tag">${pips(LEVELS[key].pips)}${LEVELS[key].name}</span>`;
const pctText = (v) => (v == null ? '—' : `${v}%`);
const sideText = (fen) => (fen.split(' ')[1] === 'w' ? 'White to move' : 'Black to move');
const n = (v) => Number(v ?? 0).toLocaleString('en');

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function miniBoard(el, fen, extra = {}) {
  if (!el) return null;
  const cg = Chessground(el, {
    fen, viewOnly: true, coordinates: false, orientation: fen.split(' ')[1] === 'b' ? 'black' : 'white', ...extra,
  });
  boards.push(cg);
  return cg;
}

function cleanup() {
  const fns = leaveFns;
  leaveFns = [];
  fns.forEach((fn) => fn());
  activeSolver?.destroy();
  activeSolver = null;
  boards.forEach((b) => b.destroy());
  boards = [];
  clearInterval(timerHandle);
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}

function skeleton(kind = 'page') {
  view.innerHTML = kind === 'board'
    ? `<div class="solve" aria-busy="true"><div class="skeleton"><i class="block" style="height:min(60vh,560px)"></i></div>
       <div class="skeleton"><i class="block"></i><i></i><i></i><i style="width:60%"></i></div></div>`
    : `<div class="skeleton" aria-busy="true" aria-label="Loading"><i style="width:30%;height:34px"></i><i class="block"></i><i></i><i style="width:70%"></i><i class="block"></i></div>`;
}

/** Wait for data; show a skeleton only if it takes long enough to notice. */
async function load(promise, kind) {
  const timer = setTimeout(() => skeleton(kind), 250);
  try { return await promise; } finally { clearTimeout(timer); }
}

/** Swap the page content inside a view transition, unless the user already navigated away. */
async function paint(nav, html, after) {
  if (nav !== navId) return false;
  await transition(() => {
    view.innerHTML = html;
    after?.();
  });
  window.scrollTo(0, 0);
  return true;
}

// ---------------------------------------------------------------- appearance
function applyAppearance(a) {
  appearance = { ...DEFAULT_APPEARANCE, ...a };
  try { localStorage.setItem('appearance', JSON.stringify(appearance)); } catch { /* private mode */ }
  if (appearance.mode === 'custom') {
    // the player's own colours go straight onto <html>; boot.js repeats this before the first paint
    const t = customTheme(appearance.custom ?? DEFAULT_CUSTOM);
    Object.entries(t.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.scheme = t.scheme;
    root.dataset.palette = 'custom';
    root.dataset.accent = 'custom';
    try { localStorage.setItem('customVars', JSON.stringify({ scheme: t.scheme, vars: t.vars })); } catch { /* private mode */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.vars['--accent']);
    paintThemeButton();
    return;
  }
  CUSTOM_VARS.forEach((k) => root.style.removeProperty(k));
  try { localStorage.removeItem('customVars'); } catch { /* private mode */ }
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && darkQuery.matches);
  root.dataset.scheme = dark ? 'dark' : 'light';
  root.dataset.palette = dark ? appearance.dark : appearance.light;
  root.dataset.accent = appearance.accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES.accent[appearance.accent][dark ? 'dark' : 'light']);
  paintThemeButton();
}
darkQuery.addEventListener('change', () => appearance.mode === 'system' && applyAppearance(appearance));

function applyPieces(set) {
  if (set && set !== 'classic') root.dataset.pieces = set;
  else delete root.dataset.pieces;
  try { localStorage.setItem('pieces', set || 'classic'); } catch { /* private mode */ }
}

function applyBoard(theme) {
  if (theme && theme !== 'slate') root.dataset.board = theme;
  else delete root.dataset.board;
  try { localStorage.setItem('board', theme || 'slate'); } catch { /* private mode */ }
}

function paintThemeButton() {
  const btn = document.getElementById('theme-toggle');
  const dark = root.dataset.scheme === 'dark';
  if (!btn.querySelector('.theme-icon')) btn.innerHTML = themeToggleSvg();
  btn.setAttribute('aria-pressed', String(dark));
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.title = btn.getAttribute('aria-label');
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  const mode = root.dataset.scheme === 'dark' ? 'light' : 'dark';
  applyAppearance({ ...appearance, mode });
  if (me) {
    me.appearance = { ...appearance };
    api.setMode(mode).catch(() => {});
  }
});

function paintUserChip() {
  const chip = document.getElementById('user-chip');
  chip.innerHTML = `${avatarHtml(me.avatar, 'sm')}
    <span class="who"><strong>${esc(me.display_name)}</strong><small>${esc(rankTitle || ' ')}</small></span>`;
  chip.setAttribute('aria-label', `Your profile: ${me.display_name}`);
}

async function refreshHeader() {
  try {
    const s = await api.stats();
    const badge = document.getElementById('due-badge');
    badge.textContent = s.review_due;
    badge.hidden = !s.review_due;
    rankTitle = s.rank.title;
    paintUserChip();
  } catch { /* not critical */ }
}

const medalFor = (a) => {
  const piece = { pawn: 'p', knight: 'n', king: 'k' }[a.icon];
  return piece ? figurine('w', piece) : icons[a.icon](22);
};

// ---------------------------------------------------------------- welcome (first launch)
const WELCOMED = 'welcomed';
const seenWelcome = () => { try { return localStorage.getItem(WELCOMED) === '1'; } catch { return true; } };

function renderWelcome() {
  document.getElementById('topbar').hidden = true;
  view.innerHTML = `
    <section class="welcome">
      <div class="welcome-intro stagger">
        <span class="brand">${logo(56)} Woodpecker</span>
        <h1>Tactics you <em>see</em>, not calculate.</h1>
        <p>2,127 puzzles from both <i>Woodpecker Method</i> books by Axel Smith and Hans Tikkanen: 1,127 tactics and 1,000 positional exercises. Solve them in order, and anything you miss comes back in review until it sticks.</p>
        <div class="facts">
          <div><strong>560</strong><span>easy</span></div>
          <div><strong>1,162</strong><span>intermediate</span></div>
          <div><strong>405</strong><span>advanced</span></div>
        </div>
        <div class="welcome-row">
          <button type="button" class="btn-primary btn-lg" id="welcome-start">Start training ${icons.next(18)}</button>
          <button type="button" class="btn-lg" id="welcome-learn">${icons.book(18)} Learn the basics first</button>
          <p class="help">${icons.lock(13)} Everything stays on this computer. No account, no internet needed.</p>
        </div>
      </div>
      <div class="surface welcome-board enter">
        <div class="board-mini" id="mini" role="img" aria-label="Board of exercise 1"></div>
        <p>Exercise 1: Hamppe vs Steinitz, Vienna 1860. Black to move and win.</p>
      </div>
    </section>`;
  stagger(view.querySelector('.welcome-intro'));
  miniBoard(view.querySelector('#mini'), SAMPLE_FEN);
  const leave = (hash) => {
    try { localStorage.setItem(WELCOMED, '1'); } catch { /* shown again next time */ }
    location.hash = hash;
    route();
  };
  view.querySelector('#welcome-start').addEventListener('click', () => leave('#/'));
  view.querySelector('#welcome-learn').addEventListener('click', () => leave('#/learn'));
}

// ---------------------------------------------------------------- home
async function renderHome(nav) {
  setNav('home');
  const [s, next, names] = await load(Promise.all([api.stats(), api.next({ mode: 'new' }), themeInfo()]));
  const r = s.rank;
  const weak = weakThemes(s);
  const rankProgress = r.next_at ? (s.solved - r.floor) / (r.next_at - r.floor) : 1;

  const continueCard = next.done
    ? `<article class="surface raised continue">
         <span class="icon-circle" style="width:120px;height:120px">${icons.trophy(56)}</span>
         <div class="body"><h2>You have tried every puzzle in the book</h2>
           <p class="meta">Start your next cycle and aim to finish it in half the time.</p>
           <a class="btn btn-primary btn-lg" href="#/browse">Open all puzzles</a></div>
       </article>`
    : `<article class="surface raised continue lift">
         <div class="board-mini" id="next-board" role="img" aria-label="Board of puzzle ${next.id}"></div>
         <div class="body">
           <span class="eyebrow">${s.attempted ? 'Continue where you left off' : 'Start with the first puzzle'}</span>
           <span class="puzzle-no">${puzzleName(next.id)}</span>
           <h2>${esc(playersText(next))}</h2>
           <p class="meta">${esc(next.event)} ${next.year ?? ''} · ${LEVELS[next.difficulty].name} · ${sideText(next.fen)}</p>
           <a class="btn btn-primary btn-lg" href="#/solve/new">${s.attempted ? 'Continue solving' : 'Start solving'} ${icons.next(18)}</a>
         </div>
       </article>`;

  const rankCard = `
    <aside class="surface raised rank-card" aria-label="Your rank">
      <div class="top">
        <div class="ring-wrap">${ring(rankProgress, 84, 6)}${avatarHtml(me.avatar, 'md')}</div>
        <div>
          <span class="eyebrow">Your rank</span>
          <h2>${esc(r.title)}</h2>
          <p class="next">${r.next_at ? `${count(r.next_at - s.solved, 'puzzle')} to ${esc(r.next_title)}` : 'You reached the top rank'}</p>
        </div>
      </div>
      <div class="mini-stats">
        <div><strong data-count="${s.solved}">0</strong><span>Solved</span></div>
        <div><strong data-count="${s.streak_days}">0</strong><span>Day streak</span></div>
        <div><strong ${s.accuracy == null ? '' : `data-count="${s.accuracy}" data-suffix="%"`}>${s.accuracy == null ? '—' : '0%'}</strong><span>Accuracy</span></div>
      </div>
      <a class="btn btn-ghost" href="#/profile">${icons.user(18)} View profile</a>
    </aside>`;

  const reviewStrip = `
    <div class="surface review-strip ${s.review_due ? 'due' : ''}">
      <div class="lead">
        <span class="badge-icon">${icons.repeat(22)}</span>
        <div>
          <strong>${s.review_due ? `${count(s.review_due, 'puzzle')} due for review` : 'Nothing to review right now'}</strong>
          <p class="muted" style="font-size:var(--text-sm)">${s.review_total ? `${count(s.review_total, 'puzzle')} in your review boxes.` : 'Puzzles you miss come back here on schedule.'}</p>
        </div>
      </div>
      ${s.review_due ? `<a class="btn" href="#/review">Start review</a>` : ''}
    </div>`;

  const rows = Object.keys(LEVELS).map((key) => {
    const l = s.levels[key];
    return `
      <div class="level-row">
        <div class="name"><strong>${levelTag(key)}</strong><span class="range">${count(l.total, 'puzzle')}</span></div>
        <div class="progress">
          <div class="bar" role="img" aria-label="${l.solved} solved and ${l.failed} in review out of ${l.total}">
            <div class="s" style="width:${pct(l.solved, l.total)}%"></div>
            <div class="f" style="width:${pct(l.failed, l.total)}%"></div>
          </div>
          <div class="legend">
            <span><i class="s"></i>${n(l.solved)} solved</span>
            <span><i class="f"></i>${n(l.failed)} in review</span>
            <span><i class="n"></i>${n(l.total - l.attempted)} left</span>
            <span>Accuracy ${pctText(l.accuracy)}</span>
          </div>
        </div>
        <div class="actions">
          <a class="btn" href="#/solve/new/${key}">Solve</a>
          <a class="btn btn-ghost" href="#/browse?difficulty=${key}">Browse</a>
        </div>
      </div>`;
  }).join('');

  await paint(nav, `
    <div class="page-head">
      <div><h1>Welcome back, ${esc(me.display_name)}</h1>
        <p>${n(s.attempted)} of ${n(s.total)} puzzles tried${s.streak_days ? ` · ${count(s.streak_days, 'day')} streak` : ''}</p></div>
    </div>
    <div class="home-grid stagger">${continueCard}${rankCard}</div>
    ${reviewStrip}
    <section class="section">
      <div class="section-head"><h2>Levels</h2></div>
      <div class="surface levels stagger">${rows}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Train your weak spots</h2><a class="btn btn-ghost" href="#/themes">All themes ${icons.next(16)}</a></div>
      ${weak.length ? `<div class="weak-grid stagger">${weak.map((t) => weakCard(t, names[t.key])).join('')}</div>`
    : `<div class="surface weak-empty"><p>Solve a few more puzzles and the tactics you miss most show up here. Or pick a theme now:</p>
        <div class="theme-chips">${['fork', 'pin', 'mate_in_2', 'discovered_attack', 'sacrifice', 'skewer'].map((k) =>
          `<a class="chip" href="#/solve/theme/${k}">${esc(names[k]?.name ?? k)}</a>`).join('')}</div></div>`}
    </section>
    <a class="surface sprint-strip learn-strip lift" href="#/learn">
      <span class="badge-icon">${icons.book(22)}</span>
      <div><strong>Learn the basics</strong><p class="muted">New to chess, or rusty? Short lessons from how the pieces move to forks and pins, all checked on the board.</p></div>
      <span class="btn">Open lessons ${icons.next(16)}</span>
    </a>
    <a class="surface sprint-strip lift" href="#/sprint">
      <span class="badge-icon">${icons.bolt(22)}</span>
      <div><strong>Sprint</strong><p class="muted">Solve as many puzzles as you can in 3 minutes. Three mistakes and the run ends.</p></div>
      <span class="btn btn-primary">Start a sprint ${icons.next(16)}</span>
    </a>
    <aside class="method" aria-label="The Woodpecker Method">
      <div>${icons.calendar(22)}<strong>Cycle one</strong><p>Solve as many puzzles as you can, in order, over about four weeks.</p></div>
      <div>${icons.repeat(22)}<strong>Every cycle after</strong><p>Repeat the same set in half the time of the previous cycle, up to seven cycles.</p></div>
      <div>${icons.eye(22)}<strong>The goal</strong><p>Recognise the idea instantly instead of recalculating it every time.</p></div>
    </aside>`, () => {
    stagger(view.querySelector('.home-grid'));
    stagger(view.querySelector('.levels'));
    stagger(view.querySelector('.weak-grid'));
    if (!next.done) miniBoard(view.querySelector('#next-board'), next.fen);
  });
  countUp(view);
  fillRings(view);
}

// ---------------------------------------------------------------- solve
function coordsHtml(orientation) {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const fileOrder = orientation === 'white' ? files : [...files].reverse();
  const rankOrder = orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const dark = (f, r) => (files.indexOf(f) + r) % 2 === 1; // a1 is dark
  const leftFile = fileOrder[0];
  const bottomRank = rankOrder[7];
  return `<div class="coords" aria-hidden="true">
    <div class="ranks">${rankOrder.map((r) => `<span class="${dark(leftFile, r) ? 'on-dark' : 'on-light'}">${r}</span>`).join('')}</div>
    <div class="files">${fileOrder.map((f) => `<span class="${dark(f, bottomRank) ? 'on-dark' : 'on-light'}">${f}</span>`).join('')}</div>
  </div>`;
}

function scoresheet(puzzle, history) {
  if (!history.length) return '<p class="sheet-empty">No moves played yet.</p>';
  const [, turn, , , , full] = puzzle.fen.split(' ');
  const rows = [];
  let row = { no: Number(full), w: '', b: '' };
  let color = turn;
  history.forEach((h, i) => {
    const cell = `<span class="cell ${h.by}">${sanToHtml(h.san, h.color)}</span>`;
    if (color === 'w') {
      row.w = cell;
      color = 'b';
    } else {
      if (i === 0) row.w = '<span class="faint">…</span>';
      row.b = cell;
      rows.push(row);
      row = { no: row.no + 1, w: '', b: '' };
      color = 'w';
    }
  });
  if (row.w) rows.push(row);
  return `<div class="sheet-wrap"><table class="sheet">
    <thead><tr><th scope="col"><span class="sr-only">Move number</span></th><th scope="col">White</th><th scope="col">Black</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="no">${r.no}.</td><td>${r.w}</td><td>${r.b}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

const statusIcon = { ok: icons.check, bad: icons.x, hint: icons.bulb };

/** SAN moves from a FEN as numbered notation: "16.g4 Nd7 17.h4" (or "14...b5 15.a3"). */
function lineHtml(fen, sans) {
  const [, turn, , , , full] = fen.split(' ');
  let n = Number(full);
  let white = turn === 'w';
  return sans.map((san, i) => {
    const num = white ? `${n}.` : (i === 0 ? `${n}...` : '');
    const html = `${num ? `<span class="no">${num}</span>` : ''}${sanToHtml(san, white ? 'w' : 'b')}`;
    if (!white) n += 1;
    white = !white;
    return html;
  }).join(' ');
}

// ---------------------------------------------------------------- explanation (after a puzzle)
/**
 * Why the solution works, move by move. Every note was computed on the board when the data was built
 * (python -m app.explain): captures, checks, forks, pins, threats. Nothing here is written by hand.
 */
function explainDialog(puzzle, names = {}) {
  const e = puzzle.explain;
  const positional = puzzle.book === 2;
  const steps = e.steps.map(([san, mine, ...notes]) => ({ san, mine: Boolean(mine), notes }));
  // the position after every step, for the small board
  const chess = new Chess(puzzle.fen);
  const positions = [{ fen: puzzle.fen, last: undefined }];
  for (const step of steps) {
    const m = chess.move(step.san);
    positions.push({ fen: chess.fen(), last: [m.from, m.to] });
  }
  const [, turn, , , , full] = puzzle.fen.split(' ');
  let number = Number(full);
  let white = turn === 'w';
  const rows = steps.map((step, i) => {
    const num = white ? `${number}.` : `${number}...`;
    const color = white ? 'w' : 'b';
    if (!white) number += 1;
    white = !white;
    const tag = positional && i === 1 ? '<li class="ex-divider"><span class="eyebrow">How the book continues</span></li>' : '';
    const notes = step.notes.length ? step.notes.map(esc).join(' ') : '';
    return `${tag}<li><button type="button" class="ex-step ${step.mine ? 'mine' : 'reply'}" data-i="${i + 1}">
        <span class="ex-move"><span class="no">${num}</span>${sanToHtml(step.san, color)}</span>
        <span class="ex-notes">${notes}</span>
      </button></li>`;
  }).join('');
  const ideas = e.ideas.map((k) => names[k]).filter(Boolean);

  const dlg = document.createElement('dialog');
  dlg.className = 'reward-dialog explain-dialog';
  dlg.setAttribute('aria-labelledby', 'explain-title');
  dlg.innerHTML = `
    <button type="button" class="btn-ghost close" aria-label="Close">${icons.x(18)}</button>
    <p class="eyebrow">${icons.bulb(12)} ${esc(puzzleName(puzzle.id))} explained</p>
    <h2 id="explain-title">The idea</h2>
    ${e.summary ? `<p class="ex-summary">${esc(e.summary)}</p>` : ''}
    ${ideas.length ? `<div class="ex-ideas">${ideas.map((t) =>
      `<div class="ex-idea"><strong>${esc(t.name)}</strong><span>${esc(t.description)}</span></div>`).join('')}</div>` : ''}
    ${e.facts?.length > 2 ? `<ul class="ex-facts">${e.facts.slice(2).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <div class="ex-body">
      <div class="ex-board-col">
        <div class="board-mini" id="ex-board" role="img" aria-label="Position"></div>
        <p class="muted" id="ex-where">Start position. Click a move to see it.</p>
      </div>
      <ol class="ex-steps">${rows}</ol>
    </div>
    ${e.result ? `<p class="ex-result">${icons.check(16)} ${esc(e.result)}</p>` : ''}
    <p class="help">${positional ? 'The answer is the key move; the rest is the line the book gives.' : 'Every note is worked out from the position itself.'}</p>`;
  document.body.append(dlg);
  const board = Chessground(dlg.querySelector('#ex-board'), {
    fen: puzzle.fen, viewOnly: true, coordinates: false,
    orientation: turn === 'b' ? 'black' : 'white', animation: { enabled: true, duration: 200 },
  });
  const show = (i) => {
    board.set({ fen: positions[i].fen, lastMove: positions[i].last });
    dlg.querySelectorAll('.ex-step').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.i) === i)));
    dlg.querySelector('#ex-where').textContent = i ? `After move ${i} of ${steps.length}.` : 'Start position. Click a move to see it.';
  };
  dlg.querySelector('.ex-steps').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ex-step');
    if (btn) show(Number(btn.dataset.i));
  });
  dlg.addEventListener('keydown', (ev) => {
    const current = Number(dlg.querySelector('.ex-step[aria-current="true"]')?.dataset.i ?? 0);
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); show(Math.min(steps.length, current + 1)); }
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); show(Math.max(0, current - 1)); }
  });
  dlg.addEventListener('close', () => { board.destroy(); dlg.remove(); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg || ev.target.closest('.close')) dlg.close(); });
  dlg.showModal();
}

function drawPanel(puzzle, solver, ctx) {
  const panel = document.getElementById('panel');
  const slot = document.getElementById('coords-slot');
  if (slot) slot.innerHTML = coordsHtml(solver.orientation);
  const color = solver.solverColor;
  const msg = solver.message;
  const steps = solver.steps;
  const positional = puzzle.book === 2;
  const chips = [
    positional ? `<span class="chip rank" title="The Woodpecker Method 2: find the key move">${icons.compass(12)} Positional</span>` : '',
    puzzle.status !== 'new' ? `<span class="chip ${puzzle.status}">${STATUS[puzzle.status]}</span>` : '',
    puzzle.review ? `<span class="chip">Review box ${puzzle.review.box} of 6</span>` : '',
    ctx.mode === 'review' ? '<span class="chip rank">Review session</span>' : '',
    ctx.theme ? `<span class="chip rank">${icons.target(12)} ${esc(ctx.theme.name)} · ${count(ctx.theme.left, 'puzzle')} left</span>` : '',
  ].join('');
  // themes are shown once the puzzle is over, so they never give the idea away
  const themeChips = solver.finished && puzzle.themes?.length
    ? `<div class="theme-chips" aria-label="Themes">${puzzle.themes.map((t) =>
      `<a class="chip" href="#/solve/theme/${t}" title="Practise ${esc(ctx.names?.[t]?.name ?? t)}">${esc(ctx.names?.[t]?.name ?? t)}</a>`).join('')}</div>`
    : '';
  // book 2: after the key move, the book's continuation (moves only, as for every solution)
  const bookLine = positional && solver.finished && puzzle.line?.length > 1
    ? `<div class="book-line"><span class="eyebrow">How the book continues</span><p>${lineHtml(puzzle.fen, puzzle.line)}</p></div>`
    : '';
  const dots = Array.from({ length: steps.total }, (_, i) => {
    const cls = i < steps.done ? 'done' : i < steps.done + steps.revealed ? 'revealed'
      : (i === steps.done + steps.revealed && !solver.finished ? 'current' : '');
    return `<i class="${cls}"></i>`;
  }).join('');
  const outcome = solver.finished
    ? `<div class="success ${solver.assisted ? 'assisted' : ''}" role="status">
         <span class="medal">${solver.assisted ? icons.repeat(24) : icons.check(26)}</span>
         <div><strong>${solver.assisted ? (solver.revealed ? 'Solution shown' : 'Solved with help') : 'Solved'}</strong>
           <span>${fmtTime(solver.elapsedMs)} · ${solver.mistakes ? count(solver.mistakes, 'mistake') : (solver.assisted ? 'goes to review' : 'no mistakes')}</span></div>
       </div>`
    : `<div class="status ${msg.kind}" role="status" aria-live="polite">
         ${statusIcon[msg.kind] ? statusIcon[msg.kind](18) : ''}
         <span>${esc(msg.text)}${solver.mistakes ? ` <small>(${count(solver.mistakes, 'mistake')})</small>` : ''}</span>
       </div>`;
  const actions = solver.finished
    ? `<button class="btn-primary wide" id="next">Next puzzle ${icons.next(18)}</button>
       ${puzzle.explain ? `<button class="wide" id="explain">${icons.bulb(20)}Explain the idea</button>` : ''}
       <button id="retry">${icons.retry(20)}Try again</button>
       <button id="flip">${icons.flip(20)}Flip board</button>
       <a class="btn" href="#/">${icons.home(20)}Home</a>`
    : `<button id="hint">${icons.bulb(20)}Hint</button>
       <button id="reveal">${icons.eye(20)}Show solution</button>
       <button id="flip">${icons.flip(20)}Flip board</button>
       ${ctx.mode === 'single' ? `<button class="wide btn-ghost" id="skip">Skip to next puzzle ${icons.next(16)}</button>` : ''}`;

  panel.innerHTML = `
    <section class="panel-head">
      <div class="top"><span class="id">${puzzleName(puzzle.id)}</span>${levelTag(puzzle.difficulty)}</div>
      <div>
        <div class="players">${esc(playersText(puzzle))}</div>
        ${puzzle.white || puzzle.black ? `<div class="event">${esc(puzzle.event)} ${puzzle.year ?? ''}</div>` : ''}
      </div>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
    </section>
    <section>
      <div class="turn-row">
        <div class="to-move"><span class="swatch ${color}"></span>${color === 'white' ? 'White to move' : 'Black to move'}</div>
        <div class="timer" title="Time spent">${icons.clock(18)}<span class="mono" id="timer">${fmtTime(solver.elapsedMs)}</span></div>
      </div>
      <div class="steps" role="img" aria-label="${steps.done} of ${steps.total} moves found">${dots}</div>
      ${outcome}
      ${themeChips}
      ${bookLine}
    </section>
    <section aria-label="Moves">${scoresheet(puzzle, solver.history)}</section>
    <section class="actions-grid">${actions}</section>
    ${ctx.mode === 'single' ? `
      <section class="nav-row">
        ${puzzle.prev_id ? `<a class="btn btn-ghost" href="#/puzzle/${puzzle.prev_id}">${icons.prev(16)} ${puzzleName(puzzle.prev_id)}</a>` : '<span></span>'}
        ${puzzle.next_id ? `<a class="btn btn-ghost" href="#/puzzle/${puzzle.next_id}">${puzzleName(puzzle.next_id)} ${icons.next(16)}</a>` : ''}
      </section>` : ''}`;
  panel.querySelector('#hint')?.addEventListener('click', () => solver.hint());
  panel.querySelector('#reveal')?.addEventListener('click', () => solver.reveal());
  panel.querySelector('#retry')?.addEventListener('click', () => solver.reset());
  panel.querySelector('#flip')?.addEventListener('click', () => solver.flip());
  panel.querySelector('#next')?.addEventListener('click', ctx.next);
  panel.querySelector('#explain')?.addEventListener('click', () => explainDialog(puzzle, ctx.names));
  panel.querySelector('#skip')?.addEventListener('click', ctx.next);
  const sheet = panel.querySelector('.sheet-wrap');
  if (sheet) sheet.scrollTop = sheet.scrollHeight;
  if (solver.finished && !document.activeElement?.closest('input, textarea')) panel.querySelector('#next')?.focus({ preventScroll: true });
}

function celebrate(result) {
  (result.new_achievements ?? []).forEach((a, i) => {
    const sub = a.reward ? `${a.detail}. Unlocked: ${rewardName(a.reward)}` : a.detail;
    setTimeout(() => awardToast(medalFor(a), `Achievement unlocked: ${a.title}`, sub), 500 + i * 900);
  });
  if (result.rank_up) {
    setTimeout(() => awardToast(icons.crown(22), `New rank: ${result.rank_up.title}`,
      result.rank_up.next_title ? `Next: ${result.rank_up.next_title} at ${result.rank_up.next_at} solved` : 'The top rank'), 400);
  }
}

async function mountSolver(nav, puzzle, ctx) {
  const ok = await paint(nav, `
    <section class="solve">
      <div class="board-col">
        <div class="board-wrap" id="board-wrap"><div class="board" id="board"></div><div id="coords-slot"></div></div>
        <div class="shortcuts" aria-hidden="true">
          <span><kbd>H</kbd> Hint</span><span><kbd>S</kbd> Solution</span><span><kbd>F</kbd> Flip</span>
          <span><kbd>R</kbd> Retry</span><span><kbd>${icons.enter(14)}</kbd> Next</span>
        </div>
      </div>
      <aside class="surface panel enter" id="panel" aria-label="Puzzle details"></aside>
    </section>`);
  if (!ok) return;
  const wrap = document.getElementById('board-wrap');
  const solver = new Solver(document.getElementById('board'), puzzle, {
    onChange: (s) => drawPanel(puzzle, s, ctx),
    onEvent: (type, detail) => {
      if (type === 'correct') pingSquare(wrap, detail.square, solver.orientation, 'ok');
      if (type === 'wrong') { shake(wrap); pingSquare(wrap, detail.square, solver.orientation, 'bad'); }
      if (type === 'solved' && detail.clean) setTimeout(() => burst(wrap), 120);
    },
    onRecord: async (result) => {
      try {
        const r = await api.attempt({ puzzle_id: puzzle.id, ...result });
        puzzle.review = r.review;
        celebrate(r);
        refreshHeader();
      } catch {
        toast('Your result was not saved. Check your connection.', 'bad', icons.x(18));
      }
    },
  });
  activeSolver = solver;
  drawPanel(puzzle, solver, ctx);
  timerHandle = setInterval(() => {
    const t = document.getElementById('timer');
    if (t && !solver.finished) t.textContent = fmtTime(solver.elapsedMs);
  }, 500);
  keyHandler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
    if ((e.key === 'Enter') && e.target.closest('button, a')) return; // native activation
    const actions = {
      h: () => solver.hint(),
      s: () => solver.reveal(),
      f: () => solver.flip(),
      r: () => solver.finished && solver.reset(),
      Enter: () => (solver.finished || ctx.mode === 'single') && ctx.next(),
    };
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };
  document.addEventListener('keydown', keyHandler);
}

async function renderMessage(nav, title, text, actions = '', icon = icons.check(28)) {
  await paint(nav, `
    <section class="surface message">
      <span class="icon-circle">${icon}</span>
      <h2>${title}</h2>
      ${text ? `<p>${text}</p>` : ''}
      <div class="row" style="justify-content:center">${actions}<a class="btn" href="#/">Home</a></div>
    </section>`);
}

// theme key -> {name, description}; names only, so one fetch per page load is enough
let themeCatalog = null;
const themeInfo = () => (themeCatalog ??= api.themes()
  .then((list) => Object.fromEntries(list.map((t) => [t.key, t])))
  .catch(() => { themeCatalog = null; return {}; }));

/** `arg` is a level for 'new'/'review' sessions and a theme key for 'theme' sessions. */
async function renderSession(nav, mode, arg, after = 0) {
  setNav(mode === 'review' ? 'review' : 'home');
  const difficulty = mode === 'theme' ? undefined : arg;
  const theme = mode === 'theme' ? arg : undefined;
  const [puzzle, names] = await load(Promise.all([api.next({ mode, difficulty, theme, after }), themeInfo()]), 'board');
  if (puzzle.done) {
    if (mode === 'theme') {
      await renderMessage(nav, `You solved every ${esc(names[theme]?.name ?? 'theme')} puzzle`, 'Pick another theme to keep working on your weak spots.', '<a class="btn btn-primary" href="#/themes">All themes</a>', icons.trophy(28));
    } else if (mode === 'review') {
      await renderMessage(nav, 'Your review queue is clear', 'Puzzles you miss will come back here when they are due.', '<a class="btn btn-primary" href="#/solve/new">Keep solving</a>');
    } else {
      await renderMessage(nav, `You finished ${difficulty ? `the ${LEVELS[difficulty].name.toLowerCase()} level` : 'every puzzle'}`, 'Start a new cycle on the same set from the puzzle list.', '<a class="btn btn-primary" href="#/browse">Open all puzzles</a>', icons.trophy(28));
    }
    return;
  }
  await mountSolver(nav, puzzle, {
    mode, names, theme: theme && { key: theme, name: names[theme]?.name ?? theme, left: puzzle.theme_left },
    next: () => { navId += 1; cleanup(); renderSession(navId, mode, arg, puzzle.id); },
  });
}

async function renderSingle(nav, id) {
  setNav('browse');
  let puzzle;
  let names = {};
  try {
    [puzzle, names] = await load(Promise.all([api.puzzle(id), themeInfo()]), 'board');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      await renderMessage(nav, 'This puzzle does not exist', 'Check the number. Puzzle 11 is left out because the book prints the wrong diagram for it.', '<a class="btn btn-primary" href="#/browse">Open all puzzles</a>', icons.info(28));
      return;
    }
    throw err;
  }
  await mountSolver(nav, puzzle, {
    mode: 'single',
    names,
    next: () => { location.hash = puzzle.next_id ? `#/puzzle/${puzzle.next_id}` : '#/browse'; },
  });
}

// ---------------------------------------------------------------- browse
async function renderBrowse(nav, params) {
  setNav('browse');
  const difficulty = params.get('difficulty') || '';
  const status = params.get('status') || 'all';
  const theme = params.get('theme') || '';
  const book = params.get('book') || '';
  const page = Math.max(0, Number(params.get('page') || 0));
  const [data, names] = await load(Promise.all([
    api.list({ difficulty, status, theme, book, offset: page * PAGE_SIZE, limit: PAGE_SIZE }), themeInfo()]));
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const link = (over) => `#/browse?${new URLSearchParams({ difficulty, status, theme, book, page: 0, ...over })}`;
  const seg = (items, key, current, label) => `
    <nav class="segmented" aria-label="${label}">
      ${items.map(([value, text]) => `<a href="${link({ [key]: value })}" class="${value === current ? 'active' : ''}" ${value === current ? 'aria-current="true"' : ''}>${text}</a>`).join('')}
    </nav>`;
  const mark = { solved: icons.check(14, 'Solved'), failed: icons.x(14, 'In review') };
  await paint(nav, `
    <div class="page-head">
      <div><h1>All puzzles</h1><p>Open any puzzle directly. The colour of a tile shows the result of your last attempt. Book 1 is tactics; book 2 (marked II) is positional play, where you find the key move.</p></div>
    </div>
    <div class="filters">
      ${seg([['', 'Both books'], ['1', 'Book 1 · Tactics'], ['2', 'Book 2 · Positional']], 'book', book, 'Book')}
      ${seg([['', 'All levels'], ...Object.entries(LEVELS).map(([k, v]) => [k, v.name])], 'difficulty', difficulty, 'Level')}
      ${seg([['all', 'Any status'], ['new', 'Unsolved'], ['solved', 'Solved'], ['failed', 'In review']], 'status', status, 'Status')}
      <label class="select-wrap"><span class="sr-only">Theme</span>
        <select id="theme-filter">
          <option value="">Any theme</option>
          ${Object.values(names).filter((t) => t.total).map((t) => `<option value="${t.key}" ${t.key === theme ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select></label>
      <span class="total">${count(data.total, 'puzzle')}</span>
    </div>
    ${data.items.length ? `<div class="tiles">
      ${data.items.map((p) => `
        <a class="tile ${p.status} ${p.book === 2 ? 'book2' : ''}" href="#/puzzle/${p.id}" title="${esc(puzzleName(p.id))}: ${esc(playersText(p))} ${p.year ?? ''} · ${STATUS[p.status]}">
          ${mark[p.status] ? `<span class="mark">${mark[p.status]}</span>` : ''}
          ${p.book === 2 ? '<span class="book-mark" aria-label="Book 2">II</span>' : ''}
          <span class="n">${p.number}</span><small>${esc(p.white || p.event)}</small>
        </a>`).join('')}
    </div>` : `<div class="surface empty">${icons.grid(40)}<h2>No puzzles here yet</h2><p>No puzzle matches these filters. Change the level or status to see others.</p><a class="btn" href="#/browse">Show all puzzles</a></div>`}
    ${pages > 1 ? `
      <nav class="pager" aria-label="Pages">
        ${page > 0 ? `<a class="btn" href="${link({ page: page - 1 })}">${icons.prev(16)} Previous</a>` : ''}
        <span class="muted">Page ${page + 1} of ${pages}</span>
        ${page < pages - 1 ? `<a class="btn" href="${link({ page: page + 1 })}">Next ${icons.next(16)}</a>` : ''}
      </nav>` : ''}`, () => stagger(view.querySelector('.tiles')));
  view.querySelector('#theme-filter')?.addEventListener('change', (e) => { location.hash = link({ theme: e.target.value }); });
}

// ---------------------------------------------------------------- themes
/** Themes with enough attempts to judge, weakest first (the engine already sorts them that way). */
const weakThemes = (s, limit = 3) => s.themes.filter((t) => t.attempts >= s.min_theme_attempts && t.accuracy < 100).slice(0, limit);

function weakCard(t, info) {
  return `<article class="surface weak-card lift">
    <div class="top"><strong>${esc(t.name)}</strong><span class="chip down">${t.accuracy}%</span></div>
    <p>${esc(info?.description ?? '')}</p>
    <div class="bar" role="img" aria-label="Accuracy ${t.accuracy}%"><div class="f" style="width:${t.accuracy}%"></div></div>
    <small class="muted">${count(t.attempts, 'attempt')} so far</small>
    <a class="btn" href="#/solve/theme/${t.key}">${icons.target(16)} Practise</a>
  </article>`;
}

async function renderThemes(nav) {
  setNav('home');
  const [list, s] = await load(Promise.all([api.themes(), api.stats()]));
  const mine = Object.fromEntries(s.themes.map((t) => [t.key, t]));
  const byKey = Object.fromEntries(list.map((t) => [t.key, t]));
  const weak = weakThemes(s);
  await paint(nav, `
    <div class="page-head">
      <div><h1>Themes</h1><p>Every puzzle is tagged with the tactics in its solution. Practise one theme at a time to fix a weak spot; puzzles you have already solved are skipped.</p></div>
    </div>
    ${weak.length ? `<section class="section"><div class="section-head"><h2>Your weak spots</h2></div>
      <div class="weak-grid stagger">${weak.map((t) => weakCard(t, byKey[t.key])).join('')}</div></section>` : ''}
    ${[['tactics', 'Tactics', 'Book 1: forcing combinations.'], ['positional', 'Positional play', 'Book 2: the key move of a plan.']].map(([group, title, note]) => `
    <section class="section">
      <div class="section-head"><h2>${title}</h2><span class="muted">${note}</span></div>
    <div class="theme-grid stagger">
      ${list.filter((t) => t.total && t.group === group).map((t) => {
        const m = mine[t.key];
        return `<article class="surface theme-card lift">
          <header><h2>${esc(t.name)}</h2>${m?.accuracy != null ? `<span class="chip ${m.accuracy < 60 ? 'down' : m.accuracy >= 85 ? 'up' : ''}">${m.accuracy}% accuracy</span>` : ''}</header>
          <p>${esc(t.description)}</p>
          <div class="bar" role="img" aria-label="${t.solved} of ${t.total} solved"><div class="s" style="width:${pct(t.solved, t.total)}%"></div></div>
          <small class="muted">${n(t.solved)} of ${count(t.total, 'puzzle')} solved</small>
          <div class="row">
            <a class="btn btn-primary" href="#/solve/theme/${t.key}">Practise</a>
            <a class="btn btn-ghost" href="#/browse?theme=${t.key}">Browse</a>
          </div>
        </article>`;
      }).join('')}
    </div>
    </section>`).join('')}
    <p class="help" style="margin-top:var(--s-4)">${icons.info(13)} Themes are detected automatically: tactics from each solution line, positional themes from the book's explanation of the key move. A few tags may be imperfect.</p>`,
  () => { view.querySelectorAll('.theme-grid').forEach((g) => stagger(g)); stagger(view.querySelector('.weak-grid')); });
}

// ---------------------------------------------------------------- statistics
function deltaChip(now, before, unit = '') {
  if (now == null || before == null) return '<small>No data for last week</small>';
  const d = now - before;
  if (d === 0) return '<span class="chip">Same as last week</span>';
  const up = d > 0;
  const label = Math.abs(d) === 1 ? unit.replace(/s$/, '') : unit;
  return `<span class="chip ${up ? 'up' : 'down'}">${up ? icons.arrowUp(12) : icons.arrowDown(12)} ${up ? '+' : ''}${d}${label} vs last week</span>`;
}

function relativeDue(iso) {
  if (!iso) return 'No later reviews scheduled';
  const ms = new Date(iso) - Date.now();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const hours = Math.round(ms / 3.6e6);
  return `Next review ${Math.abs(hours) < 24 ? rtf.format(hours, 'hour') : rtf.format(Math.round(hours / 24), 'day')}`;
}

function dailyCard(s) {
  return `
    <header><div><h2>Daily results</h2><p>Solved and missed puzzles per day.</p></div>
      <div class="segmented" role="group" aria-label="Range">
        ${[14, 30, 90].map((d) => `<button type="button" data-range="${d}" aria-pressed="${d === s.range}">${d} days</button>`).join('')}
      </div></header>
    <div class="chart-wrap" data-chart="daily"></div>
    <div class="legend"><span><i class="s"></i>Solved</span><span><i class="f"></i>Missed</span></div>
    <table class="sr-only"><caption>Daily results</caption><thead><tr><th>Day</th><th>Solved</th><th>Missed</th></tr></thead>
      <tbody>${s.activity.map((d) => `<tr><th>${fmtDay(d.date)}</th><td>${d.solved}</td><td>${d.failed}</td></tr>`).join('')}</tbody></table>`;
}

async function renderStats(nav) {
  setNav('stats');
  const s = await load(api.stats(statsRange));
  const r = s.records;
  const d = s.deltas;

  const empty = s.total_attempts === 0;
  const kpis = `
    <div class="kpis stagger">
      <section class="surface kpi lift">
        <span class="label">Puzzles solved</span>
        <div class="value-row"><span class="value"><span data-count="${s.solved}">0</span><small> / ${n(s.total)}</small></span>${sparkline(s.spark.map((x) => x.solved))}</div>
        <div class="foot">${deltaChip(d.solved.now, d.solved.before, ' solves')}</div>
      </section>
      <section class="surface kpi lift">
        <span class="label">Accuracy</span>
        <div class="value-row"><span class="value">${s.accuracy == null ? '—' : `<span data-count="${s.accuracy}" data-suffix="%">0%</span>`}</span>${sparkline(s.spark.map((x) => x.attempts))}</div>
        <div class="foot">${deltaChip(d.accuracy.now, d.accuracy.before, ' pts')}</div>
      </section>
      <section class="surface kpi lift">
        <span class="label">Day streak</span>
        <div class="value-row"><span class="value"><span data-count="${s.streak_days}">0</span><small> ${s.streak_days === 1 ? 'day' : 'days'}</small></span><span style="color:var(--gold)">${icons.flame(28)}</span></div>
        <div class="foot"><small>Best: ${count(s.best_streak, 'day')}</small></div>
      </section>
      <section class="surface kpi lift">
        <span class="label">Review queue</span>
        <div class="value-row"><span class="value"><span data-count="${s.review_due}">0</span><small> due</small></span><span style="color:var(--accent)">${icons.repeat(28)}</span></div>
        <div class="foot"><small>${count(s.review_total, 'puzzle')} in boxes${s.next_due ? ` · ${relativeDue(s.next_due)}` : ''}</small></div>
      </section>
    </div>`;

  const rings = Object.entries(LEVELS).map(([key, lv]) => {
    const l = s.levels[key];
    return `<div class="ring-card">
      <div class="ring-wrap">${ring(l.solved / l.total, 88, 9, 'var(--ok)')}<strong>${Math.round(pct(l.solved, l.total))}%</strong></div>
      ${levelTag(key)}
      <small>${n(l.solved)} of ${n(l.total)} solved · ${pctText(l.accuracy)} accuracy</small>
    </div>`;
  }).join('');

  const records = `
    <div class="record"><span class="icon-box">${icons.bolt(20)}</span><div><strong>${r.fastest ? fmtDuration(r.fastest.time_ms) : '—'}</strong><span>Fastest solve${r.fastest ? ` (${puzzleName(r.fastest.puzzle_id).toLowerCase()})` : ''}</span></div></div>
    <div class="record"><span class="icon-box">${icons.shield(20)}</span><div><strong>${n(r.best_clean_run)}</strong><span>Longest run without a mistake</span></div></div>
    <div class="record"><span class="icon-box">${icons.calendar(20)}</span><div><strong>${r.best_day ? n(r.best_day.attempts) : '—'}</strong><span>Most puzzles in a day${r.best_day ? ` (${fmtDay(r.best_day.date)})` : ''}</span></div></div>
    <div class="record"><span class="icon-box">${icons.flame(20)}</span><div><strong>${count(r.best_streak, 'day')}</strong><span>Longest streak</span></div></div>`;

  const hardest = s.hardest.length
    ? `<div class="hard-cards">${s.hardest.map((h) => `
        <a class="hard-card lift" href="#/puzzle/${h.id}">
          <div class="board-mini" data-fen="${esc(h.fen)}" role="img" aria-label="Board of puzzle ${h.id}"></div>
          <div class="meta"><span>${puzzleName(h.id)}</span><span class="chip failed">${count(h.fails, 'mistake')}</span></div>
        </a>`).join('')}</div>`
    : '<p class="muted">No misses yet. Puzzles you get wrong most often will appear here.</p>';

  await paint(nav, `
    <div class="page-head"><div><h1>Statistics</h1><p>Your training at a glance: volume, accuracy, speed and what needs another look.</p></div></div>
    ${empty ? `<div class="surface empty enter" style="margin-bottom:var(--s-4)">${icons.chart(40)}<h2>Your charts start with your first puzzle</h2>
      <p>Solve a few puzzles and this page fills in with your trends, streaks and personal records.</p><a class="btn btn-primary" href="#/solve/new">Start solving</a></div>` : ''}
    ${kpis}
    <div class="stats-grid stagger">
      <section class="surface card span-8" id="daily-card">${dailyCard(s)}</section>
      <section class="surface card span-4">
        <header><div><h2>Levels</h2><p>Share of each level solved.</p></div></header>
        <div class="rings">${rings}</div>
      </section>
      <section class="surface card span-12">
        <header><div><h2>Activity</h2><p>Attempts per day over the last six months.</p></div></header>
        <div class="chart-wrap">${heatmap(s.heatmap)}</div>
      </section>
      <section class="surface card span-7">
        <header><div><h2>Accuracy trend</h2><p>Share of attempts solved, week by week.</p></div></header>
        <div class="chart-wrap" data-chart="accuracy"></div>
      </section>
      <section class="surface card span-5">
        <header><div><h2>Solve time</h2><p>How long your correct solves take.</p></div></header>
        <div class="chart-wrap" data-chart="time"></div>
      </section>
      <section class="surface card span-5">
        <header><div><h2>Review boxes</h2><p>${esc(relativeDue(s.next_due))}. Box 1 is due now; each success moves a puzzle up.</p></div></header>
        <div class="chart-wrap" data-chart="boxes"></div>
      </section>
      <section class="surface card span-7">
        <header><div><h2>Personal records</h2></div></header>
        <div class="records">${records}</div>
      </section>
      <section class="surface card span-12">
        <header><div><h2>Hardest for you</h2><p>The puzzles you have missed most often.</p></div></header>
        ${hardest}
      </section>
      <section class="surface card span-12">
        <header><div><h2>Themes</h2><p>Accuracy on puzzles with each tactic, weakest first. A theme counts once you have ${s.min_theme_attempts} attempts on it.</p></div>
          <a class="btn btn-ghost" href="#/themes">All themes</a></header>
        ${s.themes.some((t) => t.attempts) ? `<div class="theme-table">${s.themes.filter((t) => t.attempts).map((t) => `
          <div class="theme-row ${t.attempts < s.min_theme_attempts ? 'thin' : ''}">
            <strong>${esc(t.name)}</strong>
            <div class="bar" role="img" aria-label="Accuracy ${t.accuracy}%"><div class="s" style="width:${t.accuracy}%"></div></div>
            <span class="mono">${t.accuracy}%</span>
            <small class="muted">${count(t.attempts, 'attempt')}</small>
            <a class="btn btn-ghost" href="#/solve/theme/${t.key}">Practise</a>
          </div>`).join('')}</div>`
    : '<p class="muted">Solve some puzzles and your accuracy per theme shows up here.</p>'}
      </section>
    </div>`, () => {
    stagger(view.querySelector('.kpis'));
    stagger(view.querySelector('.stats-grid'));
    view.querySelectorAll('.hard-card .board-mini').forEach((el) => miniBoard(el, el.dataset.fen));
  });
  countUp(view);
  fillRings(view);
  let data = s;
  const tipFor = (it) => `<strong>${esc(it.label)}</strong>${count(it.count, 'puzzle')}`;
  const builders = {
    daily: (w) => dailyBars(data.activity, 220, w),
    accuracy: (w) => accuracyLine(data.weekly_accuracy, 220, w),
    time: (w) => columns(data.time_histogram, { width: w, label: 'Solve time distribution', tip: tipFor }),
    boxes: (w) => columns(data.review_boxes.map((b) => ({ label: `Box ${b.box}`, count: b.count })), { width: w, label: 'Puzzles per review box', tip: tipFor }),
  };
  const draw = () => view.querySelectorAll('.chart-wrap[data-chart]').forEach((wrap) => {
    const tip = wrap.querySelector('.tip');
    wrap.innerHTML = builders[wrap.dataset.chart](Math.max(280, Math.round(wrap.clientWidth)));
    if (tip) wrap.append(tip);
  });
  draw();
  attachTips(view);
  let resizeTimer;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); };
  window.addEventListener('resize', onResize);
  onLeave(() => window.removeEventListener('resize', onResize));

  view.querySelector('#daily-card').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn || Number(btn.dataset.range) === statsRange) return;
    statsRange = Number(btn.dataset.range);
    data = { ...data, ...(await api.stats(statsRange)) };
    view.querySelectorAll('#daily-card [data-range]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === statsRange)));
    const wrap = view.querySelector('#daily-card .chart-wrap');
    const tip = wrap.querySelector('.tip');
    wrap.innerHTML = builders.daily(Math.round(wrap.clientWidth));
    if (tip) wrap.append(tip);
    view.querySelector('#daily-card table.sr-only tbody').innerHTML = data.activity.map((d) => `<tr><th>${fmtDay(d.date)}</th><td>${d.solved}</td><td>${d.failed}</td></tr>`).join('');
  });
}

// ---------------------------------------------------------------- profile
const TIERS = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const LEARN_KEYS = new Set(['first_lesson', 'piece_mover', 'rule_book', 'checkmater', 'coord_pro', 'knight_rider', 'mate_spotter', 'all_rounder', 'graduate', 'top_marks']);
const OPENING_KEYS = new Set(['first_line', 'line_master', 'both_sides', 'trap_setter', 'repertoire']);

// a tiny tile that shows what a reward looks like
function rewardPreview({ kind, item }) {
  const cls = { bg: `bg-${item}`, pattern: `bg-slate pat-${item}`, frame: `bg-slate frame-${item}`, pieces: `bg-slate set-${item}` }[kind];
  const piece = kind === 'pieces' ? '<span class="avatar-piece is-w"><i class="piece-img pc-wn"></i></span>' : '';
  return `<span class="avatar avatar-xs ${cls}" aria-hidden="true">${piece}</span>`;
}

// where to go to work on an achievement
function goalAction(key) {
  if (key === 'bounce_back' || key === 'comeback') return ['#/review', 'Open review', icons.repeat(18)];
  if (LEARN_KEYS.has(key)) return ['#/learn', 'Open Learn', icons.book(18)];
  if (OPENING_KEYS.has(key)) return ['#/learn/openings', 'Open openings', icons.book(18)];
  return ['#/', 'Start training', icons.target(18)];
}

/** Explain a reward: preview it on the viewer's avatar and say which achievement unlocks it. */
function rewardDialog(reward, a, avatar) {
  const field = { bg: 'bg', pattern: 'pattern', frame: 'frame', pieces: 'set' }[reward.kind];
  const left = Math.max(0, a.goal - a.value);
  const [href, label, icon] = a.earned ? ['#/profile/edit', 'Use it now', icons.pencil(18)] : goalAction(a.key);
  const dlg = document.createElement('dialog');
  dlg.className = 'reward-dialog';
  dlg.setAttribute('aria-labelledby', 'reward-title');
  dlg.innerHTML = `
    <button type="button" class="btn-ghost close" aria-label="Close">${icons.x(18)}</button>
    <div class="reward-hero">${avatarHtml({ ...avatar, [field]: reward.item }, 'lg', `${rewardName(reward)} on your avatar`)}</div>
    <p class="eyebrow">${a.earned ? `${icons.check(12)} Unlocked` : `${icons.lock(12)} Locked reward`}</p>
    <h2 id="reward-title">${esc(rewardName(reward))}</h2>
    <p class="muted">${a.earned ? 'You own this. Pick it in Edit profile to wear it.' : 'This is how it looks on your avatar. To unlock it:'}</p>
    <div class="unlock-card tier-${a.tier} ${a.earned ? 'earned' : ''}">
      <span class="medallion">${medalFor(a)}</span>
      <div class="unlock-body">
        <span class="tier">${TIERS[a.tier]} achievement</span>
        <strong>${esc(a.title)}</strong>
        <p>${esc(a.detail)}</p>
        <div class="bar" role="img" aria-label="${a.value} of ${a.goal}"><div class="a" style="width:${a.earned ? 100 : pct(a.value, a.goal)}%"></div></div>
        <small>${n(a.value)} / ${n(a.goal)}${a.earned ? ' · Done' : ` · ${n(left)} to go`}</small>
      </div>
    </div>
    <div class="row actions">
      <button type="button" class="btn-ghost" data-close>Close</button>
      <a class="btn btn-primary" href="${href}">${icon} ${label}</a>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  // a click on the backdrop lands on the dialog element itself
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('.close, [data-close], a')) dlg.close(); });
  dlg.showModal();
}

function badgeHtml(a) {
  const share = a.earned ? 100 : pct(a.value, a.goal);
  return `<li class="badge tier-${a.tier} ${a.earned ? 'earned' : 'locked'} lift" data-earned="${a.earned}" data-pct="${Math.round(share)}">
    <span class="medallion">${medalFor(a)}</span>
    <span class="tier">${TIERS[a.tier]}</span>
    <strong>${esc(a.title)}</strong>
    <p>${esc(a.detail)}</p>
    ${a.earned ? `<span class="chip solved">${icons.check(12)} Earned</span>`
      : `<div class="bar" role="img" aria-label="${a.value} of ${a.goal}"><div class="a" style="width:${share}%"></div></div>
         <span class="progress-text">${n(a.value)} / ${n(a.goal)}</span>`}
    ${a.reward ? `<button type="button" class="reward" data-reward="${a.key}" aria-haspopup="dialog" title="How to get the ${esc(rewardName(a.reward))}">${rewardPreview(a.reward)}${esc(rewardName(a.reward))}</button>` : ''}
  </li>`;
}

async function renderProfile(nav) {
  setNav('profile');
  const p = await load(api.profile());
  const g = p.progress;
  const r = g.rank;
  const earned = g.achievements.filter((a) => a.earned).length;
  const rewards = g.achievements.filter((a) => a.reward).length;
  const toNext = r.next_at ? pct(g.solved - r.floor, r.next_at - r.floor) : 100;
  await paint(nav, `
    <section class="surface profile-hero">
      <div class="profile-cover bg-${p.avatar.bg}" aria-hidden="true"></div>
      <div class="profile-id">
        ${avatarHtml(p.avatar, 'lg', `Avatar: ${AVATAR.pieces.find(([k]) => k === p.avatar.piece)[1]}`)}
        <div class="who">
          <h1>${esc(p.display_name)}</h1>
          <div class="meta">
            <span class="chip rank">${icons.crown(14)} ${esc(r.title)}</span>
            <span>${icons.calendar(16)} Member since ${fmtMonth(p.joined)}</span>
          </div>
          ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
        </div>
        <a class="btn" href="#/profile/edit">${icons.pencil(18)} Edit profile</a>
      </div>
    </section>
    <div class="profile-grid">
      <section class="surface">
        <div class="rank-progress">
          <div class="title">${icons.crown(22)}<h2>${esc(r.title)}</h2></div>
          <div class="bar" role="img" aria-label="Progress to the next rank"><div class="a" style="width:${toNext}%"></div></div>
          <p>${r.next_at ? `${n(g.solved)} of ${n(r.next_at)} solved to reach ${esc(r.next_title)}.` : 'You reached the highest rank in the book.'}</p>
        </div>
        <div class="stat-list">
          <div><strong data-count="${g.solved}">0</strong><span>Puzzles solved</span></div>
          <div><strong>${g.accuracy == null ? '—' : `<span data-count="${g.accuracy}" data-suffix="%">0%</span>`}</strong><span>Accuracy</span></div>
          <div><strong data-count="${g.streak_days}">0</strong><span>Current streak</span></div>
          <div><strong data-count="${g.best_streak}">0</strong><span>Longest streak</span></div>
        </div>
      </section>
      <section class="surface">
        <div class="section-head">
          <div><h2>Achievements</h2><span class="collection">${icons.gift(16)} ${earned} of ${g.achievements.length} earned, ${g.unlocked.length} of ${rewards} rewards unlocked</span></div>
          <div class="segmented badge-filter" role="group" aria-label="Show achievements">
            <button type="button" data-filter="all" aria-pressed="true">All</button>
            <button type="button" data-filter="next" aria-pressed="false">Closest</button>
            <button type="button" data-filter="earned" aria-pressed="false">Earned</button>
          </div>
        </div>
        <ul class="badges">${g.achievements.map(badgeHtml).join('')}</ul>
      </section>
    </div>`, () => stagger(view.querySelector('.badges')));
  countUp(view);
  view.querySelector('.badges').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reward]');
    if (!btn) return;
    const a = g.achievements.find((x) => x.key === btn.dataset.reward);
    rewardDialog(a.reward, a, p.avatar);
  });
  // "Closest" lists what is still to earn, nearest goal first
  view.querySelector('.badge-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const mode = btn.dataset.filter;
    view.querySelectorAll('.badge-filter [data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    view.querySelectorAll('.badges .badge').forEach((li) => {
      const done = li.dataset.earned === 'true';
      li.hidden = (mode === 'earned' && !done) || (mode === 'next' && done);
      li.style.order = mode === 'next' ? String(100 - Number(li.dataset.pct)) : '';
    });
    stagger(view.querySelector('.badges'));
  });
}

function optionHtml(name, value, checked, face, label, disabled = false, locked = false) {
  return `<label class="opt">
    <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${esc(label)}">
    <span class="face">${face}${locked ? `<span class="lock">${icons.lock(14)}</span>` : ''}</span>
  </label>`;
}

async function renderProfileEdit(nav) {
  setNav('profile');
  const p = await load(api.profile());
  // rewards: which achievement unlocks an item; items already equipped stay usable
  const rewardFor = new Map(p.progress.achievements.filter((a) => a.reward).map((a) => [`${a.reward.kind}:${a.reward.item}`, a]));
  const unlocked = new Set(p.progress.unlocked);
  const equipped = { bg: p.avatar.bg, pattern: p.avatar.pattern, frame: p.avatar.frame, pieces: p.avatar.set };
  const lockedBy = (kind, item) => {
    const a = rewardFor.get(`${kind}:${item}`);
    return a && !unlocked.has(`${kind}:${item}`) && equipped[kind] !== item ? a : null;
  };
  const choice = (field, kind, [k, name], swatch) => {
    const a = lockedBy(kind, k);
    if (!a) return optionHtml(field, k, state[field] === k, `${swatch}${name}`, name);
    return `<span class="opt">
      <button type="button" class="opt-locked" data-kind="${kind}" data-item="${k}" aria-haspopup="dialog"
        aria-label="${esc(name)}, locked. Show how to unlock it."></button>
      <span class="face">${swatch}${name}<small class="req">${icons.lock(11)}${esc(a.title)}</small></span>
    </span>`;
  };
  const state = {
    display_name: p.display_name === p.username ? '' : p.display_name,
    bio: p.bio,
    avatar_piece: p.avatar.piece,
    avatar_color: p.avatar.color,
    avatar_bg: p.avatar.bg,
    avatar_pattern: p.avatar.pattern,
    frame: p.avatar.frame,
    piece_set: p.avatar.set,
    board_theme: p.board_theme,
    theme_mode: p.appearance.mode,
    light_palette: p.appearance.light,
    dark_palette: p.appearance.dark,
    accent: p.appearance.accent,
    custom_theme: p.appearance.custom,
  };
  const initial = JSON.stringify(state);
  const avatarOf = () => ({ piece: state.avatar_piece, color: state.avatar_color, bg: state.avatar_bg, pattern: state.avatar_pattern, frame: state.frame, set: state.piece_set });
  const appearanceOf = () => ({ mode: state.theme_mode, light: state.light_palette, dark: state.dark_palette, accent: state.accent, custom: state.custom_theme });
  // a new custom theme starts from what is on screen now: the current shade and accent
  const startCustom = () => {
    const scheme = root.dataset.scheme === 'dark' ? 'dark' : 'light';
    const c = PALETTES[scheme][scheme === 'dark' ? state.dark_palette : state.light_palette] ?? PALETTES.dark.midnight;
    return { ...DEFAULT_CUSTOM, ground: c.ground, surface: c.surface, ink: c.ink, accent: PALETTES.accent[state.accent][scheme], gradient: 'none',
      ground2: scheme === 'dark' ? '#2a1f45' : '#dfe8ff' };
  };
  const customFields = [['ground', 'Background'], ['surface', 'Cards'], ['ink', 'Text'], ['accent', 'Accent']];
  const gradientPreview = (t) => customTheme(t).vars['--ground-img'].replace('none', t.ground);
  const customEditor = () => {
    const t = customTheme(state.custom_theme ?? DEFAULT_CUSTOM);
    const c = t.theme;
    return `
      <fieldset><legend>Start from a preset</legend><div class="preset-row">
        ${PRESETS.map(([name, p], i) => `<button type="button" class="preset" data-preset="${i}">
          <span class="preset-swatch" style="background:${gradientPreview(p)}"><i style="background:${p.surface};color:${p.ink}">Aa</i><b style="background:${p.accent}"></b></span>${name}</button>`).join('')}
      </div></fieldset>
      <fieldset><legend>Colours</legend><div class="color-grid">
        ${customFields.map(([k, label]) => `<label class="color-field"><input type="color" name="ct_${k}" value="${c[k]}">
          <span>${label}<small class="mono" data-hex="${k}">${c[k]}</small></span></label>`).join('')}
      </div></fieldset>
      <fieldset><legend>Background style</legend>
        <div class="segmented" role="group" aria-label="Background style">${GRADIENTS.map(([k, name]) =>
    `<button type="button" data-gradient="${k}" aria-pressed="${c.gradient === k}">${name}</button>`).join('')}</div>
        ${c.gradient !== 'none' ? `<label class="color-field second-colour"><input type="color" name="ct_ground2" value="${c.ground2}">
          <span>Second colour<small class="mono" data-hex="ground2">${c.ground2}</small></span></label>` : ''}
      </fieldset>
      <div class="contrast-note ${t.text >= 4.5 ? '' : 'warn'}" id="ct-contrast">${contrastNote(t)}</div>`;
  };
  const contrastNote = (t) => (t.text >= 4.5
    ? `${icons.check(16)}<span>Text contrast ${t.text.toFixed(1)}:1, easy to read.${t.accentAdjusted ? ' The accent was darkened or lightened a little so links and buttons stay readable.' : ''}</span>`
    : `${icons.info(16)}<span>Text contrast is only ${t.text.toFixed(1)}:1 and may be hard to read (4.5:1 or more is best).</span>
       <button type="button" class="btn-sm" id="ct-fix">Fix text colour</button>`);
  const refreshCustom = (full) => {
    const box = view.querySelector('#custom-theme');
    if (full) { box.innerHTML = customEditor(); return; }
    const t = customTheme(state.custom_theme);
    box.querySelectorAll('[data-hex]').forEach((el) => { el.textContent = t.theme[el.dataset.hex]; });
    const note = box.querySelector('#ct-contrast');
    note.className = `contrast-note ${t.text >= 4.5 ? '' : 'warn'}`;
    note.innerHTML = contrastNote(t);
  };

  const pieceOptions = () => AVATAR.pieces.map(([k, name]) =>
    optionHtml('avatar_piece', k, state.avatar_piece === k, `<span class="fig piece-img pc-${state.avatar_color}${k}"></span>${name}`, name)).join('');
  const setOptions = () => AVATAR.sets.map((item) => {
    const [light, dark] = BOARD_COLORS[state.board_theme];
    return choice('piece_set', 'pieces', item,
      `<span class="set-swatch set-${item[0]}" style="--b-light:${light};--b-dark:${dark}"><i class="piece-img pc-wk"></i><i class="piece-img pc-bn"></i></span>`);
  }).join('');
  const shadeOptions = (field, list, scheme) => list.map(([k, name]) => {
    const c = PALETTES[scheme][k];
    return optionHtml(field, k, state[field] === k,
      `<span class="theme-swatch" style="--t-ground:${c.ground};--t-surface:${c.surface};--t-ink:${c.ink};--t-accent:${PALETTES.accent[state.accent][scheme]}"></span>${name}`, `${name} ${scheme} shade`);
  }).join('');
  const accentOptions = () => THEMES.accents.map(([k, name]) =>
    optionHtml('accent', k, state.accent === k, `<span class="accent-dot" style="--a:${PALETTES.accent[k][root.dataset.scheme]}"></span>${name}`, `${name} accent`)).join('');

  const ok = await paint(nav, `
    <div class="page-head">
      <div><h1>Edit profile</h1><p>Pick your avatar, colours and board. Everything previews live; nothing is saved until you press “Save changes”.</p></div>
    </div>
    <form class="editor" id="editor" novalidate>
      <aside class="surface preview-card" aria-label="Preview">
        <div class="profile-cover" id="pv-cover" aria-hidden="true"></div>
        <div class="inner">
          <span id="pv-avatar"></span>
          <span class="name" id="pv-name"></span>
          <span class="chip rank">${icons.crown(14)} ${esc(p.progress.rank.title)}</span>
          <p class="bio" id="pv-bio"></p>
          <div class="board-preview" id="pv-board" role="img" aria-label="Board theme preview"></div>
        </div>
      </aside>
      <div class="form-sections stagger">
        <section class="surface form-section">
          <h2>${icons.sun(20)} Appearance</h2>
          <fieldset><legend>Mode</legend><div class="options">
            ${THEMES.modes.map(([k, name]) => optionHtml('theme_mode', k, state.theme_mode === k, `${{ system: icons.board(22), light: icons.sun(22), dark: icons.moon(22), custom: icons.palette(22) }[k]}${name}`, `${name} mode`)).join('')}
          </div></fieldset>
          <div id="named-theme" class="theme-group" ${state.theme_mode === 'custom' ? 'hidden' : ''}>
            <fieldset><legend>Light shade</legend><div class="options" id="light-options">${shadeOptions('light_palette', THEMES.light, 'light')}</div></fieldset>
            <fieldset><legend>Dark shade</legend><div class="options" id="dark-options">${shadeOptions('dark_palette', THEMES.dark, 'dark')}</div></fieldset>
            <fieldset><legend>Accent colour</legend><div class="options" id="accent-options">${accentOptions()}</div></fieldset>
          </div>
          <div id="custom-theme" class="theme-group custom-theme" ${state.theme_mode === 'custom' ? '' : 'hidden'}>${state.theme_mode === 'custom' ? customEditor() : ''}</div>
        </section>
        <section class="surface form-section">
          <h2>${icons.user(20)} Identity</h2>
          <div class="field">
            <label for="display_name">Display name</label>
            <input id="display_name" name="display_name" type="text" maxlength="40" value="${esc(state.display_name)}" placeholder="${esc(p.username)}">
            <p class="help">Shown in the header and on your profile. Leave it empty to show “Player”.</p>
          </div>
          <div class="field">
            <label for="bio">Bio</label>
            <textarea id="bio" name="bio" maxlength="160" placeholder="For example: ten puzzles every morning before work.">${esc(state.bio)}</textarea>
            <p class="help"><span id="bio-count">${state.bio.length}</span> / 160 characters</p>
          </div>
        </section>
        <section class="surface form-section">
          <h2>${icons.palette(20)} Avatar</h2>
          <fieldset><legend>Piece</legend><div class="options set-${state.piece_set}" id="piece-options">${pieceOptions()}</div></fieldset>
          <fieldset><legend>Piece colour</legend><div class="options">
            ${AVATAR.colors.map(([k, name]) => optionHtml('avatar_color', k, state.avatar_color === k, `<span class="fig pc-${k}k"></span>${name}`, name)).join('')}
          </div></fieldset>
          <fieldset><legend>Background</legend><div class="options">
            ${AVATAR.backgrounds.map((item) => choice('avatar_bg', 'bg', item, `<span class="swatch-dot avatar bg-${item[0]}"></span>`)).join('')}
          </div></fieldset>
          <fieldset><legend>Pattern</legend><div class="options">
            ${AVATAR.patterns.map((item) => choice('avatar_pattern', 'pattern', item, `<span class="swatch-dot avatar bg-slate pat-${item[0]}"></span>`)).join('')}
          </div></fieldset>
          <fieldset><legend>Frame</legend><div class="options">
            ${AVATAR.frames.map((item) => choice('frame', 'frame', item, `<span class="swatch-dot avatar bg-slate frame-${item[0]}" style="width:28px;height:28px;margin:4px"></span>`)).join('')}
          </div></fieldset>
          <p class="help">${icons.lock(13)} Locked styles are rewards. Click one to preview it and see how to unlock it.</p>
        </section>
        <section class="surface form-section">
          <h2>${icons.star(20)} Piece style</h2>
          <fieldset><legend class="sr-only">Piece style</legend>
            <p class="fieldset-note">Used on your avatar and on every board you play.</p>
            <div class="options" id="set-options">${setOptions()}</div>
          </fieldset>
        </section>
        <section class="surface form-section">
          <h2>${icons.board(20)} Board</h2>
          <fieldset><legend class="sr-only">Board theme</legend><div class="options">
            ${AVATAR.boards.map(([k, name]) => optionHtml('board_theme', k, state.board_theme === k,
              `<span class="board-swatch" style="--b-light:${BOARD_COLORS[k][0]};--b-dark:${BOARD_COLORS[k][1]}"></span>${name}`, `${name} board`)).join('')}
          </div></fieldset>
        </section>
        <div class="surface save-bar" id="save-bar">
          <p id="dirty-note">No changes yet.</p>
          <div class="row">
            <a class="btn btn-ghost" href="#/profile">Cancel</a>
            <button class="btn-primary" type="submit" id="save">${icons.save(18)} Save changes</button>
          </div>
        </div>
      </div>
    </form>`, () => stagger(view.querySelector('.form-sections')));
  if (!ok) return;

  miniBoard(view.querySelector('#pv-board'), SAMPLE_FEN);
  // leaving without saving drops the live preview
  let saved = false;
  onLeave(() => { if (!saved && me) { applyBoard(me.board_theme); applyPieces(me.avatar?.set); applyAppearance(me.appearance); } });

  const form = view.querySelector('#editor');
  const paintPreview = () => {
    view.querySelector('#pv-cover').className = `profile-cover bg-${state.avatar_bg}`;
    view.querySelector('#pv-avatar').innerHTML = avatarHtml(avatarOf(), 'lg', 'Avatar preview');
    view.querySelector('#pv-name').textContent = state.display_name.trim() || p.username;
    view.querySelector('#pv-bio').textContent = state.bio.trim();
    view.querySelector('#bio-count').textContent = state.bio.length;
    applyBoard(state.board_theme);
    applyPieces(state.piece_set);
    applyAppearance(appearanceOf());
    const dirty = JSON.stringify(state) !== initial;
    view.querySelector('#save-bar').classList.toggle('dirty', dirty);
    view.querySelector('#dirty-note').textContent = dirty ? 'You have unsaved changes.' : 'No changes yet.';
  };
  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name?.startsWith('ct_')) {
      state.custom_theme = { ...state.custom_theme, [name.slice(3)]: value };
      paintPreview();
      refreshCustom(false);
      return;
    }
    if (!(name in state)) return;
    if (name === 'theme_mode') {
      if (value === 'custom' && !state.custom_theme) state.custom_theme = startCustom();
      view.querySelector('#named-theme').hidden = value === 'custom';
      const box = view.querySelector('#custom-theme');
      box.hidden = value !== 'custom';
      if (value === 'custom') box.innerHTML = customEditor();
    }
    state[name] = value;
    if (name === 'avatar_color') view.querySelector('#piece-options').innerHTML = pieceOptions();
    if (name === 'piece_set') view.querySelector('#piece-options').className = `options set-${value}`;
    if (name === 'board_theme') view.querySelector('#set-options').innerHTML = setOptions();
    if (name === 'accent' || name === 'theme_mode') {
      paintPreview();
      view.querySelector('#light-options').innerHTML = shadeOptions('light_palette', THEMES.light, 'light');
      view.querySelector('#dark-options').innerHTML = shadeOptions('dark_palette', THEMES.dark, 'dark');
      view.querySelector('#accent-options').innerHTML = accentOptions();
      return;
    }
    paintPreview();
  });
  form.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-preset]');
    const gradient = e.target.closest('[data-gradient]');
    if (preset || gradient || e.target.closest('#ct-fix')) {
      if (preset) state.custom_theme = { ...PRESETS[Number(preset.dataset.preset)][1] };
      if (gradient) state.custom_theme = { ...state.custom_theme, gradient: gradient.dataset.gradient };
      if (e.target.closest('#ct-fix')) {
        // the text colour that reads best on both the background and the cards
        const c = customTheme(state.custom_theme).theme;
        const pick = (x) => Math.min(contrast(x, c.ground), contrast(x, c.surface));
        state.custom_theme = { ...state.custom_theme, ink: pick('#111111') > pick('#f4f4f4') ? '#111111' : '#f4f4f4' };
      }
      paintPreview();
      refreshCustom(true);
      return;
    }
    const btn = e.target.closest('.opt-locked');
    if (!btn) return;
    const a = rewardFor.get(`${btn.dataset.kind}:${btn.dataset.item}`);
    rewardDialog(a.reward, a, avatarOf());
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = view.querySelector('#save');
    btn.setAttribute('aria-busy', 'true');
    try {
      const updated = await api.saveProfile(state);
      me = { ...me, ...updated };
      saved = true;
      applyBoard(me.board_theme);
      applyPieces(me.avatar.set);
      applyAppearance(me.appearance);
      paintUserChip();
      toast('Profile saved.', 'ok', icons.check(18));
      location.hash = '#/profile';
    } catch (err) {
      toast(err.message, 'bad', icons.x(18));
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
  paintPreview();
}

// ---------------------------------------------------------------- router
// what the sprint page (sprint.js) needs from the shell
const shell = {
  paint, load, setNav, refreshHeader, onLeave, coordsHtml, celebrate, badgeHtml, rewardDialog, miniBoard, avatar: () => me.avatar,
};

// ---------------------------------------------------------------- back bar
// Pages where you play on a board get a bar on top that goes back to the page you came from
// (keeping its filters), or to the page they belong to when opened directly.
let fromPage = null;
const BOARD_PAGES = (parts) => ['puzzle', 'solve', 'review'].includes(parts[0])
  || (parts[0] === 'learn' && parts[1] && !(parts[1] === 'openings' && !parts[2]));

function pageLabel(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const [a, b] = path.split('/').filter(Boolean);
  if (a === 'learn' && b === 'openings') return new URLSearchParams(query).get('side') === 'traps' ? 'Traps' : 'Openings';
  return { learn: 'Learn', browse: 'Puzzles', themes: 'Themes', stats: 'Statistics', profile: 'Profile', sprint: 'Sprint' }[a] ?? 'Train';
}

/** Where a board page belongs when there is no page to go back to. */
function parentOf(parts) {
  if (parts[0] === 'puzzle') return '#/browse';
  if (parts[0] === 'solve' && parts[1] === 'theme') return '#/themes';
  if (parts[0] === 'learn' && (parts[1] === 'opening' || parts[1] === 'openings')) {
    const o = OPENINGS.find((x) => x.id === parts[2]);
    return o?.kind === 'trap' ? '#/learn/openings?side=traps' : `#/learn/openings${o?.side === 'b' ? '?side=b' : ''}`;
  }
  if (parts[0] === 'learn') return '#/learn';
  return '#/';
}

function paintBackBar(parts) {
  const bar = document.getElementById('backbar');
  if (!BOARD_PAGES(parts)) {
    bar.hidden = true;
    bar.innerHTML = '';
    fromPage = location.hash || '#/';
    return;
  }
  const href = fromPage ?? parentOf(parts);
  bar.innerHTML = `<a class="btn btn-ghost back-link" href="${href}" title="Back (Esc)">${icons.prev(18)} Back to ${esc(pageLabel(href))}</a>`;
  bar.hidden = false;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (e.target.closest('input, textarea, select')) return;
  const back = document.querySelector('#backbar:not([hidden]) .back-link');
  if (back) { e.preventDefault(); location.hash = back.getAttribute('href'); }
});

async function route() {
  cleanup();
  navId += 1;
  const nav = navId;
  if (!me) {
    try { me = await api.me(); } catch (err) {
      view.innerHTML = `<div class="surface empty">${icons.info(40)}<h2>Woodpecker could not start</h2><p>${esc(err.message)} Restart the app.</p></div>`;
      return;
    }
  }
  applyAppearance(me.appearance);
  applyBoard(me.board_theme);
  applyPieces(me.avatar?.set);
  if (!seenWelcome()) return renderWelcome();
  document.getElementById('topbar').hidden = false;
  paintUserChip();
  refreshHeader();

  const { parts, params } = parseHash();
  paintBackBar(parts);
  try {
    if (parts[0] === 'solve') await renderSession(nav, ['review', 'theme'].includes(parts[1]) ? parts[1] : 'new', parts[2]);
    else if (parts[0] === 'review') await renderSession(nav, 'review', params.get('difficulty'));
    else if (parts[0] === 'themes') await renderThemes(nav);
    else if (parts[0] === 'sprint') await renderSprint(nav, shell);
    else if (parts[0] === 'learn' && parts[1] === 'openings' && parts[2] === 'review') await renderOpeningReview(nav, shell);
    else if (parts[0] === 'learn' && parts[1] === 'openings') await renderOpenings(nav, shell, params);
    else if (parts[0] === 'learn' && parts[1] === 'opening') await renderOpening(nav, shell, parts[2], params);
    else if (parts[0] === 'learn' && parts[1] === 'drill') await renderDrill(nav, shell, parts[2]);
    else if (parts[0] === 'learn' && parts[1]) await renderLesson(nav, shell, parts[1]);
    else if (parts[0] === 'learn') await renderLearn(nav, shell);
    else if (parts[0] === 'puzzle') await renderSingle(nav, Number(parts[1]));
    else if (parts[0] === 'browse') await renderBrowse(nav, params);
    else if (parts[0] === 'stats') await renderStats(nav);
    else if (parts[0] === 'profile' && parts[1] === 'edit') await renderProfileEdit(nav);
    else if (parts[0] === 'profile') await renderProfile(nav);
    else await renderHome(nav);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="surface empty">${icons.info(40)}<h2>This page could not load</h2><p>${esc(err.message)} Go back and try again; if it keeps happening, restart the app.</p></div>`;
  }
}

document.getElementById('brand').insertAdjacentHTML('afterbegin', logo(40));
document.querySelectorAll('nav [data-icon]').forEach((a) => a.insertAdjacentHTML('afterbegin', icons[a.dataset.icon](20)));
appearance = (() => { try { return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem('appearance') || '{}') }; } catch { return { ...DEFAULT_APPEARANCE }; } })();
paintThemeButton();
window.addEventListener('hashchange', route);
route();
