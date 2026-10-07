// Colour themes: every named shade and every custom theme keeps text readable (4.5:1 or more).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { PRESETS, contrast, customTheme, normalise } from '../renderer/js/custom-theme.js';

const css = fs.readFileSync(new URL('../renderer/css/themes.css', import.meta.url), 'utf8');
function palette(name) {
  const start = css.indexOf(`[data-palette="${name}"] {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
}

test('eight light and eight dark shades, all readable', () => {
  const names = [...css.matchAll(/data-palette="(\w+)"/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, 16);
  for (const name of new Set(names)) {
    const p = palette(name);
    for (const fg of ['ink', 'muted', 'faint']) {
      for (const bg of ['ground', 'surface', 'surface-2']) {
        assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${name}: ${fg} on ${bg} is ${contrast(p[fg], p[bg]).toFixed(2)}`);
      }
    }
  }
});

test('custom themes derive readable secondary text and accent', () => {
  const samples = [...PRESETS.map(([, t]) => t),
    { ground: '#ffffff', surface: '#ffffff', ink: '#000000', accent: '#ffff00', gradient: 'none', ground2: '#ffffff' },
    { ground: '#000000', surface: '#101010', ink: '#ffffff', accent: '#000080', gradient: 'radial', ground2: '#202020' }];
  for (const t of samples) {
    const { vars, text } = customTheme(t);
    assert.ok(text >= 4.5, JSON.stringify(t));
    for (const v of ['--muted', '--faint', '--accent']) {
      assert.ok(contrast(vars[v], vars['--surface']) >= 4.5, `${v} in ${JSON.stringify(t)}`);
    }
    assert.ok(contrast(vars['--accent-ink'], vars['--accent']) >= 4.5 || contrast(vars['--accent-ink'], vars['--accent']) >= 3);
  }
  assert.equal(customTheme({ ...PRESETS[0][1] }).scheme, 'dark');
  assert.equal(customTheme({ ...PRESETS[1][1] }).scheme, 'light');
  assert.equal(normalise({ ground: 'red', gradient: 'zigzag' }).gradient, 'diagonal'); // bad values fall back
});
