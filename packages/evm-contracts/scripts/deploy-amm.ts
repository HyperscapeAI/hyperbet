import { ethers, network } from "hardhat";

import { writeDeploymentReceipt } from "./deployment-receipt";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("Deploying PM-AMM with account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);

  const treasuryAddress =
    process.env.AMM_TREASURY_ADDRESS?.trim() ||
    process.env.TREASURY_ADDRESS?.trim() ||
    deployer.address;
  const feeBps = process.env.AMM_FEE_BPS
    ? Number.parseInt(process.env.AMM_FEE_BPS, 10)
    : process.env.FEE_BPS
      ? Number.parseInt(process.env.FEE_BPS, 10)
      : 200;
  const adminAddress =
    process.env.AMM_ADMIN_ADDRESS?.trim() ||
    process.env.ADMIN_ADDRESS?.trim() ||
    "";
  const adminPrivateKey =
    process.env.AMM_ADMIN_PRIVATE_KEY?.trim() ||
    process.env.TESTNET_ADMIN_PRIVATE_KEY?.trim() ||
    process.env.ADMIN_PRIVATE_KEY?.trim() ||
    "";

  let mUsdTokenAddress =
    process.env.MUSD_TOKEN_ADDRESS?.trim() ||
    process.env.MOCK_USD_ADDRESS?.trim() ||
    "";
  if (!mUsdTokenAddress && network.name === "localhost") {
    console.log("No MUSD_TOKEN_ADDRESS found, deploying MockUSD...");
    const MockUSD = await ethers.getContractFactory("MockUSD");
    const musd = await MockUSD.deploy();
    await musd.waitForDeployment();
    mUsdTokenAddress = await musd.getAddress();
    console.log("MockUSD deployed to:", mUsdTokenAddress);
  }

  const duelOracleAddress =
    process.env.DUEL_ORACLE_ADDRESS?.trim() ||
    process.env.ORACLE_ADDRESS?.trim() ||
    "";

  if (!mUsdTokenAddress || !ethers.isAddress(mUsdTokenAddress)) {
    throw new Error("MUSD_TOKEN_ADDRESS or MOCK_USD_ADDRESS must be a valid address");
  }
  if (!duelOracleAddress || !ethers.isAddress(duelOracleAddress)) {
    throw new Error("DUEL_ORACLE_ADDRESS or ORACLE_ADDRESS must be a valid address");
  }
  if (!adminAddress || !ethers.isAddress(adminAddress)) {
    throw new Error("AMM_ADMIN_ADDRESS or ADMIN_ADDRESS must be set to a valid address");
  }
  if (!ethers.isAddress(treasuryAddress)) {
    throw new Error("AMM_TREASURY_ADDRESS or TREASURY_ADDRESS must be a valid address");
  }
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000) {
    throw new Error("AMM_FEE_BPS/FEE_BPS must be between 0 and 1000");
  }

  const MathLibrary = await ethers.getContractFactory(
    "contracts/lvr_amm/lib/Math.sol:Math",
  );
  const mathLibrary = await MathLibrary.deploy();
  await mathLibrary.waitForDeployment();

  const SwapMathLibrary = await ethers.getContractFactory(
    "contracts/lvr_amm/lib/SwapMath.sol:SwapMath",
  );
  const swapMathLibrary = await SwapMathLibrary.deploy();
  await swapMathLibrary.waitForDeployment();

  const mathLibraryAddress = await mathLibrary.getAddress();
  const swapMathLibraryAddress = await swapMathLibrary.getAddress();

  const Router = await ethers.getContractFactory("Router", {
    libraries: {
      "contracts/lvr_amm/lib/Math.sol:Math": mathLibraryAddress,
      "contracts/lvr_amm/lib/SwapMath.sol:SwapMath": swapMathLibraryAddress,
    },
  });
  const router = await Router.deploy(
    mUsdTokenAddress,
    duelOracleAddress,
    treasuryAddress,
    feeBps,
    adminAddress,
  );
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  let adminSigner = deployer;
  if (adminAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    if (!adminPrivateKey) {
      throw new Error(
        "AMM_ADMIN_PRIVATE_KEY/TESTNET_ADMIN_PRIVATE_KEY is required when AMM admin differs from deployer",
      );
    }
    const derivedAdminAddress = ethers.computeAddress(adminPrivateKey);
    if (derivedAdminAddress.toLowerCase() !== adminAddress.toLowerCase()) {
      throw new Error(
        `Configured AMM admin key does not match admin address: expected ${adminAddress}, got ${derivedAdminAddress}`,
      );
    }
    adminSigner = new ethers.Wallet(adminPrivateKey, ethers.provider);
  }

  const freezeTx = await router.connect(adminSigner).freezeConfig();
  await freezeTx.wait();

  const configFrozen = await router.configFrozen();

  console.log("PM-AMM Router deployed to:", routerAddress);
  console.log(
    "Config:",
    JSON.stringify(
      {
        mathLibraryAddress,
        swapMathLibraryAddress,
        duelOracleAddress,
        treasuryAddress,
        feeBps,
        adminAddress,
        mUsdTokenAddress,
        configFrozen,
      },
      null,
      2,
    ),
  );

  writeDeploymentReceipt(network.name, {
    network: network.name,
    chainId,
    deployer: deployer.address,
    duelOracleAddress,
    goldAmmRouterAddress: routerAddress,
    mUsdTokenAddress,
    ammMathLibraryAddress: mathLibraryAddress,
    ammSwapMathLibraryAddress: swapMathLibraryAddress,
    ammTreasuryAddress: treasuryAddress,
    ammFeeBps: feeBps,
    ammAdminAddress: adminAddress,
    ammConfigFrozen: configFrozen,
    ammDeploymentTxHash: router.deploymentTransaction()?.hash ?? null,
    ammFreezeTxHash: freezeTx.hash,
    ammDeployedAt: new Date().toISOString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
