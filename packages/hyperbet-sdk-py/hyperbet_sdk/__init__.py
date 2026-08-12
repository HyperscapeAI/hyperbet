from .solana.client import HyperbetSolanaClient
from .stream.client import HyperbetStreamClient
from .types import SdkConfig


class HyperbetClient:
    def __init__(self, config: SdkConfig):
        self.solana = HyperbetSolanaClient(
            config.solana_rpc_url,
            config.solana_private_key,
            config.duel_market_program_id,
            config.fight_oracle_program_id,
        )
        self.stream: HyperbetStreamClient | None = (
            HyperbetStreamClient(config.stream_url) if config.stream_url else None
        )


__all__ = [
    "HyperbetClient",
    "HyperbetSolanaClient",
    "HyperbetStreamClient",
    "SdkConfig",
]
