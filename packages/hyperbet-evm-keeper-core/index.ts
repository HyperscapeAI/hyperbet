import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  normalizePredictionMarketLifecycleMetadata,
  type BettingEvmChain,
  type PredictionMarketLifecycleRecord,
  type PredictionMarketLifecycleStatus,
  resolveLifecycleFromEvmDuelStatus,
  resolveLifecycleFromEvmStatus,
  resolveWinnerFromEvmStatus,
  toRecordedBetChain,
  nativeAssetForEvmChain,
  type RecordedBetChain,
} from "@hyperbet/chain-registry";
import type { KeeperMarketHealthRecord } from "@hyperbet/mm-core";
import { PublicKey, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import {
  decodeEventLog,
  decodeFunctionData,
  parseAbi,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";

export type ExternalBetVerificationInput = {
  marketRef: string | null;
  duelKey: string | null;
};

export type VerifiedExternalBetRecord = {
  chain: RecordedBetChain;
  txSignature: string;
  bettorWallet: string;
  duelKey: string | null;
  marketRef: string | null;
  sourceAsset: string;
  sourceAmount: number;
  goldAmount: number;
  feeBps: number;
  feeAmount: number;
  pointsBasisAmount: number;
};

export const DEFAULT_ALLOWED_APP_DOMAINS = [
  "hyperbet.win",
  "hyperscape.bet",
  "hyperscape.gg",
  "hyperbet.pages.dev",
  "hyperscape.club",
  "hyperscape.pages.dev",
] as const;

const GOLD_CLOB_PLACE_ORDER_DISCRIMINATOR = createHash("sha256")
  .update("global:place_order")
  .digest()
  .subarray(0, 8);
const GOLD_CLOB_EVM_PLACE_ORDER_ABI = parseAbi([
  "function placeOrder(bytes32 duelKey, uint8 marketKind, uint8 side, uint16 price, uint128 amount, uint8 orderFlags)",
]);
const GOLD_CLOB_EVM_ORDER_PLACED_EVENT = parseAbiItem(
  "event OrderPlaced(bytes32 indexed marketKey, uint64 indexed orderId, address indexed maker, uint8 side, uint16 price, uint128 amount)",
);
const GOLD_CLOB_EVM_DUEL_WINNER_MARKET_KIND = 0n;
const GOLD_CLOB_PLACE_ORDER_DATA_LENGTH = 27;
const SOL_DISPLAY_DECIMALS = 9;
const EVM_DISPLAY_DECIMALS = 18;
const EVM_MAX_PRICE = 1000n;

export type SolanaRecordedBetVerifierContext = {
  connection: Pick<Connection, "getParsedTransaction">;
  marketProgramId: PublicKey;
  deriveDuelState: (duelKeyHex: string) => string;
  deriveMarketRef: (duelState: string) => string;
  fetchTradeFeeBps: () => Promise<number>;
};

export function normalizeOriginLike(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedAppOrigin(
  origin: string | null,
  corsOrigins: readonly string[],
  allowedAppDomains: readonly string[] = DEFAULT_ALLOWED_APP_DOMAINS,
): boolean {
  const normalized = normalizeOriginLike(origin);
  if (!normalized) return false;
  const { hostname } = new URL(normalized);
  const lowerHostname = hostname.toLowerCase();
  const canonicalHostname = lowerHostname.replace(/^\[(.*)\]$/, "$1");
  const matchesAppDomain = (domain: string) =>
    canonicalHostname === domain || canonicalHostname.endsWith(`.${domain}`);
  const isLoopbackHost =
    canonicalHostname === "localhost" ||
    canonicalHostname === "127.0.0.1" ||
    canonicalHostname === "::1";
  return (
    corsOrigins.includes(normalized) ||
    allowedAppDomains.some((domain) => matchesAppDomain(domain)) ||
    isLoopbackHost
  );
}

export function normalizeDuelKeyHex(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function normalizeHex32(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function toNumberLike(
  value: bigint | number | { toString(): string } | null | undefined,
): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatAtomicAmount(amount: bigint, decimals: number): number {
  if (amount <= 0n) return 0;
  return Number(amount) / 10 ** decimals;
}

export function normalizeBase58Key(value: string | null): string | null {
  if (!value) return null;
  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    return null;
  }
}

function toInstructionAccountAddress(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "pubkey" in value &&
    typeof (value as { pubkey?: unknown }).pubkey === "string"
  ) {
    return (value as { pubkey: string }).pubkey;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "pubkey" in value &&
    typeof (value as { pubkey?: { toBase58?: () => string } }).pubkey?.toBase58 ===
      "function"
  ) {
    return (value as { pubkey: { toBase58: () => string } }).pubkey.toBase58();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toBase58" in value &&
    typeof (value as { toBase58?: () => string }).toBase58 === "function"
  ) {
    return (value as { toBase58: () => string }).toBase58();
  }
  return null;
}

function extractInstructionProgramId(instruction: unknown): string | null {
  if (
    typeof instruction === "object" &&
    instruction !== null &&
    "programId" in instruction
  ) {
    return toInstructionAccountAddress(
      (instruction as { programId?: unknown }).programId,
    );
  }
  return null;
}

function extractInstructionAccounts(instruction: unknown): string[] {
  if (
    typeof instruction !== "object" ||
    instruction === null ||
    !("accounts" in instruction) ||
    !Array.isArray((instruction as { accounts?: unknown[] }).accounts)
  ) {
    return [];
  }
  return (instruction as { accounts: unknown[] }).accounts
    .map((account) => toInstructionAccountAddress(account))
    .filter((account): account is string => Boolean(account));
}

function decodePlaceOrderInstructionData(
  data: unknown,
): { side: number; price: number; amount: bigint } | null {
  if (typeof data !== "string") return null;
  try {
    const raw = Buffer.from(bs58.decode(data));
    if (raw.length !== GOLD_CLOB_PLACE_ORDER_DATA_LENGTH) {
      return null;
    }
    if (
      !raw
        .subarray(0, GOLD_CLOB_PLACE_ORDER_DISCRIMINATOR.length)
        .equals(GOLD_CLOB_PLACE_ORDER_DISCRIMINATOR)
    ) {
      return null;
    }
    return {
      side: raw.readUInt8(16),
      price: raw.readUInt16LE(17),
      amount: raw.readBigUInt64LE(19),
    };
  } catch {
    return null;
  }
}

function calculateQuoteCostAtomic(
  side: bigint | number,
  price: bigint | number,
  amount: bigint,
): bigint | null {
  if (amount <= 0n) return null;
  const sideValue = BigInt(side);
  const priceValue = BigInt(price);
  const priceComponent =
    sideValue === 1n ? priceValue : EVM_MAX_PRICE - priceValue;
  if (priceComponent <= 0n) return null;
  const cost = (amount * priceComponent) / EVM_MAX_PRICE;
  return cost > 0n ? cost : null;
}

function calculateBpsFeeAtomic(amount: bigint, feeBps: number): bigint {
  if (amount <= 0n || feeBps <= 0) return 0n;
  return (amount * BigInt(feeBps)) / 10_000n;
}

function evmSourceAssetForChain(chainKey: BettingEvmChain): string {
  return nativeAssetForEvmChain(chainKey);
}

const ZERO_HEX_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function toNullableNumber(
  value: bigint | number | { toString(): string } | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOptionalHex32(value: unknown): string | null {
  const normalized = normalizeHex32(value);
  if (!normalized || normalized === ZERO_HEX_32) {
    return null;
  }
  return normalized;
}

function resolveEvmLifecycleStatus(
  snapshot: Record<string, any> | null,
  fallbackHealth: KeeperMarketHealthRecord | null,
): PredictionMarketLifecycleStatus {
  const currentDuel = snapshot?.currentDuel as Record<string, any> | undefined;
  const duelStatus = resolveLifecycleFromEvmDuelStatus(currentDuel?.status);
  if (duelStatus !== "UNKNOWN") return duelStatus;
  const currentMatch = snapshot?.currentMatch as Record<string, any> | undefined;
  const parsedStatus = resolveLifecycleFromEvmStatus(currentMatch?.status);
  if (parsedStatus !== "UNKNOWN") return parsedStatus;
  return fallbackHealth?.lifecycleStatus ?? "UNKNOWN";
}

export function buildEvmPredictionMarketLifecycleRecord(input: {
  chainKey: BettingEvmChain;
  duelKey: string | null;
  duelId: string | null;
  betCloseTime: number | null;
  snapshot: Record<string, any> | null;
  fallbackHealth: KeeperMarketHealthRecord | null;
  contractAddress: string | null;
  syncedAt: number | null;
}): PredictionMarketLifecycleRecord {
  const {
    chainKey,
    duelKey,
    duelId,
    betCloseTime,
    snapshot,
    fallbackHealth,
    contractAddress,
    syncedAt,
  } = input;
  const snapshotDuelKey =
    typeof snapshot?.duelKey === "string" ? snapshot.duelKey : null;
  const snapshotDuelId =
    typeof snapshot?.duelId === "string" ? snapshot.duelId : null;
  const currentMatch = snapshot?.currentMatch as Record<string, any> | undefined;
  const currentDuel = snapshot?.currentDuel as Record<string, any> | undefined;
  const marketKey =
    normalizeHex32(snapshot?.marketKey) ??
    normalizeHex32(fallbackHealth?.marketRef) ??
    null;
  const lifecycleStatus = resolveEvmLifecycleStatus(snapshot, fallbackHealth);
  const proposalId = normalizeOptionalHex32(currentDuel?.activeProposalId);
  const proposalProposedAt = toNullableNumber(currentDuel?.proposalProposedAt);
  const disputeWindowSeconds = toNullableNumber(currentDuel?.disputeWindowSeconds);
  const challengeWindowEndsAt =
    proposalProposedAt != null && disputeWindowSeconds != null
      ? proposalProposedAt + disputeWindowSeconds
      : null;
  return {
    chainKey,
    duelKey: duelKey ?? snapshotDuelKey ?? fallbackHealth?.duelKey ?? null,
    duelId: duelId ?? snapshotDuelId ?? fallbackHealth?.duelId ?? null,
    marketId: marketKey,
    marketRef: marketKey,
    lifecycleStatus,
    winner:
      currentMatch?.winner != null
        ? resolveWinnerFromEvmStatus(currentMatch.winner)
        : (fallbackHealth?.winner ?? "NONE"),
    betCloseTime,
    contractAddress: snapshot?.contractAddress ?? contractAddress ?? null,
    programId: null,
    txRef: null,
    syncedAt,
    metadata: normalizePredictionMarketLifecycleMetadata({
      proposalId,
      challengeWindowEndsAt,
      finalizedAt: null,
      cancellationReason: null,
      marketKey,
      duelStatus: currentDuel?.status ?? null,
      proposalChallenged:
        typeof currentDuel?.proposalChallenged === "boolean"
          ? currentDuel.proposalChallenged
          : null,
      yesPool: currentMatch?.yesPool ?? null,
      noPool: currentMatch?.noPool ?? null,
      recoveredFromBotHealth:
        Boolean(fallbackHealth) &&
        (duelKey == null ||
          duelId == null ||
          snapshot == null ||
          lifecycleStatus === fallbackHealth?.lifecycleStatus),
    }),
  };
}

export async function verifySolanaRecordedBet(
  context: SolanaRecordedBetVerifierContext,
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<VerifiedExternalBetRecord | null> {
  const normalizedWallet = normalizeBase58Key(bettorWallet);
  const rawMarketRef = expected.marketRef?.trim() || null;
  const rawDuelKey = expected.duelKey?.trim() || null;
  const normalizedMarketRef = rawMarketRef
    ? normalizeBase58Key(rawMarketRef)
    : null;
  const normalizedDuelKey = normalizeDuelKeyHex(rawDuelKey);
  if (!normalizedWallet || !txSignature.trim()) {
    return null;
  }
  if ((rawMarketRef && !normalizedMarketRef) || (rawDuelKey && !normalizedDuelKey)) {
    return null;
  }
  if (!normalizedMarketRef && !normalizedDuelKey) {
    return null;
  }

  const expectedDuelState = normalizedDuelKey
    ? context.deriveDuelState(normalizedDuelKey)
    : null;
  const derivedMarketRef = expectedDuelState
    ? context.deriveMarketRef(expectedDuelState)
    : null;
  if (
    normalizedMarketRef &&
    derivedMarketRef &&
    normalizedMarketRef !== derivedMarketRef
  ) {
    return null;
  }
  const expectedMarketRef = normalizedMarketRef ?? derivedMarketRef;

  try {
    const transaction = await context.connection.getParsedTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction || transaction.meta?.err) {
      return null;
    }

    const walletSigned = transaction.transaction.message.accountKeys.some(
      (key: { pubkey: unknown; signer: boolean }) =>
        key.signer &&
        normalizeBase58Key(toInstructionAccountAddress(key.pubkey)) ===
          normalizedWallet,
    );
    if (!walletSigned) {
      return null;
    }

    for (const instruction of transaction.transaction.message.instructions) {
      const programId = extractInstructionProgramId(instruction);
      if (programId !== context.marketProgramId.toBase58()) {
        continue;
      }
      const decodedOrder =
        typeof instruction === "object" && instruction !== null && "data" in instruction
          ? decodePlaceOrderInstructionData(
              (instruction as { data?: unknown }).data,
            )
          : null;
      if (!decodedOrder) {
        continue;
      }
      const accounts = extractInstructionAccounts(instruction);
      const marketState = normalizeBase58Key(accounts[0] ?? null);
      const duelState = normalizeBase58Key(accounts[1] ?? null);
      const user = normalizeBase58Key(accounts[9] ?? null);
      if (user !== normalizedWallet) continue;
      if (expectedMarketRef && marketState !== expectedMarketRef) continue;
      if (expectedDuelState && duelState !== expectedDuelState) continue;
      if (!marketState) continue;

      const totalFeeBps = await context.fetchTradeFeeBps();
      const quoteCostAtomic = calculateQuoteCostAtomic(
        decodedOrder.side,
        decodedOrder.price,
        decodedOrder.amount,
      );
      if (quoteCostAtomic == null) continue;
      const feeAmountAtomic = calculateBpsFeeAtomic(quoteCostAtomic, totalFeeBps);
      const totalSpendAtomic = quoteCostAtomic + feeAmountAtomic;
      const totalSpend = formatAtomicAmount(totalSpendAtomic, SOL_DISPLAY_DECIMALS);
      const feeAmount = formatAtomicAmount(feeAmountAtomic, SOL_DISPLAY_DECIMALS);

      return {
        chain: toRecordedBetChain("solana"),
        txSignature: txSignature.trim(),
        bettorWallet: normalizedWallet,
        duelKey: normalizedDuelKey,
        marketRef: marketState,
        sourceAsset: "SOL",
        sourceAmount: totalSpend,
        goldAmount: totalSpend,
        feeBps: totalFeeBps,
        feeAmount,
        pointsBasisAmount: totalSpend,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyEvmRecordedBet(
  client: Pick<
    PublicClient,
    "getTransactionReceipt" | "getTransaction" | "readContract"
  > | null,
  contractAddress: string,
  chainKey: BettingEvmChain,
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<VerifiedExternalBetRecord | null> {
  if (!client || !contractAddress) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txSignature)) return null;
  const rawMarketRef = expected.marketRef?.trim() || null;
  const rawDuelKey = expected.duelKey?.trim() || null;
  const normalizedMarketRef = rawMarketRef ? normalizeHex32(rawMarketRef) : null;
  const normalizedDuelKey = normalizeHex32(
    rawDuelKey ? `0x${normalizeDuelKeyHex(rawDuelKey) ?? ""}` : null,
  );
  if ((rawMarketRef && !normalizedMarketRef) || (rawDuelKey && !normalizedDuelKey)) {
    return null;
  }
  if (!normalizedMarketRef && !normalizedDuelKey) {
    return null;
  }
  try {
    const [receipt, tx, totalFeeBpsRaw] = await Promise.all([
      client.getTransactionReceipt({ hash: txSignature as `0x${string}` }),
      client.getTransaction({ hash: txSignature as `0x${string}` }),
      client.readContract({
        address: contractAddress as Address,
        abi: parseAbi(["function feeBps() view returns (uint16)"]),
        functionName: "feeBps",
      }),
    ]);
    if (
      receipt.status !== "success" ||
      tx.from.toLowerCase() !== bettorWallet.trim().toLowerCase() ||
      tx.to?.toLowerCase() !== contractAddress.toLowerCase()
    ) {
      return null;
    }

    const decodedCall = decodeFunctionData({
      abi: GOLD_CLOB_EVM_PLACE_ORDER_ABI,
      data: tx.input,
    });
    if (decodedCall.functionName !== "placeOrder") {
      return null;
    }
    const duelKeyArg = normalizeHex32(
      (decodedCall.args?.[0] as string | undefined) ?? null,
    );
    const marketKindArg = BigInt(
      (decodedCall.args?.[1] as bigint | number | undefined) ?? 255,
    );
    if (!duelKeyArg || marketKindArg !== GOLD_CLOB_EVM_DUEL_WINNER_MARKET_KIND) {
      return null;
    }
    if (normalizedDuelKey && duelKeyArg !== normalizedDuelKey) {
      return null;
    }
    const sideArg = BigInt(
      (decodedCall.args?.[2] as bigint | number | undefined) ?? 0,
    );
    const priceArg = Number(
      (decodedCall.args?.[3] as bigint | number | undefined) ?? 0,
    );
    const amountArg = BigInt(
      (decodedCall.args?.[4] as bigint | number | undefined) ?? 0,
    );
    const totalFeeBps = toNumberLike(
      totalFeeBpsRaw as bigint | number | { toString(): string },
    );
    const quoteCostAtomic = calculateQuoteCostAtomic(
      sideArg,
      priceArg,
      amountArg,
    );
    if (quoteCostAtomic == null) {
      return null;
    }
    const feeAmountAtomic = calculateBpsFeeAtomic(quoteCostAtomic, totalFeeBps);
    const totalSpendAtomic = quoteCostAtomic + feeAmountAtomic;
    const totalSpend = formatAtomicAmount(totalSpendAtomic, EVM_DISPLAY_DECIMALS);
    const feeAmount = formatAtomicAmount(feeAmountAtomic, EVM_DISPLAY_DECIMALS);

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
      try {
        const decodedLog = decodeEventLog({
          abi: [GOLD_CLOB_EVM_ORDER_PLACED_EVENT],
          data: log.data,
          topics: log.topics,
        });
        const args = decodedLog.args as { marketKey?: string; maker?: string };
        const marketKey = normalizeHex32(args.marketKey ?? null);
        const maker = args.maker?.toLowerCase();
        if (!marketKey || maker !== bettorWallet.trim().toLowerCase()) {
          continue;
        }
        if (normalizedMarketRef && marketKey !== normalizedMarketRef) {
          continue;
        }
        return {
          chain: toRecordedBetChain(chainKey),
          txSignature: txSignature.trim(),
          bettorWallet: bettorWallet.trim(),
          duelKey: duelKeyArg.replace(/^0x/i, "").toLowerCase(),
          marketRef: marketKey,
          sourceAsset: evmSourceAssetForChain(chainKey),
          sourceAmount: totalSpend,
          goldAmount: totalSpend,
          feeBps: totalFeeBps,
          feeAmount,
          pointsBasisAmount: totalSpend,
        };
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}
