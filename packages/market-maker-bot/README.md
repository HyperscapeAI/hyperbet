# Hyperbet Market Maker Bot

Real quote-lifecycle bot for BSC, Base, and AVAX. Solana prediction markets now run on the in-protocol `lvr_amm` PM AMM, so this package does not run an external Solana quote loop against that program.

## Single instance

```bash
bun run start
```

Uses `.env` values in this package. You can provide one shared EVM key via `EVM_PRIVATE_KEY`, or chain-specific keys via `EVM_PRIVATE_KEY_BSC`, `EVM_PRIVATE_KEY_BASE`, and `EVM_PRIVATE_KEY_AVAX`.

`MM_ENABLE_SOLANA` defaults to `false`. If it is forced on against the current `lvr_amm` deployment, the bot disables Solana execution with a reason because the AMM does not expose the external resting-order primitives needed by this quote bot.

## Generate multiple wallet configs

```bash
bun run wallets:generate -- --count 5 --out wallets.generated.json --prefix mm
```

This writes wallet key material to `wallets.generated.json`. Keep that file private.

## Run multiple wallet instances

```bash
bun run start:multi -- --config wallets.generated.json --stagger-ms 1200
```

`solanaPrivateKey` is optional and is mainly useful for `wallets:ui-env` exports. Multi-wallet quote execution is EVM-only unless a separate Solana quote-compatible program is introduced.

Optional:

```bash
bun run start:multi -- --config wallets.generated.json --dry-run
```

Use [wallets.example.json](wallets.example.json) as the schema reference.

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
- `sybil_identity_churn`
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
- `MM_ADVERSARIAL_MIN_PASSES` (default is all scenarios in scope: `39` for all chains, `13` for one chain)
- `MM_ADVERSARIAL_OUTPUT_DIR` (default `simulations`)
- `MM_ADVERSARIAL_ENFORCE_BASELINE` (`1` by default, set `0` to skip baseline regression checks)
- `MM_ADVERSARIAL_SEED_CORPUS` (optional path override for regression-seed corpus used by `--seed-corpus`)
- `MM_ADVERSARIAL_REPLAY_CORPUS` (optional path override for historical replay corpus used by `--replay-corpus` and gate checks)

Gate behavior now enforces twelve layers:

- mitigation pass threshold
- hard invariants (`max mitigated attacker pnl`, `max exploit events`, `max inventory peak`, `max toxic fill rate`, `max adverse slippage`, `min loss reduction`)
- baseline regression deltas from `src/adversarial/baseline.snapshot.json`
- oracle/finality/dispute policy controls (max stale oracle age, confidence bounds, same-slot round-trip pressure, finalized-only settlement reads, minimum dispute liveness window)
- bounded-loss budgets (scenario-level and chain-aggregate mitigated attacker PnL caps)
- settlement state-machine checks (`open -> resolve_proposed -> dispute_window -> finalized`) including minimum dispute-window time before finalization
- sybil/collusion controls (cluster concentration ceiling, identity-churn rate ceiling, circular-flow ratio ceiling, coordinated-resolution push score cap, minimum independent participant floor)
- adaptive attacker-policy controls (max escalation score, max tactic-switch burden, minimum defense-recovery ratio, max terminal pressure)
- chaos-resilience controls (oracle outage damage cap, finality jitter damage cap, liquidity-cliff inventory stress cap)
- deterministic abuse-matrix budgets (chain aggregate and scenario-specific attacker-pnl/exploit/toxicity/slippage envelopes)
- regression seed corpus replay checks (known-bad seeds must remain mitigated across all enabled gates)
- historical replay corpus checks (captured trace replays from prior duel/orderflow windows must stay within replay safety budgets)

Run the seed corpus gate:

```bash
bun run simulate:adversarial:seed-corpus
```

Run the historical replay corpus gate:

```bash
bun run simulate:adversarial:replay-corpus
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
  - `sybil_identity_churn`

Additional fork harness env controls:

- `MM_FORK_ATTACK_SEEDS` (comma-separated seed corpus, default `20260311`)
- `MM_FORK_REQUIRE_ALL_CHAINS` (`1`/`true` to fail unless all of `BSC_FORK_RPC_URL`, `AVAX_FORK_RPC_URL`, and `SOLANA_FORK_RPC_URL` are set)

Formal safety specification:

- `docs/safety-spec.md`

Refresh baseline snapshot after intentional model changes:

```bash
bun run simulate:adversarial:baseline:update
```

## Verification

```bash
bun test
bunx tsc --noEmit -p tsconfig.json
bun run smoke:runtime:evm
bun run smoke:runtime:solana
```

`smoke:runtime:solana` delegates to the supported Solana PM AMM local validation suite in `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-solana`, covering market open, trading, settlement, and claims.
