# Deprecated v2 Contract Addresses

> **Deprecation Date**: TBD (upon successful v3 CREATE2 deployment)  
> **Reason**: Migrated to CREATE2 deterministic deployment for cross-chain address parity.

## Old Addresses (v2 — CREATE deployment)

These contracts are **no longer active**. New contracts have been deployed at deterministic addresses via CREATE2.

### BSC Mainnet (Chain ID: 56)

| Contract | Address | Explorer |
|---|---|---|
| DuelOutcomeOracle | `0x8F582bc1D34Ca6dA12ac46B7c7Fdec02f2465961` | [View](https://bscscan.com/address/0x8F582bc1D34Ca6dA12ac46B7c7Fdec02f2465961) |
| GoldClob | `0x443C09B1E7bb7bA3392b02500772B185654A6F33` | [View](https://bscscan.com/address/0x443C09B1E7bb7bA3392b02500772B185654A6F33) |

### Base Mainnet (Chain ID: 8453)

| Contract | Address | Explorer |
|---|---|---|
| DuelOutcomeOracle | `0x63BF7f48A2795832C2b5f78172A1C6BE655F3a72` | [View](https://basescan.org/address/0x63BF7f48A2795832C2b5f78172A1C6BE655F3a72) |
| GoldClob | `0xb8c66D6895Bafd1B0027F2c0865865043064437C` | [View](https://basescan.org/address/0xb8c66D6895Bafd1B0027F2c0865865043064437C) |

### AVAX Fuji (Chain ID: 43113)

| Contract | Address | Explorer |
|---|---|---|
| DuelOutcomeOracle | `0x2ab7C67D6E3c0cb2b84AA8d6f26475FDaDE0a920` | [View](https://testnet.snowtrace.io/address/0x2ab7C67D6E3c0cb2b84AA8d6f26475FDaDE0a920) |
| GoldClob | `0xBc25103CfE182B67523c3159b6e3f5804dC4fA94` | [View](https://testnet.snowtrace.io/address/0xBc25103CfE182B67523c3159b6e3f5804dC4fA94) |

## Migration Notes

- **No state migration**: v3 contracts start with zero state. The old contracts remain accessible at their original addresses for any residual fund recovery.
- **No proxy**: Both old and new contracts are immutable (no upgrade proxy). The old contracts cannot be redirected.
- **Fund access**: Users with funds in old contracts can still interact with them directly using the addresses above. The GoldClob `cancelOrder` and `claim` functions remain callable.
