# Cross-Chain Parity Matrix (EVM vs SVM)

> **TL;DR:** Full parity on state machine (7 states), matching (50-iteration bound, cancel-taker STP), settlement (snapshotted fees, terminal-only claims), and validation (price 1-999, amount % 1000). 14 divergences catalogued — 12 intentional/documented, 2 were bugs now fixed (Solana trade fee source, missing betting-window guard). Known intentional differences: dispute window mutability (EVM constructor-immutable vs SVM admin-updatable until frozen), continuation model, and cancel-authority *shape* (EVM `PAUSER_ROLE` vs SVM oracle `authority` on `cancel_duel`). **Pause/freeze:** both stacks support governance freeze of privileged mutators, explicit post-deploy **freeze** instructions on SVM (`freeze_oracle_config` / `freeze_config`), and pauser-gated **operational pause** (EVM: `setOraclePaused`, `setMarketCreationPaused`, `setOrderPlacementPaused`; SVM: `set_oracle_paused`, `set_market_paused`). Re-initialization cannot rewrite frozen oracle/market config on SVM (P1).

## Runtime Surfaces

- EVM contracts:
  - `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
  - `packages/evm-contracts/contracts/GoldClob.sol`
- SVM programs:
  - `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`

## Behavior Mapping

| Behavior | EVM surface | SVM surface | Notes |
|---|---|---|---|
| Initialize oracle authority/config | `DuelOutcomeOracle.constructor(admin, reporter, …)` | `fight_oracle::initialize_oracle(reporter, finalizer, challenger, dispute_window_secs)` | EVM uses AccessControl bootstrap; SVM uses upgrade-authority-only PDA init (no bootstrap shortcut); all four params required, `dispute_window_secs >= 60`. |
| Rotate reporter | `setReporter(reporter, enabled)` | `update_oracle_config(authority, reporter)` | PM20 froze EVM mutator calls (`GovernanceSurfaceFrozen`); SVM updates remain via config authority checks. |
| Upsert duel lifecycle | `upsertDuel(...)` | `upsert_duel(...)` | Monotonic lifecycle progression enforced on both. |
| Cancel duel | `cancelDuel(duelKey, metadataUri)` | `cancel_duel(duel_key, metadata_uri)` | Finalization guard on both. |
| Report duel result | `proposeResult(...)` | `propose_result(...)` | Requires winner `A/B`; end timestamp validity checks. |
| Create market | `createMarketForDuel(duelKey, marketKind)` | `initialize_market(duel_key, market_kind)` | Allowed when duel is marketable (`BETTING_OPEN/LOCKED`). |
| Sync market lifecycle from oracle | `syncMarketFromOracle(duelKey, marketKind)` | `sync_market_from_duel()` | Winner propagation on resolve; winner reset on cancel. |
| Place order | `placeOrder(duelKey, marketKind, side, price, amount)` | `place_order(order_id, side, price, amount)` | Both validate side, price, status OPEN, and betting window before accepting matches. |
| Order flags (IOC / Post-Only / GTC) | `placeOrder` enforces IOC/post-only semantics and bounded GTC continuation | `place_order` enforces IOC/post-only semantics and bounded GTC continuation | Both enforce rejection-correctness and explicit continuation behavior. |
| Bounded matching / continuation | Matching loop bound enforced via bounded iterations in `GoldClob` | Matching loop bound enforced via bounded iterations in `gold_clob_market` | Both require explicit continuation when matching bounds are reached in GTC flows. |
| Self-trade policy | Matching path emits deterministic self-trade policy handling | Matching path emits deterministic self-trade policy handling | Both preserve bookkeeping and policy signals for self-cross candidates. |
| PM20 governance freeze | `setReporter/setFinalizer/setChallenger` and `setOracle/setTreasury/setMarketMaker/setFeeConfig` | `initialize_oracle` + `update_oracle_config` / `initialize_config` + `update_config` | EVM privileged setters now revert (`GovernanceSurfaceFrozen`) after deploy; SVM config authority is upgrade-authority derived, then immutable during updates. |
| Post-deploy config freeze (SVM ops) | N/A (EVM mutators frozen via PM20 flag at deploy) | `freeze_oracle_config` / `freeze_config` | SVM-only explicit freeze bits block further config updates; aligns operational intent with EVM governance surface lock. |
| Operational pause (oracle / market ops) | `setOraclePaused` / `setMarketCreationPaused` / `setOrderPlacementPaused` (`PAUSER_ROLE`) | `set_oracle_paused` / `set_market_paused` | Pauser-gated on EVM; oracle/market config `authority` on SVM. Stops new risky transitions without freezing reads. |
| Re-init after freeze | Deploy-time only | `initialize_oracle` / `initialize_config` must not rewrite fields when `config_frozen` (P1) | Blocks upgrade authority from resetting reporter/fees after freeze. |
| Cancel order | `cancelOrder(duelKey, marketKind, orderId)` | `cancel_order(order_id, side, price)` | Maker-only cancellation of active remainder; cancellation is now restricted to `OPEN` markets on both chains. |
| Claim settlement | `claim(duelKey, marketKind)` | `claim()` | Resolved = winner payout less fee; Cancelled = refund locked stake; nonterminal claims must revert. |
| Update fee config | `setFeeConfig(...)` | `update_config(...trade/winnings fee bps...)` | Both enforce BPS bounds. |
| Update treasury | `setTreasury(address)` | `update_config(...treasury...)` | SVM packed into config update. |
| Update market maker fee account | `setMarketMaker(address)` | `update_config(...market_maker...)` | SVM packed into config update. |
| Update oracle pointer | `setOracle(address)` | N/A (oracle account wired by account constraints) | EVM setter is PM20-frozen; SVM uses account graph checks. |
| Market status mapping | `_mapDuelStatus(...)` | `map_duel_status(...)` | SVM maps `Scheduled -> Locked`; EVM duel market creation avoids scheduled markets. |
| Quote/lock arithmetic | `_quoteCost(...)` | `quote_cost(...)` | Same 1000-tick economics. |

## Privileged Function Map

| Chain | Surface | Privilege gate |
|---|---|---|
| EVM | `DuelOutcomeOracle.setReporter` / `setFinalizer` / `setChallenger` | `DEFAULT_ADMIN_ROLE` (PM20 frozen; setter calls revert with `GovernanceSurfaceFrozen`) |
| EVM | `DuelOutcomeOracle.upsertDuel` | `REPORTER_ROLE` |
| EVM | `DuelOutcomeOracle.cancelDuel` | `PAUSER_ROLE` |
| EVM | `DuelOutcomeOracle.setOraclePaused` | `PAUSER_ROLE` |
| EVM | `DuelOutcomeOracle.proposeResult` | `REPORTER_ROLE` |
| EVM | `GoldClob.setOracle` / `GoldClob.setTreasury` / `GoldClob.setMarketMaker` / `GoldClob.setFeeConfig` | `DEFAULT_ADMIN_ROLE` (PM20 frozen; setter calls revert with `GovernanceSurfaceFrozen`) |
| EVM | `GoldClob.setMarketCreationPaused` / `GoldClob.setOrderPlacementPaused` | `PAUSER_ROLE` |
| EVM | `GoldClob.createMarketForDuel` | `MARKET_OPERATOR_ROLE` |
| SVM | `fight_oracle::initialize_oracle` | upgrade authority only |
| SVM | `fight_oracle::freeze_oracle_config` | oracle config `authority` signer |
| SVM | `fight_oracle::set_oracle_paused` | oracle config `authority` signer |
| SVM | `fight_oracle::update_oracle_config` | oracle config `authority` signer; authority itself is immutable for PM20 |
| SVM | `fight_oracle::upsert_duel` | oracle config `reporter` signer |
| SVM | `fight_oracle::cancel_duel` | oracle config `authority` signer |
| SVM | `fight_oracle::propose_result` | oracle config `reporter` signer |
| SVM | `gold_clob_market::initialize_config` | upgrade authority only |
| SVM | `gold_clob_market::freeze_config` | market config `authority` signer |
| SVM | `gold_clob_market::set_market_paused` | market config `authority` signer |
| SVM | `gold_clob_market::update_config` | market config `authority` signer; authority itself is immutable for PM20 |
| SVM | `gold_clob_market::initialize_market` | config `authority` or `market_operator` signer |

## PM20 Governance Controls Evidence

- EVM governance mutator freeze surfaces:
  - `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
  - `packages/evm-contracts/contracts/GoldClob.sol`
- SVM authority freeze and bootstrap removal:
  - `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
- Policy documentation:
  - `docs/runbooks/prediction-market-governance-and-emergency-controls.md`
  - `docs/release/contract-privileged-surface-inventory.md`

## Trace Coverage

The integration branch treats the commands below as the concrete parity evidence
set for lifecycle traces. EVM protocol traces are shared by BSC and AVAX
because both chains consume the same `DuelOutcomeOracle` and `GoldClob`
contracts.

| Trace | Solana evidence | BSC evidence | AVAX evidence |
|---|---|---|---|
| Place order | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| Partial fill | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Cancel active order | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| Lock / non-quotable transition | `bun run ci:gate:solana` | `bun run ci:gate:evm` | `bun run ci:gate:evm` |
| Propose result | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Challenge result | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Finalize result | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Cancel duel / market cancellation | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Claim resolved winner | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| Refund cancelled market | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| PM17 order semantics | `bun run --cwd packages/hyperbet-solana/anchor test -- tests/gold_clob_market.test.ts tests/gold_clob_security.ts` | `forge test --match-path 'test/GoldClobSettlement.t.sol'`; `forge test --match-path 'test/fuzz/GoldClobFuzz.t.sol'`; `forge test --match-path 'test/PrecisionDoS.t.sol'` | `forge test --match-path 'test/GoldClobSettlement.t.sol'`; `forge test --match-path 'test/fuzz/GoldClobFuzz.t.sol'`; `forge test --match-path 'test/PrecisionDoS.t.sol'` |
| PM17 claim parity | `bun run --cwd packages/hyperbet-solana/anchor test -- tests/hyperbet.ts` | `forge test --match-path 'test/GoldClobSettlement.t.sol'` | `forge test --match-path 'test/GoldClobSettlement.t.sol'` |

## PM21 Guardrail Evidence

- EVM guardrail regression suite: `packages/evm-contracts/test/ExploitSuite.t.sol`
- SVM guardrail regression suite: `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`
- Settlement parity references:
  - `packages/evm-contracts/test/GoldClobSettlement.t.sol`
  - `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`

Both sides enforce the same lifecycle restrictions:
- Non-open markets (LOCKED/PROPOSED/CHALLENGED/RESOLVED/CANCELLED) reject order mutations with `MarketNotOpen` equivalents.
- Only terminal states permit settlement claims; settled behavior is exact and symmetric (`resolved` payout, `cancelled` refund).

## API Contract Checks

These checks prove that the normalized lifecycle API remains stable across UI,
MM, and keeper consumers:

- `bun test` in `packages/hyperbet-chain-registry`
- `bun test --preload ./tests/setup.ts` in `packages/hyperbet-ui`
- `bunx vitest run` in `packages/market-maker-bot`
- `packages/*/app/tests/e2e/app-tabs-and-apis.spec.ts` via `scripts/ci-gate-e2e.ts`
