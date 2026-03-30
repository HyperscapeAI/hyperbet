import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";

import fightOracleIdl from "../idl/fight_oracle.json";
import goldClobMarketIdl from "../idl/gold_clob_market.json";
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

function ensureIdlAddress(idlJson: unknown, programId: PublicKey): Idl {
  const idlWithMaybeAddress = idlJson as Idl & { address?: string };
  return {
    ...idlWithMaybeAddress,
    // Anchor Program uses `idl.address` directly, so env/deployment overrides
    // must replace any baked-in generated address.
    address: programId.toBase58(),
  } as Idl;
}

export const FIGHT_ORACLE_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.fightOracleProgramId,
  fightOracleIdl,
  "",
);
export const GOLD_CLOB_MARKET_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.goldClobMarketProgramId,
  goldClobMarketIdl,
  "",
);

const FIGHT_ORACLE_IDL = ensureIdlAddress(
  fightOracleIdl,
  FIGHT_ORACLE_PROGRAM_ID,
);
const GOLD_CLOB_MARKET_IDL = ensureIdlAddress(
  goldClobMarketIdl,
  GOLD_CLOB_MARKET_PROGRAM_ID,
);

export type ProgramsBundle = {
  provider: AnchorProvider;
  fightOracle: Program<any>;
  goldClobMarket: Program<any>;
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
  const goldClobMarket = new Program(GOLD_CLOB_MARKET_IDL, provider);

  return { provider, fightOracle, goldClobMarket };
}

export function createReadonlyPrograms(connection: Connection): ProgramsBundle {
  const provider = new AnchorProvider(connection, readonlyAnchorWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);
  const goldClobMarket = new Program(GOLD_CLOB_MARKET_IDL, provider);

  return { provider, fightOracle, goldClobMarket };
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
