import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { pingWorker } from '../services/monitoring.js';
import {
    FLUSH_QUEUE_NAME,
    INGEST_QUEUE_NAME,
    REPLAY_QUEUE_NAME,
    createArtifactBullWorker,
    type ArtifactFlushJobData,
    type ArtifactJobData,
    type Job,
} from '../services/artifactBullQueue.js';
import { processArtifactFlushJobFromBullMQ } from '../services/artifactFlushJobProcessor.js';
import { markArtifactFailedAfterExhausted, processArtifactJobFromBullMQ } from '../services/artifactJobProcessor.js';
import { markArtifactFlushFailedAfterExhausted } from '../services/ingestArtifactLifecycle.js';
import type { ArtifactWorkerDefinition } from './workerDefinitions.js';

const WORKER_ID = `${process.env.HOSTNAME || 'local'}:${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 5;
const FLUSH_MAX_ATTEMPTS = 8;

export function startArtifactWorker(definition: ArtifactWorkerDefinition): void {
    const isReplayWorker = definition.allowedKinds.includes('screenshots')
        || definition.allowedKinds.includes('hierarchy')
        || definition.allowedKinds.includes('rrweb');

    const queueName = isReplayWorker ? REPLAY_QUEUE_NAME : INGEST_QUEUE_NAME;
    const concurrency = definition.defaultJobProcessConcurrency;

    logger.info(
        { workerName: definition.workerName, queueName, concurrency, workerId: WORKER_ID },
        'Artifact BullMQ worker starting',
    );

    async function processor(job: Job<ArtifactJobData>): Promise<void> {
        await processArtifactJobFromBullMQ(job, {
            workerId: WORKER_ID,
            maxAttempts: MAX_ATTEMPTS,
        });
    }

    const worker = createArtifactBullWorker(queueName, processor, concurrency);
    const workersToClose: Array<{ close: () => Promise<void> }> = [worker];

    if (!isReplayWorker) {
        const flushWorker = createArtifactBullWorker<ArtifactFlushJobData>(
            FLUSH_QUEUE_NAME,
            processArtifactFlushJobFromBullMQ,
            concurrency,
        );
        workersToClose.push(flushWorker);

        flushWorker.on('active', (job: Job<ArtifactFlushJobData>) => {
            logger.info(
                {
                    event: 'artifact_flush_worker.job_active',
                    workerName: definition.workerName,
                    jobId: job.id,
                    artifactId: job.data.artifactId,
                },
                'artifact_flush_worker.job_active',
            );
        });

        flushWorker.on('failed', (job: Job<ArtifactFlushJobData> | undefined, err: Error) => {
            const maxAttempts = typeof job?.opts?.attempts === 'number'
                ? job.opts.attempts
                : FLUSH_MAX_ATTEMPTS;
            const isExhausted = job != null
                && typeof job.attemptsMade === 'number'
                && job.attemptsMade >= maxAttempts;

            if (isExhausted && job?.data?.artifactId) {
                void markArtifactFlushFailedAfterExhausted(job.data.artifactId, err?.message ?? 'unknown');
            }
        });
    }

    // ── Heartbeat ──────────────────────────────────────────────────────────────
    let lastHeartbeatAt = 0;

    async function sendHeartbeat(): Promise<void> {
        const now = Date.now();
        if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
        lastHeartbeatAt = now;
        try {
            const { getFlushQueueCounts, getIngestQueueCounts, getReplayQueueCounts } = await import('../services/artifactBullQueue.js');
            const counts = isReplayWorker
                ? await getReplayQueueCounts()
                : await getIngestQueueCounts();
            let msg = `waiting=${counts.waiting},active=${counts.active},failed=${counts.failed}`;
            if (!isReplayWorker) {
                const flushCounts = await getFlushQueueCounts();
                msg += `,flush_waiting=${flushCounts.waiting + flushCounts.delayed},flush_active=${flushCounts.active},flush_failed=${flushCounts.failed}`;
            }
            await pingWorker(definition.workerName, 'up', msg);
        } catch (err) {
            logger.debug({ err, workerName: definition.workerName }, 'Failed to send heartbeat');
        }
    }

    worker.on('completed', () => {
        void sendHeartbeat();
    });

    // When all retry attempts are exhausted, mark the artifact row as 'failed'
    // so the session lifecycle worker doesn't keep trying to recover it.
    worker.on('failed', (job: Job<ArtifactJobData> | undefined, err: Error) => {
        const isExhausted = job != null
            && typeof job.attemptsMade === 'number'
            && job.attemptsMade >= MAX_ATTEMPTS - 1;

        if (isExhausted && job?.data?.artifactId) {
            void markArtifactFailedAfterExhausted(job.data.artifactId, err?.message ?? 'unknown');
        }
    });

    // Also send a heartbeat on a timer so idle workers still check in
    const heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);

    // ── Log replay batches (matches old worker verbosity) ──────────────────────
    if (isReplayWorker) {
        worker.on('active', (job: Job<ArtifactJobData>) => {
            logger.info(
                {
                    event: 'replay_worker.job_active',
                    workerName: definition.workerName,
                    jobId: job.id,
                    sessionId: job.data.sessionId,
                    artifactId: job.data.artifactId,
                    kind: job.data.kind,
                },
                'replay_worker.job_active',
            );
        });
    }

    // ── Graceful shutdown ──────────────────────────────────────────────────────
    async function shutdown(signal: string): Promise<void> {
        logger.info({ signal, workerName: definition.workerName }, 'Worker shutting down');
        clearInterval(heartbeatTimer);
        await Promise.all(workersToClose.map((artifactWorker) => artifactWorker.close()));
        await pool.end();
        process.exit(0);
    }

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Send initial heartbeat
    void sendHeartbeat();
}
