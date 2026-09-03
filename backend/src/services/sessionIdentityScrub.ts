import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { beginRetentionDeletionLog, finalizeRetentionDeletionLog } from './retentionAudit.js';

export const SESSION_IDENTITY_SCRUB_VERSION = 1;

export interface SessionIdentityScrubResult {
    attempted: number;
    scrubbed: number;
    linkedRowsScrubbed: number;
    reachedProcessingCap: boolean;
}

export interface SessionIdentityScrubOptions {
    /** Retention run id for the audit row; defaults to a timestamped id. */
    runId?: string;
    /** Audit trigger label; defaults to 'identity_scrub'. */
    trigger?: string;
}

type ScrubbedSessionRow = {
    id: string;
};

function coerceLimit(limit: number): number {
    return Math.max(1, Math.min(Math.trunc(limit), 1000));
}

/**
 * Column assignments applied to a session row when its identity is scrubbed.
 * visitor_session_ordinal is deliberately kept: a small integer cannot re-link
 * sessions, and it is what keeps "new user" honest after the scrub.
 */
const SESSION_IDENTITY_SCRUB_SET_SQL = `
            device_id = NULL,
            user_display_id = NULL,
            anonymous_hash = NULL,
            anonymous_display_id = NULL,
            visitor_key = NULL,
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
            updated_at = NOW()`;

const LINKED_IDENTITY_SCRUB_STATEMENTS = [
    `UPDATE crashes SET session_id = NULL, device_metadata = NULL, updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
    `UPDATE anrs SET session_id = NULL, device_metadata = NULL, updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
    `UPDATE errors SET session_id = NULL, updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
    `UPDATE issue_events SET session_id = NULL, user_id = NULL WHERE session_id = ANY($1::varchar[])`,
    `UPDATE issues SET sample_session_id = NULL, updated_at = NOW() WHERE sample_session_id = ANY($1::varchar[])`,
    `UPDATE replay_share_links SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW() WHERE session_id = ANY($1::varchar[])`,
];

async function scrubLinkedRowsForSessions(sessionIds: string[]): Promise<number> {
    let linkedRowsScrubbed = 0;
    for (const statement of LINKED_IDENTITY_SCRUB_STATEMENTS) {
        const linkedResult = await pool.query(statement, [sessionIds]);
        linkedRowsScrubbed += linkedResult.rowCount ?? 0;
    }
    return linkedRowsScrubbed;
}

async function recordIdentityScrubAudit(
    scope: 'identity_scrub' | 'visitor_erasure',
    options: SessionIdentityScrubOptions | undefined,
    details: Record<string, unknown>,
): Promise<void> {
    try {
        const logId = await beginRetentionDeletionLog({
            runId: options?.runId ?? `${scope}:${Date.now()}`,
            scope,
            trigger: options?.trigger ?? scope,
            storagePrefix: 'n/a',
            details,
        });
        await finalizeRetentionDeletionLog(logId, { status: 'completed', details });
    } catch (err) {
        logger.warn({ err, scope, details }, 'Failed to write identity scrub audit row');
    }
}

/**
 * Scrub identity on an explicit list of sessions (erasure path). Sessions that
 * are already scrubbed are skipped. Linked crash/ANR/error/issue rows are detached
 * exactly as in the batch path.
 */
export async function scrubSessionIdentityRows(
    sessionIds: string[],
    options?: SessionIdentityScrubOptions,
): Promise<SessionIdentityScrubResult> {
    const ids = [...new Set(sessionIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) {
        return { attempted: 0, scrubbed: 0, linkedRowsScrubbed: 0, reachedProcessingCap: false };
    }

    const result = await pool.query<ScrubbedSessionRow>(
        `
        UPDATE sessions s
        SET ${SESSION_IDENTITY_SCRUB_SET_SQL}
        WHERE s.id = ANY($1::varchar[])
          AND s.identity_scrubbed_at IS NULL
        RETURNING s.id
        `,
        [ids, SESSION_IDENTITY_SCRUB_VERSION],
    );

    const scrubbedIds = result.rows.map((row) => row.id);
    if (scrubbedIds.length === 0) {
        return { attempted: ids.length, scrubbed: 0, linkedRowsScrubbed: 0, reachedProcessingCap: false };
    }

    const linkedRowsScrubbed = await scrubLinkedRowsForSessions(scrubbedIds);
    await recordIdentityScrubAudit('visitor_erasure', options, {
        scrubbed: scrubbedIds.length,
        linkedRowsScrubbed,
        scrubVersion: SESSION_IDENTITY_SCRUB_VERSION,
    });

    return {
        attempted: ids.length,
        scrubbed: scrubbedIds.length,
        linkedRowsScrubbed,
        reachedProcessingCap: false,
    };
}

export async function scrubExpiredSessionIdentitiesBatch(
    limit = 100,
    options?: SessionIdentityScrubOptions,
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
        SET ${SESSION_IDENTITY_SCRUB_SET_SQL}
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

    const linkedRowsScrubbed = await scrubLinkedRowsForSessions(sessionIds);

    logger.info({
        scrubbed: sessionIds.length,
        linkedRowsScrubbed,
        scrubVersion: SESSION_IDENTITY_SCRUB_VERSION,
    }, 'Scrubbed expired session identities');

    await recordIdentityScrubAudit('identity_scrub', options, {
        scrubbed: sessionIds.length,
        linkedRowsScrubbed,
        scrubVersion: SESSION_IDENTITY_SCRUB_VERSION,
        batchLimit,
    });

    return {
        attempted: sessionIds.length,
        scrubbed: sessionIds.length,
        linkedRowsScrubbed,
        reachedProcessingCap: sessionIds.length >= batchLimit,
    };
}
