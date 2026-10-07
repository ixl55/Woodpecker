import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp) / 'test.db'}"
os.environ["SECRET_KEY"] = "test"
PASSWORD = "Secret-pass-42"


@pytest.fixture(autouse=True)
def fresh_limits():
    """Every test starts with empty rate-limit counters (they all share one client address)."""
    from app.security import limiter
    limiter.clear()
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def user(client):
    import uuid
    name = "u" + uuid.uuid4().hex[:10]
    r = client.post("/api/auth/register", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return name


@pytest.fixture
def make_player():
    """Factory: a fresh signed-in TestClient per call (separate cookie jars = separate users)."""
    import uuid

    from fastapi.testclient import TestClient

    from app.main import app
    clients = []

    def factory():
        from app.security import limiter
        limiter.clear()  # many sign-ups from one test address; the sign-up limit has its own test
        c = TestClient(app)
        c.__enter__()
        name = "p" + uuid.uuid4().hex[:10]
        r = c.post("/api/auth/register", json={"username": name, "password": PASSWORD})
        assert r.status_code == 200, r.text
        c.user = r.json()
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def friends(make_player):
    """Two players who are already friends."""
    a, b = make_player(), make_player()
    assert a.post("/api/friends/requests", json={"username": b.user["username"]}).json()["status"] == "pending"
    rid = b.get("/api/friends").json()["incoming"][0]["request_id"]
    assert b.post(f"/api/friends/requests/{rid}/accept").status_code == 200
    return a, b
