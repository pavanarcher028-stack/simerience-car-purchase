"""Test fixtures: every test runs against a throwaway SQLite file."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="simerience-tests-"))
os.environ["SIMERENCE_DB"] = str(_TMP_DIR / "test.db")

from app.db import connect, init_db  # noqa: E402
from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


@pytest.fixture()
def client():
    """A clean database plus an HTTP client for every test."""
    init_db()
    conn = connect()
    try:
        conn.execute("DELETE FROM purchases")
        conn.execute("DELETE FROM players")
        conn.execute("DELETE FROM cars")
    finally:
        conn.close()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def player(client):
    def _make(name: str = "Ash", balance: int = 100_000) -> dict:
        r = client.post("/players", json={"name": name, "balance": balance})
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture()
def car(client):
    def _make(name: str = "Sports Car", price: int = 50_000, stock: int = 1) -> dict:
        r = client.post("/cars", json={"name": name, "price": price, "stock": stock})
        assert r.status_code == 201, r.text
        return r.json()

    return _make
