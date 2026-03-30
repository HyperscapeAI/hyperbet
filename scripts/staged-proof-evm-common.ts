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
import {
  firstNonEmptyValue,
  resolveEvmAcceptanceRuntime,
} from "./testnet-acceptance-env";

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
  makerOrderTx: string;
  takerOrderTx: string;
  cancelTx: string;
  syncTx: string;
  makerClaimTx: string;
  takerClaimTx: string;
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

type ScriptPublicClient = ReturnType<typeof createPublicClient>;
type ScriptWalletClient = ReturnType<typeof createWalletClient>;

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

function logCanaryStep(chain: EvmChain, step: string): void {
  console.error(`[acceptance:${chain}] ${step}`);
}

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

function maybeAcceptanceChainSetting(
  chain: EvmChain,
  suffix: string,
): string | null {
  const upper = chain.toUpperCase();
  return firstNonEmptyValue(
    process.env[`HYPERBET_${upper}_TESTNET_${suffix}`],
    process.env[`HYPERBET_${upper}_STAGING_${suffix}`],
    maybeChainEnv(chain, `TESTNET_${suffix}`),
    maybeChainEnv(chain, `STAGING_${suffix}`),
  );
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
  const runtime = resolveEvmAcceptanceRuntime(chain, process.env);
  const keeperUrl = runtime.keeperUrl?.replace(/\/$/, "");
  const publishKey = maybeAcceptanceChainSetting(chain, "STREAM_PUBLISH_KEY");
  if (!keeperUrl || !publishKey) {
    throw new Error(`${chain} acceptance keeper URL or publish key is missing`);
  }
  await requestJson(`${keeperUrl}/api/streaming/state/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-arena-write-key": publishKey,
    },
    body: JSON.stringify(buildControlledCycle(chain, duelId, duelKeyHex)),
  });
}

async function waitForReceipt(client: ScriptPublicClient, hash: Hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`EVM transaction reverted: ${hash}`);
  }
  return receipt;
}

async function readContractLoose<T>(
  client: ScriptPublicClient,
  parameters: Record<string, unknown>,
): Promise<T> {
  return client.readContract(parameters as never) as Promise<T>;
}

async function writeContractLoose(
  client: ScriptWalletClient,
  parameters: Record<string, unknown>,
): Promise<Hash> {
  if (!client.account) {
    throw new Error("Wallet client account is required for acceptance canaries");
  }
  return client.writeContract({
    ...(parameters as Record<string, unknown>),
    account: client.account,
  } as never) as Promise<Hash>;
}

async function readTokenDecimals(
  client: ScriptPublicClient,
  tokenAddress: Address,
): Promise<number> {
  const decimals = (await readContractLoose<number>(client, {
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
  publicClient: ScriptPublicClient;
  reporterClient: ScriptWalletClient;
  marketOperatorClient: ScriptWalletClient;
  pauserClient: ScriptWalletClient;
  canaryClient: ScriptWalletClient;
  matcherClient: ScriptWalletClient;
  oracleAddress: Address;
  clobAddress: Address;
}): Promise<EvmPmCanaryResult> {
  const latestBlock = await args.publicClient.getBlock({ blockTag: "latest" });
  const now = Number(latestBlock.timestamp);
  const tag = chainAgentTag(args.chain);

  const openTx = await writeContractLoose(args.reporterClient, {
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
  logCanaryStep(args.chain, `pm open duel tx=${openTx}`);

  const createMarketTx = await writeContractLoose(args.marketOperatorClient, {
    chain: undefined,
    address: args.clobAddress,
    abi: goldClobAdminAbi,
    functionName: "createMarketForDuel",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, createMarketTx);
  logCanaryStep(args.chain, `pm create market tx=${createMarketTx}`);
  const marketRef = (await readContractLoose<Hash>(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  })) as Hash;
  const marketStateAfterCreate = await readContractLoose(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "getMarket",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  if (
    !asBoolean(marketStateAfterCreate, "exists") ||
    asBigInt(marketStateAfterCreate, 2, "status") !== 1n
  ) {
    throw new Error(`${args.chain} PM market did not enter OPEN after creation`);
  }

  const treasuryFeeBps = (await readContractLoose<bigint>(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "tradeTreasuryFeeBps",
  })) as bigint;
  const marketMakerFeeBps = (await readContractLoose<bigint>(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "tradeMarketMakerFeeBps",
  })) as bigint;
  const amount = parseUnits(
    (maybeAcceptanceChainSetting(args.chain, "CANARY_ORDER_AMOUNT") ?? "0.001").trim(),
    18,
  );
  const makerSide = EVM_SELL_SIDE;
  const takerSide = 1;
  const tradePrice = 600;
  const makerCost = quoteCost(makerSide, tradePrice, amount);
  const takerCost = quoteCost(takerSide, tradePrice, amount);
  const makerFees = (makerCost * (treasuryFeeBps + marketMakerFeeBps)) / 10_000n;
  const takerFees = (takerCost * (treasuryFeeBps + marketMakerFeeBps)) / 10_000n;

  const makerOrderTx = await writeContractLoose(args.matcherClient, {
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [
      args.duelKey,
      MARKET_KIND_DUEL_WINNER,
      makerSide,
      tradePrice,
      amount,
      ORDER_FLAG_GTC,
    ],
    value: makerCost + makerFees,
  });
  await waitForReceipt(args.publicClient, makerOrderTx);

  const takerOrderTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [
      args.duelKey,
      MARKET_KIND_DUEL_WINNER,
      takerSide,
      tradePrice,
      amount,
      ORDER_FLAG_GTC,
    ],
    value: takerCost + takerFees,
  });
  await waitForReceipt(args.publicClient, takerOrderTx);
  logCanaryStep(args.chain, `pm matched trade makerTx=${makerOrderTx} takerTx=${takerOrderTx}`);

  const makerPositionAfterMatch = (await readContractLoose<
    readonly [bigint, bigint, bigint, bigint]
  >(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketRef, args.matcherClient.account!.address],
  })) as readonly [bigint, bigint, bigint, bigint];
  const takerPositionAfterMatch = (await readContractLoose<
    readonly [bigint, bigint, bigint, bigint]
  >(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketRef, args.canaryClient.account!.address],
  })) as readonly [bigint, bigint, bigint, bigint];
  if (makerPositionAfterMatch[1] <= 0n || takerPositionAfterMatch[0] <= 0n) {
    throw new Error(
      `${args.chain} PM matched trade did not create expected maker/taker exposure`,
    );
  }

  const cancelTx = await writeContractLoose(args.pauserClient, {
    chain: undefined,
    address: args.oracleAddress,
    abi: duelOracleAbi,
    functionName: "cancelDuel",
    args: [args.duelKey, "staged-live-proof-cancelled"],
  });
  await waitForReceipt(args.publicClient, cancelTx);

  const syncTx = await writeContractLoose(args.reporterClient, {
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "syncMarketFromOracle",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, syncTx);
  logCanaryStep(args.chain, `pm cancel+sync txs=${cancelTx},${syncTx}`);
  const marketStateAfterSync = await readContractLoose(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "getMarket",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  if (asBigInt(marketStateAfterSync, 2, "status") !== 4n) {
    throw new Error(`${args.chain} PM market did not enter CANCELLED after sync`);
  }

  const makerClaimTx = await writeContractLoose(args.matcherClient, {
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, makerClaimTx);

  const takerClaimTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [args.duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(args.publicClient, takerClaimTx);
  logCanaryStep(args.chain, `pm claims makerTx=${makerClaimTx} takerTx=${takerClaimTx}`);

  const makerPosition = (await readContractLoose<
    readonly [bigint, bigint, bigint, bigint]
  >(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketRef, args.matcherClient.account!.address],
  })) as readonly [bigint, bigint, bigint, bigint];
  const takerPosition = (await readContractLoose<
    readonly [bigint, bigint, bigint, bigint]
  >(args.publicClient, {
    address: args.clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketRef, args.canaryClient.account!.address],
  })) as readonly [bigint, bigint, bigint, bigint];
  if (makerPosition.some((value) => value !== 0n) || takerPosition.some((value) => value !== 0n)) {
    throw new Error(
      `${args.chain} claim cleanup incomplete: maker=${makerPosition.map((value) => value.toString()).join(":")} taker=${takerPosition.map((value) => value.toString()).join(":")}`,
    );
  }

  return {
    marketRef,
    openTx,
    createMarketTx,
    makerOrderTx,
    takerOrderTx,
    cancelTx,
    syncTx,
    makerClaimTx,
    takerClaimTx,
  };
}

async function runAmmCanary(args: {
  chain: EvmChain;
  duelId: string;
  duelKey: Hash;
  publicClient: ScriptPublicClient;
  adminClient: ScriptWalletClient;
  canaryClient: ScriptWalletClient;
  routerAddress: Address;
  mUsdTokenAddress: Address;
}): Promise<EvmAmmCanaryResult> {
  const beforeMarkets = (await readContractLoose<Address[]>(args.publicClient, {
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "getAllMarkets",
  })) as Address[];
  const frozen = (await readContractLoose<boolean>(args.publicClient, {
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "configFrozen",
  })) as boolean;
  if (!frozen) {
    throw new Error(`${args.chain} AMM router config is not frozen`);
  }

  const mUsdDecimals = await readTokenDecimals(args.publicClient, args.mUsdTokenAddress);
  const initialLiquidity = parseUnits(
    maybeAcceptanceChainSetting(args.chain, "CANARY_AMM_INITIAL_LIQUIDITY") ?? "10",
    mUsdDecimals,
  );
  const tradeAmount = parseUnits(
    maybeAcceptanceChainSetting(args.chain, "CANARY_AMM_BUY_AMOUNT") ?? "1",
    mUsdDecimals,
  );

  const approveCreateTx = await writeContractLoose(args.adminClient, {
    chain: undefined,
    address: args.mUsdTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [args.routerAddress, initialLiquidity],
  });
  await waitForReceipt(args.publicClient, approveCreateTx);
  logCanaryStep(args.chain, `amm approve create tx=${approveCreateTx}`);

  const createMarketTx = await writeContractLoose(args.adminClient, {
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
  logCanaryStep(args.chain, `amm create market tx=${createMarketTx}`);

  const afterMarkets = (await readContractLoose<Address[]>(args.publicClient, {
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

  const marketBefore = await readContractLoose(args.publicClient, {
    address: marketAddress,
    abi: lvrMarketAbi,
    functionName: "getMarketDetails",
  });
  const reserveYesBefore = asBigInt(marketBefore, 4, "reserveYes");
  const reserveNoBefore = asBigInt(marketBefore, 5, "reserveNo");

  const approveBuyTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: args.mUsdTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [args.routerAddress, tradeAmount],
  });
  await waitForReceipt(args.publicClient, approveBuyTx);
  logCanaryStep(args.chain, `amm approve buy tx=${approveBuyTx}`);

  const buyTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: args.routerAddress,
    abi: routerAbi,
    functionName: "buyYes",
    args: [marketAddress, tradeAmount, 0n],
  });
  await waitForReceipt(args.publicClient, buyTx);
  logCanaryStep(args.chain, `amm buy yes tx=${buyTx}`);

  const marketAfter = await readContractLoose(args.publicClient, {
    address: marketAddress,
    abi: lvrMarketAbi,
    functionName: "getMarketDetails",
  });
  const reserveYesAfter = asBigInt(marketAfter, 4, "reserveYes");
  const reserveNoAfter = asBigInt(marketAfter, 5, "reserveNo");
  if (reserveYesBefore === reserveYesAfter && reserveNoBefore === reserveNoAfter) {
    throw new Error(`${args.chain} AMM trade did not move reserves`);
  }

  const yesTokenAddress = (await readContractLoose<Address>(args.publicClient, {
    address: marketAddress,
    abi: lvrMarketAbi,
    functionName: "yesToken",
  })) as Address;
  const yesBalance = (await readContractLoose<bigint>(args.publicClient, {
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
  publicClient: ScriptPublicClient;
  reporterClient: ScriptWalletClient;
  adminClient: ScriptWalletClient;
  marketOperatorClient: ScriptWalletClient;
  canaryClient: ScriptWalletClient;
  skillOracleAddress: Address;
  perpEngineAddress: Address;
}): Promise<EvmPerpsCanaryResult> {
  const agentId = args.duelKey;
  const updateSkillTx = await writeContractLoose(args.reporterClient, {
    chain: undefined,
    address: args.skillOracleAddress,
    abi: skillOracleAbi,
    functionName: "updateAgentSkill",
    args: [agentId, 1500n, 0n],
  });
  await waitForReceipt(args.publicClient, updateSkillTx);
  logCanaryStep(args.chain, `perps update skill tx=${updateSkillTx}`);

  const marketConfig = await readContractLoose(args.publicClient, {
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "marketConfigs",
    args: [agentId],
  });
  let createMarketTx: Hash | null = null;
  if (!asBoolean(marketConfig, "exists", 12)) {
    createMarketTx = await writeContractLoose(args.marketOperatorClient, {
      chain: undefined,
      address: args.perpEngineAddress,
      abi: perpEngineAbi,
      functionName: "createMarket",
      args: [agentId],
    });
    await waitForReceipt(args.publicClient, createMarketTx);
    logCanaryStep(args.chain, `perps create market tx=${createMarketTx}`);
  }

  const marginTokenAddress = (await readContractLoose<Address>(args.publicClient, {
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "marginToken",
  })) as Address;
  const marginDecimals = await readTokenDecimals(args.publicClient, marginTokenAddress);
  const marketStateBefore = await readContractLoose(args.publicClient, {
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "markets",
    args: [agentId],
  });
  const insuranceTarget = parseUnits(
    maybeAcceptanceChainSetting(args.chain, "CANARY_PERPS_MIN_INSURANCE") ?? "25",
    marginDecimals,
  );
  let approveInsuranceTx: Hash | null = null;
  let depositInsuranceTx: Hash | null = null;
  const insuranceFund = asBigInt(marketStateBefore, 9, "insuranceFund");
  if (insuranceFund < insuranceTarget) {
    const depositAmount = insuranceTarget - insuranceFund;
    approveInsuranceTx = await writeContractLoose(args.adminClient, {
      chain: undefined,
      address: marginTokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [args.perpEngineAddress, depositAmount],
    });
    await waitForReceipt(args.publicClient, approveInsuranceTx);

    depositInsuranceTx = await writeContractLoose(args.adminClient, {
      chain: undefined,
      address: args.perpEngineAddress,
      abi: perpEngineAbi,
      functionName: "depositInsuranceFund",
      args: [agentId, depositAmount],
    });
    await waitForReceipt(args.publicClient, depositInsuranceTx);
    logCanaryStep(
      args.chain,
      `perps insurance txs=${approveInsuranceTx},${depositInsuranceTx}`,
    );
  }

  const existingPosition = await readContractLoose(args.publicClient, {
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "positions",
    args: [agentId, args.canaryClient.account!.address],
  });
  const existingSize = asBigInt(existingPosition, 0, "size");
  if (existingSize !== 0n) {
    const flattenTx = await writeContractLoose(args.canaryClient, {
      chain: undefined,
      address: args.perpEngineAddress,
      abi: perpEngineAbi,
      functionName: "modifyPosition",
      args: [agentId, 0n, -existingSize],
    });
    await waitForReceipt(args.publicClient, flattenTx);
  }

  const marginDelta = parseUnits(
    maybeAcceptanceChainSetting(args.chain, "CANARY_PERPS_MARGIN") ?? "30",
    marginDecimals,
  );
  const sizeDelta = parseUnits(
    maybeAcceptanceChainSetting(args.chain, "CANARY_PERPS_SIZE") ?? "1",
    18,
  );

  const approveMarginTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: marginTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [args.perpEngineAddress, marginDelta],
  });
  await waitForReceipt(args.publicClient, approveMarginTx);
  logCanaryStep(args.chain, `perps approve margin tx=${approveMarginTx}`);

  const openPositionTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "modifyPosition",
    args: [agentId, marginDelta, sizeDelta],
  });
  await waitForReceipt(args.publicClient, openPositionTx);
  logCanaryStep(args.chain, `perps open position tx=${openPositionTx}`);

  const openedPosition = await readContractLoose(args.publicClient, {
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "positions",
    args: [agentId, args.canaryClient.account!.address],
  });
  if (asBigInt(openedPosition, 0, "size") !== sizeDelta) {
    throw new Error(`${args.chain} perps canary failed to open expected position`);
  }

  const closePositionTx = await writeContractLoose(args.canaryClient, {
    chain: undefined,
    address: args.perpEngineAddress,
    abi: perpEngineAbi,
    functionName: "modifyPosition",
    args: [agentId, 0n, -sizeDelta],
  });
  await waitForReceipt(args.publicClient, closePositionTx);
  logCanaryStep(args.chain, `perps close position tx=${closePositionTx}`);

  const closedPosition = await readContractLoose(args.publicClient, {
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

  const marketStateAfter = await readContractLoose(args.publicClient, {
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
  const runtime = resolveEvmAcceptanceRuntime(chain, process.env);
  if (
    !runtime.canaryPrivateKey ||
    !runtime.matcherPrivateKey ||
    !runtime.reporterPrivateKey ||
    !runtime.adminPrivateKey ||
    !runtime.marketOperatorPrivateKey ||
    !runtime.pauserPrivateKey
  ) {
    throw new Error(`${chain} acceptance wallet env is incomplete`);
  }
  const rpcUrl = runtime.rpcUrl;

  const canary = privateKeyToAccount(runtime.canaryPrivateKey as `0x${string}`);
  const matcher = privateKeyToAccount(runtime.matcherPrivateKey as `0x${string}`);
  const reporter = privateKeyToAccount(runtime.reporterPrivateKey as `0x${string}`);
  const admin = privateKeyToAccount(runtime.adminPrivateKey as `0x${string}`);
  const marketOperator = privateKeyToAccount(
    runtime.marketOperatorPrivateKey as `0x${string}`,
  );
  const pauser = privateKeyToAccount(runtime.pauserPrivateKey as `0x${string}`);
  const oracleAddress = runtime.duelOracleAddress as Address;
  const clobAddress = runtime.goldClobAddress as Address;
  const routerAddress = runtime.goldAmmRouterAddress as Address;
  const mUsdTokenAddress = runtime.mUsdTokenAddress as Address;
  const skillOracleAddress = runtime.skillOracleAddress as Address;
  const perpEngineAddress = runtime.perpEngineAddress as Address;

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  }) as ScriptPublicClient;
  const reporterClient = createWalletClient({
    account: reporter,
    transport: http(rpcUrl),
  }) as ScriptWalletClient;
  const adminClient = createWalletClient({
    account: admin,
    transport: http(rpcUrl),
  }) as ScriptWalletClient;
  const marketOperatorClient = createWalletClient({
    account: marketOperator,
    transport: http(rpcUrl),
  }) as ScriptWalletClient;
  const pauserClient = createWalletClient({
    account: pauser,
    transport: http(rpcUrl),
  }) as ScriptWalletClient;
  const canaryClient = createWalletClient({
    account: canary,
    transport: http(rpcUrl),
  }) as ScriptWalletClient;
  const matcherClient = createWalletClient({
    account: matcher,
    transport: http(rpcUrl),
  }) as ScriptWalletClient;

  const pm = await runPmCanary({
    chain,
    duelId,
    duelKeyHex,
    duelKey,
    publicClient,
    reporterClient,
    marketOperatorClient,
    pauserClient,
    canaryClient,
    matcherClient,
    oracleAddress,
    clobAddress,
  });
  logCanaryStep(chain, "pm complete");
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
  logCanaryStep(chain, "perps complete");
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
  logCanaryStep(chain, "amm complete");

  return {
    duelId,
    duelKeyHex,
    pm,
    perps,
    amm,
  };
}
