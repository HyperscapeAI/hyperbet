import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji, bscTestnet } from "viem/chains";

type ChainKey = "bsc" | "avax";
type FundingProfile = "default" | "browser-acceptance";
type ActorRole =
  | "admin"
  | "keeper"
  | "reporter"
  | "market_operator"
  | "pauser"
  | "canary"
  | "matcher";

type ChainConfig = {
  chain: typeof bscTestnet | typeof avalancheFuji;
  deployerKeyEnv: string;
  rpcEnv: string[];
  reserveEth: string;
  targets: Record<ActorRole, string>;
};

type PublicAddresses = {
  evm: Record<string, Address>;
};

const FUNDING_PRIORITY: ActorRole[] = [
  "keeper",
  "canary",
  "matcher",
  "reporter",
  "market_operator",
  "pauser",
  "admin",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const publicAddresses = JSON.parse(
  readFileSync(path.join(ROOT, "keys", "stage-a", "public-addresses.json"), "utf8"),
) as PublicAddresses;

const DEFAULT_CONFIG: Record<ChainKey, ChainConfig> = {
  bsc: {
    chain: bscTestnet,
    deployerKeyEnv: "BSC_TESTNET_PRIVATE_KEY",
    rpcEnv: ["BSC_RPC_URL", "BSC_ALCHEMY_RPC_URL", "HYPERBET_BSC_TESTNET_RPC_URL"],
    reserveEth: "0.001",
    targets: {
      admin: "0.02",
      keeper: "0.02",
      reporter: "0.02",
      market_operator: "0.02",
      pauser: "0.02",
      canary: "0.02",
      matcher: "0.03",
    },
  },
  avax: {
    chain: avalancheFuji,
    deployerKeyEnv: "AVAX_FUJI_PRIVATE_KEY",
    rpcEnv: ["AVAX_RPC_URL", "AVAX_ALCHEMY_RPC_URL", "HYPERBET_AVAX_TESTNET_RPC_URL"],
    reserveEth: "0.5",
    targets: {
      admin: "0.10",
      keeper: "0.05",
      reporter: "0.05",
      market_operator: "0.05",
      pauser: "0.05",
      canary: "0.10",
      matcher: "0.10",
    },
  },
};

function parseFundingProfile(): FundingProfile {
  const profileArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--profile="))
    ?.slice("--profile=".length)
    .trim()
    .toLowerCase();

  if (!profileArg || profileArg === "default") return "default";
  if (profileArg === "browser-acceptance") return "browser-acceptance";
  throw new Error(`Unsupported --profile=${profileArg}`);
}

function resolveConfig(chainKey: ChainKey, profile: FundingProfile): ChainConfig {
  const base = DEFAULT_CONFIG[chainKey];
  if (profile !== "browser-acceptance" || chainKey !== "bsc") {
    return base;
  }
  return {
    ...base,
    reserveEth: "0.0005",
    targets: {
      admin: "0.00008",
      keeper: "0.00006",
      reporter: "0.00115",
      market_operator: "0.00040",
      pauser: "0.00008",
      canary: "0.00295",
      matcher: "0.00130",
    },
  };
}

function parseChains(): ChainKey[] {
  const chainArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--chain="))
    ?.slice("--chain=".length)
    .trim()
    .toLowerCase();

  if (!chainArg || chainArg === "all") return ["bsc", "avax"];
  if (chainArg === "bsc" || chainArg === "avax") return [chainArg];
  throw new Error(`Unsupported --chain=${chainArg}`);
}

function resolveRpcUrl(config: ChainConfig): string {
  for (const envName of config.rpcEnv) {
    const value = process.env[envName]?.trim();
    if (value) return value;
  }
  throw new Error(
    `Missing RPC URL for ${config.chain.name}. Checked: ${config.rpcEnv.join(", ")}`,
  );
}

function resolvePrivateKey(config: ChainConfig): Hex {
  const value =
    process.env[config.deployerKeyEnv]?.trim() || process.env.PRIVATE_KEY?.trim();
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Missing deployer private key in ${config.deployerKeyEnv} or PRIVATE_KEY`);
  }
  return value as Hex;
}

async function topUpChain(
  chainKey: ChainKey,
  profile: FundingProfile,
): Promise<void> {
  const config = resolveConfig(chainKey, profile);
  const rpcUrl = resolveRpcUrl(config);
  const account = privateKeyToAccount(resolvePrivateKey(config));
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(rpcUrl),
  });

  const reserve = parseEther(config.reserveEth);
  const deployerBalance = await publicClient.getBalance({ address: account.address });
  const transfers: Array<{
    role: ActorRole;
    address: Address;
    current: bigint;
    target: bigint;
    delta: bigint;
  }> = [];

  for (const [role, targetEth] of Object.entries(config.targets) as Array<
    [ActorRole, string]
  >) {
    const address = publicAddresses.evm[role];
    if (!address) {
      throw new Error(`Missing EVM address for role ${role} in public-addresses.json`);
    }
    const current = await publicClient.getBalance({ address });
    const target = parseEther(targetEth);
    if (current < target) {
      transfers.push({
        role,
        address,
        current,
        target,
        delta: target - current,
      });
    }
  }

  const totalRequired = transfers.reduce((sum, transfer) => sum + transfer.delta, 0n);
  console.log(
    `[stage-a-fund][${chainKey}] deployer=${account.address} balance=${formatEther(deployerBalance)}`,
  );

  if (transfers.length === 0) {
    console.log(`[stage-a-fund][${chainKey}] actor balances already meet targets`);
    return;
  }

  let available = deployerBalance > reserve ? deployerBalance - reserve : 0n;
  if (available < totalRequired) {
    console.warn(
      `[stage-a-fund][${chainKey}] best-effort mode: need ${formatEther(totalRequired)} plus reserve ${formatEther(reserve)}, available top-up balance is ${formatEther(available)}`,
    );
  }

  transfers.sort(
    (left, right) =>
      FUNDING_PRIORITY.indexOf(left.role) - FUNDING_PRIORITY.indexOf(right.role),
  );

  for (const transfer of transfers) {
    if (available === 0n) {
      console.warn(
        `[stage-a-fund][${chainKey}] skipped ${transfer.role}; deployer reserve floor reached`,
      );
      continue;
    }
    const value = transfer.delta <= available ? transfer.delta : available;
    console.log(
      `[stage-a-fund][${chainKey}] top up ${transfer.role} ${transfer.address} from ${formatEther(transfer.current)} toward ${formatEther(transfer.target)} (+${formatEther(value)})`,
    );
    const hash = await walletClient.sendTransaction({
      to: transfer.address,
      value,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    available -= value;
    const finalBalance = await publicClient.getBalance({ address: transfer.address });
    console.log(
      `[stage-a-fund][${chainKey}] confirmed ${transfer.role} tx=${hash} balance=${formatEther(finalBalance)}`,
    );
  }

  const finalDeployerBalance = await publicClient.getBalance({ address: account.address });
  console.log(
    `[stage-a-fund][${chainKey}] deployer remaining=${formatEther(finalDeployerBalance)}`,
  );
}

async function main(): Promise<void> {
  const profile = parseFundingProfile();
  for (const chainKey of parseChains()) {
    await topUpChain(chainKey, profile);
  }
}

await main();
