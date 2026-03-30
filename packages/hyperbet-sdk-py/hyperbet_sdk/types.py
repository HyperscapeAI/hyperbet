from pydantic import BaseModel
from typing import Literal, Optional

TimeInForce = Literal["gtc", "ioc"]

class CreateOrderParams(BaseModel):
    duel_id: str
    side: Literal["buy", "sell"]
    price: int
    amount: int
    time_in_force: TimeInForce = "gtc"
    post_only: bool = False

class CancelOrderParams(BaseModel):
    duel_id: str
    order_id: int

class ClaimParams(BaseModel):
    duel_id: str

class SdkConfig(BaseModel):
    evm_private_key: Optional[str] = None
    bsc_rpc_url: Optional[str] = None
    avax_rpc_url: Optional[str] = None
    solana_private_key: Optional[str] = None
    solana_rpc_url: Optional[str] = None
    stream_url: Optional[str] = None

SIDE_BID = 1
SIDE_ASK = 2
MARKET_KIND_DUEL_WINNER = 0
ORDER_FLAG_GTC = 0x01
ORDER_FLAG_IOC = 0x02
ORDER_FLAG_POST_ONLY = 0x04
