import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";

import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  cancelDuel,
  claimClobWinnings,
  createOpenMarketFixture,
  duelStatusBettingOpen,
  duelStatusLocked,
  ensureClobConfig,
  ensureOracleReady,
  initializeCanonicalMarket,
  placeClobOrder,
  challengeDuelResult,
  finalizeDuelResult,
  proposeDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  withdrawResolvedClobTradeFees,
  writableAccount,
  marketSideA,
  marketSideB,
  sleep,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { DuelMarket } from "../target/types/duel_market";

describe("fee_simulation (stress test)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace.DuelMarket as Program<DuelMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;

  it("simulates intensive CLOB flow, escrows exact fees, and releases them only after resolution", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();

    // Create 5 traders
    const traders: Keypair[] = Array.from({ length: 5 }, () =>
      Keypair.generate(),
    );

    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 1),
      airdrop(provider.connection, marketMaker.publicKey, 1),
      ...traders.map((t) => airdrop(provider.connection, t.publicKey, 10)),
    ]);

    const tradeTreasuryFeeBps = 150; // 1.5%
    const tradeMarketMakerFeeBps = 100; // 1.0%

    // We pass custom fees via options to createOpenMarketFixture
    const fixtureNow = Math.floor(Date.now() / 1000);
    const betOpenTs = fixtureNow - 30;
    const betCloseTs = fixtureNow + 90;
    const duelStartTs = betCloseTs;

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fee-sim-market"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
        tradeTreasuryFeeBps,
        tradeMarketMakerFeeBps,
        winningsMarketMakerFeeBps: 200,
        betOpenTs,
        betCloseTs,
        duelStartTs,
      },
    );

    const treasuryBefore = await provider.connection.getBalance(
      treasury.publicKey,
    );
    const mmBefore = await provider.connection.getBalance(
      marketMaker.publicKey,
    );

    // Run 20 deterministic orders and verify fee routing from observed executions.
    let nextOrderId = 1;
    let observedTreasuryFees = 0;
    let observedMmFees = 0;

    const openOrders: any[] = [];

    // Seeded random for deterministic tests
    let seed = 1337;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? SIDE_BID : SIDE_ASK; // Ping-pong
      const price = 500; // Constant price to guarantee crossing
      const amount = 3000;
      const trader = traders[Math.floor(rng() * traders.length)];

      // Cost calculation from program
      const cost =
        side === SIDE_BID
          ? Math.floor((price * amount) / 1000)
          : Math.floor(((1000 - price) * amount) / 1000);

      let remainingAccounts: any[] = [];
      if (side === SIDE_ASK) {
        // MATCHING: Provide FIFO head(s)
        // In this specific sim, we just match the current head.
        if (openOrders.length > 0) {
          const head = openOrders[0];
          remainingAccounts = [
            writableAccount(head.restingLevel),
            writableAccount(head.order),
            writableAccount(head.userBalance),
          ];
        }
      } else {
        // RESTING: If the book is not empty, provide the tail for linking
        if (openOrders.length > 0) {
          const tail = openOrders[openOrders.length - 1];
          remainingAccounts = [writableAccount(tail.order)];
        }
      }

      const treasuryBeforeOrder = await provider.connection.getBalance(
        treasury.publicKey,
      );
      const mmBeforeOrder = await provider.connection.getBalance(
        marketMaker.publicKey,
      );
      const marketBeforeOrder = await clobProgram.account.marketState.fetch(
        market.marketState,
      );

      const orderParams = await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: trader,
        orderId: nextOrderId,
        side,
        price,
        amount,
        remainingAccounts,
      });

      const treasuryAfterOrder = await provider.connection.getBalance(
        treasury.publicKey,
      );
      const mmAfterOrder = await provider.connection.getBalance(
        marketMaker.publicKey,
      );
      const treasuryDelta = treasuryAfterOrder - treasuryBeforeOrder;
      const mmDelta = mmAfterOrder - mmBeforeOrder;
      const marketAfterOrder = await clobProgram.account.marketState.fetch(
        market.marketState,
      );
      const treasuryEscrowDelta = Number(
        marketAfterOrder.accruedTradeTreasuryFeeLamports.sub(
          marketBeforeOrder.accruedTradeTreasuryFeeLamports,
        ),
      );
      const marketMakerEscrowDelta = Number(
        marketAfterOrder.accruedTradeMarketMakerFeeLamports.sub(
          marketBeforeOrder.accruedTradeMarketMakerFeeLamports,
        ),
      );

      assert.strictEqual(
        treasuryDelta,
        0,
        "Treasury must not receive execution fees before resolution",
      );
      assert.strictEqual(
        mmDelta,
        0,
        "Market maker must not receive execution fees before resolution",
      );
      assert.ok(treasuryEscrowDelta >= 0);
      assert.ok(marketMakerEscrowDelta >= 0);
      assert.strictEqual(
        treasuryEscrowDelta === 0,
        marketMakerEscrowDelta === 0,
        "Both snapshotted fee components must accrue from the same execution",
      );

      observedTreasuryFees += treasuryEscrowDelta;
      observedMmFees += marketMakerEscrowDelta;

      if (side === SIDE_BID) {
        // BIDs always try to rest in this sim
        openOrders.push({ ...orderParams, trader });
      } else {
        // ASKs are takers. Check if it matched.
        if (openOrders.length > 0) {
          const head = openOrders[0];
          if (head.trader.publicKey.equals(trader.publicKey)) {
            // Self-trade: Taker (ASK) cancelled, Maker (BID) remains.
          } else {
            // Match: Both are cleared in this simplified 1-to-1 sim.
            openOrders.shift();
          }
        }
      }
      nextOrderId++;
    }

    const treasuryAfter = await provider.connection.getBalance(
      treasury.publicKey,
    );
    const mmAfter = await provider.connection.getBalance(marketMaker.publicKey);

    const actualTreasuryCollected = treasuryAfter - treasuryBefore;
    const actualMmCollected = mmAfter - mmBefore;

    assert.strictEqual(
      actualTreasuryCollected,
      0,
      `Treasury received ${actualTreasuryCollected} lamports before resolution`,
    );
    assert.strictEqual(
      actualMmCollected,
      0,
      `Market maker received ${actualMmCollected} lamports before resolution`,
    );
    const escrowedMarket = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.strictEqual(
      escrowedMarket.accruedTradeTreasuryFeeLamports.toNumber(),
      observedTreasuryFees,
    );
    assert.strictEqual(
      escrowedMarket.accruedTradeMarketMakerFeeLamports.toNumber(),
      observedMmFees,
    );
    assert.ok(observedTreasuryFees > 0, "Treasury escrow should be nonzero");
    assert.ok(observedMmFees > 0, "Market-maker escrow should be nonzero");
    assert.ok(
      observedTreasuryFees >= observedMmFees,
      "Treasury fees should be at least market maker fees under the configured bps schedule",
    );

    console.log(
      `Verified ${observedTreasuryFees} treasury lamports escrowed across 20 simulated orders.`,
    );
    console.log(
      `Verified ${observedMmFees} market-maker lamports escrowed across 20 simulated orders.`,
    );

    // Resolve duel and payout
    await assert.doesNotReject(async () => {
      while (true) {
        const slot = await provider.connection.getSlot("confirmed");
        const blockTime = (await provider.connection.getBlockTime(slot)) ?? 0;
        if (blockTime >= betCloseTs + 1) break;
        await sleep(1_000);
      }
    });
    await upsertDuel(fightProgram, authority, market.duelKey, {
      status: duelStatusLocked(),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      metadataUri: "https://hyperia.gg/tests/fee-sim-locked",
    });
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    const now = Math.floor(Date.now() / 1000);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: marketSideA(),
      duelEndTs: now,
      metadataUri: "https://hyperia.gg/tests/fee-sim-resolved",
    });
    await sleep(61_000);
    await finalizeDuelResult(
      fightProgram,
      authority,
      market.duelKey,
      "https://hyperia.gg/tests/fee-sim-resolved",
    );
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    await withdrawResolvedClobTradeFees(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      submitter: traders[0]!,
    });
    const [treasuryAfterWithdrawal, mmAfterWithdrawal] = await Promise.all([
      provider.connection.getBalance(treasury.publicKey),
      provider.connection.getBalance(marketMaker.publicKey),
    ]);
    assert.strictEqual(
      treasuryAfterWithdrawal - treasuryBefore,
      observedTreasuryFees,
    );
    assert.strictEqual(mmAfterWithdrawal - mmBefore, observedMmFees);

    // Claim winnings for all traders
    for (const trader of traders) {
      const userBalPda = await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: trader,
      }).catch(() => null); // Catch "NothingToClaim"

      if (userBalPda) {
        const bal =
          await clobProgram.account.userBalance.fetchNullable(userBalPda);
        if (bal) {
          assert.strictEqual(bal.aShares.toString(), "0");
          // We do not assert bShares because losing shares are intentionally left in the balance account for historical tracking
        }
      }
    }
  });
});
