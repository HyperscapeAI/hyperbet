import { describe, expect, test } from "bun:test";

import {
  findUnsupportedJsonRpcMethod,
  isWriteRateLimitedRoute,
  PUBLIC_SOLANA_RPC_READ_METHODS,
} from "./solanaRpcProxyPolicy";

describe("SOL-only RPC proxy policy", () => {
  test("allows only the public Solana read/confirm method subset", () => {
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

  test("classifies only the Solana read proxy POST as read traffic", () => {
    expect(isWriteRateLimitedRoute("POST", "/api/proxy/solana/rpc")).toBe(
      false,
    );
    expect(isWriteRateLimitedRoute("POST", "/api/proxy/evm/rpc")).toBe(true);
    expect(isWriteRateLimitedRoute("POST", "/api/unknown")).toBe(true);
    expect(isWriteRateLimitedRoute("GET", "/status")).toBe(false);
  });
});
