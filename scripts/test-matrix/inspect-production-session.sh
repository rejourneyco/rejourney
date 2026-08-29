#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <expo|brew|swift|flutter> [session-id] [--expect-paused|--expect-resumed|--expect-ended]" >&2
  exit 64
}

fixture="${1:-}"
session_id="${2:-}"
expectation="${3:-}"
case "$fixture" in
  expo|brew|swift|flutter) ;;
  *) usage ;;
esac

if [[ "$session_id" == --expect-* ]]; then
  expectation="$session_id"
  session_id=""
fi
case "$expectation" in
  ""|--expect-paused|--expect-resumed|--expect-ended) ;;
  *) usage ;;
esac

if [[ -n "$session_id" && ! "$session_id" =~ ^session_[A-Za-z0-9_-]{1,56}$ ]]; then
  echo "Invalid session id." >&2
  exit 64
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$script_dir/environments/$fixture.production.env"
if [[ ! -f "$env_file" ]]; then
  echo "Missing ignored matrix environment file: $env_file" >&2
  exit 78
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
: "${REJOURNEY_PROJECT_ID:?REJOURNEY_PROJECT_ID is required in $env_file}"
if [[ ! "$REJOURNEY_PROJECT_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Invalid REJOURNEY_PROJECT_ID in $env_file." >&2
  exit 78
fi

ssh_host="${REJOURNEY_MATRIX_SSH_HOST:-root@46.224.98.62}"
ssh_key="${REJOURNEY_MATRIX_SSH_KEY:-$HOME/.ssh/vps_deploy}"
remote_psql_command='pod=$(kubectl get pods -n rejourney -l cnpg.io/cluster=postgres-local,cnpg.io/instanceRole=primary -o jsonpath="{.items[0].metadata.name}"); test -n "$pod"; kubectl exec -i -n rejourney "$pod" -c postgres -- psql -X -v ON_ERROR_STOP=1 -P pager=off -U postgres -d rejourney'

production_psql() {
  ssh -i "$ssh_key" "$ssh_host" "$remote_psql_command"
}

production_psql_scalar() {
  ssh -i "$ssh_key" "$ssh_host" "$remote_psql_command -At"
}

if [[ -z "$session_id" ]]; then
  session_id="$({
    printf "select id from sessions where project_id = '%s' order by started_at desc, id desc limit 1;\n" "$REJOURNEY_PROJECT_ID"
  } | production_psql_scalar)"
fi

if [[ -z "$session_id" ]]; then
  echo "No production session exists for fixture '$fixture'." >&2
  exit 1
fi

echo "fixture=$fixture"
echo "session_id=$session_id"
echo "replay_url=https://rejourney.co/dashboard/sessions/$session_id"
echo

production_psql <<SQL
\echo SESSION
select
  s.id,
  p.name as project,
  s.platform,
  s.sdk_version,
  s.app_version,
  s.status,
  s.started_at,
  s.ended_at,
  s.explicit_ended_at,
  s.finalized_at,
  s.last_ingest_activity_at,
  s.sdk_paused_at,
  s.sdk_pause_id,
  s.sdk_pause_state_updated_at,
  s.duration_seconds,
  s.background_time_seconds,
  s.close_source,
  s.replay_available,
  s.replay_segment_count,
  s.replay_storage_bytes,
  s.is_sampled_in,
  s.observe_only
from sessions s
join projects p on p.id = s.project_id
where s.id = '$session_id'
  and s.project_id = '$REJOURNEY_PROJECT_ID';

\echo ARTIFACTS
select
  kind,
  status,
  count(*) as object_count,
  coalesce(sum(size_bytes), 0) as bytes,
  coalesce(sum(frame_count), 0) as frames,
  min(start_time) as first_start_ms,
  max(end_time) as last_end_ms
from recording_artifacts
where session_id = '$session_id'
group by kind, status
order by kind, status;

\echo METRICS
select
  total_events,
  touch_count,
  scroll_count,
  gesture_count,
  input_count,
  custom_event_count,
  error_count,
  crash_count,
  anr_count,
  api_total_count,
  api_error_count,
  capture_health_reported,
  frames_captured,
  frames_skipped_duplicate,
  frames_skipped_throttle,
  frames_skipped_backlog,
  frames_skipped_map_moving,
  hierarchy_snapshot_count,
  screenshot_segment_count,
  screenshot_total_bytes,
  sdk_upload_success_count,
  sdk_upload_failure_count,
  sdk_retry_attempt_count,
  sdk_circuit_breaker_open_count,
  sdk_memory_eviction_count,
  sdk_offline_persist_count,
  sdk_upload_success_rate,
  sdk_avg_upload_duration_ms,
  sdk_total_bytes_uploaded,
  battery_level_start_percent,
  battery_level_end_percent,
  battery_delta_percent,
  battery_state_start,
  battery_state_end,
  charging_state_changed,
  low_power_mode_observed,
  thermal_state_start,
  thermal_state_peak,
  thermal_state_end,
  thermal_throttled_duration_ms,
  memory_pressure_peak,
  memory_pressure_event_count,
  memory_headroom_mb_bucket_start,
  memory_headroom_mb_bucket_min,
  memory_headroom_mb_bucket_end,
  font_scale_bucket,
  ui_style,
  layout_direction,
  orientation_start,
  orientation_end,
  orientation_change_count,
  display_max_refresh_rate_hz
from session_metrics
where session_id = '$session_id';

\echo 'PAUSE MARKERS'
select
  event ->> 'name' as name,
  event ->> 'timestamp' as timestamp_ms,
  event ->> 'payload' as payload
from sessions s
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(s.events) = 'array' then s.events else '[]'::jsonb end
) event
where s.id = '$session_id'
  and lower(coalesce(event ->> 'name', '')) in ('sdk_paused', 'sdk_resumed')
order by nullif(event ->> 'timestamp', '')::double precision nulls last;
SQL

assertion_sql=""
case "$expectation" in
  --expect-paused)
    assertion_sql="status in ('processing', 'pending') and ended_at is null and explicit_ended_at is null and sdk_paused_at is not null and sdk_pause_id is not null"
    ;;
  --expect-resumed)
    assertion_sql="status in ('processing', 'pending') and ended_at is null and explicit_ended_at is null and sdk_paused_at is null and sdk_pause_id is null and sdk_pause_state_updated_at is not null"
    ;;
  --expect-ended)
    assertion_sql="ended_at is not null and explicit_ended_at is not null and sdk_paused_at is null and sdk_pause_id is null"
    ;;
esac

if [[ -n "$assertion_sql" ]]; then
  assertion_result="$({
    printf "select count(*) from sessions where id = '%s' and project_id = '%s' and %s;\n" \
      "$session_id" "$REJOURNEY_PROJECT_ID" "$assertion_sql"
  } | production_psql_scalar)"
  if [[ "$assertion_result" != "1" ]]; then
    echo "Production lifecycle assertion failed: $expectation ($session_id)" >&2
    exit 1
  fi
  echo "production_assertion=passed:$expectation"
fi
