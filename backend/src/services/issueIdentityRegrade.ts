/**
 * One-time re-key of issue events by person (see resolveIssueUserId in
 * issueTracker). Events tracked before the change stored the session's own user id,
 * else its anonymous hash or device id, so a person crashing before and after
 * sign-in counted twice in issues.user_count.
 *
 * For each issue this rewrites issue_events.user_id to the person key of the
 * event's session (skipping identity-scrubbed and deleted sessions, whose events
 * keep their stored value), then recounts issues.user_count. Scrubbed events no
 * longer say who they were, so an issue that has any keeps the share of its stored
 * count they account for (its count minus the distinct identities still visible,
 * taken before the rewrite and kept in Redis so a resumed pass reuses it) and only
 * the visible share is recounted. No other issue field changes.
 *
 * issue_events is written by live ingest, so rows are rewritten 500 at a time in
 * primary-key order, each batch in its own short transaction with a lock timeout;
 * a batch that keeps timing out is skipped and the project is retried next run.
 * Runs inside the stats aggregation lease, one project at a time, and records each
 * finished project in Redis so an interrupted pass resumes where it stopped.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { deviceUserCteSql, deviceUserJoinSql, personKeySql, sessionPersonColumns } from './personIdentity.js';

export const ISSUE_IDENTITY_VERSION = 'person-v1';
const DONE_TTL_SECONDS = 400 * 24 * 60 * 60;
export const ISSUE_EVENT_BATCH_SIZE = 500;
const LOCK_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 250;

const allDoneKey = `stats:issue-identity:${ISSUE_IDENTITY_VERSION}`;
const projectDoneKey = (projectId: string) => `${allDoneKey}:${projectId}`;
const issueOffsetKey = (issueId: string) => `${allDoneKey}:offset:${issueId}`;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class LockTimeoutSkip extends Error {}

function isLockTimeout(err: unknown): boolean {
    const code = (err as { code?: string; cause?: { code?: string } } | null)?.code
        ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
    return code === '55P03';
}

function rowsOf<T>(result: unknown): T[] {
    return ((result as { rows?: T[] })?.rows ?? []) as T[];
}

/**
 * Runs `fn` in a transaction that gives up on row locks after 2s, retrying a few
 * times. Throws LockTimeoutSkip when every attempt timed out.
 */
async function withLockTimeout<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await db.transaction(async (tx) => {
                await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
                await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
                return fn(tx);
            });
        } catch (err) {
            if (!isLockTimeout(err)) throw err;
            if (attempt >= LOCK_ATTEMPTS) throw new LockTimeoutSkip();
            await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt));
        }
    }
}

/** Returns true when every project has been re-keyed (or there is nothing to do). */
export async function regradeIssueIdentity(params: { signal: AbortSignal }): Promise<boolean> {
    const redis = getRedis();
    if (await redis.get(allDoneKey)) return true;

    const projectRows = rowsOf<{ project_id: string }>(await db.execute(sql`
        SELECT DISTINCT project_id FROM issues ORDER BY project_id
    `));
    logger.info({ projectCount: projectRows.length, version: ISSUE_IDENTITY_VERSION }, 'Re-keying issue events by person');

    let complete = true;
    let rowsUpdated = 0;
    for (const { project_id: projectId } of projectRows) {
        if (params.signal.aborted) return false;
        if (await redis.get(projectDoneKey(projectId))) continue;
        const result = await regradeProjectIssues(projectId, params.signal);
        rowsUpdated += result.rowsUpdated;
        if (result.aborted) return false;
        if (result.skippedIssues > 0) {
            complete = false;
            logger.warn({ projectId, skippedIssues: result.skippedIssues }, 'Issue re-key skipped locked rows; will retry');
            continue;
        }
        await redis.set(projectDoneKey(projectId), '1', 'EX', DONE_TTL_SECONDS);
    }

    if (!complete) return false;
    await redis.set(allDoneKey, new Date().toISOString(), 'EX', DONE_TTL_SECONDS);
    logger.info({ projectCount: projectRows.length, rowsUpdated, version: ISSUE_IDENTITY_VERSION }, 'Issue events re-keyed by person');
    return true;
}

async function regradeProjectIssues(
    projectId: string,
    signal: AbortSignal,
): Promise<{ aborted: boolean; skippedIssues: number; rowsUpdated: number }> {
    const issueRows = rowsOf<{ id: string }>(await db.execute(sql`
        SELECT i.id FROM issues i
        WHERE i.project_id = ${projectId}
          AND EXISTS (
              SELECT 1 FROM issue_events e
              WHERE e.issue_id = i.id AND (e.session_id IS NOT NULL OR e.user_id IS NOT NULL)
          )
        ORDER BY i.id
    `));
    let skippedIssues = 0;
    let rowsUpdated = 0;
    for (const { id: issueId } of issueRows) {
        if (signal.aborted) return { aborted: true, skippedIssues, rowsUpdated };
        const result = await regradeIssue(projectId, issueId, signal);
        rowsUpdated += result.rowsUpdated;
        if (result.aborted) return { aborted: true, skippedIssues, rowsUpdated };
        if (result.skipped) skippedIssues += 1;
    }
    return { aborted: false, skippedIssues, rowsUpdated };
}

/** Distinct identities as trackIssue and the alert worker count them. */
const DISTINCT_IDENTITIES_SQL = sql`count(DISTINCT coalesce(e.user_id, e.session_id))`;
/** Events whose identity was scrubbed (both links cleared). */
const UNIDENTIFIED_EVENTS_SQL = sql`count(e.id) FILTER (WHERE e.user_id IS NULL AND e.session_id IS NULL)`;

async function issueOffset(issueId: string): Promise<number | null> {
    const redis = getRedis();
    const stored = await redis.get(issueOffsetKey(issueId));
    if (stored !== null && Number.isFinite(Number(stored))) return Number(stored);

    const [stats] = rowsOf<{ user_count: number | string; identities: number | string }>(await db.execute(sql`
        SELECT i.user_count, ${DISTINCT_IDENTITIES_SQL} AS identities
        FROM issues i LEFT JOIN issue_events e ON e.issue_id = i.id
        WHERE i.id = ${issueId}
        GROUP BY i.id
    `));
    if (!stats) return null;
    const offset = Number(stats.user_count) - Number(stats.identities);
    // NX: a concurrent or earlier pass that already captured the offset wins.
    await redis.set(issueOffsetKey(issueId), String(offset), 'EX', DONE_TTL_SECONDS, 'NX');
    const kept = await redis.get(issueOffsetKey(issueId));
    return kept !== null && Number.isFinite(Number(kept)) ? Number(kept) : offset;
}

async function regradeIssue(
    projectId: string,
    issueId: string,
    signal: AbortSignal,
): Promise<{ aborted: boolean; skipped: boolean; rowsUpdated: number }> {
    const offset = await issueOffset(issueId);
    if (offset === null) return { aborted: false, skipped: false, rowsUpdated: 0 };

    let skipped = false;
    let rowsUpdated = 0;
    let cursor: string | null = null;
    for (;;) {
        if (signal.aborted) return { aborted: true, skipped, rowsUpdated };
        const ids = await nextEventBatch(issueId, cursor);
        if (ids.length === 0) break;
        cursor = ids[ids.length - 1];
        try {
            rowsUpdated += await withLockTimeout((tx) => rekeyEventBatch(tx, projectId, ids));
        } catch (err) {
            if (!(err instanceof LockTimeoutSkip)) throw err;
            // Leave this batch for the next run.
            skipped = true;
        }
    }

    if (signal.aborted) return { aborted: true, skipped, rowsUpdated };
    try {
        await withLockTimeout((tx) => recountIssueUsers(tx, issueId, offset));
    } catch (err) {
        if (!(err instanceof LockTimeoutSkip)) throw err;
        skipped = true;
    }
    // Keep the offset while anything is left so the retry recounts against it.
    if (!skipped) await getRedis().del(issueOffsetKey(issueId));
    return { aborted: false, skipped, rowsUpdated };
}

/** The issue's next event ids after `cursor`, in primary-key order. */
export async function nextEventBatch(issueId: string, cursor: string | null): Promise<string[]> {
    return rowsOf<{ id: string }>(await db.execute(sql`
        SELECT id FROM issue_events
        WHERE issue_id = ${issueId} AND session_id IS NOT NULL
          AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid)
        ORDER BY id
        LIMIT ${ISSUE_EVENT_BATCH_SIZE}
    `)).map((row) => row.id);
}

/** Re-keys the given events to their session's person key; returns the rows changed. */
export async function rekeyEventBatch(tx: Transaction, projectId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    // Nothing identifies the session: keep the stored value (trackIssue counts it by session).
    const columns = { ...sessionPersonColumns('bs'), sessionId: sql`NULL` };
    const result = await tx.execute(sql`
        WITH batch_sessions AS (
            SELECT b.id AS event_id, b.session_id, s.project_id, s.user_display_id, s.device_id, s.anonymous_hash, s.anonymous_display_id
            FROM issue_events b
            JOIN sessions s ON s.id = b.session_id
            WHERE b.id IN (${idList})
              AND s.project_id = ${projectId}
              AND s.identity_scrubbed_at IS NULL
        ),
        device_user AS (${deviceUserCteSql(sql`dus.project_id = ${projectId}
            AND dus.device_id IN (SELECT device_id FROM batch_sessions WHERE device_id IS NOT NULL)`)}),
        keyed AS (
            SELECT bs.event_id, bs.session_id, ${personKeySql(columns, sql`du.user_id`)} AS person
            FROM batch_sessions bs
            LEFT JOIN device_user du ON ${deviceUserJoinSql(columns)}
        )
        UPDATE issue_events e
        SET user_id = keyed.person
        FROM keyed
        WHERE e.id = keyed.event_id
          AND e.session_id = keyed.session_id
          AND keyed.person IS NOT NULL
          AND e.user_id IS DISTINCT FROM keyed.person
    `);
    return (result as { rowCount?: number | null }).rowCount ?? 0;
}

/**
 * Sets the issue's user_count from its events. With every event still identified
 * (none scrubbed, none missing) the count is exact; otherwise the share counted
 * for unidentified events (`offset`) is kept on top of the distinct identities.
 */
export async function recountIssueUsers(tx: Transaction, issueId: string, offset: number): Promise<void> {
    await tx.execute(sql`
        WITH stats AS (
            SELECT ${DISTINCT_IDENTITIES_SQL}::int AS identities,
                   ${UNIDENTIFIED_EVENTS_SQL}::int AS unidentified,
                   count(e.id)::bigint AS event_rows
            FROM issue_events e
            WHERE e.issue_id = ${issueId}
        ),
        recount AS (
            SELECT i.id,
                CASE
                    WHEN stats.unidentified = 0 AND stats.event_rows >= i.event_count THEN stats.identities
                    ELSE greatest(${offset}::int + stats.identities, stats.identities, 1)
                END AS user_count
            FROM issues i, stats
            WHERE i.id = ${issueId} AND stats.event_rows > 0
        )
        UPDATE issues i
        SET user_count = recount.user_count
        FROM recount
        WHERE i.id = recount.id AND i.user_count IS DISTINCT FROM recount.user_count
    `);
}
