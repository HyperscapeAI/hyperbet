import { CrossChainMarketMaker } from "./index.ts";

const DEFAULT_DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SimMode = "clob" | "amm" | "both";

function parseSimMode(): SimMode {
  const raw = (process.env.SIM_MODE ?? "both").toLowerCase();
  if (raw === "clob" || raw === "amm" || raw === "both") return raw;
  return "both";
}

function bootstrapDefaults() {
  if (!process.env.EVM_PRIVATE_KEY) {
    process.env.EVM_PRIVATE_KEY = DEFAULT_DEV_PRIVATE_KEY;
  }
  if (!process.env.EVM_BSC_RPC_URL) {
    process.env.EVM_BSC_RPC_URL = "http://127.0.0.1:8545";
  }
  if (!process.env.EVM_BASE_RPC_URL) {
    process.env.EVM_BASE_RPC_URL = process.env.EVM_BSC_RPC_URL;
  }
  if (!process.env.EVM_AVAX_RPC_URL) {
    process.env.EVM_AVAX_RPC_URL = process.env.EVM_BSC_RPC_URL;
  }
  if (!process.env.SOLANA_RPC_URL) {
    process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  }

  const simMode = parseSimMode();
  if (simMode === "clob") {
    process.env.MM_ENABLE_AMM = "false";
  } else if (simMode === "amm") {
    process.env.MM_ENABLE_AMM = "true";
  }
  // "both" leaves MM_ENABLE_AMM at its default (true)
}

async function main() {
  bootstrapDefaults();

  const cycles = parsePositiveInt(process.env.SIM_CYCLES, 20);
  const delayMs = parsePositiveInt(process.env.SIM_DELAY_MS, 200);

  const mm = new CrossChainMarketMaker();

  console.log(
    `[simulate] Starting bounded MM simulation: cycles=${cycles}, delayMs=${delayMs}`,
  );

  for (let i = 0; i < cycles; i += 1) {
    await mm.marketMakeCycle();
    await sleep(delayMs);
  }

  const simMode = parseSimMode();
  const config = mm.getConfig();
  const inventory = mm.getInventory();
  const activeOrders = mm.getActiveOrders();
  const ammPositions = mm.getAmmPositions();

  console.log("[simulate] Completed.");
  console.log(
    JSON.stringify(
      {
        simMode,
        cycles,
        chainStatus: {
          bsc: config.bscEnabled,
          base: config.baseEnabled,
          avax: config.avaxEnabled,
          solana: config.solanaEnabled,
        },
        ammEnabled: config.ammEnabled,
        ammSolanaEnabled: config.ammSolanaEnabled,
        ammEvmChains: config.ammEvmChains,
        inventory,
        ammPositions,
        activeOrderCount: activeOrders.length,
      },
      null,
      2,
    ),
  );

  const hasClobChain =
    config.bscEnabled || config.baseEnabled || config.avaxEnabled || config.solanaEnabled;
  const hasAmmChain =
    config.ammEnabled && (config.ammSolanaEnabled || Object.values(config.ammEvmChains ?? {}).some(Boolean));

  if (simMode === "clob" && !hasClobChain) {
    throw new Error("No CLOB chain endpoints were reachable");
  }
  if (simMode === "amm" && !hasAmmChain) {
    throw new Error("No AMM chain endpoints were reachable");
  }
  if (simMode === "both" && !hasClobChain && !hasAmmChain) {
    throw new Error("No chain endpoints were reachable");
  }
}

main().catch((error) => {
  console.error("[simulate] Failed:", (error as Error).message);
  process.exit(1);
});
