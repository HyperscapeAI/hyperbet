import path from "node:path";

import { copyIntoArtifacts, resolveArtifactRoot, rootDir, runCommand } from "./ci-lib";

type AmmTarget = "evm" | "solana";

function parseTarget(): AmmTarget {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--target="))
      ?.slice("--target=".length) ?? "evm";
  if (value !== "evm" && value !== "solana") {
    throw new Error(`unsupported AMM gate target: ${value}`);
  }
  return value;
}

const target = parseTarget();
const artifactRoot = resolveArtifactRoot(
  target === "evm" ? "amm-forge-gate" : "amm-solana-gate",
);

if (target === "evm") {
  await runCommand(
    "bash",
    [
      "scripts/run-foundry.sh",
      "test",
      "--match-path",
      "test/LvrMarket.t.sol",
      "-vvv",
      "--summary",
    ],
    {
      cwd: path.join(rootDir, "packages/evm-contracts"),
      stdoutFile: path.join(artifactRoot, "forge.out.log"),
      stderrFile: path.join(artifactRoot, "forge.err.log"),
    },
  );
  copyIntoArtifacts(
    artifactRoot,
    path.join(rootDir, "packages/evm-contracts/out"),
    "out",
  );
} else {
  const anchorRoot = path.join(rootDir, "packages/hyperbet-solana/anchor");
  await runCommand("anchor", ["build", "-p", "lvr_amm"], {
    cwd: anchorRoot,
    stdoutFile: path.join(artifactRoot, "anchor-build.log"),
    stderrFile: path.join(artifactRoot, "anchor-build.log"),
  });
  copyIntoArtifacts(
    artifactRoot,
    path.join(anchorRoot, "target/deploy/lvr_amm.so"),
    "deploy/lvr_amm.so",
  );
  copyIntoArtifacts(
    artifactRoot,
    path.join(anchorRoot, "target/idl/lvr_amm.json"),
    "idl/lvr_amm.json",
  );
}
