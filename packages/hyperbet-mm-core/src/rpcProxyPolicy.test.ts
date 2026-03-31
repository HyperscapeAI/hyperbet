import { describe, expect, test } from "bun:test";

import {
  findUnsupportedJsonRpcMethod,
  isWriteRateLimitedRoute,
  PUBLIC_EVM_RPC_READ_METHODS,
  PUBLIC_SOLANA_RPC_READ_METHODS,
} from "./rpcProxyPolicy.js";

describe("rpc proxy policy", () => {
  test("treats public RPC proxy POSTs as read traffic", () => {
    expect(isWriteRateLimitedRoute("POST", "/api/proxy/solana/rpc")).toBe(
      false,
    );
    expect(isWriteRateLimitedRoute("POST", "/api/proxy/evm/rpc")).toBe(false);
    expect(isWriteRateLimitedRoute("GET", "/api/perps/markets")).toBe(false);
  });

  test("keeps write and unknown POST routes on the write bucket", () => {
    expect(
      isWriteRateLimitedRoute("POST", "/api/streaming/state/publish"),
    ).toBe(true);
    expect(
      isWriteRateLimitedRoute("POST", "/api/arena/invite/redeem"),
    ).toBe(true);
    expect(
      isWriteRateLimitedRoute("POST", "/api/proxy/solana/sender"),
    ).toBe(true);
    expect(isWriteRateLimitedRoute("POST", "/api/unknown")).toBe(true);
  });

  test("allows the public EVM read subset and rejects send methods", () => {
    expect(
      findUnsupportedJsonRpcMethod(
        [
          { method: "eth_chainId" },
          { method: "eth_getTransactionCount" },
          { method: "eth_estimateGas" },
          { method: "eth_gasPrice" },
        ],
        PUBLIC_EVM_RPC_READ_METHODS,
      ),
    ).toBeNull();

    expect(
      findUnsupportedJsonRpcMethod(
        [{ method: "eth_sendRawTransaction" }],
        PUBLIC_EVM_RPC_READ_METHODS,
      ),
    ).toBe("eth_sendRawTransaction");
  });

  test("allows Solana read/confirm methods and rejects sendTransaction", () => {
    expect(
      findUnsupportedJsonRpcMethod(
        [
          { method: "getLatestBlockhash" },
          { method: "getSignatureStatuses" },
          { method: "getTokenAccountsByOwner" },
        ],
        PUBLIC_SOLANA_RPC_READ_METHODS,
      ),
    ).toBeNull();

    expect(
      findUnsupportedJsonRpcMethod(
        [{ method: "sendTransaction" }],
        PUBLIC_SOLANA_RPC_READ_METHODS,
      ),
    ).toBe("sendTransaction");
  });
});
