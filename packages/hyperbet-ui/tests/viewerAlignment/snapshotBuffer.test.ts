import { describe, expect, it } from "bun:test";
import { createSnapshotBuffer } from "../../src/lib/viewerAlignment";

/**
 * Pure tests for the time-keyed bounded snapshot buffer. Covers PRD
 * workstream F requirements for rail buffers: out-of-order tolerance,
 * retention, binary selection, duplicate-key semantics.
 */

describe("createSnapshotBuffer", () => {
  it("starts empty and returns null for pickAtOrBefore", () => {
    const buf = createSnapshotBuffer<string>();
    expect(buf.size()).toBe(0);
    expect(buf.pickAtOrBefore(1_000)).toBeNull();
  });

  it("ignores pushes with non-finite timestamps", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("x", Number.NaN);
    buf.push("y", Number.POSITIVE_INFINITY);
    expect(buf.size()).toBe(0);
  });

  it("returns the newest entry at or before a target time", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("a", 100);
    buf.push("b", 200);
    buf.push("c", 300);

    expect(buf.pickAtOrBefore(150)?.snapshot).toBe("a");
    expect(buf.pickAtOrBefore(200)?.snapshot).toBe("b");
    expect(buf.pickAtOrBefore(250)?.snapshot).toBe("b");
    expect(buf.pickAtOrBefore(300)?.snapshot).toBe("c");
    expect(buf.pickAtOrBefore(999_999)?.snapshot).toBe("c");
  });

  it("returns null when the target predates every entry", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("a", 500);
    buf.push("b", 600);
    expect(buf.pickAtOrBefore(499)).toBeNull();
    expect(buf.pickAtOrBefore(-1)).toBeNull();
  });

  it("tolerates out-of-order pushes — selection is by timestamp, not arrival", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("c", 300);
    buf.push("a", 100);
    buf.push("b", 200);
    // Iteration order is ascending by sourceEmittedAtMs regardless of arrival.
    const keys = buf.entries().map((e) => e.snapshot);
    expect(keys).toEqual(["a", "b", "c"]);
    expect(buf.pickAtOrBefore(150)?.snapshot).toBe("a");
  });

  it("replaces an entry at the same timestamp (last write wins)", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("first", 100);
    buf.push("second", 100);
    expect(buf.size()).toBe(1);
    expect(buf.pickAtOrBefore(100)?.snapshot).toBe("second");
  });

  it("prunes by retention window on push (oldest first)", () => {
    const buf = createSnapshotBuffer<string>({ retentionMs: 1_000 });
    buf.push("oldest", 0);
    buf.push("middle", 500);
    buf.push("newest", 1_200);
    // Retention window: [newest - 1000, newest] = [200, 1200]
    // 'oldest' (0) is outside and gets pruned.
    expect(buf.size()).toBe(2);
    const keys = buf.entries().map((e) => e.snapshot);
    expect(keys).toEqual(["middle", "newest"]);
  });

  it("prunes by maxSamples when window is tighter than retention", () => {
    const buf = createSnapshotBuffer<string>({
      maxSamples: 3,
      retentionMs: 1_000_000,
    });
    for (let i = 0; i < 10; i += 1) {
      buf.push(`s${i}`, i * 100);
    }
    expect(buf.size()).toBe(3);
    expect(buf.entries().map((e) => e.snapshot)).toEqual(["s7", "s8", "s9"]);
  });

  it("defaults receivedAtMs to Date.now() when not provided", () => {
    const buf = createSnapshotBuffer<string>();
    const before = Date.now();
    buf.push("a", 1);
    const after = Date.now();
    const entry = buf.pickAtOrBefore(1);
    expect(entry?.receivedAtMs).toBeGreaterThanOrEqual(before);
    expect(entry?.receivedAtMs).toBeLessThanOrEqual(after);
  });

  it("respects an explicit receivedAtMs", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("a", 1, 12_345);
    expect(buf.pickAtOrBefore(1)?.receivedAtMs).toBe(12_345);
  });

  it("clear() drops all entries", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("a", 100);
    buf.push("b", 200);
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.pickAtOrBefore(200)).toBeNull();
  });

  it("scales to dense pushes and picks correctly (binary search stress)", () => {
    // 2k entries — confirms O(log n) pick correctness under
    // sustained push pressure and retention churn.
    const buf = createSnapshotBuffer<number>({
      maxSamples: 2_500,
      retentionMs: 10_000_000,
    });
    for (let i = 0; i < 2_000; i += 1) {
      buf.push(i, i);
    }
    expect(buf.size()).toBe(2_000);
    expect(buf.pickAtOrBefore(1_000)?.snapshot).toBe(1_000);
    expect(buf.pickAtOrBefore(1_999)?.snapshot).toBe(1_999);
    expect(buf.pickAtOrBefore(5_000)?.snapshot).toBe(1_999);
  });

  it("handles an out-of-order push near the retention boundary", () => {
    // This is the subtle failure mode: a replayed frame arrives late,
    // its timestamp is just barely inside retention, but by the time
    // it inserts the window may have shifted. Confirm it still
    // inserts correctly rather than being dropped.
    const buf = createSnapshotBuffer<string>({ retentionMs: 1_000 });
    buf.push("newest", 5_000);
    buf.push("late_but_valid", 4_200);
    expect(buf.entries().map((e) => e.snapshot)).toEqual([
      "late_but_valid",
      "newest",
    ]);
  });
});
