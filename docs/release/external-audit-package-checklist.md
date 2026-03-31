# External Audit Package Checklist

> **TL;DR:** The audit package is no longer just PM-core plus AVAX notes. It now has to prove the full phase-1 launch product: `PM/CLOB duels + perps/models + internal AMM` across `Solana`, `BSC`, and `AVAX`, with truthful launch-chain registry values, staged proof and soak evidence, governance transfer receipts, and the frozen RC manifest.

Use this checklist with the candidate memo in
[release-memo-template.md](release-memo-template.md) and the evidence index in
[launch-ops-evidence-index.md](launch-ops-evidence-index.md).

## Scope And Freeze

- [x] Launch scope documented in
  [release-memo-template.md](release-memo-template.md)
- [x] Launch freeze tracker linked in
  [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
- [ ] Final RC branch and commit recorded at freeze time
- [ ] Freeze manifest regenerated and attached:
  [manifests/rc-2026-03-audit-handoff-freeze.json](manifests/rc-2026-03-audit-handoff-freeze.json)

## Non-Mainnet Bring-Up And Proof

- [x] Local Stage-A runner linked:
  [../../scripts/run-local-stage-a.ts](../../scripts/run-local-stage-a.ts)
- [x] Staged proof driver and workflow linked:
  [../../scripts/staged-live-proof.ts](../../scripts/staged-live-proof.ts),
  [../../.github/workflows/staged-live-proof.yml](../../.github/workflows/staged-live-proof.yml)
- [x] Soak workflow and runbook linked:
  [../../.github/workflows/pm-soak.yml](../../.github/workflows/pm-soak.yml),
  [../runbooks/pm-confidence-soak.md](../runbooks/pm-confidence-soak.md)
- [ ] Local Stage-A deploy and verify artifacts attached for Solana devnet, BSC
  testnet, and AVAX Fuji
- [ ] Read-only staged proof artifact bundle attached
- [ ] Canary-write staged proof artifact bundle attached with `pm`, `perps`,
  and `amm` sub-results per chain
- [ ] Staged soak artifact bundle attached
- [ ] `verify-chains.json` attached and green

## Launch-Chain Canonical Truth

- [x] Shared registry and gate linked:
  [../../packages/hyperbet-chain-registry/src/index.ts](../../packages/hyperbet-chain-registry/src/index.ts),
  [../../scripts/ci-gate-registry.ts](../../scripts/ci-gate-registry.ts)
- [ ] Solana canonical `goldAmmMarketProgramId` committed from mainnet
  deployment evidence
- [ ] BSC canonical PM, AMM, perps, and governance fields committed from
  mainnet deployment evidence
- [ ] AVAX canonical PM, AMM, perps, and governance fields committed from
  mainnet deployment evidence

## Governance And Emergency Controls

- [x] Governance and signer runbooks linked:
  [../runbooks/prediction-market-governance-and-emergency-controls.md](../runbooks/prediction-market-governance-and-emergency-controls.md),
  [../runbooks/signer-policy-and-key-rotation.md](../runbooks/signer-policy-and-key-rotation.md)
- [ ] Ownership-transfer, signer, and freeze tx hashes attached for all
  launch-critical surfaces
- [ ] Key-rotation completion recorded for any historically exposed deploy keys

## Staging Provisioning

- [ ] GitHub `staging` environment created
- [ ] Required `HYPERBET_*_STAGING_*` vars and secrets loaded
- [ ] Shared BSC and AVAX testnet token addresses recorded in
  [testnet-operations-ledger.md](testnet-operations-ledger.md)
- [ ] Canary, admin, operator, and reporter wallets funded for staged proof and
  staged soak

## Audit Handoff Package

- [x] Reviewer-facing release prep linked:
  [../prediction-market-release-prep.md](../prediction-market-release-prep.md)
- [x] Deploy guide linked:
  [../hyperbet-production-deploy.md](../hyperbet-production-deploy.md)
- [x] Runbook index linked:
  [../runbooks/README.md](../runbooks/README.md)
- [ ] ABI freeze files refreshed and attached:
  [abi/gold_clob.abi.json](abi/gold_clob.abi.json),
  [abi/duel_outcome_oracle.abi.json](abi/duel_outcome_oracle.abi.json)
- [ ] Residual-risk register attached:
  [residual-risk-register.md](residual-risk-register.md)
- [ ] Final findings ledger and accepted risks attached
