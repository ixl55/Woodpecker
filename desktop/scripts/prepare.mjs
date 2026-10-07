// Build the app's read-only data from the website project:
//   resources/puzzles.json  both books in one compact file (only the fields the app reads), with explanations
//   renderer/fonts/*.woff2  the three interface fonts (Latin, variable weight), so nothing loads from the internet
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const project = path.resolve(desktop, '..');

const FIELDS = ['id', 'book', 'number', 'difficulty', 'fen', 'moves', 'san', 'white', 'black', 'event', 'year', 'line', 'themes'];

function readBook(file) {
  return JSON.parse(fs.readFileSync(path.join(project, 'data', file), 'utf8'));
}

// the move-by-move explanations (python -m app.explain), stored compactly: theme keys only (the interface
// knows their names) and each step as [san, 1 for your move / 0 for the reply, ...notes]
const explanations = JSON.parse(fs.readFileSync(path.join(project, 'data', 'explanations.json'), 'utf8'));
const compact = (e) => e && {
  summary: e.summary,
  result: e.result,
  ideas: e.ideas.map((i) => i.key),
  facts: e.facts ?? [],
  steps: e.steps.map((st) => [st.san, st.side === 'solver' ? 1 : 0, ...st.notes]),
};

const puzzles = [...readBook('puzzles.json'), ...readBook('puzzles2.json')]
  .map((p) => ({
    ...Object.fromEntries(FIELDS.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]])),
    explain: compact(explanations[p.id]),
  }))
  .sort((a, b) => a.id - b.id);
fs.mkdirSync(path.join(desktop, 'resources'), { recursive: true });
fs.writeFileSync(path.join(desktop, 'resources', 'puzzles.json'), JSON.stringify(puzzles));

const FONTS = [
  ['figtree', 'figtree-latin-wght-normal.woff2'],
  ['bricolage-grotesque', 'bricolage-grotesque-latin-standard-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
];
const fontDir = path.join(desktop, 'renderer', 'fonts');
fs.mkdirSync(fontDir, { recursive: true });
for (const [pkg, file] of FONTS) {
  fs.copyFileSync(path.join(desktop, 'node_modules', '@fontsource-variable', pkg, 'files', file), path.join(fontDir, file));
}

console.log(`prepared ${puzzles.length} puzzles and ${FONTS.length} fonts`);
