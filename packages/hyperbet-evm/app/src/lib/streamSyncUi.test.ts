import { describe, expect, test } from "bun:test";

import {
  advanceStreamSyncUiState,
  INITIAL_STREAM_SYNC_UI_SNAPSHOT,
} from "./streamSyncUi";

describe("advanceStreamSyncUiState", () => {
  test("hides the shell state when the stream and market are healthy", () => {
    expect(
      advanceStreamSyncUiState(INITIAL_STREAM_SYNC_UI_SNAPSHOT, {
        marketAligned: true,
        syncStatus: {
          sourceEpoch: 1,
          sourceLatestSeq: 5,
          lastSeenSeq: 5,
          lastAppliedSeq: 5,
          applyLagMs: 5,
          sourceEventAgeMs: 500,
          replayMode: "live",
          degradedReason: null,
          rendererHealth: { ready: true, degradedReason: null, updatedAt: 10 },
          rendererHealthAgeMs: 500,
          lastEventReceivedAt: 10,
          lastAppliedAt: 10,
          connectedAt: 10,
          enabled: true,
        },
        rendererReady: true,
        streamSurfaceReady: true,
        streamSurfaceUnavailable: false,
        marketOverviewErrorPresent: false,
      }),
    ).toEqual({
      state: "hidden",
      driftMismatchCount: 0,
    });
  });

  test("shows refreshing for a transient replay or stale-refresh sample", () => {
    expect(
      advanceStreamSyncUiState(INITIAL_STREAM_SYNC_UI_SNAPSHOT, {
        marketAligned: true,
        syncStatus: {
          sourceEpoch: 1,
          sourceLatestSeq: 5,
          lastSeenSeq: 5,
          lastAppliedSeq: 5,
          applyLagMs: 5,
          sourceEventAgeMs: 6_000,
          replayMode: "replay",
          degradedReason: null,
          rendererHealth: { ready: true, degradedReason: null, updatedAt: 10 },
          rendererHealthAgeMs: 2_000,
          lastEventReceivedAt: 10,
          lastAppliedAt: 10,
          connectedAt: 10,
          enabled: true,
        },
        rendererReady: true,
        streamSurfaceReady: false,
        streamSurfaceUnavailable: false,
        marketOverviewErrorPresent: false,
      }).state,
    ).toBe("refreshing");
  });

  test("shows degraded when the renderer is unhealthy", () => {
    expect(
      advanceStreamSyncUiState(INITIAL_STREAM_SYNC_UI_SNAPSHOT, {
        marketAligned: true,
        syncStatus: null,
        rendererReady: false,
        streamSurfaceReady: false,
        streamSurfaceUnavailable: false,
        marketOverviewErrorPresent: false,
      }).state,
    ).toBe("degraded");
  });

  test("requires two consecutive mismatches before escalating to drift", () => {
    const first = advanceStreamSyncUiState(INITIAL_STREAM_SYNC_UI_SNAPSHOT, {
      marketAligned: false,
      syncStatus: null,
      rendererReady: true,
      streamSurfaceReady: true,
      streamSurfaceUnavailable: false,
      marketOverviewErrorPresent: false,
    });
    const second = advanceStreamSyncUiState(first, {
      marketAligned: false,
      syncStatus: null,
      rendererReady: true,
      streamSurfaceReady: true,
      streamSurfaceUnavailable: false,
      marketOverviewErrorPresent: false,
    });

    expect(first).toEqual({
      state: "refreshing",
      driftMismatchCount: 1,
    });
    expect(second).toEqual({
      state: "drift",
      driftMismatchCount: 2,
    });
  });

  test("clears drift after one healthy poll", () => {
    const drifted = {
      state: "drift" as const,
      driftMismatchCount: 2,
    };

    expect(
      advanceStreamSyncUiState(drifted, {
        marketAligned: true,
        syncStatus: {
          sourceEpoch: 1,
          sourceLatestSeq: 6,
          lastSeenSeq: 6,
          lastAppliedSeq: 6,
          applyLagMs: 1,
          sourceEventAgeMs: 100,
          replayMode: "live",
          degradedReason: null,
          rendererHealth: { ready: true, degradedReason: null, updatedAt: 11 },
          rendererHealthAgeMs: 100,
          lastEventReceivedAt: 11,
          lastAppliedAt: 11,
          connectedAt: 11,
          enabled: true,
        },
        rendererReady: true,
        streamSurfaceReady: true,
        streamSurfaceUnavailable: false,
        marketOverviewErrorPresent: false,
      }),
    ).toEqual({
      state: "hidden",
      driftMismatchCount: 0,
    });
  });

  test("hides renderer-health-stale when the stream surface is visibly ready", () => {
    expect(
      advanceStreamSyncUiState(INITIAL_STREAM_SYNC_UI_SNAPSHOT, {
        marketAligned: true,
        syncStatus: {
          sourceEpoch: 1,
          sourceLatestSeq: 5,
          lastSeenSeq: 5,
          lastAppliedSeq: 5,
          applyLagMs: 0,
          sourceEventAgeMs: 455,
          replayMode: "live",
          degradedReason: "renderer_health_stale",
          rendererHealth: {
            ready: false,
            degradedReason: "renderer_health_stale",
            updatedAt: 10,
          },
          rendererHealthAgeMs: 455,
          lastEventReceivedAt: 10,
          lastAppliedAt: 10,
          connectedAt: 10,
          enabled: true,
        },
        rendererReady: false,
        streamSurfaceReady: true,
        streamSurfaceUnavailable: false,
        marketOverviewErrorPresent: false,
      }).state,
    ).toBe("hidden");
  });
});
