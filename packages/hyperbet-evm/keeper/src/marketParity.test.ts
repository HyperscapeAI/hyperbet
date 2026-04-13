import { describe, expect, test } from "bun:test";
import type { KeeperMarketParitySnapshot } from "@hyperbet/mm-core";

import {
  applyMarketParityReceiptsToMarkets,
  buildProjectedMarketParitySnapshot,
  buildRecoveredMarketParitySnapshot,
  isPublicMarketParitySnapshot,
  isPublicMarketParitySnapshotForSourceDuel,
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

  test("redacts pre-open frozen bundles instead of treating them as public", () => {
    const frozen: KeeperMarketParitySnapshot = {
      bundleId: "bundle-pre-open",
      duelKey: "ab".repeat(32),
      duelId: "duel-secret",
      revision: 5,
      requiredChains: ["solana", "bsc"],
      confirmedChains: ["solana"],
      state: "frozen",
      phase: "ANNOUNCEMENT",
      safeToBet: false,
      openedAtMs: null,
      lockedAtMs: null,
      resolvedAtMs: null,
      freezeReason: "chain mismatch",
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
    };

    expect(isPublicMarketParitySnapshot(frozen)).toBe(false);
    expect(redactPendingMarketParity(frozen)).toMatchObject({
      bundleId: "pending:5",
      duelKey: null,
      duelId: null,
      state: "aborted",
      safeToBet: false,
      freezeReason: null,
      receipts: [
        {
          txRef: null,
          note: null,
        },
      ],
    });
  });

  test("keeps post-open confirmation gaps public", () => {
    const awaitingResolve: KeeperMarketParitySnapshot = {
      bundleId: "bundle-awaiting-resolve",
      duelKey: "ca".repeat(32),
      duelId: "duel-public",
      revision: 6,
      requiredChains: ["solana", "bsc"],
      confirmedChains: ["solana", "bsc"],
      state: "awaiting_confirmations",
      phase: "RESOLUTION",
      safeToBet: false,
      openedAtMs: 1_700_000_000_000,
      lockedAtMs: 1_700_000_030_000,
      resolvedAtMs: null,
      freezeReason: null,
      updatedAtMs: 1_700_000_060_000,
      receipts: [
        {
          chainKey: "solana",
          preparedAtMs: 1_699_999_990_000,
          openedAtMs: 1_700_000_000_000,
          lockedAtMs: 1_700_000_030_000,
          resolvedAtMs: null,
          cancelledAtMs: null,
          confirmedAtMs: 1_700_000_060_000,
          lifecycleStatus: "PROPOSED",
          txRef: "sol-tx",
          note: "waiting-dispute-window",
        },
        {
          chainKey: "bsc",
          preparedAtMs: 1_699_999_990_000,
          openedAtMs: 1_700_000_000_000,
          lockedAtMs: 1_700_000_030_000,
          resolvedAtMs: null,
          cancelledAtMs: null,
          confirmedAtMs: 1_700_000_060_000,
          lifecycleStatus: "PROPOSED",
          txRef: null,
          note: "waiting-dispute-window",
        },
      ],
    };

    expect(isPublicMarketParitySnapshot(awaitingResolve)).toBe(true);
    expect(redactPendingMarketParity(awaitingResolve)).toBe(awaitingResolve);
    expect(
      isPublicMarketParitySnapshotForSourceDuel(
        awaitingResolve,
        awaitingResolve.duelKey,
        awaitingResolve.duelId,
      ),
    ).toBe(true);
    expect(
      isPublicMarketParitySnapshotForSourceDuel(
        awaitingResolve,
        "db".repeat(32),
        "next-duel",
      ),
    ).toBe(false);
  });

  test("aligns public market rows from confirmed parity receipts", () => {
    const duelKey = "da".repeat(32);
    const aligned = applyMarketParityReceiptsToMarkets(
      [
        {
          chainKey: "bsc",
          duelKey,
          duelId: "duel-public",
          marketId: "0xmarket",
          marketRef: "0xmarket",
          lifecycleStatus: "PENDING",
          winner: "NONE",
          betCloseTime: 1_700_000_030_000,
          contractAddress: "0x0000000000000000000000000000000000000001",
          programId: null,
          txRef: null,
          syncedAt: 1_700_000_010_000,
          metadata: undefined,
        },
      ],
      {
        bundleId: `${duelKey}:7`,
        duelKey,
        duelId: "duel-public",
        revision: 7,
        requiredChains: ["solana", "bsc"],
        confirmedChains: ["solana", "bsc"],
        state: "resolved",
        phase: "RESOLUTION",
        safeToBet: false,
        openedAtMs: 1_700_000_000_000,
        lockedAtMs: 1_700_000_030_000,
        resolvedAtMs: 1_700_000_060_000,
        freezeReason: null,
        updatedAtMs: 1_700_000_060_000,
        receipts: [
          {
            chainKey: "bsc",
            preparedAtMs: 1_699_999_990_000,
            openedAtMs: 1_700_000_000_000,
            lockedAtMs: 1_700_000_030_000,
            resolvedAtMs: 1_700_000_060_000,
            cancelledAtMs: null,
            confirmedAtMs: 1_700_000_060_000,
            lifecycleStatus: "RESOLVED",
            txRef: null,
            note: "finalized-after-dispute-window",
          },
        ],
      },
      "B",
    );

    expect(aligned[0]).toMatchObject({
      chainKey: "bsc",
      duelKey,
      lifecycleStatus: "RESOLVED",
      winner: "B",
      syncedAt: 1_700_000_060_000,
      metadata: {
        parityReceiptLifecycleStatus: "RESOLVED",
        parityReceiptConfirmedAtMs: 1_700_000_060_000,
      },
    });
  });

  test("keeps post-open frozen bundles public", () => {
    const frozen: KeeperMarketParitySnapshot = {
      bundleId: "bundle-opened",
      duelKey: "cd".repeat(32),
      duelId: "duel-public",
      revision: 6,
      requiredChains: ["solana", "bsc"],
      confirmedChains: ["solana", "bsc"],
      state: "frozen",
      phase: "COUNTDOWN",
      safeToBet: false,
      openedAtMs: 1_700_000_000_000,
      lockedAtMs: null,
      resolvedAtMs: null,
      freezeReason: "post-open drift",
      updatedAtMs: 1_700_000_010_000,
      receipts: [],
    };

    expect(isPublicMarketParitySnapshot(frozen)).toBe(true);
    expect(redactPendingMarketParity(frozen)).toBe(frozen);
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
