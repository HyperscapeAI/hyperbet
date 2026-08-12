import type {
  Connection,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

// Helius Sender endpoint for dual-routing (SWQoS + Jito).
// Requires a Jito tip of at least HELIUS_SENDER_MIN_TIP_LAMPORTS in the tx.
const HELIUS_SENDER_URL = "https://sender.helius-rpc.com/fast";
// Minimum Jito tip required by Helius Sender dual-routing mode (0.0002 SOL).
export const HELIUS_SENDER_MIN_TIP_LAMPORTS = 200_000;

// Tip accounts — pick one at random per transaction.
const HELIUS_JITO_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
] as const;

export function randomJitoTipAccount(): string {
  return (
    HELIUS_JITO_TIP_ACCOUNTS[
      Math.floor(Math.random() * HELIUS_JITO_TIP_ACCOUNTS.length)
    ] ?? HELIUS_JITO_TIP_ACCOUNTS[0]
  );
}

interface JsonRpcFailure {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcSuccess<T> {
  result: T;
}

type JsonRpcResponse<T> = JsonRpcFailure | JsonRpcSuccess<T>;

interface LatestBlockhashResult {
  value: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

interface SignatureStatusesResult {
  value: Array<{
    err: unknown;
    confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  } | null>;
}

export type SolanaSignatureInspection =
  | {
      state: "not_found";
      confirmationStatus: null;
      error: null;
    }
  | {
      state: "pending";
      confirmationStatus: "processed" | null;
      error: null;
    }
  | {
      state: "confirmed";
      confirmationStatus: "confirmed" | "finalized";
      error: null;
    }
  | {
      state: "failed";
      confirmationStatus: "processed" | "confirmed" | "finalized" | null;
      error: unknown;
    };

export class SolanaTransactionExpiredError extends Error {
  readonly code = "SOLANA_TRANSACTION_EXPIRED";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SolanaTransactionExpiredError";
  }
}

export function isSolanaTransactionExpiredError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof SolanaTransactionExpiredError) return true;
    const message =
      current instanceof Error ? current.message : String(current ?? "");
    if (
      /blockhash not found|block height exceeded|blockheight exceeded|transaction expired|signature has expired/i.test(
        message,
      )
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

function isJsonRpcFailure<T>(
  payload: JsonRpcResponse<T>,
): payload is JsonRpcFailure {
  return "error" in payload;
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function resolveRpcEndpoint(endpoint: string): string {
  if (
    typeof window !== "undefined" &&
    isLoopbackEndpoint(endpoint) &&
    window.location.hostname
  ) {
    return `${window.location.protocol}//${window.location.host}/__solana/rpc`;
  }
  return endpoint;
}

function isKeeperSolanaReadProxyEndpoint(endpoint: string): boolean {
  try {
    return (
      new URL(resolveRpcEndpoint(endpoint)).pathname === "/api/proxy/solana/rpc"
    );
  } catch {
    return false;
  }
}

function resolveSolanaSenderEndpoint(endpoint: string): string {
  const resolvedEndpoint = resolveRpcEndpoint(endpoint);
  try {
    const parsed = new URL(resolvedEndpoint);
    if (parsed.pathname === "/api/proxy/solana/rpc") {
      parsed.pathname = "/api/proxy/solana/sender";
      parsed.search = "";
      return parsed.toString();
    }
  } catch {
    // Fall through to the resolved endpoint.
  }
  return resolvedEndpoint;
}

async function callJsonRpc<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveRpcEndpoint(endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${method}-${Date.now()}`,
        method,
        params,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${method} fetch failed: ${message}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (isJsonRpcFailure(payload)) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload.result;
}

async function sendTransactionViaProxySender(
  endpoint: string,
  wireTransactionBase64: string,
): Promise<string> {
  const response = await fetch(resolveSolanaSenderEndpoint(endpoint), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transaction: wireTransactionBase64,
    }),
  });

  const payload = (await response.json()) as
    | { signature: string }
    | { error?: string };
  if (!response.ok || !("signature" in payload)) {
    throw new Error(
      ("error" in payload && payload.error) ||
        `sendTransaction HTTP ${response.status}`,
    );
  }
  return payload.signature;
}

export async function getLatestBlockhashViaRpc(
  connection: Connection,
): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await connection.getLatestBlockhash("confirmed");
  } catch {
    const result = await callJsonRpc<LatestBlockhashResult>(
      connection.rpcEndpoint,
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
    );
    return result.value;
  }
}

export async function sendRawTransactionViaRpc(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
): Promise<string> {
  const serialized = transaction.serialize();
  const wireTransactionBase64 = Buffer.from(serialized).toString("base64");
  if (isKeeperSolanaReadProxyEndpoint(connection.rpcEndpoint)) {
    return sendTransactionViaProxySender(
      connection.rpcEndpoint,
      wireTransactionBase64,
    );
  }
  try {
    return await connection.sendRawTransaction(serialized, {
      preflightCommitment: "confirmed",
      skipPreflight: false,
      maxRetries: 5,
    });
  } catch {
    return callJsonRpc<string>(connection.rpcEndpoint, "sendTransaction", [
      wireTransactionBase64,
      {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight: false,
        maxRetries: 5,
      },
    ]);
  }
}

async function getSignatureStatusesViaConnection(
  connection: Connection,
  signature: string,
): Promise<SignatureStatusesResult> {
  try {
    const result = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    return {
      value: result.value.map((status) =>
        status
          ? {
              err: status.err,
              confirmationStatus: status.confirmationStatus ?? null,
            }
          : null,
      ),
    };
  } catch {
    return callJsonRpc<SignatureStatusesResult>(
      connection.rpcEndpoint,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
  }
}

/**
 * Inspect a known signed transaction without submitting it again.
 *
 * A missing status is intentionally distinct from failure: a recently sent
 * transaction may not have reached the queried RPC node yet. Callers must keep
 * retry blocked until this returns a confirmed or failed terminal result.
 */
export async function inspectSignatureViaRpc(
  connection: Connection,
  signature: string,
): Promise<SolanaSignatureInspection> {
  const normalizedSignature = signature.trim();
  if (!normalizedSignature) {
    throw new Error("Transaction signature is required for status inspection");
  }

  const result = await getSignatureStatusesViaConnection(
    connection,
    normalizedSignature,
  );
  const status = result.value[0];
  if (!status) {
    return {
      state: "not_found",
      confirmationStatus: null,
      error: null,
    };
  }
  if (status.err) {
    return {
      state: "failed",
      confirmationStatus: status.confirmationStatus,
      error: status.err,
    };
  }
  if (
    status.confirmationStatus === "confirmed" ||
    status.confirmationStatus === "finalized"
  ) {
    return {
      state: "confirmed",
      confirmationStatus: status.confirmationStatus,
      error: null,
    };
  }
  return {
    state: "pending",
    confirmationStatus:
      status.confirmationStatus === "processed" ? "processed" : null,
    error: null,
  };
}

async function getBlockHeightViaRpc(connection: Connection): Promise<number> {
  try {
    return await connection.getBlockHeight("confirmed");
  } catch {
    return callJsonRpc<number>(connection.rpcEndpoint, "getBlockHeight", [
      { commitment: "confirmed" },
    ]);
  }
}

type SignatureConfirmationOptions = {
  timeoutMs?: number;
  lastValidBlockHeight?: number;
};

export async function confirmSignatureViaRpc(
  connection: Connection,
  signature: string,
  options: number | SignatureConfirmationOptions = {},
): Promise<void> {
  const timeoutMs =
    typeof options === "number" ? options : (options.timeoutMs ?? 30_000);
  const lastValidBlockHeight =
    typeof options === "number" ? undefined : options.lastValidBlockHeight;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await getSignatureStatusesViaConnection(
      connection,
      signature,
    );
    const status = result.value[0];
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    if (lastValidBlockHeight != null) {
      const currentBlockHeight = await getBlockHeightViaRpc(connection);
      if (currentBlockHeight > lastValidBlockHeight) {
        throw new SolanaTransactionExpiredError(
          `Transaction ${signature} expired before confirmation; review the latest quote and sign a fresh transaction. It was not automatically resubmitted.`,
        );
      }
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 500);
    });
  }
  throw new Error(`Transaction ${signature} was not confirmed in time`);
}

/**
 * Send a serialized transaction via Helius Sender (dual-routing: SWQoS + Jito).
 * The transaction MUST include a Jito tip transfer of at least
 * HELIUS_SENDER_MIN_TIP_LAMPORTS to a tip account (see randomJitoTipAccount).
 *
 * Returns the base-58 transaction signature on success.
 * Throws on HTTP error or RPC-level failure.
 */
export async function sendViaHeliusSender(
  wireTransactionBase64: string,
): Promise<string> {
  const response = await fetch(HELIUS_SENDER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `sender-${Date.now()}`,
      method: "sendTransaction",
      params: [
        wireTransactionBase64,
        {
          encoding: "base64",
          skipPreflight: true,
          maxRetries: 0,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Helius Sender HTTP ${response.status}`);
  }

  const payload = (await response.json()) as
    | { result: string }
    | { error: { message: string } };

  if ("error" in payload) {
    throw new Error(`Helius Sender: ${payload.error.message}`);
  }

  return payload.result;
}

/**
 * Fetch a dynamic priority fee estimate from Helius.
 * Falls back to a conservative default on any error.
 */
export async function fetchPriorityFeeEstimate(
  rpcEndpoint: string,
  accountKeys: string[] = [],
): Promise<number> {
  const FALLBACK_FEE = 50_000;
  try {
    const result = await callJsonRpc<{ priorityFeeEstimate?: number }>(
      rpcEndpoint,
      "getPriorityFeeEstimate",
      [{ accountKeys, options: { priorityLevel: "High" } }],
    );
    const fee = result?.priorityFeeEstimate;
    if (typeof fee === "number" && fee > 0) return Math.ceil(fee);
    return FALLBACK_FEE;
  } catch {
    return FALLBACK_FEE;
  }
}

/**
 * Warm the Helius Sender connection to avoid cold-start latency.
 * Call once on app mount and every 30s thereafter.
 */
export function startHeliusSenderWarmup(): () => void {
  const ping = () =>
    fetch("https://sender.helius-rpc.com/ping").catch(() => undefined);
  ping();
  const interval = setInterval(ping, 30_000);
  return () => clearInterval(interval);
}
