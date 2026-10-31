/**
 * One-time regrade of stored daily rollups to the retention-based engagement
 * segments (services/engagementSegments). Days rolled up before the grading changed
 * hold per-session duration buckets; this rewrites only the four segment columns
 * of those rows, keeping every other metric as stored.
 *
 * Runs inside the stats aggregation lease, one project at a time, and records each
 * finished project in Redis so an interrupted pass resumes where it stopped. Days
 * with identity-scrubbed sessions keep their stored counts because their users can
 * no longer be graded.
 */

import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { db, sessions } from '../db/client.js';
import { getClickHouseClient, isClickHouseConfigured } from '../db/clickhouse.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { gradeEngagementByDay, type EngagementSegmentDay } from './engagementSegments.js';

export const ENGAGEMENT_GRADING_VERSION = 'retention-v1';
const DONE_TTL_SECONDS = 400 * 24 * 60 * 60;
const CHUNK_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

const allDoneKey = `stats:engagement-grading:${ENGAGEMENT_GRADING_VERSION}`;
const projectDoneKey = (projectId: string) => `${allDoneKey}:${projectId}`;

function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Returns true when every project has been regraded (or there is nothing to do). */
export async function regradeEngagementRollups(params: {
    signal: AbortSignal;
    /** Last fully rolled-up day; later days are left to the daily rollup. */
    throughDate: string;
}): Promise<boolean> {
    if (!isClickHouseConfigured()) return true;
    const redis = getRedis();
    if (await redis.get(allDoneKey)) return true;

    const result = await getClickHouseClient().query({
        query: `
            SELECT toString(project_id) AS projectId, toString(min(date)) AS firstDate
            FROM app_daily_rollups
            WHERE date <= {throughDate:Date}
            GROUP BY project_id
        `,
        query_params: { throughDate: params.throughDate },
        format: 'JSONEachRow',
    });
    const projects = await result.json<{ projectId: string; firstDate: string }>();
    logger.info({ projectCount: projects.length, version: ENGAGEMENT_GRADING_VERSION }, 'Regrading engagement rollups');

    for (const project of projects) {
        if (params.signal.aborted) return false;
        if (await redis.get(projectDoneKey(project.projectId))) continue;
        for (let from = project.firstDate; from <= params.throughDate; from = addDays(from, CHUNK_DAYS)) {
            if (params.signal.aborted) return false;
            const to = addDays(from, CHUNK_DAYS - 1) < params.throughDate ? addDays(from, CHUNK_DAYS - 1) : params.throughDate;
            await regradeProjectRange(project.projectId, from, to);
        }
        await redis.set(projectDoneKey(project.projectId), '1', 'EX', DONE_TTL_SECONDS);
    }

    await redis.set(allDoneKey, new Date().toISOString(), 'EX', DONE_TTL_SECONDS);
    logger.info({ projectCount: projects.length, version: ENGAGEMENT_GRADING_VERSION }, 'Engagement rollups regraded');
    return true;
}

async function regradeProjectRange(projectId: string, fromDate: string, toDate: string): Promise<void> {
    const [graded, scrubbedRows] = await Promise.all([
        gradeEngagementByDay({ projectIds: [projectId], fromDate, toDate }),
        db
            .select({ day: sql<string>`(${sessions.startedAt}::date)::text` })
            .from(sessions)
            .where(and(
                eq(sessions.projectId, projectId),
                gte(sessions.startedAt, new Date(`${fromDate}T00:00:00Z`)),
                lt(sessions.startedAt, new Date(Date.parse(`${toDate}T00:00:00Z`) + DAY_MS)),
                isNotNull(sessions.identityScrubbedAt),
            ))
            .groupBy(sql`1`),
    ]);
    const scrubbedDays = new Set(scrubbedRows.map((row) => row.day));
    const days = graded.filter((day) => !scrubbedDays.has(day.date));
    if (days.length === 0) return;
    await writeRegradedSegments(projectId, days);
}

async function writeRegradedSegments(projectId: string, days: EngagementSegmentDay[]): Promise<void> {
    // Copies the latest stored row for each day with only the segment columns
    // replaced; the newer updated_at makes the copy win the ReplacingMergeTree merge.
    const pick = (column: string, values: string) =>
        `if(indexOf({dates:Array(Date)}, date) > 0, {${values}:Array(UInt64)}[indexOf({dates:Array(Date)}, date)], ${column}) AS ${column}`;
    await getClickHouseClient().command({
        query: `
            INSERT INTO app_daily_rollups
            SELECT * REPLACE (
                ${pick('total_bouncers', 'bouncers')},
                ${pick('total_casuals', 'casuals')},
                ${pick('total_explorers', 'explorers')},
                ${pick('total_loyalists', 'loyalists')},
                greatest(now64(3, 'UTC'), updated_at + toIntervalMillisecond(1)) AS updated_at
            )
            FROM app_daily_rollups FINAL
            WHERE project_id = {projectId:UUID} AND date IN {dates:Array(Date)}
        `,
        query_params: {
            projectId,
            dates: days.map((day) => day.date),
            bouncers: days.map((day) => day.bouncers),
            casuals: days.map((day) => day.casuals),
            explorers: days.map((day) => day.explorers),
            loyalists: days.map((day) => day.loyalists),
        },
    });
}
