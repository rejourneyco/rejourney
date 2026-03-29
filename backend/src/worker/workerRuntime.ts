import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { checkQueueHealth, pingWorker, type WorkerName } from '../services/monitoring.js';

type PollingWorkerOptions = {
    heartbeatIntervalMs: number;
    onStartup?: () => Promise<void>;
    onTick: () => Promise<void>;
    pollIntervalMs: number;
    startupMessage?: string;
    workerName: WorkerName;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildQueueHeartbeatMessage(): Promise<string> {
    const queueHealth = await checkQueueHealth();
    return `pending=${queueHealth.pendingJobs},dlq=${queueHealth.dlqJobs},replay_screenshots=${queueHealth.replayPendingByKind.screenshots},replay_hierarchy=${queueHealth.replayPendingByKind.hierarchy}`;
}

export function startPollingWorker(options: PollingWorkerOptions): void {
    let isRunning = true;
    let lastHeartbeatAt = 0;

    async function sendHeartbeat(): Promise<void> {
        const now = Date.now();
        if (now - lastHeartbeatAt < options.heartbeatIntervalMs) return;
        lastHeartbeatAt = now;

        try {
            const message = await buildQueueHeartbeatMessage();
            await pingWorker(options.workerName, 'up', message);
        } catch (err) {
            logger.debug({ err, workerName: options.workerName }, 'Failed to send heartbeat');
        }
    }

    async function shutdown(signal: string): Promise<void> {
        logger.info({ signal, workerName: options.workerName }, 'Worker shutting down');
        isRunning = false;
        await pool.end();
        process.exit(0);
    }

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

    async function pollLoop(): Promise<void> {
        while (isRunning) {
            try {
                await sendHeartbeat();
                await options.onTick();
                await sleep(options.pollIntervalMs);
            } catch (err) {
                logger.error({ err, workerName: options.workerName }, 'Worker loop failed');
                await pingWorker(options.workerName, 'down', String(err)).catch(() => { });
                await sleep(5000);
            }
        }
    }

    logger.info({ workerName: options.workerName }, options.startupMessage ?? 'Worker started');
    Promise.resolve(options.onStartup?.())
        .then(() => pollLoop())
        .catch((err) => {
            logger.error({ err, workerName: options.workerName }, 'Worker fatal error');
            process.exit(1);
        });
}
