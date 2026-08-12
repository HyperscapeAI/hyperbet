# Launch Operations Evidence Index

Store evidence under an immutable release identifier with:

- source SHA, branch, tree status, dependency/tool versions
- SBF and IDL hashes
- program IDs, loader ownership, ProgramData addresses, and upgrade authorities
- frozen oracle/market roles, dispute window, fee schedule, and pause state
- deployment/initialization/verification signatures
- Pages build metadata and bundle scan
- service `/ready`, `/status`, source freshness, parser/index freshness, database probe, and bot recovery snapshots
- Hyperia stream plus betting-feed epoch/sequence trace
- active duel/market/account identity trace
- staged browser and transaction evidence
- fault-drill and sustained-soak artifacts
- alert delivery evidence
- backups/restore and rollback evidence
- operator, security, compliance, and release approvals

Never store private keys, bearer tokens, keyed URLs, or unredacted secret-manager output in the evidence bundle.
