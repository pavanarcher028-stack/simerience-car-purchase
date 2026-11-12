"""Request/response models. These are what Swagger UI renders and validates."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PlayerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40, examples=["Ash"])
    balance: int = Field(default=100_000, ge=0, description="Starting game coins")


class PlayerOut(BaseModel):
    id: int
    name: str
    balance: int


class CarCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80, examples=["Sports Car"])
    price: int = Field(gt=0, examples=[50_000])
    stock: int = Field(default=1, ge=0, examples=[1])


class CarOut(BaseModel):
    id: int
    name: str
    price: int
    stock: int


class GarageItem(BaseModel):
    purchase_id: int
    car_id: int
    car_name: str
    price_paid: int
    purchased_at: str


class PurchaseRequest(BaseModel):
    player_id: int = Field(gt=0, examples=[1])
    car_id: int = Field(gt=0, examples=[1])


class PurchaseResult(BaseModel):
    purchase_id: int
    player_id: int
    car_id: int
    car_name: str
    price_paid: int
    balance_after: int
    stock_after: int
    replayed: bool = Field(
        default=False,
        description="True when this response came from an earlier purchase with the same Idempotency-Key.",
    )


class HealthOut(BaseModel):
    status: str
    database: str


class DevResetOut(BaseModel):
    players: int
    cars: int
    purchases: int
