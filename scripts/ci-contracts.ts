import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib";

type ContractCiTarget = "fast" | "proof" | "security";

function parseArgs(): ContractCiTarget {
  const targetArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--target="))
      ?.slice("--target=".length) ?? "fast";
  if (
    targetArg !== "fast" &&
    targetArg !== "proof" &&
    targetArg !== "security"
  ) {
    throw new Error(`unsupported contract CI target ${targetArg}`);
  }
  return targetArg;
}

const target = parseArgs();
const artifactNameByTarget: Record<ContractCiTarget, string> = {
  fast: "evm-contract-validation",
  proof: "evm-contract-proof-gate",
  security: "evm-contract-security-gate",
};
const artifactRoot = resolveArtifactRoot(artifactNameByTarget[target]);
const contractRoot = path.join(rootDir, "packages/evm-contracts");
const anvilLog = path.join(artifactRoot, "anvil.log");
const foundryFuzzRoot = path.join(contractRoot, "test", "fuzz");

function hasFoundryFuzzTests(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && hasFoundryFuzzTests(entryPath)) {
      return true;
    }
    if (entry.isFile() && entry.name.endsWith(".t.sol")) {
      return true;
    }
  }
  return false;
}

function hasBinary(name: string): boolean {
  const result = spawnSync("bash", ["-lc", `command -v ${name} >/dev/null 2>&1`], {
    cwd: contractRoot,
  });
  return result.status === 0;
}

function canRunEchidna(): boolean {
  return hasBinary("echidna") || hasBinary("docker");
}

async function runStep(
  name: string,
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await runCommand(command, args, {
    cwd: contractRoot,
    env,
    stdoutFile: path.join(artifactRoot, `${name}.out.log`),
    stderrFile: path.join(artifactRoot, `${name}.err.log`),
  });
}

writeJsonArtifact(artifactRoot, "summary.json", {
  target,
  contractRoot,
  requiredCheckName:
    target === "fast"
      ? "EVM Contract Validation"
      : target === "proof"
        ? "EVM Contract Proof Gate"
        : "EVM Contract Security Gate",
});

try {
  if (target === "fast") {
    await runStep("foundry-fast", "bun", ["run", "test:foundry:fast"]);
  } else if (target === "proof") {
    await runStep("foundry-test", "bun", ["run", "test:foundry"]);
    if (hasFoundryFuzzTests(foundryFuzzRoot)) {
      await runStep("foundry-fuzz", "bun", ["run", "test:fuzz"]);
    } else {
      writeJsonArtifact(artifactRoot, "foundry-fuzz-skip.json", {
        skipped: true,
        reason: "No Foundry fuzz tests found under packages/evm-contracts/test/fuzz",
      });
    }
    await runStep("anvil-proof", "bun", ["run", "test:anvil"], {
      ANVIL_LOG: anvilLog,
    });
  } else {
    await runStep("slither", "bun", ["run", "analyze:slither"]);
    if (canRunEchidna()) {
      await runStep("echidna", "bun", ["run", "test:echidna"]);
    } else {
      writeJsonArtifact(artifactRoot, "echidna-skip.json", {
        skipped: true,
        reason: "Neither echidna nor docker was found in PATH",
      });
    }
  }
} finally {
  if (target === "proof") {
    copyIntoArtifacts(artifactRoot, anvilLog, "anvil.log");
  }
}
