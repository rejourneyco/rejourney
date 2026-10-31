/**
 * Retention-based engagement grading (Loyalists / Explorers / Casuals / Bouncers).
 *
 * Every user active on a day is graded once for that day, from their behavior over
 * the trailing 28 days rather than from a single session's length:
 *
 *   Bouncer   no engaged session in the last 28 days (opens the app and leaves).
 *   Loyalist  engaged on 4+ of the last 28 days, the first at least 7 days earlier:
 *             a weekly-or-better habit that has already carried into a second week.
 *   Explorer  engaged and either returned on another day in the window, or spent
 *             3+ minutes in the app that day: evaluating the product, no habit yet.
 *   Casual    engaged on this day only, briefly: a light one-off visit.
 *
 * Sources for the thresholds:
 *   - Engaged session = 10+ seconds or 2+ screens: Google Analytics 4's definition of
 *     an engaged session (the complement of its bounce rate).
 *   - 28-day window and active-day counts: the L28 "power user curve" used by
 *     Facebook and a16z, which grades users by distinct days active per 28.
 *   - 4 days with 7+ days of tenure: weekly usage is the most common natural usage
 *     interval for consumer apps in product-retention research; 4 of 28 days is
 *     that cadence, and requiring the habit to span two weeks separates retained
 *     users from a single burst (e.g. a 3-day trial used on consecutive days).
 *   - Returning on a second day is the earliest retention signal (D1/D7 retention),
 *     so returners grade above one-day visitors.
 *
 * Users are keyed by the canonical visitor identity (device first), the same key the
 * unique-user counts use. Sessions whose identity was scrubbed carry no key and are
 * not graded.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { VISITOR_IDENTITY_SQL } from './visitorLedger.js';

export const ENGAGEMENT_WINDOW_DAYS = 28;
export const ENGAGED_SESSION_MIN_SECONDS = 10;
export const ENGAGED_SESSION_MIN_SCREENS = 2;
export const LOYAL_MIN_ENGAGED_DAYS = 4;
export const LOYAL_MIN_TENURE_DAYS = 7;
export const EXPLORER_MIN_DAY_SECONDS = 180;

export interface EngagementSegmentCounts {
    bouncers: number;
    casuals: number;
    explorers: number;
    loyalists: number;
}

export interface EngagementSegmentDay extends EngagementSegmentCounts {
    /** YYYY-MM-DD (UTC). */
    date: string;
}

export interface UserEngagementFacts {
    /** Distinct days with any session in the window, including the graded day. */
    activeDays: number;
    /** Distinct days with an engaged session in the window. */
    engagedDays: number;
    /** Days between the first engaged day in the window and the graded day; null if none. */
    daysSinceFirstEngaged: number | null;
    /** Total session seconds on the graded day. */
    daySeconds: number;
}

export type EngagementSegment = keyof EngagementSegmentCounts;

/** Reference implementation of the SQL grading below (kept in sync; used by tests). */
export function gradeUserDay(facts: UserEngagementFacts): EngagementSegment {
    if (facts.engagedDays === 0) return 'bouncers';
    if (facts.engagedDays >= LOYAL_MIN_ENGAGED_DAYS && (facts.daysSinceFirstEngaged ?? 0) >= LOYAL_MIN_TENURE_DAYS) {
        return 'loyalists';
    }
    if (facts.activeDays >= 2 || facts.daySeconds >= EXPLORER_MIN_DAY_SECONDS) return 'explorers';
    return 'casuals';
}

const DAY_EPOCH = sql.raw(`date '2000-01-01'`);

/**
 * Daily segment counts for `fromDate`..`toDate` (inclusive, UTC days). Reads sessions
 * from 27 days before `fromDate` so the first day is graded with full history. Only
 * days with at least one graded user are returned.
 */
export async function gradeEngagementByDay(params: {
    projectIds: string[];
    fromDate: string;
    toDate?: string;
    /** Extra predicate on `sessions` (e.g. a platform filter), ANDed in. */
    sessionFilter?: SQL;
}): Promise<EngagementSegmentDay[]> {
    if (params.projectIds.length === 0) return [];
    const historyStart = sql`(${params.fromDate}::date - ${sql.raw(String(ENGAGEMENT_WINDOW_DAYS - 1))})`;
    const rangeEnd = params.toDate ? sql`AND sessions.started_at < (${params.toDate}::date + 1)` : sql``;
    const identity = sql.raw(VISITOR_IDENTITY_SQL);
    const projectList = sql.join(params.projectIds.map((id) => sql`${id}`), sql`, `);

    const result = await db.execute<{
        day: string;
        bouncers: number;
        casuals: number;
        explorers: number;
        loyalists: number;
    }>(sql`
        WITH user_day AS (
            SELECT
                sessions.project_id,
                ${identity} AS user_key,
                (sessions.started_at::date - ${DAY_EPOCH}) AS day_n,
                bool_or(
                    coalesce(sessions.duration_seconds, 0) >= ${ENGAGED_SESSION_MIN_SECONDS}
                    OR coalesce(cardinality(m.screens_visited), 0) >= ${ENGAGED_SESSION_MIN_SCREENS}
                ) AS engaged,
                sum(coalesce(sessions.duration_seconds, 0)) AS day_seconds
            FROM sessions
            LEFT JOIN session_metrics m ON m.session_id = sessions.id
            WHERE sessions.project_id IN (${projectList})
              AND sessions.started_at >= ${historyStart}
              ${rangeEnd}
              ${params.sessionFilter ? sql`AND ${params.sessionFilter}` : sql``}
            GROUP BY 1, 2, 3
        ),
        windowed AS (
            SELECT
                day_n,
                day_seconds,
                count(*) OVER w AS active_days,
                count(*) FILTER (WHERE engaged) OVER w AS engaged_days,
                min(day_n) FILTER (WHERE engaged) OVER w AS first_engaged_n
            FROM user_day
            WHERE user_key IS NOT NULL
            WINDOW w AS (
                PARTITION BY project_id, user_key ORDER BY day_n
                RANGE BETWEEN ${sql.raw(String(ENGAGEMENT_WINDOW_DAYS - 1))} PRECEDING AND CURRENT ROW
            )
        ),
        graded AS (
            SELECT day_n,
                CASE
                    WHEN engaged_days = 0 THEN 'bouncers'
                    WHEN engaged_days >= ${LOYAL_MIN_ENGAGED_DAYS} AND day_n - first_engaged_n >= ${LOYAL_MIN_TENURE_DAYS} THEN 'loyalists'
                    WHEN active_days >= 2 OR day_seconds >= ${EXPLORER_MIN_DAY_SECONDS} THEN 'explorers'
                    ELSE 'casuals'
                END AS segment
            FROM windowed
            WHERE day_n >= (${params.fromDate}::date - ${DAY_EPOCH})
        )
        SELECT
            (${DAY_EPOCH} + day_n)::text AS day,
            cast(count(*) FILTER (WHERE segment = 'bouncers') AS int) AS bouncers,
            cast(count(*) FILTER (WHERE segment = 'casuals') AS int) AS casuals,
            cast(count(*) FILTER (WHERE segment = 'explorers') AS int) AS explorers,
            cast(count(*) FILTER (WHERE segment = 'loyalists') AS int) AS loyalists
        FROM graded
        GROUP BY day_n
        ORDER BY day_n
    `);

    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
        date: String(row.day),
        bouncers: Number(row.bouncers) || 0,
        casuals: Number(row.casuals) || 0,
        explorers: Number(row.explorers) || 0,
        loyalists: Number(row.loyalists) || 0,
    }));
}
