import { eq, sql } from 'drizzle-orm';
import { db, projects, recordingArtifacts, sessionMetrics, sessions } from '../db/client.js';
import { downloadFromS3ForArtifact, getObjectSizeBytesForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { ensureHierarchyArtifactCompressed } from './hierarchyArtifactCompression.js';
import { processEventsArtifact } from './ingestEventArtifactProcessor.js';
import { processAnrsArtifact, processCrashesArtifact } from './ingestFaultArtifactProcessors.js';
import { processRecoveredReplayArtifact } from './ingestReplayArtifactProcessor.js';
import { runArtifactCompletionEffects } from './artifactCompletionEffects.js';
import { reconcileSessionState } from './sessionReconciliation.js';
import type { ArtifactJobData, Job } from './artifactBullQueue.js';

// ─── Job context type ─────────────────────────────────────────────────────────

/**
 * Lightweight job descriptor passed into the processor context.
 * Previously this was typeof ingestJobs.$inferSelect; now it's the BullMQ job data
 * plus the fields that sub-processors need (kind, sessionId).
 */
export type ArtifactJobContext = {
    id: string;           // BullMQ job ID
    artifactId: string;
    sessionId: string;
    kind: string;
    s3ObjectKey: string;
    endpointId: string | null;
    attemptsMade: number;
};

type ArtifactProcessorContext = {
    artifact: typeof recordingArtifacts.$inferSelect;
    job: ArtifactJobContext;
    log: any;
    metrics: typeof sessionMetrics.$inferSelect | null;
    projectId: string;
    s3Key: string;
    session: typeof sessions.$inferSelect;
};

type ArtifactProcessor = (context: ArtifactProcessorContext) => Promise<{ sizeBytes: number }>;

function assertArtifactObjectSize(kind: string | null | undefined, sizeBytes: number | null): number {
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new Error(`Artifact object not visible yet for ${kind}`);
    }
    return sizeBytes;
}

async function loadArtifactObjectSize(context: ArtifactProcessorContext): Promise<number> {
    return assertArtifactObjectSize(
        context.job.kind,
        await getObjectSizeBytesForArtifact(context.projectId, context.s3Key, context.artifact.endpointId),
    );
}

export const artifactProcessors: Record<string, ArtifactProcessor> = {
    events: async (context) => {
        const sizeBytes = await loadArtifactObjectSize(context);
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for events');
        await processEventsArtifact(context.job, context.session, context.metrics, context.projectId, data, context.log);
        return { sizeBytes };
    },
    crashes: async (context) => {
        const sizeBytes = await loadArtifactObjectSize(context);
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for crashes');
        await processCrashesArtifact(context.job, context.session, context.projectId, context.s3Key, data, context.log);
        return { sizeBytes };
    },
    anrs: async (context) => {
        const sizeBytes = await loadArtifactObjectSize(context);
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for anrs');
        context.log.info('Processing ANRs artifact');
        await processAnrsArtifact(context.job, context.session, context.projectId, context.s3Key, data, context.log);
        return { sizeBytes };
    },
    screenshots: async (context) => {
        const sizeBytes = await loadArtifactObjectSize(context);
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for screenshots');
        await processRecoveredReplayArtifact({
            artifactId: context.job.artifactId,
            data,
            expectedFrameCount: context.artifact.frameCount,
            job: context.job,
            log: context.log,
            sessionStartTime: context.session.startedAt.getTime(),
        });
        return { sizeBytes };
    },
    hierarchy: async (context) => {
        const repairResult = await ensureHierarchyArtifactCompressed({
            projectId: context.projectId,
            s3Key: context.s3Key,
            endpointId: context.artifact.endpointId,
            artifactId: context.job.artifactId,
            sessionId: context.job.sessionId,
        });
        const sizeBytes = repairResult.sizeBytes == null
            ? await loadArtifactObjectSize(context)
            : assertArtifactObjectSize(context.job.kind, repairResult.sizeBytes);
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for hierarchy');
        await processRecoveredReplayArtifact({
            artifactId: context.job.artifactId,
            data,
            expectedFrameCount: context.artifact.frameCount,
            job: context.job,
            log: context.log,
            sessionStartTime: context.session.startedAt.getTime(),
        });
        return { sizeBytes };
    },
};

export function getArtifactProcessor(kind: string | null | undefined): ArtifactProcessor | null {
    if (!kind) return null;
    return artifactProcessors[kind] ?? null;
}

export async function runArtifactProcessorByKind(
    kind: string | null | undefined,
    context: ArtifactProcessorContext,
): Promise<{ sizeBytes: number }> {
    const processor = getArtifactProcessor(kind);
    if (!processor) {
        throw new Error(`Unsupported artifact kind: ${kind}`);
    }
    return processor(context);
}

// ─── BullMQ-native processor entry point ─────────────────────────────────────

/**
 * Process one artifact job dispatched from a BullMQ Worker.
 *
 * BullMQ handles the job lifecycle automatically:
 *   - Moving the job to "active" when this function is entered
 *   - Marking it "completed" when this function resolves
 *   - Scheduling a retry (with exponential backoff) when this function throws
 *   - Moving to "failed" queue after all attempts are exhausted
 *
 * We therefore do NOT update ingest_jobs here.  All Postgres writes go to
 * recording_artifacts and the session/metrics tables, exactly as before.
 */
export async function processArtifactJobFromBullMQ(
    bullJob: Job<ArtifactJobData>,
    config: { workerId: string; maxAttempts: number },
): Promise<void> {
    const { artifactId, sessionId, s3ObjectKey, kind, endpointId } = bullJob.data;
    const attemptsMade = bullJob.attemptsMade ?? 0;  // 0-indexed; first attempt = 0

    // Build a context object shaped like the old ArtifactJobContext so all
    // sub-processors (ingestEventArtifactProcessor, etc.) work without changes.
    const jobCtx: ArtifactJobContext = {
        id: bullJob.id ?? artifactId,
        artifactId,
        sessionId,
        kind,
        s3ObjectKey,
        endpointId: endpointId ?? null,
        attemptsMade,
    };

    const log = logger.child({
        jobId: jobCtx.id,
        sessionId,
        artifactId,
        kind,
        attemptNumber: attemptsMade + 1,
        maxAttempts: config.maxAttempts,
        workerId: config.workerId,
    });

    // Validate required fields before touching DB
    if (!sessionId) throw new Error('Artifact job missing sessionId');
    if (!artifactId) throw new Error('Artifact job missing artifactId');
    if (!s3ObjectKey) throw new Error('Artifact job missing s3ObjectKey');

    const [sessionResult] = await db
        .select({
            session: sessions,
            project: projects,
            metrics: sessionMetrics,
        })
        .from(sessions)
        .leftJoin(projects, eq(sessions.projectId, projects.id))
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        // Session deleted — nothing to process; let BullMQ mark completed
        log.warn('Session not found, skipping artifact job');
        return;
    }

    const { session, project, metrics } = sessionResult;
    const projectId = project?.id || session.projectId;

    const [artifact] = await db
        .select()
        .from(recordingArtifacts)
        .where(eq(recordingArtifacts.id, artifactId))
        .limit(1);

    if (!artifact) {
        throw new Error('Artifact not found');
    }

    const artifactLog = log.child({
        projectId,
        s3Key: s3ObjectKey,
        endpointId: endpointId ?? null,
    });

    // If the artifact is already in ready state, just run completion effects.
    if (artifact.status === 'ready') {
        const reconcileResult = await reconcileSessionState(session.id);
        await runArtifactCompletionEffects({
            kind,
            replayAvailable: Boolean(reconcileResult?.replayAvailable),
            sessionId: session.id,
        });
        artifactLog.info('Artifact already ready; running completion effects without reprocessing');
        return;
    }

    // Run the kind-specific processor — throws on failure, BullMQ retries
    const { sizeBytes } = await runArtifactProcessorByKind(kind, {
        artifact,
        job: jobCtx,
        log: artifactLog,
        metrics,
        projectId,
        s3Key: s3ObjectKey,
        session,
    });

    const completedAt = new Date();

    // Mark artifact as ready in Postgres (skip SyncRep wait — idempotent on replay)
    await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL synchronous_commit = local`);
        await tx.update(recordingArtifacts)
            .set({
                status: 'ready',
                readyAt: completedAt,
                uploadCompletedAt: artifact.uploadCompletedAt ?? completedAt,
                verifiedAt: artifact.verifiedAt ?? completedAt,
                sizeBytes,
            })
            .where(eq(recordingArtifacts.id, artifactId));
    });

    // On final failure (all attempts exhausted), also mark artifact as failed.
    // We check this AFTER processing succeeds (this branch is never reached on fail),
    // but handle the DLQ case via the 'failed' worker event in startArtifactWorker.ts.
    // The artifact stays "uploaded" until retry succeeds or we mark it failed via
    // the markArtifactFailedAfterExhausted helper below.

    const reconcileResult = await reconcileSessionState(session.id);
    await runArtifactCompletionEffects({
        kind,
        replayAvailable: Boolean(reconcileResult?.replayAvailable),
        sessionId: session.id,
    });

    artifactLog.info(
        {
            event: 'artifact.processed',
            replayArtifact: kind === 'screenshots' || kind === 'hierarchy',
            actualObjectSize: sizeBytes,
        },
        'artifact.processed',
    );

    // BullMQ marks job completed on normal return — no explicit call needed.
}

/**
 * Called from the BullMQ 'failed' event (in startArtifactWorker.ts) once
 * a job has exhausted all retry attempts.  Marks the recording_artifact row
 * as 'failed' so the session lifecycle worker won't keep trying to recover it.
 */
export async function markArtifactFailedAfterExhausted(
    artifactId: string,
    errMsg: string,
): Promise<void> {
    try {
        await db.update(recordingArtifacts)
            .set({ status: 'failed' })
            .where(eq(recordingArtifacts.id, artifactId));
        logger.warn(
            { event: 'artifact.exhausted', artifactId, errMsg: errMsg.slice(0, 400) },
            'artifact.exhausted',
        );
    } catch (err) {
        logger.error({ err, artifactId }, 'Failed to mark artifact as failed after job exhausted');
    }
}
