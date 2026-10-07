# Woodpecker

A chess puzzle trainer built on the two *Woodpecker Method* books by Axel Smith and Hans Tikkanen: 1,127 tactics and 1,000 positional exercises. Solve them in order, and anything you miss comes back for review (Leitner boxes) until it sticks.

It comes in two forms:

- **Website**: FastAPI with accounts, statistics, friends, challenges, live duels and Sprint.
- **Windows desktop app**: Electron, fully offline. It adds lessons for beginners, practice drills, an opening trainer and custom themes.

Solutions are moves only. The books' commentary is never included.

## Project layout

| Folder | What it holds |
|---|---|
| `app/` | FastAPI + SQLAlchemy server (SQLite locally, PostgreSQL in production) |
| `static/` | Website front end (plain HTML/JS, no build step) |
| `desktop/` | Electron desktop app |
| `extract/` | One-off tools that extract the puzzles from the book PDFs |
| `data/` | The extracted puzzles, the reviewed book 2 themes and the generated explanations |
| `tests/` | Server tests (pytest) |

## Run the website

```bash
pip install -r requirements-dev.txt
```

```bash
python -m uvicorn app.main:app --reload
```

Then open http://localhost:8000. The database is created in `data/app.db` on first start.

## Run the desktop app

```bash
cd desktop
npm install
npm start
```

Build the Windows installer (`desktop/dist/Woodpecker-Setup-<version>.exe`):

```bash
npm run dist
```

## Features

- **Puzzles**: both books in order, by level, by theme, or as a review of missed ones.
- **Themes**: every tactic is detected from the solution line with python-chess (`app/themes.py`) and only counts when the line proves it. Book 2 uses a hand-reviewed classification (`data/themes2.json`).
- **Explain the idea**: once a puzzle is finished, a move-by-move explanation built from facts computed on the board (`app/explain.py`).
- **Progress**: statistics, ranks, achievements and cosmetic rewards for the avatar.
- **Sprint, challenges and duels** (website): the server checks every move, so results can't be faked.

Desktop app only:

- **Learn**: 32 lessons from the board to first tactics, and 7 randomly generated drills.
- **Openings**: 19 openings, 14 traps and 57 lines, with Learn and Practice modes and spaced review.
- **Themes**: 8 light and 8 dark shades, plus a fully custom theme that is checked for readable contrast.

## Tests

```bash
python -m pytest -q
```

```bash
cd desktop && npm test
```

## Re-extracting from the books (optional)

```bash
python -m extract.build
```

```bash
python -m extract.book2
```

Set the PDF paths with `WOODPECKER_PDF` and `WOODPECKER2_PDF`. The PDFs are not part of this repository.

## Deployment

`render.yaml` deploys the website to Render with a Neon PostgreSQL database; a `Dockerfile` is included for other hosts. Run a single process: the live duel hub and the rate limits are kept in memory.

## Note

The puzzles come from commercial books. Keep any deployment for personal use.
