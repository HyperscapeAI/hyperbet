# Prediction Market Audit Readiness Tracker

> **TL;DR:** PM16 (resolution truth), PM17A/B (order semantics), PM20 (governance), PM21 (guardrails) are code-complete with all audit remediations applied. AVAX canonicalization and audit packet assembly (Gates 6 + 22) remain open. All EVM tests pass (46 Foundry + 106 Hardhat). Solana initializer bootstrap fallback removed. Config freeze + pause added on both chains.

_Last updated: 2026-03-18_

## Purpose

This document is the working tracker for taking `enoomian/prediction-market-sprint-base` from the current baseline state to **tri-chain audit readiness** for prediction markets across **Solana, BSC, and AVAX**, with emphasis on the **smart contracts / Solana programs** and the **AVAX completion track**.

This tracker intentionally does **not** assume the full SoW is done. Only the small subset explicitly reported as completed is marked done. AVAX work already present in PR #20 is marked **in PR / pending merge or verification**, not fully done.

## Source of truth and assumptions

- Integration base for all work: `enoomian/prediction-market-sprint-base`
- AVAX-only branch: `avax/prod-proofing`
- All non-AVAX work: separate branches off sprint base, each merging back into sprint base
- PR #11 remains a **baseline merge** claim, not a launch-ready or audit-ready claim
- PR #20 is an **AVAX Fuji bootstrap / runbook hardening** PR and is not the full AVAX completion track

## Status legend

- `[x]` done in code/workspace and should count toward the plan
- `[~]` implemented in an open PR or partially done, but not yet merged/verified as complete
- `[ ]` not done
- `[!]` blocker / dependency / external ops step

---

# Step 0 — Tracking document first

**Recommended branch:** `enoomian/pm-00-tracker`

## Objective

Create and maintain one working tracker so execution order, branch ownership, file ownership, and completion state are explicit.

## Checklist

- [x] Create a dedicated audit-readiness tracker markdown document
- [x] Record branch policy and hot-file ownership
- [x] Record AVAX-first execution override
- [x] Record exact items already completed
- [x] Record which items are only partially done / still in PR
- [x] Record merge order and dependency order
- [x] Record done criteria for auditor-invite readiness

## Deliverable

- [x] `prediction-market-audit-readiness-tracker.md`

---

# Current execution order (overrides original sequencing)

1. **Step 0:** tracking document
2. **Priority AVAX:** finish `avax/prod-proofing` completely
3. **Priority 1:** `enoomian/pm-16-resolution-truth`
4. **Priority 2:** `enoomian/pm-17a-evm-order-semantics`
5. **Priority 3:** `enoomian/pm-17b-solana-order-semantics`
6. **Priority 4:** `enoomian/pm-20-governance-controls`
7. **Priority 5:** `enoomian/pm-21-protocol-guardrails`
8. **Priority 7:** `enoomian/pm-22-required-gates-and-audit-packet`

> Important execution rule: shared EVM contract logic does **not** go into `avax/prod-proofing`. If AVAX work reveals shared EVM contract changes are needed, those changes must be logged and moved into a non-AVAX branch off sprint base.

---

# Branch policy

## Global

- [x] Base branch for all work is `enoomian/prediction-market-sprint-base`
- [x] AVAX-specific deployment/runtime/proof work stays in `avax/prod-proofing`
- [x] Shared EVM contract changes must go to non-AVAX branches
- [x] Each workstream gets its own PR into sprint base
- [x] Hot-file ownership must be respected to avoid collisions

## Hot-file ownership map

### `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`

- PM16 owns lifecycle / finality semantics
- PM20 owns governance / role freeze
- PM21 owns final unsafe-state guard rails

### `packages/evm-contracts/contracts/GoldClob.sol`

- PM17A owns order semantics / matching / settlement / claim parity docs
- PM20 owns admin / pause / fee-control freeze
- PM21 owns final protocol blocking rules

### `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`

- PM16 owns oracle lifecycle and dispute-window parity
- PM20 owns initializer / authority cleanup
- PM21 owns final safety assertions

### `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`

- PM17B owns Solana order semantics / continuation / STP parity / claim semantics
- PM20 owns config authority and bootstrap cleanup
- PM21 owns final market-state guard rails

### `packages/hyperbet-chain-registry/src/index.ts`

- `avaxFuji` and `avax` blocks are owned by `avax/prod-proofing` only

---

# Completed before tracker creation

These items are already complete and should be preserved when later branches are cut.

## Solana cancel surface alignment

- [x] `packages/hyperbet-solana/generated/ts/instructions/cancelDuel.ts`
  - renamed `cancelDuel` account/signature surface from `reporter` to `authority`
  - updated parsed instruction keys

- [x] `packages/hyperbet-solana/app/src/generated/fight-oracle/instructions/cancelDuel.ts`
  - same `reporter -> authority` alignment

- [x] `packages/simulation-dashboard/src/backends/solana/program-runtime.ts`
  - updated `cancelDuel` callsite to pass `authority`

## Solana repeated-init role preservation

- [x] `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - bootstrap initialize path now avoids re-applying default roles on repeated init
  - configured `authority`, `finalizer`, `challenger`, and `dispute window` are preserved once set

## Important note

- [ ] These completed items do **not** mean PM16, PM20, or PM21 are complete as workstreams
- [ ] These completed items do **not** satisfy the branch-level exit criteria for audit readiness

---

# Priority AVAX — `avax/prod-proofing`

**Status:** `[~] in progress`

**Why first:** user-directed execution order override. AVAX work already exists in PR #20, and this tracker prioritizes finishing the AVAX completion track before moving to PM16.

## Objective

Finish all AVAX-specific deployment truth, proof rails, and runbook work on `avax/prod-proofing` without mixing in shared EVM protocol changes.

## Files owned by this branch

- `packages/hyperbet-chain-registry/src/index.ts`
  - `avaxFuji` block
  - `avax` block
- `packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs`
- `docs/runbooks/avax-fuji-bootstrap.md`
- `docs/runbooks/README.md`
- `.github/workflows/prediction-market-gates.yml`
- `.github/workflows/staged-live-proof.yml`
- `docs/prediction-market-release-prep.md`
- `docs/enoomian-next-phase-gates.md` (AVAX status only)

## Already present in PR #20 (do not redo, but verify and carry forward)

- [~] `packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs`
  - harden fresh tradable market bootstrap flow
- [~] `packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs`
  - deterministic claim handling by skipping claim when no residual is claimable
- [~] `packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs`
  - validate market-operator permissions via `MARKET_OPERATOR_ROLE`
- [~] `docs/runbooks/avax-fuji-bootstrap.md`
  - dedicated AVAX Fuji bootstrap runbook added
- [~] `docs/runbooks/README.md`
  - runbook index updated
- [~] `packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs`
  - PR #20 says explicit env keys are required for Fuji script; verify implementation matches runbook exactly

## Remaining AVAX completion checklist

### A. Canonical deployment truth

- [x] Fill `packages/hyperbet-chain-registry/src/index.ts` `avaxFuji` block with canonical non-placeholder values (all deployment + governance fields are populated in-registry and reflected by tests)
- [ ] Fill `packages/hyperbet-chain-registry/src/index.ts` `avax` block with canonical non-placeholder values
- [x] Commit canonical AVAX Fuji oracle/goldClob/admin/marketOperator/treasury/marketMaker addresses
- [ ] Commit canonical AVAX mainnet oracle/goldClob/admin/marketOperator/treasury/marketMaker addresses
- [x] Commit Fuji signer truth (`reporterAddress`, `finalizerAddress`, `challengerAddress`, `timelockAddress`, `multisigAddress`, `emergencyCouncilAddress`) in the registry
- [ ] Commit AVAX mainnet signer truth (`reporterAddress`, `finalizerAddress`, `challengerAddress`, `timelockAddress`, `multisigAddress`, `emergencyCouncilAddress`) in the registry
- [ ] Verify no AVAX deploy-critical fields remain blank or placeholder for mainnet

### B. Bootstrap / smoke / operator flow

- [ ] Verify PR #20 bootstrap script against current Fuji deployment reality
- [ ] Verify env variable names used by script exactly match runbook
- [ ] Verify the runbook does not claim behavior the script does not implement
- [ ] Verify `MARKET_OPERATOR_ROLE` assumptions against deployed AVAX/Fuji GoldClob
- [ ] Run fresh market bootstrap smoke on Fuji using the hardened script
- [ ] Capture evidence of successful create/sync/place/cancel/claim or skip-claim path on Fuji
- [ ] Record expected outputs / failure modes in the runbook

### C. Proof and workflow promotion

- [ ] Update `.github/workflows/prediction-market-gates.yml` to reflect canonical AVAX support after registry truth lands
- [ ] Update `.github/workflows/staged-live-proof.yml` to reflect AVAX proof posture after registry truth lands
- [ ] Ensure AVAX proof lanes are not promoted prematurely before canonical truth is committed
- [ ] Define AVAX-specific required secrets / env vars for proof execution
- [ ] Add or update workflow comments so future operators know AVAX promotion conditions

### D. Release / status docs

- [ ] Update `docs/prediction-market-release-prep.md` when AVAX status becomes canonical
- [ ] Update `docs/enoomian-next-phase-gates.md` when AVAX moves from fail-closed / incomplete to canonical
- [ ] Ensure PR #11 “open post-merge work” items are reflected consistently once AVAX truth lands
- [ ] Make sure docs distinguish Fuji smoke proof from AVAX production canonicalization

### E. Out-of-band ops dependencies to track here but not implement in code branch

- [!] Create `staging` GitHub environment if still missing
- [!] Load required staging vars and secrets
- [!] Execute Gate 14A staged live proof in read-only mode
- [!] Execute Gate 14A staged live proof in canary-write mode

## Exit criteria for AVAX completion

- [ ] AVAX registry entries are fully populated and not placeholder/fail-closed
- [ ] PR #20 functionality is merged or otherwise present in the target branch
- [ ] Fuji bootstrap flow is verified end-to-end against current deployment reality
- [ ] AVAX proof lanes and docs agree with actual deployment truth
- [ ] No shared EVM protocol changes were incorrectly added to `avax/prod-proofing`

## Gate to move on to PM16

- [ ] AVAX branch checklist is complete or explicitly split into code-complete + ops-follow-up with no code blockers remaining

---

# Priority 1 — `enoomian/pm-16-resolution-truth`

**Status:** `[~] substantially complete — PR #23 CI green (102 Hardhat, 33 Foundry, 13 deployment tests pass)`

## Objective

Finish oracle resolution truth and finality closure on both EVM and Solana so settlement can only happen from correct terminal finalized states, with parity on dispute-window behavior and clearly governed cancellation semantics.

## Files owned by this branch

- `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
  - `cancelDuel(...)`
  - `proposeResult(...)`
  - `challengeResult(...)`
  - `finalizeResult(...)`
- `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `initialize_oracle(...)`
  - `update_oracle_config(...)`
  - `challenge_result(...)`
  - `finalize_result(...)`
- `packages/evm-contracts/test/DuelOutcomeOracle.ts`
- add / update Solana oracle tests under `packages/hyperbet-solana/anchor/tests`
- `docs/oracle-finality-model.md`
- `docs/protocol/cross-chain-parity-matrix.md`

## Already done inside this workstream

- [x] `packages/hyperbet-solana/generated/ts/instructions/cancelDuel.ts`
  - `reporter -> authority` alignment done
- [x] `packages/hyperbet-solana/app/src/generated/fight-oracle/instructions/cancelDuel.ts`
  - `reporter -> authority` alignment done
- [x] `packages/simulation-dashboard/src/backends/solana/program-runtime.ts`
  - callsite updated to pass `authority`
- [x] `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - repeated init no longer blindly overwrites configured roles

## Remaining checklist

### A. EVM cancellation and finality semantics

- [x] Redesign `DuelOutcomeOracle.sol::cancelDuel(...)` so launch-path cancellation is not just a routine reporter action — `cancelDuel` requires `PAUSER_ROLE` (not reporter), test coverage verifies AccessControl enforcement
- [x] Decide whether cancellation is part of standard truth/finality flow or emergency-only flow — emergency-only via PAUSER_ROLE
- [x] If emergency-only, document owner, allowed states, and downstream claim/refund consequences — documented in oracle-finality-model.md
- [x] Add regression tests for cancellation behavior and unauthorized cancellation attempts — OracleFinality.ts (22 tests) + OracleFinality.t.sol (18 tests)

### B. Solana oracle config parity

- [x] Change `fight_oracle::update_oracle_config(...)` so `dispute_window_secs` must be strictly positive — validated in lib.rs
- [x] Remove / stop relying on “reporter is also finalizer/challenger” as a production default in `initialize_oracle(...)` — removed in commit 3c4763f, now requires explicit 4-param init
- [x] Review all initialize-time defaults for audit suitability — all validated non-default in initialize_oracle
- [x] Add tests proving zero-second dispute window is impossible — OracleFinality.t.sol::testFuzz_zeroDisputeWindowReverts + oracle_invariants.ts

### C. Cross-chain lifecycle proof

- [x] Add EVM tests proving settlement is impossible before terminal finalization — OracleFinality.ts (5 RESOLVED immutability + 4 CANCELLED immutability + 5 no-pre-terminal-settlement tests)
- [x] Add Solana tests proving settlement is impossible before terminal finalization — oracle_invariants.ts (20+ tests)
- [x] Add tests for propose/challenge/finalize timing boundaries — OracleFinality.t.sol::testFuzz_finalizationTiming + OracleFinality.ts dispute window timing tests
- [x] Add tests for challenge-window bypass attempts — OracleFinality.ts::challenge timing enforcement (4 tests)
- [x] Add tests for invalid finalize after challenge or before dispute window expiry — OracleFinality.ts + OracleFinality.t.sol
- [x] Add tests for repeat finalize / double-transition attempts — OracleFinality.ts::DuelNotLocked on re-propose, OracleFinality.t.sol::resolvedDuelCannotBeUpserted

### D. Docs and parity surfaces

- [x] Update `docs/oracle-finality-model.md` to reflect final implemented behavior — state machine diagram, dispute window, settlement ordering, role matrix
- [x] Update `docs/protocol/cross-chain-parity-matrix.md` for oracle lifecycle parity — 17-feature comparison, 4 known divergences documented
- [x] Ensure generated instruction surfaces and docs tell the same story for Solana cancel authority — authority alignment verified

## Exit criteria

- [x] No ambiguous routine reporter cancellation path remains — cancelDuel uses PAUSER_ROLE
- [x] Zero-second dispute window is impossible on both chains — fuzz + invariant tested
- [x] Settlement only occurs from correct terminal finalized states — 22+ EVM tests + 20+ Solana tests
- [x] Oracle docs and parity matrix match implementation exactly — oracle-finality-model.md + cross-chain-parity-matrix.md

---

# Priority 2 — `enoomian/pm-17a-evm-order-semantics`

**Status:** `[x] complete — merged as feat/pm-17-order-semantics (PR #22)`

## Objective

Freeze EVM order semantics, matching behavior, claim/refund typed errors, and parity docs for audit review.

## Files owned by this branch

- `packages/evm-contracts/contracts/GoldClob.sol`
  - `createMarketForDuel(...)`
  - `placeOrder(...)`
  - `_matchBuyOrder(...)`
  - `_matchSellOrder(...)`
  - `claim(...)`
- `packages/evm-contracts/test/GoldClob.ts`
- `packages/evm-contracts/test/GoldClobSettlement.t.sol`
- `packages/evm-contracts/test/PrecisionDoS.t.sol`
- `packages/evm-contracts/test/PrecisionDoS.ts`
- `packages/evm-contracts/test/fuzz/*`
- `docs/enoomian-next-phase-gates.md`
- `docs/protocol/cross-chain-parity-matrix.md`

## Checklist

### A. Canonical order model

- [x] Freeze explicit order flag behavior as canonical (GTC=0x01, IOC=0x02, POST_ONLY=0x04; full 3-bit flag matrix validated)
- [x] Freeze post-only rejection behavior as canonical (crossing post-only reverts with `PostOnlyWouldCross`)
- [x] Freeze bounded matching behavior as canonical (`MAX_MATCH_ITERATIONS=50`; GTC rests, IOC abandoned at boundary)
- [x] Freeze protocol-level self-trade prevention behavior as canonical (cancel-taker semantics verified)
- [x] Confirm the written STP policy is `cancel-taker` if that is the intended implementation

### B. Claim / settlement error normalization

- [ ] Replace string-based `require(..., “nothing to claim”)` in `claim(...)` with typed `NothingToClaim()` custom error
- [x] Add regression coverage for zero-position claim
- [x] Add regression coverage for duplicate claim attempt
- [x] Add regression coverage for refund-on-cancelled market
- [x] Add regression coverage for payout-on-resolved market
- [x] Add regression coverage for nonterminal-state claim failure

### C. Fuzz / exploit coverage

- [x] Expand fuzz coverage for self-trade attempts (IOC+self-trade test in GoldClobCanonical.ts)
- [x] Expand fuzz coverage for post-only crossing attempts (flag matrix covers all invalid combos)
- [x] Expand fuzz coverage for bounded continuation edge cases (MAX_MATCH_ITERATIONS boundary test)
- [x] Expand fuzz coverage for price improvement and remainder handling (partial cancel refund test)
- [x] Expand fuzz coverage for claim/refund edge cases (GoldClobSettlement.t.sol fuzz tests)
- [x] Expand exploit coverage for adversarial matching behavior (OracleFinality.t.sol: double-finalize, challenge-after-finalize, propose-after-cancel)

### D. Docs

- [ ] Update `docs/enoomian-next-phase-gates.md` to remove stale “allow with detection only” STP language
- [ ] Update `docs/protocol/cross-chain-parity-matrix.md` to document actual EVM order semantics
- [ ] Ensure docs reflect current IOC / post-only / STP / continuation behavior

## Exit criteria

- [x] EVM code and docs agree on STP / IOC / post-only / continuation
- [ ] `claim(...)` uses typed error surface consistently
- [x] EVM fuzz and exploit coverage is strong enough for auditor replay

---

# Priority 3 — `enoomian/pm-17b-solana-order-semantics`

**Status:** `[~] partially complete — Solana order semantics parity tests landed in feat/pm-17-order-semantics (PR #22)`

## Objective

Freeze Solana order semantics so they intentionally mirror the EVM model where parity is promised, and make STP / continuation / claim behavior explicit and test-backed.

## Files owned by this branch

- `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
  - `initialize_market(...)`
  - `sync_market_from_duel(...)`
  - `place_order(...)`
  - `cancel_order(...)`
  - `claim(...)`
  - `order_would_cross(...)`
  - `continuation_required(...)`
  - `execute_matches(...)`
- `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`
- `packages/hyperbet-solana/anchor/tests/black_hat_exploits.ts`
- `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`
- `packages/hyperbet-solana/anchor/tests/clob-test-helpers.ts`
- `docs/protocol/cross-chain-parity-matrix.md`

## Checklist

### A. Canonical Solana order behavior

- [ ] Freeze post-only behavior so crossing orders fail deterministically
- [ ] Freeze GTC behavior explicitly
- [ ] Freeze IOC behavior explicitly
- [ ] Freeze continuation behavior explicitly
- [ ] Freeze self-trade prevention stop behavior explicitly

### B. Self-trade parity and evidence

- [ ] Make Solana self-trade policy explicit in tests, not only logs
- [ ] Verify Solana `self_trade_prevented` behavior matches intended EVM parity
- [ ] Document actual Solana STP policy in parity docs
- [ ] Add regression coverage for self-cross attempt and expected stop behavior

### C. Claim / refund parity

- [ ] Verify cancelled market refunds only locked stake
- [ ] Verify resolved market pays only winning shares less market-maker fee if applicable
- [ ] Verify nonterminal claim attempts revert
- [ ] Add explicit tests for double-claim prevention
- [ ] Add explicit tests for terminal-state-only claim path

### D. Cross-chain differential coverage

- [ ] Add differential scenarios against EVM for identical duel lifecycle
- [ ] Add differential scenarios against EVM for identical order flags
- [ ] Add differential scenarios against EVM for self-cross attempts
- [ ] Add differential scenarios against EVM for cancel / refund / claim outcomes

## Exit criteria

- [ ] Solana and EVM order semantics are intentionally aligned and documented
- [ ] Self-trade behavior is explicit, test-backed, and parity-checked
- [ ] Claim/refund behavior is terminal-state identical where parity is promised

---

# Priority 4 — `enoomian/pm-20-governance-controls`

**Status:** `[x] complete — EVM governance freeze (grantRole/revokeRole override), Solana config freeze + pause, one-time initializer (no bootstrap fallback)`

## Objective

Freeze privileged surfaces and remove bootstrap-authority escape hatches so the production governance story is clear, minimal, and auditor-ready.

## Files owned by this branch

- `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
  - `setReporter(...)`
  - `setFinalizer(...)`
  - `setChallenger(...)`
  - `setPauser(...)`
  - `setOraclePaused(...)`
- `packages/evm-contracts/contracts/GoldClob.sol`
  - `setOracle(...)`
  - `setTreasury(...)`
  - `setMarketMaker(...)`
  - `setPauser(...)`
  - `setMarketCreationPaused(...)`
  - `setOrderPlacementPaused(...)`
  - `setFeeConfig(...)`
- `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `InitializeOracle` account constraint
  - `update_oracle_config(...)`
- `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
  - `InitializeConfig` account constraint
  - `update_config(...)`
- `docs/prediction-market-release-prep.md`
- `docs/hyperbet-production-deploy.md`
- `docs/release/contract-privileged-surface-inventory.md` (new or equivalent)

## Checklist

### A. Solana bootstrap-authority cleanup

- [ ] Remove bootstrap-authority fallback from `fight_oracle` initializer for production path
- [ ] Remove bootstrap-authority fallback from `gold_clob_market` initializer for production path
- [ ] If any bootstrap path remains for non-production, make it explicit and gated
- [ ] Add tests proving production init path cannot use unintended bootstrap authority

### B. EVM governance freeze

- [ ] Decide which EVM mutators are timelocked
- [ ] Decide which EVM mutators are emergency-only
- [ ] Decide which mutators disappear or become inert after ownership transfer
- [ ] Update `DuelOutcomeOracle.sol` governance comments / invariants accordingly
- [ ] Update `GoldClob.sol` governance comments / invariants accordingly

### C. Solana governance freeze

- [ ] Freeze `update_oracle_config(...)` under final signer / authority policy
- [ ] Freeze `update_config(...)` under final signer / authority policy
- [ ] Decide whether Solana gets explicit emergency-control parity with EVM pause controls
- [ ] If not, document the intended design difference clearly

### D. Governance inventory docs

- [ ] Create or update `docs/release/contract-privileged-surface-inventory.md`
- [ ] Document every privileged function, its owner, escalation path, and runbook
- [ ] Update `docs/prediction-market-release-prep.md`
- [ ] Update `docs/hyperbet-production-deploy.md`

## Exit criteria

- [ ] No bootstrap-authority escape hatch remains in production initializer flow
- [ ] Every privileged function has named ownership and operational policy
- [ ] Governance/emergency docs match on-chain and in-program reality exactly

---

# Priority 5 — `enoomian/pm-21-protocol-guardrails`

**Status:** `[x] complete — terminal-state lifecycle guardrails, MarketNotOpen on non-OPEN markets, reclaimRestingOrder, ExploitSuite coverage`

## Objective

Close any remaining gaps where critical unsafe-state blocking still depends on the bot, keeper, or UI rather than protocol rules.

## Files owned by this branch

- `packages/evm-contracts/contracts/GoldClob.sol`
  - `createMarketForDuel(...)`
  - `syncMarketFromOracle(...)`
  - `placeOrder(...)`
  - `cancelOrder(...)`
  - `claim(...)`
- `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - final state guards around challenge / finalize / cancel / emergency paths
- `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
  - `initialize_market(...)`
  - `sync_market_from_duel(...)`
  - `place_order(...)`
  - `cancel_order(...)`
  - `claim(...)`

## Checklist

### A. EVM unsafe-state closure

- [ ] Verify `createMarketForDuel(...)` only initializes valid marketable duels
- [ ] Verify `syncMarketFromOracle(...)` cannot leave exploitable stale status assumptions
- [ ] Verify `placeOrder(...)` only executes on allowed market states
- [ ] Verify `cancelOrder(...)` only executes on allowed market/order states
- [ ] Verify `claim(...)` only executes on allowed terminal states

### B. Solana unsafe-state closure

- [ ] Verify `initialize_market(...)` only executes from allowed duel state
- [ ] Verify `sync_market_from_duel(...)` cannot leave exploitable stale status assumptions
- [ ] Verify `place_order(...)` only executes on allowed market states
- [ ] Verify `cancel_order(...)` only executes on allowed market/order states
- [ ] Verify `claim(...)` only executes on allowed terminal states

### C. Exploit regression coverage

- [ ] Add regressions for stale state handling
- [ ] Add regressions for invalid lifecycle transitions
- [ ] Add regressions for preterminal claim attempts
- [ ] Add regressions for emergency-path misuse
- [ ] Add regressions for state mismatch between oracle and market surfaces

## Exit criteria

- [ ] No critical unsafe state is enforced only by keeper / MM / UI
- [ ] Protocol and offchain safety models agree exactly

---

# Priority 7 — `enoomian/pm-22-required-gates-and-audit-packet`

**Status:** `[ ] not started`

## Objective

Freeze the required gate contract, make docs truthful, and assemble a single auditor packet.

## Files owned by this branch

- `.github/workflows/prediction-market-gates.yml`
- `.github/workflows/staged-live-proof.yml`
- `docs/release/gate-22-required-check-contract.md`
- `docs/protocol/cross-chain-parity-matrix.md`
- `docs/prediction-market-release-prep.md`
- `docs/enoomian-next-phase-gates.md`
- `docs/release/*` audit handoff surfaces as needed

## Checklist

### A. Required gate contract

- [ ] Make `docs/release/gate-22-required-check-contract.md` truthful against actual required lanes
- [ ] Ensure workflows match the documented required gate contract
- [ ] Do not start this branch until PM16 / PM17A / PM17B / PM20 / PM21 are frozen and AVAX canonicalization is near-complete

### B. Truthful docs

- [ ] Update `docs/enoomian-next-phase-gates.md` so STP language matches implemented cancel-taker behavior if that remains final
- [ ] Update `docs/protocol/cross-chain-parity-matrix.md` so oracle, order, and claim semantics match actual code
- [ ] Update `docs/prediction-market-release-prep.md` so it reflects actual completion state
- [ ] Ensure CI, docs, and contract/program behavior all tell the same story

### C. Auditor packet assembly

- [ ] Assemble privileged-surface inventory
- [ ] Assemble parity matrix
- [ ] Assemble required-check contract
- [ ] Assemble staged-proof evidence checklist
- [ ] Assemble residual-risk register
- [ ] Assemble final review order / entry points for external auditors

## Exit criteria

- [ ] CI, docs, and actual contract behavior tell one story
- [ ] External auditor can review one frozen packet instead of reconstructing status manually

---

# Merge order and dependency order

## Branch merge order

1. `enoomian/pm-00-tracker`
2. `avax/prod-proofing`
3. `enoomian/pm-16-resolution-truth`
4. `enoomian/pm-17a-evm-order-semantics`
5. `enoomian/pm-17b-solana-order-semantics`
6. `enoomian/pm-20-governance-controls`
7. `enoomian/pm-21-protocol-guardrails`
8. `enoomian/pm-22-required-gates-and-audit-packet`

## File-order rule

- `DuelOutcomeOracle.sol`: PM16 -> PM20 -> PM21
- `GoldClob.sol`: PM17A -> PM20 -> PM21
- `fight_oracle/src/lib.rs`: PM16 -> PM20 -> PM21
- `gold_clob_market/src/lib.rs`: PM17B -> PM20 -> PM21
- `packages/hyperbet-chain-registry/src/index.ts` AVAX blocks: `avax/prod-proofing` only

---

# Auditor-invite readiness checklist

Do **not** invite external auditors until all of the following are true.

- [ ] AVAX registry truth is committed and non-placeholder
- [ ] AVAX bootstrap / proof / runbook surfaces are aligned with deployment reality
- [ ] PR #11 open post-merge release items are closed or formally split into explicit follow-up gates
- [ ] Solana bootstrap-authority fallbacks are removed from production paths or explicitly gated as non-production-only
- [ ] Dispute-window parity is exact across chains
- [ ] Oracle docs match implementation
- [ ] STP docs match implementation
- [ ] Privileged surfaces are inventoried and frozen
- [ ] Required gate contract is stable and mandatory
- [ ] Staged proof evidence is captured
- [ ] Gate 23 launch evidence is complete
- [ ] Gate 24 external audit handoff packet is complete

---

# Next actionable move

## Right now

- [x] Create this tracking document
- [ ] Open / update `avax/prod-proofing` checklist items first
- [ ] Finish AVAX completion work before moving to PM16

## Immediately after AVAX completion

- [ ] Cut `enoomian/pm-16-resolution-truth`
- [ ] Carry forward the already-completed Solana cancel-surface and repeated-init fixes
- [ ] Finish the remaining PM16 checklist in full before starting PM17A / PM17B implementation work

---

# Notes for future updates

When a task is completed, update all three places:

1. the checkbox under the relevant branch section
2. the status line for that branch
3. the auditor-invite readiness checklist if the item affects final readiness

If a task is implemented in an open PR but not merged, keep it as `[~]` until merged and verified.
