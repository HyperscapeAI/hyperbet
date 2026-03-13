import fs from "node:fs/promises";
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
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import mockErc20Artifact from "../../../../evm-contracts/out/MockERC20.sol/MockERC20.json";
import duelOutcomeOracleArtifact from "../../../../evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json";
import goldClobArtifact from "../../../../evm-contracts/out/GoldClob.sol/GoldClob.json";

type E2eState = Record<string, unknown> & {
  currentDuelKeyHex?: string;
  evmRpcUrl?: string;
  evmChainId?: number;
  evmHeadlessAddress?: string;
  evmGoldTokenAddress?: string;
  evmGoldClobAddress?: string;
  evmMatchId?: number;
  evmDuelKeyHex?: string;
  evmMarketKey?: string;
  evmOracleAddress?: string;
  evmAdminPrivateKey?: string;
  evmSeedNoPrice?: number;
  evmSeedYesPrice?: number;
  evmSeedOrderAmount?: string;
};

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_CHAIN_ID = 97;
const DEFAULT_ADMIN_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEFAULT_ANVIL_MNEMONIC =
  "test test test test test test test test test test test junk";
const MARKET_KIND_DUEL_WINNER = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const DUEL_STATUS_BETTING_OPEN = 2;

type EvmArtifact = {
  abi: unknown[];
  bytecode:
    | `0x${string}`
    | {
        object?: string;
      };
};

function resolveArtifactBytecode(artifact: EvmArtifact): `0x${string}` {
  const raw =
    typeof artifact.bytecode === "string"
      ? artifact.bytecode
      : artifact.bytecode.object || "";
  if (!raw) {
    throw new Error("Artifact is missing deployable bytecode");
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function ensureHex32(value: string, label: string): `0x${string}` {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}; expected 32-byte hex string`);
  }
  return `0x${normalized}`;
}

function hashLabel(label: string): `0x${string}` {
  return keccak256(stringToHex(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function parseDotEnv(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    result[key] = value;
  }
  return result;
}

function serializeDotEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

async function readJson<T>(filepath: string): Promise<T | null> {
  try {
    const body = await fs.readFile(filepath, "utf8");
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

async function readEnv(filepath: string): Promise<Record<string, string>> {
  try {
    const body = await fs.readFile(filepath, "utf8");
    return parseDotEnv(body);
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(__dirname, "../..");
  const statePath = path.resolve(__dirname, "./state.json");
  const envPath = path.resolve(appDir, ".env.e2e");

  const rpcUrl =
    process.env.E2E_EVM_RPC_URL ||
    (process.env.E2E_EVM_PORT
      ? `http://127.0.0.1:${process.env.E2E_EVM_PORT}`
      : DEFAULT_RPC_URL);
  const chainId = Number(process.env.E2E_EVM_CHAIN_ID || DEFAULT_CHAIN_ID);
  const adminPrivateKey =
    process.env.E2E_EVM_ADMIN_PRIVATE_KEY || DEFAULT_ADMIN_PRIVATE_KEY;
  const makerPrivateKey = process.env.E2E_EVM_MAKER_PRIVATE_KEY || "";
  const seedNoOrderPrice = Number(
    process.env.E2E_EVM_SEED_NO_ORDER_PRICE || 600,
  );
  const seedYesOrderPrice = Number(
    process.env.E2E_EVM_SEED_YES_ORDER_PRICE || 400,
  );
  const seedOrderAmountUi = process.env.E2E_EVM_SEED_ORDER_AMOUNT || "3";

  const localChain = {
    id: chainId,
    name: "e2e-local-evm",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  } as const;

  const publicClient = createPublicClient({
    chain: localChain,
    transport: http(rpcUrl),
  });

  const adminAccount = privateKeyToAccount(adminPrivateKey as `0x${string}`);
  const makerAccount = makerPrivateKey
    ? privateKeyToAccount(makerPrivateKey as `0x${string}`)
    : mnemonicToAccount(DEFAULT_ANVIL_MNEMONIC, {
        accountIndex: 0,
        addressIndex: 1,
      });
  const walletClient = createWalletClient({
    account: adminAccount,
    chain: localChain,
    transport: http(rpcUrl),
  });
  const makerWalletClient = createWalletClient({
    account: makerAccount,
    chain: localChain,
    transport: http(rpcUrl),
  });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== chainId) {
    throw new Error(
      `Unexpected EVM chain id. expected=${chainId}, got=${onChainId}`,
    );
  }
  let nextNonce = await publicClient.getTransactionCount({
    address: adminAccount.address,
    blockTag: "pending",
  });
  let nextMakerNonce = await publicClient.getTransactionCount({
    address: makerAccount.address,
    blockTag: "pending",
  });
  const consumeNonce = (): number => {
    const nonce = nextNonce;
    nextNonce += 1;
    return nonce;
  };
  const consumeMakerNonce = (): number => {
    const nonce = nextMakerNonce;
    nextMakerNonce += 1;
    return nonce;
  };
  const existingState = (await readJson<E2eState>(statePath)) || {};
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const duelKey = ensureHex32(
    existingState.currentDuelKeyHex ||
      keccak256(stringToHex("hyperbet-e2e-evm:local")),
    "currentDuelKeyHex",
  );
  const duelBetOpenTs = latestBlock.timestamp - 15n;
  const duelBetCloseTs = duelBetOpenTs + 300n;
  const duelStartTs = duelBetCloseTs + 60n;

  const tokenDeployTx = await walletClient.deployContract({
    abi: mockErc20Artifact.abi,
    bytecode: resolveArtifactBytecode(mockErc20Artifact as EvmArtifact),
    args: ["Mock Gold", "GOLD"],
    nonce: consumeNonce(),
  });
  const tokenDeployReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenDeployTx,
  });
  const goldTokenAddress = tokenDeployReceipt.contractAddress;
  if (!goldTokenAddress) {
    throw new Error("Token deployment did not return contract address");
  }

  const oracleDeployTx = await walletClient.deployContract({
    abi: duelOutcomeOracleArtifact.abi,
    bytecode: resolveArtifactBytecode(
      duelOutcomeOracleArtifact as EvmArtifact,
    ),
    args: [adminAccount.address, adminAccount.address],
    nonce: consumeNonce(),
  });
  const oracleDeployReceipt = await publicClient.waitForTransactionReceipt({
    hash: oracleDeployTx,
  });
  const oracleAddress = oracleDeployReceipt.contractAddress;
  if (!oracleAddress) {
    throw new Error("Duel oracle deployment did not return contract address");
  }

  const clobDeployTx = await walletClient.deployContract({
    abi: goldClobArtifact.abi,
    bytecode: resolveArtifactBytecode(goldClobArtifact as EvmArtifact),
    args: [
      adminAccount.address,
      adminAccount.address,
      oracleAddress,
      adminAccount.address,
      adminAccount.address,
    ],
    nonce: consumeNonce(),
  });
  const clobDeployReceipt = await publicClient.waitForTransactionReceipt({
    hash: clobDeployTx,
  });
  const goldClobAddress = clobDeployReceipt.contractAddress;
  if (!goldClobAddress) {
    throw new Error("GoldClob deployment did not return contract address");
  }

  const mintTx = await walletClient.writeContract({
    address: goldTokenAddress as Address,
    abi: mockErc20Artifact.abi,
    functionName: "mint",
    args: [adminAccount.address, parseUnits("100000", 18)],
    account: adminAccount,
    nonce: consumeNonce(),
  });
  await publicClient.waitForTransactionReceipt({ hash: mintTx });

  const upsertDuelTx = await walletClient.writeContract({
    address: oracleAddress as Address,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      hashLabel("e2e-evm-agent-a"),
      hashLabel("e2e-evm-agent-b"),
      duelBetOpenTs,
      duelBetCloseTs,
      duelStartTs,
      "hyperbet-local-evm",
      DUEL_STATUS_BETTING_OPEN,
    ],
    account: adminAccount,
    nonce: consumeNonce(),
  });
  await publicClient.waitForTransactionReceipt({ hash: upsertDuelTx });

  const createMarketTx = await walletClient.writeContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "createMarketForDuel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
    account: adminAccount,
    nonce: consumeNonce(),
  });
  await publicClient.waitForTransactionReceipt({ hash: createMarketTx });

  const marketKey = (await publicClient.readContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as `0x${string}`;

  const seedNoOrderTx = await makerWalletClient.writeContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      seedNoOrderPrice,
      parseUnits(seedOrderAmountUi, 18),
    ],
    value: (() => {
      const amount = parseUnits(seedOrderAmountUi, 18);
      const cost = quoteCost(SELL_SIDE, seedNoOrderPrice, amount);
      const tradeTreasuryFee = cost / 100n;
      const tradeMarketMakerFee = cost / 100n;
      return cost + tradeTreasuryFee + tradeMarketMakerFee;
    })(),
    account: makerAccount,
    nonce: consumeMakerNonce(),
  });
  await publicClient.waitForTransactionReceipt({ hash: seedNoOrderTx });

  const seedYesOrderTx = await makerWalletClient.writeContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      seedYesOrderPrice,
      parseUnits(seedOrderAmountUi, 18),
    ],
    value: (() => {
      const amount = parseUnits(seedOrderAmountUi, 18);
      const cost = quoteCost(BUY_SIDE, seedYesOrderPrice, amount);
      const tradeTreasuryFee = cost / 100n;
      const tradeMarketMakerFee = cost / 100n;
      return cost + tradeTreasuryFee + tradeMarketMakerFee;
    })(),
    account: makerAccount,
    nonce: consumeMakerNonce(),
  });
  await publicClient.waitForTransactionReceipt({ hash: seedYesOrderTx });

  const env = await readEnv(envPath);
  env.VITE_BSC_RPC_URL = rpcUrl;
  env.VITE_BSC_CHAIN_ID = String(chainId);
  env.VITE_BSC_GOLD_CLOB_ADDRESS = goldClobAddress;
  env.VITE_BSC_GOLD_TOKEN_ADDRESS = goldTokenAddress;
  env.VITE_EVM_PRIVATE_KEY = adminPrivateKey;
  env.VITE_HEADLESS_EVM_PRIVATE_KEY = adminPrivateKey;
  env.VITE_HEADLESS_EVM_ADDRESS = adminAccount.address;
  env.VITE_E2E_EVM_PRIVATE_KEY = adminPrivateKey;
  env.VITE_E2E_EVM_ADDRESS = adminAccount.address;
  env.VITE_E2E_EVM_DUEL_KEY = duelKey.replace(/^0x/i, "");
  env.VITE_E2E_EVM_DUEL_ID = String(existingState.evmMatchId ?? 1);
  await fs.writeFile(envPath, serializeDotEnv(env), "utf8");

  const state: E2eState = {
    ...existingState,
    evmRpcUrl: rpcUrl,
    evmChainId: chainId,
    evmHeadlessAddress: adminAccount.address,
    evmGoldTokenAddress: goldTokenAddress,
    evmGoldClobAddress: goldClobAddress,
    evmMatchId: 1,
    evmDuelKeyHex: duelKey,
    evmMarketKey: marketKey,
    evmOracleAddress: oracleAddress,
    evmAdminPrivateKey: adminPrivateKey,
    evmSeedNoPrice: seedNoOrderPrice,
    evmSeedYesPrice: seedYesOrderPrice,
    evmSeedOrderAmount: seedOrderAmountUi,
  };

  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        rpcUrl,
        chainId,
        evmHeadlessAddress: adminAccount.address,
        evmGoldTokenAddress: goldTokenAddress,
        evmGoldClobAddress: goldClobAddress,
        evmDuelKeyHex: duelKey,
        evmMarketKey: marketKey,
        evmOracleAddress: oracleAddress,
        tx: {
          tokenDeployTx,
          oracleDeployTx,
          clobDeployTx,
          mintTx,
          upsertDuelTx,
          createMarketTx,
          seedNoOrderTx,
          seedYesOrderTx,
        },
        envPath,
        statePath,
      },
      null,
      2,
    ),
  );
}

void main();
