"""Live demo against a running server: the whole checklist in one script.

    python -m uvicorn main:app --reload      # terminal 1
    python demo.py                           # terminal 2

It creates its own players and car, so it can be run repeatedly.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://127.0.0.1:8000"


def call(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def show(label: str, status: int, body) -> None:
    print(f"  {label:<34} {status}  {json.dumps(body)}")


def main() -> None:
    stamp = int(time.time())
    print("1) Create two players and a car with exactly 1 in stock")
    _, ash = call("POST", "/players", {"name": f"Ash-{stamp}", "balance": 100_000})
    _, riya = call("POST", "/players", {"name": f"Riya-{stamp}", "balance": 100_000})
    _, car = call(
        "POST", "/cars", {"name": f"Sports Car {stamp}", "price": 50_000, "stock": 1}
    )
    print(f"  Ash balance {ash['balance']:,} | Riya balance {riya['balance']:,}")
    print(f"  Shop: {car['name']} @ {car['price']:,} coins, stock {car['stock']}")

    print("\n2) Both players press BUY at the same instant")
    barrier = threading.Barrier(2)

    def buy(player, key):
        barrier.wait(timeout=10)
        return player, call(
            "POST",
            "/purchase",
            {"player_id": player["id"], "car_id": car["id"]},
            {"Idempotency-Key": key},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda p: buy(p, f"race-{car['id']}-{p['id']}"), [ash, riya]
            )
        )

    for player, (status, body) in results:
        show(f"{player['name']} buys the last car", status, body)

    print("\n3) Final state")
    for player in (ash, riya):
        _, fresh = call("GET", f"/players/{player['id']}")
        _, garage = call("GET", f"/players/{player['id']}/garage")
        show(f"{player['name']} balance", 200, {"balance": fresh["balance"]})
        show(f"{player['name']} garage", 200, [g["car_name"] for g in garage])
    _, shop = call("GET", f"/cars/{car['id']}")
    show("Shop stock after the race", 200, {"stock": shop["stock"]})

    print("\n4) Retry the same purchase request three times (same Idempotency-Key)")
    winner = ash if results[0][1][0] == 201 else riya
    _, rich = call("POST", "/players", {"name": f"Retry-{stamp}", "balance": 100_000})
    _, spare = call(
        "POST", "/cars", {"name": f"SUV {stamp}", "price": 30_000, "stock": 2}
    )
    key = f"retry-{spare['id']}"
    for attempt in range(1, 4):
        status, body = call(
            "POST",
            "/purchase",
            {"player_id": rich["id"], "car_id": spare["id"]},
            {"Idempotency-Key": key},
        )
        show(
            f"attempt {attempt}",
            status,
            {
                "purchase_id": body["purchase_id"],
                "balance_after": body["balance_after"],
                "replayed": body["replayed"],
            },
        )

    _, fresh = call("GET", f"/players/{rich['id']}")
    _, garage = call("GET", f"/players/{rich['id']}/garage")
    print(
        f"\n  Charged once: balance {fresh['balance']:,}, "
        f"cars owned {len(garage)} (winner of the race: {winner['name']})"
    )


if __name__ == "__main__":
    main()
