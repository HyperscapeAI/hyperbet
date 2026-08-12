# Solana Signer Policy and Rotation

## Required separation

- program upgrade/config authority
- keeper fee payer
- oracle reporter
- oracle finalizer
- public-only challenger
- market operator
- liquidity provider
- treasury

Production identities must be distinct. The HTTP service and browser receive no privileged private key.

## Storage

- cold/config authority: hardware-backed multisig or equivalent controlled custody
- hot operational roles: separate managed secrets with least privilege and audit logs
- staging: isolated keys that never reuse production material
- repository, build artifacts, logs, Pages variables, and support tickets: no private key material

## Rotation

1. Pause the affected writer/quoting process if compromise is suspected.
2. Record the role, reason, UTC time, current public key, and impacted markets.
3. Create the replacement in approved custody.
4. Simulate and review the exact on-chain configuration change.
5. Apply it with the required cold-authority approval.
6. update the secret manager and restart only the affected process.
7. verify program/config identity, role separation, readiness, and one smallest-safe staged action.
8. revoke/destroy the old secret and retain signatures plus custody audit evidence.

Because launch configuration may be frozen, prove the approved rotation mechanism before launch. If a required role cannot be rotated safely, that is a launch blocker.
