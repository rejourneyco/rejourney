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
import { getRedis } from '../db/redis.js';
import { analyzeProjectFunnel } from '../services/funnelAnalysis.js';
import { downloadFromS3ForArtifact, getObjectSizeBytesForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { pingWorker, checkQueueHealth } from '../services/monitoring.js';
import { invalidateFrameCache, prewarmSessionScreenshotFrames } from '../services/screenshotFrames.js';
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
import { repairMissingSessionsFromIngestJobs } from '../services/ingestSessionLifecycle.js';
import { backfillArtifactDrivenLifecycleState, reconcileDueSessions, reconcileSessionState } from '../services/sessionReconciliation.js';

const POLL_INTERVAL_MS = 500;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = Number(process.env.RJ_INGEST_BATCH_SIZE ?? 20);
const JOB_PROCESS_CONCURRENCY = Number(process.env.RJ_INGEST_JOB_CONCURRENCY ?? 4);
const MAX_RUNNABLE_PER_SESSION = Math.max(1, Number(process.env.RJ_INGEST_MAX_RUNNABLE_PER_SESSION ?? 2));
const ALLOWED_JOB_KINDS = new Set(
    String(process.env.RJ_INGEST_ALLOWED_KINDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
);
const KIND_PRIORITY_ORDER = String(process.env.RJ_INGEST_KIND_PRIORITY ?? 'screenshots,hierarchy,events,crashes,anrs')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const KIND_PRIORITY = new Map(KIND_PRIORITY_ORDER.map((kind, index) => [kind, index]));
const SESSION_SWEEP_INTERVAL_MS = 10_000;
const ORPHAN_SESSION_SWEEP_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_ID = `${process.env.HOSTNAME || 'local'}:${process.pid}`;
const WORKER_MONITOR_NAME = (process.env.RJ_WORKER_NAME as 'ingestWorker' | 'replayWorker' | undefined) ?? 'ingestWorker';
const ENABLE_STARTUP_BACKFILL = process.env.INGEST_ENABLE_STARTUP_BACKFILL === 'true';

let lastSessionSweepAt = 0;
let lastOrphanSessionSweepAt = 0;
let lastHeartbeatAt = 0;

let isRunning = true;

// Avoid duplicate prewarm calls when multiple artifacts land close together.
const prewarmInFlight = new Set<string>();

async function invalidateSessionDetailCaches(sessionId: string): Promise<void> {
    try {
        await invalidateFrameCache(sessionId);
        await getRedis().del(
            `session_core:${sessionId}`,
            `session_timeline:${sessionId}`,
            `session_hierarchy:${sessionId}`,
        );
    } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to invalidate session detail caches after ingest');
    }
}

function kindPriority(kind: string | null | undefined): number {
    if (!kind) return KIND_PRIORITY.size + 1;
    return KIND_PRIORITY.get(kind) ?? (KIND_PRIORITY.size + 1);
}

function maybePrewarmReplayFrames(sessionId: string) {
    if (prewarmInFlight.has(sessionId)) return;
    prewarmInFlight.add(sessionId);
    prewarmSessionScreenshotFrames(sessionId)
        .then((ok) => {
            if (ok) {
                logger.info({ sessionId }, 'Prewarmed screenshot frames');
            }
        })
        .catch((err) => {
            logger.warn({ err, sessionId }, 'Failed to prewarm screenshot frames');
        })
        .finally(() => {
            prewarmInFlight.delete(sessionId);
        });
}

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
        const reconciled = await reconcileDueSessions(500, 20);
        if (abandoned > 0 || requeued > 0 || recovered > 0 || reconciled > 0) {
            logger.info({ abandoned, requeued, recovered, reconciled }, 'session.reconcile_sweep');
        }
    } catch (err) {
        logger.error({ err }, 'Session reconciliation sweep failed');
    }
}

async function runMissingSessionRepairIfDue(): Promise<void> {
    if (WORKER_MONITOR_NAME !== 'ingestWorker') return;

    const now = Date.now();
    if (now - lastOrphanSessionSweepAt < ORPHAN_SESSION_SWEEP_INTERVAL_MS) return;
    lastOrphanSessionSweepAt = now;

    try {
        const repaired = await repairMissingSessionsFromIngestJobs({
            since: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)),
            limit: 25,
            source: WORKER_MONITOR_NAME,
        });
        if (repaired.scanned > 0) {
            logger.info(repaired, 'session.repair_missing_sweep');
        }
    } catch (err) {
        logger.error({ err }, 'Missing session repair sweep failed');
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
            const reconcileResult = await reconcileSessionState(session.id);
            await invalidateSessionDetailCaches(session.id);
            if (job.kind === 'screenshots' && reconcileResult?.replayAvailable) {
                maybePrewarmReplayFrames(session.id);
            }
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

        const reconcileResult = await reconcileSessionState(session.id);
        await invalidateSessionDetailCaches(session.id);

        if (job.kind === 'screenshots' && reconcileResult?.replayAvailable) {
            maybePrewarmReplayFrames(session.id);
        }

        if (Number(pendingResult?.count ?? 0) === 0) {
            maybePrewarmReplayFrames(session.id);

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
        const message = `pending=${queueHealth.pendingJobs},dlq=${queueHealth.dlqJobs},replay_screenshots=${queueHealth.replayPendingByKind.screenshots},replay_hierarchy=${queueHealth.replayPendingByKind.hierarchy}`;
        await pingWorker(WORKER_MONITOR_NAME, 'up', message);
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
                        ALLOWED_JOB_KINDS.size > 0
                            ? sql`${ingestJobs.kind} in (${sql.join(Array.from(ALLOWED_JOB_KINDS).map((kind) => sql`${kind}`), sql`, `)})`
                            : sql`true`,
                        sql`${recordingArtifacts.status} in ('uploaded', 'ready')`,
                        or(
                            isNull(ingestJobs.nextRunAt),
                            lte(ingestJobs.nextRunAt, new Date())
                        )
                    )
                )
                .orderBy(asc(ingestJobs.createdAt))
                .limit(BATCH_SIZE);
            const runnableSource = jobs
                .map((row) => row.job)
                .sort((left, right) => {
                    const priorityDelta = kindPriority(left.kind) - kindPriority(right.kind);
                    if (priorityDelta !== 0) return priorityDelta;
                    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
                });

            if (runnableSource.length > 0) {
                logger.info({ count: runnableSource.length }, 'Processing ingest jobs');
                const perSessionCounts = new Map<string, number>();
                const runnableJobs = runnableSource.filter((job) => {
                    const key = job.sessionId || `job:${job.id}`;
                    const currentCount = perSessionCounts.get(key) ?? 0;
                    if (currentCount >= MAX_RUNNABLE_PER_SESSION) return false;
                    perSessionCounts.set(key, currentCount + 1);
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
            await runMissingSessionRepairIfDue();

            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        } catch (err) {
            logger.error({ err }, 'Error polling ingest jobs');
            await pingWorker(WORKER_MONITOR_NAME, 'down', String(err)).catch(() => { });
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
    if (!ENABLE_STARTUP_BACKFILL) {
        logger.info('Skipping artifact lifecycle backfill on startup; run the manual backfill command when needed');
        return;
    }

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
