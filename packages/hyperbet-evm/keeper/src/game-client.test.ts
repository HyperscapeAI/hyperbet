import { afterEach, describe, expect, test } from "bun:test";

import { GameClient } from "./game-client";

type FetchCycle = {
  cycleId?: string;
  phase?: string;
  duelId?: string | null;
  duelKeyHex?: string | null;
  betOpenTime?: number | null;
  betCloseTime?: number | null;
  fightStartTime?: number | null;
  duelEndTime?: number | null;
  winnerId?: string | null;
  seed?: string | null;
  replayHash?: string | null;
};

const originalFetch = globalThis.fetch;

function makeCycle(overrides: FetchCycle): FetchCycle {
  const base: FetchCycle = {
    cycleId: "cycle-1",
    phase: "BETTING",
    duelId: "duel-1",
    duelKeyHex: "11".repeat(32),
    betOpenTime: 1_000,
    betCloseTime: 1_060,
    fightStartTime: 1_120,
    duelEndTime: 1_180,
    winnerId: null,
    seed: null,
    replayHash: null,
  };
  return { ...base, ...overrides };
}

function mockFetchSequence(cycles: FetchCycle[]) {
  let index = 0;
  globalThis.fetch = (async () => {
    const cycle = cycles[Math.min(index, cycles.length - 1)];
    index += 1;
    return {
      ok: true,
      json: async () => ({
        type: "STREAMING_STATE_UPDATE",
        cycle,
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("GameClient lifecycle reconciliation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("replays locked and resolved callbacks when the first poll lands mid-resolution", async () => {
    mockFetchSequence([
      makeCycle({
        phase: "RESOLUTION",
        winnerId: "agent-a",
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

  test("re-emits resolution when authoritative result fields arrive after the phase flip", async () => {
    mockFetchSequence([
      makeCycle({ phase: "FIGHTING" }),
      makeCycle({ phase: "RESOLUTION" }),
      makeCycle({
        phase: "RESOLUTION",
        winnerId: "agent-a",
        seed: "42",
        replayHash: "cd".repeat(32),
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
      events.push(`end:${event.seed ?? "-"}`);
    });

    await (client as any).poll();
    await (client as any).poll();
    await (client as any).poll();

    expect(events).toEqual(["start", "lock", "end:-", "end:42"]);
  });
});
