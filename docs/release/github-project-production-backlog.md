# GitHub Project Production Backlog

> **TL;DR:** This is the canonical issue-seed backlog for Hyperbet's full launch path. It covers the full product destination of `PM + perps + internal AMM`, the shared application shell and account surfaces around those products, uses `BSC + Solana` as the active production-readiness gate, and keeps `AVAX` visible as a parked follow-on epic rather than an active blocker. The implementation target is runtime-family based: shared `EVM` plus `SVM`, with `BSC` acting as the current active EVM wrapper.

Detailed document ownership is defined in
[tracking-document-map.md](tracking-document-map.md).

The canonical end-to-end runtime status view lives in
[runtime-integration-readiness-matrix.md](runtime-integration-readiness-matrix.md).

## Scope Contract

- full product destination: `PM + perps + internal AMM`
- active production-readiness gate: `BSC + Solana`
- parked follow-on epic: `AVAX`
- `AMM` remains internal infrastructure, not a required retail browser surface
- implementation target: shared `EVM` runtime plus `SVM`

## Chain Generality Contract

Interpret every ticket in this document with the following default:

- `BSC` is the current active EVM proving wrapper, not the exclusive EVM
  implementation target
- unless a ticket explicitly says `wrapper-specific`, `deployment-specific`, or
  `governance/evidence-only`, EVM work should land in shared EVM packages,
  registry-driven config, and reusable runtime/app surfaces
- `Solana` owns the active `SVM` lane
- future `Base` onboarding and any later `AVAX` reactivation should be able to
  consume the same shared EVM path rather than require BSC-only rewrites
- if an issue is created from this backlog, it should be labeled or fielded as
  one of: `evm-shared`, `svm`, `cross-runtime`, or `wrapper-specific`

## How To Use This Backlog

- each `##` section is an epic candidate
- each `###` section is an issue candidate
- copy the title directly into GitHub
- keep the acceptance criteria unless scope changes materially
- if work is off-repo or operational, keep it on the same board with an owner

Suggested label families:

- `priority:P0`, `priority:P1`, `priority:P2`
- `scope:active`, `scope:parked`, `scope:off-repo`
- `blocker:launch`, `blocker:quality`, `blocker:parked`
- `type:bug`, `type:feature`, `type:improvement`, `type:ci`,
  `type:security`, `type:ops`, `type:docs`
- `runtime:evm-shared`, `runtime:svm`, `runtime:cross-runtime`,
  `runtime:wrapper-specific`

Suggested project fields:

- `Status`: `Inbox`, `Needs Decision`, `Ready`, `In Progress`, `In Review`,
  `In QA`, `Blocked`, `Done`
- `Workflow`: mirrored compatibility field with the same queue values until it
  is retired deliberately
- `Priority`: `P0`, `P1`, `P2`
- `Scope`: `active`, `parked`, `off-repo`
- `Runtime Applicability`: `evm-shared`, `svm`, `cross-runtime`,
  `wrapper-specific`
- `Work Type`: `bug`, `feature`, `improvement`, `ci`, `security`, `ops`,
  `docs`
- `Parent issue`
- `Sub-issues progress`
- `Epic`
- `Blocker Class`: `launch-blocking`, `quality-blocking`, `parked`,
  `non-blocking`
- `Evidence Required`: `yes`, `no`
- `Owner`

Suggested Kanban status options:

- `Inbox`
- `Needs Decision`
- `Ready`
- `In Progress`
- `In Review`
- `In QA`
- `Blocked`
- `Done`

Suggested project views:

- `All Work`
- `Launch Blockers`
- `Current Queue`
- `Parked`
- `Off-Repo`
- `By Runtime`

Queue model:

- do not use dated sprints or time promises in the canonical backlog
- `Status` is the board-driving queue field used for Kanban grouping and
  day-to-day execution
- `Workflow` mirrors `Status` for compatibility until the board model is
  simplified deliberately
- sequence only by `Status`, `Priority`, `Dependencies`, `Scope`,
  `Runtime Applicability`, and `Blocker Class`
- if a lightweight queue field is needed, use `Current`, `Next`, `Later`, and
  `Parked`

## GitHub Project Conversion Contract

- create one GitHub Project v2 named `Hyperbet Sprint`
- keep active, parked, and off-repo work on the same board
- create one umbrella issue per epic and one execution issue per `PROD-*`
  ticket
- every umbrella issue must use native GitHub sub-issues as the authoritative
  child-membership graph
- every `PROD-*` issue must have the correct native GitHub parent issue
- umbrella issue bodies must not be used as pseudo-sub-issue lists
- `Parent issue` and `Sub-issues progress` are required parts of the project
  structure, not optional add-ons
- split broad active `P0` tickets into child execution issues before import
  when they are too large to act on as single issues
- do not create new execution issues during hierarchy-alignment passes unless a
  later explicit planning pass decides to split oversized tickets
- every created issue must carry explicit `Runtime applicability`, even when
  the markdown entry relied on inference from the `Chain Generality Contract`

## Already Landed

Do not reopen these unless a concrete regression is found:

- Stage-A browser-to-chain acceptance
- real local Hyperscapes duel lane
- direct canary and verify rails
- current release, freeze, threat-model, and deploy documentation
- explicit distinction between browser surfaces and internal AMM operations
- repo artifact-policy CI enforcement and removal of the previously flagged
  tracked Solana deploy artifacts from the tracked tree
- develop-era launch trackers now preserved as historical snapshots rather than
  live blocker owners

## Reconciliation Notes

This backlog is the reconciled canonical set after comparing:

- the current repo state
- the canonical release-tracking docs
- the corrected local issue pack and corrected probe audit
- package-level application and SDK truth across `hyperbet-ui`,
  `hyperbet-sdk`, `hyperbet-bsc`, `hyperbet-solana`, `hyperbet-evm`, and
  `market-maker-bot`

Important reconciliation outcomes:

- earlier repo-hygiene items around tracked Solana deploy artifacts and artifact
  policy are already closed in the current repo state and therefore remain in
  `Already Landed`, not as open tickets
- the corrected probe did surface real open gaps that were previously tracked
  too generically; those are now represented by `PROD-001A`, `PROD-007A`,
  `PROD-015B`, and `PROD-015C`
- integration and runtime tickets below were sharpened so the canonical backlog
  now explicitly owns event-feed promotion, durable checkpoints, idempotent
  replay, coordinated staged smoke, and AMM settlement-model closure
- the final review pass also surfaced missing full-app work around wallet and
  account surfaces, points/referrals, app-shell acceptance, shared keeper
  convergence, orchestration explicitness, and market-maker integration; those
  are now owned by `PROD-047` through `PROD-054`

## Ticket Schema

Every issue in this document uses the same required fields:

- `ID`
- `Title`
- `Type`
- `Priority`
- `Scope`
- `Area`
- `Description`
- `Acceptance criteria`
- `Dependencies`
- `Source docs`
- `Suggested owner`
- `Blocker class`
- `Runtime applicability`

When issue text below predates an explicit runtime line, infer it from the
`Chain Generality Contract` during GitHub issue conversion and make it explicit
on the created issue and project item.

## Epic 1: Chain Truth And Deployment Integrity

### PROD-001 Populate canonical active launch-chain registry truth from final receipts

- ID: `PROD-001`
- Title: `Populate canonical active launch-chain registry truth from final receipts`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Area: `registry`
- Description: Commit truthful production registry values for the active launch
  chains, `BSC` and `Solana`, using final deployment receipts only, while
  preserving registry shape and config semantics that future EVM chains can
  reuse without forking the runtime contract.
- Acceptance criteria:
  - `packages/hyperbet-chain-registry/src/index.ts` contains complete launch
    values for `BSC` and `Solana`
  - no active-scope registry placeholders remain
  - registry gate passes in strict active-launch mode
- Dependencies: final deployment receipts, explorer verification
- Source docs: `launch-ops-evidence-index.md`,
  `prediction-market-launch-freeze-tracker.md`,
  `prediction-market-release-prep.md`
- Suggested owner: `protocol`
- Blocker class: `launch-blocking`

### PROD-001A Align active launch constants and feature-flag truth with the current scope contract

- ID: `PROD-001A`
- Title: `Align active launch constants and feature-flag truth with the current scope contract`
- Type: `bug`
- Priority: `P0`
- Scope: `active`
- Area: `registry`
- Description: Eliminate scope drift between the canonical registry, launch
  ordering constants, and runtime feature truth so the repo stops implying an
  active launch posture that no longer matches `BSC + Solana`.
- Acceptance criteria:
  - `BETTING_LAUNCH_EVM_CHAIN_ORDER` reflects the active launch gate and no
    longer implies parked `AVAX`
  - PM, perps, and internal AMM enablement has one documented canonical source
    of truth for active environments
  - registry tests, runtime env resolution, and active release docs agree on
    the same feature and chain-scope contract
- Dependencies: `PROD-001`
- Source docs: `prediction-market-release-prep.md`,
  `production-readiness-audit-2026-03-29.md`
- Suggested owner: `protocol`
- Blocker class: `launch-blocking`

### PROD-002 Freeze and publish a launch manifest from final receipts

- ID: `PROD-002`
- Title: `Freeze and publish a launch manifest from final receipts`
- Type: `docs`
- Priority: `P0`
- Scope: `active`
- Area: `release`
- Description: Materialize a frozen launch manifest with addresses,
  authorities, deployment versions, explorer links, and receipt hashes.
- Acceptance criteria:
  - frozen manifest exists under `docs/release/manifests/`
  - every launch-critical address maps back to a receipt
  - manifest matches chain registry and verification outputs
- Dependencies: `PROD-001`
- Source docs: `pm-launch-execution-plan.md`,
  `external-audit-package-checklist.md`
- Suggested owner: `release`
- Blocker class: `launch-blocking`

### PROD-003 Close non-mainnet receipt packaging and evidence indexing

- ID: `PROD-003`
- Title: `Close non-mainnet receipt packaging and evidence indexing`
- Type: `docs`
- Priority: `P1`
- Scope: `active`
- Area: `evidence`
- Description: Convert the current Stage-A evidence into a stable attachment set
  that reviewers and operators can consume without hunting through artifact
  folders.
- Acceptance criteria:
  - deploy, init, freeze, and verify outputs are grouped by chain
  - receipt index links work from repo docs
  - browser/on-chain evidence can be traced to receipts
- Dependencies: none
- Source docs: `stage-a-browser-acceptance-matrix.md`,
  `stage-a-promotion-execution-ledger.md`,
  `launch-ops-evidence-index.md`
- Suggested owner: `release`
- Blocker class: `quality-blocking`

### PROD-004 Replace SDK and app placeholder deployment constants with registry-driven config

- ID: `PROD-004`
- Title: `Replace SDK and app placeholder deployment constants with registry-driven config`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `sdk`
- Description: Remove placeholder addresses and hardcoded defaults from public
  SDK and app entrypoints so runtime config resolves from the canonical
  registry or frozen manifest instead of drifting into chain-specific
  placeholders such as the current SDK default addresses.
- Acceptance criteria:
  - no placeholder deployment constants remain in active SDK/app entrypoints,
    including `packages/hyperbet-sdk/src/index.ts`
  - BSC and Solana config resolution is tested and EVM config semantics remain
    reusable for future wrappers
  - docs point consumers to the registry or launch manifest
- Dependencies: `PROD-001`
- Source docs: `launch-ops-evidence-index.md`,
  `system-design-alignment.md`,
  `production-readiness-audit-2026-03-29.md`
- Suggested owner: `sdk`
- Blocker class: `quality-blocking`

## Epic 2: Staged Environment, CI, Proof, And Soak

### PROD-005 Provision the GitHub staging environment and staged secrets contract

- ID: `PROD-005`
- Title: `Provision the GitHub staging environment and staged secrets contract`
- Type: `ci`
- Priority: `P0`
- Scope: `active`
- Area: `infra`
- Description: Create the real GitHub `staging` environment and provision the
  staged Pages, Railway, RPC, signer, and publish secrets required by staged
  proof and staged soak.
- Acceptance criteria:
  - GitHub `staging` environment exists
  - required `HYPERBET_*_STAGING_*` vars and secrets are loaded
  - env audit passes without placeholder or shadow-truth failures
- Dependencies: infrastructure ownership, secret custody
- Source docs: `hyperbet-production-deploy.md`,
  `launch-ops-evidence-index.md`,
  `external-audit-package-checklist.md`
- Suggested owner: `infra`
- Blocker class: `launch-blocking`

### PROD-006 Capture staged proof artifacts for PM, perps/models, and internal AMM

- ID: `PROD-006`
- Title: `Capture staged proof artifacts for PM, perps/models, and internal AMM`
- Type: `ci`
- Priority: `P0`
- Scope: `active`
- Area: `validation`
- Description: Execute staged proof in read-only and canary-write modes and
  archive the full artifact bundle.
- Acceptance criteria:
  - staged proof produces chain-by-chain `pm`, `perps`, and `amm` results
  - `verify-chains.json` is attached and green
  - artifact bundle is linked from evidence and audit docs
- Dependencies: `PROD-005`
- Source docs: `launch-ops-evidence-index.md`,
  `external-audit-package-checklist.md`
- Suggested owner: `qa`
- Blocker class: `launch-blocking`

### PROD-007 Capture authoritative staged soak evidence

- ID: `PROD-007`
- Title: `Capture authoritative staged soak evidence`
- Type: `ci`
- Priority: `P0`
- Scope: `active`
- Area: `validation`
- Description: Run the staged soak rail against the provisioned environment and
  archive the output with a reviewer-facing summary.
- Acceptance criteria:
  - real staged soak artifacts exist under `.ci-artifacts/pm-soak`
  - summary and screenshots are linked from release docs
  - incidents are resolved or explicitly accepted
- Dependencies: `PROD-005`
- Source docs: `launch-ops-evidence-index.md`,
  `external-audit-package-checklist.md`
- Suggested owner: `qa`
- Blocker class: `launch-blocking`

### PROD-007A Run coordinated full-product staged smoke and publish one immutable evidence bundle

- ID: `PROD-007A`
- Title: `Run coordinated full-product staged smoke and publish one immutable evidence bundle`
- Type: `ci`
- Priority: `P0`
- Scope: `active`
- Area: `validation`
- Description: Prove the coordinated loop of game feed, keeper ingestion, app
  interaction, on-chain posting, result pickup, and recovery in one staged
  environment for every enabled product surface, then publish one candidate
  evidence bundle that reviewers can download directly.
- Acceptance criteria:
  - one staged run proves the coordinated PM loop across the active launch
    chains
  - perps staged smoke is captured on the active EVM lane without baking in
    BSC-only assumptions that would block later EVM onboardings
  - internal AMM smoke is captured according to the final AMM scope decision
  - one immutable evidence bundle contains browser artifacts, tx hashes,
    receipts, checkpoints, and run summaries for the candidate
- Dependencies: `PROD-006`, `PROD-007`, `PROD-014A`, `PROD-015`,
  `PROD-015A`, `PROD-015B`
- Source docs: `runtime-integration-readiness-matrix.md`,
  `launch-ops-evidence-index.md`,
  `prediction-market-release-prep.md`
- Suggested owner: `qa`
- Blocker class: `launch-blocking`

### PROD-008 Rehearse production deploy and rollback as a controlled ceremony

- ID: `PROD-008`
- Title: `Rehearse production deploy and rollback as a controlled ceremony`
- Type: `ops`
- Priority: `P1`
- Scope: `active`
- Area: `deploy`
- Description: Turn the production deploy guide into an executed ceremony
  rehearsal that covers deploy, health verification, rollback trigger, and
  rollback validation.
- Acceptance criteria:
  - deployment checklist is executed against a non-mainnet environment
  - rollback path is written and tested
  - operator ownership is documented
- Dependencies: `PROD-006`, `PROD-007`
- Source docs: `hyperbet-production-deploy.md`
- Suggested owner: `infra`
- Blocker class: `quality-blocking`

## Epic 3: Governance, Key Management, And Custody

### PROD-009 Finish multisig, timelock, and upgrade-authority custody for the active launch chains

- ID: `PROD-009`
- Title: `Finish multisig, timelock, and upgrade-authority custody for the active launch chains`
- Type: `ops`
- Priority: `P0`
- Scope: `active`
- Area: `governance`
- Description: Complete the real governance custody model assumed by the threat
  model for `BSC` and `Solana`.
- Acceptance criteria:
  - BSC timelock and multisig custody is live and recorded
  - Solana upgrade authority is transferred from the deployer
  - chain registry and governance docs reference the same owners
- Dependencies: final deployment addresses
- Source docs: `threat-model.md`,
  `contract-privileged-surface-inventory.md`,
  `pm-launch-execution-plan.md`
- Suggested owner: `protocol-ops`
- Blocker class: `launch-blocking`

### PROD-010 Execute and record final freeze transactions for every privileged surface

- ID: `PROD-010`
- Title: `Execute and record final freeze transactions for every privileged surface`
- Type: `ops`
- Priority: `P0`
- Scope: `active`
- Area: `governance`
- Description: Run the final freeze steps for oracle, market, perps, and AMM
  surfaces and record the tx hashes in the evidence bundle.
- Acceptance criteria:
  - all freeze tx hashes are captured and linked
  - release docs no longer refer to freeze as pending
  - privileged-surface inventory is updated with final evidence
- Dependencies: `PROD-009`
- Source docs: `prediction-market-launch-freeze-tracker.md`,
  `contract-privileged-surface-inventory.md`
- Suggested owner: `protocol-ops`
- Blocker class: `launch-blocking`

### PROD-011 Rotate and retire historical deploy and test keys

- ID: `PROD-011`
- Title: `Rotate and retire historical deploy and test keys`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Area: `key-management`
- Description: Treat any keys used during prior testnet, branch, or local
  proving phases as exposed and replace them with final production custody.
- Acceptance criteria:
  - historical keys are marked retired
  - active signer inventory is published
  - key-rotation completion is attached to the audit packet
- Dependencies: `PROD-009`
- Source docs: `external-audit-package-checklist.md`,
  `signer-policy-and-key-rotation.md`
- Suggested owner: `security`
- Blocker class: `launch-blocking`

### PROD-012 Rehearse emergency governance actions with named owners

- ID: `PROD-012`
- Title: `Rehearse emergency governance actions with named owners`
- Type: `ops`
- Priority: `P1`
- Scope: `active`
- Area: `governance`
- Description: Run pause, cancel, and role-recovery drills against the final
  custody model so governance is operationally usable.
- Acceptance criteria:
  - emergency drill report exists
  - owner list and escalation chain are documented
  - runbooks reflect final custody addresses and steps
- Dependencies: `PROD-009`, `PROD-010`
- Source docs: `prediction-market-governance-and-emergency-controls.md`
- Suggested owner: `protocol-ops`
- Blocker class: `quality-blocking`

## Epic 4: Hyperscapes Integration And Runtime Contract Stability

### PROD-013 Converge BSC onto the canonical EVM runtime and keeper core

- ID: `PROD-013`
- Title: `Converge BSC onto the canonical EVM runtime and keeper core`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `evm-shared`
- Area: `runtime`
- Description: Reduce chain-wrapper drift so BSC remains only the active EVM
  proving shell over one canonical EVM runtime and shared keeper core, rather
  than becoming the place where EVM-specific business logic accumulates.
- Acceptance criteria:
  - chain-specific business logic is minimized in the BSC wrapper
  - shared runtime modules own common behavior
  - future EVM chains can onboard against the same shared runtime with only
    documented wrapper/config differences
  - convergence docs match reality
- Dependencies: none
- Source docs: `system-design-alignment.md`
- Suggested owner: `protocol`
- Blocker class: `quality-blocking`

### PROD-014 Version and contract-test the Hyperscapes to Hyperbet integration boundary

- ID: `PROD-014`
- Title: `Version and contract-test the Hyperscapes to Hyperbet integration boundary`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Area: `integration`
- Description: Formalize the upstream duel lifecycle contract so releases can
  pin to a schema and catch breaking changes before runtime.
- Acceptance criteria:
  - one canonical upstream contract is identified explicitly
  - the contract covers `schemaVersion`, `sourceEpoch`, `seq`, timing fields,
    winner mapping, and reset/replay semantics
  - contract tests cover duel lifecycle, timing, result mapping, and resets
- Dependencies: active Hyperscapes contract access
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `prediction-market-test-flow.md`,
  `hyperscapes-local-pm-integration.md`
- Suggested owner: `integration`
- Blocker class: `launch-blocking`

### PROD-014A Canonicalize keeper ingestion onto the versioned Hyperscapes betting feed

- ID: `PROD-014A`
- Title: `Canonicalize keeper ingestion onto the versioned Hyperscapes betting feed`
- Type: `bug`
- Priority: `P0`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `keeper`
- Description: Stop treating the loose raw `/api/streaming/state` payload as a
  production contract where a richer betting-feed contract already exists.
- Acceptance criteria:
  - BSC and Solana consume the canonical `/api/internal/bet-sync/state` and
    `/api/internal/bet-sync/events` contract, or a documented compatibility
    adapter with equivalent semantics
  - env examples and deploy docs prefer the canonical feed contract
  - local and staged runners no longer depend on implicit feed-shape knowledge
    and expose the consumer checkpoint boundary explicitly
  - the canonical feed path is described as shared runtime contract rather than
    a single-wrapper behavior
- Dependencies: `PROD-014`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `hyperscapes-local-pm-integration.md`
- Suggested owner: `integration`
- Blocker class: `launch-blocking`

### PROD-014B Make feed parsing fail closed on schema drift, replay mismatch, and source resets

- ID: `PROD-014B`
- Title: `Make feed parsing fail closed on schema drift, replay mismatch, and source resets`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `keeper`
- Description: Harden keeper feed parsing so contract drift or replay
  corruption surfaces as an explicit integration error instead of silently
  becoming synthesized state.
- Acceptance criteria:
  - production-mode parsers reject missing required sequencing or version fields
  - source-epoch changes, replay windows, and reset events are tracked and
    surfaced as integration errors when contracts diverge
  - missing `seq`, `emittedAt`, or equivalent fields are not silently fabricated
  - the failure model is consistent across the active EVM and SVM keepers
- Dependencies: `PROD-014`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `hyperscapes-local-pm-integration.md`
- Suggested owner: `integration`
- Blocker class: `launch-blocking`

### PROD-015 Close remaining EVM models/perps browser deltas

- ID: `PROD-015`
- Title: `Close remaining EVM models/perps browser deltas`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Runtime applicability: `evm-shared`
- Area: `ui`
- Description: Productionize the user-facing EVM `models/agents` surface so the
  product makes a precise claim about what users can do on the active EVM lane,
  with BSC as the current proving wrapper rather than a hard-coded product
  boundary.
- Acceptance criteria:
  - intended active-EVM user actions are documented and tested
  - browser-to-chain evidence exists for the supported models/perps actions,
    including receipts or tx hashes
  - stale-oracle, paused-market, and insufficient-margin UI handling is
    exercised and evidenced for the supported flows
  - the supported user actions are described as shared EVM product behavior,
    with wrapper-specific differences called out separately
  - unsupported behaviors are explicit in product copy and docs
  - the resulting implementation does not require BSC-only logic where a shared
    EVM path is intended
  - browser acceptance evidence reflects the final active product claim
- Dependencies: product decision on EVM models/perps scope
- Source docs: `stage-a-browser-acceptance-matrix.md`,
  `prediction-market-release-prep.md`
- Suggested owner: `app`
- Blocker class: `launch-blocking`

### PROD-015A Close active-scope internal AMM and liquidity runtime dependencies

- ID: `PROD-015A`
- Title: `Close active-scope internal AMM and liquidity runtime dependencies`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Runtime applicability: `evm-shared`
- Area: `market-making`
- Description: Close the remaining launch-path gaps for the internal AMM and
  active EVM liquidity dependencies, using BSC as the current proving wrapper
  without turning AMM into a retail UI scope item or baking BSC-only logic into
  the shared EVM path.
- Acceptance criteria:
  - required active-EVM token and router inputs are finalized, with current BSC
    proving inputs documented explicitly
  - internal AMM runtime dependencies are documented and testable
  - internal-only AMM operator expectations are explicit in docs, staged smoke,
    and release evidence
  - staged proof and launch docs treat AMM as internal but production-critical
  - the dependency contract is reusable for future EVM wrappers without
    reopening BSC-only assumptions
- Dependencies: `PROD-001`, `PROD-005`, `PROD-006`, `PROD-015B`
- Source docs: `prediction-market-release-prep.md`,
  `launch-ops-evidence-index.md`,
  `runtime-integration-readiness-matrix.md`
- Suggested owner: `protocol`
- Blocker class: `launch-blocking`

### PROD-015B Decide and freeze the production AMM settlement model

- ID: `PROD-015B`
- Title: `Decide and freeze the production AMM settlement model`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Area: `market-making`
- Description: The EVM AMM still exposes both challenge-window settlement and
  oracle-driven settlement. Freeze the production truth so auditors and
  operators do not have to infer whether AMM is oracle-only or dual-mode.
- Acceptance criteria:
  - the production AMM settlement truth is explicit and documented
  - if oracle-only, proposer/challenge settlement is disabled or tightly
    guarded for production markets
  - if dual-mode, the governing rules, tests, and runbooks are exhaustive and
    audit-grade
- Dependencies: product and protocol signoff
- Source docs: `prediction-market-release-prep.md`,
  `production-readiness-audit-2026-03-29.md`,
  `pm-launch-execution-plan.md`
- Suggested owner: `protocol`
- Blocker class: `launch-blocking`

### PROD-015C Harden Solana AMM settlement account typing and auditability

- ID: `PROD-015C`
- Title: `Harden Solana AMM settlement account typing and auditability`
- Type: `security`
- Priority: `P1`
- Scope: `active`
- Area: `market-making`
- Description: Make the Solana AMM settlement path defensible to auditors by
  either tightening optional account typing or documenting and exhaustively
  testing the compatibility posture.
- Acceptance criteria:
  - settlement accounts are strongly constrained or the compatibility exception
    is documented explicitly
  - negative tests cover wrong owner, wrong PDA, and incompatible optional
    account cases
  - the audit packet explains the final Solana AMM settlement validation model
- Dependencies: `PROD-015B`
- Source docs: `prediction-market-release-prep.md`,
  `production-readiness-audit-2026-03-29.md`
- Suggested owner: `solana-protocol`
- Blocker class: `quality-blocking`

### PROD-016 Stabilize public API and SDK contracts against chain truth

- ID: `PROD-016`
- Title: `Stabilize public API and SDK contracts against chain truth`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `api`
- Description: Publish one stable contract for keeper APIs, stream APIs, chain
  addressing, SDK entrypoints, and application-level config resolution so
  consumers stop relying on incidental implementation details.
- Acceptance criteria:
  - API contract doc exists
  - SDKs consume canonical config paths
  - app shells consume the same contract for addresses, feature flags, and
    runtime capabilities
  - compatibility policy is documented for breaking changes
- Dependencies: `PROD-001`, `PROD-014`
- Source docs: `system-design-alignment.md`,
  `tracking-document-map.md`
- Suggested owner: `sdk`
- Blocker class: `quality-blocking`

## Epic 5: Application Shell, Account Surfaces, And Runtime Convergence

### PROD-047 Productionize shared wallet and account surfaces across the active runtimes

- ID: `PROD-047`
- Title: `Productionize shared wallet and account surfaces across the active runtimes`
- Type: `feature`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `app-shell`
- Description: Make wallet connect/select, account state, claimability,
  positions, and account-facing copy behave as one deliberate Hyperbet product
  across the active runtimes rather than a set of partially chain-specific
  surfaces.
- Acceptance criteria:
  - shared wallet and account surfaces are documented for the active `EVM` and
    `SVM` lanes
  - launch-critical account actions such as connect, view positions, and claim
    state are covered by acceptance evidence
  - chain-specific differences are explicit in copy and docs rather than
    emerging from wrapper drift
- Dependencies: `PROD-016`
- Source docs: `system-design-alignment.md`,
  `stage-a-browser-acceptance-matrix.md`,
  `production-readiness-audit-2026-03-29.md`
- Suggested owner: `app`
- Blocker class: `quality-blocking`

### PROD-048 Productionize points, referrals, and rewards surfaces as first-class product scope

- ID: `PROD-048`
- Title: `Productionize points, referrals, and rewards surfaces as first-class product scope`
- Type: `feature`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `rewards`
- Description: Treat points, referrals, leaderboard, invite redeem, and wallet
  linking as explicit product surfaces with clear durability, auth, and support
  expectations rather than incidental add-ons.
- Acceptance criteria:
  - points, referrals, and rewards product claims are documented explicitly
  - durable versus cached or reconstructable rewards state is stated in docs
  - browser evidence exists for the active account and referral flows the
    product claims to support
  - unsupported or operator-mediated rewards behaviors are explicit in product
    copy and support docs
- Dependencies: `PROD-021`, `PROD-047`, `PROD-050`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `stage-a-browser-acceptance-matrix.md`,
  `hyperbet-production-deploy.md`
- Suggested owner: `app`
- Blocker class: `quality-blocking`

### PROD-049 Freeze the active app-shell acceptance contract for the full Hyperbet surface

- ID: `PROD-049`
- Title: `Freeze the active app-shell acceptance contract for the full Hyperbet surface`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `acceptance`
- Description: Define and prove the user-facing Hyperbet shell beyond pure
  market lifecycle flows so launch claims cover the full active application:
  navigation, drawers, tabs, models/agents, claims, positions, account panels,
  and explicit unsupported-state messaging.
- Acceptance criteria:
  - the active application shell contract is documented in one canonical place
  - every visible active-scope app shell surface maps to acceptance evidence or
    an explicit unsupported-state statement
  - app-shell acceptance is expressed as shared product truth, not as wrapper
    folklore
- Dependencies: `PROD-015`, `PROD-047`, `PROD-048`
- Source docs: `stage-a-browser-acceptance-matrix.md`,
  `runtime-integration-readiness-matrix.md`,
  `prediction-market-release-prep.md`
- Suggested owner: `app`
- Blocker class: `launch-blocking`

### PROD-050 Add durable user-account and rewards reconciliation tooling

- ID: `PROD-050`
- Title: `Add durable user-account and rewards reconciliation tooling`
- Type: `feature`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `ops-tooling`
- Description: Extend operator tooling beyond settlement only so support and
  finance can reconstruct points, referrals, wallet-link state, claimability,
  and account-facing reward questions deterministically.
- Acceptance criteria:
  - operator reports can answer account, referral, and points disputes
  - rewards and account state can be reconciled against keeper and chain
    evidence where applicable
  - support and finance runbooks describe the investigation path
- Dependencies: `PROD-019`, `PROD-048`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `hyperbet-production-deploy.md`
- Suggested owner: `ops`
- Blocker class: `quality-blocking`

### PROD-051 Extract shared keeper domain logic out of wrapper packages

- ID: `PROD-051`
- Title: `Extract shared keeper domain logic out of wrapper packages`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `runtime`
- Description: Move reusable keeper domain logic into shared modules so wrapper
  packages stop accumulating chain-family business behavior and the shared
  runtime contract becomes the default implementation path.
- Acceptance criteria:
  - shared keeper modules own common domain behavior where runtime semantics
    are actually shared
  - wrapper packages are reduced toward execution adapters plus config
  - convergence docs accurately describe the resulting ownership model
- Dependencies: `PROD-013`
- Source docs: `system-design-alignment.md`,
  `production-readiness-audit-2026-03-29.md`
- Suggested owner: `protocol`
- Blocker class: `quality-blocking`

### PROD-052 Make Hyperscapes orchestration runtime-explicit and wrapper-agnostic

- ID: `PROD-052`
- Title: `Make Hyperscapes orchestration runtime-explicit and wrapper-agnostic`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `integration`
- Description: Update local and staged orchestration so Hyperbet runtime
  selection is explicit and no older Solana-first or wrapper-specific
  assumptions survive in the duel-stack control plane.
- Acceptance criteria:
  - orchestration scripts describe runtime selection explicitly
  - no active runner depends on an implicit Solana-first sibling-app contract
  - local and staged integration docs match the resulting orchestration model
- Dependencies: `PROD-014A`, `PROD-051`
- Source docs: `system-design-alignment.md`,
  `hyperscapes-local-pm-integration.md`
- Suggested owner: `integration`
- Blocker class: `quality-blocking`

### PROD-053 Canonicalize market-maker integration on shared runtime interfaces

- ID: `PROD-053`
- Title: `Canonicalize market-maker integration on shared runtime interfaces`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `market-making`
- Description: Align the market-maker integration with the same registry,
  runtime, and interface contracts that the rest of Hyperbet uses so internal
  AMM operations do not depend on ad hoc cross-chain behavior.
- Acceptance criteria:
  - market-maker config resolves from canonical runtime and registry truth
  - shared runtime interfaces are the documented integration contract
  - release and ops docs describe the market-maker as part of the same canonical
    launch system
- Dependencies: `PROD-015A`, `PROD-016`, `PROD-051`
- Source docs: `system-design-alignment.md`,
  `prediction-market-release-prep.md`
- Suggested owner: `protocol`
- Blocker class: `quality-blocking`

### PROD-054 Normalize active-scope package READMEs and launch docs to the chain-generality contract

- ID: `PROD-054`
- Title: `Normalize active-scope package READMEs and launch docs to the chain-generality contract`
- Type: `docs`
- Priority: `P2`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `docs`
- Description: Remove active-scope wording that can mislead contributors into
  treating `BSC` as the permanent EVM boundary or PM as the only product lane,
  while preserving historical evidence where appropriate.
- Acceptance criteria:
  - active READMEs and guidance docs use the same shared `EVM` plus `SVM`
    contract
  - historical documents remain preserved without regaining open-work ownership
  - contributors can tell which work is wrapper-specific versus shared-runtime
    work
- Dependencies: `PROD-013`, `PROD-049`
- Source docs: `tracking-document-map.md`,
  `prediction-market-release-prep.md`,
  `production-readiness-audit-2026-03-29.md`
- Suggested owner: `release`
- Blocker class: `non-blocking`

## Epic 6: Reliability, Durability, And Reconciliation

### PROD-017 Replace ephemeral keeper storage with durable persistence

- ID: `PROD-017`
- Title: `Replace ephemeral keeper storage with durable persistence`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Area: `keeper`
- Description: Move keeper state off ephemeral SQLite semantics in hosted
  environments and define backup, restore, and migration behavior.
- Acceptance criteria:
  - durable storage backend is selected and wired
  - backup and restore runbook exists
  - hosted keeper deploy no longer depends on ephemeral local files
- Dependencies: production infra choice
- Source docs: `hyperbet-production-deploy.md`
- Suggested owner: `infra`
- Blocker class: `launch-blocking`

### PROD-018 Add production observability, SLOs, and alerting

- ID: `PROD-018`
- Title: `Add production observability, SLOs, and alerting`
- Type: `ops`
- Priority: `P0`
- Scope: `active`
- Area: `observability`
- Description: Add metrics, structured alerts, dashboards, and paging criteria
  for keeper health, duel freshness, quote health, claim latency, and RPC
  degradation.
- Acceptance criteria:
  - SLOs are defined for critical surfaces
  - alert thresholds and owners are documented
  - dashboards exist for operators
- Dependencies: `PROD-017`
- Source docs: `hyperbet-production-deploy.md`,
  `runtime-integration-readiness-matrix.md`
- Suggested owner: `ops`
- Blocker class: `launch-blocking`

### PROD-018A Add stream freshness, restart recovery, replay, and backfill automation

- ID: `PROD-018A`
- Title: `Add stream freshness, restart recovery, replay, and backfill automation`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Area: `runtime`
- Description: Turn the currently manual recovery and replay assumptions into
  explicit production automation for stale stream detection, resets, restart
  recovery, and backfill.
- Acceptance criteria:
  - stream freshness and reset conditions are measured and alertable
  - consumer checkpoints survive restart and are queryable for operators
  - keeper restart and Hyperscapes restart paths have deterministic backfill
    behavior
  - duplicate or replayed source events are applied idempotently
  - the proof harness can show source events, consumer checkpoints, and
    projected state together
  - replay, reset, and backfill behavior is documented and tested
- Dependencies: `PROD-014A`, `PROD-014B`, `PROD-017`
- Source docs: `runtime-integration-readiness-matrix.md`,
  `stage-a-browser-acceptance-matrix.md`
- Suggested owner: `integration`
- Blocker class: `launch-blocking`

### PROD-019 Build result discovery, settlement reconciliation, and payout investigation tooling

- ID: `PROD-019`
- Title: `Build result discovery, settlement reconciliation, and payout investigation tooling`
- Type: `feature`
- Priority: `P0`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `ops-tooling`
- Description: Create operator tooling for result correlation, payout disputes,
  claim backlog review, market-state reconstruction, user-facing accounting
  questions, and the investigation primitives that higher-level account and
  rewards tooling will build on.
- Acceptance criteria:
  - chain and keeper events can be reconciled into one operator report
  - result discovery and settlement correlation are deterministic
  - payout investigation flow is documented
  - the tool contract is reusable by account, rewards, and support workflows
- Dependencies: `PROD-017`, `PROD-018A`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `runtime-integration-readiness-matrix.md`
- Suggested owner: `ops`
- Blocker class: `launch-blocking`

### PROD-020 Harden production incident handling and support operations

- ID: `PROD-020`
- Title: `Harden production incident handling and support operations`
- Type: `ops`
- Priority: `P1`
- Scope: `active`
- Area: `support`
- Description: Complete the operator side of a real betting service: support
  queue routing, incident communication templates, and recovery ownership.
- Acceptance criteria:
  - support and incident severity matrix exists
  - operator handoff process is documented
  - customer-facing incident communication templates are ready
- Dependencies: `PROD-018`, `PROD-019`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `docs/runbooks/README.md`
- Suggested owner: `ops`
- Blocker class: `quality-blocking`

## Epic 7: Security Hardening And External Audit

### PROD-021 Make keeper write auth fail closed across the active keeper surfaces

- ID: `PROD-021`
- Title: `Make keeper write auth fail closed across the active keeper surfaces`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Area: `keeper`
- Description: Align the BSC and Solana keepers with the canonical EVM keeper
  so missing write keys reject writes instead of granting access.
- Acceptance criteria:
  - `requireWriteAuth()` fails closed when the configured key is unset
  - invite redeem, wallet link, external bet recording, and stream publish
    reject missing or incorrect auth
  - automated tests cover configured, missing-key, and wrong-key cases
- Dependencies: none
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `threat-model.md`
- Suggested owner: `security`
- Blocker class: `launch-blocking`

### PROD-022 Remove origin-based trust from the Solana sender proxy

- ID: `PROD-022`
- Title: `Remove origin-based trust from the Solana sender proxy`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Area: `keeper`
- Description: Replace the Solana sender proxy's current allowed-origin
  authorization path with an explicit trusted service contract.
- Acceptance criteria:
  - no auth decision depends on `Origin` alone
  - the proxy requires a privileged key or signed service identity
  - spoofed-origin tests are rejected
- Dependencies: `PROD-021`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `stage-a-browser-acceptance-matrix.md`
- Suggested owner: `security`
- Blocker class: `launch-blocking`

### PROD-023 Enforce read-only allowlists and quotas on public RPC proxies

- ID: `PROD-023`
- Title: `Enforce read-only allowlists and quotas on public RPC proxies`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Area: `proxy`
- Description: Bring the keeper RPC proxies in line with their documented
  contract as public keyed read-only endpoints.
- Acceptance criteria:
  - Solana and EVM proxy handlers enforce approved read-only method sets
  - state-changing or unknown methods are rejected before upstream forwarding
  - usage is rate-limited and observable per method family
- Dependencies: none
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `hyperbet-production-deploy.md`
- Suggested owner: `security`
- Blocker class: `launch-blocking`

### PROD-024 Close the remaining explicit security test gaps

- ID: `PROD-024`
- Title: `Close the remaining explicit security test gaps`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Area: `tests`
- Description: Finish the concrete adversarial tests still called out by the
  risk and historical audit docs.
- Acceptance criteria:
  - malicious-contract reentrancy test exists and passes
  - flash-loan or single-tx abuse scenarios are covered where applicable
  - residual-risk register is updated to reflect the new status
- Dependencies: `PROD-021`, `PROD-022`, `PROD-023`
- Source docs: `residual-risk-register.md`,
  `convergence-audit-report.md`
- Suggested owner: `security`
- Blocker class: `launch-blocking`

### PROD-025 Assemble the frozen external audit packet

- ID: `PROD-025`
- Title: `Assemble the frozen external audit packet`
- Type: `docs`
- Priority: `P0`
- Scope: `active`
- Area: `audit`
- Description: Convert the current audit-prep state into a frozen packet that
  an external reviewer can consume without chasing live branch drift.
- Acceptance criteria:
  - RC commit and freeze manifest are attached
  - staged proof and staged soak artifacts are attached
  - coordinated staged smoke and candidate evidence bundle are attached
  - governance receipts and final findings ledger are attached
- Dependencies: `PROD-006`, `PROD-007`, `PROD-007A`, `PROD-010`, `PROD-011`,
  `PROD-015B`, `PROD-015C`, `PROD-024`
- Source docs: `external-audit-package-checklist.md`
- Suggested owner: `release`
- Blocker class: `launch-blocking`

### PROD-026 Run the external audit and close the remediation loop

- ID: `PROD-026`
- Title: `Run the external audit and close the remediation loop`
- Type: `security`
- Priority: `P0`
- Scope: `active`
- Area: `audit`
- Description: Complete the external audit engagement, land required fixes, and
  record the final accepted risks and remediated findings.
- Acceptance criteria:
  - external findings are logged in one ledger
  - fixes are linked to evidence and code changes
  - remaining accepted risks have explicit owner signoff
- Dependencies: `PROD-025`
- Source docs: `external-audit-package-checklist.md`
- Suggested owner: `security`
- Blocker class: `launch-blocking`

### PROD-027 Add coverage reporting and invariant verification to the release packet

- ID: `PROD-027`
- Title: `Add coverage reporting and invariant verification to the release packet`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Area: `tests`
- Description: Make test quality visible by attaching coverage, invariant, and
  adversarial verification summaries to the release and audit packet.
- Acceptance criteria:
  - quantitative coverage reports exist for critical packages
  - invariant and fuzz suites are linked from the packet
  - release docs reference the reports as evidence
- Dependencies: `PROD-024`
- Source docs: `convergence-audit-report.md`
- Suggested owner: `qa`
- Blocker class: `quality-blocking`

## Epic 8: Gold Asset Architecture

### PROD-028 Approve the final Gold architecture spec

- ID: `PROD-028`
- Title: `Approve the final Gold architecture spec`
- Type: `docs`
- Priority: `P1`
- Scope: `active`
- Area: `gold`
- Description: Resolve the canonical Gold model so the product stops making
  stronger claims than the implemented asset semantics can support.
- Acceptance criteria:
  - canonical supply source is chosen
  - issuance, burn, redemption, and chain-support rules are explicit
  - supported vs unsupported behavior is stated plainly
- Dependencies: cross-team product decision
- Source docs: `gold-architecture-spec-plan.md`,
  `gold-current-state.md`
- Suggested owner: `product`
- Blocker class: `quality-blocking`

### PROD-029 Align registry, SDK, and product copy with the approved Gold model

- ID: `PROD-029`
- Title: `Align registry, SDK, and product copy with the approved Gold model`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Area: `gold`
- Description: Once the Gold model is approved, remove misleading aliases and
  update runtime semantics, copy, and verification to match it.
- Acceptance criteria:
  - field naming matches the approved asset model
  - unsupported Gold behaviors are removed or labeled
  - verification logic no longer implies a broader rollout than exists
- Dependencies: `PROD-028`
- Source docs: `gold-architecture-spec-plan.md`
- Suggested owner: `sdk`
- Blocker class: `quality-blocking`

### PROD-030 Implement Gold issuance, redemption, and reconciliation after the spec is approved

- ID: `PROD-030`
- Title: `Implement Gold issuance, redemption, and reconciliation after the spec is approved`
- Type: `feature`
- Priority: `P2`
- Scope: `active`
- Area: `gold`
- Description: Treat Gold portability and backing as a separate build track
  after the architecture is fixed, not as an incidental side effect of launch.
- Acceptance criteria:
  - issuance and redemption flows are implemented against the approved model
  - reserve and reconciliation invariants are enforced
  - Gold-specific runbooks and audit scope exist
- Dependencies: `PROD-028`, `PROD-029`
- Source docs: `gold-architecture-spec-plan.md`
- Suggested owner: `protocol`
- Blocker class: `non-blocking`

## Epic 9: Compliance, Treasury, And Customer Operations

### PROD-031 Define jurisdiction, licensing, KYC/AML, and responsible-gaming posture

- ID: `PROD-031`
- Title: `Define jurisdiction, licensing, KYC/AML, and responsible-gaming posture`
- Type: `ops`
- Priority: `P0`
- Scope: `off-repo`
- Area: `compliance`
- Description: A production betting product needs an explicit legal and
  compliance operating model.
- Acceptance criteria:
  - supported jurisdictions are defined
  - KYC/AML policy is approved
  - age gating and responsible-gaming requirements are specified
- Dependencies: legal and compliance ownership
- Source docs: `production-readiness-audit-2026-03-29.md`
- Suggested owner: `legal`
- Blocker class: `launch-blocking`

### PROD-032 Ship legal disclosures and account-policy UX

- ID: `PROD-032`
- Title: `Ship legal disclosures and account-policy UX`
- Type: `feature`
- Priority: `P0`
- Scope: `off-repo`
- Area: `legal-ux`
- Description: Add the legal and customer-policy surfaces required for a real
  betting product.
- Acceptance criteria:
  - terms of service, privacy policy, and risk disclosures exist
  - required age or region gating is enforced in product UX
  - rewards copy matches the approved legal posture
- Dependencies: `PROD-031`
- Source docs: `production-readiness-audit-2026-03-29.md`
- Suggested owner: `app`
- Blocker class: `launch-blocking`

### PROD-033 Establish treasury, accounting, and financial-control workflows

- ID: `PROD-033`
- Title: `Establish treasury, accounting, and financial-control workflows`
- Type: `ops`
- Priority: `P0`
- Scope: `off-repo`
- Area: `finance`
- Description: Define how treasury balances, fees, reserves, and payouts are
  tracked and audited outside pure protocol execution.
- Acceptance criteria:
  - treasury ownership and approval paths are documented
  - accounting and reconciliation cadence is defined
  - tax and reporting responsibilities are assigned
- Dependencies: `PROD-019`, `PROD-031`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `gold-architecture-spec-plan.md`
- Suggested owner: `finance-ops`
- Blocker class: `launch-blocking`

### PROD-034 Create customer support and dispute-resolution operations

- ID: `PROD-034`
- Title: `Create customer support and dispute-resolution operations`
- Type: `ops`
- Priority: `P1`
- Scope: `off-repo`
- Area: `support`
- Description: Build the human process for payout disputes, delayed claims,
  platform incidents, and customer communications.
- Acceptance criteria:
  - support escalation path exists
  - dispute-resolution workflow exists
  - operator tooling can answer the questions support receives
- Dependencies: `PROD-019`, `PROD-020`
- Source docs: `production-readiness-audit-2026-03-29.md`
- Suggested owner: `ops`
- Blocker class: `quality-blocking`

## Epic 10: Release Governance And Project Management

### PROD-035 Convert this backlog into GitHub issues and create the production-readiness project

- ID: `PROD-035`
- Title: `Convert this backlog into GitHub issues and create the production-readiness project`
- Type: `docs`
- Priority: `P1`
- Scope: `active`
- Runtime applicability: `cross-runtime`
- Area: `project-management`
- Description: Turn this document into the active GitHub issue board the team
  will execute from after merge, using one full Kanban board with no dated
  sprint contract baked into the backlog.
- Acceptance criteria:
  - one GitHub Project named `Hyperbet Sprint` exists
  - issue titles, fields, and epic mapping match this document
  - the project uses `Status`, `Workflow`, `Priority`, `Scope`,
    `Runtime Applicability`, `Work Type`, `Parent issue`,
    `Sub-issues progress`, `Epic`, `Blocker Class`, `Evidence Required`, and
    `Owner` fields
  - `Status` exposes the live delivery queue as `Inbox`, `Needs Decision`,
    `Ready`, `In Progress`, `In Review`, `In QA`, `Blocked`, and `Done`
  - every epic issue has native GitHub sub-issues attached for its child
    backlog tickets
  - every `PROD-*` issue has the correct native GitHub parent issue
  - umbrella issue bodies do not maintain manual tracked-ticket lists as a
    substitute for the native hierarchy
  - the project exposes `All Work`, `Launch Blockers`, `Current Queue`,
    `Parked`, `Off-Repo`, and `By Runtime` views
  - each issue has an owner, priority, dependency note, and runtime
    applicability field or label (`evm-shared`, `svm`, `cross-runtime`, or
    `wrapper-specific`)
  - broad active `P0` tickets are split into child execution issues when needed
    before import
- Dependencies: agreed working branch or merge target
- Source docs: `github-project-production-backlog.md`
- Suggested owner: `release`
- Blocker class: `non-blocking`

### PROD-036 Add a go/no-go release review ritual

- ID: `PROD-036`
- Title: `Add a go/no-go release review ritual`
- Type: `ops`
- Priority: `P1`
- Scope: `active`
- Area: `release`
- Description: Create the review ceremony that decides whether Hyperbet is
  ready to promote from testnet-proven to production-ready.
- Acceptance criteria:
  - signoff template exists
  - required attendees and approvals are defined
  - evidence checklist is attached to the ritual
- Dependencies: `PROD-025`, `PROD-031`, `PROD-033`
- Source docs: `external-audit-package-checklist.md`,
  `tracking-document-map.md`
- Suggested owner: `release`
- Blocker class: `quality-blocking`

## Epic 11: Parked And Add-Chain Epics

### PROD-037 Preserve AVAX as a parked epic without active blocker status

- ID: `PROD-037`
- Title: `Preserve AVAX as a parked epic without active blocker status`
- Type: `docs`
- Priority: `P1`
- Scope: `parked`
- Area: `avax`
- Description: Keep AVAX code, evidence, and investigation work intact while
  ensuring AVAX incompleteness does not block the active `BSC + Solana` board.
- Acceptance criteria:
  - active docs consistently mark AVAX as parked or preserved
  - AVAX evidence remains linked and accessible
  - AVAX does not appear in active blocker summaries unless reactivated
- Dependencies: none
- Source docs: `production-readiness-audit-2026-03-29.md`,
  `tracking-document-map.md`
- Suggested owner: `release`
- Blocker class: `parked`

### PROD-038 Define AVAX reactivation gates and re-entry checklist

- ID: `PROD-038`
- Title: `Define AVAX reactivation gates and re-entry checklist`
- Type: `docs`
- Priority: `P2`
- Scope: `parked`
- Area: `avax`
- Description: Define the exact conditions under which AVAX can be reactivated
  as an active launch lane without rediscovering prior decisions.
- Acceptance criteria:
  - re-entry checklist covers registry truth, custody, proof, soak, and runtime
    contract verification
  - owner signoff is required before AVAX re-enters the blocker list
  - active docs reference the same reactivation criteria
- Dependencies: `PROD-037`
- Source docs: `pm-launch-execution-plan.md`,
  `tracking-document-map.md`
- Suggested owner: `release`
- Blocker class: `parked`

### PROD-038A Define Base add-chain promotion checklist

- ID: `PROD-038A`
- Title: `Define Base add-chain promotion checklist`
- Type: `docs`
- Priority: `P2`
- Scope: `parked`
- Area: `base`
- Description: Keep Base as a non-blocking add-chain lane with one explicit
  re-entry checklist so the team can promote it later without reopening scope
  confusion about the active launch gate.
- Acceptance criteria:
  - Base promotion checklist covers registry truth, custody, staged proof,
    runtime contract verification, and product-surface evidence
  - Base remains excluded from active blocker summaries until an explicit
    product decision promotes it
  - owner signoff is required before Base becomes an active launch lane
- Dependencies: `PROD-001A`
- Source docs: `prediction-market-release-prep.md`,
  `tracking-document-map.md`
- Suggested owner: `release`
- Blocker class: `parked`

## Epic 12: Repository Governance, Review Automation, And OSS Housekeeping

### PROD-039 Establish the repository governance baseline

- ID: `PROD-039`
- Title: `Establish the repository governance baseline`
- Type: `docs`
- Priority: `P1`
- Scope: `active`
- Area: `repo-governance`
- Description: Add the missing repository control-plane files that make review,
  ownership, disclosure, and contribution expectations explicit from day one.
- Acceptance criteria:
  - `.github/CODEOWNERS` exists with clear ownership for protocol, keeper, app,
    workflows, docs, and release surfaces
  - `CONTRIBUTING.md` exists with branch, commit, testing, and PR expectations
  - `SECURITY.md` exists with vulnerability reporting and embargo guidance
  - `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/` exist
- Dependencies: owner list and escalation path
- Source docs: `tracking-document-map.md`,
  `production-readiness-audit-2026-03-29.md`,
  external benchmarks: `milady/.github/PULL_REQUEST_TEMPLATE.md`,
  `HyperscapeAI/hyperscape/.github/CODEOWNERS`
- Suggested owner: `release`
- Blocker class: `quality-blocking`

### PROD-040 Add a PR evidence contract and automated validation

- ID: `PROD-040`
- Title: `Add a PR evidence contract and automated validation`
- Type: `ci`
- Priority: `P1`
- Scope: `active`
- Area: `review`
- Description: Require PRs to state what changed, why, how it was verified, and
  what evidence exists, then validate that contract automatically for
  launch-critical surfaces.
- Acceptance criteria:
  - PR template requires `What`, `Why`, `How`, `Testing`, `Evidence`, `Risk`,
    and `Rollback`
  - protocol, keeper, app, and workflow PRs must include concrete evidence such
    as test commands, screenshots, tx hashes, or artifact paths
  - CI flags incomplete PR bodies or missing evidence for critical change areas
- Dependencies: `PROD-039`
- Source docs: `stage-a-browser-acceptance-matrix.md`,
  `stage-a-promotion-execution-ledger.md`,
  `external-audit-package-checklist.md`,
  external benchmark: `milady/.github/PULL_REQUEST_TEMPLATE.md`
- Suggested owner: `release`
- Blocker class: `quality-blocking`

### PROD-041 Add a safe AI-assisted PR review workflow for Hyperbet

- ID: `PROD-041`
- Title: `Add a safe AI-assisted PR review workflow for Hyperbet`
- Type: `feature`
- Priority: `P1`
- Scope: `active`
- Area: `review-automation`
- Description: Add an AI code-review workflow that improves reviewer throughput
  without turning the repo into an agent-governed system or exposing the repo
  to unsafe workflow patterns.
- Acceptance criteria:
  - one primary AI reviewer is selected for Hyperbet PR review automation
  - the workflow is read-first, comment-only, and does not auto-close, auto-merge,
    or self-approve PRs
  - external-contributor safety is explicit: no unsafe `pull_request_target`
    secret exposure, no broad write tokens, no unrestricted tool access
  - human CODEOWNER approval remains mandatory for protocol, security, release,
    and workflow changes
- Dependencies: `PROD-039`, `PROD-046`
- Source docs: `tracking-document-map.md`,
  external benchmarks: `HyperscapeAI/hyperscape/.github/workflows/claude-code-review.yml`,
  `milady/.github/workflows/agent-review.yml`
- Suggested owner: `infra`
- Blocker class: `quality-blocking`

### PROD-042 Add workflow linting and agentic-action security scanning

- ID: `PROD-042`
- Title: `Add workflow linting and agentic-action security scanning`
- Type: `security`
- Priority: `P1`
- Scope: `active`
- Area: `github-actions`
- Description: Add CI checks that specifically protect GitHub Actions and any
  future AI-agent workflows from configuration drift and unsafe trigger or
  permission choices.
- Acceptance criteria:
  - workflow linting runs in CI for every workflow change
  - workflow security scanning covers dangerous triggers, excessive
    permissions, unpinned actions, and unsafe agent-tool settings
  - CI fails when new workflow files violate the policy
- Dependencies: `PROD-041`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  external benchmarks: `milady/.github/actionlint.yaml`,
  `HyperscapeAI/hyperscape/.github/workflows/security.yml`
- Suggested owner: `security`
- Blocker class: `quality-blocking`

### PROD-043 Add repository dependency hygiene automation

- ID: `PROD-043`
- Title: `Add repository dependency hygiene automation`
- Type: `improvement`
- Priority: `P1`
- Scope: `active`
- Area: `dependencies`
- Description: Add automated dependency update flows for npm workspaces,
  GitHub Actions, and Docker surfaces so the repo does not drift into stale or
  unreviewable infrastructure.
- Acceptance criteria:
  - `dependabot.yml` exists and covers active package directories plus
    GitHub Actions
  - update groups are tuned to avoid review spam
  - the review policy for automated dependency PRs is documented
- Dependencies: `PROD-039`
- Source docs: external benchmark:
  `HyperscapeAI/hyperscape/.github/dependabot.yml`
- Suggested owner: `infra`
- Blocker class: `quality-blocking`

### PROD-044 Add repo security automation beyond Solidity-specific scanning

- ID: `PROD-044`
- Title: `Add repo security automation beyond Solidity-specific scanning`
- Type: `security`
- Priority: `P1`
- Scope: `active`
- Area: `security-automation`
- Description: Complement the current Slither and protocol gates with repo-wide
  security automation for JavaScript/TypeScript, workflow surfaces, and secret
  exposure.
- Acceptance criteria:
  - CodeQL or equivalent static analysis runs on the active JS/TS codebase
  - dependency audit runs on a schedule
  - secret scanning policy is documented and automated where practical
- Dependencies: `PROD-042`, `PROD-043`
- Source docs: `production-readiness-audit-2026-03-29.md`,
  external benchmark: `HyperscapeAI/hyperscape/.github/workflows/security.yml`
- Suggested owner: `security`
- Blocker class: `quality-blocking`

### PROD-045 Add label and triage automation for PRs and issues

- ID: `PROD-045`
- Title: `Add label and triage automation for PRs and issues`
- Type: `improvement`
- Priority: `P2`
- Scope: `active`
- Area: `triage`
- Description: Add lightweight labeling and intake automation so the repo can
  route bugs, security reports, protocol changes, release work, and docs work
  quickly without turning triage into manual bookkeeping.
- Acceptance criteria:
  - path-based PR labels are applied automatically
  - issue templates feed consistent labels for bug, security, docs, and ops
  - triage labels align with the GitHub project fields
- Dependencies: `PROD-039`
- Source docs: `tracking-document-map.md`,
  external benchmarks: `milady/.github/labeler.yml`,
  `milady/.github/workflows/auto-label.yml`
- Suggested owner: `release`
- Blocker class: `non-blocking`

### PROD-046 Define branch protection, required checks, and review policy

- ID: `PROD-046`
- Title: `Define branch protection, required checks, and review policy`
- Type: `ops`
- Priority: `P1`
- Scope: `active`
- Area: `repo-governance`
- Description: Turn the desired repo-review standards into enforced GitHub
  settings for `main`, `develop`, and any protected release branches.
- Acceptance criteria:
  - required status checks are defined explicitly for CI, prediction-market
    gates, and any new review/security workflows
  - stale approvals are dismissed on new commits
  - CODEOWNER review is required for sensitive paths
  - merge policy is documented and enforced consistently
- Dependencies: `PROD-039`, `PROD-040`, `PROD-041`
- Source docs: `tracking-document-map.md`,
  `github-project-production-backlog.md`
- Suggested owner: `release`
- Blocker class: `quality-blocking`

## Suggested Milestones

- `M1 - Perimeter hardening, launch truth, and governance closeout`
- `M2 - Hyperscapes integration contract and runtime recovery hardening`
- `M3 - Staged proof, soak, and audit packet`
- `M4 - Reliability, reconciliation, and production operations`
- `M5 - Compliance, launch governance, and long-tail hardening`

## Suggested First 12 Issues To Open

1. `PROD-021 Make keeper write auth fail closed across the active keeper surfaces`
2. `PROD-022 Remove origin-based trust from the Solana sender proxy`
3. `PROD-023 Enforce read-only allowlists and quotas on public RPC proxies`
4. `PROD-014 Version and contract-test the Hyperscapes to Hyperbet integration boundary`
5. `PROD-014A Canonicalize keeper ingestion onto the versioned Hyperscapes betting feed`
6. `PROD-014B Make feed parsing fail closed on schema drift, replay mismatch, and source resets`
7. `PROD-001 Populate canonical active launch-chain registry truth from final receipts`
8. `PROD-001A Align active launch constants and feature-flag truth with the current scope contract`
9. `PROD-009 Finish multisig, timelock, and upgrade-authority custody for the active launch chains`
10. `PROD-015B Decide and freeze the production AMM settlement model`
11. `PROD-049 Freeze the active app-shell acceptance contract for the full Hyperbet surface`
12. `PROD-047 Productionize shared wallet and account surfaces across the active runtimes`
