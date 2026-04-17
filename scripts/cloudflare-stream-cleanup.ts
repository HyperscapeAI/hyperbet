#!/usr/bin/env bun
/**
 * Cloudflare Stream storage cleanup.
 *
 * Deletes videos on the configured Cloudflare Stream account when they match:
 *   age < CLEANUP_MAX_AGE_DAYS AND duration > CLEANUP_MIN_DURATION_SECONDS
 *
 * Default thresholds target live-capture recordings (accumulating hourly,
 * each 30s–5min long) while preserving:
 *   - Videos older than 2 weeks (presumed intentional archive)
 *   - Videos <= 10 seconds (trivial fragments, not meaningful storage)
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     bun run scripts/cloudflare-stream-cleanup.ts [--dry-run]
 *
 * Environment overrides (optional):
 *   CLEANUP_MAX_AGE_DAYS         (default: 14)
 *   CLEANUP_MIN_DURATION_SECONDS (default: 10)
 *   CLEANUP_DELETE_RATE_MS       (default: 200, per-delete delay)
 */

type StreamVideo = {
  uid: string;
  created: string;
  duration: number | null;
  size: number | null;
  liveInput?: string | null;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env: ${name}`);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function listAllVideos(
  accountId: string,
  token: string,
): Promise<StreamVideo[]> {
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
  );
  url.searchParams.set("per_page", "1000");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `Cloudflare list failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    success: boolean;
    result: StreamVideo[] | null;
    errors?: { message: string }[];
  };
  if (!body.success) {
    const msg = body.errors?.map((e) => e.message).join("; ") ?? "unknown";
    throw new Error(`Cloudflare list error: ${msg}`);
  }
  return body.result ?? [];
}

async function deleteVideo(
  accountId: string,
  token: string,
  uid: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Delete ${uid} failed: ${res.status} ${res.statusText}`,
    );
  }
}

async function main() {
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_API_TOKEN");
  const maxAgeDays = envInt("CLEANUP_MAX_AGE_DAYS", 14);
  const minDurationSec = envInt("CLEANUP_MIN_DURATION_SECONDS", 10);
  const rateMs = envInt("CLEANUP_DELETE_RATE_MS", 200);
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    `[cleanup] account=${accountId.slice(0, 8)}... maxAge=${maxAgeDays}d minDuration=${minDurationSec}s dryRun=${dryRun}`,
  );

  const videos = await listAllVideos(accountId, token);
  console.log(`[cleanup] listed ${videos.length} videos`);

  const nowMs = Date.now();
  const maxAgeMs = maxAgeDays * 86_400_000;
  const candidates: StreamVideo[] = [];
  let keptByAge = 0;
  let keptByDuration = 0;
  let totalDurSec = 0;

  for (const v of videos) {
    const durationSec = Number(v.duration ?? 0);
    totalDurSec += durationSec;
    const createdMs = Date.parse(v.created);
    const ageMs = Number.isFinite(createdMs)
      ? nowMs - createdMs
      : Number.POSITIVE_INFINITY;
    if (ageMs >= maxAgeMs) {
      keptByAge += 1;
      continue;
    }
    if (durationSec <= minDurationSec) {
      keptByDuration += 1;
      continue;
    }
    candidates.push(v);
  }

  console.log(
    `[cleanup] keep=${keptByAge} (age>=${maxAgeDays}d) keep=${keptByDuration} (dur<=${minDurationSec}s) candidates=${candidates.length} stored=${(totalDurSec / 60).toFixed(1)}min`,
  );

  if (candidates.length === 0) {
    console.log("[cleanup] nothing to delete");
    return;
  }

  let candidateDur = 0;
  for (const v of candidates) candidateDur += Number(v.duration ?? 0);
  console.log(
    `[cleanup] candidate total duration ${(candidateDur / 60).toFixed(1)}min`,
  );

  if (dryRun) {
    for (const v of candidates.slice(0, 10)) {
      const age = (nowMs - Date.parse(v.created)) / 86_400_000;
      console.log(
        `[dry-run] would delete ${v.uid} dur=${v.duration}s age=${age.toFixed(2)}d`,
      );
    }
    if (candidates.length > 10) {
      console.log(`[dry-run] ... and ${candidates.length - 10} more`);
    }
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const v of candidates) {
    try {
      await deleteVideo(accountId, token, v.uid);
      deleted += 1;
      if (deleted % 10 === 0 || deleted === candidates.length) {
        console.log(`[cleanup] deleted ${deleted}/${candidates.length}`);
      }
    } catch (err) {
      failed += 1;
      console.warn(
        `[cleanup] delete ${v.uid} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (rateMs > 0) {
      await new Promise((r) => setTimeout(r, rateMs));
    }
  }

  console.log(
    `[cleanup] done deleted=${deleted} failed=${failed} freedMin=${(candidateDur / 60).toFixed(1)}`,
  );
}

main().catch((err) => {
  console.error("[cleanup] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
