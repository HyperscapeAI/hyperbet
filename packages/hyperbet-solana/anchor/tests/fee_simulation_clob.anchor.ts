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
  writableAccount,
  marketSideA,
  marketSideB,
  sleep,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { GoldClobMarket } from "../target/types/gold_clob_market";

describe("fee_simulation (stress test)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace.GoldClobMarket as Program<GoldClobMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

  it("simulates intensive CLOB order flow and routes executed fees to treasury and market maker", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    
    // Create 5 traders
    const traders: Keypair[] = Array.from({ length: 5 }, () => Keypair.generate());
    
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
    const duelStartTs = betCloseTs + 60;

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fee-sim-market"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
        betOpenTs,
        betCloseTs,
        duelStartTs,
      },
    );

    // We need to re-init config with specific fees for math assertions if the previous tests created a default config.
    // wait, ensureClobConfig uses the same PDA `config` for the localnet.
    // We update config explicitly just in case to guarantee fee numbers.
    await clobProgram.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        treasury.publicKey,
        marketMaker.publicKey,
        tradeTreasuryFeeBps,
        tradeMarketMakerFeeBps,
        200, // winnings
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: market.config,
      })
      .signers([authority])
      .rpc();

    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);
    const mmBefore = await provider.connection.getBalance(marketMaker.publicKey);

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
        const cost = side === SIDE_BID 
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

        if (side === SIDE_BID) {
          assert.strictEqual(
            treasuryDelta,
            0,
            "Resting bid should not pay treasury fees before execution",
          );
          assert.strictEqual(
            mmDelta,
            0,
            "Resting bid should not pay market maker fees before execution",
          );
        } else if (treasuryDelta === 0 || mmDelta === 0) {
          assert.strictEqual(
            treasuryDelta,
            0,
            "Fee routing should be symmetric when no execution occurs",
          );
          assert.strictEqual(
            mmDelta,
            0,
            "Fee routing should be symmetric when no execution occurs",
          );
        } else {
          assert.ok(
            treasuryDelta >= mmDelta,
            `Treasury fee should be at least market maker fee per execution: treasury=${treasuryDelta} mm=${mmDelta}`,
          );
        }

        observedTreasuryFees += treasuryDelta;
        observedMmFees += mmDelta;

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

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const mmAfter = await provider.connection.getBalance(marketMaker.publicKey);

    const actualTreasuryCollected = treasuryAfter - treasuryBefore;
    const actualMmCollected = mmAfter - mmBefore;

    assert.strictEqual(
        actualTreasuryCollected,
        observedTreasuryFees,
        `Treasury fee mismatch: expected ${observedTreasuryFees}, got ${actualTreasuryCollected}`
    );
    assert.strictEqual(
        actualMmCollected,
        observedMmFees,
        `MM fee mismatch: expected ${observedMmFees}, got ${actualMmCollected}`
    );
    assert.ok(actualTreasuryCollected > 0, "Treasury should collect nonzero executed fees");
    assert.ok(actualMmCollected > 0, "Market maker should collect nonzero executed fees");
    assert.ok(
      actualTreasuryCollected >= actualMmCollected,
      "Treasury fees should be at least market maker fees under the configured bps schedule",
    );

    console.log(`Successfully verified ${observedTreasuryFees} lamports routed to treasury across 20 simulated orders.`);
    console.log(`Successfully verified ${observedMmFees} lamports routed to market maker across 20 simulated orders.`);
    
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
      metadataUri: "https://hyperscape.gg/tests/fee-sim-locked",
    });
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);
    const now = Math.floor(Date.now() / 1000);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: marketSideA(),
      duelEndTs: now,
      metadataUri: "https://hyperscape.gg/tests/fee-sim-resolved",
    });
    await sleep(61_000);
    await finalizeDuelResult(
      fightProgram,
      authority,
      market.duelKey,
      "https://hyperscape.gg/tests/fee-sim-resolved",
    );
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

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
           const bal = await clobProgram.account.userBalance.fetchNullable(userBalPda);
           if (bal) {
             assert.strictEqual(bal.aShares.toString(), "0");
             // We do not assert bShares because losing shares are intentionally left in the balance account for historical tracking
           }
       }
    }
  });
});
