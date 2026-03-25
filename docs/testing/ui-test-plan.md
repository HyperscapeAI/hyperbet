# Prediction Market — UI Test Plan

> **TL;DR:** This manual UI checklist is supplemental QA coverage. It is not the only launch-signoff artifact. The current phase-1 signoff model combines this manual UI work with staged proof, soak, `verify-chains`, and deterministic AMM/perps gates. Remaining skipped UI-only cases are treated as replaced coverage, not as “zero skipped UI tests.”

Manual tests for QA testers. Each test must be performed in a browser against a
running local stack.

## Setup

1. Start Hyperscapes: game server on `localhost:5555`, client on `localhost:3333`
2. Start Anvil: `anvil --port 18545 --chain-id 97 --block-time 2 --accounts 20 --balance 10000`
3. Run soak harness (seeds contracts and exercises PM, AMM, and perps paths):
   `bun run pm:soak:harness -- --duration-min=5`
4. Start keeper: set `GAME_URL=http://localhost:5555`, `BSC_RPC_URL=http://localhost:18545`, contract addresses from soak output
5. Start frontend: `cd packages/hyperbet-bsc/app && bun run dev` with `.env.e2e` pointing to keeper + Anvil

## Tests

### TEST-UI-01: Stream connects and shows live duel

| | |
|---|---|
| **Steps** | 1. Open http://localhost:4179 2. Wait 5s |
| **Expected** | Phase indicator visible (ANNOUNCEMENT/COUNTDOWN/FIGHTING/RESOLUTION). Agent names shown. HP bars update during FIGHTING. No blank screen. |
| **Evidence** | Screenshot of main view with phase + agents |
| **Pass** | [ ] |

### TEST-UI-02: Bet close countdown

| | |
|---|---|
| **Steps** | 1. Open during ANNOUNCEMENT/COUNTDOWN 2. Watch timer |
| **Expected** | Timer counts down. Controls disable at 0. Status shows "Betting Closed". |
| **Evidence** | Screenshot with timer active, screenshot after close |
| **Pass** | [ ] |

### TEST-UI-03: Place a YES bet

| | |
|---|---|
| **Steps** | 1. During OPEN phase, enter amount "5" 2. Price 600 3. Click Buy YES 4. Confirm tx |
| **Expected** | Tx submits. Position appears. Book/trades update. Balance decreases. |
| **Evidence** | Before + after screenshots |
| **Pass** | [ ] |

### TEST-UI-04: Place a NO bet

| | |
|---|---|
| **Steps** | Same as TEST-UI-03, NO side |
| **Expected** | Same as above, mirrored |
| **Evidence** | Screenshot showing NO position |
| **Pass** | [ ] |

### TEST-UI-05: Order book renders correctly

| | |
|---|---|
| **Steps** | 1. Open during OPEN with market active 2. Check order book |
| **Expected** | Bids green, asks red. Prices 0-1000. Best bid < best ask. Flash on new orders. |
| **Evidence** | Screenshot of order book |
| **Pass** | [ ] |

### TEST-UI-06: Recent trades update on fills

| | |
|---|---|
| **Steps** | 1. Place market order that crosses spread 2. Check trades section |
| **Expected** | New trade at top. Side, amount, price, "just now" shown. Updates to "Xs ago". |
| **Evidence** | Screenshot of trades list |
| **Pass** | [ ] |

### TEST-UI-07: Phase transition FIGHTING to RESOLUTION

| | |
|---|---|
| **Steps** | 1. Open during FIGHTING 2. Wait for end |
| **Expected** | Phase changes to RESOLUTION. Winner announced. Bet controls disabled. Claim button appears if winning. |
| **Evidence** | FIGHTING screenshot, RESOLUTION screenshot |
| **Pass** | [ ] |

### TEST-UI-08: Claim winnings

| | |
|---|---|
| **Steps** | 1. Have winning position 2. After RESOLUTION, click Claim 3. Confirm tx |
| **Expected** | Tx submits. Position cleared. Balance increases. Claim button gone or shows "Claimed". |
| **Evidence** | Before + after claim screenshots |
| **Pass** | [ ] |

### TEST-UI-09: Losing side gets nothing

| | |
|---|---|
| **Steps** | 1. Have losing position 2. After RESOLUTION, check UI |
| **Expected** | No claim button or payout shows 0. Position marked "Lost". |
| **Evidence** | Screenshot of losing position |
| **Pass** | [ ] |

### TEST-UI-10: New duel cycle resets market

| | |
|---|---|
| **Steps** | 1. Watch RESOLUTION to next ANNOUNCEMENT |
| **Expected** | Old market clears. New agents appear. Controls re-enable on new OPEN. No stale data. |
| **Evidence** | New duel screenshot, fresh panel screenshot |
| **Pass** | [ ] |

### TEST-UI-11: Chain selector

| | |
|---|---|
| **Steps** | 1. Switch between BSC/AVAX/Solana tabs |
| **Expected** | Market data reloads per chain. No crash. Empty state if no market. |
| **Evidence** | Screenshot of each chain tab |
| **Pass** | [ ] |

### TEST-UI-12: Wallet connection

| | |
|---|---|
| **Steps** | 1. Open without wallet 2. Click Connect 3. Connect provider |
| **Expected** | Modal with providers. Address + balance shown after connect. Bet controls activate. |
| **Evidence** | Modal screenshot, connected screenshot |
| **Pass** | [ ] |

### TEST-UI-13: Error boundary

| | |
|---|---|
| **Steps** | 1. Trigger error (e.g. disconnect RPC, invalid URL param) |
| **Expected** | Error boundary catches crash. Friendly message. Not blank. Refresh option. |
| **Evidence** | Screenshot of error boundary |
| **Pass** | [ ] |

### TEST-UI-14: Mobile responsive

| | |
|---|---|
| **Steps** | 1. Chrome DevTools mobile (375x812) 2. Navigate all tabs |
| **Expected** | No horizontal overflow. Panel stacks vertically. Book readable. Touch targets 44px+. |
| **Evidence** | Mobile screenshots of each section |
| **Pass** | [ ] |

### TEST-UI-15: Theme toggle

| | |
|---|---|
| **Steps** | 1. Toggle dark/light/hm-gold |
| **Expected** | Colors change instantly. No FOUC. Text readable. Charts update. |
| **Evidence** | Screenshot per theme |
| **Pass** | [ ] |

### TEST-UI-16: Multi-cycle stress (10+ min)

| | |
|---|---|
| **Steps** | 1. Leave app open 10+ min 2. Bet each cycle 3. Claim each resolution |
| **Expected** | No memory leak. SSE reconnects. State stays accurate. No duplicates. Positions correct. |
| **Evidence** | Cycle 1, 5, 10 screenshots. Browser memory reading. |
| **Pass** | [ ] |

## Reporting

For each test:
1. Record PASS or FAIL
2. Attach evidence screenshots
3. If FAIL: describe actual behavior, attach console errors
4. Submit completed checklist + screenshots as test run artifact
