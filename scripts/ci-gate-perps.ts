import path from "node:path";

import { copyIntoArtifacts, resolveArtifactRoot, rootDir, runCommand } from "./ci-lib";

type PerpsTarget = "evm" | "solana";

function parseTarget(): PerpsTarget {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--target="))
      ?.slice("--target=".length) ?? "evm";
  if (value !== "evm" && value !== "solana") {
    throw new Error(`unsupported perps gate target: ${value}`);
  }
  return value;
}

const target = parseTarget();
const artifactRoot = resolveArtifactRoot(
  target === "evm" ? "perps-forge-gate" : "perps-solana-gate",
);

if (target === "evm") {
  await runCommand(
    "bash",
    [
      "scripts/run-foundry.sh",
      "test",
      "--match-path",
      "test/perps/*",
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
  await runCommand("anchor", ["build", "-p", "gold_perps_market"], {
    cwd: anchorRoot,
    stdoutFile: path.join(artifactRoot, "anchor-build.log"),
    stderrFile: path.join(artifactRoot, "anchor-build.log"),
  });
  copyIntoArtifacts(
    artifactRoot,
    path.join(anchorRoot, "target/deploy/gold_perps_market.so"),
    "deploy/gold_perps_market.so",
  );
  copyIntoArtifacts(
    artifactRoot,
    path.join(anchorRoot, "target/idl/gold_perps_market.json"),
    "idl/gold_perps_market.json",
  );
}
