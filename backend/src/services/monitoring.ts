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
    | 'stripeSyncWorker'
    | 'dashboardPrewarmWorker';

export type WorkerMetric = {
    help: string;
    labels?: Record<string, string>;
    name: string;
    type?: 'gauge' | 'counter';
    value: number;
};

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

type QueueHealthJobRow = {
    status: string;
    kind: string | null;
    is_due: boolean;
    job_count: number | string;
    oldest_created: Date | string | null;
};

function getPushgatewayUrl(): string | null {
    return process.env.PUSHGATEWAY_URL ?? null;
}

function escapePrometheusLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderWorkerMetric(metric: WorkerMetric): string {
    const labels = metric.labels && Object.keys(metric.labels).length > 0
        ? `{${Object.entries(metric.labels)
            .map(([key, value]) => `${key}="${escapePrometheusLabelValue(String(value))}"`)
            .join(',')}}`
        : '';

    const type = metric.type ?? 'gauge';
    return (
        `# TYPE ${metric.name} ${type}\n` +
        `# HELP ${metric.name} ${metric.help}\n` +
        `${metric.name}${labels} ${metric.value}\n`
    );
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
    ping?: number,
    extraMetrics: WorkerMetric[] = [],
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

        for (const metric of extraMetrics) {
            body += renderWorkerMetric(metric);
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

// Cache key and TTL for checkQueueHealth results.
// Three artifact workers call this every ~60s each; caching means the
// expensive DB query runs at most once per 30s regardless of caller count.
const QUEUE_HEALTH_CACHE_KEY = 'monitoring:queue_health';
const QUEUE_HEALTH_TTL_S = 30;

/**
 * Check queue health by counting jobs in different states.
 *
 * Performance notes:
 *   - The main ingest_jobs query only touches non-done rows
 *     (~68K rows via ingest_jobs_monitoring_idx), avoiding the previous
 *     full 8.4M-row seq scan that cost ~4.6s per call.
 *   - Results are cached in Redis for 30s so concurrent worker heartbeats
 *     (3 workers × every 60s) share a single DB hit.
 *   - The two recording_artifacts subqueries use recording_artifacts_pending_stalled_idx
 *     (kind, created_at WHERE status='pending' AND upload_completed_at IS NULL).
 */
export async function checkQueueHealth(): Promise<QueueHealth> {
    try {
        const { getRedis } = await import('../db/redis.js');
        const redis = getRedis();

        // Return cached result if fresh enough
        const cached = await redis.get(QUEUE_HEALTH_CACHE_KEY);
        if (cached) {
            return JSON.parse(cached) as QueueHealth;
        }

        const staleReplayArtifactCutoffSeconds = Math.floor(ABANDONED_ARTIFACT_TTL_MS / 1000);
        const replayGraceSeconds = Math.floor(REPLAY_PENDING_ARTIFACT_GRACE_MS / 1000);

        // Query only non-terminal rows — uses ingest_jobs_monitoring_idx.
        // Returns ≤ ~30 rows grouped by (status, kind, is_due) instead of scanning 8.4M rows.
        const jobsResult = await db.execute(sql`
            SELECT
                status,
                kind,
                (next_run_at IS NULL OR next_run_at <= NOW()) AS is_due,
                COUNT(*)::int                                  AS job_count,
                MIN(created_at)                                AS oldest_created
            FROM ingest_jobs
            WHERE status IN ('pending', 'processing', 'dlq', 'failed')
            GROUP BY status, kind, is_due
        `);

        const rawJobRows = ((((jobsResult as unknown) as { rows?: QueueHealthJobRow[] }).rows) ?? []);
        const jobRows: QueueHealthJobRow[] = rawJobRows.map((row) => ({
            ...row,
            is_due: Boolean(row.is_due),
        }));

        const sumCount = (rows: QueueHealthJobRow[]): number =>
            rows.reduce((acc: number, row: QueueHealthJobRow) => acc + Number(row.job_count), 0);

        const oldestAgeSeconds = (rows: QueueHealthJobRow[]): number | null => {
            const dates = rows
                .map((row: QueueHealthJobRow) => row.oldest_created)
                .map((value: Date | string | null) => value == null ? null : new Date(value))
                .filter((value: Date | null): value is Date => value != null && !Number.isNaN(value.getTime()));
            if (dates.length === 0) return null;
            const oldest = new Date(Math.min(...dates.map((date: Date) => date.getTime())));
            return (Date.now() - oldest.getTime()) / 1000;
        };

        const pendingDue = jobRows.filter((row: QueueHealthJobRow) => row.status === 'pending' && row.is_due);
        const replayPendingDue = pendingDue.filter(
            (row: QueueHealthJobRow) => row.kind === 'screenshots' || row.kind === 'hierarchy',
        );

        const pendingJobs     = sumCount(pendingDue);
        const processingJobs  = sumCount(jobRows.filter(r => r.status === 'processing'));
        const dlqJobs         = sumCount(jobRows.filter(r => r.status === 'dlq'));
        const failedJobs      = sumCount(jobRows.filter(r => r.status === 'failed'));
        const oldestPendingAge = oldestAgeSeconds(pendingDue);
        const oldestReplayPendingAge = oldestAgeSeconds(replayPendingDue);
        const replayPendingByKind = {
            screenshots: sumCount(pendingDue.filter((row: QueueHealthJobRow) => row.kind === 'screenshots')),
            hierarchy: sumCount(pendingDue.filter((row: QueueHealthJobRow) => row.kind === 'hierarchy')),
        };

        // Stale replay artifacts: uses recording_artifacts_pending_stalled_idx
        const staleResult = await db.execute(sql`
            SELECT
                COUNT(*)::int                                          AS stale_count,
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::float  AS oldest_age_seconds
            FROM recording_artifacts
            WHERE status = 'pending'
              AND upload_completed_at IS NULL
              AND kind IN ('screenshots', 'hierarchy')
              AND created_at <= NOW() - (${staleReplayArtifactCutoffSeconds} * interval '1 second')
        `);

        const staleRow = (staleResult as any).rows?.[0];
        const stalePendingReplayArtifacts = Number(staleRow?.stale_count ?? 0);
        const oldestStalePendingReplayArtifactAge = staleRow?.oldest_age_seconds
            ? Number(staleRow.oldest_age_seconds)
            : null;

        // Determine status based on thresholds
        let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

        if (
            dlqJobs > 0
            || (oldestPendingAge && oldestPendingAge > 3600)
            || (oldestReplayPendingAge && oldestReplayPendingAge > 900)
            || (oldestStalePendingReplayArtifactAge && oldestStalePendingReplayArtifactAge > replayGraceSeconds)
        ) {
            status = 'critical';
        } else if (
            pendingJobs > 100
            || (oldestPendingAge && oldestPendingAge > 600)
            || replayPendingByKind.screenshots > 100
            || replayPendingByKind.hierarchy > 100
            || stalePendingReplayArtifacts > 50
            || (oldestStalePendingReplayArtifactAge && oldestStalePendingReplayArtifactAge > staleReplayArtifactCutoffSeconds)
        ) {
            status = 'degraded';
        }

        const health: QueueHealth = {
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

        // Cache for 30s — safe for health checks and worker heartbeats
        await redis.set(QUEUE_HEALTH_CACHE_KEY, JSON.stringify(health), 'EX', QUEUE_HEALTH_TTL_S);

        return health;
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
        'dashboardPrewarmWorker',
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
