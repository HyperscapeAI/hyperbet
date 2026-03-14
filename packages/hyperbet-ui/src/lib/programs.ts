import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";

import fightOracleIdl from "../idl/fight_oracle.json";
import lvrMarketIdl from "../idl/lvr_amm.json";
import { CONFIG } from "./config";

function extractProgramAddressFromIdl(idlJson: unknown): string | null {
  if (!idlJson || typeof idlJson !== "object") return null;
  const asRecord = idlJson as Record<string, unknown>;
  const direct = asRecord.address;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const metadata = asRecord.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const metadataAddress = (metadata as Record<string, unknown>).address;
  if (typeof metadataAddress === "string" && metadataAddress.trim()) {
    return metadataAddress.trim();
  }

  return null;
}

function resolveProgramId(idlJson: unknown, fallback: string): PublicKey {
  const address = extractProgramAddressFromIdl(idlJson) || fallback;
  return new PublicKey(address);
}

function resolveConfiguredProgramId(
  configuredAddress: string,
  idlJson: unknown,
  fallback: string,
): PublicKey {
  const trimmedConfigured = configuredAddress.trim();
  if (trimmedConfigured.length > 0) {
    return new PublicKey(trimmedConfigured);
  }
  return resolveProgramId(idlJson, fallback);
}

function ensureIdlAddress(idlJsonIn: unknown, programId: PublicKey): Idl {
  const unwrapped = (idlJsonIn && typeof idlJsonIn === "object" && "default" in idlJsonIn)
    ? (idlJsonIn as any).default
    : idlJsonIn;
  const idlWithMaybeAddress = unwrapped as Idl & { address?: string, metadata?: any, name?: string };
  const base = {
    ...idlWithMaybeAddress,
    address: programId.toBase58(),
  };
  
  if (base.name === "lvr_amm" || (base.metadata && base.metadata.name === "lvr_amm")) {
    base.metadata = {
      ...(base.metadata || {}),
      address: programId.toBase58(),
    };
  }
  return base as Idl;
}

export const FIGHT_ORACLE_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.fightOracleProgramId,
  fightOracleIdl,
  "",
);
export const LVR_AMM_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.lvrMarketProgramId,
  lvrMarketIdl,
  "",
);

const FIGHT_ORACLE_IDL = ensureIdlAddress(
  fightOracleIdl,
  FIGHT_ORACLE_PROGRAM_ID,
);
const LVR_ROUTER_MARKET_IDL = ensureIdlAddress(
  lvrMarketIdl,
  LVR_AMM_PROGRAM_ID,
);

export type ProgramsBundle = {
  provider: AnchorProvider;
  fightOracle: Program<any>;
  lvrMarket: Program<any>;
};

export type SigningWalletLike = {
  publicKey: WalletContextState["publicKey"];
  signTransaction?: WalletContextState["signTransaction"];
  signAllTransactions?: WalletContextState["signAllTransactions"];
};

function asAnchorWallet(wallet: SigningWalletLike): any {
  if (
    !wallet.publicKey ||
    !wallet.signTransaction ||
    !wallet.signAllTransactions
  ) {
    throw new Error("Wallet does not support required signing methods");
  }

  return {
    payer: null,
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions,
  };
}

function readonlyAnchorWallet(): any {
  const readonlyPk = new PublicKey("11111111111111111111111111111111");
  return {
    payer: null,
    publicKey: readonlyPk,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T): Promise<T> => txs,
  };
}

export function createPrograms(
  connection: Connection,
  wallet: SigningWalletLike,
): ProgramsBundle {
  const anchorWallet = asAnchorWallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);
  const lvrMarket = new Program(LVR_ROUTER_MARKET_IDL, provider);

  return { provider, fightOracle, lvrMarket };
}

export function createReadonlyPrograms(connection: Connection): ProgramsBundle {
  const provider = new AnchorProvider(connection, readonlyAnchorWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);
  const lvrMarket = new Program(LVR_ROUTER_MARKET_IDL, provider);

  return { provider, fightOracle, lvrMarket };
}

export function toBnAmount(amount: bigint): BN {
  return new BN(amount.toString());
}

export function marketSideAEnum(): { a: Record<string, never> } {
  return { a: {} };
}

export function marketSideBEnum(): { b: Record<string, never> } {
  return { b: {} };
}

export function duelStatusBettingOpenEnum(): {
  bettingOpen: Record<string, never>;
} {
  return { bettingOpen: {} };
}

export function duelStatusLockedEnum(): { locked: Record<string, never> } {
  return { locked: {} };
}

export function findBetPda(programId: PublicKey, betId: BN, creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), betId.toArrayLike(Buffer, "le", 8), creator.toBuffer()],
    programId
  )[0];
}

export function findMintYesPda(programId: PublicKey, betId: BN, creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_yes"), betId.toArrayLike(Buffer, "le", 8), creator.toBuffer()],
    programId
  )[0];
}

export function findMintNoPda(programId: PublicKey, betId: BN, creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_no"), betId.toArrayLike(Buffer, "le", 8), creator.toBuffer()],
    programId
  )[0];
}
