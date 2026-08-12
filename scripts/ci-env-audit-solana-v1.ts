import { readFileSync } from "node:fs";
import path from "node:path";

import { rootDir } from "./ci-lib";

type AuditTarget = "ci-shared" | "pages:solana" | "keeper:solana";
type DeploymentMode = "production" | "staging";

type Finding = {
  level: "error" | "warning";
  message: string;
};

const TRACKED_ENV_FILES = [
  ".env.example",
  "packages/hyperbet-solana/app/.env.example",
  "packages/hyperbet-solana/keeper/.env.example",
] as const;

const SENSITIVE_VALUE_KEYS = [
  "ARENA_EXTERNAL_BET_WRITE_KEY",
  "STREAM_PUBLISH_KEY",
  "STREAM_STATE_SOURCE_BEARER_TOKEN",
  "HELIUS_API_KEY",
  "RAILWAY_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "SOLANA_PRIVATE_KEY",
  "SOLANA_KEEPER_FEE_PAYER_KEYPAIR",
  "SOLANA_ORACLE_REPORTER_KEYPAIR",
  "SOLANA_ORACLE_FINALIZER_KEYPAIR",
  "SOLANA_CLOB_MARKET_OPERATOR_KEYPAIR",
  "SOLANA_MARKET_MAKER_KEYPAIR",
] as const;

const FORBIDDEN_NON_SOLANA_ENV =
  /^(?:VITE_)?(?:EVM|BSC|BASE|AVAX|AVALANCHE|GOLD|PERPS|AMM)(?:_|$)/i;
const PROVIDER_SECRET_PATTERNS = [
  /[?&](?:api[-_]?key|token)=/i,
  /helius-rpc\.com/i,
  /alchemy\.com\/v2\//i,
  /infura\.io\/v3\//i,
  /quicknode\.(?:com|pro)\//i,
  /quiknode\.pro\//i,
  /drpc\.org\//i,
] as const;

function parseArgs(): {
  target: AuditTarget;
  deployment: DeploymentMode;
  json: boolean;
} {
  const args = process.argv.slice(2);
  const targetArg =
    args
      .find((arg) => arg.startsWith("--target="))
      ?.slice("--target=".length) ?? "ci-shared";
  const deploymentArg =
    args
      .find((arg) => arg.startsWith("--deployment="))
      ?.slice("--deployment=".length) ?? "production";

  if (
    targetArg !== "ci-shared" &&
    targetArg !== "pages:solana" &&
    targetArg !== "keeper:solana"
  ) {
    throw new Error(
      `unsupported SOL-only audit target: ${targetArg}; expected ci-shared, pages:solana, or keeper:solana`,
    );
  }
  if (deploymentArg !== "production" && deploymentArg !== "staging") {
    throw new Error(`unsupported deployment mode: ${deploymentArg}`);
  }

  return {
    target: targetArg,
    deployment: deploymentArg,
    json: args.includes("--json"),
  };
}

function parseEnvFile(filePath: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    parsed[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
  return parsed;
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "changeme" ||
    normalized === "<required>" ||
    normalized === "<placeholder>" ||
    normalized === "your-api-key" ||
    normalized === "your-token" ||
    normalized === "..." ||
    normalized.includes("path/to/") ||
    normalized.includes("~/.config/solana/") ||
    normalized.endsWith("/id.json")
  );
}

function requireEnv(findings: Finding[], key: string): string {
  const value = process.env[key]?.trim() ?? "";
  if (!value) {
    findings.push({ level: "error", message: `missing required env ${key}` });
  }
  return value;
}

function requireHttpUrl(
  findings: Finding[],
  key: string,
  allowedProtocols: readonly string[],
): void {
  const value = requireEnv(findings, key);
  if (!value) return;
  try {
    const url = new URL(value);
    if (!allowedProtocols.includes(url.protocol)) {
      findings.push({
        level: "error",
        message: `${key} must use ${allowedProtocols.join(" or ")}`,
      });
    }
    if (url.username || url.password) {
      findings.push({
        level: "error",
        message: `${key} must not contain URL credentials`,
      });
    }
  } catch {
    findings.push({ level: "error", message: `${key} must be a valid URL` });
  }
}

function auditTrackedEnvFiles(findings: Finding[]): void {
  for (const relativePath of TRACKED_ENV_FILES) {
    const env = parseEnvFile(path.join(rootDir, relativePath));
    for (const key of SENSITIVE_VALUE_KEYS) {
      const value = env[key];
      if (value && !isPlaceholder(value)) {
        findings.push({
          level: "error",
          message: `${relativePath} contains a non-placeholder value for ${key}`,
        });
      }
    }
  }
}

function auditInjectedEnvironment(findings: Finding[]): void {
  for (const [key, rawValue] of Object.entries(process.env)) {
    const value = rawValue?.trim() ?? "";
    if (!value) continue;
    if (FORBIDDEN_NON_SOLANA_ENV.test(key)) {
      findings.push({
        level: "error",
        message: `${key} is outside the SOL-only v1 environment surface`,
      });
    }
    if (
      key.startsWith("VITE_") &&
      key.endsWith("RPC_URL") &&
      PROVIDER_SECRET_PATTERNS.some((pattern) => pattern.test(value))
    ) {
      findings.push({
        level: "error",
        message: `${key} contains a provider-keyed public RPC URL`,
      });
    }
  }
}

function auditPages(findings: Finding[]): void {
  requireHttpUrl(findings, "VITE_GAME_API_URL", ["https:"]);
  requireHttpUrl(findings, "VITE_GAME_WS_URL", ["wss:"]);
  const cluster = requireEnv(findings, "VITE_SOLANA_CLUSTER");
  if (cluster && cluster !== "mainnet-beta") {
    findings.push({
      level: "error",
      message: "pages:solana must build with VITE_SOLANA_CLUSTER=mainnet-beta",
    });
  }
  if ((process.env.VITE_USE_GAME_RPC_PROXY ?? "").trim() !== "true") {
    findings.push({
      level: "error",
      message: "pages:solana must enable VITE_USE_GAME_RPC_PROXY=true",
    });
  }
}

function auditKeeper(findings: Finding[]): void {
  requireHttpUrl(findings, "HYPERBET_KEEPER_URL", ["https:"]);
  requireEnv(findings, "RAILWAY_PROJECT_ID");
  requireEnv(findings, "RAILWAY_ENVIRONMENT_ID");
  requireEnv(findings, "RAILWAY_KEEPER_SERVICE_ID");

  if ((process.env.CI_AUDIT_REQUIRE_RUNTIME ?? "").trim() === "true") {
    requireHttpUrl(findings, "SOLANA_RPC_URL", ["https:"]);
  }
}

const { target, deployment, json } = parseArgs();
const findings: Finding[] = [];
auditTrackedEnvFiles(findings);
auditInjectedEnvironment(findings);

if (target === "pages:solana") auditPages(findings);
if (target === "keeper:solana") auditKeeper(findings);

const result = {
  target,
  deployment,
  ok: findings.every((finding) => finding.level !== "error"),
  findings,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`SOL-only v1 env audit: ${target} (${deployment})`);
  if (findings.length === 0) console.log("ok");
  for (const finding of findings) {
    console.log(`${finding.level}: ${finding.message}`);
  }
}

if (!result.ok) process.exit(1);
