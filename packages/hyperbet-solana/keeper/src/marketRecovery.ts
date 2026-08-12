import { PublicKey } from "@solana/web3.js";

import {
  DUEL_WINNER_MARKET_KIND,
  findClobVaultPda,
  findDuelStatePda,
  findMarketPda,
  findOrderPda,
} from "./launchCommon";

type AccountRecord = Record<string, unknown>;

export type ProgramAccountSnapshot = {
  publicKey: PublicKey;
  account: AccountRecord;
};

export type RecoveredManagedOrder = {
  orderId: number;
  side: number;
  price: number;
  amountLamports: number;
  placedAtMs: number;
};

export type RecoveredDuelMarket = {
  duelId: string;
  duelKeyHex: string;
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
  oracleStatus:
    | "scheduled"
    | "bettingOpen"
    | "locked"
    | "proposed"
    | "challenged"
    | "resolved"
    | "cancelled";
  marketStatus: "open" | "locked" | "resolved" | "cancelled";
  winner: "A" | "B" | "NONE";
  createdAtMs: number;
  managedOrders: RecoveredManagedOrder[];
};

export type MarketRecoveryIssue = {
  code:
    | "invalid-duel-account"
    | "invalid-market-account"
    | "invalid-managed-order"
    | "missing-market"
    | "market-status-drift";
  duelRef: string | null;
  marketRef: string | null;
  details: string;
};

export type DuelMarketRecoveryResult = {
  markets: RecoveredDuelMarket[];
  issues: MarketRecoveryIssue[];
};

export type DuelMarketRecoveryInput = {
  fightProgramId: PublicKey;
  marketProgramId: PublicKey;
  duelAccounts: ProgramAccountSnapshot[];
  marketAccounts: ProgramAccountSnapshot[];
  orderAccounts: ProgramAccountSnapshot[];
  allowedMarketAuthorities: PublicKey[];
  marketMaker: PublicKey;
  expectedFees: {
    tradeTreasuryFeeBps: number;
    tradeMarketMakerFeeBps: number;
    winningsMarketMakerFeeBps: number;
  };
  observedAt?: number;
};

export type ManagedOrderClosurePlan = {
  instruction: "cancel" | "reclaim";
  adjacentOrderIds: number[];
};

export function planManagedOrderClosure(input: {
  marketIsOpen: boolean;
  orderId: number;
  previousOrderId: number;
  nextOrderId: number;
  continuationPending: boolean;
}): ManagedOrderClosurePlan {
  for (const [label, value] of [
    ["order", input.orderId],
    ["previous order", input.previousOrderId],
    ["next order", input.nextOrderId],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} id is not a non-negative safe integer`);
    }
  }
  if (input.orderId < 1) {
    throw new Error("order id must be positive");
  }
  if (input.continuationPending) {
    if (input.previousOrderId !== 0 || input.nextOrderId !== 0) {
      throw new Error("continuation-pending order has unexpected book links");
    }
    return {
      instruction: input.marketIsOpen ? "cancel" : "reclaim",
      adjacentOrderIds: [],
    };
  }

  const adjacentOrderIds = [input.previousOrderId, input.nextOrderId].filter(
    (orderId) => orderId > 0,
  );
  if (
    adjacentOrderIds.includes(input.orderId) ||
    new Set(adjacentOrderIds).size !== adjacentOrderIds.length
  ) {
    throw new Error("resting order has invalid adjacent book links");
  }
  return {
    instruction: input.marketIsOpen ? "cancel" : "reclaim",
    adjacentOrderIds,
  };
}

type ValidDuel = {
  publicKey: PublicKey;
  duelKeyHex: string;
  duelId: string | null;
  status: RecoveredDuelMarket["oracleStatus"];
  winner: RecoveredDuelMarket["winner"];
  createdAtMs: number;
};

function asSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const converted = Number((value as { toString(): string }).toString());
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}

function asPublicKey(value: unknown): PublicKey | null {
  try {
    if (value instanceof PublicKey) return value;
    if (typeof value === "string") return new PublicKey(value);
    if (value && typeof value === "object" && "toBase58" in value) {
      return new PublicKey((value as { toBase58(): string }).toBase58());
    }
  } catch {
    return null;
  }
  return null;
}

function bytes32Hex(value: unknown): string | null {
  const bytes =
    value instanceof Uint8Array
      ? Array.from(value)
      : Array.isArray(value)
        ? value.map(Number)
        : null;
  if (
    !bytes ||
    bytes.length !== 32 ||
    bytes.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)
  ) {
    return null;
  }
  return Buffer.from(bytes).toString("hex");
}

function enumKey(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value as AccountRecord);
  return keys.length === 1 ? (keys[0] ?? null) : null;
}

function oracleStatus(
  value: unknown,
): RecoveredDuelMarket["oracleStatus"] | null {
  const key = enumKey(value);
  return key === "scheduled" ||
    key === "bettingOpen" ||
    key === "locked" ||
    key === "proposed" ||
    key === "challenged" ||
    key === "resolved" ||
    key === "cancelled"
    ? key
    : null;
}

function marketStatus(
  value: unknown,
): RecoveredDuelMarket["marketStatus"] | null {
  const key = enumKey(value);
  return key === "open" ||
    key === "locked" ||
    key === "resolved" ||
    key === "cancelled"
    ? key
    : null;
}

function winner(value: unknown): RecoveredDuelMarket["winner"] | null {
  const key = enumKey(value);
  if (key === "a") return "A";
  if (key === "b") return "B";
  if (key === "none") return "NONE";
  return null;
}

function duelIdFromMetadata(
  metadata: unknown,
  duelKeyHex: string,
): string | null {
  if (typeof metadata !== "string" || !metadata.trim()) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const duelId =
      typeof parsed.duelId === "string"
        ? parsed.duelId.trim()
        : parsed.v === 1 && typeof parsed.d === "string"
          ? parsed.d.trim()
          : "";
    let metadataKey: string | null = null;
    if (typeof parsed.duelKeyHex === "string") {
      metadataKey = parsed.duelKeyHex.trim().replace(/^0x/i, "").toLowerCase();
    } else if (
      parsed.v === 1 &&
      typeof parsed.k === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(parsed.k)
    ) {
      const keyBytes = Buffer.from(parsed.k, "base64url");
      if (
        keyBytes.length === 32 &&
        keyBytes.toString("base64url") === parsed.k
      ) {
        metadataKey = keyBytes.toString("hex");
      }
    }
    if (!duelId || metadataKey !== duelKeyHex) return null;
    return duelId;
  } catch {
    return null;
  }
}

function expectedMarketStatus(
  status: RecoveredDuelMarket["oracleStatus"],
): RecoveredDuelMarket["marketStatus"] | null {
  if (status === "bettingOpen") return "open";
  if (status === "locked" || status === "proposed" || status === "challenged") {
    return "locked";
  }
  if (status === "resolved") return "resolved";
  if (status === "cancelled") return "cancelled";
  return null;
}

function issue(
  issues: MarketRecoveryIssue[],
  value: MarketRecoveryIssue,
): void {
  issues.push(value);
}

export function discoverDuelMarketRecovery(
  input: DuelMarketRecoveryInput,
): DuelMarketRecoveryResult {
  const observedAt = input.observedAt ?? Date.now();
  const issues: MarketRecoveryIssue[] = [];
  const validDuels = new Map<string, ValidDuel>();

  for (const snapshot of input.duelAccounts) {
    const duelRef = snapshot.publicKey.toBase58();
    const duelKeyHex = bytes32Hex(snapshot.account.duelKey);
    const status = oracleStatus(snapshot.account.status);
    const duelWinner = winner(snapshot.account.winner);
    const betOpenTs = asSafeInteger(snapshot.account.betOpenTs);
    const betOpenMs = betOpenTs === null ? null : betOpenTs * 1_000;
    const winnerMatchesStatus =
      duelWinner !== null &&
      (status === "resolved" ? duelWinner !== "NONE" : duelWinner === "NONE");
    if (
      !duelKeyHex ||
      !status ||
      !winnerMatchesStatus ||
      betOpenTs === null ||
      betOpenTs <= 0 ||
      !Number.isSafeInteger(betOpenMs)
    ) {
      issue(issues, {
        code: "invalid-duel-account",
        duelRef,
        marketRef: null,
        details:
          "duel account has invalid key, lifecycle, winner, or timestamp",
      });
      continue;
    }
    const expectedDuel = findDuelStatePda(
      input.fightProgramId,
      Buffer.from(duelKeyHex, "hex"),
    );
    if (!expectedDuel.equals(snapshot.publicKey)) {
      issue(issues, {
        code: "invalid-duel-account",
        duelRef,
        marketRef: null,
        details: "duel account does not match its canonical PDA",
      });
      continue;
    }
    validDuels.set(duelRef, {
      publicKey: snapshot.publicKey,
      duelKeyHex,
      duelId: duelIdFromMetadata(snapshot.account.metadataUri, duelKeyHex),
      status,
      winner: duelWinner,
      createdAtMs: betOpenTs * 1_000,
    });
  }

  const recoveredByMarket = new Map<string, RecoveredDuelMarket>();
  const recoveredDuelRefs = new Set<string>();
  const recoveredDuelIds = new Set<string>();

  for (const snapshot of input.marketAccounts) {
    const marketRef = snapshot.publicKey.toBase58();
    const duelState = asPublicKey(snapshot.account.duelState);
    const duelRef = duelState?.toBase58() ?? null;
    const duel = duelRef ? validDuels.get(duelRef) : null;
    const keyHex = bytes32Hex(snapshot.account.duelKey);
    const kind = asSafeInteger(snapshot.account.marketKind);
    const status = marketStatus(snapshot.account.status);
    const authority = asPublicKey(snapshot.account.authority);
    const marketMaker = asPublicKey(snapshot.account.marketMaker);
    const recoveredWinner = winner(snapshot.account.winner);
    const duelId = duel?.duelId ?? null;
    const expectedMarket = duelState
      ? findMarketPda(input.marketProgramId, duelState, DUEL_WINNER_MARKET_KIND)
      : null;
    const feesMatch =
      asSafeInteger(snapshot.account.tradeTreasuryFeeBpsSnapshot) ===
        input.expectedFees.tradeTreasuryFeeBps &&
      asSafeInteger(snapshot.account.tradeMarketMakerFeeBpsSnapshot) ===
        input.expectedFees.tradeMarketMakerFeeBps &&
      asSafeInteger(snapshot.account.winningsMarketMakerFeeBpsSnapshot) ===
        input.expectedFees.winningsMarketMakerFeeBps;
    const authorityAllowed =
      authority !== null &&
      input.allowedMarketAuthorities.some((allowed) =>
        allowed.equals(authority),
      );
    const marketWinnerMatches =
      recoveredWinner !== null &&
      (status === "resolved"
        ? recoveredWinner === duel?.winner && recoveredWinner !== "NONE"
        : recoveredWinner === "NONE");

    if (
      !duelState ||
      !duel ||
      !keyHex ||
      keyHex !== duel.duelKeyHex ||
      kind !== DUEL_WINNER_MARKET_KIND ||
      !status ||
      !marketWinnerMatches ||
      !expectedMarket?.equals(snapshot.publicKey) ||
      !authorityAllowed ||
      !marketMaker?.equals(input.marketMaker) ||
      !feesMatch ||
      !duelId ||
      recoveredDuelIds.has(duelId)
    ) {
      issue(issues, {
        code: "invalid-market-account",
        duelRef,
        marketRef,
        details: [
          !duel ? "missing canonical duel" : null,
          keyHex !== duel?.duelKeyHex ? "duel key mismatch" : null,
          kind !== DUEL_WINNER_MARKET_KIND ? "market kind mismatch" : null,
          !status ? "invalid market status" : null,
          !marketWinnerMatches ? "market winner mismatch" : null,
          !expectedMarket?.equals(snapshot.publicKey)
            ? "market PDA mismatch"
            : null,
          !authorityAllowed ? "market authority mismatch" : null,
          !marketMaker?.equals(input.marketMaker)
            ? "market maker mismatch"
            : null,
          !feesMatch ? "fee snapshot mismatch" : null,
          !duelId ? "missing canonical duelId metadata" : null,
          duelId && recoveredDuelIds.has(duelId) ? "duplicate duelId" : null,
        ]
          .filter((entry): entry is string => Boolean(entry))
          .join(", "),
      });
      continue;
    }

    const expectedStatus = expectedMarketStatus(duel.status);
    if (expectedStatus && expectedStatus !== status) {
      issue(issues, {
        code: "market-status-drift",
        duelRef,
        marketRef,
        details: `oracle is ${duel.status} while market is ${status}`,
      });
    }

    const recovered: RecoveredDuelMarket = {
      duelId,
      duelKeyHex: duel.duelKeyHex,
      duelState,
      marketState: snapshot.publicKey,
      vault: findClobVaultPda(input.marketProgramId, snapshot.publicKey),
      oracleStatus: duel.status,
      marketStatus: status,
      winner: duel.winner,
      createdAtMs: duel.createdAtMs,
      managedOrders: [],
    };
    recoveredByMarket.set(marketRef, recovered);
    recoveredDuelRefs.add(duel.publicKey.toBase58());
    recoveredDuelIds.add(duelId);
  }

  for (const snapshot of input.orderAccounts) {
    if (snapshot.account.active !== true) continue;
    const marketState = asPublicKey(snapshot.account.marketState);
    const maker = asPublicKey(snapshot.account.maker);
    const marketRef = marketState?.toBase58() ?? null;
    const recovered = marketRef ? recoveredByMarket.get(marketRef) : null;
    const orderId = asSafeInteger(snapshot.account.id);
    const side = asSafeInteger(snapshot.account.side);
    const price = asSafeInteger(snapshot.account.price);
    const amount = asSafeInteger(snapshot.account.amount);
    const filled = asSafeInteger(snapshot.account.filled);
    const expectedOrder =
      marketState && orderId !== null && orderId >= 0
        ? findOrderPda(input.marketProgramId, marketState, BigInt(orderId))
        : null;
    if (
      !recovered ||
      !maker?.equals(input.marketMaker) ||
      orderId === null ||
      orderId < 1 ||
      (side !== 1 && side !== 2) ||
      price === null ||
      price < 1 ||
      price > 999 ||
      amount === null ||
      amount <= 0 ||
      filled === null ||
      filled < 0 ||
      filled >= amount ||
      amount % 1_000 !== 0 ||
      recovered.managedOrders.some((order) => order.orderId === orderId) ||
      !expectedOrder?.equals(snapshot.publicKey)
    ) {
      issue(issues, {
        code: "invalid-managed-order",
        duelRef: recovered?.duelState.toBase58() ?? null,
        marketRef,
        details:
          "active market-maker order failed identity or amount validation",
      });
      continue;
    }
    recovered.managedOrders.push({
      orderId,
      side,
      price,
      amountLamports: amount - filled,
      placedAtMs: observedAt,
    });
  }

  for (const [duelRef, duel] of validDuels) {
    if (duel.status !== "scheduled" && !recoveredDuelRefs.has(duelRef)) {
      issue(issues, {
        code: "missing-market",
        duelRef,
        marketRef: null,
        details: `canonical duel ${duel.duelId ?? duel.duelKeyHex} has status ${duel.status} but no valid market`,
      });
    }
  }

  for (const recovered of recoveredByMarket.values()) {
    recovered.managedOrders.sort((left, right) => left.orderId - right.orderId);
  }

  return {
    markets: [...recoveredByMarket.values()].sort((left, right) =>
      left.duelId.localeCompare(right.duelId),
    ),
    issues: issues.sort((left, right) =>
      `${left.code}:${left.duelRef ?? ""}:${left.marketRef ?? ""}`.localeCompare(
        `${right.code}:${right.duelRef ?? ""}:${right.marketRef ?? ""}`,
      ),
    ),
  };
}
