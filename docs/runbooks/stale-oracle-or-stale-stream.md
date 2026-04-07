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

## Recovery Order

1. restore source render truth
2. restore capture and encode cadence
3. restore manifest and delivery freshness
4. force player rebuild only if the source and delivery are already healthy
5. restart the keeper only if it failed to ingest a now-healthy upstream state

## Success Criteria

- Hyperscapes capture status reports fresh `rendererHealth`
- capture metrics and encode metrics recover
- keepers expose the same delivery mode and renderer truth
- viewers return to live-edge playback without repeated rebuild loops
