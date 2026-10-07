"""Shared constants for the PDF extraction pipeline."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PDF_PATH = Path(os.environ.get(
    "WOODPECKER_PDF",
    r"C:\Users\AL-SERAJ\Desktop\chess\The-Woodpecker-Method-by-Axel-Smith-Hans-Tikkanen.pdf",
))

# 0-based PDF page indexes (the TOC uses 1-based numbers: 32, 70, 198, 224, 381)
EXERCISE_PAGES = range(31, 223)
SOLUTION_PAGES = range(223, 380)


def difficulty_for_page(page_index: int) -> str:
    page_no = page_index + 1
    if page_no < 70:
        return "easy"
    if page_no < 198:
        return "intermediate"
    return "advanced"


def plain(text: str) -> str:
    """Symbol fonts put glyphs in the U+F0xx private range; map them back to ASCII."""
    return "".join(chr(ord(c) - 0xF000) if 0xF000 <= ord(c) <= 0xF0FF else c for c in text)
