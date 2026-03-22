import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { GoldPerpsMarket } from "../target/types/gold_perps_market";
import { confirmSignatureByPolling } from "./test-anchor";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const TEST_RUN_OFFSET = Math.floor(Date.now() % 1_000_000_000);

export const DEFAULT_SKEW_SCALE = SOL(100);
export const DEFAULT_FUNDING_VELOCITY = 1_000;
export const DEFAULT_MAX_ORACLE_STALENESS_SECONDS = Number(
  process.env.HYPERSCAPE_MAX_ORACLE_STALENESS_SECONDS || 5,
);
export const DEFAULT_MIN_ORACLE_SPOT_INDEX = PRICE(80);
export const DEFAULT_MAX_ORACLE_SPOT_INDEX = PRICE(120);
export const DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS = 2_500;
export const DEFAULT_MIN_MARGIN = SOL(0.1);
export const DEFAULT_MAX_LEVERAGE = 5;
export const DEFAULT_MAX_MARKET_OPEN_INTEREST = SOL(25);
export const DEFAULT_MIN_MARKET_INSURANCE = SOL(12);
export const DEFAULT_MAINTENANCE_MARGIN_BPS = 500;
export const DEFAULT_LIQUIDATION_FEE_BPS = 100;
export const DEFAULT_TRADE_TREASURY_FEE_BPS = 25;
export const DEFAULT_TRADE_MARKET_MAKER_FEE_BPS = 25;
export const PERPS_STATUS_ACTIVE = 0;
export const PERPS_STATUS_CLOSE_ONLY = 1;
export const PERPS_STATUS_ARCHIVED = 2;
export const TOTAL_TRADE_FEE_BPS =
  DEFAULT_TRADE_TREASURY_FEE_BPS + DEFAULT_TRADE_MARKET_MAKER_FEE_BPS;
export const DEFAULT_STALE_WAIT_MS = Number(
  process.env.GOLD_PERPS_TEST_STALE_WAIT_MS ||
    String((DEFAULT_MAX_ORACLE_STALENESS_SECONDS + 2) * 1_000),
);

export function SOL(amount: number): number {
  return Math.round(amount * LAMPORTS_PER_SOL);
}

export function PRICE(amount: number): number {
  return SOL(amount);
}

export function toBn(value: number): anchor.BN {
  return new anchor.BN(Math.round(value));
}

export function marketIdBn(marketId: number): anchor.BN {
  return new anchor.BN(String(marketId));
}

export function num(value: anchor.BN | number | bigint): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return value.toNumber();
}

export function uniqueMarketId(baseMarketId: number): number {
  return baseMarketId + TEST_RUN_OFFSET;
}

export function tradeFeeLamports(sizeDeltaLamports: number): number {
  return Math.floor(
    (Math.abs(sizeDeltaLamports) * TOTAL_TRADE_FEE_BPS) / 10_000,
  );
}

export function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
}

export function marketPda(programId: PublicKey, marketId: number): PublicKey {
  const marketIdBytes = Buffer.alloc(8);
  marketIdBytes.writeBigUInt64LE(BigInt(marketId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketIdBytes],
    programId,
  )[0];
}

export function positionPda(
  programId: PublicKey,
  trader: PublicKey,
  marketId: number,
): PublicKey {
  const marketIdBytes = Buffer.alloc(8);
  marketIdBytes.writeBigUInt64LE(BigInt(marketId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), trader.toBuffer(), marketIdBytes],
    programId,
  )[0];
}

export async function airdrop(
  connection: anchor.web3.Connection,
  recipient: PublicKey,
  sol = 10,
): Promise<void> {
  const requestedLamports = sol * LAMPORTS_PER_SOL;
  const startingBalance = await connection.getBalance(recipient, "confirmed");
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(
        recipient,
        requestedLamports,
      );
      await confirmSignatureByPolling(connection, signature);
      for (let poll = 0; poll < 20; poll += 1) {
        const balance = await connection.getBalance(recipient, "confirmed");
        if (balance >= startingBalance + requestedLamports) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("airdrop confirmed but balance did not update");
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function waitForOracleToExpire(
  ms = DEFAULT_STALE_WAIT_MS,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasProgramError(error: unknown, fragment: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(fragment);
}

export async function ensurePerpsConfig(
  program: Program<GoldPerpsMarket>,
  authority: Keypair,
  keeperAuthority = authority.publicKey,
): Promise<PublicKey> {
  const config = configPda(program.programId);
  const existingConfig =
    await program.account.configState.fetchNullable(config);
  if (existingConfig) {
    return config;
  }

  await program.methods
    .initializeConfig(
      keeperAuthority,
      authority.publicKey,
      authority.publicKey,
      toBn(DEFAULT_SKEW_SCALE),
      toBn(DEFAULT_FUNDING_VELOCITY),
      new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
      toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
      toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
      DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
      toBn(DEFAULT_MAX_LEVERAGE),
      toBn(DEFAULT_MIN_MARGIN),
      toBn(DEFAULT_MAX_MARKET_OPEN_INTEREST),
      toBn(DEFAULT_MIN_MARKET_INSURANCE),
      DEFAULT_MAINTENANCE_MARGIN_BPS,
      DEFAULT_LIQUIDATION_FEE_BPS,
      DEFAULT_TRADE_TREASURY_FEE_BPS,
      DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
    )
    .accountsPartial({
      config,
      authority: authority.publicKey,
      program: program.programId,
      programData: deriveProgramDataAddress(program.programId),
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const createdConfig =
      await program.account.configState.fetchNullable(config);
    if (createdConfig) {
      return config;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`config ${config.toBase58()} was not readable after init`);
}

export async function seedMarket(
  program: Program<GoldPerpsMarket>,
  authority: Keypair,
  marketId: number,
  spotIndex = PRICE(100),
  insuranceLamports = 0,
): Promise<PublicKey> {
  const config = await ensurePerpsConfig(program, authority);
  const market = marketPda(program.programId, marketId);

  await refreshMarketOracle(program, authority, marketId, spotIndex);

  if (insuranceLamports > 0) {
    await program.methods
      .depositInsurance(marketIdBn(marketId), toBn(insuranceLamports))
      .accountsPartial({
        market,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }

  return market;
}

/**
 * Drop the oracle price from its current value to the target in steps small
 * enough to stay within the configured max_oracle_price_delta_bps (25%).
 * Each step reduces by at most 24% to stay safely within bounds.
 */
export async function crashOracle(
  program: Program<GoldPerpsMarket>,
  authority: Keypair,
  marketId: number,
  targetPrice: number,
): Promise<void> {
  const market = marketPda(program.programId, marketId);
  let currentPrice = num(
    (await program.account.marketState.fetch(market)).spotIndex,
  );
  const MAX_DROP_RATIO = 0.76; // 24% drop per step

  while (currentPrice > targetPrice) {
    const nextPrice = Math.max(
      targetPrice,
      Math.floor(currentPrice * MAX_DROP_RATIO),
    );
    await refreshMarketOracle(program, authority, marketId, nextPrice);
    currentPrice = nextPrice;
  }
}

export async function refreshMarketOracle(
  program: Program<GoldPerpsMarket>,
  authority: Keypair,
  marketId: number,
  spotIndex = PRICE(100),
): Promise<void> {
  await program.methods
    .updateMarketOracle(
      marketIdBn(marketId),
      toBn(spotIndex),
      toBn(spotIndex),
      toBn(Math.max(1, Math.floor(spotIndex / 10))),
    )
    .accountsPartial({
      config: configPda(program.programId),
      market: marketPda(program.programId, marketId),
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
}
