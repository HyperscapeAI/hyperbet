# PM-AMM Hardening Plan

> Formalized from audit findings against PR #19 (`feat/amm-swap-fees`) and the convergence branch audit. This plan governs `feature/pm-amm-hardening-v1` (Phase 1) and `feature/pm-amm-integration-v1` (Phase 2).

---

## Branch Topology

```
enoomian/pm16-17-20-21 (frozen PM-core base)
  └── feature/pm-amm-hardening-v1 (Phase 1 — this plan)
        └── feature/pm-amm-integration-v1 (Phase 2 — after Phase 1 merges)
```

**Source material:** Cherry-pick AMM-specific code from PR #19. Do NOT merge PR #19 wholesale.

---

## Audit Findings Summary (from PR #19 audit)

### Critical (3)

| ID | Finding | Location |
|----|---------|----------|
| C-1 | Missing `isDynamic` variable — EVM LvrMarket will not compile | `LvrMarket.sol` |
| C-2 | `setFeeConfig()` has no access control — anyone can steal fees | `Router.sol` |
| C-3 | Solana AMM uses `f64` floating point — consensus-breaking (different validators produce different results) | `lvr_amm/src/math.rs` |

### High (4)

| ID | Finding | Location |
|----|---------|----------|
| H-1 | No slippage protection on swaps — no `minAmountOut` parameter | `Router.sol`, `lvr_amm/src/instructions/buy.rs` |
| H-2 | Gaussian approximation in `SwapMath` may diverge at distribution tails | `SwapMath.sol` |
| H-3 | No reentrancy guard on Router | `Router.sol` |
| H-4 | Missing oracle staleness checks — stale price feeds accepted without validation | `LvrMarket.sol` |

### Medium (4)

| ID | Finding | Location |
|----|---------|----------|
| M-1 | LP share rounding can be exploited at low liquidity | `LvrMarket.sol` |
| M-2 | No minimum liquidity requirement — first depositor manipulation | `LvrMarket.sol` |
| M-3 | Fee-on-transfer token incompatibility | `Router.sol` |
| M-4 | Missing event emissions for key state changes | Both chains |

### Governance/Architecture Conflicts with PM-Core (from convergence audit)

| ID | Conflict | Detail |
|----|----------|--------|
| G-1 | EVM Router `setFeeConfig` is public — PM-core freezes all setter surfaces | Violates PM20 governance freeze |
| G-2 | Solana AMM `create_bet_account` accepts `fee_bps` and `treasury` as caller inputs | PM-core uses protocol-owned Config PDA |
| G-3 | EVM LvrMarket has its own dispute/settlement state machine (OPEN→PENDING→DISPUTED→RESOLVED) | PM-core uses reporter/challenger/finalizer model |
| G-4 | Solana AMM settles via `admin_state.admin` signer | PM-core uses oracle-driven resolution |
| G-5 | EVM LvrMarket hardcodes 5-minute dispute window | PM-core enforces minimum 60-second dispute window via oracle |
| G-6 | No pause mechanism on AMM | PM-core has pause on both chains |
| G-7 | Price read/execution divergence — `getPriceYes` uses static liquidity, `_swap` uses time-decayed | Displayed price diverges from execution price near expiry |

### PR #18 Findings (carried forward — affects shared programs)

| ID | Finding | Severity | Location |
|----|---------|----------|----------|
| P18-1 | Double-division precision loss in perps `execution_price` | Medium | `gold_perps_market/src/lib.rs` |
| P18-2 | `LiquidatePosition` missing PDA seeds on position account (defense-in-depth) | Medium | `gold_perps_market/src/lib.rs` |
| P18-3 | Bootstrap authority fallback may conflict with PM-core freeze | Medium | `gold_perps_market/src/lib.rs` |

---

## Phase 1 — Hardening (`feature/pm-amm-hardening-v1`)

### WS 1.1 — Branch Surgery

- [ ] Start from merged PM-gates base (`enoomian/pm16-17-20-21`)
- [ ] Cherry-pick only AMM-specific files from PR #19:
  - [ ] `packages/evm-contracts/contracts/lvr_amm/LvrMarket.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/Router.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/lib/SwapMath.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/lib/Math.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/lib/Gaussian.sol`
  - [ ] `packages/evm-contracts/test/LvrMarket.t.sol`
  - [ ] `packages/hyperbet-solana/anchor/programs/lvr_amm/` (entire directory)
- [ ] Exclude: dashboard, frontend, shared runtime, keeper, bot strategy, sprint-base history
- [ ] Verify PM-core contracts (`DuelOutcomeOracle.sol`, `GoldClob.sol`, `fight_oracle`, `gold_clob_market`) are byte-identical to convergence base after cherry-pick
- [ ] Verify `forge build` and `anchor build` succeed

**Gate:** AMM diff is AMM-focused. PM-core contracts unchanged.

### WS 1.2 — EVM AMM Critical/High Fixes

#### C-1: Fix `isDynamic` compilation error
- [ ] Declare `isDynamic` as state variable or local in `LvrMarket.sol`
- [ ] Verify `forge build` succeeds

#### C-2: Lock down `setFeeConfig`
- [ ] Add `onlyRole(DEFAULT_ADMIN_ROLE)` modifier to `Router.setFeeConfig()`
- [ ] Add fee cap: `require(feeBps <= 1000)` (max 10%)
- [ ] Add test: unauthorized caller reverts
- [ ] Add test: fee above cap reverts

#### H-1: Add slippage protection
- [ ] Add `minAmountOut` parameter to `Router.buy()` and `Router.sell()`
- [ ] Add `require(amountOut >= minAmountOut, "SlippageExceeded")`
- [ ] Add test: swap reverts when output below minimum

#### H-2: Validate Gaussian bounds
- [ ] Add input validation to `SwapMath` Gaussian functions
- [ ] Add revert for extreme z-score inputs (|z| > 8)
- [ ] Add test: extreme inputs revert cleanly instead of returning garbage

#### H-3: Add reentrancy guard
- [ ] Import OpenZeppelin `ReentrancyGuard` on Router
- [ ] Add `nonReentrant` to `buy()`, `sell()`, `addLiquidity()`, `removeLiquidity()`
- [ ] Add test: reentrant callback reverts

#### H-4: Oracle staleness check
- [ ] Add `maxStaleness` parameter to market creation or as global config
- [ ] Check `block.timestamp - oracle.updatedAt <= maxStaleness` in swap path
- [ ] Add test: stale oracle reverts

**Gate:** All 3 critical and 4 high EVM findings resolved. `forge test` passes.

### WS 1.3 — EVM AMM Medium Fixes

#### M-1: LP share rounding
- [ ] Add minimum initial deposit requirement (e.g., 1000 wei)
- [ ] Add test: dust deposit manipulation reverts

#### M-2: Minimum liquidity
- [ ] Enforce minimum liquidity on first deposit (burn MINIMUM_LIQUIDITY shares to zero address, same as Uniswap V2 pattern)
- [ ] Add test: first deposit below minimum reverts

#### M-3: Fee-on-transfer
- [ ] Document that fee-on-transfer tokens are not supported
- [ ] OR add balance-before/after checks in Router

#### M-4: Events
- [ ] Add events for: `FeeConfigUpdated`, `MarketCreated`, `LiquidityAdded`, `LiquidityRemoved`, `Swap`, `MarketResolved`
- [ ] Verify all state-changing functions emit events

**Gate:** All medium EVM findings resolved.

### WS 1.4 — Solana AMM Critical/High Fixes

#### C-3: Replace f64 with fixed-point integer math
- [ ] Rewrite `lvr_amm/src/math.rs` using integer arithmetic with defined precision (e.g., 1e9 fixed point)
- [ ] Replace all `f64` operations: `exp`, `ln`, `sqrt`, `pow`, `erf`
- [ ] Use lookup tables or polynomial approximations for transcendental functions
- [ ] Add comprehensive precision tests comparing fixed-point output to known reference values
- [ ] Verify deterministic output across different validator hardware

#### G-2: Protocol-owned config instead of per-market caller inputs
- [ ] Create `AmmConfig` PDA (singleton, authority-gated) storing:
  - `treasury: Pubkey`
  - `market_maker: Pubkey`
  - `fee_bps: u16`
  - `config_frozen: bool`
  - `paused: bool`
- [ ] Modify `create_bet_account` to read fee/treasury from `AmmConfig` instead of caller inputs
- [ ] Add `freeze_amm_config` instruction
- [ ] Add `set_amm_paused` instruction

#### G-4: Oracle-driven settlement
- [ ] Replace `admin_state.admin` settlement with oracle adapter pattern:
  - AMM reads resolution from `fight_oracle` `DuelState` (same as CLOB)
  - OR: AMM accepts resolution from a designated `resolver` role stored in `AmmConfig`
- [ ] Remove direct admin settlement path
- [ ] Add test: unauthorized settlement reverts
- [ ] Add test: settlement matches oracle truth

#### Solana fee routing fix
- [ ] Enforce treasury ATA ownership and mint checks in sell instruction
- [ ] Add `has_one = treasury` constraint against `AmmConfig`
- [ ] Add test: wrong treasury ATA reverts
- [ ] Add test: wrong mint reverts

**Gate:** All Solana critical findings resolved. `anchor test` passes.

### WS 1.5 — Governance Alignment with PM-Core

#### G-1: Freeze setter surfaces
- [ ] Override `grantRole`/`revokeRole` on Router (same pattern as PM-core)
- [ ] OR: freeze `setFeeConfig` with `GovernanceSurfaceFrozen` after bootstrap

#### G-5: Dispute window alignment
- [ ] Remove hardcoded 5-minute dispute window from LvrMarket
- [ ] Use oracle's dispute window (read from `DuelOutcomeOracle`)
- [ ] OR: enforce minimum 60-second window matching PM-core

#### G-6: Pause mechanism
- [ ] EVM: Add `setAmmPaused(bool)` gated on PAUSER_ROLE
- [ ] Add pause guards on `buy()`, `sell()`, `addLiquidity()`, market creation
- [ ] Ensure `removeLiquidity()` and claim/refund paths remain open during pause
- [ ] Solana: Use `paused` flag in `AmmConfig` (from WS 1.4)

#### G-7: Price read/execution parity
- [ ] Fix `getPriceYes` and `getMarketDetails` to use time-decayed liquidity (same as `_swap`)
- [ ] Add test: read price == execution price at same block timestamp

**Gate:** AMM governance posture matches PM-core. Freeze, pause, dispute window, resolution model all aligned.

### WS 1.6 — AMM Test Suite

#### Exploit regression tests
- [ ] Malicious callback caller (non-market address calls Router callbacks)
- [ ] Unauthorized fee config change
- [ ] Dispute bypass (settle without waiting for dispute window)
- [ ] Reentrancy via receive() callback
- [ ] Stale oracle price acceptance
- [ ] Per-market fee/treasury injection (Solana)
- [ ] Wrong ATA / wrong owner / wrong mint (Solana)

#### Invariant tests
- [ ] Accounting conservation: `sum(all_positions) + fees == total_deposited`
- [ ] Fee conservation: `fees_collected == expected_from_volume`
- [ ] Reserve non-negativity: `reserve >= 0` after every operation
- [ ] Complement pricing: `price_yes + price_no == 1` (within rounding tolerance)
- [ ] Terminal redemption: winning shares redeem at 1.0, losing at 0.0
- [ ] Read/execution parity: `getPriceYes() == execution_price` at same timestamp

#### Fuzz tests
- [ ] Fuzz buy/sell with random amounts, prices, timestamps
- [ ] Fuzz add/remove liquidity at various pool states
- [ ] Fuzz near-expiry behavior
- [ ] Fuzz low-liquidity edge cases

**Gate:** All exploit regressions pass. All invariants hold under fuzz. Test coverage is comprehensive.

---

## Phase 2 — Integration (`feature/pm-amm-integration-v1`)

Phase 2 starts only after Phase 1 merges. It integrates the hardened AMM with the existing PM stack.

### WS 2.1 — Shared Resolution and Lifecycle

- [ ] AMM markets resolve off `DuelOutcomeOracle` / `fight_oracle` (same truth source as CLOB)
- [ ] Require explicit market-level resolution metadata before trading opens
- [ ] AMM terminal states (RESOLVED, CANCELLED) map cleanly to claim/refund semantics
- [ ] No standalone AMM resolution path remains

**Gate:** Every AMM market resolves through PM-core oracle truth.

### WS 2.2 — Market-Type Integration

- [ ] Launch PM-AMM as separate market type (not hidden inside GoldClob)
- [ ] Keep CLOB and AMM routing explicit in UI, indexer, analytics
- [ ] Add feature flags for per-market AMM enable/disable
- [ ] GoldClob PM gates stay true and unchanged after integration

**Gate:** CLOB unaffected. AMM independently toggleable.

### WS 2.3 — Offchain Runtime Discipline

- [ ] Keep AMM bot/keeper components non-trust-bearing (per PM-core threat model)
- [ ] Add order/quote TTLs and replay protection
- [ ] Document convenience vs safety-critical components
- [ ] Add restart/recovery tests

**Gate:** No settlement dependency on offchain actors.

### WS 2.4 — Deployment Integration

- [ ] Extend CREATE2 and registry discipline to AMM EVM deployments on BSC/AVAX
- [ ] Add Solana deployment manifests and authority records for `lvr_amm` program
- [ ] Add chain-registry entries for AMM
- [ ] Add deployment verification script coverage for AMM contracts
- [ ] Add staged-proof checks for AMM

**Gate:** AMM deployment follows identical manifest/verification discipline as PM-core.

### WS 2.5 — Audit and Launch Controls

- [ ] Audit PM-core first (separate engagement — already in progress via Phase 0)
- [ ] Audit PM-AMM second (separate scoped engagement after Phase 1)
- [ ] Add monitoring and alerting for AMM-specific metrics
- [ ] Add bug bounty coverage for AMM
- [ ] Set canary liquidity limits before mainnet scale
- [ ] Document AMM kill-switch procedures (aligned with PM-core emergency runbook)

**Gate:** Zero open critical/high. Canary limits live. Kill-switch documented.

---

## Forbidden Actions

- Do NOT merge PR #19 wholesale into either branch
- Do NOT modify PM-core contracts (`DuelOutcomeOracle`, `GoldClob`, `fight_oracle`, `gold_clob_market`) in either Phase
- Do NOT introduce cross-chain messaging or relay dependencies
- Do NOT make keepers trust-bearing for AMM settlement
- Do NOT deploy AMM without matching governance freeze/pause posture
- Do NOT skip the Solana f64→fixed-point rewrite — this is consensus-breaking and non-negotiable

---

## Acceptance Criteria (Phase 1 Complete)

- [ ] All 3 critical findings resolved and tested
- [ ] All 4 high findings resolved and tested
- [ ] All 4 medium findings resolved or explicitly documented as accepted
- [ ] All 7 governance conflicts resolved — AMM matches PM-core posture
- [ ] Exploit regression suite passes
- [ ] Invariant suite passes under fuzz
- [ ] PM-core contracts byte-identical to convergence base
- [ ] `forge test` all pass
- [ ] `anchor test` all pass (pending Solana AMM test infrastructure)
- [ ] No `f64` in any Solana program

## Acceptance Criteria (Phase 2 Complete)

- [ ] AMM resolves through PM-core oracle on both chains
- [ ] AMM deployable via CREATE2 with registry parity
- [ ] AMM independently toggleable without CLOB impact
- [ ] No trust-bearing offchain dependencies
- [ ] External audit scoped and engaged
- [ ] Canary limits and kill-switch live
