def test_request_accept_and_list(make_player):
    a, b = make_player(), make_player()
    assert a.post("/api/friends/requests", json={"username": b.user["username"].upper()}).json()["status"] == "pending"
    assert a.get("/api/friends").json()["outgoing"][0]["id"] == b.user["id"]
    incoming = b.get("/api/friends").json()["incoming"]
    assert incoming[0]["id"] == a.user["id"]
    # only the addressee can answer
    assert a.post(f"/api/friends/requests/{incoming[0]['request_id']}/accept").status_code == 404
    assert b.post(f"/api/friends/requests/{incoming[0]['request_id']}/accept").status_code == 200
    friends = a.get("/api/friends").json()["friends"]
    assert [f["id"] for f in friends] == [b.user["id"]]
    assert friends[0]["record"] == {"wins": 0, "losses": 0, "draws": 0}


def test_request_rules(make_player):
    a, b = make_player(), make_player()
    assert a.post("/api/friends/requests", json={"username": a.user["username"]}).status_code == 400
    assert a.post("/api/friends/requests", json={"username": "nobody-here"}).status_code == 404
    a.post("/api/friends/requests", json={"username": b.user["username"]})
    assert a.post("/api/friends/requests", json={"username": b.user["username"]}).status_code == 409
    # b sending back to a counts as accepting
    assert b.post("/api/friends/requests", json={"username": a.user["username"]}).json()["status"] == "accepted"
    assert a.post("/api/friends/requests", json={"username": b.user["username"]}).status_code == 409


def test_decline_cancel_remove(make_player):
    a, b, c = make_player(), make_player(), make_player()
    a.post("/api/friends/requests", json={"username": b.user["username"]})
    rid = b.get("/api/friends").json()["incoming"][0]["request_id"]
    assert b.post(f"/api/friends/requests/{rid}/decline").status_code == 200
    assert a.get("/api/friends").json()["outgoing"] == []

    a.post("/api/friends/requests", json={"username": c.user["username"]})
    rid = a.get("/api/friends").json()["outgoing"][0]["request_id"]
    assert a.delete(f"/api/friends/requests/{rid}").status_code == 200

    a.post("/api/friends/requests", json={"username": b.user["username"]})
    b.post(f"/api/friends/requests/{b.get('/api/friends').json()['incoming'][0]['request_id']}/accept")
    assert a.delete(f"/api/friends/{b.user['id']}").status_code == 200
    assert b.get("/api/friends").json()["friends"] == []
    assert a.get(f"/api/friends/{b.user['id']}").status_code == 404


def test_search_shows_relation(friends, make_player):
    a, b = friends
    c = make_player()
    found = {u["id"]: u["relation"] for u in a.get("/api/users/search", params={"q": b.user["username"][:4]}).json()}
    assert found.get(b.user["id"]) == "friend" and a.user["id"] not in found
    only_c = a.get("/api/users/search", params={"q": c.user["username"]}).json()
    assert only_c[0]["relation"] == "none"
    # LIKE wildcards are escaped
    assert a.get("/api/users/search", params={"q": "%"}).json() == []


def test_friendship_page(friends):
    a, b = friends
    page = a.get(f"/api/friends/{b.user['id']}").json()
    assert page["me"]["id"] == a.user["id"] and page["friend"]["id"] == b.user["id"]
    assert page["record"]["all"] == {"wins": 0, "losses": 0, "draws": 0} and page["history"] == []
    assert "solved" in page["friend"] and "rank" in page["friend"]


def test_notifications_count_requests(make_player):
    a, b = make_player(), make_player()
    a.post("/api/friends/requests", json={"username": b.user["username"]})
    n = b.get("/api/notifications").json()
    assert n["friend_requests"] == 1 and n["total"] == 1
