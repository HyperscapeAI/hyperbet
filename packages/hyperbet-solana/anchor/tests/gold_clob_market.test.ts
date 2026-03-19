import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";

import {
  ORDER_BEHAVIOR_GTC,
  ORDER_BEHAVIOR_IOC,
  ORDER_BEHAVIOR_POST_ONLY,
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  cancelClobOrder,
  cancelDuel,
  claimClobWinnings,
  continueClobOrder,
  createOpenMarketFixture,
  duelStatusBettingOpen,
  duelStatusLocked,
  ensureClobConfig,
  ensureOracleReady,
  finalizeDuelResult,
  hasProgramError,
  initializeCanonicalMarket,
  placeClobOrder,
  proposeDuelResult,
  reclaimClobOrder,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  writableAccount,
  sleep,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { GoldClobMarket } from "../target/types/gold_clob_market";

describe("gold_clob_market (native SOL settlement)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace
    .GoldClobMarket as Program<GoldClobMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;

  async function lockFixtureMarket(
    market: { duelKey: number[]; duelState: anchor.web3.PublicKey; marketState: anchor.web3.PublicKey },
    metadataUri: string,
  ): Promise<void> {
    const duelStateAccount = await fightProgram.account.duelState.fetch(
      market.duelState,
    );
    const betCloseTs = Number(duelStateAccount.betCloseTs);
    const waitMs = Math.max(
      0,
      (betCloseTs - Math.floor(Date.now() / 1000) + 1) * 1_000,
    );
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    await upsertDuel(fightProgram, authority, market.duelKey, {
      status: duelStatusLocked(),
      betOpenTs: Number(duelStateAccount.betOpenTs),
      betCloseTs,
      duelStartTs: Number(duelStateAccount.duelStartTs),
      metadataUri,
    });
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);
  }

  it("initializes one deterministic duel market and rejects duplicate init", async () => {
    await ensureOracleReady(fightProgram, authority, authority.publicKey);
    const config = await ensureClobConfig(clobProgram, authority);

    const duelKey = uniqueDuelKey("deterministic-market");
    const now = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 15,
      betCloseTs: now + 600,
      duelStartTs: now + 660,
      metadataUri: "https://hyperscape.gg/tests/clob/init",
    });
    const market = await initializeCanonicalMarket(
      clobProgram,
      authority,
      duelState,
      duelKey,
      config,
    );

    const marketState = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.ok(marketState.duelState.equals(duelState));
    assert.deepStrictEqual([...marketState.duelKey], duelKey);
    assert.deepStrictEqual(marketState.status, { open: {} });
    assert.strictEqual(marketState.marketKind, 1);
    assert.strictEqual(marketState.nextOrderId.toString(), "1");
    assert.strictEqual(marketState.bestBid, 0);
    assert.strictEqual(marketState.bestAsk, 1000);

    try {
      await initializeCanonicalMarket(
        clobProgram,
        authority,
        duelState,
        duelKey,
        config,
      );
      assert.fail("duplicate canonical market initialization succeeded");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(
        message.includes("already in use") ||
          message.includes("already initialized"),
        `expected duplicate PDA initialization failure, got ${message}`,
      );
    }
  });

  it("charges trade fees only on executed taker size and enforces FIFO at a shared price level", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    const makerOne = Keypair.generate();
    const makerTwo = Keypair.generate();
    const taker = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 2),
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, makerOne.publicKey, 5),
      airdrop(provider.connection, makerTwo.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fifo-market"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
      },
    );

    const treasuryBefore = await provider.connection.getBalance(
      treasury.publicKey,
    );
    const marketMakerBefore = await provider.connection.getBalance(
      marketMaker.publicKey,
    );

    const firstAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: makerOne,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const secondAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: makerTwo,
      orderId: 2,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
      remainingAccounts: [writableAccount(firstAsk.order)],
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 3,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(firstAsk.restingLevel),
        writableAccount(firstAsk.order),
        writableAccount(firstAsk.userBalance),
      ],
    });

    const priceLevel = await clobProgram.account.priceLevel.fetch(
      firstAsk.restingLevel,
    );
    const makerOneOrder = await clobProgram.account.order.fetch(firstAsk.order);
    const makerTwoOrder = await clobProgram.account.order.fetch(
      secondAsk.order,
    );
    const makerOneBalance = await clobProgram.account.userBalance.fetch(
      firstAsk.userBalance,
    );
    const makerTwoBalance = await clobProgram.account.userBalance.fetch(
      secondAsk.userBalance,
    );
    const takerBalance = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );

    assert.strictEqual(priceLevel.headOrderId.toString(), "2");
    assert.strictEqual(priceLevel.tailOrderId.toString(), "2");
    assert.strictEqual(priceLevel.totalOpen.toString(), "1000");
    assert.strictEqual(makerOneOrder.filled.toString(), "1000");
    assert.strictEqual(makerOneOrder.active, false);
    assert.strictEqual(makerTwoOrder.filled.toString(), "0");
    assert.strictEqual(makerTwoOrder.active, true);
    assert.strictEqual(makerOneBalance.bShares.toString(), "1000");
    assert.strictEqual(makerTwoBalance.bShares.toString(), "0");
    assert.strictEqual(takerBalance.aShares.toString(), "1000");

    const treasuryAfter = await provider.connection.getBalance(
      treasury.publicKey,
    );
    const marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 6);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 6);
  });

  it("prevents direct self-crosses with cancel-taker telemetry", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    const selfTrader = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 2),
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, selfTrader.publicKey, 8),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("self-cross-direct"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
      },
    );

    const [treasuryBefore, marketMakerBefore] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);

    const ask = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(ask.restingLevel),
        writableAccount(ask.order),
        writableAccount(ask.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logText = (tx?.meta?.logMessages ?? []).join("\n");
    assert.ok(
      logText.includes("policy=cancel-taker prevented=true"),
      `expected self-trade detection log, got logs: ${logText}`,
    );

    const priceLevel = await clobProgram.account.priceLevel.fetch(ask.restingLevel);
    const makerOrder = await clobProgram.account.order.fetch(ask.order);
    const balance = await clobProgram.account.userBalance.fetch(ask.userBalance);
    assert.strictEqual(priceLevel.totalOpen.toString(), "1000");
    assert.strictEqual(makerOrder.filled.toString(), "0");
    assert.strictEqual(makerOrder.active, true);
    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(bid.order),
      null,
    );
    assert.strictEqual(balance.aShares.toString(), "0");
    assert.strictEqual(balance.bShares.toString(), "0");
    const [treasuryAfter, marketMakerAfter] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);
    assert.strictEqual(treasuryAfter - treasuryBefore, 0);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 0);
  });

  it("cancels the taker remainder when a later self-cross candidate appears", async () => {
    const selfTrader = Keypair.generate();
    const externalMaker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, selfTrader.publicKey, 8),
      airdrop(provider.connection, externalMaker.publicKey, 8),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("self-cross-partial") },
    );

    const externalAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: externalMaker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 4000,
    });

    const selfAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 2,
      side: SIDE_ASK,
      price: 600,
      amount: 7000,
      remainingAccounts: [writableAccount(externalAsk.order)],
    });

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 3,
      side: SIDE_BID,
      price: 600,
      amount: 8000,
      remainingAccounts: [
        writableAccount(externalAsk.restingLevel),
        writableAccount(externalAsk.order),
        writableAccount(externalAsk.userBalance),
        writableAccount(externalAsk.restingLevel),
        writableAccount(selfAsk.order),
        writableAccount(selfAsk.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const selfTradeLogCount = (tx?.meta?.logMessages ?? []).filter((line) =>
      line.includes("policy=cancel-taker prevented=true"),
    ).length;
    assert.strictEqual(selfTradeLogCount, 1);

    const externalOrderState = await clobProgram.account.order.fetch(externalAsk.order);
    const selfOrderState = await clobProgram.account.order.fetch(selfAsk.order);
    const takerBalance = await clobProgram.account.userBalance.fetch(bid.userBalance);
    assert.strictEqual(externalOrderState.filled.toString(), "4000");
    assert.strictEqual(externalOrderState.active, false);
    assert.strictEqual(selfOrderState.filled.toString(), "0");
    assert.strictEqual(selfOrderState.active, true);
    assert.strictEqual(takerBalance.aShares.toString(), "4000");
  });

  it("keeps mixed-user fills free of self-trade policy logs", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 8),
      airdrop(provider.connection, taker.publicKey, 8),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("self-cross-mixed") },
    );

    const ask = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 5000,
    });

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 5000,
      remainingAccounts: [
        writableAccount(ask.restingLevel),
        writableAccount(ask.order),
        writableAccount(ask.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const hasSelfTradeLog = (tx?.meta?.logMessages ?? []).some((line) =>
      line.includes("policy=cancel-taker prevented=true"),
    );
    assert.strictEqual(hasSelfTradeLog, false);
  });

  it("rejects unsupported order behaviors", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 5);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("invalid-order-behavior") },
    );

    try {
      await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: trader,
        orderId: 1,
        side: SIDE_BID,
        price: 500,
        amount: 1000,
        orderBehavior: 99,
      });
      assert.fail("invalid order behavior was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidOrderBehavior"),
        `expected InvalidOrderBehavior, got ${String(error)}`,
      );
    }
  });

  it("rejects post-only orders that would cross the book", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("post-only-cross") },
    );

    await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    try {
      await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
        orderId: 2,
        side: SIDE_BID,
        price: 600,
        amount: 1000,
        orderBehavior: ORDER_BEHAVIOR_POST_ONLY,
      });
      assert.fail("crossing post-only order was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "PostOnlyWouldCross"),
        `expected PostOnlyWouldCross, got ${String(error)}`,
      );
    }

    const marketState = await clobProgram.account.marketState.fetch(market.marketState);
    assert.strictEqual(marketState.nextOrderId.toString(), "2");
  });

  it("refunds unmatched IOC remainder instead of resting it", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    const trader = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 2),
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, trader.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("ioc-remainder"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
      },
    );

    const [treasuryBefore, marketMakerBefore] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
      orderId: 1,
      side: SIDE_BID,
      price: 500,
      amount: 1000,
      orderBehavior: ORDER_BEHAVIOR_IOC,
    });

    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(bid.order),
      null,
    );
    const marketState = await clobProgram.account.marketState.fetch(market.marketState);
    assert.strictEqual(marketState.bestBid, 0);
    assert.strictEqual(marketState.bestAsk, 1000);
    const [treasuryAfter, marketMakerAfter] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);
    assert.strictEqual(treasuryAfter - treasuryBefore, 0);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 0);
  });

  it("charges fees only on the filled size when a partial GTC remainder is later cancelled", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 2),
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("partial-fill-cancel-fees"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
      },
    );

    const [treasuryBefore, marketMakerBefore] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 2000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    let treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    let marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 6);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 6);

    await cancelClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
    });

    const takerOrderAfterCancel = await clobProgram.account.order.fetch(
      takerBid.order,
    );
    assert.strictEqual(takerOrderAfterCancel.active, false);
    assert.strictEqual(takerOrderAfterCancel.continuationPending, false);
    treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 6);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 6);
  });

  it("requires explicit continuation when a GTC order exhausts the match bound", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 2),
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("gtc-continuation"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
      },
    );

    const makerOrders: Array<{
      order: anchor.web3.PublicKey;
      restingLevel: anchor.web3.PublicKey;
      userBalance: anchor.web3.PublicKey;
    }> = [];

    for (let orderId = 1; orderId <= 55; orderId += 1) {
      const placed = await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: maker,
        orderId,
        side: SIDE_ASK,
        price: 600,
        amount: 1000,
        remainingAccounts:
          orderId > 1
            ? [writableAccount(makerOrders[makerOrders.length - 1]!.order)]
            : [],
      });
      makerOrders.push(placed);
    }

    const initialMatchAccounts = makerOrders.slice(0, 50).flatMap((entry) => [
      writableAccount(entry.restingLevel),
      writableAccount(entry.order),
      writableAccount(entry.userBalance),
    ]);
    const [treasuryBefore, marketMakerBefore] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);
    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 56,
      side: SIDE_BID,
      price: 600,
      amount: 55_000,
      orderBehavior: ORDER_BEHAVIOR_GTC,
      remainingAccounts: initialMatchAccounts,
    });

    const pendingOrder = await clobProgram.account.order.fetch(takerBid.order);
    assert.strictEqual(pendingOrder.active, true);
    assert.strictEqual(pendingOrder.continuationPending, true);
    assert.strictEqual(pendingOrder.amount.toString(), "5000");
    let treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    let marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 300);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 300);

    const continuationAccounts = makerOrders.slice(50).flatMap((entry) => [
      writableAccount(entry.restingLevel),
      writableAccount(entry.order),
      writableAccount(entry.userBalance),
    ]);
    await continueClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 56,
      side: SIDE_BID,
      price: 600,
      remainingAccounts: continuationAccounts,
    });

    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(takerBid.order),
      null,
    );
    const takerBalance = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerBalance.aShares.toString(), "55000");
    treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 330);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 330);
  });

  it("reclaims continuation-pending remainder after the market locks", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const closeSoon = Math.floor(Date.now() / 1000) + 60;
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("continuation-reclaim"),
        betOpenTs: closeSoon - 30,
        betCloseTs: closeSoon,
        duelStartTs: closeSoon + 1,
      },
    );

    const makerOrders: Array<{
      order: anchor.web3.PublicKey;
      restingLevel: anchor.web3.PublicKey;
      userBalance: anchor.web3.PublicKey;
    }> = [];

    for (let orderId = 1; orderId <= 55; orderId += 1) {
      const placed = await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: maker,
        orderId,
        side: SIDE_ASK,
        price: 600,
        amount: 1000,
        remainingAccounts:
          orderId > 1
            ? [writableAccount(makerOrders[makerOrders.length - 1]!.order)]
            : [],
      });
      makerOrders.push(placed);
    }

    const initialMatchAccounts = makerOrders.slice(0, 50).flatMap((entry) => [
      writableAccount(entry.restingLevel),
      writableAccount(entry.order),
      writableAccount(entry.userBalance),
    ]);
    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 56,
      side: SIDE_BID,
      price: 600,
      amount: 55_000,
      orderBehavior: ORDER_BEHAVIOR_GTC,
      remainingAccounts: initialMatchAccounts,
    });

    const pendingOrderBefore = await clobProgram.account.order.fetch(
      takerBid.order,
    );
    assert.strictEqual(pendingOrderBefore.continuationPending, true);
    await lockFixtureMarket(
      market,
      "https://hyperscape.gg/duels/continuation-reclaim",
    );

    await reclaimClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: taker,
      orderId: 56,
      side: SIDE_BID,
      price: 600,
    });

    const pendingOrderAfterReclaim = await clobProgram.account.order.fetch(
      takerBid.order,
    );
    const takerBalance = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(pendingOrderAfterReclaim.active, false);
    assert.strictEqual(pendingOrderAfterReclaim.continuationPending, false);
    assert.strictEqual(takerBalance.aShares.toString(), "50000");
    assert.strictEqual(takerBalance.aLockedLamports.toString(), "30000");
  });

  it("rejects non-FIFO tail updates when the wrong order account is supplied", async () => {
    const makerOne = Keypair.generate();
    const makerTwo = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, makerOne.publicKey, 5),
      airdrop(provider.connection, makerTwo.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("bad-tail") },
    );

    const firstAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: makerOne,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    try {
      await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: makerTwo,
        orderId: 2,
        side: SIDE_ASK,
        price: 600,
        amount: 1000,
        remainingAccounts: [writableAccount(market.marketState)],
      });
      assert.fail("invalid tail order account was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidRemainingAccount"),
        `expected InvalidRemainingAccount, got ${String(error)}`,
      );
    }

    const firstOrder = await clobProgram.account.order.fetch(firstAsk.order);
    assert.strictEqual(firstOrder.nextOrderId.toString(), "0");
  });

  it("uses market fee snapshots for claims after config fee changes", async () => {
    const marketMaker = Keypair.generate();
    const maker = Keypair.generate();
    const taker = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const closeSoon = Math.floor(Date.now() / 1000) + 10;
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fee-snapshot-claim"),
        marketMaker: marketMaker.publicKey,
        betOpenTs: closeSoon - 30,
        betCloseTs: closeSoon,
        duelStartTs: closeSoon + 1,
      },
    );

    const marketStateBefore = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.strictEqual(
      marketStateBefore.winningsMarketMakerFeeBpsSnapshot,
      200,
    );

    await clobProgram.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        market.marketMaker,
        100,
        100,
        5000,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: market.config,
      })
      .signers([authority])
      .rpc();

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    const mmBefore = await provider.connection.getBalance(market.marketMaker);

    await lockFixtureMarket(
      market,
      "https://hyperscape.gg/duels/locked-fee-snapshot",
    );
    const proposalNow = Math.floor(Date.now() / 1000);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: { a: {} },
      duelEndTs: proposalNow,
      metadataUri: "https://hyperscape.gg/duels/resolved-fee-snapshot",
    });
    await sleep(61_000);
    await finalizeDuelResult(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const takerBalanceAfter = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerBalanceAfter.aShares.toString(), "0");

    const mmAfter = await provider.connection.getBalance(market.marketMaker);
    assert.strictEqual(mmAfter - mmBefore, 20);
  });

  it("refunds matched stake when a duel is cancelled", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("cancelled-refund") },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    const makerBalanceBefore = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const takerBalanceBefore = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(makerBalanceBefore.bLockedLamports.toString(), "400");
    assert.strictEqual(takerBalanceBefore.aLockedLamports.toString(), "600");

    await cancelDuel(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    const cancelledMarket = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.deepStrictEqual(cancelledMarket.status, { cancelled: {} });

    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
    });
    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const makerBalanceAfter = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const takerBalanceAfter = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(makerBalanceAfter.aShares.toString(), "0");
    assert.strictEqual(makerBalanceAfter.bShares.toString(), "0");
    assert.strictEqual(makerBalanceAfter.aLockedLamports.toString(), "0");
    assert.strictEqual(makerBalanceAfter.bLockedLamports.toString(), "0");
    assert.strictEqual(takerBalanceAfter.aShares.toString(), "0");
    assert.strictEqual(takerBalanceAfter.bShares.toString(), "0");
    assert.strictEqual(takerBalanceAfter.aLockedLamports.toString(), "0");
    assert.strictEqual(takerBalanceAfter.bLockedLamports.toString(), "0");
  });

  it("reclaims unmatched resting collateral after the market locks", async () => {
    const maker = Keypair.generate();
    await airdrop(provider.connection, maker.publicKey, 5);

    const closeSoon = Math.floor(Date.now() / 1000) + 5;
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("reclaim-unmatched-lock"),
        betOpenTs: closeSoon - 30,
        betCloseTs: closeSoon,
        duelStartTs: closeSoon + 1,
      },
    );

    const ask = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const vaultBeforeReclaim = await provider.connection.getBalance(market.vault);
    await lockFixtureMarket(market, "https://hyperscape.gg/duels/reclaim-locked");

    await reclaimClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
    });

    const vaultAfterReclaim = await provider.connection.getBalance(market.vault);
    const orderAfterReclaim = await clobProgram.account.order.fetch(ask.order);
    const levelAfterReclaim = await clobProgram.account.priceLevel.fetch(
      ask.restingLevel,
    );
    const makerBalance = await clobProgram.account.userBalance.fetch(ask.userBalance);
    assert.strictEqual(vaultBeforeReclaim - vaultAfterReclaim, 400);
    assert.strictEqual(orderAfterReclaim.active, false);
    assert.strictEqual(levelAfterReclaim.totalOpen.toString(), "0");
    assert.strictEqual(levelAfterReclaim.headOrderId.toString(), "0");
    assert.strictEqual(levelAfterReclaim.tailOrderId.toString(), "0");
    assert.strictEqual(makerBalance.aShares.toString(), "0");
    assert.strictEqual(makerBalance.bShares.toString(), "0");
    assert.strictEqual(makerBalance.aLockedLamports.toString(), "0");
    assert.strictEqual(makerBalance.bLockedLamports.toString(), "0");
  });

  it("reclaims cancelled-market remainder without disturbing later claim/refund state", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("reclaim-cancelled-remainder") },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 2000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    await cancelDuel(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    const vaultBeforeReclaim = await provider.connection.getBalance(market.vault);
    const makerBeforeReclaim = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    assert.strictEqual(makerBeforeReclaim.bShares.toString(), "1000");
    assert.strictEqual(makerBeforeReclaim.bLockedLamports.toString(), "400");

    await reclaimClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
    });

    const vaultAfterReclaim = await provider.connection.getBalance(market.vault);
    const makerAfterReclaim = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const makerOrderAfterReclaim = await clobProgram.account.order.fetch(
      makerAsk.order,
    );
    const makerLevelAfterReclaim = await clobProgram.account.priceLevel.fetch(
      makerAsk.restingLevel,
    );
    assert.strictEqual(vaultBeforeReclaim - vaultAfterReclaim, 400);
    assert.strictEqual(makerAfterReclaim.bShares.toString(), "1000");
    assert.strictEqual(makerAfterReclaim.bLockedLamports.toString(), "400");
    assert.strictEqual(makerOrderAfterReclaim.active, false);
    assert.strictEqual(makerLevelAfterReclaim.totalOpen.toString(), "0");
    assert.strictEqual(makerLevelAfterReclaim.headOrderId.toString(), "0");
    assert.strictEqual(makerLevelAfterReclaim.tailOrderId.toString(), "0");

    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
    });
    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const [makerAfterClaim, takerAfterClaim] = await Promise.all([
      clobProgram.account.userBalance.fetch(makerAsk.userBalance),
      clobProgram.account.userBalance.fetch(takerBid.userBalance),
    ]);
    assert.strictEqual(makerAfterClaim.aShares.toString(), "0");
    assert.strictEqual(makerAfterClaim.bShares.toString(), "0");
    assert.strictEqual(makerAfterClaim.aLockedLamports.toString(), "0");
    assert.strictEqual(makerAfterClaim.bLockedLamports.toString(), "0");
    assert.strictEqual(takerAfterClaim.aShares.toString(), "0");
    assert.strictEqual(takerAfterClaim.bShares.toString(), "0");
    assert.strictEqual(takerAfterClaim.aLockedLamports.toString(), "0");
    assert.strictEqual(takerAfterClaim.bLockedLamports.toString(), "0");
  });

  it("reclaims resolved-market remainder while preserving matched winner claims", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const closeSoon = Math.floor(Date.now() / 1000) + 10;
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("reclaim-resolved-remainder"),
        betOpenTs: closeSoon - 30,
        betCloseTs: closeSoon,
        duelStartTs: closeSoon + 1,
      },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 2000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    await lockFixtureMarket(market, "https://hyperscape.gg/duels/reclaim-resolved");
    const proposalNow = Math.floor(Date.now() / 1000);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: { b: {} },
      duelEndTs: proposalNow,
      metadataUri: "https://hyperscape.gg/duels/reclaim-resolved-proposed",
    });
    await sleep(61_000);
    await finalizeDuelResult(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    await reclaimClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
    });
    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
    });

    const makerAfterClaim = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const makerOrderAfterReclaim = await clobProgram.account.order.fetch(
      makerAsk.order,
    );
    assert.strictEqual(makerOrderAfterReclaim.active, false);
    assert.strictEqual(makerAfterClaim.aShares.toString(), "0");
    assert.strictEqual(makerAfterClaim.bShares.toString(), "0");
    assert.strictEqual(makerAfterClaim.aLockedLamports.toString(), "0");
    assert.strictEqual(makerAfterClaim.bLockedLamports.toString(), "0");

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("losing taker claim succeeded after maker reclaim");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "NothingToClaim"),
        `expected NothingToClaim, got ${String(error)}`,
      );
    }

    const takerAfterClaim = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerAfterClaim.aShares.toString(), "1000");
    assert.strictEqual(takerAfterClaim.aLockedLamports.toString(), "600");
  });

  it("pays winning claim with market-maker fee and clears winner and loser state", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const closeSoon = Math.floor(Date.now() / 1000) + 10;
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("resolved-state-clear"),
        betOpenTs: closeSoon - 30,
        betCloseTs: closeSoon,
        duelStartTs: closeSoon + 1,
      },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    await lockFixtureMarket(market, "https://hyperscape.gg/duels/resolved-state");
    const proposalNow = Math.floor(Date.now() / 1000);

    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: { a: {} },
      duelEndTs: proposalNow + 10,
      metadataUri: "https://hyperscape.gg/duels/resolved-state-proposed",
    });
    await sleep(61_000);
    await finalizeDuelResult(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(
      clobProgram,
      market.marketState,
      market.duelState,
    );

    const losingPositionBefore = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const winningPositionAfter = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(winningPositionAfter.aShares.toString(), "0");
    assert.strictEqual(winningPositionAfter.bShares.toString(), "0");
    assert.strictEqual(winningPositionAfter.aLockedLamports.toString(), "0");
    assert.strictEqual(winningPositionAfter.bLockedLamports.toString(), "0");

    const losingPositionAfter = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    assert.strictEqual(
      losingPositionAfter.aShares.toString(),
      losingPositionBefore.aShares.toString(),
    );
    assert.strictEqual(
      losingPositionAfter.bShares.toString(),
      losingPositionBefore.bShares.toString(),
    );
    assert.strictEqual(
      losingPositionAfter.aLockedLamports.toString(),
      losingPositionBefore.aLockedLamports.toString(),
    );
    assert.strictEqual(
      losingPositionAfter.bLockedLamports.toString(),
      losingPositionBefore.bLockedLamports.toString(),
    );
    assert.ok(
      !(
        losingPositionAfter.aShares.toString() === "0" &&
        losingPositionAfter.bShares.toString() === "0"
      ),
      "loser still holding position should remain non-zero",
    );

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("winner repeat claim succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "NothingToClaim"),
        `expected NothingToClaim, got ${String(error)}`,
      );
    }

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: maker,
      });
      assert.fail("loser claim succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "NothingToClaim"),
        `expected NothingToClaim, got ${String(error)}`,
      );
    }
  });

  it("rejects claim before resolution and preserves lockup", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("unsettled-claim") },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    const makerAskBalanceBefore = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const takerBidBalanceBefore = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("claim succeeded before settlement");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotResolved"),
        `expected MarketNotResolved, got ${String(error)}`,
      );
    }

    const takerBidPositionAfter = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    const makerAskPositionAfter = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    assert.strictEqual(
      takerBidPositionAfter.aShares.toString(),
      takerBidBalanceBefore.aShares.toString(),
    );
    assert.strictEqual(
      takerBidPositionAfter.aLockedLamports.toString(),
      takerBidBalanceBefore.aLockedLamports.toString(),
    );
    assert.strictEqual(
      takerBidPositionAfter.bShares.toString(),
      takerBidBalanceBefore.bShares.toString(),
    );
    assert.strictEqual(
      takerBidPositionAfter.bLockedLamports.toString(),
      takerBidBalanceBefore.bLockedLamports.toString(),
    );
    assert.strictEqual(
      makerAskPositionAfter.bShares.toString(),
      makerAskBalanceBefore.bShares.toString(),
    );
    assert.strictEqual(
      makerAskPositionAfter.bLockedLamports.toString(),
      makerAskBalanceBefore.bLockedLamports.toString(),
    );
    assert.strictEqual(
      makerAskPositionAfter.aShares.toString(),
      makerAskBalanceBefore.aShares.toString(),
    );
    assert.strictEqual(
      makerAskPositionAfter.aLockedLamports.toString(),
      makerAskBalanceBefore.aLockedLamports.toString(),
    );
  });
});
