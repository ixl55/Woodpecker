// Apply the saved appearance before first paint (the stored profile is re-applied once the app loads).
(function () {
  var a = { mode: 'system', light: 'porcelain', dark: 'midnight', accent: 'cobalt' };
  try { Object.assign(a, JSON.parse(localStorage.getItem('appearance') || '{}')); } catch (e) {}
  var dark = a.mode === 'dark' || (a.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.dataset.scheme = dark ? 'dark' : 'light';
  root.dataset.palette = dark ? a.dark : a.light;
  root.dataset.accent = a.accent;
  if (a.mode === 'custom') {
    // a custom theme: the colours worked out by the app last time, so the first paint already uses them
    try {
      var c = JSON.parse(localStorage.getItem('customVars') || 'null');
      if (c) {
        root.dataset.scheme = c.scheme;
        root.dataset.palette = 'custom';
        root.dataset.accent = 'custom';
        Object.keys(c.vars).forEach(function (k) { root.style.setProperty(k, c.vars[k]); });
      }
    } catch (e) {}
  }
  try { var b = localStorage.getItem('board'); if (b && b !== 'slate') root.dataset.board = b; } catch (e) {}
  try { var s = localStorage.getItem('pieces'); if (s && s !== 'classic') root.dataset.pieces = s; } catch (e) {}
})();
