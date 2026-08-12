import { describe, expect, test } from "bun:test";

import {
  buildSolanaRpcProxyUrl,
  resolveAbsoluteHttpBase,
} from "../app/src/lib/runtimeUrls";

describe("Solana app runtime URLs", () => {
  test("builds an absolute RPC proxy URL from the configured keeper", () => {
    expect(
      buildSolanaRpcProxyUrl({
        configuredBase: "https://keeper.hyperia.example/",
        browserOrigin: "https://arena.hyperia.example",
        cluster: "mainnet-beta",
      }),
    ).toBe(
      "https://keeper.hyperia.example/api/proxy/solana/rpc?cluster=mainnet-beta",
    );
  });

  test("uses the browser origin when production relies on same-origin APIs", () => {
    expect(
      buildSolanaRpcProxyUrl({
        configuredBase: "",
        browserOrigin: "http://127.0.0.1:4173",
        cluster: "mainnet-beta",
      }),
    ).toBe("http://127.0.0.1:4173/api/proxy/solana/rpc?cluster=mainnet-beta");
  });

  test("fails closed on relative, credentialed, and non-HTTP service URLs", () => {
    for (const value of [
      "",
      "/api",
      "ws://keeper.hyperia.example",
      "https://user:secret@keeper.hyperia.example",
    ]) {
      expect(() => resolveAbsoluteHttpBase(value, null)).toThrow(
        "absolute HTTP(S)",
      );
    }
  });
});
