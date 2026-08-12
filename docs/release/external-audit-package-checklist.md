# External Audit Package Checklist

- [ ] release SHA frozen and working tree reproducible
- [ ] scope statement names only `fight_oracle`, `duel_market`, native SOL, keeper, service, app, and required shared Solana libraries
- [ ] program sources, Cargo/Anchor manifests, lockfiles, IDLs, generated clients, and SBF hashes included
- [ ] canonical deployment registry and identity verifier included
- [ ] role/config/fee/dispute model and privileged surface inventory included
- [ ] protocol specification and state diagrams included
- [ ] threat model and residual-risk register included
- [ ] validator unit/integration/security evidence included
- [ ] exploit matrix inputs/results/logs included
- [ ] keeper parser, index, accounting, recovery, and continuity tests included
- [ ] browser lifecycle, restart, cancellation, settlement, and disabled-route evidence included
- [ ] build determinism, warning classifier, dependency audit, and bundle scan included
- [ ] findings triage owner/severity/SLA process defined
- [ ] every accepted risk has explicit accountable approval

No deployment or configuration change may occur while the reviewed audit artifact is considered frozen without invalidating the package and documenting the delta.
