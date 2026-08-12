import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

import fightOracleIdl from "../idl/fight_oracle.json";
import duelMarketIdl from "../idl/duel_market.json";

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

export type DuelProgramAddresses = {
  fightOracleProgramId: string;
  duelMarketProgramId: string;
};

function resolveProgramIdls(addresses: DuelProgramAddresses): {
  fightOracleIdl: Idl;
  duelMarketIdl: Idl;
} {
  const fightOracleProgramId = resolveConfiguredProgramId(
    addresses.fightOracleProgramId,
    fightOracleIdl,
    "",
  );
  const duelMarketProgramId = resolveConfiguredProgramId(
    addresses.duelMarketProgramId,
    duelMarketIdl,
    "",
  );
  return {
    fightOracleIdl: ensureIdlAddress(fightOracleIdl, fightOracleProgramId),
    duelMarketIdl: ensureIdlAddress(duelMarketIdl, duelMarketProgramId),
  };
}

export type ProgramsBundle = {
  provider: AnchorProvider;
  fightOracle: Program<any>;
  duelMarket: Program<any>;
};

export type SigningWalletLike = {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ) => Promise<T[]>;
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
  addresses: DuelProgramAddresses,
): ProgramsBundle {
  const anchorWallet = asAnchorWallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const idls = resolveProgramIdls(addresses);
  const fightOracle = new Program(idls.fightOracleIdl, provider);
  const duelMarket = new Program(idls.duelMarketIdl, provider);

  return { provider, fightOracle, duelMarket };
}

export function createReadonlyPrograms(
  connection: Connection,
  addresses: DuelProgramAddresses,
): ProgramsBundle {
  const provider = new AnchorProvider(connection, readonlyAnchorWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const idls = resolveProgramIdls(addresses);
  const fightOracle = new Program(idls.fightOracleIdl, provider);
  const duelMarket = new Program(idls.duelMarketIdl, provider);

  return { provider, fightOracle, duelMarket };
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
