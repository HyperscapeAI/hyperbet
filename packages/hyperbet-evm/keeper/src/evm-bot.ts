import { createHash } from "node:crypto";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  createPublicClient,
  createWalletClient,
  http,
  pad,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { type DuelLifecycleEvent, GameClient } from "./game-client";

const DUEL_WINNER_MARKET_KIND = 1;

const DUEL_OUTCOME_ORACLE_ABI = [
  {
    type: "function",
    name: "upsertDuel",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "string" },
      { type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reportResult",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      { type: "uint8" },
      { type: "uint64" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" },
      { type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getDuel",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        components: [
          { name: "duelKey", type: "bytes32" },
          { name: "participantAHash", type: "bytes32" },
          { name: "participantBHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "winner", type: "uint8" },
          { name: "betOpenTs", type: "uint64" },
          { name: "betCloseTs", type: "uint64" },
          { name: "duelStartTs", type: "uint64" },
          { name: "duelEndTs", type: "uint64" },
          { name: "seed", type: "uint64" },
          { name: "resultHash", type: "bytes32" },
          { name: "replayHash", type: "bytes32" },
          { name: "metadataUri", type: "string" },
        ],
        type: "tuple",
      },
    ],
  },
] as const;

const EVM_GOLD_CLOB_ADMIN_ABI = [
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [
      {
        components: [
          { name: "exists", type: "bool" },
          { name: "duelKey", type: "bytes32" },
          { name: "marketKind", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "winner", type: "uint8" },
          { name: "nextOrderId", type: "uint64" },
          { name: "bestBid", type: "uint16" },
          { name: "bestAsk", type: "uint16" },
          { name: "totalAShares", type: "uint128" },
          { name: "totalBShares", type: "uint128" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "createMarketForDuel",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "syncMarketFromOracle",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [{ type: "uint8" }],
  },
] as const;

const SKILL_ORACLE_ABI = [
  {
    type: "function",
    name: "updateAgentSkill",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const PERP_ENGINE_ADMIN_ABI = [
  {
    type: "function",
    name: "marketConfigs",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        components: [
          { name: "skewScale", type: "uint256" },
          { name: "maxLeverage", type: "uint256" },
          { name: "maintenanceMarginBps", type: "uint256" },
          { name: "liquidationRewardBps", type: "uint256" },
          { name: "maxOracleDelay", type: "uint256" },
          { name: "maxOpenInterest", type: "uint256" },
          { name: "tradeTreasuryFeeBps", type: "uint256" },
          { name: "tradeMarketMakerFeeBps", type: "uint256" },
          { name: "maxOraclePriceDeltaBps", type: "uint256" },
          { name: "minInsuranceFund", type: "uint256" },
          { name: "exists", type: "bool" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        components: [
          { name: "totalLongOI", type: "uint256" },
          { name: "totalShortOI", type: "uint256" },
          { name: "currentFundingRate", type: "int256" },
          { name: "cumulativeFundingRate", type: "int256" },
          { name: "lastFundingTimestamp", type: "uint256" },
          { name: "lastOraclePrice", type: "uint256" },
          { name: "lastConservativeSkill", type: "int256" },
          { name: "lastOracleTimestamp", type: "uint256" },
          { name: "vaultBalance", type: "uint256" },
          { name: "insuranceFund", type: "uint256" },
          { name: "badDebt", type: "uint256" },
          { name: "settlementPrice", type: "uint256" },
          { name: "treasuryFeeBalance", type: "uint256" },
          { name: "marketMakerFeeBalance", type: "uint256" },
          { name: "openPositions", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "syncOracle",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setMarketStatus",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [],
  },
] as const;

type EvmKeeperRuntime = {
  label: string;
  duelOracleAddress: Address;
  goldClobAddress: Address;
  skillOracleAddress: Address | null;
  perpEngineAddress: Address | null;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  perpsCache: Map<string, string>;
};

type PerpsMarketFeedEntry = {
  characterId: string;
  agentKey?: string | null;
  mu?: number | null;
  sigma?: number | null;
  status?: string | null;
};

type PerpsMarketsFeed = {
  markets?: PerpsMarketFeedEntry[];
};

function parseAddressEnv(value: string | undefined): Address | null {
  const trimmed = value?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return null;
  }
  return trimmed as Address;
}

function parsePrivateKey(value: string | undefined): `0x${string}` | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    return null;
  }
  return withPrefix as `0x${string}`;
}

function normalizeHex32(value: string): Hex {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("expected 32-byte hex");
  }
  return `0x${normalized}`;
}

function participantHashHex(agent: { id?: string; name?: string } | null): Hex {
  const id = agent?.id ?? agent?.name ?? "unknown";
  return `0x${createHash("sha256").update(id).digest("hex")}`;
}

function resultHashHex(
  duelKeyHex: string,
  winnerSide: "A" | "B",
  seed: string,
  replayHashHex: string,
): Hex {
  return `0x${createHash("sha256")
    .update(
      JSON.stringify({
        duelKeyHex,
        winnerSide,
        seed,
        replayHashHex: replayHashHex.toLowerCase(),
      }),
    )
    .digest("hex")}`;
}

function buildDuelMetadata(data: DuelLifecycleEvent): string {
  return JSON.stringify({
    cycleId: data.cycleId,
    duelId: data.duelId,
    duelKeyHex: data.duelKeyHex,
    agent1: data.agent1?.name ?? "Agent A",
    agent2: data.agent2?.name ?? "Agent B",
  });
}

function isIgnorableRaceError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return (
    message.includes("already known") ||
    message.includes("replacement transaction underpriced") ||
    message.includes("nonce too low") ||
    message.includes("MarketAlreadyExists") ||
    message.includes("already exists") ||
    message.includes("MarketNotOpen") ||
    message.includes("BettingClosed") ||
    message.includes("MarketAlreadyResolved") ||
    message.includes("OracleNotResolved")
  );
}

function buildEvmRuntime(
  label: string,
  rpcUrl: string | undefined,
  duelOracleAddress: string | undefined,
  goldClobAddress: string | undefined,
  skillOracleAddress: string | undefined,
  perpEngineAddress: string | undefined,
  privateKey: `0x${string}` | null,
): EvmKeeperRuntime | null {
  const oracle = parseAddressEnv(duelOracleAddress);
  const clob = parseAddressEnv(goldClobAddress);
  const skillOracle = parseAddressEnv(skillOracleAddress);
  const perpEngine = parseAddressEnv(perpEngineAddress);
  const trimmedRpcUrl = rpcUrl?.trim() ?? "";
  if (!trimmedRpcUrl || !oracle || !clob || !privateKey) {
    return null;
  }

  const account = privateKeyToAccount(privateKey);
  const transport = http(trimmedRpcUrl);
  return {
    label,
    duelOracleAddress: oracle,
    goldClobAddress: clob,
    skillOracleAddress: skillOracle,
    perpEngineAddress: perpEngine,
    publicClient: createPublicClient({ transport }),
    walletClient: createWalletClient({ account, transport }),
    account,
    perpsCache: new Map(),
  };
}

const args = await yargs(hideBin(process.argv))
  .option("game-url", {
    type: "string",
    default: process.env.GAME_URL || "http://localhost:3000",
    describe: "URL of the Hyperscape game server",
  })
  .strict()
  .parse();

const evmKeeperPrivateKey = parsePrivateKey(
  process.env.EVM_KEEPER_PRIVATE_KEY ?? process.env.PRIVATE_KEY,
);

const runtimes = [
  buildEvmRuntime(
    "bsc",
    process.env.BSC_RPC_URL ??
      process.env.BSC_MAINNET_RPC ??
      process.env.BSC_TESTNET_RPC,
    process.env.BSC_DUEL_ORACLE_ADDRESS,
    process.env.BSC_GOLD_CLOB_ADDRESS,
    process.env.BSC_SKILL_ORACLE_ADDRESS,
    process.env.BSC_PERP_ENGINE_ADDRESS,
    evmKeeperPrivateKey,
  ),
  buildEvmRuntime(
    "base",
    process.env.BASE_RPC_URL ??
      process.env.BASE_MAINNET_RPC ??
      process.env.BASE_SEPOLIA_RPC,
    process.env.BASE_DUEL_ORACLE_ADDRESS,
    process.env.BASE_GOLD_CLOB_ADDRESS,
    process.env.BASE_SKILL_ORACLE_ADDRESS,
    process.env.BASE_PERP_ENGINE_ADDRESS,
    evmKeeperPrivateKey,
  ),
  buildEvmRuntime(
    "avax",
    process.env.AVAX_RPC_URL ??
      process.env.AVAX_MAINNET_RPC ??
      process.env.AVAX_FUJI_RPC,
    process.env.AVAX_DUEL_ORACLE_ADDRESS,
    process.env.AVAX_GOLD_CLOB_ADDRESS,
    process.env.AVAX_SKILL_ORACLE_ADDRESS,
    process.env.AVAX_PERP_ENGINE_ADDRESS,
    evmKeeperPrivateKey,
  ),
].filter((chain): chain is EvmKeeperRuntime => chain !== null);

if (runtimes.length === 0) {
  throw new Error(
    "No EVM keeper chains configured. Set EVM_KEEPER_PRIVATE_KEY/PRIVATE_KEY and at least one *_RPC_URL, *_DUEL_ORACLE_ADDRESS, *_GOLD_CLOB_ADDRESS tuple.",
  );
}

const perpsPollIntervalMs = Math.max(
  5_000,
  Number(process.env.PERPS_SYNC_POLL_INTERVAL_MS || 15_000),
);

function parseAgentKey(value: string | null | undefined, fallbackCharacterId: string): Hex {
  const trimmed = value?.trim() ?? "";
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase() as Hex;
  }
  return pad(stringToHex(fallbackCharacterId.trim()), { size: 32 }) as Hex;
}

function parsePerpsStatus(value: string | null | undefined): number {
  switch ((value ?? "").trim().toUpperCase()) {
    case "CLOSE_ONLY":
      return 2;
    case "ARCHIVED":
      return 3;
    default:
      return 1;
  }
}

async function upsertEvmDuelLifecycle(
  data: DuelLifecycleEvent,
  status: 2 | 3,
): Promise<void> {
  const duelKey = normalizeHex32(data.duelKeyHex);
  const betOpenTs = BigInt(Math.floor((data.betOpenTime ?? Date.now()) / 1000));
  const betCloseTs = BigInt(
    Math.floor(
      (data.betCloseTime ?? data.fightStartTime ?? Date.now() + 1_000) / 1000,
    ),
  );
  const duelStartTs = BigInt(
    Math.floor((data.fightStartTime ?? data.betCloseTime ?? Date.now()) / 1000),
  );
  const metadata = buildDuelMetadata(data);

  const settled = await Promise.allSettled(
    runtimes.map(async (runtime) => {
      await runtime.walletClient.writeContract({
        chain: undefined,
        address: runtime.duelOracleAddress,
        abi: DUEL_OUTCOME_ORACLE_ABI,
        functionName: "upsertDuel",
        args: [
          duelKey,
          participantHashHex(data.agent1),
          participantHashHex(data.agent2),
          betOpenTs,
          betCloseTs,
          duelStartTs,
          metadata,
          status,
        ],
        account: runtime.account,
      });

      const market = (await runtime.publicClient.readContract({
        address: runtime.goldClobAddress,
        abi: EVM_GOLD_CLOB_ADMIN_ABI,
        functionName: "getMarket",
        args: [duelKey, DUEL_WINNER_MARKET_KIND],
      })) as { exists: boolean };

      if (!market.exists) {
        await runtime.walletClient.writeContract({
          chain: undefined,
          address: runtime.goldClobAddress,
          abi: EVM_GOLD_CLOB_ADMIN_ABI,
          functionName: "createMarketForDuel",
          args: [duelKey, DUEL_WINNER_MARKET_KIND],
          account: runtime.account,
        });
      }

      await runtime.walletClient.writeContract({
        chain: undefined,
        address: runtime.goldClobAddress,
        abi: EVM_GOLD_CLOB_ADMIN_ABI,
        functionName: "syncMarketFromOracle",
        args: [duelKey, DUEL_WINNER_MARKET_KIND],
        account: runtime.account,
      });
    }),
  );

  for (const [index, result] of settled.entries()) {
    if (result.status === "rejected" && !isIgnorableRaceError(result.reason)) {
      throw new Error(
        `[${runtimes[index]!.label}] failed to upsert duel lifecycle: ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        }`,
      );
    }
  }
}

async function reportEvmResult(data: DuelLifecycleEvent): Promise<void> {
  if (!data.seed || !data.replayHash) {
    return;
  }

  const duelKey = normalizeHex32(data.duelKeyHex);
  const replayHash = normalizeHex32(data.replayHash);
  const winner =
    data.winnerId === data.agent1?.id ? 1 : data.winnerId === data.agent2?.id ? 2 : 0;
  if (winner === 0) {
    return;
  }

  const duelEndTs = BigInt(Math.floor((data.duelEndTime ?? Date.now()) / 1000));
  const metadata = buildDuelMetadata(data);

  const settled = await Promise.allSettled(
    runtimes.map(async (runtime) => {
      await runtime.walletClient.writeContract({
        chain: undefined,
        address: runtime.duelOracleAddress,
        abi: DUEL_OUTCOME_ORACLE_ABI,
        functionName: "reportResult",
        args: [
          duelKey,
          winner,
          BigInt(data.seed!),
          replayHash,
          resultHashHex(
            data.duelKeyHex,
            winner === 1 ? "A" : "B",
            data.seed!,
            data.replayHash!,
          ),
          duelEndTs,
          metadata,
        ],
        account: runtime.account,
      });

      await runtime.walletClient.writeContract({
        chain: undefined,
        address: runtime.goldClobAddress,
        abi: EVM_GOLD_CLOB_ADMIN_ABI,
        functionName: "syncMarketFromOracle",
        args: [duelKey, DUEL_WINNER_MARKET_KIND],
        account: runtime.account,
      });
    }),
  );

  for (const [index, result] of settled.entries()) {
    if (result.status === "rejected" && !isIgnorableRaceError(result.reason)) {
      throw new Error(
        `[${runtimes[index]!.label}] failed to report duel result: ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        }`,
      );
    }
  }
}

async function loadPerpsMarketFeed(): Promise<PerpsMarketFeedEntry[]> {
  const response = await fetch(
    `${args["game-url"].replace(/\/$/, "")}/api/perps/markets`,
    {
      cache: "no-store",
      headers: { connection: "close" },
    },
  );
  if (!response.ok) {
    throw new Error(`perps feed HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PerpsMarketsFeed;
  return Array.isArray(payload.markets)
    ? payload.markets.filter(
        (entry): entry is PerpsMarketFeedEntry =>
          typeof entry?.characterId === "string" &&
          entry.characterId.trim().length > 0,
      )
    : [];
}

async function syncPerpsRuntime(
  runtime: EvmKeeperRuntime,
  markets: PerpsMarketFeedEntry[],
): Promise<void> {
  if (!runtime.skillOracleAddress || !runtime.perpEngineAddress) {
    return;
  }

  for (const market of markets) {
    const mu = Number.isFinite(market.mu as number)
      ? Math.max(0, Math.floor(Number(market.mu)))
      : null;
    const sigma = Number.isFinite(market.sigma as number)
      ? Math.max(0, Math.floor(Number(market.sigma)))
      : null;
    if (mu === null || sigma === null) continue;

    const agentKey = parseAgentKey(market.agentKey, market.characterId);
    const status = parsePerpsStatus(market.status);
    const cacheKey = `${mu}:${sigma}:${status}`;
    if (runtime.perpsCache.get(market.characterId) === cacheKey) {
      continue;
    }

    const config = (await runtime.publicClient.readContract({
      address: runtime.perpEngineAddress,
      abi: PERP_ENGINE_ADMIN_ABI,
      functionName: "marketConfigs",
      args: [agentKey],
    })) as { exists: boolean };

    if (!config.exists) {
      await runtime.walletClient.writeContract({
        chain: undefined,
        address: runtime.perpEngineAddress,
        abi: PERP_ENGINE_ADMIN_ABI,
        functionName: "createMarket",
        args: [agentKey],
        account: runtime.account,
      });
    }

    await runtime.walletClient.writeContract({
      chain: undefined,
      address: runtime.skillOracleAddress,
      abi: SKILL_ORACLE_ABI,
      functionName: "updateAgentSkill",
      args: [agentKey, BigInt(mu), BigInt(sigma)],
      account: runtime.account,
    });

    await runtime.walletClient.writeContract({
      chain: undefined,
      address: runtime.perpEngineAddress,
      abi: PERP_ENGINE_ADMIN_ABI,
      functionName: "syncOracle",
      args: [agentKey],
      account: runtime.account,
    });

    const currentMarket = (await runtime.publicClient.readContract({
      address: runtime.perpEngineAddress,
      abi: PERP_ENGINE_ADMIN_ABI,
      functionName: "markets",
      args: [agentKey],
    })) as { status: number };

    if (Number(currentMarket.status) !== status) {
      await runtime.walletClient.writeContract({
        chain: undefined,
        address: runtime.perpEngineAddress,
        abi: PERP_ENGINE_ADMIN_ABI,
        functionName: "setMarketStatus",
        args: [agentKey, status],
        account: runtime.account,
      });
    }

    runtime.perpsCache.set(market.characterId, cacheKey);
  }
}

async function syncPerpsAcrossChains(): Promise<void> {
  const perpsRuntimes = runtimes.filter(
    (runtime) => runtime.skillOracleAddress && runtime.perpEngineAddress,
  );
  if (perpsRuntimes.length === 0) return;

  const markets = await loadPerpsMarketFeed();
  if (markets.length === 0) return;

  const settled = await Promise.allSettled(
    perpsRuntimes.map((runtime) => syncPerpsRuntime(runtime, markets)),
  );
  for (const [index, result] of settled.entries()) {
    if (result.status !== "rejected") continue;
    console.error(
      `[evm-bot] failed perps sync on ${perpsRuntimes[index]!.label}`,
      result.reason,
    );
  }
}

const gameClient = new GameClient(args["game-url"]);

gameClient.onDuelStart(async (data) => {
  try {
    await upsertEvmDuelLifecycle(data, 2);
    console.log(`[evm-bot] upserted duel ${data.duelId} across ${runtimes.length} EVM chain(s)`);
  } catch (error) {
    console.error(`[evm-bot] failed to upsert duel ${data.duelId}`, error);
  }
});

gameClient.onBettingLocked(async (data) => {
  try {
    await upsertEvmDuelLifecycle(data, 3);
    console.log(`[evm-bot] locked duel ${data.duelId} across ${runtimes.length} EVM chain(s)`);
  } catch (error) {
    console.error(`[evm-bot] failed to lock duel ${data.duelId}`, error);
  }
});

gameClient.onDuelEnd(async (data) => {
  try {
    await reportEvmResult(data);
    console.log(`[evm-bot] reported duel result ${data.duelId} across ${runtimes.length} EVM chain(s)`);
  } catch (error) {
    console.error(`[evm-bot] failed to report duel result ${data.duelId}`, error);
  }
});

gameClient.connect();
void syncPerpsAcrossChains();
setInterval(() => {
  void syncPerpsAcrossChains();
}, perpsPollIntervalMs);
