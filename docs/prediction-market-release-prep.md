# Prediction Market Release Prep

> **TL;DR:** As of 2026-03-25, the repo is materially stronger and now carries full-product phase-1 rails for `PM + internal AMM + perps` plus the surrounding app shell and account surfaces that users actually touch. The active production-readiness gate is `Solana devnet + BSC testnet`; AVAX Fuji evidence is preserved but isolated and non-blocking. The remaining blockers are truthful active-scope registry values, staged environment provisioning, shared testnet token/address inputs, app-shell and account-surface closure, governance/evidence closeout, and the frozen audit packet plus external audit/remediation cycle.

This document is the reviewer-facing release summary for the current launch
closeout train on `audit/develop-pm-hardening`.

Detailed implementation work is tracked in:

- [GitHub Project Production Backlog](release/github-project-production-backlog.md)
- [Runtime Integration Readiness Matrix](release/runtime-integration-readiness-matrix.md)
- [Tracking Document Map](release/tracking-document-map.md)

## Phase-1 Product Definition

- Active production-readiness chains: `Solana`, `BSC`
- Preserved but isolated follow-on lane: `AVAX`
- Non-blocking add-chain lane: `Base`
- Implementation target: shared `EVM` runtime plus `SVM`, with `BSC` as the
  current active EVM proving wrapper
- User-facing surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- Production-critical internal surface:
  - `AMM` as a headless market-maker and liquidity engine, not a retail UI

## What Is Already Landed

- PM-core hardening is merged for oracle finality, order semantics, governance
  freezes, and protocol guardrails.
- repo artifact policy is enforced in CI, and the previously flagged tracked
  Solana deploy artifacts are no longer present in the tracked tree.
- AMM settlement implementation is materially stronger than before, but the
  production settlement model still needs an explicit freeze between
  oracle-driven and challenge-window paths.
- Solana perps pause remains callable after freeze.
- Solana full-product deploy, init, freeze, and verify paths now include
  `lvr_amm`.
- EVM deploy receipts now write canonical registry-shaped PM, AMM, and perps
  fields.
- Staged proof is no longer PM-only. The canary surface now emits `pm`,
  `perps`, and `amm` results per chain.
- Local Stage-A bring-up, staged proof, soak, AMM gates, and perps gates are
  wired into the repo scripts and workflows.
- Base has been demoted to a non-blocking add-chain lane for phase-1 release
  gating.

## What Is Still Blocking

Detailed execution tickets for every blocker below live in the canonical
backlog. This document is the summary view, not the issue owner.

### 1. Active launch-chain canonical truth is incomplete

Strict active-scope canonical truth is still incomplete, even though the
develop-side Stage-A closeout gate now validates the real PR contract for
`Solana devnet + BSC testnet` while AVAX is intentionally isolated:

- active-scope launch constants still imply `avax` in places that should now
  reflect the parked-chain decision
- default feature flags still understate the intended active product surface
- `solana`: `goldAmmMarketProgramId`
- `bsc`: `goldAmmRouterAddress`, `mUsdTokenAddress`, `goldTokenAddress`,
  `skillOracleAddress`, `perpEngineAddress`
- `avax`: PM-core plus AMM and perps canonical fields remain preserved
  follow-on work and are not blocking the current production-readiness path

Those values must still come from final mainnet deployment receipts only before
any true launch promotion to `main` or `staging`.

### 2. Staged proof and staged soak are structurally ready but operationally blocked

The workflows now expect a real staged environment contract. As of the latest
GitHub secret and variable audit:

- repo-level testnet deploy primitives exist
- there is no GitHub `staging` environment
- there are no `HYPERBET_*_STAGING_*` vars or secrets provisioned yet

That means GitHub staged proof and staged soak cannot run honestly yet.

### 3. Local Stage-A is only partially unblocked

Local non-mainnet deploy and verification are now feasible, but the active BSC
AMM/perps rehearsal still needs shared token/address inputs:

- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
- optional perps margin token addresses when margin is not the GOLD token

### 4. Governance and audit evidence are not complete

The repo-side governance and freeze logic is much closer to launch grade, but
the final package still needs:

- ownership transfer and freeze transaction evidence
- signer and key-rotation closeout
- staged proof artifact bundles
- soak artifact bundles
- final RC freeze manifest
- external audit findings and remediation output

### 5. AMM settlement truth, coordinated full-product smoke, and full app-shell closure are not yet closed

- the EVM AMM still exposes both `settleMarket()` and `settleFromOracle()`
- the Solana AMM settlement path still carries compatibility-oriented optional
  account handling that needs either tighter validation or an audit-grade
  rationale
- PM has the strongest live evidence today; coordinated staged smoke and
  evidence for the full active product destination still need to be frozen
- wallet/account, points/referral, and broader app-shell product claims still
  need one frozen acceptance and support contract for the active runtimes

## Gold Asset Boundary

Gold is currently tracked as a separate architecture concern, not a phase-1
launch blocker for PM, AMM, perps, or market-maker audit readiness.

- the current launch protocols already settle in native assets or designated
  collateral tokens
- Solana still carries the meaningful `goldMint` surface
- the long-term `Hyperscapes Gold -> Solana Gold -> future multi-chain Gold`
  model still needs a dedicated asset architecture spec

For the current-state interpretation and the follow-on spec-planning document,
see:

- [Gold current state](protocol/gold-current-state.md)
- [Gold architecture spec plan](protocol/gold-architecture-spec-plan.md)

## Current Reviewer Checklist

Reviewers should verify that the repo now reflects these truths consistently:

- active production-readiness scope is `Solana + BSC`
- AVAX is preserved but isolated and non-blocking
- `Base` is non-blocking
- `BSC` is the active EVM wrapper, not the exclusive EVM implementation target
- launch destination is `PM + perps + internal AMM`, not PM-only
- active launch scope includes the application shell and account surfaces
  around those products, not only the underlying market engines
- stage/testnet proof does not equal mainnet canonical truth
- AMM settlement-model closure and coordinated full-product smoke are still
  open blockers
- launch remains blocked on registry truth, staged env provisioning, and audit
  evidence

## Source Documents

- [Launch execution plan](release/pm-launch-execution-plan.md)
- [Launch freeze tracker](release/prediction-market-launch-freeze-tracker.md)
- [Launch-ops evidence index](release/launch-ops-evidence-index.md)
- [Production deploy guide](hyperbet-production-deploy.md)
- [Gold current state](protocol/gold-current-state.md)
- [Gold architecture spec plan](protocol/gold-architecture-spec-plan.md)
- [Runbook index](runbooks/README.md)
- [External audit package checklist](release/external-audit-package-checklist.md)
