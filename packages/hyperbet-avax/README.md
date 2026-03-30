# Hyperbet AVAX

> **TL;DR:** This package is the AVAX phase-1 app and keeper surface for user-facing `PM/CLOB duels` and `perps/models`, with `AMM` as an internal launch-critical engine. AVAX is a launch-blocking chain. Full-product Fuji deploy and verify rails now exist, but AVAX mainnet still lacks canonical PM, AMM, and perps truth in the shared chain registry.

## What Lives Here

- `app`: AVAX app shell for duels and models
- `keeper`: AVAX keeper and staged-proof canary implementation
- `deployments/contracts.json`: package-local receipt mirror for convenience

Production truth does **not** come from this package-local manifest. Use the
shared chain registry.

## Current Phase-1 Role

- launch-blocking chain: `yes`
- non-mainnet proving lane: `avax fuji`
- user-facing surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- internal launch-critical surface:
  - `AMM`

## Key Commands

From `packages/hyperbet-avax`:

```bash
bun run dev
bun run dev:testnet
bun run dev:mainnet
bun run test:e2e:local
bun run deploy:preflight:testnet
bun run deploy:preflight:mainnet
```

Representative full-product AVAX Fuji sequence:

```bash
bun run --cwd packages/evm-contracts deploy:create2:avax-fuji
bun run --cwd packages/evm-contracts deploy:amm:avax-fuji
bun run --cwd packages/evm-contracts deploy:perps:avax-fuji
node --import tsx packages/evm-contracts/scripts/verify-deployment.ts --network avaxFuji
```

## Current Blockers

AVAX launch remains blocked on canonical mainnet truth for:

- PM-core registry fields
- AMM canonical fields
- perps canonical fields
- governance and operator addresses from final receipts

Those values must be committed only after final mainnet deployment evidence is
available.
