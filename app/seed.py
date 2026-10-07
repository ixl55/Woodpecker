"""Load both books into the puzzles table (insert new ids, update changed ones).

data/puzzles.json is book 1 (tactics, extract.build); data/puzzles2.json is book 2 (positional, extract.book2).
"""
import json

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from . import catalog
from .db import ROOT, Base, SessionLocal, engine
from .models import Puzzle
from .themes import detect_themes

PUZZLES_JSON = ROOT / "data" / "puzzles.json"
PUZZLES2_JSON = ROOT / "data" / "puzzles2.json"
FIELDS = ("difficulty", "fen", "moves", "san", "white", "black", "event", "year", "line")
_theme_cache: dict[tuple, str] = {}


def themes_for(item: dict) -> str:
    """',fork,pin,' for a puzzle; puzzles.json may carry them already (python -m app.themes)."""
    key = (item["fen"], tuple(item["moves"]))
    if key not in _theme_cache:
        tags = item["themes"] if "themes" in item else detect_themes(item["fen"], item["moves"])
        _theme_cache[key] = f",{','.join(tags)}," if tags else ""
    return _theme_cache[key]


def load_books() -> list[dict]:
    data = json.loads(PUZZLES_JSON.read_text(encoding="utf-8"))
    if PUZZLES2_JSON.exists():
        data += json.loads(PUZZLES2_JSON.read_text(encoding="utf-8"))
    return data


def seed(db: Session) -> int:
    existing = {p.id: p for p in db.query(Puzzle).all()}
    changed = 0
    for item in load_books():
        row = existing.get(item["id"])
        values = {k: item.get(k) for k in FIELDS} | {
            "themes": themes_for(item), "book": item.get("book", 1), "number": item.get("number", item["id"])}
        if row is None:
            db.add(Puzzle(id=item["id"], **values))
            changed += 1
        elif any(getattr(row, k) != v for k, v in values.items()):
            for k, v in values.items():
                setattr(row, k, v)
            changed += 1
    db.commit()
    catalog.reset()
    return changed


def ensure_columns() -> None:
    """create_all() never alters existing tables; add any model column the database lacks."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                default = column.default.arg if column.default is not None and not callable(column.default.arg) else None
                clause = (f" DEFAULT '{default}'" if isinstance(default, str) else
                          f" DEFAULT {default}" if isinstance(default, int) and not isinstance(default, bool) else "")
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {column.name} {ddl_type}{clause}'))


def init_db() -> None:
    Base.metadata.create_all(engine)
    ensure_columns()
    with SessionLocal() as db:
        seed(db)


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    ensure_columns()
    with SessionLocal() as db:
        print(seed(db), "puzzles inserted/updated")
