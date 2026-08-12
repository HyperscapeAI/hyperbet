import type { KeeperBotHealthSnapshot } from "./launchHealth";

export type ReadinessParserState = {
  enabled: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
};

export type KeeperReadinessInput = {
  nowMs: number;
  requireStreamSource: boolean;
  streamMaxAgeMs: number;
  botMaxAgeMs: number;
  parserMaxAgeMs: number;
  stream: {
    sourceConfigured: boolean;
    authoritative: boolean;
    lastUpdatedAt: number | null;
    lastSourceError: string | null;
  };
  bot: KeeperBotHealthSnapshot | null;
  parser: ReadinessParserState;
  database: {
    ok: boolean;
    error: string | null;
  };
};

export type KeeperReadinessResult = {
  ready: boolean;
  reasons: string[];
  agesMs: {
    stream: number | null;
    bot: number | null;
    botRpc: number | null;
    parser: number | null;
  };
};

/**
 * A freshly polled IDLE frame is authoritative even though it intentionally
 * has no cycle id. This lets the SOL runtime prove source synchronization
 * before the first market opens, while still rejecting the local boot
 * placeholder and malformed active-cycle identities.
 */
export function isAuthoritativeStreamSnapshot(
  cycleId: unknown,
  phase: unknown,
): boolean {
  if (cycleId === "boot-cycle") return false;
  if (phase === "IDLE") {
    return cycleId === null || cycleId === "";
  }
  return (
    typeof cycleId === "string" &&
    cycleId.trim().length > 0 &&
    cycleId !== "boot-cycle"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseKeeperBotHealthSnapshot(
  value: unknown,
): KeeperBotHealthSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.chainKey !== "solana" ||
    typeof value.updatedAtMs !== "number" ||
    !Number.isFinite(value.updatedAtMs) ||
    typeof value.bootedAtMs !== "number" ||
    !Number.isFinite(value.bootedAtMs) ||
    typeof value.running !== "boolean" ||
    !Array.isArray(value.recovery) ||
    !Array.isArray(value.markets)
  ) {
    return null;
  }
  if (
    !value.recovery.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.code === "string" &&
        typeof entry.active === "boolean",
    )
  ) {
    return null;
  }
  if (
    !value.markets.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.lifecycleStatus === "string" &&
        (entry.circuitBreakerReason === null ||
          typeof entry.circuitBreakerReason === "string") &&
        Array.isArray(entry.recovery) &&
        entry.recovery.every((reason) => typeof reason === "string"),
    )
  ) {
    return null;
  }
  return value as unknown as KeeperBotHealthSnapshot;
}

function ageMs(nowMs: number, timestamp: number | null): number | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  return Math.max(0, nowMs - timestamp);
}

export function evaluateKeeperReadiness(
  input: KeeperReadinessInput,
): KeeperReadinessResult {
  const reasons = new Set<string>();
  const streamAge = ageMs(input.nowMs, input.stream.lastUpdatedAt);
  const botAge = ageMs(input.nowMs, input.bot?.updatedAtMs ?? null);
  const botRpcAge = ageMs(
    input.nowMs,
    input.bot?.lastSuccessfulRpcAtMs ?? null,
  );
  const parserAge = ageMs(input.nowMs, input.parser.lastSuccessAt);

  if (input.requireStreamSource && !input.stream.sourceConfigured) {
    reasons.add("stream-source-missing");
  }
  if (!input.stream.authoritative) reasons.add("stream-state-unverified");
  if (streamAge == null || streamAge > input.streamMaxAgeMs) {
    reasons.add("stream-state-stale");
  }
  if (input.stream.lastSourceError) reasons.add("stream-source-error");

  if (!input.bot) {
    reasons.add("bot-health-missing");
  } else {
    if (!input.bot.running) reasons.add("bot-not-running");
    if (botAge == null || botAge > input.botMaxAgeMs) {
      reasons.add("bot-health-stale");
    }
    if (botRpcAge == null || botRpcAge > input.botMaxAgeMs) {
      reasons.add("bot-rpc-stale");
    }
    for (const recovery of input.bot.recovery) {
      if (recovery.active) reasons.add(`bot-recovery:${recovery.code}`);
    }
    for (const market of input.bot.markets) {
      const isTerminalMarket =
        market.lifecycleStatus === "RESOLVED" ||
        market.lifecycleStatus === "CANCELLED";
      if (market.circuitBreakerReason && !isTerminalMarket) {
        reasons.add("market-circuit-breaker");
      }
      if (market.lifecycleStatus === "CHALLENGED") {
        reasons.add("market-result-challenged");
      }
      if (market.recovery.length > 0) reasons.add("market-recovery-active");
    }
  }

  if (!input.parser.enabled) reasons.add("solana-parser-disabled");
  if (input.parser.lastError) reasons.add("solana-parser-error");
  if (parserAge == null || parserAge > input.parserMaxAgeMs) {
    reasons.add("solana-parser-stale");
  }
  if (!input.database.ok) reasons.add("database-unhealthy");

  return {
    ready: reasons.size === 0,
    reasons: [...reasons],
    agesMs: {
      stream: streamAge,
      bot: botAge,
      botRpc: botRpcAge,
      parser: parserAge,
    },
  };
}
