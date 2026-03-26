import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { GOLD_CLOB_ABI } from "../packages/hyperbet-ui/src/lib/goldClobAbi";

export type EvmChain = "bsc" | "avax";

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

export type EvmPmCanaryResult = {
  marketRef: string;
  openTx: string;
  createMarketTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
};

export type EvmPerpsCanaryResult = {
  agentId: string;
  updateSkillTx: string;
  createMarketTx: string | null;
  approveMarginTx: string;
  depositInsuranceTx: string | null;
  approveInsuranceTx: string | null;
  openPositionTx: string;
  closePositionTx: string;
};

export type EvmAmmCanaryResult = {
  marketAddress: string;
  approveCreateTx: string;
  createMarketTx: string;
  approveBuyTx: string;
  buyTx: string;
  reserveYesBefore: string;
  reserveYesAfter: string;
  reserveNoBefore: string;
  reserveNoAfter: string;
};

export type EvmCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  pm: EvmPmCanaryResult;
  perps: EvmPerpsCanaryResult;
  amm: EvmAmmCanaryResult;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const duelOracleArtifactPath = path.resolve(
  __dirname,
  "../packages/evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json",
);
const routerArtifactPath = path.resolve(
  __dirname,
  "../packages/evm-contracts/out/Router.sol/Router.json",
);
const lvrMarketArtifactPath = path.resolve(
  __dirname,
  "../packages/evm-contracts/out/LvrMarket.sol/LvrMarket.json",
);
const skillOracleArtifactPath = path.resolve(
  __dirname,
  "../packages/evm-contracts/out/SkillOracle.sol/SkillOracle.json",
);
const perpEngineArtifactPath = path.resolve(
  __dirname,
  "../packages/evm-contracts/out/AgentPerpEngine.sol/AgentPerpEngine.json",
);

const duelOracleAbi = JSON.parse(readFileSync(duelOracleArtifactPath, "utf8"))
  .abi as readonly unknown[];
const routerAbi = JSON.parse(readFileSync(routerArtifactPath, "utf8"))
  .abi as readonly unknown[];
const lvrMarketAbi = JSON.parse(readFileSync(lvrMarketArtifactPath, "utf8"))
  .abi as readonly unknown[];
const skillOracleAbi = JSON.parse(readFileSync(skillOracleArtifactPath, "utf8"))
  .abi as readonly unknown[];
const perpEngineAbi = JSON.parse(readFileSync(perpEngineArtifactPath, "utf8"))
  .abi as readonly unknown[];

const erc20Abi = [
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

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
const ORDER_FLAG_GTC = 0x01;
const EVM_PERPS_ACTIVE_STATUS = 1n;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function maybeEnv(name: string): string | null {
  const value = process.env[name]?.trim() ?? "";
  return value || null;
}

function envKey(chain: EvmChain, suffix: string): string {
  return `HYPERBET_${chain.toUpperCase()}_${suffix}`;
}

function requireChainEnv(chain: EvmChain, suffix: string): string {
  return requireEnv(envKey(chain, suffix));
}

function maybeChainEnv(chain: EvmChain, suffix: string): string | null {
  return maybeEnv(envKey(chain, suffix));
}

function normalizeHex32(value: string): string {
  return value.replace(/^0x/i, "").toLowerCase();
}

function chainAgentTag(chain: EvmChain): string {
  return chain === "bsc" ? "bsc" : "avax";
}

function buildControlledCycle(
  chain: EvmChain,
  duelId: string,
  duelKeyHex: string,
): Record<string, unknown> {
  const now = Date.now();
  const tag = chainAgentTag(chain);
  return {
    cycle: {
      cycleId: `staged-proof-${tag}-${duelId}`,
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
        id: `staged-${tag}-agent-a`,
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
        id: `staged-${tag}-agent-b`,
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

function findCanonicalMarket(
  chain: EvmChain,
  payload: PredictionMarketsResponse,
) {
  return payload.markets.find((market) => market.chainKey === chain) ?? null;
}

function shaParticipant(label: string): `0x${string}` {
  return `0x${createHash("sha256").update(label).digest("hex")}` as `0x${string}`;
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === 1 ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function asBigInt(value: unknown, index = 0, key?: string): bigint {
  const candidate =
    key && value && typeof value === "object" && key in value
      ? (value as Record<string, unknown>)[key]
      : Array.isArray(value)
        ? value[index]
        : value;
  if (typeof candidate === "bigint") return candidate;
  if (typeof candidate === "number") return BigInt(Math.trunc(candidate));
  if (typeof candidate === "string") return BigInt(candidate);
  if (candidate && typeof candidate === "object" && "toString" in candidate) {
    return BigInt(String(candidate));
  }
  throw new Error(`Cannot convert value to bigint: ${String(candidate)}`);
}

function asBoolean(value: unknown, key: string, index = 0): boolean {
  const candidate =
    value && typeof value === "object" && key in value
      ? (value as Record<string, unknown>)[key]
      : Array.isArray(value)
        ? value[index]
        : value;
  return Boolean(candidate);
}

async function publishControlledState(
  chain: EvmChain,
  duelId: string,
  duelKeyHex: string,
): Promise<void> {
  const keeperUrl = requireChainEnv(chain, "KEEPER_STAGING_URL").replace(/\/$/, "");
  const publishKey = requireChainEnv(chain, "STAGING_STREAM_PUBLISH_KEY");
  await requestJson(`${keeperUrl}/api/streaming/state/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-arena-write-key": publishKey,
    },
    body: JSON.stringify(buildControlledCycle(chain, duelId, duelKeyHex)),
  });
}

async function waitForReceipt(
  client: ReturnType<typeof createPublicClient>,
  hash: Hash,
) {
  return client.waitForTransactionReceipt({ hash });
}

async function readTokenDecimals(
  client: ReturnType<typeof createPublicClient>,
  tokenAddress: Address,
): Promise<number> {
  const decimals = (await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
  })) as number;
  return Number(decimals);
}

async function runPmCanary(args: {
  chain: EvmChain;
  duelId: string;
  duelKeyHex: string;
  duelKey: Hash;
  publicClient: ReturnType<typeof createPublicClient>;
  reporterClient: ReturnType<typeof createWalletClient>;
  canaryClient: ReturnType<typeof createWalletClient>;
  oracleAddress: Address;
  clobAddress: Address;
  keeperUrl: string;
}): Promise<EvmPmCanaryResult> {
  const latestBlock = await args.publicClient.getBlock({ blockTag: "latest" });
  const now = Number(latestBlock.timestamp);
  const tag = chainAgentTag(args.chain);

  const openTx = await args.reporterClient.writeContract({
    chain: undefined,
    address: args.oracleAddress,
    abi: duelOracleAbi,
    functionName: "upsertDuel",
    args: [
      args.duelKey,
      shaParticipant(`stage-${tag}-agent-a`),
      shaParticipant(`stage-${tag}-agent-b`),
      BigInt(now - 15),
      BigInt(now + 300),
      BigInt(now + 360),
      "staged-live-proof-open",
      EVM_STATUS_BETTING_OPEN,
    ],
  });
  await waitForReceipt(args.publicClient, openTx);

  const createMarketTx = await args.reporterClient.writeContract({
    chain: undefined,
    address: args.clobAddress,
    abi: goldClobAdminAbi,
    functionName: "createMarketForDuel",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, createMarketTx);

  await publishControlledState(args.chain, args.duelId, args.duelKeyHex);

  const openLifecycle = await waitFor(
    `${args.chain} lifecycle market open`,
    async () =>
      requestJson<PredictionMarketsResponse>(
        `${args.keeperUrl}/api/arena/prediction-markets/active`,
      ),
    (payload) => {
      const nextMarket = findCanonicalMarket(args.chain, payload);
      return (
        payload.duel.duelKey === args.duelKeyHex &&
        nextMarket?.marketRef != null &&
        nextMarket.lifecycleStatus === "OPEN"
      );
    },
  );

  const runtimeMarket = findCanonicalMarket(args.chain, openLifecycle);
  if (!runtimeMarket?.marketRef) {
    throw new Error(`${args.chain} marketRef missing after lifecycle open`);
  }

  const treasuryFeeBps = (await args.publicClient.readContract({
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "tradeTreasuryFeeBps",
  })) as bigint;
  const marketMakerFeeBps = (await args.publicClient.readContract({
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "tradeMarketMakerFeeBps",
  })) as bigint;
  const amount = parseUnits(
    (
      maybeChainEnv(args.chain, "STAGING_CANARY_ORDER_AMOUNT") ?? "0.001"
    ).trim(),
    18,
  );
  const cost = quoteCost(EVM_SELL_SIDE, 999, amount);
  const fees = (cost * (treasuryFeeBps + marketMakerFeeBps)) / 10_000n;

  const placeOrderTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [
      args.duelKey,
      MARKET_KIND_DUEL_WINNER,
      EVM_SELL_SIDE,
      999,
      amount,
      ORDER_FLAG_GTC,
    ],
    value: cost + fees,
  });
  await waitForReceipt(args.publicClient, placeOrderTx);

  const cancelTx = await args.reporterClient.writeContract({
    chain: undefined,
    address: args.oracleAddress,
    abi: duelOracleAbi,
    functionName: "cancelDuel",
    args: [args.duelKey, "staged-live-proof-cancelled"],
  });
  await waitForReceipt(args.publicClient, cancelTx);

  const syncTx = await args.reporterClient.writeContract({
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "syncMarketFromOracle",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, syncTx);

  await waitFor(
    `${args.chain} lifecycle cancelled`,
    async () =>
      requestJson<PredictionMarketsResponse>(
        `${args.keeperUrl}/api/arena/prediction-markets/active`,
      ),
    (payload) => findCanonicalMarket(args.chain, payload)?.lifecycleStatus === "CANCELLED",
  );

  const claimTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, claimTx);

  const position = (await args.publicClient.readContract({
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [runtimeMarket.marketRef as Hash, args.canaryClient.account!.address],
  })) as readonly [bigint, bigint, bigint, bigint];
  if (position.some((value) => value !== 0n)) {
    throw new Error(
      `${args.chain} claim cleanup incomplete: ${position.map((value) => value.toString()).join(":")}`,
    );
  }

  return {
    marketRef: runtimeMarket.marketRef,
    openTx,
    createMarketTx,
    placeOrderTx,
    cancelTx,
    syncTx,
    claimTx,
  };
}

async function runAmmCanary(args: {
  chain: EvmChain;
  duelId: string;
  duelKey: Hash;
  publicClient: ReturnType<typeof createPublicClient>;
  adminClient: ReturnType<typeof createWalletClient>;
  canaryClient: ReturnType<typeof createWalletClient>;
  routerAddress: Address;
  mUsdTokenAddress: Address;
}): Promise<EvmAmmCanaryResult> {
  const beforeMarkets = (await args.publicClient.readContract({
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "getAllMarkets",
  })) as Address[];
  const frozen = (await args.publicClient.readContract({
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "configFrozen",
  })) as boolean;
  if (!frozen) {
    throw new Error(`${args.chain} AMM router config is not frozen`);
  }

  const mUsdDecimals = await readTokenDecimals(args.publicClient, args.mUsdTokenAddress);
  const initialLiquidity = parseUnits(
    maybeChainEnv(args.chain, "STAGING_CANARY_AMM_INITIAL_LIQUIDITY") ?? "10",
    mUsdDecimals,
  );
  const tradeAmount = parseUnits(
    maybeChainEnv(args.chain, "STAGING_CANARY_AMM_BUY_AMOUNT") ?? "1",
    mUsdDecimals,
  );

  const approveCreateTx = await args.adminClient.writeContract({
    chain: undefined,
    address: args.mUsdTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [args.routerAddress, initialLiquidity],
  });
  await waitForReceipt(args.publicClient, approveCreateTx);

  const createMarketTx = await args.adminClient.writeContract({
    chain: undefined,
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "create",
    args: [
      `staged-${args.chain}-amm-${args.duelId}`,
      `staged live proof internal amm ${args.duelId}`,
      "staged-live-proof",
      args.duelKey,
      false,
      900n,
      initialLiquidity,
    ],
  });
  await waitForReceipt(args.publicClient, createMarketTx);

  const afterMarkets = (await args.publicClient.readContract({
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "getAllMarkets",
  })) as Address[];

  const known = new Set(beforeMarkets.map((address) => address.toLowerCase()));
  const marketAddress =
    afterMarkets.find((address) => !known.has(address.toLowerCase())) ??
    afterMarkets[afterMarkets.length - 1];
  if (!marketAddress) {
    throw new Error(`${args.chain} AMM market address missing after create`);
  }

  const marketBefore = await args.publicClient.readContract({
    address: marketAddress,
    abi: lvrMarketAbi,
    functionName: "getMarketDetails",
  });
  const reserveYesBefore = asBigInt(marketBefore, 4, "reserveYes");
  const reserveNoBefore = asBigInt(marketBefore, 5, "reserveNo");

  const approveBuyTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: args.mUsdTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [marketAddress, tradeAmount],
  });
  await waitForReceipt(args.publicClient, approveBuyTx);

  const buyTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "buyYes",
    args: [marketAddress, tradeAmount, 0n],
  });
  await waitForReceipt(args.publicClient, buyTx);

  const marketAfter = await args.publicClient.readContract({
    address: marketAddress,
    abi: lvrMarketAbi,
    functionName: "getMarketDetails",
  });
  const reserveYesAfter = asBigInt(marketAfter, 4, "reserveYes");
  const reserveNoAfter = asBigInt(marketAfter, 5, "reserveNo");
  if (reserveYesBefore === reserveYesAfter && reserveNoBefore === reserveNoAfter) {
    throw new Error(`${args.chain} AMM trade did not move reserves`);
  }

  const yesTokenAddress = (await args.publicClient.readContract({
    address: marketAddress,
    abi: lvrMarketAbi,
    functionName: "yesToken",
  })) as Address;
  const yesBalance = (await args.publicClient.readContract({
    address: yesTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [args.canaryClient.account!.address],
  })) as bigint;
  if (yesBalance <= 0n) {
    throw new Error(`${args.chain} AMM trader received no YES inventory`);
  }

  return {
    marketAddress,
    approveCreateTx,
    createMarketTx,
    approveBuyTx,
    buyTx,
    reserveYesBefore: reserveYesBefore.toString(),
    reserveYesAfter: reserveYesAfter.toString(),
    reserveNoBefore: reserveNoBefore.toString(),
    reserveNoAfter: reserveNoAfter.toString(),
  };
}

async function runPerpsCanary(args: {
  chain: EvmChain;
  duelKey: Hash;
  publicClient: ReturnType<typeof createPublicClient>;
  reporterClient: ReturnType<typeof createWalletClient>;
  adminClient: ReturnType<typeof createWalletClient>;
  marketOperatorClient: ReturnType<typeof createWalletClient>;
  canaryClient: ReturnType<typeof createWalletClient>;
  skillOracleAddress: Address;
  perpEngineAddress: Address;
}): Promise<EvmPerpsCanaryResult> {
  const agentId = args.duelKey;
  const updateSkillTx = await args.reporterClient.writeContract({
    chain: undefined,
    address: args.skillOracleAddress,
    abi: skillOracleAbi,
    functionName: "updateAgentSkill",
    args: [agentId, 1500n, 0n],
  });
  await waitForReceipt(args.publicClient, updateSkillTx);

  const marketConfig = await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "marketConfigs",
    args: [agentId],
  });
  let createMarketTx: string | null = null;
  if (!asBoolean(marketConfig, "exists", 12)) {
    createMarketTx = await args.marketOperatorClient.writeContract({
      chain: undefined,
      address: args.perpEngineAddress,
      abi: perpEngineAbi,
      functionName: "createMarket",
      args: [agentId],
    });
    await waitForReceipt(args.publicClient, createMarketTx);
  }

  const marginTokenAddress = (await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "marginToken",
  })) as Address;
  const marginDecimals = await readTokenDecimals(args.publicClient, marginTokenAddress);
  const marketStateBefore = await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "markets",
    args: [agentId],
  });
  const insuranceTarget = parseUnits(
    maybeChainEnv(args.chain, "STAGING_CANARY_PERPS_MIN_INSURANCE") ?? "25",
    marginDecimals,
  );
  let approveInsuranceTx: string | null = null;
  let depositInsuranceTx: string | null = null;
  const insuranceFund = asBigInt(marketStateBefore, 9, "insuranceFund");
  if (insuranceFund < insuranceTarget) {
    const depositAmount = insuranceTarget - insuranceFund;
    approveInsuranceTx = await args.adminClient.writeContract({
      chain: undefined,
      address: marginTokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [args.perpEngineAddress, depositAmount],
    });
    await waitForReceipt(args.publicClient, approveInsuranceTx);

    depositInsuranceTx = await args.adminClient.writeContract({
      chain: undefined,
      address: args.perpEngineAddress,
      abi: perpEngineAbi,
      functionName: "depositInsuranceFund",
      args: [agentId, depositAmount],
    });
    await waitForReceipt(args.publicClient, depositInsuranceTx);
  }

  const existingPosition = await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "positions",
    args: [agentId, args.canaryClient.account!.address],
  });
  const existingSize = asBigInt(existingPosition, 0, "size");
  if (existingSize !== 0n) {
    const flattenTx = await args.canaryClient.writeContract({
      chain: undefined,
      address: args.perpEngineAddress,
      abi: perpEngineAbi,
      functionName: "modifyPosition",
      args: [agentId, 0n, -existingSize],
    });
    await waitForReceipt(args.publicClient, flattenTx);
  }

  const marginDelta = parseUnits(
    maybeChainEnv(args.chain, "STAGING_CANARY_PERPS_MARGIN") ?? "30",
    marginDecimals,
  );
  const sizeDelta = parseUnits(
    maybeChainEnv(args.chain, "STAGING_CANARY_PERPS_SIZE") ?? "1",
    18,
  );

  const approveMarginTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: marginTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [args.perpEngineAddress, marginDelta],
  });
  await waitForReceipt(args.publicClient, approveMarginTx);

  const openPositionTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "modifyPosition",
    args: [agentId, marginDelta, sizeDelta],
  });
  await waitForReceipt(args.publicClient, openPositionTx);

  const openedPosition = await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "positions",
    args: [agentId, args.canaryClient.account!.address],
  });
  if (asBigInt(openedPosition, 0, "size") !== sizeDelta) {
    throw new Error(`${args.chain} perps canary failed to open expected position`);
  }

  const closePositionTx = await args.canaryClient.writeContract({
    chain: undefined,
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "modifyPosition",
    args: [agentId, 0n, -sizeDelta],
  });
  await waitForReceipt(args.publicClient, closePositionTx);

  const closedPosition = await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "positions",
    args: [agentId, args.canaryClient.account!.address],
  });
  if (
    asBigInt(closedPosition, 0, "size") !== 0n ||
    asBigInt(closedPosition, 1, "margin") !== 0n
  ) {
    throw new Error(`${args.chain} perps canary position did not close cleanly`);
  }

  const marketStateAfter = await args.publicClient.readContract({
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "markets",
    args: [agentId],
  });
  if (
    asBigInt(marketStateAfter, 15, "status") !== EVM_PERPS_ACTIVE_STATUS ||
    asBigInt(marketStateAfter, 10, "badDebt") !== 0n
  ) {
    throw new Error(`${args.chain} perps market is not healthy after canary`);
  }

  return {
    agentId,
    updateSkillTx,
    createMarketTx,
    approveMarginTx,
    depositInsuranceTx,
    approveInsuranceTx,
    openPositionTx,
    closePositionTx,
  };
}

export async function runEvmCanary(chain: EvmChain): Promise<EvmCanaryResult> {
  const duelId = requireEnv("HYPERBET_STAGED_PROOF_DUEL_ID");
  const duelKeyHex = normalizeHex32(requireEnv("HYPERBET_STAGED_PROOF_DUEL_KEY"));
  const duelKey = `0x${duelKeyHex}` as Hash;
  const rpcUrl = requireChainEnv(chain, "STAGING_RPC_URL");
  const keeperUrl = requireChainEnv(chain, "KEEPER_STAGING_URL").replace(/\/$/, "");

  const canary = privateKeyToAccount(
    requireChainEnv(chain, "STAGING_CANARY_PRIVATE_KEY") as `0x${string}`,
  );
  const reporter = privateKeyToAccount(
    requireChainEnv(chain, "STAGING_REPORTER_PRIVATE_KEY") as `0x${string}`,
  );
  const admin = privateKeyToAccount(
    requireChainEnv(chain, "STAGING_ADMIN_PRIVATE_KEY") as `0x${string}`,
  );
  const marketOperator = privateKeyToAccount(
    (
      maybeChainEnv(chain, "STAGING_MARKET_OPERATOR_PRIVATE_KEY") ??
      requireChainEnv(chain, "STAGING_ADMIN_PRIVATE_KEY")
    ) as `0x${string}`,
  );
  const oracleAddress = requireChainEnv(chain, "STAGING_DUEL_ORACLE_ADDRESS") as Address;
  const clobAddress = requireChainEnv(chain, "STAGING_GOLD_CLOB_ADDRESS") as Address;
  const routerAddress = requireChainEnv(chain, "STAGING_GOLD_AMM_ROUTER_ADDRESS") as Address;
  const mUsdTokenAddress = requireChainEnv(chain, "STAGING_MUSD_TOKEN_ADDRESS") as Address;
  const skillOracleAddress = requireChainEnv(chain, "STAGING_SKILL_ORACLE_ADDRESS") as Address;
  const perpEngineAddress = requireChainEnv(chain, "STAGING_PERP_ENGINE_ADDRESS") as Address;

  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const reporterClient = createWalletClient({
    account: reporter,
    transport: http(rpcUrl),
  });
  const adminClient = createWalletClient({
    account: admin,
    transport: http(rpcUrl),
  });
  const marketOperatorClient = createWalletClient({
    account: marketOperator,
    transport: http(rpcUrl),
  });
  const canaryClient = createWalletClient({
    account: canary,
    transport: http(rpcUrl),
  });

  const pm = await runPmCanary({
    chain,
    duelId,
    duelKeyHex,
    duelKey,
    publicClient,
    reporterClient,
    canaryClient,
    oracleAddress,
    clobAddress,
    keeperUrl,
  });
  const perps = await runPerpsCanary({
    chain,
    duelKey,
    publicClient,
    reporterClient,
    adminClient,
    marketOperatorClient,
    canaryClient,
    skillOracleAddress,
    perpEngineAddress,
  });
  const amm = await runAmmCanary({
    chain,
    duelId,
    duelKey,
    publicClient,
    adminClient,
    canaryClient,
    routerAddress,
    mUsdTokenAddress,
  });

  return {
    duelId,
    duelKeyHex,
    pm,
    perps,
    amm,
  };
}
