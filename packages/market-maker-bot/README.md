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

## Adversarial market-maker simulation (Solana, BSC, AVAX)

```bash
bun run simulate:adversarial
```

This executes scam-oriented scenarios against a baseline profile and a mitigated profile:

- `latency_sniping`
- `spoof_pressure`
- `toxic_flow_poisoning`
- `stale_signal_arbitrage`

Output report:

- `packages/market-maker-bot/simulations/market-maker-adversarial-report.json`

Use this in CI as a safety gate: mitigation pass counts should not regress.

CI gate command:

```bash
bun run simulate:adversarial:ci
```

This runs the simulation and fails if `mitigationPasses` is below `MM_ADVERSARIAL_MIN_PASSES` (default `12`).

## Full adversarial suite (entire simulation battery)

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

Strict CI gate (fails on regression):

```bash
bun run simulate:adversarial:ci
```

Gate env controls:

- `MM_ADVERSARIAL_SEED` (default `20260311`)
- `MM_ADVERSARIAL_MIN_PASSES` (default `18`)
