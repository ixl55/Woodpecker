// Derived progress: rank, streaks, records and achievements, computed from the stored attempts.
// Days are the computer's local calendar days, so a streak follows the player's own evenings.
import { DRILL_IDS } from '../renderer/js/drills.js';
import { LESSONS, UNITS } from '../renderer/js/lessons.js';
import { OPENING_LINES } from '../renderer/js/openings.js';

const RANKS = [
  [0, 'Novice'],
  [25, 'Amateur'],
  [100, 'Club Player'],
  [300, 'Advanced'],
  [600, 'Expert'],
  [900, 'Master'],
  [1400, 'International Master'],
  [2000, 'Grandmaster'], // both books: 1,127 tactics + 1,000 positional exercises
];
const FAST_MS = 10_000;
const LIGHTNING_MS = 5_000;
const LONG_LINE = 5; // solver moves that make a puzzle a "deep" one

// What each achievement unlocks in the profile editor: achievement key -> [kind, item].
// Anything not listed here is free (this includes the cosmetics the website gives for friend challenges).
export const REWARDS = {
  first: ['bg', 'meadow'],
  warm_up: ['pattern', 'zigzag'],
  ten: ['bg', 'ocean'],
  hat_trick: ['frame', 'bronze'],
  hot_hand: ['bg', 'sunset'],
  lightning: ['pattern', 'sunburst'],
  bounce_back: ['pattern', 'scales'],
  fifty: ['frame', 'silver'],
  week: ['frame', 'ember'],
  mate_hunter: ['bg', 'aurora'],
  deep: ['pattern', 'stars'],
  sharp_eye: ['pattern', 'knights'],
  clean: ['frame', 'frost'],
  fast: ['pieces', 'ice'],
  comeback: ['pieces', 'jade'],
  hundred: ['frame', 'gold'],
  easy_done: ['bg', 'nebula'],
  five_hundred: ['frame', 'royal'],
  mid_done: ['bg', 'volcano'],
  adv_done: ['frame', 'prism'],
  month: ['pieces', 'marble'],
  // Learn
  first_lesson: ['bg', 'chalkboard'],
  piece_mover: ['pattern', 'rooks'],
  checkmater: ['frame', 'checkered'],
  coord_pro: ['pattern', 'lattice'],
  graduate: ['frame', 'scholar'],
  top_marks: ['bg', 'gilt'],
  // Openings
  both_sides: ['frame', 'duo'],
  repertoire: ['bg', 'dusk'],
};
export const LOCKED = new Map(Object.entries(REWARDS).map(([key, [kind, item]]) => [`${kind}:${item}`, key]));

const pad = (v) => String(v).padStart(2, '0');
/** Local calendar day of a timestamp, as YYYY-MM-DD. */
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** The day `n` days before the day key `key` (n may be negative). */
export function shiftDay(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - n, 12).getTime());
}

function longestStreak(days) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...days].sort()) {
    run = prev !== null && shiftDay(d, 1) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

function currentStreak(days, today) {
  let day = days.has(today) ? today : shiftDay(today, 1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = shiftDay(day, 1);
  }
  return streak;
}

export function rankFor(solved) {
  let current = RANKS[0];
  let next = null;
  RANKS.forEach((r, i) => {
    if (solved >= r[0]) {
      current = r;
      next = RANKS[i + 1] ?? null;
    }
  });
  return {
    title: current[1],
    level: RANKS.indexOf(current) + 1,
    floor: current[0],
    next_title: next ? next[1] : null,
    next_at: next ? next[0] : null,
  };
}

function achievement(key, title, detail, icon, goal, value, tier = 'bronze') {
  const reward = REWARDS[key];
  return {
    key, title, detail, icon, tier, goal,
    value: Math.min(value, goal),
    earned: value >= goal,
    reward: reward ? { kind: reward[0], item: reward[1] } : null,
  };
}

/** Achievements of the Learn section, from finished lessons ({id: stars}) and best drill scores ({id: score}). */
function learnAchievements(done = {}, drills = {}) {
  const finished = (ids) => ids.filter((id) => done[id]).length;
  const unit = (id) => UNITS.find((u) => u.id === id).lessons.map((l) => l.id);
  const all = LESSONS.map((l) => l.id);
  const mates = [...unit('mate'), ...unit('endgame')];
  const perfect = all.filter((id) => done[id] === 3).length;
  const drillsAtFive = DRILL_IDS.filter((id) => (drills[id] ?? 0) >= 5).length;
  return [
    achievement('first_lesson', 'First Lesson', 'Finish your first lesson in Learn', 'book', 1, finished(all)),
    achievement('piece_mover', 'Piece Mover', 'Finish the unit How the pieces move', 'knight', unit('pieces').length, finished(unit('pieces'))),
    achievement('rule_book', 'Rule Book', 'Finish the unit Special rules', 'shield', unit('rules').length, finished(unit('rules'))),
    achievement('checkmater', 'Checkmater', 'Finish the units Checkmate and Basic mates', 'crown', mates.length, finished(mates), 'silver'),
    achievement('coord_pro', 'Coordinate Pro', 'Find 20 squares in one Coordinates drill', 'crosshair', 20, drills.coords ?? 0, 'silver'),
    achievement('knight_rider', 'Knight Rider', 'Score 10 of 10 in Knight routes', 'knight', 10, drills.knight ?? 0, 'silver'),
    achievement('mate_spotter', 'Mate Spotter', 'Score 10 of 10 in Mate in one', 'target', 10, drills.mate1 ?? 0, 'silver'),
    achievement('all_rounder', 'All-Rounder', 'Score at least 5 in every practice drill', 'spark', DRILL_IDS.length, drillsAtFive, 'silver'),
    achievement('graduate', 'Graduate', 'Finish every lesson in Learn', 'medal', all.length, finished(all), 'gold'),
    achievement('top_marks', 'Top Marks', 'Earn three stars in every lesson', 'star', all.length, perfect, 'gold'),
  ].map((a) => ({ ...a, group: 'learn' }));
}

/** Achievements of the opening trainer, from {line id: [streak, due, runs, mastered, ever clean]}. */
function openingAchievements(lines = {}) {
  const everClean = (l) => Boolean(lines[l.id]?.[4]);
  const clean = OPENING_LINES.filter(everClean).length;
  const mastered = OPENING_LINES.filter((l) => lines[l.id]?.[3]);
  const real = mastered.filter((l) => l.opening.kind === 'opening');
  const sides = new Set(real.map((l) => l.opening.side)).size;
  const traps = OPENING_LINES.filter((l) => l.opening.kind === 'trap');
  const trapsClean = traps.filter(everClean).length;
  return [
    achievement('first_line', 'Opening Student', 'Play an opening line without a mistake', 'book', 1, clean),
    achievement('line_master', 'Line Master', 'Master 5 opening lines (three clean runs each)', 'layers', 5, mastered.length, 'silver'),
    achievement('both_sides', 'Both Sides', 'Master an opening line with White and one with Black', 'shield', 2, sides, 'silver'),
    achievement('trap_setter', 'Trap Setter', 'Play every opening trap without a mistake', 'crosshair', traps.length, trapsClean, 'silver'),
    achievement('repertoire', 'Repertoire', 'Master 20 opening lines', 'crown', 20, real.length, 'gold'),
  ].map((a) => ({ ...a, group: 'openings' }));
}

export function computeProgress(catalog, attempts, now = Date.now(), learn = {}) {
  const levelTotals = {};
  for (const p of catalog.puzzles) levelTotals[p.difficulty] = (levelTotals[p.difficulty] ?? 0) + 1;

  const last = new Map();
  const failedBefore = new Set();
  let comebacks = 0; let fast = 0; let lightning = 0; let cleanRun = 0; let bestCleanRun = 0;
  let fastest = null;
  const perDay = new Map();
  for (const [pid, solved, , timeMs, at] of attempts) {
    if (solved) {
      if (failedBefore.has(pid)) comebacks += 1;
      if (timeMs) {
        if (timeMs <= FAST_MS) fast += 1;
        if (timeMs <= LIGHTNING_MS) lightning += 1;
        if (fastest === null || timeMs < fastest.time_ms) fastest = { puzzle_id: pid, time_ms: timeMs };
      }
      cleanRun += 1;
      bestCleanRun = Math.max(bestCleanRun, cleanRun);
    } else {
      failedBefore.add(pid);
      cleanRun = 0;
    }
    last.set(pid, Boolean(solved));
    const day = dayKey(at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const solvedIds = [...last].filter(([pid, ok]) => ok && catalog.byId.has(pid)).map(([pid]) => catalog.byId.get(pid));
  const solved = solvedIds.length;
  const mates = solvedIds.filter((p) => p.mates).length;
  const deep = solvedIds.filter((p) => p.solverMoves >= LONG_LINE).length;
  const advancedSolved = solvedIds.filter((p) => p.difficulty === 'advanced').length;
  const tried = {};
  for (const pid of last.keys()) {
    const level = catalog.byId.get(pid)?.difficulty;
    tried[level] = (tried[level] ?? 0) + 1;
  }

  const days = new Set(perDay.keys());
  let bestDay = null;
  for (const [date, count] of perDay) {
    if (!bestDay || count > bestDay[1] || (count === bestDay[1] && date > bestDay[0])) bestDay = [date, count];
  }
  const total = catalog.puzzles.length;
  const streakBest = longestStreak(days);

  const achievements = [
    // solving
    achievement('first', 'First Step', 'Solve your first puzzle', 'flag', 1, solved),
    achievement('warm_up', 'Warm-Up', 'Solve 5 puzzles', 'sun', 5, solved),
    achievement('ten', 'Ten Down', 'Solve 10 puzzles', 'target', 10, solved),
    achievement('fifty', 'Fifty Strong', 'Solve 50 puzzles', 'layers', 50, solved, 'silver'),
    achievement('hundred', 'Centurion', 'Solve 100 puzzles', 'crown', 100, solved, 'gold'),
    achievement('five_hundred', 'Five Hundred', 'Solve 500 puzzles', 'medal', 500, solved, 'gold'),
    // habits
    achievement('hat_trick', 'Hat Trick', 'Train 3 days in a row', 'spark', 3, streakBest),
    achievement('busy_day', 'Marathon Day', 'Make 30 attempts in one day', 'clock', 30, bestDay ? bestDay[1] : 0, 'silver'),
    achievement('week', 'Seven-Day Streak', 'Train 7 days in a row', 'calendar', 7, streakBest, 'silver'),
    achievement('month', 'Thirty-Day Streak', 'Train 30 days in a row', 'mountain', 30, streakBest, 'gold'),
    // skill
    achievement('hot_hand', 'Hot Hand', 'Solve 5 puzzles in a row without a mistake', 'flame', 5, bestCleanRun),
    achievement('lightning', 'Lightning', 'Solve a puzzle in under 5 seconds', 'hourglass', 1, lightning),
    achievement('bounce_back', 'Bounce Back', 'Solve 3 puzzles you once got wrong', 'retry', 3, comebacks),
    achievement('mate_hunter', 'Mate Hunter', 'Solve 25 puzzles that end in checkmate', 'crosshair', 25, mates, 'silver'),
    achievement('deep', 'Deep Calculation', `Solve 10 puzzles with a line of ${LONG_LINE}+ moves`, 'compass', 10, deep, 'silver'),
    achievement('sharp_eye', 'Sharp Eye', 'Solve 25 advanced puzzles', 'eye', 25, advancedSolved, 'silver'),
    achievement('clean', 'Flawless Run', 'Solve 20 puzzles in a row without a mistake', 'shield', 20, bestCleanRun, 'silver'),
    achievement('fast', 'Quick Sight', 'Solve 10 puzzles in under 10 seconds each', 'bolt', 10, fast, 'silver'),
    achievement('comeback', 'Never Give Up', 'Solve 10 puzzles you once got wrong', 'repeat', 10, comebacks, 'silver'),
    // the books
    achievement('easy_done', 'Easy Cleared', 'Try every easy puzzle in both books', 'pawn', levelTotals.easy ?? 0, tried.easy ?? 0, 'silver'),
    achievement('mid_done', 'Intermediate Cleared', 'Try every intermediate puzzle in both books', 'knight',
      levelTotals.intermediate ?? 0, tried.intermediate ?? 0, 'gold'),
    achievement('adv_done', 'Advanced Cleared', 'Try every advanced puzzle in both books', 'king',
      levelTotals.advanced ?? 0, tried.advanced ?? 0, 'gold'),
    achievement('book', 'Cover to Cover', 'Try every puzzle in both books', 'book', total, last.size, 'gold'),
    ...learnAchievements(learn.done, learn.drills),
    ...openingAchievements(learn.openings),
  ];

  const solvedAttempts = attempts.filter((a) => a[1]).length;
  return {
    solved,
    attempted: last.size,
    total,
    attempts: attempts.length,
    accuracy: attempts.length ? Math.round((100 * solvedAttempts) / attempts.length) : null,
    streak_days: currentStreak(days, dayKey(now)),
    best_streak: streakBest,
    rank: rankFor(solved),
    achievements,
    unlocked: achievements.filter((a) => a.earned && REWARDS[a.key]).map((a) => `${REWARDS[a.key][0]}:${REWARDS[a.key][1]}`).sort(),
    records: {
      fastest,
      best_clean_run: bestCleanRun,
      best_day: bestDay ? { date: bestDay[0], attempts: bestDay[1] } : null,
      best_streak: streakBest,
    },
  };
}
