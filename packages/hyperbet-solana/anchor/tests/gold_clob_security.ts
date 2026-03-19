import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";

import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  createOpenMarketFixture,
  deriveMarketStatePda,
  claimClobWinnings,
  duelStatusBettingOpen,
  duelStatusLocked,
  ensureClobConfig,
  ensureOracleReady,
  hasProgramError,
  initializeCanonicalMarket,
  placeClobOrder,
  proposeDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  cancelDuel,
  challengeDuelResult,
  upsertDuel,
  writableAccount,
  cancelClobOrder,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { GoldClobMarket } from "../target/types/gold_clob_market";

const DISPUTE_WINDOW_SECS = 3600;

describe("gold_clob_market security regressions", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace
    .GoldClobMarket as Program<GoldClobMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;
  before(async () => {
    await ensureOracleReady(
      fightProgram,
      authority,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      DISPUTE_WINDOW_SECS,
    );
  });

  it("rejects unauthorized canonical market initialization", async () => {
    const outsider = Keypair.generate();
    await airdrop(provider.connection, outsider.publicKey, 3);

    await ensureOracleReady(fightProgram, authority, authority.publicKey);
    const config = await ensureClobConfig(clobProgram, authority);
    const duelKey = uniqueDuelKey("unauthorized-market-init");
    const now = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 10,
      betCloseTs: now + 300,
      duelStartTs: now + 360,
      metadataUri: "https://hyperscape.gg/tests/security/unauthorized",
    });

    try {
      await initializeCanonicalMarket(
        clobProgram,
        outsider,
        duelState,
        duelKey,
        config,
      );
      assert.fail("unauthorized market initialization succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "UnauthorizedMarketOperator"),
        `expected UnauthorizedMarketOperator, got ${String(error)}`,
      );
    }

    const marketState = deriveMarketStatePda(clobProgram.programId, duelState);
    assert.strictEqual(
      await clobProgram.account.marketState.fetchNullable(marketState),
      null,
    );
  });

  it("rejects new orders after the oracle betting window closes", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 3);

    const now = Math.floor(Date.now() / 1000);
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("betting-window-closed"),
        betOpenTs: now - 120,
        betCloseTs: now - 5,
        duelStartTs: now - 1,
        metadataUri: "https://hyperscape.gg/tests/security/closed-window",
      },
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
      });
      assert.fail("post-close order placement succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "BettingClosed"),
        `expected BettingClosed, got ${String(error)}`,
      );
    }
  });

  it("rejects duel windows that close immediately or start before betting closes", async () => {
    await ensureOracleReady(fightProgram, authority, authority.publicKey);
    const now = Math.floor(Date.now() / 1000);

    try {
      await upsertDuel(
        fightProgram,
        authority,
        uniqueDuelKey("instant-close"),
        {
          status: duelStatusBettingOpen(),
          betOpenTs: now,
          betCloseTs: now,
          duelStartTs: now + 60,
          metadataUri: "https://hyperscape.gg/tests/security/instant-close",
        },
      );
      assert.fail("zero-length betting window was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidBetWindow"),
        `expected InvalidBetWindow, got ${String(error)}`,
      );
    }

    try {
      await upsertDuel(
        fightProgram,
        authority,
        uniqueDuelKey("duel-before-close"),
        {
          status: duelStatusBettingOpen(),
          betOpenTs: now,
          betCloseTs: now + 120,
          duelStartTs: now + 60,
          metadataUri: "https://hyperscape.gg/tests/security/duel-before-close",
        },
      );
      assert.fail("duel start before bet close was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidLifecycleTransition"),
        `expected InvalidLifecycleTransition, got ${String(error)}`,
      );
    }
  });

  it("rejects maker balances from a different market", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const marketOne = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("balance-market-one") },
    );
    const marketTwo = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("balance-market-two") },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: marketOne.marketState,
      duelState: marketOne.duelState,
      config: marketOne.config,
      treasury: marketOne.treasury,
      marketMaker: marketOne.marketMaker,
      vault: marketOne.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const foreignBalance = await placeClobOrder(clobProgram, {
      marketState: marketTwo.marketState,
      duelState: marketTwo.duelState,
      config: marketTwo.config,
      treasury: marketTwo.treasury,
      marketMaker: marketTwo.marketMaker,
      vault: marketTwo.vault,
      user: maker,
      orderId: 1,
      side: SIDE_BID,
      price: 500,
      amount: 1000,
    });

    try {
      await placeClobOrder(clobProgram, {
        marketState: marketOne.marketState,
        duelState: marketOne.duelState,
        config: marketOne.config,
        treasury: marketOne.treasury,
        marketMaker: marketOne.marketMaker,
        vault: marketOne.vault,
        user: taker,
        orderId: 2,
        side: SIDE_BID,
        price: 600,
        amount: 1000,
        remainingAccounts: [
          writableAccount(makerAsk.restingLevel),
          writableAccount(makerAsk.order),
          writableAccount(foreignBalance.userBalance),
        ],
      });
      assert.fail("cross-market maker balance poisoning succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidRemainingAccount"),
        `expected InvalidRemainingAccount, got ${String(error)}`,
      );
    }
  });

  it("increments next_order_id even when the taker order is fully matched", async () => {
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
      { duelKey: uniqueDuelKey("next-order-id") },
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

    const updatedMarket = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.strictEqual(updatedMarket.nextOrderId.toString(), "3");

    const makerOrder = await clobProgram.account.order.fetch(makerAsk.order);
    assert.strictEqual(makerOrder.id.toString(), "1");
    assert.strictEqual(makerOrder.amount.toString(), "1000");
    assert.strictEqual(makerOrder.filled.toString(), "1000");
    assert.strictEqual(makerOrder.active, false);

    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(takerBid.order),
      null,
    );
  });

  it("allows fully filled maker orders to be closed so rent is recoverable", async () => {
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
      { duelKey: uniqueDuelKey("filled-order-close") },
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

    await cancelClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
    });

    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(makerAsk.order),
      null,
    );
    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(takerBid.order),
      null,
    );
  });

  it("rejects order mutation and claims during non-open lifecycle states", async () => {
    const maker = Keypair.generate();
    await airdrop(provider.connection, maker.publicKey, 5);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("guardrail-non-open-mutations") },
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

    await upsertDuel(
      fightProgram,
      authority,
      market.duelKey,
      {
        status: duelStatusLocked(),
        betOpenTs: Math.floor(Date.now() / 1000) - 120,
        betCloseTs: Math.floor(Date.now() / 1000) - 10,
        duelStartTs: Math.floor(Date.now() / 1000) + 30,
        metadataUri: "https://hyperscape.gg/tests/security/non-open-mutations",
      },
    );
    await ensureOracleReady(
      fightProgram,
      authority,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      3600,
    );
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    try {
      await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: maker,
        orderId: 2,
        side: SIDE_BID,
        price: 550,
        amount: 1000,
      });
      assert.fail("lock-state order placement succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotOpen"),
        `expected MarketNotOpen, got ${String(error)}`,
      );
    }

    try {
      await cancelClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        vault: market.vault,
        user: maker,
        orderId: 1,
        side: SIDE_ASK,
        price: 600,
      });
      assert.fail("lock-state cancellation succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotOpen"),
        `expected MarketNotOpen, got ${String(error)}`,
      );
    }

    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: { a: {} },
      duelEndTs: Math.floor(Date.now() / 1000),
      seed: 42,
      metadataUri: "https://hyperscape.gg/tests/security/proposed",
    });
    await challengeDuelResult(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    try {
      await cancelClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        vault: market.vault,
        user: maker,
        orderId: 1,
        side: SIDE_ASK,
        price: 600,
      });
      assert.fail("challenged-state cancellation succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotOpen"),
        `expected MarketNotOpen, got ${String(error)}`,
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
      assert.fail("preterminal claim succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotResolved"),
        `expected MarketNotResolved, got ${String(error)}`,
      );
    }
  });

  it("locks non-finalized claims to terminal states and refunds cancelled matches", async () => {
    const maker = Keypair.generate();
    await airdrop(provider.connection, maker.publicKey, 5);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("guardrail-cancelled-claim"),
        metadataUri: "https://hyperscape.gg/tests/security/cancelled-claim",
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
      side: SIDE_BID,
      price: 600,
      amount: 1000,
    });

    const taker = Keypair.generate();
    await airdrop(provider.connection, taker.publicKey, 5);
    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_ASK,
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

    const makerBalance = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    assert.strictEqual(makerBalance.aShares.toString(), "1000");
    assert.strictEqual(makerBalance.aLockedLamports.toString(), "600");

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

});
