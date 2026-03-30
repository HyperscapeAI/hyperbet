import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  parseUnits,
  stringToHex,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

const DEFAULT_RPC = "https://avax-fuji.g.alchemy.com/v2/h85R-i8JMJTM3RRVgxLza";
const DEFAULT_ORACLE = "0x2ab7C67D6E3c0cb2b84AA8d6f26475FDaDE0a920";
const DEFAULT_GOLD_CLOB = "0xBc25103CfE182B67523c3159b6e3f5804dC4fA94";
const DEFAULT_KEEPER_URL = "http://127.0.0.1:5555";

const MARKET_KIND_DUEL_WINNER = 0;
const EVM_STATUS_BETTING_OPEN = 2;
const SIDE_SELL = 2;
const SIDE_BUY = 1;
const ORDER_FLAG_GTC = 0x01;
const SCENARIO_UNMATCHED = "unmatched-gtc";
const SCENARIO_PARTIAL_MATCH = "partial-match-gtc";
const SCENARIO_FULL_MATCH = "full-match-gtc";
const PRICE = 999;
const AMOUNT = parseUnits("0.001", 18);

const chain = {
  id: 43113,
  name: "avax-fuji",
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [DEFAULT_RPC] },
    public: { http: [DEFAULT_RPC] },
  },
};

function hasArg(name) {
  return process.argv.includes(name);
}

function normalizeOptionalBoolean(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function allowDefaults() {
  return hasArg("--allow-defaults") || normalizeOptionalBoolean(process.env.AVAX_FUJI_ALLOW_DEFAULTS);
}

function parseScenario() {
  const raw = (process.env.AVAX_FUJI_BOOTSTRAP_SCENARIO || SCENARIO_UNMATCHED).trim();
  if (
    raw !== SCENARIO_UNMATCHED &&
    raw !== SCENARIO_PARTIAL_MATCH &&
    raw !== SCENARIO_FULL_MATCH
  ) {
    throw new Error(
      `invalid AVAX_FUJI_BOOTSTRAP_SCENARIO="${raw}", expected one of ${SCENARIO_UNMATCHED}, ${SCENARIO_PARTIAL_MATCH}, ${SCENARIO_FULL_MATCH}`,
    );
  }
  return raw;
}

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value && value.length ? value : fallback;
}

function requiredEnvWithDefaults(names, fallback, allowDefaultValues) {
  const candidateNames = Array.isArray(names) ? names : [names];
  for (const name of candidateNames) {
    const value = optionalEnv(name);
    if (value) {
      return value;
    }
  }

  if (allowDefaultValues && fallback) {
    return fallback;
  }

  const label = candidateNames.join(" or ");
  const defaultHint = fallback ? " (or enable --allow-defaults / AVAX_FUJI_ALLOW_DEFAULTS)" : "";
  throw new Error(`required environment variable missing: ${label}${defaultHint}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`required environment variable missing: ${name}`);
  }
  return value;
}

function readFirstExistingJson(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  }
  throw new Error(`missing contract artifact, checked: ${candidates.join(", ")}`);
}

function loadAbi() {
  const candidates = {
    oracle: [
      path.join(ROOT, "packages/hyperbet-sdk/src/evm/abi/DuelOutcomeOracle.json"),
      path.join(ROOT, "docs/release/abi/duel_outcome_oracle.abi.json"),
      path.join(ROOT, "docs/release/abi/duel_outcome_oracle.json"),
    ],
    clob: [
      path.join(ROOT, "packages/hyperbet-sdk/src/evm/abi/GoldClob.json"),
      path.join(ROOT, "docs/release/abi/gold_clob.abi.json"),
      path.join(ROOT, "docs/release/abi/gold_clob.json"),
    ],
  };

  return {
    oracleAbi: readFirstExistingJson(candidates.oracle).abi,
    goldClobAbi: readFirstExistingJson(candidates.clob).abi,
  };
}

const { oracleAbi, goldClobAbi } = loadAbi();

const hashLabel = (label) => keccak256(stringToHex(label));

function randomHex32() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function quoteCost(side, price, amount) {
  const component = BigInt(side === 1 ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function isZeroTupleValue(value) {
  return value === 0n || value === 0;
}

function isZeroPosition(position) {
  return position.every((value) => value === 0n);
}

function tupleValue(record, name, index) {
  if (record && typeof record === "object") {
    if (Array.isArray(record)) {
      return record[index];
    }
    if (name in record) {
      return record[name];
    }
    const fallback = record[index];
    return fallback;
  }
  return undefined;
}

function buildPublishHeaders(publishKey) {
  const headers = { "content-type": "application/json" };
  if (publishKey) {
    headers["x-arena-write-key"] = publishKey;
  }
  return headers;
}

export { buildPublishHeaders, publishState };

async function readMarketPosition(publicClient, abi, clobAddress, marketKey, traderAddress) {
  const position = await publicClient.readContract({
    address: clobAddress,
    abi,
    functionName: "positions",
    args: [marketKey, traderAddress],
  });

  return {
    raw: position,
    hasResidual: !isZeroPosition(position),
  };
}

async function readOrderState(publicClient, abi, clobAddress, marketKey, orderId) {
  const order = await publicClient.readContract({
    address: clobAddress,
    abi,
    functionName: "orders",
    args: [marketKey, orderId],
  });

  return {
    raw: order,
    active: Boolean(tupleValue(order, "active", 8)),
    id: tupleValue(order, "id", 0) ?? null,
    filled: tupleValue(order, "filled", 5) ?? null,
    amount: tupleValue(order, "amount", 4) ?? null,
    side: tupleValue(order, "side", 1) ?? null,
    maker: tupleValue(order, "maker", 3) ?? null,
    isEmpty: Boolean(
      isZeroTupleValue(tupleValue(order, "id", 0)) &&
        isZeroTupleValue(tupleValue(order, "amount", 4)),
    ),
  };
}

function extractPlacedOrderId({
  receipt,
  abi,
  marketKey,
}) {
  try {
    const events = parseEventLogs({ abi, logs: receipt.logs });
    for (const event of events) {
      if (event.eventName !== "OrderPlaced") {
        continue;
      }
      if (
        (event.args.marketKey || "").toLowerCase() === marketKey.toLowerCase() &&
        event.args.orderId != null
      ) {
        return event.args.orderId;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function pickMarketOperatorClient({
  publicClient,
  oracleAddress,
  goldClobAbi,
  goldClobAddress,
  candidates,
}) {
  const requiredRole = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "MARKET_OPERATOR_ROLE",
  });

  for (const candidate of candidates) {
    const hasRole = await publicClient.readContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "hasRole",
      args: [requiredRole, candidate.account.address],
    });
    if (hasRole) {
      return candidate;
    }
  }

  const candidateAddresses = candidates.map((candidate) => candidate.account.address).join(", ");
  throw new Error(
    `no configured operator key has MARKET_OPERATOR_ROLE (checked: [${candidateAddresses}]) on oracle=${oracleAddress}, clob=${goldClobAddress}`,
  );
}

function normalizePrivateKey(hex) {
  const trimmed = hex.trim();
  const bare = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(bare)) {
    throw new Error(`invalid private key format: ${trimmed}`);
  }
  if (bare.length > 64) {
    throw new Error(`invalid private key length: ${trimmed}`);
  }
  return `0x${bare.padStart(64, "0")}`;
}

function normalizeAddress(raw) {
  const normalized = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`invalid address format: ${normalized}`);
  }
  return `0x${normalized.slice(2).toLowerCase()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return JSON.parse(body);
}

async function publishState(keeps, duelId, duelKeyHex) {
  const payload = {
    cycle: {
      cycleId: `fresh-avax-${duelId}`,
      phase: "ANNOUNCEMENT",
      duelId,
      duelKeyHex,
      cycleStartTime: Date.now() - 90_000,
      phaseStartTime: Date.now() - 5_000,
      phaseEndTime: Date.now() + 300_000,
      betOpenTime: Date.now() - 15_000,
      betCloseTime: Date.now() + 300_000,
      fightStartTime: Date.now() + 60_000,
      duelEndTime: null,
      countdown: 300,
      timeRemaining: 300_000,
      winnerId: null,
      winnerName: null,
      winReason: null,
      seed: null,
      replayHash: null,
      agent1: {
        id: `stage-avax-${duelId}-a`,
        name: "Stage Agent A",
        provider: "Hyperscape",
        model: "alpha",
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
        id: `stage-avax-${duelId}-b`,
        name: "Stage Agent B",
        provider: "OpenRouter",
        model: "beta",
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

  const publishHeaders = buildPublishHeaders(keeps.publishKey);
  await requestJson(`${keeps.keeperUrl}/api/streaming/state/publish`, {
    method: "POST",
    headers: publishHeaders,
    body: JSON.stringify(payload),
  });
}

async function waitForMarketLifecycle(keeps, duelKeyHex, lifecycleStatus) {
  for (let i = 0; i < 40; i += 1) {
    const state = await requestJson(`${keeps.keeperUrl}/api/arena/prediction-markets/active`);
    const target = (state.markets || []).find(
      (entry) =>
        entry.chainKey === "avax" &&
        (entry.duelKey || "").toLowerCase() === duelKeyHex &&
        entry.lifecycleStatus === lifecycleStatus,
    );
    const sample = (state.markets || [])
      .filter((entry) => entry.chainKey === "avax")
      .map((entry) => `${entry.duelKey?.slice(0, 10)}:${entry.lifecycleStatus}`)
      .join(" | ");
    console.log("active sample", sample);
    if (target) {
      return {
        target,
        marketRef: target.marketRef || target.marketId || target.marketKey || null,
      };
    }
    await sleep(2000);
  }
  throw new Error(`timeout waiting for ${lifecycleStatus} avax market for duel ${duelKeyHex}`);
}

async function waitForTx(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${String(receipt.transactionHash)}`);
  }
  return receipt;
}

async function main() {
  const permitDefaults = allowDefaults();
  const rpcUrl = requiredEnvWithDefaults(
    ["AVAX_FUJI_RPC", "AVAX_RPC_URL"],
    permitDefaults ? DEFAULT_RPC : null,
    permitDefaults,
  );
  const oracleAddress = normalizeAddress(
    requiredEnvWithDefaults(
      "AVAX_DUEL_ORACLE_ADDRESS",
      permitDefaults ? DEFAULT_ORACLE : null,
      permitDefaults,
    ),
  );
  const goldClobAddress = normalizeAddress(
    requiredEnvWithDefaults(
      "AVAX_GOLD_CLOB_ADDRESS",
      permitDefaults ? DEFAULT_GOLD_CLOB : null,
      permitDefaults,
    ),
  );
  const keeperUrl = requiredEnvWithDefaults(
    "KEEPER_URL",
    permitDefaults ? DEFAULT_KEEPER_URL : null,
    permitDefaults,
  ).replace(/\/$/, "");

  const publishKey = optionalEnv("HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY");
  const publishMode = publishKey ? "keyed" : "unkeyed";
  const scenario = parseScenario();
  const scenarioMatchAmount =
    scenario === SCENARIO_PARTIAL_MATCH ? AMOUNT / 2n : scenario === SCENARIO_FULL_MATCH ? AMOUNT : 0n;

  const reporterKey = requiredEnv("REPORTER_PRIVATE_KEY");
  const operatorKey = requiredEnv("MARKET_OPERATOR_PRIVATE_KEY");
  const canaryKey = requiredEnv("CANARY_PRIVATE_KEY");
  const matchingTraderKey =
    scenario === SCENARIO_UNMATCHED
      ? null
      : (optionalEnv("MATCHER_PRIVATE_KEY") || optionalEnv("AVAX_MATCHING_TRADER_PRIVATE_KEY"));
  const matcherKey = matchingTraderKey;
  if ((scenario === SCENARIO_PARTIAL_MATCH || scenario === SCENARIO_FULL_MATCH) && !matcherKey) {
    throw new Error(
      `missing environment variable MATCHER_PRIVATE_KEY or AVAX_MATCHING_TRADER_PRIVATE_KEY for scenario=${scenario}`,
    );
  }

  chain.rpcUrls.default.http = [rpcUrl];
  chain.rpcUrls.public.http = [rpcUrl];

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const reporter = privateKeyToAccount(normalizePrivateKey(reporterKey));
  const operator = privateKeyToAccount(normalizePrivateKey(operatorKey));
  const canary = privateKeyToAccount(normalizePrivateKey(canaryKey));

  const reporterClient = createWalletClient({
    account: reporter,
    chain,
    transport: http(rpcUrl),
  });
  const operatorClient = createWalletClient({
    account: operator,
    chain,
    transport: http(rpcUrl),
  });
  const canaryClient = createWalletClient({
    account: canary,
    chain,
    transport: http(rpcUrl),
  });
  const matcherClient =
    matcherKey != null ? createWalletClient({
      account: privateKeyToAccount(normalizePrivateKey(matcherKey)),
      chain,
      transport: http(rpcUrl),
    }) : null;
  if (matcherClient && matcherClient.account.address.toLowerCase() === canary.address.toLowerCase()) {
    throw new Error("matching trader must be different from canary account");
  }

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const openTs = block.timestamp - 15n;
  const closeTs = openTs + 300n;
  const startTs = closeTs + 60n;
  const duelId = `${Date.now()}`;
  const duelKey = randomHex32();
  const duelKeyHex = duelKey.replace(/^0x/, "");

  console.log(`using rpc=${rpcUrl}`);
  console.log(`using oracle=${oracleAddress}`);
  console.log(`using clob=${goldClobAddress}`);
  console.log(`using keeper=${keeperUrl}`);
  console.log(`publishMode=${publishMode}`);
  console.log(`scenario=${scenario}`);
  console.log(`using duel=${duelKey}`);
  console.log(`matchingTrader=${matcherClient?.account?.address ?? "none"}`);

  const balances = {
    reporter: await publicClient.getBalance({ address: reporter.address }),
    operator: await publicClient.getBalance({ address: operator.address }),
    canary: await publicClient.getBalance({ address: canary.address }),
  };
  console.log("balances", balances);

  const upsertTx = await reporterClient.writeContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      hashLabel("avax-agent-a"),
      hashLabel("avax-agent-b"),
      openTs,
      closeTs,
      startTs,
      `${duelId}-open`,
      EVM_STATUS_BETTING_OPEN,
    ],
  });
  await waitForTx(publicClient, upsertTx, "upsertDuel");

  const marketOperatorClient = await pickMarketOperatorClient({
    publicClient,
    oracleAddress,
    goldClobAbi,
    goldClobAddress,
    candidates: [
      { client: operatorClient, account: operator },
      { client: reporterClient, account: reporter },
    ],
  });

  const createTx = await marketOperatorClient.client.writeContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "createMarketForDuel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForTx(publicClient, createTx, "createMarketForDuel");

  const marketKey = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  console.log("marketKey", marketKey);

  await publishState({ keeperUrl, publishKey }, duelId, duelKeyHex);

  const open = await waitForMarketLifecycle({ keeperUrl }, duelKeyHex, "OPEN");
  console.log("market is OPEN in keeper", {
    lifecycle: open.target.lifecycleStatus,
    marketRef: open.marketRef,
  });

  const tradeTreasuryFeeBps = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "tradeTreasuryFeeBps",
  });
  const tradeMarketMakerFeeBps = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "tradeMarketMakerFeeBps",
  });
  const feeBps = tradeTreasuryFeeBps + tradeMarketMakerFeeBps;
  const cost = quoteCost(SIDE_SELL, PRICE, AMOUNT);
  const fees = (cost * feeBps) / 10_000n;
  const value = cost + fees;

  const placeTx = await canaryClient.writeContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "placeOrder",
    args: [duelKey, MARKET_KIND_DUEL_WINNER, SIDE_SELL, PRICE, AMOUNT, ORDER_FLAG_GTC],
    value,
  });
  await waitForTx(publicClient, placeTx, "placeOrder");

  const placeReceipt = await publicClient.getTransactionReceipt({ hash: placeTx });
  let placedOrderId = extractPlacedOrderId({
    receipt: placeReceipt,
    abi: goldClobAbi,
    marketKey,
  });
  if (!placedOrderId) {
    const market = await publicClient.readContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "getMarket",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    const nextOrderId = tupleValue(market, "nextOrderId", 7);
    if (!nextOrderId || nextOrderId <= 0n) {
      throw new Error("could not resolve placed order id");
    }
    placedOrderId = nextOrderId - 1n;
  }

  const preCancelOrderState = await readOrderState(publicClient, goldClobAbi, goldClobAddress, marketKey, placedOrderId);
  const preCleanupState = {
    order: {
      id: preCancelOrderState.id?.toString?.() || null,
      active: preCancelOrderState.active,
      filled: preCancelOrderState.filled?.toString?.() || null,
      amount: preCancelOrderState.amount?.toString?.() || null,
      side: preCancelOrderState.side?.toString?.() || null,
      maker: preCancelOrderState.maker || null,
      raw: preCancelOrderState.raw,
    },
  };

  let matchOrderTx = null;
  if (scenario !== SCENARIO_UNMATCHED) {
    const matcherCost = quoteCost(SIDE_BUY, PRICE, scenarioMatchAmount);
    const matcherFees = (matcherCost * feeBps) / 10_000n;
    const matcherValue = matcherCost + matcherFees;
    const matchTx = await matcherClient.writeContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "placeOrder",
      args: [duelKey, MARKET_KIND_DUEL_WINNER, SIDE_BUY, PRICE, scenarioMatchAmount, ORDER_FLAG_GTC],
      value: matcherValue,
    });
    await waitForTx(publicClient, matchTx, `match-${scenario}`);
    matchOrderTx = matchTx;
  }

  const cancelTx = await reporterClient.writeContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "cancelDuel",
    args: [duelKey, `${duelId}-cancel`],
  });
  await waitForTx(publicClient, cancelTx, "cancelDuel");

  const syncTx = await marketOperatorClient.client.writeContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "syncMarketFromOracle",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForTx(publicClient, syncTx, "syncMarketFromOracle");
  const cancelledState = await waitForMarketLifecycle({ keeperUrl }, duelKeyHex, "CANCELLED");

  const canaryOrderStateBeforeClaim = await readOrderState(
    publicClient,
    goldClobAbi,
    goldClobAddress,
    marketKey,
    placedOrderId,
  );

  let cancelOrderTx = null;
  if (canaryOrderStateBeforeClaim.active) {
    const cancelOrder = await canaryClient.writeContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "cancelOrder",
      args: [duelKey, MARKET_KIND_DUEL_WINNER, placedOrderId],
    });
    await waitForTx(publicClient, cancelOrder, "cancelOrder");
    cancelOrderTx = cancelOrder;
  }

  let preClaimState = await readMarketPosition(
    publicClient,
    goldClobAbi,
    goldClobAddress,
    marketKey,
    canary.address,
  );
  let claimTx = null;
  if (preClaimState.hasResidual) {
    console.log("position exists before claim", {
      values: preClaimState.raw.map((value) => value.toString()),
      marketKey,
      canary: canary.address,
    });
    claimTx = await canaryClient.writeContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "claim",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await waitForTx(publicClient, claimTx, "claim");
  } else {
    console.log("skip claim because canary position is already zero");
  }

  const finalPos = await readMarketPosition(
    publicClient,
    goldClobAbi,
    goldClobAddress,
    marketKey,
    canary.address,
  );

  const finalOrder = await readOrderState(publicClient, goldClobAbi, goldClobAddress, marketKey, placedOrderId);
  const finalState = {
    order: {
      id: finalOrder.id?.toString?.() || null,
      active: finalOrder.active,
      filled: finalOrder.filled?.toString?.() || null,
      amount: finalOrder.amount?.toString?.() || null,
      side: finalOrder.side?.toString?.() || null,
      maker: finalOrder.maker || null,
      raw: finalOrder.raw,
    },
    position: {
      raw: finalPos.raw.map((value) => value.toString()),
      hasResidual: finalPos.hasResidual,
    },
  };
  if (finalOrder.active) {
    throw new Error(`order cleanup failed: orderId ${String(placedOrderId)} still active`);
  }
  if (finalPos.hasResidual) {
    throw new Error(
      `position not cleared after cleanup: ${finalPos.raw.map((value) => value.toString()).join(":")}`,
    );
  }
  if (cancelledState.target.lifecycleStatus !== "CANCELLED") {
    throw new Error(`cleanup failed: keeper lifecycle is ${cancelledState.target.lifecycleStatus}`);
  }

  console.log(
    JSON.stringify(
      {
        duelId,
        duelKey,
        scenario,
        publishMode,
        orderId: placedOrderId.toString(),
        marketKey,
        preCancelOrderState: preCleanupState,
        preClaimState: {
          order: canaryOrderStateBeforeClaim.raw,
          position: preClaimState.raw.map((value) => value.toString()),
          hasResidual: preClaimState.hasResidual,
        },
        upsertTx,
        createTx,
        placeTx,
        matchOrderTx,
        cancelTx,
        syncTx,
        keeperLifecycle: {
          open: open.target.lifecycleStatus,
          cancelled: cancelledState.target.lifecycleStatus,
        },
        cancelOrderTx,
        claimTx,
        finalState,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
