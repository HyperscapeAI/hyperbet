# Hyperbet

> **TL;DR:** Phase-1 launch scope is `Solana`, `BSC`, and `AVAX` with user-facing `PM/CLOB duels` and `perps/models`, plus `AMM` as an internal market-maker/liquidity engine. `Base` remains a non-blocking add-chain lane. The repo now has full-product non-mainnet deploy, verify, proof, and soak rails, but launch is still blocked on canonical mainnet registry truth, staged environment provisioning, governance/evidence closeout, and the external audit/remediation cycle.

Private monorepo for Hyperbet betting, prediction-market, and perps products.

## Current State

- Active launch-closeout branch: `audit/develop-pm-hardening`
- Canonical deployment source of truth: `packages/hyperbet-chain-registry`
- Current release posture: not deploy-only yet
- Off-mainnet status: full-product Stage-A rails exist for Solana devnet, BSC testnet, and AVAX Fuji
- Launch blockers:
  - missing canonical launch-chain mainnet fields in the chain registry
  - missing staged GitHub environment vars and secrets for proof and soak
  - missing shared BSC and AVAX testnet token address inputs for AMM and perps rehearsal
  - governance transfer, freeze evidence, and audit handoff artifacts

## Packages

- `packages/hyperbet-chain-registry`: shared deployment and runtime registry for Solana and EVM launch surfaces
- `packages/hyperbet-solana`: Solana programs, app, keeper, deploy, init, and verify scripts for PM, AMM, and perps
- `packages/hyperbet-bsc`: BSC app and keeper shell for the shared EVM PM, AMM, and perps stack
- `packages/hyperbet-avax`: AVAX app and keeper shell for the shared EVM PM, AMM, and perps stack
- `packages/hyperbet-evm`: canonical shared EVM app and keeper runtime used across BSC, AVAX, and Base
- `packages/evm-contracts`: Hyperbet-owned EVM contracts plus deploy and verify scripts for PM, AMM, and perps
- `packages/market-maker-bot`: internal market-maker and adversarial simulation tooling

## Relationship To Hyperscape

The game remains in the `hyperscape` monorepo.

Hyperbet consumes duel arena oracle artifacts published from Hyperscape:

- Solana oracle IDL and types
- EVM duel outcome oracle ABI and artifacts

## Core Commands

```bash
bun run dev:doctor
bun run dev:bootstrap
bun run build
bun run stagea:local
bun run staged:proof -- --mode=read-only --target=all
bun run staged:proof -- --mode=canary-write --target=all
bun run pm:soak -- --mode=local --follow --duration-min=25
bun run pm:soak:harness -- --duration-min=25
```

## Source Docs

- [Launch execution plan](docs/release/pm-launch-execution-plan.md)
- [Launch freeze tracker](docs/release/prediction-market-launch-freeze-tracker.md)
- [Release prep](docs/prediction-market-release-prep.md)
- [Staged proof runbook](docs/runbooks/staged-live-proof.md)
- [Soak runbook](docs/runbooks/pm-confidence-soak.md)
