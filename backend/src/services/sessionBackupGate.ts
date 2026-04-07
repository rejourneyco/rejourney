import { pool } from '../db/client.js';
import { logger } from '../logger.js';

export async function getBackedUpSessionIds(sessionIds: string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) {
        return new Set();
    }

    try {
        // Require backup log counts to cover every recording_artifacts row (same scope as purge).
        const result = await pool.query<{ session_id: string }>(
            `
            SELECT bl.session_id
            FROM session_backup_log bl
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS artifact_rows
                FROM recording_artifacts ra
                WHERE ra.session_id = bl.session_id
            ) artifact_stats ON true
            WHERE bl.session_id = ANY($1::varchar[])
              AND bl.artifact_count >= COALESCE(artifact_stats.artifact_rows, 0)
              AND bl.planned_artifact_count >= COALESCE(artifact_stats.artifact_rows, 0)
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
