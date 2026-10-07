import uuid

import pytest
from fastapi.testclient import TestClient

from app.security import client_ip, password_problems

PASSWORD = "Secret-pass-42"  # the one conftest registers every player with


def new_name() -> str:
    return "s" + uuid.uuid4().hex[:10]


@pytest.mark.parametrize("password, fragment", [
    ("Short-1a", "at least 10 characters"),
    ("alllowercase-42", "an uppercase letter"),
    ("ALLUPPERCASE-42", "a lowercase letter"),
    ("No-Digits-Here", "a number"),
    ("NoSymbols12345", "a symbol"),
])
def test_weak_passwords_are_rejected_with_the_reason(client, password, fragment):
    r = client.post("/api/auth/register", json={"username": new_name(), "password": password})
    assert r.status_code == 400 and fragment in r.json()["detail"]


def test_password_rules_beyond_character_classes(client):
    name = new_name()
    r = client.post("/api/auth/register", json={"username": name, "password": f"X-{name}-99"})
    assert r.status_code == 400 and "username" in r.json()["detail"]
    r = client.post("/api/auth/register", json={"username": new_name(), "password": "Password123!"})
    assert r.status_code == 400 and "common" in r.json()["detail"]
    r = client.post("/api/auth/register", json={"username": new_name(), "password": "Aa1!" + "a" * 200})
    assert r.status_code == 422  # longer than the 128-character cap
    assert password_problems(PASSWORD) == []


def test_login_locks_the_account_after_five_failures(client, user):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": user, "password": "Wrong-pass-00"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": user, "password": PASSWORD})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert "sign-in attempts" in r.json()["detail"]


def test_lockout_is_per_account_and_success_resets_it(client, make_player):
    other = make_player().user["username"]
    for _ in range(4):
        client.post("/api/auth/login", json={"username": other, "password": "Wrong-pass-00"})
    assert client.post("/api/auth/login", json={"username": other, "password": PASSWORD}).status_code == 200
    for _ in range(4):  # the counter started over after the successful sign-in
        assert client.post("/api/auth/login", json={"username": other, "password": "Wrong-pass-00"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": other, "password": PASSWORD}).status_code == 200


def test_unknown_usernames_count_too(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "ghost-user", "password": "Wrong-pass-00"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "ghost-user", "password": "Wrong-pass-00"}).status_code == 429


def test_signup_is_limited_per_address(client):
    codes = [client.post("/api/auth/register", json={"username": new_name(), "password": PASSWORD}).status_code
             for _ in range(6)]
    assert codes == [200] * 5 + [429]


def test_spoofed_forwarded_for_does_not_change_the_address():
    class Req:
        def __init__(self, xff):
            self.headers = {"x-forwarded-for": xff}
            self.client = None
    # the attacker controls everything left of what our proxy appended
    assert client_ip(Req("1.2.3.4, 203.0.113.9")) == "203.0.113.9"
    assert client_ip(Req("9.9.9.9, 203.0.113.9")) == "203.0.113.9"


def test_security_headers(client):
    h = client.get("/").headers
    assert "script-src 'self' 'sha256-" in h["content-security-policy"]
    assert "frame-ancestors 'none'" in h["content-security-policy"]
    assert h["x-frame-options"] == "DENY" and h["x-content-type-options"] == "nosniff"
    assert client.get("/healthz").headers["referrer-policy"] == "same-origin"
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"
    assert client.get("/openapi.json").status_code == 404


def test_cross_site_writes_and_huge_bodies_are_refused(client, user):
    r = client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/auth/me").status_code == 200  # still signed in
    assert client.post("/api/auth/logout", headers={"Origin": "http://testserver"}).status_code == 200
    r = client.post("/api/auth/login", content="x" * 40_000, headers={"Content-Type": "application/json"})
    assert r.status_code == 413


def test_password_change_signs_out_other_devices(client, user):
    from app.main import app
    other = TestClient(app)
    assert other.post("/api/auth/login", json={"username": user, "password": PASSWORD}).status_code == 200
    r = client.post("/api/auth/password", json={"current_password": "Wrong-pass-00", "new_password": "Brand-new-77"})
    assert r.status_code == 400
    r = client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "weak"})
    assert r.status_code == 400
    r = client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "Brand-new-77"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # this device stays in
    assert other.get("/api/auth/me").status_code == 401  # the other one is out
    assert other.post("/api/auth/login", json={"username": user, "password": PASSWORD}).status_code == 401
    assert other.post("/api/auth/login", json={"username": user, "password": "Brand-new-77"}).status_code == 200


def test_friend_and_challenge_inputs_are_bounded(friends):
    a, b = friends
    assert a.post("/api/friends/requests", json={"username": "x" * 500}).status_code == 422
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async", "count": 5}).json()["id"]
    assert b.post(f"/api/challenges/{cid}/move", json={"uci": "e2e4" * 100}).status_code == 422


def test_open_invitations_are_capped(friends):
    a, b = friends
    codes = [a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "async", "count": 5}).status_code
             for _ in range(11)]
    assert codes == [200] * 10 + [429]


def test_websocket_from_another_site_is_refused(friends):
    from starlette.websockets import WebSocketDisconnect
    a, b = friends
    cid = a.post("/api/challenges", json={"opponent_id": b.user["id"], "mode": "live", "minutes": 3}).json()["id"]
    with pytest.raises(WebSocketDisconnect) as exc:
        with a.websocket_connect(f"/ws/challenges/{cid}", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_json()
    assert exc.value.code == 4403


# ---------------------------------------------------------------- remember me (30 days after the last visit)
DAY = 24 * 60 * 60


def _travel(monkeypatch, seconds):
    """Move the clock forward for the app and the cookie signer alike."""
    import time
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() + seconds)


def test_sign_in_cookie_lasts_thirty_days(client):
    r = client.post("/api/auth/register", json={"username": new_name(), "password": PASSWORD})
    assert "Max-Age=2592000" in r.headers["set-cookie"]


def test_a_visit_renews_the_thirty_days(client, user, monkeypatch):
    _travel(monkeypatch, 20 * DAY)
    r = client.get("/api/auth/me")
    assert r.status_code == 200 and "Max-Age=2592000" in r.headers["set-cookie"]  # renewed on this visit
    monkeypatch.undo()
    _travel(monkeypatch, 45 * DAY)  # 45 days after sign-in, but only 25 after the last visit
    assert client.get("/api/auth/me").status_code == 200


def test_frequent_requests_do_not_rewrite_the_cookie(client, user):
    assert "set-cookie" not in client.get("/api/auth/me").headers  # renewed at most once an hour


def test_more_than_thirty_days_away_means_signing_in_again(client, user, monkeypatch):
    _travel(monkeypatch, 31 * DAY)
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"username": user, "password": PASSWORD}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_static_files_are_versioned_cached_and_compressed(client):
    import re
    page = client.get("/")
    assert page.headers["cache-control"] == "no-cache"
    script = re.search(r'src="(/static/[0-9a-f]{12}/js/app\.js)"', page.text).group(1)
    r = client.get(script, headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and r.headers["content-encoding"] == "gzip"
    assert "immutable" in r.headers["cache-control"]
    # modules import each other relatively, so they stay under the same version
    assert "'/static/" not in r.text
    assert client.get("/static/js/app.js").headers["cache-control"] == "no-cache"
