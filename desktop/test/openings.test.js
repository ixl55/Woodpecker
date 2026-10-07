// Every opening line is played on a board from the starting position: all moves legal, a reason for
// every move of the side you play, and the opening traps really end in checkmate.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Chess } from '../renderer/vendor/chess.js';
import { tryGoal } from '../renderer/js/learn-rules.js';
import { OPENINGS, OPENING_LINES, learnerPlies } from '../renderer/js/openings.js';

test('at least eight openings for each colour, plus traps', () => {
  const real = OPENINGS.filter((o) => o.kind === 'opening');
  assert.ok(real.filter((o) => o.side === 'w').length >= 8);
  assert.ok(real.filter((o) => o.side === 'b').length >= 8);
  assert.ok(OPENINGS.some((o) => o.kind === 'trap' && o.side === 'w'));
  assert.ok(OPENINGS.some((o) => o.kind === 'trap' && o.side === 'b'));
  const ids = OPENING_LINES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(OPENINGS.map((o) => o.id)).size, OPENINGS.length);
  for (const o of OPENINGS) {
    assert.match(o.eco, /^[A-E]\d\d$/, o.id);
    assert.ok(o.idea.length > 40, o.id);
  }
});

test('every line is legal and every move you play has a reason', () => {
  for (const line of OPENING_LINES) {
    const c = new Chess();
    line.moves.forEach((san, i) => {
      assert.doesNotThrow(() => c.move(san), `${line.id}: move ${i + 1} ${san}`);
    });
    for (const i of learnerPlies(line, line.opening.side)) {
      assert.ok(line.notes[i], `${line.id}: no reason for ${line.moves[i]}`);
    }
    // a line ends on a move of the learner, so practice finishes with your move
    assert.ok(learnerPlies(line, line.opening.side).includes(line.moves.length - 1), `${line.id}: ends on the opponent's move`);
    assert.ok(line.moves.length >= 4, line.id);
  }
});

test('every trap wins what it says: mate, a fork or skewer, or material', () => {
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const traps = OPENING_LINES.filter((l) => l.opening.kind === 'trap');
  assert.ok(traps.length >= 10 && traps.length <= 15);
  assert.ok(traps.filter((l) => l.opening.side === 'b').length >= 5);
  for (const line of traps) {
    const o = line.opening;
    const c = new Chess();
    line.moves.slice(0, -1).forEach((san) => c.move(san));
    const before = c.fen();
    c.move(line.moves.at(-1));
    assert.ok(o.result, o.id);
    if (o.proof === 'mate') {
      assert.ok(c.isCheckmate(), `${o.id}: not mate`);
    } else if (o.proof === 'material') {
      let diff = 0;
      c.board().flat().filter(Boolean).forEach((p) => { diff += (p.color === o.side ? 1 : -1) * VALUE[p.type]; });
      assert.ok(diff >= o.gain, `${o.id}: material ${diff}, expected ${o.gain}`);
    } else {
      assert.ok(tryGoal(before, line.moves.at(-1), o.proof).ok, `${o.id}: last move is not a ${o.proof}`);
    }
  }
});

test('no Arabic letters or emoji in the openings', () => {
  const text = JSON.stringify(OPENINGS);
  assert.doesNotMatch(text, /[؀-ۿ]/);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
});
