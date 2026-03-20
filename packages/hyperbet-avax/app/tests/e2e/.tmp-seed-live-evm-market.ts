import { readFileSync } from "node:fs";
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
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

const ROOT = "/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick";

const GOLD_CLOB_PATH = `${ROOT}/packages/evm-contracts/out/GoldClob.sol/GoldClob.json`;
const DUEL_ORACLE_PATH = `${ROOT}/packages/evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json`;
const BSC_STATE_PATH = `${ROOT}/packages/hyperbet-bsc/app/tests/e2e/state.json`;
const AVAX_STATE_PATH = `${ROOT}/packages/hyperbet-avax/app/tests/e2e/state.json`;

type EvmState = {
  evmRpcUrl: string;
  evmChainId: number;
  evmGoldClobAddress: string;
  evmOracleAddress: string;
  evmAdminPrivateKey: string;
};

type StreamState = {
  cycle?: {
    duelKeyHex?: string;
    duelId?: string;
    betOpenTime?: number;
    betCloseTime?: number;
    fightStartTime?: number;
    agent1?: { id?: string; name?: string };
    agent2?: { id?: string; name?: string };
  };
};

const MARKET_KIND_DUEL_WINNER = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const DUEL_STATUS_BETTING_OPEN = 2;
const ORDER_FLAG_GTC = 0x01;
const DEFAULT_ANVIL_MNEMONIC =
  "test test test test test test test test test test test junk";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeHex(value: string | undefined): Hash | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hash;
}

async function waitForAnnouncementDuel(
  maxWaitMs = 10 * 60 * 1000,
): Promise<Hash> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const response = await fetch("http://127.0.0.1:5555/api/streaming/state", {
      cache: "no-store",
    });
    if (response.ok) {
      const payload = (await response.json()) as StreamState;
      const cycle = payload.cycle;
      const phase = String(cycle?.phase || "");
      const duelKey = normalizeHex(cycle?.duelKeyHex);
      if (phase === "ANNOUNCEMENT" && duelKey) {
        return duelKey;
      }
      if (phase === "COUNTDOWN" && duelKey) {
        return duelKey;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Timed out waiting for a live ANNOUNCEMENT duel");
}

function hashLabel(label: string): Hash {
  return keccak256(stringToHex(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * component) / 1000n;
}

async function waitForReceipt(
  client: ReturnType<typeof createPublicClient>,
  hash: Hash,
  label: string,
): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${label} failed`);
  }
}

async function seedChain(
  chainKey: "bsc" | "avax",
  state: EvmState,
  duelKey: Hash,
): Promise<{ duelKey: Hash; marketKey: Hash }> {
  const duelSuffix = duelKey.slice(2, 10);
  const uniqueKey = `${chainKey}-local-ui-${duelSuffix}`;
  const rpcUrl = state.evmRpcUrl;
  const chainId = state.evmChainId;
  const adminAccount = privateKeyToAccount(
    state.evmAdminPrivateKey as `0x${string}`,
  );
  const makerAccount = mnemonicToAccount(DEFAULT_ANVIL_MNEMONIC, {
    accountIndex: 0,
    addressIndex: 1,
  });

  const chain = {
    id: chainId,
    name: `pm-${chainKey}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  } as const;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const adminWalletClient = createWalletClient({
    account: adminAccount,
    chain,
    transport: http(rpcUrl),
  });
  const makerWalletClient = createWalletClient({
    account: makerAccount,
    chain,
    transport: http(rpcUrl),
  });

  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const betOpenTs = latestBlock.timestamp - 120n;
  const betCloseTs = latestBlock.timestamp + 1800n;
  const duelStartTs = betCloseTs + 60n;

  const duelOutcomeOracleArtifact = readJson<{ abi: unknown[] }>(
    DUEL_ORACLE_PATH,
  );
  const goldClobArtifact = readJson<{ abi: unknown[] }>(GOLD_CLOB_PATH);

  const upsertHash = await adminWalletClient.writeContract({
    address: state.evmOracleAddress as Address,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      hashLabel(`${chainKey}-fresh-agent-a`),
      hashLabel(`${chainKey}-fresh-agent-b`),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      `${uniqueKey}-open`,
      DUEL_STATUS_BETTING_OPEN,
    ],
  });
  await waitForReceipt(publicClient, upsertHash, `${chainKey} upsert`);

  const createHash = await adminWalletClient.writeContract({
    address: state.evmGoldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "createMarketForDuel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(publicClient, createHash, `${chainKey} createMarket`);

  const syncHash = await adminWalletClient.writeContract({
    address: state.evmGoldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "syncMarketFromOracle",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForReceipt(publicClient, syncHash, `${chainKey} syncMarket`);

  const seedAmount = parseUnits("1", 18);
  const seedPrice = 600;
  const seedCost = quoteCost(SELL_SIDE, seedPrice, seedAmount);
  const seedFee = seedCost / 100n;
  const seedSellHash = await makerWalletClient.writeContract({
    address: state.evmGoldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      seedPrice,
      seedAmount,
      ORDER_FLAG_GTC,
    ],
    value: seedCost + seedFee + seedFee,
  });
  await waitForReceipt(publicClient, seedSellHash, `${chainKey} seed-sell`);

  const buyAmount = parseUnits("0.5", 18);
  const buyCost = quoteCost(BUY_SIDE, seedPrice, buyAmount);
  const buyFee = buyCost / 100n;
  const takerBuyHash = await adminWalletClient.writeContract({
    address: state.evmGoldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      seedPrice,
      buyAmount,
      ORDER_FLAG_GTC,
    ],
    value: buyCost + buyFee + buyFee,
  });
  await waitForReceipt(publicClient, takerBuyHash, `${chainKey} taker-buy`);

  const marketKey = (await publicClient.readContract({
    address: state.evmGoldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as Hash;

  const market = (await publicClient.readContract({
    address: state.evmGoldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "getMarket",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as {
    status: number;
    nextOrderId: bigint;
    bestBid: number;
    bestAsk: number;
    totalAShares: bigint;
    totalBShares: bigint;
  };

  console.log(
    JSON.stringify(
      {
        chainKey,
        duelKey,
        marketKey,
        market,
        admin: adminAccount.address,
        maker: makerAccount.address,
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );

  return { duelKey, marketKey };
}

async function main() {
  const bscState = readJson<EvmState>(BSC_STATE_PATH);
  const avaxState = readJson<EvmState>(AVAX_STATE_PATH);

  const duelKey = await waitForAnnouncementDuel();
  console.log(`using live duel ${duelKey}`);

  await seedChain("bsc", bscState, duelKey);
  await seedChain("avax", avaxState, duelKey);

  console.log("seeded fresh local evm market(s)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
