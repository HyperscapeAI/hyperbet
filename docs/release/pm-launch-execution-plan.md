# PM Launch Execution Plan

> **TL;DR:** Testnet-first, mainnet-is-ceremony model. Phase 0 proves everything on testnets with exhaustive integration, scenario, and simulation evidence — mainnet is a mechanical replay. Phase 1 hardens AMM on the frozen PM base. Phase 2 integrates AMM with the PM stack. PR #19 is excluded from the launch-critical merge train.

---

## Branch Topology

```
main
  └── develop
        └── enoomian/pm16-17-20-21 (convergence, PR #27 → develop)
              └── release/pm-gates-closeout (Phase 0)
                    ├── feature/pm-amm-hardening-v1 (Phase 1, after Phase 0 merges)
                    └── feature/pm-amm-integration-v1 (Phase 2, after Phase 1 merges)
```

**PR #19 (`feat/amm-swap-fees`)** stays open as reference. Do NOT merge into any launch-critical branch.

---

## Core Principle: Testnet-First, Mainnet-Is-Ceremony

Every deployment, governance action, integration test, and scenario simulation is executed and proven on testnets first. Mainnet deployment is a mechanical replay of the exact same runbook with production keys. Zero decisions at deploy time. Zero debugging at deploy time. If it wasn't proven on testnet, it doesn't happen on mainnet.

---

## Phase 0 — Get PM Gates True

**Branch:** `release/pm-gates-closeout`
**Parent:** `enoomian/pm16-17-20-21` (after PR #27 merges to develop)
**Goal:** Prove the entire deployment, governance, and integration pipeline on testnets. Capture exhaustive evidence. Make mainnet deployment a mechanical ceremony.

### Stage A — Testnet Proving Ground (Engineering)

Everything in Stage A is executed by engineering on testnets with test funds. No real funds. No production keys. Full control. Full debuggability. This is where all problems are found and fixed.

#### WS 0.1A — Testnet Deployment

- [ ] Materialize the Stage A deploy env from [`testnet-operations-ledger.md`](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/docs/release/testnet-operations-ledger.md) through [`scripts/export-stage-a-env.sh`](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/scripts/export-stage-a-env.sh) before running testnet deployment workflows; while the workflow remains branch-only, Stage A is kicked by push on `enoomian/pm16-17-20-21`
- [ ] Deploy `TimelockController` on BSC Testnet
- [ ] Deploy `TimelockController` on AVAX Fuji
- [ ] Deploy Safe multisig (3-of-3) on BSC Testnet
- [ ] Deploy Safe multisig (3-of-3) on AVAX Fuji
- [ ] Deploy v3 PM contracts via CREATE2 with timelock as admin on BSC Testnet
- [ ] Deploy v3 PM contracts via CREATE2 with timelock as admin on AVAX Fuji
- [ ] Verify CREATE2 addresses are identical across both EVM testnets
- [ ] Deploy Solana PM programs on devnet (`fight_oracle` + `gold_clob_market`; perps excluded from Stage A)
- [ ] Initialize Solana PM oracle + market config on devnet
- [ ] Transfer Solana devnet upgrade authority to test multisig
- [ ] Execute `freeze_oracle_config` on Solana devnet
- [ ] Execute `freeze_config` on Solana devnet
- [ ] Record all testnet tx hashes in evidence bundle

**Acceptance:** Both EVM testnets (BSC + AVAX) + Solana devnet deployed for PM scope. Base is out of scope for this Stage A lane.

#### WS 0.2A — Testnet Registry Population

- [ ] Populate chain-registry `bscTestnet` with deployed v3 addresses
- [ ] Populate chain-registry `avaxFuji` with deployed v3 addresses (all 13 fields)
- [ ] Populate Solana devnet program IDs and config addresses
- [ ] Update `deploymentVersion` to `"v3"` for all testnet entries
- [ ] Commit registry updates to `release/pm-gates-closeout`
- [ ] Verify `bun test` deployment tests pass with new values
- [ ] Verify `bun x tsc --noEmit` passes for all chain apps

**Acceptance:** Registry is complete for all testnets. No blank fields. Deployment tests pass.

#### WS 0.3A — Deployment Verification Script

Build a script that validates a deployment is correct. Run it on testnet. Run it again on mainnet later.

- [ ] Create [`packages/evm-contracts/scripts/verify-deployment.ts`](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/packages/evm-contracts/scripts/verify-deployment.ts) that takes a chain config and checks:
  - [ ] Contracts deployed at expected CREATE2 addresses (`getCode` != `0x`)
  - [ ] Oracle constructor args match: admin, reporter, finalizer, challenger, pauser, disputeWindow
  - [ ] CLOB constructor args match: admin, operator, oracle, treasury, marketMaker, pauser
  - [ ] `duelOracle`, `treasury`, `marketMaker` are immutable and match expected values
  - [ ] `grantRole(REPORTER_ROLE, ...)` reverts with `GovernanceSurfaceFrozen`
  - [ ] `setFeeConfig(...)` reverts with `GovernanceSurfaceFrozen`
  - [ ] Timelock is `DEFAULT_ADMIN_ROLE` holder
  - [ ] Fee config matches expected snapshot values
  - [ ] Dispute window == 3600 (or expected value)
- [ ] Create [`packages/hyperbet-solana/scripts/verify-deployment.ts`](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/packages/hyperbet-solana/scripts/verify-deployment.ts) that checks:
  - [ ] Program deployed at expected address
  - [ ] OracleConfig authority matches expected pubkey
  - [ ] OracleConfig `config_frozen == true`
  - [ ] OracleConfig `paused == false`
  - [ ] MarketConfig authority, treasury, market_maker match expected
  - [ ] MarketConfig `config_frozen == true`
  - [ ] Upgrade authority transferred (no longer original deployer)
- [ ] Run verification scripts against all testnet deployments
- [ ] All checks pass

**Acceptance:** Automated verification confirms deployment correctness on all testnets.

#### WS 0.4A — UI and Game Integration Testing

- [ ] Connect UI to testnet deployments (BSC Testnet, AVAX Fuji, Solana devnet)
- [ ] Verify wallet connection flow on all chains
- [ ] Verify market creation flow end-to-end
- [ ] Verify order placement flow (GTC, IOC, Post-Only) on all chains
- [ ] Verify order cancellation flow
- [ ] Verify order matching and position tracking
- [ ] Verify settlement flow: propose → finalize → claim
- [ ] Verify cancellation flow: cancel → refund
- [ ] Verify `reclaimRestingOrder` flow for locked collateral
- [ ] Verify `reproposeResult` flow after challenge
- [ ] Verify chain switching in UI
- [ ] Verify the Hyperscapes game integration:
  - [ ] Game events trigger duel creation correctly
  - [ ] Betting window opens and closes at correct times
  - [ ] Game outcome maps to correct oracle proposal
  - [ ] Settlement reflects game result
- [ ] Capture screenshots/recordings of each flow as evidence

**Acceptance:** Every user-facing flow works end-to-end on testnets against deployed v3 contracts with real game integration.

#### WS 0.5A — Scenario Testing and Simulation Evidence

- [ ] Run full CI gate suite against testnet deployments:
  - [ ] Solana Exploit Gate (all 6 scenarios)
  - [ ] EVM Exploit Gate
  - [ ] Cross-Chain E2E (Solana, BSC, AVAX)
  - [ ] Launch-chain runtime smoke remains green for BSC and AVAX
  - [ ] EVM Contract Proof Gate (anvil adversarial simulation)
- [ ] Run market-maker adversarial simulations:
  - [ ] Seed corpus (all chains)
  - [ ] Replay corpus (all chains)
  - [ ] CI gate (all chains, min 13 passes)
- [ ] Run extended fuzz testing: `forge test --fuzz-runs 2048`
- [ ] Run keeper lifecycle test:
  - [ ] Start keeper against testnet
  - [ ] Verify keeper creates markets from game events
  - [ ] Verify keeper syncs oracle state
  - [ ] Kill keeper, restart, verify recovery
  - [ ] Verify no state corruption after restart
- [ ] Run pause/unpause drill:
  - [ ] Pause oracle on testnet
  - [ ] Verify all writes blocked
  - [ ] Verify reads/claims still work
  - [ ] Unpause, verify recovery
- [ ] Run emergency cancel drill:
  - [ ] Cancel a duel with active positions
  - [ ] Verify all users can claim refunds
  - [ ] Verify resting orders can be reclaimed
- [ ] Capture all scenario results as structured evidence artifacts

**Acceptance:** Every exploit scenario, adversarial simulation, and operational drill passes on testnets. Evidence artifacts captured and indexed.

#### WS 0.6A — Evidence Bundle Assembly

- [ ] Create `docs/release/evidence/` directory with structured evidence:
  - [ ] `testnet-deployment-receipts/` — tx hashes, explorer links, verification script output for each chain
  - [ ] `testnet-governance-receipts/` — timelock deploy, multisig deploy, role assignment, freeze tx hashes
  - [ ] `testnet-integration-evidence/` — UI flow screenshots/recordings, game integration evidence
  - [ ] `testnet-scenario-evidence/` — exploit gate results, adversarial simulation reports, fuzz results
  - [ ] `testnet-operational-evidence/` — keeper lifecycle, pause drill, emergency cancel drill
- [ ] Create `docs/release/evidence/testnet-signoff-summary.md` — single document linking all evidence with pass/fail status
- [ ] Verify every item in `docs/release/external-audit-package-checklist.md` can be checked with testnet evidence

**Acceptance:** Complete evidence bundle exists. Every claim is backed by a testnet artifact.

#### WS 0.7A — Gate 22 Audit Packet Finalization

- [ ] Finalize `docs/release/gate-22-required-check-contract.md`
- [ ] Attach freeze manifest with RC commit hash
- [ ] Attach ABI freeze files (verify against deployed testnet bytecode)
- [ ] Attach staged-proof evidence bundles from WS 0.5A
- [ ] Attach governance tx hashes from WS 0.1A
- [ ] Finalize residual-risk register (all tracking items resolved or explicitly accepted)
- [ ] Finalize findings ledger
- [ ] Close `docs/release/external-audit-package-checklist.md` — all items checked
- [ ] Verify no release doc contradicts implementation, CI, or evidence
- [ ] Update launch-freeze tracker: Gate 6 green, Gate 22 green

**Acceptance:** Gate 22 closed. Audit packet complete. No doc contradicts code or evidence.

#### WS 0.8A — Final Testnet Signoff

- [ ] All CI checks green on `release/pm-gates-closeout`
- [ ] Deployment verification scripts pass on all testnets
- [ ] Evidence bundle complete and reviewed
- [ ] Audit packet complete and reviewed
- [ ] Tag testnet RC: `v3.0.0-rc.1-testnet`
- [ ] Explicit signoff: "Stage A complete. Testnet is proven. Ready for mainnet ceremony."

**Acceptance:** Everything that will happen on mainnet has been proven on testnet. No open questions.

---

### Stage B — Mainnet Deployment Ceremony (Admin Ops)

Stage B is a ceremony, not an engineering session. Every action here is a mechanical replay of what was proven in Stage A. The admin follows the runbook exactly. No improvisation. No debugging. If something fails, stop — do not proceed until the failure is understood and re-proven on testnet.

**Prerequisites:** Stage A signoff complete. Testnet RC tagged. Evidence bundle reviewed.

**Who:** Admin with production keys. Engineering on standby for observation only.

**Duration:** ~2 hours for all chains.

#### Step B.1 — Pre-Ceremony Verification

- [ ] Verify the branch being deployed matches the testnet RC tag exactly
- [ ] Verify production deployer wallet has sufficient gas on BSC, AVAX
- [ ] Verify production Solana deployer has sufficient SOL
- [ ] Verify Safe multisig signers have confirmed availability
- [ ] Verify Squads multisig signers have confirmed availability
- [ ] Communication: notify stakeholders that mainnet deployment is starting

#### Step B.2 — EVM Mainnet Deployment (Replay of WS 0.1A)

- [ ] Deploy `TimelockController` on BSC — record tx hash
- [ ] Deploy `TimelockController` on AVAX — record tx hash
- [ ] Deploy Safe multisig (3-of-3) on BSC — record address
- [ ] Deploy Safe multisig (3-of-3) on AVAX — record address
- [ ] Run `deploy-create2.ts --network bsc` with timelock as admin — record receipt
- [ ] Run `deploy-create2.ts --network avax` with timelock as admin — record receipt
- [ ] Verify CREATE2 addresses match testnet predictions (must be identical)
- [ ] If addresses don't match: STOP. Do not proceed. Investigate on testnet first.

#### Step B.3 — Solana Mainnet Deployment (Replay of WS 0.1A)

- [ ] Deploy fight_oracle program on mainnet — record program ID
- [ ] Deploy gold_clob_market program on mainnet — record program ID
- [ ] Verify program IDs match expected values
- [ ] Initialize oracle config with production governance keys
- [ ] Initialize market config with production governance keys
- [ ] Transfer upgrade authority to Squads multisig — record tx
- [ ] Execute `freeze_oracle_config` — record tx
- [ ] Execute `freeze_config` — record tx

#### Step B.4 — Post-Deployment Verification (Replay of WS 0.3A)

- [ ] Run `verify-deployment.ts` against BSC mainnet
- [ ] Run `verify-deployment.ts` against AVAX mainnet
- [ ] Run `verify-solana-deployment.ts` against Solana mainnet
- [ ] All verification checks pass
- [ ] If any check fails: STOP. Do not proceed. Investigate.

#### Step B.5 — Registry Population

- [ ] Populate chain-registry mainnet entries with deployed addresses
- [ ] Populate governance addresses (timelock, multisig, emergency council)
- [ ] Update `deploymentVersion` to `"v3"` for all mainnet entries
- [ ] Commit registry updates
- [ ] Run `bun test` deployment tests — all pass

#### Step B.6 — Post-Ceremony Verification

- [ ] Run smoke test against mainnet deployments (read-only — no real funds yet)
- [ ] Verify block explorer shows correct constructor args on all chains
- [ ] Verify governance roles on all chains via block explorer
- [ ] Verify freeze state on Solana via explorer

#### Step B.7 — Ceremony Completion

- [ ] Tag mainnet RC: `v3.0.0`
- [ ] Record all mainnet tx hashes in `docs/release/evidence/mainnet-deployment-receipts/`
- [ ] Update launch-freeze tracker with mainnet evidence
- [ ] Communication: notify stakeholders that mainnet deployment is complete
- [ ] Explicit signoff: "Mainnet deployment complete. Contracts verified. Ready for canary operations."

**Acceptance:** Mainnet matches testnet exactly. Verification scripts pass. All evidence recorded. Admin's job is done.

---

## Phase 1 — PM-AMM Hardening

**Branch:** `feature/pm-amm-hardening-v1`
**Parent:** `release/pm-gates-closeout` (after Phase 0 merges)
**Goal:** Bring AMM code to PM-core quality bar. Do NOT reopen PM16/17/20/21 semantics.

### WS 1.1 — Branch Surgery

- [ ] Start from merged PM-gates base (NOT from PR #19)
- [ ] Cherry-pick only AMM-specific commits from PR #19:
  - [ ] `packages/evm-contracts/contracts/lvr_amm/LvrMarket.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/Router.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/lib/*.sol`
  - [ ] `packages/hyperbet-solana/anchor/programs/lvr_amm/`
- [ ] Exclude unrelated dashboard/frontend/shared-runtime/keeper churn
- [ ] Verify PM-core contracts are unchanged after cherry-pick

**Acceptance:** AMM diff is AMM-focused and reviewable. No accidental reintroduction of superseded work.

### WS 1.2 — EVM AMM Remediation

- [ ] Add Router market allowlist; enforce in all callbacks
- [ ] Validate callback asset addresses against market metadata
- [ ] Put `setFeeConfig` behind `onlyRole(DEFAULT_ADMIN_ROLE)` with fee caps
- [ ] Remove or redesign standalone AMM dispute/settlement path — cannot bypass PM-core finality
- [ ] Fix dynamic price read/execution parity (time-decayed liquidity in reads, not just swaps)
- [ ] Replace `f64` floating-point math if present
- [ ] Add `nonReentrant` to Router
- [ ] Add slippage protection (`minAmountOut`) to swap functions
- [ ] Add oracle staleness checks
- [ ] Add exploit regression tests:
  - [ ] Malicious callback caller
  - [ ] Unauthorized config change
  - [ ] Dispute bypass
  - [ ] Price/reporting divergence

**Acceptance:** Non-market callers always revert. Unauthorized config always reverts. AMM settlement cannot bypass PM-core truth. Price views match execution.

### WS 1.3 — Solana AMM Remediation

- [ ] Replace per-market caller-supplied `fee_bps` and `treasury` with protocol-owned Config PDA
- [ ] Remove unchecked treasury ATA fee routing; enforce canonical treasury ATA constraints
- [ ] Replace `admin_state.admin` settlement with PM-core resolution model or thin oracle adapter
- [ ] Add freeze/pause parity aligned with PM-core (`freeze_config`, `set_paused`)
- [ ] Replace all `f64` floating-point math with fixed-point integer arithmetic
- [ ] Add negative tests:
  - [ ] Wrong ATA
  - [ ] Wrong owner
  - [ ] Wrong mint
  - [ ] Unauthorized config
  - [ ] Unauthorized settlement

**Acceptance:** Fee routing cannot be redirected. Unauthorized settlement always fails. AMM config matches PM-core posture.

### WS 1.4 — AMM Assurance Package

- [ ] Build independent AMM reference model
- [ ] Add invariant suites:
  - [ ] Accounting conservation
  - [ ] Fee conservation
  - [ ] Reserve non-negativity
  - [ ] Complement pricing
  - [ ] Terminal redemption
  - [ ] Read/execution parity
- [ ] Add edge-case and fuzz coverage:
  - [ ] Near expiry
  - [ ] Low liquidity
  - [ ] Large orders
  - [ ] Fee edge cases
- [ ] Document allowed parameter ranges and launch-eligible market classes

**Acceptance:** AMM passes invariants on every commit. Value-moving paths have property tests. Parameterization memo exists.

---

## Phase 2 — PM-AMM Integration

**Branch:** `feature/pm-amm-integration-v1`
**Parent:** `feature/pm-amm-hardening-v1` (after Phase 1 merges)
**Goal:** Integrate hardened AMM with the existing prediction-market stack.

### WS 2.1 — Shared Resolution and Lifecycle Integration

- [ ] AMM markets resolve off same truth model as PM-core (reporter/challenger/finalizer)
- [ ] Require explicit market-level resolution metadata (source, end date, edge cases, dispute flow)
- [ ] AMM terminal states map to claim/refund semantics
- [ ] No standalone AMM resolution path remains outside PM-core truth model

### WS 2.2 — Market-Type Integration Strategy

- [ ] Launch PM-AMM as separate market type (not hidden fallback inside GoldClob)
- [ ] Keep CLOB and AMM routing explicit in app, indexer, analytics
- [ ] Add feature flags for per-market AMM enable/disable
- [ ] GoldClob PM gates stay true and unchanged

### WS 2.3 — Offchain Orderflow and Runtime Discipline

- [ ] Keep PM-AMM bot/keeper components non-trust-bearing
- [ ] Add order/quote TTLs, replay protection, restart behavior
- [ ] Document what is convenience infra vs safety-critical
- [ ] Replay/restart tests pass

### WS 2.4 — Tri-Chain Deployment Integration

- [ ] Extend CREATE2 and registry discipline to AMM EVM deployments on BSC/AVAX
- [ ] Add Solana deployment manifests and authority records for AMM program
- [ ] Add chain-registry entries for AMM
- [ ] Add explorer verification and staged-proof checks for AMM

### WS 2.5 — External Audit and Launch Controls

- [ ] Audit PM-core first (separate engagement)
- [ ] Audit PM-AMM second (separate scoped engagement)
- [ ] Add monitoring and alerting
- [ ] Add bug bounty coverage
- [ ] Add canary liquidity limits before AMM mainnet scale
- [ ] Document kill-switch procedures

**Acceptance:** Zero open critical/high on PM-AMM. PM-core unchanged except auditor-reviewed fixes. Canary rollout limits live.

---

## Forbidden Actions

- Do NOT merge PR #19 into any launch-critical branch
- Do NOT reopen PM16/17/20/21 contract semantics for AMM compatibility
- Do NOT widen the trust-bearing surface by merging keeper/dashboard churn into PM-core
- Do NOT deploy AMM contracts without matching CREATE2/registry/governance discipline
- Do NOT deploy to mainnet anything that wasn't proven on testnet first
- Do NOT debug on mainnet — if something fails during ceremony, stop and return to testnet
