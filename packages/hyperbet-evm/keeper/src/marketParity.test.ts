import { describe, expect, test } from "bun:test";

import {
  buildProjectedMarketParitySnapshot,
  buildRecoveredMarketParitySnapshot,
  redactPendingMarketParity,
} from "./marketParity";

describe("market parity helpers", () => {
  test("reconstructs a stable open bundle only when every required chain agrees", () => {
    const recovered = buildRecoveredMarketParitySnapshot({
      duelKey: "ab".repeat(32),
      duelId: "duel-open",
      phase: "ANNOUNCEMENT",
      requiredChains: ["solana", "bsc"],
      updatedAtMs: 1_700_000_000_000,
      streamSafe: true,
      markets: [
        {
          chainKey: "solana",
          duelKey: "ab".repeat(32),
          duelId: "duel-open",
          marketId: "sol-market",
          marketRef: "sol-market",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 1_700_000_060_000,
          contractAddress: null,
          programId: "sol-program",
          txRef: "sol-signature",
          syncedAt: 1_700_000_000_000,
          metadata: undefined,
        },
        {
          chainKey: "bsc",
          duelKey: "ab".repeat(32),
          duelId: "duel-open",
          marketId: "0xmarket",
          marketRef: "0xmarket",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 1_700_000_060_000,
          contractAddress: "0x0000000000000000000000000000000000000001",
          programId: null,
          txRef: null,
          syncedAt: 1_700_000_000_000,
          metadata: undefined,
        },
      ],
    });

    expect(recovered).toMatchObject({
      bundleId: `recovered:${"ab".repeat(32)}`,
      duelKey: "ab".repeat(32),
      duelId: "duel-open",
      state: "open",
      safeToBet: true,
      confirmedChains: ["solana", "bsc"],
    });
  });

  test("refuses to reconstruct parity when required chains disagree", () => {
    const recovered = buildRecoveredMarketParitySnapshot({
      duelKey: "cd".repeat(32),
      duelId: "duel-mismatch",
      phase: "COUNTDOWN",
      requiredChains: ["solana", "bsc"],
      updatedAtMs: 1_700_000_000_000,
      streamSafe: true,
      markets: [
        {
          chainKey: "solana",
          duelKey: "cd".repeat(32),
          duelId: "duel-mismatch",
          marketId: "sol-market",
          marketRef: "sol-market",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 1_700_000_060_000,
          contractAddress: null,
          programId: "sol-program",
          txRef: null,
          syncedAt: 1_700_000_000_000,
          metadata: undefined,
        },
        {
          chainKey: "bsc",
          duelKey: "cd".repeat(32),
          duelId: "duel-mismatch",
          marketId: "0xmarket",
          marketRef: "0xmarket",
          lifecycleStatus: "LOCKED",
          winner: "NONE",
          betCloseTime: 1_700_000_060_000,
          contractAddress: "0x0000000000000000000000000000000000000001",
          programId: null,
          txRef: null,
          syncedAt: 1_700_000_000_000,
          metadata: undefined,
        },
      ],
    });

    expect(recovered).toBeNull();
  });

  test("redacts duel identity from pending bundles", () => {
    const redacted = redactPendingMarketParity({
      bundleId: `abcd:4`,
      duelKey: "ab".repeat(32),
      duelId: "duel-secret",
      revision: 4,
      requiredChains: ["solana", "bsc"],
      confirmedChains: ["solana"],
      state: "awaiting_confirmations",
      phase: "ANNOUNCEMENT",
      safeToBet: false,
      openedAtMs: null,
      lockedAtMs: null,
      resolvedAtMs: null,
      freezeReason: "ignore-me",
      updatedAtMs: 1_700_000_000_000,
      receipts: [
        {
          chainKey: "solana",
          preparedAtMs: 1_700_000_000_000,
          openedAtMs: null,
          lockedAtMs: null,
          resolvedAtMs: null,
          cancelledAtMs: null,
          confirmedAtMs: 1_700_000_000_000,
          lifecycleStatus: "PENDING",
          txRef: "sol-tx",
          note: "prepared",
        },
      ],
    });

    expect(redacted).toMatchObject({
      bundleId: "pending:4",
      duelKey: null,
      duelId: null,
      freezeReason: null,
    });
    expect(redacted?.receipts[0]).toMatchObject({
      txRef: null,
      note: null,
    });
  });

  test("projects a preparing bundle when a live duel exists but no chain receipts do yet", () => {
    const projected = buildProjectedMarketParitySnapshot({
      duelKey: "ef".repeat(32),
      duelId: "duel-preparing",
      phase: "ANNOUNCEMENT",
      requiredChains: ["solana", "bsc"],
      updatedAtMs: 1_700_000_000_000,
      streamSafe: false,
      markets: [],
    });

    expect(projected).toMatchObject({
      bundleId: `recovered-pending:${"ef".repeat(32)}`,
      duelKey: "ef".repeat(32),
      duelId: "duel-preparing",
      state: "preparing",
      safeToBet: false,
      confirmedChains: [],
    });
    expect(projected?.receipts).toHaveLength(2);
    expect(projected?.receipts[0]).toMatchObject({
      lifecycleStatus: null,
      confirmedAtMs: null,
    });
  });

  test("projects awaiting confirmations when required chains are mid-transition", () => {
    const projected = buildProjectedMarketParitySnapshot({
      duelKey: "12".repeat(32),
      duelId: "duel-awaiting",
      phase: "ANNOUNCEMENT",
      requiredChains: ["solana", "bsc"],
      updatedAtMs: 1_700_000_000_000,
      streamSafe: true,
      markets: [
        {
          chainKey: "solana",
          duelKey: "12".repeat(32),
          duelId: "duel-awaiting",
          marketId: "sol-market",
          marketRef: "sol-market",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 1_700_000_060_000,
          contractAddress: null,
          programId: "sol-program",
          txRef: "sol-signature",
          syncedAt: 1_700_000_000_000,
          metadata: undefined,
        },
        {
          chainKey: "bsc",
          duelKey: "12".repeat(32),
          duelId: "duel-awaiting",
          marketId: "0xmarket",
          marketRef: "0xmarket",
          lifecycleStatus: "PENDING",
          winner: "NONE",
          betCloseTime: 1_700_000_060_000,
          contractAddress: "0x0000000000000000000000000000000000000001",
          programId: null,
          txRef: null,
          syncedAt: 1_700_000_000_000,
          metadata: undefined,
        },
      ],
    });

    expect(projected).toMatchObject({
      duelKey: "12".repeat(32),
      duelId: "duel-awaiting",
      state: "awaiting_confirmations",
      safeToBet: false,
      confirmedChains: ["solana"],
    });
    expect(projected?.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chainKey: "solana",
          lifecycleStatus: "OPEN",
          openedAtMs: 1_700_000_000_000,
        }),
        expect.objectContaining({
          chainKey: "bsc",
          lifecycleStatus: "PENDING",
          preparedAtMs: 1_700_000_000_000,
        }),
      ]),
    );
  });
});
