import {
  BETTING_EVM_CHAIN_ORDER,
  resolveBettingSolanaDeployment,
  resolveBettingEvmDeploymentForChain,
  resolveBettingEvmRuntimeEnv,
  type BettingEvmChain,
} from "@hyperbet/chain-registry";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import { ethers } from "ethers";

import { normalizeAddress } from "./index.ts";

dotenv.config();

const DEFAULT_SOLANA_PROGRAM_ID =
  process.env.SOLANA_VERIFY_PROGRAM_ID ||
  process.env.GOLD_CLOB_MARKET_PROGRAM_ID ||
  process.env.SOLANA_ARENA_MARKET_PROGRAM_ID ||
  resolveBettingSolanaDeployment("mainnet-beta").goldClobMarketProgramId;
const DEFAULT_SOLANA_RPC_URL =
  process.env.SOLANA_VERIFY_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const EVM_CLOB_ABI = ["function feeBps() view returns (uint256)"];

export type CheckResult = {
  chain: BettingEvmChain | "solana";
  ok: boolean;
  details: string;
};

type DeploymentMode = "production" | "staging";

export function validateConfiguredAddress(
  rawAddress: string,
  fieldName: string,
): { ok: true; address: string } | { ok: false; details: string } {
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    return {
      ok: false,
      details: `${fieldName} not configured`,
    };
  }
  try {
    return {
      ok: true,
      address: normalizeAddress(trimmed),
    };
  } catch {
    return {
      ok: false,
      details: `${fieldName} invalid`,
    };
  }
}

export const verifyEvmChain = async (params: {
  chain: BettingEvmChain;
  rpcUrl: string;
  expectedChainId: bigint;
  clobAddress: string;
}): Promise<CheckResult> => {
  try {
    const provider = new ethers.JsonRpcProvider(params.rpcUrl);
    const network = await provider.getNetwork();
    if (network.chainId !== params.expectedChainId) {
      return {
        chain: params.chain,
        ok: false,
        details: `wrong chainId ${network.chainId.toString()} (expected ${params.expectedChainId.toString()})`,
      };
    }

    const code = await provider.getCode(params.clobAddress);
    if (code === "0x") {
      return {
        chain: params.chain,
        ok: false,
        details: `no contract at ${params.clobAddress}`,
      };
    }

    const clob = new ethers.Contract(params.clobAddress, EVM_CLOB_ABI, provider);
    const feeBps = (await clob.feeBps()) as bigint;
    return {
      chain: params.chain,
      ok: true,
      details: `chainId=${network.chainId.toString()} clob=${params.clobAddress} feeBps=${feeBps.toString()}`,
    };
  } catch (error) {
    return {
      chain: params.chain,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
};

export const verifySolanaChain = async (params: {
  rpcUrl: string;
  programId: string;
}): Promise<CheckResult> => {
  try {
    const connection = new Connection(params.rpcUrl, "confirmed");
    const programId = new PublicKey(params.programId);
    const [version, programInfo] = await Promise.all([
      connection.getVersion(),
      connection.getAccountInfo(programId, "confirmed"),
    ]);
    if (!programInfo?.executable) {
      return {
        chain: "solana",
        ok: false,
        details: `rpc=${params.rpcUrl} program ${programId.toBase58()} missing or not executable`,
      };
    }

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      programId,
    );
    const configInfo = await connection.getAccountInfo(configPda, "confirmed");
    const coreVersion = version["solana-core"] ?? "unknown";
    return {
      chain: "solana",
      ok: true,
      details: `rpc=${params.rpcUrl} program=${programId.toBase58()} configPda=${configInfo ? "present" : "missing"} core=${coreVersion}`,
    };
  } catch (error) {
    return {
      chain: "solana",
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
};

function expectedChainIdEnvVar(chain: BettingEvmChain): string {
  return `${chain.toUpperCase()}_EXPECTED_CHAIN_ID`;
}

function parseDeployment(args: string[]): DeploymentMode {
  const argValue = args.find((arg) => arg.startsWith("--deployment="))?.slice("--deployment=".length);
  const envValue = process.env.HYPERBET_VERIFY_DEPLOYMENT?.trim();
  const value = argValue || envValue || "production";
  if (value !== "production" && value !== "staging") {
    throw new Error(`unsupported deployment mode: ${value}`);
  }
  return value;
}

function firstNonEmptyValue(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function resolveStagingEvmCheck(
  chain: BettingEvmChain,
):
  | {
      chain: BettingEvmChain;
      rpcUrl: string;
      expectedChainId: bigint;
      clobAddress: string;
    }
  | CheckResult {
  const chainUpper = chain.toUpperCase();
  const deployment = resolveBettingEvmDeploymentForChain(chain, "mainnet-beta");
  const rpcUrl = firstNonEmptyValue(
    process.env[`${chainUpper}_STAGING_RPC_URL`],
    process.env[`EVM_${chainUpper}_STAGING_RPC_URL`],
  );
  if (!rpcUrl) {
    return {
      chain,
      ok: false,
      details: `${chainUpper}_STAGING_RPC_URL not configured`,
    };
  }

  const addressValidation = validateConfiguredAddress(
    firstNonEmptyValue(
      process.env[`CLOB_CONTRACT_ADDRESS_${chainUpper}_STAGING`],
      process.env[`${chainUpper}_STAGING_GOLD_CLOB_ADDRESS`],
      "",
    ) ?? "",
    "goldClobAddress",
  );
  if ("details" in addressValidation) {
    return {
      chain,
      ok: false,
      details: addressValidation.details,
    };
  }

  const expectedChainId = BigInt(
    firstNonEmptyValue(
      process.env[expectedChainIdEnvVar(chain)],
      process.env[`${chainUpper}_STAGING_CHAIN_ID`],
      `${deployment.chainId}`,
    )!,
  );

  return {
    chain,
    rpcUrl,
    expectedChainId,
    clobAddress: addressValidation.address,
  };
}

async function run() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const deployment = parseDeployment(args);
  const chainsArg = args.find((arg) => arg.startsWith("--chains="));
  const requestedChains = new Set(
    (chainsArg?.slice("--chains=".length).split(",") ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const includeAll = requestedChains.size === 0;
  const evmChains = BETTING_EVM_CHAIN_ORDER.filter(
    (chain) => includeAll || requestedChains.has(chain),
  );
  const includeSolana = includeAll || requestedChains.has("solana");

  const evmChecks = evmChains.map((chain) => {
    if (deployment === "staging") {
      const resolved = resolveStagingEvmCheck(chain);
      if ("ok" in resolved) {
        return Promise.resolve(resolved);
      }
      return verifyEvmChain(resolved);
    }

    const runtime = resolveBettingEvmRuntimeEnv(chain, "mainnet-beta", process.env);
    const addressValidation = validateConfiguredAddress(
      runtime.goldClobAddress,
      "goldClobAddress",
    );
    if ("details" in addressValidation) {
      return Promise.resolve({
        chain,
        ok: false,
        details: addressValidation.details,
      });
    }
    return verifyEvmChain({
      chain,
      rpcUrl: runtime.rpcUrl,
      expectedChainId: BigInt(
        process.env[expectedChainIdEnvVar(chain)] || runtime.deployment.chainId,
      ),
      clobAddress: addressValidation.address,
    });
  });
  const results = await Promise.all(
    [
      ...evmChecks,
      includeSolana
        ? verifySolanaChain({
            rpcUrl: DEFAULT_SOLANA_RPC_URL,
            programId: DEFAULT_SOLANA_PROGRAM_ID,
          })
        : null,
    ].filter(Boolean) as Array<Promise<CheckResult>>,
  );

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`deployment=${deployment}`);
    console.log("chain | status | details");
    for (const result of results) {
      console.log(
        `${result.chain} | ${result.ok ? "ok" : "fail"} | ${result.details}`,
      );
    }
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(
      `[verify-chains] fatal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
