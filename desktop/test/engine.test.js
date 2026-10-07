import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ApiError, createApi } from '../engine/api.js';
import { loadCatalog } from '../engine/catalog.js';
import { Store } from '../engine/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = loadCatalog(path.join(here, '..', 'resources', 'puzzles.json'));

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-'));
  const store = new Store(path.join(dir, 'progress.json'));
  let clock = Date.UTC(2026, 0, 10, 12);
  const api = createApi(store, catalog, { now: () => clock });
  return { api, store, dir, tick: (ms) => { clock += ms; } };
}

test('both books are in the catalogue', () => {
  assert.equal(catalog.puzzles.length, 2127);
  assert.ok(catalog.byId.get(1).themeSet.has('sacrifice'));
  assert.equal(catalog.byId.get(2001).book, 2);
});

test('puzzles, next and list', () => {
  const { api } = setup();
  const p = api('GET', '/api/puzzles/1');
  assert.equal(p.white, 'Hamppe');
  assert.equal(p.prev_id, null);
  assert.equal(p.next_id, 2);
  assert.equal(api('GET', '/api/puzzles/1128').next_id, 2001); // the books follow each other
  assert.equal(api('GET', '/api/puzzles/next?mode=new').id, 1);
  assert.equal(api('GET', '/api/puzzles?book=2').total, 1000);
  assert.equal(api('GET', '/api/puzzles?difficulty=easy&book=2').total, 339);
  assert.equal(api('GET', '/api/puzzles?limit=500').items.length, 200);
  assert.throws(() => api('GET', '/api/puzzles/11'), (e) => e instanceof ApiError && e.status === 404);
});

test('attempts feed review boxes, status and achievements', () => {
  const { api, store, tick } = setup();
  const first = api('POST', '/api/attempts', { puzzle_id: 1, solved: true, time_ms: 4000 });
  assert.deepEqual(first.new_achievements.map((a) => a.key).sort(), ['first', 'lightning']);
  assert.equal(api('GET', '/api/puzzles/next?mode=new').id, 2);
  const miss = api('POST', '/api/attempts', { puzzle_id: 2, solved: false, time_ms: 9000 });
  assert.equal(miss.review.box, 1);
  assert.equal(api('GET', '/api/puzzles/next?mode=review').id, 2);
  api('POST', '/api/attempts', { puzzle_id: 2, solved: true, time_ms: 9000 });
  assert.deepEqual(api('GET', '/api/puzzles/next?mode=review'), { done: true }); // box 2: due tomorrow
  tick(25 * 3600 * 1000);
  assert.equal(api('GET', '/api/puzzles/next?mode=review').id, 2);
  const list = api('GET', '/api/puzzles?limit=3').items.map((i) => i.status);
  assert.deepEqual(list, ['solved', 'solved', 'new']);
  assert.equal(store.data.attempts.length, 3);
  // saved to disk and read back
  const again = new Store(store.file);
  assert.equal(again.data.attempts.length, 3);
});

test('stats and themes', () => {
  const { api } = setup();
  api('POST', '/api/attempts', { puzzle_id: 1, solved: true, time_ms: 20000 });
  api('POST', '/api/attempts', { puzzle_id: 3, solved: false, time_ms: 20000 });
  const s = api('GET', '/api/stats?range=30');
  assert.equal(s.range, 30);
  assert.equal(s.activity.length, 30);
  assert.equal(s.heatmap.length, 182);
  assert.equal(s.total_attempts, 2);
  assert.equal(s.review_due, 1);
  assert.equal(s.accuracy, 50);
  assert.equal(s.levels.easy.attempts, 2);
  assert.deepEqual(s.hardest.map((h) => h.id), [3]);
  const fork = api('GET', '/api/puzzles/themes').find((t) => t.key === 'fork');
  assert.ok(fork.total > 100);
  assert.equal(api('GET', '/api/puzzles/next?mode=theme&theme=pin').themes.includes('pin'), true);
});

test('profile: rewards stay locked until earned', () => {
  const { api } = setup();
  assert.equal(api('GET', '/api/auth/me').display_name, 'Player');
  const base = { avatar_bg: 'meadow' };
  assert.throws(() => api('PUT', '/api/profile', base), (e) => e.status === 403 && /First Step/.test(e.message));
  assert.equal(api('PUT', '/api/profile', { avatar_bg: 'teal', display_name: '  Sam   the  player ' }).display_name,
    'Sam the player');
  api('POST', '/api/attempts', { puzzle_id: 1, solved: true, time_ms: 20000 });
  assert.equal(api('PUT', '/api/profile', base).avatar.bg, 'meadow');
  // the website's friend rewards are free here
  assert.equal(api('PUT', '/api/profile', { piece_set: 'neon' }).avatar.set, 'neon');
  assert.equal(api('PATCH', '/api/profile/appearance', { theme_mode: 'dark' }).appearance.mode, 'dark');
});

test('sprint: judged moves, lives, records and pruning', () => {
  const { api, store, tick } = setup();
  const s = api('POST', '/api/sprint', { minutes: 3 });
  assert.equal(s.status, 'active');
  assert.equal(s.current.index, 0);
  const run = store.data.sprint.runs[0];
  // play the first puzzle correctly, move by move
  const p = catalog.byId.get(run.puzzle_ids[0]);
  let verdict;
  for (let ply = 0; ply < p.moves.length; ply += 2) {
    verdict = api('POST', `/api/sprint/${s.id}/move`, { uci: p.moves[ply] });
    if (verdict.result === 'solved') break;
    assert.equal(verdict.result, 'correct');
  }
  assert.equal(verdict.result, 'solved');
  assert.equal(verdict.state.solved, 1);
  // three wrong moves end the run
  for (let i = 0; i < 3; i += 1) verdict = api('POST', `/api/sprint/${s.id}/move`, { uci: 'a1a1' });
  assert.equal(verdict.state.status, 'finished');
  assert.equal(verdict.state.reason, 'lives');
  assert.equal(verdict.state.new_best, true);
  assert.equal(verdict.state.results.length, 4);
  assert.equal(api('GET', '/api/sprint').best['3'], 1);
  // time-outs are applied when the run is read
  const late = api('POST', '/api/sprint', { minutes: 5 });
  tick(6 * 60_000);
  assert.equal(api('GET', `/api/sprint/${late.id}`).reason, 'time');
  // only the latest runs are kept; the record count keeps growing
  for (let i = 0; i < 12; i += 1) api('POST', `/api/sprint/${api('POST', '/api/sprint', { minutes: 3 }).id}/end`);
  assert.equal(store.data.sprint.runs.length, 10);
  assert.equal(api('GET', '/api/sprint').runs, 14);
});

test('learn lessons and drills earn badges that unlock rewards', () => {
  const { api } = setup();
  let r = api('POST', '/api/learn/squares', { stars: 3 });
  assert.deepEqual(r.new_achievements.map((a) => a.key), ['first_lesson']);
  assert.equal(r.new_achievements[0].reward.item, 'chalkboard');
  assert.throws(() => api('POST', '/api/learn/nope', { stars: 3 }), (e) => e.status === 404);
  r = api('POST', '/api/drills/coords', { score: 21 });
  assert.ok(r.new_achievements.some((a) => a.key === 'coord_pro'));
  assert.equal(r.previous_best, null);
  r = api('POST', '/api/drills/coords', { score: 12 });
  assert.equal(r.drills.coords, 21); // the best is kept
  assert.equal(r.previous_best, 21);
  assert.throws(() => api('POST', '/api/drills/nope', { score: 1 }), (e) => e.status === 404);
  const learn = api('GET', '/api/learn');
  assert.ok(learn.achievements.every((a) => a.group === 'learn'));
  // the new rewards can be worn once earned, and not before
  api('PUT', '/api/profile', { avatar_bg: 'chalkboard' });
  assert.throws(() => api('PUT', '/api/profile', { frame: 'scholar' }), (e) => e instanceof ApiError);
});

test('opening lines: spaced review, mastery and badges that stay earned', () => {
  const { api, tick } = setup();
  let r = api('POST', '/api/openings/italian-1', { mistakes: 0 });
  assert.ok(r.new_achievements.some((a) => a.key === 'first_line'));
  assert.equal(r.lines['italian-1'][0], 1);
  assert.ok(r.lines['italian-1'][1] > r.now); // comes back tomorrow
  api('POST', '/api/openings/italian-1', { mistakes: 0 });
  r = api('POST', '/api/openings/italian-1', { mistakes: 0 });
  assert.equal(r.lines['italian-1'][3], 1); // mastered after three clean runs
  r = api('POST', '/api/openings/italian-1', { mistakes: 2 });
  assert.equal(r.lines['italian-1'][0], 0);
  assert.ok(r.lines['italian-1'][1] <= r.now); // a mistake brings it back at once
  assert.equal(r.lines['italian-1'][3], 1); // still mastered
  assert.ok(r.achievements.find((a) => a.key === 'first_line').earned);
  // a White line and a Black line mastered: the Duo frame
  for (let i = 0; i < 3; i += 1) { tick(1000); r = api('POST', '/api/openings/sicilian-1', { mistakes: 0 }); }
  assert.ok(r.achievements.find((a) => a.key === 'both_sides').earned);
  api('PUT', '/api/profile', { frame: 'duo' });
  assert.throws(() => api('POST', '/api/openings/nope-1', { mistakes: 0 }), (e) => e.status === 404);
});

test('custom theme is saved, and anything that is not a colour is refused', () => {
  const { api } = setup();
  const theme = { ground: '#101820', surface: '#18222c', ink: '#EEF2F6', accent: '#ff8800', gradient: 'radial', ground2: '#302040' };
  const saved = api('PUT', '/api/profile', { theme_mode: 'custom', custom_theme: theme, light_palette: 'blush', dark_palette: 'wine' });
  assert.equal(saved.appearance.mode, 'custom');
  assert.equal(saved.appearance.custom.ink, '#eef2f6');
  assert.equal(saved.appearance.dark, 'wine');
  assert.throws(() => api('PUT', '/api/profile', { theme_mode: 'custom', custom_theme: { ...theme, ink: 'url(x)' } }), (e) => e.status === 422);
  assert.throws(() => api('PUT', '/api/profile', { custom_theme: { ...theme, gradient: 'zigzag' } }), (e) => e.status === 422);
});
