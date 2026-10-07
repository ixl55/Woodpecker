// Custom stroke icons on a 24px grid (1.75 stroke, round joins). They inherit currentColor.
// No emoji or font glyphs are used anywhere in the interface.
const svg = (body, size = 20, label = '') =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${body}</svg>`;

const paths = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>',
  flip: '<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  prev: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M9.5 2.5h5"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  flame: '<path d="M12 21.5c3.9 0 6.5-2.6 6.5-6.2 0-3.3-2.3-5.3-3.8-8.1-.9 1.8-1.9 2.8-3.2 3.3.3-2.8-.6-5.2-2.5-7.5 0 3.9-3.5 6.2-3.5 11.3 0 4.3 2.6 7.2 6.5 7.2z"/>',
  logout: '<path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5L5.5 12 10 7.5M5.5 12h10"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="3.75"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  user: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
  pencil: '<path d="M15.5 4.5l4 4L9 19H5v-4L15.5 4.5z"/><path d="M13.5 6.5l4 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  crown: '<path d="M4 17.5L3 7.5l5 4 4-6.5 4 6.5 5-4-1 10H4z"/><path d="M4.5 20.5h15"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2 4 2 4h-11"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.75"/><circle cx="12" cy="12" r="1.25"/>',
  layers: '<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8 12 3.5z"/><path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.5L6 3h4l2 4 2-4h4l-2.5 7.5"/><path d="M12 12.5v5M10 14.5l2-2"/>',
  book: '<path d="M4 5.5A2 2 0 0 1 6 3.5h13.5v14H6a2 2 0 0 0-2 2v-14z"/><path d="M4 19.5a2 2 0 0 0 2 2h13.5M8.5 8h7M8.5 11.5h5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M12 14h2M16 14h.5M8 17h2M12 17h2"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.1-7.5 9.5-4.3-1.4-7.5-4.9-7.5-9.5V6L12 3z"/><path d="M8.75 12l2.25 2.25 4.25-4.5"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4z"/><path d="M7.5 6H4.5v1.5A3 3 0 0 0 7.6 10.5M16.5 6h3v1.5a3 3 0 0 1-3.1 3M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  enter: '<path d="M19.5 5v6.5a3 3 0 0 1-3 3H5.5"/><path d="M9.5 10.5l-4 4 4 4"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.7-3.3 3.3-5 6.5-5s5.8 1.7 6.5 5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.8.7 3 2.3 3.5 4.7"/>',
  userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 19.5c.7-3.3 3.3-5 6.5-5s5.8 1.7 6.5 5M19 8v6M16 11h6"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 7.5 2.9C19.5 15.4 12 20 12 20z"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z"/>',
  hourglass: '<path d="M6.5 3h11M6.5 21h11M7.5 3c0 4.5 4.5 5.5 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 5.5-4.5 9s4.5 4.5 4.5 9"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15h-6v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.5z"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16.5V11M12 16.5V6.5M17 16.5v-3.5"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6h2.1a4 4 0 0 0 4-4c0-3.9-3.8-7.1-8.5-7.1z"/><circle cx="7.75" cy="11.5" r="1"/><circle cx="10.5" cy="7.75" r="1"/><circle cx="15" cy="8.25" r="1"/>',
  board: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 12h17M12 3.5v17"/><path d="M3.5 3.5h8.5v8.5H3.5zM12 12h8.5v8.5H12z" fill="currentColor" stroke="none" opacity=".35"/>',
  save: '<path d="M5 4h11.5L20 7.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v4.5h7V4M7.5 20v-6h9v6"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z"/>',
  spark: '<path d="M12 3l1.9 5.6c.3.9 1 1.6 1.9 1.9L21 12l-5.2 1.5c-.9.3-1.6 1-1.9 1.9L12 21l-1.9-5.6c-.3-.9-1-1.6-1.9-1.9L3 12l5.2-1.5c.9-.3 1.6-1 1.9-1.9z"/>',
  mountain: '<path d="M2.5 19.5l6.5-12 4 7 2.5-4 6 9z"/><path d="M7 12l2 1.5 2-1.5"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".9" fill="currentColor"/>',
  laurel: '<path d="M8 20c-3.5-2-5-5.5-4.5-10M16 20c3.5-2 5-5.5 4.5-10"/><path d="M5 15.5c1.5 0 2.7.6 3.3 1.8M3.8 11.5c1.5.2 2.6 1 3 2.3M4.5 7.5c1.3.5 2.1 1.5 2.2 2.8M19 15.5c-1.5 0-2.7.6-3.3 1.8M20.2 11.5c-1.5.2-2.6 1-3 2.3M19.5 7.5c-1.3.5-2.1 1.5-2.2 2.8"/><path d="M12 5.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z"/>',
  gem: '<path d="M6.5 4h11l4 5.5-9.5 11-9.5-11z"/><path d="M2.5 9.5h19M9.5 4L8 9.5l4 11 4-11L14.5 4"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v7h14v-7M12 8.5v11M12 8.5C10.5 5 7 4.5 7 6.8 7 8.5 10 8.5 12 8.5zM12 8.5c1.5-3.5 5-4 5-1.7 0 1.7-3 1.7-5 1.7z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.25"/>',
};

export const icons = Object.fromEntries(
  Object.entries(paths).map(([name, body]) => [name, (size, label) => svg(body, size, label)]),
);

// Brand mark: the woodpecker artwork (static/img, cut from logo.png).
export const logo = (size = 30) =>
  `<img class="logo" src="/static/img/logo-${size > 32 ? 256 : 64}.png" width="${size}" height="${size}" alt="" decoding="async">`;

// Progress ring (value 0..1). The value arc starts empty and fills when .ring-go is added.
export const ring = (value, size = 64, stroke = 6, color = 'var(--accent)') => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>
    <circle class="value" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - v)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
};

// Theme toggle: one SVG that morphs between a moon (light scheme) and a sun (dark scheme).
// A masked circle slides across the disc to cut the crescent; the rays grow and turn in.
export const themeToggleSvg = () => `
  <svg class="theme-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <mask id="theme-cut"><rect width="24" height="24" fill="#fff"/><circle class="cut" cx="17" cy="7" r="6.5" fill="#000"/></mask>
    <circle class="core" cx="12" cy="12" r="8.5" fill="currentColor" mask="url(#theme-cut)"/>
    <g class="rays" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5"/>
    </g>
  </svg>`;
