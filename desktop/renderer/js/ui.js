// Shared presentation helpers: notation, avatars, pluralisation, toasts.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Book 2 (positional play) puzzles are stored as 2000 + their exercise number.
export const puzzleName = (id) => (id > 2000 ? `Book 2 · ${id - 2000}` : `Puzzle ${id}`);
/** "White vs Black", or the opening name for the exam positions that have no players. */
export const playersText = (p) => (p.white || p.black ? `${p.white} vs ${p.black}` : p.event || 'Unknown game');

export const PIECE_NAMES ={ k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };

export const figurine = (color, piece) =>
  `<span class="fig pc-${color}${piece}" role="img" aria-label="${PIECE_NAMES[piece]}"></span>`;

/** SAN ('Rxh2+', 'exd5', 'e8=Q#', 'O-O') -> figurine notation HTML. color: 'w' | 'b'. */
export function sanToHtml(san, color) {
  const m = san.match(/^([KQRBN])?(.*?)(?:=([QRBN]))?([+#])?$/);
  if (!m || san.startsWith('O-O')) return `<span class="san">${esc(san)}</span>`;
  const [, piece, body, promo, check] = m;
  return `<span class="san">${piece ? figurine(color, piece.toLowerCase()) : ''}${esc(body)}${promo ? `=${figurine(color, promo.toLowerCase())}` : ''}${check ?? ''}</span>`;
}

const NOUNS = { puzzle: 'puzzle', day: 'day', mistake: 'mistake', attempt: 'attempt', friend: 'friend', run: 'run' };
export const count = (n, word) => `${n.toLocaleString('en')} ${NOUNS[word]}${n === 1 ? '' : 's'}`;

export const fmtTime = (ms) => {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtDuration = (ms) => {
  if (ms == null) return '—';
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : fmtTime(ms);
};
const dateFmt = (opts) => new Intl.DateTimeFormat('en', opts);
export const fmtMonth = (iso) => dateFmt({ month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00`));
export const fmtDay = (iso) => dateFmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${iso}T00:00:00`));
export const fmtShort = (iso) => dateFmt({ month: 'short', day: 'numeric' }).format(new Date(`${iso}T00:00:00`));

// ---------------------------------------------------------------- avatar
export const AVATAR = {
  pieces: [['k', 'King'], ['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight'], ['p', 'Pawn']],
  colors: [['w', 'White'], ['b', 'Black']],
  // items after the free ones are rewards; the server says which achievement unlocks each
  backgrounds: [['ink', 'Ink'], ['emerald', 'Emerald'], ['olive', 'Olive'], ['walnut', 'Walnut'], ['wine', 'Wine'], ['plum', 'Plum'],
    ['slate', 'Slate'], ['sand', 'Sand'], ['teal', 'Teal'], ['crimson', 'Crimson'], ['charcoal', 'Charcoal'], ['sky', 'Sky'],
    ['meadow', 'Meadow'], ['ocean', 'Ocean'], ['sunset', 'Sunset'], ['aurora', 'Aurora'], ['nebula', 'Nebula'], ['volcano', 'Volcano'],
    ['chalkboard', 'Chalkboard'], ['gilt', 'Gilt'], ['dusk', 'Dusk']],
  patterns: [['plain', 'Plain'], ['checker', 'Checker'], ['diagonal', 'Stripes'], ['rings', 'Rings'], ['dots', 'Dots'], ['grid', 'Grid'],
    ['zigzag', 'Zigzag'], ['sunburst', 'Sunburst'], ['scales', 'Scales'], ['argyle', 'Argyle'], ['stars', 'Stars'], ['knights', 'Knights'],
    ['rooks', 'Rooks'], ['lattice', 'Lattice']],
  frames: [['none', 'None'], ['ring', 'Ring'], ['double', 'Double'], ['dashed', 'Dashed'], ['bronze', 'Bronze'], ['silver', 'Silver'],
    ['gold', 'Gold'], ['laurel', 'Laurel'], ['ember', 'Ember'], ['frost', 'Frost'], ['aurora', 'Aurora'], ['royal', 'Royal'], ['prism', 'Prism'],
    ['checkered', 'Checkered'], ['scholar', 'Scholar'], ['duo', 'Duo']],
  sets: [['classic', 'Classic'], ['bauhaus', 'Bauhaus'], ['ice', 'Ice'], ['jade', 'Jade'], ['neon', 'Neon'], ['ruby', 'Ruby'],
    ['gilded', 'Gilded'], ['marble', 'Marble']],
  boards: [['slate', 'Slate'], ['walnut', 'Walnut'], ['olive', 'Olive'], ['marble', 'Marble'], ['sand', 'Sand']],
};
export const THEMES = {
  modes: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['custom', 'Custom']],
  light: [['porcelain', 'Porcelain'], ['parchment', 'Parchment'], ['mist', 'Mist'], ['sage', 'Sage'],
    ['blush', 'Blush'], ['lavender', 'Lavender'], ['glacier', 'Glacier'], ['butter', 'Butter']],
  dark: [['midnight', 'Midnight'], ['obsidian', 'Obsidian'], ['graphite', 'Graphite'], ['espresso', 'Espresso'],
    ['forest', 'Forest'], ['plum', 'Plum'], ['abyss', 'Abyss'], ['wine', 'Wine']],
  accents: [['cobalt', 'Cobalt'], ['emerald', 'Emerald'], ['amber', 'Amber'], ['violet', 'Violet'], ['teal', 'Teal'], ['rose', 'Rose']],
};

// what an achievement reward is called: {kind: 'bg', item: 'sunset'} -> 'Sunset background'
const REWARD_KINDS = { bg: ['backgrounds', 'background'], pattern: ['patterns', 'pattern'], frame: ['frames', 'frame'], pieces: ['sets', 'piece style'] };
export function rewardName({ kind, item }) {
  const [list, noun] = REWARD_KINDS[kind];
  return `${AVATAR[list].find(([k]) => k === item)?.[1] ?? item} ${noun}`;
}

export function avatarHtml(a, size = 'md', label = '') {
  return `<span class="avatar avatar-${size} bg-${a.bg} pat-${a.pattern} frame-${a.frame} set-${a.set || 'classic'}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>
    <span class="avatar-piece is-${a.color}"><i class="piece-img pc-${a.color}${a.piece}"></i></span>
  </span>`;
}

// ---------------------------------------------------------------- toast
function toastHost() {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  return host;
}

function showToast(el, ms) {
  toastHost().append(el);
  setTimeout(() => el.classList.add('leaving'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function toast(message, kind = 'ok', iconHtml = '') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${iconHtml}<span>${esc(message)}</span>`;
  showToast(el, 2600);
}

/** A richer toast for achievements and rank-ups: medal + title + subtitle. */
export function awardToast(medalHtml, title, subtitle) {
  const el = document.createElement('div');
  el.className = 'toast toast-award';
  el.innerHTML = `<span class="medal-mini">${medalHtml}</span><span><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span>`;
  showToast(el, 4200);
}
