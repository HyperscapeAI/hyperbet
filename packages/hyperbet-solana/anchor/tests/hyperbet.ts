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
  duelStatusLocked,
  duelStatusScheduled,
  hasProgramError,
  hashLabel,
  marketSideA,
  placeClobOrder,
  reportDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  writableAccount,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { LvrAmm } from "../target/types/lvr_amm";

describe("hyperbet-solana", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace
    .LvrAmm as Program<LvrAmm>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;

  it("refuses to pay out before the oracle resolves the duel", async () => {
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
      { duelKey: uniqueDuelKey("unresolved-claim") },
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
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("claim succeeded before oracle resolution");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotResolved"),
        `expected MarketNotResolved, got ${String(error)}`,
      );
    }
  });

  it("mirrors duel lifecycle updates and pays the resolved winner from the oracle result", async () => {
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
        duelKey: uniqueDuelKey("resolved-claim"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
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
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    const now = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram, authority, market.duelKey, {
      status: duelStatusLocked(),
      betOpenTs: now - 120,
      betCloseTs: now - 10,
      duelStartTs: now - 5,
      metadataUri: "https://hyperscape.gg/tests/demo/locked",
    });
    await syncMarketFromDuel(
      clobProgram,
      market.marketState,
      market.duelState,
    );

    let marketState = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.deepStrictEqual(marketState.status, { locked: {} });

    await reportDuelResult(fightProgram, authority, market.duelKey, {
      winner: marketSideA(),
      duelEndTs: now + 5,
      seed: 777,
      metadataUri: "https://hyperscape.gg/tests/demo/resolved",
    });
    await syncMarketFromDuel(
      clobProgram,
      market.marketState,
      market.duelState,
    );

    marketState = await clobProgram.account.marketState.fetch(market.marketState);
    assert.deepStrictEqual(marketState.status, { resolved: {} });
    assert.deepStrictEqual(marketState.winner, { a: {} });

    const marketMakerBefore = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    const userBalance = await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const takerBalance = await clobProgram.account.userBalance.fetch(userBalance);
    assert.strictEqual(takerBalance.aShares.toString(), "0");
    assert.strictEqual(takerBalance.bShares.toString(), "0");

    const marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 20);
  });

  it("refunds cancelled markets based on exact locked collateral", async () => {
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

    await cancelDuel(
      fightProgram,
      authority,
      market.duelKey,
      "https://hyperscape.gg/tests/demo/cancelled",
    );
    await syncMarketFromDuel(
      clobProgram,
      market.marketState,
      market.duelState,
    );

    const takerStateBeforeClaim = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerStateBeforeClaim.aShares.toString(), "1000");
    assert.strictEqual(takerStateBeforeClaim.bShares.toString(), "0");
    assert.strictEqual(
      takerStateBeforeClaim.aLockedLamports.toString(),
      "600",
    );
    const vaultBalanceBeforeClaim = await provider.connection.getBalance(
      market.vault,
    );

    const userBalance = await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });
    const vaultBalanceAfterClaim = await provider.connection.getBalance(
      market.vault,
    );
    const takerState = await clobProgram.account.userBalance.fetch(userBalance);

    assert.strictEqual(takerState.aShares.toString(), "0");
    assert.strictEqual(takerState.bShares.toString(), "0");
    assert.strictEqual(takerState.aLockedLamports.toString(), "0");
    assert.strictEqual(takerState.bLockedLamports.toString(), "0");
    assert.strictEqual(vaultBalanceBeforeClaim - vaultBalanceAfterClaim, 600);
  });

  it("rejects lifecycle regression after a duel is locked", async () => {
    const duelKey = uniqueDuelKey("locked-regression");
    const now = Math.floor(Date.now() / 1000);

    await upsertDuel(fightProgram, authority, duelKey, {
      participantAHash: hashLabel("agent-a"),
      participantBHash: hashLabel("agent-b"),
      status: duelStatusLocked(),
      betOpenTs: now - 120,
      betCloseTs: now - 10,
      duelStartTs: now - 5,
      metadataUri: "https://hyperscape.gg/tests/demo/locked",
    });

    try {
      await upsertDuel(fightProgram, authority, duelKey, {
        participantAHash: hashLabel("agent-a"),
        participantBHash: hashLabel("agent-b"),
        status: duelStatusScheduled(),
        betOpenTs: now - 60,
        betCloseTs: now + 60,
        duelStartTs: now + 120,
        metadataUri: "https://hyperscape.gg/tests/demo/regressed",
      });
      assert.fail("lifecycle regression succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidLifecycleTransition"),
        `expected InvalidLifecycleTransition, got ${String(error)}`,
      );
    }
  });

  it("rejects repeated cancellation after a duel is already cancelled", async () => {
    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("cancelled-twice") },
    );

    await cancelDuel(
      fightProgram,
      authority,
      market.duelKey,
      "https://hyperscape.gg/tests/demo/cancelled-once",
    );

    try {
      await cancelDuel(
        fightProgram,
        authority,
        market.duelKey,
        "https://hyperscape.gg/tests/demo/cancelled-twice",
      );
      assert.fail("repeated cancellation succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "DuelAlreadyFinalized"),
        `expected DuelAlreadyFinalized, got ${String(error)}`,
      );
    }
  });
});
