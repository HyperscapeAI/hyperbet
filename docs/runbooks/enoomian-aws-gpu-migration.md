# Enoomian AWS GPU Migration Runbook

This runbook is intentionally scoped to `enoomian/staging`.

The goal is to move the Hyperscapes GPU capture host from Hetzner to AWS without
regressing the staging stream, bettor playback, or keeper readiness surfaces. Do
not treat this as a production deploy-path replacement until enoomian staging has
proven it under soak.

## Why This Is Separate

The current enoomian staging lane contains deployment topology and operational
choices that are not yet accepted as the canonical production standard. This
runbook documents the version that works for enoomian staging so the team can
test it end-to-end before deciding what belongs in the permanent production
runbooks and PRs.

This is not meant to fork the architecture forever. It is a staging proof lane:

- prove the AWS GPU host can render, encode, and publish the same feed as the
  current Hetzner host
- preserve the Cloudflare Stream playback contract when Cloudflare ingest is
  healthy, but allow an explicit enoomian-only self-HLS fallback during AWS
  migration proof
- preserve the enoomian public authority path and status APIs
- avoid changing GitHub production or generic staging deploy paths during proof
- only promote the working pieces into the effective PRs after soak

## Current Working Contract

Before migration, capture is expected to work like this:

- Hyperscapes source worker runs on the dedicated GPU host.
- The source worker renders the stream page in a GPU-capable browser.
- Capture mode is `x11_nvenc` when the host supports NVIDIA NVENC correctly.
- FFmpeg publishes RTMPS to the configured Cloudflare Stream live input.
- Cloudflare Stream distributes the public LL-HLS playback used by Hyperbet.
- Enoomian staging status and readiness endpoints must report the real source
  worker state, not a separate Railway-only view.

Do not restart or replace the healthy live rail during a migration test unless
the migration window explicitly calls for cutover.

## Migration Principle

AWS should be introduced as a replacement GPU source host, not as a broad
replacement for Cloudflare distribution.

The desired result is:

- AWS renders and encodes the same Hyperscapes source view.
- AWS publishes to the same canonical Cloudflare Stream lane or a deliberate
  canary lane when Cloudflare ingest is healthy.
- If Cloudflare Stream ingest rejects AWS publishers, AWS may temporarily expose
  self-HLS for enoomian staging only while Cloudflare ingest is investigated.
- Hyperbet consumes the canonical playback URL stamped by enoomian staging,
  either Cloudflare LL-HLS or the explicit AWS self-HLS fallback.
- Public enoomian staging APIs continue to expose one truthful authority path.
- Rollback is immediate: stop AWS publisher, restore the previous enoomian
  playback/API env, and redeploy the enoomian staging surfaces.

## Deployment Targets

The enoomian staging deploy script now owns the AWS GPU migration path. Use these
targets from the Hyperbet repo root:

```bash
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-plan
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-preflight
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-deploy
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-status
```

The deploy target prepares the AWS GPU host and starts the Hyperscapes duel API.
It does not redeploy Cloudflare Pages, change Hyperbet playback selection, move
Railway services, or start the AWS stream publisher by default.

The AWS stream publisher is opt-in:

```bash
ENOOMIAN_AWS_GPU_START_SOURCE=1 \
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-deploy
```

Only use `ENOOMIAN_AWS_GPU_START_SOURCE=1` for an intentional canary live input
or a scheduled canonical cutover. Do not run it against the canonical Cloudflare
input while the Hetzner source is still connected.

Public authority cutover is a separate explicit step:

```bash
ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY=1 \
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-activate
```

Activation requires `ENOOMIAN_AWS_GPU_PUBLIC_API_URL` and
`ENOOMIAN_AWS_GPU_PUBLIC_WS_URL`. It updates only enoomian staging authority
inputs and then redeploys the staging surfaces that consume those inputs. When
`ENOOMIAN_AWS_GPU_STREAM_DELIVERY_MODE=self_hls`, activation also stamps
`ENOOMIAN_STREAM_PLAYBACK_URL` from `ENOOMIAN_AWS_GPU_PUBLIC_HLS_URL` so
keepers and Pages do not keep using a stale Cloudflare playback URL.

By default the AWS activation target does not sync Hyperscapes Railway variables.
That is intentional for this proof lane: Hyperscapes public authority is AWS +
Pages. Hyperbet is different: the public app mounts the canonical stream session
published by the keeper, so activation must reconcile the Hyperbet keeper env and
redeploy the unified keeper by default. Otherwise the Pages bundle can contain
the AWS HLS URL while the live canonical session still advertises stale
Cloudflare playback.

Optional overrides:

- `ENOOMIAN_AWS_GPU_SYNC_HYPERSCAPES_RAILWAY_ENV=1` also reconciles the
  Hyperscapes Railway env during activation.
- `ENOOMIAN_AWS_GPU_SYNC_HYPERBET_KEEPER_ENV=0` skips Hyperbet keeper env sync;
  use only for Pages-only proof because the app may keep the previous canonical
  session.
- `ENOOMIAN_AWS_GPU_DEPLOY_HYPERBET_KEEPER=0` skips the keeper deploy; use only
  when the keeper has already been restarted with reconciled env.

## AWS Host Requirements

Minimum functional requirements:

- NVIDIA GPU with working driver and NVENC support.
- Linux display stack capable of running headful Chrome/Chromium against X11.
- Browser launch flags compatible with Hyperscapes WebGPU on Linux.
- FFmpeg with `h264_nvenc` available.
- Stable outbound RTMPS to Cloudflare Stream.
- Enough CPU, memory, disk, and network headroom for continuous 720p stream
  capture plus API/status processes.
- Stable process supervision for `hyperscape-stream-source` and related
  services.

Deployment env required by the AWS GPU target:

- `ENOOMIAN_AWS_GPU_SSH_TARGET`, or both `ENOOMIAN_AWS_GPU_HOST` and optional
  `ENOOMIAN_AWS_GPU_SSH_USER`
- optional `ENOOMIAN_AWS_GPU_SSH_KEY`
- optional `ENOOMIAN_AWS_GPU_SSH_PORT`
- optional `ENOOMIAN_AWS_GPU_REMOTE_ROOT`, default `/root/hyperscape` for
  `root` SSH and `/home/<user>/hyperscape` for non-root SSH
- existing enoomian stream and Cloudflare env from `personal-staging.env`

The exact AWS instance family and availability zone are not hardcoded in this
runbook. Select them from actual AWS availability during the migration window,
then record the chosen region, zone, instance type, AMI, volume size, public IP,
and security group in the staging proof notes.

## Current AWS Proof Host

Current enoomian staging proof host as of 2026-04-28:

- AWS account: `364947027011`
- AWS profile: `stream-admin`
- Region: `us-east-2`
- Instance id: `i-0c212958b7b092968`
- Instance type: `g6.xlarge`
- GPU: NVIDIA L4, 24 GB class memory, NVENC available
- AMI: `Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04) 20260421`
- Root volume: 75 GB gp3
- Public IP: `3.129.45.146`
- Security group: `sg-0583d9b7f2735aabf`
- SSH user: `ubuntu`
- Remote root: `/home/ubuntu/hyperscape`
- Local API port: `5560`
- Source publisher default: disabled with `ENOOMIAN_AWS_GPU_START_SOURCE=0`
- Public API proof URL: `https://3.129.45.146.sslip.io`
- Public self-HLS proof URL: `https://3.129.45.146.sslip.io/live/stream.m3u8`

Initial proof result:

- `nvidia-smi` works and reports the L4 GPU.
- `ffmpeg -encoders` includes `h264_nvenc`.
- The enoomian AWS deploy can sync/build the Hyperscapes app on the host.
- `hyperscape-duel-api` starts successfully on the AWS host.
- `/health` returns `ok` locally on the AWS host.
- Direct Cloudflare Stream ingest from the AWS proof host failed for canonical,
  canary, and fresh live inputs with `The specified session has been
  invalidated for some reason`. That was reproduced with the Hyperscapes source
  worker and direct FFmpeg, including a software-encode probe, so the failure is
  outside the Hyperscapes renderer/NVENC path.
- AWS self-HLS is currently the working enoomian staging fallback. The stream
  source writes fresh two-second segments to `/live/stream.m3u8`; the public
  Caddy rail serves the manifest over HTTPS.

## Do Not Change During Proof

Do not change these unless the migration test specifically calls for it:

- Cloudflare Stream account, live input, or playback policy
- Hyperbet app playback selection rules
- canonical enoomian Pages env values
- production deploy scripts
- generic staging deploy scripts
- duel lifecycle, keeper polling, or betting settlement logic
- Cloudflare cleanup jobs

The migration is about the GPU source host first.

## Proof Phases

### Phase 1: Inventory

Document the current Hetzner source host before provisioning AWS:

- process manager and process names
- source worker command and environment
- browser path and launch flags
- capture mode
- FFmpeg version and encoders
- Caddy or reverse proxy config
- public status endpoints
- Cloudflare live input id
- playback URL used by Hyperbet
- current health/status payload samples
- rollback command

If direct host access is unavailable, use existing local runbooks, env manifests,
deployment scripts, and public status endpoints to fill the inventory. Mark any
field as `unknown` instead of guessing.

### Phase 2: AWS Provision

Provision a GPU host in AWS as a canary first:

- create or select a GPU-capable EC2 instance
- attach persistent storage sized for logs, app builds, browser cache, and HLS
  scratch space if used
- install NVIDIA driver and verify `nvidia-smi`
- install Chrome/Chromium channel required for WebGPU
- install FFmpeg and verify `ffmpeg -encoders` includes `h264_nvenc`
- install Bun/Node/runtime dependencies matching the current source worker
- install process supervisor
- configure firewall/security group for only required inbound ports
- configure outbound access to Cloudflare RTMPS

Do not point public enoomian authority to AWS yet.

Then run:

```bash
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-preflight
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-deploy
```

### Phase 3: Canary Source Worker

Run the AWS source worker against a canary Cloudflare live input first.

Before enabling the source publisher, confirm the env points to a canary live
input or that a canonical cutover window is active. The safe deploy default is
`ENOOMIAN_AWS_GPU_START_SOURCE=0`; change it to `1` only for this phase.

Required checks:

- browser starts with WebGPU available
- source worker reports ready
- capture mode is `x11_nvenc` or an explicitly approved fallback
- FFmpeg emits frames continuously
- Cloudflare canary live input shows connected
- canary playback shows visible world/fighters
- source status payload includes accurate capture mode, readiness, heartbeat,
  and playback URL

If canary cannot produce a stable feed, stop. Do not touch the canonical
Cloudflare live input or public enoomian authority path.

Use this status check after deploy:

```bash
scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-status
```

### Phase 4: Public Authority Cutover

Only after canary is stable:

- decide whether AWS will publish to canonical Cloudflare directly or first
  continue on canary
- update enoomian staging-only env and proxy authority to point status/control
  endpoints at the AWS source host if needed
- keep Hyperbet playback on Cloudflare, not direct browser capture
- verify `/api/streaming/capture/status` reports the AWS source worker truth
- verify Hyperbet pages still play the Cloudflare stream
- verify keeper readiness changes propagate without stale same-duel state

This phase must not modify production or generic staging deploy paths.

Only after canary status is healthy, set the AWS public authority env values and
run the explicit activation target.

### Phase 5: Soak

Run soak before declaring AWS acceptable:

- direct Cloudflare playback
- Hyperbet embed playback
- public capture/status endpoint
- keeper stream-state publication
- source worker heartbeat
- Cloudflare input connected state
- frame continuity
- recovery after AWS process restart
- recovery after browser restart
- recovery after FFmpeg restart

Record exact timestamps, commands, status payloads, and any drift observed.

### Phase 6: Promotion Decision

After soak, split the proven work into effective PRs:

- Hyperscapes PR: source-worker/runtime changes required for AWS GPU capture.
- Hyperbet PR: enoomian staging deploy/runbook changes required to operate the
  AWS host and public authority lane.
- Production runbook update: only after the team agrees the staging topology is
  the future-forward standard.

Anything that is only a personal enoomian staging secret, host note, or local
proof artifact stays out of the public PR and remains documented in the local
staging manifest.

## Acceptance Criteria

The AWS migration is not accepted until all of these are true:

- Cloudflare playback remains the public bettor distribution rail.
- AWS source worker can run continuously without black frames or stale readiness.
- `sourceRuntime.captureMode` is truthful.
- public capture status matches the active source worker.
- Hyperbet embed plays the expected duel feed.
- no stale canonical session can mount for the wrong duel.
- no same-duel readiness or authority update is suppressed by keeper dedupe.
- rollback to Hetzner is documented and tested.

## Rollback

Rollback must be simple:

1. Stop the AWS source worker.
2. Restore the previous enoomian staging authority/status target if it changed.
3. Resume or keep the Hetzner source worker on the canonical Cloudflare input.
4. Verify Cloudflare playback.
5. Verify Hyperbet embed playback.
6. Record why AWS failed and whether the failure is host, driver, browser,
   capture, RTMPS, Cloudflare, proxy, or keeper/status related.

Do not debug by changing Hyperbet playback rules unless playback selection is
directly proven to be the failing layer.
