# Gate 22 Required Check Contract

This document freezes the launch-critical CI contract for Engineer 3's
integration branch work.

## Required Checks

These are the protected check names Gate 22 promotes once the underlying lanes
are stable:

- `EVM Contract Validation`
- `Shared Validation`
- `Validate hyperbet-solana`
- `Validate hyperbet-bsc`
- `Validate hyperbet-avax`
- `Solana Program Build Gate`
- `EVM Contract Proof Gate`
- `EVM Contract Security Gate`
- `EVM Exploit Gate`
- `Solana Exploit Gate`
- `Cross-Chain E2E (solana)`
- `Cross-Chain E2E (bsc)`
- `Cross-Chain E2E (avax)`
- `Base Add-Chain Smoke`

## Nightly Integration Contract

- Workflow: `.github/workflows/prediction-market-gates.yml`
- Schedule: daily at `07:00 UTC`
- Integration target: `enoomian/prediction-market-sprint-base`
- Artifact expectation: every nightly run uploads the same logs and JSON
  artifacts as the push and pull-request gate runs

## Nightly Checklist

- Shared lifecycle defaults still match `docs/enoomian-next-phase-gates.md`.
- Only `OPEN` is quotable; only `RESOLVED` and `CANCELLED` are terminal.
- `PROPOSED` and `CHALLENGED` remain fail-closed in UI, MM, and keeper
  consumers.
- Reserved metadata keys stay typed and backward-compatible on
  `/api/arena/prediction-markets/active`:
  - `proposalId`
  - `challengeWindowEndsAt`
  - `finalizedAt`
  - `cancellationReason`
- Privileged surfaces are inventoried in
  `release/contract-privileged-surface-inventory.md` and kept in sync with check
  criteria.
- The parity evidence in `docs/protocol/cross-chain-parity-matrix.md` still
  maps every required trace to a concrete passing command.
- No duplicate heavyweight check names exist outside
  `.github/workflows/prediction-market-gates.yml`.

## Promotion Rule

- Keep the full Gate 22 target set in-repo now.
- Promote the checks above to GitHub branch protection or rulesets only after
  Gates `16`, `17A`, `17B`, `19`, and `21` are stable on the integration
  branch.
- AVAX checks stay part of the target contract, but external ruleset promotion
  still requires Gate `19` canonicalization signoff.
