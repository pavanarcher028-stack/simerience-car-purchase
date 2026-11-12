"""The seven checklist tests, plus a few extra guards.

Run with:  python -m pytest -v
"""

from __future__ import annotations

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app import store
from app.db import db_path
from app.main import app


def purchase(client, player_id: int, car_id: int, key: str):
    return client.post(
        "/purchase",
        json={"player_id": player_id, "car_id": car_id},
        headers={"Idempotency-Key": key},
    )


def count_purchases() -> int:
    conn = sqlite3.connect(db_path())
    try:
        return conn.execute("SELECT COUNT(*) FROM purchases").fetchone()[0]
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# 1. Player can see their balance and the available cars
# --------------------------------------------------------------------------- #
def test_01_player_can_see_balance_and_shop(client, player, car):
    ash = player("Ash", 100_000)
    car("Sports Car", 50_000, 1)

    balance = client.get(f"/players/{ash['id']}")
    assert balance.status_code == 200
    assert balance.json() == {"id": ash["id"], "name": "Ash", "balance": 100_000}

    shop = client.get("/cars")
    assert shop.status_code == 200
    assert shop.json() == [
        {"id": 1, "name": "Sports Car", "price": 50_000, "stock": 1}
    ]


# --------------------------------------------------------------------------- #
# 2. Buying a car deducts the correct number of coins
# --------------------------------------------------------------------------- #
def test_02_purchase_deducts_coins(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 1)

    r = purchase(client, ash["id"], sports["id"], "key-1")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["price_paid"] == 50_000
    assert body["balance_after"] == 50_000
    assert body["stock_after"] == 0
    assert body["replayed"] is False

    assert client.get(f"/players/{ash['id']}").json()["balance"] == 50_000
    assert client.get("/cars").json()[0]["stock"] == 0


# --------------------------------------------------------------------------- #
# 3. The purchased car appears in the garage
# --------------------------------------------------------------------------- #
def test_03_car_appears_in_garage(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 1)
    purchase(client, ash["id"], sports["id"], "key-1")

    garage = client.get(f"/players/{ash['id']}/garage")
    assert garage.status_code == 200
    items = garage.json()
    assert len(items) == 1
    assert items[0]["car_name"] == "Sports Car"
    assert items[0]["price_paid"] == 50_000


# --------------------------------------------------------------------------- #
# 4. Restarting the server does not remove the purchased car
# --------------------------------------------------------------------------- #
def test_04_purchase_survives_a_restart(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 1)
    purchase(client, ash["id"], sports["id"], "key-1")

    # A brand-new client = a brand-new app process reading the same file on disk.
    with TestClient(app) as fresh_server:
        garage = fresh_server.get(f"/players/{ash['id']}/garage").json()
        balance = fresh_server.get(f"/players/{ash['id']}").json()["balance"]

    assert len(garage) == 1
    assert garage[0]["car_name"] == "Sports Car"
    assert balance == 50_000


# --------------------------------------------------------------------------- #
# 5. Insufficient balance deducts nothing
# --------------------------------------------------------------------------- #
def test_05_insufficient_balance_changes_nothing(client, player, car):
    broke = player("Riya", 1_000)
    sports = car("Sports Car", 50_000, 1)

    r = purchase(client, broke["id"], sports["id"], "key-1")
    assert r.status_code == 400
    assert "Insufficient balance" in r.json()["detail"]

    assert client.get(f"/players/{broke['id']}").json()["balance"] == 1_000
    assert client.get("/cars").json()[0]["stock"] == 1
    assert client.get(f"/players/{broke['id']}/garage").json() == []
    assert count_purchases() == 0


# --------------------------------------------------------------------------- #
# 6. Two players cannot buy the same final-stock car
# --------------------------------------------------------------------------- #
def test_06_only_one_player_wins_the_last_car(client, player, car):
    ash = player("Ash", 100_000)
    riya = player("Riya", 100_000)
    sports = car("Sports Car", 50_000, 1)

    barrier = threading.Barrier(2)

    def buy(player_id: int):
        barrier.wait(timeout=10)  # fire both purchases at the same instant
        try:
            return store.purchase_car(player_id, sports["id"], f"race-{player_id}")
        except store.OutOfStock:
            return "sold_out"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(buy, [ash["id"], riya["id"]]))

    winners = [r for r in results if isinstance(r, dict)]
    losers = [r for r in results if r == "sold_out"]
    assert len(winners) == 1, results
    assert len(losers) == 1, results

    # Exactly one charge, exactly one car owned, stock is empty.
    winner_id = winners[0]["player_id"]
    loser_id = riya["id"] if winner_id == ash["id"] else ash["id"]
    assert client.get(f"/players/{winner_id}").json()["balance"] == 50_000
    assert client.get(f"/players/{loser_id}").json()["balance"] == 100_000
    assert client.get("/cars").json()[0]["stock"] == 0
    assert len(client.get(f"/players/{winner_id}/garage").json()) == 1
    assert client.get(f"/players/{loser_id}/garage").json() == []
    assert count_purchases() == 1


def test_06b_no_oversell_under_heavy_concurrency(client, player, car):
    """8 buyers fight over 3 cars: exactly 3 succeed."""
    buyers = [player(f"Player{i}", 100_000) for i in range(8)]
    suv = car("SUV", 30_000, 3)

    barrier = threading.Barrier(len(buyers))

    def buy(p):
        barrier.wait(timeout=10)
        try:
            return store.purchase_car(p["id"], suv["id"], f"heavy-{p['id']}")
        except store.OutOfStock:
            return "sold_out"

    with ThreadPoolExecutor(max_workers=len(buyers)) as pool:
        results = list(pool.map(buy, buyers))

    assert sum(1 for r in results if isinstance(r, dict)) == 3
    assert sum(1 for r in results if r == "sold_out") == 5
    assert client.get("/cars").json()[0]["stock"] == 0
    assert count_purchases() == 3

    sold = sum(len(client.get(f"/players/{p['id']}/garage").json()) for p in buyers)
    assert sold == 3


# --------------------------------------------------------------------------- #
# 7. Retrying the same purchase does not deduct coins twice
# --------------------------------------------------------------------------- #
def test_07_retry_with_same_key_is_not_charged_twice(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 2)

    first = purchase(client, ash["id"], sports["id"], "retry-me")
    second = purchase(client, ash["id"], sports["id"], "retry-me")

    assert first.status_code == second.status_code == 201
    assert first.json()["replayed"] is False
    assert second.json()["replayed"] is True
    assert first.json()["purchase_id"] == second.json()["purchase_id"]

    assert client.get(f"/players/{ash['id']}").json()["balance"] == 50_000
    assert client.get("/cars").json()[0]["stock"] == 1
    assert len(client.get(f"/players/{ash['id']}/garage").json()) == 1
    assert count_purchases() == 1


def test_07b_same_key_concurrent_requests_charge_once(client, player, car):
    """5 identical retries fired in parallel still cost one car and one payment."""
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 5)

    barrier = threading.Barrier(5)

    def buy(_):
        barrier.wait(timeout=10)
        return store.purchase_car(ash["id"], sports["id"], "same-key")

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(buy, range(5)))

    assert len({r["purchase_id"] for r in results}) == 1
    assert sum(1 for r in results if r["replayed"] is False) == 1
    assert client.get(f"/players/{ash['id']}").json()["balance"] == 50_000
    assert client.get("/cars").json()[0]["stock"] == 4
    assert count_purchases() == 1


# --------------------------------------------------------------------------- #
# Extra guards
# --------------------------------------------------------------------------- #
def test_08_sold_out_car_cannot_be_bought(client, player, car):
    ash = player("Ash", 100_000)
    ghost = car("Ghost Car", 10_000, 0)

    r = purchase(client, ash["id"], ghost["id"], "key-1")
    assert r.status_code == 409
    assert "sold out" in r.json()["detail"].lower()
    assert client.get(f"/players/{ash['id']}").json()["balance"] == 100_000


def test_09_reused_key_for_a_different_car_is_rejected(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 1)
    suv = car("SUV", 30_000, 1)

    assert purchase(client, ash["id"], sports["id"], "shared-key").status_code == 201
    r = purchase(client, ash["id"], suv["id"], "shared-key")
    assert r.status_code == 409
    assert client.get(f"/players/{ash['id']}").json()["balance"] == 50_000


def test_10_unknown_player_or_car_returns_404(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 1)

    assert purchase(client, 999, sports["id"], "k1").status_code == 404
    assert purchase(client, ash["id"], 999, "k2").status_code == 404
    assert client.get(f"/players/{ash['id']}").json()["balance"] == 100_000


def test_11_missing_idempotency_key_is_rejected(client, player, car):
    ash = player("Ash", 100_000)
    sports = car("Sports Car", 50_000, 1)

    r = client.post(
        "/purchase", json={"player_id": ash["id"], "car_id": sports["id"]}
    )
    assert r.status_code == 422  # FastAPI validates the required header
    assert client.get(f"/players/{ash['id']}").json()["balance"] == 100_000
