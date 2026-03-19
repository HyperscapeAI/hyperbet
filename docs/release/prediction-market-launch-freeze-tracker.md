# Prediction-Market Launch Freeze Tracker

> **TL;DR:** Gates 16, 17A, 17B, 20, 21 are complete. Gate 6 (AVAX canonicalization) is blocked on deployment evidence. Gate 22 (audit packet) is not started — depends on WS3 (AVAX) completion. All code-level work is done; remaining items are ops (deploy, populate registry, attach evidence).

Last updated: 2026-03-18

## How to read this tracker
- [x] = done
- [~] = in progress
- [ ] = not started
- [BLOCKED] = waiting on external evidence / missing values

### Current position
- Working in this workspace as a single active track.
- First operational block to execute: **Priority 6 (AVAX canonicalization / rollout prep)**.
- PM-16/PM-17A/PM-17B work is intentionally gated until AVAX registry reality is locked.
- PM-21 guardrail completion is now tracked and validated on this branch.

## Global merge order to enforce
1. Priority 6 (AVAX canonicalization + proof gating)
2. Priority 16 (resolution truth)
3. Priorities 17A and 17B (in parallel)
4. Priority 20 (governance controls)
5. Priority 21 (protocol guardrails)
6. avax/prod-proofing (post shared-contract lock for shared EVM semantics)
7. Priority 22 (audit packet / required gates)

---

## [6] Priority: `avax/prod-proofing`
**Owner:** AVAX integration
**Status:** [~]

- [x] Track file added for this branch scope.
- [x] AVAX branch work already owns:
  - `packages/hyperbet-chain-registry/src/index.ts`
  - `packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs`
  - `docs/runbooks/avax-fuji-bootstrap.md`
  - `docs/runbooks/README.md`
  - `docs/hyperbet-production-deploy.md`
  - `.github/workflows/prediction-market-gates.yml`
  - `.github/workflows/staged-live-proof.yml`
  - `docs/prediction-market-release-prep.md`
- [x] AVAX bootstrap runbook already documents operator-only smoke path expectations (explicit env requirements, deterministic cleanup, claim skip logic, role checks).
- [x] AVAX staged-proof workflow options already include `target=avax` plus AVAX-specific artifacts and env audit.
- [BLOCKED] Canonical AVAX deployment truth in code: `packages/hyperbet-chain-registry/src/index.ts` and `packages/hyperbet-avax/deployments/contracts.json` still contain blank chain-truth values for:
  - `duelOracleAddress`
  - `goldClobAddress`
  - `adminAddress`
  - `marketOperatorAddress`
  - `treasuryAddress`
  - `marketMakerAddress`
  - `reporterAddress`
  - `finalizerAddress`
  - `challengerAddress`
  - `timelockAddress`
  - `multisigAddress`
  - `emergencyCouncilAddress`
  - `goldTokenAddress`
- [x] Conservative proof/docs posture is already visible: release + runbook docs still mark AVAX launch as pending canonical proof and proof artifacts.

### Immediate AVAX actions completed in this workspace
- [x] Added explicit tracking entry: this document.
- [x] Updated `.github/workflows/prediction-market-gates.yml` to keep `solana` and `bsc` cross-chain lanes only while AVAX is not canonicalized (prevents AVAX from being treated as fully promoted in shared CI lanes until registry is populated).
- [ ] Populate canonical AVAX addresses and governance fields from deployment evidence (Fuji + mainnet).
- [ ] Add a second-pass tracker line in release docs and runbook index once canonicalization lands.

---

## [16] Priority: `enoomian/pm-16-resolution-truth`
**Owner:** Gate 16
**Status:** [x]

- [x] Redesign EVM cancellation path — `cancelDuel` requires `PAUSER_ROLE`, not reporter. `reproposeResult` added for challenge resolution.
- [x] Minimum 60-second dispute window enforced on both chains (EVM constructor + Solana initialize/update).
- [x] Bootstrap fallback removed — `initialize_oracle` is one-time only (`AlreadyInitialized` on re-call). Explicit 4-param init (reporter, finalizer, challenger, dispute_window).
- [x] Invariant tests proving no settlement before terminal finalization:
  - EVM: `OracleFinality.ts` (22 tests), `OracleFinality.t.sol` (21 tests), `ExploitSuite.t.sol` (10 tests)
  - Solana: `oracle_invariants.ts`, `oracle-finality.test.ts`
- [x] Oracle documentation updated:
  - `docs/oracle-finality-model.md` — state machine, dispute window, role matrix
  - `docs/protocol/cross-chain-parity-matrix.md` — 17-feature parity comparison

### Acceptance checkpoints
- [x] Finality is trust-minimized: propose/challenge/finalize with separate keys.
- [x] Dispute window minimum 60 seconds on both chains.
- [x] Emergency cancellation is PAUSER_ROLE only (EVM) / authority only (Solana), documented.

---

## [17A] Priority: `enoomian/pm-17a-evm-order-semantics`
**Owner:** Gate 17A
**Status:** [x]

- [x] Confirm/cement canonical order model in `packages/evm-contracts/contracts/GoldClob.sol`:
  - explicit flags
  - post-only rejection
  - bounded matching
  - STP cancel-taker behavior
- [x] Replace string revert in `claim(...)` with `NothingToClaim()`.
- [x] Expand regression coverage:
  - `packages/evm-contracts/test/GoldClob.ts`
  - `packages/evm-contracts/test/GoldClobSettlement.t.sol`
  - `packages/evm-contracts/test/PrecisionDoS.t.sol`
  - `packages/evm-contracts/test/PrecisionDoS.ts`
  - `packages/evm-contracts/test/fuzz/*`
- [x] Update docs:
  - `docs/enoomian-next-phase-gates.md`
  - `docs/protocol/cross-chain-parity-matrix.md`

---

## [17B] Priority: `enoomian/pm-17b-solana-order-semantics`
**Owner:** Gate 17B
**Status:** [x]

- [x] Freeze Solana order semantics in `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`:
  - post-only fail on crossing
  - GTC/IOC continuation rules
  - `execute_matches(...)` cancel-taker STP parity
- [x] Make self-trade policy explicit in tests and docs:
  - `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`
  - `packages/hyperbet-solana/anchor/tests/black_hat_exploits.ts`
  - `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`
  - `docs/protocol/cross-chain-parity-matrix.md`
- [x] Lock claim parity in tests:
  - cancelled => refund-only
  - resolved => winner payout less MM fee
  - nonterminal => revert
- [x] Add EVM/Solana differential parity cases (order flags, self-cross, claim/refund).

## Shared PM17 parity evidence section

Parity checks for this gate are now covered in:

- EVM: `packages/evm-contracts/test/GoldClobSettlement.t.sol`, `packages/evm-contracts/test/fuzz/GoldClobFuzz.t.sol`, `packages/evm-contracts/test/PrecisionDoS.ts`, `packages/evm-contracts/test/PrecisionDoS.t.sol`
- Solana: `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`, `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`

---

## [20] Priority: `enoomian/pm-20-governance-controls`
**Owner:** Gate 20
**Status:** [x]

- [x] Remove Solana bootstrap-authority fallbacks in both initializers — `initialize_oracle` and `initialize_config` now reject re-initialization (`AlreadyInitialized`) instead of using `init_if_needed` + default-authority bootstrap:
  - `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
- [x] Freeze EVM setter surface in `packages/evm-contracts/contracts/DuelOutcomeOracle.sol` and `packages/evm-contracts/contracts/GoldClob.sol`.
- [x] Freeze Solana config authority policies in `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs` and `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`.
- [x] Finalize governance docs and emergency-control stance:
  - `docs/prediction-market-release-prep.md`
  - `docs/hyperbet-production-deploy.md`
  - privileged-surface inventory doc under `docs/release/`

### PM20 completion evidence

- [x] EVM governance mutators are intentionally frozen in:
  - `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
  - `packages/evm-contracts/contracts/GoldClob.sol`
- [x] SVM governance authority initialization and updates now require upgrade-authority
  ownership + immutable config authority:
  - `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
- [x] Governance evidence and signature policy remain centralized in:
  - `docs/runbooks/prediction-market-governance-and-emergency-controls.md`
  - `docs/release/contract-privileged-surface-inventory.md`

---

## [21] Priority: `enoomian/pm-21-protocol-guardrails`
**Owner:** Gate 21
**Status:** [x]

- [x] Add protocol-level lifecycle and guardrail enforcement in:
  - `packages/evm-contracts/contracts/GoldClob.sol`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
- [x] Verify terminal-state-only claim/invalidation semantics and open-market mutation constraints.
- [x] Add exploit/regression coverage for stale state, invalid transitions, pre-terminal claim, and market-lock manipulation:
  - `packages/evm-contracts/test/ExploitSuite.t.sol`
  - `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`
- [x] Confirm parity and audit-ready behavior in docs + evidence references:
  - `docs/protocol/cross-chain-parity-matrix.md`

### PM21 completion evidence
- EVM exploit regression coverage: `packages/evm-contracts/test/ExploitSuite.t.sol`
- SVM exploit regression coverage: `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`
- Settlement parity checks:
  - `packages/evm-contracts/test/GoldClobSettlement.t.sol`
  - `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`

---

## [22] Priority: `enoomian/pm-22-required-gates-and-audit-packet`
**Owner:** Gate 22
**Status:** [ ]

- [ ] Finalize required-gate execution artifact and required checks:
  - `docs/release/gate-22-required-check-contract.md`
  - `docs/protocol/cross-chain-parity-matrix.md`
  - `docs/prediction-market-release-prep.md`
  - `docs/enoomian-next-phase-gates.md`
  - `.github/workflows/prediction-market-gates.yml`
  - `.github/workflows/staged-live-proof.yml`
- [ ] Assemble audit packet under `docs/release/`:
  - privileged surface inventory
  - required checks and gate lock status
  - staged-proof evidence checklists
  - residual-risk register
- [ ] Ensure doc+workflow truth is aligned and no longer contradicted by implementation.

---

## Definition of done for this tracker
- [ ] A PR is not allowed to merge until its priority block is fully checked.
- [ ] Each completed file-level task is linked back to a test or proof artifact.
- [ ] Release-facing docs and CI/lane promotion are mutually consistent before `priority 22` begins.
