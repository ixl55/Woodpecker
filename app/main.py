import hashlib
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .auth import REMEMBER_SECONDS
from .db import ROOT
from .routers import attempts, auth, challenges, friends, profile, puzzles, sprint, stats
from .security import content_security_policy, inline_script_hashes, security_middleware
from .seed import init_db

STATIC = ROOT / "static"


def _static_version() -> str:
    """A fingerprint of every static file. It changes whenever any of them does, so the files can be cached
    for a year under /static/<version>/ while a new deploy is still picked up on the next page load."""
    digest = hashlib.sha256()
    for path in sorted(STATIC.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(STATIC).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


STATIC_VERSION = _static_version()
# the page points at the versioned copies; the modules' relative imports then stay under the same version
INDEX_HTML = (STATIC / "index.html").read_text(encoding="utf-8").replace('"/static/', f'"/static/{STATIC_VERSION}/')


class _Static(StaticFiles):
    """StaticFiles with an explicit Cache-Control: a year for the versioned copies, revalidation otherwise."""

    def __init__(self, cache_control: str, **kwargs):
        super().__init__(**kwargs)
        self.cache_control = cache_control

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = self.cache_control
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


HTTPS_ONLY = os.environ.get("HTTPS_ONLY", "0") == "1"
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if HTTPS_ONLY and len(SECRET_KEY) < 32:
    # production must sign cookies with a stable, long secret; a guessable one lets anyone forge a session
    raise RuntimeError("Set SECRET_KEY to a random value of at least 32 characters before serving over HTTPS.")

app = FastAPI(title="Woodpecker Puzzles", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    SessionMiddleware,
    # locally, without SECRET_KEY, sessions reset on every restart
    secret_key=SECRET_KEY or secrets.token_urlsafe(32),
    session_cookie="wp_session",
    max_age=REMEMBER_SECONDS,  # counted from the last renewal, see app/auth.py
    same_site="lax",
    https_only=HTTPS_ONLY,
)
app.middleware("http")(security_middleware(
    content_security_policy(inline_script_hashes(INDEX_HTML)), HTTPS_ONLY))
# text compresses to about a quarter; WebSockets pass through untouched
app.add_middleware(GZipMiddleware, minimum_size=1024)

for r in (auth.router, puzzles.router, attempts.router, stats.router, profile.router, friends.router, challenges.router,
          sprint.router):
    app.include_router(r)


@app.get("/healthz")
def healthz():
    return {"ok": True}


app.mount(f"/static/{STATIC_VERSION}", _Static("public, max-age=31536000, immutable", directory=STATIC),
          name="static-versioned")
app.mount("/static", _Static("no-cache", directory=STATIC), name="static")


@app.get("/")
def index():
    # always revalidated, so a deploy's new STATIC_VERSION reaches the browser straight away
    return HTMLResponse(INDEX_HTML, headers={"Cache-Control": "no-cache"})
