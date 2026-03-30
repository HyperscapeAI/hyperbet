# Threat Model — Prediction Market Protocol

> **TL;DR:** 8 actors, 3 trust boundaries, 7 attack surfaces analyzed. Key mitigations: 3-key oracle separation (reporter/challenger/finalizer), PM20 governance freeze (EVM + Solana), bounded matching (50 iterations), cancel-taker STP, minimum 60s dispute window. Highest residual risk: reporter+finalizer collusion can finalize fraudulent results after dispute window.

## Actors

| Actor | Trust Level | Capabilities |
|-------|------------|--------------|
| **Admin** (EVM DEFAULT_ADMIN_ROLE) | Trusted (timelock-controlled) | Grant/revoke PAUSER_ROLE only (all other role mutations frozen via PM20) |
| **Reporter** | Semi-trusted (operational key) | Upsert duels, propose results, repropose after challenge |
| **Finalizer** | Semi-trusted (operational key) | Finalize results after dispute window expires |
| **Challenger** | Semi-trusted (operational key) | Challenge proposed results within dispute window |
| **Pauser** (EVM PAUSER_ROLE) | Trusted (emergency key) | Pause/unpause oracle and market operations, cancel duels |
| **Market Operator** | Semi-trusted (operational key) | Create markets for duels, sync market state |
| **Trader** | Untrusted | Place orders, cancel own orders, claim settlements |
| **Validator/Miner** | Untrusted | Order transactions, manipulate timestamps (~15s EVM) |
| **Solana Authority** | Trusted (upgrade-authority-derived) | All config operations, pause, freeze; program upgrade |

## Trust Boundaries

1. **On-chain vs Off-chain:** All settlement, matching, and lifecycle logic is on-chain. Keepers are convenience infrastructure, not trust-bearing.
2. **Cross-chain:** EVM and Solana operate independently. No cross-chain messaging. Parity is behavioral, not cryptographic.
3. **Oracle truth:** The reporter/finalizer/challenger system is the sole source of duel outcomes. No external price feeds.

## Attack Surfaces

### 1. Oracle Manipulation
- **Vector:** Compromised reporter submits fraudulent results
- **Mitigation:** Dispute window (default 1h) allows challenger to intervene. Finalizer is a separate key. Re-proposal path exists after challenge.
- **Residual risk:** If reporter AND finalizer collude, fraudulent results can be finalized after dispute window. Challenger can only delay, not prevent.

### 2. Governance Key Compromise
- **Vector:** Admin key stolen; attacker grants themselves roles
- **Mitigation (EVM):** PM20 governance freeze — `grantRole`/`revokeRole` revert for all roles except PAUSER_ROLE. Admin cannot grant REPORTER/FINALIZER/OPERATOR roles.
- **Mitigation (Solana):** `freeze_config` instruction permanently locks all config updates. Pause remains functional.
- **Mitigation (Both):** Timelock + multisig for admin/authority keys (ops requirement).
- **Residual risk:** PAUSER_ROLE can still be granted/revoked. Compromised admin + pauser = permanent fund lock (but not theft).

### 3. MEV / Front-Running
- **Vector:** Mempool observers sandwich user orders
- **Mitigation:** Bounded matching (50 iterations), cancel-taker STP policy, betting-window enforcement
- **Accepted risk:** No commit-reveal or batch auction. MEV is limited by the betting context (fixed-outcome markets, not continuous trading).

### 4. Fund Locking
- **Vector:** Market stuck in non-terminal state (LOCKED/PROPOSED/CHALLENGED)
- **Mitigation:** PAUSER can cancel any non-terminal duel. `reproposeResult` resolves challenged duels. `reclaimRestingOrder` recovers resting collateral on settled markets.
- **Residual risk:** If pauser key is lost AND a challenge occurs, funds are locked until a new pauser is granted by admin.

### 5. Program Upgrade (Solana)
- **Vector:** Malicious program upgrade drains vaults
- **Mitigation:** Transfer upgrade authority to multisig or null (immutable). Config freeze prevents runtime parameter changes.
- **Ops requirement:** Upgrade authority must be transferred before mainnet launch.

### 6. Fee Manipulation
- **Vector:** Authority changes fees to 100% mid-market
- **Mitigation (EVM):** Fee config frozen at deploy (GovernanceSurfaceFrozen). Fees snapshotted at market creation.
- **Mitigation (Solana):** Fee BPS snapshotted at market creation (FIX-5). Config freeze available. market_maker pubkey snapshotted (FIX-7).

### 7. Timestamp Manipulation
- **Vector:** EVM miners adjust block.timestamp by ~15s; Solana validators have clock drift
- **Mitigation:** Dispute windows measured in hours (default 3600s). 15s drift is negligible. Betting windows measured in minutes.
- **Residual risk:** For very short dispute windows (< 60s), clock drift becomes significant. Minimum enforcement recommended.

## Security Invariants

1. Settlement ONLY occurs from terminal states (RESOLVED or CANCELLED)
2. Terminal states are immutable — no re-entry to prior states
3. Participant identity and bet timing are immutable after betting opens
4. All fee calculations use snapshotted values from market creation
5. Resting order collateral is always recoverable (via cancel on OPEN, reclaim on settled)
6. Governance mutations are permanently frozen on EVM; freezable on Solana
7. Pause controls remain operational even after config freeze
