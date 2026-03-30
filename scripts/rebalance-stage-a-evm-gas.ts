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
import { bscTestnet } from "viem/chains";

type Role =
  | "admin"
  | "keeper"
  | "finalizer"
  | "treasury"
  | "market_maker"
  | "challenger"
  | "reporter"
  | "market_operator"
  | "pauser"
  | "canary"
  | "matcher";

const ROLE_ADDRESS_ENV: Record<Role, string> = {
  admin: "ADMIN_ADDRESS",
  keeper: "LOCAL_STAGE_A_EVM_KEEPER_ADDRESS",
  finalizer: "FINALIZER_ADDRESS",
  treasury: "TREASURY_ADDRESS",
  market_maker: "MARKET_MAKER_ADDRESS",
  challenger: "CHALLENGER_ADDRESS",
  reporter: "REPORTER_ADDRESS",
  market_operator: "MARKET_OPERATOR_ADDRESS",
  pauser: "PAUSER_ADDRESS",
  canary: "LOCAL_STAGE_A_EVM_CANARY_ADDRESS",
  matcher: "LOCAL_STAGE_A_EVM_MATCHER_ADDRESS",
};

const ROLE_KEY_ENV: Partial<Record<Role, string>> = {
  admin: "TESTNET_ADMIN_PRIVATE_KEY",
  keeper: "EVM_KEEPER_PRIVATE_KEY",
  finalizer: "TESTNET_FINALIZER_PRIVATE_KEY",
  treasury: "TESTNET_TREASURY_PRIVATE_KEY",
  market_maker: "TESTNET_MARKET_MAKER_PRIVATE_KEY",
  challenger: "TESTNET_CHALLENGER_PRIVATE_KEY",
  reporter: "TESTNET_REPORTER_PRIVATE_KEY",
  market_operator: "TESTNET_MARKET_OPERATOR_PRIVATE_KEY",
  pauser: "TESTNET_PAUSER_PRIVATE_KEY",
  canary: "CANARY_PRIVATE_KEY",
  matcher: "MATCHER_PRIVATE_KEY",
};

function parseArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)?.trim();
  if (!value) {
    throw new Error(`Missing required --${name}=... argument`);
  }
  return value;
}

function parseRole(name: string, value: string): Role {
  if (value in ROLE_ADDRESS_ENV) {
    return value as Role;
  }
  throw new Error(`Unsupported ${name} role: ${value}`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function resolveAddress(role: Role): Address {
  return requireEnv(ROLE_ADDRESS_ENV[role]) as Address;
}

function resolvePrivateKey(role: Role): Hex {
  const envName = ROLE_KEY_ENV[role];
  if (!envName) {
    throw new Error(`Role ${role} does not have a configured private key`);
  }
  const value = requireEnv(envName);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid private key in ${envName}`);
  }
  return value as Hex;
}

async function main(): Promise<void> {
  const fromRole = parseRole("from-role", parseArg("from-role"));
  const toRole = parseRole("to-role", parseArg("to-role"));
  const amount = parseEther(parseArg("amount"));
  const rpcUrl = requireEnv("BSC_RPC_URL");

  const account = privateKeyToAccount(resolvePrivateKey(fromRole));
  const to = resolveAddress(toRole);
  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  const beforeFrom = await publicClient.getBalance({ address: account.address });
  const beforeTo = await publicClient.getBalance({ address: to });
  const hash = await walletClient.sendTransaction({
    account,
    to,
    value: amount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const afterFrom = await publicClient.getBalance({ address: account.address });
  const afterTo = await publicClient.getBalance({ address: to });

  console.log(
    JSON.stringify(
      {
        chain: "bsc",
        fromRole,
        from: account.address,
        toRole,
        to,
        amount: formatEther(amount),
        hash,
        status: receipt.status,
        balances: {
          beforeFrom: formatEther(beforeFrom),
          afterFrom: formatEther(afterFrom),
          beforeTo: formatEther(beforeTo),
          afterTo: formatEther(afterTo),
        },
      },
      null,
      2,
    ),
  );
}

await main();
