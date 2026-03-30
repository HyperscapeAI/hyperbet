# @hyperbet/sdk

TypeScript SDK for interacting with the Hyperbet prediction market on **EVM (BSC / AVAX)** and **Solana**.

## Installation

```bash
npm install @hyperbet/sdk
# or
bun add @hyperbet/sdk
```

## Quick Start

```ts
import { HyperbetClient } from "@hyperbet/sdk";

const client = new HyperbetClient({
  evmPrivateKey: process.env.EVM_PRIVATE_KEY,
  solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY,
  // Optional — falls back to public RPCs if omitted
  bscRpcUrl: process.env.ALCHEMY_BSC_URL,
  avaxRpcUrl: process.env.ALCHEMY_AVAX_URL,
  solanaRpcUrl: process.env.HELIUS_URL,
});

// Place an order on BSC
await client.evmBsc!.placeOrder({
  duelId: "my-duel-id",
  side: "buy",
  price: 600,           // 60.0% implied probability
  amount: 10000000000000000n, // 0.01 ETH worth of shares
  timeInForce: "gtc",
  postOnly: false,
});

// Place an order on Solana
await client.solana!.placeOrder({
  duelId: "0".repeat(64), // 32-byte hex duel key
  side: "sell",
  price: 400,
  amount: 5000n,
});

// Subscribe to live duel updates
client.stream!.connect();
client.stream!.subscribe((event) => {
  console.log("Stream event:", event);
});
```

## Clients

| Client | Chain | Library |
|--------|-------|---------|
| `HyperbetEVMClient` | BSC, AVAX | ethers.js v6 |
| `HyperbetSolanaClient` | Solana | @solana/web3.js + Anchor |
| `HyperbetStreamClient` | WebSocket | ws |

## RPC Fallback Defaults

| Chain | Default Public RPC |
|-------|-------------------|
| BSC | `https://bsc-dataseed.binance.org/` |
| AVAX | `https://api.avax.network/ext/bc/C/rpc` |
| Solana | `https://api.mainnet-beta.solana.com` |

Pass your own Alchemy, Helius, or QuickNode URLs via the config object for better performance.

## API

### `HyperbetEVMClient`
- `placeOrder({ duelId, side, price, amount, timeInForce, postOnly })` — Place a CLOB order. Defaults to `timeInForce: "gtc"` and `postOnly: false`.
- `cancelOrder({ duelId, orderId })` — Cancel an existing order
- `claim({ duelId })` — Claim winnings after resolution

### `HyperbetSolanaClient`
- `placeOrder({ duelId, side, price, amount })` — Place a CLOB order (derives PDAs automatically)
- `cancelOrder({ duelId, orderId })` — Cancel order
- `claim({ duelId })` — Claim winnings

### `HyperbetStreamClient`
- `connect()` — Open WebSocket connection
- `subscribe(callback)` — Register an event listener
- `disconnect()` — Close connection

## Development

```bash
bun install
bun run test      # Run vitest
bun run build     # Bundle with tsup
```
