#!/bin/sh
# =============================================================================
# Rejourney Session Backup → Cloudflare R2
#
# Backs up completed sessions with replay recordings to the existing
# rejourney-backup R2 bucket under backups/sessions/.
#
# Same pattern as k8s/backup.yaml (K3s CronJob + aws-cli).
#
# Usage:
#   archive-sessions.sh [--dry-run] [--limit N] [--project-id UUID] [--since YYYY-MM-DD]
#
# Required env vars:
#   DATABASE_URL          – Postgres connection string
#   S3_ENDPOINT           – Hetzner S3 endpoint (source)
#   S3_BUCKET             – Hetzner S3 bucket  (source)
#   S3_ACCESS_KEY_ID      – Hetzner S3 credentials
#   S3_SECRET_ACCESS_KEY  – Hetzner S3 credentials
#   R2_ENDPOINT           – Cloudflare R2 endpoint (destination)
#   R2_BUCKET             – R2 bucket name (destination, e.g. rejourney-backup)
#   AWS_ACCESS_KEY_ID     – R2 credentials (set by K8s secret)
#   AWS_SECRET_ACCESS_KEY – R2 credentials (set by K8s secret)
# =============================================================================

set -e

# ── CLI flags ────────────────────────────────────────────────────────────────
DRY_RUN=false
LIMIT=0
PROJECT_FILTER=""
SINCE_FILTER=""
BATCH_SIZE=50

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY_RUN=true; shift ;;
    --limit)      LIMIT="$2"; shift 2 ;;
    --project-id) PROJECT_FILTER="$2"; shift 2 ;;
    --since)      SINCE_FILTER="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Validation ───────────────────────────────────────────────────────────────
for VAR in DATABASE_URL S3_ENDPOINT S3_BUCKET R2_ENDPOINT R2_BUCKET; do
  eval "VAL=\$$VAR"
  if [ -z "$VAL" ]; then
    echo "❌ Missing required env var: $VAR"
    exit 1
  fi
done

echo "╔════════════════════════════════════════════════════════════╗"
echo "║       REJOURNEY SESSION BACKUP → R2                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  Source:  s3://${S3_BUCKET} @ ${S3_ENDPOINT}"
echo "  Dest:   s3://${R2_BUCKET}/backups/sessions/ @ ${R2_ENDPOINT}"
echo "  Mode:   $([ "$DRY_RUN" = true ] && echo 'DRY RUN' || echo 'LIVE')"
[ -n "$PROJECT_FILTER" ] && echo "  Filter: project=${PROJECT_FILTER}"
[ -n "$SINCE_FILTER" ]   && echo "  Since:  ${SINCE_FILTER}"
[ "$LIMIT" -gt 0 ] 2>/dev/null && echo "  Limit:  ${LIMIT} sessions"
echo ""

# ── Helper: run SQL ──────────────────────────────────────────────────────────
run_sql() {
  psql "$DATABASE_URL" -tAX -c "$1"
}

# ── Ensure session_backup_log table ──────────────────────────────────────────
echo "[$(date)] Ensuring session_backup_log table exists..."
run_sql "
CREATE TABLE IF NOT EXISTS session_backup_log (
  session_id    VARCHAR(64) PRIMARY KEY,
  backed_up_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  r2_key_prefix TEXT NOT NULL,
  artifact_count INT NOT NULL DEFAULT 0,
  total_bytes   BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS session_backup_log_backed_up_at_idx ON session_backup_log(backed_up_at);
"

# ── Build eligible-sessions query ────────────────────────────────────────────
# Completed sessions that:
#   1. Have at least one screenshot artifact with status='ready'
#   2. Are NOT already backed up (not in session_backup_log)
#   3. Recordings haven't been deleted or expired

WHERE_CLAUSES="
  s.status IN ('ready', 'completed')
  AND s.recording_deleted = false
  AND s.is_replay_expired = false
  AND EXISTS (
    SELECT 1 FROM recording_artifacts ra
    WHERE ra.session_id = s.id
      AND ra.kind = 'screenshots'
      AND ra.status = 'ready'
  )
  AND NOT EXISTS (
    SELECT 1 FROM session_backup_log bl
    WHERE bl.session_id = s.id
  )
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = s.project_id AND p.deleted_at IS NULL
  )
"

if [ -n "$PROJECT_FILTER" ]; then
  WHERE_CLAUSES="${WHERE_CLAUSES} AND s.project_id = '${PROJECT_FILTER}'"
fi

if [ -n "$SINCE_FILTER" ]; then
  WHERE_CLAUSES="${WHERE_CLAUSES} AND s.started_at >= '${SINCE_FILTER}'::timestamptz"
fi

LIMIT_CLAUSE=""
if [ "$LIMIT" -gt 0 ] 2>/dev/null; then
  LIMIT_CLAUSE="LIMIT ${LIMIT}"
fi

# ── Count eligible sessions ──────────────────────────────────────────────────
TOTAL=$(run_sql "
  SELECT COUNT(*) FROM sessions s WHERE ${WHERE_CLAUSES};
")

echo "[$(date)] Found ${TOTAL} eligible sessions to back up"

if [ "$TOTAL" -eq 0 ]; then
  echo "✅ Nothing to back up. Exiting."
  exit 0
fi

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "🔍 DRY RUN — would back up these sessions:"
  run_sql "
    SELECT s.id, s.project_id, s.started_at::date, s.duration_seconds,
           s.platform, s.device_model,
           (SELECT COUNT(*) FROM recording_artifacts ra WHERE ra.session_id = s.id AND ra.kind = 'screenshots' AND ra.status = 'ready') AS segments
    FROM sessions s
    WHERE ${WHERE_CLAUSES}
    ORDER BY s.started_at ASC
    ${LIMIT_CLAUSE};
  "
  echo ""
  echo "✅ Dry run complete. Re-run without --dry-run to back up."
  exit 0
fi

# ── Process sessions in batches ──────────────────────────────────────────────
BACKED_UP=0
ERRORS=0
TOTAL_BYTES=0

# Cap total to limit if set
if [ "$LIMIT" -gt 0 ] 2>/dev/null && [ "$LIMIT" -lt "$TOTAL" ]; then
  TOTAL=$LIMIT
fi

while [ "$BACKED_UP" -lt "$TOTAL" ] && [ "$ERRORS" -lt 10 ]; do

  # Fetch a batch of session IDs (re-query each batch to skip newly backed up)
  SESSION_IDS=$(run_sql "
    SELECT s.id
    FROM sessions s
    WHERE ${WHERE_CLAUSES}
    ORDER BY s.started_at ASC
    LIMIT ${BATCH_SIZE};
  ")

  if [ -z "$SESSION_IDS" ]; then
    break
  fi

  for SESSION_ID in $SESSION_IDS; do
    if [ "$BACKED_UP" -ge "$TOTAL" ]; then
      break
    fi

    echo ""
    echo "─── Backing up session: ${SESSION_ID} ($(( BACKED_UP + 1 ))/${TOTAL}) ───"

    # ── 0. Get session metadata for path ─────────────────────────────────
    SESSION_META=$(run_sql "
      SELECT s.project_id || '|' || p.name || '|' || s.started_at::date || '|' || COALESCE(s.platform, 'unknown')
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = '${SESSION_ID}';
    ")

    PROJECT_ID=$(echo "$SESSION_META" | cut -d'|' -f1)
    PROJECT_NAME=$(echo "$SESSION_META" | cut -d'|' -f2 | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    SESSION_DATE=$(echo "$SESSION_META" | cut -d'|' -f3)
    PLATFORM=$(echo "$SESSION_META" | cut -d'|' -f4)

    # ── 1. Verify screenshots actually exist on S3 before proceeding ─────
    FIRST_KEY=$(run_sql "
      SELECT s3_object_key FROM recording_artifacts
      WHERE session_id = '${SESSION_ID}' AND kind = 'screenshots' AND status = 'ready'
      LIMIT 1;
    ")

    # HeadObject check — if the file doesn't exist on Hetzner S3, skip
    if ! AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
         AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
         aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
           --bucket "$S3_BUCKET" --key "$FIRST_KEY" > /dev/null 2>&1; then
      echo "  ⏭️  Replay file missing on S3, skipping session ${SESSION_ID}"
      # Mark as backed up with 0 artifacts so we don't re-check every run
      run_sql "
        INSERT INTO session_backup_log (session_id, r2_key_prefix, artifact_count, total_bytes)
        VALUES ('${SESSION_ID}', 'skipped:missing_replay', 0, 0)
        ON CONFLICT (session_id) DO NOTHING;
      "
      BACKED_UP=$((BACKED_UP + 1))
      continue
    fi

    # ── R2 path structure ────────────────────────────────────────────────
    # backups/sessions/{project_name}/{platform}/{YYYY-MM-DD}/{sessionId}/
    R2_PREFIX="backups/sessions/${PROJECT_NAME}/${PLATFORM}/${SESSION_DATE}/${SESSION_ID}"

    # ── 2. Export session + metrics as JSON manifest ─────────────────────
    MANIFEST=$(run_sql "
      SELECT json_build_object(
        'version', '1.0',
        'exportedAt', NOW()::text,
        'session', json_build_object(
          'id', s.id,
          'projectId', s.project_id,
          'deviceId', s.device_id,
          'platform', s.platform,
          'appVersion', s.app_version,
          'deviceModel', s.device_model,
          'osVersion', s.os_version,
          'sdkVersion', s.sdk_version,
          'userDisplayId', s.user_display_id,
          'startedAt', s.started_at::text,
          'endedAt', s.ended_at::text,
          'durationSeconds', s.duration_seconds,
          'backgroundTimeSeconds', s.background_time_seconds,
          'status', s.status,
          'retentionTier', s.retention_tier,
          'retentionDays', s.retention_days,
          'isSampledIn', s.is_sampled_in,
          'replayPromoted', s.replay_promoted,
          'replayPromotedReason', s.replay_promoted_reason,
          'replaySegmentCount', s.replay_segment_count,
          'replayStorageBytes', s.replay_storage_bytes,
          'geoCity', s.geo_city,
          'geoRegion', s.geo_region,
          'geoCountry', s.geo_country,
          'geoCountryCode', s.geo_country_code,
          'geoLatitude', s.geo_latitude,
          'geoLongitude', s.geo_longitude,
          'geoTimezone', s.geo_timezone,
          'eventCount', COALESCE(json_array_length(s.events::json), 0),
          'metadata', s.metadata
        ),
        'metrics', (
          SELECT json_build_object(
            'totalEvents', m.total_events,
            'errorCount', m.error_count,
            'touchCount', m.touch_count,
            'scrollCount', m.scroll_count,
            'gestureCount', m.gesture_count,
            'inputCount', m.input_count,
            'apiSuccessCount', m.api_success_count,
            'apiErrorCount', m.api_error_count,
            'apiTotalCount', m.api_total_count,
            'apiAvgResponseMs', m.api_avg_response_ms,
            'rageTapCount', m.rage_tap_count,
            'deadTapCount', m.dead_tap_count,
            'screensVisited', m.screens_visited,
            'interactionScore', m.interaction_score,
            'explorationScore', m.exploration_score,
            'uxScore', m.ux_score,
            'customEventCount', m.custom_event_count,
            'crashCount', m.crash_count,
            'anrCount', m.anr_count,
            'appStartupTimeMs', m.app_startup_time_ms,
            'networkType', m.network_type,
            'cellularGeneration', m.cellular_generation,
            'isConstrained', m.is_constrained,
            'isExpensive', m.is_expensive,
            'screenshotSegmentCount', m.screenshot_segment_count,
            'screenshotTotalBytes', m.screenshot_total_bytes
          )
          FROM session_metrics m WHERE m.session_id = s.id
        ),
        'artifacts', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', ra.id,
            'kind', ra.kind,
            'sizeBytes', ra.size_bytes,
            'startTime', ra.start_time,
            'endTime', ra.end_time,
            'frameCount', ra.frame_count
          ) ORDER BY ra.start_time NULLS LAST), '[]'::json)
          FROM recording_artifacts ra
          WHERE ra.session_id = s.id AND ra.status = 'ready'
        ),
        'tags', json_build_object(
          'hasErrors', COALESCE((SELECT m.error_count > 0 FROM session_metrics m WHERE m.session_id = s.id), false),
          'hasCrash', COALESCE((SELECT m.crash_count > 0 FROM session_metrics m WHERE m.session_id = s.id), false),
          'hasAnr', COALESCE((SELECT m.anr_count > 0 FROM session_metrics m WHERE m.session_id = s.id), false),
          'hasRageTaps', COALESCE((SELECT m.rage_tap_count > 0 FROM session_metrics m WHERE m.session_id = s.id), false),
          'hasDeadTaps', COALESCE((SELECT m.dead_tap_count > 0 FROM session_metrics m WHERE m.session_id = s.id), false),
          'hasApiErrors', COALESCE((SELECT m.api_error_count > 0 FROM session_metrics m WHERE m.session_id = s.id), false),
          'isPromoted', s.replay_promoted,
          'engagementTier', CASE
            WHEN s.duration_seconds IS NULL OR s.duration_seconds < 10 THEN 'bouncer'
            WHEN s.duration_seconds < 60 THEN 'casual'
            WHEN s.duration_seconds < 300 THEN 'explorer'
            ELSE 'loyalist'
          END,
          'uxScoreBucket', CASE
            WHEN COALESCE((SELECT m.ux_score FROM session_metrics m WHERE m.session_id = s.id), 0) >= 80 THEN 'excellent'
            WHEN COALESCE((SELECT m.ux_score FROM session_metrics m WHERE m.session_id = s.id), 0) >= 60 THEN 'good'
            WHEN COALESCE((SELECT m.ux_score FROM session_metrics m WHERE m.session_id = s.id), 0) >= 40 THEN 'fair'
            ELSE 'poor'
          END
        )
      )::text
      FROM sessions s
      WHERE s.id = '${SESSION_ID}';
    ")

    if [ -z "$MANIFEST" ]; then
      echo "  ⚠️  No data for session ${SESSION_ID}, skipping"
      ERRORS=$((ERRORS + 1))
      continue
    fi

    # ── 3. Upload manifest (gzipped) ─────────────────────────────────────
    MANIFEST_KEY="${R2_PREFIX}/manifest.json.gz"
    echo "  📄 Uploading manifest → ${MANIFEST_KEY}"

    echo "$MANIFEST" | gzip -9 | \
      aws --endpoint-url "$R2_ENDPOINT" s3 cp - \
        "s3://${R2_BUCKET}/${MANIFEST_KEY}" \
        --content-type "application/json" \
        --content-encoding "gzip" 2>&1 || {
      echo "  ❌ Failed to upload manifest for ${SESSION_ID}"
      ERRORS=$((ERRORS + 1))
      continue
    }

    # ── 4. Copy replay segments (Hetzner S3 → R2) ────────────────────────
    ARTIFACT_COUNT=0
    SESSION_BYTES=0

    # Get screenshot artifact S3 keys
    ARTIFACT_KEYS=$(run_sql "
      SELECT s3_object_key || '|' || COALESCE(size_bytes, 0)
      FROM recording_artifacts
      WHERE session_id = '${SESSION_ID}'
        AND kind = 'screenshots'
        AND status = 'ready'
      ORDER BY start_time NULLS LAST;
    ")

    SEGMENT_IDX=0
    for ARTIFACT_ROW in $ARTIFACT_KEYS; do
      S3_KEY=$(echo "$ARTIFACT_ROW" | cut -d'|' -f1)
      ARTIFACT_SIZE=$(echo "$ARTIFACT_ROW" | cut -d'|' -f2)

      SEGMENT_NAME=$(printf "segment_%03d" $SEGMENT_IDX)

      # Determine extension based on original key
      if echo "$S3_KEY" | grep -q '\.gz$'; then
        R2_SEGMENT_KEY="${R2_PREFIX}/replay/${SEGMENT_NAME}.bin.gz"
      else
        R2_SEGMENT_KEY="${R2_PREFIX}/replay/${SEGMENT_NAME}.bin"
      fi

      echo "  📦 Copying segment ${SEGMENT_IDX}: ${S3_KEY}"

      # Verify this specific segment exists before copying
      if ! AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
           AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
           aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
             --bucket "$S3_BUCKET" --key "$S3_KEY" > /dev/null 2>&1; then
        echo "  ⚠️  Segment missing on S3: ${S3_KEY}, skipping"
        continue
      fi

      # Download from Hetzner S3 and re-upload to R2
      AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
      aws --endpoint-url "$S3_ENDPOINT" s3 cp \
        "s3://${S3_BUCKET}/${S3_KEY}" - 2>/dev/null | \
      aws --endpoint-url "$R2_ENDPOINT" s3 cp - \
        "s3://${R2_BUCKET}/${R2_SEGMENT_KEY}" 2>&1 || {
        echo "  ⚠️  Failed to copy segment ${S3_KEY}"
        ERRORS=$((ERRORS + 1))
        continue
      }

      ARTIFACT_COUNT=$((ARTIFACT_COUNT + 1))
      SESSION_BYTES=$((SESSION_BYTES + ARTIFACT_SIZE))
      SEGMENT_IDX=$((SEGMENT_IDX + 1))
    done

    # Skip if no segments were actually copied (all missing)
    if [ "$ARTIFACT_COUNT" -eq 0 ]; then
      echo "  ⏭️  No replay segments could be copied, skipping"
      # Clean up the manifest we already uploaded
      aws --endpoint-url "$R2_ENDPOINT" s3 rm \
        "s3://${R2_BUCKET}/${MANIFEST_KEY}" 2>/dev/null || true
      run_sql "
        INSERT INTO session_backup_log (session_id, r2_key_prefix, artifact_count, total_bytes)
        VALUES ('${SESSION_ID}', 'skipped:no_segments_copied', 0, 0)
        ON CONFLICT (session_id) DO NOTHING;
      "
      BACKED_UP=$((BACKED_UP + 1))
      continue
    fi

    # ── 5. Also copy events artifact if available ────────────────────────
    EVENTS_KEY=$(run_sql "
      SELECT s3_object_key
      FROM recording_artifacts
      WHERE session_id = '${SESSION_ID}'
        AND kind = 'events'
        AND status = 'ready'
      LIMIT 1;
    ")

    if [ -n "$EVENTS_KEY" ]; then
      if AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
         AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
         aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
           --bucket "$S3_BUCKET" --key "$EVENTS_KEY" > /dev/null 2>&1; then
        R2_EVENTS_KEY="${R2_PREFIX}/events/events.json.gz"
        echo "  📋 Copying events artifact"

        if echo "$EVENTS_KEY" | grep -q '\.gz$'; then
          AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
          AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
          aws --endpoint-url "$S3_ENDPOINT" s3 cp \
            "s3://${S3_BUCKET}/${EVENTS_KEY}" - 2>/dev/null | \
          aws --endpoint-url "$R2_ENDPOINT" s3 cp - \
            "s3://${R2_BUCKET}/${R2_EVENTS_KEY}" 2>&1 || {
            echo "  ⚠️  Failed to copy events artifact (non-fatal)"
          }
        else
          AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
          AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
          aws --endpoint-url "$S3_ENDPOINT" s3 cp \
            "s3://${S3_BUCKET}/${EVENTS_KEY}" - 2>/dev/null | \
          gzip -9 | \
          aws --endpoint-url "$R2_ENDPOINT" s3 cp - \
            "s3://${R2_BUCKET}/${R2_EVENTS_KEY}" 2>&1 || {
            echo "  ⚠️  Failed to copy events artifact (non-fatal)"
          }
        fi

        ARTIFACT_COUNT=$((ARTIFACT_COUNT + 1))
      fi
    fi

    # ── 6. Also copy hierarchy snapshots if available ────────────────────
    HIERARCHY_KEY=$(run_sql "
      SELECT s3_object_key
      FROM recording_artifacts
      WHERE session_id = '${SESSION_ID}'
        AND kind = 'hierarchy'
        AND status = 'ready'
      LIMIT 1;
    ")

    if [ -n "$HIERARCHY_KEY" ]; then
      if AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
         AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
         aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
           --bucket "$S3_BUCKET" --key "$HIERARCHY_KEY" > /dev/null 2>&1; then
        R2_HIERARCHY_KEY="${R2_PREFIX}/hierarchy/hierarchy.json.gz"
        echo "  🌳 Copying hierarchy artifact"

        if echo "$HIERARCHY_KEY" | grep -q '\.gz$'; then
          AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
          AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
          aws --endpoint-url "$S3_ENDPOINT" s3 cp \
            "s3://${S3_BUCKET}/${HIERARCHY_KEY}" - 2>/dev/null | \
          aws --endpoint-url "$R2_ENDPOINT" s3 cp - \
            "s3://${R2_BUCKET}/${R2_HIERARCHY_KEY}" 2>&1 || {
            echo "  ⚠️  Failed to copy hierarchy artifact (non-fatal)"
          }
        else
          AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
          AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
          aws --endpoint-url "$S3_ENDPOINT" s3 cp \
            "s3://${S3_BUCKET}/${HIERARCHY_KEY}" - 2>/dev/null | \
          gzip -9 | \
          aws --endpoint-url "$R2_ENDPOINT" s3 cp - \
            "s3://${R2_BUCKET}/${R2_HIERARCHY_KEY}" 2>&1 || {
            echo "  ⚠️  Failed to copy hierarchy artifact (non-fatal)"
          }
        fi

        ARTIFACT_COUNT=$((ARTIFACT_COUNT + 1))
      fi
    fi

    # ── 7. Record in session_backup_log (dedup) ──────────────────────────
    run_sql "
      INSERT INTO session_backup_log (session_id, r2_key_prefix, artifact_count, total_bytes)
      VALUES ('${SESSION_ID}', '${R2_PREFIX}', ${ARTIFACT_COUNT}, ${SESSION_BYTES})
      ON CONFLICT (session_id) DO NOTHING;
    "

    BACKED_UP=$((BACKED_UP + 1))
    TOTAL_BYTES=$((TOTAL_BYTES + SESSION_BYTES))
    echo "  ✅ Backed up (${ARTIFACT_COUNT} artifacts, ~$((SESSION_BYTES / 1024)) KB)"

  done  # end per-session loop
done    # end batch loop

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║       SESSION BACKUP COMPLETE                              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  Sessions backed up: ${BACKED_UP}"
echo "  Errors:             ${ERRORS}"
echo "  Total bytes:        ~$((TOTAL_BYTES / 1024 / 1024)) MB"
echo "  Destination:        s3://${R2_BUCKET}/backups/sessions/"
echo ""
echo "[$(date)] Done."
