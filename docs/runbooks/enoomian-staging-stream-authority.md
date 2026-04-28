# Enoomian Staging Stream Authority

## Goal

Protect the enoomian staging product lane from one specific class of outage:

- Cloudflare playback is healthy
- the GPU source worker is healthy
- but Hyperbet blocks before mounting the player because keeper authority is reading the wrong upstream truth

This runbook exists to catch and fix that class of failure before it becomes another long investigation.

## Core Invariant

On enoomian staging, the public authority path for:

- `/api/streaming/*`
- `/api/internal/bet-sync/*`

must resolve to the same upstream truth for the active stream lane.

If those two surfaces disagree, Hyperbet can block playback even when the live stream itself is healthy.

## Known Failure Signature

The specific incident on 2026-04-22 presented as:

- Cloudflare LL-HLS manifest returned `200`
- GPU-host source worker was healthy
- `capture/status` reported `sourceRuntime.ready = true`
- Hyperbet showed stream-authority blocking copy or stayed stuck before useful playback
- the player either never mounted or stayed stuck in bootstrap/catch-up behavior driven by false upstream authority

Root cause:

- `46.4.80.150.sslip.io` was split at the proxy layer
- `/api/streaming/*` resolved to the healthy GPU-host service
- `/api/internal/bet-sync/*` resolved elsewhere
- keeper trusted the false-negative bet-sync authority and blocked playback

## What Matters

Do not treat these as interchangeable:

1. source runtime truth
2. public betting authority truth
3. keeper canonical state
4. Cloudflare media transport

The product lane is healthy only when all four align enough for Hyperbet to mount and play the canonical Cloudflare stream.

## Fast Audit

Run:

```bash
bun run enoomian:authority:audit
```

Optional overrides:

```bash
bun run enoomian:authority:audit -- \
  --public-origin=https://46.4.80.150.sslip.io \
  --keeper-url=https://hyperbet-keeper-staging-production.up.railway.app \
  --timeout-ms=12000
```

The audit checks:

- public bet-sync state
- public capture/status
- keeper canonical state
- playback manifest reachability

If direct `bet-sync/state` is not readable from the current environment and returns
`401` or `403`, the audit falls back to:

- `capture/status`
- `keeper/state`

That fallback is still useful because keeper is the surface that blocks or allows
Hyperbet playback.

It fails if:

- bet-sync `sourceRuntime` disagrees with `capture/status`
- bet-sync blocks `publicReadiness` while capture reports a healthy source
- keeper disagrees with bet-sync on readiness or playback URL
- playback URL is missing or dead while authority says ready

## Manual Spot Check

If the audit reports failure, inspect all of these explicitly:

```bash
curl -fsSL https://46.4.80.150.sslip.io/api/internal/bet-sync/state | jq
curl -fsSL https://46.4.80.150.sslip.io/api/streaming/capture/status | jq
curl -fsSL https://hyperbet-keeper-staging-production.up.railway.app/api/streaming/state | jq
curl -fsSI 'https://customer-mmgn3z7blyfeyxx5.cloudflarestream.com/<live-input>/manifest/video.m3u8?protocol=llhls'
```

If direct bet-sync returns `401` or `403`, continue with:

- `capture/status`
- `keeper/state`

and treat the keeper response as the public bettor-authority proxy.

Expected healthy pattern:

- bet-sync `publicReadiness.ready = true`
- bet-sync `sourceRuntime.ready = true`
- capture/status `sourceRuntime.ready = true`
- keeper `canonicalAuthority.decision = ready`
- keeper `channel.publicPlaybackUrl` present
- Cloudflare manifest returns `200`

## Recovery Order

1. Confirm Cloudflare playback is actually healthy.
2. Confirm source worker truth on the GPU host.
3. Compare public bet-sync state against public capture/status.
4. Fix public authority routing before touching player code.
5. Restart the keeper only after the public authority path is corrected.

Do not start by changing Hyperbet UI code if:

- Cloudflare is healthy
- capture/status is healthy
- keeper is blocked by false upstream readiness

That is an authority topology problem, not a player problem.

## Promotion Rule

If this runbook ever changes because of a new incident, update it together with:

- the authority audit script
- the local enoomian incident record
- any proxy/deploy topology documentation that explains the change
