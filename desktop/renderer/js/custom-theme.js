// Custom theme: the player picks a few colours (background, cards, text, accent, an optional gradient)
// and every other colour the interface needs is derived from them. Secondary text and the accent are
// pushed towards the text colour until they read at 4.5:1, so a custom theme stays readable.

export const GRADIENTS = [['none', 'Solid'], ['vertical', 'Top to bottom'], ['diagonal', 'Diagonal'], ['radial', 'Glow']];

export const DEFAULT_CUSTOM = { ground: '#0f1724', surface: '#172234', ink: '#e8eef7', accent: '#7aa2f7', gradient: 'diagonal', ground2: '#2a1f45' };

export const PRESETS = [
  ['Nightfall', { ground: '#0f1724', surface: '#172234', ink: '#e8eef7', accent: '#7aa2f7', gradient: 'diagonal', ground2: '#2a1f45' }],
  ['Sunrise', { ground: '#fff4ea', surface: '#fffaf5', ink: '#2a1a12', accent: '#c2410c', gradient: 'vertical', ground2: '#ffd9c2' }],
  ['Lagoon', { ground: '#e6f6f4', surface: '#f7fdfc', ink: '#0d2624', accent: '#0f766e', gradient: 'radial', ground2: '#c3ebe6' }],
  ['Forest night', { ground: '#0c1611', surface: '#14221a', ink: '#e4f1e8', accent: '#7fd49b', gradient: 'vertical', ground2: '#1f3b2a' }],
  ['Candy', { ground: '#fdf0f7', surface: '#fffafd', ink: '#2b1422', accent: '#be185d', gradient: 'diagonal', ground2: '#e9e3ff' }],
  ['Mono', { ground: '#161616', surface: '#202020', ink: '#f2f2f2', accent: '#d4d4d4', gradient: 'none', ground2: '#303030' }],
];

/** Every CSS variable a custom theme sets; a named palette removes them again. */
export const CUSTOM_VARS = ['--ground', '--ground-img', '--surface', '--surface-2', '--surface-3', '--ink', '--muted', '--faint',
  '--line', '--line-strong', '--accent', '--accent-hover', '--accent-soft', '--accent-ink', '--hl-last', '--hl-select'];

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v) => typeof v === 'string' && HEX.test(v);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** a mixed with b: t = 0 gives a, t = 1 gives b */
export const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };

function luminance(color) {
  const [r, g, b] = rgb(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Move `color` towards `to` until it reads at `min` against every background given. */
function readable(color, to, backgrounds, min = 4.5) {
  let c = color;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    c = mix(color, to, t);
    if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return to;
}

/** The better text colour on top of `color`: near-white or near-black. */
export const bestText = (color) => (contrast(color, '#ffffff') >= contrast(color, '#111111') ? '#ffffff' : '#111111');

/** Clean up whatever came from storage: unknown or broken values fall back to the default. */
export function normalise(c) {
  const out = { ...DEFAULT_CUSTOM };
  for (const key of ['ground', 'surface', 'ink', 'accent', 'ground2']) if (isHex(c?.[key])) out[key] = c[key].toLowerCase();
  if (GRADIENTS.some(([k]) => k === c?.gradient)) out.gradient = c.gradient;
  return out;
}

/**
 * All the variables for a custom theme, whether it is a dark or a light scheme (for the board,
 * the success and error colours), and the contrast figures the editor shows.
 */
export function customTheme(input) {
  const c = normalise(input);
  const dark = contrast(c.ground, '#ffffff') > contrast(c.ground, '#000000');
  const surface2 = mix(c.surface, c.ink, dark ? 0.07 : 0.06);
  const surface3 = mix(c.surface, c.ink, dark ? 0.12 : 0.11);
  const backs = [c.ground, c.surface, surface2];
  const muted = readable(mix(c.ink, c.surface, 0.38), c.ink, backs);
  const faint = readable(mix(c.ink, c.surface, 0.46), c.ink, backs);
  const accent = readable(c.accent, c.ink, [c.surface, c.ground]);
  const img = {
    none: 'none',
    vertical: `linear-gradient(180deg, ${c.ground} 0%, ${c.ground2} 100%)`,
    diagonal: `linear-gradient(135deg, ${c.ground} 0%, ${c.ground2} 100%)`,
    radial: `radial-gradient(circle at 50% 0%, ${c.ground2} 0%, ${c.ground} 70%)`,
  }[c.gradient];
  const vars = {
    '--ground': c.ground,
    '--ground-img': img,
    '--surface': c.surface,
    '--surface-2': surface2,
    '--surface-3': surface3,
    '--ink': c.ink,
    '--muted': muted,
    '--faint': faint,
    '--line': mix(c.surface, c.ink, dark ? 0.12 : 0.1),
    '--line-strong': mix(c.surface, c.ink, dark ? 0.2 : 0.18),
    '--accent': accent,
    '--accent-hover': mix(accent, c.ink, 0.18),
    '--accent-soft': mix(c.surface, accent, dark ? 0.2 : 0.13),
    '--accent-ink': bestText(accent),
    '--hl-last': `color-mix(in srgb, ${accent} 30%, transparent)`,
    '--hl-select': `color-mix(in srgb, ${accent} 45%, transparent)`,
  };
  return {
    theme: c,
    scheme: dark ? 'dark' : 'light',
    vars,
    text: Math.min(contrast(c.ink, c.ground), contrast(c.ink, c.surface)),
    accentAdjusted: accent !== c.accent,
  };
}
