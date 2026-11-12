"""Development reset and the concurrency lab page.

The reset is a development helper: these tests pin down what it restores, that
it is idempotent, and that it can be switched off with SIMERENCE_ALLOW_RESET=0.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

from app.demo_data import DEMO_CARS, DEMO_PLAYERS


def reset(client):
    r = client.post("/dev/reset")
    assert r.status_code == 200, r.text
    return r.json()


def test_reset_restores_the_demo_dealership(client):
    body = reset(client)

    assert body == {"players": 2, "cars": 6, "purchases": 0}

    players = client.get("/players").json()
    assert [(p["id"], p["name"], p["balance"]) for p in players] == list(DEMO_PLAYERS)

    cars = client.get("/cars").json()
    assert [(c["id"], c["name"], c["price"], c["stock"]) for c in cars] == list(
        DEMO_CARS
    )


def test_reset_is_idempotent(client):
    first = reset(client)
    second = reset(client)

    assert first == second == {"players": 2, "cars": 6, "purchases": 0}
    assert len(client.get("/players").json()) == 2
    assert len(client.get("/cars").json()) == 6


def test_reset_clears_purchases_and_refunds_wallets(client):
    reset(client)

    r = client.post(
        "/purchase",
        json={"player_id": 1, "car_id": 1},
        headers={"Idempotency-Key": "dev-reset-check"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["balance_after"] == 15_000

    assert client.get("/players/1").json()["balance"] == 15_000
    assert client.get("/cars").json()[0]["stock"] == 0
    assert len(client.get("/players/1/garage").json()) == 1

    body = reset(client)
    assert body["purchases"] == 0
    assert client.get("/players/1").json()["balance"] == 100_000
    assert client.get("/cars").json()[0]["stock"] == 1
    assert client.get("/players/1/garage").json() == []


def test_reset_can_be_disabled_for_demos(client, monkeypatch):
    monkeypatch.setenv("SIMERENCE_ALLOW_RESET", "0")

    r = client.post("/dev/reset")
    assert r.status_code == 403
    assert "disabled" in r.json()["detail"].lower()


def test_race_page_and_assets_are_served(client):
    page = client.get("/race")
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/html")
    assert "SIMERIENCE" in page.text
    assert "/static/race.js" in page.text
    assert "/static/styles.css" in page.text
    assert "Concurrency lab" in page.text

    js = client.get("/static/race.js")
    assert js.status_code == 200
    assert "Idempotency-Key" in js.text
    assert "Promise.all" in js.text
    assert "/dev/reset" in js.text

    assert "/race" not in client.get("/openapi.json").json()["paths"]


def test_http_race_has_exactly_one_winner(client):
    """Two buyers POST /purchase for the last unit at the same instant."""
    reset(client)

    barrier = threading.Barrier(2)

    def buy(player_id: int):
        barrier.wait(timeout=10)  # release both requests together
        return client.post(
            "/purchase",
            json={"player_id": player_id, "car_id": 1},
            headers={"Idempotency-Key": f"race-{player_id}"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(buy, [1, 2]))

    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 409], [
        (r.status_code, r.text) for r in results
    ]

    winner = next(r for r in results if r.status_code == 201).json()
    loser = next(r for r in results if r.status_code == 409).json()
    assert winner["stock_after"] == 0
    assert "sold out" in loser["detail"].lower()

    car = client.get("/cars").json()[0]
    assert car["stock"] == 0

    winner_id = winner["player_id"]
    loser_id = 2 if winner_id == 1 else 1
    assert client.get(f"/players/{winner_id}").json()["balance"] == 15_000
    assert client.get(f"/players/{loser_id}").json()["balance"] == 100_000

    garages = {
        pid: client.get(f"/players/{pid}/garage").json() for pid in (1, 2)
    }
    assert len(garages[winner_id]) == 1
    assert garages[loser_id] == []
