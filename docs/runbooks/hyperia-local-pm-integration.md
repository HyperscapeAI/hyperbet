# Local Hyperia-to-Hyperbet Integration

## Purpose

Prove the real local path from Hyperia duel state through the authenticated betting feed, the Solana duel keeper, the HTTP/streaming service, and the browser app.

## Preconditions

- Hyperia implementation checkout is available as a sibling workspace or through `HYPERIA_ROOT`.
- `bun run dev:doctor` passes.
- PostgreSQL and the Hyperia local stack are healthy.
- a local Solana keypair is available for the isolated validator.

## Start

For the self-contained Solana market/browser gate:

```bash
bun run dev:local:solana
```

For the real cross-repository duel stack, use Hyperia's canonical one-command launcher. It must start:

1. the authoritative Hyperia duel scheduler and stream
2. the authenticated schema-v3 betting-feed adapter
3. the key-free Hyperbet HTTP service
4. the separately authorized Solana duel keeper
5. the Hyperbet browser app

Do not substitute the spectator projection endpoint for the settlement feed.

## Acceptance

- Hyperia stream state leaves `IDLE` and advances monotonically.
- the betting feed reports schema version 2 with a stable source epoch and advancing sequence.
- the HTTP service reports a fresh canonical source poll.
- `/ready` is 200 only when stream, bot, parser/index, recovery, program identity, and database checks are safe.
- stream and market endpoints agree on duel ID/key and lifecycle.
- the browser shows the same agents, phase, timing, and market.
- a full local lifecycle can place orders, lock, propose/challenge/finalize as applicable, settle, and reclaim terminal accounts.
- stopping the stack removes every managed process and listener.

Capture logs, JSON state, browser screenshots, transaction signatures, and the exact release SHA for any evidence run.
