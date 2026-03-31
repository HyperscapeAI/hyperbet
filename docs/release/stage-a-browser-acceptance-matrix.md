# Stage-A Browser Acceptance Matrix

> **Historical snapshot:** This document preserves browser-to-chain and real-Hyperscapes acceptance evidence for the Stage-A branch effort. Current open-work ownership lives in [tracking-document-map.md](tracking-document-map.md) and [github-project-production-backlog.md](github-project-production-backlog.md). Use this matrix as evidence, not as the canonical blocker list.

This matrix tracks the browser-to-chain acceptance bar for the current Hyperbet branch against the deployed Stage-A chains:

- Solana `devnet`
- BSC testnet
- AVAX Fuji

The browser acceptance work now has two explicit lanes:

- `synthetic_publish`
  - local apps
  - local keepers
  - real Stage-A chains
  - real Stage-A wallets
  - duel state injected through `/api/streaming/state/publish`
- `real_hyperscapes`
  - local apps
  - local keepers
  - real Stage-A chains
  - real Stage-A wallets
  - duel state discovered from the sibling Hyperscapes checkout instead of synthetic publish

The real Hyperscapes lane remains separate from the synthetic lane so the same browser assertions can be reused while only the duel source changes.

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
  - Solana: 5 default live browser cases passing, with the explicit time-gated matured winner-claim lane proven separately on the `real_hyperscapes` path after `finalizableAt`
- the copied Solana placeholder skips were removed from the BSC and AVAX browser suites
- the `real_hyperscapes` lane is now green for the targeted BSC PM, AVAX PM, Solana PM, and Solana CLOB write-path cases using prepared live markets from [/Volumes/OWC Envoy Pro FX/Work/hyperbet/scripts/run-hyperscapes-pm-local.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/scripts/run-hyperscapes-pm-local.sh)
- the `real_hyperscapes` lane is also green for the time-gated Solana matured-claim lane and the bounded observe-only soak
- the updated Hyperscapes `origin/main` commit staged for that swap is `98f8fe26271a63edb61b4b72e4314917a0fa50d7` in `/tmp/hyperscapes-main`
- synthetic on-chain evidence is retained in:
  - direct canary artifacts under [/Volumes/OWC Envoy Pro FX/Work/hyperbet/.ci-artifacts/stage-a/direct-canaries](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.ci-artifacts/stage-a/direct-canaries)
  - BSC targeted browser rerun txs:
    - recovery YES: `0x79c6a2a7840ad0736b6d85b45fab05296735d67d7655e6ed9b081c040beb35bd`
    - cancel YES: `0xc0163a00de2f03133ed1f7b8f58bf5d6611963336bfda418a1d4d95bc390b670`
    - cancel refund claim: `0x73277718f9c347752176315d122544007975fbfae0ab64271582383be617bdb6`
- real-duel on-chain evidence now includes the targeted BSC PM rerun:
  - YES order: `0x97bd75b787b8d488a7b0ad1d794efd7f6718d63abf0378440e9488a460c2aecd`
  - NO order: `0xb98edc456cd953d84266516f642877275444a78c41bf901fdda3447332daafd5`
- real-duel on-chain evidence also includes the targeted AVAX PM rerun:
  - YES order: `0x3af62ab49f66739d81746b21ebcb9ceccdc68b859e42766343c21f5b35c93532`
  - NO order: `0x261cdba97db07805cd056cf8c5915fe2668f021a5b499da39eb9a771ca6c2417`
- real-duel recovery evidence now includes:
  - BSC keeper-restart YES: `0x3abd521c2b89a1f2be898a89e2c67a52f4f5289bf7170aba80f9a30b3bef2a99`
  - AVAX keeper-restart YES: `0x079b2c841a3fb02f272e6640d44ba80b6f2ccf0b98305153e9d7a89daf0bed76`
  - BSC Hyperscapes-restart YES: `0xa093fc026860c5d5d0f549de4188d32854dd58d6c0773855e4bf964b5f5e3579`
  - AVAX Hyperscapes-restart YES: `0x338b3f3cab3f7684bd06eff84a7484a6395e461abe959035d4939421e299e674`
  - Solana PM Hyperscapes-restart: browser lane green against the same prepared live duel after service restart
  - Solana CLOB Hyperscapes-restart: browser lane green against the rebound live duel after service restart
- real-duel matured-claim evidence now includes:
  - finalize signature: `4tkVyYhgZMjTjzmWdoyZPvam7dMKBHj5Zm7CTVuu31yk4nrKYzkKQupPAyNzHx85FXL9dCvEyeKhZUC4WVL5a7Fy`
  - claim signature: `2Mopxy5AbnJUHC55VMVeADUcsSVBWLcp9kvBnq41doUGk8GhBmGPZyAcACCfGMC9Qbr9QEcCYPn8mE4CiV2og2bV`
  - trader lamport delta: `50609720`
- observe-only soak evidence now includes:
  - artifact root: [/Volumes/OWC Envoy Pro FX/Work/hyperbet/output/playwright/pm-soak/2026-03-28T08-03-45-491Z](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/output/playwright/pm-soak/2026-03-28T08-03-45-491Z)
  - summary: `pass=true`, `signoffMode=true`, `durationMs=1504787`, `cyclesObserved=7`, `scoredCyclesObserved=6`, `driftCyclesObserved=2`, `incidents=[]`

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
  - finalize a matured proposal and claim winnings
- real Hyperscapes PM write path:
  - prepared live duel selection
  - runner and keeper operate from live Hyperscapes state without `/api/streaming/state/publish`
  - browser YES and NO orders execute on the prepared live market
- real Hyperscapes CLOB path:
  - dedicated CLOB UI consumes the prepared live duel and market from `state.json`
  - seeded ask liquidity is funded from the bootstrap authority and confirmed with polling-safe Anchor sends
  - browser YES mint is verified on-chain against the prepared live market
- perps flows:
  - LONG open/close
  - SHORT open/close

Time-gated winner-claim evidence:

- finalized winner claim on the recorded real proposal-stage fixture
  - current devnet oracle config remains frozen with `disputeWindowSecs=3600`, so this lane is intentionally rerun only after the recorded `finalizableAt`
  - fixture:
    - duel id `streaming-177dc378-c195-4faf-a3c2-2ef2e945bf33`
    - duel key `9ec21f89f3797aac98a35cb401eeeee6e8c269a749505d3def8ec2f7bd6f5be7`
    - market `Eg27CiTYX67SdPFrnqeNbyVZePraZ23jxPA9dATaxXeE`
    - duel state `BEZYSNQaFDVzThZ8L66YG7SA9vLgtTuVWN8BEi83mqct`
    - proposal signature `4iwM3VNyJ8SWjWugyUGkWbE8R5PGrLQrFXp5Autf2pqmDLJggTgdQa3ZDkFSAHEnsvhFabEaLu3gRtp2EKSB1fih`
    - `finalizableAt=1774682887` (`2026-03-28 02:28:07 CDT`)
  - claim completion:
    - finalize signature `4tkVyYhgZMjTjzmWdoyZPvam7dMKBHj5Zm7CTVuu31yk4nrKYzkKQupPAyNzHx85FXL9dCvEyeKhZUC4WVL5a7Fy`
    - claim signature `2Mopxy5AbnJUHC55VMVeADUcsSVBWLcp9kvBnq41doUGk8GhBmGPZyAcACCfGMC9Qbr9QEcCYPn8mE4CiV2og2bV`
    - trader lamport delta `50609720`
  - the browser lane finishes against the same pinned duel and market with terminal claimed state and no remaining payout CTA
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
- real Hyperscapes PM write path:
  - prepared live market selection
  - browser YES order placed on-chain
  - browser NO order placed on-chain
  - keeper restart recovery

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
- real Hyperscapes PM write path:
  - prepared live market selection
  - browser YES order placed on-chain
  - browser NO order placed on-chain
  - keeper restart recovery

Not yet fully proven:

- the models/agents surface is the correct AVAX browser surface for acceptance
- no browser AMM work is required for signoff

## Honest Remaining Work

None. The bounded observe-only real-duel soak and the time-gated Solana matured-winner-claim lane are both complete on this branch.
