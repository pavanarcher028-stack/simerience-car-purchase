"""Proof that the concurrency test is not vacuous.

This is NOT the project's purchase code. It is the naive version a first draft
would have: read the stock, decide, then write. Run both players at once and
SQLite happily sells the same car twice.

    python tests/naive_oversell_demo.py
"""

from __future__ import annotations

import sqlite3
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DB = Path(tempfile.mkdtemp()) / "naive.db"
BARRIER = threading.Barrier(2)

conn = sqlite3.connect(DB)
conn.executescript(
    """
    CREATE TABLE players (id INTEGER PRIMARY KEY, balance INTEGER);
    CREATE TABLE cars    (id INTEGER PRIMARY KEY, stock INTEGER);
    INSERT INTO players VALUES (1, 100000), (2, 100000);
    INSERT INTO cars    VALUES (1, 1);
    """
)
conn.commit()
conn.close()


def naive_purchase(player_id: int) -> str:
    conn = sqlite3.connect(DB, timeout=10)
    try:
        stock = conn.execute("SELECT stock FROM cars WHERE id = 1").fetchone()[0]
        balance = conn.execute(
            "SELECT balance FROM players WHERE id = ?", (player_id,)
        ).fetchone()[0]
        if stock <= 0 or balance < 50_000:
            return "sold out"

        # The gap: another player can buy the car between the read above and
        # the writes below, because nothing is locked.
        BARRIER.wait(timeout=5)

        conn.execute(
            "UPDATE players SET balance = balance - 50000 WHERE id = ?", (player_id,)
        )
        conn.execute("UPDATE cars SET stock = stock - 1 WHERE id = 1")
        conn.commit()
        return "bought"
    finally:
        conn.close()


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(naive_purchase, [1, 2]))

    conn = sqlite3.connect(DB)
    stock = conn.execute("SELECT stock FROM cars").fetchone()[0]
    balances = conn.execute("SELECT id, balance FROM players").fetchall()
    conn.close()

    print("Naive read-then-write purchase, two players at the same time")
    print(f"  results : {results}")
    print(f"  stock   : {stock}  <- negative: the car was sold twice")
    print(f"  balances: {balances}")
    print("\nThe real implementation in app/store.py prevents this with")
    print("BEGIN IMMEDIATE plus conditional UPDATE ... WHERE stock > 0.")
