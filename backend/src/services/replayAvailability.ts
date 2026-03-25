import { sql } from 'drizzle-orm';
import { db, recordingArtifacts } from '../db/client.js';

export function hasSuccessfulRecording(
    session: any,
    _metrics?: any,
    readyScreenshotArtifacts = false
): boolean {
    return Boolean(session?.replayAvailable) || readyScreenshotArtifacts;
}

export async function hasReadyScreenshotArtifacts(sessionId: string): Promise<boolean> {
    const rows = await db
        .select({
            exists: sql<boolean>`exists(
                select 1
                from ${recordingArtifacts}
                where ${recordingArtifacts.sessionId} = ${sessionId}
                  and ${recordingArtifacts.kind} = 'screenshots'
                  and ${recordingArtifacts.status} = 'ready'
            )`,
        })
        .from(recordingArtifacts)
        .limit(1);

    return Boolean(rows[0]?.exists);
}

export const readyScreenshotArtifactsExistsSql = (sessionIdExpr: any) => sql<boolean>`exists(
    select 1
    from ${recordingArtifacts}
    where ${recordingArtifacts.sessionId} = ${sessionIdExpr}
      and ${recordingArtifacts.kind} = 'screenshots'
      and ${recordingArtifacts.status} = 'ready'
)`;

export const readyScreenshotArtifactsConditionSql = (sessionIdExpr: any) => sql`
    coalesce(${readyScreenshotArtifactsExistsSql(sessionIdExpr)}, false)
`;
