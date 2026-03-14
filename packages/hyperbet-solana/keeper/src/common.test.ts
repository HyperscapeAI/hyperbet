import { afterEach, expect, test } from "bun:test";

import { getPredictionMarketCreatorKeypairRef } from "./common";

const CREATOR_ENV_NAMES = [
  "AUTHORITY_KEYPAIR",
  "MARKET_MAKER_KEYPAIR",
  "ORACLE_AUTHORITY_KEYPAIR",
] as const;

const originalEnv = new Map(
  CREATOR_ENV_NAMES.map((name) => [name, process.env[name]]),
);

function restoreCreatorEnv(): void {
  for (const name of CREATOR_ENV_NAMES) {
    const originalValue = originalEnv.get(name);
    if (originalValue == null) {
      delete process.env[name];
      continue;
    }
    process.env[name] = originalValue;
  }
}

afterEach(() => {
  restoreCreatorEnv();
});

test("getPredictionMarketCreatorKeypairRef returns null when creator env vars are unset", () => {
  for (const name of CREATOR_ENV_NAMES) {
    delete process.env[name];
  }

  expect(getPredictionMarketCreatorKeypairRef()).toBeNull();
});

test("getPredictionMarketCreatorKeypairRef prefers authority over fallback creator keys", () => {
  process.env.AUTHORITY_KEYPAIR = "authority-key";
  process.env.MARKET_MAKER_KEYPAIR = "market-maker-key";
  process.env.ORACLE_AUTHORITY_KEYPAIR = "oracle-key";

  expect(getPredictionMarketCreatorKeypairRef()).toBe("authority-key");
});

test("getPredictionMarketCreatorKeypairRef falls back through market maker to oracle authority", () => {
  delete process.env.AUTHORITY_KEYPAIR;
  process.env.MARKET_MAKER_KEYPAIR = "market-maker-key";
  process.env.ORACLE_AUTHORITY_KEYPAIR = "oracle-key";

  expect(getPredictionMarketCreatorKeypairRef()).toBe("market-maker-key");

  delete process.env.MARKET_MAKER_KEYPAIR;

  expect(getPredictionMarketCreatorKeypairRef()).toBe("oracle-key");
});
