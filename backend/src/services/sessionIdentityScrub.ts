import { pool } from '../db/client.js';
import { logger } from '../logger.js';

export const SESSION_IDENTITY_SCRUB_VERSION = 1;

export interface SessionIdentityScrubResult {
    attempted: number;
    scrubbed: number;
    linkedRowsScrubbed: number;
    reachedProcessingCap: boolean;
}

type ScrubbedSessionRow = {
    id: string;
};

function coerceLimit(limit: number): number {
    return Math.max(1, Math.min(Math.trunc(limit), 1000));
}

export async function scrubExpiredSessionIdentitiesBatch(
    limit = 100,
): Promise<SessionIdentityScrubResult> {
    const batchLimit = coerceLimit(limit);

    const result = await pool.query<ScrubbedSessionRow>(
        `
        WITH due AS (
            SELECT s.id
            FROM sessions s
            INNER JOIN projects p ON p.id = s.project_id
            WHERE s.identity_scrubbed_at IS NULL
              AND s.started_at < NOW() - (s.retention_days * INTERVAL '1 day')
              AND p.deleted_at IS NULL
            ORDER BY s.started_at, s.id
            LIMIT $1
            FOR UPDATE OF s SKIP LOCKED
        )
        UPDATE sessions s
        SET
            device_id = NULL,
            user_display_id = NULL,
            anonymous_hash = NULL,
            anonymous_display_id = NULL,
            geo_city = NULL,
            geo_region = NULL,
            geo_latitude = NULL,
            geo_longitude = NULL,
            geo_timezone = NULL,
            events = '[]'::jsonb,
            metadata = '{}'::jsonb,
            raw_events_deleted_at = NOW(),
            identity_scrubbed_at = NOW(),
            identity_scrub_version = $2,
            updated_at = NOW()
        FROM due
        WHERE s.id = due.id
        RETURNING s.id
        `,
        [batchLimit, SESSION_IDENTITY_SCRUB_VERSION],
    );

    const sessionIds = result.rows.map((row) => row.id);
    if (sessionIds.length === 0) {
        return {
            attempted: 0,
            scrubbed: 0,
            linkedRowsScrubbed: 0,
            reachedProcessingCap: false,
        };
    }

    let linkedRowsScrubbed = 0;
    const linkedStatements = [
        `UPDATE crashes SET session_id = NULL, device_metadata = NULL, updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
        `UPDATE anrs SET session_id = NULL, device_metadata = NULL, updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
        `UPDATE errors SET session_id = NULL, updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
        `UPDATE issue_events SET session_id = NULL, user_id = NULL WHERE session_id = ANY($1::varchar[])`,
        `UPDATE issues SET sample_session_id = NULL, updated_at = NOW() WHERE sample_session_id = ANY($1::varchar[])`,
        `UPDATE replay_share_links SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
    ];

    for (const statement of linkedStatements) {
        const linkedResult = await pool.query(statement, [sessionIds]);
        linkedRowsScrubbed += linkedResult.rowCount ?? 0;
    }

    logger.info({
        scrubbed: sessionIds.length,
        linkedRowsScrubbed,
        scrubVersion: SESSION_IDENTITY_SCRUB_VERSION,
    }, 'Scrubbed expired session identities');

    return {
        attempted: sessionIds.length,
        scrubbed: sessionIds.length,
        linkedRowsScrubbed,
        reachedProcessingCap: sessionIds.length >= batchLimit,
    };
}
