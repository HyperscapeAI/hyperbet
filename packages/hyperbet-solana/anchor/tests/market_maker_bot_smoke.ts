import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("external market-maker bot Solana smoke", function () {
  this.timeout(1_000_000);

  it("runs the market-maker Solana smoke against the local validator", () => {
    const anchorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const repoRoot = path.resolve(anchorRoot, "..", "..", "..");
    const smokeScriptPath = path.resolve(
      repoRoot,
      "packages",
      "market-maker-bot",
      "src",
      "runtime-smoke-solana.ts",
    );

    execFileSync("bun", [smokeScriptPath], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    assert.ok(true);
  });
});
