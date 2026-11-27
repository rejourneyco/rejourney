#!/usr/bin/env bash
# Usage: dump-production-session.sh <session-id> <output.jsonl> [every-nth-frame]
# Downloads a matrix session's stored frames and events through an API pod, read-only.
# check-cloud-frames.py then checks the frames against the lab's markers.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
session_id="${1:-}"; output="${2:-}"; every="${3:-1}"
[[ "$session_id" =~ ^session_[A-Za-z0-9_-]{1,56}$ && -n "$output" ]] || { echo "Usage: $0 <session-id> <output.jsonl> [every-nth-frame]" >&2; exit 64; }
load_environment
: "${REJOURNEY_PROJECT_ID:?REJOURNEY_PROJECT_ID is required in the unity production environment file}"
# The server is never named in this public repo: set it in the private environment file.
: "${REJOURNEY_MATRIX_SSH_HOST:?REJOURNEY_MATRIX_SSH_HOST (user@host of the production server) is required in the unity production environment file}"
ssh_host="$REJOURNEY_MATRIX_SSH_HOST"
ssh_key="${REJOURNEY_MATRIX_SSH_KEY:-$HOME/.ssh/vps_deploy}"
ssh -i "$ssh_key" "$ssh_host" "pod=\$(kubectl -n rejourney get pods -l app=api-dashboard -o jsonpath='{.items[0].metadata.name}'); test -n \"\$pod\"; kubectl -n rejourney exec -i \"\$pod\" -- env MATRIX_SESSION_ID='$session_id' MATRIX_PROJECT_ID='$REJOURNEY_PROJECT_ID' MATRIX_EVERY_NTH_FRAME='$every' LOG_LEVEL=error node --input-type=module -" \
  < "$script_dir/dump-production-session.mjs" > "$output"
echo "wrote $output ($(wc -l < "$output" | tr -d ' ') lines)"
