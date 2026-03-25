# Hyperbet BSC

> **TL;DR:** This package is the BSC phase-1 app and keeper surface for user-facing `PM/CLOB duels` and `perps/models`, with `AMM` running as an internal engine behind the same launch train. BSC is a launch-blocking chain. Full-product BSC testnet deploy and verify rails now exist, but canonical BSC mainnet AMM and perps fields are still missing from the shared chain registry.

## What Lives Here

- `app`: BSC app shell for duels and models
- `keeper`: BSC keeper and staged-proof canary implementation
- `deployments/contracts.json`: package-local receipt mirror for convenience

Production truth does **not** come from this package-local manifest. Use the
shared chain registry.

## Current Phase-1 Role

- launch-blocking chain: `yes`
- non-mainnet proving lane: `bsc testnet`
- user-facing surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- internal launch-critical surface:
  - `AMM`

## Key Commands

From `packages/hyperbet-bsc`:

```bash
bun run dev
bun run dev:testnet
bun run dev:mainnet
bun run test:e2e:local
bun run deploy:preflight:testnet
bun run deploy:preflight:mainnet
```

Representative full-product BSC testnet sequence:

```bash
bun run --cwd packages/evm-contracts deploy:create2:bsc-testnet
bun run --cwd packages/evm-contracts deploy:amm:bsc-testnet
bun run --cwd packages/evm-contracts deploy:perps:bsc-testnet
node --import tsx packages/evm-contracts/scripts/verify-deployment.ts --network bscTestnet
```

## Current Blockers

The remaining BSC launch-truth gaps are the canonical mainnet values for:

- `goldAmmRouterAddress`
- `mUsdTokenAddress`
- `goldTokenAddress`
- `skillOracleAddress`
- `perpEngineAddress`

Those fields must come from final mainnet receipts, not guesswork.
