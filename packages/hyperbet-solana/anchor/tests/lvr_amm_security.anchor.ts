import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as assert from "assert";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { FightOracle } from "../target/types/fight_oracle";
import { LvrAmm } from "../target/types/lvr_amm";
import {
  airdrop,
  cancelDuel,
  deriveAdminStatePda,
  deriveAmmConfigPda,
  deriveBetPda,
  deriveDuelStatePda,
  deriveMintNoPda,
  deriveMintYesPda,
  deriveProgramDataAddress,
  duelStatusBettingOpen,
  ensureAmmConfig,
  ensureLvrAdmin,
  ensureOracleReady,
  hasProgramError,
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

async function ensureAta(
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const existing = await provider.connection.getAccountInfo(ata);
  if (existing) return ata;

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
    ),
  );
  await provider.sendAndConfirm(tx, [payer]);
  return ata;
}

async function waitUntilAfter(unixTs: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= unixTs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function createBetFixture(options?: {
  creator?: Keypair;
  duelKey?: readonly number[];
  expirationOffsetSecs?: number;
  initialized?: boolean;
  initialLiqLamports?: number;
  isDynamic?: boolean;
  treasury?: PublicKey;
}): Promise<{
  adminState: PublicKey;
  ammConfig: PublicKey;
  bet: PublicKey;
  mintYes: PublicKey;
  mintNo: PublicKey;
  betId: BN;
  betIdBigInt: bigint;
  duelKey: number[];
  creator: Keypair;
  treasury: PublicKey;
  expirationAt: number;
}> {
  const creator = options?.creator ?? Keypair.generate();
  const duelKey = [...(options?.duelKey ?? uniqueDuelKey("lvr-amm-security"))];
  const treasury = options?.treasury ?? authority.publicKey;
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
    Math.floor(Date.now() / 1000) + (options?.expirationOffsetSecs ?? 60);

  await airdrop(provider.connection, creator.publicKey, 10);
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
    treasury,
  );

  await ammProgram.methods
    .createBetAccount(
      betId,
      new BN(options?.initialLiqLamports ?? 5_000_000),
      options?.isDynamic ?? false,
      "LVR AMM security fixture",
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

  if (options?.initialized ?? true) {
    await ammProgram.methods
      .initBetAccount(betId)
      .accountsPartial({
        signer: creator.publicKey,
        bet,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
  }

  return {
    adminState,
    ammConfig,
    bet,
    mintYes,
    mintNo,
    betId,
    betIdBigInt,
    duelKey,
    creator,
    treasury,
    expirationAt,
  };
}

describe("lvr_amm security", () => {
  it("rejects config initialization by a non-upgrade authority", async function () {
    const ammConfig = deriveAmmConfigPda(ammProgram.programId);
    const existingConfig =
      await (ammProgram.account as any).ammConfig.fetchNullable(ammConfig);
    if (existingConfig) {
      this.skip();
    }

    const attacker = Keypair.generate();
    await airdrop(provider.connection, attacker.publicKey, 1);

    try {
      await ammProgram.methods
        .initializeConfig(
          attacker.publicKey,
          attacker.publicKey,
          fightProgram.programId,
          200,
        )
        .accountsPartial({
          ammConfig,
          signer: attacker.publicKey,
          program: ammProgram.programId,
          programData: deriveProgramDataAddress(ammProgram.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("initialize_config accepted a non-upgrade authority");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "UnauthorizedInitializer"),
        `expected UnauthorizedInitializer, got ${String(error)}`,
      );
    }
  });

  it("rejects dynamic market creation while dynamic liquidity is disabled", async () => {
    try {
      await createBetFixture({
        isDynamic: true,
        expirationOffsetSecs: 300,
      });
      assert.fail("create_bet_account accepted a dynamic market");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "DynamicMarketsDisabled"),
        `expected DynamicMarketsDisabled, got ${String(error)}`,
      );
    }
  });

  it("rejects settlement with a duel PDA derived from a different duel key", async () => {
    const fixture = await createBetFixture({ expirationOffsetSecs: -60 });
    const now = Math.floor(Date.now() / 1000);
    const otherDuelKey = uniqueDuelKey("wrong-duel");
    const wrongDuelState = deriveDuelStatePda(fightProgram.programId, otherDuelKey);

    await upsertDuel(fightProgram, authority, otherDuelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 120,
      betCloseTs: now - 60,
      duelStartTs: now - 30,
      metadataUri: "https://tests/wrong-duel",
    });
    await cancelDuel(fightProgram, authority, otherDuelKey);

    try {
      await ammProgram.methods
        .settleBet(fixture.betId, 0)
        .accountsPartial({
          signer: authority.publicKey,
          ammConfig: fixture.ammConfig,
          adminState: fixture.adminState,
          bet: fixture.bet,
          duelState: wrongDuelState,
        })
        .signers([authority])
        .rpc();
      assert.fail("settle_bet accepted an unrelated duel PDA");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "OracleBetMismatch"),
        `expected OracleBetMismatch, got ${String(error)}`,
      );
    }
  });

  it("rejects settlement with a duel account owned by the wrong program", async () => {
    const fixture = await createBetFixture({ expirationOffsetSecs: -60 });

    try {
      await ammProgram.methods
        .settleBet(fixture.betId, 0)
        .accountsPartial({
          signer: authority.publicKey,
          ammConfig: fixture.ammConfig,
          adminState: fixture.adminState,
          bet: fixture.bet,
          duelState: fixture.bet,
        })
        .signers([authority])
        .rpc();
      assert.fail("settle_bet accepted a non-oracle-owned account");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "Fight oracle program mismatch"),
        `expected Fight oracle program mismatch, got ${String(error)}`,
      );
    }
  });

  it("rejects buys before init_bet_account funds the bet", async () => {
    const creator = Keypair.generate();
    const buyer = Keypair.generate();
    const fixture = await createBetFixture({
      creator,
      initialized: false,
      expirationOffsetSecs: 300,
    });

    await airdrop(provider.connection, buyer.publicKey, 5);
    const destinationYes = await ensureAta(fixture.mintYes, buyer.publicKey, buyer);
    const destinationNo = await ensureAta(fixture.mintNo, buyer.publicKey, buyer);

    try {
      await ammProgram.methods
        .buy(fixture.betId, 0, new BN(100_000))
        .accountsPartial({
          signer: buyer.publicKey,
          ammConfig: fixture.ammConfig,
          bet: fixture.bet,
          treasury: fixture.treasury,
          mintYes: fixture.mintYes,
          mintNo: fixture.mintNo,
          destinationYes,
          destinationNo,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();
      assert.fail("buy succeeded before init_bet_account");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "Bet not initialized"),
        `expected Bet not initialized, got ${String(error)}`,
      );
    }
  });

  it("redeems YES holders at 0.5:1 after a cancelled oracle duel", async () => {
    const buyer = Keypair.generate();
    const fixture = await createBetFixture({ expirationOffsetSecs: 15 });
    await airdrop(provider.connection, buyer.publicKey, 5);
    const destinationYes = await ensureAta(fixture.mintYes, buyer.publicKey, buyer);
    const destinationNo = await ensureAta(fixture.mintNo, buyer.publicKey, buyer);

    await ammProgram.methods
      .buy(fixture.betId, 0, new BN(100_000))
      .accountsPartial({
        signer: buyer.publicKey,
        ammConfig: fixture.ammConfig,
        bet: fixture.bet,
        treasury: fixture.treasury,
        mintYes: fixture.mintYes,
        mintNo: fixture.mintNo,
        destinationYes,
        destinationNo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const now = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram, authority, fixture.duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 120,
      betCloseTs: now - 60,
      duelStartTs: now - 30,
      metadataUri: "https://tests/cancel-yes",
    });
    await cancelDuel(fightProgram, authority, fixture.duelKey);
    await waitUntilAfter(fixture.expirationAt);

    const duelState = deriveDuelStatePda(fightProgram.programId, fixture.duelKey);
    await ammProgram.methods
      .settleBet(fixture.betId, 0)
      .accountsPartial({
        signer: authority.publicKey,
        ammConfig: fixture.ammConfig,
        adminState: fixture.adminState,
        bet: fixture.bet,
        duelState,
      })
      .signers([authority])
      .rpc();

    const yesBalance = await provider.connection.getTokenAccountBalance(destinationYes);
    const q = Number(yesBalance.value.amount);
    const betBalanceBefore = await provider.connection.getBalance(fixture.bet);

    await ammProgram.methods
      .withdrawPostSettle(fixture.betId, 0, new BN(q))
      .accountsPartial({
        signer: buyer.publicKey,
        bet: fixture.bet,
        mintYes: fixture.mintYes,
        mintNo: fixture.mintNo,
        destinationYes,
        destinationNo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const betBalanceAfter = await provider.connection.getBalance(fixture.bet);
    const yesBalanceAfter = await provider.connection.getTokenAccountBalance(destinationYes);
    assert.strictEqual(betBalanceBefore - betBalanceAfter, Math.floor(q / 2));
    assert.strictEqual(Number(yesBalanceAfter.value.amount), 0);
  });

  it("redeems NO holders at 0.5:1 after a cancelled oracle duel", async () => {
    const buyer = Keypair.generate();
    const fixture = await createBetFixture({ expirationOffsetSecs: 15 });
    await airdrop(provider.connection, buyer.publicKey, 5);
    const destinationYes = await ensureAta(fixture.mintYes, buyer.publicKey, buyer);
    const destinationNo = await ensureAta(fixture.mintNo, buyer.publicKey, buyer);

    await ammProgram.methods
      .buy(fixture.betId, 1, new BN(100_000))
      .accountsPartial({
        signer: buyer.publicKey,
        ammConfig: fixture.ammConfig,
        bet: fixture.bet,
        treasury: fixture.treasury,
        mintYes: fixture.mintYes,
        mintNo: fixture.mintNo,
        destinationYes,
        destinationNo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const now = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram, authority, fixture.duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 120,
      betCloseTs: now - 60,
      duelStartTs: now - 30,
      metadataUri: "https://tests/cancel-no",
    });
    await cancelDuel(fightProgram, authority, fixture.duelKey);
    await waitUntilAfter(fixture.expirationAt);

    const duelState = deriveDuelStatePda(fightProgram.programId, fixture.duelKey);
    await ammProgram.methods
      .settleBet(fixture.betId, 0)
      .accountsPartial({
        signer: authority.publicKey,
        ammConfig: fixture.ammConfig,
        adminState: fixture.adminState,
        bet: fixture.bet,
        duelState,
      })
      .signers([authority])
      .rpc();

    const noBalance = await provider.connection.getTokenAccountBalance(destinationNo);
    const q = Number(noBalance.value.amount);
    const betBalanceBefore = await provider.connection.getBalance(fixture.bet);

    await ammProgram.methods
      .withdrawPostSettle(fixture.betId, 1, new BN(q))
      .accountsPartial({
        signer: buyer.publicKey,
        bet: fixture.bet,
        mintYes: fixture.mintYes,
        mintNo: fixture.mintNo,
        destinationYes,
        destinationNo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const betBalanceAfter = await provider.connection.getBalance(fixture.bet);
    const noBalanceAfter = await provider.connection.getTokenAccountBalance(destinationNo);
    assert.strictEqual(betBalanceBefore - betBalanceAfter, Math.floor(q / 2));
    assert.strictEqual(Number(noBalanceAfter.value.amount), 0);
  });

  it("rejects sells when the YES source ATA is not owned by the signer", async () => {
    const buyer = Keypair.generate();
    const fixture = await createBetFixture({ expirationOffsetSecs: 300 });
    await airdrop(provider.connection, buyer.publicKey, 5);
    const destinationYes = await ensureAta(fixture.mintYes, buyer.publicKey, buyer);
    const destinationNo = await ensureAta(fixture.mintNo, buyer.publicKey, buyer);
    const rogueYesAta = await ensureAta(fixture.mintYes, authority.publicKey, authority);
    await ammProgram.methods
      .buy(fixture.betId, 0, new BN(100_000))
      .accountsPartial({
        signer: buyer.publicKey,
        ammConfig: fixture.ammConfig,
        bet: fixture.bet,
        treasury: fixture.treasury,
        mintYes: fixture.mintYes,
        mintNo: fixture.mintNo,
        destinationYes,
        destinationNo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    try {
      await ammProgram.methods
        .sell(fixture.betId, 0, new BN(1))
        .accountsPartial({
          signer: buyer.publicKey,
          ammConfig: fixture.ammConfig,
          bet: fixture.bet,
          mintYes: fixture.mintYes,
          mintNo: fixture.mintNo,
          destinationYes: rogueYesAta,
          destinationNo,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();
      assert.fail("sell accepted a YES source ATA owned by another wallet");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "ConstraintAssociated") ||
          hasProgramError(error, "ConstraintTokenOwner"),
        `expected associated/token owner constraint failure, got ${String(error)}`,
      );
    }
  });

  it("rejects sells when the YES source ATA mint does not match the expected mint", async () => {
    const buyer = Keypair.generate();
    const fixture = await createBetFixture({ expirationOffsetSecs: 300 });
    await airdrop(provider.connection, buyer.publicKey, 5);
    const destinationYes = await ensureAta(fixture.mintYes, buyer.publicKey, buyer);
    const destinationNo = await ensureAta(fixture.mintNo, buyer.publicKey, buyer);
    await ammProgram.methods
      .buy(fixture.betId, 0, new BN(100_000))
      .accountsPartial({
        signer: buyer.publicKey,
        ammConfig: fixture.ammConfig,
        bet: fixture.bet,
        treasury: fixture.treasury,
        mintYes: fixture.mintYes,
        mintNo: fixture.mintNo,
        destinationYes,
        destinationNo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    try {
      await ammProgram.methods
        .sell(fixture.betId, 0, new BN(1))
        .accountsPartial({
          signer: buyer.publicKey,
          ammConfig: fixture.ammConfig,
          bet: fixture.bet,
          mintYes: fixture.mintYes,
          mintNo: fixture.mintNo,
          destinationYes: destinationNo,
          destinationNo: destinationYes,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();
      assert.fail("sell accepted a YES source ATA for the wrong mint");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "ConstraintAssociated") ||
          hasProgramError(error, "ConstraintTokenMint"),
        `expected associated-token or mint constraint failure, got ${String(error)}`,
      );
    }
  });
});
