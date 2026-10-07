// Sprint: a solo race against the clock. The server judges every move and keeps the clock and the record.
import { api } from './api.js';
import { RemoteSolver, clockOffset } from './challenge.js';
import { icons } from './icons.js';
import { burst, pingSquare, shake } from './motion.js';
import { count, esc, fmtTime, sanToHtml, toast } from './ui.js';

const LIVES = 3;
const LENGTHS = [3, 5];
const REASON = {
  time: 'Time is up.',
  lives: 'Three mistakes ended the run.',
  done: 'You cleared every puzzle in the run.',
  ended: 'You ended the run early.',
};
const view = () => document.getElementById('view');
let chosen = 3; // remembered while the page is open

function hearts(left, flash) {
  return `<span class="hearts" aria-label="${left} of ${LIVES} lives left">${Array.from({ length: LIVES }, (_, i) =>
    `<i class="${i < left ? 'on' : 'off'} ${flash && i === left ? 'lost' : ''}">${icons.heart(20)}</i>`).join('')}</span>`;
}

export async function renderSprint(nav, ctx) {
  ctx.setNav('sprint');
  const info = await ctx.load(api.sprints());
  const ok = await ctx.paint(nav, introHtml(info));
  if (!ok) return;
  const { signal } = (() => { const ac = new AbortController(); ctx.onLeave(() => ac.abort()); return ac; })();
  let solver = null;
  let timer = null;
  let run = null;
  let offset = 0;
  ctx.onLeave(() => { clearInterval(timer); solver?.destroy(); });

  view().addEventListener('click', async (e) => {
    const length = e.target.closest('[data-minutes]');
    if (length) {
      chosen = Number(length.dataset.minutes);
      view().querySelectorAll('[data-minutes]').forEach((b) => b.setAttribute('aria-pressed', String(b === length)));
      return;
    }
    if (e.target.closest('#sprint-start, #sprint-again')) countdown();
    if (e.target.closest('#sprint-end') && run) {
      e.target.closest('#sprint-end').setAttribute('aria-busy', 'true');
      show(await api.endSprint(run.id).catch(() => run));
    }
  }, { signal });

  // 3-2-1 on the page, then the server starts the clock
  async function countdown() {
    view().innerHTML = `<section class="sprint-count" aria-live="assertive"><span class="countdown" id="count">3</span><p class="muted">Get ready</p></section>`;
    const el = view().querySelector('#count');
    for (const n of ['3', '2', '1']) {
      el.textContent = n;
      el.classList.remove('beat');
      void el.offsetWidth; // restart the animation
      el.classList.add('beat');
      await new Promise((r) => setTimeout(r, 700));
      if (signal.aborted) return;
    }
    try {
      run = await api.startSprint(chosen);
    } catch (err) {
      toast(err.message, 'bad', icons.x(18));
      ctx.rerender();
      return;
    }
    offset = clockOffset(run.server_now);
    mountBoard();
    show(run);
  }

  function mountBoard() {
    view().innerHTML = `<section class="solve">
      <div class="board-col"><div class="board-wrap" id="board-wrap"><div class="board" id="board"></div></div></div>
      <aside class="surface panel enter sprint-panel" id="spanel" aria-label="Sprint"></aside></section>`;
    solver = new RemoteSolver(view().querySelector('#board'), (uci) => api.sprintMove(run.id, uci), {
      onVerdict: (verdict, dest) => {
        const wrap = view().querySelector('#board-wrap');
        if (verdict.result === 'wrong') { shake(wrap); pingSquare(wrap, dest, solver.orientation, 'bad'); }
        else pingSquare(wrap, dest, solver.orientation, 'ok');
        if (verdict.result === 'solved') setTimeout(() => burst(wrap), 60);
        const delay = verdict.result === 'wrong' ? 750 : verdict.result === 'solved' ? 380 : 0;
        const flash = verdict.result === 'wrong';
        if (verdict.result !== 'correct') setTimeout(() => show(verdict.state, flash), delay);
        else { run = verdict.state; paintPanel(run, false); }
      },
      onError: async (err) => { toast(err.message, 'bad', icons.x(18)); show(await api.sprint(run.id)); },
    });
    timer = setInterval(tick, 250);
  }

  function tick() {
    if (!run || run.status !== 'active') return;
    const left = Date.parse(run.ends_at) - (Date.now() + offset);
    const clock = view().querySelector('#sprint-clock');
    if (clock) {
      clock.textContent = fmtTime(Math.max(0, left));
      clock.classList.toggle('low', left < 10_000);
    }
    if (left <= -1200) { // the server closes the run a moment after the buzzer
      run = { ...run, status: 'closing' };
      api.sprint(run.id).then((s) => show(s)).catch(() => {});
    }
  }

  function paintPanel(s, flash) {
    const panel = view().querySelector('#spanel');
    if (!panel) return;
    const left = Math.max(0, Date.parse(s.ends_at) - (Date.now() + offset));
    panel.innerHTML = `
      <section class="duel-head"><span class="eyebrow">${icons.bolt(14)} Sprint · ${s.minutes} minutes</span>
        <div class="duel-clock ${left < 10_000 ? 'low' : ''}" id="sprint-clock">${fmtTime(left)}</div></section>
      <section class="sprint-score">
        <div><span class="duel-score" aria-label="${s.solved} solved">${s.solved}</span><small class="muted">solved</small></div>
        ${hearts(s.lives_left, flash)}
      </section>
      <section class="duel-foot"><span class="muted">Puzzle ${(s.current?.index ?? 0) + 1} · ${s.current ? s.current.difficulty : ''}</span>
        <button class="btn-ghost" id="sprint-end">${icons.flag(16)} End run</button></section>`;
  }

  function show(s, flash = false) {
    run = s;
    if (s.status === 'finished') {
      clearInterval(timer);
      solver?.destroy();
      solver = null;
      view().innerHTML = resultHtml(s);
      if (s.new_best) setTimeout(() => burst(view().querySelector('.sprint-result')), 200);
      return;
    }
    if (!solver) mountBoard();
    paintPanel(s, flash);
    if (s.current && s.current.index !== solver.index) solver.load(s.current);
    else if (s.current) solver.unlock();
  }
}

function introHtml(info) {
  return `
    <section class="sprint-intro">
      <div class="surface sprint-hero enter">
        <span class="icon-circle">${icons.bolt(34)}</span>
        <h1>Sprint</h1>
        <p>Solve as many puzzles as you can before the clock runs out. They start easy and get harder. Every mistake costs a life, and the third one ends the run.</p>
        <div class="segmented" role="group" aria-label="Length">
          ${LENGTHS.map((m) => `<button type="button" data-minutes="${m}" aria-pressed="${m === chosen}">${m} minutes</button>`).join('')}
        </div>
        <button class="btn-primary btn-lg" id="sprint-start">${icons.bolt(18)} Start</button>
      </div>
      <div class="sprint-side">
        <div class="surface sprint-bests">
          <h2>Personal bests</h2>
          ${LENGTHS.map((m) => `<div class="best-row"><span>${m} minutes</span><strong>${info.best[m] ?? '—'}</strong></div>`).join('')}
          <small class="muted">${count(info.runs, 'run')} finished</small>
        </div>
        ${info.recent.length ? `<div class="surface sprint-recent"><h2>Recent runs</h2><ol>
          ${info.recent.map((r) => `<li><span>${r.minutes} min</span><strong>${r.solved}</strong><small class="muted">${esc(REASON[r.reason] ?? '')}</small></li>`).join('')}
        </ol></div>` : ''}
      </div>
    </section>`;
}

function resultHtml(s) {
  const rows = s.results.map((r, i) => {
    const color = r.fen.split(' ')[1];
    const line = r.san.map((m, k) => sanToHtml(m, k % 2 === 0 ? color : (color === 'w' ? 'b' : 'w'))).join(' ');
    return `<li class="${r.solved ? 'ok' : 'bad'}">
      <span class="mark">${r.solved ? icons.check(14) : icons.x(14)}</span>
      <a href="#/puzzle/${r.puzzle_id}">Puzzle ${r.puzzle_id}</a>
      <span class="line">${line}</span>
      <small class="muted">${esc(r.difficulty)}</small>
    </li>`;
  }).join('');
  return `
    <section class="surface sprint-result enter">
      <p class="eyebrow">${icons.bolt(14)} Sprint · ${s.minutes} minutes</p>
      <div class="big">${s.solved}</div>
      <h1>${s.new_best ? 'New personal best!' : count(s.solved, 'puzzle') + ' solved'}</h1>
      <p class="muted">${esc(REASON[s.reason] ?? '')} ${s.new_best ? '' : `Your best for ${s.minutes} minutes is ${s.best ?? 0}.`}</p>
      <div class="row" style="justify-content:center">
        <button class="btn-primary" id="sprint-again">${icons.retry(18)} Run again</button>
        <a class="btn" href="#/">Home</a>
      </div>
      ${rows ? `<h2>The puzzles</h2><ol class="sprint-list">${rows}</ol>` : ''}
    </section>`;
}
