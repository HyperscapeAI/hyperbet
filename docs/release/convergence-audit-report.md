# Convergence Branch Audit Report

> **TL;DR:** 6-workstream internal audit found 4 critical + 9 high findings. All 7 code-level fixes implemented (grantRole override, resting order recovery, challenge resolution, participant lock, Solana fee/betting-window/market_maker snapshots). Remaining blockers are ops-only (timelock deploy, upgrade authority transfer, AVAX registry population).

**Branch:** `enoomian/pm16-17-20-21`
**Date:** 2026-03-17
**Scope:** DuelOutcomeOracle.sol, GoldClob.sol, fight_oracle/lib.rs, gold_clob_market/lib.rs, cross-chain parity, governance model, test coverage, documentation

---

## Executive Summary

Six parallel audit workstreams assessed the prediction market convergence branch against industry-standard security practices (Trail of Bits, OpenZeppelin, OtterSec, Neodyme checklists). The protocol's state machine, matching engine, and settlement logic are architecturally sound. However, **7 critical/high findings require remediation before external audit engagement**, with the most severe being a governance freeze bypass on EVM and permanently locked resting-order collateral on settled markets.

### Finding Distribution

| Severity | Count | Requires Code Change | Requires Ops/Docs Only |
|----------|-------|---------------------|----------------------|
| Critical | 4 | 3 | 1 |
| High | 9 | 5 | 4 |
| Medium | 12 | 4 | 8 |
| Low | 10 | 0 | 10 |
| Informational | 5 | 0 | 0 |

---

## CRITICAL FINDINGS

### CRIT-1: AccessControl.grantRole Bypasses PM20 Governance Freeze (EVM)

**Source:** Governance audit
**Location:** DuelOutcomeOracle.sol, GoldClob.sol (inherited from OpenZeppelin AccessControl)
**Impact:** Complete governance freeze circumvention

PM20 froze `setReporter`, `setFinalizer`, `setChallenger`, `setOracle`, `setTreasury`, `setMarketMaker`, and `setFeeConfig` with unconditional `GovernanceSurfaceFrozen()` reverts. However, OpenZeppelin's `AccessControl.grantRole(bytes32, address)` is **not overridden** and remains callable by the admin. A compromised admin can:
1. `grantRole(REPORTER_ROLE, attacker)` -- propose fraudulent results
2. `grantRole(FINALIZER_ROLE, attacker)` -- finalize them after dispute window
3. `grantRole(MARKET_OPERATOR_ROLE, attacker)` -- create markets

**Remediation:** Override `grantRole` and `revokeRole` in both contracts to revert with `GovernanceSurfaceFrozen()` for all roles except PAUSER_ROLE, OR renounce `DEFAULT_ADMIN_ROLE` after deployment.

---

### CRIT-2: Resting Order Collateral Permanently Locked on Settled Markets (EVM)

**Source:** EVM contract audit
**Location:** GoldClob.sol:364-391 (cancelOrder), GoldClob.sol:393-420 (claim)
**Impact:** Permanent fund loss for users with unmatched GTC orders

When a market leaves OPEN status (transitions to LOCKED/RESOLVED/CANCELLED), `cancelOrder` reverts with `MarketNotOpen` (PM21 guardrail). The `claim` function only refunds matched positions (`aStake + bStake`), not collateral locked in unmatched resting orders. Users with GTC orders on the book when a duel is cancelled or resolved lose their collateral permanently.

**Example:** User deposits 5000 wei for a resting buy order. Before matching, the duel is cancelled. `cancelOrder` reverts (market not OPEN). `claim` reverts (NothingToClaim -- no matched position). The 5000 wei is locked forever.

**Remediation:** Either (a) allow `cancelOrder` on non-OPEN markets for resting-order refunds only, (b) include resting order collateral in the `claim` payout, or (c) add a dedicated `reclaimOrderCollateral` function for settled markets.

---

### CRIT-3: CHALLENGED State Dead-End on Both Chains

**Source:** EVM audit + Solana audit (confirmed on both)
**Location:** DuelOutcomeOracle.sol:273-287, fight_oracle/lib.rs:241-311
**Impact:** Permanent fund lock after a successful challenge

When a result is challenged, the duel moves to CHALLENGED status. There is **no instruction on either chain** to resolve a challenged duel:
- `proposeResult`/`propose_result` requires LOCKED status
- `finalizeResult`/`finalize_result` requires PROPOSED status
- The only exit is `cancelDuel`/`cancel_duel` by PAUSER/authority

If the pauser/authority is unavailable or the oracle is paused, funds are locked indefinitely. The challenge mechanism is effectively a one-way fund-lock operation with no re-proposal path.

**Remediation:** Add a `repropose` instruction (REPORTER_ROLE/reporter) that transitions CHALLENGED back to LOCKED, resetting the proposal, OR add a `resolveChallenge` instruction for the FINALIZER to confirm/override after review.

---

### CRIT-4: No Timelock or Multisig on Production Chains

**Source:** Governance audit
**Location:** packages/hyperbet-chain-registry/src/index.ts (BSC/Base mainnet entries)
**Impact:** Single EOA key compromise = total protocol compromise

BSC and Base mainnet deployments have:
- `timelockAddress = ""`, `multisigAddress = ""`, `emergencyCouncilAddress = ""`
- `adminAddress == marketOperatorAddress` (same EOA: `0x7908...eED8`)
- `reporterAddress = ""`, `finalizerAddress = ""`, `challengerAddress = ""`

**Remediation:** Deploy timelock + multisig before real-funds launch. Register all governance keys in the chain registry. Separate admin and marketOperator keys.

---

## HIGH FINDINGS

### HIGH-1: Solana Config Not Frozen (Unlike EVM)

**Source:** Governance audit + cross-chain parity audit
**Location:** gold_clob_market/lib.rs:92-132 (update_config), fight_oracle/lib.rs:65-94 (update_oracle_config)

EVM froze all governance setters via PM20. Solana did NOT. The authority can still change treasury, market_maker, all fee BPS values, reporter, finalizer, and challenger at any time. Setting `winnings_market_maker_fee_bps = 10000` (100%) and redirecting `market_maker` to an attacker wallet would steal all winnings.

**Remediation:** Freeze Solana config the same way EVM is frozen, or transfer authority to a multisig.

---

### HIGH-2: Solana Program Upgradeable by Config Authority

**Source:** Governance audit
**Location:** fight_oracle/lib.rs:25-36, gold_clob_market/lib.rs:42-54

Config authority == upgrade authority. A malicious upgrade could drain all vault PDAs, bypass all access controls, or modify settlement logic.

**Remediation:** Transfer upgrade authority to a multisig, or make programs immutable (set upgrade authority to null) once code is stable.

---

### HIGH-3: Front-Running / MEV in Order Matching (EVM)

**Source:** EVM contract audit
**Location:** GoldClob.sol:305-362

`placeOrder` has no commit-reveal or MEV protection. Sandwich attacks are possible. Price improvement (`totalImprovement`) is calculated but never refunded to the taker.

**Remediation:** Document as accepted risk for the betting context, or integrate Flashbots Protect / batch auctions.

---

### HIGH-4: Reporter Can Modify Participant Hashes After Betting Opens (Both Chains)

**Source:** EVM audit (M-4) + Solana audit (H-1)
**Location:** DuelOutcomeOracle.sol:183-220, fight_oracle/lib.rs:96-163

`upsertDuel` allows the reporter to change `participantAHash`, `participantBHash`, `betOpenTs`, and `betCloseTs` on a duel that is already in BETTING_OPEN status. Users may have already placed bets based on the original parameters.

**Remediation:** Once a duel has progressed past SCHEDULED, lock participant hashes and timing fields.

---

### HIGH-5: Solana Vault Rent Exemption Drain

**Source:** Solana audit (C-2)
**Location:** gold_clob_market/lib.rs:759-769

If total claims drain the vault PDA below rent-exemption threshold, the account risks garbage collection, permanently locking remaining funds.

**Remediation:** Use direct lamport manipulation instead of `system_program::transfer` for PDA-to-account transfers, or ensure the last claim also closes the vault account.

---

### HIGH-6: No Pause Mechanism on Solana

**Source:** Governance audit
**Location:** Both Solana programs

EVM has `setOraclePaused`, `setMarketCreationPaused`, `setOrderPlacementPaused`. Solana has no equivalent. In an oracle compromise, there is no way to halt operations without upgrading the program.

**Remediation:** Add pause flags to both Solana programs.

---

### HIGH-7: Trade Fee Source Mismatch (Cross-Chain Parity Bug)

**Source:** Cross-chain parity audit (D5)
**Location:** GoldClob.sol:353-355 vs gold_clob_market/lib.rs:251-252

EVM charges trade fees from snapshotted BPS at market creation. Solana charges from live config BPS. If fee config changes after market creation, Solana traders pay the new rate while EVM traders pay the old rate.

**Remediation:** Change Solana `place_order` to read from `market_state.trade_treasury_fee_bps_snapshot`.

---

### HIGH-8: Missing Betting-Window Guard on Solana propose_result

**Source:** Cross-chain parity audit (D1)
**Location:** fight_oracle/lib.rs (propose_result)

EVM's `proposeResult` checks `block.timestamp < betCloseTs` and reverts with `BettingWindowActive`. Solana's `propose_result` has no equivalent timestamp check.

**Remediation:** Add `require!(clock.unix_timestamp >= duel_state.bet_close_ts)` to `propose_result`.

---

### HIGH-9: Solana market_maker Not Snapshotted in MarketState

**Source:** Solana audit (C-3)
**Location:** gold_clob_market/lib.rs:977-1010

Claim validates `market_maker` against live config, not against a snapshot. If authority changes `market_maker` between market creation and settlement, fees flow to the new address.

**Remediation:** Store `market_maker` pubkey in `MarketState` at creation time.

---

## MEDIUM FINDINGS (Summary)

| ID | Finding | Source |
|----|---------|--------|
| MED-1 | Dead code: `totalImprovement` computed but unused (EVM) | EVM audit |
| MED-2 | `syncMarketFromOracle` is permissionless, emits on every call (EVM) | EVM audit |
| MED-3 | PAUSER_ROLE can permanently trap funds via oracle pause (EVM) | Governance audit |
| MED-4 | Fee snapshot gameable if governance freeze is ever lifted (EVM) | EVM audit |
| MED-5 | No upper bound on `amount` in `placeOrder` -- uint128 overflow risk (EVM) | EVM audit |
| MED-6 | u16 fee addition can overflow in `validate_fee_config` (Solana) | Solana audit |
| MED-7 | DuelState / MarketState / UserBalance accounts never closed -- PDA bloat (Solana) | Solana audit |
| MED-8 | Clock-based dispute window vulnerable to validator timestamp drift (Solana) | Solana audit |
| MED-9 | Stale canonical spec says reporter can cancel (code requires PAUSER_ROLE) | Docs audit |
| MED-10 | Stale state diagram omits PROPOSED/CHALLENGED states | Docs audit |
| MED-11 | Tracker discrepancy: freeze tracker marks PM-17B complete, readiness tracker has 16+ unchecked items | Docs audit |
| MED-12 | Post-Only continuation semantics differ between chains (undocumented) | Parity audit |

---

## TEST COVERAGE GAPS (Top Priority)

| # | Missing Scenario | Severity |
|---|---|---|
| 1 | Re-entrancy through claim() callback (no attacker contract test) | Critical |
| 2 | Flash loan + atomic place/resolve/claim in single tx | Critical |
| 3 | Partial fill + cancel + resolve + claim combined flow | High |
| 4 | Gas metering for pathological book depth (DoS) | High |
| 5 | Solana clock boundary for dispute window | High |
| 6 | Order book depth attack (fill to prevent legitimate orders) | High |
| 7 | Integer boundary tests (max uint128 amounts) | Medium |
| 8 | Zero-amount edge cases | Medium |
| 9 | Fee rounding exploitation at dust amounts (systematic) | Medium |
| 10 | Timestamp manipulation (15s miner drift) | Medium |

---

## DOCUMENTATION GAPS (Audit Packet)

| Component | Status | Action Required |
|-----------|--------|----------------|
| Threat model | **Missing** | Must create before audit |
| Auditor build guide | **Missing** | Must create with toolchain versions |
| Residual risk register | **Missing** | Must create |
| State diagram (oracle) | **Stale** | Fix PROPOSED/CHALLENGED omission |
| Canonical spec | **Stale** | Fix reporter->PAUSER_ROLE for cancel |
| v3 deployment addresses | **Missing** | Create address table |
| Quantitative test coverage | **Missing** | Generate lcov report |
| Architecture 1-pager | **Missing** | Create system diagram |

---

## REMEDIATION PRIORITY

### Must Fix Before External Audit (Code Changes)

1. **CRIT-1:** Override `grantRole`/`revokeRole` or renounce admin
2. **CRIT-2:** Allow resting order collateral recovery on settled markets
3. **CRIT-3:** Add re-proposal or challenge resolution path
4. **HIGH-4:** Lock participant hashes and timestamps after SCHEDULED
5. **HIGH-7:** Fix Solana trade fee to use snapshot, not live config
6. **HIGH-8:** Add betting-window guard to Solana `propose_result`
7. **HIGH-9:** Snapshot `market_maker` pubkey in Solana MarketState

### Must Fix Before Launch (Ops)

8. **CRIT-4:** Deploy timelock + multisig, register all governance keys
9. **HIGH-1:** Freeze Solana config or transfer authority to multisig
10. **HIGH-2:** Transfer Solana upgrade authority to multisig or null
11. **HIGH-6:** Add pause mechanism to Solana programs

### Must Fix Before External Audit (Docs)

12. Create threat model document
13. Create auditor build/setup guide
14. Fix stale canonical spec and state diagrams
15. Create residual risk register

---

## Cross-Chain Parity Summary

14 divergences catalogued. 10 are intentional and documented. 2 are intentional but undocumented (D2, D4). **2 are likely unintentional bugs (D1: missing betting-window guard, D5: trade fee source mismatch).**

Core state machine, matching engine, settlement logic, and price/amount validation are at **full parity**.

---

*Report generated from 6 parallel audit workstreams covering EVM contract security, Solana program security, test coverage analysis, cross-chain parity verification, governance & centralization risk, and documentation completeness.*
