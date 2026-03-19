# Residual Risk Register

> **TL;DR:** 7 accepted risks, 1 tracking item. Highest accepted: MEV/front-running (mitigated by betting context), PAUSER griefing (mitigated by timelock/multisig). Tracking: missing reentrancy exploit test coverage (nonReentrant guard verified present but explicit malicious-contract test now added).

Risks that have been assessed, accepted, and documented. These are NOT bugs — they are known design trade-offs or environmental constraints.

## Accepted Risks

### R-1: MEV / Front-Running in Order Matching (Medium)

**Description:** `placeOrder` is a public payable function with no commit-reveal scheme. Mempool observers can sandwich orders.

**Mitigation:** Bounded matching (50 iterations), cancel-taker STP policy, fixed-outcome betting context (not continuous trading).

**Acceptance rationale:** The prediction market operates on discrete duel outcomes, not continuous price discovery. The economic incentive for MEV extraction is limited by the binary nature of bets.

### R-2: EVM Timestamp Manipulation ~15s (Low)

**Description:** Block proposers can adjust `block.timestamp` by approximately 15 seconds on Ethereum-compatible chains.

**Mitigation:** Dispute windows default to 3600 seconds (1 hour). A 15-second drift represents 0.4% of the window.

**Acceptance rationale:** The drift is negligible relative to all protocol-relevant time windows (betting windows, dispute windows).

### R-3: Solana Clock Drift (Low)

**Description:** Solana `Clock` sysvar timestamps can drift from wall-clock time by several seconds.

**Mitigation:** Dispute windows should be set to >= 60 seconds. The protocol enforces `dispute_window_secs > 0` but does not enforce a minimum.

**Acceptance rationale:** Operational policy: never set dispute windows below 60 seconds. Clock drift is negligible for windows of 600+ seconds.

### R-4: PDA Account Bloat — Unclosed DuelState/MarketState (Medium)

**Description:** Resolved/cancelled `DuelState` and `MarketState` accounts on Solana are never closed, accumulating rent costs over time.

**Mitigation:** Future enhancement: add close instructions with appropriate time delays.

**Acceptance rationale:** Pre-launch volume is low. Post-launch, a cleanup sweep can be added without protocol changes. Rent costs are bounded by the number of duels created.

### R-5: Vault Rent-Exemption Edge Case (Low)

**Description:** On Solana, if claims drain a vault PDA below the rent-exemption threshold, the account could be garbage-collected.

**Mitigation:** Vault PDAs hold aggregate market collateral, which is always >= sum of claims. The last claim should drain to exactly 0 (not below rent-exempt).

**Acceptance rationale:** The arithmetic is verified in tests. Partial claims that would leave dust are prevented by the 1000-tick size constraint.

### R-6: PAUSER_ROLE Griefing Vector (Medium)

**Description:** A compromised PAUSER can pause oracle operations indefinitely, preventing finalization and trapping funds.

**Mitigation:** Admin (via timelock/multisig) can revoke the compromised PAUSER and grant to a new key. On Solana, authority can toggle pause.

**Acceptance rationale:** The PAUSER role is intentionally powerful — it's an emergency control. The timelock/multisig ensures the admin can recover from a compromised pauser within the timelock delay.

### R-7: Single-Reporter Oracle Trust (Medium)

**Description:** The reporter is a single key that proposes duel outcomes. A compromised reporter can propose fraudulent results.

**Mitigation:** Challenger can challenge within the dispute window. Finalizer is a separate key that must wait for the dispute window to expire. Re-proposal path exists after challenge.

**Acceptance rationale:** The three-key separation (reporter/challenger/finalizer) provides defense-in-depth. Key rotation is possible via admin (pre-freeze) or multisig governance.

## Tracking (Not Yet Mitigated)

### T-2: Missing Reentrancy Exploit Test

**Description:** No test deploys a malicious contract that re-enters `claim()` via the ETH receive callback. While `nonReentrant` guard is applied, explicit test verification is missing.

**Recommendation:** Add in the next test coverage expansion.
