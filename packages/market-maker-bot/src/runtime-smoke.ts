import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";

import type { BettingEvmChain } from "@hyperbet/chain-registry";

import { createTestMarketMakerStateStore } from "./storage/index.ts";

const MARKET_KIND_DUEL_WINNER = 0;
const DUEL_STATUS_BETTING_OPEN = 2;
const DUEL_STATUS_LOCKED = 3;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const WINNER_SIDE_A = 1;
const MAX_PRICE = 1000;
const SHARE_UNIT_SIZE = 1_000n;
const ORDER_FLAG_GTC = 0x01;
const DISPUTE_WINDOW_SECONDS = 3_600;
const DEFAULT_ANVIL_RPC_URL = "http://127.0.0.1:18545";
const DEFAULT_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945382d7d46f71fbb8f7a1a5b2d3c6f90ad7d4",
  "0x5de4111afa1a4b94908b95ad9b8e4f5ff3a5f9d1f0e8f8dd3c9a1f4f2b7c6d5e",
  "0x7c852118294d6d4f0c3d1e4b4a1a278e6b8980c97c7c1b3e76aa87e3112e7854",
  "0x47e179ec19748874f6b4b93b5e1f0a421c7b0f52ce6f5c4f0b1e4a962f8d8338",
  "0x8b3a350cf5c34c9194ca3a545d8a7d3a8d2c2e0f28c52f4fb151797f63018e8d",
  "0x92db14e403f6dc6cc99d4d1d5bf4d70e2e7a55d499c19de577f4d3e42c8f2b29",
] as const;

type OracleArtifact = {
  abi: readonly unknown[];
  bytecode: { object: string };
};

type ClobArtifact = OracleArtifact;
type RuntimeContract = ethers.Contract & Record<string, any>;

type StubState = {
  duelKey: string;
  duelId: string;
  marketStatus: "OPEN" | "LOCKED";
  phase: "FIGHTING" | "COUNTDOWN";
  betCloseTime: number;
  updatedAt: number;
  hpA: number;
  hpB: number;
};

function parseArgs(): { chain: BettingEvmChain; rpcUrl: string } {
  const args = process.argv.slice(2);
  const getValue = (flag: string, fallback: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = args[index + 1];
    return value && !value.startsWith("--") ? value : fallback;
  };
  const chain = getValue("--chain", "bsc").trim().toLowerCase();
  if (chain !== "bsc" && chain !== "base" && chain !== "avax") {
    throw new Error(`unsupported chain ${chain}`);
  }
  return {
    chain,
    rpcUrl: getValue("--rpc-url", DEFAULT_ANVIL_RPC_URL).trim(),
  };
}

function duelKey(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function participantHash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function resultHash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : MAX_PRICE - price);
  return (amount * component) / BigInt(MAX_PRICE);
}

function unitsToRawAmount(units: number): bigint {
  return BigInt(Math.max(1, Math.floor(units))) * SHARE_UNIT_SIZE;
}

async function loadArtifact<T extends OracleArtifact | ClobArtifact>(
  relativePath: string,
): Promise<T> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const artifactPath = path.resolve(here, "../../evm-contracts/out", relativePath);
  return JSON.parse(await readFile(artifactPath, "utf8")) as T;
}

function sendJson(res: ServerResponse, payload: unknown) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

async function startStubServer(
  chain: BettingEvmChain,
  state: StubState,
): Promise<{ apiUrl: string; duelUrl: string; close: () => Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/arena/prediction-markets/active") {
      sendJson(res, {
        duel: {
          duelKey: state.duelKey,
          duelId: state.duelId,
          phase: state.phase,
          betCloseTime: state.betCloseTime,
        },
        markets: [
          {
            chainKey: chain,
            duelKey: state.duelKey,
            duelId: state.duelId,
            marketId: `${chain}-${state.duelId}`,
            marketRef: null,
            lifecycleStatus: state.marketStatus,
            winner: "NONE",
            betCloseTime: state.betCloseTime,
            contractAddress: null,
            programId: null,
            txRef: null,
            syncedAt: state.updatedAt,
          },
        ],
        updatedAt: state.updatedAt,
      });
      return;
    }

    if (url.pathname === "/api/streaming/state") {
      sendJson(res, {
        cycle: {
          phase: state.phase,
          agent1: { hp: state.hpA, maxHp: 100 },
          agent2: { hp: state.hpB, maxHp: 100 },
        },
      });
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind stub server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    apiUrl: `${baseUrl}/api/arena/prediction-markets/active`,
    duelUrl: `${baseUrl}/api/streaming/state`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function createNonceTracker(provider: ethers.JsonRpcProvider) {
  const nextNonceByAddress = new Map<string, number>();
  return async (address: string) => {
    const normalized = address.toLowerCase();
    const cached = nextNonceByAddress.get(normalized);
    if (cached != null) {
      nextNonceByAddress.set(normalized, cached + 1);
      return cached;
    }
    const fresh = await provider.getTransactionCount(address, "latest");
    nextNonceByAddress.set(normalized, fresh + 1);
    return fresh;
  };
}

async function main() {
  const { chain, rpcUrl } = parseArgs();
  const oracleArtifact = await loadArtifact<OracleArtifact>(
    "DuelOutcomeOracle.sol/DuelOutcomeOracle.json",
  );
  const clobArtifact = await loadArtifact<ClobArtifact>(
    "GoldClob.sol/GoldClob.json",
  );

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const [
    admin,
    operator,
    reporter,
    treasury,
    marketMakerFeeSink,
    trader,
    botSigner,
  ] = DEFAULT_PRIVATE_KEYS.map((privateKey) => new ethers.Wallet(privateKey, provider));
  const finalizer = await provider.getSigner(7);
  const challenger = await provider.getSigner(8);
  const nextNonce = createNonceTracker(provider);

  const runtimeActorAddresses = [
    operator.address,
    reporter.address,
    await finalizer.getAddress(),
    await challenger.getAddress(),
    treasury.address,
    marketMakerFeeSink.address,
    trader.address,
    botSigner.address,
  ];
  for (const actorAddress of runtimeActorAddresses) {
    await admin.sendTransaction({
      to: actorAddress,
      value: ethers.parseEther("25"),
      nonce: await nextNonce(admin.address),
    });
  }

  const oracleFactory = new ethers.ContractFactory(
    oracleArtifact.abi,
    oracleArtifact.bytecode.object,
    admin,
  );
  const oracle = (await oracleFactory.deploy(
    admin.address,
    reporter.address,
    await finalizer.getAddress(),
    await challenger.getAddress(),
    admin.address,
    DISPUTE_WINDOW_SECONDS,
    { nonce: await nextNonce(admin.address) },
  )) as RuntimeContract;
  await oracle.waitForDeployment();
  const oracleReporter = oracle.connect(reporter) as RuntimeContract;
  const oracleFinalizer = oracle.connect(finalizer) as RuntimeContract;

  const clobFactory = new ethers.ContractFactory(
    clobArtifact.abi,
    clobArtifact.bytecode.object,
    admin,
  );
  const clob = (await clobFactory.deploy(
    admin.address,
    operator.address,
    await oracle.getAddress(),
    treasury.address,
    marketMakerFeeSink.address,
    admin.address,
    { nonce: await nextNonce(admin.address) },
  )) as RuntimeContract;
  await clob.waitForDeployment();
  const clobOperator = clob.connect(operator) as RuntimeContract;
  const clobTrader = clob.connect(trader) as RuntimeContract;

  const duel = duelKey(`runtime-smoke-${chain}`);
  const duelId = `${chain}-runtime-smoke`;
  const participantA = participantHash("agent-alpha");
  const participantB = participantHash("agent-beta");
  const duelMetadata = `${chain}-runtime-smoke`;
  const latestBlock = await provider.getBlock("latest");
  const now = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
  await oracleReporter.upsertDuel(
    duel,
    participantA,
    participantB,
    now,
    now + 60n,
    now + 120n,
    duelMetadata,
    DUEL_STATUS_BETTING_OPEN,
    { nonce: await nextNonce(reporter.address) },
  );
  await clobOperator.createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER, {
    nonce: await nextNonce(operator.address),
  });

  const stubState: StubState = {
    duelKey: duel,
    duelId,
    marketStatus: "OPEN",
    phase: "FIGHTING",
    betCloseTime: Number(now + 60n) * 1_000,
    updatedAt: Date.now(),
    hpA: 85,
    hpB: 40,
  };
  const stubServer = await startStubServer(chain, stubState);

  process.env.MM_ENV = "testnet";
  process.env.EVM_PRIVATE_KEY = botSigner.privateKey;
  process.env.MM_ENABLE_BSC = chain === "bsc" ? "true" : "false";
  process.env.MM_ENABLE_BASE = chain === "base" ? "true" : "false";
  process.env.MM_ENABLE_AVAX = chain === "avax" ? "true" : "false";
  process.env.MM_ENABLE_SOLANA = "false";
  process.env.MM_MARKETS_CACHE_MS = "0";
  process.env.MM_DUEL_SIGNAL_CACHE_MS = "0";
  process.env.MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS = "250";
  process.env.CANCEL_STALE_AGE_MS = "1000";
  process.env.ORDER_SIZE_MIN = "50";
  process.env.ORDER_SIZE_MAX = "100";
  process.env.MM_PREDICTION_MARKETS_API_URL = stubServer.apiUrl;
  process.env.MM_DUEL_STATE_API_URL = stubServer.duelUrl;
  const chainUpper = chain.toUpperCase();
  process.env[`EVM_${chainUpper}_RPC_URL`] = rpcUrl;
  process.env[`CLOB_CONTRACT_ADDRESS_${chainUpper}`] = await clob.getAddress();
  process.env[`${chainUpper}_DUEL_ORACLE_ADDRESS`] = await oracle.getAddress();

  const { CrossChainMarketMaker } = await import("./index.ts");
  const mm = new CrossChainMarketMaker({
    stateStore: createTestMarketMakerStateStore(),
  });

  try {
    await mm.marketMakeCycle();

    const quotedOrders = mm.getActiveOrders().filter((order) => order.chainKey === chain);
    assert.equal(quotedOrders.length, 2, `${chain} should have two active quotes`);

    const askOrder = quotedOrders.find((order) => order.side === SELL_SIDE);
    assert.ok(askOrder, `${chain} should place an ask quote`);
    const rawAmount = unitsToRawAmount(askOrder.amount);
    const cost = quoteCost(BUY_SIDE, askOrder.price, rawAmount);
    const fees =
      ((cost * BigInt(await clob.tradeTreasuryFeeBps())) / 10_000n) +
      ((cost * BigInt(await clob.tradeMarketMakerFeeBps())) / 10_000n);

    await clobTrader.placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      askOrder.price,
      rawAmount,
      ORDER_FLAG_GTC,
      { value: cost + fees, nonce: await nextNonce(trader.address) },
    );

    stubState.marketStatus = "LOCKED";
    stubState.phase = "COUNTDOWN";
    stubState.updatedAt = Date.now();
    await mm.marketMakeCycle();
    assert.equal(
      mm.getActiveOrders().filter((order) => order.chainKey === chain).length,
      0,
      `${chain} quotes should cancel on lock`,
    );

    await provider.send("evm_increaseTime", [61]);
    await provider.send("evm_mine", []);
    await oracleReporter.upsertDuel(
      duel,
      participantA,
      participantB,
      now,
      now + 60n,
      now + 120n,
      duelMetadata,
      DUEL_STATUS_LOCKED,
      { nonce: await nextNonce(reporter.address) },
    );
    const lockedDuel = await oracle.getDuel(duel);
    const resolvedBlock = await provider.getBlock("latest");
    const latestResolvedTs = BigInt(
      resolvedBlock?.timestamp ?? Math.floor(Date.now() / 1000),
    );
    const duelBetCloseTs = BigInt(lockedDuel.betCloseTs);
    const duelEndTs =
      latestResolvedTs > duelBetCloseTs
        ? latestResolvedTs
        : duelBetCloseTs + 1n;
    await oracleReporter.proposeResult(
      duel,
      WINNER_SIDE_A,
      42,
      resultHash("replay"),
      resultHash("result"),
      duelEndTs,
      `${chain}-resolved`,
      { nonce: await nextNonce(reporter.address) },
    );
    await provider.send("evm_increaseTime", [DISPUTE_WINDOW_SECONDS]);
    await provider.send("evm_mine", []);
    await oracleFinalizer.finalizeResult(duel, `${chain}-resolved`, {
      nonce: await nextNonce(await finalizer.getAddress()),
    });
    await clobOperator.syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER, {
      nonce: await nextNonce(operator.address),
    });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const positionBefore = await clob.positions(marketKey, trader.address);
    assert.equal(
      positionBefore.aShares > 0n,
      true,
      `${chain} trader should hold winning shares before claim`,
    );

    await clobTrader.claim(duel, MARKET_KIND_DUEL_WINNER, {
      nonce: await nextNonce(trader.address),
    });
    const positionAfter = await clob.positions(marketKey, trader.address);
    assert.equal(positionAfter.aShares, 0n, `${chain} claim should clear winner shares`);
    assert.equal(positionAfter.bShares, 0n, `${chain} claim should leave no loser shares`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          chain,
          duel,
          marketKey,
          quotedOrders: quotedOrders.length,
          claimed: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await stubServer.close();
  }
}

main().catch((error) => {
  console.error(
    `[runtime-smoke] ${(error as Error).message}`,
  );
  process.exit(1);
});
