// Everything the app remembers lives in one small JSON file in the user's data folder.
// Attempts are stored as compact rows, so a whole run through the seven Woodpecker cycles stays
// around a megabyte. Writes go to a temporary file first and then replace the old one, so a crash
// or power cut in the middle of a save never leaves a half-written file behind.
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;

export const DEFAULT_PROFILE = {
  display_name: '',
  bio: '',
  avatar_piece: 'n',
  avatar_color: 'w',
  avatar_bg: 'ink',
  avatar_pattern: 'plain',
  frame: 'ring',
  piece_set: 'classic',
  board_theme: 'slate',
  theme_mode: 'system',
  light_palette: 'porcelain',
  dark_palette: 'midnight',
  accent: 'cobalt',
  custom_theme: null, // {ground, surface, ink, accent, gradient, ground2} when theme_mode is 'custom'
};

function fresh() {
  return {
    version: VERSION,
    created_at: new Date().toISOString(),
    profile: { ...DEFAULT_PROFILE },
    // [puzzle_id, solved (1/0), mistakes, time_ms, timestamp_ms], oldest first
    attempts: [],
    // puzzle_id -> [box, due timestamp_ms]: Leitner cards for puzzles missed at least once
    cards: {},
    sprint: { next_id: 1, runs: [], best: { 3: null, 5: null }, finished: 0 },
    // lesson id -> best stars (1..3) in the Learn section
    learn: {},
    // drill id -> best score in the Learn practice drills
    drills: {},
    // opening line id -> [clean runs in a row, next review (ms), runs, mastered 0/1, played clean once 0/1]
    openings: {},
    window: null,
  };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = this.read();
  }

  read() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // unreadable: keep the damaged file aside instead of silently overwriting the user's progress
        try { fs.renameSync(this.file, `${this.file}.damaged-${Date.now()}`); } catch { /* nothing to keep */ }
      }
      return fresh();
    }
    const base = fresh();
    return {
      ...base,
      ...data,
      profile: { ...DEFAULT_PROFILE, ...data.profile },
      sprint: { ...base.sprint, ...data.sprint, best: { ...base.sprint.best, ...data.sprint?.best } },
      learn: { ...data.learn },
      drills: { ...data.drills },
      openings: { ...data.openings },
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
