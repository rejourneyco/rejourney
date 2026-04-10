import { pool } from '../db/client.js';
import { logger } from '../logger.js';

function buildMeaningfulSessionMetricsPredicateSql(metricsAlias: string): string {
    return `
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
}

function buildEmptySessionPredicateSql(sessionAlias = 's'): string {
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
            AND (
                CASE
                    WHEN ${sessionAlias}.events IS NULL THEN 0
                    WHEN jsonb_typeof(${sessionAlias}.events) = 'array' THEN jsonb_array_length(${sessionAlias}.events)
                    ELSE 0
                END
            ) = 0
            AND COALESCE(${sessionAlias}.metadata, '{}'::jsonb) = '{}'::jsonb
            AND NOT EXISTS (
                SELECT 1
                FROM session_metrics sm
                WHERE sm.session_id = ${sessionAlias}.id
                  AND (
                    ${buildMeaningfulSessionMetricsPredicateSql('sm')}
                  )
            )
`.trim();
}

function isMissingBackupQueueTableError(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '42P01');
}

/**
 * Queue a finalized session for archival backup if it is still eligible and has
 * not already been completed in session_backup_log.
 */
export async function enqueueSessionBackupCandidate(sessionId: string): Promise<boolean> {
    if (!sessionId) {
        return false;
    }

    const emptySessionPredicate = buildEmptySessionPredicateSql('s');

    try {
        const result = await pool.query<{ session_id: string }>(
            `
            INSERT INTO session_backup_queue (
                session_id,
                status,
                attempts,
                created_at,
                updated_at
            )
            SELECT
                s.id,
                'pending',
                0,
                NOW(),
                NOW()
            FROM sessions s
            JOIN projects p ON p.id = s.project_id
            WHERE s.id = $1
              AND s.status IN ('ready', 'completed')
              AND p.deleted_at IS NULL
              AND NOT (
                ${emptySessionPredicate}
              )
              AND NOT EXISTS (
                SELECT 1
                FROM session_backup_log bl
                WHERE bl.session_id = s.id
              )
            ON CONFLICT (session_id) DO NOTHING
            RETURNING session_id
            `,
            [sessionId],
        );

        return result.rows.length > 0;
    } catch (err) {
        if (isMissingBackupQueueTableError(err)) {
            logger.warn('session_backup_queue does not exist yet; backup enqueue skipped until migration has run');
            return false;
        }

        throw err;
    }
}
