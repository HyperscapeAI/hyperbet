import { describe, expect, test } from "bun:test";
import {
  normalizePredictionMarketLifecycleMetadata,
  resolveLifecycleFromSolanaDuelStatus,
  resolveLifecycleFromSolanaMarketStatus,
  resolveLifecycleFromStreamPhase,
  toRecordedBetChain,
} from "./solanaLifecycle";

describe("Solana-only keeper lifecycle", () => {
  test("maps only the native Solana recorded-bet chain", () => {
    expect(toRecordedBetChain("solana")).toBe("SOLANA");
  });

  test("normalizes stream, oracle, and duel-market lifecycle states", () => {
    expect(resolveLifecycleFromStreamPhase("announcement")).toBe("OPEN");
    expect(resolveLifecycleFromStreamPhase("fighting")).toBe("LOCKED");
    expect(resolveLifecycleFromSolanaDuelStatus("betting_open")).toBe("OPEN");
    expect(resolveLifecycleFromSolanaDuelStatus("challenged")).toBe(
      "CHALLENGED",
    );
    expect(resolveLifecycleFromSolanaMarketStatus("resolved")).toBe("RESOLVED");
    expect(resolveLifecycleFromSolanaMarketStatus("amm-open")).toBe("UNKNOWN");
  });

  test("fails optional lifecycle metadata closed to canonical values", () => {
    expect(
      normalizePredictionMarketLifecycleMetadata({
        proposalId: 123,
        challengeWindowEndsAt: Number.NaN,
        finalizedAt: 456,
        cancellationReason: "operator-cancelled",
      }),
    ).toEqual({
      proposalId: null,
      challengeWindowEndsAt: null,
      finalizedAt: 456,
      cancellationReason: "operator-cancelled",
    });
  });
});
