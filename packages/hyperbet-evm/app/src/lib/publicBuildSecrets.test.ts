import { describe, expect, it } from "bun:test";

import { assertPublicBuildSecrets } from "./publicBuildSecrets";

describe("assertPublicBuildSecrets", () => {
  it("rejects public builds with VITE EVM private keys", () => {
    expect(() =>
      assertPublicBuildSecrets("production", {
        VITE_EVM_PRIVATE_KEY:
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      }),
    ).toThrow(/VITE_EVM_PRIVATE_KEY/);
  });

  it("allows non-public builds to use local-only private key env", () => {
    expect(() =>
      assertPublicBuildSecrets("development", {
        VITE_EVM_PRIVATE_KEY:
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      }),
    ).not.toThrow();
  });
});
