import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, recordingArtifacts, sessionMetrics, sessions } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { downloadFromS3ForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import {
    SESSION_EVENT_ROLLUP_QUEUE_NAME,
    createArtifactBullWorker,
    getSessionEventRollupQueue,
    type Job,
    type SessionEventRollupJobData,
} from './artifactBullQueue.js';
import type { ArtifactJobContext } from './artifactJobProcessor.js';
import { processEventsArtifact } from './ingestEventArtifactProcessor.js';
import { enqueueSessionEffectsJob } from './sessionEffectsQueue.js';

const DEFAULT_SESSION_EVENT_ROLLUP_DELAY_MS = 60_000;
const DEFAULT_SESSION_EVENT_ROLLUP_CONCURRENCY = 48;
const DEFAULT_SESSION_EVENT_ROLLUP_BATCH_SIZE = 250;
const DEFAULT_SESSION_EVENT_ROLLUP_LOCK_TTL_MS = 10 * 60_000;
const SESSION_EVENT_ROLLUP_DIRTY_TTL_MS = 24 * 60 * 60_000;
const SESSION_EVENT_ROLLUP_BUSY_RETRY_DELAY_MS = 30_000;

function parseBoundedInteger(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function resolveSessionEventRollupDelayMs(raw = process.env.RJ_SESSION_EVENT_ROLLUP_DELAY_MS): number {
    return parseBoundedInteger(raw, DEFAULT_SESSION_EVENT_ROLLUP_DELAY_MS, 500, 60_000);
}

export function resolveSessionEventRollupConcurrency(raw = process.env.RJ_SESSION_EVENT_ROLLUP_CONCURRENCY): number {
    return parseBoundedInteger(raw, DEFAULT_SESSION_EVENT_ROLLUP_CONCURRENCY, 1, 64);
}

export function resolveSessionEventRollupBatchSize(raw = process.env.RJ_SESSION_EVENT_ROLLUP_BATCH_SIZE): number {
    return parseBoundedInteger(raw, DEFAULT_SESSION_EVENT_ROLLUP_BATCH_SIZE, 1, 250);
}

export function resolveSessionEventRollupLockTtlMs(raw = process.env.RJ_SESSION_EVENT_ROLLUP_LOCK_TTL_MS): number {
    return parseBoundedInteger(raw, DEFAULT_SESSION_EVENT_ROLLUP_LOCK_TTL_MS, 30_000, 60 * 60_000);
}

export function shouldSweepPendingSessionEventRollups(
    raw = process.env.RJ_SESSION_EVENT_ROLLUP_SWEEP_ENABLED,
): boolean {
    if (!raw) return false;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function buildSessionEventRollupJobId(
    sessionId: string,
    _nowMs = Date.now(),
    _delayMs = resolveSessionEventRollupDelayMs(),
): string {
    return `session-event-rollup-${sessionId}`;
}

function buildSessionEventRollupRetryJobId(
    sessionId: string,
    nowMs = Date.now(),
    delayMs = SESSION_EVENT_ROLLUP_BUSY_RETRY_DELAY_MS,
): string {
    const dueBucket = Math.floor((nowMs + delayMs) / Math.max(1, delayMs));
    return `session-event-rollup-${sessionId}-retry-${dueBucket}`;
}

function rollupDirtyKey(sessionId: string): string {
    return `dirty:session-event-rollup:${sessionId}`;
}

async function markRollupDirty(sessionId: string): Promise<void> {
    await getRedis().set(rollupDirtyKey(sessionId), '1', 'PX', SESSION_EVENT_ROLLUP_DIRTY_TTL_MS);
}

async function clearRollupDirty(sessionId: string): Promise<void> {
    await getRedis().del(rollupDirtyKey(sessionId));
}

async function hasRollupDirty(sessionId: string): Promise<boolean> {
    return (await getRedis().exists(rollupDirtyKey(sessionId))) > 0;
}

export async function enqueueSessionEventRollupJob(
    sessionId: string,
    options: { delayMs?: number; nowMs?: number } = {},
): Promise<boolean> {
    if (!sessionId) return false;

    const delayMs = options.delayMs ?? resolveSessionEventRollupDelayMs();
    const queue = getSessionEventRollupQueue();
    const jobId = buildSessionEventRollupJobId(sessionId, options.nowMs ?? Date.now(), delayMs);
    await markRollupDirty(sessionId);

    const existing = await queue.getJob(jobId);

    if (existing) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
            logger.debug({ sessionId, jobId, existingState: state }, 'session.event_rollup_job_already_exists');
            return false;
        }
        await existing.remove().catch(() => {/* ignore races */});
    }

    await queue.add('session-event-rollup', { sessionId }, { jobId, delay: delayMs });
    logger.debug({ sessionId, jobId, delayMs }, 'session.event_rollup_job_enqueued');
    return true;
}

async function enqueueSessionEventRollupRetryJob(
    sessionId: string,
    delayMs = SESSION_EVENT_ROLLUP_BUSY_RETRY_DELAY_MS,
): Promise<boolean> {
    const queue = getSessionEventRollupQueue();
    const jobId = buildSessionEventRollupRetryJobId(sessionId, Date.now(), delayMs);
    const existing = await queue.getJob(jobId);

    if (existing) {
        logger.debug({ sessionId, jobId }, 'session.event_rollup_job_already_exists');
        return false;
    }

    await queue.add('session-event-rollup', { sessionId }, { jobId, delay: delayMs });
    logger.debug({ sessionId, jobId, delayMs }, 'session.event_rollup_job_enqueued');
    return true;
}

function rollupLockKey(sessionId: string): string {
    return `lock:session-event-rollup:${sessionId}`;
}

async function acquireRollupLock(sessionId: string): Promise<string | null> {
    const token = `${process.env.HOSTNAME || 'local'}:${process.pid}:${Date.now()}:${Math.random()}`;
    const result = await getRedis().set(
        rollupLockKey(sessionId),
        token,
        'PX',
        resolveSessionEventRollupLockTtlMs(),
        'NX',
    );
    return result === 'OK' ? token : null;
}

async function releaseRollupLock(sessionId: string, token: string): Promise<void> {
    await getRedis().eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        rollupLockKey(sessionId),
        token,
    );
}

function pendingEventRollupPredicate(sessionId?: string) {
    const predicates = [
        eq(recordingArtifacts.kind, 'events'),
        eq(recordingArtifacts.status, 'ready'),
        isNotNull(recordingArtifacts.eventRollupRequestedAt),
        isNull(recordingArtifacts.eventRollupProcessedAt),
    ];
    if (sessionId) predicates.push(eq(recordingArtifacts.sessionId, sessionId));
    return and(...predicates);
}

async function ensureSessionRollupMetrics(sessionId: string): Promise<void> {
    await db.insert(sessionMetrics)
        .values({ sessionId })
        .onConflictDoNothing();
}

async function loadSessionRollupContext(sessionId: string) {
    const [row] = await db
        .select({
            metrics: sessionMetrics,
            session: {
                anonymousHash: sessions.anonymousHash,
                appVersion: sessions.appVersion,
                deviceId: sessions.deviceId,
                deviceModel: sessions.deviceModel,
                explicitEndedAt: sessions.explicitEndedAt,
                id: sessions.id,
                isReplayExpired: sessions.isReplayExpired,
                osVersion: sessions.osVersion,
                platform: sessions.platform,
                projectId: sessions.projectId,
                recordingDeleted: sessions.recordingDeleted,
                sdkVersion: sessions.sdkVersion,
                startedAt: sessions.startedAt,
                status: sessions.status,
                userDisplayId: sessions.userDisplayId,
            },
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    return row ?? null;
}

export async function processSessionEventRollupBatch(
    sessionId: string,
    batchSize = resolveSessionEventRollupBatchSize(),
): Promise<{ hasMore: boolean; processed: number }> {
    const artifacts = await db
        .select({
            endpointId: recordingArtifacts.endpointId,
            id: recordingArtifacts.id,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
        })
        .from(recordingArtifacts)
        .where(pendingEventRollupPredicate(sessionId))
        .orderBy(recordingArtifacts.createdAt, recordingArtifacts.id)
        .limit(batchSize + 1);

    const batch = artifacts.slice(0, batchSize);
    let processed = 0;

    if (batch.length > 0) {
        // The row is invariant for this session and the per-session lease prevents
        // concurrent rollups. Creating it once avoids one redundant INSERT for
        // every artifact while the context SELECT below still refreshes mutable
        // session and metrics fields between artifacts.
        await ensureSessionRollupMetrics(sessionId);
    }

    for (const artifact of batch) {
        const context = await loadSessionRollupContext(sessionId);
        if (!context) {
            logger.warn({ sessionId }, 'session.event_rollup_session_missing');
            break;
        }

        const data = await downloadFromS3ForArtifact(
            context.session.projectId,
            artifact.s3ObjectKey,
            artifact.endpointId,
        );
        if (!data) {
            throw new Error(`Event artifact payload missing from S3: ${artifact.id}`);
        }

        const jobContext: ArtifactJobContext = {
            attemptsMade: 0,
            artifactId: artifact.id,
            endpointId: artifact.endpointId,
            id: `session-event-rollup-${artifact.id}`,
            kind: 'events',
            s3ObjectKey: artifact.s3ObjectKey,
            sessionId,
        };
        const log = logger.child({
            artifactId: artifact.id,
            event: 'session.event_rollup_artifact',
            sessionId,
        });

        await processEventsArtifact(
            jobContext,
            context.session,
            context.metrics,
            context.session.projectId,
            data,
            log,
            { recomputeMobileFrustrationCounts: false },
        );

        await db.update(recordingArtifacts)
            .set({ eventRollupProcessedAt: new Date() })
            .where(eq(recordingArtifacts.id, artifact.id));
        processed += 1;
    }

    return {
        hasMore: artifacts.length > batchSize,
        processed,
    };
}

export async function processSessionEventRollupJobFromBullMQ(
    job: Job<SessionEventRollupJobData>,
): Promise<void> {
    const sessionId = job.data.sessionId;
    if (!sessionId) {
        throw new Error('Session event rollup job missing sessionId');
    }

    const log = logger.child({
        event: 'session.event_rollup_job',
        jobId: job.id,
        sessionId,
        attemptNumber: (job.attemptsMade ?? 0) + 1,
    });
    const lockToken = await acquireRollupLock(sessionId);

    if (!lockToken) {
        await markRollupDirty(sessionId);
        const requeued = await enqueueSessionEventRollupRetryJob(sessionId);
        log.info({ requeued }, 'session.event_rollup_lock_busy');
        return;
    }

    try {
        await clearRollupDirty(sessionId);
        const result = await processSessionEventRollupBatch(sessionId);
        const dirty = await hasRollupDirty(sessionId);
        if (result.processed > 0) {
            await enqueueSessionEffectsJob(sessionId);
        }
        if (result.hasMore || dirty) {
            await enqueueSessionEventRollupRetryJob(
                sessionId,
                result.hasMore ? 1_000 : resolveSessionEventRollupDelayMs(),
            );
        }

        log.info({ ...result, dirty }, 'session.event_rollup_job_processed');
    } finally {
        await releaseRollupLock(sessionId, lockToken);
    }
}

export async function queuePendingSessionEventRollups(limit = 100): Promise<number> {
    if (!shouldSweepPendingSessionEventRollups()) {
        return 0;
    }

    const rows = await db
        .select({ sessionId: recordingArtifacts.sessionId })
        .from(recordingArtifacts)
        .where(pendingEventRollupPredicate())
        .groupBy(recordingArtifacts.sessionId)
        .limit(limit);

    let queued = 0;
    for (const row of rows) {
        if (await enqueueSessionEventRollupJob(row.sessionId)) {
            queued += 1;
        }
    }
    return queued;
}

export function startSessionEventRollupWorker(): { close: () => Promise<void> } {
    const concurrency = resolveSessionEventRollupConcurrency();
    logger.info(
        { queueName: SESSION_EVENT_ROLLUP_QUEUE_NAME, concurrency },
        'Session event rollup BullMQ worker starting',
    );

    return createArtifactBullWorker<SessionEventRollupJobData>(
        SESSION_EVENT_ROLLUP_QUEUE_NAME,
        processSessionEventRollupJobFromBullMQ,
        concurrency,
    );
}
