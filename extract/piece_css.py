"""Build static/css/pieces.css: the cburnett pieces plus the extra piece sets.

Each piece exposes its image as --pc so a set can swap it (a new shape) or use it as a mask
(a new material). Pieces show up in three places: .pc-xx figurines, avatars and chessground boards.

    python -m extract.piece_css
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "css" / "pieces.css"
NAMES = {"p": "pawn", "n": "knight", "b": "bishop", "r": "rook", "q": "queen", "k": "king"}
COLORS = {"w": "white", "b": "black"}


def selectors(code: str) -> str:
    color, piece = code
    return f".pc-{code}, .cg-wrap piece.{NAMES[piece]}.{COLORS[color]}"


def uri(svg: str) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ---------------------------------------------------------------- Bauhaus: flat geometric shapes
BASE = '<rect x="10.5" y="34" width="24" height="5" rx="1.5"/>'
BAUHAUS = {
    "p": '<path d="M17 34 22.5 21 28 34z"/><circle cx="22.5" cy="16" r="5.5"/>',
    "r": '<path d="M15 34V19h15v15z"/><path d="M13 19v-9h4.5v3.5h3V10h4v3.5h3V10H32v9z"/>'
         '<path d="M15 24h15" stroke="{d}"/>',
    "b": '<path d="M22.5 9c5.5 5 8 10 8 15 0 6-3.5 10-8 10s-8-4-8-10c0-5 2.5-10 8-15z"/>'
         '<circle cx="22.5" cy="7" r="2.3"/><path d="M19.5 23l6-6" stroke="{d}" stroke-width="2.2"/>',
    "n": '<path d="M14.5 34l2-9-5.5-1.5-.5-4.5 7-7.5 1.5-5 3.5 3.5c7 1 10.5 6.5 10 14L31 34z"/>'
         '<circle cx="18.5" cy="15.5" r="1.5" fill="{d}" stroke="none"/>'
         '<path d="M26 12.5c3.5 3.5 4.5 7.5 3.5 14.5" fill="none" stroke="{d}"/>',
    "q": '<path d="M16 34l2.5-14h8L29 34z"/><path d="M14 20l1.5-8 4 4.5 3-7 3 7 4-4.5 1.5 8z"/>'
         '<circle cx="15.5" cy="10.5" r="2"/><circle cx="22.5" cy="7.5" r="2"/><circle cx="29.5" cy="10.5" r="2"/>',
    "k": '<path d="M16 34l2-15h9l2 15z"/><rect x="15" y="15" width="15" height="4.5" rx="1"/>'
         '<path d="M21 3.5h3V7h3.5v3H24v5h-3v-5h-3.5V7H21z"/><path d="M19 26.5h7" stroke="{d}"/>',
}
BAUHAUS_STYLE = {"w": ("#f6f3ea", "#1b1b1d", "#1b1b1d"), "b": ("#2a2c31", "#0d0d0f", "#e9e4d8")}


def bauhaus_svg(color: str, piece: str) -> str:
    fill, stroke, detail = BAUHAUS_STYLE[color]
    body = BAUHAUS[piece].replace("{d}", detail)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 45 45">'
            f'<g fill="{fill}" stroke="{stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">'
            f'{body}{BASE}</g></svg>')


# ---------------------------------------------------------------- materials: gradient bodies masked by the piece
# (light body, dark body). The original drawing is blended back on top to keep its detail lines.
MATERIALS = {
    "ice": ("linear-gradient(160deg, #ffffff 0%, #d9f2ff 38%, #93d0f2 72%, #5aa9d8 100%)",
            "linear-gradient(160deg, #4b86ad 0%, #1d4a6d 55%, #0c2236 100%)"),
    "jade": ("linear-gradient(160deg, #f0fcf3 0%, #a6e2bc 40%, #4fb37f 75%, #2a8a58 100%)",
             "linear-gradient(160deg, #2f8a5e 0%, #155a3a 55%, #07301d 100%)"),
    "ruby": ("linear-gradient(160deg, #fff0f2 0%, #f7a3b1 38%, #e0445f 72%, #a8193a 100%)",
             "linear-gradient(160deg, #b0223f 0%, #6e0c22 55%, #34040f 100%)"),
    "gilded": ("linear-gradient(135deg, #fff8d6 0%, #f4d676 30%, #d9a93a 55%, #fbe7a1 70%, #a8761c 100%)",
               "linear-gradient(135deg, #8a6420 0%, #4f370b 50%, #2a1c04 100%)"),
    "marble": ("linear-gradient(118deg, transparent 38%, rgba(110, 110, 125, .38) 40%, transparent 43%, transparent 62%,"
               " rgba(110, 110, 125, .25) 63.5%, transparent 66%), linear-gradient(160deg, #ffffff, #e9e6df 60%, #cfcac0)",
               "linear-gradient(118deg, transparent 38%, rgba(235, 235, 245, .35) 40%, transparent 43%, transparent 62%,"
               " rgba(235, 235, 245, .22) 63.5%, transparent 66%), linear-gradient(160deg, #4a4a52, #26262b 60%, #121215)"),
}


def material_rules(name: str, light: str, dark: str) -> str:
    av = f".set-{name} .piece-img"
    cg = f'html[data-pieces="{name}"] .cg-wrap piece'
    return f"""
/* {name} */
{av}, {cg} {{
  -webkit-mask: var(--pc) center / 100% 100% no-repeat; mask: var(--pc) center / 100% 100% no-repeat;
}}
{av}[class*="pc-w"], {cg}.white {{ background-image: {light}; }}
{av}[class*="pc-b"], {cg}.black {{ background-image: {dark}; }}
{av}::after, {cg}::after {{
  content: ''; position: absolute; inset: 0; background: var(--pc) center / 100% 100% no-repeat; mix-blend-mode: multiply;
}}
{av}[class*="pc-b"]::after, {cg}.black::after {{ mix-blend-mode: screen; opacity: .8; }}
"""


def main() -> None:
    src = (ROOT / "static" / "vendor" / "chessground.cburnett.css").read_text(encoding="utf-8")
    classic = {}
    for piece_name, color_name, url in re.findall(r"\.cg-wrap piece\.(\w+)\.(\w+) \{\s*background-image: url\('([^']+)'\)", src):
        code = {v: k for k, v in COLORS.items()}[color_name] + {v: k for k, v in NAMES.items()}[piece_name]
        classic[code] = url
    assert len(classic) == 12, classic.keys()

    out = ["/* Generated by extract/piece_css.py. Piece images: cburnett (from chessground, GPLv2+) and the",
           "   Bauhaus set drawn for this site. Every piece exposes its image as --pc. */"]
    for code, url in classic.items():
        out.append(f"{selectors(code)} {{ --pc: url('{url}'); }}")
    out.append(", ".join(f".pc-{c}" for c in classic) + ", .cg-wrap piece { background-image: var(--pc); }")
    out.append(".piece-img { position: relative; }")

    out.append("\n/* Bauhaus: a different shape for every piece */")
    for code in classic:
        color, piece = code
        out.append(f'.set-bauhaus .pc-{code}, html[data-pieces="bauhaus"] .cg-wrap piece.{NAMES[piece]}.{COLORS[color]} '
                   f"{{ --pc: url('{uri(bauhaus_svg(color, piece))}'); }}")

    out.append("\n/* Neon: the classic drawing with a glow */")
    out.append('.set-neon .piece-img[class*="pc-w"], html[data-pieces="neon"] .cg-wrap piece.white '
               "{ filter: drop-shadow(0 0 1px #6ff) drop-shadow(0 0 3px #1ce0f0); }")
    out.append('.set-neon .piece-img[class*="pc-b"], html[data-pieces="neon"] .cg-wrap piece.black '
               "{ filter: drop-shadow(0 0 1px #f7c) drop-shadow(0 0 3px #f03fa8); }")

    for name, (light, dark) in MATERIALS.items():
        out.append(material_rules(name, light, dark))
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
