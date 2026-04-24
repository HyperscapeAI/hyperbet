# Stale Oracle Or Stale Stream

## Goal

Separate four failure planes before taking action:

1. source render
2. capture and encode
3. manifest and delivery freshness
4. player live-edge drift

Do not treat all stale-stream incidents as one class of outage.

## Detection

Check Hyperscapes first:

```bash
curl -fsSL "$HYPERSCAPES_URL/api/streaming/capture/status" | jq
curl -fsSL "$HYPERSCAPES_URL/api/streaming/capture/smoke" | jq
curl -fsSL "$HYPERSCAPES_URL/api/streaming/state" | jq
curl -fsSL "$HLS_URL" | head
```

Then check the keeper:

```bash
curl -fsSL "$KEEPER_URL/api/streaming/state" | jq
curl -fsSL "$KEEPER_URL/status" | jq '.stream'
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
```

## Interpretation

Treat source truth, canonical delivery truth, and player truth as separate
signals:

- `sourceRuntime`
  - worker, browser, and capture health only
- `canonicalAuthority`
  - persisted Cloudflare lifecycle, poll, probe, and reconciliation truth
- `channel.publicReadiness`
  - canonical public playback truth
- `delivery` / `canonicalDestination`
  - consumer-facing playback metadata derived from canonical channel truth
- `fallbackDestination`
  - provider-specific warm standby state; not the normal bettor rail
- renderer-health polling may enrich playback URLs, but it must not replace
  canonical ingest transport metadata once a canonical destination exists
- player sync telemetry
  - bettor-facing live-edge alignment; separate from authority and delivery
    availability

- `render_tick_stale`
  - source page is not advancing
- `visual_change_stale`
  - render loop is alive but duel visuals are not changing
- `capture_fps_low`
  - capture path is overloaded
- `encoder_fps_low`
  - encode path is overloaded or misconfigured
- `manifest_stale`
  - delivery path is stale
- `player_drifted`
  - viewer was too far behind the live edge
- `player_buffering`
  - viewer is near the live edge but is temporarily waiting on buffer

Canonical authority decision ordering is:

1. `source_unready`
2. `provider_not_live`
3. `probe_unready`
4. `authority_stale`

## Recovery Order

1. restore source render truth
2. restore capture and encode cadence
3. restore manifest and delivery freshness
4. force player rebuild only if the source and delivery are already healthy
5. restart the keeper only if it failed to ingest a now-healthy upstream state

Do not page a full-stream outage when the fallback rail alone is red and the
canonical Cloudflare rail is still green.
Do not declare the bettor page "live synced" unless player telemetry is
aligned as well.

## Success Criteria

- Hyperscapes capture status reports fresh `rendererHealth`
- Hyperscapes capture status reports fresh `sourceRuntime`
- Hyperscapes exposes fresh `canonicalAuthority` and `publicReadiness`
- Hyperscapes smoke status reports the expected `/stream` scene URL and bundle
- capture metrics and encode metrics recover
- keepers expose the same canonical ingest and playback truth as Hyperscapes
- viewers return to live-edge playback without repeated rebuild loops
- bettor UI only presents "live synced" when both server readiness and player
  sync telemetry agree
