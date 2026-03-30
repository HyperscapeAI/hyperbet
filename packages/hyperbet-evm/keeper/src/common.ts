import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import dotenv from "dotenv";

import { resolveBettingSolanaDeployment } from "../../deployments";
import fightOracleIdl from "./idl/fight_oracle.json";
import goldClobMarketIdl from "./idl/gold_clob_market.json";
import goldPerpsMarketIdl from "./idl/gold_perps_market.json";
import { type FightOracle } from "../../../hyperbet-solana/anchor/target/types/fight_oracle";
import { type GoldClobMarket } from "../../../hyperbet-solana/anchor/target/types/gold_clob_market";
import { type GoldPerpsMarket } from "../../../hyperbet-solana/anchor/target/types/gold_perps_market";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keeperRoot = path.resolve(__dirname, "..");
const demoRootCandidate = path.resolve(__dirname, "../..");
const envRoot = fs.existsSync(path.join(demoRootCandidate, ".env.mainnet"))
  ? demoRootCandidate
  : keeperRoot;
const configuredClusterRaw =
  process.env.SOLANA_CLUSTER ||
  process.env.CLUSTER ||
  process.env.VITE_SOLANA_CLUSTER ||
  "mainnet-beta";
const configuredCluster = configuredClusterRaw.toLowerCase();
const envClusterSuffix =
  configuredCluster === "mainnet" || configuredCluster === "mainnet-beta"
    ? "mainnet"
    : configuredCluster;
const solanaDeployment = resolveBettingSolanaDeployment(configuredClusterRaw);

// Load cluster-specific defaults first, then generic .env fallback.
dotenv.config({ path: path.join(envRoot, `.env.${envClusterSuffix}`) });
dotenv.config({ path: path.join(envRoot, ".env") });

type SignableTx = Transaction | VersionedTransaction;

type AnchorLikeWallet = Wallet & {
  payer: Keypair;
};

function signTx(tx: SignableTx, signer: Keypair): SignableTx {
  if (tx instanceof VersionedTransaction) {
    tx.sign([signer]);
  } else {
    tx.partialSign(signer);
  }
  return tx;
}

function toAnchorWallet(signer: Keypair): AnchorLikeWallet {
  return {
    payer: signer,
    publicKey: signer.publicKey,
    signTransaction: async <T extends SignableTx>(tx: T): Promise<T> => {
      return signTx(tx, signer) as T;
    },
    signAllTransactions: async <T extends SignableTx[]>(txs: T): Promise<T> => {
      txs.forEach((tx) => signTx(tx, signer));
      return txs;
    },
  };
}

export function getRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;

  if (configuredCluster === "localnet") {
    return "http://127.0.0.1:8899";
  }

  if (configuredCluster === "testnet") {
    return "https://api.testnet.solana.com";
  }

  if (configuredCluster === "devnet") {
    return "https://api.devnet.solana.com";
  }

  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (heliusApiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  }

  return "https://api.mainnet-beta.solana.com";
}

export function readKeypair(keypairRef: string): Keypair {
  const trimmed = keypairRef.trim();

  // Railway-friendly inline secret support:
  // 1) JSON array: [1,2,3,...]
  // 2) base64-encoded secret key bytes: base64:AAAA...
  if (trimmed.startsWith("[")) {
    const secret = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return Keypair.fromSecretKey(secret);
  }

  if (trimmed.startsWith("base64:")) {
    const encoded = trimmed.slice("base64:".length).trim();
    const decoded = Buffer.from(encoded, "base64");
    return Keypair.fromSecretKey(Uint8Array.from(decoded));
  }

  const expanded = trimmed.startsWith("~")
    ? path.join(process.env.HOME ?? "", trimmed.slice(1))
    : trimmed;

  const raw = fs.readFileSync(expanded, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(secret);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function resolveProgramId(idlJson: unknown, fallback: string): PublicKey {
  const idl = idlJson as { address?: string; metadata?: { address?: string } };
  const fromAddress = typeof idl.address === "string" ? idl.address.trim() : "";
  const fromMetadata =
    typeof idl.metadata?.address === "string"
      ? idl.metadata.address.trim()
      : "";
  const address = fromAddress || fromMetadata || fallback;
  return new PublicKey(address);
}

function resolveConfiguredProgramId(
  configuredAddress: string | undefined,
  idlJson: unknown,
  fallback: string,
): PublicKey {
  const trimmedConfigured = configuredAddress?.trim() ?? "";
  if (trimmedConfigured.length > 0) {
    return new PublicKey(trimmedConfigured);
  }
  return resolveProgramId(idlJson, fallback);
}

function ensureIdlAddress(idlJson: unknown, programId: PublicKey): Idl {
  const idlWithMaybeAddress = idlJson as Idl & { address?: string };
  return {
    ...idlWithMaybeAddress,
    address: programId.toBase58(),
  } as Idl;
}

export const FIGHT_ORACLE_PROGRAM_ID = resolveConfiguredProgramId(
  process.env.FIGHT_ORACLE_PROGRAM_ID,
  fightOracleIdl,
  solanaDeployment.fightOracleProgramId,
);
export const GOLD_CLOB_MARKET_PROGRAM_ID = resolveConfiguredProgramId(
  process.env.GOLD_CLOB_MARKET_PROGRAM_ID,
  goldClobMarketIdl,
  solanaDeployment.goldClobMarketProgramId,
);
export const GOLD_PERPS_MARKET_PROGRAM_ID = resolveConfiguredProgramId(
  process.env.GOLD_PERPS_MARKET_PROGRAM_ID,
  goldPerpsMarketIdl,
  solanaDeployment.goldPerpsMarketProgramId,
);

/** @deprecated Binary market is no longer deployed. Retained for backward compat. */
export const GOLD_BINARY_MARKET_PROGRAM_ID = new PublicKey(
  "7pxwReoFYABrSN7rnqusAxniKvrdv3zWDLoVamX5NN3W",
);

const FIGHT_ORACLE_IDL = ensureIdlAddress(
  fightOracleIdl,
  FIGHT_ORACLE_PROGRAM_ID,
);
const GOLD_CLOB_MARKET_IDL = ensureIdlAddress(
  goldClobMarketIdl,
  GOLD_CLOB_MARKET_PROGRAM_ID,
);
const GOLD_PERPS_MARKET_IDL = ensureIdlAddress(
  goldPerpsMarketIdl,
  GOLD_PERPS_MARKET_PROGRAM_ID,
);

export function createPrograms(signer: Keypair): {
  connection: Connection;
  provider: AnchorProvider;
  fightOracle: Program<FightOracle>;
  goldClobMarket: Program<GoldClobMarket>;
  goldPerpsMarket: Program<GoldPerpsMarket>;
  /** @deprecated Binary market removed. Returns null. */
  goldBinaryMarket: null;
} {
  const connection = new Connection(getRpcUrl(), {
    commitment: "confirmed",
  });
  const wallet = toAnchorWallet(signer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle: Program<FightOracle> = new Program(
    FIGHT_ORACLE_IDL,
    provider,
  );
  const goldClobMarket: Program<GoldClobMarket> = new Program(
    GOLD_CLOB_MARKET_IDL,
    provider,
  );
  const goldPerpsMarket: Program<GoldPerpsMarket> = new Program(
    GOLD_PERPS_MARKET_IDL,
    provider,
  );

  return {
    connection,
    provider,
    fightOracle,
    goldClobMarket,
    goldPerpsMarket,
    goldBinaryMarket: null,
  };
}

export function findOracleConfigPda(
  fightOracleProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightOracleProgramId,
  )[0];
}

export const DUEL_WINNER_MARKET_KIND = 1;
export const SIDE_BID = 1;
export const SIDE_ASK = 2;
export const ORDER_BEHAVIOR_GTC = 0;
export const ORDER_BEHAVIOR_IOC = 1;
export const ORDER_BEHAVIOR_POST_ONLY = 2;

export function duelKeyHexToBytes(duelKeyHex: string): Uint8Array {
  const normalized = duelKeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("duelKeyHex must be a 32-byte hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function findDuelStatePda(
  fightOracleProgramId: PublicKey,
  duelKey: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("duel"), Buffer.from(duelKey)],
    fightOracleProgramId,
  )[0];
}

export function findMarketPda(
  marketProgramId: PublicKey,
  duelStatePda: PublicKey,
  marketKind = DUEL_WINNER_MARKET_KIND,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), duelStatePda.toBuffer(), Uint8Array.of(marketKind)],
    marketProgramId,
  )[0];
}

export function findMarketConfigPda(marketProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    marketProgramId,
  )[0];
}

export function findClobVaultPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findUserBalancePda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("balance"), marketPda.toBuffer(), owner.toBuffer()],
    marketProgramId,
  )[0];
}

export function findOrderPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  orderId: bigint,
): PublicKey {
  const orderIdBytes = Buffer.alloc(8);
  orderIdBytes.writeBigUInt64LE(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), marketPda.toBuffer(), orderIdBytes],
    marketProgramId,
  )[0];
}

export function findPriceLevelPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  side: number,
  price: number,
): PublicKey {
  const priceBytes = Buffer.alloc(2);
  priceBytes.writeUInt16LE(price);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("level"),
      marketPda.toBuffer(),
      Uint8Array.of(side),
      priceBytes,
    ],
    marketProgramId,
  )[0];
}

export function enumIs(value: unknown, variant: string): boolean {
  if (!value || typeof value !== "object") return false;
  const key = Object.keys(value as Record<string, unknown>)[0];
  return key === variant;
}

export function baseUnitsFromGold(goldAmount: number, decimals = 6): BN {
  const scaled = BigInt(Math.floor(goldAmount * 10 ** decimals));
  return new BN(scaled.toString());
}

export async function detectTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAccount) {
    throw new Error(`Mint not found: ${mint.toBase58()}`);
  }
  if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    return TOKEN_PROGRAM_ID;
  }
  throw new Error(`Unsupported token program for mint ${mint.toBase58()}`);
}

export async function findTokenAccountForMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<PublicKey | null> {
  const response = await connection.getTokenAccountsByOwner(owner, {
    mint,
    programId: tokenProgram,
  });
  return response.value[0]?.pubkey ?? null;
}

export async function findAnyTokenAccountForMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ tokenAccount: PublicKey | null; tokenProgram: PublicKey | null }> {
  const token2022 = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID,
  );
  if (token2022) {
    return { tokenAccount: token2022, tokenProgram: TOKEN_2022_PROGRAM_ID };
  }

  const legacy = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
  );
  if (legacy) {
    return { tokenAccount: legacy, tokenProgram: TOKEN_PROGRAM_ID };
  }

  return { tokenAccount: null, tokenProgram: null };
}
