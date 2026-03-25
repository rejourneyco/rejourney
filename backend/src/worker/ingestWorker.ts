/**
 * Ingest Worker
 * 
 * Processes ingest jobs from the queue:
 * - Downloads artifacts from S3
 * - Extracts metrics (rage taps, screens, API calls)
 * - Updates session metrics + daily stats
 * - Computes UX scores
 */

import { eq, and, or, isNull, lte, asc, sql } from 'drizzle-orm';
import { db, pool, ingestJobs, sessions, sessionMetrics, projects, recordingArtifacts } from '../db/client.js';
import { analyzeProjectFunnel } from '../services/funnelAnalysis.js';
import { downloadFromS3ForArtifact, getObjectSizeBytesForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { pingWorker, checkQueueHealth } from '../services/monitoring.js';
import { prewarmSessionScreenshotFrames } from '../services/screenshotFrames.js';
import { ensureHierarchyArtifactCompressed } from '../services/hierarchyArtifactCompression.js';
import { sanitizeIngestErrorMessage } from '../services/ingestProtocol.js';
import {
    abandonExpiredPendingArtifacts,
    queueRecoverableArtifacts,
    requeueStaleProcessingJobs,
} from '../services/ingestArtifactLifecycle.js';
import { processEventsArtifact } from '../services/ingestEventArtifactProcessor.js';
import { processRecoveredReplayArtifact } from '../services/ingestReplayArtifactProcessor.js';
import { processAnrsArtifact, processCrashesArtifact } from '../services/ingestFaultArtifactProcessors.js';
import { backfillArtifactDrivenLifecycleState, reconcileDueSessions, reconcileSessionState } from '../services/sessionReconciliation.js';

const POLL_INTERVAL_MS = 500;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const JOB_PROCESS_CONCURRENCY = Number(process.env.RJ_INGEST_JOB_CONCURRENCY ?? 4);
const SESSION_SWEEP_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_ID = `${process.env.HOSTNAME || 'local'}:${process.pid}`;

let lastSessionSweepAt = 0;
let lastHeartbeatAt = 0;

let isRunning = true;

// Avoid duplicate prewarm calls when multiple artifacts land close together.
const prewarmInFlight = new Set<string>();

async function scheduleArtifactJobRetry(
    jobId: string,
    artifactId: string | null | undefined,
    attemptNumber: number,
    errorMsg: string,
    log: any,
): Promise<void> {
    if (attemptNumber >= MAX_ATTEMPTS) {
        await db.update(ingestJobs)
            .set({ status: 'dlq', errorMsg, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(ingestJobs.id, jobId));
        if (artifactId) {
            await db.update(recordingArtifacts)
                .set({ status: 'failed' })
                .where(eq(recordingArtifacts.id, artifactId));
        }
        log.warn({ attemptNumber, maxAttempts: MAX_ATTEMPTS }, 'Job moved to DLQ after max attempts');
        return;
    }

    const nextRunAt = new Date(Date.now() + Math.pow(2, attemptNumber) * 1000);
    await db.update(ingestJobs)
        .set({ status: 'pending', nextRunAt, errorMsg })
        .where(eq(ingestJobs.id, jobId));

    log.warn({
        attemptNumber,
        maxAttempts: MAX_ATTEMPTS,
        nextRunAt,
    }, 'Artifact job scheduled for retry');
}

async function runSessionSweepIfDue(): Promise<void> {
    const now = Date.now();
    if (now - lastSessionSweepAt < SESSION_SWEEP_INTERVAL_MS) return;
    lastSessionSweepAt = now;

    try {
        const abandoned = await abandonExpiredPendingArtifacts(100);
        const requeued = await requeueStaleProcessingJobs(100);
        const recovered = await queueRecoverableArtifacts(100);
        const reconciled = await reconcileDueSessions(100);
        if (abandoned > 0 || requeued > 0 || recovered > 0 || reconciled > 0) {
            logger.info({ abandoned, requeued, recovered, reconciled }, 'session.reconcile_sweep');
        }
    } catch (err) {
        logger.error({ err }, 'Session reconciliation sweep failed');
    }
}

/**
 * Process a single artifact job
 */
async function processArtifactJob(job: any): Promise<boolean> {
    const attemptNumber = Number(job.attempts || 0) + 1;
    const log = logger.child({
        jobId: job.id,
        sessionId: job.sessionId,
        artifactId: job.artifactId,
        kind: job.kind,
        attemptNumber,
        maxAttempts: MAX_ATTEMPTS,
    });

    try {
        log.debug('Processing artifact job');
        const startedAt = new Date();

        // Mark as processing
        await db.update(ingestJobs)
            .set({
                status: 'processing',
                attempts: attemptNumber,
                startedAt,
                workerId: WORKER_ID,
                updatedAt: startedAt,
            })
            .where(eq(ingestJobs.id, job.id));

        // Get session with project and metrics
        const [sessionResult] = await db
            .select({
                session: sessions,
                project: projects,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(projects, eq(sessions.projectId, projects.id))
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(eq(sessions.id, job.sessionId!))
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
        const s3Key = job.payloadRef;

        const [artifact] = await db
            .select()
            .from(recordingArtifacts)
            .where(eq(recordingArtifacts.id, job.artifactId))
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
            await db.update(ingestJobs)
                .set({ status: 'done', completedAt: new Date(), updatedAt: new Date() })
                .where(eq(ingestJobs.id, job.id));
            await reconcileSessionState(session.id);
            artifactLog.info('Artifact already ready; marked job done without reprocessing');
            return true;
        }

        let repairedHierarchySize: number | null = null;
        if (job.kind === 'hierarchy') {
            const repairResult = await ensureHierarchyArtifactCompressed({
                projectId,
                s3Key,
                endpointId: artifact.endpointId,
                artifactId: job.artifactId,
                sessionId: job.sessionId,
            });
            repairedHierarchySize = repairResult.sizeBytes;
        }

        const actualObjectSize = repairedHierarchySize
            ?? await getObjectSizeBytesForArtifact(projectId, s3Key, artifact.endpointId);

        if (typeof actualObjectSize !== 'number' || !Number.isFinite(actualObjectSize) || actualObjectSize <= 0) {
            throw new Error(`Artifact object not visible yet for ${job.kind}`);
        }

        let data: Buffer | null = null;
        // Process based on kind
        if (job.kind === 'events') {
            data = await downloadFromS3ForArtifact(projectId, s3Key, artifact.endpointId);
            if (!data) throw new Error('Artifact payload missing from S3 for events');
            await processEventsArtifact(job, session, metrics, projectId, data!, artifactLog);
        } else if (job.kind === 'crashes') {
            data = await downloadFromS3ForArtifact(projectId, s3Key, artifact.endpointId);
            if (!data) throw new Error('Artifact payload missing from S3 for crashes');
            await processCrashesArtifact(job, session, projectId, s3Key, data!, artifactLog);
        } else if (job.kind === 'anrs') {
            data = await downloadFromS3ForArtifact(projectId, s3Key, artifact.endpointId);
            if (!data) throw new Error('Artifact payload missing from S3 for anrs');
            artifactLog.info('Processing ANRs artifact');
            await processAnrsArtifact(job, session, projectId, s3Key, data!, artifactLog);
        } else if (job.kind === 'screenshots' || job.kind === 'hierarchy') {
            await processRecoveredReplayArtifact(job, artifactLog);
        }

        const completedAt = new Date();
        await db.update(recordingArtifacts)
            .set({
                status: 'ready',
                readyAt: completedAt,
                uploadCompletedAt: artifact.uploadCompletedAt ?? completedAt,
                verifiedAt: artifact.verifiedAt ?? completedAt,
                sizeBytes: actualObjectSize,
            })
            .where(eq(recordingArtifacts.id, job.artifactId));

        await db.update(ingestJobs)
            .set({ status: 'done', completedAt, updatedAt: completedAt })
            .where(eq(ingestJobs.id, job.id));

        const [pendingResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(ingestJobs)
            .where(
                and(
                    eq(ingestJobs.sessionId, session.id),
                    or(
                        eq(ingestJobs.status, 'pending'),
                        eq(ingestJobs.status, 'processing')
                    )
                )
            );

        await reconcileSessionState(session.id);

        if (Number(pendingResult?.count ?? 0) === 0) {
            if (!prewarmInFlight.has(session.id)) {
                prewarmInFlight.add(session.id);
                prewarmSessionScreenshotFrames(session.id)
                    .then((ok) => {
                        if (ok) {
                            logger.info({ sessionId: session.id }, 'Prewarmed screenshot frames after ingest completion');
                        }
                    })
                    .catch((err) => {
                        logger.warn({ err, sessionId: session.id }, 'Failed to prewarm screenshot frames');
                    })
                    .finally(() => {
                        prewarmInFlight.delete(session.id);
                    });
            }

            // LAZY FUNNEL LEARNING
            // Randomly trigger funnel analysis (5% chance) to keep the "Happy Path" up to date
            if (Math.random() < 0.05) {
                analyzeProjectFunnel(projectId).catch(err => {
                    logger.error({ err, projectId }, 'Failed to lazy-analyze project funnel');
                });
            }
        }

        artifactLog.info({
            actualObjectSize,
            pendingJobsRemaining: Number(pendingResult?.count ?? 0),
        }, 'artifact.processed');
        return true;

    } catch (err) {
        log.error({ err }, 'Artifact job processing failed');

        const errorMsg = sanitizeIngestErrorMessage(err);
        await scheduleArtifactJobRetry(job.id, job.artifactId, attemptNumber, errorMsg, log);
        if (job.sessionId) {
            await reconcileSessionState(job.sessionId).catch(reconcileErr => {
                logger.warn({ err: reconcileErr, sessionId: job.sessionId }, 'Failed to reconcile session after artifact failure');
            });
        }

        return false;
    }
}

/**
 * Process events artifact - extract metrics, update session
 */
async function sendHeartbeat(): Promise<void> {
    const now = Date.now();
    if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeatAt = now;

    try {
        const queueHealth = await checkQueueHealth();
        const message = `pending = ${queueHealth.pendingJobs}, dlq = ${queueHealth.dlqJobs} `;
        await pingWorker('ingestWorker', 'up', message);
    } catch (err) {
        logger.debug({ err }, 'Failed to send heartbeat');
    }
}

async function pollJobs(): Promise<void> {
    while (isRunning) {
        try {
            // Send heartbeat
            await sendHeartbeat();

            const jobs = await db
                .select({ job: ingestJobs })
                .from(ingestJobs)
                .innerJoin(recordingArtifacts, eq(recordingArtifacts.id, ingestJobs.artifactId))
                .where(
                    and(
                        eq(ingestJobs.status, 'pending'),
                        sql`${recordingArtifacts.status} in ('uploaded', 'ready')`,
                        or(
                            isNull(ingestJobs.nextRunAt),
                            lte(ingestJobs.nextRunAt, new Date())
                        )
                    )
                )
                .orderBy(asc(ingestJobs.createdAt))
                .limit(BATCH_SIZE);
            const runnableSource = jobs.map((row) => row.job);

            if (runnableSource.length > 0) {
                logger.info({ count: runnableSource.length }, 'Processing ingest jobs');
                const seenSessionIds = new Set<string>();
                const runnableJobs = runnableSource.filter((job) => {
                    const key = job.sessionId || `job:${job.id}`;
                    if (seenSessionIds.has(key)) return false;
                    seenSessionIds.add(key);
                    return true;
                });

                let cursor = 0;
                const workerCount = Math.max(1, Math.min(JOB_PROCESS_CONCURRENCY, runnableJobs.length));

                async function workerLoop() {
                    while (isRunning && cursor < runnableJobs.length) {
                        const idx = cursor++;
                        await processArtifactJob(runnableJobs[idx]);
                    }
                }

                await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
            }

            await runSessionSweepIfDue();

            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        } catch (err) {
            logger.error({ err }, 'Error polling ingest jobs');
            await pingWorker('ingestWorker', 'down', String(err)).catch(() => { });
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}

// Graceful shutdown
async function shutdown(signal: string) {
    logger.info({ signal }, 'Ingest worker shutting down...');
    isRunning = false;
    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// On startup, reset any jobs left stuck in 'processing' from a prior crash/restart.
async function recoverStuckJobs(): Promise<void> {
    try {
        const result = await db.update(ingestJobs)
            .set({ status: 'pending', updatedAt: new Date(), startedAt: null, workerId: null })
            .where(eq(ingestJobs.status, 'processing'));
        const count = (result as any).rowCount ?? 0;
        if (count > 0) {
            logger.info({ count }, 'Reset stuck processing jobs back to pending');
        }
    } catch (err) {
        logger.error({ err }, 'Failed to recover stuck processing jobs');
    }
}

function startArtifactLifecycleBackfill(): void {
    logger.info('Starting artifact lifecycle backfill in background');

    void backfillArtifactDrivenLifecycleState()
        .then(() => {
            logger.info('Artifact lifecycle backfill completed');
        })
        .catch((err) => {
            logger.error({ err }, 'Artifact lifecycle backfill failed');
        });
}

// Start worker
logger.info('Ingest worker started');
recoverStuckJobs()
    .then(() => {
        startArtifactLifecycleBackfill();
        logger.info('Ingest worker polling loop started');
        return pollJobs();
    })
    .catch((err) => {
    logger.error({ err }, 'Ingest worker fatal error');
    process.exit(1);
});
