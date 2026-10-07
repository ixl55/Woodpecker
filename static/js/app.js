import { Chessground } from '../vendor/chessground.js';
import { api, ApiError } from './api.js';
import { accuracyLine, attachTips, columns, dailyBars, heatmap, sparkline } from './charts.js';
import { icons, logo, ring, themeToggleSvg } from './icons.js';
import { burst, countUp, fillRings, pingSquare, shake, stagger, transition } from './motion.js';
import { PALETTES } from './palettes.js';
import { renderChallenge, renderFriend, renderFriends, renderNewChallenge } from './social.js';
import { Solver } from './solver.js';
import { renderSprint } from './sprint.js';
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
const DEFAULT_APPEARANCE = { mode: 'system', light: 'porcelain', dark: 'midnight', accent: 'cobalt' };
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
let noticeTimer = null;
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
  refreshNotices();
}

async function refreshNotices() {
  if (!me) return;
  let n;
  try { n = await api.notifications(); } catch { return; }
  const badge = document.getElementById('social-badge');
  badge.textContent = n.total;
  badge.hidden = !n.total;
  // a live duel needs a quick answer, so it gets a banner on every page except its own
  const banner = document.getElementById('live-banner');
  const here = location.hash.replace(/^#\/challenge\//, '');
  const duel = n.live.find((d) => String(d.id) !== here);
  if (!duel) { banner.hidden = true; return; }
  const who = esc(duel.from.display_name);
  banner.innerHTML = `${avatarHtml(duel.from.avatar, 'sm')}
    <span><strong>${duel.status === 'lobby' ? `Your duel with ${who} is waiting` : `${who} challenged you`}</strong>
    <small>Live duel · ${duel.minutes} min</small></span>
    <a class="btn btn-primary" href="#/challenge/${duel.id}">${duel.status === 'lobby' ? 'Join' : 'Open'}</a>`;
  banner.hidden = false;
}

const medalFor = (a) => {
  const piece = { pawn: 'p', knight: 'n', king: 'k' }[a.icon];
  return piece ? figurine('w', piece) : icons[a.icon](22);
};

// ---------------------------------------------------------------- password rules (mirrors app/security.py)
const PASSWORD_RULES = [
  ['At least 10 characters', (p) => p.length >= 10],
  ['An uppercase letter', (p) => /[A-Z]/.test(p)],
  ['A lowercase letter', (p) => /[a-z]/.test(p)],
  ['A number', (p) => /\d/.test(p)],
  ['A symbol such as ! ? # or @', (p) => /[^A-Za-z0-9]/.test(p)],
];
const rulesHtml = (id) => `<ul class="pw-rules" id="${id}" aria-live="polite">
  ${PASSWORD_RULES.map(([text]) => `<li>${icons.check(14)}<span>${text}</span></li>`).join('')}</ul>`;
function paintRules(list, password) {
  list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('ok', PASSWORD_RULES[i][1](password)));
}

// ---------------------------------------------------------------- sign in
function renderAuth() {
  document.getElementById('topbar').hidden = true;
  let mode = 'login';
  view.innerHTML = `
    <section class="auth">
      <div class="auth-intro stagger">
        <span class="brand">${logo(56)} Woodpecker</span>
        <h1>Tactics you <em>see</em>, not calculate.</h1>
        <p>2,127 puzzles from both <i>Woodpecker Method</i> books by Axel Smith and Hans Tikkanen: 1,127 tactics and 1,000 positional exercises. Solve them in order, and anything you miss comes back in review until it sticks.</p>
        <div class="facts">
          <div><strong>560</strong><span>easy</span></div>
          <div><strong>1,162</strong><span>intermediate</span></div>
          <div><strong>405</strong><span>advanced</span></div>
        </div>
        <div class="auth-board">
          <div class="board-mini" id="mini" role="img" aria-label="Board of exercise 1"></div>
          <p>Exercise 1: Hamppe vs Steinitz, Vienna 1860. Black to move and win.</p>
        </div>
      </div>
      <div class="surface auth-card enter">
        <div class="tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" data-mode="login" aria-selected="true">Sign in</button>
          <button type="button" role="tab" data-mode="register" aria-selected="false">Create account</button>
        </div>
        <form novalidate>
          <div class="field">
            <label for="u">Username</label>
            <input id="u" type="text" autocomplete="username" required aria-describedby="auth-error">
          </div>
          <div class="field">
            <label for="p">Password</label>
            <input id="p" type="password" autocomplete="current-password" required maxlength="128" aria-describedby="p-help auth-error">
            <div id="p-help" hidden>${rulesHtml('p-rules')}<p class="help">It also can't contain your username or be a common password.</p></div>
          </div>
          <p class="error" id="auth-error" role="alert"></p>
          <button class="btn-primary btn-lg" type="submit">Sign in</button>
          <p class="help remember-note">${icons.lock(13)} You stay signed in on this device for 30 days after your last visit.</p>
        </form>
      </div>
    </section>`;
  stagger(view.querySelector('.auth-intro'));
  miniBoard(view.querySelector('#mini'), SAMPLE_FEN);
  const submit = view.querySelector('button[type=submit]');
  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    view.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    submit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
    view.querySelector('#p').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    view.querySelector('#p-help').hidden = mode === 'login';
    view.querySelector('#auth-error').textContent = '';
    paintRules(view.querySelector('#p-rules'), view.querySelector('#p').value);
  }));
  view.querySelector('#p').addEventListener('input', (e) => paintRules(view.querySelector('#p-rules'), e.target.value));
  view.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = view.querySelector('#u');
    const p = view.querySelector('#p');
    const error = view.querySelector('#auth-error');
    u.removeAttribute('aria-invalid');
    p.removeAttribute('aria-invalid');
    if (!u.value.trim()) { u.setAttribute('aria-invalid', 'true'); error.textContent = 'Enter your username.'; u.focus(); return; }
    if (!p.value) { p.setAttribute('aria-invalid', 'true'); error.textContent = 'Enter your password.'; p.focus(); return; }
    if (mode === 'register' && !PASSWORD_RULES.every(([, ok]) => ok(p.value))) {
      p.setAttribute('aria-invalid', 'true');
      error.textContent = 'Your password is missing something from the list above.';
      p.focus();
      return;
    }
    submit.setAttribute('aria-busy', 'true');
    try {
      me = mode === 'login' ? await api.login(u.value.trim(), p.value) : await api.register(u.value.trim(), p.value);
      if (mode === 'register') toast('Account created. Start with puzzle 1.', 'ok', icons.check(18));
      location.hash = '#/';
      route();
    } catch (err) {
      error.textContent = err.message;
      p.setAttribute('aria-invalid', 'true');
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });
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
/** Themes with enough attempts to judge, weakest first (the server already sorts them that way). */
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

// a tiny tile that shows what a reward looks like
function rewardPreview({ kind, item }) {
  const cls = { bg: `bg-${item}`, pattern: `bg-slate pat-${item}`, frame: `bg-slate frame-${item}`, pieces: `bg-slate set-${item}` }[kind];
  const piece = kind === 'pieces' ? '<span class="avatar-piece is-w"><i class="piece-img pc-wn"></i></span>' : '';
  return `<span class="avatar avatar-xs ${cls}" aria-hidden="true">${piece}</span>`;
}

// where to go to work on an achievement
const FRIEND_GOALS = ['game_on', 'first_win', 'five_wins', 'duelist', 'clean_sheet', 'untouchable'];
function goalAction(key) {
  if (key === 'good_company') return ['#/friends', 'Find a friend', icons.userPlus(18)];
  if (FRIEND_GOALS.includes(key)) return ['#/friends', 'Challenge a friend', icons.swords(18)];
  if (key === 'bounce_back' || key === 'comeback') return ['#/review', 'Open review', icons.repeat(18)];
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
            <span>${icons.user(16)} ${esc(p.username)}</span>
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
  };
  const initial = JSON.stringify(state);
  const avatarOf = () => ({ piece: state.avatar_piece, color: state.avatar_color, bg: state.avatar_bg, pattern: state.avatar_pattern, frame: state.frame, set: state.piece_set });
  const appearanceOf = () => ({ mode: state.theme_mode, light: state.light_palette, dark: state.dark_palette, accent: state.accent });

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
            ${THEMES.modes.map(([k, name]) => optionHtml('theme_mode', k, state.theme_mode === k, `${{ system: icons.board(22), light: icons.sun(22), dark: icons.moon(22) }[k]}${name}`, `${name} mode`)).join('')}
          </div></fieldset>
          <fieldset><legend>Light shade</legend><div class="options" id="light-options">${shadeOptions('light_palette', THEMES.light, 'light')}</div></fieldset>
          <fieldset><legend>Dark shade</legend><div class="options" id="dark-options">${shadeOptions('dark_palette', THEMES.dark, 'dark')}</div></fieldset>
          <fieldset><legend>Accent colour</legend><div class="options" id="accent-options">${accentOptions()}</div></fieldset>
        </section>
        <section class="surface form-section">
          <h2>${icons.user(20)} Identity</h2>
          <div class="field">
            <label for="display_name">Display name</label>
            <input id="display_name" name="display_name" type="text" maxlength="40" value="${esc(state.display_name)}" placeholder="${esc(p.username)}">
            <p class="help">Shown in the header and on your profile. Leave it empty to use your username.</p>
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
            <p class="fieldset-note">Used on your avatar, which friends see, and on every board you play.</p>
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
        <section class="surface form-section" id="password-section">
          <h2>${icons.lock(20)} Password</h2>
          <p class="fieldset-note">Changing it signs you out on every other device. This is saved on its own, not with “Save changes”.</p>
          <div class="field">
            <label for="pw-current">Current password</label>
            <input id="pw-current" type="password" autocomplete="current-password" maxlength="128">
          </div>
          <div class="field">
            <label for="pw-new">New password</label>
            <input id="pw-new" type="password" autocomplete="new-password" maxlength="128" aria-describedby="pw-rules pw-error">
            ${rulesHtml('pw-rules')}
          </div>
          <div class="field">
            <label for="pw-confirm">Repeat the new password</label>
            <input id="pw-confirm" type="password" autocomplete="new-password" maxlength="128" aria-describedby="pw-error">
          </div>
          <p class="error" id="pw-error" role="alert"></p>
          <div><button type="button" class="btn" id="pw-save">${icons.lock(18)} Change password</button></div>
        </section>
        <section class="surface form-section danger-zone" id="delete-section">
          <h2>${icons.x(20)} Delete account</h2>
          <p class="fieldset-note">This permanently erases your account: progress, statistics, review boxes, friends, challenges and sprints. It can't be undone.</p>
          <div><button type="button" class="btn btn-danger" id="delete-open">Delete my account…</button></div>
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
    if (!(name in state)) return;
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
  // password change: separate from the profile form (its inputs have no name, so they never mark it dirty)
  const pw = (id) => view.querySelector(`#pw-${id}`);
  pw('new').addEventListener('input', () => paintRules(pw('rules'), pw('new').value));
  const changePassword = async () => {
    const error = pw('error');
    error.textContent = '';
    if (!pw('current').value) { error.textContent = 'Enter your current password.'; pw('current').focus(); return; }
    if (!PASSWORD_RULES.every(([, ok]) => ok(pw('new').value))) { error.textContent = 'The new password is missing something from the list.'; pw('new').focus(); return; }
    if (pw('new').value !== pw('confirm').value) { error.textContent = 'The two new passwords don’t match.'; pw('confirm').focus(); return; }
    pw('save').setAttribute('aria-busy', 'true');
    try {
      await api.changePassword(pw('current').value, pw('new').value);
      ['current', 'new', 'confirm'].forEach((id) => { pw(id).value = ''; });
      paintRules(pw('rules'), '');
      toast('Password changed. Other devices were signed out.', 'ok', icons.check(18));
    } catch (err) {
      error.textContent = err.message;
    } finally {
      pw('save').removeAttribute('aria-busy');
    }
  };
  pw('save').addEventListener('click', changePassword);
  view.querySelector('#delete-open').addEventListener('click', deleteAccountDialog);
  view.querySelector('#password-section').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); changePassword(); }
  });
  form.addEventListener('click', (e) => {
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

/** Confirm with the password and the username typed out, then erase the account and sign out. */
function deleteAccountDialog() {
  const dlg = document.createElement('dialog');
  dlg.className = 'reward-dialog delete-dialog';
  dlg.setAttribute('aria-labelledby', 'delete-title');
  dlg.innerHTML = `
    <form method="dialog" class="delete-form" novalidate>
      <h2 id="delete-title">Delete your account?</h2>
      <p class="muted">Everything goes: your progress, statistics, friends, challenges and sprints. This can't be undone.</p>
      <div class="field">
        <label for="del-confirm">Type your username, <strong>${esc(me.username)}</strong>, to confirm</label>
        <input id="del-confirm" type="text" autocomplete="off" spellcheck="false" maxlength="40">
      </div>
      <div class="field">
        <label for="del-password">Your password</label>
        <input id="del-password" type="password" autocomplete="current-password" maxlength="128">
      </div>
      <p class="error" id="del-error" role="alert"></p>
      <div class="row actions">
        <button type="button" class="btn-ghost" data-close>Keep my account</button>
        <button type="submit" class="btn btn-danger" id="del-go" disabled>Delete account</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const $ = (sel) => dlg.querySelector(sel);
  const armed = () => $('#del-confirm').value.trim().toLowerCase() === me.username.toLowerCase() && $('#del-password').value;
  dlg.addEventListener('input', () => { $('#del-go').disabled = !armed(); });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!armed()) return;
    $('#del-go').setAttribute('aria-busy', 'true');
    try {
      await api.deleteAccount($('#del-password').value, $('#del-confirm').value);
      dlg.close();
      me = null;
      clearInterval(noticeTimer);
      noticeTimer = null;
      location.hash = '#/';
      renderAuth();
      toast('Your account was deleted.', 'ok', icons.check(18));
    } catch (err) {
      $('#del-error').textContent = err.message;
    } finally {
      $('#del-go')?.removeAttribute('aria-busy');
    }
  });
  dlg.showModal();
  $('#del-confirm').focus();
}

// ---------------------------------------------------------------- router
// what the friends/challenges pages (social.js) need from the shell
const social = {
  paint, load, setNav, refreshHeader, onLeave,
  me: () => me,
  rerender: () => route(),
};

async function route() {
  cleanup();
  navId += 1;
  const nav = navId;
  if (!me) {
    try { me = await api.me(); } catch { me = null; }
  }
  if (!me) return renderAuth();
  document.getElementById('topbar').hidden = false;
  applyAppearance(me.appearance);
  applyBoard(me.board_theme);
  applyPieces(me.avatar?.set);
  paintUserChip();
  refreshHeader();
  if (!noticeTimer) noticeTimer = setInterval(refreshNotices, 15000);

  const { parts, params } = parseHash();
  try {
    if (parts[0] === 'solve') await renderSession(nav, ['review', 'theme'].includes(parts[1]) ? parts[1] : 'new', parts[2]);
    else if (parts[0] === 'review') await renderSession(nav, 'review', params.get('difficulty'));
    else if (parts[0] === 'themes') await renderThemes(nav);
    else if (parts[0] === 'sprint') await renderSprint(nav, social);
    else if (parts[0] === 'puzzle') await renderSingle(nav, Number(parts[1]));
    else if (parts[0] === 'browse') await renderBrowse(nav, params);
    else if (parts[0] === 'stats') await renderStats(nav);
    else if (parts[0] === 'friends' && parts[1]) await renderFriend(nav, social, Number(parts[1]));
    else if (parts[0] === 'friends' || parts[0] === 'challenges') await renderFriends(nav, social);
    else if (parts[0] === 'challenge' && parts[1] === 'new') await renderNewChallenge(nav, social, params);
    else if (parts[0] === 'challenge') await renderChallenge(nav, social, Number(parts[1]));
    else if (parts[0] === 'profile' && parts[1] === 'edit') await renderProfileEdit(nav);
    else if (parts[0] === 'profile') await renderProfile(nav);
    else await renderHome(nav);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      me = null;
      renderAuth();
      return;
    }
    console.error(err);
    view.innerHTML = `<div class="surface empty">${icons.info(40)}<h2>This page could not load</h2><p>${esc(err.message)} Reload the page; if it keeps happening, check that the server is running.</p></div>`;
  }
}

document.getElementById('brand').insertAdjacentHTML('afterbegin', logo(40));
document.querySelectorAll('nav [data-icon]').forEach((a) => a.insertAdjacentHTML('afterbegin', icons[a.dataset.icon](20)));
document.getElementById('logout').innerHTML = icons.logout(20);
appearance = (() => { try { return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem('appearance') || '{}') }; } catch { return { ...DEFAULT_APPEARANCE }; } })();
paintThemeButton();
document.getElementById('logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  me = null;
  clearInterval(noticeTimer);
  noticeTimer = null;
  document.getElementById('live-banner').hidden = true;
  location.hash = '#/';
  route();
});
window.addEventListener('hashchange', route);
route();
