# Launch Ops Evidence Index

> **TL;DR:** The repo now contains the full phase-1 non-mainnet proving rails for `PM + perps + internal AMM` plus the surrounding app-shell and account surfaces, but the evidence bundle is still incomplete. The active production-readiness path is `Solana + BSC`; AVAX evidence is preserved but isolated and non-blocking. The remaining gaps are real staged environment provisioning, recorded Stage-A receipts, truthful active-scope registry values, frozen app-shell/account-surface evidence, governance transfer/freeze receipts, and the final audit freeze packet.

This index ties the current launch closeout work to concrete repo artifacts and
records what still needs live evidence before release signoff.

Detailed implementation work is tracked in:

- [GitHub Project Production Backlog](github-project-production-backlog.md)
- [Runtime Integration Readiness Matrix](runtime-integration-readiness-matrix.md)
- [Tracking Document Map](tracking-document-map.md)

## Phase-1 Non-Mainnet Proving

| Surface | Path | Status |
|---|---|---|
| Local Stage-A runner | `scripts/run-local-stage-a.ts` | Merged; ready to orchestrate local-first bring-up once secrets and shared token addresses are present. |
| Staged proof driver | `scripts/staged-live-proof.ts` | Merged with `pm`, `perps`, and `amm` canary surfaces per chain. |
| Staged proof workflow | `.github/workflows/staged-live-proof.yml` | Merged; blocked on staged env provisioning. |
| Staged proof runbook | `docs/runbooks/staged-live-proof.md` | Updated for launch-scope proof and staged env contract. |
| Soak workflow | `.github/workflows/pm-soak.yml` | Merged; blocked on staged env provisioning and funded canary wallets. |
| Soak runbook | `docs/runbooks/pm-confidence-soak.md` | Updated for launch-scope staged soak and local-first execution. |
| Expected artifact bundle | `.ci-artifacts/staged-live-proof/{summary.json,verify-chains.json,solana/*,bsc/*,avax/*}` | Pending first real staged execution. |
| Expected soak bundle | `.ci-artifacts/pm-soak/*` | Pending first real staged execution. |

## Launch-Chain Canonical Truth

| Surface | Path | Status |
|---|---|---|
| Shared registry schema | `packages/hyperbet-chain-registry/src/index.ts` | Full-product launch gating is merged. |
| Launch registry gate | `scripts/ci-gate-registry.ts` | Develop-side PRs now validate the Stage-A closeout registry contract (`Solana devnet + BSC testnet`, AVAX deferred); strict launch-branch runs still enforce canonical mainnet truth. |
| Canonical EVM receipt writer | `packages/evm-contracts/scripts/deployment-receipt.ts` | Merged; writes registry-shaped PM, AMM, and perps fields. |
| EVM verify script | `packages/evm-contracts/scripts/verify-deployment.ts` | Merged; full-product verification exists. |
| Solana verify script | `packages/hyperbet-solana/scripts/verify-deployment.ts` | Merged; full-product verification now includes AMM. |

Canonical launch truth is still missing for:

- `solana`: `goldAmmMarketProgramId`
- `bsc`: AMM and perps canonical fields
- `avax`: PM-core plus AMM and perps canonical fields remain preserved
  follow-on work and are not blocking the active scope

## Governance And Operational Control

| Surface | Path | Status |
|---|---|---|
| Governance and emergency runbook | `docs/runbooks/prediction-market-governance-and-emergency-controls.md` | Present and linked. |
| Signer and key-rotation runbook | `docs/runbooks/signer-policy-and-key-rotation.md` | Present and linked. |
| Freeze tracker | `docs/release/prediction-market-launch-freeze-tracker.md` | Current source for repo-side closeout status. |
| Release prep summary | `docs/prediction-market-release-prep.md` | Updated for launch-scope repo reality. |

Remaining live evidence:

- ownership-transfer transaction hashes
- final freeze transactions per launch surface
- signer provisioning and key-rotation completion

## Current Operational Blockers

These are blocker summaries only. Detailed owner tickets live in the canonical
backlog.

- no GitHub `staging` environment exists yet
- no `HYPERBET_*_STAGING_*` vars or secrets are provisioned yet
- local BSC AMM/perps bring-up still needs shared token addresses
- no real staged proof artifact bundle exists yet
- no real staged soak artifact bundle exists yet
- no frozen full-app acceptance bundle exists yet for wallet/account,
  claims/positions, and points/referral surfaces
- no truthful launch-chain mainnet registry population exists yet
