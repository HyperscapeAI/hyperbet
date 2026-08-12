import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import { isCanonicalSolanaTransactionSignature } from "./solanaBetAccounting";

export type FinalizedSignatureReference = {
  signature: string;
  slot: number;
  blockTime: number | null;
  succeeded: boolean;
};

export type SignaturePageRequest = {
  before?: string;
  limit: number;
};

export type SignaturePageEntry = {
  signature?: unknown;
  slot?: unknown;
  blockTime?: unknown;
  err?: unknown;
  confirmationStatus?: unknown;
};

export type SolanaLifecycleFactKind =
  | "ORDER_PLACED"
  | "ORDER_MATCHED"
  | "TAKER_EXECUTION"
  | "ORDER_CANCELLED"
  | "RESTING_ORDER_RECLAIMED"
  | "FILLED_ORDER_CLOSED"
  | "PRICE_LEVEL_CLOSED"
  | "CLAIM_PAYOUT"
  | "CANCELLATION_REFUND"
  | "RESOLVED_TRADE_FEES_WITHDRAWN"
  | "LOSING_BALANCE_CLOSED"
  | "MARKET_SYNCED";

export type SolanaLifecycleFact = {
  kind: SolanaLifecycleFactKind;
  marketPda: string;
  orderId?: string;
  makerOrderId?: string;
  takerOrderId?: string;
  wallet?: string;
  treasury?: string;
  marketMaker?: string;
  submitter?: string;
  side?: 1 | 2;
  price?: number;
  orderBehavior?: 0 | 1 | 2;
  selfTradeTriggered?: boolean;
  amountUnits?: string;
  releasedAmountUnits?: string;
  amountLamports?: string;
  feeLamports?: string;
  refundLamports?: string;
  treasuryFeeLamports?: string;
  marketMakerFeeLamports?: string;
  status?: "open" | "locked" | "resolved" | "cancelled";
  winner?: "none" | "a" | "b";
};

function canonicalPublicKey(value: unknown, label: string): string {
  if (typeof value !== "string" || value !== value.trim() || !value) {
    throw new Error(`${label} must be a canonical Solana public key`);
  }
  try {
    const canonical = new PublicKey(value).toBase58();
    if (canonical !== value) {
      throw new Error(`${label} must be a canonical Solana public key`);
    }
    return canonical;
  } catch {
    throw new Error(`${label} must be a canonical Solana public key`);
  }
}

function unsignedInteger(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer string`);
  }
  return BigInt(value).toString();
}

function positiveUnits(value: unknown, label: string): string {
  const normalized = unsignedInteger(value, label);
  if (BigInt(normalized) <= 0n || BigInt(normalized) % 1_000n !== 0n) {
    throw new Error(`${label} must be a positive multiple of 1000`);
  }
  return normalized;
}

function optionalWallet(value: unknown): string | undefined {
  return value === undefined
    ? undefined
    : canonicalPublicKey(value, "lifecycle fact wallet");
}

function optionalOrderId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : unsignedInteger(value, label);
}

function assertExactFields(
  fact: SolanaLifecycleFact,
  required: Array<keyof SolanaLifecycleFact>,
  allowed: Array<keyof SolanaLifecycleFact>,
): void {
  for (const field of required) {
    if (fact[field] === undefined) {
      throw new Error(`${fact.kind} lifecycle fact is missing ${field}`);
    }
  }
  const allowedFields = new Set<keyof SolanaLifecycleFact>([
    "kind",
    "marketPda",
    ...allowed,
  ]);
  for (const field of Object.keys(fact) as Array<keyof SolanaLifecycleFact>) {
    if (fact[field] !== undefined && !allowedFields.has(field)) {
      throw new Error(`${fact.kind} lifecycle fact contains invalid ${field}`);
    }
  }
}

export function normalizeLifecycleFact(
  input: SolanaLifecycleFact,
): SolanaLifecycleFact {
  const base = {
    ...input,
    marketPda: canonicalPublicKey(input.marketPda, "lifecycle fact marketPda"),
    orderId: optionalOrderId(input.orderId, "lifecycle fact orderId"),
    makerOrderId: optionalOrderId(
      input.makerOrderId,
      "lifecycle fact makerOrderId",
    ),
    takerOrderId: optionalOrderId(
      input.takerOrderId,
      "lifecycle fact takerOrderId",
    ),
    wallet: optionalWallet(input.wallet),
    treasury:
      input.treasury === undefined
        ? undefined
        : canonicalPublicKey(input.treasury, "lifecycle fact treasury"),
    marketMaker:
      input.marketMaker === undefined
        ? undefined
        : canonicalPublicKey(input.marketMaker, "lifecycle fact marketMaker"),
    submitter:
      input.submitter === undefined
        ? undefined
        : canonicalPublicKey(input.submitter, "lifecycle fact submitter"),
    amountLamports:
      input.amountLamports === undefined
        ? undefined
        : unsignedInteger(
            input.amountLamports,
            "lifecycle fact amountLamports",
          ),
    feeLamports:
      input.feeLamports === undefined
        ? undefined
        : unsignedInteger(input.feeLamports, "lifecycle fact feeLamports"),
    refundLamports:
      input.refundLamports === undefined
        ? undefined
        : unsignedInteger(
            input.refundLamports,
            "lifecycle fact refundLamports",
          ),
    treasuryFeeLamports:
      input.treasuryFeeLamports === undefined
        ? undefined
        : unsignedInteger(
            input.treasuryFeeLamports,
            "lifecycle fact treasuryFeeLamports",
          ),
    marketMakerFeeLamports:
      input.marketMakerFeeLamports === undefined
        ? undefined
        : unsignedInteger(
            input.marketMakerFeeLamports,
            "lifecycle fact marketMakerFeeLamports",
          ),
  } satisfies SolanaLifecycleFact;

  if (base.side !== undefined && base.side !== 1 && base.side !== 2) {
    throw new Error("lifecycle fact side must be 1 or 2");
  }
  if (
    base.price !== undefined &&
    (!Number.isInteger(base.price) || base.price <= 0 || base.price >= 1_000)
  ) {
    throw new Error("lifecycle fact price must be an integer from 1 to 999");
  }

  switch (base.kind) {
    case "ORDER_PLACED":
      assertExactFields(
        base,
        ["orderId", "wallet", "side", "price", "orderBehavior", "amountUnits"],
        ["orderId", "wallet", "side", "price", "orderBehavior", "amountUnits"],
      );
      if (
        base.orderBehavior !== 0 &&
        base.orderBehavior !== 1 &&
        base.orderBehavior !== 2
      ) {
        throw new Error("ORDER_PLACED orderBehavior must be 0, 1, or 2");
      }
      base.amountUnits = positiveUnits(
        base.amountUnits,
        "ORDER_PLACED amountUnits",
      );
      break;
    case "ORDER_MATCHED":
      assertExactFields(
        base,
        ["makerOrderId", "takerOrderId", "price", "amountUnits"],
        ["makerOrderId", "takerOrderId", "price", "amountUnits"],
      );
      base.amountUnits = positiveUnits(
        base.amountUnits,
        "ORDER_MATCHED amountUnits",
      );
      break;
    case "TAKER_EXECUTION":
      assertExactFields(
        base,
        [
          "orderId",
          "wallet",
          "side",
          "price",
          "amountUnits",
          "releasedAmountUnits",
          "amountLamports",
          "feeLamports",
          "refundLamports",
          "treasuryFeeLamports",
          "marketMakerFeeLamports",
          "selfTradeTriggered",
        ],
        [
          "orderId",
          "wallet",
          "side",
          "price",
          "amountUnits",
          "releasedAmountUnits",
          "amountLamports",
          "feeLamports",
          "refundLamports",
          "treasuryFeeLamports",
          "marketMakerFeeLamports",
          "selfTradeTriggered",
        ],
      );
      if (typeof base.selfTradeTriggered !== "boolean") {
        throw new Error("TAKER_EXECUTION selfTradeTriggered must be a boolean");
      }
      base.amountUnits = unsignedInteger(
        base.amountUnits,
        "TAKER_EXECUTION amountUnits",
      );
      base.releasedAmountUnits = unsignedInteger(
        base.releasedAmountUnits,
        "TAKER_EXECUTION releasedAmountUnits",
      );
      if (
        BigInt(base.amountUnits) % 1_000n !== 0n ||
        BigInt(base.releasedAmountUnits) % 1_000n !== 0n ||
        (BigInt(base.amountUnits) === 0n &&
          BigInt(base.releasedAmountUnits) === 0n) ||
        (BigInt(base.amountLamports!) === 0n) !==
          (BigInt(base.amountUnits) === 0n) ||
        BigInt(base.feeLamports!) !==
          BigInt(base.treasuryFeeLamports!) +
            BigInt(base.marketMakerFeeLamports!) ||
        (base.selfTradeTriggered && BigInt(base.releasedAmountUnits) === 0n)
      ) {
        throw new Error("TAKER_EXECUTION unit/value invariant failed");
      }
      break;
    case "ORDER_CANCELLED":
    case "RESTING_ORDER_RECLAIMED":
      assertExactFields(
        base,
        ["orderId", "wallet", "side", "price", "amountUnits", "amountLamports"],
        ["orderId", "wallet", "side", "price", "amountUnits", "amountLamports"],
      );
      base.amountUnits = unsignedInteger(
        base.amountUnits,
        `${base.kind} amountUnits`,
      );
      if (BigInt(base.amountUnits) % 1_000n !== 0n) {
        throw new Error(`${base.kind} amountUnits must be a multiple of 1000`);
      }
      break;
    case "FILLED_ORDER_CLOSED":
      assertExactFields(base, ["orderId", "wallet"], ["orderId", "wallet"]);
      break;
    case "PRICE_LEVEL_CLOSED":
      assertExactFields(
        base,
        ["wallet", "side", "price"],
        ["wallet", "side", "price"],
      );
      break;
    case "CLAIM_PAYOUT":
      assertExactFields(
        base,
        ["wallet", "amountLamports", "feeLamports", "status", "winner"],
        ["wallet", "amountLamports", "feeLamports", "status", "winner"],
      );
      if (
        base.status !== "resolved" ||
        (base.winner !== "a" && base.winner !== "b") ||
        BigInt(base.amountLamports!) <= 0n
      ) {
        throw new Error(
          "CLAIM_PAYOUT must describe a positive resolved payout",
        );
      }
      break;
    case "CANCELLATION_REFUND":
      assertExactFields(
        base,
        ["wallet", "amountLamports", "feeLamports", "status", "winner"],
        [
          "wallet",
          "amountLamports",
          "feeLamports",
          "treasuryFeeLamports",
          "marketMakerFeeLamports",
          "status",
          "winner",
        ],
      );
      if (
        base.status !== "cancelled" ||
        base.winner !== "none" ||
        BigInt(base.amountLamports!) <= 0n ||
        BigInt(base.feeLamports!) !== 0n ||
        (base.treasuryFeeLamports === undefined) !==
          (base.marketMakerFeeLamports === undefined) ||
        (base.treasuryFeeLamports !== undefined &&
          BigInt(base.treasuryFeeLamports) +
            BigInt(base.marketMakerFeeLamports!) >
            BigInt(base.amountLamports!))
      ) {
        throw new Error(
          "CANCELLATION_REFUND must describe a positive fee-free cancellation refund",
        );
      }
      break;
    case "RESOLVED_TRADE_FEES_WITHDRAWN":
      assertExactFields(
        base,
        [
          "treasury",
          "marketMaker",
          "submitter",
          "treasuryFeeLamports",
          "marketMakerFeeLamports",
          "status",
          "winner",
        ],
        [
          "treasury",
          "marketMaker",
          "submitter",
          "treasuryFeeLamports",
          "marketMakerFeeLamports",
          "status",
          "winner",
        ],
      );
      if (
        base.status !== "resolved" ||
        (base.winner !== "a" && base.winner !== "b") ||
        (BigInt(base.treasuryFeeLamports!) === 0n &&
          BigInt(base.marketMakerFeeLamports!) === 0n)
      ) {
        throw new Error(
          "RESOLVED_TRADE_FEES_WITHDRAWN must describe a positive canonical resolved release",
        );
      }
      break;
    case "LOSING_BALANCE_CLOSED":
      assertExactFields(
        base,
        ["wallet", "side", "amountUnits", "amountLamports", "status", "winner"],
        ["wallet", "side", "amountUnits", "amountLamports", "status", "winner"],
      );
      base.amountUnits = unsignedInteger(
        base.amountUnits,
        "LOSING_BALANCE_CLOSED amountUnits",
      );
      if (
        base.status !== "resolved" ||
        (base.winner !== "a" && base.winner !== "b") ||
        (base.winner === "a" && base.side !== 2) ||
        (base.winner === "b" && base.side !== 1) ||
        BigInt(base.amountUnits) % 1_000n !== 0n ||
        (BigInt(base.amountUnits) === 0n && BigInt(base.amountLamports!) === 0n)
      ) {
        throw new Error(
          "LOSING_BALANCE_CLOSED must describe only nonempty resolved losing value",
        );
      }
      break;
    case "MARKET_SYNCED":
      assertExactFields(base, ["status", "winner"], ["status", "winner"]);
      if (
        !["open", "locked", "resolved", "cancelled"].includes(
          base.status ?? "",
        ) ||
        !["none", "a", "b"].includes(base.winner ?? "") ||
        (base.status === "resolved") !==
          (base.winner === "a" || base.winner === "b")
      ) {
        throw new Error("MARKET_SYNCED lifecycle/status invariant failed");
      }
      break;
    default: {
      const exhaustive: never = base.kind;
      throw new Error(`unsupported lifecycle fact kind: ${exhaustive}`);
    }
  }

  return Object.fromEntries(
    Object.entries(base).filter(([, value]) => value !== undefined),
  ) as SolanaLifecycleFact;
}

export function digestLifecycleFacts(facts: SolanaLifecycleFact[]): string {
  const normalized = facts.map(normalizeLifecycleFact);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function unitsReleasedByVaultRefund(input: {
  side: number;
  price: number;
  lamports: bigint;
}): bigint {
  if (
    (input.side !== 1 && input.side !== 2) ||
    !Number.isInteger(input.price) ||
    input.price <= 0 ||
    input.price >= 1_000 ||
    input.lamports < 0n
  ) {
    throw new Error("resting-order refund input is invalid");
  }
  const priceComponent = BigInt(
    input.side === 1 ? input.price : 1_000 - input.price,
  );
  const numerator = input.lamports * 1_000n;
  if (numerator % priceComponent !== 0n) {
    throw new Error("resting-order refund cannot be mapped to exact units");
  }
  const units = numerator / priceComponent;
  if (units % 1_000n !== 0n) {
    throw new Error("resting-order refund units violate lot size");
  }
  return units;
}

export function verifyClaimLifecycleAccounting(input: {
  status: "resolved" | "cancelled";
  winner: "none" | "a" | "b";
  payoutLamports: bigint;
  feeLamports: bigint;
  winningsFeeBps: number;
}): "CLAIM_PAYOUT" | "CANCELLATION_REFUND" {
  if (
    input.payoutLamports <= 0n ||
    input.feeLamports < 0n ||
    !Number.isInteger(input.winningsFeeBps) ||
    input.winningsFeeBps < 0 ||
    input.winningsFeeBps > 10_000
  ) {
    throw new Error("claim transfer accounting input is invalid");
  }
  if (input.status === "cancelled") {
    if (input.winner !== "none" || input.feeLamports !== 0n) {
      throw new Error("cancelled market claims must be fee-free refunds");
    }
    return "CANCELLATION_REFUND";
  }
  if (input.winner !== "a" && input.winner !== "b") {
    throw new Error("resolved market claim is missing a winner");
  }
  const gross = input.payoutLamports + input.feeLamports;
  const expectedFee = (gross * BigInt(input.winningsFeeBps)) / BigInt(10_000);
  if (input.feeLamports !== expectedFee) {
    throw new Error(
      "claim fee transfer does not match the market fee snapshot",
    );
  }
  return "CLAIM_PAYOUT";
}

export function verifyLosingBalanceCleanupAccounting(input: {
  status: string | undefined;
  winner: string | undefined;
  aShares: bigint;
  bShares: bigint;
  aLockedLamports: bigint;
  bLockedLamports: bigint;
}): { side: 1 | 2; amountUnits: bigint; amountLamports: bigint } {
  if (
    input.status !== "resolved" ||
    (input.winner !== "a" && input.winner !== "b") ||
    input.aShares < 0n ||
    input.bShares < 0n ||
    input.aLockedLamports < 0n ||
    input.bLockedLamports < 0n ||
    (input.aShares === 0n &&
      input.bShares === 0n &&
      input.aLockedLamports === 0n &&
      input.bLockedLamports === 0n) ||
    (input.winner === "a" &&
      (input.aShares !== 0n || input.aLockedLamports !== 0n)) ||
    (input.winner === "b" &&
      (input.bShares !== 0n || input.bLockedLamports !== 0n))
  ) {
    throw new Error(
      "losing-balance cleanup must discard only nonempty resolved losing value",
    );
  }

  const side = input.winner === "a" ? 2 : 1;
  const amountUnits = side === 1 ? input.aShares : input.bShares;
  const amountLamports =
    side === 1 ? input.aLockedLamports : input.bLockedLamports;
  if (amountUnits % 1_000n !== 0n) {
    throw new Error("losing-balance cleanup violates the market lot size");
  }
  return { side, amountUnits, amountLamports };
}

export function resolveLifecycleIndexStartSlot(input: {
  value: string | undefined;
  required: boolean;
}): number {
  const value = input.value?.trim() ?? "";
  if (!value) {
    if (input.required) {
      throw new Error(
        "SOLANA_LIFECYCLE_INDEX_START_SLOT is required for mainnet indexing",
      );
    }
    return 0;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("SOLANA_LIFECYCLE_INDEX_START_SLOT must be an integer");
  }
  const slot = Number(value);
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new Error(
      "SOLANA_LIFECYCLE_INDEX_START_SLOT must be a safe non-negative integer",
    );
  }
  return slot;
}

function normalizeSignatureEntry(
  entry: SignaturePageEntry,
): FinalizedSignatureReference {
  if (!isCanonicalSolanaTransactionSignature(entry.signature)) {
    throw new Error("Solana lifecycle history contains an invalid signature");
  }
  if (
    !Number.isSafeInteger(entry.slot) ||
    Number(entry.slot) < 0 ||
    (entry.confirmationStatus != null &&
      entry.confirmationStatus !== "finalized")
  ) {
    throw new Error("Solana lifecycle history contains a non-finalized slot");
  }
  if (
    entry.blockTime != null &&
    (!Number.isSafeInteger(entry.blockTime) || Number(entry.blockTime) < 0)
  ) {
    throw new Error("Solana lifecycle history contains an invalid block time");
  }
  return {
    signature: entry.signature,
    slot: Number(entry.slot),
    blockTime: entry.blockTime == null ? null : Number(entry.blockTime),
    succeeded: entry.err == null,
  };
}

export async function collectFinalizedSignatureBackfill(input: {
  fetchPage: (request: SignaturePageRequest) => Promise<SignaturePageEntry[]>;
  checkpointSignature: string | null;
  checkpointSlot: number | null;
  startSlot: number;
  minimumAvailableSlot: number;
  pageSize?: number;
  maxPages?: number;
}): Promise<FinalizedSignatureReference[]> {
  if (
    !Number.isSafeInteger(input.startSlot) ||
    input.startSlot < 0 ||
    !Number.isSafeInteger(input.minimumAvailableSlot) ||
    input.minimumAvailableSlot < 0
  ) {
    throw new Error("Solana lifecycle slot bounds are invalid");
  }
  const requiredHistorySlot = input.checkpointSlot ?? input.startSlot;
  if (requiredHistorySlot < input.minimumAvailableSlot) {
    throw new Error(
      `Solana lifecycle history is unavailable before slot ${input.minimumAvailableSlot}`,
    );
  }
  if (
    (input.checkpointSignature === null) !==
    (input.checkpointSlot === null)
  ) {
    throw new Error("Solana lifecycle checkpoint is incomplete");
  }
  if (
    input.checkpointSignature !== null &&
    (!isCanonicalSolanaTransactionSignature(input.checkpointSignature) ||
      !Number.isSafeInteger(input.checkpointSlot) ||
      input.checkpointSlot! < input.startSlot)
  ) {
    throw new Error("Solana lifecycle checkpoint is invalid");
  }

  const pageSize = input.pageSize ?? 1_000;
  const maxPages = input.maxPages ?? 100;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1_000 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1
  ) {
    throw new Error("Solana lifecycle pagination bounds are invalid");
  }

  const newestFirst: FinalizedSignatureReference[] = [];
  const seen = new Set<string>();
  let before: string | undefined;
  let foundBoundary = false;
  let previousSlot = Number.POSITIVE_INFINITY;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await input.fetchPage({ before, limit: pageSize });
    if (!Array.isArray(page)) {
      throw new Error(
        "Solana lifecycle RPC returned an invalid signature page",
      );
    }
    if (page.length === 0) {
      if (input.checkpointSignature !== null && !foundBoundary) {
        throw new Error(
          "Solana lifecycle checkpoint is no longer present in RPC history",
        );
      }
      foundBoundary = true;
      break;
    }
    if (page.length > pageSize) {
      throw new Error("Solana lifecycle RPC exceeded the requested page size");
    }

    for (const rawEntry of page) {
      const entry = normalizeSignatureEntry(rawEntry);
      if (seen.has(entry.signature)) {
        throw new Error("Solana lifecycle RPC returned a duplicate signature");
      }
      seen.add(entry.signature);
      if (entry.slot > previousSlot) {
        throw new Error(
          "Solana lifecycle RPC returned signatures out of newest-first order",
        );
      }
      previousSlot = entry.slot;

      if (entry.signature === input.checkpointSignature) {
        if (entry.slot !== input.checkpointSlot) {
          throw new Error("Solana lifecycle checkpoint slot drifted");
        }
        foundBoundary = true;
        break;
      }
      if (entry.slot < input.startSlot) {
        foundBoundary = true;
        break;
      }
      newestFirst.push(entry);
    }
    if (foundBoundary) break;

    const last = page.at(-1);
    if (!last || !isCanonicalSolanaTransactionSignature(last.signature)) {
      throw new Error("Solana lifecycle RPC page has no pagination cursor");
    }
    before = last.signature;
  }

  if (!foundBoundary) {
    throw new Error(
      `Solana lifecycle backfill exceeded ${maxPages} page(s) before reaching its durable boundary`,
    );
  }
  return newestFirst.reverse();
}
