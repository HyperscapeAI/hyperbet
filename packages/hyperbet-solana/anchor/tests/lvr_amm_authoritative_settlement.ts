import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as assert from "assert";
import BN from "bn.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { finalizeDuelResult } from "./clob-test-helpers";
import { FightOracle } from "../target/types/fight_oracle";
import { LvrAmm } from "../target/types/lvr_amm";
import {
  airdrop,
  cancelDuel,
  deriveBetPda,
  deriveDuelStatePda,
  deriveMintNoPda,
  deriveMintYesPda,
  duelStatusBettingOpen,
  duelStatusLocked,
  ensureAmmConfig,
  ensureLvrAdmin,
  ensureOracleReady,
  hasProgramError,
  marketSideA,
  reportDuelResult,
  uniqueDuelKey,
  upsertDuel,
} from "./amm-test-helpers";
import { configureAnchorTests } from "./test-anchor";

const provider = configureAnchorTests();
anchor.setProvider(provider);

const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
const ammProgram = anchor.workspace.LvrAmm as Program<LvrAmm>;
const authority = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

function betIdFromDuelKey(duelKey: readonly number[]): bigint {
  return BigInt(
    `0x${Buffer.from(duelKey).slice(0, 8).reverse().toString("hex")}`,
  );
}

async function createBetFixture(options?: {
  duelKey?: readonly number[];
  expirationOffsetSecs?: number;
}): Promise<{
  adminState: PublicKey;
  ammConfig: PublicKey;
  bet: PublicKey;
  betId: BN;
  duelKey: Array<number>;
}> {
  const creator = Keypair.generate();
  const duelKey = [...(options?.duelKey ?? uniqueDuelKey("lvr-amm-settlement"))];
  const betIdBigInt = betIdFromDuelKey(duelKey);
  const betId = new BN(betIdBigInt.toString());
  const bet = deriveBetPda(ammProgram.programId, betIdBigInt, creator.publicKey);
  const mintYes = deriveMintYesPda(
    ammProgram.programId,
    betIdBigInt,
    creator.publicKey,
  );
  const mintNo = deriveMintNoPda(
    ammProgram.programId,
    betIdBigInt,
    creator.publicKey,
  );
  const expirationAt =
    Math.floor(Date.now() / 1000) + (options?.expirationOffsetSecs ?? -60);

  await airdrop(provider.connection, creator.publicKey, 5);
  await ensureOracleReady(
    fightProgram,
    authority,
    authority.publicKey,
    authority.publicKey,
    authority.publicKey,
    60,
  );
  const adminState = await ensureLvrAdmin(ammProgram, authority);
  const ammConfig = await ensureAmmConfig(
    ammProgram,
    authority,
    fightProgram.programId,
    authority.publicKey,
  );

  await ammProgram.methods
    .createBetAccount(
      betId,
      new BN(5_000_000),
      false,
      "Authoritative settlement fixture",
      new BN(expirationAt),
      [...duelKey],
    )
    .accountsPartial({
      signer: creator.publicKey,
      ammConfig,
      bet,
      mintYes,
      mintNo,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([creator])
    .rpc();

  await ammProgram.methods
    .initBetAccount(betId)
    .accountsPartial({
      signer: creator.publicKey,
      bet,
      systemProgram: SystemProgram.programId,
    })
    .signers([creator])
    .rpc();

  return {
    adminState,
    ammConfig,
    bet,
    betId,
    duelKey,
  };
}

async function fetchBetSideWon(bet: PublicKey): Promise<number | null> {
  const account = await (ammProgram.account as any).bet.fetch(bet);
  return account.sideWon as number | null;
}

describe("lvr_amm authoritative settlement", () => {
  it("rejects settlement when duel state is omitted", async () => {
    const fixture = await createBetFixture();

    try {
      await ammProgram.methods
        .settleBet(fixture.betId, 0)
        .accountsPartial({
          signer: authority.publicKey,
          adminState: fixture.adminState,
          ammConfig: fixture.ammConfig,
          bet: fixture.bet,
        })
        .signers([authority])
        .rpc();
      assert.fail("settle_bet accepted a missing duel_state account");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "Invalid duel state account") ||
          String(error).includes("Account `duelState` not provided"),
        `expected missing duel state rejection, got ${String(error)}`,
      );
    }
  });

  it("rejects settlement with a mismatched oracle duel account", async () => {
    const fixture = await createBetFixture();
    const now = Math.floor(Date.now() / 1000);
    const otherDuelKey = uniqueDuelKey("lvr-amm-other-duel");
    const wrongDuelState = deriveDuelStatePda(fightProgram.programId, otherDuelKey);

    await upsertDuel(fightProgram, authority, otherDuelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 180,
      betCloseTs: now - 120,
      duelStartTs: now - 60,
      metadataUri: "https://tests/wrong-duel",
    });

    try {
      await ammProgram.methods
        .settleBet(fixture.betId, 0)
        .accountsPartial({
          signer: authority.publicKey,
          adminState: fixture.adminState,
          ammConfig: fixture.ammConfig,
          bet: fixture.bet,
          duelState: wrongDuelState,
        })
        .signers([authority])
        .rpc();
      assert.fail("settle_bet accepted an unrelated duel account");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "Oracle duel does not match bet"),
        `expected Oracle duel does not match bet, got ${String(error)}`,
      );
    }
  });

  it("rejects settlement until the oracle duel is finalized", async () => {
    const fixture = await createBetFixture();
    const now = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram, authority, fixture.duelKey, {
      status: duelStatusLocked(),
      betOpenTs: now - 180,
      betCloseTs: now - 120,
      duelStartTs: now - 120,
      metadataUri: "https://tests/unresolved-duel",
    });

    try {
      await ammProgram.methods
        .settleBet(fixture.betId, 0)
        .accountsPartial({
          signer: authority.publicKey,
          adminState: fixture.adminState,
          ammConfig: fixture.ammConfig,
          bet: fixture.bet,
          duelState,
        })
        .signers([authority])
        .rpc();
      assert.fail("settle_bet accepted an unresolved duel");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "Bet not expired"),
        `expected Bet not expired, got ${String(error)}`,
      );
    }
  });

  it("settles to the oracle winner after finalization", async () => {
    const fixture = await createBetFixture();
    const now = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram, authority, fixture.duelKey, {
      status: duelStatusLocked(),
      betOpenTs: now - 180,
      betCloseTs: now - 120,
      duelStartTs: now - 120,
      metadataUri: "https://tests/resolved-duel",
    });

    await reportDuelResult(fightProgram, authority, fixture.duelKey, {
      winner: marketSideA(),
      duelEndTs: now - 60,
      metadataUri: "https://tests/resolved-duel/proposed",
    });
    await finalizeDuelResult(
      fightProgram,
      authority,
      fixture.duelKey,
      "https://tests/resolved-duel/final",
    );

    await ammProgram.methods
      .settleBet(fixture.betId, 1)
      .accountsPartial({
        signer: authority.publicKey,
        adminState: fixture.adminState,
        ammConfig: fixture.ammConfig,
        bet: fixture.bet,
        duelState,
      })
      .signers([authority])
      .rpc();

    assert.strictEqual(await fetchBetSideWon(fixture.bet), 0);
  });

  it("records the cancelled-duel sentinel outcome", async () => {
    const fixture = await createBetFixture();
    const now = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram, authority, fixture.duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 180,
      betCloseTs: now - 120,
      duelStartTs: now - 60,
      metadataUri: "https://tests/cancelled-duel",
    });

    await cancelDuel(fightProgram, authority, fixture.duelKey);

    await ammProgram.methods
      .settleBet(fixture.betId, 0)
      .accountsPartial({
        signer: authority.publicKey,
        adminState: fixture.adminState,
        ammConfig: fixture.ammConfig,
        bet: fixture.bet,
        duelState,
      })
      .signers([authority])
      .rpc();

    assert.strictEqual(await fetchBetSideWon(fixture.bet), 2);
  });
});
