"""SQLite connection handling and schema for the SIMERIENCE car purchase prototype.

Design notes
------------
* One connection per request/transaction. SQLite connections are not thread-safe
  to share, and FastAPI runs sync endpoints on a thread pool.
* ``isolation_level=None`` disables Python's implicit transaction handling so we
  can control transactions explicitly with ``BEGIN IMMEDIATE``.
* ``BEGIN IMMEDIATE`` takes the write lock up front. That is what makes reads
  inside the transaction (balance, stock) trustworthy: no other writer can slip
  in between our check and our UPDATE.
* ``busy_timeout`` makes concurrent writers wait their turn instead of failing
  instantly with "database is locked".
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "simerience.db"


def db_path() -> Path:
    """Path to the SQLite file. Override with the SIMERENCE_DB env var (used by tests)."""
    return Path(os.environ.get("SIMERENCE_DB", DEFAULT_DB_PATH))


SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    balance     INTEGER NOT NULL CHECK (balance >= 0),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cars (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    price       INTEGER NOT NULL CHECK (price > 0),
    stock       INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS purchases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id       INTEGER NOT NULL REFERENCES players(id),
    car_id          INTEGER NOT NULL REFERENCES cars(id),
    price_paid      INTEGER NOT NULL,
    balance_after   INTEGER NOT NULL,
    stock_after     INTEGER NOT NULL,
    idempotency_key TEXT    NOT NULL UNIQUE,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchases_player ON purchases(player_id);
"""


def connect() -> sqlite3.Connection:
    """Open a connection configured for safe concurrent writes."""
    conn = sqlite3.connect(db_path(), timeout=30.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    """Create the database file and tables. Safe to call on every startup."""
    conn = connect()
    try:
        # WAL lets readers run while a writer holds the lock.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
    finally:
        conn.close()
