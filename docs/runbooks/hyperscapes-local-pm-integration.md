# Hyperscapes Local PM Integration

This is the local and personal-staging integration model after the streaming
overhaul.

## Boundary

Hyperscapes provides:

- duel lifecycle
- renderer health
- renderer metrics
- delivery metadata

Hyperbet provides:

- keeper APIs
- betting surfaces
- chain interaction

The Hyperbet UI should point at the keeper for canonical session state and use
the playback URL carried in that session. It should not invent its own stream
selection rules beyond fallback behavior.

## Personal Staging

For `enoomian` personal staging:

- Pages hosts `/stream`
- `/stream` is a dedicated capture preset with the duel camera path and no
  generic client overhead
- the GPU box renders and encodes
- `cdp` is the primary capture mode; `webcodecs` and `mediarecorder` remain
  supported fallback/debug modes
- Railway hosts the Hyperscapes API
- Hyperbet keepers poll Hyperscapes renderer health and session state
- Cloudflare Stream LL-HLS is the target viewer feed when configured
- self-hosted HLS remains available for smoke and rollback
- canonical channel and destination truth own ingest metadata; keeper
  `delivery` may enrich playback URLs but must not override canonical ingest
  transport
- Railway env reconciliation is now a separate action from deploy execution:
  use `scripts/enoomian-staging/deploy.sh hyperscapes-railway-env`,
  `scripts/enoomian-staging/deploy.sh hyperbet-solana-keepers-env`, or
  `scripts/enoomian-staging/deploy.sh hyperbet-keepers-env` when env vars need
  to be reconciled, then use the normal deploy targets for code-only deploys

## Local Debug Rules

When the stream looks stale:

1. check Hyperscapes capture status
2. check HLS manifest freshness
3. check the keeper canonical session
4. only then inspect the browser player

If the player alone drifted, rebuild the player.
If render or encode are stale, do not blame the player.

## Required Checks

```bash
curl -fsSL "$HYPERSCAPES_URL/api/streaming/capture/status" | jq
curl -fsSL "$HYPERSCAPES_URL/api/streaming/capture/smoke" | jq
curl -fsSL "$HYPERSCAPES_URL/api/streaming/state" | jq
curl -fsSL "$KEEPER_URL/api/streaming/state" | jq
```

Look for:

- `rendererHealth`
- `rendererMetrics`
- `sourceRuntime`
- `delivery`
- `playback.url`
- `currentSceneUrl`
- `activeBundle`

## Operator Goal

Every local and personal-staging integration run should answer:

- is the source rendering?
- is encode keeping up?
- is delivery fresh?
- is the player near the live edge?

If those four answers are not separated, the incident data is incomplete.
