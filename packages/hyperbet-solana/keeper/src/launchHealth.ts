import type {
  PredictionMarketLifecycleRecord,
  PredictionMarketLifecycleStatus,
  PredictionMarketWinner,
} from "./solanaLifecycle";

export interface KeeperRecoveryState {
  code: string;
  active: boolean;
  sinceMs: number | null;
  untilMs: number | null;
  details: string | null;
}

export interface KeeperMarketHealthRecord {
  chainKey: "solana";
  duelId: string | null;
  duelKey: string | null;
  marketRef: string | null;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  winner: PredictionMarketWinner;
  fairValue: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  bidUnits: number;
  askUnits: number;
  openOrderCount: number;
  inventoryYes: number;
  inventoryNo: number;
  openYes: number;
  openNo: number;
  netExposure: number;
  grossExposure: number;
  drawdownBps: number;
  quoteAgeMs: number | null;
  lastStreamAtMs: number | null;
  lastOracleAtMs: number | null;
  lastRpcAtMs: number | null;
  circuitBreakerReason: string | null;
  lastResolvedAtMs: number | null;
  lastClaimAtMs: number | null;
  recovery: string[];
}

export interface KeeperBotHealthSnapshot {
  chainKey: "solana";
  updatedAtMs: number;
  bootedAtMs: number;
  running: boolean;
  processId: number | null;
  lastSuccessfulRpcAtMs: number | null;
  recovery: KeeperRecoveryState[];
  markets: KeeperMarketHealthRecord[];
}

export interface PredictionMarketStatusRecord extends PredictionMarketLifecycleRecord {
  health: KeeperMarketHealthRecord | null;
}

export function mergePredictionMarketsWithHealth(
  records: readonly PredictionMarketLifecycleRecord[],
  botHealth: KeeperBotHealthSnapshot | null,
): PredictionMarketStatusRecord[] {
  return records.map((record) => {
    const health =
      botHealth?.markets.find(
        (candidate) =>
          (candidate.marketRef != null &&
            record.marketRef != null &&
            candidate.marketRef === record.marketRef) ||
          (candidate.duelKey != null &&
            record.duelKey != null &&
            candidate.duelKey === record.duelKey),
      ) ?? null;
    return { ...record, health };
  });
}
