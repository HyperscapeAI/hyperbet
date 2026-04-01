# Hyperbet Production Readiness Audit - 2026-03-29

> **TL;DR:** Hyperbet is materially stronger and already proves real non-mainnet browser-to-chain betting flows, but it is not yet production-ready for a real-money Hyperscapes betting launch. The biggest remaining gaps are keeper and public-API perimeter hardening, a pinned and consistently enforced `Hyperscapes -> Hyperbet` integration contract, canonical launch-chain registry truth, staged and production environment provisioning, shared app-shell and account-surface closure, governance custody and freeze evidence, durable keeper operations, external audit package completion, and betting-product operational controls that do not yet exist in the repo.

## Purpose

This document is the production-readiness audit snapshot for the Hyperbet repo as
of `2026-03-29`.

It answers two questions:

1. what is already strong enough to keep
2. what still has to be built, proven, or operated before Hyperbet can be
   treated as a production betting product for Hyperscapes

This audit covers:

- code and release artifacts in this repo
- repo-adjacent operational work explicitly referenced by the repo
- betting-product workstreams that are not yet represented in code but are
  required for a real production launch

This audit does **not** redefine product scope, but it does make the current
production-readiness gate explicit:

- active production-readiness scope is `Solana` and `BSC`
- `AVAX` remains a preserved but isolated lane; existing work and evidence stay
  in place, but AVAX-specific gaps do not block the current readiness decision
- `Base` remains a non-blocking add-chain lane
- implementation target remains runtime-family based: shared `EVM` plus `SVM`,
  with `BSC` serving as the current active EVM wrapper rather than the
  long-term exclusive EVM chain target
- user-facing surfaces remain `PM/CLOB duels` and `perps/models`
- `AMM` remains an internal market-making surface, not a retail browser surface

Detailed execution ownership now lives in:

- [GitHub Project Production Backlog](github-project-production-backlog.md)
- [Runtime Integration Readiness Matrix](runtime-integration-readiness-matrix.md)
- [Tracking Document Map](tracking-document-map.md)

## Evidence Base

Primary source documents for this audit:

- [Tracking Document Map](tracking-document-map.md)
- [Runtime Integration Readiness Matrix](runtime-integration-readiness-matrix.md)
- [Prediction Market Release Prep](../prediction-market-release-prep.md)
- [Launch Ops Evidence Index](launch-ops-evidence-index.md)
- [Prediction-Market Launch Freeze Tracker](prediction-market-launch-freeze-tracker.md)
- [Stage-A Browser Acceptance Matrix](stage-a-browser-acceptance-matrix.md)
- [Residual Risk Register](residual-risk-register.md)
- [Threat Model](threat-model.md)
- [PM Launch Execution Plan](pm-launch-execution-plan.md)
- [External Audit Package Checklist](external-audit-package-checklist.md)
- [Hyperbet Production Deploy](../hyperbet-production-deploy.md)
- [Cross-Chain Parity Matrix](../protocol/cross-chain-parity-matrix.md)
- [Perps EVM/SVM Parity Matrix](../perps-parity-matrix.md)
- [Hyperbet System Design Alignment](../system-design-alignment.md)
- [Contract Privileged Surface Inventory](contract-privileged-surface-inventory.md)
- [Hyperscapes Local PM Integration](../runbooks/hyperscapes-local-pm-integration.md)
- [Prediction-Market Test Flow](../runbooks/prediction-market-test-flow.md)

The board-ready follow-on backlog lives in
[GitHub Project Production Backlog](github-project-production-backlog.md).

## Canonical Tracking Contract

- this document owns the production-readiness verdict and blocker inventory
- the backlog owns detailed implementation work
- the runtime matrix owns the answer to “is the end-to-end loop actually
  running?”
- historical ledgers and branch-era plans preserve evidence, but do not own
  current blockers

## Executive Summary

### What is already true

- Stage-A non-mainnet proving is real, not paper-only.
- Direct protocol canaries exist across the phase-1 product surfaces.
- Browser-to-chain acceptance exists against real deployed Stage-A chains.
- The real Hyperscapes duel lane has been proven locally and is documented.
- Repo artifact policy is enforced in CI, and the previously flagged tracked
  Solana deploy artifacts are no longer present in the tracked tree.
- Governance freeze and pause controls are materially stronger than the earlier
  convergence baseline.
- The repo now contains credible release, ops, threat, and audit-prep
  documentation.
- Existing AVAX deployments and investigation work are preserved, but AVAX is
  no longer on the current production-critical path.

### What is still blocking production readiness

- Keeper and public-API auth hardening is incomplete and contains verified
  launch-blocking gaps.
- The `Hyperscapes -> Hyperbet` feed contract is only partially versioned and is
  enforced asymmetrically across keeper variants.
- Active launch-chain registry truth is incomplete for `Solana` and `BSC`, and
  the active-scope constants and default feature truth still drift from the
  current `BSC + Solana` contract;
  AVAX registry completion remains non-blocking while the chain is isolated.
- GitHub staged environment and staged proof/soak provisioning are incomplete.
- Governance custody, ownership transfer, upgrade-authority transfer, and final
  freeze evidence are incomplete.
- Shared wallet/account surfaces, points/referrals product claims, and full
  app-shell acceptance are not yet frozen as one launch-grade contract.
- The AMM settlement model and coordinated full-product staged smoke are not
  yet frozen to one audit-grade truth.
- Keeper persistence, observability, alerting, reconciliation, and rollback
  posture are not yet production-grade.
- The external audit packet is not complete and a remediation closeout loop has
  not been demonstrated from a frozen RC.
- The repo does not yet cover the full legal, compliance, treasury, support,
  and incident-management obligations of a real betting product.

### Overall assessment

Current maturity: **Moderate with launch-blocking perimeter and integration flaws**

Release posture: **strong testnet acceptance, not yet production-ready**

## Current Green State

The following areas should be treated as already landed and should not be
re-opened without a concrete regression:

- Stage-A browser acceptance for the current branch scope
- real-duel local Hyperscapes integration lane
- direct canary and verification rails
- launch-scope release docs and freeze tracking
- EVM governance freeze posture
- Solana freeze and pause posture
- explicit distinction between browser surfaces and internal AMM operations

## AVAX Scope Decision

AVAX is not being undone, removed, or denied as future scope. The current
decision is narrower:

- keep existing AVAX code, deployments, and evidence intact
- stop treating AVAX incompleteness as a blocker for the current
  production-readiness path
- do not open new AVAX-specific critical-path work unless the lane is
  intentionally reactivated

## Security Findings Snapshot

The following findings were verified directly against the current repo snapshot
and should be treated as production blockers, not abstract “audit later” work.

| Severity | Finding | Evidence | Production impact |
|---|---|---|---|
| Critical | BSC, Solana, and AVAX keepers fail open when `ARENA_WRITE_KEY` is unset. | `requireWriteAuth()` returns `true` on missing key in `packages/hyperbet-bsc/keeper/src/service.ts`, `packages/hyperbet-solana/keeper/src/service.ts`, and `packages/hyperbet-avax/keeper/src/service.ts`; the canonical EVM keeper already rejects this state in `packages/hyperbet-evm/keeper/src/service.ts`. | Unauthorized callers can reach write paths such as invite redeem, wallet link, external bet recording fallback, and stream publish if deployment envs omit the key. This is an active blocker for `BSC` and `Solana`; AVAX remains isolated and therefore non-blocking in the current launch gate. |
| High | The Solana sender proxy treats browser `Origin` as authorization. | `handleSolanaSenderProxy()` in `packages/hyperbet-solana/keeper/src/service.ts` allows requests from any allowed origin even without the write key. | A forged client can relay whitelisted Hyperbet Solana transactions through the keyed sender proxy, turning the keeper into an open relay. |
| High | Public RPC proxies do not enforce a read-only method allowlist. | `handleSolanaRpcProxy()` and `handleEvmRpcProxy()` in the keeper services validate JSON-RPC shape and cache TTLs, but do not restrict forwarded methods. | Public clients can consume keyed upstream quota with arbitrary JSON-RPC methods and widen the externally reachable provider surface beyond the documented “read-only proxy” contract. |
| High | Most keepers still trust the legacy raw Hyperscapes stream instead of the newer versioned betting-feed contract. | The local EVM runner wires `BET_SYNC_SOURCE_STATE_URL` and `BET_SYNC_SOURCE_EVENTS_URL` to `/api/internal/bet-sync/*` in `scripts/run-hyperscapes-pm-local.sh`, and Hyperscapes emits `schemaVersion`, `sourceEpoch`, `seq`, `phaseVersion`, and `rendererHealth` from `packages/server/src/routes/streaming-betting-routes.ts`; meanwhile BSC, Solana, and AVAX still ingest `/api/streaming/state` through permissive `toStreamState()` parsers in their keeper services. | Upstream feed drift, replay/reset events, or source-epoch changes can degrade into silent keeper desync instead of a fail-closed integration error. This is launch-blocking for the active `BSC` and `Solana` scope; AVAX remains a preserved follow-on lane. |

## Maturity Scorecard

| Category | Rating | Notes |
|---|---|---|
| Arithmetic safety | Moderate | Strong parity and guardrail work exists, but precision and edge-case follow-through is still tracked in hardening plans and exploit coverage. |
| Auditing and observability | Weak | Audit-prep docs exist, but staged evidence, production telemetry, alerting, and incident response automation are incomplete. |
| Authentication and access control | Weak | Governance freeze is materially improved, but live custody transfer is incomplete and the keeper perimeter still has verified fail-open write auth and proxy-trust gaps. |
| Complexity management | Moderate | The architecture direction is clear, but BSC/AVAX wrappers, keeper boundaries, and the Hyperscapes feed contract are still converging toward one canonical runtime contract. AVAX is currently isolated from the active delivery path rather than treated as a gate. |
| Decentralization and custody | Weak | Production governance posture still depends on finishing multisig/timelock rollout and final registry-backed custody truth. |
| Documentation | Satisfactory | Release, threat, parity, and runbook coverage is strong, but production checklists still point to unfinished evidence and freeze outputs. |
| Transaction-ordering risk | Moderate | Risks are understood and documented, but they are largely accepted-risk mitigations rather than full protections. |
| Low-level and unsafe primitives | Satisfactory | No broad low-level red flags dominate the current codebase, but some generated and operational edges still need cleanup. |
| Testing and verification | Moderate | Non-mainnet proving is unusually strong, but staged proof, staged soak, frozen audit packet, and some adversarial gaps remain open. |

## Detailed Gap Inventory

### 1. Keeper and API perimeter hardening is incomplete

The current repo snapshot still exposes internet-facing keeper behavior that is
not safe for production.

Concrete gaps verified in code:

- BSC, Solana, and AVAX keepers return `true` from `requireWriteAuth()` when
  `ARENA_WRITE_KEY` is unset, unlike the EVM keeper which already fails closed
- write routes protected by that helper include invite redeem, wallet linking,
  external bet recording fallback, and stream publish
- the Solana sender proxy currently accepts either a privileged write key or a
  trusted `Origin` header, which is not a trustworthy authentication boundary
- public Solana and EVM RPC proxies are described as public keyed read-only
  proxies in env docs, but the code does not enforce a read-only method set

Why this matters:

- production keepers should never become writable because an env var is missing
- proxy trust based on `Origin` is not a secure server-to-server control
- keyed public RPC surfaces need explicit method and quota boundaries, not just
  operator intent

### 2. Active launch-chain canonical truth is not complete

The repo still does not contain truthful launch-chain registry values for all
active production surfaces.

Concrete gaps called out by the release docs:

- `BETTING_LAUNCH_EVM_CHAIN_ORDER` still implies `avax` instead of the parked
  chain posture
- `DEFAULT_FEATURE_FLAGS` still default `perps: false` and `amm: false` even
  though active launch docs describe a broader product destination
- `solana` missing canonical `goldAmmMarketProgramId`
- `bsc` missing canonical AMM and perps fields
- `avax` still has incomplete PM, AMM, perps, and governance/operator fields,
  but those gaps are currently isolated and non-blocking

Why this matters:

- the chain registry is the canonical runtime source of truth
- production deploys and release docs cannot honestly promote without it
- SDK, app builds, and operational tooling cannot stabilize around placeholders
  for the active `BSC`/`Solana` launch path

### 3. Staged and production environment provisioning is incomplete

The repo already has staged proof and soak rails, but the live environment
contract is not actually provisioned.

Repo-evidenced gaps:

- no GitHub `staging` environment
- no `HYPERBET_*_STAGING_*` vars or secrets
- no real staged proof bundle
- no real staged soak bundle

Why this matters:

- testnet-first is the release model in this repo
- without staged proof and soak, mainnet remains ceremony-only on paper

### 4. Governance custody and freeze closeout is incomplete

The code-level freeze posture is stronger than before, but production custody is
not complete until the live authorities are actually transferred and frozen.

Repo-evidenced gaps:

- ownership transfer receipts
- final freeze receipts
- signer provisioning completion
- key-rotation closeout for historical deploy keys
- Solana upgrade-authority transfer evidence

Why this matters:

- a frozen governance model is only real once receipts exist
- the threat model assumes multisig and timelock custody, not ad hoc key
  handling

### 5. The Hyperscapes integration boundary is only partially formalized

The upstream game-to-betting contract has evolved, but Hyperbet still consumes
it asymmetrically.

Repo-evidenced gaps:

- Hyperscapes now exposes an authenticated internal betting feed at
  `/api/internal/bet-sync/state` and `/api/internal/bet-sync/events`
- that feed carries explicit `schemaVersion`, `sourceEpoch`, `seq`,
  `phaseVersion`, and `rendererHealth` fields plus replay/reset semantics
- the local EVM runner already wires the keeper to that richer feed contract
- the current local real-duel evidence resolves against the sibling
  `hyperscapes-main-latest-e2e` checkout at commit `4bb8987dc`, but that target
  is not yet recorded as a formal Hyperbet release dependency
- the canonical EVM keeper consumes and tracks the richer feed via
  `packages/hyperbet-evm/keeper/src/betSync.ts`
- BSC, Solana, and AVAX keepers still poll the legacy
  `/api/streaming/state` surface and accept any object with a `cycle`
- those raw-stream parsers silently synthesize missing `seq` and `emittedAt`
  instead of rejecting incompatible or degraded payloads
- the current soak and proof posture still leans on state polling as the
  primary verification lane rather than treating direct event-feed consumption,
  persisted checkpoints, and idempotent replay as the canonical release proof
- the local Hyperscapes integration runbook still describes
  `/api/streaming/state` as the primary keeper contract even though the local
  runner already prefers the internal bet-sync contract for EVM

Why this matters:

- launch releases need one pinned upstream contract, not multiple implied ones
- replay/reset and source-epoch transitions are part of correctness, not only
  developer convenience
- permissive parsing hides integration regressions until market state has
  already drifted

### 6. Runtime and product architecture are still converging

The intended design is one shared product with chain adapters, but some package
layout and keeper responsibilities are still transitional.

Repo-evidenced gaps:

- BSC remains the active EVM launch wrapper and AVAX remains a preserved but
  isolated wrapper
- canonical EVM runtime convergence is not complete
- several active tickets and docs previously used `BSC` as shorthand for the
  active EVM lane, which can cause negative work unless issue conversion keeps
  the shared-EVM implementation contract explicit
- SDK surfaces are not yet locked to canonical registry truth
- public chain/runtime contracts between Hyperbet and Hyperscapes are not yet
  packaged as a versioned release contract
- the EVM AMM still exposes both challenge-window settlement and oracle-driven
  settlement, so production AMM settlement truth is not frozen
- PM has the strongest live browser-backed evidence today; coordinated
  full-product staged smoke and evidence parity for the remaining active
  surfaces are still open
- wallet/account surfaces and rewards surfaces are still stronger as proven
  features than as frozen product contracts with durable support expectations

Why this matters:

- production incidents get harder to reason about when each chain drifts
- duplicated wrapper logic increases maintenance and review cost
- auditors and operators should not have to infer AMM settlement truth from
  contradictory implementation and documentation

### 7. Keeper durability and operational reliability are not complete

The deployment guide is explicit that keeper SQLite is ephemeral unless the
state backend is changed or persistence is attached.

Repo-evidenced gaps:

- durable keeper storage strategy
- backup and restore runbooks
- production observability dashboards and alert thresholds
- on-call escalation and incident evidence packaging
- reconciliation tooling for claims, points, referrals, and operator review

Why this matters:

- a betting product needs durable audit trails and recovery paths
- real customer support depends on deterministic reconstruction of market and
  payout state

### 8. Security verification is not complete

The repo has strong exploit and parity work, but the audit packet is still not
frozen, not all explicit test gaps are closed, and the keeper/API perimeter
issues above need remediation before an external audit closeout can honestly be
treated as final.

Repo-evidenced gaps:

- missing explicit reentrancy exploit test tracking item
- frozen external audit packet still incomplete
- staged proof and soak evidence missing from the audit package
- final findings ledger and RC freeze manifest still open

Why this matters:

- external audit handoff cannot be honest without frozen artifacts
- accepted risk needs explicit owner signoff and expiry, not just a document

### 9. Gold asset semantics are still a phase-separation gap

The repo is explicit that phase-1 does not yet have a fully solved cross-chain
Gold architecture.

Repo-evidenced gaps:

- canonical Gold source-of-truth decision
- issuance and redemption model
- cross-chain representation model
- reserve and reconciliation invariants
- EVM Gold alias cleanup after the architecture decision

Why this matters:

- a production betting application cannot make stronger Gold claims than the
  implemented asset model can support

### 10. Betting-product operational controls are still missing

The repo documents operator runbooks but does not yet represent the full
commercial launch obligations of a real betting application.

Operational requirements inferred from the product category:

- jurisdiction and licensing review
- KYC/AML posture
- age gating and responsible-gaming controls
- terms of service, privacy, and risk disclosures
- treasury, accounting, and tax operations
- customer support, dispute handling, and incident communications

Why this matters:

- these are launch-critical for a real-money betting product even when the repo
  itself does not yet implement them

## Launch Readiness Verdict

### Ready today

- continued non-mainnet proving
- internal review and audit-prep work
- turning the current branch evidence into an executable project backlog

### Not ready today

- production promotion
- internet-exposed keeper deployments with the current perimeter posture
- public claims of mainnet launch readiness
- external audit handoff as a final frozen packet
- real-money betting launch operations

## Recommended Execution Order

1. close keeper and public-API auth hardening blockers
2. formalize and harden the Hyperscapes integration boundary across the active
   keeper surfaces, promote direct event-feed proof, and keep AVAX isolated
3. close active launch-chain registry truth, active-scope constants, feature
   truth, and governance custody for `BSC` and `Solana`
4. freeze the AMM settlement model and close the remaining coordinated
   full-product smoke and evidence gaps
5. provision staged environment and capture truthful staged proof/soak evidence
6. freeze the shared app-shell, wallet/account, and rewards product contract
   for the active runtimes
7. harden keeper durability, observability, and reconciliation
8. freeze and deliver the external audit packet, then remediate findings
9. finish repo-adjacent production controls: legal, compliance, treasury, and
   support
10. only then treat mainnet as a release ceremony

## Recommended GitHub Project Shape

Use a single production-readiness project with epics grouped by:

- chain truth and deploy integrity
- staged and production environment readiness
- governance and key management
- Hyperscapes integration and runtime convergence
- application shell, account surfaces, and rewards
- reliability, observability, and reconciliation
- security hardening and external audit
- Gold asset architecture
- compliance, treasury, support, and launch operations
- repository governance and review automation

Use one full Kanban board with no dated sprint contract. Sequence work by
status, priority, dependencies, scope, runtime applicability, and blocker
class.

The issue-ready seed list for that project is in
[GitHub Project Production Backlog](github-project-production-backlog.md).
