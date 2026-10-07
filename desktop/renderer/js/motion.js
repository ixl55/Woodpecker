// Motion helpers. Every effect is skipped when the user asks for reduced motion.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run a DOM update inside a View Transition (cross-fade + rise); plain call where unsupported. */
export async function transition(update) {
  if (reduced() || !document.startViewTransition) return update();
  let result;
  const vt = document.startViewTransition(async () => { result = await update(); });
  // a quick second navigation skips this transition; that is expected, not an error
  vt.ready.catch(() => {});
  vt.finished.catch(() => {});
  await vt.updateCallbackDone.catch(() => {});
  return result;
}

/** Give children an index so `.stagger > *` can cascade their entrance. */
export function stagger(container, selector = ':scope > *') {
  if (!container) return;
  container.classList.add('stagger');
  container.querySelectorAll(selector).forEach((el, i) => el.style.setProperty('--i', i));
}

/** Animate numbers inside [data-count] elements from 0 to their value. */
export function countUp(root = document, duration = 900) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix ?? '';
    if (!Number.isFinite(target)) return;
    if (reduced() || target === 0) {
      el.textContent = target.toLocaleString('en') + suffix;
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = Math.round(target * eased).toLocaleString('en') + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Fill progress rings (their arc starts empty; see icons.ring). */
export function fillRings(root = document) {
  const rings = root.querySelectorAll('.ring .value[data-target]');
  const apply = () => rings.forEach((c) => { c.style.strokeDashoffset = c.dataset.target; });
  if (reduced()) apply(); else requestAnimationFrame(() => requestAnimationFrame(apply));
}

/** Expanding ring over a board square. square: 'e4', orientation: 'white' | 'black'. */
export function pingSquare(wrap, square, orientation, kind = 'ok') {
  if (reduced() || !wrap) return;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = orientation === 'white' ? file : 7 - file;
  const y = orientation === 'white' ? 7 - rank : rank;
  const el = document.createElement('span');
  el.className = `ping ${kind === 'bad' ? 'bad' : ''}`;
  el.style.left = `${x * 12.5}%`;
  el.style.top = `${y * 12.5}%`;
  wrap.append(el);
  setTimeout(() => el.remove(), 700);
}

export function shake(el) {
  if (reduced() || !el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 350);
}

/** Particle burst from the centre of `wrap` in the accent and gold colours. */
export function burst(wrap) {
  if (reduced() || !wrap) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  wrap.append(canvas);
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue('--accent').trim(), css.getPropertyValue('--gold').trim(), css.getPropertyValue('--ok').trim(), '#ffffff'];
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const parts = Array.from({ length: 70 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 6;
    return {
      x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
      size: 3 + Math.random() * 4, rot: Math.random() * Math.PI, spin: (Math.random() - .5) * .3,
      color: colors[Math.floor(Math.random() * colors.length)], square: Math.random() > .5,
    };
  });
  const start = performance.now();
  const frame = (now) => {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const p of parts) {
      p.vy += .22;
      p.vx *= .985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      ctx.globalAlpha = Math.max(0, 1 - t / 1.1);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.square) ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (t < 1.1) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
