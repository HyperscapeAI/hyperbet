# PM Confidence Soak

Use this runbook to exercise prediction-market duel cadence, keeper ingestion,
market lifecycle, and market-maker behavior in two lanes:

1. **Local preflight**
   - local `Hyperscapes + Hyperbet keeper + Hyperbet UI`
   - validates duel cadence, bridge ingestion, UI freshness, and screenshot
     capture
   - stays read/debug-first unless you intentionally materialize writer keys

2. **Staged canonical soak**
   - staged duel source + staged keepers/pages + deployed Stage A contracts on
     `solana devnet`, `bsc testnet`, and `avax fuji`
   - uses the staged keepers as the authoritative lifecycle/MM writers
   - uses canary trader wallets only for order placement and claim/refund

## Why This Split Exists

The local lane is the fastest way to debug the real game-to-keeper-to-UI
integration path because it keeps Hyperscapes, the keeper service, and both UIs
under direct operator control.

The staged lane is the authoritative betting/MM soak because it exercises the
deployed contracts/programs and the staged writer authority without copying
privileged reporter/operator/finalizer keys onto a laptop.

## Local Lane

### Prerequisites

- PM worktree:
  - [/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick)
- sibling game repo:
  - `/Users/mac/Desktop/hyperscapes-mono`
- optional funded local trader wallets:
  - [local-smoke-wallets.json](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/docs/release/evidence/local-smoke-wallets.json)
  - [fund-local-smoke-wallets.yml](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/.github/workflows/fund-local-smoke-wallets.yml)

### Start The Integrated Stack

```bash
cd /Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick
bash scripts/run-hyperscapes-pm-local.sh
```

That runner already:

- starts Hyperscapes locally
- starts the Hyperbet keeper bridge
- starts the Hyperbet EVM app
- opens both UIs
- keeps the paired UI capture helper running in the background

### If The Duel Stream Stays `IDLE`

The soak monitor will fail fast if the local stream never leaves `IDLE`. Seed
and start two local agents first:

1. Create two agent characters in Hyperscapes:

```bash
curl http://127.0.0.1:5555/api/characters/db \
  -X POST \
  -H 'content-type: application/json' \
  --data '{"accountId":"local-agent-account-a","name":"Local Agent A","isAgent":true}'

curl http://127.0.0.1:5555/api/characters/db \
  -X POST \
  -H 'content-type: application/json' \
  --data '{"accountId":"local-agent-account-b","name":"Local Agent B","isAgent":true}'
```

2. Start those two agents through Hyperscapes:

```bash
curl http://127.0.0.1:5555/api/agents/<agent-id>/start -X POST
curl http://127.0.0.1:5555/api/agents/<agent-id>/start -X POST
```

### Run The Local Confidence Soak

```bash
cd /Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick
node --import tsx scripts/pm-soak-monitor.ts --mode=local --duration-min=25
```

Defaults:

- cadence baseline: `30s ANNOUNCEMENT + 150s FIGHTING + 5s RESOLUTION`
- soak budget: `8` cycles, about `25` minutes
- screenshots: enabled

Artifacts:

- monitor summary:
  - `output/playwright/pm-soak/<timestamp>/summary.json`
  - `output/playwright/pm-soak/<timestamp>/cycles.csv`
- dual-UI paired captures from the runner:
  - `output/playwright/hyperscapes-pm-local/<timestamp>/`

Local pass bar:

- no stack crash loop
- no stuck `IDLE`
- no skipped duel cycles
- cycle durations stay within reasonable drift of the `185s` baseline
- both local UIs remain reachable
- the evidence bundle contains initial, phase-change, and final screenshots

## Staged Lane

### Preconditions

- Stage A deploy is already green on:
  - `solana devnet`
  - `bsc testnet`
  - `avax fuji`
- staged URLs/secrets from the existing staged proof contract are present in the
  `staging` GitHub environment
- canary trader wallets are funded

### GitHub Workflow

Manual workflow:

- [pm-soak.yml](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/.github/workflows/pm-soak.yml)

Inputs:

- `lane=staged|both`
- `duration_minutes` default `120`
- `chains` default `solana,bsc,avax`
- `screenshots=true|false`

What the workflow does:

1. runs staged read-only proof first
2. installs Chromium when screenshots are enabled
3. runs the staged soak monitor
4. uses staged canary trader wallets to place alternating YES/NO orders on
   naturally opening staged markets
5. attempts claim/refund cleanup for matured cycles
6. uploads `.ci-artifacts/pm-soak`

`lane=both` keeps staged soak authoritative on GitHub, but it also writes the
required local preflight commands into the workflow summary. Hosted runners do
not spin up the sibling Hyperscapes repo or the local desktop UIs.

### Direct CLI Entry

```bash
cd /Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick
node --import tsx scripts/pm-soak-monitor.ts \
  --mode=staged \
  --chains=solana,bsc,avax \
  --duration-min=120
```

Useful env toggles:

- `PM_SOAK_ENABLE_CANARY_TRADES=true|false`
- `PM_SOAK_SCREENSHOTS=true|false`
- `PM_SOAK_BSC_CANARY_AMOUNT=<raw amount>`
- `PM_SOAK_AVAX_CANARY_AMOUNT=<raw amount>`
- `PM_SOAK_SOLANA_CANARY_LAMPORTS=<lamports>`

Artifacts:

- `.ci-artifacts/pm-soak/summary.json`
- `.ci-artifacts/pm-soak/cycles.csv`
- `.ci-artifacts/pm-soak/polls/*.json`
- `.ci-artifacts/pm-soak/events/*.json`
- `.ci-artifacts/pm-soak/screenshots/*.png`

Staged pass bar:

- staged keepers remain healthy on `solana`, `bsc`, and `avax`
- market reaches `OPEN` within `15s` of duel entry into its marketable phase
- MM quotes become visible within `20s` of market open
- quotes are gone or the market is non-quotable within `10s` of `betCloseTime`
- proposal appears within `60s` of duel resolution
- no persistent stale/MM halt condition lasts more than two poll intervals
- no chain stays stuck in `OPEN` or `LOCKED` past one duel cycle
- for a full `120m` soak, at least `3` matured duels per chain clear canary
  exposure cleanly

## Incident Checklist

Escalate immediately if any of these appear in the soak summary:

- `idle_seed_required`
- `market_missing_after_open_budget`
- `mm_quotes_missing_after_open_budget`
- `quotes_or_open_after_bet_close`
- `proposal_missing_after_resolution_budget`
- `persistent_stale_quote_health`
- `canary_trade_failed`
- `canary_trade_no_fill`
- `claim_failed`
- `claim_residual_not_cleared`
- screenshot capture failures

Before escalating, keep:

- `summary.json`
- `cycles.csv`
- the incident JSON under `events/`
- the matching screenshots under `screenshots/`
- the workflow URL if the staged lane ran on GitHub
