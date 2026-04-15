/**
 * Monitoring Service
 *
 * Pushes worker heartbeat metrics to Prometheus Pushgateway.
 * VictoriaMetrics scrapes the Pushgateway; Grafana alerts on stale workers.
 *
 * Environment Variables:
 *   PUSHGATEWAY_URL: Base URL for Prometheus Pushgateway
 *
 * Example:
 *   PUSHGATEWAY_URL=http://pushgateway.rejourney.svc.cluster.local:9091 (in-cluster; set in k8s)
 *
 * Grafana alert to detect stale workers:
 *   time() - worker_last_heartbeat_unix{job="ingestWorker"} > 240
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logger } from '../logger.js';
import { ABANDONED_ARTIFACT_TTL_MS, REPLAY_PENDING_ARTIFACT_GRACE_MS } from './ingestUploadRelay.js';

// Worker names for monitoring
export type WorkerName =
    | 'api'
    | 'ingestWorker'
    | 'replayWorker'
    | 'sessionLifecycleWorker'
    | 'retentionWorker'
    | 'statsAggregator'
    | 'alertWorker'
    | 'stripeSyncWorker';

interface QueueHealth {
    pendingJobs: number;
    processingJobs: number;
    dlqJobs: number;
    failedJobs: number;
    oldestPendingAge: number | null;  // in seconds
    oldestReplayPendingAge: number | null;
    replayPendingByKind: {
        screenshots: number;
        hierarchy: number;
    };
    stalePendingReplayArtifacts: number;
    oldestStalePendingReplayArtifactAge: number | null;
    status: 'healthy' | 'degraded' | 'critical';
}

interface WorkerHealthMetrics {
    name: WorkerName;
    status: 'up' | 'down';
    lastRunTime?: Date | null;
    message?: string;
    metrics?: Record<string, number | string>;
}

function getPushgatewayUrl(): string | null {
    return process.env.PUSHGATEWAY_URL ?? null;
}

/**
 * Push a heartbeat metric to Prometheus Pushgateway for a specific worker.
 *
 * Pushes two gauges:
 *   worker_up{job="<workerName>"}                  — 1 if up, 0 if down
 *   worker_last_heartbeat_unix{job="<workerName>"}  — unix timestamp of this push
 *
 * @param workerName - Name of the worker (used as the Pushgateway job label)
 * @param status - 'up' or 'down'
 * @param message - Optional message (logged on down status)
 * @param ping - Optional processing time in ms (pushed as worker_heartbeat_duration_ms)
 */
export async function pingWorker(
    workerName: WorkerName,
    status: 'up' | 'down' = 'up',
    message?: string,
    ping?: number
): Promise<void> {
    const baseUrl = getPushgatewayUrl();

    if (!baseUrl) {
        logger.debug({ workerName }, 'Pushgateway not configured, skipping heartbeat');
        return;
    }

    if (status === 'down' && message) {
        logger.warn({ workerName, message }, 'Worker reported down status');
    }

    try {
        const workerUp = status === 'up' ? 1 : 0;
        const nowSeconds = Date.now() / 1000;

        let body =
            `# TYPE worker_up gauge\n` +
            `# HELP worker_up 1 if worker is healthy, 0 if down\n` +
            `worker_up ${workerUp}\n` +
            `# TYPE worker_last_heartbeat_unix gauge\n` +
            `# HELP worker_last_heartbeat_unix Unix timestamp of last worker heartbeat\n` +
            `worker_last_heartbeat_unix ${nowSeconds}\n`;

        if (ping !== undefined) {
            body +=
                `# TYPE worker_heartbeat_duration_ms gauge\n` +
                `# HELP worker_heartbeat_duration_ms Processing time of last worker run in ms\n` +
                `worker_heartbeat_duration_ms ${ping}\n`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(`${baseUrl}/metrics/job/${workerName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body,
                signal: controller.signal,
            });

            if (!response.ok) {
                logger.warn({ workerName, status: response.status }, 'Pushgateway push failed');
            }
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        // Don't let monitoring failures affect worker operation
        logger.debug({ workerName, error }, 'Failed to send heartbeat to Pushgateway');
    }
}

/**
 * Check queue health by counting jobs in different states
 */
export async function checkQueueHealth(): Promise<QueueHealth> {
    try {
        const staleReplayArtifactCutoffSeconds = Math.floor(ABANDONED_ARTIFACT_TTL_MS / 1000);
        const replayGraceSeconds = Math.floor(REPLAY_PENDING_ARTIFACT_GRACE_MS / 1000);
        const result = await db.execute(sql`
            SELECT
                COUNT(*) FILTER (WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= NOW())) as pending_jobs,
                COUNT(*) FILTER (WHERE status = 'processing') as processing_jobs,
                COUNT(*) FILTER (WHERE status = 'dlq') as dlq_jobs,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= NOW())))) as oldest_pending_age,
                COUNT(*) FILTER (WHERE status = 'pending' AND kind = 'screenshots' AND (next_run_at IS NULL OR next_run_at <= NOW())) as replay_screenshots_pending,
                COUNT(*) FILTER (WHERE status = 'pending' AND kind = 'hierarchy' AND (next_run_at IS NULL OR next_run_at <= NOW())) as replay_hierarchy_pending,
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending' AND kind IN ('screenshots', 'hierarchy') AND (next_run_at IS NULL OR next_run_at <= NOW())))) as oldest_replay_pending_age,
                (
                    SELECT COUNT(*)
                    FROM recording_artifacts ra
                    WHERE ra.status = 'pending'
                      AND ra.upload_completed_at IS NULL
                      AND ra.kind IN ('screenshots', 'hierarchy')
                      AND ra.created_at <= NOW() - (${staleReplayArtifactCutoffSeconds} * interval '1 second')
                ) as stale_pending_replay_artifacts,
                (
                    SELECT EXTRACT(EPOCH FROM (
                        NOW() - MIN(ra.created_at)
                    ))
                    FROM recording_artifacts ra
                    WHERE ra.status = 'pending'
                      AND ra.upload_completed_at IS NULL
                      AND ra.kind IN ('screenshots', 'hierarchy')
                      AND ra.created_at <= NOW() - (${staleReplayArtifactCutoffSeconds} * interval '1 second')
                ) as oldest_stale_pending_replay_artifact_age
            FROM ingest_jobs
        `);

        const row = (result as any).rows?.[0];

        const pendingJobs = Number(row?.pending_jobs ?? 0);
        const processingJobs = Number(row?.processing_jobs ?? 0);
        const dlqJobs = Number(row?.dlq_jobs ?? 0);
        const failedJobs = Number(row?.failed_jobs ?? 0);
        const oldestPendingAge = row?.oldest_pending_age ? Number(row.oldest_pending_age) : null;
        const oldestReplayPendingAge = row?.oldest_replay_pending_age ? Number(row.oldest_replay_pending_age) : null;
        const stalePendingReplayArtifacts = Number(row?.stale_pending_replay_artifacts ?? 0);
        const oldestStalePendingReplayArtifactAge = row?.oldest_stale_pending_replay_artifact_age
            ? Number(row.oldest_stale_pending_replay_artifact_age)
            : null;
        const replayPendingByKind = {
            screenshots: Number(row?.replay_screenshots_pending ?? 0),
            hierarchy: Number(row?.replay_hierarchy_pending ?? 0),
        };

        // Determine status based on thresholds
        let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

        // Critical if DLQ has jobs or oldest pending job is > 1 hour old
        if (
            dlqJobs > 0
            || (oldestPendingAge && oldestPendingAge > 3600)
            || (oldestReplayPendingAge && oldestReplayPendingAge > 900)
            || (oldestStalePendingReplayArtifactAge && oldestStalePendingReplayArtifactAge > replayGraceSeconds)
        ) {
            status = 'critical';
        }
        // Degraded if too many pending jobs or oldest is > 10 min old
        else if (
            pendingJobs > 100
            || (oldestPendingAge && oldestPendingAge > 600)
            || replayPendingByKind.screenshots > 100
            || replayPendingByKind.hierarchy > 100
            || stalePendingReplayArtifacts > 50
            || (oldestStalePendingReplayArtifactAge && oldestStalePendingReplayArtifactAge > staleReplayArtifactCutoffSeconds)
        ) {
            status = 'degraded';
        }

        return {
            pendingJobs,
            processingJobs,
            dlqJobs,
            failedJobs,
            oldestPendingAge,
            oldestReplayPendingAge,
            stalePendingReplayArtifacts,
            oldestStalePendingReplayArtifactAge,
            replayPendingByKind,
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
            oldestReplayPendingAge: null,
            stalePendingReplayArtifacts: 0,
            oldestStalePendingReplayArtifactAge: null,
            replayPendingByKind: {
                screenshots: 0,
                hierarchy: 0,
            },
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

    const message = `pending=${queueHealth.pendingJobs},dlq=${queueHealth.dlqJobs},replay_screenshots=${queueHealth.replayPendingByKind.screenshots},replay_hierarchy=${queueHealth.replayPendingByKind.hierarchy},stale_replay_pending=${queueHealth.stalePendingReplayArtifacts}`;

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
        'replayWorker',
        'retentionWorker',
        'statsAggregator',
        'alertWorker',
        'stripeSyncWorker',
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
