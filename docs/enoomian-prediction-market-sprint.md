# Enoomian Prediction Market Sprint

> **TL;DR:** Historical sprint tracker for `enoomian/prediction-market-sprint-base`. Status: closed. Keep this as branch history only. It is not the current phase-1 launch closeout plan. Use [`docs/release/pm-launch-execution-plan.md`](release/pm-launch-execution-plan.md) and [`docs/release/prediction-market-launch-freeze-tracker.md`](release/prediction-market-launch-freeze-tracker.md) for current status.

This is the living gate tracker for the `enoomian/prediction-market-sprint-base` branch.

Update this document every time the sprint base branch is pushed, or when the
local sprint-base canonization materially changes its scope. Each update should
record:

1. The new sprint base commit.
2. Which gate branch merged into the base.
3. The targeted verification that was run.
4. The remaining risk or next gate.

## Sprint Base

- Base branch: `enoomian/prediction-market-sprint-base`
- Latest recorded sprint-era gate merged into base: `Gate 15 / 2e16661`
- Original sprint gate sequence status: `01-13 and 15 complete; 14 execution outstanding`
- Last updated: `2026-03-12`
- Active gate branch: `none`

## Gate Status

| Gate | Branch | Status | Merged To Base | Result |
| --- | --- | --- | --- | --- |
| 01 | `enoomian/pm-01-evm-sim-stability` | Complete | Yes | Async simulation runs, persisted scenario history, scenario CLI, deterministic degraded `ScenarioResult` output for heavy presets |
| 02 | `enoomian/pm-02-evm-scenario-gates` | Complete | Yes | Explicit gate-family catalog, scenario-specific policy evaluation, fresh-baseline scenario runs, and canonical/matrix verification coverage |
| 03 | `enoomian/pm-03-mm-risk-engine` | Complete | Yes | Shared quote sizing, gross-exposure and imbalance caps, and keeper quote refresh decisions now come from `@hyperbet/mm-core` |
| 04 | `enoomian/pm-04-keeper-health-recovery` | Complete | Yes | Keeper bots now persist market health/recovery snapshots and all three keeper services expose merged bot health via `/status` and `/api/keeper/bot-health` |
| 05 | `enoomian/pm-05-runtime-parity` | Complete | Yes | External bot and EVM keepers now share chain-registry runtime assembly, quote refresh behavior, and direct local quote lifecycle smokes for BSC and AVAX |
| 06 | `enoomian/pm-06-frontend-settlement` | Complete | Yes | Solana, BSC, and AVAX shells now follow canonical lifecycle and claim state with green focused lifecycle verification |
| 07 | `enoomian/pm-07-solana-bot-execution` | Complete | Yes | External market-maker bot now executes real Solana quote, cancel, refresh, and claim flows with validator-backed smoke coverage |
| 08 | `enoomian/pm-08-solana-sim-backend` | Complete | Yes | Validator-backed Solana proof scenarios now run through the shared scenario backend contract |
| 09 | `enoomian/pm-09-solana-scenario-gates` | Complete | Yes | Validator-backed Solana exploit families now run through deterministic gate scenarios with canonical and matrix verification |
| 10 | `enoomian/pm-10-cross-chain-e2e` | Complete | Yes | Cross-chain local E2E now covers full lifecycle, cancel/refund, and keeper restart recovery across Solana, BSC, and AVAX |
| 11 | `enoomian/pm-11-ci-ops` | Complete | Yes | Prediction-market gates are enforced in CI, deploy envs fail closed, Base has a registry-only add-chain proof, and operator runbooks are in place |
| 12 | `enoomian/pm-12-avax-canonicalization` | Complete | Yes | AVAX Fuji deployment truth is canonicalized; AVAX mainnet remains non-live until canonical mainnet addresses are committed |
| 13 | `enoomian/pm-13-contract-ci-hardening` | Complete | Yes | EVM contract validation, proof, and security checks are promoted into stable CI workflow lanes |
| 14 | `n/a` | In Progress | No | Manual staged live-proof rail is implemented for Solana and BSC, but the staged execution and artifact review are still outstanding |
| 15 | `enoomian/pm-15-docs-hygiene-and-release-prep` | Complete | Yes | Release-facing docs are cleaned, reviewer handoff material is assembled, and sprint history reflects the merged post-sprint gates |

## Current Branch State

- Current branch head: local sprint-base standardization head
- Latest integrated code-hardening batch: local sprint-base standardization head
- Latest integrated doc/tracker refresh: local sprint-base standardization head
- Latest known fully green branch-check baseline: `f1824a0`
- Current CI state on the latest fully green branch-check baseline:
  - `Hyperbet CI` green
  - `Prediction Market Gates` green
- The original sprint gate sequence is complete except for Gate `14`
  execution.
- Gate `14` should now be treated as deployed-environment proof execution:
  - proof rail implemented
  - execution still outstanding
- Cross-chain E2E remains local-only by design until it is re-promoted as a
  stable required lane.
- AVAX is partially canonicalized: Fuji is canonicalized in-registry, while mainnet is intentionally non-live until canonical deployment is committed.

### Post-Sprint Hardening Already Merged

- external-bet auth and idempotency hardening
- canonicalized external-bet economics
- EVM loser-cleanup claim path exposure in the UI
- Solana runtime deploy artifact tracking for the exploit gate
- staging-rail mode awareness for deploy and proof flows
- Solana simulation dashboard fee-unit and agent-state fixes
- fallback winner preservation for BSC/AVAX degraded lifecycle records
- duplicate-bet startup quarantine instead of keeper boot failure
- Solana MM environment normalization for `MM_ENV=e2e|stream-ui`
- EVM standardization:
  - deployment materialization under `@hyperbet/chain-registry`
  - canonical `hyperbet-evm` app shell
  - hardened shared EVM keeper core
  - canonicalized `hyperbet-evm/keeper`
  - safe shell-level wrapper convergence

### What The Sprint Base Contains Today

The sprint base now contains:

- the completed original sprint gate set (`01-13`, `15`)
- a partial but implemented Gate `14` proof rail
- post-sprint security, reliability, and deploy hardening beyond the original
  gate sequence

The branch is therefore best understood as:

- a complete multichain prediction-market hardening baseline for
  `develop`-level integration
- not yet a launch-complete branch under the trust-minimized, tri-chain
  mandatory launch bar

### Integrated Scope Today

Today, the sprint base includes the following integrated work:

- Multichain foundation:
  - shared chain/deployment registry
  - shared `@hyperbet/mm-core`
  - normalized prediction-market lifecycle/read-model surfaces
  - workspace/bootstrap normalization required by the shared packages
- EVM protocol and proof surface:
  - GoldClob settlement cleanup
  - EVM contract validation, proof, and security lanes
  - deterministic EVM exploit/simulation coverage
  - Base add-chain proof through the shared runtime model
- Solana runtime and proof surface:
  - validator-backed Solana proof backend
  - Solana exploit gate
  - Solana program build gate
  - committed Solana runtime deploy artifacts for proof/runtime lanes
  - Solana bot/runtime support for quote, cancel, refresh, and claim flows
- Frontend/runtime parity:
  - canonical lifecycle-driven Solana/BSC/AVAX shell behavior
  - shared claim-state handling
  - EVM loser-cleanup path exposed in the app
  - Solana dashboard fixes for fee units and top-level agents
- Keeper security and degraded-runtime correctness:
  - strict external-bet tx verification
  - insert-first/idempotent reward recording
  - canonicalized external-bet economics
  - exact trusted-origin enforcement
  - graceful `verify:chains` failure for unconfigured AVAX
  - fallback winner preservation for degraded BSC/AVAX lifecycle records
  - deterministic duplicate-bet quarantine instead of startup outage
  - Solana MM env normalization for `e2e` and `stream-ui`
- CI, deploy, and operational hardening:
  - canonical EVM surfaces now recognized by CI
  - fast CI plus heavyweight prediction-market gates
  - verified install wrapper and env/deploy audit
  - deploy rail hardening without topology redesign
- AVAX mainnet-only fail-closed production semantics while Fuji is canonicalized
  - deployed-environment proof rail scaffolding
  - runbooks and release-prep documentation

What remains is launch-completion work, not architecture bootstrap:

- Gate `14` proof execution against a real deployed environment
- trust-minimized resolution
- full order semantics and self-trade prevention
- durable production keeper/MM storage
- AVAX production-canonical enablement
- final deployed-environment proof, audit, and release-candidate signoff

## Next Phase

The sprint base is not launch-complete under the chosen bar:

- trust-minimized prelaunch
- tri-chain mandatory launch

The remaining work is tracked in:

- [Next-Phase Gates](enoomian-next-phase-gates.md)

Execution model for the next phase:

- branch each gate independently from `enoomian/prediction-market-sprint-base`
- ship each gate as its own coherent mergeable unit
- use [Next-Phase Gates](enoomian-next-phase-gates.md) as the source of truth
  for branch names, dependencies, merge criteria, and required checks

The dominant open risks are:

- privileged resolution truth
- incomplete protocol order semantics and self-trade prevention
- non-canonical AVAX mainnet production state
- non-durable keeper/MM production storage
- unexecuted deployed-environment proof

## Gate Results

### Gate 01

- Branch: `enoomian/pm-01-evm-sim-stability`
- Base commit after merge: `5834cec`
- Commit: `5834cec` `evm-sim: stabilize scenario runner and CLI`
- Status: complete and merged into sprint base

Delivered:

- Background scenario runs instead of request-blocking execution.
- Scenario CLI with `list`, `latest`, `history`, and `run`.
- Persisted run and result history outside the repo.
- Per-run stage tracking, including per-agent tick stages.
- Deterministic degraded `ScenarioResult` output for overloaded scenarios.
- Reduced scenario hot-path load for heavy presets.

Targeted verification:

- `bunx tsc --noEmit -p packages/simulation-dashboard/tsconfig.json`
- `bun run --cwd packages/simulation-dashboard scenario run attack-gauntlet --seed=gauntlet-seed-1`
- `bun run --cwd packages/simulation-dashboard scenario run full-chaos --seed=chaos-seed-1`

Known remaining risk:

- Heavy scenarios are now deterministic and diagnosable, but they still degrade on timeout paths instead of passing as exploit gates.
- `ScenarioResult` can still be generated from fallback state when final state capture times out.
- Gate 02 needs to turn these degraded completions into explicit scenario-family gates with fixed expected outcomes and stronger assertions.

### Gate 02

- Branch: `enoomian/pm-02-evm-scenario-gates`
- Base commit after merge: `cb92a52`
- Commit: `cb92a52` `evm-sim: add scenario gates and deterministic fresh runs`
- Status: complete and merged into sprint base

Delivered:

- Added explicit gate scenario catalog with ids, families, canonical seeds, matrix seeds, runtime profiles, and per-scenario gate policy.
- Added scenario policy evaluation on top of shared mitigation gates so stale-signal, stale-oracle, close-window, inventory-poisoning, sandwich, frontrun/backrun, wash, cancel-replace, order-flood, arbitrage, and claim/refund scenarios each have deterministic pass/fail semantics.
- Expanded the simulation CLI with `gates`, `canonical`, `matrix`, `suite`, and `--fresh`, and made CLI exit status depend on `result.passed`, not only run completion.
- Hardened the sim runner with staged baseline restore/rebuild, awaited Anvil shutdown, fresh-baseline scenario mode, and more fault-tolerant settlement/claim cleanup.
- Tuned heavy canonical scenarios down to CI-grade tick budgets while keeping the higher-pressure behavior in matrix and diagnostic runs.

Targeted verification:

- `bunx tsc --noEmit -p packages/simulation-dashboard/tsconfig.json`
- `bun test packages/simulation-dashboard/src/scenario-evaluator.test.ts`
- Fresh canonical gate runs passed for:
  `stale-signal-sniping`, `stale-oracle-sniping`, `close-window-race`, `whale-impact`, `mev-extraction`, `sandwich-attack`, `wash-trading`, `arbitrage-hunt`, `cancel-replace-griefing`, `stress-test`, `claim-refund-abuse`
- Fresh matrix runs passed for:
  `sandwich-attack` (`sandwich-seed-1/2/3`),
  `stale-oracle-sniping` (`stale-oracle-seed-1/2/3`),
  `whale-impact` (`inventory-poisoning-seed-1/2/3`),
  `stress-test` (`order-flood-seed-1/2/3`)

Known remaining risk:

- The fastest snapshot/revert path is still less reliable than fresh-baseline mode for long multi-scenario runs, so fresh rebuilds are the current verification default for exploit gates.
- Scenario history intentionally retains older degraded runs, so operators need to read the latest run for current gate truth.
- Gate 03 should now focus on extending `@hyperbet/mm-core` from pricing into full size/risk planning and then feed that into keepers and the external bot.

### Gate 03

- Branch: `enoomian/pm-03-mm-risk-engine`
- Base commit after merge: `d4323e4`
- Commit: `d4323e4` `mm-core: share quote sizing and refresh policy with keepers`
- Status: complete and merged into sprint base

Delivered:

- Extended `@hyperbet/mm-core` with explicit gross-exposure limits, side-imbalance caps, toxicity-driven size reduction, reduce-only state, and centralized quote refresh decisions.
- Added shared `evaluateQuoteDecision` flow so keeper bots no longer open-code price-only refresh and stale replacement logic.
- Switched Solana, BSC, and AVAX keeper-managed CLOB seeding from fixed-size perpetual seed orders to shared target sizing from `buildQuotePlan`.
- Added unit coverage for per-market notional caps, reduce-only imbalance behavior, size-refresh behavior, and refresh-window keep behavior.

Targeted verification:

- `bun test` in `packages/hyperbet-mm-core`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-solana/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-bsc/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-avax/keeper`

Known remaining risk:

- Keeper quote contexts still feed placeholder freshness timestamps into the shared risk engine, so stale-stream / stale-oracle / stale-rpc halts are structurally available but not yet backed by real keeper health telemetry.
- Gross exposure and imbalance policy are now centralized, but keeper `/status` does not yet expose the resulting per-market health model for operators.
- Gate 04 should focus on surfacing that health state and adding restart/recovery behavior around missed sync, stale RPC, partial claim, and restart-with-open-orders.

### Gate 04

- Branch: `enoomian/pm-04-keeper-health-recovery`
- Base commit after merge: `79d0101`
- Commit: `79d0101` `keeper: add health and recovery surfaces`
- Status: complete and merged into sprint base

Delivered:

- Added shared keeper market-health and recovery snapshot types to `@hyperbet/mm-core`, plus merge helpers for lifecycle records and keeper health.
- Extended Solana, BSC, and AVAX keeper bots to persist restart/recovery state, per-market quote health, stream/oracle/RPC freshness timestamps, and settled-market retention snapshots.
- Added startup restart reconciliation detection for prior open-order state and serialized bot health snapshots so operators can inspect recovery state even when the bot is disabled.
- Updated all three keeper services to load bot health snapshots, merge them into normalized prediction-market status output, and expose a dedicated `/api/keeper/bot-health` endpoint.
- Added mm-core unit coverage for lifecycle-to-health merging so the status merge path is tested independently of live keeper state.

Targeted verification:

- `bun test` in `packages/hyperbet-mm-core`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-solana/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-bsc/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-avax/keeper`
- `curl -s http://127.0.0.1:5611/status`
- `curl -s http://127.0.0.1:5611/api/keeper/bot-health`
- `curl -s http://127.0.0.1:5612/status`
- `curl -s http://127.0.0.1:5612/api/keeper/bot-health`
- `curl -s http://127.0.0.1:5613/status`
- `curl -s http://127.0.0.1:5613/api/keeper/bot-health`

Known remaining risk:

- Keeper health is now visible and durable, but the external market-maker bot and EVM keeper runtimes still diverge in runtime assembly, env handling, and refresh/recovery behavior.
- `predictionMarkets.chains[].health` depends on live lifecycle records existing in the current keeper snapshot, so the merge path is covered by tests while idle `/status` responses can still show an empty `chains` array.
- Gate 05 should align the external bot and EVM keepers on the same chain-registry-driven runtime selection, fair-value inputs, halt logic, and refresh rules.

### Gate 05

- Branch: `enoomian/pm-05-runtime-parity`
- Base commit after merge: `dc05370`
- Commits:
  - `8928897` `runtime: align evm resolver and quote refresh`
  - `dc05370` `runtime: add evm quote lifecycle smoke coverage`
- Status: complete and merged into sprint base

Delivered:

- Moved the external market-maker bot and `verify-chains` onto shared chain-registry runtime resolution so BSC, Base, and AVAX use the same RPC/address/env selection path as the rest of the stack.
- Switched the external bot onto shared quote refresh behavior and added explicit per-chain nonce management for EVM write paths, fixing local same-cycle quote placement on real chains.
- Updated BSC and AVAX keeper bots and services to derive enabled EVM runtimes from chain-registry data plus `EVM_KEEPER_CHAINS`, instead of package-local hardcoded chain lists.
- Added direct runtime smoke commands in `packages/market-maker-bot` that deploy local oracle/CLOB contracts, run quote -> take -> lock -> resolve -> claim, and verify filled-position cleanup without depending on the frontend shell.
- Extended the bot test harness to cover the new runtime nonce path and refresh-window behavior.

Targeted verification:

- `bun test` in `packages/hyperbet-chain-registry`
- `bun test` in `packages/market-maker-bot`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-bsc/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-avax/keeper`
- `bun run smoke:runtime:bsc -- --rpc-url http://127.0.0.1:18545` in `packages/market-maker-bot`
- `bun run smoke:runtime:avax -- --rpc-url http://127.0.0.1:18545` in `packages/market-maker-bot`

Known remaining risk:

- The BSC and AVAX app shells still have UI-level drift relative to the shared canonical lifecycle panels, so frontend claim/settlement parity remains open for Gate 06 and full cross-chain product reliability remains open for Gate 10.
- The direct runtime smokes currently log a benign cancel failure when the bot tries to cancel an order that was already fully filled before lock; the tracked-order state still clears correctly, but the noisy log path should eventually be tightened.
- Solana execution in the external bot is still incomplete, so runtime parity is only closed for the EVM side of the external market maker.

### Gate 06

- Branch: `enoomian/pm-06-frontend-settlement`
- Base commit after merge: `0a8af43`
- Commits:
  - `110c9e9` `Implement Gate 06 frontend settlement parity`
  - `9c6fcd1` `frontend: fix shell typecheck and avax e2e setup`
  - `0a8af43` `frontend: keep evm lifecycle claim state live`
- Status: complete and merged into sprint base

Delivered:

- Fixed Solana shell/typecheck drift so the Solana app now resolves the shared `ModelsMarketView` correctly and no longer carries duplicate handler/prop issues in the stream shell.
- Fixed AVAX local E2E harness drift so its validator bootstrap falls back through the same Solana wallet path chain as BSC instead of hard-failing on a missing deployer key.
- Kept the shared EVM lifecycle shell canonical by allowing the EVM panel to trade from normalized lifecycle state without requiring a pre-fetched market existence check.
- Added optimistic EVM wallet-position carry-forward in the shared EVM panel so claimability and visible exposure stay aligned with canonical lifecycle after a confirmed order even when local read refresh lags the write path.
- Kept quick-order UI hidden by default in normal runtime but exposed limit-price controls in E2E mode so the lifecycle shell specs can drive deterministic price entry on BSC and AVAX.

Targeted verification:

- `bun test packages/hyperbet-ui/tests/predictionMarkets.test.ts`
- `bunx tsc --noEmit -p packages/hyperbet-ui/tsconfig.verify.json`
- `bunx tsc --noEmit -p packages/hyperbet-solana/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-bsc/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-avax/app/tsconfig.json`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "solana lifecycle shell|solana predictions place"` in `packages/hyperbet-solana/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm lifecycle shell|evm predictions place"` in `packages/hyperbet-bsc/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm lifecycle shell|evm predictions place"` in `packages/hyperbet-avax/app`

Known remaining risk:

- Gate 06 closes focused lifecycle and claim parity, but it does not yet close the full cross-chain product path; restart/recovery, broader shell regressions, and full create -> seed -> trade -> lock -> resolve -> claim reliability remain Gate 10 work.
- The shared EVM panel now uses an optimistic exposure fallback to bridge local read lag after confirmed writes. That behavior is intentional and test-backed, but it should continue to be exercised in Gate 10 so it does not mask a real backend read regression.
- Solana exploit-family coverage is now closed by Gate 09, so the next sprint-critical work moves to Gate 10 cross-chain reliability.

### Gate 07

- Branch: `enoomian/pm-07-solana-bot-execution`
- Base commit after merge: `70e1bd4`
- Commits:
  - `19bb8e6` `market-maker-bot: implement Solana execution runtime`
  - `d0997ae` `tests: add Solana bot smoke coverage`
  - `70e1bd4` `docs: document Solana bot runtime requirements`
- Status: complete and merged into sprint base

Delivered:

- Replaced the external bot's readiness-only Solana path with an Anchor-backed runtime that resolves Solana deployment defaults from `@hyperbet/chain-registry`, loads config PDA state, and disables only Solana when signer, program, or config prerequisites are unusable.
- Added real Solana duel-to-market sync, on-chain order reconciliation, shared mm-core quote planning, refresh-window keep behavior, stale and lifecycle-driven cancellation, resolved claim handling, and richer Solana status/config reporting.
- Added focused Solana unit coverage plus a validator-backed `bun run smoke:runtime:solana` path reused from the local Anchor workspace.
- Documented the Solana signer, program-id, and wallet-config requirements in the market-maker bot package examples and README.

Targeted verification:

- `bun test` in `packages/market-maker-bot`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/market-maker-bot`
- `ANCHOR_TEST_RPC_PORT=18999 ANCHOR_TEST_WS_PORT=19000 ANCHOR_TEST_FAUCET_PORT=19900 bun run smoke:runtime:solana` in `packages/market-maker-bot`

Known remaining risk:

- The validator smoke proves quote placement, fill, resolve, and claim. Stale-order cancellation and lock-triggered cancellation remain primarily covered by unit tests and should be re-exercised in Gate 10 cross-chain E2E.
- Production Solana execution now depends on a funded signer plus live fight-oracle / gold-CLOB deployments and config PDA state, so env validation and operator runbooks remain Gate 11 work.

### Gate 08

- Branch: `enoomian/pm-08-solana-sim-backend`
- Base commit after merge: `e709eac`
- Commits:
  - `8d8ae2a` `simulation-dashboard: add chain-aware scenario metadata`
  - `067ee7a` `simulation-dashboard: add validator-backed Solana scenarios`
  - `e709eac` `simulation-dashboard: harden backend split runtime`
- Status: complete and merged into sprint base

Delivered:

- Added backend selection and shared backend contracts so simulation scenarios can run on EVM or validator-backed Solana without changing the public HTTP surface.
- Added a full Solana backend with validator bootstrapping, program runtime wiring, proof scenario execution, and normalization into the shared `ScenarioResult` contract.
- Added chain-aware scenario run records and unit coverage for backend routing and Solana result normalization.
- Hardened the EVM backend path with managed MM quote refresh behavior, read-provider fallback to the write client, and env-configurable simulation ports for isolated verification runs.

Targeted verification:

- `bunx tsc --noEmit -p tsconfig.json` in `packages/simulation-dashboard`
- `bun test` in `packages/simulation-dashboard`
- `SIM_API_URL=http://127.0.0.1:3501 node --import tsx src/cli.ts canonical solana-happy-path`
- `SIM_API_URL=http://127.0.0.1:3501 node --import tsx src/cli.ts canonical solana-unauthorized-oracle-attack`
- `SIM_API_URL=http://127.0.0.1:3501 node --import tsx src/cli.ts canonical stale-oracle-sniping --fresh`

Known remaining risk:

- The long diagnostic EVM `normal-market` preset still degrades under extended tick counts; Gate 08 closes the backend abstraction and proof path, but not the remaining diagnostic-performance issue.
- Solana proof runs still leave noisy websocket reconnect logs from validator teardown in the long-lived dashboard process; they do not invalidate results, but the cleanup path should be tightened.
- Gate 09 closes the first Solana exploit-family gate set, but Gate 10 still needs to re-exercise those protections in the full cross-chain product flows.

### Gate 09

- Branch: `enoomian/pm-09-solana-scenario-gates`
- Base commit after merge: `20c3e52`
- Commit: `20c3e52` `solana-sim: add validator-backed scenario gates`
- Status: complete and merged into sprint base

Delivered:

- Added six real Solana gate presets on top of the validator-backed backend: stale-resolution-window, lock-race-attempt, cancel-replace-griefing, inventory-poisoning, claim-refund-abuse, and cross-market-validation-abuse.
- Extended the Solana program runtime with duel locking, duel cancellation, order cancellation, and custom result timestamps so validator-backed proof scenarios can drive real lifecycle abuse paths against `fight_oracle` and `gold_clob_market`.
- Replaced the single-path Solana proof runner with scenario-specific scripted flows that hit actual oracle and CLOB rejection paths, including invalid pre-close resolution attempts, post-lock order rejection, same-level cancel/replace churn, repeated refund-claim rejection, and wrong-market remaining-account rejection.
- Extended Solana proof normalization with guard-trip metrics and generalized adversarial-rejection detection so the new gate scenarios land on the shared `ScenarioResult` contract without Solana-only pass/fail logic.
- Verified that persistent-level cancel/replace churn works on the real Solana programs while level-closing cancellation remains a separate protocol concern to revisit under broader E2E/runtime coverage.

Targeted verification:

- `bunx tsc --noEmit -p packages/simulation-dashboard/tsconfig.json`
- `bun test packages/simulation-dashboard`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-stale-resolution-window`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-lock-race-attempt`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-cancel-replace-griefing`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-inventory-poisoning`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-claim-refund-abuse`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-cross-market-validation-abuse`
- `bun run --cwd packages/simulation-dashboard scenario matrix solana-lock-race-attempt`
- `bun run --cwd packages/simulation-dashboard scenario matrix solana-inventory-poisoning`
- `bun run --cwd packages/simulation-dashboard scenario matrix solana-cross-market-validation-abuse`

Known remaining risk:

- Solana validator runs still emit noisy websocket reconnect logs during teardown; they do not invalidate results, but the shutdown path is still rough.
- The cancel/replace scenario is currently validated through same-level churn behind a persistent resting quote; broader order-book cancellation patterns still need to be exercised in Gate 10 cross-chain E2E.
- The canonical stale-resolution and claim-refund scenarios have one fixed seed each today. They are deterministic and green, but higher-pressure seed matrices can still be added if Gate 10 uncovers path dependence.

### Gate 10

- Branch: `enoomian/pm-10-cross-chain-e2e`
- Base commit after merge: `875d1a4`
- Commits:
  - `521d074` `e2e: add gate 10 process control and recovery specs`
  - `3984410` `e2e: harden gate 10 recovery paths`
  - `e143181` `runtime: persist lifecycle state and fix claim recovery`
  - `875d1a4` `e2e: close gate 10 cross-chain reliability flows`
- Status: complete and merged into sprint base

Delivered:

- Added deterministic local process-control and recovery wiring for the Solana, BSC, and AVAX E2E stacks so the harness can restart keepers and chain readers inside a live run without production-only restart endpoints.
- Persisted keeper stream-state snapshots across Solana, BSC, and AVAX services so the canonical lifecycle surface can recover duel identity and market refs after restarts instead of falling back to `UNKNOWN`.
- Hardened shared EVM lifecycle and claim recovery by aligning the UI ABI/client expectations with the live `GoldClob` interface and surfacing richer E2E lifecycle debug state in the shared EVM and Solana panels.
- Reworked the cross-chain reliability specs to use fresh isolated markets for restart and cancel/refund flows, which closes the prior false-coupling to already-resolved seeded markets.
- Closed the real product-path assertions for full lifecycle, keeper restart recovery, cancel/refund cleanup, and health-surface parity across Solana, BSC, and AVAX.

Targeted verification:

- `bun test packages/hyperbet-ui/tests/predictionMarkets.test.ts`
- `bunx tsc --noEmit -p packages/hyperbet-ui/tsconfig.verify.json`
- `bunx tsc --noEmit -p packages/hyperbet-solana/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-solana/keeper/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-bsc/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-bsc/keeper/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-avax/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-avax/keeper/tsconfig.json`
- `bash -n packages/hyperbet-solana/app/scripts/run-e2e-local.sh`
- `bash -n packages/hyperbet-bsc/app/scripts/run-e2e-local.sh`
- `bash -n packages/hyperbet-avax/app/scripts/run-e2e-local.sh`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "solana predictions place YES and NO orders, resolve, and claim|solana prediction markets recover after keeper and proxy restarts|solana cancelled duel refunds and clears claim state"` in `packages/hyperbet-solana/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm predictions place YES and NO orders, resolve, and claim|bsc prediction markets recover after keeper and anvil restarts|bsc cancelled prediction markets refund and clear positions"` in `packages/hyperbet-bsc/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm predictions place YES and NO orders, resolve, and claim|avax prediction markets recover after keeper and anvil restarts|avax cancelled prediction markets refund and clear positions"` in `packages/hyperbet-avax/app`
- `bash scripts/run-e2e-local.sh tests/e2e/app-tabs-and-apis.spec.ts --grep "keeper backend exposes all app-facing data endpoints"` in `packages/hyperbet-solana/app`
- `bash scripts/run-e2e-local.sh tests/e2e/app-tabs-and-apis.spec.ts --grep "keeper backend exposes all app-facing data endpoints"` in `packages/hyperbet-bsc/app`
- `bash scripts/run-e2e-local.sh tests/e2e/app-tabs-and-apis.spec.ts --grep "keeper backend exposes all app-facing data endpoints"` in `packages/hyperbet-avax/app`

Known remaining risk:

- The BSC and AVAX API smoke now asserts exact duel and contract identity but only enforces `marketRef` as a valid canonical hex32 or `null`; the stricter seeded-key equality is still exercised by the real product E2E flows, but the cold-start API record path remains slightly looser than the full lifecycle path.
- Gate 10 closes local cross-chain reliability, but CI promotion, env/secret safety, add-chain proof for Base, and operator runbooks remain Gate 11 work.
- Solana cancellation is now covered in the product path for fresh isolated markets, but any future protocol changes to order-book cancellation semantics should be re-exercised against these E2E flows, not only the validator scenario suite.

### Gate 11

- Branch: `enoomian/pm-11-ci-ops`
- Base commit after merge: `05c7882`
- Commits:
  - `d91e5fc` `ci: add prediction market gate automation`
  - `05c7882` `ops: harden deploy checks and add runbooks`
- Status: complete and merged into sprint base

Delivered:

- Added a reusable GitHub Actions toolchain setup action for Bun `1.3.1` plus optional Foundry, Rust, Solana CLI, and Anchor installs.
- Expanded fast CI to cover `@hyperbet/mm-core`, `@hyperbet/market-maker-bot`, `packages/simulation-dashboard`, shared env auditing, and production build hygiene.
- Added a heavyweight `prediction-market-gates.yml` workflow with independent EVM exploit, Solana exploit, cross-chain E2E, and Base add-chain smoke jobs plus artifact upload on failure.
- Added root CI wrapper scripts for env auditing, exploit gates, cross-chain E2E gate execution, Base add-chain proof, and shared artifact collection under `.ci-artifacts/`.
- Added a machine-enforced env/deploy audit that validates tracked env placeholders, public RPC safety, required deploy vars, and canonical mainnet BSC/Base production settings.
- Hardened Pages and keeper deploy workflows with the shared env audit plus post-deploy health verification for `/status`, `/api/arena/prediction-markets/active`, and `/api/keeper/bot-health`.
- Added operator runbooks for quote disablement, stale oracle/stream handling, chain outage/RPC degradation, stuck market recovery, and claim backlog drainage.
- Proved the Base path remains registry-driven with a direct add-chain smoke that exercises chain-registry tests, market-maker runtime smoke, and shared EVM app-shell build output without chain-specific strategy edits.

Targeted verification:

- `node --import tsx scripts/ci-env-audit.ts --target=ci-shared --json`
- `VITE_GAME_API_URL=https://api.hyperbet.win VITE_GAME_WS_URL=wss://api.hyperbet.win/ws VITE_SOLANA_CLUSTER=mainnet-beta VITE_USE_GAME_RPC_PROXY=true VITE_USE_GAME_EVM_RPC_PROXY=true VITE_BSC_CHAIN_ID=56 VITE_BSC_GOLD_CLOB_ADDRESS=0x443C09B1E7bb7bA3392b02500772B185654A6F33 VITE_BASE_CHAIN_ID=8453 VITE_BASE_GOLD_CLOB_ADDRESS=0xb8c66D6895Bafd1B0027F2c0865865043064437C node --import tsx scripts/ci-env-audit.ts --target=pages:solana --json`
- `VITE_GAME_API_URL=https://api.hyperbet.win VITE_GAME_WS_URL=wss://api.hyperbet.win/ws VITE_SOLANA_CLUSTER=mainnet-beta VITE_USE_GAME_RPC_PROXY=true VITE_USE_GAME_EVM_RPC_PROXY=true VITE_BSC_CHAIN_ID=56 VITE_BSC_GOLD_CLOB_ADDRESS=0x443C09B1E7bb7bA3392b02500772B185654A6F33 VITE_BASE_CHAIN_ID=8453 VITE_BASE_GOLD_CLOB_ADDRESS=0xb8c66D6895Bafd1B0027F2c0865865043064437C node --import tsx scripts/ci-env-audit.ts --target=pages:bsc --json`
- `CI_AUDIT_REQUIRE_RUNTIME=true HYPERBET_KEEPER_URL=https://api.hyperbet.win RAILWAY_PROJECT_ID=test RAILWAY_PRODUCTION_ENVIRONMENT_ID=test RAILWAY_KEEPER_SERVICE_ID=test SOLANA_RPC_URL=https://api.mainnet-beta.solana.com node --import tsx scripts/ci-env-audit.ts --target=keeper:solana --json`
- `CI_AUDIT_REQUIRE_RUNTIME=true HYPERBET_KEEPER_URL=https://bsc-api.hyperbet.win RAILWAY_PROJECT_ID=test RAILWAY_PRODUCTION_ENVIRONMENT_ID=test RAILWAY_KEEPER_SERVICE_ID=test BSC_RPC_URL=https://bsc-dataseed.binance.org node --import tsx scripts/ci-env-audit.ts --target=keeper:bsc --json`
- `CI_AUDIT_REQUIRE_RUNTIME=true HYPERBET_KEEPER_URL=https://avax-api.hyperbet.win RAILWAY_PROJECT_ID=test RAILWAY_PRODUCTION_ENVIRONMENT_ID=test RAILWAY_KEEPER_SERVICE_ID=test AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc node --import tsx scripts/ci-env-audit.ts --target=keeper:avax --json`
- `MM_PREDICTION_MARKETS_API_URL=https://api.hyperbet.win/api/arena/prediction-markets/active EVM_BSC_RPC_URL=https://bsc-dataseed.binance.org CLOB_CONTRACT_ADDRESS_BSC=0x443C09B1E7bb7bA3392b02500772B185654A6F33 EVM_BASE_RPC_URL=https://mainnet.base.org CLOB_CONTRACT_ADDRESS_BASE=0xb8c66D6895Bafd1B0027F2c0865865043064437C EVM_AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc CLOB_CONTRACT_ADDRESS_AVAX=0x1111111111111111111111111111111111111111 SOLANA_RPC_URL=https://api.mainnet-beta.solana.com SOLANA_PRIVATE_KEY=[1,2,3] GOLD_CLOB_MARKET_PROGRAM_ID=Gold11111111111111111111111111111111111111 node --import tsx scripts/ci-env-audit.ts --target=bot --json`
- `bun test packages/hyperbet-chain-registry/tests/chainRegistry.test.ts`
- `bun run --cwd packages/market-maker-bot test`
- `bun run --cwd packages/simulation-dashboard test`
- `node --import tsx scripts/ci-gate-base.ts`

Known remaining risk:

- The new heavyweight CI workflow is wired and locally sanity-checked through the direct wrapper entrypoints, but the full GitHub Actions matrix has not yet been observed end-to-end on remote runners from this branch.
- The direct Node/tsx wrapper entrypoints are the canonical Gate 11 verification path. On this local desktop sandbox, `bun run ci:gate:base` remains less reliable than invoking the wrapper directly, so the workflows intentionally call the wrappers themselves instead of shelling through package scripts.
- Any new protocol-level exploit or deploy invariant uncovered by the CI gate workflows should land as a dedicated follow-up branch, not by weakening the gates.

### Gate 12

- Branch: `enoomian/pm-12-avax-canonicalization`
- Base commit after merge: `eaa5f0f`
- Commits:
  - `c173587` `avax: add canonical readiness checks`
  - `e4f1d44` `ci: fail closed on incomplete avax production config`
  - `eaa5f0f` `docs: document avax fail-closed production state`
- Status: complete and merged into sprint base

Delivered:

- Added explicit shared chain-registry helpers for EVM canonical readiness and missing canonical address reporting.
- Marked AVAX mainnet as intentionally non-live until canonical mainnet addresses are committed, while Fuji deployment truth is now canonicalized.
- Added fail-closed AVAX app, keeper, and bot env-audit semantics so production-like AVAX paths reject partial config.
- Updated CI/deploy assumptions and AVAX-facing docs/examples so AVAX is treated as local/testnet capable but intentionally production-disabled until canonical registry truth exists.
- Disabled AVAX by default in the market-maker bot example env so copied configs do not accidentally opt into a non-canonical production lane.

Targeted verification:

- `bun test packages/hyperbet-chain-registry/tests/chainRegistry.test.ts`
- `VITE_GAME_API_URL=https://api.hyperbet.win VITE_GAME_WS_URL=wss://api.hyperbet.win/ws VITE_SOLANA_CLUSTER=testnet VITE_USE_GAME_RPC_PROXY=true VITE_USE_GAME_EVM_RPC_PROXY=true node --import tsx scripts/ci-env-audit.ts --target=app:avax`
- `HYPERBET_KEEPER_URL=https://keeper.example RAILWAY_PROJECT_ID=proj RAILWAY_PRODUCTION_ENVIRONMENT_ID=env RAILWAY_KEEPER_SERVICE_ID=svc CI_AUDIT_REQUIRE_RUNTIME=true AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc AVAX_GOLD_CLOB_ADDRESS=0x1111111111111111111111111111111111111111 node --import tsx scripts/ci-env-audit.ts --target=keeper:avax`
- `node --import tsx scripts/ci-gate-base.ts`

Known remaining risk:

- AVAX is safe by explicit disablement, not by canonical production readiness.
- Re-enabling AVAX production later should happen in a dedicated follow-up lane that commits real registry addresses and reopens the audits/workflows intentionally.

### Gate 13

- Branch: `enoomian/pm-13-contract-ci-hardening`
- Base commit after merge: `77deb7e`
- Commits:
  - `b123339` `contracts: promote evm assurance entrypoints`
  - `77deb7e` `ci: wire contract and security jobs`
- Status: complete and merged into sprint base

Delivered:

- Added stable root contract-CI entrypoints and a dedicated `scripts/ci-contracts.ts` wrapper for fast validation, proof, and security targets.
- Promoted EVM contract validation into fast CI and added heavyweight `EVM Contract Proof Gate` and `EVM Contract Security Gate` jobs with artifact upload.
- Replaced the stale fuzz script with a real Foundry fuzz suite for `GoldClob`.
- Updated contract tests to match the current custom-error settlement behavior instead of stale revert-string expectations.

Targeted verification:

- `bun test packages/hyperbet-chain-registry/tests/chainRegistry.test.ts`
- `bun run ci:contracts:fast`
- `bun run ci:contracts:proof`
- workflow structure spot-checks in `.github/workflows/ci.yml` and `.github/workflows/prediction-market-gates.yml`

Known remaining risk:

- Local desktop verification of the contract lanes is still constrained by environment issues: Hardhat fast validation needs network compiler download, and local macOS Foundry proof runs can crash inside the system configuration layer.
- The intended source of truth for final Gate 13 green status remains the CI workflows themselves once pushed to remote runners.

### Gate 15

- Branch: `enoomian/pm-15-docs-hygiene-and-release-prep`
- Base commit after merge: `2e16661`
- Commits:
  - `9af1b49` `docs: clean release-facing repo documentation`
  - `2e16661` `release: add final reviewer summary and checklist`
- Status: complete and merged into sprint base

Delivered:

- Cleaned tracked release-facing docs to remove accidental local absolute-path links and normalize repo-relative references.
- Updated production deploy and runbook docs so AVAX fail-closed wording and current verification commands match the actual repo state.
- Added `docs/prediction-market-release-prep.md` as the reviewer-facing release handoff with artifact inventory, merge checklist, and residual-risk summary.
- Recorded the post-sprint Gate 12 and Gate 13 outcomes in the sprint tracker so the merged base history matches the real repo state.

Targeted verification:

- relative-link and path sanity scan across touched markdown docs
- spot-checks against:
  - `docs/hyperbet-production-deploy.md`
  - `docs/development-setup.md`
  - `docs/runbooks/README.md`
  - `packages/market-maker-bot/README.md`
  - `docs/prediction-market-release-prep.md`

Known remaining risk:

- Gate 15 closes reviewer/documentation drift, but it does not eliminate the remaining staged-live-proof follow-up represented by Gate 14.
- Any future AVAX production enablement or contract-gate changes must update the release-prep doc again so it stays aligned with the repo truth.

## Update Template

Copy this block when a new gate is merged into the sprint base.

```md
### Gate XX

- Branch: `enoomian/pm-XX-...`
- Base commit after merge: `<sha>`
- Commit: `<sha>` `<message>`
- Status: complete and merged into sprint base

Delivered:

- ...

Targeted verification:

- `...`

Known remaining risk:

- ...
```
