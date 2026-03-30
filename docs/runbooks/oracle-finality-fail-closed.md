# Oracle Finality Emergency Runbook (Fail-Closed)

## Trigger Conditions
- Proposal challenged and unresolved.
- Finalizer unavailable past dispute window.
- Conflicting proposal evidence (result/replay mismatch) under investigation.

## Fail-Closed Behavior
- Markets remain non-settleable while duel status is `PROPOSED` or `CHALLENGED`.
- Claims must revert until status becomes `RESOLVED` or `CANCELLED`.
- Operators must not bypass oracle finality via manual settlement.

## Authority Procedure
1. **Reporter** proposes corrected result if prior proposal invalid and lifecycle allows.
2. **Challenger** raises dispute immediately on evidence mismatch.
3. **Finalizer** finalizes only after:
   - dispute window expiry,
   - no active challenge,
   - operational checklist signoff.
4. **Admin** rotates compromised reporter/challenger/finalizer keys.

## Emergency Cancellation Path
If result integrity cannot be restored in SLA, reporter/admin coordination should cancel duel and drive refund settlement paths.

## Audit Artifacts
Record:
- duel key,
- proposal ID,
- result/replay hashes,
- timestamps for propose/challenge/finalize/cancel,
- signer identities for each authority action.
