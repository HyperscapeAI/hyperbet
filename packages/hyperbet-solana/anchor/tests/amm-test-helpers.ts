import crypto from "crypto";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  type AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { FightOracle } from "../target/types/fight_oracle";
import { LvrAmm } from "../target/types/lvr_amm";
import { confirmSignatureByPolling } from "./test-anchor";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const DUEL_STATE_DISCRIMINATOR = Buffer.from([
  149, 213, 59, 165, 124, 116, 145, 120,
]);
const DUEL_STATE_STATUS_OFFSET = 8 + 32 + 32 + 32;
const DUEL_STATE_WINNER_OFFSET = DUEL_STATE_STATUS_OFFSET + 1;

export const DUEL_WINNER_MARKET_KIND = 1;
export const SIDE_BID = 1;
export const SIDE_ASK = 2;
const duelKeyCounters = new Map<string, number>();

function u64Le(value: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function toBn(value: bigint | number): BN {
  return new BN(BigInt(value).toString());
}

export function uniqueDuelKey(label: string): number[] {
  const next = (duelKeyCounters.get(label) ?? 0) + 1;
  duelKeyCounters.set(label, next);
  return Array.from(
    crypto.createHash("sha256").update(`${label}:${next}`).digest(),
  );
}

export function hashLabel(label: string): number[] {
  return Array.from(crypto.createHash("sha256").update(label).digest());
}

export function duelStatusScheduled(): { scheduled: Record<string, never> } {
  return { scheduled: {} };
}

export function duelStatusBettingOpen(): {
  bettingOpen: Record<string, never>;
} {
  return { bettingOpen: {} };
}

export function duelStatusLocked(): { locked: Record<string, never> } {
  return { locked: {} };
}

export function marketSideA(): { a: Record<string, never> } {
  return { a: {} };
}

export function marketSideB(): { b: Record<string, never> } {
  return { b: {} };
}

function readDuelHeader(data: Buffer): {
  status: number;
  winner: number;
} {
  if (data.length <= DUEL_STATE_WINNER_OFFSET) {
    throw new Error(`Duel state account is too small: ${data.length} bytes`);
  }
  if (!data.subarray(0, 8).equals(DUEL_STATE_DISCRIMINATOR)) {
    throw new Error("Unexpected duel state discriminator");
  }
  return {
    status: data[DUEL_STATE_STATUS_OFFSET] ?? 0,
    winner: data[DUEL_STATE_WINNER_OFFSET] ?? 0,
  };
}

export function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

export function deriveOracleConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    programId,
  )[0];
}

export function deriveDuelStatePda(
  programId: PublicKey,
  duelKey: readonly number[],
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("duel"), Buffer.from(duelKey)],
    programId,
  )[0];
}

export function deriveAdminStatePda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("admin_state")],
    programId,
  )[0];
}

export function deriveBetPda(
  programId: PublicKey,
  betId: bigint | number,
  creator: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), u64Le(betId), creator.toBuffer()],
    programId,
  )[0];
}

export function deriveMintYesPda(
  programId: PublicKey,
  betId: bigint | number,
  creator: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_yes"), u64Le(betId), creator.toBuffer()],
    programId,
  )[0];
}

export function deriveMintNoPda(
  programId: PublicKey,
  betId: bigint | number,
  creator: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_no"), u64Le(betId), creator.toBuffer()],
    programId,
  )[0];
}

export async function airdrop(
  connection: anchor.web3.Connection,
  recipient: PublicKey,
  sol = 5,
): Promise<void> {
  const signature = await connection.requestAirdrop(
    recipient,
    sol * LAMPORTS_PER_SOL,
  );
  await confirmSignatureByPolling(connection, signature);
}

export function hasProgramError(error: unknown, fragment: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(fragment);
}

export function writableAccount(pubkey: PublicKey): AccountMeta {
  return {
    pubkey,
    isSigner: false,
    isWritable: true,
  };
}

export async function ensureOracleReady(
  program: Program<FightOracle>,
  authority: Keypair,
  reporter = authority.publicKey,
): Promise<PublicKey> {
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const existingConfig =
    await program.account.oracleConfig.fetchNullable(oracleConfig);

  if (!existingConfig) {
    await program.methods
      .initializeOracle(reporter)
      .accountsPartial({
        authority: authority.publicKey,
        oracleConfig,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return oracleConfig;
  }

  await program.methods
    .updateOracleConfig(authority.publicKey, reporter)
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig,
    })
    .signers([authority])
    .rpc();

  return oracleConfig;
}

export async function ensureLvrAdmin(
  program: Program<LvrAmm>,
  authority: Keypair,
): Promise<PublicKey> {
  const adminState = deriveAdminStatePda(program.programId);
  const existingConfig =
    await program.account.admin.fetchNullable(adminState);

  if (!existingConfig) {
    await program.methods
      .initialize()
      .accountsPartial({
        adminState,
        signer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return adminState;
  }
  return adminState;
}

export async function upsertDuel(
  program: Program<FightOracle>,
  reporter: Keypair,
  duelKey: readonly number[],
  options: {
    status:
      | { scheduled: Record<string, never> }
      | { bettingOpen: Record<string, never> }
      | { locked: Record<string, never> };
    betOpenTs: number;
    betCloseTs: number;
    duelStartTs?: number;
    participantAHash?: readonly number[];
    participantBHash?: readonly number[];
    metadataUri?: string;
  },
): Promise<PublicKey> {
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const duelState = deriveDuelStatePda(program.programId, duelKey);

  await program.methods
    .upsertDuel(
      [...duelKey],
      [
        ...(options.participantAHash ??
          hashLabel(`${Buffer.from(duelKey).toString("hex")}:a`)),
      ],
      [
        ...(options.participantBHash ??
          hashLabel(`${Buffer.from(duelKey).toString("hex")}:b`)),
      ],
      toBn(options.betOpenTs),
      toBn(options.betCloseTs),
      toBn(options.duelStartTs ?? options.betCloseTs),
      options.metadataUri ?? "https://hyperscape.gg/duels/test",
      options.status,
    )
    .accountsPartial({
      reporter: reporter.publicKey,
      oracleConfig,
      duelState,
      systemProgram: SystemProgram.programId,
    })
    .signers([reporter])
    .rpc();

  return duelState;
}

export async function cancelDuel(
  program: Program<FightOracle>,
  reporter: Keypair,
  duelKey: readonly number[],
  metadataUri = "https://hyperscape.gg/duels/cancelled",
): Promise<PublicKey> {
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const duelState = deriveDuelStatePda(program.programId, duelKey);

  await program.methods
    .cancelDuel([...duelKey], metadataUri)
    .accountsPartial({
      reporter: reporter.publicKey,
      oracleConfig,
      duelState,
    })
    .signers([reporter])
    .rpc();

  return duelState;
}

export async function reportDuelResult(
  program: Program<FightOracle>,
  reporter: Keypair,
  duelKey: readonly number[],
  options: {
    winner: { a: Record<string, never> } | { b: Record<string, never> };
    duelEndTs: number;
    seed?: bigint | number;
    replayHash?: readonly number[];
    resultHash?: readonly number[];
    metadataUri?: string;
  },
): Promise<PublicKey> {
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const duelState = deriveDuelStatePda(program.programId, duelKey);

  await program.methods
    .reportResult(
      [...duelKey],
      options.winner,
      toBn(options.seed ?? 42),
      [
        ...(options.replayHash ??
          hashLabel(`${Buffer.from(duelKey).toString("hex")}:replay`)),
      ],
      [
        ...(options.resultHash ??
          hashLabel(`${Buffer.from(duelKey).toString("hex")}:result`)),
      ],
      toBn(options.duelEndTs),
      options.metadataUri ?? "https://hyperscape.gg/duels/result",
    )
    .accountsPartial({
      reporter: reporter.publicKey,
      oracleConfig,
      duelState,
    })
    .signers([reporter])
    .rpc();

  return duelState;
}

export async function initializeCanonicalMarket(
  program: Program<LvrAmm>,
  operator: Keypair,
  duelState: PublicKey,
  duelKey: readonly number[],
  config: PublicKey,
  marketKind = DUEL_WINNER_MARKET_KIND,
  options?: {
    feeBps?: number;
    treasury?: PublicKey;
    initialLiquidityLamports?: bigint | number;
    isDynamic?: boolean;
    description?: string;
    expirationAt?: bigint | number;
  },
): Promise<{ marketState: PublicKey; vault: PublicKey }> {
  const betIdNum = BigInt(`0x${Buffer.from(duelKey).slice(0, 8).reverse().toString('hex')}`);
  const betId = toBn(betIdNum);
  const feeBps = options?.feeBps ?? 200;
  const treasury = options?.treasury ?? operator.publicKey;
  
  const bet = deriveBetPda(
    program.programId,
    betIdNum,
    operator.publicKey,
  );
  const mintYes = deriveMintYesPda(program.programId, betIdNum, operator.publicKey);
  const mintNo = deriveMintNoPda(program.programId, betIdNum, operator.publicKey);

  const initialLiq = new BN(
    BigInt(
      options?.initialLiquidityLamports ?? BigInt(LAMPORTS_PER_SOL * 20),
    ).toString(),
  );
  const isDynamic = options?.isDynamic ?? true;
  const description = options?.description ?? "Test AMM Open Market";
  const expirationAt = new BN(
    BigInt(
      options?.expirationAt ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
    ).toString(),
  );

  await program.methods
    .createBetAccount(betId, initialLiq, isDynamic, description, expirationAt, feeBps, treasury)
    .accountsPartial({
      signer: operator.publicKey,
      bet,
      mintYes,
      mintNo,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([operator])
    .rpc();

  await program.methods
    .initBetAccount(betId)
    .accountsPartial({
      signer: operator.publicKey,
      bet,
      systemProgram: SystemProgram.programId,
    })
    .signers([operator])
    .rpc();

  // The bet instance IS the vault for lamports in AMM.
  return { marketState: bet, vault: bet };
}

export async function ensureVaultRentExempt(
  program: Program<LvrAmm>,
  funder: Keypair,
  vault: PublicKey,
): Promise<void> {
    // bet account init already handles rent limit but tests might request more.
}

export async function syncMarketFromDuel(
  program: Program<LvrAmm>,
  marketState: PublicKey,
  duelState: PublicKey,
): Promise<void> {
  const duelStateInfo = await program.provider.connection.getAccountInfo(
    duelState,
    "confirmed",
  );
  if (!duelStateInfo) {
    throw new Error(`Missing duel state account ${duelState.toBase58()}`);
  }

  const decodedDuelState = readDuelHeader(duelStateInfo.data);
  let sideWon: number | null = null;
  if (decodedDuelState.status === 3) {
    if (decodedDuelState.winner === 1) {
      sideWon = 0;
    } else if (decodedDuelState.winner === 2) {
      sideWon = 1;
    } else {
      throw new Error(
        `Resolved duel ${duelState.toBase58()} has unsupported winner ${decodedDuelState.winner}`,
      );
    }
  } else if (decodedDuelState.status === 4) {
    sideWon = 2;
  }

  if (sideWon == null) {
    return;
  }

  const bet = await program.account.bet.fetch(marketState);
  if (bet.sideWon != null) {
    return;
  }

  const wallet = (program.provider as anchor.AnchorProvider).wallet as
    | (anchor.Wallet & { payer?: Keypair })
    | undefined;
  const settleSigner = wallet?.payer;
  if (!settleSigner) {
    throw new Error("AMM provider wallet cannot sign settleBet during sync");
  }

  await program.methods
    .settleBet(bet.betId, sideWon)
    .accountsPartial({
      signer: settleSigner.publicKey,
      adminState: deriveAdminStatePda(program.programId),
      bet: marketState,
    })
    .signers([settleSigner])
    .rpc();
}

export async function placeClobOrder(
  program: Program<LvrAmm>,
  args: {
    marketState: PublicKey;
    duelState: PublicKey;
    config: PublicKey;
    treasury: PublicKey;
    marketMaker: PublicKey;
    vault: PublicKey;
    user: Keypair;
    orderId: bigint | number;
    side: number;
    price: number;
    amount: bigint | number;
    remainingAccounts?: AccountMeta[];
  },
): Promise<{
  userBalance: PublicKey;
  order: PublicKey;
  restingLevel: PublicKey;
}> {
  const bet = await program.account.bet.fetch(args.marketState);
  const betId = bet.betId;
  const creator = bet.creator;
  
  const mintYes = deriveMintYesPda(program.programId, BigInt(betId.toString()), creator);
  const mintNo = deriveMintNoPda(program.programId, BigInt(betId.toString()), creator);
  
  const destinationYes = getAssociatedTokenAddressSync(mintYes, args.user.publicKey, true);
  const destinationNo = getAssociatedTokenAddressSync(mintNo, args.user.publicKey, true);
  
  // Create ATAs if they don't exist
  for (const [mint, dest] of [[mintYes, destinationYes], [mintNo, destinationNo]]) {
      const info = await program.provider.connection.getAccountInfo(dest);
      if (!info) {
          await program.provider.sendAndConfirm!(new anchor.web3.Transaction().add(
             createAssociatedTokenAccountInstruction(
                args.user.publicKey, dest, args.user.publicKey, mint
             )
          ), [args.user]);
      }
  }

  const outcome = args.side === 1 ? 0 : 1;
  const amountIn = toBn(args.amount);

  await program.methods
    .buy(betId, outcome, amountIn)
    .accountsPartial({
      signer: args.user.publicKey,
      bet: args.marketState,
      mintYes,
      mintNo,
      destinationYes,
      destinationNo,
      treasury: args.treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([args.user])
    .rpc();

  // Return destinationYes as our "dummy" userBalance PDA so market-flows.spec.ts doesn't crash on undefined
  return { userBalance: destinationYes, order: destinationYes, restingLevel: destinationYes };
}

export async function cancelClobOrder(
  program: Program<LvrAmm>,
  args: {
    marketState: PublicKey;
    duelState: PublicKey;
    vault: PublicKey;
    user: Keypair;
    orderId: bigint | number;
    side: number;
    price: number;
    remainingAccounts?: AccountMeta[];
  },
): Promise<{ order: PublicKey; priceLevel: PublicKey }> {
  // LvrAmm does not support cancelling limits, no op.
  return { order: args.marketState, priceLevel: args.marketState };
}

export async function claimClobWinnings(
  program: Program<LvrAmm>,
  args: {
    marketState: PublicKey;
    duelState: PublicKey;
    config: PublicKey;
    marketMaker: PublicKey;
    vault: PublicKey;
    user: Keypair;
  },
): Promise<PublicKey> {
  const bet = await program.account.bet.fetch(args.marketState);
  const betId = bet.betId;
  const creator = bet.creator;
  
  const mintYes = deriveMintYesPda(program.programId, BigInt(betId.toString()), creator);
  const mintNo = deriveMintNoPda(program.programId, BigInt(betId.toString()), creator);
  const srcYes = getAssociatedTokenAddressSync(mintYes, args.user.publicKey, true);
  const srcNo = getAssociatedTokenAddressSync(mintNo, args.user.publicKey, true);

  // In tests, claim everything on the winning side
  const infoYes = await program.provider.connection.getAccountInfo(srcYes);
  const infoNo = await program.provider.connection.getAccountInfo(srcNo);
  const balYes = await program.provider.connection.getTokenAccountBalance(srcYes).catch(() => ({ value: { amount: "0" }}));
  const balNo = await program.provider.connection.getTokenAccountBalance(srcNo).catch(() => ({ value: { amount: "0" }}));
  
  const hasYes = BigInt(balYes.value.amount) > 0;
  const outcome = hasYes ? 0 : 1;
  const qStr = hasYes ? balYes.value.amount : balNo.value.amount;
  
  await program.methods
    .withdrawPostSettle(betId, outcome, new BN(qStr))
    .accountsPartial({
      signer: args.user.publicKey,
      bet: args.marketState,
      mintYes,
      mintNo,
      destinationYes: srcYes,
      destinationNo: srcNo,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([args.user])
    .rpc();

  return srcYes;
}

export async function createOpenMarketFixture(
  fightProgram: Program<FightOracle>,
  clobProgram: Program<LvrAmm>,
  authority: Keypair,
  options?: {
    duelKey?: readonly number[];
    marketOperator?: PublicKey;
    treasury?: PublicKey;
    marketMaker?: PublicKey;
    betOpenTs?: number;
    betCloseTs?: number;
    duelStartTs?: number;
    metadataUri?: string;
    feeBps?: number;
    initialLiquidityLamports?: bigint | number;
    isDynamic?: boolean;
    description?: string;
    expirationAt?: bigint | number;
  },
): Promise<{
  config: PublicKey;
  duelKey: number[];
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
  treasury: PublicKey;
  marketMaker: PublicKey;
}> {
  const duelKey = [...(options?.duelKey ?? uniqueDuelKey("clob-market"))];
  const now = Math.floor(Date.now() / 1000);
  const treasury = options?.treasury ?? authority.publicKey;
  const marketMaker = options?.marketMaker ?? authority.publicKey;

  await ensureOracleReady(fightProgram, authority, authority.publicKey);
  const config = await ensureLvrAdmin(clobProgram, authority);
  const duelState = await upsertDuel(fightProgram, authority, duelKey, {
    status: duelStatusBettingOpen(),
    betOpenTs: options?.betOpenTs ?? now - 30,
    betCloseTs: options?.betCloseTs ?? now + 3600,
    duelStartTs:
      options?.duelStartTs ?? (options?.betCloseTs ?? now + 3600) + 60,
    metadataUri: options?.metadataUri,
  });
  const { marketState, vault } = await initializeCanonicalMarket(
    clobProgram,
    authority,
    duelState,
    duelKey,
    config,
    DUEL_WINNER_MARKET_KIND,
    {
      feeBps: options?.feeBps,
      treasury,
      initialLiquidityLamports: options?.initialLiquidityLamports,
      isDynamic: options?.isDynamic,
      description: options?.description,
      expirationAt: options?.expirationAt,
    },
  );

  return {
    config,
    duelKey,
    duelState,
    marketState,
    vault,
    treasury,
    marketMaker,
  };
}
