import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, ingestJobs, recordingArtifacts, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import {
    ABANDONED_ARTIFACT_TTL_MS,
    STALE_PROCESSING_JOB_TTL_MS,
} from './ingestUploadRelay.js';
import { markSessionIngestActivity } from './sessionReconciliation.js';
import { assertSessionAcceptsNewIngestWork, isSessionIngestImmutable } from './sessionIngestImmutability.js';
import { ApiError } from '../middleware/errorHandler.js';

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

function isReplayArtifactKind(kind: string | null | undefined): boolean {
    return kind === 'screenshots' || kind === 'hierarchy';
}

async function ensureArtifactProcessingJob(artifact: any): Promise<QueueArtifactJobResult> {
    const replay = isReplayArtifactKind(artifact.kind);
    const [existingJob] = await db.select().from(ingestJobs)
        .where(eq(ingestJobs.artifactId, artifact.id))
        .limit(1);

    if (!existingJob) {
        await db.insert(ingestJobs).values({
            projectId: artifact.projectId,
            sessionId: artifact.sessionId,
            artifactId: artifact.id,
            kind: artifact.kind,
            payloadRef: artifact.s3ObjectKey,
            status: 'pending',
        });
        if (replay) {
            logger.info({
                event: 'ingest.replay_ingest_job_created',
                projectId: artifact.projectId,
                sessionId: artifact.sessionId,
                artifactId: artifact.id,
                kind: artifact.kind,
                artifactRowStatus: artifact.status,
            }, 'ingest.replay_ingest_job_created');
        }
        return { queued: true, alreadyCompleted: false };
    }

    if (existingJob.status === 'done' && artifact.status === 'ready') {
        if (replay) {
            logger.info({
                event: 'ingest.replay_ingest_job_ensure',
                outcome: 'noop_done_and_ready',
                projectId: artifact.projectId,
                sessionId: artifact.sessionId,
                artifactId: artifact.id,
                kind: artifact.kind,
                jobId: existingJob.id,
            }, 'ingest.replay_ingest_job_ensure');
        }
        return { queued: false, alreadyCompleted: true };
    }

    if (existingJob.status === 'pending' || existingJob.status === 'processing') {
        return { queued: false, alreadyCompleted: false };
    }

    await db.update(ingestJobs)
        .set({
            status: 'pending',
            nextRunAt: null,
            errorMsg: null,
            startedAt: null,
            completedAt: null,
            workerId: null,
            updatedAt: new Date(),
        })
        .where(eq(ingestJobs.id, existingJob.id));

    if (replay) {
        logger.info({
            event: 'ingest.replay_ingest_job_requeued',
            projectId: artifact.projectId,
            sessionId: artifact.sessionId,
            artifactId: artifact.id,
            kind: artifact.kind,
            jobId: existingJob.id,
            previousJobStatus: existingJob.status,
            artifactRowStatus: artifact.status,
        }, 'ingest.replay_ingest_job_requeued');
    }

    return { queued: true, alreadyCompleted: false };
}

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

    await markSessionIngestActivity(session.id, { reopen: true });

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

    await markSessionIngestActivity(params.sessionId, { reopen: true });

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
        : await ensureArtifactProcessingJob({
            ...artifact,
            projectId: session.projectId,
            status: nextStatus,
        });

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
        return {
            ignored: true,
        };
    }

    const { artifact, session } = artifactResult;
    const now = new Date();
    const nextStatus = artifact.uploadCompletedAt ? 'failed' : 'abandoned';
    const errorMsg = params.errorMsg ?? 'Upload interrupted before relay storage';

    await db.update(recordingArtifacts)
        .set({
            status: nextStatus,
            readyAt: null,
            verifiedAt: null,
        })
        .where(eq(recordingArtifacts.id, artifact.id));

    await db.update(ingestJobs)
        .set({
            status: 'failed',
            errorMsg,
            completedAt: now,
            startedAt: null,
            workerId: null,
            updatedAt: now,
        })
        .where(and(
            eq(ingestJobs.artifactId, artifact.id),
            sql`${ingestJobs.status} in ('pending', 'processing')`,
        ));

    if (!isSessionIngestImmutable(session)) {
        await markSessionIngestActivity(session.id, { at: now, reopen: true });
    }

    logger.warn({
        sessionId: session.id,
        artifactId: artifact.id,
        kind: artifact.kind,
        clientUploadId: artifact.clientUploadId,
        reason: params.reason,
        errorMsg,
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
            .set({
                frameCount: params.frameCount,
            })
            .where(eq(recordingArtifacts.id, artifact.id));
    }

    let jobState: QueueArtifactJobResult = { queued: false, alreadyCompleted: false };
    if (artifact.status === 'uploaded') {
        jobState = await ensureArtifactProcessingJob({
            ...artifact,
            projectId: session.projectId,
        });
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
    const rows = await db.select({
        artifact: recordingArtifacts,
        projectId: sessions.projectId,
        jobStatus: ingestJobs.status,
    })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
        .leftJoin(ingestJobs, eq(ingestJobs.artifactId, recordingArtifacts.id))
        .where(and(
            eq(recordingArtifacts.status, 'uploaded'),
            or(
                isNull(ingestJobs.id),
                sql`${ingestJobs.status} in ('failed', 'dlq', 'done')`
            ),
        ))
        .limit(limit);

    let queued = 0;
    for (const row of rows) {
        const jobState = await ensureArtifactProcessingJob({
            ...row.artifact,
            projectId: row.projectId,
        });
        if (jobState.queued) {
            queued += 1;
            logger.info({
                event: 'artifact.queued',
                replayArtifact: isReplayArtifactKind(row.artifact.kind),
                sessionId: row.artifact.sessionId,
                artifactId: row.artifact.id,
                kind: row.artifact.kind,
                previousJobStatus: row.jobStatus ?? null,
            }, 'artifact.queued');
        }
    }

    return queued;
}

export async function abandonExpiredPendingArtifacts(limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - ABANDONED_ARTIFACT_TTL_MS);
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
        ))
        .limit(limit);

    if (rows.length === 0) {
        return 0;
    }

    const now = new Date();
    const ids = rows.map((row) => row.id);

    await db.update(recordingArtifacts)
        .set({ status: 'abandoned' })
        .where(inArray(recordingArtifacts.id, ids));

    await db.update(ingestJobs)
        .set({
            status: 'failed',
            errorMsg: 'Upload abandoned before relay receipt',
            completedAt: now,
            startedAt: null,
            workerId: null,
            updatedAt: now,
        })
        .where(and(
            inArray(ingestJobs.artifactId, ids),
            sql`${ingestJobs.status} in ('pending', 'processing')`,
        ));

    for (const row of rows) {
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

export async function requeueStaleProcessingJobs(limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_JOB_TTL_MS);
    const rows = await db.select({
        id: ingestJobs.id,
        artifactId: ingestJobs.artifactId,
        sessionId: ingestJobs.sessionId,
        kind: ingestJobs.kind,
        workerId: ingestJobs.workerId,
        startedAt: ingestJobs.startedAt,
    })
        .from(ingestJobs)
        .where(and(
            eq(ingestJobs.status, 'processing'),
            lte(ingestJobs.startedAt, cutoff),
        ))
        .limit(limit);

    for (const row of rows) {
        await db.update(ingestJobs)
            .set({
                status: 'pending',
                nextRunAt: null,
                startedAt: null,
                workerId: null,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.id, row.id));

        const replayArtifact = isReplayArtifactKind(row.kind);
        logger.warn(
            {
                event: 'artifact.job_stale_requeued',
                replayArtifact,
                jobId: row.id,
                artifactId: row.artifactId,
                sessionId: row.sessionId,
                kind: row.kind,
                workerId: row.workerId,
                startedAt: row.startedAt,
            },
            replayArtifact ? 'ingest.replay_job_stale_requeued' : 'artifact.retry',
        );
    }

    return rows.length;
}
