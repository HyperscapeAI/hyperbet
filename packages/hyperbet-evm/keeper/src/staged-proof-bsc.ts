import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { GOLD_CLOB_ABI } from "../../../hyperbet-ui/src/lib/goldClobAbi";

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
  };
  markets: Array<{
    chainKey: string;
    marketRef: string | null;
    lifecycleStatus: string;
    contractAddress?: string | null;
  }>;
};

type BscCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  marketRef: string;
  openTx: string;
  createMarketTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const duelOracleArtifactPath = path.resolve(
  __dirname,
  "../../../evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json",
);
const duelOracleAbi = JSON.parse(readFileSync(duelOracleArtifactPath, "utf8"))
  .abi as readonly unknown[];

const goldClobAdminAbi = [
  ...GOLD_CLOB_ABI,
  {
    inputs: [
      { internalType: "bytes32", name: "duelKey", type: "bytes32" },
      { internalType: "uint8", name: "marketKind", type: "uint8" },
    ],
    name: "createMarketForDuel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const MARKET_KIND_DUEL_WINNER = 0;
const EVM_SELL_SIDE = 2;
const EVM_STATUS_BETTING_OPEN = 2;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function normalizeHex32(value: string): string {
  return value.replace(/^0x/i, "").toLowerCase();
}

function buildControlledCycle(
  duelId: string,
  duelKeyHex: string,
): Record<string, unknown> {
  const now = Date.now();
  return {
    cycle: {
      cycleId: `staged-proof-bsc-${duelId}`,
      phase: "ANNOUNCEMENT",
      duelId,
      duelKeyHex,
      cycleStartTime: now - 90_000,
      phaseStartTime: now - 5_000,
      phaseEndTime: now + 300_000,
      betOpenTime: now - 15_000,
      betCloseTime: now + 300_000,
      fightStartTime: now + 60_000,
      duelEndTime: null,
      countdown: 300,
      timeRemaining: 300_000,
      winnerId: null,
      winnerName: null,
      winReason: null,
      seed: null,
      replayHash: null,
      agent1: {
        id: "staged-bsc-agent-a",
        name: "Stage Agent A",
        provider: "Hyperscape",
        model: "stage-alpha",
        hp: 90,
        maxHp: 100,
        combatLevel: 90,
        wins: 10,
        losses: 2,
        damageDealtThisFight: 12,
        inventory: [],
        monologues: [],
      },
      agent2: {
        id: "staged-bsc-agent-b",
        name: "Stage Agent B",
        provider: "OpenRouter",
        model: "stage-beta",
        hp: 88,
        maxHp: 100,
        combatLevel: 88,
        wins: 8,
        losses: 4,
        damageDealtThisFight: 9,
        inventory: [],
        monologues: [],
      },
    },
    leaderboard: [],
    cameraTarget: null,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }
  return JSON.parse(raw) as T;
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = `${label} did not become ready`;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (predicate(value)) {
        return value;
      }
      lastError = `${label} predicate not satisfied`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(lastError);
}

function findCanonicalMarket(payload: PredictionMarketsResponse) {
  return payload.markets.find((market) => market.chainKey === "bsc") ?? null;
}

function shaParticipant(label: string): `0x${string}` {
  return `0x${createHash("sha256").update(label).digest("hex")}` as `0x${string}`;
}

async function publishControlledState(duelId: string, duelKeyHex: string): Promise<void> {
  const keeperUrl = requireEnv("HYPERBET_BSC_KEEPER_STAGING_URL").replace(/\/$/, "");
  const publishKey = requireEnv("HYPERBET_BSC_STAGING_STREAM_PUBLISH_KEY");
  await requestJson(
    `${keeperUrl}/api/streaming/state/publish`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-arena-write-key": publishKey,
      },
      body: JSON.stringify(buildControlledCycle(duelId, duelKeyHex)),
    },
  );
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === 1 ? price : 1000 - price);
  return (amount * component) / 1000n;
}

async function waitForReceipt(
  client: ReturnType<typeof createPublicClient>,
  hash: Hash,
) {
  return client.waitForTransactionReceipt({ hash });
}

async function main(): Promise<void> {
  const duelId = requireEnv("HYPERBET_STAGED_PROOF_DUEL_ID");
  const duelKeyHex = normalizeHex32(requireEnv("HYPERBET_STAGED_PROOF_DUEL_KEY"));
  const duelKey = `0x${duelKeyHex}` as Hash;
  const rpcUrl = requireEnv("HYPERBET_BSC_STAGING_RPC_URL");
  const canary = privateKeyToAccount(
    requireEnv("HYPERBET_BSC_STAGING_CANARY_PRIVATE_KEY") as `0x${string}`,
  );
  const reporter = privateKeyToAccount(
    requireEnv("HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY") as `0x${string}`,
  );
  const oracleAddress = requireEnv(
    "HYPERBET_BSC_STAGING_DUEL_ORACLE_ADDRESS",
  ) as Address;
  const keeperUrl = requireEnv("HYPERBET_BSC_KEEPER_STAGING_URL").replace(/\/$/, "");

  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const reporterClient = createWalletClient({
    account: reporter,
    transport: http(rpcUrl),
  });
  const canaryClient = createWalletClient({
    account: canary,
    transport: http(rpcUrl),
  });
  const clobAddress = requireEnv("HYPERBET_BSC_STAGING_GOLD_CLOB_ADDRESS") as Address;

  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const now = Number(latestBlock.timestamp);
  const openTx = await reporterClient.writeContract({
    chain: undefined,
    address: oracleAddress,
    abi: duelOracleAbi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      shaParticipant("stage-bsc-agent-a"),
      shaParticipant("stage-bsc-agent-b"),
      BigInt(now - 15),
      BigInt(now + 300),
      BigInt(now + 360),
      "staged-live-proof-open",
      EVM_STATUS_BETTING_OPEN,
    ],
  });
  await waitForReceipt(publicClient, openTx);

  const createMarketTx = await reporterClient.writeContract({
    chain: undefined,
    address: clobAddress,
    abi: goldClobAdminAbi,
    functionName: "createMarketForDuel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(publicClient, createMarketTx);

  await publishControlledState(duelId, duelKeyHex);

  const openLifecycle = await waitFor(
    "bsc lifecycle market open",
    async () =>
      requestJson<PredictionMarketsResponse>(
        `${keeperUrl}/api/arena/prediction-markets/active`,
      ),
    (payload) => {
      const nextMarket = findCanonicalMarket(payload);
      return (
        payload.duel.duelKey === duelKeyHex &&
        nextMarket?.marketRef != null &&
        nextMarket.lifecycleStatus === "OPEN"
      );
    },
  );

  const runtimeMarket = findCanonicalMarket(openLifecycle);
  if (!runtimeMarket?.marketRef) {
    throw new Error("bsc marketRef missing after lifecycle open");
  }

  const treasuryFeeBps = (await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "tradeTreasuryFeeBps",
  })) as bigint;
  const marketMakerFeeBps = (await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "tradeMarketMakerFeeBps",
  })) as bigint;
  const amount = parseUnits(
    (process.env.HYPERBET_BSC_STAGING_CANARY_ORDER_AMOUNT ?? "0.001").trim(),
    18,
  );
  const cost = quoteCost(EVM_SELL_SIDE, 999, amount);
  const fees = (cost * (treasuryFeeBps + marketMakerFeeBps)) / 10_000n;

  const placeOrderTx = await canaryClient.writeContract({
    chain: undefined,
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [duelKey, MARKET_KIND_DUEL_WINNER, EVM_SELL_SIDE, 999, amount],
    value: cost + fees,
  });
  await waitForReceipt(publicClient, placeOrderTx);

  const cancelTx = await reporterClient.writeContract({
    chain: undefined,
    address: oracleAddress,
    abi: duelOracleAbi,
    functionName: "cancelDuel",
    args: [duelKey, "staged-live-proof-cancelled"],
  });
  await waitForReceipt(publicClient, cancelTx);

  const syncTx = await reporterClient.writeContract({
    chain: undefined,
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "syncMarketFromOracle",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(publicClient, syncTx);

  await waitFor(
    "bsc lifecycle cancelled",
    async () =>
      requestJson<PredictionMarketsResponse>(
        `${keeperUrl}/api/arena/prediction-markets/active`,
      ),
    (payload) => findCanonicalMarket(payload)?.lifecycleStatus === "CANCELLED",
  );

  const claimTx = await canaryClient.writeContract({
    chain: undefined,
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(publicClient, claimTx);

  const position = (await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [runtimeMarket.marketRef as Hash, canary.address],
  })) as readonly [bigint, bigint, bigint, bigint];
  if (position.some((value) => value !== 0n)) {
    throw new Error(
      `bsc claim cleanup incomplete: ${position.map((value) => value.toString()).join(":")}`,
    );
  }

  const result: BscCanaryResult = {
    duelId,
    duelKeyHex,
    marketRef: runtimeMarket.marketRef,
    openTx,
    createMarketTx,
    placeOrderTx,
    cancelTx,
    syncTx,
    claimTx,
  };
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
