# Hyperbet Market Maker Bot

## Single instance

```bash
bun run start
```

Uses `.env` values in this package. You can provide one shared EVM key via `EVM_PRIVATE_KEY`, or chain-specific keys via `EVM_PRIVATE_KEY_BSC` and `EVM_PRIVATE_KEY_BASE`.
The bot now discovers active prediction markets from the keeper lifecycle endpoint and quotes against the current `GoldClob` `duelKey` / `marketKey` model on BSC, Base, and AVAX.

## Generate multiple wallet configs

```bash
bun run wallets:generate -- --count 5 --out wallets.generated.json --prefix mm
```

This writes wallet key material to `wallets.generated.json`. Keep that file private.

## Run multiple wallet instances

```bash
bun run start:multi -- --config wallets.generated.json --stagger-ms 1200
```

Optional:

```bash
bun run start:multi -- --config wallets.generated.json --dry-run
```

Use [wallets.example.json](/Users/mac/Desktop/hyperbet/packages/market-maker-bot/wallets.example.json) as the schema reference.

## Export generated Solana wallets to UI env

```bash
bun run wallets:ui-env -- --config wallets.generated.json --out ../hyperbet-solana/app/.env.local
```

This writes `VITE_HEADLESS_WALLETS=...` for the UI headless wallet adapters.

## Full adversarial suite (Solana, BSC, AVAX)

```bash
bun run simulate:adversarial
```

Scenarios covered per chain (Solana, BSC, AVAX):

- `latency_sniping`
- `spoof_pressure`
- `toxic_flow_poisoning`
- `stale_signal_arbitrage`
- `liquidation_cascade`
- `gas_auction_backrun`
- `layering_spoof_ladder`
- `quote_stuffing_burst`
- `cancel_storm_griefing`
- `sybil_wash_trading`
- `rebate_farming_ring`
- `coordinated_resolution_push`

Outputs:

- `simulations/market-maker-adversarial-report.json`
- `simulations/market-maker-adversarial-summary.md`
- Per-chain mode writes:
  - `simulations/market-maker-adversarial-report-<chain>.json`
  - `simulations/market-maker-adversarial-summary-<chain>.md`

Strict CI gate (fails on regression):

```bash
bun run simulate:adversarial:ci
```

Gate env controls:

- `MM_ADVERSARIAL_SEED` (default `20260311`)
- `MM_ADVERSARIAL_CHAIN` (`solana` | `bsc` | `avax`, optional; unset means all chains)
- `MM_ADVERSARIAL_MIN_PASSES` (default is all scenarios in scope: `36` for all chains, `12` for one chain)
- `MM_ADVERSARIAL_OUTPUT_DIR` (default `simulations`)
- `MM_ADVERSARIAL_ENFORCE_BASELINE` (`1` by default, set `0` to skip baseline regression checks)
- `MM_ADVERSARIAL_SEED_CORPUS` (optional path override for regression-seed corpus used by `--seed-corpus`)

Gate behavior now enforces ten layers:

- mitigation pass threshold
- hard invariants (`max mitigated attacker pnl`, `max exploit events`, `max inventory peak`, `max toxic fill rate`, `max adverse slippage`, `min loss reduction`)
- baseline regression deltas from `src/adversarial/baseline.snapshot.json`
- oracle/finality/dispute policy controls (max stale oracle age, confidence bounds, same-slot round-trip pressure, finalized-only settlement reads, minimum dispute liveness window)
- bounded-loss budgets (scenario-level and chain-aggregate mitigated attacker PnL caps)
- settlement state-machine checks (`open -> resolve_proposed -> dispute_window -> finalized`) including minimum dispute-window time before finalization
- sybil/collusion controls (cluster concentration ceiling, circular-flow ratio ceiling, coordinated-resolution push score cap, minimum independent participant floor)
- chaos-resilience controls (oracle outage damage cap, finality jitter damage cap, liquidity-cliff inventory stress cap)
- deterministic abuse-matrix budgets (chain aggregate and scenario-specific attacker-pnl/exploit/toxicity/slippage envelopes)
- regression seed corpus replay checks (known-bad seeds must remain mitigated across all enabled gates)

Run the seed corpus gate:

```bash
bun run simulate:adversarial:seed-corpus
```

Run chain-specific seed corpus replay:

```bash
MM_ADVERSARIAL_CHAIN=solana bun run simulate:adversarial:seed-corpus
MM_ADVERSARIAL_CHAIN=bsc bun run simulate:adversarial:seed-corpus
MM_ADVERSARIAL_CHAIN=avax bun run simulate:adversarial:seed-corpus
```

Optional fork integration harness (executes only when fork RPC env vars are set):

```bash
bun run verify:forks
```

`verify:forks` now performs two checks for each configured chain fork:

- fork RPC reachability and block/head freshness check
- deterministic fork-attack replay checks for:
  - `stale_signal_arbitrage`
  - `gas_auction_backrun`
  - `layering_spoof_ladder`
  - `quote_stuffing_burst`
  - `cancel_storm_griefing`
  - `sybil_wash_trading`

Additional fork harness env controls:

- `MM_FORK_ATTACK_SEEDS` (comma-separated seed corpus, default `20260311`)
- `MM_FORK_REQUIRE_ALL_CHAINS` (`1`/`true` to fail unless all of `BSC_FORK_RPC_URL`, `AVAX_FORK_RPC_URL`, and `SOLANA_FORK_RPC_URL` are set)

Formal safety specification:

- `docs/safety-spec.md`

Refresh baseline snapshot after intentional model changes:

```bash
bun run simulate:adversarial:baseline:update
```
