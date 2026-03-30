import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { resolveArtifactRoot, rootDir, writeJsonArtifact } from "./ci-lib";

const artifactRoot = resolveArtifactRoot("repo-artifact-policy");
const forbiddenTrackedPatterns = [
  /^packages\/[^/]+\/anchor\/target\/deploy\/[^/]+\.so$/,
  /^packages\/[^/]+\/anchor\/target\/deploy\/[^/]+-keypair\.json$/,
];
const solanaGitignorePath = path.join(rootDir, "packages/hyperbet-solana/.gitignore");
const forbiddenGitignoreFragments = [
  "!anchor/target/deploy/",
  "!anchor/target/deploy/*-keypair.json",
  "!anchor/target/deploy/*.so",
];

function listTrackedFiles(): Array<string> {
  const result = spawnSync("git", ["ls-files"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "failed to list tracked files");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const trackedFiles = listTrackedFiles();
const trackedViolations = trackedFiles.filter((filePath) =>
  forbiddenTrackedPatterns.some((pattern) => pattern.test(filePath)),
);
const solanaGitignore = readFileSync(solanaGitignorePath, "utf8");
const gitignoreViolations = forbiddenGitignoreFragments.filter((fragment) =>
  solanaGitignore.includes(fragment),
);

writeJsonArtifact(artifactRoot, "summary.json", {
  trackedViolations,
  gitignoreViolations,
});

if (trackedViolations.length > 0 || gitignoreViolations.length > 0) {
  const messages = [
    "repo artifact policy failed",
  ];
  if (trackedViolations.length > 0) {
    messages.push(
      `tracked deploy artifacts must not be committed:\n${trackedViolations.join("\n")}`,
    );
  }
  if (gitignoreViolations.length > 0) {
    messages.push(
      `gitignore must not re-allow deploy artifacts:\n${gitignoreViolations.join("\n")}`,
    );
  }
  throw new Error(messages.join("\n\n"));
}
