#!/usr/bin/env node

import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prohibitedTerms = [
  ["hyper", "scape"].join(""),
  ["rune", "scape"].join(""),
  ["OS", "RS"].join(""),
];
const ignoredDirectories = new Set([
  ".anchor",
  ".ci-artifacts",
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "storybook-artifacts",
  "storybook-static",
  "target",
  "test-results",
]);
const ignoredGlobs = [...ignoredDirectories].flatMap((directory) => [
  `!**/${directory}`,
  `!**/${directory}/**`,
]);
ignoredGlobs.push("!**/node_modules [0-9]*", "!**/node_modules [0-9]*/**");

function isIgnoredDirectory(name) {
  return ignoredDirectories.has(name) || /^node_modules [0-9]+$/.test(name);
}

function containsProhibitedTerm(value) {
  const normalized = value.toLowerCase();
  return prohibitedTerms.some((term) =>
    normalized.includes(term.toLowerCase()),
  );
}

function findPathViolations(directory, relativeDirectory = "") {
  const violations = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      (entry.isDirectory() && isIgnoredDirectory(entry.name)) ||
      entry.name.startsWith(".e2e-")
    ) {
      continue;
    }

    const relativePath = path.join(relativeDirectory, entry.name);
    if (containsProhibitedTerm(relativePath)) {
      violations.push(relativePath);
    }
    if (entry.isDirectory()) {
      violations.push(
        ...findPathViolations(path.join(directory, entry.name), relativePath),
      );
    }
  }
  return violations;
}

const args = ["-a", "-l", "-i", "--hidden", "--no-ignore"];
for (const glob of ignoredGlobs) {
  args.push("--glob", glob);
}
args.push("--glob", "!**/.e2e-*");
for (const term of prohibitedTerms) {
  args.push("-e", term);
}
args.push("--", ".");

const contentScan = spawnSync("rg", args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (contentScan.error) throw contentScan.error;
if (contentScan.status !== 0 && contentScan.status !== 1) {
  throw new Error(`branding content scan failed: ${contentScan.stderr.trim()}`);
}

const contentViolations =
  contentScan.status === 0
    ? contentScan.stdout.split(/\r?\n/).filter(Boolean).sort()
    : [];
const pathViolations = findPathViolations(root).sort();

if (contentViolations.length > 0 || pathViolations.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        contentViolations,
        pathViolations,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    prohibitedTerms: prohibitedTerms.length,
    sourceAndBinaryContentScan: true,
    workingTreePathScan: true,
  }),
);
