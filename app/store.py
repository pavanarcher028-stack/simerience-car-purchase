"""Business logic: players, cars, garage and the purchase transaction.

The purchase is the interesting part. It must satisfy four rules at once:

1. Atomic    -> deduct coins, decrement stock and record ownership all in one
                transaction. Any failure rolls all three back.
2. No oversell -> the stock decrement is conditional (``WHERE stock > 0``) and we
                verify that it actually touched a row.
3. No overdraft -> the balance decrement is conditional (``WHERE balance >= price``).
4. Idempotent -> the client sends an ``Idempotency-Key``; a retry returns the
                original result instead of charging again.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from .db import connect


class AppError(Exception):
    """Base class for errors that map to an HTTP status code."""

    status_code = 400

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFound(AppError):
    status_code = 404


class InsufficientBalance(AppError):
    status_code = 400

    def __init__(self, balance: int, price: int) -> None:
        super().__init__(
            f"Insufficient balance: you have {balance} coins, this car costs {price}."
        )


class OutOfStock(AppError):
    status_code = 409

    def __init__(self, car_name: str) -> None:
        super().__init__(f"{car_name} is sold out.")


class IdempotencyConflict(AppError):
    status_code = 409

    def __init__(self) -> None:
        super().__init__(
            "This Idempotency-Key was already used for a different purchase."
        )


class DatabaseBusy(AppError):
    status_code = 503

    def __init__(self) -> None:
        super().__init__("The database is busy. Please retry in a moment.")


# --------------------------------------------------------------------------- #
# Players
# --------------------------------------------------------------------------- #
def create_player(name: str, balance: int) -> dict[str, Any]:
    conn = connect()
    try:
        cur = conn.execute(
            "INSERT INTO players (name, balance) VALUES (?, ?)", (name, balance)
        )
        return {"id": cur.lastrowid, "name": name, "balance": balance}
    except sqlite3.IntegrityError:
        raise AppError(f"A player named '{name}' already exists.") from None
    finally:
        conn.close()


def get_player(player_id: int) -> dict[str, Any]:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT id, name, balance FROM players WHERE id = ?", (player_id,)
        ).fetchone()
        if row is None:
            raise NotFound(f"Player {player_id} not found.")
        return dict(row)
    finally:
        conn.close()


def list_players() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute("SELECT id, name, balance FROM players ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Cars
# --------------------------------------------------------------------------- #
def create_car(name: str, price: int, stock: int) -> dict[str, Any]:
    conn = connect()
    try:
        cur = conn.execute(
            "INSERT INTO cars (name, price, stock) VALUES (?, ?, ?)",
            (name, price, stock),
        )
        return {"id": cur.lastrowid, "name": name, "price": price, "stock": stock}
    finally:
        conn.close()


def list_cars() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute("SELECT id, name, price, stock FROM cars ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_car(car_id: int) -> dict[str, Any]:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT id, name, price, stock FROM cars WHERE id = ?", (car_id,)
        ).fetchone()
        if row is None:
            raise NotFound(f"Car {car_id} not found.")
        return dict(row)
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Garage
# --------------------------------------------------------------------------- #
def get_garage(player_id: int) -> list[dict[str, Any]]:
    get_player(player_id)  # 404 if the player does not exist
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT p.id   AS purchase_id,
                   c.id   AS car_id,
                   c.name AS car_name,
                   p.price_paid,
                   p.created_at AS purchased_at
            FROM purchases p
            JOIN cars c ON c.id = p.car_id
            WHERE p.player_id = ?
            ORDER BY p.id
            """,
            (player_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Purchase
# --------------------------------------------------------------------------- #
def _existing_purchase(
    conn: sqlite3.Connection, key: str, player_id: int, car_id: int
) -> dict[str, Any] | None:
    """Return the stored result for an idempotency key, or None if unused."""
    row = conn.execute(
        """
        SELECT p.id, p.player_id, p.car_id, p.price_paid,
               p.balance_after, p.stock_after, c.name AS car_name
        FROM purchases p
        JOIN cars c ON c.id = p.car_id
        WHERE p.idempotency_key = ?
        """,
        (key,),
    ).fetchone()
    if row is None:
        return None
    if row["player_id"] != player_id or row["car_id"] != car_id:
        # Same key, different intent: refuse rather than silently returning
        # a purchase the caller did not ask for.
        raise IdempotencyConflict()
    return _purchase_payload(row, replayed=True)


def _purchase_payload(row: sqlite3.Row, replayed: bool) -> dict[str, Any]:
    return {
        "purchase_id": row["id"],
        "player_id": row["player_id"],
        "car_id": row["car_id"],
        "car_name": row["car_name"],
        "price_paid": row["price_paid"],
        "balance_after": row["balance_after"],
        "stock_after": row["stock_after"],
        "replayed": replayed,
    }


def purchase_car(player_id: int, car_id: int, idempotency_key: str) -> dict[str, Any]:
    conn = connect()
    try:
        # IMMEDIATE = grab the write lock now, so the checks below cannot be
        # invalidated by another player's purchase before we commit.
        conn.execute("BEGIN IMMEDIATE")

        replay = _existing_purchase(conn, idempotency_key, player_id, car_id)
        if replay is not None:
            conn.execute("COMMIT")
            return replay

        player = conn.execute(
            "SELECT id, balance FROM players WHERE id = ?", (player_id,)
        ).fetchone()
        if player is None:
            raise NotFound(f"Player {player_id} not found.")

        car = conn.execute(
            "SELECT id, name, price, stock FROM cars WHERE id = ?", (car_id,)
        ).fetchone()
        if car is None:
            raise NotFound(f"Car {car_id} not found.")

        if car["stock"] <= 0:
            raise OutOfStock(car["name"])

        price = car["price"]
        if player["balance"] < price:
            raise InsufficientBalance(player["balance"], price)

        # Conditional UPDATEs: the WHERE clause is the guard, rowcount is the proof.
        deducted = conn.execute(
            "UPDATE players SET balance = balance - ? WHERE id = ? AND balance >= ?",
            (price, player_id, price),
        )
        if deducted.rowcount != 1:
            raise InsufficientBalance(player["balance"], price)

        claimed = conn.execute(
            "UPDATE cars SET stock = stock - 1 WHERE id = ? AND stock > 0",
            (car_id,),
        )
        if claimed.rowcount != 1:
            raise OutOfStock(car["name"])

        balance_after = player["balance"] - price
        stock_after = car["stock"] - 1

        cur = conn.execute(
            """
            INSERT INTO purchases
                (player_id, car_id, price_paid, balance_after, stock_after, idempotency_key)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (player_id, car_id, price, balance_after, stock_after, idempotency_key),
        )
        conn.execute("COMMIT")

        return {
            "purchase_id": cur.lastrowid,
            "player_id": player_id,
            "car_id": car_id,
            "car_name": car["name"],
            "price_paid": price,
            "balance_after": balance_after,
            "stock_after": stock_after,
            "replayed": False,
        }

    except AppError:
        _rollback(conn)
        raise
    except sqlite3.IntegrityError:
        # Two requests with the same key raced. The loser rolls back its own
        # deductions and returns the winner's committed result.
        _rollback(conn)
        replay: dict[str, Any] | None = None
        try:
            conn.execute("BEGIN")
            replay = _existing_purchase(conn, idempotency_key, player_id, car_id)
        finally:
            _rollback(conn)
        if replay is not None:
            return replay
        raise AppError("Purchase could not be completed. Please retry.") from None
    except sqlite3.OperationalError as exc:
        _rollback(conn)
        if "locked" in str(exc).lower() or "busy" in str(exc).lower():
            raise DatabaseBusy() from None
        raise
    finally:
        conn.close()


def _rollback(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("ROLLBACK")
    except sqlite3.OperationalError:
        pass  # no transaction was open
