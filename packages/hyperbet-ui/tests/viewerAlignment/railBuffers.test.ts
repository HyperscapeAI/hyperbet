import { describe, expect, it } from "bun:test";
import {
  createDuelContextSnapshotBuffer,
  createMarketSnapshotBuffer,
  createSessionSnapshotBuffer,
  extractDuelContextServerEmittedAt,
  extractDuelContextSourceEmittedAt,
  extractMarketServerEmittedAt,
  extractMarketSourceEmittedAt,
  extractSessionSourceEmittedAt,
} from "../../src/lib/viewerAlignment";

/**
 * Tests for the per-rail buffer factories and the source/server
 * timestamp extraction helpers. Covers the legacy-payload fallback
 * behavior that lets the selector operate during rollout while some
 * keepers still emit pre-commit-2 shapes.
 */

describe("extractSessionSourceEmittedAt", () => {
  it("returns the numeric emittedAt from a canonical session envelope", () => {
    expect(extractSessionSourceEmittedAt({ emittedAt: 1_234 })).toBe(1_234);
  });

  it("returns null when emittedAt is missing or non-numeric", () => {
    expect(extractSessionSourceEmittedAt({})).toBeNull();
    expect(
      extractSessionSourceEmittedAt({ emittedAt: "1234" }),
    ).toBeNull();
    expect(
      extractSessionSourceEmittedAt({ emittedAt: Number.NaN }),
    ).toBeNull();
    expect(extractSessionSourceEmittedAt(null)).toBeNull();
    expect(extractSessionSourceEmittedAt(undefined)).toBeNull();
  });
});

describe("extractMarketSourceEmittedAt", () => {
  it("prefers envelope sourceEmittedAt when present (C2 contract)", () => {
    expect(
      extractMarketSourceEmittedAt({
        sourceEmittedAt: 5_000,
        live: { sourceEmittedAt: 4_000 },
        recentSettlement: { sourceEmittedAt: 3_000 },
        updatedAt: 2_000,
      }),
    ).toBe(5_000);
  });

  it("falls back to max over per-surface values when envelope missing", () => {
    expect(
      extractMarketSourceEmittedAt({
        live: { sourceEmittedAt: 4_000 },
        recentSettlement: { sourceEmittedAt: 6_000 },
        updatedAt: 2_000,
      }),
    ).toBe(6_000);
  });

  it("uses whichever per-surface anchor is present when the other is absent", () => {
    expect(
      extractMarketSourceEmittedAt({
        live: { sourceEmittedAt: 4_000 },
        recentSettlement: null,
      }),
    ).toBe(4_000);
    expect(
      extractMarketSourceEmittedAt({
        live: null,
        recentSettlement: { sourceEmittedAt: 6_000 },
      }),
    ).toBe(6_000);
  });

  it("falls back to envelope updatedAt for legacy keepers", () => {
    expect(
      extractMarketSourceEmittedAt({
        live: {},
        recentSettlement: {},
        updatedAt: 2_000,
      }),
    ).toBe(2_000);
  });

  it("returns null when nothing usable is present", () => {
    expect(extractMarketSourceEmittedAt({})).toBeNull();
    expect(extractMarketSourceEmittedAt(null)).toBeNull();
    expect(extractMarketSourceEmittedAt({ live: {}, recentSettlement: {} })).toBeNull();
  });
});

describe("extractMarketServerEmittedAt", () => {
  it("prefers envelope serverEmittedAt over updatedAt", () => {
    expect(
      extractMarketServerEmittedAt({
        serverEmittedAt: 9_000,
        updatedAt: 5_000,
      }),
    ).toBe(9_000);
  });

  it("falls back to updatedAt", () => {
    expect(extractMarketServerEmittedAt({ updatedAt: 5_000 })).toBe(5_000);
  });

  it("returns null when neither is present", () => {
    expect(extractMarketServerEmittedAt({})).toBeNull();
  });
});

describe("extractDuelContextSourceEmittedAt", () => {
  it("prefers sourceEmittedAt from C2 contract", () => {
    expect(
      extractDuelContextSourceEmittedAt({
        sourceEmittedAt: 7_000,
        updatedAt: 3_000,
      }),
    ).toBe(7_000);
  });

  it("falls back to updatedAt for legacy keepers", () => {
    expect(
      extractDuelContextSourceEmittedAt({ updatedAt: 3_000 }),
    ).toBe(3_000);
  });

  it("returns null when nothing usable is present", () => {
    expect(extractDuelContextSourceEmittedAt({})).toBeNull();
  });
});

describe("extractDuelContextServerEmittedAt", () => {
  it("prefers serverEmittedAt, falls back to updatedAt", () => {
    expect(
      extractDuelContextServerEmittedAt({
        serverEmittedAt: 11_000,
        updatedAt: 3_000,
      }),
    ).toBe(11_000);
    expect(
      extractDuelContextServerEmittedAt({ updatedAt: 3_000 }),
    ).toBe(3_000);
    expect(extractDuelContextServerEmittedAt({})).toBeNull();
  });
});

describe("rail buffer factories", () => {
  it("createSessionSnapshotBuffer returns a working SnapshotBuffer", () => {
    const buf = createSessionSnapshotBuffer<{ phase: string }>();
    buf.push({ phase: "COUNTDOWN" }, 100);
    buf.push({ phase: "FIGHTING" }, 200);
    expect(buf.pickAtOrBefore(150)?.snapshot.phase).toBe("COUNTDOWN");
    expect(buf.pickAtOrBefore(250)?.snapshot.phase).toBe("FIGHTING");
  });

  it("createMarketSnapshotBuffer honors retention options", () => {
    const buf = createMarketSnapshotBuffer<{ id: number }>({
      retentionMs: 500,
    });
    buf.push({ id: 1 }, 0);
    buf.push({ id: 2 }, 700);
    expect(buf.size()).toBe(1);
    expect(buf.pickAtOrBefore(700)?.snapshot.id).toBe(2);
  });

  it("createDuelContextSnapshotBuffer honors maxSamples options", () => {
    const buf = createDuelContextSnapshotBuffer<string>({ maxSamples: 2 });
    buf.push("a", 100);
    buf.push("b", 200);
    buf.push("c", 300);
    expect(buf.size()).toBe(2);
    expect(buf.entries().map((e) => e.snapshot)).toEqual(["b", "c"]);
  });

  it("all three rails share the same underlying SnapshotBuffer semantics", () => {
    // Sanity: identity of behavior across rails. If one diverges in
    // the future the selector's per-rail composition must change too.
    const session = createSessionSnapshotBuffer<string>();
    const market = createMarketSnapshotBuffer<string>();
    const ctx = createDuelContextSnapshotBuffer<string>();
    [session, market, ctx].forEach((buf) => {
      buf.push("early", 100);
      buf.push("late", 200);
      expect(buf.pickAtOrBefore(150)?.snapshot).toBe("early");
      expect(buf.pickAtOrBefore(250)?.snapshot).toBe("late");
    });
  });
});
