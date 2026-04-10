const MEANINGFUL_SESSION_METRICS_PREDICATE_BY_ALIAS = (metricsAlias: string) => `
COALESCE(${metricsAlias}.total_events, 0) > 0
                    OR COALESCE(${metricsAlias}.error_count, 0) > 0
                    OR COALESCE(${metricsAlias}.touch_count, 0) > 0
                    OR COALESCE(${metricsAlias}.scroll_count, 0) > 0
                    OR COALESCE(${metricsAlias}.gesture_count, 0) > 0
                    OR COALESCE(${metricsAlias}.input_count, 0) > 0
                    OR COALESCE(${metricsAlias}.api_success_count, 0) > 0
                    OR COALESCE(${metricsAlias}.api_error_count, 0) > 0
                    OR COALESCE(${metricsAlias}.api_total_count, 0) > 0
                    OR COALESCE(${metricsAlias}.rage_tap_count, 0) > 0
                    OR COALESCE(${metricsAlias}.dead_tap_count, 0) > 0
                    OR COALESCE(array_length(${metricsAlias}.screens_visited, 1), 0) > 0
                    OR COALESCE(${metricsAlias}.interaction_score, 0) > 0
                    OR COALESCE(${metricsAlias}.exploration_score, 0) > 0
                    OR COALESCE(${metricsAlias}.ux_score, 0) > 0
                    OR COALESCE(${metricsAlias}.events_size_bytes, 0) > 0
                    OR COALESCE(${metricsAlias}.custom_event_count, 0) > 0
                    OR COALESCE(${metricsAlias}.crash_count, 0) > 0
                    OR COALESCE(${metricsAlias}.anr_count, 0) > 0
                    OR COALESCE(${metricsAlias}.app_startup_time_ms, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_upload_success_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_upload_failure_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_retry_attempt_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_circuit_breaker_open_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_memory_eviction_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_offline_persist_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_upload_success_rate, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_avg_upload_duration_ms, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_total_bytes_uploaded, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_total_bytes_evicted, 0) > 0
                    OR COALESCE(${metricsAlias}.hierarchy_snapshot_count, 0) > 0
                    OR COALESCE(${metricsAlias}.screenshot_segment_count, 0) > 0
                    OR COALESCE(${metricsAlias}.screenshot_total_bytes, 0) > 0
`.trim();

function buildJsonArrayLengthExpr(sessionAlias: string): string {
    return `
CASE
                    WHEN ${sessionAlias}.events IS NULL THEN 0
                    WHEN jsonb_typeof(${sessionAlias}.events) = 'array' THEN jsonb_array_length(${sessionAlias}.events)
                    ELSE 0
                END
`.trim();
}

/**
 * Empty sessions are safe to skip from archive backup because they have no
 * artifacts, no queued ingest work, no replay state, and no meaningful payload
 * metrics beyond lifecycle timestamps.
 */
export function buildEmptySessionPredicateSql(sessionAlias = 's'): string {
    const metricsAlias = 'sm';
    const meaningfulMetricsPredicate = MEANINGFUL_SESSION_METRICS_PREDICATE_BY_ALIAS(metricsAlias);
    const jsonArrayLengthExpr = buildJsonArrayLengthExpr(sessionAlias);

    return `
NOT EXISTS (
                SELECT 1
                FROM recording_artifacts ra
                WHERE ra.session_id = ${sessionAlias}.id
            )
            AND NOT EXISTS (
                SELECT 1
                FROM ingest_jobs ij
                WHERE ij.session_id = ${sessionAlias}.id
            )
            AND COALESCE(${sessionAlias}.replay_available, false) = false
            AND COALESCE(${sessionAlias}.replay_segment_count, 0) = 0
            AND COALESCE(${sessionAlias}.replay_storage_bytes, 0) = 0
            AND ${jsonArrayLengthExpr} = 0
            AND COALESCE(${sessionAlias}.metadata, '{}'::jsonb) = '{}'::jsonb
            AND NOT EXISTS (
                SELECT 1
                FROM session_metrics ${metricsAlias}
                WHERE ${metricsAlias}.session_id = ${sessionAlias}.id
                  AND (
                    ${meaningfulMetricsPredicate}
                  )
            )
`.trim();
}
