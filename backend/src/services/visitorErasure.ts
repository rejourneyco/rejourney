/**
 * Per-visitor erasure (GDPR Article 17).
 *
 * Given a raw device or user identifier for one project, this removes everything
 * that could single the visitor out: the pseudonymous project_visitors row, the
 * replay artifacts of every still-identifiable session, and the identity columns
 * on those sessions (via the same scrub the retention worker uses). Aggregate
 * counters that contain no identifier are left untouched.
 *
 * Work is capped per call so very active visitors are drained by repeated calls;
 * the response reports how many sessions still match.
 */

import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { purgeSessionArtifacts } from './sessionArtifactPurge.js';
import { scrubSessionIdentityRows } from './sessionIdentityScrub.js';
import { computeVisitorKey } from './visitorLedger.js';

export const VISITOR_ERASURE_MAX_SESSIONS_PER_CALL = 500;
const ERASURE_SCRUB_CHUNK = 100;

export interface EraseVisitorParams {
    projectId: string;
    /** Raw device id, anonymous id, or user id as the SDK reported it. */
    identity: string;
    runId?: string;
    trigger?: string;
    maxSessions?: number;
}

export interface EraseVisitorResult {
    visitorKey: string;
    ledgerRowsDeleted: number;
    sessionsMatched: number;
    sessionsScrubbed: number;
    artifactsPurged: number;
    artifactPurgeFailures: number;
    /** Sessions still matching after this call (0 means the visitor is fully erased). */
    remaining: number;
}

async function countMatchingSessions(projectId: string, identity: string, visitorKey: string): Promise<number> {
    const result = await pool.query<{ count: number | string }>(
        `
        SELECT count(*)::int AS count
        FROM sessions
        WHERE project_id = $1
          AND identity_scrubbed_at IS NULL
          AND (
              visitor_key = $2
              OR device_id = $3
              OR anonymous_hash = $3
              OR anonymous_display_id = $3
              OR user_display_id = $3
          )
        `,
        [projectId, visitorKey, identity],
    );
    return Number(result.rows[0]?.count ?? 0);
}

async function selectMatchingSessionIds(
    projectId: string,
    identity: string,
    visitorKey: string,
    limit: number,
): Promise<string[]> {
    const result = await pool.query<{ id: string }>(
        `
        SELECT id
        FROM sessions
        WHERE project_id = $1
          AND identity_scrubbed_at IS NULL
          AND (
              visitor_key = $2
              OR device_id = $3
              OR anonymous_hash = $3
              OR anonymous_display_id = $3
              OR user_display_id = $3
          )
        ORDER BY started_at, id
        LIMIT $4
        `,
        [projectId, visitorKey, identity, limit],
    );
    return result.rows.map((row) => row.id);
}

export async function eraseVisitor(params: EraseVisitorParams): Promise<EraseVisitorResult> {
    const identity = params.identity.trim();
    if (!identity) {
        throw new Error('Visitor identity is required');
    }

    const runId = params.runId ?? `visitor_erasure:${Date.now()}`;
    const trigger = params.trigger ?? 'visitor_erasure';
    const maxSessions = Math.max(1, Math.min(Math.trunc(params.maxSessions ?? VISITOR_ERASURE_MAX_SESSIONS_PER_CALL), 5000));
    const visitorKey = computeVisitorKey(params.projectId, identity);

    // 1. Forget the pseudonymous ledger row first so a concurrent ingest cannot extend it.
    const ledgerResult = await pool.query(
        `DELETE FROM project_visitors WHERE project_id = $1 AND visitor_key = $2`,
        [params.projectId, visitorKey],
    );
    const ledgerRowsDeleted = ledgerResult.rowCount ?? 0;

    // 2. Purge replay media and scrub identity on every matching session.
    const sessionsMatched = await countMatchingSessions(params.projectId, identity, visitorKey);
    const sessionIds = await selectMatchingSessionIds(params.projectId, identity, visitorKey, maxSessions);

    let artifactsPurged = 0;
    let artifactPurgeFailures = 0;
    for (const sessionId of sessionIds) {
        try {
            await purgeSessionArtifacts(sessionId, {
                runId,
                trigger,
                allowMissingStorage: true,
                failOnMissingStorage: false,
            });
            artifactsPurged += 1;
        } catch (err) {
            artifactPurgeFailures += 1;
            logger.warn({ err, sessionId, projectId: params.projectId }, 'Visitor erasure: artifact purge failed; identity scrub continues');
        }
    }

    let sessionsScrubbed = 0;
    for (let offset = 0; offset < sessionIds.length; offset += ERASURE_SCRUB_CHUNK) {
        const chunk = sessionIds.slice(offset, offset + ERASURE_SCRUB_CHUNK);
        const scrubResult = await scrubSessionIdentityRows(chunk, { runId, trigger });
        sessionsScrubbed += scrubResult.scrubbed;
    }

    const remaining = await countMatchingSessions(params.projectId, identity, visitorKey);

    logger.info({
        projectId: params.projectId,
        runId,
        ledgerRowsDeleted,
        sessionsMatched,
        sessionsScrubbed,
        artifactsPurged,
        artifactPurgeFailures,
        remaining,
    }, 'Visitor erased');

    return {
        visitorKey,
        ledgerRowsDeleted,
        sessionsMatched,
        sessionsScrubbed,
        artifactsPurged,
        artifactPurgeFailures,
        remaining,
    };
}
