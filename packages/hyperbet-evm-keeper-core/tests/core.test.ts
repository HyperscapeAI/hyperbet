import { describe, expect, it } from "bun:test";
import {
  buildEvmPredictionMarketLifecycleRecord,
  isAllowedAppOrigin,
  verifyEvmRecordedBet,
} from "../index";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
} from "viem";

describe("isAllowedAppOrigin", () => {
  it("allows exact loopback hosts and rejects lookalikes", () => {
    expect(isAllowedAppOrigin("http://localhost:3000", [])).toBe(true);
    expect(isAllowedAppOrigin("http://127.0.0.1:4173", [])).toBe(true);
    expect(isAllowedAppOrigin("http://[::1]:3000", [])).toBe(true);
    expect(isAllowedAppOrigin("https://localhost.attacker.tld", [])).toBe(false);
  });
});

describe("buildEvmPredictionMarketLifecycleRecord", () => {
  it("preserves fallback winner when parser snapshot is missing", () => {
    const record = buildEvmPredictionMarketLifecycleRecord({
      chainKey: "bsc",
      duelKey: null,
      duelId: null,
      betCloseTime: 123,
      snapshot: null,
      fallbackHealth: {
        chainKey: "bsc",
        duelId: "duel-1",
        duelKey: "abcd",
        marketRef:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        lifecycleStatus: "RESOLVED",
        winner: "A",
        fairValue: null,
        bidPrice: null,
        askPrice: null,
        bidUnits: 0,
        askUnits: 0,
        openOrderCount: 0,
        inventoryYes: 0,
        inventoryNo: 0,
        openYes: 0,
        openNo: 0,
        netExposure: 0,
        grossExposure: 0,
        drawdownBps: 0,
        quoteAgeMs: null,
        lastStreamAtMs: null,
        lastOracleAtMs: null,
        lastRpcAtMs: null,
        circuitBreakerReason: null,
        lastResolvedAtMs: null,
        lastClaimAtMs: null,
        recovery: [],
      },
      contractAddress: "0x123",
      syncedAt: 456,
    });

    expect(record.lifecycleStatus).toBe("RESOLVED");
    expect(record.winner).toBe("A");
    expect(record.marketRef).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("prefers oracle in-flight status and reserved metadata when present", () => {
    const record = buildEvmPredictionMarketLifecycleRecord({
      chainKey: "avax",
      duelKey: "abcd",
      duelId: "duel-2",
      betCloseTime: 999,
      snapshot: {
        marketKey:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        currentDuel: {
          status: 4,
          activeProposalId:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          proposalProposedAt: 2_000,
          proposalChallenged: false,
          disputeWindowSeconds: 300,
        },
        currentMatch: {
          status: 2,
          winner: 0,
          yesPool: "100",
          noPool: "200",
        },
      },
      fallbackHealth: null,
      contractAddress: "0x456",
      syncedAt: 777,
    });

    expect(record.lifecycleStatus).toBe("PROPOSED");
    expect(record.metadata).toMatchObject({
      proposalId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      challengeWindowEndsAt: 2_300,
      finalizedAt: null,
      cancellationReason: null,
      proposalChallenged: false,
    });
  });
});

describe("verifyEvmRecordedBet", () => {
  it("derives canonical economics from a verified placeOrder tx", async () => {
    const duelKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const marketKey =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const maker = "0x00000000000000000000000000000000000000aa";
    const contractAddress = "0x00000000000000000000000000000000000000bb";
    const txHash =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    const abi = parseAbi([
      "function placeOrder(bytes32 duelKey, uint8 marketKind, uint8 side, uint16 price, uint128 amount, uint8 orderFlags)",
    ]);
    const eventAbi = parseAbiItem(
      "event OrderPlaced(bytes32 indexed marketKey, uint64 indexed orderId, address indexed maker, uint8 side, uint16 price, uint128 amount)",
    );
    const txInput = encodeFunctionData({
      abi,
      functionName: "placeOrder",
      args: [duelKey as `0x${string}`, 0n, 1n, 600, 1000n, 1n],
    });
    const topics = encodeEventTopics({
      abi: [eventAbi],
      eventName: "OrderPlaced",
      args: {
        marketKey: marketKey as `0x${string}`,
        orderId: 1n,
        maker: maker as `0x${string}`,
      },
    });
    const data = encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint16" },
        { type: "uint128" },
      ],
      [1, 600, 1000n],
    );
    const client = {
      async getTransactionReceipt() {
        return {
          status: "success",
          logs: [
            {
              address: contractAddress,
              topics,
              data,
            },
          ],
        };
      },
      async getTransaction() {
        return {
          from: maker,
          to: contractAddress,
          input: txInput,
        };
      },
      async readContract() {
        return 50n;
      },
    };

    const record = await verifyEvmRecordedBet(
      client as any,
      contractAddress,
      "bsc",
      maker,
      txHash,
      {
        duelKey: duelKey.slice(2),
        marketRef: marketKey,
      },
    );

    expect(record).not.toBeNull();
    expect(record?.marketRef).toBe(marketKey);
    expect(record?.duelKey).toBe(duelKey.slice(2));
    expect(record?.sourceAsset).toBe("BNB");
    expect(record?.feeBps).toBe(50);
    expect(record?.pointsBasisAmount).toBeGreaterThan(0);
  });
});
