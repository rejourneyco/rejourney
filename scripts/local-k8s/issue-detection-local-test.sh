#!/bin/bash
# Exercise the private issue-detection scan job against this local Rejourney
# k8s/dev stack without printing shared secrets.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.k8s.local}"

COMMAND="${1:-}"
[ -n "$COMMAND" ] && shift || true

PROJECT_ID="${PROJECT_ID:-}"
LOCAL_API_ORIGIN="${LOCAL_API_ORIGIN:-http://localhost:3000}"
LOOKBACK_HOURS="${LOOKBACK_HOURS:-168}"
MIN_REPLAY_SECONDS="${MIN_REPLAY_SECONDS:-15}"
SCAN_JOB="${SCAN_JOB:-scan}"
GCP_REGION="${GCP_REGION:-us-east1}"
GCP_PROJECT="${GCP_PROJECT:-}"
SCAN_TOP_PERCENT="${SCAN_TOP_PERCENT:-100}"
SCAN_DAILY_CAP="${SCAN_DAILY_CAP:-150}"
SCAN_DAILY_FLOOR="${SCAN_DAILY_FLOOR:-0}"
SCAN_MAX_CANDIDATES="${SCAN_MAX_CANDIDATES:-2000}"
SPA_GATE="${SPA_GATE:-scored}"
USE_TUNNEL="${USE_TUNNEL:-true}"
PUBLIC_REJOURNEY_URL="${PUBLIC_REJOURNEY_URL:-}"
EXPECTED_CONTEXT="${EXPECTED_CONTEXT:-k3d-rejourney-dev}"

TUNNEL_PID=""
TUNNEL_LOG=""

usage() {
    cat <<'EOF'
Usage:
  scripts/local-k8s/issue-detection-local-test.sh check   --project-id <uuid>
  scripts/local-k8s/issue-detection-local-test.sh dry-run --project-id <uuid> [options]
  scripts/local-k8s/issue-detection-local-test.sh run     --project-id <uuid> [options]

Commands:
  check    Verify local k8s context, env shape, and signed candidate-session API.
  dry-run  Open a temporary tunnel and execute the scan job with SCAN_DRY_RUN=true.
  run      Open a temporary tunnel and execute the scan job with SCAN_DRY_RUN=false.

Options:
  --project-id <uuid>       Rejourney project id to scan.
  --env-file <path>         Env file to read; default .env.k8s.local.
  --local-api-origin <url>  Local Rejourney API origin; default http://localhost:3000.
  --lookback-hours <n>      Candidate-session lookback; default 168.
  --min-replay-seconds <n>  Candidate-session replay floor; default 15.
  --gcp-project <id>        GCP project containing the private scan job.
  --gcp-region <region>     Cloud Run region; default us-east1.
  --scan-job <name>         Cloud Run Job name; default scan.
  --top-percent <n>         Scan admission percent for this execution; default 100.
  --daily-cap <n>           Scan daily cap for this execution; default 150.
  --daily-floor <n>         Scan daily floor for this execution; default 0.
  --max-candidates <n>      Candidate API limit for this execution; default 2000.
  --spa-gate <legacy|scored> Gate mode override for this execution; default scored.
  --public-rejourney-url <url>
                            Existing public URL for local API; skips cloudflared.
  --no-tunnel               Do not start cloudflared; requires --public-rejourney-url.

Environment variables with the same uppercase names are also supported, for
example PROJECT_ID, GCP_PROJECT, LOOKBACK_HOURS, and PUBLIC_REJOURNEY_URL.

This script intentionally never prints private URL or secret values from env.
EOF
}

log() { echo "[issue-detection-local] $*"; }
error() { echo "[issue-detection-local] ERROR: $*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
    case "$1" in
        --project-id) PROJECT_ID="${2:-}"; shift 2 ;;
        --env-file) ENV_FILE="${2:-}"; shift 2 ;;
        --local-api-origin) LOCAL_API_ORIGIN="${2:-}"; shift 2 ;;
        --lookback-hours) LOOKBACK_HOURS="${2:-}"; shift 2 ;;
        --min-replay-seconds) MIN_REPLAY_SECONDS="${2:-}"; shift 2 ;;
        --gcp-project) GCP_PROJECT="${2:-}"; shift 2 ;;
        --gcp-region) GCP_REGION="${2:-}"; shift 2 ;;
        --scan-job) SCAN_JOB="${2:-}"; shift 2 ;;
        --top-percent) SCAN_TOP_PERCENT="${2:-}"; shift 2 ;;
        --daily-cap) SCAN_DAILY_CAP="${2:-}"; shift 2 ;;
        --daily-floor) SCAN_DAILY_FLOOR="${2:-}"; shift 2 ;;
        --max-candidates) SCAN_MAX_CANDIDATES="${2:-}"; shift 2 ;;
        --spa-gate) SPA_GATE="${2:-}"; shift 2 ;;
        --public-rejourney-url) PUBLIC_REJOURNEY_URL="${2:-}"; USE_TUNNEL=false; shift 2 ;;
        --no-tunnel) USE_TUNNEL=false; shift ;;
        -h|--help) usage; exit 0 ;;
        *) error "Unknown option: $1" ;;
    esac
done

cleanup() {
    if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
        log "Stopping temporary tunnel"
        kill "$TUNNEL_PID" 2>/dev/null || true
        wait "$TUNNEL_PID" 2>/dev/null || true
    fi
    if [ -n "$TUNNEL_LOG" ]; then
        rm -f "$TUNNEL_LOG"
    fi
}
trap cleanup EXIT

require_command() {
    command -v "$1" >/dev/null 2>&1 || error "$1 is required"
}

require_common() {
    case "$COMMAND" in
        check|dry-run|run) ;;
        ""|-h|--help) usage; exit 0 ;;
        *) usage; error "Unknown command: $COMMAND" ;;
    esac

    [ -n "$PROJECT_ID" ] || error "Set --project-id or PROJECT_ID"
    [ -f "$ENV_FILE" ] || error "Missing env file: $ENV_FILE"

    require_command node
    require_command kubectl

    local context
    context="$(kubectl config current-context 2>/dev/null || true)"
    [ "$context" = "$EXPECTED_CONTEXT" ] || error "kubectl context is '$context', expected '$EXPECTED_CONTEXT'"
    kubectl get namespace rejourney-local >/dev/null 2>&1 || error "namespace rejourney-local is not present"
}

env_audit() {
    ENV_FILE="$ENV_FILE" node --input-type=commonjs - <<'NODE'
const fs = require('fs');
const envFile = process.env.ENV_FILE;
const wanted = [
  'REJOURNEY_INTERNAL_SERVICE_SECRET',
  'REJOURNEY_INTERNAL_API_URL',
  'ISSUE_DETECTION_API_URL',
  'ISSUE_DETECTION_SERVICE_SECRET',
  'SHOW_ISSUE_DETECTION_UI',
];
const env = {};
for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const idx = line.indexOf('=');
  if (idx < 0) continue;
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[line.slice(0, idx).trim()] = value;
}
for (const key of wanted) {
  const value = env[key] || '';
  const isSensitiveDisplay = key.endsWith('_SECRET') || key.endsWith('_KEY') || key.endsWith('_URL');
  const printable =
    isSensitiveDisplay
      ? (value ? `set (${value.length} chars)` : 'missing')
      : (value || 'missing');
  console.log(`${key}: ${printable}`);
}
if (!env.REJOURNEY_INTERNAL_SERVICE_SECRET) process.exitCode = 2;
NODE
}

signed_candidate_check() {
    ENV_FILE="$ENV_FILE" \
    PROJECT_ID="$PROJECT_ID" \
    LOCAL_API_ORIGIN="$LOCAL_API_ORIGIN" \
    LOOKBACK_HOURS="$LOOKBACK_HOURS" \
    MIN_REPLAY_SECONDS="$MIN_REPLAY_SECONDS" \
    node --input-type=commonjs - <<'NODE'
const fs = require('fs');
const crypto = require('crypto');

function readEnv(path) {
  const env = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, idx).trim()] = value;
  }
  return env;
}

async function main() {
  const env = readEnv(process.env.ENV_FILE);
  const secret = env.REJOURNEY_INTERNAL_SERVICE_SECRET;
  if (!secret) throw new Error('REJOURNEY_INTERNAL_SERVICE_SECRET is missing');

  const projectId = process.env.PROJECT_ID;
  const origin = process.env.LOCAL_API_ORIGIN.replace(/\/+$/, '');
  const path =
    `/api/internal/issue-detection/projects/${encodeURIComponent(projectId)}/candidate-sessions` +
    `?lookback=${encodeURIComponent(process.env.LOOKBACK_HOURS)}h` +
    `&limit=1&minReplayDurationSeconds=${encodeURIComponent(process.env.MIN_REPLAY_SECONDS)}`;
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update('', 'utf8').digest('hex');
  const payload = ['GET', path, timestamp, nonce, bodyHash].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  const response = await fetch(origin + path, {
    headers: {
      'X-RJ-Internal-Service': 'issue-detection',
      'X-RJ-Internal-Timestamp': timestamp,
      'X-RJ-Internal-Nonce': nonce,
      'X-RJ-Internal-Signature': signature,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`candidate API returned ${response.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  console.log(`candidate API: HTTP ${response.status}, sample sessions returned ${json.sessions?.length ?? 0}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
}

require_gcp() {
    require_command gcloud
    if [ -z "$GCP_PROJECT" ]; then
        GCP_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
    fi
    [ -n "$GCP_PROJECT" ] || error "Set --gcp-project or configure gcloud core/project"
}

start_tunnel() {
    if [ "$USE_TUNNEL" != "true" ]; then
        [ -n "$PUBLIC_REJOURNEY_URL" ] || error "--no-tunnel requires --public-rejourney-url"
        return
    fi

    require_command cloudflared
    TUNNEL_LOG="$(mktemp -t issue-detection-tunnel.XXXXXX.log)"
    log "Starting temporary cloudflared tunnel to $LOCAL_API_ORIGIN"
    cloudflared tunnel --url "$LOCAL_API_ORIGIN" --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID="$!"

    for _ in $(seq 1 60); do
        if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
            sed -n '1,120p' "$TUNNEL_LOG" >&2 || true
            error "cloudflared exited before producing a URL"
        fi
        PUBLIC_REJOURNEY_URL="$(grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n 1 || true)"
        if [ -n "$PUBLIC_REJOURNEY_URL" ]; then
            log "Tunnel ready: $PUBLIC_REJOURNEY_URL"
            return
        fi
        sleep 1
    done

    sed -n '1,160p' "$TUNNEL_LOG" >&2 || true
    error "Timed out waiting for cloudflared URL"
}

run_scan_job() {
    local dry_run="$1"
    local output execution

    require_gcp
    start_tunnel

    log "Executing Cloud Run Job '$SCAN_JOB' against local Rejourney (dryRun=$dry_run)"
    output="$(
        gcloud run jobs execute "$SCAN_JOB" \
            --region "$GCP_REGION" \
            --project "$GCP_PROJECT" \
            --wait \
            --update-env-vars="REJOURNEY_INTERNAL_API_URL=$PUBLIC_REJOURNEY_URL,SCAN_PROJECT_ID=$PROJECT_ID,SCAN_WINDOW_HOURS=$LOOKBACK_HOURS,SCAN_TOP_PERCENT=$SCAN_TOP_PERCENT,SCAN_DAILY_CAP=$SCAN_DAILY_CAP,SCAN_DAILY_FLOOR=$SCAN_DAILY_FLOOR,SCAN_MAX_CANDIDATES=$SCAN_MAX_CANDIDATES,SCAN_DRY_RUN=$dry_run,SPA_GATE=$SPA_GATE" \
            2>&1
    )" || {
        printf '%s\n' "$output" >&2
        error "Cloud Run Job execution failed"
    }
    printf '%s\n' "$output"

    execution="$(printf '%s\n' "$output" | sed -n 's/.*Execution \[\([^]]*\)\].*/\1/p' | tail -n 1)"
    if [ -n "$execution" ]; then
        summarize_execution "$execution"
    else
        log "Could not parse execution name from gcloud output; skipping log summary"
    fi

    if [ "$dry_run" = "false" ]; then
        signed_leaks_check || true
    fi
}

summarize_execution() {
    local execution="$1"
    log "Execution: $execution"
    gcloud logging read \
        "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SCAN_JOB\" AND labels.\"run.googleapis.com/execution_name\"=\"$execution\"" \
        --project "$GCP_PROJECT" \
        --limit 200 \
        --format='value(timestamp,jsonPayload.msg,jsonPayload.admitted,jsonPayload.sessionId,jsonPayload.spaStatus,jsonPayload.candidatesEmitted,jsonPayload.issuesUpserted,jsonPayload.err.name)' \
        | awk 'NF {print}' \
        | tail -n 80 || true
}

signed_leaks_check() {
    ENV_FILE="$ENV_FILE" PROJECT_ID="$PROJECT_ID" node --input-type=commonjs - <<'NODE'
const fs = require('fs');
const crypto = require('crypto');

function readEnv(path) {
  const env = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, idx).trim()] = value;
  }
  return env;
}

async function main() {
  const env = readEnv(process.env.ENV_FILE);
  const origin = (env.ISSUE_DETECTION_API_URL || '').replace(/\/+$/, '');
  const secret = env.ISSUE_DETECTION_SERVICE_SECRET || '';
  if (!origin || !secret) {
    console.log('leaks API check: skipped (ISSUE_DETECTION_API_URL or ISSUE_DETECTION_SERVICE_SECRET missing)');
    return;
  }

  const path = `/v1/projects/${encodeURIComponent(process.env.PROJECT_ID)}/leaks`;
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update('', 'utf8').digest('hex');
  const payload = ['GET', path, timestamp, nonce, bodyHash].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const response = await fetch(origin + path, {
    headers: {
      'X-RJ-Internal-Service': 'rejourney',
      'X-RJ-Internal-Timestamp': timestamp,
      'X-RJ-Internal-Nonce': nonce,
      'X-RJ-Internal-Signature': signature,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`leaks API returned ${response.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const leaks = Array.isArray(json.leaks) ? json.leaks.length : (json.leakCount ?? 'unknown');
  console.log(`leaks API: HTTP ${response.status}, visible leaks ${leaks}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
}

require_common

case "$COMMAND" in
    check)
        env_audit
        signed_candidate_check
        ;;
    dry-run)
        env_audit
        signed_candidate_check
        run_scan_job true
        ;;
    run)
        env_audit
        signed_candidate_check
        run_scan_job false
        ;;
esac
