import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { db, sessions } from '../db/client.js';

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
