import re


def test_default_profile(client, user):
    p = client.get("/api/profile").json()
    assert p["display_name"] == user
    assert p["avatar"] == {"piece": "n", "color": "w", "bg": "ink", "pattern": "plain", "frame": "none", "set": "classic"}
    assert p["board_theme"] == "slate"
    assert p["appearance"] == {"mode": "system", "light": "porcelain", "dark": "midnight", "accent": "cobalt"}
    g = p["progress"]
    assert g["rank"]["title"] == "Novice" and g["solved"] == 0
    assert len(g["achievements"]) == 30 and not any(a["earned"] for a in g["achievements"])
    assert g["unlocked"] == []
    assert {a["tier"] for a in g["achievements"]} == {"bronze", "silver", "gold"}


def test_update_profile_and_me(client, user):
    body = {"display_name": "  Tactics   Hunter ", "bio": "Ten puzzles a day", "avatar_piece": "q", "avatar_color": "b",
            "avatar_bg": "emerald", "avatar_pattern": "checker", "frame": "ring", "board_theme": "walnut",
            "theme_mode": "dark", "light_palette": "parchment", "dark_palette": "espresso", "accent": "teal"}
    r = client.put("/api/profile", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "Tactics Hunter"  # whitespace collapsed
    me = client.get("/api/auth/me").json()
    assert me["avatar"]["piece"] == "q" and me["board_theme"] == "walnut"
    assert me["appearance"] == {"mode": "dark", "light": "parchment", "dark": "espresso", "accent": "teal"}


def test_quick_mode_switch(client, user):
    assert client.patch("/api/profile/appearance", json={"theme_mode": "light"}).json()["appearance"]["mode"] == "light"
    assert client.patch("/api/profile/appearance", json={"theme_mode": "sepia"}).status_code == 422


def test_profile_rejects_unknown_values_and_locked_frame(client, user):
    assert client.put("/api/profile", json={"avatar_piece": "x"}).status_code == 422
    assert client.put("/api/profile", json={"accent": "neon"}).status_code == 422
    assert client.put("/api/profile", json={"light_palette": "midnight"}).status_code == 422
    assert client.put("/api/profile", json={"display_name": "a" * 41}).status_code == 422
    r = client.put("/api/profile", json={"frame": "gold"})
    assert r.status_code == 403 and "Centurion" in r.json()["detail"]
    r = client.put("/api/profile", json={"piece_set": "ruby"})
    assert r.status_code == 403 and "Untouchable" in r.json()["detail"]
    assert client.put("/api/profile", json={"piece_set": "plastic"}).status_code == 422


def test_first_solve_reports_new_achievement(client, user):
    r = client.post("/api/attempts", json={"puzzle_id": 1, "solved": True, "time_ms": 3000}).json()
    assert [a["key"] for a in r["new_achievements"]] == ["first", "lightning"]
    assert r["rank_up"] is None
    again = client.post("/api/attempts", json={"puzzle_id": 2, "solved": True, "time_ms": 4000}).json()
    assert again["new_achievements"] == []
    g = client.get("/api/profile").json()["progress"]
    assert g["rank"]["next_title"] == "Amateur" and g["rank"]["next_at"] == 25
    assert g["records"]["fastest"] == {"puzzle_id": 1, "time_ms": 3000}


def test_site_serves_no_arabic(client, user):
    assert client.get("/api/puzzles/1").json()["white"] == "Hamppe"
    items = client.get("/api/puzzles", params={"limit": 200}).json()["items"]
    blob = " ".join(i["white"] + i["black"] for i in items) + str(client.get("/api/profile").json())
    assert not re.search("[؀-ۿ]", blob)


def test_rewards_unlock_with_achievements(client, user):
    free = {"avatar_bg": "teal", "avatar_pattern": "dots", "frame": "dashed"}
    assert client.put("/api/profile", json=free).status_code == 200
    assert client.put("/api/profile", json={"avatar_bg": "meadow"}).status_code == 403
    client.post("/api/attempts", json={"puzzle_id": 1, "solved": True, "time_ms": 20000})
    g = client.get("/api/profile").json()["progress"]
    assert g["unlocked"] == ["bg:meadow"]
    first = next(a for a in g["achievements"] if a["key"] == "first")
    assert first["reward"] == {"kind": "bg", "item": "meadow"} and first["tier"] == "bronze"
    r = client.put("/api/profile", json={"avatar_bg": "meadow", "avatar_pattern": "dots"})
    assert r.status_code == 200 and r.json()["avatar"]["bg"] == "meadow"
