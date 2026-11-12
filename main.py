"""Entry point so `python -m uvicorn main:app --reload` works from the project root."""

from app.main import app

__all__ = ["app"]
