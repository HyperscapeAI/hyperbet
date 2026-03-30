/**
 * Deploy perps contracts (SkillOracle + AgentPerpEngine) via CREATE2 for
 * deterministic addresses across chains.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-perps-create2.ts --network bscTestnet
 *
 * Environment:
 *   PERPS_ADMIN_ADDRESS          – admin role (required)
 *   PERPS_REPORTER_ADDRESS       – oracle reporter role (required)
 *   PERPS_MARKET_OPERATOR_ADDRESS – market operator role (required)
 *   PERPS_PAUSER_ADDRESS         – pauser role (required)
 *   PERPS_MARGIN_TOKEN_ADDRESS   – ERC20 margin token (required, e.g. USDC)
 *   PERPS_INITIAL_BASE_PRICE     – oracle initial base price in wei (default: 100e18)
 *   PERPS_MAX_ORACLE_DELAY       – oracle max staleness in seconds (default: 120)
 *   PERPS_DEFAULT_SKEW_SCALE     – engine default skew scale in wei (default: 1_000_000e18)
 *   CREATE2_SALT                 – CREATE2 salt (default: keccak256("hyperbet-perps-v1"))
 */

import { ethers } from "hardhat";
import { writeDeploymentReceipt } from "./deployment-receipt";

const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C"; // deterministic deployer

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  const admin = process.env.PERPS_ADMIN_ADDRESS;
  const reporter = process.env.PERPS_REPORTER_ADDRESS;
  const marketOperator = process.env.PERPS_MARKET_OPERATOR_ADDRESS;
  const pauser = process.env.PERPS_PAUSER_ADDRESS;
  const marginToken = process.env.PERPS_MARGIN_TOKEN_ADDRESS;

  if (!admin || !reporter || !marketOperator || !pauser || !marginToken) {
    throw new Error(
      "Missing required env: PERPS_ADMIN_ADDRESS, PERPS_REPORTER_ADDRESS, " +
        "PERPS_MARKET_OPERATOR_ADDRESS, PERPS_PAUSER_ADDRESS, PERPS_MARGIN_TOKEN_ADDRESS",
    );
  }

  const initialBasePrice =
    BigInt(process.env.PERPS_INITIAL_BASE_PRICE ?? "") || ethers.parseEther("100");
  const maxOracleDelay = BigInt(process.env.PERPS_MAX_ORACLE_DELAY ?? "") || 120n;
  const defaultSkewScale =
    BigInt(process.env.PERPS_DEFAULT_SKEW_SCALE ?? "") || ethers.parseEther("1000000");
  const salt =
    process.env.CREATE2_SALT ?? ethers.keccak256(ethers.toUtf8Bytes("hyperbet-perps-v1"));

  // Deploy SkillOracle
  console.log("\n--- Deploying SkillOracle ---");
  const OracleFactory = await ethers.getContractFactory("SkillOracle");
  const oracleInitCode = OracleFactory.getDeployTransaction(
    initialBasePrice,
    maxOracleDelay,
    admin,
    reporter,
    pauser,
  ).data!;

  const oracleCreate2Tx = await deployer.sendTransaction({
    to: CREATE2_FACTORY,
    data: salt + oracleInitCode.slice(2),
  });
  const oracleReceipt = await oracleCreate2Tx.wait();
  const oracleAddress = ethers.getCreate2Address(
    CREATE2_FACTORY,
    salt,
    ethers.keccak256(oracleInitCode),
  );
  console.log("SkillOracle deployed at:", oracleAddress);
  console.log("Tx hash:", oracleReceipt?.hash);

  // Deploy AgentPerpEngine
  console.log("\n--- Deploying AgentPerpEngine ---");
  const EngineFactory = await ethers.getContractFactory("AgentPerpEngine");
  const engineInitCode = EngineFactory.getDeployTransaction(
    oracleAddress,
    marginToken,
    defaultSkewScale,
    admin,
    marketOperator,
    pauser,
  ).data!;

  const engineCreate2Tx = await deployer.sendTransaction({
    to: CREATE2_FACTORY,
    data: salt + engineInitCode.slice(2),
  });
  const engineReceipt = await engineCreate2Tx.wait();
  const engineAddress = ethers.getCreate2Address(
    CREATE2_FACTORY,
    salt,
    ethers.keccak256(engineInitCode),
  );
  console.log("AgentPerpEngine deployed at:", engineAddress);
  console.log("Tx hash:", engineReceipt?.hash);

  console.log("\n--- Deployment Summary ---");
  console.log("SkillOracle:", oracleAddress);
  console.log("AgentPerpEngine:", engineAddress);
  console.log("Admin:", admin);
  console.log("Reporter:", reporter);
  console.log("Market Operator:", marketOperator);
  console.log("Pauser:", pauser);
  console.log("Margin Token:", marginToken);
  console.log("Salt:", salt);

  writeDeploymentReceipt((await ethers.provider.getNetwork()).name, {
    network: (await ethers.provider.getNetwork()).name,
    goldTokenAddress:
      process.env.GOLD_TOKEN_ADDRESS?.trim() || marginToken,
    skillOracleAddress: oracleAddress,
    perpEngineAddress: engineAddress,
    perpMarginTokenAddress: marginToken,
    perpsAdminAddress: admin,
    perpsReporterAddress: reporter,
    perpsMarketOperatorAddress: marketOperator,
    perpsPauserAddress: pauser,
    perpsInitialBasePrice: initialBasePrice.toString(),
    perpsMaxOracleDelay: maxOracleDelay.toString(),
    perpsDefaultSkewScale: defaultSkewScale.toString(),
    skillOracleDeploymentTxHash: oracleReceipt?.hash ?? null,
    perpEngineDeploymentTxHash: engineReceipt?.hash ?? null,
    perpsCreate2Salt: salt,
    perpsDeployedAt: new Date().toISOString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
