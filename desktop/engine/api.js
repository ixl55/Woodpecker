// The app's "server": the same paths and answers the website's API gives, computed in-process from the
// local store. The interface calls these through Electron IPC instead of HTTP (see preload.cjs).
import { checkMove, fenAt } from './catalog.js';
import { LOCKED, computeProgress, dayKey, shiftDay } from './progress.js';
import { DEFAULT_PROFILE } from './store.js';
import { GRADIENTS, isHex, normalise } from '../renderer/js/custom-theme.js';
import { DRILL_IDS } from '../renderer/js/drills.js';
import { LESSONS } from '../renderer/js/lessons.js';
import { OPENING_LINES } from '../renderer/js/openings.js';
import THEMES from './themes.json' with { type: 'json' };

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

const LEVELS = ['easy', 'intermediate', 'advanced'];
const DAY_MS = 24 * 3600 * 1000;
// Leitner boxes: a failed puzzle starts in box 1 (due now); each success moves it up; success from the last box retires it
const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14, 6: 30 };
const LAST_BOX = 6;
const MIN_THEME_ATTEMPTS = 3; // below this a theme's accuracy is too noisy to call it a weakness
const HEATMAP_DAYS = 182;
const WEEKS = 12;
const TIME_BUCKETS = [['<10s', 10_000], ['10–30s', 30_000], ['30–60s', 60_000], ['1–2m', 120_000], ['2–5m', 300_000], ['>5m', null]];
// Sprint: rising puzzles from book 1 (book 2's positional key moves need calm thinking, not a clock)
const LIVES = 3;
const SPRINT_PLAN = [['easy', 15], ['intermediate', 35], ['advanced', 30]];
const LATE_MOVE_GRACE_MS = 1000; // a move sent just before the buzzer may land a moment after it
const KEPT_SPRINTS = 10;

const PROFILE_CHOICES = {
  avatar_piece: ['k', 'q', 'r', 'b', 'n', 'p'],
  avatar_color: ['w', 'b'],
  avatar_bg: ['ink', 'emerald', 'olive', 'walnut', 'wine', 'plum', 'slate', 'sand', 'teal', 'crimson', 'charcoal',
    'sky', 'meadow', 'ocean', 'sunset', 'aurora', 'nebula', 'volcano', 'chalkboard', 'gilt', 'dusk'],
  avatar_pattern: ['plain', 'checker', 'diagonal', 'rings', 'dots', 'grid', 'zigzag', 'sunburst', 'scales', 'argyle',
    'stars', 'knights', 'rooks', 'lattice'],
  frame: ['none', 'ring', 'double', 'dashed', 'bronze', 'silver', 'gold', 'laurel', 'ember', 'frost', 'aurora', 'royal', 'prism', 'checkered', 'scholar', 'duo'],
  piece_set: ['classic', 'bauhaus', 'ice', 'jade', 'neon', 'ruby', 'gilded', 'marble'],
  board_theme: ['slate', 'walnut', 'olive', 'marble', 'sand'],
  theme_mode: ['system', 'light', 'dark', 'custom'],
  light_palette: ['porcelain', 'parchment', 'mist', 'sage', 'blush', 'lavender', 'glacier', 'butter'],
  dark_palette: ['midnight', 'obsidian', 'graphite', 'espresso', 'forest', 'plum', 'abyss', 'wine'],
  accent: ['cobalt', 'emerald', 'amber', 'violet', 'teal', 'rose'],
};

const LESSON_IDS = new Set(LESSONS.map((l) => l.id));
const LINE_IDS = new Set(OPENING_LINES.map((l) => l.id));
const DAY = 86_400_000;
// days until an opening line comes back, by clean runs in a row (a mistake brings it back at once)
const LINE_REVIEW_DAYS = [0, 1, 3, 7, 14, 30];

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const accuracy = (rows) => (rows.length ? Math.round((100 * rows.filter((a) => a[1]).length) / rows.length) : null);
const intParam = (v, fallback) => (v === null || v === '' || !Number.isFinite(Number(v)) ? fallback : Math.trunc(Number(v)));

export function createApi(store, catalog, { now = () => Date.now() } = {}) {
  const data = () => store.data;
  const puzzle = (id) => {
    const p = catalog.byId.get(id);
    if (!p) throw new ApiError(404, 'Puzzle not found.');
    return p;
  };

  /** puzzle_id -> whether the latest attempt was solved */
  function lastResults() {
    const last = new Map();
    for (const [pid, solved] of data().attempts) last.set(pid, Boolean(solved));
    return last;
  }
  const status = (results, pid) => (!results.has(pid) ? 'new' : results.get(pid) ? 'solved' : 'failed');
  const cardOut = (card) => (card ? { box: card[0], due_at: iso(card[1]) } : null);

  function puzzleOut(p, st, card = null) {
    return {
      id: p.id, difficulty: p.difficulty, fen: p.fen, moves: p.moves, san: p.san,
      white: p.white, black: p.black, event: p.event, year: p.year ?? null, status: st,
      themes: p.themeList, book: p.book ?? 1, number: p.number ?? p.id, line: p.line ?? null,
      review: cardOut(card), explain: p.explain ?? null,
    };
  }

  function profileOut() {
    const p = data().profile;
    return {
      username: 'Player',
      display_name: p.display_name || 'Player',
      bio: p.bio,
      avatar: { piece: p.avatar_piece, color: p.avatar_color, bg: p.avatar_bg, pattern: p.avatar_pattern, frame: p.frame,
        set: p.piece_set || 'classic' },
      board_theme: p.board_theme,
      appearance: { mode: p.theme_mode || 'system', light: p.light_palette || 'porcelain', dark: p.dark_palette || 'midnight',
        accent: p.accent || 'cobalt', custom: p.custom_theme ? normalise(p.custom_theme) : null },
      joined: dayKey(Date.parse(data().created_at)),
    };
  }

  const progress = () => computeProgress(catalog, data().attempts, now(),
    { done: data().learn, drills: data().drills, openings: data().openings });

  // ---------------------------------------------------------------- puzzles
  function themes() {
    const results = lastResults();
    return THEMES.map(({ key, name, description, group }) => {
      const ids = catalog.puzzles.filter((p) => p.themeSet.has(key)).map((p) => p.id);
      return { key, name, description, total: ids.length, group, solved: ids.filter((id) => results.get(id)).length };
    });
  }

  function list(q) {
    const difficulty = q.get('difficulty');
    const theme = q.get('theme');
    const book = intParam(q.get('book'), null);
    const wanted = q.get('status') || 'all';
    const offset = Math.max(0, intParam(q.get('offset'), 0));
    const limit = Math.min(200, Math.max(1, intParam(q.get('limit'), 60)));
    const results = lastResults();
    let rows = catalog.puzzles
      .filter((p) => (!difficulty || p.difficulty === difficulty) && (!book || (p.book ?? 1) === book)
        && (!theme || p.themeSet.has(theme)))
      .map((p) => ({ id: p.id, book: p.book ?? 1, number: p.number ?? p.id, difficulty: p.difficulty, white: p.white,
        black: p.black, event: p.event, year: p.year ?? null, status: status(results, p.id) }));
    if (wanted !== 'all') rows = rows.filter((r) => r.status === wanted);
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }

  function next(q) {
    const mode = q.get('mode') || 'new';
    const difficulty = q.get('difficulty');
    const after = intParam(q.get('after'), 0);
    const results = lastResults();
    if (mode === 'theme') {
      // practise one theme: every puzzle with it that isn't solved yet (new or missed), in book order
      const theme = q.get('theme');
      if (!theme) throw new ApiError(400, 'Pick a theme to practise.');
      const ids = catalog.puzzles.filter((p) => p.themeSet.has(theme) && !results.get(p.id)).map((p) => p.id);
      const pick = ids.find((id) => id > after) ?? ids[0];
      if (pick === undefined) return { done: true };
      return { ...puzzleOut(puzzle(pick), status(results, pick)), theme_left: ids.length };
    }
    if (mode === 'review') {
      const due = Object.entries(data().cards)
        .map(([pid, card]) => [Number(pid), card])
        .filter(([pid, card]) => card[1] <= now() && (!difficulty || catalog.byId.get(pid)?.difficulty === difficulty))
        .sort((a, b) => a[1][1] - b[1][1] || a[0] - b[0]);
      if (!due.length) return { done: true };
      const [pid, card] = due[0];
      return puzzleOut(puzzle(pid), 'failed', card);
    }
    // the Woodpecker method says: solve the exercises in order
    const fresh = catalog.puzzles.filter((p) => !results.has(p.id) && (!difficulty || p.difficulty === difficulty));
    const pick = fresh.find((p) => p.id > after) ?? fresh[0];
    return pick ? puzzleOut(pick, 'new') : { done: true };
  }

  function getPuzzle(id) {
    const p = puzzle(id);
    const index = catalog.puzzles.indexOf(p);
    return {
      ...puzzleOut(p, status(lastResults(), id), data().cards[id]),
      prev_id: catalog.puzzles[index - 1]?.id ?? null,
      next_id: catalog.puzzles[index + 1]?.id ?? null,
    };
  }

  // ---------------------------------------------------------------- attempts and review boxes
  function updateCard(pid, solved) {
    const cards = data().cards;
    const card = cards[pid];
    if (!solved) {
      cards[pid] = [1, now()];
      return cards[pid];
    }
    if (!card) return null;
    if (card[0] >= LAST_BOX) {
      delete cards[pid];
      return null;
    }
    card[0] += 1;
    card[1] = now() + BOX_INTERVAL_DAYS[card[0]] * DAY_MS;
    return card;
  }

  function attempt(body) {
    const pid = Number(body?.puzzle_id);
    puzzle(pid);
    if (typeof body.solved !== 'boolean') throw new ApiError(422, 'Say whether the puzzle was solved.');
    const mistakes = Math.min(100, Math.max(0, Math.trunc(Number(body.mistakes) || 0)));
    const timeMs = Math.min(6 * 3600 * 1000, Math.max(0, Math.trunc(Number(body.time_ms) || 0)));
    const before = progress();
    data().attempts.push([pid, body.solved ? 1 : 0, mistakes, timeMs, now()]);
    const card = updateCard(pid, body.solved);
    store.save();
    const after = progress();
    const had = new Set(before.achievements.filter((a) => a.earned).map((a) => a.key));
    return {
      ok: true,
      review: cardOut(card),
      // lets the page celebrate unlocks right away
      new_achievements: after.achievements.filter((a) => a.earned && !had.has(a.key)),
      rank_up: after.rank.level > before.rank.level ? after.rank : null,
    };
  }

  // ---------------------------------------------------------------- statistics
  function stats(q) {
    const requested = intParam(q.get('range'), 14);
    const span = [14, 30, 90].includes(requested) ? requested : 14;
    const at = now();
    const today = dayKey(at);
    const attempts = data().attempts;
    const results = lastResults();
    const levelOf = (pid) => catalog.byId.get(pid)?.difficulty;

    const levels = {};
    for (const level of LEVELS) {
      const mine = attempts.filter((a) => levelOf(a[0]) === level);
      const times = mine.filter((a) => a[1]).map((a) => a[3]);
      levels[level] = {
        total: catalog.puzzles.filter((p) => p.difficulty === level).length,
        attempted: new Set(mine.map((a) => a[0])).size,
        solved: [...results].filter(([pid, ok]) => ok && levelOf(pid) === level).length,
        failed: [...results].filter(([pid, ok]) => !ok && levelOf(pid) === level).length,
        attempts: mine.length,
        accuracy: accuracy(mine),
        avg_time_ms: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
      };
    }

    const byDay = new Map();
    for (const a of attempts) {
      const d = dayKey(a[4]);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(a);
    }
    const dayRow = (d) => {
      const rows = byDay.get(d) ?? [];
      const solved = rows.filter((a) => a[1]).length;
      return { date: d, attempts: rows.length, solved, failed: rows.length - solved };
    };
    const lastDays = (n) => Array.from({ length: n }, (_, i) => shiftDay(today, n - 1 - i));
    const between = (lo, hi) => attempts.filter((a) => { const d = dayKey(a[4]); return lo <= d && d <= hi; });

    const weekly = [];
    for (let w = WEEKS - 1; w >= 0; w -= 1) {
      const end = shiftDay(today, 7 * w);
      const start = shiftDay(end, 6);
      const rows = between(start, end);
      weekly.push({ start, end, attempts: rows.length, accuracy: accuracy(rows) });
    }

    const histogram = TIME_BUCKETS.map(([label]) => ({ label, count: 0 }));
    for (const a of attempts) {
      if (!a[1] || !a[3]) continue;
      const i = TIME_BUCKETS.findIndex(([, upper]) => upper === null || a[3] < upper);
      histogram[i].count += 1;
    }

    const thisWeek = between(shiftDay(today, 6), today);
    const lastWeek = between(shiftDay(today, 13), shiftDay(today, 7));
    const solvedIn = (rows) => rows.filter((a) => a[1]).length;

    const cards = Object.values(data().cards);
    const boxes = {};
    for (const [box] of cards) boxes[box] = (boxes[box] ?? 0) + 1;
    const upcoming = cards.map((c) => c[1]).filter((t) => t > at);

    const fails = new Map();
    for (const a of attempts) if (!a[1]) fails.set(a[0], (fails.get(a[0]) ?? 0) + 1);
    const hardest = [...fails].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6)
      .map(([id, n]) => ({ id, fails: n, fen: catalog.byId.get(id)?.fen ?? null }));

    // per theme: how the player does on puzzles that carry it (weakest first once there is enough data)
    const byTheme = new Map();
    for (const a of attempts) {
      for (const t of catalog.byId.get(a[0])?.themeList ?? []) {
        if (!byTheme.has(t)) byTheme.set(t, []);
        byTheme.get(t).push(a);
      }
    }
    const themeRows = THEMES.map(({ key, name }) => {
      const rows = byTheme.get(key) ?? [];
      return { key, name, attempts: rows.length, accuracy: accuracy(rows),
        puzzles: catalog.puzzles.filter((p) => p.themeSet.has(key)).length };
    }).sort((a, b) => (a.attempts < MIN_THEME_ATTEMPTS) - (b.attempts < MIN_THEME_ATTEMPTS)
      || (a.accuracy ?? 101) - (b.accuracy ?? 101) || b.attempts - a.attempts);

    const summary = progress();
    return {
      range: span,
      rank: summary.rank,
      solved: summary.solved,
      attempted: summary.attempted,
      total: summary.total,
      accuracy: summary.accuracy,
      streak_days: summary.streak_days,
      best_streak: summary.best_streak,
      records: summary.records,
      levels,
      total_attempts: attempts.length,
      review_due: cards.filter((c) => c[1] <= at).length,
      review_total: cards.length,
      review_boxes: [1, 2, 3, 4, 5, 6].map((box) => ({ box, count: boxes[box] ?? 0 })),
      next_due: upcoming.length ? iso(Math.min(...upcoming)) : null,
      activity: lastDays(span).map(dayRow),
      heatmap: lastDays(HEATMAP_DAYS).map((d) => ({ date: d, attempts: (byDay.get(d) ?? []).length })),
      weekly_accuracy: weekly,
      time_histogram: histogram,
      deltas: {
        attempts: { now: thisWeek.length, before: lastWeek.length },
        solved: { now: solvedIn(thisWeek), before: solvedIn(lastWeek) },
        accuracy: { now: accuracy(thisWeek), before: accuracy(lastWeek) },
      },
      spark: lastDays(7).map(dayRow),
      hardest,
      themes: themeRows,
      min_theme_attempts: MIN_THEME_ATTEMPTS,
    };
  }

  // ---------------------------------------------------------------- profile
  function saveProfile(body) {
    const p = data().profile;
    const clean = {};
    for (const [field, fallback] of Object.entries(DEFAULT_PROFILE)) {
      const value = body?.[field] ?? fallback;
      if (field === 'custom_theme') {
        // a custom theme is a few colours; anything that is not a colour is refused
        if (value !== null && (typeof value !== 'object' || !['ground', 'surface', 'ink', 'accent', 'ground2'].every((k) => isHex(value[k]))
          || !GRADIENTS.some(([k]) => k === value.gradient))) throw new ApiError(422, 'That custom theme is not valid.');
        clean[field] = value && normalise(value);
      } else if (field === 'display_name' || field === 'bio') {
        const max = field === 'bio' ? 160 : 40;
        if (typeof value !== 'string' || value.length > max) throw new ApiError(422, `Keep it under ${max} characters.`);
        clean[field] = value.split(/\s+/).filter(Boolean).join(' ');
      } else {
        if (!PROFILE_CHOICES[field].includes(value)) throw new ApiError(422, 'That option does not exist.');
        clean[field] = value;
      }
    }
    // locked cosmetics need their achievement; whatever is already equipped stays allowed
    const wanted = { bg: [clean.avatar_bg, p.avatar_bg], pattern: [clean.avatar_pattern, p.avatar_pattern],
      frame: [clean.frame, p.frame], pieces: [clean.piece_set, p.piece_set] };
    let progressNow = null;
    for (const [kind, [item, current]] of Object.entries(wanted)) {
      const key = LOCKED.get(`${kind}:${item}`);
      if (!key || item === current) continue;
      progressNow ??= progress();
      if (!progressNow.unlocked.includes(`${kind}:${item}`)) {
        const title = progressNow.achievements.find((a) => a.key === key).title;
        const noun = { bg: 'background', pattern: 'pattern', frame: 'frame', pieces: 'piece style' }[kind];
        throw new ApiError(403, `Earn the “${title}” achievement to unlock the ${item[0].toUpperCase()}${item.slice(1)} ${noun}.`);
      }
    }
    Object.assign(p, clean);
    store.save();
    return profileOut();
  }

  function setMode(body) {
    if (!PROFILE_CHOICES.theme_mode.includes(body?.theme_mode)) throw new ApiError(422, 'That option does not exist.');
    data().profile.theme_mode = body.theme_mode;
    store.save();
    return profileOut();
  }

  // ---------------------------------------------------------------- sprint
  const sprintData = () => data().sprint;
  function sprintRun(id) {
    const run = sprintData().runs.find((r) => r.id === id);
    if (!run) throw new ApiError(404, 'Sprint not found.');
    return run;
  }

  function finish(run, reason, when) {
    if (run.status === 'finished') return;
    const s = sprintData();
    Object.assign(run, { status: 'finished', reason, finished_at: when, prev_best: s.best[run.minutes] });
    s.best[run.minutes] = Math.max(s.best[run.minutes] ?? 0, run.solved);
    s.finished += 1;
    delete run.puzzle_ids; // only the results are needed once the run is over
    // keep the latest runs; the records live on in `best` and `finished`
    const done = s.runs.filter((r) => r.status === 'finished').sort((a, b) => b.id - a.id);
    const dropped = new Set(done.slice(KEPT_SPRINTS).map((r) => r.id));
    s.runs = s.runs.filter((r) => !dropped.has(r.id));
  }

  /** Close a run whose time is up; runs are only checked when read or played. */
  function refresh(run) {
    if (run.status === 'active' && now() >= run.ends_at + LATE_MOVE_GRACE_MS) {
      finish(run, 'time', run.ends_at);
      return true;
    }
    return false;
  }

  function sprintState(run) {
    let current = null;
    if (run.status === 'active' && run.index < run.puzzle_ids.length) {
      const p = puzzle(run.puzzle_ids[run.index]);
      current = { index: run.index, puzzle_id: p.id, difficulty: p.difficulty, fen: fenAt(p.fen, p.moves, run.ply),
        last_move: run.ply ? p.moves[run.ply - 1] : null, steps_total: Math.ceil(p.moves.length / 2),
        steps_done: Math.floor(run.ply / 2) };
    }
    const out = {
      id: run.id, minutes: run.minutes, status: run.status, reason: run.reason ?? null,
      solved: run.solved, mistakes: run.mistakes, lives_left: Math.max(0, LIVES - run.mistakes),
      started_at: iso(run.started_at), ends_at: iso(run.ends_at), server_now: iso(now()), current,
    };
    if (run.status === 'finished') {
      out.best = sprintData().best[run.minutes];
      out.new_best = run.solved > 0 && (run.prev_best == null || run.solved > run.prev_best);
      out.results = run.results.filter(([pid]) => catalog.byId.has(pid)).map(([pid, solved]) => {
        const p = catalog.byId.get(pid);
        return { puzzle_id: pid, solved: Boolean(solved), fen: p.fen, san: p.san, difficulty: p.difficulty };
      });
    }
    return out;
  }

  function sprintOverview() {
    const s = sprintData();
    if (s.runs.map(refresh).some(Boolean)) store.save();
    const recent = s.runs.filter((r) => r.status === 'finished').sort((a, b) => b.id - a.id).slice(0, 10);
    return {
      best: { 3: s.best[3], 5: s.best[5] },
      runs: s.finished,
      recent: recent.map((r) => ({ id: r.id, minutes: r.minutes, solved: r.solved, mistakes: r.mistakes, reason: r.reason,
        finished_at: iso(r.finished_at) })),
    };
  }

  function pickSprintPuzzles() {
    const ids = [];
    for (const [level, k] of SPRINT_PLAN) {
      const pool = catalog.puzzles.filter((p) => (p.book ?? 1) === 1 && p.difficulty === level).map((p) => p.id);
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      ids.push(...pool.slice(0, k));
    }
    return ids;
  }

  function startSprint(body) {
    const minutes = body?.minutes ?? 3;
    if (![3, 5].includes(minutes)) throw new ApiError(422, 'A sprint lasts 3 or 5 minutes.');
    const s = sprintData();
    const at = now();
    for (const old of s.runs.filter((r) => r.status === 'active')) finish(old, 'ended', at); // one run at a time
    const run = { id: s.next_id, minutes, puzzle_ids: pickSprintPuzzles(), index: 0, ply: 0, solved: 0, mistakes: 0,
      results: [], status: 'active', reason: null, started_at: at, ends_at: at + minutes * 60_000, finished_at: null };
    s.next_id += 1;
    s.runs.push(run);
    store.save();
    return sprintState(run);
  }

  function sprintRead(id) {
    const run = sprintRun(id);
    if (refresh(run)) store.save();
    return sprintState(run);
  }

  function sprintMove(id, body) {
    const run = sprintRun(id);
    if (refresh(run)) store.save();
    if (run.status !== 'active') throw new ApiError(409, 'This sprint is over.');
    const uci = String(body?.uci ?? '').trim().slice(0, 5);
    const p = puzzle(run.puzzle_ids[run.index]);
    const verdict = checkMove(p.fen, p.moves, run.ply, uci);
    if (verdict.result === 'correct') {
      run.ply = verdict.next_ply;
      delete verdict.next_ply;
    } else {
      const solved = verdict.result === 'solved';
      run.results.push([p.id, solved ? 1 : 0]);
      run.solved += solved ? 1 : 0;
      run.mistakes += solved ? 0 : 1;
      run.index += 1;
      run.ply = 0;
      if (run.mistakes >= LIVES) finish(run, 'lives', now());
      else if (run.index >= run.puzzle_ids.length) finish(run, 'done', now());
    }
    store.save();
    return { ...verdict, state: sprintState(run) };
  }

  function sprintEnd(id) {
    const run = sprintRun(id);
    refresh(run);
    finish(run, 'ended', now());
    store.save();
    return sprintState(run);
  }

  // ---------------------------------------------------------------- learn
  const learnOut = () => ({
    done: data().learn,
    drills: data().drills,
    achievements: progress().achievements.filter((a) => a.group === 'learn'),
  });
  /** Save a change and say which achievements it earned. */
  function earning(change) {
    const had = new Set(progress().achievements.filter((a) => a.earned).map((a) => a.key));
    change();
    store.save();
    return { ...learnOut(), new_achievements: progress().achievements.filter((a) => a.earned && !had.has(a.key)) };
  }
  // ---------------------------------------------------------------- openings
  const openingsOut = () => ({
    lines: data().openings,
    now: now(),
    achievements: progress().achievements.filter((a) => a.group === 'openings'),
  });
  function linePlayed(id, body) {
    const mistakes = body?.mistakes;
    if (!LINE_IDS.has(id)) throw new ApiError(404, 'Opening line not found.');
    if (!Number.isInteger(mistakes) || mistakes < 0 || mistakes > 500) throw new ApiError(422, 'Invalid mistakes count.');
    const had = new Set(progress().achievements.filter((a) => a.earned).map((a) => a.key));
    const [streak = 0, , runs = 0, mastered = 0, clean = 0] = data().openings[id] ?? [];
    const next = mistakes ? 0 : streak + 1;
    const due = now() + LINE_REVIEW_DAYS[Math.min(next, LINE_REVIEW_DAYS.length - 1)] * DAY;
    // mastered and "played clean once" never go away, so a later slip can't take a badge back
    data().openings[id] = [next, due, runs + 1, mastered || next >= 3 ? 1 : 0, clean || !mistakes ? 1 : 0];
    store.save();
    return { ...openingsOut(), new_achievements: progress().achievements.filter((a) => a.earned && !had.has(a.key)) };
  }

  function learnDone(id, body) {
    const stars = body?.stars;
    if (!LESSON_IDS.has(id)) throw new ApiError(404, 'Lesson not found.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 3) throw new ApiError(422, 'Stars must be 1, 2 or 3.');
    return earning(() => { data().learn[id] = Math.max(data().learn[id] ?? 0, stars); });
  }
  function drillDone(id, body) {
    const score = body?.score;
    if (!DRILL_IDS.includes(id)) throw new ApiError(404, 'Drill not found.');
    if (!Number.isInteger(score) || score < 0 || score > 200) throw new ApiError(422, 'Invalid score.');
    const before = data().drills[id] ?? null;
    return { ...earning(() => { data().drills[id] = Math.max(before ?? 0, score); }), previous_best: before };
  }

  // ---------------------------------------------------------------- routing
  const routes = [
    ['GET', /^\/api\/auth\/me$/, () => ({ id: 1, ...profileOut() })],
    ['GET', /^\/api\/puzzles\/themes$/, () => themes()],
    ['GET', /^\/api\/puzzles\/next$/, (m, q) => next(q)],
    ['GET', /^\/api\/puzzles\/(\d+)$/, (m) => getPuzzle(Number(m[1]))],
    ['GET', /^\/api\/puzzles$/, (m, q) => list(q)],
    ['POST', /^\/api\/attempts$/, (m, q, body) => attempt(body)],
    ['GET', /^\/api\/stats$/, (m, q) => stats(q)],
    ['GET', /^\/api\/profile$/, () => ({ ...profileOut(), progress: progress() })],
    ['PUT', /^\/api\/profile$/, (m, q, body) => saveProfile(body)],
    ['PATCH', /^\/api\/profile\/appearance$/, (m, q, body) => setMode(body)],
    ['GET', /^\/api\/sprint$/, () => sprintOverview()],
    ['POST', /^\/api\/sprint$/, (m, q, body) => startSprint(body)],
    ['GET', /^\/api\/sprint\/(\d+)$/, (m) => sprintRead(Number(m[1]))],
    ['POST', /^\/api\/sprint\/(\d+)\/move$/, (m, q, body) => sprintMove(Number(m[1]), body)],
    ['POST', /^\/api\/sprint\/(\d+)\/end$/, (m) => sprintEnd(Number(m[1]))],
    ['GET', /^\/api\/learn$/, () => learnOut()],
    ['POST', /^\/api\/drills\/([a-z0-9]{1,20})$/, (m, q, body) => drillDone(m[1], body)],
    ['GET', /^\/api\/openings$/, () => openingsOut()],
    ['POST', /^\/api\/openings\/([a-z0-9-]{1,40})$/, (m, q, body) => linePlayed(m[1], body)],
    ['POST', /^\/api\/learn\/([a-z0-9-]{1,40})$/, (m, q, body) => learnDone(m[1], body)],
  ];

  return function handle(method, path, body) {
    const url = new URL(path, 'app://local');
    for (const [verb, pattern, fn] of routes) {
      const match = verb === method && url.pathname.match(pattern);
      if (match) return fn(match, url.searchParams, body);
    }
    throw new ApiError(404, 'Not found.');
  };
}
