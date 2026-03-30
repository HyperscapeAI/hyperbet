# Release Memo: Phase-1 RC Candidate

> **TL;DR:** This memo tracks the current release-candidate posture for the `Solana + BSC + AVAX` phase-1 launch product. The repo now has full-product non-mainnet rails for `PM/CLOB duels + perps/models + internal AMM`, but launch is still blocked on canonical mainnet registry truth, staged environment provisioning, governance/evidence receipts, and the external audit/remediation cycle.

## Release Candidate

- Candidate label: `rc-2026-03-phase1-launch`
- Active closeout branch: `audit/develop-pm-hardening`
- Release prep summary: [../prediction-market-release-prep.md](../prediction-market-release-prep.md)
- Launch-ops evidence index: [launch-ops-evidence-index.md](launch-ops-evidence-index.md)
- Freeze tracker: [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)

## Product Scope

- Launch chains: `Solana`, `BSC`, `AVAX`
- Non-blocking add-chain lane: `Base`
- User-facing launch surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- Internal launch-critical surface:
  - `AMM` as headless MM and liquidity engine

## Repo Snapshot

- PM-core hardening is merged.
- AMM settlement is oracle-only on EVM and Solana.
- Solana perps pause survives config freeze.
- Solana full-product deploy, init, freeze, and verify paths include `lvr_amm`.
- EVM deploy receipts and verification now cover PM, AMM, and perps.
- Staged proof and soak rails now target launch-scope `pm`, `perps`, and `amm`
  surfaces.

## Blocking Items

- launch-chain canonical mainnet registry fields are still incomplete
- GitHub staged environment vars and secrets are not provisioned yet
- shared BSC and AVAX testnet token addresses are still missing for local
  AMM/perps rehearsal
- governance transfer and freeze receipts are still pending
- final audit packet, external audit, and remediation are still pending

## Evidence Links

- [Production deploy guide](../hyperbet-production-deploy.md)
- [Staged proof runbook](../runbooks/staged-live-proof.md)
- [Soak runbook](../runbooks/pm-confidence-soak.md)
- [Testnet operations ledger](testnet-operations-ledger.md)
- [External audit checklist](external-audit-package-checklist.md)

## Current Decision

- Current decision: not ready for unrestricted real-funds launch
- Next honest milestone: complete local Stage-A deploy and verify, provision the
  staged environment, capture launch-scope staged proof and soak artifacts, and
  then populate launch-chain canonical mainnet truth from final receipts
