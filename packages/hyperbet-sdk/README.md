# @hyperbet/sdk

TypeScript SDK for the SOL-only Hyperbet duel market. The package binds one
explicit Solana RPC, signer, fight-oracle program, and duel-market program; it
does not contain fallback program identities or alternate-chain clients.

## Installation

```bash
npm install @hyperbet/sdk
# or
bun add @hyperbet/sdk
```

## Quick start

```ts
import { HyperbetClient } from "@hyperbet/sdk";

const client = new HyperbetClient({
  solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY!,
  solanaRpcUrl: process.env.SOLANA_RPC_URL!,
  duelMarketProgramId: process.env.DUEL_MARKET_PROGRAM_ID!,
  fightOracleProgramId: process.env.FIGHT_ORACLE_PROGRAM_ID!,
  streamUrl: process.env.HYPERIA_STREAM_URL,
});

const signature = await client.solana.placeOrder({
  duelKeyHex: "0".repeat(64),
  side: "YES",
  outcomePriceMillis: 600,
  amountLamports: 10_000n,
  behavior: "GTC",
});

console.log(signature);
```

`outcomePriceMillis` is the selected outcome's probability from `1` to `999`.
`amountLamports` is the program's native-SOL payout unit and must be positive,
fit in a `u64`, and be divisible by `1000`, matching the on-chain precision
rule. For `NO`, the client converts the selected-outcome price to the program's
complementary ask price.

Program identities are mandatory because launch deployments must be verified
externally before use. Do not substitute the example duel key or unverified
addresses in a real transaction.

## Clients

| Client                 | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `HyperbetSolanaClient` | Native-SOL duel orders, recovery, and settlement   |
| `HyperbetStreamClient` | Optional canonical Hyperia WebSocket subscriptions |

## Solana API

- `placeOrder(params)` — place a GTC, IOC, or post-only order after rebuilding
  the canonical current account graph.
- `cancelOrder(params)` — cancel an open resting order owned by the signer.
- `reclaimOrder(params)` — reclaim a resting order after the market locks or
  reaches a terminal state.
- `closeFilledOrder(params)` — recover signer-owned rent from an inactive,
  fully filled, unlinked order account.
- `claim(params)` — claim a resolved payout or cancelled-market refund.
- `closeLosingBalance(params)` — close a resolved losing balance without
  attempting a payout.

Each method returns the submitted Solana signature. The on-chain programs
remain the final authority and reject stale market/order state. Applications
should still present a fresh pre-signature quote, validate wallet funding, and
show durable transaction recovery states; the launch app implements those
product-level controls.

## Development

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```
