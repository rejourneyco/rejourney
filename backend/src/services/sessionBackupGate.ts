import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { buildEmptySessionPredicateSql } from './sessionRetentionEligibility.js';

export async function getBackedUpSessionIds(sessionIds: string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) {
        return new Set();
    }

    try {
        const emptySessionPredicate = buildEmptySessionPredicateSql('s');
        // Require backup log counts to cover every recording_artifacts row, but let
        // truly empty sessions age out without waiting on a backup row.
        // observeOnly sessions (no visual artifacts by design) are also treated as
        // "nothing to archive" — their telemetry lives in the DB, not in R2.
        const result = await pool.query<{ session_id: string }>(
            `
            SELECT s.id AS session_id
            FROM sessions s
            LEFT JOIN session_backup_log bl ON bl.session_id = s.id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS artifact_rows
                FROM recording_artifacts ra
                WHERE ra.session_id = s.id
            ) artifact_stats ON true
            WHERE s.id = ANY($1::varchar[])
              AND (
                (
                    bl.session_id IS NOT NULL
                    AND bl.artifact_count >= COALESCE(artifact_stats.artifact_rows, 0)
                    AND bl.planned_artifact_count >= COALESCE(artifact_stats.artifact_rows, 0)
                )
                OR (
                    ${emptySessionPredicate}
                )
                OR (
                    s.observe_only = true
                )
              )
            `,
            [sessionIds],
        );

        return new Set(result.rows.map((row) => row.session_id));
    } catch (err: any) {
        if (err?.code === '42P01') {
            logger.warn('session_backup_log does not exist yet; retention will skip purge until backup has created it');
            return new Set();
        }

        throw err;
    }
}

export async function partitionBackedUpSessions<T extends { id: string }>(
    rows: T[],
): Promise<{
    backedUp: T[];
    notBackedUp: T[];
}> {
    const backedUpIds = await getBackedUpSessionIds(rows.map((row) => row.id));

    return {
        backedUp: rows.filter((row) => backedUpIds.has(row.id)),
        notBackedUp: rows.filter((row) => !backedUpIds.has(row.id)),
    };
}
