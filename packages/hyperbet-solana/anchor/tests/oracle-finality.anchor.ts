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
  challengeDuelResult,
  duelStatusLocked,
  duelStatusScheduled,
  deriveDuelStatePda,
  deriveOracleConfigPda,
  ensureOracleReady,
  finalizeDuelResult,
  hashLabel,
  hasProgramError,
  marketSideA,
  placeClobOrder,
  proposeDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  writableAccount,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { GoldClobMarket } from "../target/types/gold_clob_market";

describe("oracle finality truth (solana)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace.GoldClobMarket as Program<GoldClobMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

  it("freezes the scheduled duel manifest after prepare", async () => {
    const duelKey = uniqueDuelKey("sol-scheduled-immutable");
    const now = Math.floor(Date.now() / 1000);
    const participantAHash = hashLabel("sol-agent-a");
    const participantBHash = hashLabel("sol-agent-b");

    await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusScheduled(),
      betOpenTs: now + 30,
      betCloseTs: now + 90,
      duelStartTs: now + 150,
      participantAHash,
      participantBHash,
      metadataUri: "https://hyperscape.gg/tests/prepare/scheduled",
    });

    try {
      await upsertDuel(fightProgram, authority, duelKey, {
        status: duelStatusScheduled(),
        betOpenTs: now + 30,
        betCloseTs: now + 90,
        duelStartTs: now + 151,
        participantAHash,
        participantBHash,
        metadataUri: "https://hyperscape.gg/tests/prepare/scheduled-shifted",
      });
      assert.fail("scheduled duel timing mutated after prepare");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "TimingImmutable"),
        `expected TimingImmutable, got ${String(error)}`,
      );
    }

    try {
      await upsertDuel(fightProgram, authority, duelKey, {
        status: duelStatusScheduled(),
        betOpenTs: now + 30,
        betCloseTs: now + 90,
        duelStartTs: now + 150,
        participantAHash: hashLabel("sol-agent-a-mutated"),
        participantBHash,
        metadataUri: "https://hyperscape.gg/tests/prepare/scheduled-mutated",
      });
      assert.fail("scheduled duel participant mutated after prepare");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "ParticipantHashImmutable"),
        `expected ParticipantHashImmutable, got ${String(error)}`,
      );
    }
  });

  it("rejects settlement before terminal oracle states", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    const setupNow = Math.floor(Date.now() / 1000);
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("sol-nonterminal-claim"),
        betOpenTs: setupNow - 30,
        betCloseTs: setupNow + 15,
        duelStartTs: setupNow + 75,
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

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("claim succeeded before finalization");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotResolved"),
        `expected MarketNotResolved, got ${String(error)}`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const duelStateAccount = await fightProgram.account.duelState.fetch(
      market.duelState,
    );
    const lockWaitMs = Math.max(
      0,
      (Number(duelStateAccount.betCloseTs) - Math.floor(Date.now() / 1000) + 1) *
        1_000,
    );
    if (lockWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, lockWaitMs));
    }
    await upsertDuel(fightProgram, authority, market.duelKey, {
      status: duelStatusLocked(),
      betOpenTs: Number(duelStateAccount.betOpenTs),
      betCloseTs: Number(duelStateAccount.betCloseTs),
      duelStartTs: Number(duelStateAccount.duelStartTs),
      metadataUri: "https://hyperscape.gg/tests/demo/locked",
    });
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("claim succeeded while market was locked");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotResolved"),
        `expected MarketNotResolved, got ${String(error)}`,
      );
    }

    await ensureOracleReady(
      fightProgram,
      authority,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      60,
    );
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: marketSideA(),
      duelEndTs: Math.max(
        Math.floor(Date.now() / 1000),
        Number(duelStateAccount.betCloseTs),
      ),
      metadataUri: "https://hyperscape.gg/tests/demo/proposed",
    });
    await challengeDuelResult(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    try {
      await claimClobWinnings(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: taker,
      });
      assert.fail("claim succeeded while proposal was challenged");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketNotResolved"),
        `expected MarketNotResolved, got ${String(error)}`,
      );
    }
  });

  it("enforces direct finalization preconditions", async () => {
    const duelKey = uniqueDuelKey("sol-direct-finalize-gates");
    const now = Math.floor(Date.now() / 1000);
    await ensureOracleReady(
      fightProgram,
      authority,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      60,
    );
    await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs: now - 120,
      betCloseTs: now - 10,
      duelStartTs: now - 5,
      metadataUri: "https://hyperscape.gg/tests/resolve/before-lock",
    });

    await proposeDuelResult(fightProgram, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: now + 5,
      metadataUri: "https://hyperscape.gg/tests/resolve/proposed",
    });

    const oracleConfig = deriveOracleConfigPda(fightProgram.programId);
    const duelState = deriveDuelStatePda(fightProgram.programId, duelKey);
    try {
      await fightProgram.methods
        .finalizeResult([...duelKey], "too-early")
        .accountsPartial({
          finalizer: authority.publicKey,
          oracleConfig,
          duelState,
        })
        .signers([authority])
        .rpc();
      assert.fail("finalize succeeded before dispute window expiry");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "DisputeWindowActive"),
        `expected DisputeWindowActive, got ${String(error)}`,
      );
    }

    await challengeDuelResult(fightProgram, authority, duelKey, "challenged");

    try {
      await fightProgram.methods
        .finalizeResult([...duelKey], "post-challenge")
        .accountsPartial({
          finalizer: authority.publicKey,
          oracleConfig,
          duelState,
        })
        .signers([authority])
        .rpc();
      assert.fail("finalize succeeded after challenge");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "NotProposed"),
        `expected NotProposed, got ${String(error)}`,
      );
    }
  });

  it("refunds only cancelled outcomes and not open outcomes", async () => {
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
      { duelKey: uniqueDuelKey("sol-cancel-refund") },
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

    const takerBalanceBefore = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerBalanceBefore.aShares.toString(), "1000");
    const vaultBefore = await provider.connection.getBalance(market.vault);

    await cancelDuel(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const vaultAfter = await provider.connection.getBalance(market.vault);
    const takerBalanceAfter = await provider.connection.getAccountInfo(
      takerBid.userBalance,
    );
    assert.strictEqual(takerBalanceAfter, null);
    assert.strictEqual(
      BigInt(vaultBefore) - BigInt(vaultAfter),
      BigInt(takerBalanceBefore.aLockedLamports.toString()),
    );
  });
});
