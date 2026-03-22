/**
 * Local end-to-end MM simulator.
 *
 * Starts anvil, deploys Oracle + CLOB + MockUSD + AMM Router, creates both
 * CLOB and AMM markets, spins up a stub API server, funds wallets, and runs
 * the CrossChainMarketMaker through full market-making cycles on both market
 * types.
 *
 * Usage:
 *   bun run src/local-sim.ts [--chain bsc] [--cycles 10]
 */
import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import type { BettingEvmChain } from "@hyperbet/chain-registry";
import { createTestMarketMakerStateStore } from "./storage/index.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const ANVIL_PORT = 28545;
const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const ANVIL_CHAIN_ID = 31337;

const MARKET_KIND_DUEL_WINNER = 0;
const DUEL_STATUS_BETTING_OPEN = 2;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const ORDER_FLAG_GTC = 0x01;
const MAX_PRICE = 1000;
const SHARE_UNIT_SIZE = 1_000n;
const DISPUTE_WINDOW_SECONDS = 3_600;

const DEFAULT_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945382d7d46f71fbb8f7a1a5b2d3c6f90ad7d4",
  "0x5de4111afa1a4b94908b95ad9b8e4f5ff3a5f9d1f0e8f8dd3c9a1f4f2b7c6d5e",
  "0x7c852118294d6d4f0c3d1e4b4a1a278e6b8980c97c7c1b3e76aa87e3112e7854",
  "0x47e179ec19748874f6b4b93b5e1f0a421c7b0f52ce6f5c4f0b1e4a962f8d8338",
  "0x8b3a350cf5c34c9194ca3a545d8a7d3a8d2c2e0f28c52f4fb151797f63018e8d",
  "0x92db14e403f6dc6cc99d4d1d5bf4d70e2e7a55d499c19de577f4d3e42c8f2b29",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type Artifact = {
  abi: readonly unknown[];
  bytecode: { object: string };
};

type StubState = {
  duelKey: string;
  duelId: string;
  marketStatus: "OPEN" | "LOCKED";
  phase: "FIGHTING" | "COUNTDOWN";
  betCloseTime: number;
  updatedAt: number;
  hpA: number;
  hpB: number;
  ammMarketAddress: string | null;
};

type RuntimeContract = ethers.Contract & Record<string, any>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs(): { chain: BettingEvmChain; cycles: number } {
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
    cycles: Math.max(1, parseInt(getValue("--cycles", "10"), 10) || 10),
  };
}

type FullArtifact = Artifact & {
  bytecode: Artifact["bytecode"] & {
    linkReferences?: Record<string, Record<string, { start: number; length: number }[]>>;
  };
};

async function loadArtifact(relativePath: string): Promise<FullArtifact> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const artifactPath = path.resolve(here, "../../evm-contracts/out", relativePath);
  return JSON.parse(await readFile(artifactPath, "utf8")) as FullArtifact;
}

/**
 * Link library addresses into bytecode that has unresolved link references.
 * Foundry uses `__$<hash>$__` placeholders. We extract the placeholder from
 * the first known position then do a global string replace — this covers both
 * the init code AND the embedded LvrMarket creation code in the runtime.
 */
function linkBytecode(
  artifact: FullArtifact,
  libraries: Record<string, string>,
): string {
  let bytecode = artifact.bytecode.object;
  const refs = artifact.bytecode.linkReferences ?? {};
  for (const [filePath, libs] of Object.entries(refs)) {
    for (const [libName, positions] of Object.entries(libs)) {
      const key = `${filePath}:${libName}`;
      const address = libraries[key];
      if (!address) {
        throw new Error(`missing library address for ${key}`);
      }
      const addrHex = address.replace("0x", "").toLowerCase().padStart(40, "0");
      // Extract the placeholder string from the first known position
      const firstPos = positions[0];
      const hexStart = 2 + firstPos.start * 2;
      const placeholder = bytecode.slice(hexStart, hexStart + 40);
      // Replace ALL occurrences globally (init code + embedded runtime)
      bytecode = bytecode.replaceAll(placeholder, addrHex);
    }
  }
  return bytecode;
}

function duelKey(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function participantHash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : MAX_PRICE - price);
  return (amount * component) / BigInt(MAX_PRICE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Anvil ───────────────────────────────────────────────────────────────────

async function startAnvil(): Promise<ChildProcess> {
  // Kill any stale anvil on this port
  try {
    const { execSync } = await import("node:child_process");
    const pids = execSync(`lsof -tiTCP:${ANVIL_PORT} -sTCP:LISTEN 2>/dev/null || true`, {
      encoding: "utf8",
    }).trim();
    for (const pid of pids.split("\n").filter(Boolean)) {
      try { process.kill(parseInt(pid, 10)); } catch {}
    }
  } catch {}

  console.log(`[local-sim] starting anvil on port ${ANVIL_PORT}...`);
  const anvil = spawn("anvil", [
    "--silent",
    "--accounts", "20",
    "--host", "127.0.0.1",
    "--port", String(ANVIL_PORT),
    "--chain-id", String(ANVIL_CHAIN_ID),
  ], { stdio: "ignore" });

  // Wait for RPC readiness
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(ANVIL_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      });
      const json = await response.json() as any;
      if (json.result) {
        console.log("[local-sim] anvil ready");
        return anvil;
      }
    } catch {}
    await sleep(500);
  }
  anvil.kill();
  throw new Error("anvil did not become ready within 30s");
}

// ─── Stub API Server ─────────────────────────────────────────────────────────

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
      const markets: any[] = [
        // CLOB market
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
          marketType: "clob",
        },
      ];

      // AMM market (if deployed)
      if (state.ammMarketAddress) {
        markets.push({
          chainKey: chain,
          duelKey: state.duelKey,
          duelId: state.duelId,
          marketId: `${chain}-amm-${state.duelId}`,
          marketRef: state.ammMarketAddress,
          lifecycleStatus: state.marketStatus,
          winner: "NONE",
          betCloseTime: state.betCloseTime,
          contractAddress: state.ammMarketAddress,
          programId: null,
          txRef: null,
          syncedAt: state.updatedAt,
          marketType: "amm",
        });
      }

      sendJson(res, {
        duel: {
          duelKey: state.duelKey,
          duelId: state.duelId,
          phase: state.phase,
          betCloseTime: state.betCloseTime,
        },
        markets,
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

// ─── Deploy Contracts ────────────────────────────────────────────────────────

function createNonceTracker(provider: ethers.JsonRpcProvider) {
  const nextNonceByAddress = new Map<string, number>();
  const tracker = async (address: string) => {
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
  tracker.invalidate = (address: string) => {
    nextNonceByAddress.delete(address.toLowerCase());
  };
  return tracker;
}

async function deployContracts(provider: ethers.JsonRpcProvider, chain: BettingEvmChain) {
  const [admin, operator, reporter, treasury, marketMakerFeeSink, trader, botSigner] =
    DEFAULT_PRIVATE_KEYS.map((pk) => new ethers.Wallet(pk, provider));
  const finalizer = await provider.getSigner(7);
  const challenger = await provider.getSigner(8);
  const nextNonce = createNonceTracker(provider);

  // Fund actors
  const actors = [
    operator.address,
    reporter.address,
    await finalizer.getAddress(),
    await challenger.getAddress(),
    treasury.address,
    marketMakerFeeSink.address,
    trader.address,
    botSigner.address,
  ];
  console.log("[local-sim] funding wallets...");
  for (const addr of actors) {
    await admin.sendTransaction({
      to: addr,
      value: ethers.parseEther("50"),
      nonce: await nextNonce(admin.address),
    });
  }

  // Deploy DuelOutcomeOracle
  console.log("[local-sim] deploying DuelOutcomeOracle...");
  const oracleArtifact = await loadArtifact("DuelOutcomeOracle.sol/DuelOutcomeOracle.json");
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
  console.log(`[local-sim] Oracle: ${await oracle.getAddress()}`);

  // Deploy GoldClob
  console.log("[local-sim] deploying GoldClob...");
  const clobArtifact = await loadArtifact("GoldClob.sol/GoldClob.json");
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
  console.log(`[local-sim] CLOB: ${await clob.getAddress()}`);

  // Deploy MockUSD
  console.log("[local-sim] deploying MockUSD...");
  const musdArtifact = await loadArtifact("MockUSD.sol/MockUSD.json");
  const musdFactory = new ethers.ContractFactory(
    musdArtifact.abi,
    musdArtifact.bytecode.object,
    admin,
  );
  const musd = (await musdFactory.deploy({
    nonce: await nextNonce(admin.address),
  })) as RuntimeContract;
  await musd.waitForDeployment();
  console.log(`[local-sim] MockUSD: ${await musd.getAddress()}`);

  // Deploy AMM contracts via forge (handles library linking at compile time)
  console.log("[local-sim] deploying AMM Router via forge...");
  const { execSync } = await import("node:child_process");
  const evmContractsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../evm-contracts",
  );
  const musdAddress = await musd.getAddress();
  const forgeEnv = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.HOME}/.bun/bin:${process.env.PATH}` };

  // Deploy Math library
  const mathOut = execSync(
    `forge create contracts/lvr_amm/lib/Math.sol:Math --rpc-url ${ANVIL_RPC_URL} --private-key ${admin.privateKey} --broadcast --json`,
    { cwd: evmContractsDir, env: forgeEnv, encoding: "utf8" },
  );
  const mathAddr = JSON.parse(mathOut).deployedTo;
  console.log(`[local-sim] Math: ${mathAddr}`);

  // Deploy SwapMath library
  const swapOut = execSync(
    `forge create contracts/lvr_amm/lib/SwapMath.sol:SwapMath --rpc-url ${ANVIL_RPC_URL} --private-key ${admin.privateKey} --broadcast --json`,
    { cwd: evmContractsDir, env: forgeEnv, encoding: "utf8" },
  );
  const swapMathAddr = JSON.parse(swapOut).deployedTo;
  console.log(`[local-sim] SwapMath: ${swapMathAddr}`);

  // Deploy Router with linked libraries
  const routerOut = execSync(
    `forge create contracts/lvr_amm/Router.sol:Router` +
    ` --rpc-url ${ANVIL_RPC_URL}` +
    ` --private-key ${admin.privateKey}` +
    ` --broadcast --json` +
    ` --libraries contracts/lvr_amm/lib/Math.sol:Math:${mathAddr}` +
    ` --libraries contracts/lvr_amm/lib/SwapMath.sol:SwapMath:${swapMathAddr}` +
    ` --constructor-args ${musdAddress} ${treasury.address} 200 ${admin.address} ${await oracle.getAddress()}`,
    { cwd: evmContractsDir, env: forgeEnv, encoding: "utf8" },
  );
  const routerAddress = JSON.parse(routerOut).deployedTo;
  console.log(`[local-sim] Router: ${routerAddress}`);

  // Forge used admin's nonces directly — invalidate cached nonce so ethers re-fetches
  nextNonce.invalidate(admin.address);

  // Create ethers contract instances for the Router and MockUSD
  const routerArtifact = await loadArtifact("Router.sol/Router.json");
  const router = new ethers.Contract(routerAddress, routerArtifact.abi, admin) as RuntimeContract;

  // Mint mUSD to admin, trader, and bot for AMM trading
  const mintAmount = ethers.parseUnits("1000000", 18); // 1M mUSD
  for (const addr of [admin.address, trader.address, botSigner.address]) {
    await musd.mint(addr, mintAmount, { nonce: await nextNonce(admin.address) });
  }
  console.log("[local-sim] minted mUSD to admin, trader, bot");

  // Approve Router to spend admin's mUSD (for market creation)
  await musd.approve(await router.getAddress(), ethers.MaxUint256, {
    nonce: await nextNonce(admin.address),
  });

  // Approve Router for bot signer too
  const musdBot = musd.connect(botSigner) as RuntimeContract;
  await musdBot.approve(await router.getAddress(), ethers.MaxUint256, {
    nonce: await nextNonce(botSigner.address),
  });

  return {
    admin,
    operator,
    reporter,
    treasury,
    marketMakerFeeSink,
    trader,
    botSigner,
    finalizer,
    challenger,
    oracle,
    clob,
    musd,
    router,
    nextNonce,
  };
}

// ─── Create Markets ──────────────────────────────────────────────────────────

async function createMarkets(
  contracts: Awaited<ReturnType<typeof deployContracts>>,
  provider: ethers.JsonRpcProvider,
  chain: BettingEvmChain,
) {
  const { admin, operator, reporter, oracle, clob, router, nextNonce } = contracts;
  const oracleReporter = oracle.connect(reporter) as RuntimeContract;
  const clobOperator = clob.connect(operator) as RuntimeContract;

  const duel = duelKey(`local-sim-${chain}`);
  const duelId = `${chain}-local-sim`;
  const participantA = participantHash("agent-alpha");
  const participantB = participantHash("agent-beta");
  const latestBlock = await provider.getBlock("latest");
  const now = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));

  // Create CLOB duel + market
  console.log("[local-sim] creating CLOB duel + market...");
  await oracleReporter.upsertDuel(
    duel,
    participantA,
    participantB,
    now,
    now + 600n, // betCloseTs 10 min from now
    now + 1200n,
    `local://${chain}-local-sim`,
    DUEL_STATUS_BETTING_OPEN,
    { nonce: await nextNonce(reporter.address) },
  );
  await clobOperator.createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER, {
    nonce: await nextNonce(operator.address),
  });
  console.log(`[local-sim] CLOB market created for duel ${duel.slice(0, 10)}...`);

  // Create AMM market via Router
  console.log("[local-sim] creating AMM market via Router...");
  const collateral = ethers.parseUnits("10000", 18); // 10k mUSD initial liquidity
  const duration = 600; // 10 minutes

  const tx = await router.create(
    "Local Sim Market",
    "Test market for local simulation",
    "local://sim",
    duel,
    false, // static liquidity (simpler)
    duration,
    collateral,
    { nonce: await nextNonce(admin.address) },
  );
  const receipt = await tx.wait();

  // Extract AMM market address from MarketCreated event
  const routerInterface = router.interface;
  let ammMarketAddress: string | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = routerInterface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "MarketCreated") {
        ammMarketAddress = parsed.args.market;
        break;
      }
    } catch {}
  }

  if (!ammMarketAddress) {
    // Fallback: query getAllMarkets
    const allMarkets = await router.getAllMarkets();
    ammMarketAddress = allMarkets[allMarkets.length - 1];
  }
  console.log(`[local-sim] AMM market: ${ammMarketAddress}`);

  // Verify AMM market is readable via getMarketDetails()
  const lvrMarket = new ethers.Contract(ammMarketAddress!, [
    "function getMarketDetails() view returns (uint8, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
    "function getPriceYes() view returns (uint256)",
    "function yesToken() view returns (address)",
    "function noToken() view returns (address)",
    "function state() view returns (uint8)",
    "function isDynamic() view returns (bool)",
  ], provider);

  const [state, marketDeadline, outcome, liquidity, reserveYes, reserveNo, priceYes, priceNo] =
    await lvrMarket.getMarketDetails();

  console.log(`[local-sim] AMM state: ${state}, isDynamic: ${await lvrMarket.isDynamic()}`);
  console.log(`[local-sim] AMM reserves: yes=${ethers.formatUnits(reserveYes, 18)}, no=${ethers.formatUnits(reserveNo, 18)}`);
  console.log(`[local-sim] AMM liquidity: ${ethers.formatUnits(liquidity, 18)}`);
  console.log(`[local-sim] AMM priceYes: ${ethers.formatUnits(priceYes, 18)}, priceNo: ${ethers.formatUnits(priceNo, 18)}`);
  console.log(`[local-sim] AMM deadline: ${new Date(Number(marketDeadline) * 1000).toISOString()}`);

  return {
    duel,
    duelId,
    ammMarketAddress: ammMarketAddress!,
    betCloseTime: Number(now + 600n) * 1000,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { chain, cycles } = parseArgs();
  let anvil: ChildProcess | null = null;
  let stubServer: { close: () => Promise<void> } | null = null;

  try {
    // Start anvil
    anvil = await startAnvil();
    const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);

    // Deploy all contracts
    const contracts = await deployContracts(provider, chain);

    // Create CLOB + AMM markets
    const { duel, duelId, ammMarketAddress, betCloseTime } = await createMarkets(
      contracts,
      provider,
      chain,
    );

    // Start stub API server
    const stubState: StubState = {
      duelKey: duel,
      duelId,
      marketStatus: "OPEN",
      phase: "FIGHTING",
      betCloseTime,
      updatedAt: Date.now(),
      hpA: 85,
      hpB: 40,
      ammMarketAddress,
    };
    const stub = await startStubServer(chain, stubState);
    stubServer = stub;

    // Configure environment for MM bot
    const chainUpper = chain.toUpperCase();
    process.env.MM_ENV = "testnet";
    process.env.EVM_PRIVATE_KEY = contracts.botSigner.privateKey;
    process.env.MM_ENABLE_BSC = chain === "bsc" ? "true" : "false";
    process.env.MM_ENABLE_BASE = chain === "base" ? "true" : "false";
    process.env.MM_ENABLE_AVAX = chain === "avax" ? "true" : "false";
    process.env.MM_ENABLE_SOLANA = "false";
    process.env.MM_MARKETS_CACHE_MS = "0";
    process.env.MM_DUEL_SIGNAL_CACHE_MS = "0";
    process.env.MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS = "500";
    process.env.CANCEL_STALE_AGE_MS = "1000";
    process.env.ORDER_SIZE_MIN = "50";
    process.env.ORDER_SIZE_MAX = "100";
    process.env.MM_PREDICTION_MARKETS_API_URL = stub.apiUrl;
    process.env.MM_DUEL_STATE_API_URL = stub.duelUrl;
    process.env[`EVM_${chainUpper}_RPC_URL`] = ANVIL_RPC_URL;
    process.env[`CLOB_CONTRACT_ADDRESS_${chainUpper}`] = await contracts.clob.getAddress();
    process.env[`${chainUpper}_DUEL_ORACLE_ADDRESS`] = await contracts.oracle.getAddress();

    // AMM env vars
    process.env.MM_ENABLE_AMM = "true";
    process.env.MM_ENABLE_AMM_SOLANA = "false";
    process.env[`AMM_ROUTER_ADDRESS_${chainUpper}`] = await contracts.router.getAddress();
    process.env[`MUSD_TOKEN_ADDRESS_${chainUpper}`] = await contracts.musd.getAddress();
    process.env.MM_AMM_DEVIATION_THRESHOLD_BPS = "100"; // Lower threshold for testing
    process.env.MM_AMM_MAX_TRADE_SIZE = "100000";
    process.env.MM_AMM_MIN_TRADE_SIZE = "1000";
    process.env.MM_AMM_MAX_POSITION_SIZE = "500000";

    // Import and create MM bot
    const { CrossChainMarketMaker } = await import("./index.ts");
    const mm = new CrossChainMarketMaker({
      stateStore: createTestMarketMakerStateStore(),
    });

    console.log(`\n[local-sim] ═══ Running ${cycles} market-making cycles ═══\n`);

    const config = mm.getConfig();
    console.log("[local-sim] Config:", JSON.stringify({
      chain,
      clobEnabled: (config as any)[`${chain}Enabled`],
      ammEnabled: config.ammEnabled,
      ammEvmChains: config.ammEvmChains,
    }, null, 2));

    for (let i = 0; i < cycles; i++) {
      console.log(`\n[local-sim] ─── Cycle ${i + 1}/${cycles} ───`);

      // Vary HP signal to create fair value changes → trigger AMM trades
      stubState.hpA = Math.max(10, Math.min(95, 85 - i * 5 + Math.floor(Math.random() * 10)));
      stubState.hpB = Math.max(10, Math.min(95, 40 + i * 3 + Math.floor(Math.random() * 10)));
      stubState.updatedAt = Date.now();

      try {
        await mm.marketMakeCycle();
      } catch (cycleErr: any) {
        console.warn(`[local-sim] cycle error (non-fatal): ${cycleErr.message?.slice(0, 120)}`);
      }

      const activeOrders = mm.getActiveOrders().filter((o: any) => o.chainKey === chain);
      const ammPositions = mm.getAmmPositions();
      const inventory = mm.getInventory();

      console.log(`[local-sim] HP: A=${stubState.hpA}, B=${stubState.hpB}`);
      console.log(`[local-sim] CLOB orders: ${activeOrders.length}`);
      if (activeOrders.length > 0) {
        for (const order of activeOrders) {
          console.log(`  ${order.side === SELL_SIDE ? "ASK" : "BID"} price=${order.price} amount=${order.amount}`);
        }
      }
      console.log(`[local-sim] AMM positions: ${ammPositions.length}`);
      for (const pos of ammPositions) {
        console.log(`  ${pos.chainKey} yes=${pos.yesBalance} no=${pos.noBalance} cost=${pos.costBasis}`);
      }
      console.log(`[local-sim] Inventory: yes=${inventory.yes}, no=${inventory.no}, ammYes=${inventory.ammYes}, ammNo=${inventory.ammNo}`);

      await sleep(200);
    }

    // Read on-chain AMM state after trading
    const lvrMarket = new ethers.Contract(ammMarketAddress, [
      "function getMarketDetails() view returns (uint8, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
    ], provider);

    const [, , , finalLiquidity, finalReserveYes, finalReserveNo] =
      await lvrMarket.getMarketDetails();

    console.log(`\n[local-sim] ═══ Final State ═══`);
    console.log(`[local-sim] AMM reserves: yes=${ethers.formatUnits(finalReserveYes, 18)}, no=${ethers.formatUnits(finalReserveNo, 18)}`);
    console.log(`[local-sim] AMM liquidity: ${ethers.formatUnits(finalLiquidity, 18)}`);

    const finalConfig = mm.getConfig();
    const finalInventory = mm.getInventory();
    const finalOrders = mm.getActiveOrders();
    const finalAmm = mm.getAmmPositions();

    console.log(
      JSON.stringify(
        {
          ok: true,
          chain,
          cycles,
          duel: duel.slice(0, 18) + "...",
          ammMarket: ammMarketAddress,
          clobOrders: finalOrders.length,
          ammPositions: finalAmm.length,
          inventory: finalInventory,
          ammFinalReserves: {
            yes: ethers.formatUnits(finalReserveYes, 18),
            no: ethers.formatUnits(finalReserveNo, 18),
          },
          config: {
            ammEnabled: finalConfig.ammEnabled,
            ammEvmChains: finalConfig.ammEvmChains,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    if (stubServer) await stubServer.close();
    if (anvil) {
      anvil.kill();
      console.log("[local-sim] anvil stopped");
    }
  }
}

main().catch((error) => {
  console.error(`[local-sim] fatal: ${(error as Error).message}`);
  console.error((error as Error).stack);
  process.exit(1);
});
