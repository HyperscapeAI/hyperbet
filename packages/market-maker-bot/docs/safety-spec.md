# Market-Maker Safety Specification

Version: `2026-03-11`

This specification defines the minimum risk posture that must hold for Solana, BSC, and AVAX before merge.

## Safety Objective

The market maker must remain solvent and operational under adversarial order flow, oracle/finality stress, and coordinated manipulation attempts.

## Scope

- Chains: `solana`, `bsc`, `avax`
- Scenario suite: latency, spoof, toxic flow, stale signal, liquidation, gas backrun, layering ladder, quote stuffing, cancel storm, sybil wash, sybil identity churn, rebate ring, coordinated resolution push
- Gate families:
  - mitigation threshold
  - invariants
  - baseline regression deltas
  - policy controls
  - bounded loss budgets
  - settlement state machine
  - sybil/collusion controls
  - adaptive attacker-policy controls
  - chaos-resilience controls
  - deterministic abuse matrix budgets
  - regression seed corpus
  - historical replay corpus

## Formal Budgets

Source of truth:

- `src/adversarial/spec.ts`
- `src/adversarial/matrix.ts`
- `src/adversarial/regression-seeds.json`
- `src/adversarial/replay-corpus.json`

The deterministic abuse matrix enforces:

- chain aggregate budgets:
  - total mitigated attacker PnL
  - total exploit events
  - total inventory stress
- scenario budgets:
  - max mitigated attacker PnL
  - max exploit events
  - max toxic fill rate
  - max adverse slippage bps
  - minimum attacker-PnL reduction ratio
  - required control mapping per scenario

## Merge Criteria

A PR is merge-ready only if all of these pass:

1. `bun run --cwd packages/market-maker-bot test`
2. `bun run --cwd packages/market-maker-bot simulate:adversarial:ci`
3. `bun run --cwd packages/market-maker-bot simulate:adversarial:seed-corpus`
4. `bun run --cwd packages/market-maker-bot simulate:adversarial:replay-corpus`
5. per-chain adversarial gates (`solana`, `bsc`, `avax`)
6. repository pre-PR checks (`node scripts/check-pr-ready.mjs`)

## Fork Harness

Fork integration harness is available via:

- `bun run --cwd packages/market-maker-bot verify:forks`

It is opt-in and executes only when one or more RPC env vars are set:

- `BSC_FORK_RPC_URL`
- `AVAX_FORK_RPC_URL`
- `SOLANA_FORK_RPC_URL`
