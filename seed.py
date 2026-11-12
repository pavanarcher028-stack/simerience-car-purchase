"""Seed the shop with demo players and cars.

    python seed.py          # add demo data (keeps existing purchases)
    python seed.py --reset  # delete the database and start fresh
"""

from __future__ import annotations

import sys

from app import store
from app.db import db_path, init_db


def main() -> None:
    if "--reset" in sys.argv:
        for suffix in ("", "-wal", "-shm"):
            path = db_path().with_name(db_path().name + suffix)
            path.unlink(missing_ok=True)
        print(f"Deleted {db_path()}")

    init_db()

    if not store.list_players():
        store.create_player("Ash", 100_000)
        store.create_player("Riya", 100_000)
        print("Created players: Ash (100,000), Riya (100,000)")
    else:
        print("Players already exist, skipping.")

    if not store.list_cars():
        store.create_car("Sports Car", 50_000, 1)
        store.create_car("SUV", 30_000, 2)
        store.create_car("Hatchback", 12_000, 3)
        print("Created cars: Sports Car x1, SUV x2, Hatchback x3")
    else:
        print("Cars already exist, skipping.")

    print("\nPlayers:")
    for p in store.list_players():
        print(f"  #{p['id']} {p['name']:<8} balance {p['balance']:,}")
    print("Shop:")
    for c in store.list_cars():
        print(f"  #{c['id']} {c['name']:<12} {c['price']:>7,} coins   stock {c['stock']}")


if __name__ == "__main__":
    main()
