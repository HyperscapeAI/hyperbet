# Governance and Emergency Controls

## Authority boundary

- upgrade/config authority is cold and absent from normal services
- reporter proposes authoritative outcomes
- finalizer finalizes after the dispute window
- challenger is a separate public identity whose private key is never held by the keeper
- market operator creates/synchronizes markets
- liquidity provider manages only its own orders
- treasury receives only fees proven by finalized on-chain events

Every production role is distinct and must match frozen on-chain configuration.

## Emergency response

1. Record UTC time, release SHA, cluster, programs, impacted duel/market, and triggering evidence.
2. Stop the duel keeper to halt new privileged writes and quoting.
3. Preserve HTTP reads and user cleanup paths where safe.
4. Capture stream/feed continuity, readiness, bot recovery, lifecycle index, terminal queue, program identity, and database state.
5. Classify the incident as source, RPC, signer, program/config, accounting, or data-integrity failure.
6. Follow the specific runbook; never mutate the database or force settlement by hand.
7. If a frozen program action is required, obtain the documented multisig/cold-authority approval and simulate it first.
8. Re-run verification and a bounded staged proof before restoring writes.

Retain every signature, approval, before/after snapshot, and incident decision. Readiness must remain failed until the unsafe dependency is actually resolved.
