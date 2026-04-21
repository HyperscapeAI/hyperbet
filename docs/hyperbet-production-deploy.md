# Hyperbet Deploy Topology

This document defines the intended deploy model after the multicast broadcast
refactor.

## Product Topology

- Frontends: Cloudflare Pages per chain surface
- Keepers: Railway per chain surface
- Duel and broadcast authority: Hyperscapes
- Canonical betting destination: Cloudflare Stream
- Emergency fallback destination: self-hosted HLS from the Hyperscapes GPU host
- Mirror destinations: Twitch, Kick, YouTube, and custom restream outputs

The product operates as one always-on channel. Duel transitions change the
content carried by the channel, not the identity of the channel itself.

## Ownership Model

Hyperscapes is the sole writer of stream truth. It authors:

- `channel`
- `channel.publicReadiness`
- `channel.destinations`
- `canonicalDestination`
- `fallbackDestination`

Keepers and frontends consume that contract unchanged. They do not reconstruct
canonical playback truth from local `STREAM_PLAYBACK_*` env vars, and they do
not promote fallback rails on their own.

Keepers may still poll renderer-health endpoints for additive diagnostics, but
those probes are not authoritative for canonical playback routing.

## Session Contract Hyperbet Consumes

Hyperbet surfaces should read the server-authored v2 session/feed contract:

- `channel.id`
- `channel.mode`
- `channel.presentationDelayMs`
- `channel.canonicalDestinationId`
- `channel.fallbackDestinationId`
- `channel.destinations[]`
- `channel.publicPlaybackUrl`
- `channel.publicReadiness`
- `canonicalDestination`
- `fallbackDestination`

Legacy `delivery` and `deliveryHealth` fields remain compatibility shims during
the migration window only. New work should not depend on them.

## Destination Roles

- `canonical`
  - the only destination that controls betting-page playback readiness
  - currently Cloudflare Stream
- `fallback`
  - emergency recovery rail
  - currently self-hosted HLS on the GPU host
- `mirror`
  - promotional and distribution outputs
  - Twitch, Kick, YouTube, custom

Mirror failures must not change canonical betting readiness. A broken Twitch or
Kick output is an isolated mirror problem, not a betting-page routing event.

## Env Policy

These env families belong to the Hyperscapes source server and bridge runtime:

- `STREAM_DELIVERY_MODE`
- `STREAM_DELIVERY_PROVIDER`
- `STREAM_INGEST_*`
- `STREAM_PLAYBACK_*`

They exist to bootstrap the encoder and destinations. They are not a source of
canonical playback truth for keepers or frontends.

Keepers may use:

- `STREAM_RENDERER_HEALTH_URL`
- `STREAM_RENDERER_HEALTH_BEARER_TOKEN`

Only for renderer diagnostics and stale-source detection.

## Frontend Playback Policy

All betting surfaces must follow the same routing rules:

1. Mount canonical playback only when `channel.publicReadiness.ready === true`.
2. Treat missing canonical readiness as not ready.
3. Do not auto-fail over in the browser from canonical to fallback unless the
   server explicitly permits or promotes fallback.
4. Keep browser/player reconnect state diagnostic-only relative to bet truth.
5. Never let mirror health change the betting page.

Low-latency player tuning can remain consistent across surfaces, but those
player settings do not decide authoritative stream truth.

## Rollout Order

Production and staging rollouts must respect the control-plane ownership model:

1. Deploy Hyperscapes server schema v2 with both new and legacy fields.
2. Deploy keepers so they consume the server-authored `channel` contract and
   stop reconstructing delivery truth from env.
3. Deploy Pages frontends so they prefer `channel.publicReadiness` and
   canonical destination state.
4. Remove remaining legacy `delivery`/`deliveryHealth` consumers only after all
   surfaces are on v2.

Do not roll frontends or keepers onto a mixed contract that assumes v2 fields
before the server emits them.

## Verification Gates

Before promoting a rollout:

1. The Hyperscapes feed emits `channel`, `publicReadiness`,
   `canonicalDestination`, and `fallbackDestination`.
2. The canonical destination is ready only when both transport health and
   public playback readiness are good.
3. A mirror failure leaves canonical betting readiness unchanged.
4. Duel transitions do not restart the channel identity or force player remount
   churn.
5. The betting page never shows browser-local buffering as market truth.
6. Soak tests show no sustained rebuild loop and no canonical/fallback drift.

## Operator Runbooks

### Canonical Destination Down

- Expect `channel.publicReadiness.ready === false`.
- Expect a canonical-destination-specific reason such as `manifest_missing`,
  `manifest_stale`, or `destination_disconnected`.
- Keepers and frontends should surface the unavailable state; they should not
  synthesize readiness from a leftover playback URL.
- Restore the canonical destination at the source server or bridge layer.

### Mirror Destination Down

- Expect only that mirror destination entry to degrade.
- Do not treat this as a betting outage if canonical readiness remains true.
- Restore the affected mirror without touching canonical playback routing.

### Fallback Manifest Stale

- Expect the fallback destination entry to degrade independently.
- This is important operationally, but it does not demote canonical betting
  playback while canonical readiness is still true.
- Repair the fallback rail so emergency recovery remains available.

### Source Healthy But Canonical Public Playback Not Ready

- Expect renderer/capture health to stay green while `publicReadiness` is false.
- Treat this as a distribution-plane problem, not a renderer problem.
- Inspect canonical destination transport health and the public playback probe
  before touching duel or renderer systems.
