# Prediction-Market Test Flow

Run tests in increasing cost order and stop at the first failure.

```bash
bun install --frozen-lockfile
bun run ci:env
bun run ci:scope:solana
bun run ci:gate:registry:launch
bun run typecheck
bun run --cwd packages/hyperbet-solana/keeper test:launch
bun run --cwd packages/hyperbet-ui test
bun run ci:gate:solana:build
bun run ci:gate:solana
bun run ci:gate:e2e:solana
bun run build
bun run ci:prepr
```

The browser gate must cover both sides of an order, legal close timing, oracle proposal/finality, winner claim, loser cleanup, cancellation refund, keeper restart, RPC-proxy restart, and disabled-route 404 behavior.

Public devnet/testnet browser acceptance is read-only:

```bash
E2E_GAME_API_URL=https://keeper.example \
SOLANA_RPC_URL=https://rpc.example \
bun run --cwd packages/hyperbet-solana/app test:e2e:devnet
```

The public harness refuses mainnet and does not submit transactions.
