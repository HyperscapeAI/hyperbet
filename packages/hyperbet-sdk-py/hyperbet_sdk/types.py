from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_U64 = 18_446_744_073_709_551_615

SolanaOutcomeSide = Literal["YES", "NO"]
SolanaOrderBehavior = Literal["GTC", "IOC", "POST_ONLY"]


class DuelKeyParams(BaseModel):
    duel_key_hex: str

    @field_validator("duel_key_hex")
    @classmethod
    def validate_duel_key(cls, value: str) -> str:
        normalized = value.strip().lower()
        if len(normalized) != 64:
            raise ValueError("duel_key_hex must be a 32-byte hex string")
        try:
            bytes.fromhex(normalized)
        except ValueError as exc:
            raise ValueError("duel_key_hex must be a 32-byte hex string") from exc
        return normalized


class CreateOrderParams(DuelKeyParams):
    side: SolanaOutcomeSide
    outcome_price_millis: int = Field(gt=0, lt=1_000)
    amount_lamports: int = Field(gt=0, le=MAX_U64)
    behavior: SolanaOrderBehavior = "GTC"

    @field_validator("amount_lamports")
    @classmethod
    def validate_amount_precision(cls, value: int) -> int:
        if value % 1_000 != 0:
            raise ValueError("amount_lamports must be divisible by 1000")
        return value


class OrderActionParams(DuelKeyParams):
    order_id: int = Field(ge=0, le=MAX_U64)


CancelOrderParams = OrderActionParams
ReclaimOrderParams = OrderActionParams
CloseFilledOrderParams = OrderActionParams


class ClaimParams(DuelKeyParams):
    pass


CloseLosingBalanceParams = ClaimParams


class SdkConfig(BaseModel):
    solana_private_key: str = Field(min_length=1)
    solana_rpc_url: str = Field(min_length=1)
    duel_market_program_id: str = Field(min_length=1)
    fight_oracle_program_id: str = Field(min_length=1)
    stream_url: str | None = None


SIDE_BID = 1
SIDE_ASK = 2
MARKET_KIND_DUEL_WINNER = 1
ORDER_BEHAVIOR_GTC = 0
ORDER_BEHAVIOR_IOC = 1
ORDER_BEHAVIOR_POST_ONLY = 2
MAX_MATCHES_PER_TRANSACTION = 50
