import { and, eq, exists, or, sql } from 'drizzle-orm';
import {
    db,
    projects,
    recordingArtifacts,
    sessionMetrics,
    sessions,
} from '../db/client.js';
import { getRedis, invalidateSessionEndpointCache, invalidateSessionExistsCache } from '../db/redis.js';
import {
    classifyS3DeletionError,
    deleteObjectsFromStorageEndpoints,
    deletePrefixFromStorageEndpoints,
    resolveRetentionDeletionEndpoints,
} from '../db/s3.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import {
    beginRetentionDeletionLog,
    finalizeRetentionDeletionLog,
} from './retentionAudit.js';
import { runBoundedConcurrentBatch } from './retentionBatch.js';

const FRAME_CACHE_PREFIX = 'screenshot_frames:';
const FRAME_CACHE_V2_PREFIX = 'screenshot_frames:v2:';
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

type SessionPurgeContext = {
    sessionId: string;
    projectId: string;
    teamId: string;
    retentionTier: number;
    retentionDays: number;
    recordingDeleted: boolean;
    isReplayExpired: boolean;
    artifacts: SessionArtifactRecord[];
};

export interface PurgeSessionArtifactsOptions {
    runId: string;
    trigger: string;
    now?: Date;
    invalidateCaches?: boolean;
    allowMissingStorage?: boolean;
    retentionTier?: number | null;
    retentionDays?: number | null;
    failOnMissingStorage?: boolean;
}

export interface PurgeSessionArtifactsResult {
    sessionId: string;
    projectId: string;
    teamId: string;
    deletedArtifactCount: number;
    deletedObjectCount: number;
    deletedBytes: number;
    plannedArtifactCount: number;
    plannedArtifactBytes: number;
    cacheKeyCount: number;
    storageMissing: boolean;
}

export interface ExpiredSessionArtifactRepairResult {
    attempted: number;
    repaired: number;
    failed: number;
    deletedObjectCount: number;
    deletedBytes: number;
    reachedProcessingCap: boolean;
}

type ExpiredSessionRepairCandidate = {
    sessionId: string;
    retentionTier: number;
    retentionDays: number;
    startedAt: Date;
};

export function buildCanonicalSessionStoragePrefix(
    teamId: string,
    projectId: string,
    sessionId: string,
): string {
    return `tenant/${teamId}/project/${projectId}/sessions/${sessionId}/`;
}

export function buildDerivedSessionStoragePrefix(sessionId: string): string {
    return `sessions/${sessionId}/`;
}

async function collectExpiredRepairCandidates(limit: number): Promise<{
    sessionsToRepair: ExpiredSessionRepairCandidate[];
    reachedProcessingCap: boolean;
}> {
    const currentRetentionPeriodExpired = sql`
        ${sessions.startedAt} < NOW() - (${sessions.retentionDays} * INTERVAL '1 day')
    `;

    const sessionsToRepair = await db
        .select({
            sessionId: sessions.id,
            retentionTier: sessions.retentionTier,
            retentionDays: sessions.retentionDays,
            startedAt: sessions.startedAt,
        })
        .from(sessions)
        .where(
            and(
                or(
                    eq(sessions.recordingDeleted, true),
                    eq(sessions.isReplayExpired, true),
                ),
                currentRetentionPeriodExpired,
                exists(
                    db
                        .select({ artifactId: recordingArtifacts.id })
                        .from(recordingArtifacts)
                        .where(eq(recordingArtifacts.sessionId, sessions.id)),
                ),
            ),
        )
        .orderBy(sessions.startedAt, sessions.id)
        .limit(limit);

    return {
        sessionsToRepair,
        reachedProcessingCap: sessionsToRepair.length >= limit,
    };
}

async function invalidatePurgedSessionCaches(sessionId: string): Promise<number> {
    try {
        const redis = getRedis();
        const deletedKeyCount = await redis.del(
            `${SESSION_CORE_CACHE_PREFIX}${sessionId}`,
            `${SESSION_TIMELINE_CACHE_PREFIX}${sessionId}`,
            `${SESSION_HIERARCHY_CACHE_PREFIX}${sessionId}`,
            `${FRAME_CACHE_PREFIX}${sessionId}`,
            `${FRAME_CACHE_V2_PREFIX}${sessionId}`,
        );

        // Individual screenshot_frame_data keys already have a hard 10-minute
        // TTL. Scanning the entire Redis keyspace once per expired session made
        // retention O(expired sessions × Redis keys), and cross-region Sentinel
        // failover turned each no-op scan into hundreds of network round trips.
        // The session is marked replay-unavailable before this returns, so those
        // short-lived payload keys are unreachable while they expire naturally.
        return Number(deletedKeyCount);
    } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to invalidate purged session caches');
        return 0;
    }
}

async function loadSessionPurgeContext(sessionId: string): Promise<SessionPurgeContext> {
    const [sessionRows, artifacts] = await Promise.all([
        db
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
            .limit(1),
        db
            .select({
                id: recordingArtifacts.id,
                kind: recordingArtifacts.kind,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                endpointId: recordingArtifacts.endpointId,
                sizeBytes: recordingArtifacts.sizeBytes,
                declaredSizeBytes: recordingArtifacts.declaredSizeBytes,
            })
            .from(recordingArtifacts)
            .where(eq(recordingArtifacts.sessionId, sessionId)),
    ]);

    const [sessionResult] = sessionRows;
    if (!sessionResult) {
        throw new Error(`Session not found: ${sessionId}`);
    }

    return {
        ...sessionResult,
        artifacts,
    };
}

function buildEndpointBreakdown(details: {
    endpointId: string;
    endpointUrl: string;
    projectId: string | null;
    shadow: boolean;
    active: boolean;
    bucket: string;
    deletedObjectCount: number;
    deletedBytes: number;
    missingPrefix?: boolean;
    listStatus?: 'deleted' | 'empty' | 'missing';
    durationMs?: number;
}[]): Record<string, unknown>[] {
    return details.map((result) => ({
        endpointId: result.endpointId,
        endpointUrl: result.endpointUrl,
        projectId: result.projectId,
        shadow: result.shadow,
        active: result.active,
        bucket: result.bucket,
        deletedObjectCount: result.deletedObjectCount,
        deletedBytes: result.deletedBytes,
        missingPrefix: result.missingPrefix ?? false,
        listStatus: result.listStatus ?? null,
        durationMs: result.durationMs ?? null,
    }));
}

export async function purgeSessionArtifacts(
    sessionId: string,
    options: PurgeSessionArtifactsOptions,
): Promise<PurgeSessionArtifactsResult> {
    const now = options.now ?? new Date();
    const invalidateCaches = options.invalidateCaches ?? true;
    const allowMissingStorage = options.allowMissingStorage ?? false;
    const failOnMissingStorage = options.failOnMissingStorage ?? config.RETENTION_FAIL_ON_MISSING_STORAGE;
    const context = await loadSessionPurgeContext(sessionId);
    let finalizedLog = false;
    const canonicalPrefix = buildCanonicalSessionStoragePrefix(
        context.teamId,
        context.projectId,
        context.sessionId,
    );
    const derivedPrefix = buildDerivedSessionStoragePrefix(context.sessionId);
    const artifactEndpointIds = context.artifacts.map((artifact) => artifact.endpointId);
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
        plannedIngestJobCount: 0,
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
            endpointId: artifact.endpointId,
        }));

    try {
        // Resolve the project + historical artifact endpoints once, then overlap
        // the independent canonical, derived-cache, and misplaced-key deletes.
        // This preserves the exact deletion set while avoiding repeated endpoint
        // database lookups and serial S3 round trips for every expired session.
        const deletionEndpoints = await resolveRetentionDeletionEndpoints(
            context.projectId,
            artifactEndpointIds,
        );
        const [
            deletionResult,
            derivedDeletionResult,
            invalidArtifactDeletion,
        ] = await Promise.all([
            deletePrefixFromStorageEndpoints(
                canonicalPrefix,
                deletionEndpoints,
            ),
            deletePrefixFromStorageEndpoints(
                derivedPrefix,
                deletionEndpoints,
            ),
            invalidArtifacts.length > 0
                ? deleteObjectsFromStorageEndpoints(
                    invalidArtifacts.map((artifact) => artifact.s3ObjectKey),
                    deletionEndpoints,
                )
                : Promise.resolve({
                    deletedObjectCount: 0,
                    deletedBytes: 0,
                    endpointResults: [],
                }),
        ]);
        const deletedCanonicalObjectCount = deletionResult.deletedObjectCount + invalidArtifactDeletion.deletedObjectCount;
        const deletedStorageObjectCount = deletedCanonicalObjectCount + derivedDeletionResult.deletedObjectCount;
        const deletedStorageBytes = deletionResult.deletedBytes
            + invalidArtifactDeletion.deletedBytes
            + derivedDeletionResult.deletedBytes;
        const storageMissing = context.artifacts.length > 0 && deletedCanonicalObjectCount === 0;

        if (storageMissing && failOnMissingStorage && !allowMissingStorage) {
            await finalizeRetentionDeletionLog(logId, {
                status: 'failed',
                deletedObjectCount: deletedStorageObjectCount,
                deletedBytes: deletedStorageBytes,
                storageMissing: true,
                errorText: 'Canonical storage scan found no objects for a session that still has recording_artifacts',
                details: {
                    retentionTier: options.retentionTier ?? context.retentionTier,
                    retentionDays: options.retentionDays ?? context.retentionDays,
                    invalidArtifacts,
                    endpointResults: buildEndpointBreakdown([
                        ...deletionResult.endpointResults,
                        ...derivedDeletionResult.endpointResults,
                        ...invalidArtifactDeletion.endpointResults,
                    ]),
                    errorClass: 'missing_source_prefix',
                    durationMs: Date.now() - now.getTime(),
                },
            });
            finalizedLog = true;
            throw new Error(`Canonical storage missing for session ${sessionId}`);
        }

        let deletedArtifactCount = 0;
        await db.transaction(async (tx) => {
            const deletedArtifacts = await tx
                .delete(recordingArtifacts)
                .where(eq(recordingArtifacts.sessionId, context.sessionId))
                .returning({ id: recordingArtifacts.id });

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
                    replayRetentionState: 'not_available',
                    replaySegmentCount: 0,
                    replayStorageBytes: 0,
                    updatedAt: now,
                })
                .where(eq(sessions.id, context.sessionId));
        });

        const cacheKeyCount = invalidateCaches
            ? await invalidatePurgedSessionCaches(context.sessionId)
            : 0;
        if (invalidateCaches) {
            invalidateSessionExistsCache(context.projectId, context.sessionId).catch(() => {});
            invalidateSessionEndpointCache(context.projectId, context.sessionId).catch(() => {});
        }

        await finalizeRetentionDeletionLog(logId, {
            status: 'completed',
            deletedArtifactRowCount: deletedArtifactCount,
            deletedIngestJobCount: 0,
            deletedObjectCount: deletedStorageObjectCount,
            deletedBytes: deletedStorageBytes,
            storageMissing,
            cacheKeyCount,
            details: {
                retentionTier: options.retentionTier ?? context.retentionTier,
                retentionDays: options.retentionDays ?? context.retentionDays,
                invalidArtifacts,
                invalidArtifactDeletedObjectCount: invalidArtifactDeletion.deletedObjectCount,
                invalidArtifactDeletedBytes: invalidArtifactDeletion.deletedBytes,
                derivedStoragePrefix: derivedPrefix,
                derivedDeletedObjectCount: derivedDeletionResult.deletedObjectCount,
                derivedDeletedBytes: derivedDeletionResult.deletedBytes,
                endpointResults: buildEndpointBreakdown([
                    ...deletionResult.endpointResults,
                    ...derivedDeletionResult.endpointResults,
                    ...invalidArtifactDeletion.endpointResults,
                ]),
                durationMs: Date.now() - now.getTime(),
            },
        });
        finalizedLog = true;

        logger.info({
            sessionId: context.sessionId,
            projectId: context.projectId,
            teamId: context.teamId,
            trigger: options.trigger,
            deletedArtifactCount,
            deletedObjectCount: deletedStorageObjectCount,
            deletedBytes: deletedStorageBytes,
            storageMissing,
            invalidArtifactCount: invalidArtifacts.length,
            derivedDeletedObjectCount: derivedDeletionResult.deletedObjectCount,
        }, 'Purged canonical and derived session artifacts and storage');

        return {
            sessionId: context.sessionId,
            projectId: context.projectId,
            teamId: context.teamId,
            deletedArtifactCount,
            deletedObjectCount: deletedStorageObjectCount,
            deletedBytes: deletedStorageBytes,
            plannedArtifactCount: context.artifacts.length,
            plannedArtifactBytes,
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
                    errorClass: classifyS3DeletionError(err),
                    durationMs: Date.now() - now.getTime(),
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
    options: {
        concurrency?: number;
        deadlineAtMs?: number;
        now?: () => number;
    } = {},
): Promise<ExpiredSessionArtifactRepairResult> {
    const {
        sessionsToRepair,
        reachedProcessingCap,
    } = await collectExpiredRepairCandidates(limit);

    let repaired = 0;
    let failed = 0;
    let deletedObjectCount = 0;
    let deletedBytes = 0;

    const batchResult = await runBoundedConcurrentBatch(
        sessionsToRepair,
        {
            concurrency: options.concurrency ?? 1,
            deadlineAtMs: options.deadlineAtMs,
            now: options.now,
        },
        async (session) => {
            try {
                const result = await purgeSessionArtifacts(session.sessionId, {
                    runId,
                    trigger,
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
        },
    );

    if (repaired > 0 || failed > 0) {
        logger.info({
            trigger,
            attempted: batchResult.startedCount,
            repaired,
            failed,
            deletedObjectCount,
            deletedBytes,
        }, 'Processed expired sessions with leftover artifacts');
    }

    return {
        attempted: batchResult.startedCount,
        repaired,
        failed,
        deletedObjectCount,
        deletedBytes,
        reachedProcessingCap: reachedProcessingCap || batchResult.stoppedEarly,
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
