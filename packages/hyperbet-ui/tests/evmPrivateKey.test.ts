import { describe, expect, it } from "bun:test";

import {
  normalizeEvmPrivateKey,
  selectConfiguredEvmPrivateKey,
} from "../src/lib/evmPrivateKey";

describe("evmPrivateKey helpers", () => {
  it("normalizes bare and prefixed private keys", () => {
    const raw = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    expect(normalizeEvmPrivateKey(raw)).toBe(`0x${raw}`);
    expect(normalizeEvmPrivateKey(`0x${raw}`)).toBe(`0x${raw}`);
    expect(normalizeEvmPrivateKey("bad-key")).toBeNull();
  });

  it("selects the first configured private key from VITE env", () => {
    expect(
      selectConfiguredEvmPrivateKey({
        VITE_EVM_PRIVATE_KEY:
          "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      }),
    ).toBe(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    expect(
      selectConfiguredEvmPrivateKey({
        VITE_HEADLESS_EVM_PRIVATE_KEY:
          "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      }),
    ).toBe(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
  });
});
