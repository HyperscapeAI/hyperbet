# Prediction-Market Launch Freeze Tracker

> **TL;DR:** The repo now carries phase-1 full-product plumbing for `PM/CLOB duels + perps/models + internal AMM` plus the surrounding app shell and account surfaces, but the release train is still not deploy-only. The active production-readiness path is `Solana + BSC`; AVAX evidence is preserved but isolated and non-blocking. The remaining blockers are truthful active-scope registry population, staged environment provisioning, shared non-mainnet token/address inputs, full app-shell and account-surface closure, governance/evidence closeout, and the frozen audit packet plus external audit/remediation cycle.

Last updated: 2026-03-25

Detailed implementation work is tracked in:

- [GitHub Project Production Backlog](github-project-production-backlog.md)
- [Runtime Integration Readiness Matrix](runtime-integration-readiness-matrix.md)
- [Tracking Document Map](tracking-document-map.md)

## Current Position

- Active implementation train: `audit/develop-pm-hardening`
- Active production-readiness chains: `solana`, `bsc`
- Preserved but isolated follow-on lane: `avax`
- Non-blocking add-chain lane: `base`
- Implementation target: shared `EVM` runtime plus `SVM`, with `bsc` as the
  current active EVM proving wrapper
- Active off-mainnet rehearsal: `solana devnet`, `bsc testnet`
- User-facing launch surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- Internal launch-critical surface:
  - `AMM`

## Repo-Side Work Already Landed

- PM-core hardening for oracle finality, order semantics, governance freeze,
  and protocol guardrails
- repo artifact policy is enforced in CI, and the previously flagged tracked
  Solana deploy artifacts are no longer present in the tracked tree
- AMM settlement implementation is materially stronger than before, but the
  production settlement model still needs an explicit freeze between
  oracle-driven and challenge-window paths
- Solana perps pause preserved after freeze
- Solana full-product deploy, init, freeze, and verify rails now include AMM
- canonical EVM receipt writing for PM, AMM, and perps
- launch-scope staged proof canary results for `pm`, `perps`, and `amm`
- local Stage-A runner plus staged proof and soak workflow wiring
- launch-scope registry gating with `base` removed from phase-1 blocking scope

## Remaining Blockers

This document keeps the blocker summary and freeze posture. Detailed execution
ownership lives in the canonical backlog.

### 1. Canonical active-scope truth is still incomplete

Current missing launch-truth fields:

- active-scope launch constants still imply `avax` in places that should now
  reflect the parked-chain decision
- default feature flags still understate the intended active product surface
- `solana`
  - `goldAmmMarketProgramId`
- `bsc`
  - `goldAmmRouterAddress`
  - `mUsdTokenAddress`
  - `goldTokenAddress`
  - `skillOracleAddress`
  - `perpEngineAddress`
- `avax`
  - PM-core canonical fields
  - AMM canonical fields
  - perps canonical fields
  - governance and operator addresses from final receipts
  - preserved follow-on work; not blocking the current production-readiness path

### 2. Staged proof and staged soak are blocked on provisioning

Audited GitHub state as of 2026-03-25:

- deploy and testnet repo secrets exist
- no GitHub `staging` environment exists
- no `HYPERBET_*_STAGING_*` vars or secrets are provisioned

That means staged proof and soak are structurally ready but operationally
blocked.

### 3. Local Stage-A is waiting on shared token and address inputs

Still missing for honest active-scope BSC AMM/perps rehearsal:

- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
- optional perps margin token addresses when margin is not the GOLD token

### 4. Governance and audit evidence are still open

Still required:

- governance transfer receipts
- freeze receipts
- signer and key-rotation closeout
- staged proof artifact bundle
- staged soak artifact bundle
- RC freeze manifest
- external audit and remediation outputs

### 5. AMM settlement truth, coordinated full-product smoke, and app/account surface closure are still open

Still required:

- explicit production AMM settlement-model freeze
- audit-grade explanation or tightening of the Solana AMM settlement account
  posture
- one coordinated staged smoke and evidence bundle for the enabled full-product
  surfaces
- one frozen product contract for wallet/account, claims/positions, and
  points/referral surfaces on the active runtimes

## Ordered Next Steps

The ordered next steps are now owned by the canonical backlog and runtime
matrix. Use this document to verify that freeze posture and blocker summaries
still match those sources.
