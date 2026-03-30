import fs from "node:fs";
import path from "node:path";

import { ethers, network } from "hardhat";

import { writeDeploymentReceipt } from "./deployment-receipt";

type BootstrapMarketStatus = "ACTIVE" | "CLOSE_ONLY" | "ARCHIVED";

type BootstrapMarketConfig = {
  agentId: string;
  mu: string | number;
  sigma: string | number;
  insuranceFund?: string | number;
  status?: BootstrapMarketStatus;
  skewScale?: string | number;
  maxLeverage?: string | number;
  maintenanceMarginBps?: number;
  liquidationRewardBps?: number;
  maxOracleDelay?: number;
  maxOpenInterest?: string | number;
  tradeTreasuryFeeBps?: number;
  tradeMarketMakerFeeBps?: number;
};

const MANIFEST_NETWORK_KEYS = new Map<string, string>([
  ["bscTestnet", "bscTestnet"],
  ["bsc", "bsc"],
  ["baseSepolia", "baseSepolia"],
  ["base", "base"],
  ["avaxFuji", "avaxFuji"],
  ["avax", "avax"],
]);

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

function resolveManifestPaths(): Array<string> {
  return [
    path.resolve(
      __dirname,
      "..",
      "..",
      "hyperbet-deployments",
      "contracts.json",
    ),
  ];
}

function updatePerpsManifest(
  networkName: string,
  skillOracleAddress: string,
  perpEngineAddress: string,
  goldTokenAddress: string,
  perpMarginTokenAddress: string,
): void {
  const manifestKey = MANIFEST_NETWORK_KEYS.get(networkName);
  if (!manifestKey) return;
  if (process.env.SKIP_BETTING_MANIFEST_UPDATE === "true") {
    console.log("Skipping betting manifest update");
    return;
  }

  for (const manifestPath of resolveManifestPaths()) {
    if (!fs.existsSync(manifestPath)) {
      console.warn("Skipping missing betting manifest:", manifestPath);
      continue;
    }

    const rawManifest = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(rawManifest) as {
      evm?: Record<
        string,
        {
          goldTokenAddress?: string;
          skillOracleAddress?: string;
          perpEngineAddress?: string;
          perpMarginTokenAddress?: string;
          deploymentVersion?: string;
        }
      >;
    };

    if (!manifest.evm || !manifest.evm[manifestKey]) {
      console.warn(
        `Skipping manifest without evm entry '${manifestKey}': ${manifestPath}`,
      );
      continue;
    }

    manifest.evm[manifestKey] = {
      ...manifest.evm[manifestKey],
      goldTokenAddress,
      skillOracleAddress,
      perpEngineAddress,
      perpMarginTokenAddress,
      deploymentVersion: "v3",
    };

    ensureDir(manifestPath);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log("Updated perps manifest:", manifestPath);
  }
}

function parseUnitsValue(value: string | number, decimals = 18): bigint {
  return ethers.parseUnits(String(value).trim(), decimals);
}

function parseAgentId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("0x")) {
    if (trimmed.length !== 66) {
      throw new Error(`Invalid hex agentId '${trimmed}'`);
    }
    return trimmed;
  }
  return ethers.encodeBytes32String(trimmed);
}

function parseMarketStatus(value: BootstrapMarketStatus | undefined): number | null {
  if (!value) return null;
  switch (value) {
    case "ACTIVE":
      return 1;
    case "CLOSE_ONLY":
      return 2;
    case "ARCHIVED":
      return 3;
    default:
      return null;
  }
}

function parseBootstrapMarkets(): Array<BootstrapMarketConfig> {
  const raw = process.env.PERPS_BOOTSTRAP_MARKETS_JSON?.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("PERPS_BOOTSTRAP_MARKETS_JSON must be a JSON array");
  }
  return parsed as Array<BootstrapMarketConfig>;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const initialBasePrice = ethers.parseUnits(
    process.env.PERPS_INITIAL_BASE_PRICE?.trim() || "100",
    18,
  );
  const maxOracleDelay = BigInt(
    process.env.PERPS_MAX_ORACLE_DELAY?.trim() || "120",
  );
  const defaultSkewScale = ethers.parseUnits(
    process.env.PERPS_DEFAULT_SKEW_SCALE?.trim() || "1000000",
    18,
  );
  const marginTokenAddress =
    process.env.PERPS_MARGIN_TOKEN_ADDRESS?.trim() || "";
  const goldTokenAddress =
    process.env.GOLD_TOKEN_ADDRESS?.trim() || marginTokenAddress;
  const adminAddress =
    process.env.PERPS_ADMIN_ADDRESS?.trim() ||
    process.env.ADMIN_ADDRESS?.trim() ||
    "";
  const reporterAddress =
    process.env.PERPS_REPORTER_ADDRESS?.trim() ||
    process.env.REPORTER_ADDRESS?.trim() ||
    "";
  const marketOperatorAddress =
    process.env.PERPS_MARKET_OPERATOR_ADDRESS?.trim() ||
    process.env.MARKET_OPERATOR_ADDRESS?.trim() ||
    "";
  const pauserAddress =
    process.env.PERPS_PAUSER_ADDRESS?.trim() ||
    process.env.PAUSER_ADDRESS?.trim() ||
    "";
  const bootstrapMarkets = parseBootstrapMarkets();

  if (!marginTokenAddress || !ethers.isAddress(marginTokenAddress)) {
    throw new Error(
      "PERPS_MARGIN_TOKEN_ADDRESS must be set to a valid ERC20 collateral token",
    );
  }
  if (!goldTokenAddress || !ethers.isAddress(goldTokenAddress)) {
    throw new Error("GOLD_TOKEN_ADDRESS must be set to a valid ERC20 address");
  }
  if (!adminAddress || !ethers.isAddress(adminAddress)) {
    throw new Error("PERPS_ADMIN_ADDRESS or ADMIN_ADDRESS must be a valid address");
  }
  if (!reporterAddress || !ethers.isAddress(reporterAddress)) {
    throw new Error(
      "PERPS_REPORTER_ADDRESS or REPORTER_ADDRESS must be a valid address",
    );
  }
  if (!marketOperatorAddress || !ethers.isAddress(marketOperatorAddress)) {
    throw new Error(
      "PERPS_MARKET_OPERATOR_ADDRESS or MARKET_OPERATOR_ADDRESS must be a valid address",
    );
  }
  if (!pauserAddress || !ethers.isAddress(pauserAddress)) {
    throw new Error(
      "PERPS_PAUSER_ADDRESS or PAUSER_ADDRESS must be a valid address",
    );
  }

  console.log("Deploying perps contracts with account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);
  console.log("Initial base price:", initialBasePrice.toString());
  console.log("Max oracle delay:", maxOracleDelay.toString());
  console.log("Default skew scale:", defaultSkewScale.toString());
  console.log("Margin token:", marginTokenAddress);
  console.log("Gold token:", goldTokenAddress);
  console.log("Bootstrap markets:", bootstrapMarkets.length);

  const SkillOracle = await ethers.getContractFactory("SkillOracle");
  const skillOracle = await SkillOracle.deploy(
    initialBasePrice,
    maxOracleDelay,
    adminAddress,
    reporterAddress,
    pauserAddress,
  );
  await skillOracle.waitForDeployment();

  const AgentPerpEngine = await ethers.getContractFactory("AgentPerpEngine");
  const perpEngine = await AgentPerpEngine.deploy(
    await skillOracle.getAddress(),
    marginTokenAddress,
    defaultSkewScale,
    adminAddress,
    marketOperatorAddress,
    pauserAddress,
  );
  await perpEngine.waitForDeployment();

  const skillOracleAddress = await skillOracle.getAddress();
  const perpEngineAddress = await perpEngine.getAddress();
  const marginToken = await ethers.getContractAt("IERC20", marginTokenAddress);
  const bootstrappedMarkets: Array<Record<string, string | number>> = [];

  for (const market of bootstrapMarkets) {
    const agentId = parseAgentId(market.agentId);
    const mu = parseUnitsValue(market.mu, 0);
    const sigma = parseUnitsValue(market.sigma, 0);
    const insuranceFund = market.insuranceFund
      ? parseUnitsValue(market.insuranceFund, 18)
      : 0n;
    const status = parseMarketStatus(market.status);
    const useCustomConfig =
      market.skewScale !== undefined ||
      market.maxLeverage !== undefined ||
      market.maintenanceMarginBps !== undefined ||
      market.liquidationRewardBps !== undefined ||
      market.maxOracleDelay !== undefined ||
      market.maxOpenInterest !== undefined ||
      market.tradeTreasuryFeeBps !== undefined ||
      market.tradeMarketMakerFeeBps !== undefined;

    console.log(`Bootstrapping perps market ${market.agentId} (${agentId})`);
    await (await skillOracle.updateAgentSkill(agentId, mu, sigma)).wait();

    if (useCustomConfig) {
      await (
        await perpEngine[
          "createMarket(bytes32,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"
        ](
          agentId,
          market.skewScale !== undefined
            ? parseUnitsValue(market.skewScale, 18)
            : defaultSkewScale,
          market.maxLeverage !== undefined
            ? parseUnitsValue(market.maxLeverage, 18)
            : ethers.parseUnits("5", 18),
          market.maintenanceMarginBps ?? 1_000,
          market.liquidationRewardBps ?? 500,
          market.maxOracleDelay ?? 120,
          market.maxOpenInterest !== undefined
            ? parseUnitsValue(market.maxOpenInterest, 18)
            : 0n,
          market.tradeTreasuryFeeBps ?? 0,
          market.tradeMarketMakerFeeBps ?? 0,
        )
      ).wait();
    } else {
      await (await perpEngine["createMarket(bytes32)"](agentId)).wait();
    }

    if (insuranceFund > 0n) {
      await (await marginToken.approve(perpEngineAddress, insuranceFund)).wait();
      await (await perpEngine.depositInsuranceFund(agentId, insuranceFund)).wait();
    }

    if (status !== null && status !== 1) {
      await (await perpEngine.setMarketStatus(agentId, status)).wait();
    }

    bootstrappedMarkets.push({
      agentId: market.agentId,
      agentKey: agentId,
      mu: mu.toString(),
      sigma: sigma.toString(),
      insuranceFund: insuranceFund.toString(),
      status: status ?? 1,
    });
  }

  console.log("SkillOracle deployed to:", skillOracleAddress);
  console.log("AgentPerpEngine deployed to:", perpEngineAddress);

  writeDeploymentReceipt(network.name, {
    network: network.name,
    chainId,
    deployer: deployer.address,
    goldTokenAddress,
    skillOracleAddress,
    perpEngineAddress,
    perpMarginTokenAddress: marginTokenAddress,
    perpsAdminAddress: adminAddress,
    perpsReporterAddress: reporterAddress,
    perpsMarketOperatorAddress: marketOperatorAddress,
    perpsPauserAddress: pauserAddress,
    perpsInitialBasePrice: initialBasePrice.toString(),
    perpsMaxOracleDelay: maxOracleDelay.toString(),
    perpsDefaultSkewScale: defaultSkewScale.toString(),
    skillOracleDeploymentTxHash: skillOracle.deploymentTransaction()?.hash ?? null,
    perpEngineDeploymentTxHash: perpEngine.deploymentTransaction()?.hash ?? null,
    perpsBootstrappedMarkets: bootstrappedMarkets,
    perpsDeployedAt: new Date().toISOString(),
  });

  updatePerpsManifest(
    network.name,
    skillOracleAddress,
    perpEngineAddress,
    goldTokenAddress,
    marginTokenAddress,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
