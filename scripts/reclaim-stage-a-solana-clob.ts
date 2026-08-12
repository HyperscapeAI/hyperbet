import fs from "node:fs";

import fightOracleIdl from "../packages/hyperbet-solana/anchor/target/idl/fight_oracle.json";
import duelMarketIdl from "../packages/hyperbet-solana/anchor/target/idl/duel_market.json";
import {
  cancelDuel,
  claimClobWinnings,
  deriveClobVaultPda,
  deriveMarketConfigPda,
  syncMarketFromDuel,
} from "../packages/hyperbet-solana/anchor/tests/clob-test-helpers";

const anchor = await import(
  "../packages/hyperbet-solana/node_modules/@coral-xyz/anchor/dist/cjs/index.js"
);
const web3 = await import(
  "../packages/hyperbet-solana/node_modules/@solana/web3.js/lib/index.cjs.js"
);

const { AnchorProvider, Program } = anchor;
const { Connection, Keypair, Transaction, VersionedTransaction } = web3;

const ASK_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  14, 22, 189, 71, 203, 44, 97, 156, 18, 240, 85, 132, 53, 199, 4, 220, 91,
  11, 144, 201, 32, 77, 165, 118, 246, 17, 63, 154, 208, 39, 121, 6,
]);
const BID_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  101, 33, 174, 9, 57, 218, 66, 140, 211, 45, 87, 16, 193, 24, 129, 204, 73,
  188, 12, 240, 61, 109, 173, 28, 142, 215, 54, 167, 80, 31, 199, 114,
]);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() || "";
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function loadKeypairFromPath(filepath: string) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(filepath, "utf8")) as number[]),
  );
}

function toWallet(keypair: typeof Keypair.prototype & { publicKey: unknown }) {
  return {
    payer: keypair,
    publicKey: keypair.publicKey,
    signTransaction: async (transaction: any) => {
      transaction.partialSign(keypair);
      return transaction;
    },
    signAllTransactions: async (transactions: any[]) => {
      for (const transaction of transactions) {
        transaction.partialSign(keypair);
      }
      return transactions;
    },
  };
}

function seededMaker(seed: Uint8Array) {
  return Keypair.fromSeed(seed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace(/^https:\/\//, "wss://");
  }
  if (httpUrl.startsWith("http://")) {
    return httpUrl.replace(/^http:\/\//, "ws://");
  }
  return httpUrl;
}

function cloneTransaction(transaction: typeof Transaction.prototype) {
  const clone = new Transaction();
  clone.instructions = [...transaction.instructions];
  clone.feePayer = transaction.feePayer;
  clone.nonceInfo = transaction.nonceInfo;
  clone.minNonceContextSlot = transaction.minNonceContextSlot;
  return clone;
}

async function confirmSignatureByPolling(
  connection: typeof Connection.prototype,
  signature: string,
  lastValidBlockHeight?: number,
  timeoutMs = 120_000,
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
        const currentBlockHeight = await connection.getBlockHeight("confirmed");
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
  provider: typeof AnchorProvider.prototype,
  transaction: typeof Transaction.prototype,
  signers: Array<typeof Keypair.prototype> = [],
  options?: {
    commitment?: "processed" | "confirmed" | "finalized";
    preflightCommitment?: "processed" | "confirmed" | "finalized";
    skipPreflight?: boolean;
  },
): Promise<string> {
  const opts = {
    ...provider.opts,
    ...options,
  };
  const commitment =
    opts.preflightCommitment ?? opts.commitment ?? "confirmed";
  const tx = cloneTransaction(transaction);
  tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = blockhash;
  if (signers.length > 0) {
    tx.partialSign(...signers);
  }
  const signedTransaction = await provider.wallet.signTransaction(tx);
  const signature = await provider.connection.sendRawTransaction(
    signedTransaction.serialize(),
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
  );
  return signature;
}

function createPollingProvider(
  connection: typeof Connection.prototype,
  keypair: typeof Keypair.prototype,
) {
  const provider = new AnchorProvider(connection, toWallet(keypair), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const defaultSendAndConfirm = provider.sendAndConfirm.bind(provider);
  provider.sendAndConfirm = async (transaction, signers, options) => {
    if (transaction instanceof VersionedTransaction) {
      return defaultSendAndConfirm(transaction, signers, options);
    }
    return sendAndConfirmWithPolling(
      provider,
      transaction,
      (signers ?? []) as Array<typeof Keypair.prototype>,
      options,
    );
  };
  return provider;
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function hasNonZeroBalance(row: any): boolean {
  return (
    bnLikeToBigInt(row.account.aShares) > 0n ||
    bnLikeToBigInt(row.account.bShares) > 0n ||
    bnLikeToBigInt(row.account.aLockedLamports) > 0n ||
    bnLikeToBigInt(row.account.bLockedLamports) > 0n
  );
}

async function getLamports(connection: any, publicKey: any): Promise<bigint> {
  return BigInt(await connection.getBalance(publicKey, "confirmed"));
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const wsUrl =
    process.env.SOLANA_WS_URL?.trim() ||
    process.env.ANCHOR_WS_URL?.trim() ||
    deriveWsUrl(rpcUrl);
  const authority = loadKeypairFromPath(requireEnv("ANCHOR_WALLET"));
  const canary = loadKeypairFromPath(requireEnv("SOLANA_CANARY_KEYPAIR"));
  const targetUsers = [
    { label: "canary", keypair: canary },
    { label: "seeded-ask-maker", keypair: seededMaker(ASK_LIQUIDITY_MAKER_SEED) },
    { label: "seeded-bid-maker", keypair: seededMaker(BID_LIQUIDITY_MAKER_SEED) },
  ];
  const targetUserByAddress = new Map(
    targetUsers.map((entry) => [entry.keypair.publicKey.toBase58(), entry]),
  );

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: wsUrl,
  });
  const provider = createPollingProvider(connection, authority);
  const fightProgram = new Program(fightOracleIdl as any, provider);
  const clobProgram = new Program(duelMarketIdl as any, provider);
  const config = deriveMarketConfigPda(clobProgram.programId);

  const beforeBalances = await Promise.all(
    targetUsers.map(async (entry) => ({
      label: entry.label,
      address: entry.keypair.publicKey.toBase58(),
      lamports: await getLamports(connection, entry.keypair.publicKey),
    })),
  );

  const rows = await clobProgram.account.userBalance.all();
  const reclaimable = rows.filter(
    (row: any) =>
      targetUserByAddress.has(row.account.user.toBase58()) && hasNonZeroBalance(row),
  );

  const byMarket = new Map<string, any[]>();
  for (const row of reclaimable) {
    const marketKey = row.account.marketState.toBase58();
    const existing = byMarket.get(marketKey) ?? [];
    existing.push(row);
    byMarket.set(marketKey, existing);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const [marketKey, marketRows] of byMarket.entries()) {
    const marketState = marketRows[0].account.marketState;
    const market = await clobProgram.account.marketState.fetch(marketState);
    const duelKey = [...market.duelKey];
    const vault = deriveClobVaultPda(clobProgram.programId, marketState);
    const marketResult: Record<string, unknown> = {
      marketState: marketKey,
      duelState: market.duelState.toBase58(),
      users: marketRows.map((row) => ({
        user: row.account.user.toBase58(),
        aShares: bnLikeToBigInt(row.account.aShares).toString(),
        bShares: bnLikeToBigInt(row.account.bShares).toString(),
        aLockedLamports: bnLikeToBigInt(row.account.aLockedLamports).toString(),
        bLockedLamports: bnLikeToBigInt(row.account.bLockedLamports).toString(),
      })),
    };

    try {
      await cancelDuel(fightProgram as never, authority, duelKey);
      marketResult.cancelled = true;
    } catch (error) {
      marketResult.cancelled = false;
      marketResult.cancelError =
        error instanceof Error ? error.message : String(error);
    }

    try {
      await syncMarketFromDuel(clobProgram as never, marketState, market.duelState);
      marketResult.synced = true;
    } catch (error) {
      marketResult.synced = false;
      marketResult.syncError =
        error instanceof Error ? error.message : String(error);
    }

    const claimResults: Array<Record<string, unknown>> = [];
    for (const row of marketRows) {
      const claimant = targetUserByAddress.get(row.account.user.toBase58());
      if (!claimant) continue;
      try {
        await claimClobWinnings(clobProgram as never, {
          marketState,
          duelState: market.duelState,
          config,
          marketMaker: market.marketMaker,
          vault,
          user: claimant.keypair,
        });
        claimResults.push({
          user: claimant.label,
          address: claimant.keypair.publicKey.toBase58(),
          claimed: true,
        });
      } catch (error) {
        claimResults.push({
          user: claimant.label,
          address: claimant.keypair.publicKey.toBase58(),
          claimed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    marketResult.claims = claimResults;
    results.push(marketResult);
  }

  const afterBalances = await Promise.all(
    targetUsers.map(async (entry) => ({
      label: entry.label,
      address: entry.keypair.publicKey.toBase58(),
      lamports: await getLamports(connection, entry.keypair.publicKey),
    })),
  );

  console.log(
    JSON.stringify(
      {
        processedMarkets: results.length,
        beforeBalances: beforeBalances.map((entry) => ({
          ...entry,
          sol: Number(entry.lamports) / 1e9,
        })),
        afterBalances: afterBalances.map((entry) => ({
          ...entry,
          sol: Number(entry.lamports) / 1e9,
        })),
        markets: results,
      },
      null,
      2,
    ),
  );
}

await main();
