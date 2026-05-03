import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { getObjectSizeBytesForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import {
    ABANDONED_ARTIFACT_TTL_MS,
    REPLAY_PENDING_ARTIFACT_GRACE_MS,
} from './ingestUploadRelay.js';
import { markSessionIngestActivity } from './sessionReconciliation.js';
import { assertSessionAcceptsNewIngestWork, isSessionIngestImmutable } from './sessionIngestImmutability.js';
import { ApiError } from '../middleware/errorHandler.js';
import {
    enqueueArtifactJob,
    removeArtifactJobIfQueued,
    type ArtifactJobData,
} from './artifactBullQueue.js';

type PendingArtifactParams = {
    sessionId: string;
    kind: string;
    s3ObjectKey: string;
    endpointId?: string | null;
    clientUploadId: string;
    declaredSizeBytes?: number | null;
    timestamp?: number | null;
    startTime?: number | null;
    endTime?: number | null;
    frameCount?: number | null;
};

type CompleteArtifactParams = {
    projectId: string;
    clientUploadId: string;
    actualSizeBytes?: number | null;
    frameCount?: number | null;
};

type QueueArtifactJobResult = {
    queued: boolean;
    alreadyCompleted: boolean;
};

type ReplayArtifactPreparationResult = {
    artifact: any;
    action: 'created' | 'reused' | 'reopened' | 'skip';
    alreadyCompleted: boolean;
};

type StalePendingReplayRecoveryResult = {
    checked: number;
    recovered: number;
};

function isReplayArtifactKind(kind: string | null | undefined): boolean {
    return kind === 'screenshots' || kind === 'hierarchy';
}

function hasClosedTiming(session: { endedAt?: Date | string | null }): boolean {
    if (!session.endedAt) {
        return false;
    }
    const endedAt = session.endedAt instanceof Date ? session.endedAt : new Date(String(session.endedAt));
    return Number.isFinite(endedAt.getTime());
}

async function touchSessionForArtifactMutation(
    session: { id: string; endedAt?: Date | string | null },
    at = new Date()
): Promise<void> {
    if (hasClosedTiming(session)) {
        await markSessionIngestActivity(session.id, { at });
        return;
    }
    await markSessionIngestActivity(session.id, { at, reopen: true });
}

// ─── BullMQ enqueue helpers ───────────────────────────────────────────────────

/**
 * Build the job data payload from an artifact row + projectId.
 */
function buildArtifactJobData(artifact: any, projectId: string): ArtifactJobData {
    return {
        artifactId: artifact.id,
        sessionId: artifact.sessionId,
        projectId,
        kind: artifact.kind,
        s3ObjectKey: artifact.s3ObjectKey,
        endpointId: artifact.endpointId ?? null,
    };
}

/**
 * Ensure a BullMQ processing job exists for this artifact.
 *
 * Uses jobId = `artifact:{artifactId}` deduplication — safe to call multiple
 * times; BullMQ won't create a duplicate while a live job exists.
 */
async function ensureArtifactProcessingJob(artifact: any, projectId: string): Promise<QueueArtifactJobResult> {
    // artifact.status === 'ready' means processing is already done
    if (artifact.status === 'ready') {
        return { queued: false, alreadyCompleted: true };
    }

    const enqueued = await enqueueArtifactJob(buildArtifactJobData(artifact, projectId));

    const isReplay = isReplayArtifactKind(artifact.kind);
    if (enqueued && isReplay) {
        logger.info({
            event: 'ingest.replay_ingest_job_created',
            projectId,
            sessionId: artifact.sessionId,
            artifactId: artifact.id,
            kind: artifact.kind,
        }, 'ingest.replay_ingest_job_created');
    }

    return { queued: enqueued, alreadyCompleted: false };
}

// ─── Internal DB helpers ──────────────────────────────────────────────────────

async function getArtifactWithSessionByUploadId(projectId: string, clientUploadId: string) {
    const [artifactResult] = await db.select({
        artifact: recordingArtifacts,
        session: sessions,
    })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
        .where(and(
            eq(recordingArtifacts.clientUploadId, clientUploadId),
            eq(sessions.projectId, projectId),
        ))
        .limit(1);

    return artifactResult;
}

async function getArtifactWithSessionById(artifactId: string) {
    const [artifactResult] = await db.select({
        artifact: recordingArtifacts,
        session: sessions,
    })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
        .where(eq(recordingArtifacts.id, artifactId))
        .limit(1);

    return artifactResult;
}

function buildArtifactRetryUpdate(params: PendingArtifactParams) {
    return {
        s3ObjectKey: params.s3ObjectKey,
        endpointId: params.endpointId ?? null,
        declaredSizeBytes: params.declaredSizeBytes ?? null,
        sizeBytes: null,
        status: 'pending',
        readyAt: null,
        uploadCompletedAt: null,
        verifiedAt: null,
        timestamp: params.timestamp ?? null,
        startTime: params.startTime ?? null,
        endTime: params.endTime ?? null,
        frameCount: params.frameCount ?? null,
    } as const;
}

// ─── Public lifecycle functions ───────────────────────────────────────────────

export async function prepareReplayArtifactForUpload(
    params: PendingArtifactParams & { projectId: string }
): Promise<ReplayArtifactPreparationResult> {
    const existing = await getArtifactWithSessionByUploadId(params.projectId, params.clientUploadId);

    if (!existing) {
        try {
            return {
                artifact: await registerPendingArtifact(params),
                action: 'created',
                alreadyCompleted: false,
            };
        } catch (err: any) {
            if (err?.code !== '23505') {
                throw err;
            }
        }
    }

    const current = existing ?? await getArtifactWithSessionByUploadId(params.projectId, params.clientUploadId);
    if (!current) {
        throw new Error(`Artifact registration race lost for ${params.clientUploadId}`);
    }

    const { artifact, session } = current;
    if (session.id !== params.sessionId) {
        throw new Error(`Artifact ${artifact.id} belongs to unexpected session ${session.id}`);
    }

    if (artifact.status === 'ready') {
        return {
            artifact,
            action: 'skip',
            alreadyCompleted: true,
        };
    }

    if (isSessionIngestImmutable(session)) {
        throw ApiError.conflict('Session is closed to ingest; no new uploads or mutations are accepted.');
    }

    await touchSessionForArtifactMutation(session);

    const update = buildArtifactRetryUpdate(params);

    if (artifact.status === 'abandoned' || artifact.status === 'failed') {
        await db.update(recordingArtifacts)
            .set(update)
            .where(eq(recordingArtifacts.id, artifact.id));

        logger.info({
            sessionId: session.id,
            artifactId: artifact.id,
            kind: artifact.kind,
            clientUploadId: artifact.clientUploadId,
        }, 'artifact.reopened');

        return {
            artifact: { ...artifact, ...update },
            action: 'reopened',
            alreadyCompleted: false,
        };
    }

    if (artifact.status === 'pending' || artifact.status === 'uploaded') {
        await db.update(recordingArtifacts)
            .set({
                s3ObjectKey: params.s3ObjectKey,
                endpointId: params.endpointId ?? null,
                declaredSizeBytes: params.declaredSizeBytes ?? null,
                timestamp: params.timestamp ?? null,
                startTime: params.startTime ?? null,
                endTime: params.endTime ?? null,
                frameCount: params.frameCount ?? null,
            })
            .where(eq(recordingArtifacts.id, artifact.id));

        logger.info({
            sessionId: session.id,
            artifactId: artifact.id,
            kind: artifact.kind,
            clientUploadId: artifact.clientUploadId,
            status: artifact.status,
        }, 'artifact.reused');

        return {
            artifact: {
                ...artifact,
                s3ObjectKey: params.s3ObjectKey,
                endpointId: params.endpointId ?? null,
                declaredSizeBytes: params.declaredSizeBytes ?? null,
                timestamp: params.timestamp ?? null,
                startTime: params.startTime ?? null,
                endTime: params.endTime ?? null,
                frameCount: params.frameCount ?? null,
            },
            action: 'reused',
            alreadyCompleted: false,
        };
    }

    return {
        artifact,
        action: 'reused',
        alreadyCompleted: false,
    };
}

export async function registerPendingArtifact(params: PendingArtifactParams) {
    const [guardSession] = await db.select().from(sessions).where(eq(sessions.id, params.sessionId)).limit(1);
    if (!guardSession) {
        throw ApiError.internal('Session not found for artifact registration');
    }
    assertSessionAcceptsNewIngestWork(guardSession);

    await touchSessionForArtifactMutation(guardSession);

    const [artifact] = await db.insert(recordingArtifacts).values({
        sessionId: params.sessionId,
        kind: params.kind,
        s3ObjectKey: params.s3ObjectKey,
        clientUploadId: params.clientUploadId,
        endpointId: params.endpointId ?? null,
        declaredSizeBytes: params.declaredSizeBytes ?? null,
        status: 'pending',
        timestamp: params.timestamp ?? null,
        startTime: params.startTime ?? null,
        endTime: params.endTime ?? null,
        frameCount: params.frameCount ?? null,
    }).returning();

    const replayArtifact = params.kind === 'screenshots' || params.kind === 'hierarchy';
    logger.info({
        event: 'artifact.presigned',
        replayArtifact,
        sessionId: params.sessionId,
        artifactId: artifact.id,
        kind: params.kind,
        clientUploadId: params.clientUploadId,
        s3ObjectKey: params.s3ObjectKey,
        endpointId: params.endpointId ?? null,
    }, 'artifact.presigned');

    return artifact;
}

export async function markArtifactUploadStored(params: {
    artifactId: string;
    sizeBytes?: number | null;
    contentType?: string | null;
    endpointId?: string | null;
}) {
    const artifactResult = await getArtifactWithSessionById(params.artifactId);
    if (!artifactResult) {
        logger.warn({ artifactId: params.artifactId }, 'artifact.upload_missing');
        return {
            ignored: true,
            queued: false,
            alreadyCompleted: false,
        };
    }

    const { artifact, session } = artifactResult;
    const uploadedAt = new Date();
    const nextStatus = artifact.status === 'ready' ? 'ready' : 'uploaded';
    const resolvedSizeBytes = params.sizeBytes ?? artifact.sizeBytes ?? artifact.declaredSizeBytes ?? null;
    const resolvedEndpointId = params.endpointId ?? artifact.endpointId ?? null;

    await db.update(recordingArtifacts)
        .set({
            status: nextStatus,
            sizeBytes: resolvedSizeBytes,
            endpointId: resolvedEndpointId,
            uploadCompletedAt: artifact.uploadCompletedAt ?? uploadedAt,
        })
        .where(eq(recordingArtifacts.id, artifact.id));

    if (!isSessionIngestImmutable(session)) {
        await markSessionIngestActivity(session.id, { at: uploadedAt });
    }

    const jobState = nextStatus === 'ready'
        ? { queued: false, alreadyCompleted: true }
        : await ensureArtifactProcessingJob(
            { ...artifact, status: nextStatus, endpointId: resolvedEndpointId },
            session.projectId,
        );

    logger.info({
        event: 'artifact.upload_stored',
        replayArtifact: isReplayArtifactKind(artifact.kind),
        projectId: session.projectId,
        sessionId: session.id,
        artifactId: artifact.id,
        kind: artifact.kind,
        s3ObjectKey: artifact.s3ObjectKey,
        endpointId: resolvedEndpointId,
        sizeBytes: resolvedSizeBytes,
        contentType: params.contentType ?? null,
        queued: jobState.queued,
        alreadyCompleted: jobState.alreadyCompleted,
    }, 'artifact.upload_stored');

    return {
        ignored: false,
        queued: jobState.queued,
        alreadyCompleted: jobState.alreadyCompleted,
        sessionId: session.id,
        artifactId: artifact.id,
        projectId: session.projectId,
    };
}

export async function markArtifactUploadInterrupted(params: {
    artifactId: string;
    errorMsg?: string | null;
    reason: string;
}) {
    const artifactResult = await getArtifactWithSessionById(params.artifactId);
    if (!artifactResult) {
        logger.warn({ artifactId: params.artifactId, reason: params.reason }, 'artifact.upload_interrupt_missing');
        return { ignored: true };
    }

    const { artifact, session } = artifactResult;
    const now = new Date();
    const nextStatus = artifact.uploadCompletedAt ? 'failed' : 'abandoned';

    await db.update(recordingArtifacts)
        .set({ status: nextStatus, readyAt: null, verifiedAt: null })
        .where(eq(recordingArtifacts.id, artifact.id));

    // Remove the BullMQ job if it's still waiting (not yet active)
    await removeArtifactJobIfQueued(artifact.id, artifact.kind);

    if (!isSessionIngestImmutable(session)) {
        await touchSessionForArtifactMutation(session, now);
    }

    logger.warn({
        sessionId: session.id,
        artifactId: artifact.id,
        kind: artifact.kind,
        clientUploadId: artifact.clientUploadId,
        reason: params.reason,
        errorMsg: params.errorMsg ?? 'Upload interrupted before relay storage',
    }, 'artifact.upload_interrupted');

    return {
        ignored: false,
        sessionId: session.id,
        artifactId: artifact.id,
        status: nextStatus,
    };
}

export async function completeArtifactUpload(params: CompleteArtifactParams) {
    const artifactResult = await getArtifactWithSessionByUploadId(params.projectId, params.clientUploadId);

    if (!artifactResult) {
        logger.warn({
            projectId: params.projectId,
            clientUploadId: params.clientUploadId,
        }, 'artifact.complete_missing');
        return {
            success: true,
            ignored: true,
            queued: false,
            alreadyCompleted: false,
        };
    }

    const { artifact, session } = artifactResult;
    const acknowledgedAt = new Date();

    if (!isSessionIngestImmutable(session)) {
        await markSessionIngestActivity(session.id, { at: acknowledgedAt });
    }

    if (params.frameCount !== undefined && params.frameCount !== null) {
        await db.update(recordingArtifacts)
            .set({ frameCount: params.frameCount })
            .where(eq(recordingArtifacts.id, artifact.id));
    }

    let jobState: QueueArtifactJobResult = { queued: false, alreadyCompleted: false };
    if (artifact.status === 'uploaded') {
        jobState = await ensureArtifactProcessingJob(
            { ...artifact, projectId: session.projectId },
            session.projectId,
        );
    } else if (artifact.status === 'ready') {
        jobState = { queued: false, alreadyCompleted: true };
    }

    const isReplayKind = artifact.kind === 'screenshots' || artifact.kind === 'hierarchy';
    if (isReplayKind && artifact.status === 'pending') {
        logger.warn(
            {
                event: 'ingest.segment_complete_while_pending',
                projectId: params.projectId,
                sessionId: session.id,
                artifactId: artifact.id,
                kind: artifact.kind,
                clientUploadId: params.clientUploadId,
                actualSizeBytes: params.actualSizeBytes ?? null,
                frameCount: params.frameCount ?? null,
            },
            'ingest.segment_complete_while_pending',
        );
    }

    logger.info({
        event: 'artifact.complete_received',
        projectId: params.projectId,
        sessionId: session.id,
        artifactId: artifact.id,
        kind: artifact.kind,
        clientUploadId: params.clientUploadId,
        actualSizeBytes: params.actualSizeBytes ?? null,
        frameCount: params.frameCount ?? null,
        artifactStatus: artifact.status,
        queued: jobState.queued,
        alreadyCompleted: jobState.alreadyCompleted,
    }, 'artifact.complete_received');

    return {
        success: true,
        ignored: false,
        queued: jobState.queued,
        alreadyCompleted: jobState.alreadyCompleted,
    };
}

export async function queueRecoverableArtifacts(limit = 100): Promise<number> {
    // Find uploaded artifacts with no active BullMQ job.
    // We simply call enqueueArtifactJob for each — BullMQ's jobId deduplication
    // makes this safe to call even when a job already exists.
    const rows = await db.select({
        artifact: recordingArtifacts,
        projectId: sessions.projectId,
    })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
        .where(eq(recordingArtifacts.status, 'uploaded'))
        .limit(limit);

    let queued = 0;
    for (const row of rows) {
        const enqueued = await enqueueArtifactJob(buildArtifactJobData(row.artifact, row.projectId));
        if (enqueued) {
            queued += 1;
            logger.info({
                event: 'artifact.queued',
                replayArtifact: isReplayArtifactKind(row.artifact.kind),
                sessionId: row.artifact.sessionId,
                artifactId: row.artifact.id,
                kind: row.artifact.kind,
            }, 'artifact.queued');
        }
    }

    return queued;
}

export async function recoverStalePendingReplayArtifacts(limit = 100): Promise<StalePendingReplayRecoveryResult> {
    const cutoff = new Date(Date.now() - ABANDONED_ARTIFACT_TTL_MS);
    const rows = await db.select({
        artifact: recordingArtifacts,
        projectId: sessions.projectId,
    })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
        .where(and(
            eq(recordingArtifacts.status, 'pending'),
            isNull(recordingArtifacts.uploadCompletedAt),
            sql`${recordingArtifacts.kind} in ('screenshots', 'hierarchy')`,
            lte(recordingArtifacts.createdAt, cutoff),
        ))
        .limit(limit);

    if (rows.length === 0) {
        return { checked: 0, recovered: 0 };
    }

    let recovered = 0;

    for (const row of rows) {
        const sizeBytes = await getObjectSizeBytesForArtifact(
            row.projectId,
            row.artifact.s3ObjectKey,
            row.artifact.endpointId,
        );

        if (!sizeBytes || sizeBytes <= 0) {
            continue;
        }

        const recoveredAt = new Date();
        await db.update(recordingArtifacts)
            .set({
                status: 'uploaded',
                sizeBytes,
                uploadCompletedAt: row.artifact.uploadCompletedAt ?? recoveredAt,
            })
            .where(eq(recordingArtifacts.id, row.artifact.id));

        await markSessionIngestActivity(row.artifact.sessionId, { at: recoveredAt });

        const enqueued = await enqueueArtifactJob(
            buildArtifactJobData({ ...row.artifact, status: 'uploaded' }, row.projectId),
        );

        recovered += 1;
        logger.info({
            event: 'artifact.recovered_from_storage',
            replayArtifact: true,
            sessionId: row.artifact.sessionId,
            artifactId: row.artifact.id,
            kind: row.artifact.kind,
            s3ObjectKey: row.artifact.s3ObjectKey,
            endpointId: row.artifact.endpointId ?? null,
            sizeBytes,
            queued: enqueued,
        }, 'artifact.recovered_from_storage');
    }

    return { checked: rows.length, recovered };
}

export async function abandonExpiredPendingArtifacts(limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - ABANDONED_ARTIFACT_TTL_MS);
    const replayGraceCutoff = new Date(Date.now() - REPLAY_PENDING_ARTIFACT_GRACE_MS);
    const rows = await db.select({
        id: recordingArtifacts.id,
        sessionId: recordingArtifacts.sessionId,
        kind: recordingArtifacts.kind,
        clientUploadId: recordingArtifacts.clientUploadId,
        s3ObjectKey: recordingArtifacts.s3ObjectKey,
    })
        .from(recordingArtifacts)
        .where(and(
            eq(recordingArtifacts.status, 'pending'),
            isNull(recordingArtifacts.uploadCompletedAt),
            lte(recordingArtifacts.createdAt, cutoff),
            sql`(
                ${recordingArtifacts.kind} NOT IN ('screenshots', 'hierarchy')
                OR ${recordingArtifacts.createdAt} <= ${replayGraceCutoff}
            )`,
        ))
        .limit(limit);

    if (rows.length === 0) {
        return 0;
    }

    const ids = rows.map((row) => row.id);

    await db.update(recordingArtifacts)
        .set({ status: 'abandoned' })
        .where(inArray(recordingArtifacts.id, ids));

    // Remove any waiting BullMQ jobs for these artifacts (pending artifacts
    // shouldn't have jobs yet, but guard in case of race)
    for (const row of rows) {
        await removeArtifactJobIfQueued(row.id, row.kind);

        const replayArtifact = isReplayArtifactKind(row.kind);
        logger.warn(
            {
                event: 'artifact.abandoned',
                replayArtifact,
                sessionId: row.sessionId,
                artifactId: row.id,
                kind: row.kind,
                clientUploadId: row.clientUploadId,
                s3ObjectKey: row.s3ObjectKey,
            },
            replayArtifact ? 'ingest.replay_artifact_abandoned' : 'artifact.abandoned',
        );
    }

    return rows.length;
}

/**
 * requeueStaleProcessingJobs is no longer needed.
 * BullMQ handles stalled job recovery automatically via the stalledInterval /
 * maxStalledCount Worker options.  This function is kept as a no-op so callers
 * (sessionLifecycleWorker) don't need an immediate follow-up change.
 *
 * @deprecated Remove after BullMQ migration is fully confirmed stable.
 */
export async function requeueStaleProcessingJobs(_limit = 100): Promise<number> {
    return 0;
}
