# Residual Risk Register

| Risk                                         | Required mitigation/evidence                                                      | Owner            | Status                                |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ---------------- | ------------------------------------- |
| Smart-contract defect                        | independent audit, remediation, fresh validator/security suite                    | Security         | Open                                  |
| Upgrade/config authority compromise          | controlled custody, threshold approval, rotation drill, identity monitoring       | Operations       | Open                                  |
| Reporter/finalizer/operator compromise       | distinct least-privilege keys, alerting, pause/recovery drill                     | Operations       | Open                                  |
| RPC outage/history loss                      | redundant archival providers, retention check, fail-closed index readiness        | Infrastructure   | Open                                  |
| Stream/feed discontinuity                    | authenticated continuity/replay, retention alert, authority failover proof        | Game/Backend     | Open                                  |
| Keeper crash or contradictory terminal input | durable queue, leases, quarantine, process-kill drill                             | Backend          | Mitigated; proof required per release |
| Accounting/parser mismatch                   | finalized evidence validation, immutable index, reconciliation, invariants        | Backend/Security | Mitigated; audit open                 |
| Browser/3D/stream performance regression     | device matrix, sustained soak, telemetry budgets                                  | Client/Game      | Open                                  |
| Real-value regulatory exposure               | counsel-approved jurisdiction, age, identity, sanctions, responsible-use controls | Legal/Compliance | Open                                  |
| Incident-response failure                    | on-call ownership, alert delivery, rollback/pause/recovery drills                 | Operations       | Open                                  |

No open risk is implicitly accepted. Every launch exception requires a named owner, expiry, evidence, and explicit approval.
