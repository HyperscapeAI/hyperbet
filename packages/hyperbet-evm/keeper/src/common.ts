import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  type ConfirmOptions,
  type FetchFn,
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
type CommitmentLevel = "processed" | "confirmed" | "finalized";

type CreateProgramsOptions = {
  usePollingSendAndConfirm?: boolean;
  commitment?: CommitmentLevel;
  preflightCommitment?: CommitmentLevel;
  confirmTimeoutMs?: number;
};

type AnchorLikeWallet = Wallet & {
  payer: Keypair;
};

const DEFAULT_SOLANA_RPC_REQUEST_TIMEOUT_MS = 15_000;

function resolveSolanaRpcRequestTimeoutMs(): number {
  const configured = Number(process.env.SOLANA_RPC_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_SOLANA_RPC_REQUEST_TIMEOUT_MS;
}

function createSolanaRpcFetch(timeoutMs: number): FetchFn {
  const solanaFetch = (async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal ?? null;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);

    if (upstreamSignal?.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal?.addEventListener("abort", abortFromUpstream, {
        once: true,
      });
    }

    const timeout = setTimeout(() => {
      controller.abort(
        new Error(`Solana RPC request timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    try {
      return await fetch(input, {
        ...(init ?? {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }) as FetchFn;

  solanaFetch.preconnect = fetch.preconnect.bind(fetch);
  return solanaFetch;
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneTransaction(transaction: Transaction): Transaction {
  const clone = new Transaction();
  clone.instructions = [...transaction.instructions];
  clone.feePayer = transaction.feePayer;
  clone.nonceInfo = transaction.nonceInfo;
  clone.minNonceContextSlot = transaction.minNonceContextSlot;
  return clone;
}

async function getLatestBlockhashWithRetries(
  connection: Connection,
  commitment: CommitmentLevel,
  maxAttempts = 4,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await connection.getLatestBlockhash(commitment);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(Math.min(2_000, 250 * attempt));
      }
    }
  }

  throw new Error(
    `failed to fetch latest blockhash after ${maxAttempts} attempts: ${String(lastError)}`,
  );
}

export async function confirmSignatureByPolling(
  connection: Connection,
  signature: string,
  lastValidBlockHeight?: number,
  timeoutMs = Number.parseInt(
    process.env.HYPERBET_SOLANA_CONFIRM_TIMEOUT_MS ?? "180000",
    10,
  ),
  commitment: CommitmentLevel = "confirmed",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastRpcError: unknown = null;
  let pollCount = 0;

  while (Date.now() < deadline) {
    pollCount += 1;
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = statuses.value[0];

      if (status?.err) {
        throw new Error(
          `transaction ${signature} failed: ${JSON.stringify(status.err)}`,
        );
      }

      if (
        status &&
        (status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized")
      ) {
        return;
      }

      if (lastValidBlockHeight && pollCount % 8 === 0) {
        const currentBlockHeight = await connection.getBlockHeight(commitment);
        if (currentBlockHeight > lastValidBlockHeight) {
          throw new Error(
            `transaction ${signature} expired at block height ${lastValidBlockHeight}`,
          );
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes(`transaction ${signature} failed`) ||
          error.message.includes("expired at block height"))
      ) {
        throw error;
      }
      lastRpcError = error;
    }

    await sleep(250);
  }

  const reason =
    lastRpcError instanceof Error ? ` (${lastRpcError.message})` : "";
  throw new Error(
    `timed out waiting for confirmation for ${signature}${reason}`,
  );
}

async function sendAndConfirmWithPolling(
  provider: AnchorProvider,
  transaction: Transaction,
  signers: Keypair[] = [],
  options?: ConfirmOptions,
): Promise<string> {
  const opts = {
    ...provider.opts,
    ...options,
  };
  const commitment =
    (opts.preflightCommitment ??
      opts.commitment ??
      "confirmed") as CommitmentLevel;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const tx = cloneTransaction(transaction);
      tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;

      const { blockhash, lastValidBlockHeight } =
        await getLatestBlockhashWithRetries(provider.connection, commitment);
      tx.recentBlockhash = blockhash;

      if (signers.length > 0) {
        tx.partialSign(...signers);
      }

      const signedTx = await provider.wallet.signTransaction(tx);
      const signature = await provider.connection.sendRawTransaction(
        signedTx.serialize(),
        {
          maxRetries: 8,
          preflightCommitment: commitment,
          skipPreflight: opts.skipPreflight ?? false,
        },
      );

      await confirmSignatureByPolling(
        provider.connection,
        signature,
        lastValidBlockHeight,
        undefined,
        commitment,
      );
      return signature;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await sleep(250 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function sendVersionedTransactionWithPolling(
  provider: AnchorProvider,
  transaction: VersionedTransaction,
  signers: Keypair[] = [],
  options?: ConfirmOptions,
): Promise<string> {
  const opts = {
    ...provider.opts,
    ...options,
  };
  const commitment =
    (opts.preflightCommitment ??
      opts.commitment ??
      "confirmed") as CommitmentLevel;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      if (signers.length > 0) {
        transaction.sign(signers);
      }
      const signedTx = await provider.wallet.signTransaction(transaction);
      const signature = await provider.connection.sendRawTransaction(
        signedTx.serialize(),
        {
          maxRetries: 8,
          preflightCommitment: commitment,
          skipPreflight: opts.skipPreflight ?? false,
        },
      );

      await confirmSignatureByPolling(
        provider.connection,
        signature,
        undefined,
        undefined,
        commitment,
      );
      return signature;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await sleep(250 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function createPollingProvider(
  connection: Connection,
  wallet: Wallet,
  options?: Partial<AnchorProvider["opts"]>,
): AnchorProvider {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    ...(options ?? {}),
  });
  const defaultSendAndConfirm = provider.sendAndConfirm.bind(provider);
  provider.sendAndConfirm = async (tx, signers, overrideOptions) => {
    if (tx instanceof VersionedTransaction) {
      return sendVersionedTransactionWithPolling(
        provider,
        tx,
        (signers ?? []) as Keypair[],
        overrideOptions,
      );
    }
    if (tx instanceof Transaction) {
      return sendAndConfirmWithPolling(
        provider,
        tx,
        (signers ?? []) as Keypair[],
        overrideOptions,
      );
    }
    return defaultSendAndConfirm(tx, signers, overrideOptions);
  };
  return provider;
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

export function createPrograms(signer: Keypair, options?: CreateProgramsOptions): {
  connection: Connection;
  provider: AnchorProvider;
  fightOracle: Program<FightOracle>;
  goldClobMarket: Program<GoldClobMarket>;
  goldPerpsMarket: Program<GoldPerpsMarket>;
  /** @deprecated Binary market removed. Returns null. */
  goldBinaryMarket: null;
} {
  const commitment = options?.commitment ?? "confirmed";
  const preflightCommitment =
    options?.preflightCommitment ?? options?.commitment ?? "confirmed";
  const connection = new Connection(getRpcUrl(), {
    commitment,
    confirmTransactionInitialTimeout: options?.confirmTimeoutMs,
    fetch: createSolanaRpcFetch(resolveSolanaRpcRequestTimeoutMs()),
  });
  const wallet = toAnchorWallet(signer);
  const provider = options?.usePollingSendAndConfirm
    ? createPollingProvider(connection, wallet, {
        commitment,
        preflightCommitment,
      })
    : new AnchorProvider(connection, wallet, {
        commitment,
        preflightCommitment,
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
