import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import { resolveSolanaDuelLaunchConfig } from "./solana-launch-config";

function key(byte: number): string {
  return new PublicKey(Buffer.alloc(32, byte)).toBase58();
}

function validEnv(): Record<string, string> {
  return {
    SOLANA_LAUNCH_FEE_POLICY_APPROVED: "true",
    TRADE_TREASURY_FEE_BPS: "100",
    TRADE_MARKET_MAKER_FEE_BPS: "0",
    WINNINGS_MARKET_MAKER_FEE_BPS: "0",
    SOLANA_ORACLE_DISPUTE_WINDOW_SECS: "3600",
    SOLANA_PM_REPORTER_PUBKEY: key(2),
    SOLANA_PM_FINALIZER_PUBKEY: key(3),
    SOLANA_PM_CHALLENGER_PUBKEY: key(4),
    SOLANA_PM_MARKET_OPERATOR_PUBKEY: key(5),
    SOLANA_PM_TREASURY_PUBKEY: key(6),
    SOLANA_PM_MARKET_MAKER_PUBKEY: key(7),
  };
}

describe("Solana duel launch configuration policy", () => {
  test("resolves an explicit approved native-SOL role and fee policy", () => {
    const config = resolveSolanaDuelLaunchConfig({
      env: validEnv(),
      configAuthority: new PublicKey(key(1)),
    });
    expect(config.disputeWindowSecs).toBe(3600);
    expect(config.tradeTreasuryFeeBps).toBe(100);
    expect(config.tradeMarketMakerFeeBps).toBe(0);
    expect(config.winningsMarketMakerFeeBps).toBe(0);
    expect(config.marketMaker.toBase58()).toBe(key(7));
  });

  test("requires an exact fee-policy approval and every fee input", () => {
    const env = validEnv();
    delete env.SOLANA_LAUNCH_FEE_POLICY_APPROVED;
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("must be exactly 'true'");

    Object.assign(env, validEnv());
    delete env.WINNINGS_MARKET_MAKER_FEE_BPS;
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("WINNINGS_MARKET_MAKER_FEE_BPS must be explicitly configured");
  });

  test("rejects malformed, excessive, and treasury-free fees", () => {
    for (const [name, value, message] of [
      ["TRADE_TREASURY_FEE_BPS", "0", "integer >= 1"],
      ["TRADE_MARKET_MAKER_FEE_BPS", "1.5", "integer >= 0"],
      ["TRADE_TREASURY_FEE_BPS", "400", "must not exceed 500"],
    ] as const) {
      const env = validEnv();
      env[name] = value;
      if (name === "TRADE_TREASURY_FEE_BPS" && value === "400") {
        env.TRADE_MARKET_MAKER_FEE_BPS = "101";
      }
      expect(() =>
        resolveSolanaDuelLaunchConfig({
          env,
          configAuthority: new PublicKey(key(1)),
        }),
      ).toThrow(message);
    }
  });

  test("requires the on-chain minimum dispute window", () => {
    const env = validEnv();
    env.SOLANA_ORACLE_DISPUTE_WINDOW_SECS = "59";
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("integer >= 60");
  });

  test("requires valid nonzero role public keys", () => {
    const missing = validEnv();
    delete missing.SOLANA_PM_REPORTER_PUBKEY;
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env: missing,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("must be a valid base58 Solana public key");

    const zero = validEnv();
    zero.SOLANA_PM_REPORTER_PUBKEY = PublicKey.default.toBase58();
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env: zero,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("cannot be the zero public key");
  });

  test("requires every operational role to be distinct from the config authority", () => {
    const duplicateRole = validEnv();
    duplicateRole.SOLANA_PM_FINALIZER_PUBKEY =
      duplicateRole.SOLANA_PM_REPORTER_PUBKEY;
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env: duplicateRole,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("roles must be distinct");

    const duplicateAuthority = validEnv();
    duplicateAuthority.SOLANA_PM_MARKET_OPERATOR_PUBKEY = key(1);
    expect(() =>
      resolveSolanaDuelLaunchConfig({
        env: duplicateAuthority,
        configAuthority: new PublicKey(key(1)),
      }),
    ).toThrow("duplicates config authority");
  });
});
