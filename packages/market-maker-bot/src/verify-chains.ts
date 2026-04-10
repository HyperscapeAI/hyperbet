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

const configuredVerifyTimeoutMs = Number.parseInt(
  process.env.HYPERBET_CHAIN_VERIFY_TIMEOUT_MS ?? "",
  10,
);
const VERIFY_TIMEOUT_MS =
  Number.isFinite(configuredVerifyTimeoutMs) && configuredVerifyTimeoutMs > 0
    ? configuredVerifyTimeoutMs
    : 60_000;

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

async function withRpcStepTimeout<T>(
  promise: Promise<T>,
  label: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${VERIFY_TIMEOUT_MS}ms`));
    }, VERIFY_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isSolanaRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("monthly capacity limit exceeded")
  );
}

async function evmRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${method} HTTP ${response.status}: ${raw}`);
    }
    const payload = JSON.parse(raw) as
      | { result: T }
      | { error?: { message?: string; code?: number } };
    if ("error" in payload && payload.error) {
      const code = payload.error.code != null ? ` (${payload.error.code})` : "";
      throw new Error(
        `${method} RPC error${code}: ${payload.error.message ?? raw}`,
      );
    }
    if (!("result" in payload)) {
      throw new Error(`${method} returned no result`);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

async function evmGetCode(rpcUrl: string, address: string): Promise<string> {
  return evmRpc<string>(rpcUrl, "eth_getCode", [address, "latest"]);
}

async function evmCall<
  TFunction extends string,
>(
  rpcUrl: string,
  address: string,
  contractInterface: ethers.Interface,
  functionName: TFunction,
): Promise<ethers.Result> {
  const data = contractInterface.encodeFunctionData(functionName, []);
  const rawResult = await evmRpc<string>(rpcUrl, "eth_call", [
    { to: address, data },
    "latest",
  ]);
  return contractInterface.decodeFunctionResult(functionName, rawResult);
}

function defaultSolanaFallbackRpcUrl(primaryRpcUrl: string): string {
  return /testnet/i.test(primaryRpcUrl)
    ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com";
}

function solanaRpcCandidates(primaryRpcUrl: string): string[] {
  const configuredFallbacks = (
    process.env.SOLANA_VERIFY_FALLBACK_RPC_URLS ?? ""
  )
    .split(",")
    .map((entry) => entry.trim());
  return uniqueNonEmpty([
    primaryRpcUrl,
    ...configuredFallbacks,
    process.env.SOLANA_PUBLIC_RPC_URL,
    defaultSolanaFallbackRpcUrl(primaryRpcUrl),
  ]);
}

export const verifyEvmChain = async (
  params: EvmSurfaceCheck,
): Promise<CheckResult> => {
  try {
    const chainIdHex = await withRpcStepTimeout(
      evmRpc<string>(params.rpcUrl, "eth_chainId", []),
      `${params.chain} eth_chainId`,
    );
    const chainId = BigInt(chainIdHex);
    if (chainId !== params.expectedChainId) {
      return {
        chain: params.chain,
        ok: false,
        details: `wrong chainId ${chainId.toString()} (expected ${params.expectedChainId.toString()})`,
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
    ] = await withRpcStepTimeout(
      Promise.all([
        evmGetCode(params.rpcUrl, params.duelOracleAddress),
        evmGetCode(params.rpcUrl, params.goldClobAddress),
        evmGetCode(params.rpcUrl, params.goldAmmRouterAddress),
        evmGetCode(params.rpcUrl, params.mUsdTokenAddress),
        evmGetCode(params.rpcUrl, params.goldTokenAddress),
        evmGetCode(params.rpcUrl, params.skillOracleAddress),
        evmGetCode(params.rpcUrl, params.perpEngineAddress),
      ]),
      `${params.chain} load contract bytecode`,
    );

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

    const clobInterface = new ethers.Interface(EVM_CLOB_ABI);
    const ammInterface = new ethers.Interface(EVM_AMM_ABI);
    const skillOracleInterface = new ethers.Interface(EVM_SKILL_ORACLE_ABI);
    const perpEngineInterface = new ethers.Interface(EVM_PERP_ENGINE_ABI);

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
    ] = await withRpcStepTimeout(
      Promise.all([
        evmCall(params.rpcUrl, params.goldClobAddress, clobInterface, "duelOracle"),
        evmCall(params.rpcUrl, params.goldClobAddress, clobInterface, "feeBps"),
        evmCall(params.rpcUrl, params.goldAmmRouterAddress, ammInterface, "duelOracle"),
        evmCall(params.rpcUrl, params.goldAmmRouterAddress, ammInterface, "mUSD"),
        evmCall(params.rpcUrl, params.goldAmmRouterAddress, ammInterface, "configFrozen"),
        evmCall(params.rpcUrl, params.skillOracleAddress, skillOracleInterface, "oraclePaused"),
        evmCall(params.rpcUrl, params.skillOracleAddress, skillOracleInterface, "maxOracleDelay"),
        evmCall(params.rpcUrl, params.perpEngineAddress, perpEngineInterface, "oracle"),
        evmCall(params.rpcUrl, params.perpEngineAddress, perpEngineInterface, "marginToken"),
        evmCall(params.rpcUrl, params.perpEngineAddress, perpEngineInterface, "tradingPaused"),
        evmCall(params.rpcUrl, params.perpEngineAddress, perpEngineInterface, "marketCreationPaused"),
      ]),
      `${params.chain} read contract configuration`,
    );

    const [
      clobOracleAddress,
      clobFeeBpsValue,
      ammOracleAddress,
      ammMUsdAddress,
      ammFrozenValue,
      oraclePausedValue,
      oracleMaxDelayValue,
      perpOracleAddress,
      perpMarginTokenAddress,
      perpTradingPausedValue,
      perpMarketCreationPausedValue,
    ] = [
      clobOracle[0],
      clobFeeBps[0],
      ammOracle[0],
      ammMUsd[0],
      ammFrozen[0],
      oraclePaused[0],
      oracleMaxDelay[0],
      perpOracle[0],
      perpMarginToken[0],
      perpTradingPaused[0],
      perpMarketCreationPaused[0],
    ];

    const ok =
      ethers.getAddress(String(clobOracleAddress)) ===
        ethers.getAddress(params.duelOracleAddress) &&
      ethers.getAddress(String(ammOracleAddress)) ===
        ethers.getAddress(params.duelOracleAddress) &&
      ethers.getAddress(String(ammMUsdAddress)) ===
        ethers.getAddress(params.mUsdTokenAddress) &&
      ethers.getAddress(String(perpOracleAddress)) ===
        ethers.getAddress(params.skillOracleAddress) &&
      ethers.getAddress(String(perpMarginTokenAddress)) ===
        ethers.getAddress(params.perpMarginTokenAddress) &&
      ammFrozenValue === true &&
      oraclePausedValue === false &&
      perpTradingPausedValue === false &&
      perpMarketCreationPausedValue === false;

    return {
      chain: params.chain,
      ok,
      details:
        `chainId=${chainId.toString()} ` +
        `oracle=${params.duelOracleAddress} clob=${params.goldClobAddress} ` +
        `clobFeeBps=${clobFeeBpsValue.toString()} amm=${params.goldAmmRouterAddress} ` +
        `ammFrozen=${String(ammFrozenValue)} skillOracleDelay=${oracleMaxDelayValue.toString()} ` +
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
  const goldClobProgramId = new PublicKey(params.goldClobProgramId);
  const goldAmmProgramId = new PublicKey(params.goldAmmProgramId);
  const goldPerpsProgramId = new PublicKey(params.goldPerpsProgramId);
  let lastError: unknown = null;

  for (const rpcUrl of solanaRpcCandidates(params.rpcUrl)) {
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const [version, clobInfo, ammInfo, perpsInfo] = await Promise.all([
        connection.getVersion(),
        connection.getAccountInfo(goldClobProgramId, "confirmed"),
        connection.getAccountInfo(goldAmmProgramId, "confirmed"),
        connection.getAccountInfo(goldPerpsProgramId, "confirmed"),
      ]);

      if (
        !clobInfo?.executable ||
        !ammInfo?.executable ||
        !perpsInfo?.executable
      ) {
        return {
          chain: "solana",
          ok: false,
          details:
            "one or more Solana launch programs are missing or not executable",
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
          `rpc=${rpcUrl} clob=${goldClobProgramId.toBase58()} ` +
          `amm=${goldAmmProgramId.toBase58()} perps=${goldPerpsProgramId.toBase58()} ` +
          `clobConfig=${clobConfigInfo ? "present" : "missing"} ` +
          `ammAdmin=${ammAdminInfo ? "present" : "missing"} ` +
          `ammConfig=${ammConfigInfo ? "present" : "missing"} ` +
          `perpsConfig=${perpsConfigInfo ? "present" : "missing"} core=${coreVersion}`,
      };
    } catch (error) {
      lastError = error;
      if (!isSolanaRateLimitError(error)) {
        continue;
      }
    }
  }

  return {
    chain: "solana",
    ok: false,
    details: lastError instanceof Error ? lastError.message : String(lastError),
  };
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
