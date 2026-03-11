#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function runStep(label, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync("bun", args, {
    stdio: "inherit",
    cwd: repoRoot,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(`step failed: ${label}`);
  }
}

const chains = ["hyperbet-solana", "hyperbet-bsc", "hyperbet-avax"];
const mmChains = ["solana", "bsc", "avax"];

runStep("root frozen install", ["install", "--frozen-lockfile"]);

for (const pkg of chains) {
  runStep(`${pkg} app frozen install`, [
    "install",
    "--cwd",
    `packages/${pkg}/app`,
    "--frozen-lockfile",
  ]);
  runStep(`${pkg} keeper frozen install`, [
    "install",
    "--cwd",
    `packages/${pkg}/keeper`,
    "--frozen-lockfile",
  ]);
  runStep(`${pkg} app typecheck`, [
    "x",
    "tsc",
    "--noEmit",
    "-p",
    `packages/${pkg}/app/tsconfig.json`,
  ]);
  runStep(`${pkg} app lint`, ["run", "--cwd", `packages/${pkg}/app`, "lint"]);

  const unitDir = path.join(repoRoot, "packages", pkg, "app", "tests", "unit");
  const hasUnitTests =
    existsSync(unitDir) && readdirSync(unitDir).some((file) => file.endsWith(".test.ts"));
  if (hasUnitTests) {
    runStep(`${pkg} app unit tests`, ["test", `packages/${pkg}/app/tests/unit`]);
  } else {
    console.log(`\n=== ${pkg} app unit tests ===\nNo app unit tests found, skipping`);
  }

  runStep(`${pkg} keeper tests`, [
    "test",
    `packages/${pkg}/keeper/src/walletKeys.test.ts`,
    `packages/${pkg}/keeper/src/modelMarkets.test.ts`,
    `packages/${pkg}/keeper/src/db.test.ts`,
    `packages/${pkg}/keeper/src/perpsMath.test.ts`,
  ]);
}

runStep("market-maker frozen install", [
  "install",
  "--cwd",
  "packages/market-maker-bot",
  "--frozen-lockfile",
]);
runStep("market-maker tests", ["run", "--cwd", "packages/market-maker-bot", "test"]);

for (const chain of mmChains) {
  runStep(`market-maker adversarial gate (${chain})`, [
    "run",
    "--cwd",
    "packages/market-maker-bot",
    "simulate:adversarial:ci",
  ], {
    env: {
      MM_ADVERSARIAL_CHAIN: chain,
      MM_ADVERSARIAL_MIN_PASSES: "6",
      MM_ADVERSARIAL_OUTPUT_DIR: `simulations/ci-${chain}`,
    },
  });
}

console.log("\nAll pre-PR checks passed.");
