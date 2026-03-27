import { pool } from '../db/client.js';
import { logger } from '../logger.js';

export async function getBackedUpSessionIds(sessionIds: string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) {
        return new Set();
    }

    try {
        const result = await pool.query<{ session_id: string }>(
            `
            SELECT session_id
            FROM session_backup_log
            WHERE session_id = ANY($1::varchar[])
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
