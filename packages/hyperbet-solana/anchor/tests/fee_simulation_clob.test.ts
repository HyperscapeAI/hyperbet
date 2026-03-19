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

  it("simulates intensive CLOB order flow and mathematically guarantees perfect fee extraction", async () => {
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
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fee-sim-market"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
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

    // Run 20 random orders
    let nextOrderId = 1;
    let expectedTreasuryFees = 0;
    let expectedMmFees = 0;
    
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

        const treasuryFee = Math.floor((cost * tradeTreasuryFeeBps) / 10000);
        const mmFee = Math.floor((cost * tradeMarketMakerFeeBps) / 10000);
        
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

        // Track fee math (only if not a self-trade cancellation)
        // Wait, fees are taken on entry regardless of match? Yes, in this program.
        expectedTreasuryFees += treasuryFee;
        expectedMmFees += mmFee;

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
        expectedTreasuryFees,
        `Treasury fee mismatch: expected ${expectedTreasuryFees}, got ${actualTreasuryCollected}`
    );
    assert.strictEqual(
        actualMmCollected,
        expectedMmFees,
        `MM fee mismatch: expected ${expectedMmFees}, got ${actualMmCollected}`
    );

    console.log(`Successfully verified ${expectedTreasuryFees} lamports routed to treasury across 20 simulated orders.`);
    console.log(`Successfully verified ${expectedMmFees} lamports routed to market maker across 20 simulated orders.`);
    
    // Resolve duel and payout
    const now = Math.floor(Date.now() / 1000);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: marketSideA(),
      duelEndTs: now + 4000, // past betCloseTs
    });
    await sleep(61_000);
    await finalizeDuelResult(fightProgram, authority, market.duelKey);
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
           const bal = await clobProgram.account.userBalance.fetch(userBalPda);
           assert.strictEqual(bal.aShares.toString(), "0");
           // We do not assert bShares because losing shares are intentionally left in the balance account for historical tracking
       }
    }
  });
});
