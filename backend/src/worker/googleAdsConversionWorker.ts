/**
 * Delivers consented first-party conversion milestones to Google Ads through
 * the Data Manager API and polls Google's asynchronous processing diagnostics.
 */

import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { runGoogleAdsConversionDeliveryCycle } from '../services/googleAdsConversions.js';
import { pingWorker } from '../services/monitoring.js';

const WORKER_NAME = 'googleAdsConversionWorker';
const CYCLE_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

let cycleTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;
let cycleRunning = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function heartbeat(message = 'outbox=running'): Promise<void> {
    await pingWorker(WORKER_NAME, 'up', message).catch((error) => {
        logger.debug({ error }, 'Failed to send Google Ads conversion worker heartbeat');
    });
}

async function runCycle(): Promise<void> {
    if (cycleRunning || isShuttingDown) return;
    cycleRunning = true;
    try {
        const result = await runGoogleAdsConversionDeliveryCycle();
        await heartbeat(result.enabled
            ? `claimed=${result.claimed}`
            : 'disabled_by_configuration');
    } catch (error) {
        logger.error({ error }, 'Google Ads conversion delivery cycle failed');
        await pingWorker(WORKER_NAME, 'down', errorMessage(error)).catch(() => {});
    } finally {
        cycleRunning = false;
        if (!isShuttingDown) {
            cycleTimer = setTimeout(() => void runCycle(), CYCLE_INTERVAL_MS);
        }
    }
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Google Ads conversion worker shutting down');
    if (cycleTimer) clearTimeout(cycleTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await pool.end();
    process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Google Ads conversion worker uncaught exception');
    void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (error) => {
    logger.error({ error }, 'Google Ads conversion worker unhandled rejection');
    void shutdown('unhandledRejection', 1);
});

heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
void runCycle();
