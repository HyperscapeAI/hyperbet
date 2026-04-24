import { describe, expect, test } from "bun:test";

import {
  extractCycleIdFromStreamingDuelId,
  streamCycleAdvancedBeyondPinnedParity,
} from "./predictionMarketsSurface";

describe("prediction markets surface helpers", () => {
  test("extracts cycle ids from streaming duel ids", () => {
    expect(
      extractCycleIdFromStreamingDuelId("streaming-72abb82f-abc"),
    ).toBe("72abb82f-abc");
    expect(
      extractCycleIdFromStreamingDuelId("  STREAMING-72abb82f-abc  "),
    ).toBe("72abb82f-abc");
  });

  test("returns null for non-string or empty duel ids", () => {
    expect(extractCycleIdFromStreamingDuelId(null)).toBeNull();
    expect(extractCycleIdFromStreamingDuelId("")).toBeNull();
    expect(extractCycleIdFromStreamingDuelId("   ")).toBeNull();
  });

  test("does not treat a missing stream cycle id as advanced", () => {
    expect(
      streamCycleAdvancedBeyondPinnedParity({
        streamCycleId: null,
        previousLiveDuelId: "streaming-3735f4d1-old",
        marketParityDuelId: "streaming-3735f4d1-old",
      }),
    ).toBeFalse();
  });

  test("does not treat a matching previous live cycle as advanced", () => {
    expect(
      streamCycleAdvancedBeyondPinnedParity({
        streamCycleId: "72abb82f-new",
        previousLiveDuelId: "streaming-72abb82f-new",
        marketParityDuelId: "streaming-3735f4d1-old",
      }),
    ).toBeFalse();
  });

  test("does not treat a matching parity cycle as advanced", () => {
    expect(
      streamCycleAdvancedBeyondPinnedParity({
        streamCycleId: "72abb82f-new",
        previousLiveDuelId: "streaming-3735f4d1-old",
        marketParityDuelId: "streaming-72abb82f-new",
      }),
    ).toBeFalse();
  });

  test("detects when the stream has advanced beyond both previous live and parity", () => {
    expect(
      streamCycleAdvancedBeyondPinnedParity({
        streamCycleId: "72abb82f-new",
        previousLiveDuelId: "streaming-3735f4d1-old",
        marketParityDuelId: "streaming-3735f4d1-old",
      }),
    ).toBeTrue();
  });

  test("treats an unparseable parity duel id as lagging behind the new stream cycle", () => {
    expect(
      streamCycleAdvancedBeyondPinnedParity({
        streamCycleId: "72abb82f-new",
        previousLiveDuelId: "streaming-3735f4d1-old",
        marketParityDuelId: null,
      }),
    ).toBeTrue();
  });
});
