# Duel, Stream, and Market Confidence Soak

## Goal

Demonstrate that the real integrated experience stays responsive, internally consistent, and recoverable for the approved duration and load profile.

## Record continuously

- duel cycle ID/key, phase, agent health, and authoritative timestamps
- stream playlist freshness, frame cadence, dropped frames, and end-to-end latency
- browser FPS, long tasks, memory, WebGL/WebGPU errors, and reconnects
- keeper loop latency, RPC latency/errors, active markets/orders, and quote age
- HTTP readiness dependencies and recovery reasons
- database size/latency, lifecycle-index lag, and terminal queue depth
- transaction failures, duplicate attempts, balance conservation, and settlement lag
- process CPU, resident memory, file descriptors, and restart count

## Fault drills

During a non-production soak, exercise one controlled fault at a time:

- restart the HTTP service
- hard-kill and restart the duel keeper
- interrupt the RPC proxy/provider
- interrupt the canonical stream source
- force feed replay within retention
- verify retention-loss and contradictory terminal events fail closed
- verify recovered open orders are cancelled and terminal orders are reclaimed

## Pass criteria

- no overlapping duel authority or regressed phase/sequence
- no stale or mismatched market identity
- no duplicate market/order/settlement side effect
- no unbounded memory, listener, account, database, or queue growth
- steady rendering and input response at the approved device profiles
- every injected fault alerts, fails closed, and recovers according to its runbook
- all user funds and fee/refund/claim accounting reconcile exactly

Retain raw metrics, logs, screenshots/video, fault timestamps, and a signed summary. A short smoke does not replace the sustained launch soak.
