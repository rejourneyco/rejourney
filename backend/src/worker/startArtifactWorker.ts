import { logger } from '../logger.js';
import { processArtifactJob } from '../services/artifactJobProcessor.js';
import { createArtifactQueueConfig, recoverStuckArtifactJobs, selectRunnableArtifactJobs } from '../services/ingestQueue.js';
import type { ArtifactWorkerDefinition } from './workerDefinitions.js';
import { startPollingWorker } from './workerRuntime.js';

const POLL_INTERVAL_MS = 500;
const WORKER_ID = `${process.env.HOSTNAME || 'local'}:${process.pid}`;
const MAX_ATTEMPTS = 5;
const HEARTBEAT_INTERVAL_MS = 60_000;

export function startArtifactWorker(definition: ArtifactWorkerDefinition): void {
    const queueConfig = createArtifactQueueConfig({
        allowedKinds: definition.allowedKinds,
        defaultBatchSize: definition.defaultBatchSize,
        defaultJobProcessConcurrency: definition.defaultJobProcessConcurrency,
        defaultMaxRunnablePerSession: definition.defaultMaxRunnablePerSession,
        kindPriority: definition.kindPriority,
        maxAttempts: MAX_ATTEMPTS,
        workerId: WORKER_ID,
    });

    startPollingWorker({
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        onStartup: async () => {
            const recoveredCount = await recoverStuckArtifactJobs();
            if (recoveredCount > 0) {
                logger.info({ count: recoveredCount, workerName: definition.workerName }, 'Reset stuck processing jobs back to pending');
            }
        },
        onTick: async () => {
            const runnableJobs = await selectRunnableArtifactJobs(queueConfig);
            if (runnableJobs.length === 0) {
                return;
            }

            logger.info({ count: runnableJobs.length, workerName: definition.workerName }, 'Processing ingest jobs');

            let cursor = 0;
            const workerCount = Math.max(1, Math.min(queueConfig.jobProcessConcurrency, runnableJobs.length));

            async function workerLoop() {
                while (cursor < runnableJobs.length) {
                    const idx = cursor++;
                    await processArtifactJob(runnableJobs[idx], queueConfig);
                }
            }

            await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
        },
        pollIntervalMs: POLL_INTERVAL_MS,
        startupMessage: 'Artifact worker started',
        workerName: definition.workerName,
    });
}
