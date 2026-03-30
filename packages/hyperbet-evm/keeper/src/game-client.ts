type StreamingAgent = {
  id: string;
  name: string;
};

type StreamingCycle = {
  cycleId: string;
  phase: string;
  duelId: string | null;
  duelKeyHex: string | null;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  winnerId: string | null;
  seed: string | null;
  replayHash: string | null;
  agent1: StreamingAgent | null;
  agent2: StreamingAgent | null;
};

type StreamingStateUpdate = {
  type: "STREAMING_STATE_UPDATE";
  cycle?: StreamingCycle;
};

export type DuelLifecycleEvent = {
  cycleId: string;
  duelId: string;
  duelKeyHex: string;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  phase: string;
  winnerId: string | null;
  seed: string | null;
  replayHash: string | null;
  agent1: StreamingAgent | null;
  agent2: StreamingAgent | null;
};

function normalizeLifecycleEvent(
  cycle: StreamingCycle,
): DuelLifecycleEvent | null {
  if (!cycle.duelId || !cycle.duelKeyHex) {
    return null;
  }

  return {
    cycleId: cycle.cycleId,
    duelId: cycle.duelId,
    duelKeyHex: cycle.duelKeyHex,
    betOpenTime: cycle.betOpenTime,
    betCloseTime: cycle.betCloseTime,
    fightStartTime: cycle.fightStartTime,
    duelEndTime: cycle.duelEndTime,
    phase: cycle.phase,
    winnerId: cycle.winnerId,
    seed: cycle.seed,
    replayHash: cycle.replayHash,
    agent1: cycle.agent1,
    agent2: cycle.agent2,
  };
}

export class GameClient {
  private url: string;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private onDuelStartCb:
    | ((data: DuelLifecycleEvent) => void | Promise<void>)
    | null = null;
  private onBettingLockedCb:
    | ((data: DuelLifecycleEvent) => void | Promise<void>)
    | null = null;
  private onDuelEndCb:
    | ((data: DuelLifecycleEvent) => void | Promise<void>)
    | null = null;
  private pollInFlight = false;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private pollBackoffUntil = 0;
  private consecutivePollFailures = 0;

  private lastCycleId: string | null = null;
  private lastPhase: string | null = null;
  private lastLockedCycleId: string | null = null;
  private lastResolutionEventKey: string | null = null;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "");
    const configuredTimeout = Number(process.env.GAME_STATE_POLL_TIMEOUT_MS);
    this.pollTimeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 1500;
    const configuredInterval = Number(process.env.GAME_STATE_POLL_INTERVAL_MS);
    this.pollIntervalMs =
      Number.isFinite(configuredInterval) && configuredInterval >= 1_000
        ? configuredInterval
        : 2_000;
  }

  public connect() {
    console.log(
      `[GameClient] Connected via HTTP polling to ${this.url} (interval=${this.pollIntervalMs}ms timeout=${this.pollTimeoutMs}ms)`,
    );
    this.pollInterval = setInterval(
      () => void this.poll(),
      this.pollIntervalMs,
    );
    void this.poll();
  }

  private registerPollFailure(reason: string) {
    this.consecutivePollFailures += 1;
    const backoffStep = Math.min(this.consecutivePollFailures, 5);
    const backoffMs = Math.min(30_000, this.pollIntervalMs * 2 ** backoffStep);
    this.pollBackoffUntil = Date.now() + backoffMs;

    if (
      this.consecutivePollFailures === 1 ||
      this.consecutivePollFailures % 10 === 0
    ) {
      console.warn(
        `[GameClient] streaming poll failed (${reason}); backing off ${backoffMs}ms (consecutive=${this.consecutivePollFailures})`,
      );
    }
  }

  private resetPollFailures() {
    this.consecutivePollFailures = 0;
    this.pollBackoffUntil = 0;
  }

  private isLockedPhase(phase: string | null): boolean {
    return (
      phase === "COUNTDOWN" || phase === "FIGHTING" || phase === "RESOLUTION"
    );
  }

  private resolutionEventKey(event: DuelLifecycleEvent): string {
    return [
      event.cycleId,
      event.winnerId ?? "",
      event.seed ?? "",
      event.replayHash ?? "",
    ].join(":");
  }

  private async emitDuelStart(event: DuelLifecycleEvent) {
    if (this.onDuelStartCb) {
      await this.onDuelStartCb(event);
    }
  }

  private async emitBettingLocked(event: DuelLifecycleEvent) {
    if (!this.onBettingLockedCb || this.lastLockedCycleId === event.cycleId) {
      return;
    }
    this.lastLockedCycleId = event.cycleId;
    await this.onBettingLockedCb(event);
  }

  private async emitDuelEnd(event: DuelLifecycleEvent) {
    if (!this.onDuelEndCb) {
      return;
    }
    const nextEventKey = this.resolutionEventKey(event);
    if (this.lastResolutionEventKey === nextEventKey) {
      return;
    }
    this.lastResolutionEventKey = nextEventKey;
    await this.onDuelEndCb(event);
  }

  private async poll() {
    if (Date.now() < this.pollBackoffUntil || this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.pollTimeoutMs);

    try {
      const res = await fetch(`${this.url}/api/streaming/state`, {
        cache: "no-store",
        headers: {
          connection: "close",
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // Ignore cancellation issues when the transport is already closed.
        }
        this.registerPollFailure(`HTTP ${res.status}`);
        return;
      }

      const data = (await res.json()) as StreamingStateUpdate;
      this.resetPollFailures();

      if (data?.type !== "STREAMING_STATE_UPDATE" || !data.cycle) {
        return;
      }

      const currentCycle = data.cycle;
      const currentPhase = currentCycle.phase;
      const lifecycleEvent = normalizeLifecycleEvent(currentCycle);

      if (currentCycle.cycleId !== this.lastCycleId) {
        this.lastCycleId = currentCycle.cycleId;
        this.lastPhase = currentPhase;
        this.lastLockedCycleId = null;
        this.lastResolutionEventKey = null;

        if (lifecycleEvent) {
          await this.emitDuelStart(lifecycleEvent);
          if (this.isLockedPhase(currentPhase)) {
            await this.emitBettingLocked(lifecycleEvent);
          }
          if (currentPhase === "RESOLUTION") {
            await this.emitDuelEnd(lifecycleEvent);
          }
        }

        return;
      }

      const transitionedToLocked =
        lifecycleEvent &&
        this.isLockedPhase(currentPhase) &&
        !this.isLockedPhase(this.lastPhase);
      if (transitionedToLocked) {
        await this.emitBettingLocked(lifecycleEvent);
      }

      if (lifecycleEvent && currentPhase === "RESOLUTION") {
        await this.emitDuelEnd(lifecycleEvent);
      }

      this.lastPhase = currentPhase;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? `timeout after ${this.pollTimeoutMs}ms`
            : err.message
          : "request failed";
      this.registerPollFailure(message);
    } finally {
      clearTimeout(timeoutId);
      this.pollInFlight = false;
    }
  }

  public onDuelStart(
    callback: (data: DuelLifecycleEvent) => void | Promise<void>,
  ) {
    this.onDuelStartCb = callback;
  }

  public onBettingLocked(
    callback: (data: DuelLifecycleEvent) => void | Promise<void>,
  ) {
    this.onBettingLockedCb = callback;
  }

  public onDuelEnd(
    callback: (data: DuelLifecycleEvent) => void | Promise<void>,
  ) {
    this.onDuelEndCb = callback;
  }

  public disconnect() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
