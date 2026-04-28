#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
usage: scripts/enoomian-staging/full-soak.sh [--duration-min=120] [--chains=unified] [--screenshots=true] [--manual-window-min=15] [env-file]
EOF
}

chain_keeper_url() {
  local chain="$1"
  case "${chain}" in
    solana)
      printf '%s\n' "${HYPERBET_SOLANA_KEEPER_STAGING_URL}"
      ;;
    bsc)
      printf '%s\n' "${HYPERBET_BSC_KEEPER_STAGING_URL}"
      ;;
    *)
      return 1
      ;;
  esac
}

fetch_hyperscapes_csrf_token() {
  local cookie_jar="$1"
  curl -fsS -c "${cookie_jar}" "${ENOOMIAN_HYPERSCAPES_API_URL}/api/csrf-token" | jq -r '.token // empty'
}

post_hyperscapes_with_csrf() {
  local cookie_jar="$1"
  local csrf_token="$2"
  local path="$3"
  local payload="${4:-}"

  if [[ -n "${payload}" ]]; then
    curl -fsS \
      -b "${cookie_jar}" \
      -H "x-csrf-token: ${csrf_token}" \
      -H 'content-type: application/json' \
      -X POST \
      "${ENOOMIAN_HYPERSCAPES_API_URL}${path}" \
      --data "${payload}"
  else
    curl -fsS \
      -b "${cookie_jar}" \
      -H "x-csrf-token: ${csrf_token}" \
      -X POST \
      "${ENOOMIAN_HYPERSCAPES_API_URL}${path}"
  fi
}

embedded_agent_state() {
  local roster_payload="$1"
  local agent_id="$2"
  printf '%s' "${roster_payload}" | jq -r --arg id "${agent_id}" '
    .agents[]?
    | select(.agentId == $id or .characterId == $id)
    | .state
  ' | head -n 1
}

ensure_embedded_combat_agents() {
  local roster_output_path="$1"
  local agent_ids_csv="${ENOOMIAN_HYPERSCAPES_EMBEDDED_AGENT_IDS:-enoomian-combat-agent-1,enoomian-combat-agent-2}"
  local csrf_root
  local cookie_jar
  local csrf_token
  local roster_payload
  local agent_id
  local state

  csrf_root="$(enoomian_mktemp_dir enoomian-hyperscapes-csrf)"
  cookie_jar="${csrf_root}/cookies.txt"
  csrf_token="$(fetch_hyperscapes_csrf_token "${cookie_jar}")"
  [[ -n "${csrf_token}" ]] || enoomian_die "failed to obtain Hyperscapes CSRF token"

  roster_payload="$(curl -fsS "${ENOOMIAN_HYPERSCAPES_API_URL}/api/embedded-agents")"
  IFS=',' read -r -a agent_ids <<<"${agent_ids_csv}"
  for agent_id in "${agent_ids[@]}"; do
    state="$(embedded_agent_state "${roster_payload}" "${agent_id}")"
    case "${state}" in
      running)
        continue
        ;;
      paused|stopped|error|initializing)
        enoomian_log "starting embedded agent ${agent_id}"
        post_hyperscapes_with_csrf "${cookie_jar}" "${csrf_token}" "/api/embedded-agents/${agent_id}/start" >/dev/null
        ;;
      "")
        enoomian_log "creating embedded combat agent ${agent_id}"
        post_hyperscapes_with_csrf \
          "${cookie_jar}" \
          "${csrf_token}" \
          "/api/embedded-agents" \
          "$(jq -n --arg id "${agent_id}" '{characterId: $id, scriptedRole: "combat", autoStart: true}')" >/dev/null
        ;;
      *)
        enoomian_die "embedded agent ${agent_id} is in unexpected state: ${state}"
        ;;
    esac
    roster_payload="$(curl -fsS "${ENOOMIAN_HYPERSCAPES_API_URL}/api/embedded-agents")"
    state="$(embedded_agent_state "${roster_payload}" "${agent_id}")"
    [[ "${state}" == "running" ]] || enoomian_die "embedded agent ${agent_id} did not reach running state"
  done

  printf '%s\n' "${roster_payload}" >"${roster_output_path}"
}

trigger_ensure_active() {
  local response_path="$1"
  local attempt
  local status=""

  if enoomian_source_stream_is_active; then
    jq -n \
      --arg status "already-active" \
      --arg reason "source_stream_already_active" \
      --arg phase "$(enoomian_source_stream_phase)" \
      '{success: true, status: $status, reason: $reason, phase: $phase}' \
      >"${response_path}"
    printf '%s\n' "204"
    return 0
  fi

  for attempt in $(seq 1 6); do
    status="$(
      curl -sS \
        -o "${response_path}" \
        -w '%{http_code}' \
        -X POST \
        -H 'accept: application/json' \
        -H "authorization: Bearer ${ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN}" \
        "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/streaming/duel/ensure-active"
    )"
    if [[ "${status}" == "200" ]]; then
      printf '%s\n' "${status}"
      return 0
    fi
    if [[ "${status}" == "404" ]] && enoomian_source_stream_is_active; then
      jq -n \
        --arg status "route-missing-stream-active" \
        --arg reason "ensure_active_route_missing_but_stream_is_active" \
        --arg phase "$(enoomian_source_stream_phase)" \
        '{success: true, status: $status, reason: $reason, phase: $phase}' \
        >"${response_path}"
      printf '%s\n' "204"
      return 0
    fi
    if [[ "${status}" == "409" ]] && jq -e '.reason == "insufficient_agents"' "${response_path}" >/dev/null 2>&1; then
      sleep 5
      continue
    fi
    if [[ "${status}" == "503" ]] && jq -e '.reason == "cleanup_in_progress"' "${response_path}" >/dev/null 2>&1; then
      sleep 5
      continue
    fi
    printf '%s\n' "${status}"
    return 0
  done
  printf '%s\n' "${status}"
}

detect_open_market_chain() {
  local chains_csv="$1"
  local chain keeper_url payload
  IFS=',' read -r -a chains <<<"${chains_csv}"
  for chain in "${chains[@]}"; do
    keeper_url="$(chain_keeper_url "${chain}")"
    payload="$(curl -fsSL "${keeper_url}/api/arena/prediction-markets/active" 2>/dev/null || true)"
    [[ -n "${payload}" ]] || continue
    if printf '%s' "${payload}" | jq -e --arg chain "${chain}" '.markets[]? | select(.chainKey == $chain and .lifecycleStatus == "OPEN")' >/dev/null; then
      printf '%s\n' "${chain}"
      return 0
    fi
  done
  return 1
}

write_manual_checklist() {
  local checklist_path="$1"
  local stream_url="$2"
  local open_chain="${3:-pending}"
  local manual_window_min="$4"
  local opened_at_iso="${5:-pending}"

  cat >"${checklist_path}" <<EOF
# Personal Staging Manual Wallet Lane

- Hyperscapes stream: ${stream_url}
- Unified app: ${HYPERBET_PAGES_STAGING_URL}
- First observed open chain: ${open_chain}
- Manual window: ${manual_window_min} minutes
- Window opened at: ${opened_at_iso}

## Required Actions

- Open the unified app and switch to Solana in-app.
- Connect a real wallet on Solana staging and place one duel bet.
- Record the Solana tx hash:
- Confirm the Solana bet reaches the active market and later resolves/claims.
- Switch the unified app to BSC in-app.
- Connect a real wallet on BSC staging and place one duel bet.
- Record the BSC tx hash:
- Confirm the BSC bet reaches the active market and later resolves/claims.
- Open the Models view on Solana from the unified app.
- Open the Models view on BSC from the unified app.
- Verify the BSC model/perps surface is visible during the open market window.

## Notes

- Observations:
- Follow-up issues:
EOF
}

write_summary_manifest() {
  local summary_path="$1"
  local run_root="$2"
  local ensure_active_response_path="$3"
  local embedded_agents_path="$4"
  local manual_checklist_path="$5"
  local soak_log_path="$6"
  local chains="$7"
  jq -n \
    --arg runRoot "${run_root}" \
    --arg envFile "${ENOOMIAN_ENV_FILE}" \
    --arg chains "${chains}" \
    --arg stagedProofDuelId "${HYPERBET_STAGED_PROOF_DUEL_ID}" \
    --arg stagedProofDuelKey "${HYPERBET_STAGED_PROOF_DUEL_KEY}" \
    --arg hyperscapesApi "${ENOOMIAN_HYPERSCAPES_API_URL}" \
    --arg hyperscapesPages "${ENOOMIAN_HYPERSCAPES_PAGES_URL}" \
    --arg streamUrl "${HYPERSCAPES_UI_URL}" \
    --arg ensureActiveResponse "${ensure_active_response_path}" \
    --arg embeddedAgents "${embedded_agents_path}" \
    --arg manualChecklist "${manual_checklist_path}" \
    --arg soakLog "${soak_log_path}" \
    --arg streamProbe "${HYPERBET_CI_ARTIFACT_DIR}/stream-probe/probe-result.json" \
    --arg stagedProofRoot "${HYPERBET_CI_ARTIFACT_DIR}/staged-live-proof" \
    --arg pmSoakSummary "${HYPERBET_CI_ARTIFACT_DIR}/pm-soak/summary.json" \
    --arg sourceActivationStartedAtMs "${SOURCE_ACTIVATION_STARTED_AT_MS}" \
    '{
      runRoot: $runRoot,
      envFile: $envFile,
      chains: ($chains | split(",")),
      stagedProof: {
        duelId: $stagedProofDuelId,
        duelKey: $stagedProofDuelKey
      },
      hyperscapes: {
        apiUrl: $hyperscapesApi,
        pagesUrl: $hyperscapesPages,
        streamUrl: $streamUrl,
        sourceActivationStartedAtMs: $sourceActivationStartedAtMs
      },
      artifacts: {
        ensureActiveResponse: $ensureActiveResponse,
        embeddedAgents: $embeddedAgents,
        streamProbe: $streamProbe,
        stagedProofRoot: $stagedProofRoot,
        pmSoakSummary: $pmSoakSummary,
        soakLog: $soakLog,
        manualChecklist: $manualChecklist
      }
    }' >"${summary_path}"
}

main() {
  local duration_minutes="120"
  local chains="unified"
  local screenshots="true"
  local manual_window_min="15"
  local env_file=""
  local arg

  for arg in "$@"; do
    case "${arg}" in
      --duration-min=*)
        duration_minutes="${arg#*=}"
        ;;
      --chains=*)
        chains="${arg#*=}"
        ;;
      --screenshots=*)
        screenshots="${arg#*=}"
        ;;
      --manual-window-min=*)
        manual_window_min="${arg#*=}"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        if [[ -z "${env_file}" ]]; then
          env_file="${arg}"
        else
          usage
          exit 1
        fi
        ;;
    esac
  done

  case "${screenshots}" in
    true|false) ;;
    *)
      usage
      exit 1
      ;;
  esac

  enoomian_require_cmds bun node curl jq
  enoomian_load_env "${env_file}"
  enoomian_prepare_staged_proof_identity
  enoomian_export_hyperbet_staged_env
  enoomian_export_hyperscapes_source_env
  enoomian_require_env ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN

  local run_root
  local ensure_active_response_path
  local embedded_agents_path
  local manual_checklist_path
  local summary_path
  local soak_log_path
  local stream_url
  local ensure_active_status
  local open_chain=""
  local open_detected_at_iso="pending"
  local detected_chain=""
  local soak_pid=""
  local soak_status=0
  local open_deadline_secs=1800
  local poll_interval_secs=5

  run_root="$(enoomian_mktemp_dir enoomian-full-soak)"
  ensure_active_response_path="${run_root}/ensure-active-response.json"
  embedded_agents_path="${run_root}/embedded-agents.json"
  manual_checklist_path="${run_root}/manual-checklist.md"
  summary_path="${run_root}/summary.json"
  soak_log_path="${run_root}/pm-soak.log"

  export HYPERBET_CI_ARTIFACT_DIR="${run_root}/artifacts"
  export SOURCE_ACTIVATION_STARTED_AT_MS="$(node -e 'console.log(Date.now())')"
  export SOURCE_ACTIVATION_BUDGET_MS="${SOURCE_ACTIVATION_BUDGET_MS:-120000}"
  export PW_BROWSER_CHANNEL="${PW_BROWSER_CHANNEL:-chrome}"
  export PW_WEBGPU_ARGS="${PW_WEBGPU_ARGS:---enable-unsafe-webgpu --ignore-gpu-blocklist --enable-features=Vulkan}"
  export PM_STREAM_PROBE_BROWSER_CHANNEL="${PM_STREAM_PROBE_BROWSER_CHANNEL:-${PW_BROWSER_CHANNEL}}"
  export PM_STREAM_PROBE_WEBGPU_ARGS="${PM_STREAM_PROBE_WEBGPU_ARGS:-${PW_WEBGPU_ARGS}}"
  export PM_SOAK_BROWSER_CHANNEL="${PM_SOAK_BROWSER_CHANNEL:-${PW_BROWSER_CHANNEL}}"
  export PM_SOAK_WEBGPU_ARGS="${PM_SOAK_WEBGPU_ARGS:-${PW_WEBGPU_ARGS}}"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    export PM_SOAK_HEADLESS="${PM_SOAK_HEADLESS:-false}"
  fi

  stream_url="$(enoomian_hyperscapes_stream_url)"
  export HYPERSCAPES_UI_URL="${stream_url}"
  export STREAM_URL="${stream_url}"

  enoomian_log "verifying personal Hyperscapes health and stream page"
  enoomian_wait_for_json "${ENOOMIAN_HYPERSCAPES_API_URL}/health" '.status == "ok"' 12 5 || enoomian_die "personal Hyperscapes /health is not ready"
  enoomian_wait_for_url "${stream_url}" 12 5 || enoomian_die "personal Hyperscapes stream page is not reachable"

  enoomian_log "ensuring personal embedded duel agents are running"
  ensure_embedded_combat_agents "${embedded_agents_path}"

  enoomian_log "triggering personal Hyperscapes duel activation"
  ensure_active_status="$(trigger_ensure_active "${ensure_active_response_path}")"
  case "${ensure_active_status}" in
    200|204) ;;
    401)
      enoomian_die "ensure-active returned 401; check ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN"
      ;;
    409)
      enoomian_die "ensure-active returned 409: $(cat "${ensure_active_response_path}")"
      ;;
    503)
      enoomian_die "ensure-active returned 503: $(cat "${ensure_active_response_path}")"
      ;;
    *)
      enoomian_die "ensure-active returned ${ensure_active_status}: $(cat "${ensure_active_response_path}")"
      ;;
  esac

  enoomian_log "waiting for Hyperscapes source phase to leave IDLE"
  enoomian_wait_for_json \
    "${SOURCE_STREAM_STATE_URL}" \
    '((.cycle.phase // .duel.phase // "IDLE") != "IDLE")' \
    24 \
    5 || enoomian_die "Hyperscapes source stayed IDLE beyond the activation budget"

  if [[ "${screenshots}" == "true" ]]; then
    bunx playwright install chromium
  fi

  enoomian_log "running stream readiness probe"
  enoomian_run_stream_probe "${stream_url}" 90000 || enoomian_die "stream readiness probe failed"
  export SOURCE_STREAM_PROBE_PATH="${HYPERBET_CI_ARTIFACT_DIR}/stream-probe/probe-result.json"

  enoomian_log "running read-only staged proof for Solana"
  node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode=read-only --target=solana
  enoomian_log "running read-only staged proof for BSC"
  node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode=read-only --target=bsc
  enoomian_log "running canary-write staged proof for Solana"
  node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode=canary-write --target=solana
  enoomian_log "running canary-write staged proof for BSC"
  node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode=canary-write --target=bsc

  write_manual_checklist "${manual_checklist_path}" "${stream_url}" "pending" "${manual_window_min}" "pending"

  enoomian_log "starting long staged soak"
  (
    PM_SOAK_ENABLE_CANARY_TRADES=true \
    PM_SOAK_SCREENSHOTS="${screenshots}" \
    PM_SOAK_CHAINS="${chains}" \
    PM_SOAK_DURATION_MINUTES="${duration_minutes}" \
    bun run pm:soak -- --mode=staged --run-scope=LIVE_CANARY --chains="${chains}" --duration-min="${duration_minutes}"
  ) >"${soak_log_path}" 2>&1 &
  soak_pid=$!

  local elapsed_secs=0
  while kill -0 "${soak_pid}" 2>/dev/null; do
    if [[ -z "${open_chain}" ]]; then
      detected_chain="$(detect_open_market_chain "${chains}" 2>/dev/null || true)"
      if [[ -n "${detected_chain}" ]]; then
        open_chain="${detected_chain}"
        open_detected_at_iso="$(node -e 'console.log(new Date().toISOString())')"
        enoomian_log "first live open market window detected on ${open_chain}; manual wallet lane is open for ${manual_window_min} minutes"
        write_manual_checklist \
          "${manual_checklist_path}" \
          "${stream_url}" \
          "${open_chain}" \
          "${manual_window_min}" \
          "${open_detected_at_iso}"
      fi
    fi
    if (( elapsed_secs >= open_deadline_secs )); then
      break
    fi
    sleep "${poll_interval_secs}"
    elapsed_secs=$((elapsed_secs + poll_interval_secs))
  done

  set +e
  wait "${soak_pid}"
  soak_status=$?
  set -e

  write_summary_manifest \
    "${summary_path}" \
    "${run_root}" \
    "${ensure_active_response_path}" \
    "${embedded_agents_path}" \
    "${manual_checklist_path}" \
    "${soak_log_path}" \
    "${chains}"

  enoomian_log "full soak artifacts:"
  enoomian_log "  summary: ${summary_path}"
  enoomian_log "  manual checklist: ${manual_checklist_path}"
  enoomian_log "  soak log: ${soak_log_path}"

  if [[ "${soak_status}" -ne 0 ]]; then
    enoomian_die "full staged soak failed; inspect ${summary_path} and ${soak_log_path}"
  fi
}

main "$@"
