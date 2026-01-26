/**
 * Monitoring Service
 * 
 * Utility to ping Uptime Kuma Push URLs and report health metrics.
 * 
 * Environment Variables:
 *   UPTIME_KUMA_BASE_URL: Base URL for Uptime Kuma push endpoints
 *   UPTIME_KUMA_TOKENS: JSON object mapping worker names to push tokens
 * 
 * Example:
 *   UPTIME_KUMA_BASE_URL=https://status.rejourney.co
 *   UPTIME_KUMA_TOKENS={"ingestWorker":"abc123","billingWorker":"def456"}
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logger } from '../logger.js';

// Worker names for monitoring
export type WorkerName =
    | 'api'
    | 'ingestWorker'
    | 'retentionWorker'
    | 'statsAggregator'
    | 'alertWorker';

interface UptimeKumaConfig {
    baseUrl: string;
    tokens: Record<WorkerName, string>;
}

interface QueueHealth {
    pendingJobs: number;
    processingJobs: number;
    dlqJobs: number;
    failedJobs: number;
    oldestPendingAge: number | null;  // in seconds
    status: 'healthy' | 'degraded' | 'critical';
}

interface WorkerHealthMetrics {
    name: WorkerName;
    status: 'up' | 'down';
    lastRunTime?: Date | null;
    message?: string;
    metrics?: Record<string, number | string>;
}

// Parse Uptime Kuma configuration from environment
function getUptimeKumaConfig(): UptimeKumaConfig | null {
    const baseUrl = process.env.UPTIME_KUMA_BASE_URL;
    const tokensJson = process.env.UPTIME_KUMA_TOKENS;

    if (!baseUrl || !tokensJson) {
        return null;
    }

    try {
        const tokens = JSON.parse(tokensJson) as Record<WorkerName, string>;
        return { baseUrl, tokens };
    } catch (e) {
        logger.warn('Failed to parse UPTIME_KUMA_TOKENS');
        return null;
    }
}

/**
 * Send a heartbeat to Uptime Kuma for a specific worker
 * 
 * @param workerName - Name of the worker
 * @param status - 'up' or 'down' status
 * @param message - Optional message (e.g., error details)
 * @param ping - Optional ping/latency value in ms
 */
export async function pingWorker(
    workerName: WorkerName,
    status: 'up' | 'down' = 'up',
    message?: string,
    ping?: number
): Promise<void> {
    const kumaConfig = getUptimeKumaConfig();

    if (!kumaConfig) {
        // Monitoring not configured, skip silently
        logger.debug({ workerName }, 'Uptime Kuma not configured, skipping heartbeat');
        return;
    }

    const token = kumaConfig.tokens[workerName];
    if (!token) {
        logger.debug({ workerName }, 'No Uptime Kuma token for worker');
        return;
    }

    try {
        // Uptime Kuma Push URL format: BASE_URL/api/push/TOKEN?status=up&msg=MSG&ping=PING
        const url = new URL(`/api/push/${token}`, kumaConfig.baseUrl);
        url.searchParams.set('status', status);

        if (message) {
            url.searchParams.set('msg', message);
        }
        if (ping !== undefined) {
            url.searchParams.set('ping', String(ping));
        }

        // Create abort controller with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                signal: controller.signal,
            });

            if (!response.ok) {
                logger.warn({
                    workerName,
                    status: response.status
                }, 'Uptime Kuma push failed');
            }
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        // Don't let monitoring failures affect worker operation
        logger.debug({ workerName, error }, 'Failed to send heartbeat to Uptime Kuma');
    }
}

/**
 * Check queue health by counting jobs in different states
 */
export async function checkQueueHealth(): Promise<QueueHealth> {
    try {
        const result = await db.execute(sql`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
                COUNT(*) FILTER (WHERE status = 'processing') as processing_jobs,
                COUNT(*) FILTER (WHERE status = 'dlq') as dlq_jobs,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending'))) as oldest_pending_age
            FROM ingest_jobs
        `);

        const row = (result as any).rows?.[0];

        const pendingJobs = Number(row?.pending_jobs ?? 0);
        const processingJobs = Number(row?.processing_jobs ?? 0);
        const dlqJobs = Number(row?.dlq_jobs ?? 0);
        const failedJobs = Number(row?.failed_jobs ?? 0);
        const oldestPendingAge = row?.oldest_pending_age ? Number(row.oldest_pending_age) : null;

        // Determine status based on thresholds
        let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

        // Critical if DLQ has jobs or oldest pending job is > 1 hour old
        if (dlqJobs > 0 || (oldestPendingAge && oldestPendingAge > 3600)) {
            status = 'critical';
        }
        // Degraded if too many pending jobs or oldest is > 10 min old
        else if (pendingJobs > 100 || (oldestPendingAge && oldestPendingAge > 600)) {
            status = 'degraded';
        }

        return {
            pendingJobs,
            processingJobs,
            dlqJobs,
            failedJobs,
            oldestPendingAge,
            status,
        };
    } catch (error) {
        logger.error({ error }, 'Failed to check queue health');
        return {
            pendingJobs: 0,
            processingJobs: 0,
            dlqJobs: 0,
            failedJobs: 0,
            oldestPendingAge: null,
            status: 'critical',
        };
    }
}

/**
 * Send a heartbeat with queue health metrics
 */
export async function pingIngestWorkerWithQueueHealth(
    status: 'up' | 'down',
    processingTime?: number
): Promise<void> {
    const queueHealth = await checkQueueHealth();

    const message = `pending=${queueHealth.pendingJobs},dlq=${queueHealth.dlqJobs}`;

    await pingWorker('ingestWorker', status, message, processingTime);

    // Also ping a separate queue monitor if configured
    if (queueHealth.status !== 'healthy') {
        logger.warn({ queueHealth }, 'Queue health degraded');
    }
}

/**
 * Get all worker statuses from Redis
 */
export async function getWorkerStatuses(): Promise<Record<WorkerName, WorkerHealthMetrics>> {
    const { getRedis } = await import('../db/redis.js');
    const redis = getRedis();

    const workers: WorkerName[] = [
        'ingestWorker',
        'retentionWorker',
        'statsAggregator',
        'alertWorker',
    ];

    const statuses: Record<WorkerName, WorkerHealthMetrics> = {} as any;

    for (const worker of workers) {
        const lastRunKey = `${worker}:last_run`;
        const lastRunTime = await redis.get(lastRunKey);

        statuses[worker] = {
            name: worker,
            status: 'up', // Assume up if we can check
            lastRunTime: lastRunTime ? new Date(lastRunTime) : null,
        };
    }

    return statuses;
}

/**
 * Report comprehensive health metrics
 */
export async function getHealthMetrics(): Promise<{
    queue: QueueHealth;
    workers: Record<WorkerName, WorkerHealthMetrics>;
}> {
    const [queue, workers] = await Promise.all([
        checkQueueHealth(),
        getWorkerStatuses(),
    ]);

    return { queue, workers };
}
