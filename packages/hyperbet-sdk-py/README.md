# hyperbet-sdk

Python SDK for the SOL-only Hyperbet duel market. The package binds one
explicit Solana RPC, signer, fight-oracle program, and duel-market program; it
does not contain fallback program identities or alternate-chain clients.

## Installation

```bash
pip install hyperbet-sdk
# or
poetry add hyperbet-sdk
```

## Quick start

```python
import asyncio
import os

from hyperbet_sdk import HyperbetClient
from hyperbet_sdk.types import CreateOrderParams, SdkConfig

client = HyperbetClient(
    SdkConfig(
        solana_private_key=os.environ["SOLANA_PRIVATE_KEY"],
        solana_rpc_url=os.environ["SOLANA_RPC_URL"],
        duel_market_program_id=os.environ["DUEL_MARKET_PROGRAM_ID"],
        fight_oracle_program_id=os.environ["FIGHT_ORACLE_PROGRAM_ID"],
        stream_url=os.environ.get("HYPERIA_STREAM_URL"),
    )
)


async def main():
    signature = await client.solana.place_order(
        CreateOrderParams(
            duel_key_hex="0" * 64,
            side="YES",
            outcome_price_millis=600,
            amount_lamports=10_000,
            behavior="GTC",
        )
    )
    print(signature)


asyncio.run(main())
```

`outcome_price_millis` is the selected outcome's probability from `1` to
`999`. `amount_lamports` is the program's native-SOL payout unit and must be
positive, fit in a `u64`, and be divisible by `1000`, matching the on-chain
precision rule. For `NO`, the client converts the selected-outcome price to the
program's complementary ask price.

Program identities are mandatory because launch deployments must be verified
externally before use. Do not substitute the example duel key or unverified
addresses in a real transaction.

## Clients

| Client                   | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `HyperbetSolanaClient`   | Native-SOL duel orders, recovery, and settlement    |
| `HyperbetStreamClient`   | Optional canonical Hyperia WebSocket subscriptions |

## Solana API

- `place_order(params)` — place a GTC, IOC, or post-only order after rebuilding
  the canonical current account graph.
- `cancel_order(params)` — cancel an open resting order owned by the signer.
- `reclaim_order(params)` — reclaim a resting order after the market locks or
  reaches a terminal state.
- `close_filled_order(params)` — recover signer-owned rent from an inactive,
  fully filled, unlinked order account.
- `claim(params)` — claim a resolved payout or cancelled-market refund.
- `close_losing_balance(params)` — close a resolved losing balance without
  attempting a payout.

The on-chain programs remain the final authority and reject stale state.
Applications should also present a fresh pre-signature quote, validate wallet
funding, and show durable transaction-recovery states; the launch app implements
those product-level controls.

## Development

```bash
poetry install
poetry run ruff check hyperbet_sdk tests
poetry run ruff format --check hyperbet_sdk tests
poetry run pytest -p no:anchorpy
poetry build
```
