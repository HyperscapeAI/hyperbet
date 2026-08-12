import { useCallback, useEffect, useState } from "react";

import { GAME_API_URL } from "./solanaConfig";

export type SolanaBetOrderState =
  | "PENDING_INDEX"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CLOSED_PARTIAL"
  | "RELEASED"
  | "RECLAIM_REQUIRED";

export type SolanaBetSettlementState =
  | "NOT_READY"
  | "AWAITING_RESULT"
  | "PAYOUT_CLAIMABLE"
  | "REFUND_CLAIMABLE"
  | "PAID"
  | "REFUNDED"
  | "LOST"
  | "NO_ENTITLEMENT";

export type SolanaSettlementHistoryEntry = {
  betId: string;
  wallet: string;
  marketPda: string;
  duelKey: string | null;
  duelId: string | null;
  placeSignature: string;
  recordedAt: number;
  orderId: string;
  side: 1 | 2;
  limitPrice: number;
  orderAmountUnits: string;
  matchedAmountUnits: string;
  restingAmountUnits: string;
  releasedAmountUnits: string;
  sourceAmountLamports: string;
  collateralLamports: string;
  executedCostLamports: string;
  tradeFeeLamports: string;
  orderRefundLamports: string;
  rewardEligibleLamports: string;
  marketStatus: "open" | "locked" | "resolved" | "cancelled" | null;
  winner: "none" | "a" | "b" | null;
  orderState: SolanaBetOrderState;
  settlementState: SolanaBetSettlementState;
  claimSignature: string | null;
  terminalGrossLamports: string;
  terminalPayoutLamports: string;
  terminalFeeLamports: string;
  reconciledAt: number | null;
  settledAt: number | null;
};

export type SolanaSettlementLedgerStatus = {
  current: boolean;
  lastIndexedAt: number | null;
  degradedReason: string | null;
};

export type SolanaSettlementHistoryResponse = {
  schemaVersion: 1;
  chain: "SOLANA";
  asset: "SOL";
  decimals: 9;
  wallet: string;
  entries: SolanaSettlementHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
  ledger: SolanaSettlementLedgerStatus;
  updatedAt: number;
};

const ORDER_STATES = new Set<SolanaBetOrderState>([
  "PENDING_INDEX",
  "OPEN",
  "PARTIALLY_FILLED",
  "FILLED",
  "CLOSED_PARTIAL",
  "RELEASED",
  "RECLAIM_REQUIRED",
]);
const SETTLEMENT_STATES = new Set<SolanaBetSettlementState>([
  "NOT_READY",
  "AWAITING_RESULT",
  "PAYOUT_CLAIMABLE",
  "REFUND_CLAIMABLE",
  "PAID",
  "REFUNDED",
  "LOST",
  "NO_ENTITLEMENT",
]);
const MARKET_STATES = new Set(["open", "locked", "resolved", "cancelled"]);
const WINNERS = new Set(["none", "a", "b"]);
const POLL_INTERVAL_MS = 5_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() === value && value
    ? value
    : null;
}

function optionalString(value: unknown): string | null {
  return value === null ? null : nonEmptyString(value);
}

function unsignedString(value: unknown): string | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  return value;
}

function safeInteger(value: unknown, minimum = 0): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum
    ? Number(value)
    : null;
}

function optionalTimestamp(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = safeInteger(value);
  return parsed === null ? undefined : parsed;
}

function parseEntry(value: unknown): SolanaSettlementHistoryEntry | null {
  const entry = asRecord(value);
  if (!entry) return null;
  const strings = {
    betId: nonEmptyString(entry.betId),
    wallet: nonEmptyString(entry.wallet),
    marketPda: nonEmptyString(entry.marketPda),
    placeSignature: nonEmptyString(entry.placeSignature),
    orderId: unsignedString(entry.orderId),
    orderAmountUnits: unsignedString(entry.orderAmountUnits),
    matchedAmountUnits: unsignedString(entry.matchedAmountUnits),
    restingAmountUnits: unsignedString(entry.restingAmountUnits),
    releasedAmountUnits: unsignedString(entry.releasedAmountUnits),
    sourceAmountLamports: unsignedString(entry.sourceAmountLamports),
    collateralLamports: unsignedString(entry.collateralLamports),
    executedCostLamports: unsignedString(entry.executedCostLamports),
    tradeFeeLamports: unsignedString(entry.tradeFeeLamports),
    orderRefundLamports: unsignedString(entry.orderRefundLamports),
    rewardEligibleLamports: unsignedString(entry.rewardEligibleLamports),
    terminalGrossLamports: unsignedString(entry.terminalGrossLamports),
    terminalPayoutLamports: unsignedString(entry.terminalPayoutLamports),
    terminalFeeLamports: unsignedString(entry.terminalFeeLamports),
  };
  if (Object.values(strings).some((item) => item === null)) return null;
  const side = entry.side === 1 || entry.side === 2 ? entry.side : null;
  const limitPrice = safeInteger(entry.limitPrice, 1);
  const recordedAt = safeInteger(entry.recordedAt);
  const reconciledAt = optionalTimestamp(entry.reconciledAt);
  const settledAt = optionalTimestamp(entry.settledAt);
  const orderState = ORDER_STATES.has(entry.orderState as SolanaBetOrderState)
    ? (entry.orderState as SolanaBetOrderState)
    : null;
  const settlementState = SETTLEMENT_STATES.has(
    entry.settlementState as SolanaBetSettlementState,
  )
    ? (entry.settlementState as SolanaBetSettlementState)
    : null;
  const marketStatus =
    entry.marketStatus === null
      ? null
      : MARKET_STATES.has(String(entry.marketStatus))
        ? (entry.marketStatus as SolanaSettlementHistoryEntry["marketStatus"])
        : undefined;
  const winner =
    entry.winner === null
      ? null
      : WINNERS.has(String(entry.winner))
        ? (entry.winner as SolanaSettlementHistoryEntry["winner"])
        : undefined;
  const claimSignature = optionalString(entry.claimSignature);
  const duelKey = optionalString(entry.duelKey);
  const duelId = optionalString(entry.duelId);
  if (
    side === null ||
    limitPrice === null ||
    limitPrice >= 1_000 ||
    recordedAt === null ||
    reconciledAt === undefined ||
    settledAt === undefined ||
    !orderState ||
    !settlementState ||
    marketStatus === undefined ||
    winner === undefined ||
    (entry.claimSignature !== null && claimSignature === null) ||
    (entry.duelKey !== null && duelKey === null) ||
    (entry.duelId !== null && duelId === null)
  ) {
    return null;
  }
  const orderAmount = BigInt(strings.orderAmountUnits!);
  const matched = BigInt(strings.matchedAmountUnits!);
  const resting = BigInt(strings.restingAmountUnits!);
  const released = BigInt(strings.releasedAmountUnits!);
  const executed = BigInt(strings.executedCostLamports!);
  const tradeFee = BigInt(strings.tradeFeeLamports!);
  const rewardEligible = BigInt(strings.rewardEligibleLamports!);
  const terminalGross = BigInt(strings.terminalGrossLamports!);
  const terminalPayout = BigInt(strings.terminalPayoutLamports!);
  const terminalFee = BigInt(strings.terminalFeeLamports!);
  if (
    orderAmount <= 0n ||
    matched + resting + released !== orderAmount ||
    executed + tradeFee !== rewardEligible ||
    terminalPayout + terminalFee !== terminalGross ||
    (orderState === "PENDING_INDEX") !== (reconciledAt === null) ||
    (["PAID", "REFUNDED"].includes(settlementState) && !claimSignature) ||
    (claimSignature !== null && settledAt === null)
  ) {
    return null;
  }
  return {
    betId: strings.betId!,
    wallet: strings.wallet!,
    marketPda: strings.marketPda!,
    duelKey,
    duelId,
    placeSignature: strings.placeSignature!,
    recordedAt,
    orderId: strings.orderId!,
    side,
    limitPrice,
    orderAmountUnits: strings.orderAmountUnits!,
    matchedAmountUnits: strings.matchedAmountUnits!,
    restingAmountUnits: strings.restingAmountUnits!,
    releasedAmountUnits: strings.releasedAmountUnits!,
    sourceAmountLamports: strings.sourceAmountLamports!,
    collateralLamports: strings.collateralLamports!,
    executedCostLamports: strings.executedCostLamports!,
    tradeFeeLamports: strings.tradeFeeLamports!,
    orderRefundLamports: strings.orderRefundLamports!,
    rewardEligibleLamports: strings.rewardEligibleLamports!,
    marketStatus,
    winner,
    orderState,
    settlementState,
    claimSignature,
    terminalGrossLamports: strings.terminalGrossLamports!,
    terminalPayoutLamports: strings.terminalPayoutLamports!,
    terminalFeeLamports: strings.terminalFeeLamports!,
    reconciledAt,
    settledAt,
  };
}

export function parseSolanaSettlementHistoryResponse(
  payload: unknown,
): SolanaSettlementHistoryResponse | null {
  const response = asRecord(payload);
  const ledger = asRecord(response?.ledger);
  if (
    !response ||
    !ledger ||
    response.schemaVersion !== 1 ||
    response.chain !== "SOLANA" ||
    response.asset !== "SOL" ||
    response.decimals !== 9 ||
    !Array.isArray(response.entries)
  ) {
    return null;
  }
  const wallet = nonEmptyString(response.wallet);
  const total = safeInteger(response.total);
  const limit = safeInteger(response.limit, 1);
  const offset = safeInteger(response.offset);
  const updatedAt = safeInteger(response.updatedAt);
  const lastIndexedAt = optionalTimestamp(ledger.lastIndexedAt);
  const degradedReason = optionalString(ledger.degradedReason);
  const entries = response.entries.map(parseEntry);
  if (
    !wallet ||
    typeof ledger.current !== "boolean" ||
    total === null ||
    limit === null ||
    limit > 100 ||
    offset === null ||
    updatedAt === null ||
    lastIndexedAt === undefined ||
    (ledger.degradedReason !== null && degradedReason === null) ||
    entries.some((entry) => entry === null) ||
    entries.length > limit ||
    total < entries.length
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    chain: "SOLANA",
    asset: "SOL",
    decimals: 9,
    wallet,
    entries: entries as SolanaSettlementHistoryEntry[],
    total,
    limit,
    offset,
    ledger: {
      current: ledger.current === true,
      lastIndexedAt,
      degradedReason,
    },
    updatedAt,
  };
}

export async function fetchSolanaSettlementHistory(input: {
  wallet: string;
  marketPda?: string | null;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<SolanaSettlementHistoryResponse> {
  const base = GAME_API_URL.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (input.marketPda) params.set("marketPda", input.marketPda);
  params.set("limit", String(input.limit ?? 5));
  params.set("offset", String(input.offset ?? 0));
  const endpoint = `${base}/api/arena/settlements/${encodeURIComponent(
    input.wallet,
  )}?${params.toString()}`;
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`settlement history request failed (${response.status})`);
  }
  const parsed = parseSolanaSettlementHistoryResponse(await response.json());
  if (!parsed || parsed.wallet !== input.wallet) {
    throw new Error("settlement history response was invalid");
  }
  return parsed;
}

export function useSolanaSettlementHistory(input: {
  wallet: string | null;
  marketPda?: string | null;
  limit?: number;
}): {
  history: SolanaSettlementHistoryResponse | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
} {
  const pageSize = Math.min(100, Math.max(1, input.limit ?? 5));
  const requestKey = `${input.wallet ?? ""}:${input.marketPda ?? ""}:${pageSize}`;
  const [historyState, setHistoryState] = useState<{
    key: string;
    history: SolanaSettlementHistoryResponse;
  } | null>(null);
  const history =
    historyState?.key === requestKey ? historyState.history : null;
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [requestedCountState, setRequestedCountState] = useState({
    key: requestKey,
    count: pageSize,
  });
  const requestedCount =
    requestedCountState.key === requestKey
      ? requestedCountState.count
      : pageSize;
  const refresh = useCallback(
    () => setRefreshVersion((value) => value + 1),
    [],
  );
  const loadMore = useCallback(() => {
    setRequestedCountState((current) => ({
      key: requestKey,
      count:
        current.key === requestKey ? current.count + pageSize : pageSize * 2,
    }));
  }, [pageSize, requestKey]);

  useEffect(() => {
    if (!input.wallet) {
      setHistoryState(null);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return undefined;
    }
    let active = true;
    let controller: AbortController | null = null;
    let firstPoll = true;
    const poll = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      if (firstPoll) {
        setLoading(true);
        setLoadingMore(true);
      }
      try {
        const pages: SolanaSettlementHistoryResponse[] = [];
        let offset = 0;
        while (offset < requestedCount) {
          const next = await fetchSolanaSettlementHistory({
            wallet: input.wallet!,
            marketPda: input.marketPda,
            limit: Math.min(100, requestedCount - offset),
            offset,
            signal: requestController.signal,
          });
          pages.push(next);
          offset += next.entries.length;
          if (next.entries.length === 0 || offset >= next.total) break;
        }
        if (!active) return;
        const first = pages[0];
        if (!first) throw new Error("Settlement history returned no page");
        const entries = pages
          .flatMap((page) => page.entries)
          .filter(
            (entry, index, all) =>
              all.findIndex((candidate) => candidate.betId === entry.betId) ===
              index,
          );
        setHistoryState({
          key: requestKey,
          history: {
            ...first,
            entries,
            limit: requestedCount,
            offset: 0,
          },
        });
        setError(null);
      } catch (caught) {
        if (!active || requestController.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Settlement history failed",
        );
      } finally {
        if (active && firstPoll) {
          setLoading(false);
          setLoadingMore(false);
        }
        firstPoll = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [
    input.marketPda,
    input.wallet,
    refreshVersion,
    requestKey,
    requestedCount,
  ]);

  return {
    history,
    loading,
    loadingMore,
    hasMore: history !== null && history.entries.length < history.total,
    error,
    refresh,
    loadMore,
  };
}
