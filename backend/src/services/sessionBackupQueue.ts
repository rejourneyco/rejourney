import { pool } from '../db/client.js';
import { logger } from '../logger.js';

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

    try {
        const result = await pool.query<{ session_id: string }>(
            `
            INSERT INTO session_backup_queue (
                session_id,
                status,
                attempts,
                next_retry_at,
                created_at,
                updated_at
            )
            SELECT
                s.id,
                'pending',
                0,
                NOW(),
                NOW(),
                NOW()
            FROM sessions s
            JOIN projects p ON p.id = s.project_id
            JOIN LATERAL (
                SELECT COUNT(*)::int AS ready_artifact_count
                FROM recording_artifacts ra
                WHERE ra.session_id = s.id
                  AND ra.status = 'ready'
            ) artifact_stats ON true
            LEFT JOIN session_backup_log bl ON bl.session_id = s.id
            WHERE s.id = $1
              AND s.status IN ('ready', 'completed')
              AND s.ended_at IS NOT NULL
              AND p.deleted_at IS NULL
              AND artifact_stats.ready_artifact_count > 0
              AND (
                bl.session_id IS NULL
                OR bl.artifact_count < artifact_stats.ready_artifact_count
                OR bl.planned_artifact_count < artifact_stats.ready_artifact_count
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
