// Small SVG chart builders for the statistics page.
// Conventions (dataviz skill): one scale per chart, recessive grid, 2px gaps between stacked
// segments, 4px rounded data ends, text in text tokens, a tooltip on every mark.
import { esc, fmtDay, fmtShort } from './ui.js';

const DEFAULT_W = 640;

const niceMax = (v, min = 2) => {
  const m = Math.max(min, v);
  const step = m <= 10 ? 2 : m <= 50 ? 10 : m <= 200 ? 50 : 100;
  return Math.ceil(m / step) * step;
};

// rectangle with only the top corners rounded (the data end)
function topRounded(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function axis(max, h, top, left, right) {
  return [0, max / 2, max].map((v) => {
    const y = top + h - (v / max) * h;
    return `<line class="grid-line" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/>
      <text class="tick" x="${left - 8}" y="${y + 4}" text-anchor="end">${v}${axis.suffix ?? ''}</text>`;
  }).join('');
}

/** Stacked daily bars: solved (bottom) + failed (top). rows: [{date, solved, failed}] */
export function dailyBars(rows, height = 220, W = DEFAULT_W) {
  const top = 10; const left = 34; const right = W - 4; const bottom = 26;
  const h = height - top - bottom;
  const max = niceMax(Math.max(...rows.map((r) => r.solved + r.failed)));
  const slot = (right - left) / rows.length;
  const bw = Math.max(3, Math.min(28, slot * 0.64));
  const labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor((right - left) / 56)));
  const every = Math.max(1, labelEvery);
  const cols = rows.map((r, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const hs = (r.solved / max) * h;
    const hf = (r.failed / max) * h;
    const base = top + h;
    const gap = hs && hf ? 2 : 0;
    const solvedPath = hf ? `<rect class="bar-ok grow" x="${x}" y="${base - hs}" width="${bw}" height="${hs}" style="--i:${i}"/>`
      : `<path class="bar-ok grow" d="${topRounded(x, base - hs, bw, hs)}" style="--i:${i}"/>`;
    const tip = `<strong>${esc(fmtDay(r.date))}</strong>${r.solved} solved · ${r.failed} missed`;
    return `<g class="col" data-tip="${esc(tip)}">
      <rect class="hover-mark" x="${left + i * slot}" y="${top}" width="${slot}" height="${h}"/>
      ${hs ? solvedPath : ''}
      ${hf ? `<path class="bar-bad grow" d="${topRounded(x, base - hs - gap - hf, bw, hf)}" style="--i:${i}"/>` : ''}
      ${i % every === 0 || i === rows.length - 1 ? `<text class="tick" x="${x + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(fmtShort(r.date))}</text>` : ''}
    </g>`;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${height}" role="img" aria-label="Daily results: solved and missed puzzles">
    ${axis(max, h, top, left, right)}
    <line class="baseline" x1="${left}" x2="${right}" y1="${top + h}" y2="${top + h}"/>
    ${cols}
  </svg>`;
}

/** Weekly accuracy line (0–100%) with a soft area and an emphasised latest point. */
export function accuracyLine(weeks, height = 220, W = DEFAULT_W) {
  const top = 12; const left = 40; const right = W - 12; const bottom = 26;
  const h = height - top - bottom;
  const step = (right - left) / Math.max(1, weeks.length - 1);
  const pts = weeks.map((w, i) => ({ ...w, x: left + i * step, y: w.accuracy == null ? null : top + h - (w.accuracy / 100) * h }));
  const known = pts.filter((p) => p.y != null);
  const line = known.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
  const area = known.length > 1 ? `${line}L${known.at(-1).x},${top + h}L${known[0].x},${top + h}Z` : '';
  axis.suffix = '%';
  const grid = axis(100, h, top, left, right);
  axis.suffix = '';
  const hits = pts.map((p, i) => {
    const tip = `<strong>${esc(fmtShort(p.start))} – ${esc(fmtShort(p.end))}</strong>${p.accuracy == null ? 'No attempts' : `${p.accuracy}% accuracy · ${p.attempts} attempts`}`;
    return `<g class="col" data-tip="${esc(tip)}">
      <rect class="hover-mark" x="${p.x - step / 2}" y="${top}" width="${step}" height="${h}"/>
      ${(weeks.length - 1 - i) % Math.max(1, Math.ceil(weeks.length / Math.floor((right - left) / 64))) ? '' : `<text class="tick" x="${p.x}" y="${height - 6}" text-anchor="middle">${esc(fmtShort(p.end))}</text>`}
    </g>`;
  }).join('');
  const dots = known.map((p, i) => `<circle class="dot ${i === known.length - 1 ? 'last' : ''}" cx="${p.x}" cy="${p.y}" r="${i === known.length - 1 ? 5 : 3}"/>`).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${height}" role="img" aria-label="Weekly accuracy over the last ${weeks.length} weeks">
    ${grid}
    ${hits}
    ${area ? `<path class="area" d="${area}"/>` : ''}
    ${line ? `<path class="line" d="${line}" pathLength="1"/>` : ''}
    ${dots}
  </svg>`;
}

/** Simple labelled column chart (solve-time buckets, review boxes). items: [{label, count}] */
export function columns(items, { height = 200, tip = (it) => `${it.count}`, label = 'Distribution', width: W = DEFAULT_W } = {}) {
  const top = 22; const left = 8; const right = W - 8; const bottom = 26;
  const h = height - top - bottom;
  const max = niceMax(Math.max(...items.map((i) => i.count)), 1);
  const slot = (right - left) / items.length;
  const bw = Math.min(64, slot * 0.62);
  const cols = items.map((it, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const bh = (it.count / max) * h;
    return `<g class="col" data-tip="${esc(tip(it))}">
      <rect class="hover-mark" x="${left + i * slot}" y="${top}" width="${slot}" height="${h}"/>
      ${bh ? `<path class="bar-acc grow" d="${topRounded(x, top + h - bh, bw, bh)}" style="--i:${i}"/>` : ''}
      <text class="tick" x="${x + bw / 2}" y="${top + h - bh - 6}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${it.count}</text>
      <text class="tick" x="${x + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(it.label)}</text>
    </g>`;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}">
    <line class="baseline" x1="${left}" x2="${right}" y1="${top + h}" y2="${top + h}"/>
    ${cols}
  </svg>`;
}

/** Tiny 7-day sparkline of attempts. */
export function sparkline(values) {
  const w = 96; const h = 28;
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const [lx, ly] = pts.at(-1);
  return `<svg class="spark chart-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path class="area" d="${d}L${w},${h}L0,${h}Z"/><path class="line" d="${d}" pathLength="1"/>
    <circle class="dot last" cx="${lx}" cy="${ly}" r="2.5"/></svg>`;
}

/** GitHub-style activity grid: weeks as columns, Sunday on top. days: [{date, attempts}] oldest first. */
export function heatmap(days) {
  const first = new Date(`${days[0].date}T00:00:00`);
  const pad = first.getDay();
  const max = Math.max(1, ...days.map((d) => d.attempts));
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const cells = [
    ...Array.from({ length: pad }, () => '<span class="d pad"></span>'),
    ...days.map((d, i) => `<span class="d l${level(d.attempts)}" style="--i:${i}" data-tip="${esc(`<strong>${esc(fmtDay(d.date))}</strong>${d.attempts} ${d.attempts === 1 ? 'attempt' : 'attempts'}`)}"></span>`),
  ];
  const weeks = Math.ceil(cells.length / 7);
  const months = Array.from({ length: weeks }, (_, w) => {
    for (let k = 0; k < 7; k += 1) {
      const idx = w * 7 + k - pad;
      if (idx >= 0 && idx < days.length && days[idx].date.endsWith('-01')) {
        return `<span>${new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${days[idx].date}T00:00:00`))}</span>`;
      }
    }
    return '<span></span>';
  }).join('');
  return `<div class="heatmap-wrap" style="--weeks:${weeks}">
    <div class="heat-months" aria-hidden="true">${months}</div>
    <div class="heatmap" role="img" aria-label="Attempts per day over the last ${days.length} days">${cells.join('')}</div>
  </div>
  <div class="heat-legend" aria-hidden="true">Less
    <i style="background:var(--surface-2)"></i>
    <i style="background:color-mix(in srgb,var(--accent) 28%,var(--surface-2))"></i>
    <i style="background:color-mix(in srgb,var(--accent) 50%,var(--surface-2))"></i>
    <i style="background:color-mix(in srgb,var(--accent) 75%,var(--surface-2))"></i>
    <i style="background:var(--accent)"></i> More</div>`;
}

/** One floating tooltip per .chart-wrap, fed by data-tip attributes on marks. */
export function attachTips(root) {
  root.querySelectorAll('.chart-wrap').forEach((wrap) => {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    wrap.append(tip);
    const show = (target) => {
      const box = target.getBoundingClientRect();
      const host = wrap.getBoundingClientRect();
      tip.innerHTML = target.dataset.tip;
      const x = Math.min(Math.max(box.left + box.width / 2 - host.left, 70), host.width - 70);
      tip.style.left = `${x}px`;
      tip.style.top = `${box.top - host.top}px`;
      tip.classList.add('on');
    };
    wrap.addEventListener('pointerover', (e) => {
      const target = e.target.closest('[data-tip]');
      if (target && wrap.contains(target)) show(target);
    });
    wrap.addEventListener('pointerleave', () => tip.classList.remove('on'));
  });
}
