# Solana Privileged Surface Inventory

| Role                             | Capability                                                                 | Normal location         | Launch requirement                                             |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| Program upgrade/config authority | deploy, upgrade, initialize/freeze approved configuration, emergency pause | cold controlled custody | absent from normal services; exact expected authority verified |
| Oracle reporter                  | upsert duel lifecycle, cancel eligible duel, propose/re-propose result     | dedicated keeper secret | distinct identity; authenticated feed only                     |
| Oracle finalizer                 | finalize unchallenged result after dispute window                          | dedicated keeper secret | distinct identity and legal timing                             |
| Oracle challenger                | challenge proposal before deadline                                         | external/public role    | keeper receives public key only                                |
| Market operator                  | create/synchronize canonical duel market                                   | dedicated keeper secret | distinct identity; canonical PDAs only                         |
| Liquidity provider               | create/cancel/reclaim its own quotes                                       | dedicated keeper secret | bounded exposure; no config authority                          |
| Fee payer                        | pay keeper transaction fees                                                | dedicated keeper secret | no protocol authority                                          |
| Treasury                         | receive released execution fees                                            | public recipient        | immutable per-market snapshot                                  |

User order cancellation, claim/refund, loser cleanup, and permissionless resolved-fee withdrawal cannot redirect funds: all recipients and account relationships are validated on-chain.
