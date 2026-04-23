import { URL } from "node:url";

type JsonRecord = Record<string, unknown>;

type EndpointResult = {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};

type StreamSummary = {
  publicReady: boolean | null;
  publicReason: string | null;
  channelReady: boolean | null;
  sourceReady: boolean | null;
  captureMode: string | null;
  sourceStatusSource: string | null;
  canonicalDecision: string | null;
  canonicalLiveInputId: string | null;
  playbackUrl: string | null;
  rendererReady: boolean | null;
};

type AuditConfig = {
  publicOrigin: string;
  keeperUrl: string;
  timeoutMs: number;
  checkPlayback: boolean;
};

function getArg(name: string): string | null {
  const prefix = `${name}=`;
  const direct = process.argv.find((entry) => entry.startsWith(prefix));
  return direct ? direct.slice(prefix.length).trim() : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseConfig(): AuditConfig {
  const publicOrigin =
    getArg("--public-origin") ??
    process.env.ENOOMIAN_PUBLIC_ORIGIN ??
    "https://46.4.80.150.sslip.io";
  const keeperUrl =
    getArg("--keeper-url") ??
    process.env.ENOOMIAN_KEEPER_URL ??
    "https://hyperbet-keeper-staging-production.up.railway.app";
  const timeoutMs = Number.parseInt(
    getArg("--timeout-ms") ?? process.env.ENOOMIAN_AUDIT_TIMEOUT_MS ?? "12000",
    10,
  );

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeout ${timeoutMs}`);
  }

  return {
    publicOrigin: normalizeBaseUrl(publicOrigin),
    keeperUrl: normalizeBaseUrl(keeperUrl),
    timeoutMs,
    checkPlayback: !hasFlag("--skip-playback"),
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getPath(record: JsonRecord | null, ...path: string[]): unknown {
  let cursor: unknown = record;
  for (const key of path) {
    const next = asRecord(cursor);
    if (!next || !(key in next)) return null;
    cursor = next[key];
  }
  return cursor;
}

function pickPlaybackUrl(record: JsonRecord | null): string | null {
  const candidates = [
    getPath(record, "channel", "publicPlaybackUrl"),
    getPath(record, "delivery", "playbackUrl"),
    getPath(record, "delivery", "llhlsUrl"),
    getPath(record, "canonicalAuthority", "playbackUrl"),
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
}

function summarizePayload(payload: unknown): StreamSummary {
  const root = asRecord(payload);
  return {
    publicReady: asBoolean(
      getPath(root, "publicReadiness", "ready") ??
        getPath(root, "channel", "publicReadiness", "ready"),
    ),
    publicReason: asString(
      getPath(root, "publicReadiness", "reason") ??
        getPath(root, "channel", "publicReadiness", "reason"),
    ),
    channelReady: asBoolean(getPath(root, "channel", "ready")),
    sourceReady: asBoolean(getPath(root, "sourceRuntime", "ready")),
    captureMode: asString(getPath(root, "sourceRuntime", "captureMode")),
    sourceStatusSource: asString(getPath(root, "sourceRuntime", "statusSource")),
    canonicalDecision: asString(getPath(root, "canonicalAuthority", "decision")),
    canonicalLiveInputId: asString(getPath(root, "canonicalAuthority", "liveInputId")),
    playbackUrl: pickPlaybackUrl(root),
    rendererReady: asBoolean(getPath(root, "rendererHealth", "ready")),
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<EndpointResult> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw body for diagnosis
  }
  const headers = Object.fromEntries(response.headers.entries());
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers,
    body,
  };
}

async function probePlayback(url: string, timeoutMs: number): Promise<EndpointResult> {
  const response = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body: null,
  };
}

function formatSummary(label: string, summary: StreamSummary): string[] {
  return [
    `${label}:`,
    `  publicReady=${summary.publicReady ?? "null"} reason=${summary.publicReason ?? "null"}`,
    `  channelReady=${summary.channelReady ?? "null"} rendererReady=${summary.rendererReady ?? "null"}`,
    `  sourceReady=${summary.sourceReady ?? "null"} captureMode=${summary.captureMode ?? "null"} statusSource=${summary.sourceStatusSource ?? "null"}`,
    `  canonicalDecision=${summary.canonicalDecision ?? "null"} liveInputId=${summary.canonicalLiveInputId ?? "null"}`,
    `  playbackUrl=${summary.playbackUrl ?? "null"}`,
  ];
}

function compareTruths(
  betSyncResult: EndpointResult,
  captureResult: EndpointResult,
  keeperResult: EndpointResult,
  capture: StreamSummary,
  betSync: StreamSummary,
  keeper: StreamSummary,
): string[] {
  const issues: string[] = [];

  if (!captureResult.ok) {
    issues.push(`capture/status returned HTTP ${captureResult.status}`);
  }

  if (!keeperResult.ok) {
    issues.push(`keeper/state returned HTTP ${keeperResult.status}`);
  }

  if (!betSyncResult.ok && betSyncResult.status !== 401 && betSyncResult.status !== 403) {
    issues.push(`bet-sync/state returned HTTP ${betSyncResult.status}`);
  }

  if (capture.sourceReady !== null && betSync.sourceReady !== null && capture.sourceReady !== betSync.sourceReady) {
    issues.push(
      `bet-sync sourceReady ${betSync.sourceReady} disagrees with capture/status ${capture.sourceReady}`,
    );
  }

  if (
    capture.captureMode &&
    betSync.captureMode &&
    capture.captureMode !== betSync.captureMode
  ) {
    issues.push(
      `bet-sync captureMode ${betSync.captureMode} disagrees with capture/status ${capture.captureMode}`,
    );
  }

  if (
    capture.sourceReady === true &&
    betSync.publicReady === false
  ) {
    issues.push(
      `bet-sync blocks public readiness while capture/status reports sourceReady=true`,
    );
  }

  if (
    capture.sourceReady === true &&
    keeper.publicReady === false
  ) {
    issues.push(
      `keeper blocks public readiness while capture/status reports sourceReady=true`,
    );
  }

  if (
    betSync.playbackUrl &&
    keeper.playbackUrl &&
    betSync.playbackUrl !== keeper.playbackUrl
  ) {
    issues.push(
      `keeper playbackUrl disagrees with bet-sync playbackUrl`,
    );
  }

  if (
    capture.playbackUrl &&
    keeper.playbackUrl &&
    capture.playbackUrl !== keeper.playbackUrl
  ) {
    issues.push(`keeper playbackUrl disagrees with capture/status playbackUrl`);
  }

  if (
    betSync.publicReady !== null &&
    keeper.publicReady !== null &&
    betSync.publicReady !== keeper.publicReady
  ) {
    issues.push(
      `keeper publicReadiness ${keeper.publicReady} disagrees with bet-sync ${betSync.publicReady}`,
    );
  }

  if (
    betSync.canonicalDecision &&
    keeper.canonicalDecision &&
    betSync.canonicalDecision !== keeper.canonicalDecision
  ) {
    issues.push(
      `keeper canonicalAuthority.decision ${keeper.canonicalDecision} disagrees with bet-sync ${betSync.canonicalDecision}`,
    );
  }

  if (betSync.publicReady === true && !betSync.playbackUrl) {
    issues.push(`bet-sync reports publicReady=true without a playback URL`);
  }

  if (keeper.publicReady === true && !keeper.playbackUrl) {
    issues.push(`keeper reports publicReady=true without a playback URL`);
  }

  return issues;
}

function printEndpoint(label: string, result: EndpointResult): void {
  console.log(`${label} endpoint: ${result.url}`);
  console.log(`  http=${result.status} ok=${result.ok}`);
  const server = result.headers.server ?? "null";
  const via = result.headers.via ?? "null";
  console.log(`  server=${server} via=${via}`);
}

async function main(): Promise<void> {
  const config = parseConfig();

  const betSyncUrl = new URL("/api/internal/bet-sync/state", config.publicOrigin).toString();
  const captureUrl = new URL("/api/streaming/capture/status", config.publicOrigin).toString();
  const keeperStateUrl = new URL("/api/streaming/state", config.keeperUrl).toString();

  const [betSync, capture, keeper] = await Promise.all([
    fetchJson(betSyncUrl, config.timeoutMs),
    fetchJson(captureUrl, config.timeoutMs),
    fetchJson(keeperStateUrl, config.timeoutMs),
  ]);

  const betSyncSummary = summarizePayload(betSync.body);
  const captureSummary = summarizePayload(capture.body);
  const keeperSummary = summarizePayload(keeper.body);

  printEndpoint("bet-sync", betSync);
  printEndpoint("capture/status", capture);
  printEndpoint("keeper/state", keeper);
  console.log("");
  for (const line of formatSummary("bet-sync", betSyncSummary)) console.log(line);
  for (const line of formatSummary("capture/status", captureSummary)) console.log(line);
  for (const line of formatSummary("keeper/state", keeperSummary)) console.log(line);

  const issues = compareTruths(
    betSync,
    capture,
    keeper,
    captureSummary,
    betSyncSummary,
    keeperSummary,
  );

  if (!betSync.ok && (betSync.status === 401 || betSync.status === 403)) {
    console.log("");
    console.log(
      `note: direct bet-sync access returned HTTP ${betSync.status}; using keeper/state as the public authority proxy`,
    );
  }

  if (config.checkPlayback) {
    const playbackUrl =
      keeperSummary.playbackUrl ?? betSyncSummary.playbackUrl ?? captureSummary.playbackUrl;
    if (!playbackUrl) {
      issues.push("no playback URL available to probe");
    } else {
      const playback = await probePlayback(playbackUrl, config.timeoutMs);
      console.log("");
      console.log(`playback probe: ${playback.url}`);
      console.log(`  http=${playback.status} ok=${playback.ok}`);
      console.log(`  server=${playback.headers.server ?? "null"} via=${playback.headers.via ?? "null"}`);
      if (!playback.ok) {
        issues.push(`playback manifest probe returned HTTP ${playback.status}`);
      }
    }
  }

  console.log("");
  if (issues.length === 0) {
    console.log("authority audit: PASS");
    return;
  }

  console.log("authority audit: FAIL");
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    `authority audit failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
