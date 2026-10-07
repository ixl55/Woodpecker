// Every Learn exercise is checked on the board: positions load, reference solutions pass their goal,
// wrong moves exist (a goal that every move satisfies teaches nothing), star courses match their par,
// scripted lines are legal, and quiz answers that can be checked on the board are right.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LESSONS, UNITS } from '../renderer/js/lessons.js';
import { defenderMove, load, passes, shortest, squaresOf, tryGoal } from '../renderer/js/learn-rules.js';

const steps = LESSONS.flatMap((l) => l.steps.map((s, i) => ({ ...s, where: `${l.id} step ${i + 1}` })));
const TYPES = new Set(['show', 'squares', 'stars', 'goal', 'line', 'play', 'quiz']);
const SQUARE = /^[a-h][1-8]$/;

test('lesson ids are unique and every step has a known type and text', () => {
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id)));
  assert.ok(UNITS.length >= 9 && LESSONS.length >= 30);
  for (const s of steps) {
    assert.ok(TYPES.has(s.type), s.where);
    assert.ok(s.text?.length > 5, `${s.where}: text`);
    if (s.fen) load(s.fen);
    for (const sq of [...(s.marks ?? []), ...(s.stars ?? []), ...(s.arrows ?? []).flat()]) assert.match(sq, SQUARE, s.where);
  }
});

test('no Arabic letters or emoji in the lesson text', () => {
  const text = JSON.stringify(UNITS);
  assert.doesNotMatch(text, /[؀-ۿ]/);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
});

test('every goal solution passes and some other move fails', () => {
  for (const s of steps.filter((x) => x.type === 'goal')) {
    const { ok } = tryGoal(s.fen, s.solution, s.goal);
    assert.ok(ok, `${s.where}: ${s.solution} should pass ${JSON.stringify(s.goal)}`);
    const wrong = load(s.fen).moves().filter((san) => !tryGoal(s.fen, san, s.goal).ok);
    assert.ok(wrong.length > 0, `${s.where}: every move passes`);
  }
});

test('each star course can be done in exactly par moves', () => {
  for (const s of steps.filter((x) => x.type === 'stars')) {
    const best = shortest(s.fen, s, s.par + 1);
    assert.equal(best, s.par, `${s.where}: shortest is ${best}, par ${s.par}`);
    // stars sit on empty squares and captureAll courses have something to take
    const c = load(s.fen);
    for (const sq of s.stars ?? []) assert.equal(c.get(sq), undefined, `${s.where}: star on a piece`);
    if (s.captureAll) assert.ok(squaresOf(c, s.fen.split(' ')[1] === 'w' ? 'b' : 'w').length, s.where);
  }
});

test('scripted lines are legal and mating lines end in mate', () => {
  for (const s of steps.filter((x) => x.type === 'line')) {
    const c = load(s.fen);
    for (const san of s.moves) c.move(san);
    if (s.moves.at(-1).endsWith('#')) assert.ok(c.isCheckmate(), s.where);
  }
});

test('click targets are real squares', () => {
  for (const s of steps.filter((x) => x.type === 'squares')) {
    for (const [target, prompt] of s.targets) {
      assert.ok(prompt, s.where);
      target.split('|').forEach((sq) => assert.match(sq, SQUARE, s.where));
    }
  }
});

test('quiz answers exist and the ones on a board are checked', () => {
  const facts = {
    mate: (c) => c.isCheckmate(),
    stalemate: (c) => c.isStalemate(),
    insufficient: (c) => c.isInsufficientMaterial(),
    sufficient: (c) => !c.isInsufficientMaterial(),
  };
  for (const s of steps.filter((x) => x.type === 'quiz')) {
    assert.ok(s.answer >= 0 && s.answer < s.choices.length, s.where);
    assert.ok(s.after, `${s.where}: explain the answer`);
    if (s.verify) assert.ok(facts[s.verify](load(s.fen)), `${s.where}: ${s.verify}`);
  }
});

test('play positions are legal, not over, and the defender always answers', () => {
  for (const s of steps.filter((x) => x.type === 'play')) {
    const c = load(s.fen);
    assert.ok(!c.isGameOver() && !c.inCheck(), s.where);
    assert.ok(s.par < s.limit, s.where);
    // a few moves in: the defender must always have a legal reply ready
    for (const san of c.moves().slice(0, 5)) {
      const probe = load(s.fen);
      probe.move(san);
      if (!probe.isGameOver()) assert.ok(defenderMove(probe), s.where);
    }
  }
});

test('the defender takes a hanging piece', () => {
  const c = load('8/8/8/3k4/3R4/8/8/K7 b - - 0 1');
  assert.equal(defenderMove(c).san, 'Kxd4');
});

test('goal checks recognise the tactic and reject look-alikes', () => {
  const f = (fenStr, san, goal) => tryGoal(fenStr, san, goal).ok;
  const fork = LESSONS.find((l) => l.id === 'fork').steps[3].fen;
  assert.ok(f(fork, 'Qd5+', 'fork'));
  assert.ok(!f(fork, 'Qd8+', 'fork')); // the rook just takes the queen
  const pin = LESSONS.find((l) => l.id === 'pin').steps[1].fen;
  assert.ok(!f(pin, 'Bb5', 'skewer'));
  assert.ok(passes('any', null, null, null));
});

test('every generated drill round is solvable and checked', async () => {
  const { DRILLS, makeRounds } = await import('../renderer/js/drills.js');
  for (const d of DRILLS) {
    for (let run = 0; run < 2; run += 1) {
      for (const s of makeRounds(d.id)) {
        if (s.type === 'coords') continue;
        if (s.type === 'stars') {
          assert.equal(shortest(s.fen, s, s.par + 1), s.par, `${d.id}: par`);
          if (s.guarded) assert.ok(!load(s.fen).isAttacked(squaresOf(load(s.fen), 'w')[0].square, 'b'), `${d.id}: starts safe`);
        } else {
          assert.ok(tryGoal(s.fen, s.solution, s.goal).ok, `${d.id}: solution`);
          assert.ok(load(s.fen).moves().some((san) => !tryGoal(s.fen, san, s.goal).ok), `${d.id}: a wrong move exists`);
        }
      }
    }
  }
});
