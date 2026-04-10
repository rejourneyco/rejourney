import { and, eq, or, sql } from 'drizzle-orm';
import { db, ingestJobs, projects, recordingArtifacts, sessionMetrics, sessions } from '../db/client.js';
import { downloadFromS3ForArtifact, getObjectSizeBytesForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { ensureHierarchyArtifactCompressed } from './hierarchyArtifactCompression.js';
import { processEventsArtifact } from './ingestEventArtifactProcessor.js';
import { processAnrsArtifact, processCrashesArtifact } from './ingestFaultArtifactProcessors.js';
import { sanitizeIngestErrorMessage } from './ingestProtocol.js';
import { type ArtifactJobRecord, type ArtifactQueueConfig, markArtifactJobDone, markArtifactJobProcessing, scheduleArtifactJobRetry } from './ingestQueue.js';
import { processRecoveredReplayArtifact } from './ingestReplayArtifactProcessor.js';
import { runArtifactCompletionEffects } from './artifactCompletionEffects.js';
import { reconcileSessionState } from './sessionReconciliation.js';

type ArtifactProcessorContext = {
    artifact: typeof recordingArtifacts.$inferSelect;
    job: ArtifactJobRecord;
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
            artifactId: context.job.artifactId ?? undefined,
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
            artifactId: context.job.artifactId ?? undefined,
            sessionId: context.job.sessionId ?? undefined,
        });
        const sizeBytes = repairResult.sizeBytes == null
            ? await loadArtifactObjectSize(context)
            : assertArtifactObjectSize(context.job.kind, repairResult.sizeBytes);
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for hierarchy');
        await processRecoveredReplayArtifact({
            artifactId: context.job.artifactId ?? undefined,
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

async function countPendingSessionJobs(sessionId: string): Promise<number> {
    const [pendingResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(ingestJobs)
        .where(
            and(
                eq(ingestJobs.sessionId, sessionId),
                or(
                    eq(ingestJobs.status, 'pending'),
                    eq(ingestJobs.status, 'processing'),
                ),
            ),
        );

    return Number(pendingResult?.count ?? 0);
}

export async function processArtifactJob(
    job: ArtifactJobRecord,
    config: Pick<ArtifactQueueConfig, 'maxAttempts' | 'workerId'>,
): Promise<boolean> {
    const attemptNumber = Number(job.attempts || 0) + 1;
    const log = logger.child({
        jobId: job.id,
        sessionId: job.sessionId,
        artifactId: job.artifactId,
        kind: job.kind,
        attemptNumber,
        maxAttempts: config.maxAttempts,
    });

    try {
        log.debug('Processing artifact job');
        const startedAt = new Date();
        const sessionId = job.sessionId;
        const artifactId = job.artifactId;
        const s3Key = job.payloadRef;

        if (!sessionId) {
            throw new Error('Artifact job missing sessionId');
        }
        if (!artifactId) {
            throw new Error('Artifact job missing artifactId');
        }
        if (!s3Key) {
            throw new Error('Artifact job missing payloadRef');
        }

        await markArtifactJobProcessing(job.id, {
            attemptNumber,
            startedAt,
            workerId: config.workerId,
        });

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
            log.warn('Session not found, marking job as failed');
            await db.update(ingestJobs)
                .set({ status: 'failed', errorMsg: 'Session not found', completedAt: new Date(), updatedAt: new Date() })
                .where(eq(ingestJobs.id, job.id));
            return false;
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
            s3Key,
            endpointId: artifact.endpointId ?? null,
        });

        if (artifact.status === 'ready') {
            await markArtifactJobDone(job.id, new Date());
            const reconcileResult = await reconcileSessionState(session.id);
            await runArtifactCompletionEffects({
                kind: job.kind,
                replayAvailable: Boolean(reconcileResult?.replayAvailable),
                sessionId: session.id,
            });
            artifactLog.info('Artifact already ready; marked job done without reprocessing');
            return true;
        }

        const { sizeBytes } = await runArtifactProcessorByKind(job.kind, {
            artifact,
            job,
            log: artifactLog,
            metrics,
            projectId,
            s3Key,
            session,
        });

        const completedAt = new Date();
        await db.update(recordingArtifacts)
            .set({
                status: 'ready',
                readyAt: completedAt,
                uploadCompletedAt: artifact.uploadCompletedAt ?? completedAt,
                verifiedAt: artifact.verifiedAt ?? completedAt,
                sizeBytes,
            })
            .where(eq(recordingArtifacts.id, artifactId));

        await markArtifactJobDone(job.id, completedAt);

        const pendingJobsRemaining = await countPendingSessionJobs(session.id);
        const reconcileResult = await reconcileSessionState(session.id);
        await runArtifactCompletionEffects({
            kind: job.kind,
            replayAvailable: Boolean(reconcileResult?.replayAvailable),
            sessionId: session.id,
        });

        artifactLog.info({
            event: 'artifact.processed',
            replayArtifact: job.kind === 'screenshots' || job.kind === 'hierarchy',
            actualObjectSize: sizeBytes,
            pendingJobsRemaining,
        }, 'artifact.processed');
        return true;
    } catch (err) {
        log.error({ err }, 'Artifact job processing failed');

        const errorMsg = sanitizeIngestErrorMessage(err);
        await scheduleArtifactJobRetry({
            artifactId: job.artifactId,
            attemptNumber,
            errorMsg,
            jobId: job.id,
            log,
            maxAttempts: config.maxAttempts,
            kind: job.kind,
            sessionId: job.sessionId,
        });
        if (job.sessionId) {
            await reconcileSessionState(job.sessionId).catch((reconcileErr) => {
                logger.warn({ err: reconcileErr, sessionId: job.sessionId }, 'Failed to reconcile session after artifact failure');
            });
        }

        return false;
    }
}
