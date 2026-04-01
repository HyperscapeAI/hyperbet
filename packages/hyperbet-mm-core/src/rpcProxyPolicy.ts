export type JsonRpcMethodRequest = {
  method: string;
};

type AllowedJsonRpcMethods =
  | Readonly<Record<string, unknown>>
  | ReadonlySet<string>
  | readonly string[];

const READ_RATE_LIMIT_POST_PATHS = new Set([
  "/api/proxy/solana/rpc",
  "/api/proxy/evm/rpc",
]);

const WRITE_RATE_LIMIT_POST_PATHS = new Set([
  "/api/streaming/state/publish",
  "/api/arena/bet/record-external",
  "/api/arena/invite/redeem",
  "/api/arena/wallet-link",
  "/api/proxy/solana/sender",
]);

export const PUBLIC_EVM_RPC_READ_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "net_version",
  "web3_clientVersion",
]);

export const PUBLIC_SOLANA_RPC_READ_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getBlockTime",
  "getEpochInfo",
  "getEpochSchedule",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getIdentity",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getSupply",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getVersion",
]);

function isAllowedJsonRpcMethod(
  method: string,
  allowedMethods: AllowedJsonRpcMethods,
): boolean {
  if (allowedMethods instanceof Set) {
    return allowedMethods.has(method);
  }
  if (Array.isArray(allowedMethods)) {
    return allowedMethods.includes(method);
  }
  return Object.hasOwn(allowedMethods, method);
}

export function findUnsupportedJsonRpcMethod(
  requests: readonly JsonRpcMethodRequest[],
  allowedMethods: AllowedJsonRpcMethods,
): string | null {
  for (const request of requests) {
    if (!isAllowedJsonRpcMethod(request.method, allowedMethods)) {
      return request.method;
    }
  }
  return null;
}

export function isWriteRateLimitedRoute(
  method: string,
  pathname: string,
): boolean {
  if (method.toUpperCase() !== "POST") {
    return false;
  }
  if (READ_RATE_LIMIT_POST_PATHS.has(pathname)) {
    return false;
  }
  if (WRITE_RATE_LIMIT_POST_PATHS.has(pathname)) {
    return true;
  }
  return true;
}
