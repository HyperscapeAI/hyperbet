# Hyperbet Solana Release Readiness

## Product contract

The v1 product is Hyperia duel viewing plus native-SOL prediction markets on Solana. It has one authoritative duel stream, one dispute-aware result oracle, and one native-SOL duel market. No token-denominated bet, alternate chain, models market, perpetual market, or internal pool is part of the release.

## Completed engineering controls

- two-program Anchor workspace and canonical registry
- fail-closed deployment identity and upgrade-authority verification
- distinct operational roles and explicit fee/dispute configuration
- native-lamport accounting without floating-point value storage
- finalized place-order, fill, fee, refund, claim, and lifecycle evidence
- durable lifecycle index and terminal reconciliation
- authenticated schema-v3 feed continuity and replay
- crash-safe terminal queue and guarded operator recovery CLI
- canonical on-chain market/order discovery after restart
- fail-closed HTTP readiness
- disabled product routes and alternate-runtime proxy return 404
- SOL-only root commands, CI workflows, deployment staging, and production bundles
- validator-backed contract/security tests, exploit scenarios, and browser lifecycle tests

## Launch blockers

- external security audit and remediation closure
- production program deployment identity and independently reviewed upgrade-authority evidence
- approved role custody, rotation, and emergency procedures
- approved fee schedule and dispute window
- verified production lifecycle-index start slot and RPC history retention
- deployed alert routing plus operator fault drills
- production-shaped Hyperia-to-Hyperbet trace through process death/recovery
- sustained performance/soak evidence for the duel arena, stream, keeper, and browser
- accessibility, responsive-layout, and end-user UX acceptance
- legal/compliance approval for the intended jurisdictions and real-value flow
- incident-response, pause, recovery, backup, and rollback sign-off

## Required release evidence

Every release candidate must record:

- git SHA and clean-tree status
- dependency lock hash and pinned toolchain versions
- SBF hashes and IDL hashes
- exact program IDs and executable/loader/ProgramData evidence
- upgrade-authority expectations
- frozen on-chain role, dispute, and fee configuration
- validator/security/browser/exploit test counts and artifacts
- production bundle scan and size report
- deployed Pages build metadata
- keeper readiness, source freshness, parser/index freshness, and recovery state
- Hyperia stream/market identity trace
- fault-drill and soak artifacts
- sign-offs and any explicitly accepted residual risks

The cross-repository launch checklist in the Hyperia implementation repository is the canonical task ledger. This document defines Hyperbet's release boundary; it does not replace that checklist.
