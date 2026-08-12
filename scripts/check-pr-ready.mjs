#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function runStep(label, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync("bun", args, {
    stdio: "inherit",
    cwd: repoRoot,
    env: { ...process.env },
  });
  if (result.status !== 0) {
    throw new Error(`step failed: ${label}`);
  }
}

runStep("frozen install", ["install", "--frozen-lockfile"]);
runStep("Solana application install", [
  "install",
  "--cwd",
  "packages/hyperbet-solana/app",
  "--frozen-lockfile",
]);
runStep("Solana keeper install", [
  "install",
  "--cwd",
  "packages/hyperbet-solana/keeper",
  "--frozen-lockfile",
]);
runStep("SOL-only environment audit", ["run", "ci:env"]);
runStep("SOL-only source and bundle scope", ["run", "ci:scope:solana"]);
runStep("launch registry and artifact policy", [
  "run",
  "ci:gate:registry:launch",
]);
runStep("launch keeper tests", [
  "run",
  "--cwd",
  "packages/hyperbet-solana/keeper",
  "test:launch",
]);
runStep("launch keeper typecheck", [
  "x",
  "tsc",
  "--noEmit",
  "--project",
  "packages/hyperbet-solana/keeper/tsconfig.launch.json",
]);
runStep("Solana application typecheck", [
  "run",
  "--cwd",
  "packages/hyperbet-solana/app",
  "typecheck",
]);
runStep("Solana application lint", [
  "run",
  "--cwd",
  "packages/hyperbet-solana/app",
  "lint",
]);
runStep("shared UI tests", ["run", "--cwd", "packages/hyperbet-ui", "test"]);
runStep("simulation policy tests", [
  "run",
  "--cwd",
  "packages/simulation-dashboard",
  "test",
]);
runStep("SDK build", ["run", "--cwd", "packages/hyperbet-sdk", "build"]);
runStep("SDK tests", ["run", "--cwd", "packages/hyperbet-sdk", "test"]);
runStep("production application build", ["run", "build:solana"]);
runStep("post-build SOL-only bundle scope", ["run", "ci:scope:solana"]);

console.log("\nAll Solana duel v1 pre-PR checks passed.");
