import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { pingWorker } from '../services/monitoring.js';
import {
    INGEST_QUEUE_NAME,
    REPLAY_QUEUE_NAME,
    createArtifactBullWorker,
    type ArtifactJobData,
    type Job,
} from '../services/artifactBullQueue.js';
import { markArtifactFailedAfterExhausted, processArtifactJobFromBullMQ } from '../services/artifactJobProcessor.js';
import type { ArtifactWorkerDefinition } from './workerDefinitions.js';

const WORKER_ID = `${process.env.HOSTNAME || 'local'}:${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 5;

export function startArtifactWorker(definition: ArtifactWorkerDefinition): void {
    const isReplayWorker = definition.allowedKinds.includes('screenshots')
        || definition.allowedKinds.includes('hierarchy');

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

    // ── Heartbeat ──────────────────────────────────────────────────────────────
    let lastHeartbeatAt = 0;

    async function sendHeartbeat(): Promise<void> {
        const now = Date.now();
        if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
        lastHeartbeatAt = now;
        try {
            const { getIngestQueueCounts, getReplayQueueCounts } = await import('../services/artifactBullQueue.js');
            const counts = isReplayWorker
                ? await getReplayQueueCounts()
                : await getIngestQueueCounts();
            const msg = `waiting=${counts.waiting},active=${counts.active},failed=${counts.failed}`;
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
        await worker.close();
        await pool.end();
        process.exit(0);
    }

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Send initial heartbeat
    void sendHeartbeat();
}
