"""Seed the shop with demo players and cars.

    python seed.py           # add demo data (keeps existing purchases)
    python seed.py --reset   # wipe and reseed everything
"""

from __future__ import annotations

import sys

from app import store
from app.demo_data import seed_demo_data
from app.db import db_path


def main() -> None:
    wipe = "--reset" in sys.argv
    counts = seed_demo_data(wipe=wipe)

    if wipe:
        print(f"Reset {db_path()}")
    print(
        f"Demo data ready — {counts['players']} players, "
        f"{counts['cars']} cars, {counts['purchases']} purchases"
    )

    print("\nPlayers:")
    for p in store.list_players():
        print(f"  #{p['id']} {p['name']:<8} balance {p['balance']:,}")
    print("Shop:")
    for c in store.list_cars():
        print(f"  #{c['id']} {c['name']:<14} {c['price']:>7,} coins   stock {c['stock']}")


if __name__ == "__main__":
    main()
