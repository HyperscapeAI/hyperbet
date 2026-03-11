# Hyperbet Market Maker Bot

## Single instance

```bash
bun run start
```

Uses `.env` values in this package. You can provide one shared EVM key via `EVM_PRIVATE_KEY`, or chain-specific keys via `EVM_PRIVATE_KEY_BSC` and `EVM_PRIVATE_KEY_BASE`.

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

Use `/Users/shawwalters/eliza-workspace/hyperbet/packages/market-maker-bot/wallets.example.json` as the schema reference.

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
- `MM_ADVERSARIAL_MIN_PASSES` (default is all scenarios in scope: `18` for all chains, `6` for one chain)
- `MM_ADVERSARIAL_OUTPUT_DIR` (default `simulations`)
- `MM_ADVERSARIAL_ENFORCE_BASELINE` (`1` by default, set `0` to skip baseline regression checks)

Gate behavior now enforces three layers:

- mitigation pass threshold
- hard invariants (`max mitigated attacker pnl`, `max exploit events`, `max inventory peak`, `max toxic fill rate`, `max adverse slippage`, `min loss reduction`)
- baseline regression deltas from `src/adversarial/baseline.snapshot.json`

Refresh baseline snapshot after intentional model changes:

```bash
bun run simulate:adversarial:baseline:update
```
