# Runtime Integration Readiness Matrix

> **TL;DR:** This matrix is the canonical end-to-end runtime status view for Hyperbet's active production-readiness gate. It answers whether `Hyperscapes emits duel -> Hyperbet ingests stream -> Hyperbet writes on-chain -> Hyperbet discovers result -> Hyperbet resolves/claims -> Hyperbet recovers after restart` is actually working for `BSC + Solana`. `AVAX` is preserved as a parked follow-on lane and is intentionally omitted from the active blocker table. The `BSC` rows represent the current active EVM wrapper, not a BSC-only implementation target.

## Scope And Legend

- active gate: `BSC + Solana`
- parked lane: `AVAX`
- implementation note: `BSC` rows represent the active EVM proving wrapper;
  shared EVM work should land in canonical EVM paths unless explicitly
  wrapper-specific
- statuses:
  - `Green in Stage-A`: proven locally against deployed Stage-A chains
  - `Partial`: working evidence exists, but production-grade hardening or canonicalization is still open
  - `Blocked`: not yet production-ready for the active launch gate

Primary evidence documents:

- [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md)
- [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md)
- [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

Open work ownership lives in:

- [github-project-production-backlog.md](github-project-production-backlog.md)

## Active Runtime Loops

| Chain | Runtime loop | Current status | Evidence | Owner doc / ticket | Active blocker | Scope note |
|---|---|---|---|---|---|---|
| `BSC` | Duel discovery / stream ingestion | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [../runbooks/hyperscapes-local-pm-integration.md](../runbooks/hyperscapes-local-pm-integration.md) | `github-project-production-backlog.md` / `PROD-014`, `PROD-014A`, `PROD-014B`, `PROD-018A` | Active BSC keeper still needs a single canonical versioned feed contract with fail-closed parsing, durable checkpoints, and event-feed proof | Active |
| `BSC` | Market materialization | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | `github-project-production-backlog.md` / `PROD-001`, `PROD-006` | Canonical launch registry truth and staged proof artifacts still need to be frozen | Active |
| `BSC` | Trade posting | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | `github-project-production-backlog.md` / `PROD-006`, `PROD-007A` | Needs coordinated staged smoke evidence bundle and production telemetry | Active |
| `BSC` | Result discovery / correlation | Partial | [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | `github-project-production-backlog.md` / `PROD-014B`, `PROD-019` | Result correlation and operator reconciliation are not yet productionized | Active |
| `BSC` | Resolve / claim / refund | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | `github-project-production-backlog.md` / `PROD-010`, `PROD-025` | Governance freeze receipts and audit-packet evidence still need to be attached | Active |
| `BSC` | Perps / models lifecycle | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [../prediction-market-release-prep.md](../prediction-market-release-prep.md) | `github-project-production-backlog.md` / `PROD-015`, `PROD-001`, `PROD-007A` | Final BSC product claim, canonical perps addresses, and coordinated staged browser evidence are still open | Active |
| `BSC` | Wallet / account shell | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [../prediction-market-release-prep.md](../prediction-market-release-prep.md) | `github-project-production-backlog.md` / `PROD-047`, `PROD-049` | Shared wallet/account behavior, claims/positions shell truth, and full-app acceptance are not yet frozen as one canonical launch contract | Active |
| `BSC` | Points / referrals / rewards | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [production-readiness-audit-2026-03-29.md](production-readiness-audit-2026-03-29.md) | `github-project-production-backlog.md` / `PROD-048`, `PROD-050`, `PROD-021` | Rewards durability, referral/account support posture, and operator reconciliation are still open | Active |
| `BSC` | Internal AMM / liquidity dependencies | Partial | [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md), [launch-ops-evidence-index.md](launch-ops-evidence-index.md) | `github-project-production-backlog.md` / `PROD-015A`, `PROD-015B`, `PROD-015C`, `PROD-001`, `PROD-006`, `PROD-007A` | Shared BSC token inputs, AMM settlement-model freeze, canonical AMM fields, and coordinated staged evidence remain open | Active |
| `BSC` | Restart recovery / replay / backfill | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | `github-project-production-backlog.md` / `PROD-018A`, `PROD-014B` | Recovery is proven in Stage-A, but automated replay, reset, and backfill handling is not finished | Active |
| `BSC` | Observability / alerting / reconciliation | Blocked | [../hyperbet-production-deploy.md](../hyperbet-production-deploy.md), [production-readiness-audit-2026-03-29.md](production-readiness-audit-2026-03-29.md) | `github-project-production-backlog.md` / `PROD-017`, `PROD-018`, `PROD-019` | No production-grade persistence, dashboards, alert thresholds, or operator reconciliation tooling yet | Active |
| `Solana` | Duel discovery / stream ingestion | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [../runbooks/hyperscapes-local-pm-integration.md](../runbooks/hyperscapes-local-pm-integration.md) | `github-project-production-backlog.md` / `PROD-014`, `PROD-014A`, `PROD-014B`, `PROD-018A` | Solana keeper still needs the same canonical versioned feed, durable checkpoints, and fail-closed parsing story as BSC | Active |
| `Solana` | Market materialization | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | `github-project-production-backlog.md` / `PROD-001`, `PROD-006` | `goldAmmMarketProgramId` and staged proof packaging still need closeout | Active |
| `Solana` | Trade posting | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | `github-project-production-backlog.md` / `PROD-006`, `PROD-007A` | Needs coordinated staged smoke evidence bundle and production telemetry | Active |
| `Solana` | Result discovery / correlation | Partial | [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | `github-project-production-backlog.md` / `PROD-014B`, `PROD-019` | Production result correlation and operator reconciliation remain open | Active |
| `Solana` | Resolve / claim / refund | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | `github-project-production-backlog.md` / `PROD-010`, `PROD-025` | Governance receipts and frozen audit evidence still need closeout | Active |
| `Solana` | Perps / models lifecycle | Green in Stage-A | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | `github-project-production-backlog.md` / `PROD-005`, `PROD-009`, `PROD-010` | Production custody, staged proof artifacts, and audit evidence are still open | Active |
| `Solana` | Wallet / account shell | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [../prediction-market-release-prep.md](../prediction-market-release-prep.md) | `github-project-production-backlog.md` / `PROD-047`, `PROD-049` | Shared wallet/account behavior, claims/positions shell truth, and full-app acceptance are not yet frozen as one canonical launch contract | Active |
| `Solana` | Points / referrals / rewards | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md), [production-readiness-audit-2026-03-29.md](production-readiness-audit-2026-03-29.md) | `github-project-production-backlog.md` / `PROD-048`, `PROD-050`, `PROD-021` | Rewards durability, referral/account support posture, and operator reconciliation are still open | Active |
| `Solana` | Internal AMM / liquidity dependencies | Green in Stage-A | [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md), [launch-ops-evidence-index.md](launch-ops-evidence-index.md) | `github-project-production-backlog.md` / `PROD-001`, `PROD-006`, `PROD-015B`, `PROD-015C`, `PROD-007A` | AMM settlement-model freeze, Solana settlement account auditability, registry completion, and coordinated staged evidence remain open | Active |
| `Solana` | Restart recovery / replay / backfill | Partial | [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | `github-project-production-backlog.md` / `PROD-018A`, `PROD-014B` | Recovery is proven in Stage-A, but automated replay/reset/backfill handling is not finished | Active |
| `Solana` | Observability / alerting / reconciliation | Blocked | [../hyperbet-production-deploy.md](../hyperbet-production-deploy.md), [production-readiness-audit-2026-03-29.md](production-readiness-audit-2026-03-29.md) | `github-project-production-backlog.md` / `PROD-017`, `PROD-018`, `PROD-019` | No production-grade persistence, dashboards, alert thresholds, or operator reconciliation tooling yet | Active |

## Parked AVAX Note

`AVAX` is preserved but intentionally parked. Existing AVAX code, evidence, and investigation stay in the repo, but AVAX rows are excluded from the active blocker table until the lane is explicitly reactivated through:

- `PROD-037 Preserve AVAX as a parked epic without active blocker status`
- `PROD-038 Define AVAX reactivation gates and re-entry checklist`
