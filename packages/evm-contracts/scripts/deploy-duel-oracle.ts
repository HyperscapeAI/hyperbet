import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

function resolveOutputPath(networkName: string): string {
  return path.resolve(
    __dirname,
    "..",
    "deployments",
    "duel-outcome-oracle",
    `${networkName}.json`,
  );
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReceipt(
  networkName: string,
  payload: Record<string, string | number | null>,
): void {
  const outputPath = resolveOutputPath(networkName);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n");
  console.log("Deployment receipt written to:", outputPath);
}

function requireAddress(name: string, fallback: string): string {
  const candidate = process.env[name]?.trim() || fallback;
  if (!ethers.isAddress(candidate)) {
    throw new Error(`Invalid ${name}: ${candidate}`);
  }
  return candidate;
}

function requireConfiguredAddress(name: string): string {
  const candidate = process.env[name]?.trim() || "";
  if (!ethers.isAddress(candidate)) {
    throw new Error(`Invalid ${name}: ${candidate || "<missing>"}`);
  }
  return candidate;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployedNetwork = await ethers.provider.getNetwork();
  const chainId = Number(deployedNetwork.chainId);
  const timelock = requireAddress(
    "ORACLE_TIMELOCK_ADDRESS",
    process.env.ORACLE_ADMIN_ADDRESS?.trim() || deployer.address,
  );
  const multisig = requireAddress(
    "ORACLE_MULTISIG_ADDRESS",
    process.env.ORACLE_ADMIN_ADDRESS?.trim() || timelock,
  );
  const emergencyCouncil = requireAddress(
    "ORACLE_EMERGENCY_COUNCIL_ADDRESS",
    timelock,
  );
  const reporter = requireAddress("ORACLE_REPORTER_ADDRESS", deployer.address);
  const finalizer = requireConfiguredAddress("ORACLE_FINALIZER_ADDRESS");
  const challenger = requireConfiguredAddress("ORACLE_CHALLENGER_ADDRESS");

  console.log("Deploying DuelOutcomeOracle with account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);
  console.log("Governance timelock:", timelock);
  console.log("Governance multisig:", multisig);
  console.log("Emergency council:", emergencyCouncil);
  console.log("Reporter:", reporter);
  console.log("Finalizer:", finalizer);
  console.log("Challenger:", challenger);

  const DuelOutcomeOracle =
    await ethers.getContractFactory("DuelOutcomeOracle");
  const oracle = await DuelOutcomeOracle.deploy(
    timelock,
    reporter,
    finalizer,
    challenger,
    emergencyCouncil,
    3600,
  );
  await oracle.waitForDeployment();

  const contractAddress = await oracle.getAddress();
  const deploymentTxHash = oracle.deploymentTransaction()?.hash ?? null;

  console.log("DuelOutcomeOracle deployed to:", contractAddress);

  writeReceipt(network.name, {
    network: network.name,
    chainId,
    deployer: deployer.address,
    oracleAddress: contractAddress,
    adminAddress: timelock,
    timelockAddress: timelock,
    multisigAddress: multisig,
    emergencyCouncilAddress: emergencyCouncil,
    reporterAddress: reporter,
    finalizerAddress: finalizer,
    challengerAddress: challenger,
    deploymentTxHash,
    deployedAt: new Date().toISOString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
