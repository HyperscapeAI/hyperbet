import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appCwd = process.env.PLAYWRIGHT_APP_CWD || path.join(root, "packages", "hyperbet-evm", "app");
const outputRoot =
  process.env.CAPTURE_OUTPUT_DIR ||
  path.join(
    root,
    "output",
    "playwright",
    "hyperscapes-pm-local",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );

const hyperscapesUiUrl = requiredEnv("HYPERSCAPES_UI_URL");
const hyperbetUiUrl = requiredEnv("HYPERBET_UI_URL");
const streamStateUrl = requiredEnv("STREAM_STATE_URL");
const activeMarketsUrl = requiredEnv("ACTIVE_MARKETS_URL");

const pollMs = Number.parseInt(process.env.CAPTURE_POLL_MS || "5000", 10);
const maxRuntimeMs = Number.parseInt(process.env.CAPTURE_MAX_RUNTIME_MS || "900000", 10);
const screenshotWaitMs = Number.parseInt(process.env.CAPTURE_SCREENSHOT_WAIT_MS || "1500", 10);
const screenshotTimeoutMs = Number.parseInt(process.env.CAPTURE_SCREENSHOT_TIMEOUT_MS || "30000", 10);

let stopping = false;
let captureIndex = 0;
let previousPhase = "";
let previousDuelKey = "";
let previousMarketSignature = "";
let previousMarketCount = -1;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type StreamState = {
  cycle?: {
    cycleId?: string;
    phase?: string;
    duelId?: string;
    duelKey?: string;
  };
  duel?: {
    duelId?: string;
    duelKey?: string;
    phase?: string;
  };
};

type ActiveMarketsResponse = {
  duel?: {
    duelId?: string;
    duelKey?: string;
    phase?: string;
  };
  markets?: Array<{
    marketRef?: string;
    chain?: string;
    lifecycle?: {
      status?: string;
      metadata?: JsonValue;
    };
  }>;
  updatedAt?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env ${name}`);
  }
  return value;
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function shortId(value: string | undefined): string {
  return value ? value.slice(0, 12) : "unknown";
}

function currentPhase(streamState: StreamState, activeMarkets: ActiveMarketsResponse): string {
  return (
    streamState.cycle?.phase ||
    streamState.duel?.phase ||
    activeMarkets.duel?.phase ||
    "UNKNOWN"
  );
}

function currentDuelKey(streamState: StreamState, activeMarkets: ActiveMarketsResponse): string {
  return (
    streamState.cycle?.duelKey ||
    streamState.duel?.duelKey ||
    activeMarkets.duel?.duelKey ||
    streamState.cycle?.duelId ||
    streamState.duel?.duelId ||
    activeMarkets.duel?.duelId ||
    "unknown"
  );
}

function buildMarketSignature(activeMarkets: ActiveMarketsResponse): string {
  const entries = (activeMarkets.markets || []).map((market) => ({
    marketRef: market.marketRef || "unknown",
    chain: market.chain || "unknown",
    status: market.lifecycle?.status || "unknown",
  }));

  return JSON.stringify(entries.sort((a, b) => a.marketRef.localeCompare(b.marketRef)));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`request failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function takeScreenshot(url: string, filePath: string): Promise<void> {
  const args = [
    "playwright",
    "screenshot",
    "--browser",
    "chromium",
    "--device",
    "Desktop Chrome",
    "--full-page",
    "--timeout",
    String(screenshotTimeoutMs),
    "--wait-for-timeout",
    String(screenshotWaitMs),
    url,
    filePath,
  ];

  await execFileAsync("bunx", args, {
    cwd: appCwd,
    env: process.env,
  });
}

async function recordEvent(
  rawLabel: string,
  streamState: StreamState,
  activeMarkets: ActiveMarketsResponse,
): Promise<void> {
  captureIndex += 1;
  const label = `${String(captureIndex).padStart(2, "0")}-${safeSlug(rawLabel)}`;
  const prefix = path.join(outputRoot, label);
  const eventState = {
    capturedAt: new Date().toISOString(),
    label: rawLabel,
    hyperscapesUiUrl,
    hyperbetUiUrl,
    streamStateUrl,
    activeMarketsUrl,
    summary: {
      phase: currentPhase(streamState, activeMarkets),
      duelKey: currentDuelKey(streamState, activeMarkets),
      marketCount: (activeMarkets.markets || []).length,
      marketStatuses: (activeMarkets.markets || []).map((market) => ({
        marketRef: market.marketRef || "unknown",
        chain: market.chain || "unknown",
        status: market.lifecycle?.status || "unknown",
      })),
    },
    streamState,
    activeMarkets,
  };

  await writeFile(`${prefix}.json`, JSON.stringify(eventState, null, 2));
  await takeScreenshot(hyperscapesUiUrl, `${prefix}.hyperscapes.png`).catch((error) => {
    console.error(`[pm-local:capture] hyperscapes screenshot failed for ${rawLabel}: ${String(error)}`);
  });
  await takeScreenshot(hyperbetUiUrl, `${prefix}.hyperbet.png`).catch((error) => {
    console.error(`[pm-local:capture] hyperbet screenshot failed for ${rawLabel}: ${String(error)}`);
  });

  console.log(`[pm-local:capture] captured ${rawLabel}`);
}

async function captureFinal(reason: string): Promise<void> {
  try {
    const [streamState, activeMarkets] = await Promise.all([
      fetchJson<StreamState>(streamStateUrl),
      fetchJson<ActiveMarketsResponse>(activeMarketsUrl),
    ]);
    await recordEvent(`final-${reason}`, streamState, activeMarkets);
  } catch (error) {
    console.error(`[pm-local:capture] final capture failed: ${String(error)}`);
  }
}

async function main(): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    path.join(outputRoot, "metadata.json"),
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        hyperscapesUiUrl,
        hyperbetUiUrl,
        streamStateUrl,
        activeMarketsUrl,
        pollMs,
        maxRuntimeMs,
      },
      null,
      2,
    ),
  );

  const startedAt = Date.now();
  while (!stopping) {
    try {
      const [streamState, activeMarkets] = await Promise.all([
        fetchJson<StreamState>(streamStateUrl),
        fetchJson<ActiveMarketsResponse>(activeMarketsUrl),
      ]);

      const phase = currentPhase(streamState, activeMarkets);
      const duelKey = currentDuelKey(streamState, activeMarkets);
      const marketSignature = buildMarketSignature(activeMarkets);
      const marketCount = (activeMarkets.markets || []).length;

      const eventLabels: string[] = [];
      if (captureIndex === 0) {
        eventLabels.push("initial");
      }
      if (duelKey !== previousDuelKey) {
        eventLabels.push(`duel-${shortId(duelKey)}`);
      }
      if (phase !== previousPhase) {
        eventLabels.push(`phase-${phase}`);
      }
      if (marketCount > 0 && previousMarketCount <= 0) {
        eventLabels.push("markets-populated");
      }
      if (marketSignature !== previousMarketSignature && previousMarketSignature) {
        eventLabels.push(`markets-${marketCount}`);
      }

      for (const label of eventLabels) {
        await recordEvent(label, streamState, activeMarkets);
      }

      previousPhase = phase;
      previousDuelKey = duelKey;
      previousMarketSignature = marketSignature;
      previousMarketCount = marketCount;
    } catch (error) {
      console.error(`[pm-local:capture] poll failed: ${String(error)}`);
    }

    if (Date.now() - startedAt >= maxRuntimeMs) {
      await captureFinal("timeout");
      return;
    }

    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`[pm-local:capture] received ${signal}, taking final snapshot`);
  await captureFinal(signal.toLowerCase());
}

process.on("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

main().catch((error) => {
  console.error(`[pm-local:capture] failed: ${String(error)}`);
  process.exit(1);
});
