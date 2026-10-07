// Friends, the friendship page and friend challenges (set challenge + live duel).
import { api } from './api.js';
import { RemoteSolver, clockOffset, openSocket } from './challenge.js';
import { icons } from './icons.js';
import { burst, countUp, pingSquare, shake, stagger } from './motion.js';
import { avatarHtml, count, esc, fmtDay, fmtDuration, fmtTime, toast } from './ui.js';

const LEVEL = { mixed: 'Mixed, getting harder', easy: 'Easy', intermediate: 'Intermediate', advanced: 'Advanced' };
const LEVEL_SHORT = { mixed: 'Mixed', easy: 'Easy', intermediate: 'Intermediate', advanced: 'Advanced' };
const LIVES = 3;

const modeLabel = (c) => (c.mode === 'live' ? `Live duel · ${c.minutes} min` : `Set challenge · ${c.total ?? c.count} puzzles`);
const modeIcon = (mode, size = 20) => (mode === 'live' ? icons.bolt(size) : icons.layers(size));
const other = (c, meId) => c.players.find((p) => p.id !== meId);
const mine = (c, meId) => c.players.find((p) => p.id === meId);

function span(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  if (s < 3600) return fmtTime(s * 1000);
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function outcomeChip(c, meId) {
  if (c.status === 'finished') {
    if (c.winner_id == null) return '<span class="chip">Draw</span>';
    return c.winner_id === meId ? '<span class="chip solved">Win</span>' : '<span class="chip failed">Loss</span>';
  }
  const label = { pending: c.opponent_id === meId ? 'Invitation' : 'Waiting', lobby: 'In lobby', active: 'In play',
    expired: 'Expired', declined: 'Declined', cancelled: 'Cancelled' }[c.status];
  return `<span class="chip ${c.status === 'active' || c.status === 'lobby' ? 'rank' : ''}">${label}</span>`;
}

function challengeRow(c, meId) {
  const opp = other(c, meId);
  const a = mine(c, meId);
  const score = c.status === 'finished' ? `<span class="score">${a.solved} – ${opp.solved}</span>` : '';
  return `<a class="c-row lift" href="#/challenge/${c.id}">
    <span class="c-icon">${modeIcon(c.mode)}</span>
    ${avatarHtml(opp.avatar, 'sm')}
    <span class="c-main"><strong>${esc(opp.display_name)}</strong><small>${modeLabel(c)} · ${LEVEL_SHORT[c.level]}</small></span>
    ${score}${outcomeChip(c, meId)}
  </a>`;
}

const recordLine = (r) => `<span class="rec"><b>${r.wins}</b>W <b>${r.losses}</b>L <b>${r.draws}</b>D</span>`;

// ---------------------------------------------------------------- friends hub
export async function renderFriends(nav, ctx) {
  ctx.setNav('friends');
  const [f, ch] = await ctx.load(Promise.all([api.friends(), api.challenges()]));
  const meId = ctx.me().id;
  const invitations = [
    ...ch.incoming.map((c) => {
      const opp = other(c, meId);
      return `<li class="invite">${avatarHtml(opp.avatar, 'sm')}
        <span class="c-main"><strong>${esc(opp.display_name)}</strong><small>${modeIcon(c.mode, 14)} ${modeLabel(c)} · ${LEVEL_SHORT[c.level]}</small></span>
        <button class="btn-primary" data-action="accept-ch" data-id="${c.id}">Accept</button>
        <button class="btn-ghost" data-action="decline-ch" data-id="${c.id}">Decline</button></li>`;
    }),
    ...f.incoming.map((u) => `<li class="invite">${avatarHtml(u.avatar, 'sm')}
      <span class="c-main"><strong>${esc(u.display_name)}</strong><small>${icons.userPlus(14)} Wants to be your friend</small></span>
      <button class="btn-primary" data-action="accept-friend" data-id="${u.request_id}">Accept</button>
      <button class="btn-ghost" data-action="decline-friend" data-id="${u.request_id}">Decline</button></li>`),
  ];
  const inPlay = [...ch.active, ...ch.sent];

  await ctx.paint(nav, `
    <div class="page-head"><div><h1>Friends</h1><p>Add friends, answer invitations and challenge each other on the same puzzles.</p></div>
      <a class="btn btn-primary" href="#/challenge/new">${icons.swords(18)} New challenge</a></div>
    <div class="social-top">
      <section class="surface card">
        <header><div><h2>Add a friend</h2><p>Search by username.</p></div></header>
        <div class="search-box">${icons.userPlus(18)}<input id="friend-search" type="text" placeholder="Username" autocomplete="off" aria-label="Search players by username"></div>
        <ul class="search-results" id="search-results" aria-live="polite"></ul>
        ${f.outgoing.length ? `<div class="pending-out"><span class="eyebrow">Requests you sent</span>
          ${f.outgoing.map((u) => `<div class="mini-row">${avatarHtml(u.avatar, 'sm')}<span>${esc(u.display_name)}</span>
            <button class="btn-ghost" data-action="cancel-friend" data-id="${u.request_id}">Cancel</button></div>`).join('')}</div>` : ''}
      </section>
      <section class="surface card">
        <header><div><h2>Invitations</h2><p>Friend requests and challenges waiting for your answer.</p></div></header>
        ${invitations.length ? `<ul class="invites">${invitations.join('')}</ul>` : '<p class="muted">Nothing waiting for you right now.</p>'}
      </section>
    </div>
    ${inPlay.length ? `<section class="section"><div class="section-head"><h2>Challenges in play</h2></div>
      <div class="c-list">${inPlay.map((c) => challengeRow(c, meId)).join('')}</div></section>` : ''}
    <section class="section">
      <div class="section-head"><h2>Your friends</h2><span class="muted">${count(f.friends.length, 'friend')}</span></div>
      ${f.friends.length ? `<div class="friend-grid">${f.friends.map((u) => `
        <article class="surface friend-card lift">
          ${avatarHtml(u.avatar, 'md')}
          <div class="who"><strong>${esc(u.display_name)}</strong><small>${esc(u.rank)} · ${count(u.solved, 'puzzle')} solved</small>${recordLine(u.record)}</div>
          <div class="row">
            <a class="btn btn-primary" href="#/challenge/new?friend=${u.id}">${icons.swords(16)} Challenge</a>
            <a class="btn" href="#/friends/${u.id}">View</a>
          </div>
        </article>`).join('')}</div>`
    : `<div class="surface empty">${icons.users(40)}<h2>No friends yet</h2><p>Search for a player above and send a request. Once they accept, you can challenge them.</p></div>`}
    </section>
    ${ch.finished.length ? `<section class="section"><div class="section-head"><h2>Recent results</h2></div>
      <div class="c-list">${ch.finished.slice(0, 8).map((c) => challengeRow(c, meId)).join('')}</div></section>` : ''}`, () => {
    stagger(view().querySelector('.friend-grid'));
    stagger(view().querySelector('.c-list'));
  });

  const root = view();
  const ac = new AbortController();
  ctx.onLeave(() => ac.abort());
  const results = root.querySelector('#search-results');
  let timer;
  root.querySelector('#friend-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const found = await api.searchUsers(q).catch(() => []);
      results.innerHTML = found.length ? found.map((u) => {
        const action = {
          none: `<button class="btn" data-action="add-friend" data-name="${esc(u.username)}">${icons.userPlus(16)} Add</button>`,
          sent: '<span class="chip">Request sent</span>',
          received: `<button class="btn-primary" data-action="accept-friend" data-id="${u.request_id}">Accept</button>`,
          friend: '<span class="chip solved">Friends</span>',
        }[u.relation];
        return `<li class="mini-row">${avatarHtml(u.avatar, 'sm')}<span><strong>${esc(u.display_name)}</strong> <small class="muted">${esc(u.username)}</small></span>${action}</li>`;
      }).join('') : '<li class="muted">No player found with that username.</li>';
    }, 250);
  });
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, name } = btn.dataset;
    btn.setAttribute('aria-busy', 'true');
    try {
      if (action === 'add-friend') {
        const r = await api.addFriend(name);
        toast(r.status === 'accepted' ? `You and ${name} are now friends.` : `Friend request sent to ${name}.`, 'ok', icons.check(18));
      }
      if (action === 'accept-friend') { await api.acceptFriend(id); toast('Friend request accepted.', 'ok', icons.check(18)); }
      if (action === 'decline-friend') await api.declineFriend(id);
      if (action === 'cancel-friend') await api.cancelFriendRequest(id);
      if (action === 'accept-ch') { await api.challengeAction(id, 'accept'); location.hash = `#/challenge/${id}`; return; }
      if (action === 'decline-ch') await api.challengeAction(id, 'decline');
      ctx.refreshHeader();
      ctx.rerender();
    } catch (err) {
      toast(err.message, 'bad', icons.x(18));
      btn.removeAttribute('aria-busy');
    }
  }, { signal: ac.signal });
}

const view = () => document.getElementById('view');

// ---------------------------------------------------------------- friendship page
export async function renderFriend(nav, ctx, friendId) {
  ctx.setNav('friends');
  const p = await ctx.load(api.friendPage(friendId));
  const r = p.record;
  const cmp = [
    ['Puzzles solved', p.me.solved, p.friend.solved, (v) => v.toLocaleString('en')],
    ['Accuracy', p.me.accuracy ?? 0, p.friend.accuracy ?? 0, (v) => `${v}%`],
    ['Best streak', p.me.best_streak, p.friend.best_streak, (v) => count(v, 'day')],
    ['Current streak', p.me.streak_days, p.friend.streak_days, (v) => count(v, 'day')],
  ];
  const split = (label, x) => `<div class="split"><span class="eyebrow">${label}</span>
    <div class="split-nums"><span><b>${x.wins}</b> wins</span><span><b>${x.draws}</b> draws</span><span><b>${x.losses}</b> losses</span></div></div>`;

  await ctx.paint(nav, `
    <section class="surface vs-hero raised">
      <div class="vs-side">${avatarHtml(p.me.avatar, 'lg')}<strong>${esc(p.me.display_name)}</strong><small>${esc(p.me.rank)}</small></div>
      <div class="vs-center">
        <span class="vs-badge">VS</span>
        <div class="scoreboard" role="img" aria-label="${r.all.wins} wins, ${r.all.draws} draws, ${r.all.losses} losses">
          <div><b data-count="${r.all.wins}">0</b><span>Wins</span></div>
          <div><b data-count="${r.all.draws}">0</b><span>Draws</span></div>
          <div><b data-count="${r.all.losses}">0</b><span>Losses</span></div>
        </div>
        <small class="muted">${p.since ? `Friends since ${fmtDay(p.since.slice(0, 10))}` : ''}</small>
      </div>
      <div class="vs-side">${avatarHtml(p.friend.avatar, 'lg')}<strong>${esc(p.friend.display_name)}</strong><small>${esc(p.friend.rank)}</small></div>
    </section>
    <div class="row" style="justify-content:center;margin:var(--s-5) 0">
      <a class="btn btn-primary btn-lg" href="#/challenge/new?friend=${p.friend.id}">${icons.swords(18)} Challenge ${esc(p.friend.display_name)}</a>
    </div>
    <div class="stats-grid stagger">
      <section class="surface card span-5">
        <header><div><h2>Head to head</h2><p>Results by format.</p></div></header>
        ${split('Set challenges', r.async)}${split('Live duels', r.live)}
      </section>
      <section class="surface card span-7">
        <header><div><h2>Side by side</h2><p>Your training compared.</p></div></header>
        <div class="compare">${cmp.map(([label, a, b, f]) => {
          const max = Math.max(1, a, b);
          return `<div class="cmp-row"><span class="cmp-val">${f(a)}</span>
            <div class="cmp-bars"><i class="me" style="width:${(100 * a) / max}%"></i></div>
            <span class="cmp-label">${label}</span>
            <div class="cmp-bars them"><i style="width:${(100 * b) / max}%"></i></div>
            <span class="cmp-val">${f(b)}</span></div>`;
        }).join('')}</div>
      </section>
      <section class="surface card span-12">
        <header><div><h2>History</h2><p>Every challenge between you two.</p></div></header>
        ${p.history.length ? `<div class="c-list">${p.history.map((h) => `
          <a class="c-row lift" href="#/challenge/${h.id}">
            <span class="c-icon">${modeIcon(h.mode)}</span>
            <span class="c-main"><strong>${h.mode === 'live' ? `Live duel · ${h.minutes} min` : `Set challenge · ${h.count} puzzles`}</strong>
              <small>${fmtDay(h.date.slice(0, 10))} · ${LEVEL_SHORT[h.level]}</small></span>
            ${h.status === 'finished' ? `<span class="score">${h.score[0]} – ${h.score[1]}</span>` : ''}
            ${h.outcome ? `<span class="chip ${h.outcome === 'win' ? 'solved' : h.outcome === 'loss' ? 'failed' : ''}">${{ win: 'Win', loss: 'Loss', draw: 'Draw' }[h.outcome]}</span>`
              : `<span class="chip">${{ pending: 'Waiting', lobby: 'In lobby', active: 'In play', expired: 'Expired' }[h.status] ?? h.status}</span>`}
          </a>`).join('')}</div>` : '<p class="muted">No challenges yet. Send the first one.</p>'}
      </section>
    </div>
    <div class="row" style="justify-content:center;margin-top:var(--s-6)">
      <button class="btn-ghost" id="remove-friend">Remove from friends</button>
    </div>`, () => stagger(view().querySelector('.stats-grid')));
  countUp(view());

  const removeBtn = view().querySelector('#remove-friend');
  removeBtn.addEventListener('click', async () => {
    if (removeBtn.dataset.confirm !== '1') {
      removeBtn.dataset.confirm = '1';
      removeBtn.textContent = `Click again to remove ${p.friend.display_name}`;
      removeBtn.classList.add('danger');
      return;
    }
    await api.removeFriend(p.friend.id);
    toast(`${p.friend.display_name} was removed from your friends.`, 'ok', icons.check(18));
    location.hash = '#/friends';
  });
}

// ---------------------------------------------------------------- new challenge
export async function renderNewChallenge(nav, ctx, params) {
  ctx.setNav('friends');
  const { friends } = await ctx.load(api.friends());
  const opt = (name, value, checked, face, label) => `<label class="opt">
    <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span class="face">${face}</span></label>`;
  const pre = Number(params.get('friend')) || friends[0]?.id;
  if (!friends.length) {
    await ctx.paint(nav, `<section class="surface message">${icons.users(40)}<h2>Add a friend first</h2>
      <p>Challenges are between friends. Find a player on the Friends page and send a request.</p>
      <a class="btn btn-primary" href="#/friends">Go to Friends</a></section>`);
    return;
  }
  await ctx.paint(nav, `
    <div class="page-head"><div><h1>New challenge</h1><p>Both of you get the same puzzles in the same order.</p></div></div>
    <form class="surface card new-challenge" id="new-challenge" novalidate>
      <fieldset><legend>Opponent</legend><div class="options">
        ${friends.map((u) => opt('opponent_id', u.id, u.id === pre, `${avatarHtml(u.avatar, 'sm')}${esc(u.display_name)}`, u.display_name)).join('')}
      </div></fieldset>
      <fieldset><legend>Format</legend><div class="format-cards">
        <label class="format"><input type="radio" name="mode" value="async" checked>
          <span class="format-face">${icons.layers(28)}<strong>Set challenge</strong><small>A fixed set of puzzles. Each of you plays any time before the deadline. Most solved wins, faster time breaks a tie.</small></span></label>
        <label class="format"><input type="radio" name="mode" value="live">
          <span class="format-face">${icons.bolt(28)}<strong>Live duel</strong><small>Play at the same time against the clock. A wrong move costs a life and skips the puzzle. Lose three lives and you lose.</small></span></label>
      </div></fieldset>
      <div class="format-options" data-for="async">
        <fieldset><legend>Puzzles</legend><div class="segmented">${[5, 10, 20].map((n) => opt('count', n, n === 10, n, `${n} puzzles`)).join('')}</div></fieldset>
        <fieldset><legend>Deadline</legend><div class="segmented">${[[24, '24 hours'], [72, '3 days'], [168, '7 days']].map(([h, t]) => opt('deadline_hours', h, h === 72, t, t)).join('')}</div></fieldset>
      </div>
      <div class="format-options" data-for="live" hidden>
        <fieldset><legend>Clock</legend><div class="segmented">${[3, 5, 10].map((m) => opt('minutes', m, m === 5, `${m} min`, `${m} minutes`)).join('')}</div></fieldset>
      </div>
      <fieldset><legend>Level</legend><div class="segmented">${Object.entries(LEVEL_SHORT).map(([k, t]) => opt('level', k, k === 'mixed', t, LEVEL[k])).join('')}</div></fieldset>
      <div class="row" style="justify-content:flex-end"><a class="btn btn-ghost" href="#/friends">Cancel</a>
        <button class="btn-primary btn-lg" type="submit">${icons.send(18)} Send challenge</button></div>
    </form>`);
  const form = view().querySelector('#new-challenge');
  const sync = () => {
    const mode = form.mode.value;
    form.querySelectorAll('.format-options').forEach((el) => { el.hidden = el.dataset.for !== mode; });
  };
  form.addEventListener('change', sync);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.setAttribute('aria-busy', 'true');
    const data = new FormData(form);
    const body = { opponent_id: Number(data.get('opponent_id')), mode: data.get('mode'), level: data.get('level') };
    if (body.mode === 'async') Object.assign(body, { count: Number(data.get('count')), deadline_hours: Number(data.get('deadline_hours')) });
    else body.minutes = Number(data.get('minutes'));
    try {
      const c = await api.createChallenge(body);
      toast('Challenge sent.', 'ok', icons.send(18));
      location.hash = `#/challenge/${c.id}`;
    } catch (err) {
      toast(err.message, 'bad', icons.x(18));
      btn.removeAttribute('aria-busy');
    }
  });
}

// ---------------------------------------------------------------- challenge screen
const REASON = {
  mistakes: (w, l) => `${l} ran out of lives`,
  time: (w, l, c) => `Time's up · ${c.players.map((p) => p.solved).join(' vs ')} solved`,
  score: (w, l, c) => `${c.players.map((p) => p.solved).join(' vs ')} solved`,
  deadline: (w, l) => `${l} didn't play before the deadline`,
  forfeit: (w, l) => `${l} resigned or left the duel`,
  draw: (w, l, c) => `Level at ${c.players[0].solved} solved`,
};

function hearts(p, flash) {
  return `<span class="hearts" aria-label="${p.lives_left} of ${LIVES} lives left">${Array.from({ length: LIVES }, (_, i) =>
    `<i class="${i < p.lives_left ? 'on' : 'off'} ${flash && i === p.lives_left ? 'lost' : ''}">${icons.heart(18)}</i>`).join('')}</span>`;
}

export async function renderChallenge(nav, ctx, cid) {
  ctx.setNav('friends');
  let st = await ctx.load(api.challenge(cid));
  const meId = ctx.me().id;
  let offset = clockOffset(st.server_now);
  let solver = null;
  let built = null; // which board layout is mounted
  let prevMistakes = Object.fromEntries(st.players.map((p) => [p.id, p.mistakes]));
  let celebrated = false;
  let refreshing = false;
  const now = () => Date.now() + offset;

  const phase = () => {
    if (st.status === 'finished') return 'result';
    if (['declined', 'cancelled', 'expired'].includes(st.status)) return 'closed';
    if (st.status === 'pending') return 'pending';
    if (st.status === 'lobby') return 'lobby';
    const me = mine(st, meId);
    if (st.mode === 'live') return 'duel';
    return { waiting: 'intro', playing: 'play', done: 'waiting' }[me.status] ?? 'waiting';
  };

  function teardownBoard() {
    solver?.destroy();
    solver = null;
    built = null;
  }

  function mountBoard(kind) {
    if (built === kind) return;
    teardownBoard();
    view().innerHTML = `<section class="solve">
      <div class="board-col"><div class="board-wrap" id="board-wrap"><div class="board" id="board"></div>
        <div class="countdown" id="countdown" hidden></div></div></div>
      <aside class="surface panel enter" id="cpanel"></aside></section>`;
    solver = new RemoteSolver(view().querySelector('#board'), cid, {
      onVerdict: (verdict, dest) => {
        const wrap = view().querySelector('#board-wrap');
        if (verdict.result === 'wrong') { shake(wrap); pingSquare(wrap, dest, solver.orientation, 'bad'); }
        else pingSquare(wrap, dest, solver.orientation, 'ok');
        const next = verdict.state;
        const delay = verdict.result === 'correct' ? 420 : verdict.result === 'wrong' ? 900 : 450;
        setTimeout(() => apply(next), delay);
      },
      onError: (err) => { toast(err.message, 'bad', icons.x(18)); refresh(); },
    });
    built = kind;
  }

  function panelDuel() {
    const me = mine(st, meId);
    const opp = other(st, meId);
    const left = Math.max(0, Date.parse(st.ends_at) - now());
    return `
      <section class="duel-head"><span class="eyebrow">${icons.bolt(14)} Live duel · ${LEVEL_SHORT[st.level]}</span>
        <div class="duel-clock ${left < 10000 ? 'low' : ''}" id="duel-clock">${fmtTime(left)}</div></section>
      <section class="duel-players">
        ${[me, opp].map((p) => `<div class="duel-player ${p.id === meId ? 'me' : ''} ${p.status === 'out' ? 'out' : ''}">
          ${avatarHtml(p.avatar, 'sm')}
          <div class="who"><strong>${p.id === meId ? 'You' : esc(p.display_name)}</strong>${hearts(p, prevMistakes[p.id] !== undefined && p.mistakes > prevMistakes[p.id])}</div>
          <span class="duel-score" aria-label="${p.solved} solved">${p.solved}</span>
        </div>`).join('')}
      </section>
      <section class="duel-foot"><span class="muted">Puzzle ${me.index + 1}</span>
        <button class="btn-ghost" id="resign">${icons.flag(16)} Resign</button></section>`;
  }

  function panelAsync() {
    const me = mine(st, meId);
    const opp = other(st, meId);
    const total = st.total;
    const dots = Array.from({ length: total }, (_, i) => `<i class="${i < me.index ? 'done' : i === me.index ? 'current' : ''}"></i>`).join('');
    return `
      <section class="panel-head"><span class="eyebrow">${icons.layers(14)} Set challenge · ${LEVEL_SHORT[st.level]}</span>
        <span class="id">Puzzle ${Math.min(me.index + 1, total)} of ${total}</span>
        <div class="steps">${dots}</div></section>
      <section class="duel-players">
        ${[me, opp].map((p) => `<div class="duel-player ${p.id === meId ? 'me' : ''}">${avatarHtml(p.avatar, 'sm')}
          <div class="who"><strong>${p.id === meId ? 'You' : esc(p.display_name)}</strong>
            <small>${p.status === 'waiting' ? 'Not started' : `${p.index} of ${total} played · ${fmtDuration(p.time_ms)}`}</small></div>
          <span class="duel-score">${p.solved}</span></div>`).join('')}
      </section>
      <section class="duel-foot"><span class="muted">${icons.hourglass(14)} Deadline in <span id="deadline">${span(Date.parse(st.deadline_at) - now())}</span></span>
        <button class="btn-ghost" id="resign">${icons.flag(16)} Give up</button></section>`;
  }

  function drawStatic() {
    teardownBoard();
    const ph = phase();
    const opp = other(st, meId);
    const me = mine(st, meId);
    const invitedMe = st.opponent_id === meId;
    let html = '';
    if (ph === 'pending') {
      html = `<section class="surface message">
        ${avatarHtml(opp.avatar, 'lg')}
        <h2>${invitedMe ? `${esc(opp.display_name)} challenges you` : `Waiting for ${esc(opp.display_name)} to accept`}</h2>
        <p>${modeIcon(st.mode, 16)} ${modeLabel(st)} · ${LEVEL[st.level]}</p>
        <p class="muted">${st.mode === 'live' ? 'Play at the same time. A wrong move costs a life; three and you are out.' : 'Play whenever you like before the deadline. Most solved wins.'}</p>
        <p class="muted">${icons.hourglass(14)} Invitation expires in <span id="expiry">${span(Date.parse(st.invite_expires_at) - now())}</span></p>
        <div class="row" style="justify-content:center">
          ${invitedMe ? '<button class="btn-primary btn-lg" data-do="accept">Accept</button><button class="btn" data-do="decline">Decline</button>'
            : '<button class="btn" data-do="cancel">Cancel challenge</button>'}
        </div></section>`;
    } else if (ph === 'lobby') {
      html = `<section class="surface lobby raised">
        <span class="eyebrow">${icons.bolt(14)} Live duel · ${st.minutes} min · ${LEVEL_SHORT[st.level]}</span>
        <div class="lobby-vs">
          ${[me, opp].map((p) => `<div class="lobby-player">${avatarHtml(p.avatar, 'lg')}<strong>${p.id === meId ? 'You' : esc(p.display_name)}</strong>
            <span class="chip ${p.ready ? 'solved' : ''}">${p.ready ? `${icons.check(12)} Ready` : 'Not ready'}</span></div>`).join('<span class="vs-badge">VS</span>')}
        </div>
        <p class="muted">The duel starts with a 3-second countdown when you are both ready.</p>
        <div class="row" style="justify-content:center">
          ${me.ready ? '<button class="btn-primary btn-lg" disabled>Waiting for your friend…</button>' : '<button class="btn-primary btn-lg" data-do="ready">I\'m ready</button>'}
          <button class="btn-ghost" data-do="cancel">Cancel</button></div>
        <small class="muted">${icons.hourglass(14)} Lobby closes in <span id="expiry">${span(Date.parse(st.invite_expires_at) - now())}</span></small>
      </section>`;
    } else if (ph === 'intro') {
      html = `<section class="surface message">
        <span class="icon-circle" style="background:var(--accent-soft);color:var(--accent)">${icons.layers(28)}</span>
        <h2>${st.total} puzzles against ${esc(opp.display_name)}</h2>
        <p>${LEVEL[st.level]}. One try per puzzle: a wrong move marks it missed and moves on. Most solved wins; a faster total time breaks a tie.</p>
        <p class="muted">${esc(opp.display_name)}: ${opp.status === 'waiting' ? 'not started yet' : `${opp.index} of ${st.total} played`} · deadline in <span id="deadline">${span(Date.parse(st.deadline_at) - now())}</span></p>
        <button class="btn-primary btn-lg" data-do="start">Start now</button></section>`;
    } else if (ph === 'waiting') {
      html = `<section class="surface message">
        <span class="icon-circle">${icons.check(28)}</span>
        <h2>You're done: ${me.solved} of ${st.total} solved</h2>
        <p>Total time ${fmtDuration(me.time_ms)}. ${esc(opp.display_name)} ${opp.status === 'waiting' ? "hasn't started yet" : `has played ${opp.index} of ${st.total}`}.</p>
        <p class="muted">We'll show the result here when they finish or the deadline passes (<span id="deadline">${span(Date.parse(st.deadline_at) - now())}</span>).</p>
        <a class="btn" href="#/friends">Back to Friends</a></section>`;
    } else if (ph === 'closed') {
      html = `<section class="surface message"><span class="icon-circle" style="background:var(--surface-2);color:var(--muted)">${icons.x(28)}</span>
        <h2>This challenge was ${st.status}</h2><p>No result was recorded.</p>
        <div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/challenge/new?friend=${opp.id}">Send a new one</a><a class="btn" href="#/friends">Friends</a></div></section>`;
    } else if (ph === 'result') {
      html = resultHtml();
    }
    view().innerHTML = html;
    if (ph === 'result' && !celebrated) {
      celebrated = true;
      if (st.winner_id === meId) setTimeout(() => burst(view().querySelector('.result-banner')), 200);
    }
  }

  function resultHtml() {
    const me = mine(st, meId);
    const opp = other(st, meId);
    const won = st.winner_id === meId;
    const draw = st.winner_id == null;
    const winnerName = draw ? '' : st.winner_id === meId ? 'You' : opp.display_name;
    const loserName = draw ? '' : st.winner_id === meId ? opp.display_name : 'You';
    const reason = REASON[st.result_reason]?.(winnerName, loserName, st) ?? '';
    const rows = {};
    (st.results ?? []).forEach((r) => { (rows[r.index] ??= { puzzle_id: r.puzzle_id })[r.user_id] = r; });
    const cell = (r) => (r ? `<span class="res ${r.solved ? 'ok' : 'bad'}">${r.solved ? icons.check(14) : icons.x(14)} ${fmtDuration(r.time_ms)}</span>` : '<span class="muted">—</span>');
    return `
      <section class="surface result-banner ${won ? 'won' : draw ? 'draw' : 'lost'} raised">
        <span class="eyebrow">${modeIcon(st.mode, 14)} ${modeLabel(st)}</span>
        <h1>${won ? 'You won!' : draw ? 'Draw' : `${esc(opp.display_name)} won`}</h1>
        <p>${esc(reason)}</p>
        <div class="result-players">
          ${[me, opp].map((p) => `<div class="${p.id === st.winner_id ? 'winner' : ''}">${avatarHtml(p.avatar, 'md')}<strong>${p.id === meId ? 'You' : esc(p.display_name)}</strong>
            <span class="big">${p.solved}</span><small>solved · ${count(p.mistakes, 'mistake')} · ${fmtDuration(p.time_ms)}</small></div>`).join('<span class="vs-badge">VS</span>')}
        </div>
        <div class="row" style="justify-content:center">
          <button class="btn-primary" data-do="rematch">${icons.retry(16)} Rematch</button>
          <a class="btn" href="#/friends/${opp.id}">${icons.users(16)} Your record with ${esc(opp.display_name)}</a>
        </div>
      </section>
      ${Object.keys(rows).length ? `<section class="surface card" style="margin-top:var(--s-4)">
        <header><div><h2>Puzzle by puzzle</h2><p>Open any puzzle to see its solution.</p></div></header>
        <div class="table-wrap"><table class="data cmp-table">
          <thead><tr><th>#</th><th>Puzzle</th><th>You</th><th>${esc(opp.display_name)}</th></tr></thead>
          <tbody>${Object.entries(rows).map(([i, r]) => `<tr><td>${Number(i) + 1}</td><td><a href="#/puzzle/${r.puzzle_id}">Puzzle ${r.puzzle_id}</a></td>
            <td>${cell(r[meId])}</td><td>${cell(r[opp.id])}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  }

  function draw() {
    const ph = phase();
    if (ph === 'duel' || ph === 'play') {
      mountBoard(ph);
      const panel = view().querySelector('#cpanel');
      panel.innerHTML = ph === 'duel' ? panelDuel() : panelAsync();
      if (st.current && (solver.index !== st.current.index || solver.current?.fen !== st.current.fen) && !solver.busy) {
        solver.load(st.current);
        if (ph === 'duel' && Date.parse(st.started_at) > now()) solver.lock();
      }
    } else {
      drawStatic();
    }
    prevMistakes = Object.fromEntries(st.players.map((p) => [p.id, p.mistakes]));
  }

  function apply(next) {
    if (next.status !== st.status) ctx.refreshHeader(); // badges and the duel banner follow the new status
    st = next;
    offset = clockOffset(st.server_now);
    draw();
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try { apply(await api.challenge(cid)); } finally { refreshing = false; }
  }

  // clocks and the 3-2-1 countdown
  const tick = setInterval(() => {
    const t = now();
    const clock = view().querySelector('#duel-clock');
    if (clock && st.ends_at) {
      const left = Math.max(0, Date.parse(st.ends_at) - t);
      clock.textContent = fmtTime(left);
      clock.classList.toggle('low', left < 10000);
      if (left === 0 && st.status === 'active') refresh();
    }
    const cd = view().querySelector('#countdown');
    if (cd && st.status === 'active' && st.started_at) {
      const until = Date.parse(st.started_at) - t;
      if (until > 0) {
        const n = String(Math.ceil(until / 1000));
        cd.hidden = false;
        if (cd.textContent !== n) { cd.textContent = n; cd.classList.remove('beat'); void cd.offsetWidth; cd.classList.add('beat'); }
      } else if (!cd.hidden) {
        cd.hidden = true;
        solver?.unlock();
      }
    }
    for (const id of ['expiry', 'deadline']) {
      const el = view().querySelector(`#${id}`);
      const iso = id === 'expiry' ? st.invite_expires_at : st.deadline_at;
      if (el && iso) el.textContent = span(Date.parse(iso) - t);
    }
  }, 200);

  if (!(await ctx.paint(nav, '<div></div>'))) { clearInterval(tick); return; }
  draw();
  const socket = openSocket(cid, apply);
  const ac = new AbortController();
  ctx.onLeave(() => { clearInterval(tick); socket.close(); teardownBoard(); ac.abort(); });

  view().addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-do], #resign');
    if (!btn) return;
    const action = btn.id === 'resign' ? 'resign' : btn.dataset.do;
    if (action === 'resign' && btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Click again to confirm';
      btn.classList.add('danger');
      return;
    }
    btn.setAttribute('aria-busy', 'true');
    try {
      if (action === 'rematch') {
        const opp = other(st, meId);
        const body = { opponent_id: opp.id, mode: st.mode, level: st.level };
        if (st.mode === 'async') Object.assign(body, { count: [5, 10, 20].includes(st.total) ? st.total : 10, deadline_hours: 72 });
        else body.minutes = st.minutes;
        const c = await api.createChallenge(body);
        toast('Rematch sent.', 'ok', icons.send(18));
        location.hash = `#/challenge/${c.id}`;
        return;
      }
      apply(await api.challengeAction(cid, action));
      ctx.refreshHeader();
    } catch (err) {
      toast(err.message, 'bad', icons.x(18));
      btn.removeAttribute('aria-busy');
    }
  }, { signal: ac.signal });
}

