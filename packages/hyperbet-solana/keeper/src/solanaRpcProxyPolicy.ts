export type JsonRpcMethodRequest = { method: string };

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

export function findUnsupportedJsonRpcMethod(
  requests: readonly JsonRpcMethodRequest[],
  allowedMethods: ReadonlySet<string>,
): string | null {
  for (const request of requests) {
    if (!allowedMethods.has(request.method)) return request.method;
  }
  return null;
}

export function isWriteRateLimitedRoute(
  method: string,
  pathname: string,
): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return pathname !== "/api/proxy/solana/rpc";
}
