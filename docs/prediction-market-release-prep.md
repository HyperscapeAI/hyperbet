# Prediction Market Release Prep

> **TL;DR:** As of 2026-03-25, the repo is materially stronger and now carries full-product phase-1 rails for `PM + internal AMM + perps` across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`, but the release train is still not deploy-only. The remaining blockers are truthful launch-chain mainnet registry values, staged environment provisioning, shared testnet token/address inputs, governance/evidence closeout, and the frozen audit packet plus external audit/remediation cycle.

This document is the reviewer-facing release summary for the current launch
closeout train on `audit/develop-pm-hardening`.

## Phase-1 Product Definition

- Launch chains: `Solana`, `BSC`, `AVAX`
- Non-blocking add-chain lane: `Base`
- User-facing surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- Production-critical internal surface:
  - `AMM` as a headless market-maker and liquidity engine, not a retail UI

## What Is Already Landed

- PM-core hardening is merged for oracle finality, order semantics, governance
  freezes, and protocol guardrails.
- AMM settlement truth is now oracle-only on both EVM and Solana.
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

### 1. Launch-chain canonical truth is incomplete

The launch gate remains correctly red because canonical mainnet registry values
are still missing for the phase-1 launch chains:

- `solana`: `goldAmmMarketProgramId`
- `bsc`: `goldAmmRouterAddress`, `mUsdTokenAddress`, `goldTokenAddress`,
  `skillOracleAddress`, `perpEngineAddress`
- `avax`: PM-core plus AMM and perps canonical fields

Those values must come from final mainnet deployment receipts only.

### 2. Staged proof and staged soak are structurally ready but operationally blocked

The workflows now expect a real staged environment contract. As of the latest
GitHub secret and variable audit:

- repo-level testnet deploy primitives exist
- there is no GitHub `staging` environment
- there are no `HYPERBET_*_STAGING_*` vars or secrets provisioned yet

That means GitHub staged proof and staged soak cannot run honestly yet.

### 3. Local Stage-A is only partially unblocked

Local non-mainnet deploy and verification are now feasible, but the full BSC
and AVAX AMM/perps rehearsal still needs shared token/address inputs:

- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
- `AVAX_FUJI_MUSD_TOKEN_ADDRESS`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
- `AVAX_FUJI_GOLD_TOKEN_ADDRESS`
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

- phase-1 launch scope is `Solana + BSC + AVAX`
- `Base` is non-blocking
- launch proof is `PM + perps + AMM`, not PM-only
- stage/testnet proof does not equal mainnet canonical truth
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
