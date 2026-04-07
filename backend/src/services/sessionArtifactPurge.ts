import { eq, or } from 'drizzle-orm';
import {
    db,
    ingestJobs,
    projects,
    recordingArtifacts,
    sessionMetrics,
    sessions,
} from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { deletePrefixFromProjectStorage } from '../db/s3.js';
import { logger } from '../logger.js';
import {
    beginRetentionDeletionLog,
    finalizeRetentionDeletionLog,
} from './retentionAudit.js';
import { partitionBackedUpSessions } from './sessionBackupGate.js';

const FRAME_CACHE_PREFIX = 'screenshot_frames:';
const FRAME_DATA_CACHE_PREFIX = 'screenshot_frame_data:';
const SESSION_CORE_CACHE_PREFIX = 'session_core:';
const SESSION_TIMELINE_CACHE_PREFIX = 'session_timeline:';
const SESSION_HIERARCHY_CACHE_PREFIX = 'session_hierarchy:';

type SessionArtifactRecord = {
    id: string;
    kind: string;
    s3ObjectKey: string;
    endpointId: string | null;
    sizeBytes: number | null;
    declaredSizeBytes: number | null;
};

type SessionJobRecord = {
    id: string;
};

type SessionPurgeContext = {
    sessionId: string;
    projectId: string;
    teamId: string;
    retentionTier: number;
    retentionDays: number;
    recordingDeleted: boolean;
    isReplayExpired: boolean;
    artifacts: SessionArtifactRecord[];
    jobs: SessionJobRecord[];
};

export interface PurgeSessionArtifactsOptions {
    runId: string;
    trigger: string;
    now?: Date;
    invalidateCaches?: boolean;
    allowMissingStorage?: boolean;
    retentionTier?: number | null;
    retentionDays?: number | null;
}

export interface PurgeSessionArtifactsResult {
    sessionId: string;
    projectId: string;
    teamId: string;
    deletedArtifactCount: number;
    deletedJobCount: number;
    deletedObjectCount: number;
    deletedBytes: number;
    plannedArtifactCount: number;
    plannedArtifactBytes: number;
    plannedJobCount: number;
    cacheKeyCount: number;
    storageMissing: boolean;
}

export interface ExpiredSessionArtifactRepairResult {
    attempted: number;
    repaired: number;
    failed: number;
    skippedNotBackedUp: number;
    deletedObjectCount: number;
    deletedBytes: number;
}

export function buildCanonicalSessionStoragePrefix(
    teamId: string,
    projectId: string,
    sessionId: string,
): string {
    return `tenant/${teamId}/project/${projectId}/sessions/${sessionId}/`;
}

async function invalidatePurgedSessionCaches(sessionId: string): Promise<number> {
    try {
        const redis = getRedis();
        await redis.del(
            `${SESSION_CORE_CACHE_PREFIX}${sessionId}`,
            `${SESSION_TIMELINE_CACHE_PREFIX}${sessionId}`,
            `${SESSION_HIERARCHY_CACHE_PREFIX}${sessionId}`,
            `${FRAME_CACHE_PREFIX}${sessionId}`,
        );

        const keysToDelete: string[] = [];
        let cursor = '0';
        do {
            const [next, keys] = await redis.scan(
                cursor,
                'MATCH',
                `${FRAME_DATA_CACHE_PREFIX}${sessionId}:*`,
                'COUNT',
                200,
            );
            cursor = next;
            keysToDelete.push(...keys);
        } while (cursor !== '0');

        if (keysToDelete.length > 0) {
            await redis.del(...keysToDelete);
        }

        return 4 + keysToDelete.length;
    } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to invalidate purged session caches');
        return 0;
    }
}

async function loadSessionPurgeContext(sessionId: string): Promise<SessionPurgeContext> {
    const [sessionResult] = await db
        .select({
            sessionId: sessions.id,
            projectId: sessions.projectId,
            teamId: projects.teamId,
            retentionTier: sessions.retentionTier,
            retentionDays: sessions.retentionDays,
            recordingDeleted: sessions.recordingDeleted,
            isReplayExpired: sessions.isReplayExpired,
        })
        .from(sessions)
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        throw new Error(`Session not found: ${sessionId}`);
    }

    const [artifacts, jobs] = await Promise.all([
        db.select({
            id: recordingArtifacts.id,
            kind: recordingArtifacts.kind,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
            sizeBytes: recordingArtifacts.sizeBytes,
            declaredSizeBytes: recordingArtifacts.declaredSizeBytes,
        })
            .from(recordingArtifacts)
            .where(eq(recordingArtifacts.sessionId, sessionId)),
        db.select({ id: ingestJobs.id })
            .from(ingestJobs)
            .where(eq(ingestJobs.sessionId, sessionId)),
    ]);

    return {
        ...sessionResult,
        artifacts,
        jobs,
    };
}

function buildEndpointBreakdown(details: {
    endpointId: string;
    endpointUrl: string;
    projectId: string | null;
    shadow: boolean;
    active: boolean;
    deletedObjectCount: number;
    deletedBytes: number;
}[]): Record<string, unknown>[] {
    return details.map((result) => ({
        endpointId: result.endpointId,
        endpointUrl: result.endpointUrl,
        projectId: result.projectId,
        shadow: result.shadow,
        active: result.active,
        deletedObjectCount: result.deletedObjectCount,
        deletedBytes: result.deletedBytes,
    }));
}

export async function purgeSessionArtifacts(
    sessionId: string,
    options: PurgeSessionArtifactsOptions,
): Promise<PurgeSessionArtifactsResult> {
    const now = options.now ?? new Date();
    const invalidateCaches = options.invalidateCaches ?? true;
    const allowMissingStorage = options.allowMissingStorage ?? false;
    const context = await loadSessionPurgeContext(sessionId);
    let finalizedLog = false;
    const canonicalPrefix = buildCanonicalSessionStoragePrefix(
        context.teamId,
        context.projectId,
        context.sessionId,
    );
    const plannedArtifactBytes = context.artifacts.reduce(
        (total, artifact) => total + Number(artifact.sizeBytes ?? artifact.declaredSizeBytes ?? 0),
        0,
    );

    const logId = await beginRetentionDeletionLog({
        runId: options.runId,
        scope: 'session_purge',
        trigger: options.trigger,
        sessionId: context.sessionId,
        projectId: context.projectId,
        teamId: context.teamId,
        storagePrefix: canonicalPrefix,
        plannedArtifactRowCount: context.artifacts.length,
        plannedArtifactBytes,
        plannedIngestJobCount: context.jobs.length,
        details: {
            retentionTier: options.retentionTier ?? context.retentionTier,
            retentionDays: options.retentionDays ?? context.retentionDays,
        },
        startedAt: now,
    });

    const invalidArtifacts = context.artifacts
        .filter((artifact) => !artifact.s3ObjectKey.startsWith(canonicalPrefix))
        .map((artifact) => ({
            artifactId: artifact.id,
            kind: artifact.kind,
            s3ObjectKey: artifact.s3ObjectKey,
        }));

    if (invalidArtifacts.length > 0) {
        await finalizeRetentionDeletionLog(logId, {
            status: 'failed',
            errorText: 'Found recording_artifacts outside the canonical session prefix',
            details: {
                retentionTier: options.retentionTier ?? context.retentionTier,
                retentionDays: options.retentionDays ?? context.retentionDays,
                invalidArtifacts,
            },
            finishedAt: now,
        });
        finalizedLog = true;
        throw new Error(`Session ${sessionId} has recording_artifacts outside the canonical prefix`);
    }

    try {
        const deletionResult = await deletePrefixFromProjectStorage(
            context.projectId,
            canonicalPrefix,
            context.artifacts.map((artifact) => artifact.endpointId),
        );
        const storageMissing = context.artifacts.length > 0 && deletionResult.deletedObjectCount === 0;

        if (storageMissing && !allowMissingStorage) {
            await finalizeRetentionDeletionLog(logId, {
                status: 'failed',
                deletedObjectCount: deletionResult.deletedObjectCount,
                deletedBytes: deletionResult.deletedBytes,
                storageMissing: true,
                errorText: 'Canonical storage scan found no objects for a session that still has recording_artifacts',
                details: {
                    retentionTier: options.retentionTier ?? context.retentionTier,
                    retentionDays: options.retentionDays ?? context.retentionDays,
                    endpointResults: buildEndpointBreakdown(deletionResult.endpointResults),
                },
            });
            finalizedLog = true;
            throw new Error(`Canonical storage missing for session ${sessionId}`);
        }

        let deletedJobCount = 0;
        let deletedArtifactCount = 0;
        await db.transaction(async (tx) => {
            const deletedJobs = await tx
                .delete(ingestJobs)
                .where(eq(ingestJobs.sessionId, context.sessionId))
                .returning({ id: ingestJobs.id });
            const deletedArtifacts = await tx
                .delete(recordingArtifacts)
                .where(eq(recordingArtifacts.sessionId, context.sessionId))
                .returning({ id: recordingArtifacts.id });

            deletedJobCount = deletedJobs.length;
            deletedArtifactCount = deletedArtifacts.length;

            await tx.update(sessionMetrics)
                .set({
                    screenshotSegmentCount: 0,
                    screenshotTotalBytes: 0,
                    hierarchySnapshotCount: 0,
                })
                .where(eq(sessionMetrics.sessionId, context.sessionId));

            await tx.update(sessions)
                .set({
                    recordingDeleted: true,
                    recordingDeletedAt: now,
                    isReplayExpired: true,
                    replayAvailable: false,
                    replayAvailableAt: null,
                    replaySegmentCount: 0,
                    replayStorageBytes: 0,
                    updatedAt: now,
                })
                .where(eq(sessions.id, context.sessionId));
        });

        const cacheKeyCount = invalidateCaches
            ? await invalidatePurgedSessionCaches(context.sessionId)
            : 0;

        await finalizeRetentionDeletionLog(logId, {
            status: 'completed',
            deletedArtifactRowCount: deletedArtifactCount,
            deletedIngestJobCount: deletedJobCount,
            deletedObjectCount: deletionResult.deletedObjectCount,
            deletedBytes: deletionResult.deletedBytes,
            storageMissing,
            cacheKeyCount,
            details: {
                retentionTier: options.retentionTier ?? context.retentionTier,
                retentionDays: options.retentionDays ?? context.retentionDays,
                endpointResults: buildEndpointBreakdown(deletionResult.endpointResults),
            },
        });
        finalizedLog = true;

        logger.info({
            sessionId: context.sessionId,
            projectId: context.projectId,
            teamId: context.teamId,
            trigger: options.trigger,
            deletedArtifactCount,
            deletedJobCount,
            deletedObjectCount: deletionResult.deletedObjectCount,
            deletedBytes: deletionResult.deletedBytes,
            storageMissing,
        }, 'Purged canonical session artifacts and storage');

        return {
            sessionId: context.sessionId,
            projectId: context.projectId,
            teamId: context.teamId,
            deletedArtifactCount,
            deletedJobCount,
            deletedObjectCount: deletionResult.deletedObjectCount,
            deletedBytes: deletionResult.deletedBytes,
            plannedArtifactCount: context.artifacts.length,
            plannedArtifactBytes,
            plannedJobCount: context.jobs.length,
            cacheKeyCount,
            storageMissing,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!finalizedLog) {
            await finalizeRetentionDeletionLog(logId, {
                status: 'failed',
                errorText: message,
                details: {
                    retentionTier: options.retentionTier ?? context.retentionTier,
                    retentionDays: options.retentionDays ?? context.retentionDays,
                },
            }).catch(() => {});
        }
        throw err;
    }
}

export async function repairExpiredSessionArtifactsBatch(
    runId: string,
    limit = 100,
    trigger = 'retention_repair',
): Promise<ExpiredSessionArtifactRepairResult> {
    const expiredSessions = await db
        .selectDistinct({
            sessionId: sessions.id,
            retentionTier: sessions.retentionTier,
            retentionDays: sessions.retentionDays,
        })
        .from(sessions)
        .innerJoin(recordingArtifacts, eq(recordingArtifacts.sessionId, sessions.id))
        .where(
            or(
                eq(sessions.recordingDeleted, true),
                eq(sessions.isReplayExpired, true),
            ),
        )
        .limit(limit);

    const { backedUp, notBackedUp } = await partitionBackedUpSessions(
        expiredSessions.map((session) => ({
            id: session.sessionId,
            ...session,
        })),
    );

    let repaired = 0;
    let failed = 0;
    let deletedObjectCount = 0;
    let deletedBytes = 0;
    const now = new Date();

    for (const session of backedUp) {
        try {
            const result = await purgeSessionArtifacts(session.sessionId, {
                runId,
                trigger,
                now,
                allowMissingStorage: true,
                retentionTier: session.retentionTier,
                retentionDays: session.retentionDays,
            });
            repaired++;
            deletedObjectCount += result.deletedObjectCount;
            deletedBytes += result.deletedBytes;
        } catch (err) {
            failed++;
            logger.error({ err, sessionId: session.sessionId }, 'Failed to repair expired session artifacts');
        }
    }

    if (repaired > 0 || failed > 0 || notBackedUp.length > 0) {
        logger.info({
            trigger,
            attempted: expiredSessions.length,
            repaired,
            failed,
            skippedNotBackedUp: notBackedUp.length,
            deletedObjectCount,
            deletedBytes,
        }, 'Processed expired sessions with leftover artifacts');
    }

    return {
        attempted: expiredSessions.length,
        repaired,
        failed,
        skippedNotBackedUp: notBackedUp.length,
        deletedObjectCount,
        deletedBytes,
    };
}

export async function backfillExpiredSessionArtifacts(
    batchSize = 100,
    runId = `retention-backfill:${Date.now()}`,
): Promise<number> {
    let totalRepaired = 0;

    while (true) {
        const result = await repairExpiredSessionArtifactsBatch(runId, batchSize, 'manual_backfill');
        totalRepaired += result.repaired;

        if (result.attempted === 0 || result.repaired === 0) {
            return totalRepaired;
        }
    }
}
