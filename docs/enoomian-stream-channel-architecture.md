# Enoomian Stream Channel Architecture

Date: April 8, 2026
Status: Proposed target-state architecture and rollout plan
Scope: Hyperscapes source and delivery plane, Hyperbet keeper authority plane, Hyperbet player and betting consumers

## Executive Summary

Enoomian staging should operate as one stable broadcast channel per environment, not as one live stream resource per duel.

The current staging recovery proved the right shape:

- source capture and render truth can remain healthy even when a delivery provider fails
- the authority layer can expose stable `sourceRuntime`, `deliveryHealth`, `publicReadiness`, and `canonicalDestination` independently
- bet pages do not need to care whether canonical playback is currently served by Cloudflare or self-hosted HLS

The long-term design should therefore be:

- one stable canonical channel per environment
- one provider adapter layer beneath that channel
- duel boundaries represented as application metadata, not transport resets
- per-duel archives or clips derived from the stable channel after the fact
- automatic provider failover, with the client contract remaining unchanged

For staging today, self-hosted HLS on the GPU host is the working canonical rail. Cloudflare ingest remains a provider-specific investigation track and should not block the broader architecture.

## Current Findings

### What is healthy

- The GPU host source worker can render and encode continuously.
- The local HLS output on the GPU host is healthy.
- Betting bootstrap and keeper state can now reflect canonical playback truth correctly.
- The player stack can handle canonical playback from either Cloudflare or self-hosted HLS.

### What is not resolved

- Cloudflare ingest from the GPU host remains unreliable or rejected.
- We do not yet have a proven Cloudflare-side reason code for the failure.
- Staging recovered only after promoting self-hosted HLS as the canonical rail.

### Architectural implication

This is now clearly a delivery-provider problem, not a product-state problem. The system should be designed so provider failure degrades canonical delivery provider selection, not duel/session authority.

## Decision

### Adopt this model

Use one stable canonical channel per environment and reuse it across many duels and many broadcasts.

### Do not adopt this model

Do not create and rotate a new Cloudflare live input for every duel.

### Why

- Stable playback URLs are better for betting clients, embeds, player caches, and authority state.
- Reusing a stable channel reduces secret churn, resource churn, cleanup churn, and race conditions.
- Duel transitions should not require transport teardown and re-bootstrap.
- Recording and replay concerns are downstream media concerns, not reasons to recreate the live transport resource.

## Target-State System Model

### 1. Channel Layer

Each environment owns one canonical broadcast channel:

- `enoomian-staging`
- `enoomian-production`

The channel is the public contract consumed by:

- keeper bootstrap
- keeper event feeds
- bet pages
- spectator players

The channel contract exposes:

- `channel.id`
- `channel.mode`
- `channel.activeDuelId`
- `channel.activeDuelKey`
- `channel.publicPlaybackUrl`
- `channel.publicReadiness`
- `channel.canonicalDestinationId`
- `channel.fallbackDestinationId`
- `channel.destinations`

### 2. Source Plane

The source plane is responsible only for producing video reliably.

Responsibilities:

- launch Chromium against the stream page
- capture compositor frames
- encode video and audio
- emit source diagnostics
- maintain local HLS output when configured

Source-plane truth is represented by:

- `sourceRuntime`
- `rendererHealth`
- frame metrics
- capture diagnostics

Source truth must remain separate from provider truth.

### 3. Delivery Adapter Plane

The delivery adapter plane converts source output into one or more destinations.

Providers:

- `cloudflare_stream`
- `self_hls`

Transport examples:

- `srt`
- `rtmps`
- `hls`
- `llhls`

The adapter plane owns:

- provider-specific config
- ingest URL construction
- playback probe logic
- provider-specific lifecycle checks
- failover decisions

Clients must not derive behavior from ingest transport. Clients care only about canonical playback.

### 4. Authority Plane

The authority plane merges source truth and delivery truth into stable client-facing truth.

It must expose, at minimum:

- `rendererHealth`
- `sourceRuntime`
- `deliveryHealth`
- `publicReadiness`
- `canonicalDestination`
- `fallbackDestination`

Rules:

- `sourceRuntime` answers "is the source worker alive and producing frames?"
- `deliveryHealth` answers "is the selected canonical provider producing playable output?"
- `publicReadiness` answers "should betting clients treat the stream as live and usable?"
- `canonicalDestination` answers "what playback rail is authoritative right now?"

### 5. Consumer Plane

Consumers include:

- Solana keeper
- BSC keeper
- Hyperbet UI
- HLS embed/player

Consumers must:

- trust `canonicalDestination` and `publicReadiness`
- avoid reverse-engineering transport state
- avoid inventing parallel authority logic

## Duel Lifecycle Model

Duels are logical segments inside one stable channel, not separate transport instances.

Each duel should create:

- a duel metadata record
- a duel timing window
- a duel replay index entry
- optional duel clip jobs

Each duel should not create:

- a new live input resource
- a new public playback URL
- a new player bootstrap shape

### Archive model

Recommended archive approach:

- live channel remains continuous
- duel boundaries are marked by metadata
- per-duel clips or recordings are cut downstream
- retention applies to clips and archives, not to the channel identity

This allows:

- stable betting playback
- replay extraction by duel
- simpler operations

## Failover Model

### Canonical provider policy

For each environment there is one canonical provider at a time.

Candidate providers:

- primary: Cloudflare Stream
- fallback: self-hosted HLS

For staging, until Cloudflare is proven reliable, reverse that order:

- primary: self-hosted HLS
- secondary research provider: Cloudflare Stream

### Failover trigger

Fail over when the canonical provider is not producing fresh playable output within threshold.

Signals:

- playback manifest probe failure
- provider lifecycle disconnected state
- repeated ingest write failures
- stale media sequence

### Failover guarantee

When provider failover occurs:

- `publicReadiness` should remain true if fallback is healthy
- `canonicalDestination` should change provider and playback URL
- duel/session state must not reset
- keepers must continue emitting one stable authority contract

### Failback policy

Do not immediately fail back on one successful probe.

Require:

- provider healthy for soak window
- consecutive successful probes
- no fresh fatal sender errors

## Cloudflare Position In The Architecture

Cloudflare should be treated as a delivery provider, not as the architecture itself.

It remains valuable for:

- managed public delivery
- LL-HLS playback
- clip and recording workflows
- CDN edge distribution

It should not be allowed to control:

- duel truth
- source truth
- keeper authority shape
- betting session continuity

## Provider Contract Requirements

Every provider implementation must satisfy the same normalized destination contract:

- `id`
- `name`
- `role`
- `provider`
- `transport`
- `playbackUrl`
- `ingestUrl`
- `connected`
- `transportHealthy`
- `playbackReady`
- `manifestStatus`
- `lastError`
- `updatedAt`

Normalization requirements:

- provider-specific states must be mapped into this contract
- public routes must expose normalized truth, not raw provider internals
- raw provider telemetry may remain available for diagnostics only

## Configuration Model

### Desired env shape

Provider config should be typed and separated:

- channel-level settings
- provider-level settings
- source-level settings

Examples:

- `STREAM_DELIVERY_MODE`
- `STREAM_DELIVERY_PROVIDER`
- `STREAM_PLAYBACK_URL`
- `STREAM_PLAYBACK_HLS_URL`
- `STREAM_PLAYBACK_LLHLS_URL`
- `STREAM_INGEST_TRANSPORT`
- `STREAM_INGEST_SRT_URL`
- `STREAM_INGEST_SRT_STREAM_ID`
- `STREAM_INGEST_SRT_PASSPHRASE`
- `STREAM_INGEST_RTMPS_URL`
- `STREAM_INGEST_STREAM_KEY`

### Configuration rules

- Keep input identifiers separate from shared secrets.
- Do not build provider secrets by concatenating values inside env files.
- Keep one personal-staging env source of truth for enoomian staging.
- Do not let official GitHub staging envs leak into the enoomian personal-staging workflow.

## Observability Requirements

### Minimum required metrics

- source frame cadence
- encode cadence
- dropped frames
- worker heartbeat age
- render tick freshness
- visual change age
- HLS manifest updated-at
- media sequence advancement
- provider playback probe status
- first and last fatal write error

### Minimum required state probes

- source runtime route
- capture status route
- canonical playback probe
- keeper `/api/streaming/state`
- betting bootstrap `/api/internal/bet-sync/state`

### Required dashboards later

- canonical provider health
- source runtime health
- failover events
- duel-to-archive clip completion

## Rollout Plan

### Phase 0: Lock in current staging recovery

- Keep enoomian staging on personal self-hosted HLS.
- Treat self-HLS as canonical for staging until Cloudflare is proven reliable.
- Do not revert staging back to Cloudflare just because the code path exists.

### Phase 1: Normalize canonical truth everywhere

- Remove remaining route assumptions that canonical means external Cloudflare.
- Make `streaming.ts` fully self-HLS aware in canonical status derivation.
- Ensure all public and internal routes agree when self-HLS is canonical.

### Phase 2: Formalize provider failover

- Add a provider selector state machine.
- Support explicit primary and fallback ordering by environment.
- Add failover and failback soak thresholds.

### Phase 3: Archive and clip architecture

- Define duel-boundary metadata emission
- create per-duel archive jobs
- create replay lookup by duel ID and duel key

### Phase 4: Cloudflare provider investigation

- restore working personal-account Cloudflare API auth
- inspect live input lifecycle and failure telemetry
- create a fresh test live input
- rerun control publishes from:
  - GPU host
  - second machine
  - OBS
- upgrade host FFmpeg and rerun controls

### Phase 5: Production readiness

- keep Cloudflare only if it passes soak and failover tests
- otherwise ship production with self-HLS fallback mandatory

## Acceptance Criteria

The architecture is complete when all of the following are true:

- betting clients remain live through provider swaps
- duel transitions do not recreate the public playback contract
- one canonical channel supports many duels
- per-duel replay artifacts exist without per-duel live input churn
- `sourceRuntime`, `deliveryHealth`, and `publicReadiness` remain distinct
- staging and production envs can choose different provider priority safely

## Non-Goals

This plan does not require:

- per-duel live input creation
- deleting old live inputs after two newer duels
- client awareness of provider-specific transport
- perfect Cloudflare diagnosis before finishing the architecture

## Immediate Next Actions

1. Keep enoomian staging on self-HLS until Cloudflare is debugged.
2. Patch any remaining route-level canonical status that still assumes Cloudflare.
3. Add a formal provider-priority config and failover state machine.
4. Open a focused Cloudflare reliability investigation using the personal account only.
5. Design duel archive and clip outputs as downstream media products, not live transport resources.
