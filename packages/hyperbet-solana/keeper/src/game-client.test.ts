import { afterEach, describe, expect, test } from "bun:test";

import {
  GameClient,
  normalizeBettingFeedCycle,
  type BettingFeedCheckpoint,
  type BettingFeedCheckpointStore,
} from "./game-client";
import { buildTestCompetitiveSnapshot } from "./testCompetitiveSnapshot";

type FetchCycle = {
  sourceEpoch?: number;
  seq?: number;
  emittedAt?: number;
  phaseVersion?: number;
  cycleId?: string;
  phase?: string;
  duelId?: string | null;
  duelKeyHex?: string | null;
  competitiveSnapshotVersion?: number | null;
  competitiveSnapshotDigest?: string | null;
  competitiveSnapshot?: unknown;
  betOpenTime?: number | null;
  betCloseTime?: number | null;
  fightStartTime?: number | null;
  duelEndTime?: number | null;
  winnerId?: string | null;
  outcome?: "win" | "draw" | "cancelled" | null;
  cancellationReason?: string | null;
  winReason?:
    | "kill"
    | "forfeit"
    | "hp_advantage"
    | "damage_advantage"
    | "draw"
    | null;
  seed?: string | null;
  replayHash?: string | null;
};

const originalFetch = globalThis.fetch;
const originalBetSyncToken = process.env.BET_SYNC_SOURCE_BEARER_TOKEN;

function makeCycle(overrides: FetchCycle): FetchCycle {
  const base: FetchCycle = {
    sourceEpoch: 10,
    emittedAt: 1_000,
    phaseVersion: 1,
    cycleId: "cycle-1",
    phase: "ANNOUNCEMENT",
    duelId: "duel-1",
    duelKeyHex: "11".repeat(32),
    betOpenTime: 1_000,
    betCloseTime: 1_060,
    fightStartTime: null,
    duelEndTime: null,
    winnerId: null,
    outcome: null,
    cancellationReason: null,
    winReason: null,
    seed: null,
    replayHash: null,
  };
  const cycle = { ...base, ...overrides };
  if (overrides.emittedAt === undefined) {
    cycle.emittedAt = Math.max(
      Number(cycle.emittedAt ?? 0),
      Number(cycle.fightStartTime ?? 0),
      Number(cycle.duelEndTime ?? 0),
    );
  }
  if (
    typeof cycle.cycleId === "string" &&
    typeof cycle.duelId === "string" &&
    typeof cycle.duelKeyHex === "string" &&
    typeof cycle.betOpenTime === "number" &&
    typeof cycle.betCloseTime === "number"
  ) {
    return {
      ...cycle,
      ...buildTestCompetitiveSnapshot({
        cycleId: cycle.cycleId,
        duelId: cycle.duelId,
        duelKey: cycle.duelKeyHex,
        betOpenTime: cycle.betOpenTime,
        betCloseTime: cycle.betCloseTime,
      }),
    };
  }
  return {
    ...cycle,
    competitiveSnapshotVersion: null,
    competitiveSnapshotDigest: null,
    competitiveSnapshot: null,
  };
}

const DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST = String(
  makeCycle({}).competitiveSnapshotDigest,
);

function feedPresentationFields(cycle: FetchCycle) {
  const active = typeof cycle.duelId === "string";
  const winnerName =
    cycle.winnerId === "agent-a"
      ? "Agent A"
      : cycle.winnerId === "agent-b"
        ? "Agent B"
        : null;
  return {
    arenaPositions: active ? { agent1: [-1, 0, 0], agent2: [1, 0, 0] } : null,
    winnerName,
    rendererHealth: {
      ready: true,
      degradedReason: null,
      updatedAt: cycle.emittedAt ?? 1_700_000_000_000,
    },
  };
}

function feedAgent(side: "agent-a" | "agent-b") {
  const isAlpha = side === "agent-a";
  return {
    id: side,
    name: isAlpha ? "Agent A" : "Agent B",
    provider: isAlpha ? "provider-a" : "provider-b",
    model: isAlpha ? "model-a" : "model-b",
    hp: 30,
    maxHp: 30,
    combatLevel: 42,
    wins: isAlpha ? 12 : 10,
    losses: isAlpha ? 4 : 6,
    damageDealtThisFight: 0,
    rank: isAlpha ? 1 : 2,
    headToHeadWins: isAlpha ? 3 : 2,
    headToHeadLosses: isAlpha ? 2 : 3,
  };
}

function mockBetSyncSequence(cycles: FetchCycle[], schemaVersion = 3) {
  let index = 0;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input, init });
    const cycleIndex = Math.min(index, cycles.length - 1);
    const cycle = cycles[cycleIndex];
    index += 1;
    return {
      ok: true,
      json: async () => ({
        schemaVersion,
        sourceEpoch: cycle.sourceEpoch,
        seq: cycle.seq ?? cycleIndex + 1,
        emittedAt: cycle.emittedAt,
        phaseVersion: cycle.phaseVersion,
        duelId: cycle.duelId,
        duelKey: cycle.duelKeyHex,
        competitiveSnapshotVersion: cycle.competitiveSnapshotVersion,
        competitiveSnapshotDigest: cycle.competitiveSnapshotDigest,
        competitiveSnapshot: cycle.competitiveSnapshot,
        phase: cycle.phase,
        betOpenTime: cycle.betOpenTime,
        betCloseTime: cycle.betCloseTime,
        fightStartTime: cycle.fightStartTime,
        duelEndTime: cycle.duelEndTime,
        winnerId: cycle.winnerId,
        outcome: cycle.outcome,
        cancellationReason: cycle.cancellationReason,
        winReason: cycle.winReason,
        seed: cycle.seed,
        replayHash: cycle.replayHash,
        agent1: feedAgent("agent-a"),
        agent2: feedAgent("agent-b"),
        ...feedPresentationFields(cycle),
      }),
    } as Response;
  }) as unknown as typeof fetch;
  return requests;
}

class MemoryCheckpointStore implements BettingFeedCheckpointStore {
  checkpoint: BettingFeedCheckpoint | null;

  constructor(checkpoint: BettingFeedCheckpoint | null = null) {
    this.checkpoint = checkpoint;
  }

  getBettingFeedCheckpoint(): BettingFeedCheckpoint | null {
    return this.checkpoint;
  }

  saveBettingFeedCheckpoint(
    checkpoint: Omit<BettingFeedCheckpoint, "degradedReason" | "updatedAt"> & {
      updatedAt?: number;
    },
  ): BettingFeedCheckpoint {
    this.checkpoint = {
      ...checkpoint,
      degradedReason: null,
      updatedAt: checkpoint.updatedAt ?? Date.now(),
    };
    return this.checkpoint;
  }

  markBettingFeedDegraded(reason: unknown, now = Date.now()): void {
    const message = reason instanceof Error ? reason.message : String(reason);
    this.checkpoint = {
      sourceEpoch: this.checkpoint?.sourceEpoch ?? 0,
      lastAppliedSeq: this.checkpoint?.lastAppliedSeq ?? 0,
      lastEmittedAt: this.checkpoint?.lastEmittedAt ?? 0,
      duelId: this.checkpoint?.duelId ?? null,
      competitiveSnapshotDigest:
        this.checkpoint?.competitiveSnapshotDigest ?? null,
      phase: this.checkpoint?.phase ?? null,
      terminal: this.checkpoint?.terminal ?? true,
      degradedReason: message,
      updatedAt: now,
    };
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function bettingPayload(cycle: FetchCycle): Record<string, unknown> {
  return {
    schemaVersion: 3,
    sourceEpoch: cycle.sourceEpoch ?? 10,
    seq: cycle.seq ?? 1,
    emittedAt: cycle.emittedAt ?? 1_700_000_000_000,
    phaseVersion: cycle.phaseVersion ?? 1,
    duelId: cycle.duelId,
    duelKey: cycle.duelKeyHex,
    competitiveSnapshotVersion: cycle.competitiveSnapshotVersion,
    competitiveSnapshotDigest: cycle.competitiveSnapshotDigest,
    competitiveSnapshot: cycle.competitiveSnapshot,
    phase: cycle.phase,
    betOpenTime: cycle.betOpenTime,
    betCloseTime: cycle.betCloseTime,
    fightStartTime: cycle.fightStartTime,
    duelEndTime: cycle.duelEndTime,
    winnerId: cycle.winnerId,
    outcome: cycle.outcome,
    cancellationReason: cycle.cancellationReason,
    winReason: cycle.winReason,
    seed: cycle.seed,
    replayHash: cycle.replayHash,
    agent1: feedAgent("agent-a"),
    agent2: feedAgent("agent-b"),
    ...feedPresentationFields(cycle),
  };
}

describe("GameClient lifecycle reconciliation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalBetSyncToken === undefined) {
      delete process.env.BET_SYNC_SOURCE_BEARER_TOKEN;
    } else {
      process.env.BET_SYNC_SOURCE_BEARER_TOKEN = originalBetSyncToken;
    }
  });

  test.each([1, 2] as const)(
    "accepts a schema-v%i snapshot only for an explicit terminal cancellation",
    (snapshotVersion) => {
      const identity = {
        cycleId: "legacy-cycle",
        duelId: "legacy-duel",
        duelKeyHex: "55".repeat(32),
        betOpenTime: 1_000,
        betCloseTime: 1_060,
      };
      const legacySnapshot = buildTestCompetitiveSnapshot({
        cycleId: identity.cycleId,
        duelId: identity.duelId,
        duelKey: identity.duelKeyHex,
        betOpenTime: identity.betOpenTime,
        betCloseTime: identity.betCloseTime,
        snapshotVersion,
      });
      const announcement = {
        ...makeCycle({ ...identity, phase: "ANNOUNCEMENT" }),
        ...legacySnapshot,
      };
      const cancelled = {
        ...announcement,
        emittedAt: 1_180,
        duelEndTime: 1_180,
        outcome: "cancelled" as const,
        cancellationReason:
          "competitive_snapshot_recovery_loadout_schema_unavailable",
      };

      expect(
        normalizeBettingFeedCycle(bettingPayload(announcement)),
      ).toBeNull();
      expect(
        normalizeBettingFeedCycle(bettingPayload(cancelled)),
      ).toMatchObject({
        competitiveSnapshotVersion: snapshotVersion,
        outcome: "cancelled",
        cancellationReason:
          "competitive_snapshot_recovery_loadout_schema_unavailable",
      });
    },
  );

  test("accepts released arena positions only for a terminal cancellation", () => {
    const cancelled = makeCycle({
      phase: "ANNOUNCEMENT",
      emittedAt: 1_180,
      duelEndTime: 1_180,
      outcome: "cancelled",
      cancellationReason: "competitive_snapshot_recovery_window_elapsed",
    });
    const announcement = makeCycle({ phase: "ANNOUNCEMENT" });
    const win = makeCycle({
      phase: "RESOLUTION",
      emittedAt: 1_180,
      fightStartTime: 1_060,
      duelEndTime: 1_180,
      winnerId: "agent-a",
      outcome: "win",
      winReason: "kill",
      seed: "42",
      replayHash: "ab".repeat(32),
    });
    const draw = makeCycle({
      phase: "RESOLUTION",
      emittedAt: 1_180,
      fightStartTime: 1_060,
      duelEndTime: 1_180,
      outcome: "draw",
      cancellationReason: "draw",
      winReason: "draw",
      seed: "42",
      replayHash: "ab".repeat(32),
    });

    expect(
      normalizeBettingFeedCycle({
        ...bettingPayload(cancelled),
        arenaPositions: null,
      }),
    ).toMatchObject({
      duelId: "duel-1",
      outcome: "cancelled",
      cancellationReason: "competitive_snapshot_recovery_window_elapsed",
    });

    for (const invalid of [announcement, win, draw]) {
      expect(
        normalizeBettingFeedCycle({
          ...bettingPayload(invalid),
          arenaPositions: null,
        }),
      ).toBeNull();
    }
  });

  test("replays a bootstrap refund terminal after a failed callback without opening a new lifecycle", async () => {
    mockBetSyncSequence([
      makeCycle({
        phase: "RESOLUTION",
        duelEndTime: 1_180,
        outcome: "draw",
        cancellationReason: "draw",
        winReason: "draw",
        seed: "42",
        replayHash: "ab".repeat(32),
      }),
    ]);

    let attempts = 0;
    let starts = 0;
    let locks = 0;
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      starts += 1;
    });
    client.onBettingLocked(async () => {
      locks += 1;
    });
    client.onDuelEnd(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient cancellation failure");
      }
    });

    await (client as any).poll();
    (client as any).pollBackoffUntil = 0;
    await (client as any).poll();

    expect({ attempts, starts, locks }).toEqual({
      attempts: 2,
      starts: 0,
      locks: 0,
    });
  });

  test("retries a failed duel-start callback without skipping market creation", async () => {
    mockBetSyncSequence([makeCycle({ phase: "ANNOUNCEMENT" })]);

    let attempts = 0;
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient start failure");
    });

    await (client as any).poll();
    (client as any).pollBackoffUntil = 0;
    await (client as any).poll();

    expect(attempts).toBe(2);
  });

  test("reports each new validated state frame without treating duplicate polls as freshness", async () => {
    mockBetSyncSequence([
      makeCycle({ seq: 1, emittedAt: 1_000 }),
      makeCycle({ seq: 2, emittedAt: 2_000 }),
      makeCycle({ seq: 2, emittedAt: 2_000 }),
    ]);

    const frames: Array<{ seq: number; emittedAt: number }> = [];
    const client = new GameClient("https://example.test");
    client.onStateFrame((cycle) => {
      frames.push({ seq: cycle.seq, emittedAt: cycle.emittedAt });
    });

    await (client as any).poll();
    await (client as any).poll();
    await (client as any).poll();

    expect(frames).toEqual([
      { seq: 1, emittedAt: 1_000 },
      { seq: 2, emittedAt: 2_000 },
    ]);
  });

  test("retries a failed betting-lock callback without repeating duel start", async () => {
    mockBetSyncSequence([makeCycle({ phase: "FIGHTING" })]);

    let starts = 0;
    let lockAttempts = 0;
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      starts += 1;
    });
    client.onBettingLocked(async () => {
      lockAttempts += 1;
      if (lockAttempts === 1) throw new Error("transient lock failure");
    });

    await (client as any).poll();
    (client as any).pollBackoffUntil = 0;
    await (client as any).poll();

    expect({ starts, lockAttempts }).toEqual({ starts: 1, lockAttempts: 2 });
  });

  test("locks at the immutable authoritative close time even while preparation remains in announcement", async () => {
    mockBetSyncSequence([
      makeCycle({ seq: 1, phase: "ANNOUNCEMENT", emittedAt: 1_059 }),
      makeCycle({ seq: 2, phase: "ANNOUNCEMENT", emittedAt: 1_060 }),
      makeCycle({ seq: 3, phase: "ANNOUNCEMENT", emittedAt: 1_061 }),
    ]);

    const events: string[] = [];
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      events.push("start");
    });
    client.onBettingLocked(async () => {
      events.push("lock");
    });

    await (client as any).poll();
    expect(events).toEqual(["start"]);
    await (client as any).poll();
    expect(events).toEqual(["start", "lock"]);
    await (client as any).poll();
    expect(events).toEqual(["start", "lock"]);
  });

  test("ignores non-v3 betting feed payloads", async () => {
    mockBetSyncSequence([makeCycle({ phase: "ANNOUNCEMENT" })], 1);

    let starts = 0;
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      starts += 1;
    });
    await (client as any).poll();

    expect(starts).toBe(0);
  });

  test("cancels an active duel without forcing an intermediate lock or inventing a winner", async () => {
    process.env.BET_SYNC_SOURCE_BEARER_TOKEN = "feed-secret";
    const requests = mockBetSyncSequence([
      makeCycle({ phase: "ANNOUNCEMENT" }),
      makeCycle({
        phase: "FIGHTING",
        duelEndTime: 1_170,
        outcome: "cancelled",
        cancellationReason: "combat_engagement_failed",
      }),
    ]);

    const events: string[] = [];
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      events.push("start");
    });
    client.onBettingLocked(async () => {
      events.push("lock");
    });
    client.onDuelEnd(async (event) => {
      events.push(
        [
          "end",
          event.outcome,
          event.cancellationReason,
          event.winnerId ?? "none",
        ].join(":"),
      );
    });

    await (client as any).poll();
    await (client as any).poll();

    expect(events).toEqual([
      "start",
      "end:cancelled:combat_engagement_failed:none",
    ]);
    expect(String(requests[0]?.input)).toBe(
      "https://example.test/api/internal/bet-sync/state",
    );
    expect(
      (requests[0]?.init?.headers as Record<string, string>).authorization,
    ).toBe("Bearer feed-secret");
  });

  test("replays locked and resolved callbacks when the first poll lands mid-resolution", async () => {
    mockBetSyncSequence([
      makeCycle({
        phase: "RESOLUTION",
        duelEndTime: 1_180,
        winnerId: "agent-a",
        outcome: "win",
        winReason: "kill",
        seed: "777",
        replayHash: "ab".repeat(32),
      }),
    ]);

    const events: string[] = [];
    const client = new GameClient("https://example.test");
    client.onDuelStart(async () => {
      events.push("start");
    });
    client.onBettingLocked(async () => {
      events.push("lock");
    });
    client.onDuelEnd(async () => {
      events.push("end");
    });

    await (client as any).poll();

    expect(events).toEqual(["start", "lock", "end"]);
  });

  test("waits for an authoritative outcome when resolution precedes its result fields", async () => {
    mockBetSyncSequence([
      makeCycle({ phase: "FIGHTING" }),
      makeCycle({ phase: "RESOLUTION" }),
      makeCycle({
        phase: "RESOLUTION",
        duelEndTime: 1_180,
        winnerId: "agent-a",
        outcome: "win",
        winReason: "kill",
        seed: "42",
        replayHash: "cd".repeat(32),
      }),
    ]);

    const events: string[] = [];
    const checkpointStore = new MemoryCheckpointStore();
    const client = new GameClient("https://example.test", checkpointStore);
    client.onDuelStart(async () => {
      events.push("start");
    });
    client.onBettingLocked(async () => {
      events.push("lock");
    });
    client.onDuelEnd(async (event) => {
      events.push(`end:${event.seed ?? "-"}`);
    });

    await (client as any).poll();
    await (client as any).poll();
    expect(events).toEqual(["start", "lock"]);
    expect(checkpointStore.checkpoint).toMatchObject({
      phase: "RESOLUTION",
      terminal: false,
    });

    await (client as any).poll();

    expect(events).toEqual(["start", "lock", "end:42"]);
    expect(checkpointStore.checkpoint).toMatchObject({
      phase: "RESOLUTION",
      terminal: true,
    });
  });

  test("replays every missing sequence before applying the latest state", async () => {
    const checkpointStore = new MemoryCheckpointStore({
      sourceEpoch: 10,
      lastAppliedSeq: 1,
      lastEmittedAt: 1_700_000_000_000,
      duelId: "duel-1",
      competitiveSnapshotDigest: DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST,
      phase: "ANNOUNCEMENT",
      terminal: false,
      degradedReason: null,
      updatedAt: 1_700_000_000_000,
    });
    const fighting = makeCycle({
      seq: 2,
      emittedAt: 1_700_000_001_000,
      phase: "FIGHTING",
      phaseVersion: 2,
    });
    const resolved = makeCycle({
      seq: 3,
      emittedAt: 1_700_000_002_000,
      phase: "RESOLUTION",
      phaseVersion: 3,
      outcome: "win",
      winnerId: "agent-a",
      duelEndTime: 1_180,
      winReason: "kill",
      seed: "42",
      replayHash: "ef".repeat(32),
    });
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input).includes("/events")) {
        const body = [fighting, resolved]
          .map(
            (cycle) =>
              `event: betting\nid: ${cycle.seq}\ndata: ${JSON.stringify(bettingPayload(cycle))}\n\n`,
          )
          .join("");
        return new Response(body, { status: 200 });
      }
      return jsonResponse(bettingPayload(resolved));
    }) as typeof fetch;

    const events: string[] = [];
    const client = new GameClient("https://example.test", checkpointStore);
    client.onDuelStart(() => {
      events.push("start");
    });
    client.onBettingLocked(() => {
      events.push("lock");
    });
    client.onDuelEnd(() => {
      events.push("end");
    });

    await (client as any).poll();

    expect(events).toEqual(["start", "lock", "end"]);
    expect(requests[1]).toBe(
      "https://example.test/api/internal/bet-sync/events?since=1",
    );
    expect(checkpointStore.checkpoint).toMatchObject({
      sourceEpoch: 10,
      lastAppliedSeq: 3,
      duelId: "duel-1",
      competitiveSnapshotDigest: DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST,
      phase: "RESOLUTION",
      terminal: true,
      degradedReason: null,
    });
  });

  test("fails closed when a replay gap exceeds source retention", async () => {
    const checkpointStore = new MemoryCheckpointStore({
      sourceEpoch: 10,
      lastAppliedSeq: 1,
      lastEmittedAt: 1_700_000_000_000,
      duelId: "duel-1",
      competitiveSnapshotDigest: DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST,
      phase: "ANNOUNCEMENT",
      terminal: false,
      degradedReason: null,
      updatedAt: 1_700_000_000_000,
    });
    const latest = makeCycle({
      seq: 5,
      emittedAt: 1_700_000_005_000,
      phase: "RESOLUTION",
      phaseVersion: 5,
      outcome: "draw",
      cancellationReason: "draw",
      duelEndTime: 1_180,
      winReason: "draw",
      seed: "42",
      replayHash: "ab".repeat(32),
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/events")) {
        return new Response(
          `event: reset\ndata: ${JSON.stringify(bettingPayload(latest))}\n\n`,
          { status: 200 },
        );
      }
      return jsonResponse(bettingPayload(latest));
    }) as typeof fetch;

    let terminalCalls = 0;
    const client = new GameClient("https://example.test", checkpointStore);
    client.onDuelEnd(() => {
      terminalCalls += 1;
    });
    await (client as any).poll();

    expect(terminalCalls).toBe(0);
    expect(checkpointStore.checkpoint).toMatchObject({
      lastAppliedSeq: 1,
      degradedReason: expect.stringContaining("exceeded source retention"),
    });
  });

  test("fails closed on a source restart that abandons an active duel", async () => {
    const checkpointStore = new MemoryCheckpointStore({
      sourceEpoch: 10,
      lastAppliedSeq: 8,
      lastEmittedAt: 1_700_000_008_000,
      duelId: "duel-active",
      competitiveSnapshotDigest: "33".repeat(32),
      phase: "FIGHTING",
      terminal: false,
      degradedReason: null,
      updatedAt: 1_700_000_008_000,
    });
    const replacement = makeCycle({
      sourceEpoch: 11,
      seq: 1,
      emittedAt: 1_700_000_009_000,
      duelId: "duel-replacement",
      duelKeyHex: "22".repeat(32),
      phase: "ANNOUNCEMENT",
    });
    globalThis.fetch = (async () =>
      jsonResponse(bettingPayload(replacement))) as unknown as typeof fetch;

    let starts = 0;
    const client = new GameClient("https://example.test", checkpointStore);
    client.onDuelStart(() => {
      starts += 1;
    });
    await (client as any).poll();

    expect(starts).toBe(0);
    expect(checkpointStore.checkpoint).toMatchObject({
      sourceEpoch: 10,
      lastAppliedSeq: 8,
      degradedReason: expect.stringContaining(
        "before active duel duel-active reached a terminal state",
      ),
    });
  });

  test("fails closed when a valid snapshot digest changes for the same duel", async () => {
    for (const scenario of [
      {
        label: "within one source epoch",
        sourceEpoch: 10,
        seq: 6,
        expected: "competitive snapshot changed for active duel duel-1",
      },
      {
        label: "across a source epoch handoff",
        sourceEpoch: 11,
        seq: 1,
        expected:
          "competitive snapshot changed across source epoch for duel duel-1",
      },
    ]) {
      const checkpointStore = new MemoryCheckpointStore({
        sourceEpoch: 10,
        lastAppliedSeq: 5,
        lastEmittedAt: 1_700_000_005_000,
        duelId: "duel-1",
        competitiveSnapshotDigest: DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST,
        phase: "FIGHTING",
        terminal: false,
        degradedReason: null,
        updatedAt: 1_700_000_005_000,
      });
      const drifted = makeCycle({
        sourceEpoch: scenario.sourceEpoch,
        seq: scenario.seq,
        emittedAt: 1_700_000_006_000,
        cycleId: `drifted-${scenario.label.replaceAll(" ", "-")}`,
        duelId: "duel-1",
        phase: "FIGHTING",
      });
      expect(drifted.competitiveSnapshotDigest).not.toBe(
        DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST,
      );
      globalThis.fetch = (async () =>
        jsonResponse(bettingPayload(drifted))) as unknown as typeof fetch;

      let callbackCount = 0;
      const client = new GameClient("https://example.test", checkpointStore);
      client.onStateFrame(() => {
        callbackCount += 1;
      });
      await (client as any).poll();

      expect(callbackCount, scenario.label).toBe(0);
      expect(
        checkpointStore.checkpoint?.degradedReason,
        scenario.label,
      ).toContain(scenario.expected);
    }
  });

  test("fails closed on same-epoch sequence or timestamp regression", async () => {
    for (const scenario of [
      {
        seq: 4,
        emittedAt: 1_700_000_006_000,
        expected: "sequence regressed",
      },
      {
        seq: 6,
        emittedAt: 1_700_000_004_000,
        expected: "emittedAt regressed",
      },
    ]) {
      const checkpointStore = new MemoryCheckpointStore({
        sourceEpoch: 10,
        lastAppliedSeq: 5,
        lastEmittedAt: 1_700_000_005_000,
        duelId: "duel-1",
        competitiveSnapshotDigest: DEFAULT_COMPETITIVE_SNAPSHOT_DIGEST,
        phase: "FIGHTING",
        terminal: false,
        degradedReason: null,
        updatedAt: 1_700_000_005_000,
      });
      const regressed = makeCycle({
        seq: scenario.seq,
        emittedAt: scenario.emittedAt,
        phase: "FIGHTING",
      });
      globalThis.fetch = (async () =>
        jsonResponse(bettingPayload(regressed))) as unknown as typeof fetch;

      let callbackCount = 0;
      const client = new GameClient("https://example.test", checkpointStore);
      client.onDuelStart(() => {
        callbackCount += 1;
      });
      await (client as any).poll();

      expect(callbackCount).toBe(0);
      expect(checkpointStore.checkpoint?.degradedReason).toContain(
        scenario.expected,
      );
    }
  });
});
