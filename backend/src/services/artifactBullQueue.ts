/**
 * Artifact BullMQ Queues
 *
 * Two queues backed by the existing Redis Sentinel cluster:
 *   rj:ingest-artifacts  — events, crashes, anrs   (was polled from ingest_jobs)
 *   rj:replay-artifacts  — screenshots, hierarchy  (was polled from ingest_jobs)
 *
 * Using jobId = `artifact-{artifactId}` gives natural deduplication:
 * BullMQ will not enqueue a second job for the same artifact while the first
 * is still waiting/active (returns null from queue.add when deduplicated).
 *
 * Connection notes:
 *   - BullMQ requires maxRetriesPerRequest: null on its ioredis connections.
 *   - We create dedicated IORedis instances (separate from getRedis()) because
 *     BullMQ internally needs a subscriber connection plus a command connection
 *     and those must not be shared with the app's general Redis client.
 */

import { createRequire } from 'module';
import type { Job, Queue, Worker } from 'bullmq';
import { config } from '../config.js';
import { logger } from '../logger.js';

export type { Job };

// Use createRequire for ioredis CJS module (same pattern as redis.ts)
const require = createRequire(import.meta.url);
const IORedis = require('ioredis');

// ─── Job data shape ───────────────────────────────────────────────────────────

export type ArtifactJobData = {
    artifactId: string;
    sessionId: string;
    projectId: string;
    kind: string;
    s3ObjectKey: string;
    endpointId: string | null;
};

// ─── Queue names ──────────────────────────────────────────────────────────────

export const INGEST_QUEUE_NAME = 'rj-ingest-artifacts';
export const REPLAY_QUEUE_NAME = 'rj-replay-artifacts';

const REPLAY_KINDS = new Set(['screenshots', 'hierarchy']);

// ─── Connection factory ───────────────────────────────────────────────────────

/**
 * Creates a fresh IORedis connection suitable for BullMQ.
 * BullMQ requires maxRetriesPerRequest: null — it manages its own retry loop.
 * Called once per queue / worker instance; BullMQ internally creates two
 * connections per Worker (commands + blocking subscribe).
 */
export function createBullMQRedisConnection() {
    if (config.REDIS_SENTINEL_HOST) {
        return new IORedis({
            sentinels: [{ host: config.REDIS_SENTINEL_HOST, port: config.REDIS_SENTINEL_PORT ?? 26379 }],
            name: config.REDIS_MASTER_NAME ?? 'mymaster',
            password: config.REDIS_PASSWORD ?? undefined,
            sentinelPassword: config.REDIS_PASSWORD ?? undefined,
            role: 'master',
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });
    }
    return new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        password: config.REDIS_PASSWORD ?? undefined,
    });
}

// ─── Queue singletons ─────────────────────────────────────────────────────────

let _ingestQueue: Queue<ArtifactJobData> | null = null;
let _replayQueue: Queue<ArtifactJobData> | null = null;

const DEFAULT_JOB_OPTIONS = {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: { age: 3600 },        // keep completed jobs 1 h for observability
    removeOnFail: { age: 7 * 24 * 3600 },   // keep failed jobs 7 days (DLQ window)
};

export function getIngestQueue(): Queue<ArtifactJobData> {
    if (!_ingestQueue) {
        // Dynamic import so the module can be loaded in environments without bullmq
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Queue: BullQueue } = require('bullmq');
        _ingestQueue = new BullQueue(INGEST_QUEUE_NAME, {
            connection: createBullMQRedisConnection(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }
    return _ingestQueue!;
}

export function getReplayQueue(): Queue<ArtifactJobData> {
    if (!_replayQueue) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Queue: BullQueue } = require('bullmq');
        _replayQueue = new BullQueue(REPLAY_QUEUE_NAME, {
            connection: createBullMQRedisConnection(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }
    return _replayQueue!;
}

export function getQueueForKind(kind: string): Queue<ArtifactJobData> {
    if (REPLAY_KINDS.has(kind)) return getReplayQueue();
    return getIngestQueue();
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Enqueue an artifact job.
 *
 * Uses `jobId = artifact-{artifactId}` for deduplication — BullMQ will not
 * add a duplicate if a job with that ID already exists in waiting/active state.
 * Returns true if a new job was added, false if a live job already existed.
 */
export async function enqueueArtifactJob(data: ArtifactJobData): Promise<boolean> {
    const queue = getQueueForKind(data.kind);
    const jobId = `artifact-${data.artifactId}`;

    // Check for an existing live job so we can log accurately
    const existing = await queue.getJob(jobId);
    if (existing) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
            logger.debug({
                artifactId: data.artifactId,
                kind: data.kind,
                sessionId: data.sessionId,
                existingState: state,
            }, 'artifact.bullmq_job_already_exists');
            return false;
        }
        // Stale completed/failed entry — remove it so we can add fresh
        await existing.remove().catch(() => {/* ignore races */});
    }

    await queue.add(data.kind, data, { jobId });
    return true;
}

// ─── Remove ───────────────────────────────────────────────────────────────────

/**
 * Remove a waiting/delayed artifact job (e.g. when the upload was interrupted
 * or the artifact is being abandoned).  Active jobs are left alone — the worker
 * will fail them naturally and BullMQ will handle retry/failure.
 */
export async function removeArtifactJobIfQueued(artifactId: string, kind: string): Promise<void> {
    try {
        const queue = getQueueForKind(kind);
        const job = await queue.getJob(`artifact-${artifactId}`);
        if (!job) return;
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed') {
            await job.remove();
            logger.debug({ artifactId, kind }, 'artifact.bullmq_job_removed');
        }
    } catch (err) {
        logger.warn({ err, artifactId, kind }, 'artifact.bullmq_job_remove_failed');
    }
}

// ─── Health / counts ──────────────────────────────────────────────────────────

export type BullQueueCounts = {
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
};

export async function getIngestQueueCounts(): Promise<BullQueueCounts> {
    const q = getIngestQueue();
    const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
    return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
    };
}

export async function getReplayQueueCounts(): Promise<BullQueueCounts> {
    const q = getReplayQueue();
    const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
    return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
    };
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export type ArtifactWorkerProcessor = (job: Job<ArtifactJobData>) => Promise<void>;

export function createArtifactBullWorker(
    queueName: string,
    processor: ArtifactWorkerProcessor,
    concurrency: number,
): Worker<ArtifactJobData> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Worker: BullWorker } = require('bullmq');
    const worker: Worker<ArtifactJobData> = new BullWorker(
        queueName,
        processor,
        {
            connection: createBullMQRedisConnection(),
            concurrency,
            // Mark a job stalled if the worker hasn't sent a keepalive within 30s.
            // Stalled jobs are automatically moved back to waiting so another worker picks them up.
            stalledInterval: 30_000,
            maxStalledCount: 3,
        },
    );

    worker.on('error', (err: Error) => {
        logger.error({ err, queueName }, 'bullmq.worker_error');
    });

    worker.on('failed', (job: Job<ArtifactJobData> | undefined, err: Error) => {
        logger.warn(
            {
                event: 'artifact.bullmq_job_failed',
                jobId: job?.id,
                artifactId: job?.data?.artifactId,
                sessionId: job?.data?.sessionId,
                kind: job?.data?.kind,
                attemptsMade: job?.attemptsMade,
                errMsg: err?.message?.slice(0, 400),
                queueName,
            },
            'artifact.bullmq_job_failed',
        );
    });

    worker.on('stalled', (jobId: string) => {
        logger.warn({ jobId, queueName }, 'artifact.bullmq_job_stalled');
    });

    return worker;
}
