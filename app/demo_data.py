"""One source of truth for the demo dealership contents.

Used by ``seed.py`` (additive) and by ``POST /dev/reset`` (wipe + reseed), so the
showroom and the concurrency lab always start from the same known state.
"""

from __future__ import annotations

import sqlite3

from .db import connect, init_db

# Explicit ids keep the demo deterministic: player 1 plays Ash, car 1 is the
# single-unit flagship that the concurrency lab races over.
DEMO_PLAYERS: tuple[tuple[int, str, int], ...] = (
    (1, "Ash", 100_000),
    (2, "Riya", 100_000),
)

DEMO_CARS: tuple[tuple[int, str, int, int], ...] = (
    (1, "Apex GT-R", 85_000, 1),
    (2, "Ranger 4x4", 62_000, 1),
    (3, "Solaris GT", 54_000, 2),
    (4, "Meridian S", 46_000, 3),
    (5, "Vanta Cross", 38_000, 2),
    (6, "Cobalt Hatch", 18_500, 4),
)


def seed_demo_data(*, wipe: bool) -> dict[str, int]:
    """Insert the demo players and cars.

    ``wipe=True`` clears purchases, players and cars first (development reset).
    ``wipe=False`` only fills empty tables, so an existing garage survives.
    """
    init_db()
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")

        if wipe:
            conn.execute("DELETE FROM purchases")
            conn.execute("DELETE FROM players")
            conn.execute("DELETE FROM cars")
            try:
                conn.execute(
                    "DELETE FROM sqlite_sequence WHERE name IN ('purchases', 'players', 'cars')"
                )
            except sqlite3.OperationalError:
                pass  # sqlite_sequence only exists once an AUTOINCREMENT row was written

        if not conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]:
            conn.executemany(
                "INSERT INTO players (id, name, balance) VALUES (?, ?, ?)",
                DEMO_PLAYERS,
            )

        if not conn.execute("SELECT COUNT(*) FROM cars").fetchone()[0]:
            conn.executemany(
                "INSERT INTO cars (id, name, price, stock) VALUES (?, ?, ?, ?)",
                DEMO_CARS,
            )

        counts = {
            "players": conn.execute("SELECT COUNT(*) FROM players").fetchone()[0],
            "cars": conn.execute("SELECT COUNT(*) FROM cars").fetchone()[0],
            "purchases": conn.execute("SELECT COUNT(*) FROM purchases").fetchone()[0],
        }
        conn.execute("COMMIT")
        return counts
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.OperationalError:
            pass
        raise
    finally:
        conn.close()
