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
  currentChainUnixTimestamp,
  duelStatusLocked,
  deriveDuelStatePda,
  deriveOracleConfigPda,
  deriveProposalRecordPda,
  ensureOracleReady,
  finalizeDuelResult,
  hashLabel,
  hasProgramError,
  marketSideA,
  marketSideB,
  placeClobOrder,
  proposeDuelResult,
  reproposeDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  writableAccount,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { DuelMarket } from "../target/types/duel_market";

describe("oracle finality truth (solana)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace.DuelMarket as Program<DuelMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;

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
        duelStartTs: setupNow + 15,
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

    const duelStateAccount = await fightProgram.account.duelState.fetch(
      market.duelState,
    );
    const lockWaitMs = Math.max(
      0,
      (Number(duelStateAccount.betCloseTs) -
        Math.floor(Date.now() / 1000) +
        1) *
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
      metadataUri: "https://hyperia.gg/tests/demo/locked",
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
      metadataUri: "https://hyperia.gg/tests/demo/proposed",
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
      metadataUri: "https://hyperia.gg/tests/resolve/before-lock",
    });

    await proposeDuelResult(fightProgram, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: now,
      metadataUri: "https://hyperia.gg/tests/resolve/proposed",
    });

    const oracleConfig = deriveOracleConfigPda(fightProgram.programId);
    const duelState = deriveDuelStatePda(fightProgram.programId, duelKey);
    const proposedState = await fightProgram.account.duelState.fetch(duelState);
    const proposalId = Buffer.from(proposedState.activeProposal);
    try {
      await cancelDuel(fightProgram, authority, duelKey, "proposed-cancel");
      assert.fail("cancellation succeeded after a result was proposed");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidLifecycleTransition"),
        `expected InvalidLifecycleTransition, got ${String(error)}`,
      );
    }
    const stateAfterProposedCancellation =
      await fightProgram.account.duelState.fetch(duelState);
    assert.ok(stateAfterProposedCancellation.status.proposed !== undefined);
    assert.deepStrictEqual(
      Buffer.from(stateAfterProposedCancellation.activeProposal),
      proposalId,
    );

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
      await cancelDuel(fightProgram, authority, duelKey, "challenged-cancel");
      assert.fail("cancellation succeeded after a result was challenged");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidLifecycleTransition"),
        `expected InvalidLifecycleTransition, got ${String(error)}`,
      );
    }
    const stateAfterChallengedCancellation =
      await fightProgram.account.duelState.fetch(duelState);
    assert.ok(stateAfterChallengedCancellation.status.challenged !== undefined);
    assert.ok(stateAfterChallengedCancellation.pendingChallenged);
    assert.deepStrictEqual(
      Buffer.from(stateAfterChallengedCancellation.activeProposal),
      proposalId,
    );

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

    const stateAfterChallengedFinalization =
      await fightProgram.account.duelState.fetch(duelState);
    assert.ok(stateAfterChallengedFinalization.status.challenged !== undefined);
    assert.ok(stateAfterChallengedFinalization.pendingChallenged);
    assert.deepStrictEqual(
      Buffer.from(stateAfterChallengedFinalization.activeProposal),
      proposalId,
    );
  });

  it("rejects result timestamps before duel start or after confirmed chain time", async () => {
    const duelKey = uniqueDuelKey("sol-result-time-gates");
    const chainNow = await currentChainUnixTimestamp(provider.connection);
    const betCloseTs = chainNow - 20;
    const duelStartTs = chainNow - 5;
    await ensureOracleReady(
      fightProgram,
      authority,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      60,
    );
    const duelState = await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs: chainNow - 60,
      betCloseTs,
      duelStartTs,
      metadataUri: "https://hyperia.gg/tests/result-time/locked",
    });

    try {
      await proposeDuelResult(fightProgram, authority, duelKey, {
        winner: marketSideA(),
        duelEndTs: duelStartTs - 1,
        metadataUri: "https://hyperia.gg/tests/result-time/pre-start",
      });
      assert.fail("pre-start result timestamp was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidResultTime"),
        `expected InvalidResultTime, got ${String(error)}`,
      );
    }

    try {
      await proposeDuelResult(fightProgram, authority, duelKey, {
        winner: marketSideA(),
        duelEndTs: chainNow + 60,
        metadataUri: "https://hyperia.gg/tests/result-time/future",
      });
      assert.fail("future result timestamp was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidResultTime"),
        `expected InvalidResultTime, got ${String(error)}`,
      );
    }

    const unchanged = await fightProgram.account.duelState.fetch(duelState);
    assert.ok(unchanged.status.locked !== undefined);
    assert.deepStrictEqual(
      Buffer.from(unchanged.activeProposal),
      Buffer.alloc(32),
    );
  });

  it("preserves challenged proposal history and permanently rejects evidence replay", async () => {
    const duelKey = uniqueDuelKey("sol-proposal-history");
    const chainNow = await currentChainUnixTimestamp(provider.connection);
    const firstReplayHash = hashLabel("proposal-history:first:replay");
    const firstResultHash = hashLabel("proposal-history:first:result");
    const secondReplayHash = hashLabel("proposal-history:second:replay");
    const secondResultHash = hashLabel("proposal-history:second:result");
    const futureReplayHash = hashLabel("proposal-history:future:replay");
    const futureResultHash = hashLabel("proposal-history:future:result");

    await ensureOracleReady(
      fightProgram,
      authority,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      60,
    );
    const duelState = await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs: chainNow - 60,
      betCloseTs: chainNow - 20,
      duelStartTs: chainNow - 10,
      metadataUri: "https://hyperia.gg/tests/proposal-history/locked",
    });
    const firstProposalRecord = deriveProposalRecordPda(
      fightProgram.programId,
      duelKey,
      firstResultHash,
      firstReplayHash,
    );

    await proposeDuelResult(fightProgram, authority, duelKey, {
      winner: marketSideA(),
      seed: 101,
      replayHash: firstReplayHash,
      resultHash: firstResultHash,
      duelEndTs: chainNow,
      metadataUri: "https://hyperia.gg/tests/proposal-history/first",
    });
    const firstRecordBeforeChallenge =
      await fightProgram.account.proposalRecord.fetch(firstProposalRecord);
    const firstProposalId = Buffer.from(firstRecordBeforeChallenge.proposalId);
    assert.deepStrictEqual(
      Buffer.from(firstRecordBeforeChallenge.duelKey),
      Buffer.from(duelKey),
    );
    assert.deepStrictEqual(
      Buffer.from(firstRecordBeforeChallenge.resultHash),
      Buffer.from(firstResultHash),
    );
    assert.deepStrictEqual(
      Buffer.from(firstRecordBeforeChallenge.replayHash),
      Buffer.from(firstReplayHash),
    );
    assert.strictEqual(firstRecordBeforeChallenge.seed.toString(), "101");
    assert.strictEqual(firstRecordBeforeChallenge.challenged, false);

    await challengeDuelResult(fightProgram, authority, duelKey);
    const challengedFirstRecord =
      await fightProgram.account.proposalRecord.fetch(firstProposalRecord);
    assert.strictEqual(challengedFirstRecord.challenged, true);

    const futureProposalRecord = deriveProposalRecordPda(
      fightProgram.programId,
      duelKey,
      futureResultHash,
      futureReplayHash,
    );
    try {
      await reproposeDuelResult(fightProgram, authority, duelKey, {
        winner: marketSideB(),
        seed: 102,
        replayHash: futureReplayHash,
        resultHash: futureResultHash,
        duelEndTs: (await currentChainUnixTimestamp(provider.connection)) + 60,
      });
      assert.fail("future reproposal timestamp was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidResultTime"),
        `expected InvalidResultTime, got ${String(error)}`,
      );
    }
    assert.strictEqual(
      await provider.connection.getAccountInfo(futureProposalRecord),
      null,
    );

    try {
      await reproposeDuelResult(fightProgram, authority, duelKey, {
        winner: marketSideB(),
        seed: 102,
        replayHash: firstReplayHash,
        resultHash: firstResultHash,
        duelEndTs: await currentChainUnixTimestamp(provider.connection),
      });
      assert.fail("challenged evidence identity was accepted again");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "ProposalExists"),
        `expected ProposalExists, got ${String(error)}`,
      );
    }
    const afterFirstReplayAttempt =
      await fightProgram.account.duelState.fetch(duelState);
    assert.ok(afterFirstReplayAttempt.status.challenged !== undefined);
    assert.deepStrictEqual(
      Buffer.from(afterFirstReplayAttempt.activeProposal),
      firstProposalId,
    );

    const secondEndTs = await currentChainUnixTimestamp(provider.connection);
    await reproposeDuelResult(fightProgram, authority, duelKey, {
      winner: marketSideB(),
      seed: 202,
      replayHash: secondReplayHash,
      resultHash: secondResultHash,
      duelEndTs: secondEndTs,
      metadataUri: "https://hyperia.gg/tests/proposal-history/second",
    });
    const secondProposalRecord = deriveProposalRecordPda(
      fightProgram.programId,
      duelKey,
      secondResultHash,
      secondReplayHash,
    );
    const secondRecord =
      await fightProgram.account.proposalRecord.fetch(secondProposalRecord);
    assert.strictEqual(secondRecord.seed.toString(), "202");
    assert.strictEqual(secondRecord.challenged, false);
    const proposedSecondState =
      await fightProgram.account.duelState.fetch(duelState);
    assert.deepStrictEqual(
      Buffer.from(proposedSecondState.activeProposal),
      Buffer.from(secondRecord.proposalId),
    );
    assert.notDeepStrictEqual(
      Buffer.from(proposedSecondState.activeProposal),
      firstProposalId,
    );

    await challengeDuelResult(fightProgram, authority, duelKey);
    const retainedFirstRecord =
      await fightProgram.account.proposalRecord.fetch(firstProposalRecord);
    const challengedSecondRecord =
      await fightProgram.account.proposalRecord.fetch(secondProposalRecord);
    assert.strictEqual(retainedFirstRecord.challenged, true);
    assert.deepStrictEqual(
      Buffer.from(retainedFirstRecord.proposalId),
      firstProposalId,
    );
    assert.strictEqual(challengedSecondRecord.challenged, true);

    try {
      await reproposeDuelResult(fightProgram, authority, duelKey, {
        winner: marketSideA(),
        seed: 303,
        replayHash: firstReplayHash,
        resultHash: firstResultHash,
        duelEndTs: await currentChainUnixTimestamp(provider.connection),
      });
      assert.fail(
        "historical evidence identity was accepted after a later cycle",
      );
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "ProposalExists"),
        `expected ProposalExists, got ${String(error)}`,
      );
    }
    const finalState = await fightProgram.account.duelState.fetch(duelState);
    assert.ok(finalState.status.challenged !== undefined);
    assert.deepStrictEqual(
      Buffer.from(finalState.activeProposal),
      Buffer.from(secondRecord.proposalId),
    );
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
      BigInt(takerBalanceBefore.aLockedLamports.toString()) +
        BigInt(takerBalanceBefore.tradeTreasuryFeeLamports.toString()) +
        BigInt(takerBalanceBefore.tradeMarketMakerFeeLamports.toString()),
    );
  });
});
