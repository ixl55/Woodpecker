export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : 'The request could not be completed. Check your input and try again.';
    throw new ApiError(res.status, detail);
  }
  return data;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  register: (username, password) => request('POST', '/api/auth/register', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  puzzle: (id) => request('GET', `/api/puzzles/${id}`),
  next: (params) => request('GET', `/api/puzzles/next${qs(params)}`),
  list: (params) => request('GET', `/api/puzzles${qs(params)}`),
  attempt: (body) => request('POST', '/api/attempts', body),
  stats: (range) => request('GET', `/api/stats${qs({ range })}`),
  profile: () => request('GET', '/api/profile'),
  saveProfile: (body) => request('PUT', '/api/profile', body),
  changePassword: (current_password, new_password) => request('POST', '/api/auth/password', { current_password, new_password }),
  deleteAccount: (password, confirm) => request('POST', '/api/auth/delete-account', { password, confirm }),
  themes: () => request('GET', '/api/puzzles/themes'),
  sprints: () => request('GET', '/api/sprint'),
  startSprint: (minutes) => request('POST', '/api/sprint', { minutes }),
  sprint: (id) => request('GET', `/api/sprint/${id}`),
  sprintMove: (id, uci) => request('POST', `/api/sprint/${id}/move`, { uci }),
  endSprint: (id) => request('POST', `/api/sprint/${id}/end`),
  setMode: (mode) => request('PATCH', '/api/profile/appearance', { theme_mode: mode }),
  notifications: () => request('GET', '/api/notifications'),
  friends: () => request('GET', '/api/friends'),
  searchUsers: (q) => request('GET', `/api/users/search${qs({ q })}`),
  addFriend: (username) => request('POST', '/api/friends/requests', { username }),
  acceptFriend: (id) => request('POST', `/api/friends/requests/${id}/accept`),
  declineFriend: (id) => request('POST', `/api/friends/requests/${id}/decline`),
  cancelFriendRequest: (id) => request('DELETE', `/api/friends/requests/${id}`),
  removeFriend: (userId) => request('DELETE', `/api/friends/${userId}`),
  friendPage: (userId) => request('GET', `/api/friends/${userId}`),
  challenges: () => request('GET', '/api/challenges'),
  createChallenge: (body) => request('POST', '/api/challenges', body),
  challenge: (id) => request('GET', `/api/challenges/${id}`),
  challengeAction: (id, action) => request('POST', `/api/challenges/${id}/${action}`),
  challengeMove: (id, uci) => request('POST', `/api/challenges/${id}/move`, { uci }),
};
