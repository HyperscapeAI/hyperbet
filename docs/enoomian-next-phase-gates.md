# Enoomian Next-Phase Gates

This document defines the post-sprint launch-completion work for
`enoomian/prediction-market-sprint-base`.

The foundation is built. The remaining work is launch-completion, not
architecture bootstrap.

For the keep/adapt/reject record on the imported EVM parity-sweep direction,
and the resulting local canonization decisions, see
`docs/enoomian-evm-standardization-decisions.md`.

## Execution Model

This is a tracked execution document for independent teams or agents branching
from `enoomian/prediction-market-sprint-base`.

Each gate below is intended to be:

- developed on its own short-lived branch
- committed as a coherent unit
- reviewed against its own merge criteria and required checks
- merged back into `enoomian/prediction-market-sprint-base` intentionally

Unless a gate is explicitly marked as blocked or dependency-bound, it should be
treated as an independent mergeable unit.

## Current State

- Current branch head: local sprint-base standardization head
- Latest integrated code-hardening batch: `5d722dc`
- Latest integrated doc/tracker refresh: local sprint-base standardization head
- Latest known fully green branch-check baseline: `f1824a0`
- Gates `01-13` and `15` are complete on the sprint base.
- Gate `14` is partially complete:
  - the deployed-environment proof rail exists
  - execution against a real deployed environment is still outstanding
- CI is green on the latest fully green branch-check baseline for:
  - fast CI
  - EVM contract validation, proof, and security
  - EVM exploit gate
  - Solana exploit gate
  - Solana program build gate
  - Base add-chain smoke
- Cross-chain E2E is intentionally local-only until it is boring and
  deterministic again.
- AVAX Fuji deployment truth is now canonicalized, but AVAX mainnet is still blocked
  until production canonical deployment values and proof evidence are complete.
- Additional hardening already merged after the original sprint gates:
  - external-bet auth and idempotency hardening
  - canonicalized external-bet economics
  - EVM loser-cleanup UI exposure
  - Solana runtime deploy artifact tracking for the exploit gate
  - staging-rail mode awareness
  - Solana simulation dashboard fee and agent fixes
  - fallback winner preservation for degraded BSC/AVAX lifecycle records
  - duplicate-bet startup quarantine instead of hard boot failure
  - Solana MM environment normalization for `e2e` and `stream-ui`
  - EVM standardization:
    - deployments materialization under `@hyperbet/chain-registry`
    - canonical `hyperbet-evm` app shell
    - hardened shared EVM keeper core
    - canonicalized `hyperbet-evm/keeper`
    - safe shell-level wrapper convergence

This plan is written against the current launch bar:

- trust-minimized prelaunch
- tri-chain mandatory launch

That means the branch is not launch-complete yet. The dominant open risks are:

- privileged resolution
- incomplete protocol order semantics and self-trade prevention
- partially canonical AVAX production state (Fuji complete, mainnet pending)
- non-durable keeper/MM production storage
- unexecuted deployed-environment proof

In other words, the branch already contains the architecture, CI, exploit,
runtime, and deploy-hardening baseline. The remaining work is launch-completion
and launch-evidence, not architecture bootstrap.

### Integrated Scope Already On The Branch

The current sprint base already contains:

- shared multichain foundation:
  - chain/deployment registry
  - `@hyperbet/mm-core`
  - normalized lifecycle/read-model scaffolding
- EVM launch-hardening baseline:
  - contract validation/proof/security
  - deterministic exploit/simulation coverage
  - settlement cleanup correctness
- Solana launch-hardening baseline:
  - validator-backed proof backend
  - exploit gate
  - dedicated Solana program build gate
  - committed runtime deploy artifacts for proof/runtime lanes
- frontend/runtime convergence:
  - canonical lifecycle-driven Solana/BSC/AVAX shells
  - shared claim-state handling
  - EVM loser-cleanup UI support
  - Solana dashboard fee/agent compatibility fixes
- keeper and reward-integrity hardening:
  - strict external-bet verification
  - canonicalized external-bet economics
  - idempotent insert-first reward recording
  - exact origin auth
  - degraded-runtime fallback winner preservation
  - duplicate-bet startup quarantine
  - Solana MM environment normalization
- CI/deploy/proof scaffolding:
  - fast CI plus heavyweight gate workflows
  - Base add-chain proof
  - AVAX production gate posture moved to Fuji-canonicalized + mainnet pending
  - deployed-environment proof rail and runbooks

This next-phase plan therefore assumes the branch is an integration-capable
baseline and focuses only on the remaining launch-completion work.

## Parallelization

### Can Run In Parallel Now

- `14A` Deployed proof execution
- `18` Durable keeper/MM state
- `19` AVAX canonical production enablement
- `20` Governance and emergency controls

### Can Partially Run In Parallel But Must Converge Carefully

- `16` Resolution truth redesign
- `17A` EVM order semantics
- `17B` Solana order semantics
- `21` Protocol guard rails

### Should Wait For Upstream Stabilization

- `22` Required launch gates promotion
- `23` Manual deployed-environment proof finalization
- `24` External audit and release candidate

Planning notes:

- Gate `16` is the biggest protocol fork.
- Gate `19` is the biggest launch-scope blocker because tri-chain launch is
  mandatory.
- Gate `18` is the biggest operational blocker.
- Gate `23` is an evidence gate, not a coding gate.
- Gate `14A` is operational execution, not missing architecture work.

## Gate 14A

### Gate Name And Branch

- Gate: `14A — Deployed Proof Execution`
- Branch: `enoomian/pm-14a-deployed-proof`

### Goal

Execute the already-built deployed-environment proof rail, collect artifacts,
and close the operational portion of Gate `14`.

### Why This Gate Exists

The branch now has the proof workflow, wrapper, and runbooks, but no reviewed
evidence from a real deployed environment.

### In Scope

- manual read-only proof for Solana and BSC
- manual canary-write proof for Solana and BSC
- AVAX staging proof sequencing after canonicality and signer proof setup
- artifact review
- runbook validation against the real environment

### Explicitly Out Of Scope

- protocol redesign
- AVAX production enablement
- CI redesign

### Dependencies

- no code dependency
- blocked only by missing real environment URLs, secrets, and canary wallets

### Merge Criteria

- read-only proof passes for Solana and BSC
- canary-write proof passes for Solana and BSC
- AVAX proof lane is not treated as promotion-complete until AVAX mainnet
  canonical addresses are committed and staged read-only + canary evidence is
  reviewed
- proof artifacts are captured and reviewed
- sprint tracker and release-prep docs updated with real evidence

### Required Checks

- deployed `build-info.json`
- `/status`
- `/api/arena/prediction-markets/active`
- `/api/keeper/bot-health`
- proxy/RPC proof
- tx hashes/signatures for canary writes

### Reviewer Focus

- proof was executed against a real deployed environment
- canary writes were capped and controlled
- AVAX remains intentionally non-production until canonical mainnet addresses and proof evidence are validated

### Risks And Traps

- treating the proof rail itself as proof completion
- running canary-write before read-only succeeds
- mixing production and staging config accidentally

### Follow-On Gates Unblocked By Completion

- `23`
- `24`

## Gate 16

### Gate Name And Branch

- Gate: `16 — Resolution Truth Redesign`
- Branch: `enoomian/pm-16-resolution-truth`

### Goal

Replace privileged reporter-finality with proposal/challenge/finalize
settlement on EVM and Solana.

### Why This Gate Exists

The current oracle path is still privileged on both chains and does not satisfy
the trust-minimized prelaunch bar.

### In Scope

- EVM oracle redesign
- Solana oracle redesign
- finalized-outcome state machine
- keeper/runtime integration
- UI lifecycle updates
- exploit and lifecycle regression updates

### Explicitly Out Of Scope

- order semantics and STP
- AVAX canonical addresses
- governance controls not required for the new oracle flow

### Dependencies

- foundation only
- blocks Gates `21`, `22`, `23`, and `24`

### Merge Criteria

- no direct privileged finalization path remains in the launch path
- markets settle only from finalized outcomes
- lifecycle mapping is updated across keeper, bot, and UI
- EVM and Solana regression suites cover proposal/challenge/finalize

### Required Checks

- EVM contract tests
- Solana program tests
- lifecycle/claim invariants
- exploit regressions for premature or invalid settlement

### Reviewer Focus

- trust reduction is real, not just renamed roles
- settlement is impossible before finalization
- challenge windows are explicit and enforced

### Risks And Traps

- hidden direct-finalize backdoors
- keeper logic still assuming single-step resolution
- inconsistent oracle semantics across chains

### Follow-On Gates Unblocked By Completion

- `21`
- `22`
- `23`
- `24`

## Gate 17A

### Gate Name And Branch

- Gate: `17A — EVM Order Semantics`
- Branch: `enoomian/pm-17a-evm-order-semantics`

### Goal

Add protocol-level IOC, post-only, self-trade prevention, and explicit bounded
continuation behavior on EVM.

### Why This Gate Exists

EVM matching behavior now enforces production-complete order semantics including
IOC/post-only enforcement, bounded continuation, and protocol-visible
self-trade policy handling.

### In Scope

- EVM contract order instruction model
- self-trade prevention
- bounded-match continuation semantics
- EVM exploit and regression coverage

### Explicitly Out Of Scope

- Solana order semantics
- broad UI polish beyond required API compatibility

### Dependencies

- can proceed in parallel with `16` only if interface conflicts are avoided
- otherwise follows the stabilized resolution model

### Merge Criteria

- IOC, post-only, and continuation rules are enforced in `GoldClob.placeOrder`.
- Self-trade cancellation policy is explicit at match time and emits policy signals.
- Bounded match continuation requires explicit continuation when the iteration cap is hit.
- Claim and refund behavior remains terminal-state gated and aligned with resolver outcome.

### Status

- Completed on `enoomian/pm-17a-evm-order-semantics`.
- Evidence: `packages/evm-contracts/test/GoldClobSettlement.t.sol`, `packages/evm-contracts/test/fuzz/GoldClobFuzz.t.sol`, `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`.

### Self-Trade Policy Decision (Cross-Chain Parity)

- Selected policy: **allow with detection only**.
- EVM and Solana must enforce identical parity behavior at match time:
  - a taker is still allowed to match against their own resting maker order;
  - the fill is applied normally (shares, stake accounting, fees, and queue progression are unchanged);
  - an explicit machine-readable policy signal is emitted for every self-cross candidate that fills, so indexers can classify self-trade flow deterministically.
- Rejection/netting semantics are out of scope for this gate; parity requires detection logs on both chains for equivalent matching paths.

### Required Checks

- EVM contract tests
- proof/security lanes
- exploit regressions around self-crossing and order instruction behavior

### Reviewer Focus

- protocol semantics, not front-end hints
- bounded continuation is explicit and test-backed

### Risks And Traps

- offchain assumptions diverging from protocol behavior
- partial semantic parity with Solana

### Follow-On Gates Unblocked By Completion

- `22`
- `23`
- `24`

## Gate 17B

### Gate Name And Branch

- Gate: `17B — Solana Order Semantics`
- Branch: `enoomian/pm-17b-solana-order-semantics`

### Goal

Add matching order semantics and self-trade prevention on Solana.

### Why This Gate Exists

Solana matching behavior now includes production-complete order semantics and is
aligned with EVM intent for IOC, post-only rejection, continuation, and self-cross
policy.

### In Scope

- Solana program order instruction model
- Solana STP behavior
- bounded continuation semantics
- Solana tests and exploit regressions

### Explicitly Out Of Scope

- EVM order semantics
- broad UI convergence beyond required compatibility

### Dependencies

- same dependency policy as `17A`

### Merge Criteria

- Solana order semantics match the intended exchange model
- STP exists at protocol level
- continuation rules are deterministic and documented

### Status

- Completed on `enoomian/pm-17b-solana-order-semantics`.
- Evidence: `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`, `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`.

### Required Checks

- Solana program tests
- Solana exploit regressions
- runtime smoke on the updated contract

### Reviewer Focus

- protocol semantics are explicit
- Solana and EVM semantics are intentionally aligned

### Risks And Traps

- partial parity with EVM
- keeper and bot assumptions not updated

### Follow-On Gates Unblocked By Completion

- `22`
- `23`
- `24`

## Gate 18

### Gate Name And Branch

- Gate: `18 — Durable Keeper/MM State`
- Branch: `enoomian/pm-18-durable-state`

### Goal

Make keeper and market-maker state production-durable and restart-safe.

### Why This Gate Exists

The repo still documents SQLite state on Railway as ephemeral unless
explicit persistence is attached. That is below the real-funds bar.

### In Scope

- canonical persistence choice
- persistence migration/backfill
- restart and reconciliation guarantees
- deploy docs and runbooks
- production storage policy

### Explicitly Out Of Scope

- oracle redesign
- AVAX address canonicalization

### Dependencies

- independent of `16` and `17` at the storage layer

### Merge Criteria

- one durable production storage path is canonical
- restart/recovery is documented and tested
- reconciliation covers open orders, partial fills, and claim backlog
- deploy docs stop treating persistence as optional

### Required Checks

- restart/recovery tests
- reconciliation tests
- migration/backfill tests where needed
- deploy env audit and operator runbook review

### Reviewer Focus

- durable state is real, not aspirational
- restart recovery is deterministic

### Risks And Traps

- partial persistence leaving critical state ephemeral
- migration path ambiguity

### Follow-On Gates Unblocked By Completion

- `23`
- `24`

## Gate 19

### Gate Name And Branch

- Gate: `19 — AVAX Canonical Production Enablement`
- Branch: `enoomian/pm-19-avax-canonical`

### Goal

Move AVAX from partially canonical (Fuji-only) to full production-canonical.

### Why This Gate Exists

Tri-chain launch is mandatory, and AVAX mainnet is still intentionally disabled.

### In Scope

- canonical registry addresses
- deploy manifests and env audit
- runtime smokes
- proof support
- docs and runbooks

### Explicitly Out Of Scope

- oracle/order redesign for Solana and BSC

### Dependencies

- can run in parallel with `16`, `17`, and `18`
- must complete before launch signoff

### Merge Criteria

- AVAX canonical addresses are committed in mainnet registry
- AVAX deploy and proof paths are valid and reviewed
- AVAX is no longer described as canonicalization-blocked

### Required Checks

- registry tests
- runtime smokes
- env audit
- deployed proof support

### Reviewer Focus

- no placeholder/env-only shadow truth
- AVAX uses the same standard as the other launch chains

### Risks And Traps

- drifting truth between docs, env, and registry
- half-enabled AVAX paths

### Follow-On Gates Unblocked By Completion

- `22`
- `23`
- `24`

## Gate 20

### Gate Name And Branch

- Gate: `20 — Governance And Emergency Controls`
- Branch: `enoomian/pm-20-governance-controls`

### Goal

Add pause, timelock, multisig, and authority policy to meet the real-funds bar.

### Why This Gate Exists

The prediction-market stack has admin roles, but not a complete emergency and
governance model.

### In Scope

- protocol emergency controls
- timelocked non-emergency admin
- multisig ownership model
- signer/authority policy
- emergency runbooks

### Explicitly Out Of Scope

- business logic redesign outside authority/emergency posture

### Dependencies

- can start in parallel at policy/doc level
- final protocol wiring may depend on `16` and `17`

### Merge Criteria

- authority model is explicit and documented
- emergency controls exist at protocol level where needed
- operational key policy is reviewable

### Required Checks

- protocol tests for pause/emergency behavior
- runbook validation
- deploy and ownership review

### Reviewer Focus

- control surfaces are scoped and intentional
- launch ownership is operationally credible

### Risks And Traps

- adding admin power without operational discipline
- inconsistent authority structure across chains

### Follow-On Gates Unblocked By Completion

- `23`
- `24`

## Gate 21

### Gate Name And Branch

- Gate: `21 — Protocol Guard Rails`
- Branch: `enoomian/pm-21-protocol-guardrails`

### Goal

Move unsafe-market blocking into protocol rules instead of offchain-only MM
logic.

### Why This Gate Exists

The MM and keeper health model is more mature than the protocol’s own blocking
rules for unsafe state.

### In Scope

- stale or unsafe resolution blocking
- settlement safety conditions
- market transition constraints
- protocol tests for guard-rail enforcement

### Explicitly Out Of Scope

- broad UI work
- deploy topology changes

### Dependencies

- should follow or co-develop with `16`
- may partially depend on `17`

### Merge Criteria

- critical unsafe states are blocked by protocol, not just offchain policy
- tests enforce the intended blocking rules

### Required Checks

- protocol tests
- exploit regressions
- lifecycle invariants

### Reviewer Focus

- protocol and offchain safety models agree
- settlement and transition rules are explicit

### Risks And Traps

- “the bot knows it is unsafe” but the protocol still allows it
- guard rails implemented only in UI or keeper code

### Follow-On Gates Unblocked By Completion

- `22`
- `23`
- `24`

## Gate 22

### Gate Name And Branch

- Gate: `22 — Required Launch Gates Promotion`
- Branch: `enoomian/pm-22-required-gates`

### Goal

Make the final launch-critical proof set mandatory and stable.

### Why This Gate Exists

The branch has strong gate coverage already, but not every launch-critical lane
is yet stable and required.

### In Scope

- required CI check set
- re-promotion of cross-chain E2E when stable
- AVAX proof lanes after canonicalization
- final gate policy documentation

### Explicitly Out Of Scope

- inventing new tests that are not needed for launch

### Dependencies

- follows stabilization of `16`, `17`, `19`, and `21`
- can start early by defining the required-check contract

### Merge Criteria

- required launch gates are stable and mandatory
- no manual-only release blockers remain except the deliberate deployed proof

### Required Checks

- full gate workflow set
- proof of required-check enforcement
- CI policy review

### Reviewer Focus

- required lanes match the real launch bar
- no critical proof lane is still “optional”

### Risks And Traps

- overpromoting unstable lanes
- underpromoting real blockers

### Follow-On Gates Unblocked By Completion

- `23`
- `24`

## Gate 23

### Gate Name And Branch

- Gate: `23 — Manual Deployed-Environment Proof Finalization`
- Branch: `enoomian/pm-23-live-proof-final`

### Goal

Produce final operator proof of launch-capable deployed environments.

### Why This Gate Exists

CI cannot prove deployed env wiring, secrets, RPC routing, and canary write
behavior. This gate does that.

### In Scope

- deployed read-only proof
- deployed canary-write proof
- restart/recovery drill
- proof artifact package
- launch evidence summary

### Explicitly Out Of Scope

- protocol redesign
- core CI implementation

### Dependencies

- follows `14A`
- follows the launch-critical protocol and ops gates that affect live safety

### Merge Criteria

- deployed proof passes on all launch chains
- artifacts are captured and reviewed
- launch evidence summary is written

### Required Checks

- read-only proof
- canary-write proof
- restart/recovery drill
- artifact review

### Reviewer Focus

- this is real deployed proof, not simulated confidence
- evidence is complete enough for launch review

### Risks And Traps

- confusing rail implementation with proof completion
- proving only read-only health and skipping canary writes

### Follow-On Gates Unblocked By Completion

- `24`

## Gate 24

### Gate Name And Branch

- Gate: `24 — External Audit And Release Candidate`
- Branch: `enoomian/pm-24-audit-rc`

### Goal

Freeze, audit, remediate, and produce release-candidate signoff.

### Why This Gate Exists

The final launch bar requires external review and an explicit release memo, not
just internal confidence.

### In Scope

- audit package
- remediation cycle
- release memo
- final residual-risk statement

### Explicitly Out Of Scope

- new product scope unrelated to audit findings

### Dependencies

- final gate

### Merge Criteria

- external audit is complete
- critical/high findings are remediated or explicitly accepted
- release memo is written and reviewed

### Required Checks

- audit package completeness
- remediation verification
- final launch/no-launch decision package

### Reviewer Focus

- every unresolved risk is explicit
- the launch call is evidence-backed

### Risks And Traps

- scope creep during freeze
- incomplete mapping from findings to fixes

### Follow-On Gates Unblocked By Completion

- launch candidate signoff

## Verification Families

Every next-phase gate should define its verification in one or more of these
families:

- Protocol gates:
  - EVM contract tests
  - Solana program tests
  - exploit regressions
  - lifecycle and claim invariants
- Ops and durability gates:
  - restart and recovery
  - reconciliation
  - persistence migration and backfill
  - deploy env audits
- Runtime and product gates:
  - local Gate 10 E2E
  - required CI gates
  - deployed read-only proof
  - deployed canary-write proof
- Launch-evidence gates:
  - runbook completeness
  - proof artifacts
  - audit package completeness
  - release memo completeness
