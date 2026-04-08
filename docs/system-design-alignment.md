# Hyperbet System Design Alignment

This is the current authoritative alignment between Hyperbet and Hyperscapes
for the streaming and betting stack.

## Canonical Ownership

Hyperscapes owns:

- duel lifecycle truth
- renderer truth
- delivery truth
- the canonical stream session consumed by downstream products

Hyperbet owns:

- betting UX
- chain-specific keepers
- wallet interaction
- market-facing product surfaces

Hyperbet must consume Hyperscapes stream truth additively. It must not invent a
parallel renderer-health model.

## Streaming Contract

The canonical stream session now includes:

- `rendererHealth`
- `rendererMetrics`
  - `captureFps`
  - `encodeFps`
  - `droppedFrames`
  - `latestFrameAt`
  - `latestRenderTickAt`
  - `latestDuelStateTickAt`
  - `latestVisualChangeAt`
  - `visualChangeAgeMs`
  - `hlsManifest.updatedAt`
  - `hlsManifest.mediaSequence`
- `delivery`
  - `mode`
  - `provider`
  - `playbackUrl`
  - `hlsUrl`
  - `llhlsUrl`

Hyperbet should use:

1. explicit Hyperscapes renderer truth first
2. HLS freshness as fallback only
3. local player telemetry to detect live-edge drift separately

## Delivery Topology

- Pages hosts the public Hyperscapes stream page
- Hyperscapes `/stream` is a dedicated low-overhead capture preset
- the GPU host renders and encodes
- Railway serves the keeper-facing and UI-facing stream session
- Cloudflare Stream LL-HLS is the target viewer-delivery path once enabled
- self-hosted HLS remains reachable for smoke and emergency fallback

## UI Rule

Every player surface should present the same operator-relevant dimensions:

- current live-edge latency
- stall count
- rebuild count
- last buffered fragment freshness
- current delivery mode

Degraded UI should distinguish:

- source stale
- delivery stale
- player drifted
- player buffering

It should not collapse those conditions into generic stream failure.
