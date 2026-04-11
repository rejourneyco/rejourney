import { and, asc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { db, sessions } from '../db/client.js';

function visitorIdentityForSession(params: {
    deviceId?: string | null;
    anonymousHash?: string | null;
    userDisplayId?: string | null;
}): string | null {
    const d = params.deviceId?.trim();
    if (d) return d;
    return params.anonymousHash || params.userDisplayId || null;
}

/**
 * True when another session exists for the same project + visitor identity with a strictly later
 * (started_at, id) ordering. Used so stale `last_ingest_activity_at` bumps on an old row do not
 * keep the archive showing LIVE after the user started a newer session.
 */
export async function hasNewerSessionForSameVisitor(params: {
    projectId: string;
    sessionId: string;
    startedAt: Date;
    deviceId?: string | null;
    anonymousHash?: string | null;
    userDisplayId?: string | null;
}): Promise<boolean> {
    const identity = visitorIdentityForSession(params);
    if (!identity) {
        return false;
    }

    const [row] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
            eq(sessions.projectId, params.projectId),
            sql`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId}) = ${identity}`,
            or(
                gt(sessions.startedAt, params.startedAt),
                and(eq(sessions.startedAt, params.startedAt), gt(sessions.id, params.sessionId)),
            ),
        ))
        .limit(1);

    return Boolean(row);
}

/** Earliest later session on the same device+project (timeline fence for ended_at). */
export async function loadSuccessorSessionStartedAt(params: {
    sessionId: string;
    projectId: string;
    deviceId?: string | null;
    startedAt: Date;
}): Promise<Date | null> {
    if (!params.deviceId) {
        return null;
    }

    const [successor] = await db.select({ startedAt: sessions.startedAt })
        .from(sessions)
        .where(and(
            eq(sessions.projectId, params.projectId),
            eq(sessions.deviceId, params.deviceId),
            gt(sessions.startedAt, params.startedAt),
            ne(sessions.id, params.sessionId),
        ))
        .orderBy(asc(sessions.startedAt))
        .limit(1);

    return successor?.startedAt ?? null;
}
