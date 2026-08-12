# Staged Solana Live Proof

Use a dedicated devnet or testnet environment. Never point this procedure at mainnet.

## Preconditions

- exact release SHA deployed to the staged app and services
- staged program IDs match the canonical registry and are executable
- upgrade authorities and frozen role/fee/dispute configuration are verified
- distinct staged writer roles are funded with bounded amounts
- canonical Hyperia stream and authenticated betting feed are live
- alerts and operator access are available

## Proof

1. Capture deployment identity and configuration evidence.
2. Confirm `/ready` and every underlying dependency are healthy.
3. Observe one real Hyperia duel open a matching Solana market.
4. Place bounded YES and NO orders with approved staged wallets.
5. Confirm exact fills, resting collateral, fees, and wallet history.
6. Observe market lock at the authoritative close time.
7. Exercise the dispute-aware oracle flow and legal finalization.
8. Claim the winner and clear the losing balance; separately prove cancellation/refund.
9. Restart the keeper and service, then prove on-chain discovery and replay recover state without duplication.
10. Confirm disabled routes remain 404 and the public app exposes no privileged key or provider credential.

Store transaction signatures, account snapshots, API payloads, bot/readiness snapshots, browser evidence, logs, and UTC timestamps under the release SHA. Any manual intervention or mismatch invalidates the proof until explained and rerun.
