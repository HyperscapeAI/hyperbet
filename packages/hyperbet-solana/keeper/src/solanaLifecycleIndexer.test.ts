import { describe, expect, test } from "bun:test";

import bs58 from "bs58";

import {
  collectFinalizedSignatureBackfill,
  digestLifecycleFacts,
  normalizeLifecycleFact,
  resolveLifecycleIndexStartSlot,
  unitsReleasedByVaultRefund,
  verifyClaimLifecycleAccounting,
  verifyLosingBalanceCleanupAccounting,
  type SignaturePageEntry,
  type SignaturePageRequest,
  type SolanaLifecycleFact,
} from "./solanaLifecycleIndexer";

function signature(index: number): string {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(index, 0);
  bytes.writeUInt32LE((index ^ 0xa5a5a5a5) >>> 0, 4);
  return bs58.encode(bytes);
}

const MARKET = bs58.encode(Buffer.alloc(32, 7));
const WALLET = bs58.encode(Buffer.alloc(32, 9));

function entry(
  index: number,
  slot: number,
  overrides: Partial<SignaturePageEntry> = {},
): SignaturePageEntry {
  return {
    signature: signature(index),
    slot,
    blockTime: 1_700_000_000 + slot,
    err: null,
    confirmationStatus: "finalized",
    ...overrides,
  };
}

function pagedHistory(history: SignaturePageEntry[]) {
  return async ({ before, limit }: SignaturePageRequest) => {
    const start = before
      ? history.findIndex((item) => item.signature === before) + 1
      : 0;
    return history.slice(start, start + limit);
  };
}

describe("finalized Solana lifecycle signature backfill", () => {
  test("paginates to a durable checkpoint and returns every new signature oldest-first", async () => {
    const history = [
      entry(9, 109),
      entry(8, 108),
      entry(7, 107, { err: { InstructionError: [0, "Custom"] } }),
      entry(6, 106),
      entry(5, 105),
      entry(4, 104),
    ];

    const result = await collectFinalizedSignatureBackfill({
      fetchPage: pagedHistory(history),
      checkpointSignature: signature(4),
      checkpointSlot: 104,
      startSlot: 100,
      minimumAvailableSlot: 90,
      pageSize: 2,
    });

    expect(result.map((item) => item.signature)).toEqual([
      signature(5),
      signature(6),
      signature(7),
      signature(8),
      signature(9),
    ]);
    expect(
      result.find((item) => item.signature === signature(7))?.succeeded,
    ).toBe(false);
  });

  test("bootstraps exactly at the configured launch slot", async () => {
    const result = await collectFinalizedSignatureBackfill({
      fetchPage: pagedHistory([
        entry(4, 104),
        entry(3, 103),
        entry(2, 102),
        entry(1, 99),
      ]),
      checkpointSignature: null,
      checkpointSlot: null,
      startSlot: 102,
      minimumAvailableSlot: 80,
      pageSize: 2,
    });

    expect(result.map((item) => item.slot)).toEqual([102, 103, 104]);
  });

  test("uses the durable checkpoint instead of the original start slot after ledger pruning", async () => {
    const result = await collectFinalizedSignatureBackfill({
      fetchPage: pagedHistory([entry(4, 104), entry(3, 103)]),
      checkpointSignature: signature(3),
      checkpointSlot: 103,
      startSlot: 10,
      minimumAvailableSlot: 100,
    });
    expect(result.map((item) => item.signature)).toEqual([signature(4)]);
  });

  test("fails closed on retention loss, missing checkpoints, ordering drift, and non-finalized data", async () => {
    await expect(
      collectFinalizedSignatureBackfill({
        fetchPage: pagedHistory([]),
        checkpointSignature: null,
        checkpointSlot: null,
        startSlot: 10,
        minimumAvailableSlot: 11,
      }),
    ).rejects.toThrow("unavailable before slot 11");

    await expect(
      collectFinalizedSignatureBackfill({
        fetchPage: pagedHistory([entry(3, 103), entry(2, 102)]),
        checkpointSignature: signature(1),
        checkpointSlot: 101,
        startSlot: 100,
        minimumAvailableSlot: 90,
      }),
    ).rejects.toThrow("checkpoint is no longer present");

    await expect(
      collectFinalizedSignatureBackfill({
        fetchPage: pagedHistory([entry(2, 102), entry(3, 103)]),
        checkpointSignature: null,
        checkpointSlot: null,
        startSlot: 100,
        minimumAvailableSlot: 90,
      }),
    ).rejects.toThrow("out of newest-first order");

    await expect(
      collectFinalizedSignatureBackfill({
        fetchPage: pagedHistory([
          entry(2, 102, { confirmationStatus: "confirmed" }),
        ]),
        checkpointSignature: null,
        checkpointSlot: null,
        startSlot: 100,
        minimumAvailableSlot: 90,
      }),
    ).rejects.toThrow("non-finalized slot");
  });

  test("bounds pagination so an RPC cannot force an unbounded poll", async () => {
    let page = 0;
    await expect(
      collectFinalizedSignatureBackfill({
        fetchPage: async () => [entry(10 - page, 110 - page++)],
        checkpointSignature: signature(1),
        checkpointSlot: 101,
        startSlot: 100,
        minimumAvailableSlot: 90,
        pageSize: 1,
        maxPages: 2,
      }),
    ).rejects.toThrow("exceeded 2 page");
  });
});

describe("Solana lifecycle index configuration and facts", () => {
  test("requires an explicit, exact mainnet launch slot", () => {
    expect(
      resolveLifecycleIndexStartSlot({ value: "123456", required: true }),
    ).toBe(123456);
    expect(
      resolveLifecycleIndexStartSlot({ value: undefined, required: false }),
    ).toBe(0);
    expect(() =>
      resolveLifecycleIndexStartSlot({ value: undefined, required: true }),
    ).toThrow("required for mainnet");
    expect(() =>
      resolveLifecycleIndexStartSlot({ value: "1.5", required: false }),
    ).toThrow("must be an integer");
    expect(() =>
      resolveLifecycleIndexStartSlot({
        value: String(Number.MAX_SAFE_INTEGER + 1),
        required: false,
      }),
    ).toThrow("safe non-negative integer");
  });

  test("normalizes exact lifecycle facts and produces a deterministic digest", () => {
    const facts: SolanaLifecycleFact[] = [
      {
        kind: "ORDER_MATCHED",
        marketPda: MARKET,
        makerOrderId: "7",
        takerOrderId: "9",
        price: 620,
        amountUnits: "40000",
      },
      {
        kind: "CANCELLATION_REFUND",
        marketPda: MARKET,
        wallet: WALLET,
        amountLamports: "9007199254740993",
        feeLamports: "0",
        status: "cancelled",
        winner: "none",
      },
      {
        kind: "LOSING_BALANCE_CLOSED",
        marketPda: MARKET,
        wallet: WALLET,
        side: 2,
        amountUnits: "40000",
        amountLamports: "16000",
        status: "resolved",
        winner: "a",
      },
      {
        kind: "FILLED_ORDER_CLOSED",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
      },
      {
        kind: "PRICE_LEVEL_CLOSED",
        marketPda: MARKET,
        wallet: WALLET,
        side: 2,
        price: 620,
      },
      {
        kind: "RESOLVED_TRADE_FEES_WITHDRAWN",
        marketPda: MARKET,
        treasury: MARKET,
        marketMaker: WALLET,
        submitter: WALLET,
        treasuryFeeLamports: "6",
        marketMakerFeeLamports: "6",
        status: "resolved",
        winner: "a",
      },
    ];

    expect(normalizeLifecycleFact(facts[0]!)).toEqual(facts[0]);
    expect(digestLifecycleFacts(facts)).toBe(digestLifecycleFacts(facts));
    expect(digestLifecycleFacts(facts)).not.toBe(
      digestLifecycleFacts([...facts].reverse()),
    );
  });

  test("rejects malformed or contradictory facts", () => {
    expect(() =>
      normalizeLifecycleFact({
        kind: "ORDER_MATCHED",
        marketPda: MARKET,
        makerOrderId: "7",
        takerOrderId: "9",
        price: 620,
        amountUnits: "1",
      }),
    ).toThrow("positive multiple of 1000");

    expect(() =>
      normalizeLifecycleFact({
        kind: "CANCELLATION_REFUND",
        marketPda: MARKET,
        wallet: WALLET,
        amountLamports: "1000",
        feeLamports: "1",
        status: "cancelled",
        winner: "none",
      }),
    ).toThrow("fee-free cancellation refund");

    expect(() =>
      normalizeLifecycleFact({
        kind: "MARKET_SYNCED",
        marketPda: MARKET,
        status: "resolved",
        winner: "none",
      }),
    ).toThrow("lifecycle/status invariant");

    expect(() =>
      normalizeLifecycleFact({
        kind: "TAKER_EXECUTION",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
        side: 1,
        price: 600,
        amountUnits: "0",
        releasedAmountUnits: "0",
        amountLamports: "0",
        feeLamports: "0",
        refundLamports: "0",
        treasuryFeeLamports: "0",
        marketMakerFeeLamports: "0",
        selfTradeTriggered: false,
      }),
    ).toThrow("unit/value invariant");

    expect(() =>
      normalizeLifecycleFact({
        kind: "LOSING_BALANCE_CLOSED",
        marketPda: MARKET,
        wallet: WALLET,
        side: 1,
        amountUnits: "40000",
        amountLamports: "16000",
        status: "resolved",
        winner: "a",
      }),
    ).toThrow("resolved losing value");

    expect(() =>
      normalizeLifecycleFact({
        kind: "RESOLVED_TRADE_FEES_WITHDRAWN",
        marketPda: MARKET,
        treasury: MARKET,
        marketMaker: WALLET,
        submitter: WALLET,
        treasuryFeeLamports: "0",
        marketMakerFeeLamports: "0",
        status: "resolved",
        winner: "a",
      }),
    ).toThrow("positive canonical resolved release");

    expect(() =>
      normalizeLifecycleFact({
        kind: "CANCELLATION_REFUND",
        marketPda: MARKET,
        wallet: WALLET,
        amountLamports: "1000",
        feeLamports: "0",
        treasuryFeeLamports: "600",
        marketMakerFeeLamports: "500",
        status: "cancelled",
        winner: "none",
      }),
    ).toThrow("fee-free cancellation refund");

    expect(() =>
      normalizeLifecycleFact({
        kind: "LOSING_BALANCE_CLOSED",
        marketPda: MARKET,
        wallet: WALLET,
        side: 2,
        amountUnits: "0",
        amountLamports: "0",
        status: "resolved",
        winner: "a",
      }),
    ).toThrow("resolved losing value");

    expect(() =>
      normalizeLifecycleFact({
        kind: "FILLED_ORDER_CLOSED",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
        amountLamports: "1",
      }),
    ).toThrow("invalid amountLamports");

    expect(() =>
      normalizeLifecycleFact({
        kind: "PRICE_LEVEL_CLOSED",
        marketPda: MARKET,
        wallet: WALLET,
        side: 2,
        price: 620,
        amountLamports: "1",
      }),
    ).toThrow("invalid amountLamports");
  });

  test("derives exact cancel/reclaim units and rejects rounded refunds", () => {
    expect(
      unitsReleasedByVaultRefund({ side: 1, price: 600, lamports: 24000n }),
    ).toBe(40000n);
    expect(
      unitsReleasedByVaultRefund({ side: 2, price: 600, lamports: 16000n }),
    ).toBe(40000n);
    expect(() =>
      unitsReleasedByVaultRefund({ side: 1, price: 600, lamports: 1n }),
    ).toThrow("exact units");
  });

  test("classifies fee-free refunds and verifies winnings-fee conservation", () => {
    expect(
      verifyClaimLifecycleAccounting({
        status: "cancelled",
        winner: "none",
        payoutLamports: 60_000n,
        feeLamports: 0n,
        winningsFeeBps: 200,
      }),
    ).toBe("CANCELLATION_REFUND");
    expect(
      verifyClaimLifecycleAccounting({
        status: "resolved",
        winner: "a",
        payoutLamports: 98_000n,
        feeLamports: 2_000n,
        winningsFeeBps: 200,
      }),
    ).toBe("CLAIM_PAYOUT");
    expect(() =>
      verifyClaimLifecycleAccounting({
        status: "resolved",
        winner: "b",
        payoutLamports: 98_001n,
        feeLamports: 1_999n,
        winningsFeeBps: 200,
      }),
    ).toThrow("fee snapshot");
    expect(() =>
      verifyClaimLifecycleAccounting({
        status: "cancelled",
        winner: "none",
        payoutLamports: 100_000n,
        feeLamports: 1n,
        winningsFeeBps: 200,
      }),
    ).toThrow("fee-free refunds");
  });

  test("classifies only exact loser-side cleanup accounting", () => {
    expect(
      verifyLosingBalanceCleanupAccounting({
        status: "resolved",
        winner: "a",
        aShares: 0n,
        bShares: 40_000n,
        aLockedLamports: 0n,
        bLockedLamports: 16_000n,
      }),
    ).toEqual({ side: 2, amountUnits: 40_000n, amountLamports: 16_000n });

    expect(
      verifyLosingBalanceCleanupAccounting({
        status: "resolved",
        winner: "b",
        aShares: 40_000n,
        bShares: 0n,
        aLockedLamports: 24_000n,
        bLockedLamports: 0n,
      }),
    ).toEqual({ side: 1, amountUnits: 40_000n, amountLamports: 24_000n });

    expect(() =>
      verifyLosingBalanceCleanupAccounting({
        status: "resolved",
        winner: "a",
        aShares: 1_000n,
        bShares: 40_000n,
        aLockedLamports: 600n,
        bLockedLamports: 16_000n,
      }),
    ).toThrow("only nonempty resolved losing value");
    expect(() =>
      verifyLosingBalanceCleanupAccounting({
        status: "cancelled",
        winner: "none",
        aShares: 0n,
        bShares: 40_000n,
        aLockedLamports: 0n,
        bLockedLamports: 16_000n,
      }),
    ).toThrow("only nonempty resolved losing value");
    expect(() =>
      verifyLosingBalanceCleanupAccounting({
        status: "resolved",
        winner: "a",
        aShares: 0n,
        bShares: 1n,
        aLockedLamports: 0n,
        bLockedLamports: 1n,
      }),
    ).toThrow("lot size");
  });
});
