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

import {
  resolveEvmAcceptanceRuntime,
  resolveSolanaAcceptanceRuntime,
} from "../../../scripts/testnet-acceptance-env.ts";
import { normalizeAddress } from "./index.ts";

dotenv.config();

const EVM_CLOB_ABI = [
  "function duelOracle() view returns (address)",
  "function feeBps() view returns (uint256)",
] as const;
const EVM_AMM_ABI = [
  "function duelOracle() view returns (address)",
  "function mUSD() view returns (address)",
  "function configFrozen() view returns (bool)",
] as const;
const EVM_SKILL_ORACLE_ABI = [
  "function oraclePaused() view returns (bool)",
  "function maxOracleDelay() view returns (uint256)",
] as const;
const EVM_PERP_ENGINE_ABI = [
  "function oracle() view returns (address)",
  "function marginToken() view returns (address)",
  "function tradingPaused() view returns (bool)",
  "function marketCreationPaused() view returns (bool)",
] as const;

export type CheckResult = {
  chain: BettingEvmChain | "solana";
  ok: boolean;
  details: string;
};

type DeploymentMode = "production" | "staging" | "testnet";

type EvmSurfaceCheck = {
  chain: BettingEvmChain;
  rpcUrl: string;
  expectedChainId: bigint;
  duelOracleAddress: string;
  goldClobAddress: string;
  goldAmmRouterAddress: string;
  mUsdTokenAddress: string;
  goldTokenAddress: string;
  skillOracleAddress: string;
  perpEngineAddress: string;
  perpMarginTokenAddress: string;
};

type SolanaSurfaceCheck = {
  rpcUrl: string;
  goldClobProgramId: string;
  goldAmmProgramId: string;
  goldPerpsProgramId: string;
};

const VERIFY_TIMEOUT_MS = 20_000;

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

async function waitForCode(
  provider: ethers.JsonRpcProvider,
  address: string,
): Promise<string> {
  return provider.getCode(address);
}

export const verifyEvmChain = async (
  params: EvmSurfaceCheck,
): Promise<CheckResult> => {
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

    const [
      duelOracleCode,
      clobCode,
      ammCode,
      mUsdCode,
      goldTokenCode,
      skillOracleCode,
      perpEngineCode,
    ] = await Promise.all([
      waitForCode(provider, params.duelOracleAddress),
      waitForCode(provider, params.goldClobAddress),
      waitForCode(provider, params.goldAmmRouterAddress),
      waitForCode(provider, params.mUsdTokenAddress),
      waitForCode(provider, params.goldTokenAddress),
      waitForCode(provider, params.skillOracleAddress),
      waitForCode(provider, params.perpEngineAddress),
    ]);

    if (
      duelOracleCode === "0x" ||
      clobCode === "0x" ||
      ammCode === "0x" ||
      mUsdCode === "0x" ||
      goldTokenCode === "0x" ||
      skillOracleCode === "0x" ||
      perpEngineCode === "0x"
    ) {
      return {
        chain: params.chain,
        ok: false,
        details: "one or more full-product contracts are missing on-chain",
      };
    }

    const clob = new ethers.Contract(params.goldClobAddress, EVM_CLOB_ABI, provider);
    const amm = new ethers.Contract(params.goldAmmRouterAddress, EVM_AMM_ABI, provider);
    const skillOracle = new ethers.Contract(
      params.skillOracleAddress,
      EVM_SKILL_ORACLE_ABI,
      provider,
    );
    const perpEngine = new ethers.Contract(
      params.perpEngineAddress,
      EVM_PERP_ENGINE_ABI,
      provider,
    );

    const [
      clobOracle,
      clobFeeBps,
      ammOracle,
      ammMUsd,
      ammFrozen,
      oraclePaused,
      oracleMaxDelay,
      perpOracle,
      perpMarginToken,
      perpTradingPaused,
      perpMarketCreationPaused,
    ] = await Promise.all([
      clob.duelOracle(),
      clob.feeBps(),
      amm.duelOracle(),
      amm.mUSD(),
      amm.configFrozen(),
      skillOracle.oraclePaused(),
      skillOracle.maxOracleDelay(),
      perpEngine.oracle(),
      perpEngine.marginToken(),
      perpEngine.tradingPaused(),
      perpEngine.marketCreationPaused(),
    ]);

    const ok =
      ethers.getAddress(clobOracle) === ethers.getAddress(params.duelOracleAddress) &&
      ethers.getAddress(ammOracle) === ethers.getAddress(params.duelOracleAddress) &&
      ethers.getAddress(ammMUsd) === ethers.getAddress(params.mUsdTokenAddress) &&
      ethers.getAddress(perpOracle) === ethers.getAddress(params.skillOracleAddress) &&
      ethers.getAddress(perpMarginToken) ===
        ethers.getAddress(params.perpMarginTokenAddress) &&
      ammFrozen === true &&
      oraclePaused === false &&
      perpTradingPaused === false &&
      perpMarketCreationPaused === false;

    return {
      chain: params.chain,
      ok,
      details:
        `chainId=${network.chainId.toString()} ` +
        `oracle=${params.duelOracleAddress} clob=${params.goldClobAddress} ` +
        `clobFeeBps=${clobFeeBps.toString()} amm=${params.goldAmmRouterAddress} ` +
        `ammFrozen=${String(ammFrozen)} skillOracleDelay=${oracleMaxDelay.toString()} ` +
        `perpEngine=${params.perpEngineAddress}`,
    };
  } catch (error) {
    return {
      chain: params.chain,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
};

export const verifySolanaChain = async (
  params: SolanaSurfaceCheck,
): Promise<CheckResult> => {
  try {
    const connection = new Connection(params.rpcUrl, "confirmed");
    const goldClobProgramId = new PublicKey(params.goldClobProgramId);
    const goldAmmProgramId = new PublicKey(params.goldAmmProgramId);
    const goldPerpsProgramId = new PublicKey(params.goldPerpsProgramId);

    const [version, clobInfo, ammInfo, perpsInfo] = await Promise.all([
      connection.getVersion(),
      connection.getAccountInfo(goldClobProgramId, "confirmed"),
      connection.getAccountInfo(goldAmmProgramId, "confirmed"),
      connection.getAccountInfo(goldPerpsProgramId, "confirmed"),
    ]);

    if (!clobInfo?.executable || !ammInfo?.executable || !perpsInfo?.executable) {
      return {
        chain: "solana",
        ok: false,
        details: "one or more Solana launch programs are missing or not executable",
      };
    }

    const [clobConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      goldClobProgramId,
    );
    const [ammAdminPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("admin_state", "utf8")],
      goldAmmProgramId,
    );
    const [ammConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("amm_config", "utf8")],
      goldAmmProgramId,
    );
    const [perpsConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      goldPerpsProgramId,
    );

    const [clobConfigInfo, ammAdminInfo, ammConfigInfo, perpsConfigInfo] =
      await Promise.all([
        connection.getAccountInfo(clobConfigPda, "confirmed"),
        connection.getAccountInfo(ammAdminPda, "confirmed"),
        connection.getAccountInfo(ammConfigPda, "confirmed"),
        connection.getAccountInfo(perpsConfigPda, "confirmed"),
      ]);

    const ok =
      Boolean(clobConfigInfo) &&
      Boolean(ammAdminInfo) &&
      Boolean(ammConfigInfo) &&
      Boolean(perpsConfigInfo);
    const coreVersion = version["solana-core"] ?? "unknown";

    return {
      chain: "solana",
      ok,
      details:
        `rpc=${params.rpcUrl} clob=${goldClobProgramId.toBase58()} ` +
        `amm=${goldAmmProgramId.toBase58()} perps=${goldPerpsProgramId.toBase58()} ` +
        `clobConfig=${clobConfigInfo ? "present" : "missing"} ` +
        `ammAdmin=${ammAdminInfo ? "present" : "missing"} ` +
        `ammConfig=${ammConfigInfo ? "present" : "missing"} ` +
        `perpsConfig=${perpsConfigInfo ? "present" : "missing"} core=${coreVersion}`,
    };
  } catch (error) {
    return {
      chain: "solana",
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
};

async function withCheckTimeout(
  chain: BettingEvmChain | "solana",
  check: Promise<CheckResult>,
): Promise<CheckResult> {
  const timeout = new Promise<CheckResult>((resolve) => {
    setTimeout(() => {
      resolve({
        chain,
        ok: false,
        details: `verification timed out after ${VERIFY_TIMEOUT_MS}ms`,
      });
    }, VERIFY_TIMEOUT_MS);
  });
  return Promise.race([check, timeout]);
}

function expectedChainIdEnvVar(chain: BettingEvmChain): string {
  return `${chain.toUpperCase()}_EXPECTED_CHAIN_ID`;
}

function parseDeployment(args: Array<string>): DeploymentMode {
  const argValue = args
    .find((arg) => arg.startsWith("--deployment="))
    ?.slice("--deployment=".length);
  const envValue = process.env.HYPERBET_VERIFY_DEPLOYMENT?.trim();
  const value = argValue || envValue || "production";
  if (value !== "production" && value !== "staging" && value !== "testnet") {
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

function resolveNonMainnetEvmCheck(
  chain: BettingEvmChain,
): EvmSurfaceCheck | CheckResult {
  const runtime = resolveEvmAcceptanceRuntime(chain as "bsc" | "avax", process.env);
  const deployment = resolveBettingEvmDeploymentForChain(chain, "testnet");
  const rpcUrl = runtime.rpcUrl;
  if (!rpcUrl) {
    return {
      chain,
      ok: false,
      details: `${chain.toUpperCase()} testnet RPC URL not configured`,
    };
  }

  const addressFields = {
    duelOracleAddress: runtime.duelOracleAddress,
    goldClobAddress: runtime.goldClobAddress,
    goldAmmRouterAddress: runtime.goldAmmRouterAddress,
    mUsdTokenAddress: runtime.mUsdTokenAddress,
    goldTokenAddress: runtime.goldTokenAddress,
    skillOracleAddress: runtime.skillOracleAddress,
    perpEngineAddress: runtime.perpEngineAddress,
    perpMarginTokenAddress: runtime.perpMarginTokenAddress,
  };

  for (const [fieldName, rawAddress] of Object.entries(addressFields)) {
    const validation = validateConfiguredAddress(rawAddress ?? "", fieldName);
    if ("details" in validation) {
      return {
        chain,
        ok: false,
        details: validation.details,
      };
    }
  }

    return {
      chain,
      rpcUrl,
      expectedChainId: BigInt(
        firstNonEmptyValue(
          process.env[expectedChainIdEnvVar(chain)],
          process.env[`${chain.toUpperCase()}_TESTNET_CHAIN_ID`],
          process.env[`${chain.toUpperCase()}_STAGING_CHAIN_ID`],
          `${deployment.chainId}`,
        )!,
      ),
    duelOracleAddress: normalizeAddress(addressFields.duelOracleAddress!),
    goldClobAddress: normalizeAddress(addressFields.goldClobAddress!),
    goldAmmRouterAddress: normalizeAddress(addressFields.goldAmmRouterAddress!),
    mUsdTokenAddress: normalizeAddress(addressFields.mUsdTokenAddress!),
    goldTokenAddress: normalizeAddress(addressFields.goldTokenAddress!),
    skillOracleAddress: normalizeAddress(addressFields.skillOracleAddress!),
    perpEngineAddress: normalizeAddress(addressFields.perpEngineAddress!),
    perpMarginTokenAddress: normalizeAddress(addressFields.perpMarginTokenAddress!),
  };
}

function resolveProductionEvmCheck(
  chain: BettingEvmChain,
): EvmSurfaceCheck | CheckResult {
  try {
    const runtime = resolveBettingEvmRuntimeEnv(chain, "mainnet-beta", process.env);
    const deployment = resolveBettingEvmDeploymentForChain(chain, "mainnet-beta");
    const addresses = {
      duelOracleAddress: runtime.duelOracleAddress,
      goldClobAddress: runtime.goldClobAddress,
      goldAmmRouterAddress: runtime.goldAmmRouterAddress,
      mUsdTokenAddress: runtime.mUsdTokenAddress,
      goldTokenAddress: deployment.goldTokenAddress,
      skillOracleAddress: deployment.skillOracleAddress,
      perpEngineAddress: deployment.perpEngineAddress,
      perpMarginTokenAddress: deployment.goldTokenAddress,
    };

    for (const [fieldName, rawAddress] of Object.entries(addresses)) {
      const validation = validateConfiguredAddress(rawAddress, fieldName);
      if ("details" in validation) {
        return {
          chain,
          ok: false,
          details: validation.details,
        };
      }
    }

    return {
      chain,
      rpcUrl: runtime.rpcUrl,
      expectedChainId: BigInt(
        process.env[expectedChainIdEnvVar(chain)] || runtime.deployment.chainId,
      ),
      duelOracleAddress: normalizeAddress(addresses.duelOracleAddress),
      goldClobAddress: normalizeAddress(addresses.goldClobAddress),
      goldAmmRouterAddress: normalizeAddress(addresses.goldAmmRouterAddress),
      mUsdTokenAddress: normalizeAddress(addresses.mUsdTokenAddress),
      goldTokenAddress: normalizeAddress(addresses.goldTokenAddress),
      skillOracleAddress: normalizeAddress(addresses.skillOracleAddress),
      perpEngineAddress: normalizeAddress(addresses.perpEngineAddress),
      perpMarginTokenAddress: normalizeAddress(addresses.perpMarginTokenAddress),
    };
  } catch (error) {
    return {
      chain,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveNonMainnetSolanaCheck(): SolanaSurfaceCheck | CheckResult {
  const runtime = resolveSolanaAcceptanceRuntime(process.env);
  const rpcUrl =
    process.env.SOLANA_VERIFY_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    runtime.rpcUrl;
  if (!rpcUrl) {
    return {
      chain: "solana",
      ok: false,
      details: "SOLANA_VERIFY_RPC_URL not configured",
    };
  }

  const goldClobProgramId =
    process.env.SOLANA_VERIFY_GOLD_CLOB_PROGRAM_ID?.trim() ||
    process.env.SOLANA_VERIFY_PROGRAM_ID?.trim() ||
    runtime.goldClobProgramId;
  const goldAmmProgramId =
    process.env.SOLANA_VERIFY_GOLD_AMM_PROGRAM_ID?.trim() ||
    runtime.goldAmmProgramId;
  const goldPerpsProgramId =
    process.env.SOLANA_VERIFY_GOLD_PERPS_PROGRAM_ID?.trim() ||
    runtime.goldPerpsProgramId;

  for (const [fieldName, rawAddress] of Object.entries({
    goldClobProgramId,
    goldAmmProgramId,
    goldPerpsProgramId,
  })) {
    if (!rawAddress) {
      return {
        chain: "solana",
        ok: false,
        details: `${fieldName} not configured`,
      };
    }
  }

  return {
    rpcUrl,
    goldClobProgramId,
    goldAmmProgramId,
    goldPerpsProgramId,
  };
}

function resolveProductionSolanaCheck(): SolanaSurfaceCheck {
  const deployment = resolveBettingSolanaDeployment("mainnet-beta");
  return {
    rpcUrl:
      process.env.SOLANA_VERIFY_RPC_URL?.trim() ||
      process.env.SOLANA_RPC_URL?.trim() ||
      "https://api.mainnet-beta.solana.com",
    goldClobProgramId: deployment.goldClobMarketProgramId,
    goldAmmProgramId: deployment.goldAmmMarketProgramId,
    goldPerpsProgramId: deployment.goldPerpsMarketProgramId,
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
    const resolved =
      deployment === "production"
        ? resolveProductionEvmCheck(chain)
        : resolveNonMainnetEvmCheck(chain);
    if ("ok" in resolved) {
      return Promise.resolve(resolved);
    }
    return withCheckTimeout(chain, verifyEvmChain(resolved));
  });

  const solanaCheck = includeSolana
    ? (() => {
        const resolved =
          deployment === "production"
            ? resolveProductionSolanaCheck()
            : resolveNonMainnetSolanaCheck();
        if ("ok" in resolved) {
          return Promise.resolve(resolved);
        }
        return withCheckTimeout("solana", verifySolanaChain(resolved));
      })()
    : null;

  const results = await Promise.all(
    [...evmChecks, ...(solanaCheck ? [solanaCheck] : [])],
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

if (import.meta.main) {
  run().catch((error) => {
    console.error(
      `[verify-chains] fatal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
