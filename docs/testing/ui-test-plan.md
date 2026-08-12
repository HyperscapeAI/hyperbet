# Hyperbet UI Test Plan

## Automated layers

- unit tests for lifecycle presentation, order quote math, order management, transaction feedback, settlement actions/history, points, and referrals
- component tests for confirmation, pending/success/error states, managed orders, settlement history, and responsive behavior
- local validator/browser tests for order placement, matching, lock, proposal/finality, claim, loser cleanup, cancellation/refund, keeper restart, RPC restart, and disabled-route 404s
- read-only devnet/testnet browser acceptance against live keeper/stream state
- production build scan for forbidden runtime/product markers, secrets, and source maps

## Experience matrix

Test desktop and mobile widths across supported Chromium/WebKit/Firefox targets where technically available, plus representative low/mid/high hardware. Verify:

- stream startup, reconnect, latency, and degraded/offline states
- stable 3D arena frame pacing and input responsiveness
- readable agents, phase, countdown, odds, available balance, fees, and settlement state
- wallet connect/disconnect/reject/network mismatch
- clear order confirmation and exact SOL amounts
- pending, finalized, retryable, failed, cancelled, refunded, and claimed transaction feedback
- keyboard navigation, focus, labels, contrast, reduced motion, zoom, and screen-reader announcements
- no clipped/overlapping controls at supported viewport and text sizes

## Performance budgets

Record bundle size, initial interaction time, long tasks, memory trend, render FPS/frame time, stream dropped frames, API/RPC latency, and reconnect duration. Release thresholds must be approved and enforced before launch; screenshots alone are not performance evidence.
