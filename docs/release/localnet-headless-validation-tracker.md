# Localnet Headless Validation Tracker

> **Historical snapshot:** This tracker preserves branch-era local runner and headless validation findings. Current open-work ownership lives in [tracking-document-map.md](tracking-document-map.md) and [github-project-production-backlog.md](github-project-production-backlog.md). Use this file as context and evidence, not as the canonical blocker list.

> **TL;DR:** The local signoff lane is not blocked by product functionality anymore; it is blocked by local orchestration quality. The main issues are runner assumptions, headless stream proof, and final BSC/AVAX local E2E stabilization. The Hyperbet page does **not** need `?debug=1` for real local betting flow, and the integrated runner starts the stream by shelling into the sibling Hyperscapes repo and executing `bun run duel`.

## Current Findings

### 1. Hyperbet page debug flag

- `?debug=1` only enables hidden E2E/operator controls in local `e2e` mode.
- It is gated behind `isE2eMode && searchParams.has("debug")` in:
  - `packages/hyperbet-evm/app/src/App.tsx`
  - `packages/hyperbet-bsc/app/src/App.tsx`
  - `packages/hyperbet-avax/app/src/App.tsx`
  - `packages/hyperbet-solana/app/src/App.tsx`
- It is not required for the actual betting surface, stream embedding, or local soak.

### 2. How the integrated local runner starts the stream

- `scripts/run-hyperscapes-pm-local.sh` locates the local Hyperscapes checkout, `cd`s into it, and runs:
  - `bun run duel --skip-betting --skip-keeper --bots=<n>`
- That boots the Hyperscapes duel stack and exposes:
  - `GET /api/streaming/state`
  - `GET /api/internal/bet-sync/state`
  - `GET /api/internal/bet-sync/events`
  - `http://127.0.0.1:3333/stream.html`
- Hyperbet is then started separately by the Hyperbet runner:
  - local keeper on `:8080`
  - local app on `:4179`

### 3. External-drive / moved-project implication

- The integrated runner used to assume a single default location:
  - `<workspace>/.worktrees/hyperscapes-stream-bet-sync`
- That is fragile if the sibling repo is moved.
- The runner now needs an explicit path contract:
  - honor `HYPERSCAPES_ROOT` first
  - auto-detect common sibling locations second
  - fail fast with a clear message otherwise

## Domain Tracker

| Domain | Current State | Blocker | Next Action | Exit Gate |
| --- | --- | --- | --- | --- |
| Product UI surface | Real betting page works without `?debug=1`; debug only exposes hidden E2E controls | Default local URL still drifts toward debug/operator view in some paths | Standardize local default page to `/`, keep debug opt-in only | Local runner, monitor, and docs all default to the non-debug betting page |
| Hyperscapes bootstrap | Stream source is the sibling Hyperscapes repo launched via `bun run duel` | Runner still depends on repo-location assumptions and local runtime prerequisites | Make `HYPERSCAPES_ROOT` the explicit override and document fallback discovery | Local runner starts the duel stack from any valid checkout path without manual patching |
| Local runtime contract | Hyperscapes local lane depends on Bun, Node, Anvil, local ports, and sibling repo assets | Runtime/version drift causes brittle boots and silent failures | Pin and verify Node runtime for local duel stack, fail fast on mismatch | Local runner refuses invalid runtime combinations before partial startup |
| Headless WebGPU validation | Playwright configs now support headless WebGPU args across chains | Integrated monitor/probe lane still needs one canonical path and artifact contract | Use headless Chrome/Chromium with 1280x720 viewport and screenshot artifacts as the standard | Stream probe reports renderer-ready and writes screenshots/JSON without opening UI |
| Integrated local orchestration | `run-hyperscapes-pm-local.sh` can boot game, keeper, app, monitor, and soak lanes | Current orchestration is still awkward for scripted signoff because the runner is long-lived | Make the orchestrator spawn the integrated stack in the background and then run probe/soak against it | One local command can boot, verify, soak, archive artifacts, and tear down cleanly |
| BSC local E2E | Most restart/seed-path fixes are in | Final rerun from a clean stack still pending | Re-run headless BSC E2E and patch any remaining stale-duel or nonce issues | `ci:gate:e2e:bsc` passes headlessly from a clean environment |
| AVAX local E2E | Same codepath class as BSC, but not fully re-verified yet | Final clean-stack rerun still pending | Re-run headless AVAX E2E and patch any remaining chain-specific drift | `ci:gate:e2e:avax` passes headlessly from a clean environment |
| Soak / MM simulation | Contract gates and MM adversarial lane exist | Integrated local signoff still needs real headless proof and screenshot evidence | Run local probe, soak monitor, soak harness, and MM simulation against the same session | No unresolved sync drift, reconciliation failure, or renderer degradation |
| Documentation / operator clarity | Core runbook exists | It had drifted from actual defaults and local topology assumptions | Keep the runbook aligned with code defaults and maintain one active tracker | Operators can boot localnet without tribal knowledge or chat history |

## Priority Order

1. Normalize the local runner contract.
   - non-interactive by default
   - non-debug Hyperbet UI by default
   - explicit `HYPERSCAPES_ROOT` override
   - runtime verification up front

2. Finish the headless proof lane.
   - dedicated stream probe
   - 16:9 screenshots
   - headless WebGPU
   - artifactized JSON result

3. Re-run clean local E2E on all launch surfaces.
   - Solana
   - BSC
   - AVAX

4. Run the integrated local signoff suite.
   - stream probe
   - PM soak
   - soak harness
   - MM adversarial simulation

5. Promote only after local signoff is green.
   - devnet/testnet deploys
   - staged proof
   - staged soak

## Tracking Rules

- Treat this file as the active localnet tracker until devnet/testnet promotion starts.
- Every blocker should map to one of the domains above.
- Do not mark the local lane complete until:
  - all three local E2E gates are green
  - the headless stream probe is green
  - local soak and harness are green
  - no UI windows/tabs are opened by default
