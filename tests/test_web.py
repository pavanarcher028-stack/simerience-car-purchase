"""The showroom page and its assets are served by the same FastAPI app."""

from __future__ import annotations


def test_showroom_page_is_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert "SIMERIENCE" in r.text
    assert "/static/app.js" in r.text
    assert "/static/styles.css" in r.text


def test_showroom_assets_are_served(client):
    js = client.get("/static/app.js")
    assert js.status_code == 200
    assert "Idempotency-Key" in js.text

    css = client.get("/static/styles.css")
    assert css.status_code == 200
    assert "--accent" in css.text


def test_swagger_ui_still_works(client):
    assert client.get("/docs").status_code == 200
    paths = client.get("/openapi.json").json()["paths"]
    assert "/purchase" in paths
    assert "/" not in paths  # the showroom is not part of the API contract
