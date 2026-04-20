import "./setup";
import { describe, expect, it } from "bun:test";

import {
  normalizePredictionMarketDuelKeyHex,
  parsePredictionMarketsOverviewResponse,
  parsePredictionMarketsResponse,
  parsePredictionMarketSyncStatusResponse,
  selectPredictionMarketOverviewRecord,
  selectPredictionMarketLifecycleRecord,
} from "../src/lib/predictionMarkets";
import {
  deriveMarketParityLabel,
  shouldMarketParityGatePhaseLabel,
} from "../src/lib/marketParity";
import {
  derivePredictionMarketUiState,
  EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
} from "../src/lib/predictionMarketUiState";

describe("prediction market lifecycle helpers", () => {
  it("normalizes duel keys from bare and 0x-prefixed hex", () => {
    const duelKey = "ab".repeat(32);

    expect(normalizePredictionMarketDuelKeyHex(duelKey)).toBe(duelKey);
    expect(normalizePredictionMarketDuelKeyHex(`0x${duelKey}`)).toBe(duelKey);
    expect(normalizePredictionMarketDuelKeyHex("not-a-duel-key")).toBeNull();
  });

  it("parses and normalizes keeper lifecycle payloads", () => {
    const duelKey = "cd".repeat(32);
    const parsed = parsePredictionMarketsResponse({
      duel: {
        duelKey: `0x${duelKey}`,
        duelId: "duel-42",
        phase: "ANNOUNCEMENT",
        winner: "NONE",
        betCloseTime: 12345,
        agent1Name: "Alpha",
        agent2Name: "Beta",
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: duelKey.toUpperCase(),
          duelId: "duel-42",
          marketId: "market-a",
          marketRef: "market-a",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 12345,
          contractAddress: null,
          programId: "program-a",
          txRef: null,
          syncedAt: 999,
        },
        {
          chainKey: "bsc",
          duelKey: "bad-key",
          duelId: "duel-42",
          marketId: "market-b",
          marketRef: "market-b",
          lifecycleStatus: "PROPOSED",
          winner: "A",
          betCloseTime: null,
          contractAddress: "0xabc",
          programId: null,
          txRef: "0xdef",
          syncedAt: 1000,
          metadata: {
            proposalId: "proposal-1",
            challengeWindowEndsAt: 1111,
            finalizedAt: null,
            cancellationReason: null,
          },
        },
      ],
      marketParity: {
        bundleId: "bundle-1",
        duelKey: `0x${duelKey}`,
        duelId: "duel-42",
        revision: 3,
        requiredChains: ["solana", "bsc"],
        confirmedChains: ["solana"],
        state: "awaiting_confirmations",
        phase: "ANNOUNCEMENT",
        safeToBet: false,
        openedAtMs: null,
        lockedAtMs: null,
        resolvedAtMs: null,
        freezeReason: null,
        updatedAtMs: 777,
        receipts: [
          {
            chainKey: "solana",
            preparedAtMs: 700,
            openedAtMs: null,
            lockedAtMs: null,
            resolvedAtMs: null,
            cancelledAtMs: null,
            confirmedAtMs: 701,
            lifecycleStatus: "PENDING",
            txRef: "sol-tx",
            note: null,
          },
        ],
      },
      updatedAt: 555,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.duel.duelKey).toBe(duelKey);
    expect(parsed?.duel.agent1Name).toBe("Alpha");
    expect(parsed?.duel.agent2Name).toBe("Beta");
    expect(parsed?.markets).toHaveLength(2);
    expect(parsed?.markets[0]?.duelKey).toBe(duelKey);
    expect(parsed?.markets[1]?.duelKey).toBeNull();
    expect(parsed?.markets[1]?.lifecycleStatus).toBe("PROPOSED");
    expect(parsed?.markets[1]?.metadata?.proposalId).toBe("proposal-1");
    expect(parsed?.marketParity).toMatchObject({
      bundleId: "bundle-1",
      duelKey,
      revision: 3,
      state: "awaiting_confirmations",
      safeToBet: false,
    });
    expect(parsed?.marketParity?.receipts[0]).toMatchObject({
      chainKey: "solana",
      lifecycleStatus: "PENDING",
      txRef: "sol-tx",
    });
  });

  it("treats masked awaiting-confirmations parity as preparing in the UI copy", () => {
    expect(
      deriveMarketParityLabel(
        {
          bundleId: "pending:0",
          duelKey: null,
          duelId: null,
          revision: 1,
          requiredChains: ["solana", "bsc"],
          confirmedChains: ["solana"],
          state: "awaiting_confirmations",
          phase: "ANNOUNCEMENT",
          safeToBet: false,
          openedAtMs: null,
          lockedAtMs: null,
          resolvedAtMs: null,
          freezeReason: null,
          updatedAtMs: 123,
          receipts: [],
        },
        {
          parityPreparing: "Preparing next match",
          parityAwaitingConfirmations: "Awaiting final confirmations",
          parityBettingOpen: "Betting open",
          parityLocked: "Locked",
          parityResolved: "Resolved",
          parityFrozen: "Frozen",
        },
      ),
    ).toBe("Preparing next match");
  });

  it("does not let non-public parity override an active live phase", () => {
    expect(
      shouldMarketParityGatePhaseLabel(
        {
          bundleId: "pending:1",
          duelKey: null,
          duelId: null,
          revision: 1,
          requiredChains: ["solana", "bsc"],
          confirmedChains: ["solana"],
          state: "preparing",
          phase: "FIGHTING",
          safeToBet: false,
          openedAtMs: null,
          lockedAtMs: null,
          resolvedAtMs: null,
          freezeReason: null,
          updatedAtMs: 123,
          receipts: [],
        },
        "FIGHTING",
      ),
    ).toBe(false);
  });

  it("still lets non-public parity gate pre-fight phases", () => {
    expect(
      shouldMarketParityGatePhaseLabel(
        {
          bundleId: "pending:2",
          duelKey: null,
          duelId: null,
          revision: 1,
          requiredChains: ["solana", "bsc"],
          confirmedChains: [],
          state: "preparing",
          phase: "ANNOUNCEMENT",
          safeToBet: false,
          openedAtMs: null,
          lockedAtMs: null,
          resolvedAtMs: null,
          freezeReason: null,
          updatedAtMs: 123,
          receipts: [],
        },
        "ANNOUNCEMENT",
      ),
    ).toBe(true);
  });

  it("selects the lifecycle record for a target chain", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "ef".repeat(32),
        duelId: "duel-7",
        phase: "COUNTDOWN",
        winner: "NONE",
        betCloseTime: 456,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: "ef".repeat(32),
          duelId: "duel-7",
          marketId: "sol-market",
          marketRef: "sol-market",
          lifecycleStatus: "LOCKED",
          winner: "NONE",
          betCloseTime: 456,
          contractAddress: null,
          programId: "program-a",
          txRef: null,
          syncedAt: 1,
        },
        {
          chainKey: "avax",
          duelKey: "ef".repeat(32),
          duelId: "duel-7",
          marketId: "avax:12",
          marketRef: "avax:12",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 456,
          contractAddress: "0x123",
          programId: null,
          txRef: null,
          syncedAt: 2,
        },
      ],
      updatedAt: 999,
    });

    expect(selectPredictionMarketLifecycleRecord(payload, "avax")?.marketRef).toBe(
      "avax:12",
    );
    expect(selectPredictionMarketLifecycleRecord(payload, "base")).toBeNull();
  });

  it("parses live and recent settlement overview payloads", () => {
    const duelKey = "12".repeat(32);
    const parsed = parsePredictionMarketsOverviewResponse({
      live: {
        duel: {
          duelKey: `0x${duelKey}`,
          duelId: "duel-live",
          phase: "FIGHTING",
          winner: "NONE",
          betCloseTime: 111,
          agent1Name: "Live Alpha",
          agent2Name: "Live Beta",
        },
        markets: [
          {
            chainKey: "bsc",
            duelKey,
            duelId: "duel-live",
            marketId: "market-live",
            marketRef: "market-live",
            lifecycleStatus: "OPEN",
            winner: "NONE",
            betCloseTime: 111,
            contractAddress: "0x123",
            programId: null,
            txRef: null,
            syncedAt: 1,
          },
        ],
        marketParity: {
          bundleId: "bundle-live",
          duelKey,
          duelId: "duel-live",
          revision: 9,
          requiredChains: ["solana", "bsc"],
          confirmedChains: ["solana", "bsc"],
          state: "open",
          phase: "COUNTDOWN",
          safeToBet: true,
          openedAtMs: 101,
          lockedAtMs: null,
          resolvedAtMs: null,
          freezeReason: null,
          updatedAtMs: 100,
          receipts: [],
        },
        updatedAt: 100,
      },
      recentSettlement: {
        duel: {
          duelKey,
          duelId: "duel-previous",
          phase: "RESOLUTION",
          winner: "A",
          betCloseTime: 222,
          agent1Name: "Settled Alpha",
          agent2Name: "Settled Beta",
        },
        markets: [],
        updatedAt: 90,
      },
      updatedAt: 123,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.live?.duel.duelId).toBe("duel-live");
    expect(parsed?.recentSettlement?.duel.duelId).toBe("duel-previous");
    expect(parsed?.recentSettlement?.duel.agent1Name).toBe("Settled Alpha");
    expect(parsed?.recentSettlement?.duel.agent2Name).toBe("Settled Beta");
    expect(parsed?.live?.marketParity?.state).toBe("open");
    expect(parsed?.live?.marketParity?.safeToBet).toBe(true);
    expect(selectPredictionMarketOverviewRecord(parsed, "bsc", "live")?.marketRef).toBe(
      "market-live",
    );
    expect(
      selectPredictionMarketOverviewRecord(parsed, "bsc", "recentSettlement"),
    ).toBeNull();
  });

  it("parses sync status sequence fields as integers", () => {
    const parsed = parsePredictionMarketSyncStatusResponse({
      sourceEpoch: 7.9,
      sourceLatestSeq: 101.8,
      lastSeenSeq: 99.2,
      lastAppliedSeq: 98.7,
      applyLagMs: 1500,
      sourceEventAgeMs: 2500,
      replayMode: "replay",
      degradedReason: null,
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1234,
      },
      rendererHealthAgeMs: 15,
      lastEventReceivedAt: 2345,
      lastAppliedAt: 3456,
      connectedAt: 4567,
      enabled: true,
    });

    expect(parsed).toMatchObject({
      sourceEpoch: 7,
      sourceLatestSeq: 101,
      lastSeenSeq: 99,
      lastAppliedSeq: 98,
      replayMode: "replay",
    });
  });
});

describe("prediction market ui state", () => {
  it("allows trading but not claims while a market is open", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "aa".repeat(32),
        duelId: "duel-open",
        phase: "ANNOUNCEMENT",
        winner: "NONE",
        betCloseTime: 123,
      },
      markets: [
        {
          chainKey: "bsc",
          duelKey: "aa".repeat(32),
          duelId: "duel-open",
          marketId: "market-open",
          marketRef: "market-open",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 123,
          contractAddress: "0x123",
          programId: null,
          txRef: null,
          syncedAt: 1,
        },
      ],
      updatedAt: 1,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "bsc"),
      EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
    );

    expect(uiState.canTrade).toBe(true);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimKind).toBe("NONE");
  });

  it("keeps locked markets non-tradable and non-claimable", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "bb".repeat(32),
        duelId: "duel-locked",
        phase: "COUNTDOWN",
        winner: "NONE",
        betCloseTime: 456,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: "bb".repeat(32),
          duelId: "duel-locked",
          marketId: "market-locked",
          marketRef: "market-locked",
          lifecycleStatus: "LOCKED",
          winner: "NONE",
          betCloseTime: 456,
          contractAddress: null,
          programId: "program-a",
          txRef: null,
          syncedAt: 2,
        },
      ],
      updatedAt: 2,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "solana"),
      {
        aShares: 10n,
        bShares: 20n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 30n,
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimableAmount).toBe(0n);
  });

  it("keeps proposed markets non-tradable and non-claimable", () => {
    const uiState = derivePredictionMarketUiState(
      {
        chainKey: "bsc",
        duelKey: "11".repeat(32),
        duelId: "duel-proposed",
        marketId: "market-proposed",
        marketRef: "market-proposed",
        lifecycleStatus: "PROPOSED",
        winner: "NONE",
        betCloseTime: 456,
        contractAddress: "0x123",
        programId: null,
        txRef: null,
        syncedAt: 2,
        metadata: {
          proposalId: "proposal-proposed",
          challengeWindowEndsAt: 999,
        },
      },
      {
        aShares: 10n,
        bShares: 20n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 30n,
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimableAmount).toBe(0n);
  });

  it("keeps challenged markets fail-closed", () => {
    const uiState = derivePredictionMarketUiState(
      {
        chainKey: "solana",
        duelKey: "22".repeat(32),
        duelId: "duel-challenged",
        marketId: "market-challenged",
        marketRef: "market-challenged",
        lifecycleStatus: "CHALLENGED",
        winner: "NONE",
        betCloseTime: 789,
        contractAddress: null,
        programId: "program-a",
        txRef: null,
        syncedAt: 3,
        metadata: {
          proposalId: "proposal-challenged",
          challengeWindowEndsAt: 1000,
        },
      },
      EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimKind).toBe("NONE");
  });

  it("enables claims for resolved winner A balances", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "cc".repeat(32),
        duelId: "duel-a",
        phase: "RESOLUTION",
        winner: "A",
        betCloseTime: 789,
      },
      markets: [
        {
          chainKey: "avax",
          duelKey: "cc".repeat(32),
          duelId: "duel-a",
          marketId: "market-a",
          marketRef: "market-a",
          lifecycleStatus: "RESOLVED",
          winner: "A",
          betCloseTime: 789,
          contractAddress: "0xabc",
          programId: null,
          txRef: null,
          syncedAt: 3,
        },
      ],
      updatedAt: 3,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "avax"),
      {
        aShares: 25n,
        bShares: 0n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 0n,
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("WINNER_A");
    expect(uiState.claimableAmount).toBe(25n);
  });

  it("enables claims for resolved winner B balances", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "dd".repeat(32),
        duelId: "duel-b",
        phase: "RESOLUTION",
        winner: "B",
        betCloseTime: 999,
      },
      markets: [
        {
          chainKey: "bsc",
          duelKey: "dd".repeat(32),
          duelId: "duel-b",
          marketId: "market-b",
          marketRef: "market-b",
          lifecycleStatus: "RESOLVED",
          winner: "B",
          betCloseTime: 999,
          contractAddress: "0xdef",
          programId: null,
          txRef: null,
          syncedAt: 4,
        },
      ],
      updatedAt: 4,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "bsc"),
      {
        aShares: 0n,
        bShares: 42n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 0n,
      },
    );

    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("WINNER_B");
    expect(uiState.claimableAmount).toBe(42n);
  });

  it("enables cancelled-market refunds from refundable balances", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "ee".repeat(32),
        duelId: "duel-cancelled",
        phase: "RESOLUTION",
        winner: "NONE",
        betCloseTime: 1000,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: "ee".repeat(32),
          duelId: "duel-cancelled",
          marketId: "market-cancelled",
          marketRef: "market-cancelled",
          lifecycleStatus: "CANCELLED",
          winner: "NONE",
          betCloseTime: 1000,
          contractAddress: null,
          programId: "program-b",
          txRef: null,
          syncedAt: 5,
        },
      ],
      updatedAt: 5,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "solana"),
      {
        aShares: 0n,
        bShares: 0n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 11n,
      },
    );

    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("REFUND");
    expect(uiState.claimableAmount).toBe(11n);
  });

  it("falls back to chain-local lifecycle state when normalized state is missing", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
      {
        lifecycleStatus: "OPEN",
        winner: "NONE",
      },
    );

    expect(uiState.hasCanonicalLifecycle).toBe(false);
    expect(uiState.lifecycleStatus).toBe("OPEN");
    expect(uiState.canTrade).toBe(true);
  });

  it("keeps resolved EVM markets non-claimable when the winner has no shares", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      {
        aShares: 0n,
        bShares: 0n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 0n,
      },
      {
        lifecycleStatus: "RESOLVED",
        winner: "A",
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimableAmount).toBe(0n);
  });

  it("treats cancelled Solana locked lamports as refundable even without winning shares", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      {
        aShares: 0n,
        bShares: 0n,
        aStake: 0n,
        bStake: 0n,
        refundableAmount: 9n,
      },
      {
        lifecycleStatus: "CANCELLED",
        winner: "NONE",
      },
    );

    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("REFUND");
    expect(uiState.claimableAmount).toBe(9n);
  });

  it("enables loser cleanup claims for resolved stale EVM positions", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      {
        aShares: 0n,
        bShares: 12n,
        aStake: 0n,
        bStake: 7n,
        refundableAmount: 0n,
      },
      {
        lifecycleStatus: "RESOLVED",
        winner: "A",
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("LOSER_CLEANUP");
    expect(uiState.claimableAmount).toBe(0n);
  });
});
