import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveArtifactRoot, rootDir, writeJsonArtifact } from "./ci-lib";

type RootPackage = {
  scripts?: Record<string, string>;
};

const artifactRoot = resolveArtifactRoot("soak-harness-contract");
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
) as RootPackage;
const scripts = packageJson.scripts ?? {};
const requiredScripts = ["pm:soak", "pm:soak:harness"];
const missingScripts = requiredScripts.filter((name) => !scripts[name]);

writeJsonArtifact(artifactRoot, "summary.json", {
  missingScripts,
  localPreflight: {
    command: "bash scripts/run-hyperia-pm-local.sh",
    monitorCommand: "bun run pm:soak -- --mode=local --follow --duration-min=25",
    harnessCommand: "bun run pm:soak:harness -- --duration-min=25",
    expectedArtifacts: [
      "output/playwright/pm-soak/**",
      "output/soak/**",
    ],
  },
});

if (missingScripts.length > 0) {
  throw new Error(
    `missing required root soak scripts: ${missingScripts.join(", ")}`,
  );
}
