# Enoomian EVM Standardization Decisions

> **TL;DR:** Historical decision log for the `enoomian/prediction-market-sprint-base` EVM standardization work. Status: closed. Useful as architecture history, but not the current branch or launch authority. Current release truth lives in the launch execution plan, freeze tracker, and chain registry.

> Current open-work ownership now lives in [`docs/release/tracking-document-map.md`](release/tracking-document-map.md) and [`docs/release/github-project-production-backlog.md`](release/github-project-production-backlog.md).

This document records the authoritative keep/adapt/reject decisions for the
`hyperbet-evm-parity-sweep` assimilation work as it has been standardized onto
the local `enoomian/prediction-market-sprint-base`.

## Purpose / Status

- This is the tracked decision log for the EVM parity assimilation gate.
- It began as a review of the imported replay direction represented by:
  - `57d940d`
  - `f51898d`
  - `1604da6`
  - `c920f0a`
  - `c699c97`
  - `ec8e5f7`
- It now also records the local sprint-base standardization work through:
  - `13e772f`
  - `935caf1`
  - `c40967b`
  - `0035401`
  - `3347a14`
  - `5321ba2`
  - `71f4d0f`
- It is the authoritative keep/adapt/reject record for this gate.

## Current Branch Standard

The following remain authoritative today and must not regress:

- `@hyperbet/chain-registry` is the only deployments/runtime source of truth.
- The hardened BSC, AVAX, and Solana keepers, plus the rebuilt
  `hyperbet-evm/keeper`, define the current backend standard.
- The current release-hardening rails remain authoritative:
  - fast CI
  - heavyweight prediction-market gates
  - deploy/proof workflows
  - `scripts/ci-*`
- AVAX remains intentionally fail-closed until canonical production truth
  exists.
- The current operational/runtime surfaces stay canonical:
  - `/status`
  - `/api/arena/prediction-markets/active`
  - `/api/keeper/bot-health`
  - `build-info.json`

## Non-Negotiable Standards

- One deployments/config source of truth only.
- No regression in external-bet security, economics integrity, or duplicate
  protection.
- No regression in lifecycle, claimability, or bot-health surfaces.
- No new canonical surface may exist outside the required CI/deploy coverage.
- Wrapper convergence must never outrun backend/runtime correctness.

## Decision Register Summary

| Subsystem | Decision | Status | Standard To Preserve | Follow-Up |
| --- | --- | --- | --- | --- |
| `packages/hyperbet-deployments` | Keep as materialization layer only | Adapt | `@hyperbet/chain-registry` authority | Phase 1 complete |
| `packages/hyperbet-evm/app` | Keep as canonical EVM app-shell direction | Keep | current shared UI/runtime correctness | Phase 2 complete |
| `packages/hyperbet-evm/keeper` | Rebuild on hardened keeper core, then keep | Adapt | current hardened keeper semantics | Phases 3-4 complete |
| `packages/hyperbet-evm/deployments` | Route through one deployment authority only | Adapt | no duplicate resolver truth | Phase 1 complete |
| Shared UI/theme/chart/storybook additions | Keep | Keep | current lifecycle/claim correctness | Phase 2 complete |
| Perps/contracts reconciliation | Keep selectively after newer finality-model reconciliation | Adapt | current contract proof/security bar | contract-focused follow-up |
| Wrapper convergence changes | Keep only after canonical app shell and canonical keeper exist | Adapt | current wrapper runtime/deploy safety | Phase 6 safe shell convergence complete |

## Detailed Decisions

### 1. `packages/hyperbet-deployments`

- Decision: `Adapt`
- Status: `Implemented locally`
- Why:
  - The imported package is useful as a materialized/export layer.
  - It is not acceptable as a second deployments authority.
- Evidence:
  - `packages/hyperbet-chain-registry/src/index.ts` already defines runtime
    deployment resolution.
  - `packages/hyperbet-deployments/index.ts` now materializes from the registry
    instead of competing with it.
- Standard to preserve:
  - `@hyperbet/chain-registry` remains the single authoritative source of
    runtime/deploy truth.
- Follow-up gate:
  - none required for authority collapse
  - future work is ordinary maintenance, not canonization

### 2. `packages/hyperbet-evm/app`

- Decision: `Keep`
- Status: `Implemented locally`
- Why:
  - The additive EVM app shell is directionally correct.
  - It compiles against the sprint branch and fits the shared theme/runtime
    direction.
- Evidence:
  - local validation passed for:
    - `packages/hyperbet-evm/app`
    - `packages/hyperbet-ui`
    - BSC and AVAX app shells
- Standard to preserve:
  - current lifecycle, claim-state, and shared UI correctness from the sprint
    branch
- Follow-up gate:
  - wrapper cleanup only; app-shell canonization itself is complete

### 3. `packages/hyperbet-evm/keeper`

- Decision: `Adapt`
- Status: `Implemented locally`
- Why:
  - The imported keeper was behind the sprint branch's keeper/runtime security
    model and was not acceptable as-is.
  - It is acceptable only because it has been rebuilt on top of the hardened
    shared EVM keeper core from the current branch.
- Evidence:
  - imported behavior was rejected for:
    - weaker external-bet behavior
    - missing normalized lifecycle/health surfaces
    - backend drift from hardened BSC/AVAX semantics
  - the local sprint-base standardization now includes:
    - `packages/hyperbet-evm-keeper-core`
    - rebuilt `packages/hyperbet-evm/keeper/src/service.ts`
    - canonical `src/bot.ts` and `src/common.ts`
    - CI validation coverage for `packages/hyperbet-evm/**`
- Standard to preserve:
  - current external-bet verification
  - canonicalized tx-derived economics
  - fallback winner preservation
  - duplicate-safe persistence
  - current lifecycle and bot-health APIs
- Follow-up gate:
  - operational rollout review
  - deploy-surface adoption decisions

### 4. `packages/hyperbet-evm/deployments`

- Decision: `Adapt`
- Status: `Implemented locally`
- Why:
  - It is acceptable as a convenience layer only if it stops competing with the
    chain registry.
- Evidence:
  - `packages/hyperbet-evm/deployments/index.ts` now routes through the
    standardized deployments materialization path instead of acting as an
    independent deployments authority.
- Standard to preserve:
  - no duplicated deployment resolver authority
- Follow-up gate:
  - none beyond ordinary upkeep

### 5. Shared UI/theme/chart/storybook additions

- Decision: `Keep`
- Status: `Implemented locally`
- Why:
  - These are additive improvements that fit the sprint branch's shared UI
    direction.
  - They passed local validation without regressing the existing app shells.
- Evidence:
  - local `@hyperbet/ui` tests passed
  - Storybook build passed
  - BSC, AVAX, and `hyperbet-evm` app typechecks/builds passed
- Standard to preserve:
  - current lifecycle- and claim-state correctness
  - no regression in Solana/BSC/AVAX shell behavior
- Follow-up gate:
  - none beyond normal UI maintenance

### 6. Perps/contracts reconciliation

- Decision: `Adapt`
- Status: `Partially implemented locally`
- Why:
  - The imported perps/contracts work is directionally useful, but it sits on
    top of a newer finality/oracle model in the sprint branch and cannot be
    treated as an unreviewed carry-over.
- Evidence:
  - the replay required manual reconciliation in:
    - `packages/evm-contracts/scripts/deploy.ts`
    - `packages/evm-contracts/test/GoldClob.ts`
  - perps Foundry tests passed locally after that reconciliation
- Standard to preserve:
  - current contract proof/security expectations
  - newer oracle finality model
- Follow-up gate:
  - contract-focused review and rollout decision

### 7. Wrapper convergence changes

- Decision: `Adapt`
- Status: `Safe shell convergence complete locally`
- Why:
  - Thinner wrappers are the right end state.
  - They were only accepted after the canonical app shell and canonical keeper
    were made real.
- Evidence:
  - AVAX now consumes shared theme/chart components and app root semantics
  - BSC now follows the same shared theme preload/root identity pattern
  - obsolete AVAX-local `HmChart` and `ThemeSelector` wrappers were removed
- Standard to preserve:
  - current wrapper runtime/deploy semantics
  - AVAX fail-closed posture
- Follow-up gate:
  - deeper wrapper retirement is a future cleanup decision, not a blocker to
    the standardized baseline

## Standardization Phases

### Phase 1: Deployment Materialization Without Competing Authority

Status:
- Complete locally

Goal:
- keep the useful materialization/export idea
- prevent it from competing with `@hyperbet/chain-registry`

Required changes:
- make `packages/hyperbet-deployments` a generated/materialized layer
- remove duplicate long-term resolver authority from that package
- ensure `hyperbet-evm` consumes the registry directly or through that
  materialized view

Success criteria:
- one authoritative deployments model remains
- no co-equal deployment resolver implementations remain

### Phase 2: Canonical EVM App Shell

Status:
- Complete locally

Goal:
- promote `packages/hyperbet-evm/app` as the canonical EVM app shell

Required changes:
- keep the imported app shell
- align docs so it is canonical in the app/runtime-shell layer only
- preserve current shared UI/runtime correctness from the sprint branch
- keep BSC/AVAX wrappers functioning as branded shells

Success criteria:
- `hyperbet-evm/app` is clearly the canonical EVM app shell
- wrapper shells align to the shared theme/root contract

### Phase 3: Hardened Shared EVM Keeper Core

Status:
- Complete locally

Goal:
- make the current sprint keeper semantics the future EVM backend standard

Required changes:
- extract shared EVM keeper modules from the hardened BSC/AVAX keepers
- include:
  - normalized lifecycle/health APIs
  - external-bet verification and economics integrity
  - fallback winner preservation
  - points/referral integrity
  - bot-health/status shaping

Success criteria:
- a hardened shared EVM keeper core exists
- BSC/AVAX keepers remain identical or stricter in behavior

### Phase 4: Canonical `hyperbet-evm/keeper`

Status:
- Complete locally

Goal:
- rebuild `packages/hyperbet-evm/keeper` on the hardened EVM keeper core

Required changes:
- replace imported legacy behavior with current hardened semantics
- require parity with:
  - `/status`
  - `/api/arena/prediction-markets/active`
  - `/api/keeper/bot-health`
  - strict external-bet handling
  - duplicate-safe persistence
  - current reward/referral integrity

Success criteria:
- `hyperbet-evm/keeper` reaches parity with hardened BSC/AVAX keepers
- only then may it be described as canonical backend/runtime

### Phase 5: CI And Deploy Integration

Status:
- Complete locally for CI path recognition
- deploy-rail adoption remains aligned to the existing sprint topology

Goal:
- make the new canonical EVM surfaces first-class in the branch's proof model

Required changes:
- expand CI and heavy gate path filters to include:
  - `packages/hyperbet-evm/**`
  - the retained deployment materialization package, if any
  - the shared EVM keeper core package
- add required checks for canonical EVM app/keeper surfaces
- preserve current deploy topology and AVAX fail-closed semantics

Success criteria:
- no canonical EVM surface can change outside required CI/deploy coverage

### Phase 6: Wrapper Convergence After Canonicalization

Status:
- Safe shell-level convergence complete locally
- full wrapper retirement remains intentionally deferred

Goal:
- make BSC/AVAX wrappers thin only after the canonical app shell and canonical
  keeper are real

Required changes:
- converge wrappers only after Phases 2 and 4 are complete
- keep wrapper-specific:
  - branding
  - env presets
  - deployment entrypoints
  - chain-specific copy/docs

Success criteria:
- wrappers get thinner without runtime or deploy regression
- AVAX remains fail-closed until separately canonicalized

## Required Verification

### Deployment/materialization

- chain-registry tests
- materialization/export package tests
- no duplicate authority checks

### EVM app shell

- `@hyperbet/ui` tests
- Storybook build
- `packages/hyperbet-evm/app` typecheck/build
- BSC/AVAX app typechecks/builds

### EVM keeper core / canonical keeper

- keeper typechecks
- external-bet auth/idempotency/economics tests
- fallback winner tests
- lifecycle/health surface tests

### CI/deploy integration

- workflow/path-filter sanity
- env-audit checks
- no regressions in existing required gates

## Bottom Line

The imported branch was useful as a design harvest, but not safe as a
wholesale replacement baseline.

The local sprint-base canonization now captures the useful parts as the new
standard while preserving the existing hardened truth:

- `@hyperbet/chain-registry` remains the one authority
- `hyperbet-evm/app` is the canonical EVM app shell
- `hyperbet-evm/keeper` has been rebuilt on the hardened EVM keeper core
- CI recognizes the canonical EVM surfaces
- wrapper convergence is complete at the safe shell level

What remains after this document is no longer canonization of the imported
branch itself, but ordinary follow-on engineering and rollout decisions.

## Maintenance Rules

- Update this document whenever a keep/adapt/reject decision changes.
- Update it before promoting any additional imported EVM parity-sweep
  subsystem to canonical status.
- Do not change canonical claims in READMEs or architecture docs without also
  updating this log.
