# Stage-A Browser Acceptance Matrix

This matrix tracks the browser-to-chain acceptance bar for the current Hyperbet branch against the deployed Stage-A chains:

- Solana `devnet`
- BSC testnet
- AVAX Fuji

The current browser lane is still the **synthetic publish** lane:

- local apps
- local keepers
- real Stage-A chains
- real Stage-A wallets
- duel state injected through `/api/streaming/state/publish`

The later **real Hyperscapes** lane is intentionally separate and should switch duel generation to the sibling Hyperscapes checkout after the synthetic lane is green enough to stop debugging basic browser issues.

Scope rule for this matrix:

- `models` / `agents` is the user-facing perps surface
- AMM is an internal market-making tool and is **not** part of browser-surface acceptance

## Duel Source Contract

Accepted non-mainnet duel-source modes are:

- `synthetic_publish`
- `real_hyperscapes`

Current status:

- the public E2E runners now accept the duel-source contract explicitly
- the synthetic browser lane is currently green on:
  - BSC: 4 live EVM market-flow cases passing
  - AVAX: 4 live EVM market-flow cases passing
  - Solana: 5 live browser cases passing, with 1 explicit time-gated winner-claim lane skipped unless `E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM=true`
- the copied Solana placeholder skips were removed from the BSC and AVAX browser suites
- the public E2E runners still execute only the `synthetic_publish` lane
- `real_hyperscapes` is reserved for the later live-duel swap via [/Volumes/OWC Envoy Pro FX/Work/hyperbet/scripts/run-hyperscapes-pm-local.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/scripts/run-hyperscapes-pm-local.sh)
- the updated Hyperscapes `origin/main` commit staged for that swap is `98f8fe26271a63edb61b4b72e4314917a0fa50d7` in `/tmp/hyperscapes-main`
- synthetic on-chain evidence is retained in:
  - direct canary artifacts under [/Volumes/OWC Envoy Pro FX/Work/hyperbet/.ci-artifacts/stage-a/direct-canaries](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.ci-artifacts/stage-a/direct-canaries)
  - BSC targeted browser rerun txs:
    - recovery YES: `0x79c6a2a7840ad0736b6d85b45fab05296735d67d7655e6ed9b081c040beb35bd`
    - cancel YES: `0xc0163a00de2f03133ed1f7b8f58bf5d6611963336bfda418a1d4d95bc390b670`
    - cancel refund claim: `0x73277718f9c347752176315d122544007975fbfae0ab64271582383be617bdb6`

## Current Coverage

### Solana

Covered:

- wallet connect and active-chain boot
- duels bottom tabs: `trades`, `orders`, `positions`, `news`, `holders`, `topTraders`
- points drawer open/close
- points leaderboard scope/window toggles
- points history render plus filter toggle
- referral render plus redeem validation
- referral link-wallet CTA state
- surface-mode toggle to `models` and back to `duels`
- PM flows:
  - lifecycle shell
  - YES and NO order placement
  - restart recovery
  - cancelled duel refund
- perps flows:
  - LONG open/close
  - SHORT open/close

Blocked by protocol time, not browser wiring:

- finalized winner claim on a newly proposed duel
  - current devnet oracle config is frozen with `disputeWindowSecs=3600`
  - the synthetic browser lane now treats this as a separate time-gated check
  - resolved claim CTA semantics are covered in-browser
  - the shared on-chain `claim()` instruction path is exercised by the cancelled-duel refund flow
  - set `E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM=true` only when intentionally running the timed maturity lane

### BSC

Covered:

- wallet connect and chain selection
- duels bottom tabs: `trades`, `orders`, `positions`
- points drawer open/close
- points leaderboard scope/window toggles
- points history render plus filter toggle
- referral render plus redeem validation
- referral link-wallet CTA state
- locale switch
- surface-mode toggle to `models` and back to `duels`
- models/agents surface as the user-facing perps browser surface
- PM flows:
  - fresh live market creation
  - YES and NO order placement
  - keeper recovery
  - cancel and refund
- the BSC PM surface is proven from live targeted reruns on the deployed Stage-A chain, not from mocked receipts

Not yet fully proven:

- the models/agents surface is covered as a browser surface, but it is still a lighter acceptance lane than Solana’s writable perps flow
- no browser AMM work is required for signoff

### AVAX

Covered:

- wallet connect and chain selection
- duels bottom tabs: `trades`, `orders`, `positions`
- points drawer open/close
- points leaderboard scope/window toggles
- points history render plus filter toggle
- referral render plus redeem validation
- referral link-wallet CTA state
- locale switch
- theme toggle
- surface-mode toggle to `models` and back to `duels`
- models/agents surface as the user-facing perps browser surface
- PM flows:
  - fresh live market creation
  - YES and NO order placement
  - keeper recovery
  - cancel and refund

Not yet fully proven:

- the models/agents surface is the correct AVAX browser surface for acceptance
- no browser AMM work is required for signoff

## Honest Remaining Work

1. Run the time-gated Solana matured-winner-claim lane once a real matured fixture exists, with `E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM=true`.
2. Switch the duel source to real Hyperscapes and rerun the same browser suites without `/api/streaming/state/publish`.
