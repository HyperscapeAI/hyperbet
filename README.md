# Hyperbet

Private monorepo for Hyperbet betting, gambling, and futures products.

## Packages

- `packages/hyperbet-chain-registry`: shared chain/deployment registry for Solana and EVM prediction markets.
- `packages/hyperbet-solana`: Solana-focused betting stack copied from the current betting workspace.
- `packages/hyperbet-bsc`: BSC-focused betting stack copied from the current betting workspace.
- `packages/hyperbet-avax`: Avalanche-focused betting shell and keeper.
- `packages/evm-contracts`: Hyperbet-owned EVM contracts for CLOB and futures flows.
- `packages/market-maker-bot`: optional automated market-maker and wallet export tooling for Hyperbet environments.

## Relationship To Hyperscape

The game stays in the `hyperscape` monorepo.

Hyperbet consumes duel arena oracle artifacts published from Hyperscape:

- Solana oracle IDL/types
- EVM duel outcome oracle ABI/artifacts

## Commands

```bash
bun run dev:doctor
bun run dev:bootstrap
bun run build
bun run dev:solana
bun run dev:bsc
bun run dev:avax
bun run dev:local:solana
bun run dev:local:bsc
bun run dev:local:avax
```

Deployment runbook:

- `docs/hyperbet-production-deploy.md`
- `docs/development-setup.md`
