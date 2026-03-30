# Hyperbet EVM

> **TL;DR:** This package is the shared EVM app and keeper runtime for `BSC`, `AVAX`, and the non-blocking `Base` add-chain lane. Phase-1 launch-critical EVM chains are `BSC` and `AVAX`. The shared EVM launch product is `PM/CLOB duels + perps/models`, with `AMM` as an internal engine. Canonical deploy truth still lives in the chain registry, not in package-local manifests.

## What This Package Is

- shared EVM app shell
- shared EVM keeper runtime
- common frontend and backend surface used by BSC and AVAX
- optional add-chain runtime for Base

## Phase-1 Scope

- launch-blocking EVM chains:
  - `BSC`
  - `AVAX`
- non-blocking add-chain lane:
  - `Base`

## Deploy And Verify Model

EVM deployment and verification live in `packages/evm-contracts`.

The current full-product sequence is:

1. PM CREATE2 deployment
2. AMM deployment
3. perps deployment
4. full-product verification
5. registry population from final receipts only

## Key Commands

From `packages/hyperbet-evm`:

```bash
bun run dev
bun run test:e2e:local
bun run keeper:service
bun run keeper:bot
```

Representative EVM deploys:

```bash
bun run --cwd packages/evm-contracts deploy:create2:bsc-testnet
bun run --cwd packages/evm-contracts deploy:amm:bsc-testnet
bun run --cwd packages/evm-contracts deploy:perps:bsc-testnet
node --import tsx packages/evm-contracts/scripts/verify-deployment.ts --network bscTestnet
```

## Canonical Truth

- authoritative runtime and deployment truth:
  `packages/hyperbet-chain-registry/src/index.ts`
- canonical EVM receipt writer:
  `packages/evm-contracts/scripts/deployment-receipt.ts`
- package-local manifests and env files are convenience surfaces, not canonical
  launch truth
