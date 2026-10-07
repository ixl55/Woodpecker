from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import progress
from ..auth import current_user
from ..db import get_db
from ..models import Profile, User

router = APIRouter(prefix="/api/profile", tags=["profile"])

Piece = Literal["k", "q", "r", "b", "n", "p"]
PieceColor = Literal["w", "b"]
# the last items of each list are rewards: progress.REWARDS says which achievement unlocks them
Background = Literal["ink", "emerald", "olive", "walnut", "wine", "plum", "slate", "sand", "teal", "crimson", "charcoal",
                     "sky", "meadow", "ocean", "sunset", "aurora", "nebula", "volcano"]
Pattern = Literal["plain", "checker", "diagonal", "rings", "dots", "grid", "zigzag", "sunburst", "scales", "argyle",
                  "stars", "knights"]
Frame = Literal["none", "ring", "double", "dashed", "bronze", "silver", "gold", "laurel", "ember", "frost", "aurora",
                "royal", "prism"]
PieceSet = Literal["classic", "bauhaus", "ice", "jade", "neon", "ruby", "gilded", "marble"]
BoardTheme = Literal["slate", "walnut", "olive", "marble", "sand"]
ThemeMode = Literal["system", "light", "dark"]
LightPalette = Literal["porcelain", "parchment", "mist", "sage"]
DarkPalette = Literal["midnight", "obsidian", "graphite", "espresso"]
Accent = Literal["cobalt", "emerald", "amber", "violet", "teal", "rose"]


def get_or_create(db: Session, user: User) -> Profile:
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


def profile_out(user: User, p: Profile) -> dict:
    return {
        "username": user.username,
        "display_name": p.display_name or user.username,
        "bio": p.bio,
        "avatar": {"piece": p.avatar_piece, "color": p.avatar_color, "bg": p.avatar_bg,
                   "pattern": p.avatar_pattern, "frame": p.frame, "set": p.piece_set or "classic"},
        "board_theme": p.board_theme,
        "appearance": {"mode": p.theme_mode or "system", "light": p.light_palette or "porcelain",
                       "dark": p.dark_palette or "midnight", "accent": p.accent or "cobalt"},
        "joined": user.created_at.date().isoformat(),
    }


class ProfileIn(BaseModel):
    display_name: str = Field("", max_length=40)
    bio: str = Field("", max_length=160)
    avatar_piece: Piece = "n"
    avatar_color: PieceColor = "w"
    avatar_bg: Background = "ink"
    avatar_pattern: Pattern = "plain"
    frame: Frame = "none"
    piece_set: PieceSet = "classic"
    board_theme: BoardTheme = "slate"
    theme_mode: ThemeMode = "system"
    light_palette: LightPalette = "porcelain"
    dark_palette: DarkPalette = "midnight"
    accent: Accent = "cobalt"

    @field_validator("display_name", "bio")
    @classmethod
    def strip(cls, v: str) -> str:
        return " ".join(v.split())


class AppearanceIn(BaseModel):
    theme_mode: ThemeMode


@router.get("")
def read_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_or_create(db, user)
    return {**profile_out(user, p), "progress": progress.compute(db, user.id)}


@router.put("")
def update_profile(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_or_create(db, user)
    # locked cosmetics need their achievement; whatever is already equipped stays allowed
    wanted = {"bg": (body.avatar_bg, p.avatar_bg), "pattern": (body.avatar_pattern, p.avatar_pattern),
              "frame": (body.frame, p.frame), "pieces": (body.piece_set, p.piece_set)}
    unlocked = None
    for kind, (new, current) in wanted.items():
        key = progress.LOCKED.get((kind, new))
        if key is None or new == current:
            continue
        if unlocked is None:
            g = progress.compute(db, user.id)
            unlocked, titles = set(g["unlocked"]), {a["key"]: a["title"] for a in g["achievements"]}
        if f"{kind}:{new}" not in unlocked:
            noun = {"bg": "background", "pattern": "pattern", "frame": "frame", "pieces": "piece style"}[kind]
            raise HTTPException(403, f"Earn the “{titles[key]}” achievement to unlock the {new.title()} {noun}.")
    for field, value in body.model_dump().items():
        setattr(p, field, value)
    db.commit()
    return profile_out(user, p)


@router.patch("/appearance")
def update_mode(body: AppearanceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Quick light/dark switch from the header without resending the whole profile."""
    p = get_or_create(db, user)
    p.theme_mode = body.theme_mode
    db.commit()
    return profile_out(user, p)
