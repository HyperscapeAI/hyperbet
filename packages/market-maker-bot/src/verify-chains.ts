import {
  defaultRpcUrlForEvmNetwork,
  resolveBettingEvmDeploymentForChain,
} from "@hyperbet/chain-registry";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import { ethers } from "ethers";

import { normalizeAddress } from "./index.ts";

dotenv.config();

const DEFAULT_SOLANA_PROGRAM_ID =
  process.env.SOLANA_VERIFY_PROGRAM_ID ||
  process.env.SOLANA_ARENA_MARKET_PROGRAM_ID ||
  "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi";
const DEFAULT_SOLANA_RPC_URL =
  process.env.SOLANA_VERIFY_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const EVM_CLOB_ABI = ["function feeBps() view returns (uint256)"];

export type CheckResult = {
  chain: "bsc" | "base" | "avax" | "solana";
  ok: boolean;
  details: string;
};

export const verifyEvmChain = async (params: {
  chain: "bsc" | "base" | "avax";
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

async function run() {
  const bscDeployment = resolveBettingEvmDeploymentForChain("bsc", "mainnet-beta");
  const baseDeployment = resolveBettingEvmDeploymentForChain("base", "mainnet-beta");
  const avaxDeployment = resolveBettingEvmDeploymentForChain("avax", "mainnet-beta");
  const results = await Promise.all([
    verifyEvmChain({
      chain: "bsc",
      rpcUrl:
        process.env.EVM_BSC_RPC_URL ||
        process.env[bscDeployment.rpcEnvVar] ||
        defaultRpcUrlForEvmNetwork(bscDeployment.networkKey),
      expectedChainId: BigInt(process.env.BSC_EXPECTED_CHAIN_ID || bscDeployment.chainId),
      clobAddress: normalizeAddress(
        process.env.CLOB_CONTRACT_ADDRESS_BSC || bscDeployment.goldClobAddress,
      ),
    }),
    verifyEvmChain({
      chain: "base",
      rpcUrl:
        process.env.EVM_BASE_RPC_URL ||
        process.env[baseDeployment.rpcEnvVar] ||
        defaultRpcUrlForEvmNetwork(baseDeployment.networkKey),
      expectedChainId: BigInt(process.env.BASE_EXPECTED_CHAIN_ID || baseDeployment.chainId),
      clobAddress: normalizeAddress(
        process.env.CLOB_CONTRACT_ADDRESS_BASE || baseDeployment.goldClobAddress,
      ),
    }),
    verifyEvmChain({
      chain: "avax",
      rpcUrl:
        process.env.EVM_AVAX_RPC_URL ||
        process.env[avaxDeployment.rpcEnvVar] ||
        defaultRpcUrlForEvmNetwork(avaxDeployment.networkKey),
      expectedChainId: BigInt(process.env.AVAX_EXPECTED_CHAIN_ID || avaxDeployment.chainId),
      clobAddress: normalizeAddress(
        process.env.CLOB_CONTRACT_ADDRESS_AVAX || avaxDeployment.goldClobAddress,
      ),
    }),
    verifySolanaChain({
      rpcUrl: DEFAULT_SOLANA_RPC_URL,
      programId: DEFAULT_SOLANA_PROGRAM_ID,
    }),
  ]);

  console.log("chain | status | details");
  for (const result of results) {
    console.log(
      `${result.chain} | ${result.ok ? "ok" : "fail"} | ${result.details}`,
    );
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
