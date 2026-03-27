import { eq } from 'drizzle-orm';
import { db, retentionDeletionLog } from '../db/client.js';

export type RetentionDeletionScope = 'session_purge' | 'legacy_sessions_sweep';
export type RetentionDeletionStatus = 'started' | 'completed' | 'failed' | 'skipped';

export interface RetentionAuditStartParams {
    runId: string;
    scope: RetentionDeletionScope;
    trigger: string;
    storagePrefix: string;
    sessionId?: string | null;
    projectId?: string | null;
    teamId?: string | null;
    plannedArtifactRowCount?: number;
    plannedArtifactBytes?: number;
    plannedIngestJobCount?: number;
    details?: Record<string, unknown>;
    startedAt?: Date;
}

export interface RetentionAuditFinalizeParams {
    status: RetentionDeletionStatus;
    deletedArtifactRowCount?: number;
    deletedIngestJobCount?: number;
    deletedObjectCount?: number;
    deletedBytes?: number;
    storageMissing?: boolean;
    cacheKeyCount?: number;
    details?: Record<string, unknown>;
    errorText?: string | null;
    finishedAt?: Date;
}

export async function beginRetentionDeletionLog(
    params: RetentionAuditStartParams
): Promise<string> {
    const [row] = await db.insert(retentionDeletionLog).values({
        runId: params.runId,
        scope: params.scope,
        status: 'started',
        trigger: params.trigger,
        sessionId: params.sessionId ?? null,
        projectId: params.projectId ?? null,
        teamId: params.teamId ?? null,
        storagePrefix: params.storagePrefix,
        plannedArtifactRowCount: params.plannedArtifactRowCount ?? 0,
        plannedArtifactBytes: params.plannedArtifactBytes ?? 0,
        plannedIngestJobCount: params.plannedIngestJobCount ?? 0,
        details: params.details ?? {},
        startedAt: params.startedAt ?? new Date(),
    }).returning({ id: retentionDeletionLog.id });

    return row.id;
}

export async function finalizeRetentionDeletionLog(
    logId: string,
    params: RetentionAuditFinalizeParams
): Promise<void> {
    await db.update(retentionDeletionLog)
        .set({
            status: params.status,
            deletedArtifactRowCount: params.deletedArtifactRowCount ?? 0,
            deletedIngestJobCount: params.deletedIngestJobCount ?? 0,
            deletedObjectCount: params.deletedObjectCount ?? 0,
            deletedBytes: params.deletedBytes ?? 0,
            storageMissing: params.storageMissing ?? false,
            cacheKeyCount: params.cacheKeyCount ?? 0,
            details: params.details ?? {},
            errorText: params.errorText ?? null,
            finishedAt: params.finishedAt ?? new Date(),
        })
        .where(eq(retentionDeletionLog.id, logId));
}
