# Hyperbet Solana Threat Model

## Protected assets

- user SOL held in market vaults
- exact order, fill, fee, refund, claim, and settlement accounting
- duel identity/timing/outcome integrity
- program/config/role identity
- keeper signer secrets
- feed continuity and terminal evidence
- lifecycle index, terminal queue, and database history
- availability of safe user cleanup

## Trust boundaries

- Hyperia duel authority to authenticated betting feed
- betting feed to duel keeper
- keeper to Solana RPC/programs
- chain to read-only service/parser
- service to public browser
- hot operational roles to cold configuration authority

## Principal threats

- forged/stale/regressed duel state or replayed terminal result
- proposal/challenge/finalize timing abuse
- PDA, program, market, order, recipient, or remaining-account substitution
- self-trade, partial-fill, rounding, fee, refund, or claim value creation
- duplicate processing after retry/restart/crash
- hidden active orders or incomplete finalized history
- signer compromise or role/config drift
- keyed RPC/secret leakage into public artifacts
- RPC/source outage causing unsafe writes
- database corruption or operator recovery misuse
- denial of service, resource growth, renderer stalls, and stream degradation

## Security posture

On-chain account/authority/time/value checks are primary. The keeper accepts only authenticated schema-v3 continuity, derives financial truth from canonical finalized chain evidence, persists recovery state before side effects, and fails readiness closed on uncertainty. The public service has no writer key. The browser is never trusted for settlement or accounting.

Remaining high-risk launch gates are the independent audit, production custody/config evidence, production-shaped failure drills, sustained performance soak, and legal/compliance approval.
