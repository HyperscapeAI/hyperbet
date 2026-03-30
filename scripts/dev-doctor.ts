import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type ToolCheck = {
  name: string;
  command: string;
  versionArgs: string[];
  required: boolean;
  expectedVersion?: string;
  notes?: string;
};

type DoctorResult = {
  ok: boolean;
  messages: string[];
  missingTools: string[];
  versionMismatches: string[];
};

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRootPackageJson(): { packageManager?: string } {
  return JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
    packageManager?: string;
  };
}

function readAnchorVersion(): string | undefined {
  const anchorTomlPath = path.join(
    rootDir,
    "packages/hyperbet-solana/anchor/Anchor.toml",
  );
  const body = readFileSync(anchorTomlPath, "utf8");
  const match = body.match(/anchor_version\s*=\s*"([^"]+)"/);
  return match?.[1];
}

function commandExists(command: string): boolean {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return result.status === 0;
}

function runVersion(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return `${result.stdout}${result.stderr}`.trim();
}

function extractVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

function nodeModulesPresent(): boolean {
  return existsSync(path.join(rootDir, "node_modules"));
}

function standaloneInstallDirs(): string[] {
  return [
    "packages/hyperbet-solana/anchor",
    "packages/hyperbet-solana/app",
    "packages/hyperbet-bsc/app",
    "packages/hyperbet-avax/app",
  ].filter((dir) => existsSync(path.join(rootDir, dir, "package.json")));
}

export function runDoctor(): DoctorResult {
  const rootPackageJson = readRootPackageJson();
  const expectedBunVersion = rootPackageJson.packageManager
    ?.split("@")
    .slice(1)
    .join("@");
  const expectedAnchorVersion = readAnchorVersion();

  const checks: ToolCheck[] = [
    {
      name: "bun",
      command: "bun",
      versionArgs: ["--version"],
      required: true,
      expectedVersion: expectedBunVersion,
    },
    {
      name: "anchor",
      command: "anchor",
      versionArgs: ["--version"],
      required: true,
      expectedVersion: expectedAnchorVersion,
    },
    {
      name: "solana-test-validator",
      command: "solana-test-validator",
      versionArgs: ["--version"],
      required: true,
    },
    { name: "rustc", command: "rustc", versionArgs: ["--version"], required: true },
    { name: "cargo", command: "cargo", versionArgs: ["--version"], required: true },
    { name: "jq", command: "jq", versionArgs: ["--version"], required: true },
    {
      name: "anvil",
      command: "anvil",
      versionArgs: ["--version"],
      required: true,
      notes: "required for the AVAX local demo and EVM contract smoke flows",
    },
    {
      name: "forge",
      command: "forge",
      versionArgs: ["--version"],
      required: true,
      notes: "required for AVAX/BSC contract compile and deployment scripts",
    },
  ];

  const messages: string[] = [];
  const missingTools: string[] = [];
  const versionMismatches: string[] = [];

  for (const check of checks) {
    if (!commandExists(check.command)) {
      missingTools.push(
        `${check.name}${check.notes ? `: ${check.notes}` : ""}`,
      );
      messages.push(`missing ${check.name}`);
      continue;
    }

    const installedVersion = extractVersion(runVersion(check.command, check.versionArgs));
    if (check.expectedVersion && installedVersion !== check.expectedVersion) {
      versionMismatches.push(
        `${check.name}: expected ${check.expectedVersion}, found ${installedVersion ?? "unknown"}`,
      );
      messages.push(
        `${check.name} version drift (${installedVersion ?? "unknown"} != ${check.expectedVersion})`,
      );
    }
  }

  if (!existsSync(path.join(rootDir, ".env.example"))) {
    messages.push("missing root .env.example");
  }

  if (!nodeModulesPresent()) {
    messages.push("root node_modules missing");
  }

  for (const dir of standaloneInstallDirs()) {
    if (!existsSync(path.join(rootDir, dir, "node_modules"))) {
      messages.push(`missing install for ${dir}`);
    }
  }

  return {
    ok:
      missingTools.length === 0 &&
      versionMismatches.length === 0 &&
      !messages.includes("missing root .env.example"),
    messages,
    missingTools,
    versionMismatches,
  };
}

if (import.meta.main) {
  const result = runDoctor();
  const lines = [
    "Hyperbet dev doctor",
    `root: ${rootDir}`,
    result.missingTools.length === 0
      ? "tools: ok"
      : `tools: missing ${result.missingTools.join(", ")}`,
    result.versionMismatches.length === 0
      ? "versions: ok"
      : `versions: ${result.versionMismatches.join("; ")}`,
    nodeModulesPresent()
      ? "root install: present"
      : "root install: missing (run `bun run dev:bootstrap`)",
  ];

  const missingNestedInstalls = standaloneInstallDirs().filter(
    (dir) => !existsSync(path.join(rootDir, dir, "node_modules")),
  );
  lines.push(
    missingNestedInstalls.length === 0
      ? "standalone installs: present"
      : `nested installs: missing ${missingNestedInstalls.join(", ")}`,
  );

  if (!existsSync(path.join(rootDir, ".env.example"))) {
    lines.push("env template: missing .env.example");
  } else {
    lines.push("env template: present");
  }

  for (const line of lines) {
    console.log(line);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}
