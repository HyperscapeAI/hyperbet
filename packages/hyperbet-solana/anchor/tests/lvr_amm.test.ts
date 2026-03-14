import * as assert from "node:assert";

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { FightOracle } from "../target/types/fight_oracle";
import { LvrAmm } from "../target/types/lvr_amm";
import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  claimClobWinnings,
  createOpenMarketFixture,
  deriveAdminStatePda,
  deriveMintNoPda,
  deriveMintYesPda,
  hasProgramError,
  placeClobOrder,
  uniqueDuelKey,
} from "./amm-test-helpers";
import { configureAnchorTests } from "./test-anchor";

async function fetchSplBalance(
  connection: anchor.web3.Connection,
  ata: PublicKey,
): Promise<bigint> {
  try {
    const balance = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

async function ensureAta(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  if (await provider.connection.getAccountInfo(ata, "confirmed")) {
    return ata;
  }

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

async function settleBet(
  program: Program<LvrAmm>,
  authority: Keypair,
  marketState: PublicKey,
  betId: BN,
  sideWon: number,
): Promise<void> {
  await program.methods
    .settleBet(betId, sideWon)
    .accountsPartial({
      signer: authority.publicKey,
      adminState: deriveAdminStatePda(program.programId),
      bet: marketState,
    })
    .signers([authority])
    .rpc();
}

describe("lvr_amm", () => {
  const TRADE_AMOUNT_LAMPORTS = BigInt(LAMPORTS_PER_SOL / 10);
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const ammProgram = anchor.workspace.LvrAmm as Program<LvrAmm>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

  it("routes SOL buy fees and token sell fees to the configured treasury", async () => {
    const treasury = Keypair.generate();
    const trader = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 1),
      airdrop(provider.connection, trader.publicKey, 10),
    ]);

    const market = await createOpenMarketFixture(fightProgram, ammProgram, authority, {
      duelKey: uniqueDuelKey("amm-buy-sell-fees"),
      treasury: treasury.publicKey,
      feeBps: 200,
    });
    const bet = await ammProgram.account.bet.fetch(market.marketState);
    const betId = new BN(bet.betId.toString());
    const creator = bet.creator;
    const mintYes = deriveMintYesPda(
      ammProgram.programId,
      BigInt(betId.toString()),
      creator,
    );
    const mintNo = deriveMintNoPda(
      ammProgram.programId,
      BigInt(betId.toString()),
      creator,
    );
    const traderYesAta = getAssociatedTokenAddressSync(
      mintYes,
      trader.publicKey,
      true,
    );
    const traderNoAta = getAssociatedTokenAddressSync(
      mintNo,
      trader.publicKey,
      true,
    );

    const treasurySolBefore = await provider.connection.getBalance(
      treasury.publicKey,
      "confirmed",
    );
    await placeClobOrder(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: treasury.publicKey,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
      orderId: 1,
      side: SIDE_BID,
      price: 600,
      amount: TRADE_AMOUNT_LAMPORTS,
    });

    const treasurySolAfter = await provider.connection.getBalance(
      treasury.publicKey,
      "confirmed",
    );
    assert.strictEqual(
      treasurySolAfter - treasurySolBefore,
      Number(TRADE_AMOUNT_LAMPORTS / 50n),
    );

    const yesBalanceBeforeSell = await fetchSplBalance(
      provider.connection,
      traderYesAta,
    );
    assert.ok(yesBalanceBeforeSell > 0n, "buy should mint YES shares");

    const treasuryYesAta = await ensureAta(
      provider,
      authority,
      treasury.publicKey,
      mintYes,
    );
    const treasuryNoAta = await ensureAta(
      provider,
      authority,
      treasury.publicKey,
      mintNo,
    );
    const sellAmount = yesBalanceBeforeSell / 2n;
    assert.ok(sellAmount > 0n, "sell amount should be positive");

    const treasuryYesBeforeSell = await fetchSplBalance(
      provider.connection,
      treasuryYesAta,
    );
    const noBalanceBeforeSell = await fetchSplBalance(
      provider.connection,
      traderNoAta,
    );

    await ammProgram.methods
      .sell(betId, 0, new BN(sellAmount.toString()))
      .accountsPartial({
        signer: trader.publicKey,
        bet: market.marketState,
        mintYes,
        mintNo,
        destinationYes: traderYesAta,
        destinationNo: traderNoAta,
        treasury: treasury.publicKey,
        treasuryYesAta,
        treasuryNoAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    const treasuryYesAfterSell = await fetchSplBalance(
      provider.connection,
      treasuryYesAta,
    );
    const noBalanceAfterSell = await fetchSplBalance(
      provider.connection,
      traderNoAta,
    );
    assert.strictEqual(
      treasuryYesAfterSell - treasuryYesBeforeSell,
      sellAmount / 50n,
    );
    assert.ok(
      noBalanceAfterSell > noBalanceBeforeSell,
      "selling YES should mint NO shares to the trader",
    );
  });

  it("rejects winner claims before the bet is settled", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const market = await createOpenMarketFixture(fightProgram, ammProgram, authority, {
      duelKey: uniqueDuelKey("amm-claim-before-settle"),
    });

    await placeClobOrder(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
      orderId: 1,
      side: SIDE_BID,
      price: 600,
      amount: TRADE_AMOUNT_LAMPORTS,
    });

    try {
      await claimClobWinnings(ammProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: trader,
      });
      assert.fail("claim should fail before settlement");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "BetNotSettled") ||
          hasProgramError(error, "Bet not settled"),
        `expected BetNotSettled, got ${String(error)}`,
      );
    }
  });

  it("only settles once and only with a valid winning side", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const market = await createOpenMarketFixture(fightProgram, ammProgram, authority, {
      duelKey: uniqueDuelKey("amm-settle-validation"),
    });
    const bet = await ammProgram.account.bet.fetch(market.marketState);
    const betId = new BN(bet.betId.toString());

    await placeClobOrder(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
      orderId: 1,
      side: SIDE_BID,
      price: 600,
      amount: TRADE_AMOUNT_LAMPORTS,
    });

    try {
      await settleBet(ammProgram, authority, market.marketState, betId, 3);
      assert.fail("invalid winner side should be rejected");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "OutComeCanOnlyBe01") ||
          hasProgramError(error, "outcome can only be 0"),
        `expected invalid outcome error, got ${String(error)}`,
      );
    }

    await settleBet(ammProgram, authority, market.marketState, betId, 0);

    try {
      await settleBet(ammProgram, authority, market.marketState, betId, 1);
      assert.fail("second settlement should be rejected");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "BetAlreadySettled") ||
          hasProgramError(error, "Bet already settled"),
        `expected BetAlreadySettled, got ${String(error)}`,
      );
    }
  });

  it("allows cancelled-market cleanup without paying out extra lamports", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const market = await createOpenMarketFixture(fightProgram, ammProgram, authority, {
      duelKey: uniqueDuelKey("amm-cancel-cleanup"),
    });

    await placeClobOrder(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
      orderId: 1,
      side: SIDE_BID,
      price: 600,
      amount: TRADE_AMOUNT_LAMPORTS,
    });

    const bet = await ammProgram.account.bet.fetch(market.marketState);
    const betId = new BN(bet.betId.toString());
    const mintYes = deriveMintYesPda(
      ammProgram.programId,
      BigInt(betId.toString()),
      bet.creator,
    );
    const traderYesAta = getAssociatedTokenAddressSync(
      mintYes,
      trader.publicKey,
      true,
    );
    const traderShares = await fetchSplBalance(provider.connection, traderYesAta);
    assert.ok(traderShares > 0n, "cancelled trader should hold YES shares");

    const betLamportsBeforeClaim = BigInt(
      await provider.connection.getBalance(market.marketState, "confirmed"),
    );
    await settleBet(ammProgram, authority, market.marketState, betId, 2);
    await claimClobWinnings(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
    });
    const betLamportsAfterClaim = BigInt(
      await provider.connection.getBalance(market.marketState, "confirmed"),
    );

    assert.strictEqual(
      await fetchSplBalance(provider.connection, traderYesAta),
      0n,
    );
    assert.strictEqual(
      betLamportsAfterClaim,
      betLamportsBeforeClaim,
    );
  });

  it("pays the winner and burns the loser without draining extra lamports", async () => {
    const winner = Keypair.generate();
    const loser = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, winner.publicKey, 10),
      airdrop(provider.connection, loser.publicKey, 10),
    ]);

    const market = await createOpenMarketFixture(fightProgram, ammProgram, authority, {
      duelKey: uniqueDuelKey("amm-withdraw-resolution"),
    });

    await placeClobOrder(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: winner,
      orderId: 1,
      side: SIDE_BID,
      price: 600,
      amount: TRADE_AMOUNT_LAMPORTS,
    });
    await placeClobOrder(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: loser,
      orderId: 2,
      side: SIDE_ASK,
      price: 400,
      amount: TRADE_AMOUNT_LAMPORTS,
    });

    const bet = await ammProgram.account.bet.fetch(market.marketState);
    const betId = new BN(bet.betId.toString());
    const creator = bet.creator;
    const mintYes = deriveMintYesPda(
      ammProgram.programId,
      BigInt(betId.toString()),
      creator,
    );
    const mintNo = deriveMintNoPda(
      ammProgram.programId,
      BigInt(betId.toString()),
      creator,
    );
    const winnerYesAta = getAssociatedTokenAddressSync(
      mintYes,
      winner.publicKey,
      true,
    );
    const loserNoAta = getAssociatedTokenAddressSync(
      mintNo,
      loser.publicKey,
      true,
    );

    const winnerShares = await fetchSplBalance(provider.connection, winnerYesAta);
    const loserShares = await fetchSplBalance(provider.connection, loserNoAta);
    assert.ok(winnerShares > 0n, "winner should hold YES shares");
    assert.ok(loserShares > 0n, "loser should hold NO shares");

    await settleBet(ammProgram, authority, market.marketState, betId, 0);

    const betLamportsBeforeWinner = BigInt(
      await provider.connection.getBalance(market.marketState, "confirmed"),
    );
    await claimClobWinnings(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: winner,
    });
    const betLamportsAfterWinner = BigInt(
      await provider.connection.getBalance(market.marketState, "confirmed"),
    );
    assert.strictEqual(
      betLamportsBeforeWinner - betLamportsAfterWinner,
      winnerShares,
    );
    assert.strictEqual(
      await fetchSplBalance(provider.connection, winnerYesAta),
      0n,
    );

    await claimClobWinnings(ammProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: loser,
    });
    const betLamportsAfterLoser = BigInt(
      await provider.connection.getBalance(market.marketState, "confirmed"),
    );
    assert.strictEqual(betLamportsAfterLoser, betLamportsAfterWinner);
    assert.strictEqual(
      await fetchSplBalance(provider.connection, loserNoAta),
      0n,
    );
  });
});
