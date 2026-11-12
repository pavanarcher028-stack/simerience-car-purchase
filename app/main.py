"""FastAPI app: the HTTP layer over ``store``.

Run it with:
    python -m uvicorn main:app --reload
Then open http://127.0.0.1:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path as FileSystemPath

from fastapi import FastAPI, Header, Path
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import store
from .db import db_path, init_db
from .schemas import (
    CarCreate,
    CarOut,
    GarageItem,
    HealthOut,
    PlayerCreate,
    PlayerOut,
    PurchaseRequest,
    PurchaseResult,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="SIMERIENCE Car Purchase Prototype",
    version="1.0.0",
    description=(
        "Buy cars with game coins. Demonstrates atomic SQLite transactions, "
        "stock protection and idempotent purchases.\n\n"
        "**Try it:** create a player, create a car, then `POST /purchase` with a "
        "unique `Idempotency-Key` header. Repeat the same call to see the retry "
        "return the original result without charging again."
    ),
    lifespan=lifespan,
)


@app.exception_handler(store.AppError)
async def app_error_handler(_, exc: store.AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# --------------------------------------------------------------------------- #
# Showroom (static front end, same origin as the API)
# --------------------------------------------------------------------------- #
STATIC_DIR = FileSystemPath(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False, response_class=FileResponse)
def showroom() -> FileResponse:
    """The visual car showroom. The API below is the only thing it talks to."""
    return FileResponse(STATIC_DIR / "index.html")


# --------------------------------------------------------------------------- #
# Meta
# --------------------------------------------------------------------------- #
@app.get("/health", response_model=HealthOut, tags=["meta"])
def health() -> HealthOut:
    return HealthOut(status="ok", database=str(db_path()))


# --------------------------------------------------------------------------- #
# Players
# --------------------------------------------------------------------------- #
@app.post("/players", response_model=PlayerOut, status_code=201, tags=["players"])
def create_player(payload: PlayerCreate) -> PlayerOut:
    """Create a player with a starting balance (default 100,000 coins)."""
    return PlayerOut(**store.create_player(payload.name, payload.balance))


@app.get("/players", response_model=list[PlayerOut], tags=["players"])
def list_players() -> list[PlayerOut]:
    return [PlayerOut(**p) for p in store.list_players()]


@app.get("/players/{player_id}", response_model=PlayerOut, tags=["players"])
def get_player(player_id: int = Path(gt=0)) -> PlayerOut:
    """Check a player's current balance."""
    return PlayerOut(**store.get_player(player_id))


@app.get("/players/{player_id}/garage", response_model=list[GarageItem], tags=["players"])
def get_garage(player_id: int = Path(gt=0)) -> list[GarageItem]:
    """Everything this player owns."""
    return [GarageItem(**item) for item in store.get_garage(player_id)]


# --------------------------------------------------------------------------- #
# Cars
# --------------------------------------------------------------------------- #
@app.post("/cars", response_model=CarOut, status_code=201, tags=["cars"])
def create_car(payload: CarCreate) -> CarOut:
    """Add a car to the shop."""
    return CarOut(**store.create_car(payload.name, payload.price, payload.stock))


@app.get("/cars", response_model=list[CarOut], tags=["cars"])
def list_cars() -> list[CarOut]:
    """The shop: price and remaining stock for every car."""
    return [CarOut(**c) for c in store.list_cars()]


@app.get("/cars/{car_id}", response_model=CarOut, tags=["cars"])
def get_car(car_id: int = Path(gt=0)) -> CarOut:
    return CarOut(**store.get_car(car_id))


# --------------------------------------------------------------------------- #
# Purchase
# --------------------------------------------------------------------------- #
@app.post(
    "/purchase",
    response_model=PurchaseResult,
    status_code=201,
    tags=["purchase"],
    responses={
        400: {"description": "Insufficient balance"},
        404: {"description": "Player or car not found"},
        409: {"description": "Sold out, or Idempotency-Key reused for a different purchase"},
    },
)
def purchase(
    payload: PurchaseRequest,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=1,
        max_length=128,
        description="Unique per purchase attempt. Reuse the same value when retrying.",
        examples=["buy-car-1-for-player-1"],
    ),
) -> PurchaseResult:
    """Atomically buy a car: check balance, check stock, deduct, record ownership.

    Everything happens in one transaction. If any step fails, nothing is saved.
    """
    return PurchaseResult(
        **store.purchase_car(payload.player_id, payload.car_id, idempotency_key)
    )
