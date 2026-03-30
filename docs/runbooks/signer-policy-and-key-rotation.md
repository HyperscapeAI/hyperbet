# Signer Policy And Key Rotation

This runbook defines the signer boundaries for launch-chain EVM operations and
the minimum evidence required when any signing authority changes.

## Required Separation

- `timelockAddress`: non-emergency admin for contract upgrades and role
  management
- `multisigAddress`: owner/controller of the timelock
- `emergencyCouncilAddress`: emergency pause authority only
- `reporterAddress`: duel open / result proposal writer
- `finalizerAddress`: post-dispute finalization authority
- `challengerAddress`: dispute authority
- `marketOperatorAddress`: market creation authority
- staged-proof canary signer: staging-only account used for Gate `14A`

Do not collapse these roles onto a single production private key. The deploy
receipts and committed manifests should show the separated owners directly.

## Storage Policy

- production keys live in hardware-backed wallets, multisigs, or managed secret
  stores
- staging keys live in isolated staging secrets and never reuse production
  material
- no private key, seed phrase, or signer JSON belongs in git-tracked files
- Cloudflare Pages variables must not hold production private keys
- any deploy keypair or signer material ever committed to git must be treated as
  burned, removed from the repo, and rotated before release or audit handoff

## Routine Rotation

Rotate any hot or delegated signing key before launch, after personnel changes,
and after any suspected leak. For routine rotation:

1. Record UTC time, chain, role, and rotation reason.
2. Generate the replacement signer in the approved wallet or secret store.
3. Update staging or production secret managers before any on-chain cutover.
4. Grant the new on-chain role from the timelock or current admin surface.
5. Verify the new signer with the smallest safe action:
   - read-only verification for emergency/timelock operators
   - staged canary or dry-run validation for staging reporters/operators
6. Revoke the old signer only after the replacement is confirmed.
7. Attach tx hashes, secret-manager change records, and the verification output
   to the release evidence package.

## Emergency Rotation

If a write-capable signer is suspected compromised:

1. Pause the affected write surfaces first when safety requires it:
   - `DuelOutcomeOracle.setOraclePaused(true)`
   - `GoldClob.setMarketCreationPaused(true)`
   - `GoldClob.setOrderPlacementPaused(true)`
2. Rotate the compromised secrets in the secret manager.
3. Grant replacement on-chain roles.
4. Revoke the compromised signer.
5. Re-run keeper status, `verify:chains`, and the relevant staged-proof step
   before unpausing.

## Evidence To Retain

- change ticket or incident reference
- UTC timestamps for secret rotation and on-chain role changes
- tx hashes for grants, revokes, ownership transfer, pause, and unpause
- post-rotation verification output
- updated release memo and audit checklist references
