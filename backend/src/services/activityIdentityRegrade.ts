/**
 * One-time recount of DAU/MAU snapshots after the person key changed (see
 * activitySnapshots). Snapshots and visitor participation from before the change
 * counted a person twice when their pre-sign-in sessions lacked the user id.
 *
 * Only the last 31 days can be recounted, because older sessions no longer carry
 * identities. Days with identity-scrubbed sessions keep their participation rows
 * and stored counts (the snapshot upsert already refuses incomplete recounts).
 * Runs inside the stats aggregation lease, one project at a time, and records each
 * finished project in Redis so an interrupted pass resumes where it stopped.
 */

import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { db, pool, sessions } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { snapshotActivityDay } from './activitySnapshots.js';

export const ACTIVITY_IDENTITY_VERSION = 'person-v1';
const DONE_TTL_SECONDS = 60 * 24 * 60 * 60;
const WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

const allDoneKey = `stats:activity-identity:${ACTIVITY_IDENTITY_VERSION}`;
const projectDoneKey = (projectId: string) => `${allDoneKey}:${projectId}`;

function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Returns true when every project has been recounted (or there is nothing to do). */
export async function regradeActivityIdentity(params: {
    signal: AbortSignal;
    /** Last fully rolled-up day; later days are left to the daily rollup. */
    throughDate: string;
}): Promise<boolean> {
    const redis = getRedis();
    if (await redis.get(allDoneKey)) return true;

    const fromDate = addDays(new Date().toISOString().slice(0, 10), -WINDOW_DAYS + 1);
    if (fromDate > params.throughDate) return true;
    const projectRows = await db
        .select({ projectId: sessions.projectId })
        .from(sessions)
        .where(and(
            gte(sessions.startedAt, new Date(`${fromDate}T00:00:00Z`)),
            lt(sessions.startedAt, new Date(Date.parse(`${params.throughDate}T00:00:00Z`) + DAY_MS)),
        ))
        .groupBy(sessions.projectId);
    logger.info({ projectCount: projectRows.length, fromDate, throughDate: params.throughDate }, 'Recounting activity snapshots by person');

    for (const { projectId } of projectRows) {
        if (params.signal.aborted) return false;
        if (await redis.get(projectDoneKey(projectId))) continue;
        const scrubbedDays = new Set((await db
            .select({ day: sql<string>`(${sessions.startedAt}::date)::text` })
            .from(sessions)
            .where(and(
                eq(sessions.projectId, projectId),
                gte(sessions.startedAt, new Date(`${fromDate}T00:00:00Z`)),
                isNotNull(sessions.identityScrubbedAt),
            ))
            .groupBy(sql`1`)).map((row) => row.day));

        for (let date = fromDate; date <= params.throughDate; date = addDays(date, 1)) {
            if (params.signal.aborted) return false;
            if (!scrubbedDays.has(date)) {
                await pool.query('DELETE FROM visitor_activity_days WHERE project_id = $1 AND date = $2::date', [projectId, date]);
            }
            await snapshotActivityDay(projectId, date);
        }
        await redis.set(projectDoneKey(projectId), '1', 'EX', DONE_TTL_SECONDS);
    }

    await redis.set(allDoneKey, new Date().toISOString(), 'EX', DONE_TTL_SECONDS);
    logger.info({ projectCount: projectRows.length }, 'Activity snapshots recounted by person');
    return true;
}
