# Hyperbet Deploy Topology

This document defines the intended deploy model after the streaming overhaul.

## Product Topology

- Frontends: Cloudflare Pages per chain surface
- Keepers: Railway per chain surface
- Duel and stream truth: Hyperscapes
- Viewer delivery target: Cloudflare Stream LL-HLS
- Fallback delivery: self-hosted HLS from the Hyperscapes GPU host

Hyperbet frontends and keepers should not point directly at an arbitrary local
HLS path unless they are in fallback or diagnostics mode.

## Delivery Inputs Hyperbet Consumes

Keepers and frontends should rely on:

- canonical session playback URL
- canonical `delivery.mode`
- canonical `delivery.provider`
- canonical renderer metrics

Expected envs on the keeper side:

- `STREAM_DELIVERY_MODE=self_hls|external_hls`
- `STREAM_DELIVERY_PROVIDER`
- `STREAM_PLAYBACK_HLS_URL`
- `STREAM_PLAYBACK_LLHLS_URL`
- `STREAM_RENDERER_HEALTH_URL`
- `STREAM_RENDERER_HEALTH_BEARER_TOKEN`

## Frontend Playback Policy

All player surfaces should use the same low-latency HLS tuning:

- `lowLatencyMode: true`
- `liveSyncDurationCount: 2`
- `liveMaxLatencyDurationCount: 4`
- `maxBufferLength: 6`
- `maxMaxBufferLength: 12`
- `liveBackBufferLength: 10`
- `maxLiveSyncPlaybackRate: 1.5`

## Staging And Production Rule

- test new stream behavior on integration branches first
- push real runtime fixes back to the owning scoped branches after proof
- keep staging-only glue and personal-staging overrides out of canonical PRs

## Verification Gates

Before promoting a rollout:

1. keepers expose `rendererHealth`, `rendererMetrics`, and `delivery`
2. Solana and EVM surfaces render the same active duel
3. live-edge latency stays within target bounds
4. no sustained `Playback stalled -> Rebuilding stream` loop occurs during soak
5. stale-stream recovery can identify whether the issue was source, delivery, or
   player drift
