// Calls into the app's local engine (Electron main process) through the bridge in preload.cjs.
// Same paths and answers as the website's HTTP API, so the pages did not have to change.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await window.woodpecker.request(method, path, body ?? null);
  if (!res.ok) throw new ApiError(res.status, res.detail || 'Something went wrong. Try again.');
  return res.data;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/api/auth/me'),
  puzzle: (id) => request('GET', `/api/puzzles/${id}`),
  next: (params) => request('GET', `/api/puzzles/next${qs(params)}`),
  list: (params) => request('GET', `/api/puzzles${qs(params)}`),
  attempt: (body) => request('POST', '/api/attempts', body),
  stats: (range) => request('GET', `/api/stats${qs({ range })}`),
  profile: () => request('GET', '/api/profile'),
  saveProfile: (body) => request('PUT', '/api/profile', body),
  themes: () => request('GET', '/api/puzzles/themes'),
  sprints: () => request('GET', '/api/sprint'),
  startSprint: (minutes) => request('POST', '/api/sprint', { minutes }),
  sprint: (id) => request('GET', `/api/sprint/${id}`),
  sprintMove: (id, uci) => request('POST', `/api/sprint/${id}/move`, { uci }),
  endSprint: (id) => request('POST', `/api/sprint/${id}/end`),
  learn: () => request('GET', '/api/learn'),
  learnDone: (id, stars) => request('POST', `/api/learn/${id}`, { stars }),
  drillDone: (id, score) => request('POST', `/api/drills/${id}`, { score }),
  openings: () => request('GET', '/api/openings'),
  linePlayed: (id, mistakes) => request('POST', `/api/openings/${id}`, { mistakes }),
  setMode: (mode) => request('PATCH', '/api/profile/appearance', { theme_mode: mode }),
};
