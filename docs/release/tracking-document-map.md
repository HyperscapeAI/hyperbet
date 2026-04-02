# Hyperbet Tracking Document Map

> **TL;DR:** This map defines which documents own live launch truth, which documents own open work, which documents only preserve evidence, and which documents are historical snapshots. Hyperbet's full launch target remains `PM + perps + internal AMM`, the active production-readiness gate is `BSC + Solana`, and `AVAX` is preserved as a parked follow-on epic. The implementation target is runtime-family based: shared `EVM` plus `SVM`, not one named EVM chain.

## Scope Contract

Use this scope statement consistently across every active tracking document:

- full product destination: `PM + perps + internal AMM`
- active production-readiness gate: `BSC + Solana`
- parked follow-on epic: `AVAX`
- `AMM` is internal infrastructure, not a required retail browser surface
- implementation target: shared `EVM` runtime plus `SVM`

## Chain Generality Contract

Use this interpretation consistently across active documents and issue creation:

- `BSC` is the current active EVM proving and launch wrapper, not the exclusive
  long-term implementation target
- unless a ticket explicitly says `wrapper-specific`, `deployment-specific`, or
  `governance/evidence-only`, EVM work should land in shared EVM modules,
  registry-driven config, and reusable app/runtime paths
- `Solana` owns the active `SVM` lane
- future EVM onboardings such as `Base` or reactivated `AVAX` should consume
  the shared EVM path rather than require BSC-only rewrites

## Document Role Contract

| Role | Purpose | May own open work? |
|---|---|---|
| `Canonical guidance` | Says what is true now, what the active gate is, and what the top blockers are. | Summary only |
| `Canonical backlog` | Owns all remaining implementation, hardening, CI, launch, and ops work. | Yes |
| `Canonical evidence/status` | Proves what already passed and records current runtime status. | No |
| `Runbook` | Explains how to operate, deploy, verify, or recover a system. | No |
| `Historical snapshot` | Preserves prior branch-era execution context and evidence. | No |

## Canonical Guidance

| Document | Role | Current job |
|---|---|---|
| [production-readiness-audit-2026-03-29.md](production-readiness-audit-2026-03-29.md) | Canonical guidance | Production-readiness verdict, blocker inventory, execution order |
| [github-project-production-backlog.md](github-project-production-backlog.md) | Canonical backlog | Single issue-seed source for all remaining work |
| [../prediction-market-release-prep.md](../prediction-market-release-prep.md) | Canonical guidance | Reviewer-facing release summary and blocker summary |
| [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md) | Canonical guidance | Current freeze posture and blocker summary |
| [launch-ops-evidence-index.md](launch-ops-evidence-index.md) | Canonical guidance | Links launch evidence to repo artifacts and names missing evidence |
| [../hyperbet-production-deploy.md](../hyperbet-production-deploy.md) | Canonical guidance | Production and staging topology, required env contract |
| [external-audit-package-checklist.md](external-audit-package-checklist.md) | Canonical guidance | Audit-handoff packet completeness only |

## Canonical Evidence And Status

| Document | Role | Current job |
|---|---|---|
| [runtime-integration-readiness-matrix.md](runtime-integration-readiness-matrix.md) | Canonical evidence/status | End-to-end runtime loop status for `BSC + Solana` |
| [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | Canonical evidence/status | Browser-to-chain and real-Hyperscapes acceptance evidence |
| [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | Canonical evidence/status | Detailed Stage-A execution log, tx hashes, balances, artifacts |
| [launch-ops-evidence-index.md](launch-ops-evidence-index.md) | Canonical guidance + evidence index | Reviewer entrypoint to evidence references |

## Runbooks

| Document | Role | Current job |
|---|---|---|
| [../runbooks/hyperscapes-local-pm-integration.md](../runbooks/hyperscapes-local-pm-integration.md) | Runbook | Local real-duel integration steps and validation |
| [../runbooks/prediction-market-test-flow.md](../runbooks/prediction-market-test-flow.md) | Runbook | PM flow expectations and test guidance |
| [../runbooks/create2-mainnet-deploy.md](../runbooks/create2-mainnet-deploy.md) | Runbook | CREATE2 deployment procedure for active launch scope |
| [../runbooks/README.md](../runbooks/README.md) | Runbook | Index for operational runbooks |

## Historical Snapshots

These documents remain important, but they no longer own current blockers or open work:

| Document | Why it stays |
|---|---|
| [pm-launch-execution-plan.md](pm-launch-execution-plan.md) | Preserved superset strategy and checklist history |
| [testnet-operations-ledger.md](testnet-operations-ledger.md) | Historical Stage-A wallet and provisioning record |
| [localnet-headless-validation-tracker.md](localnet-headless-validation-tracker.md) | Branch-era local runner findings |
| [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md) | Execution evidence, not backlog ownership |
| [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) | Append-only evidence log |
| [../enoomian-prediction-market-sprint.md](../enoomian-prediction-market-sprint.md) | Closed sprint tracker |
| [../enoomian-evm-standardization-decisions.md](../enoomian-evm-standardization-decisions.md) | Historical design log |
| [../enoomian-next-phase-gates.md](../enoomian-next-phase-gates.md) | Historical planning artifact |

## Usage Rules

1. If the question is “what is still left?”, use the backlog first.
2. If the question is “is the system actually running end to end?”, use the runtime matrix first.
3. If the question is “what has already been proven?”, use the evidence docs.
4. If the question is “how do I operate this?”, use runbooks.
5. If a historical document disagrees with a canonical document, the canonical document wins unless the historical document is being cited as evidence.
6. The GitHub Project execution surface is one full Kanban board derived from
   the canonical backlog; do not create dated sprint contracts or calendar
   promises in tracking docs.
7. App shell, account, rewards, SDK, runtime, protocol, and off-repo launch
   work all belong on the same execution surface unless explicitly parked.
