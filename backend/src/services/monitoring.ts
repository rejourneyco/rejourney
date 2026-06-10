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
import type { BullQueueCounts } from './artifactBullQueue.js';

// Worker names for monitoring
export type WorkerName =
    | 'api'
    | 'ingestWorker'
    | 'replayWorker'
    | 'sessionLifecycleWorker'
    | 'retentionWorker'
    | 'researchLakeWorker'
    | 'statsAggregator'
    | 'alertWorker'
    | 'revenueSyncWorker'
    | 'stripeSyncWorker';

export type WorkerMetric = {
    help: string;
    labels?: Record<string, string>;
    name: string;
    type?: 'gauge' | 'counter';
    value: number;
};

export interface QueueHealth {
    pendingJobs: number;
    processingJobs: number;
    dlqJobs: number;
    failedJobs: number;
    sessionEffectsWaiting: number;
    sessionEffectsActive: number;
    sessionEffectsFailed: number;
    sessionEventRollupWaiting: number;
    sessionEventRollupActive: number;
    sessionEventRollupFailed: number;
    oldestPendingAge: number | null;  // in seconds
    oldestReplayPendingAge: number | null;
    replayPendingByKind: {
        screenshots: number;
        hierarchy: number;
        rrweb: number;
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

function escapePrometheusLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderWorkerMetricSample(metric: WorkerMetric): string {
    const labels = metric.labels && Object.keys(metric.labels).length > 0
        ? `{${Object.entries(metric.labels)
            .map(([key, value]) => `${key}="${escapePrometheusLabelValue(String(value))}"`)
            .join(',')}}`
        : '';

    return `${metric.name}${labels} ${metric.value}\n`;
}

function renderWorkerMetrics(metrics: WorkerMetric[]): string {
    const declared = new Set<string>();
    let body = '';

    for (const metric of metrics) {
        if (!Number.isFinite(metric.value)) continue;
        if (!declared.has(metric.name)) {
            const type = metric.type ?? 'gauge';
            body +=
                `# TYPE ${metric.name} ${type}\n` +
                `# HELP ${metric.name} ${metric.help}\n`;
            declared.add(metric.name);
        }
        body += renderWorkerMetricSample(metric);
    }

    return body;
}

export function buildQueueHealthWorkerMetrics(queueHealth: QueueHealth): WorkerMetric[] {
    const statusValue = queueHealth.status === 'healthy'
        ? 0
        : queueHealth.status === 'degraded'
            ? 1
            : 2;

    return [
        {
            help: 'Logical queue health status: 0 healthy, 1 degraded, 2 critical',
            name: 'rejourney_queue_health_status',
            value: statusValue,
        },
        {
            help: 'Total pending jobs across primary ingest/flush queues',
            name: 'rejourney_queue_health_pending_jobs',
            value: queueHealth.pendingJobs,
        },
        {
            help: 'Total active jobs across artifact and session follow-up queues',
            name: 'rejourney_queue_health_processing_jobs',
            value: queueHealth.processingJobs,
        },
        {
            help: 'Total failed BullMQ jobs retained in DLQ windows',
            name: 'rejourney_queue_health_failed_jobs',
            value: queueHealth.dlqJobs,
        },
        {
            help: 'Session event rollup jobs waiting or delayed',
            name: 'rejourney_queue_health_session_event_rollup_waiting_jobs',
            value: queueHealth.sessionEventRollupWaiting,
        },
        {
            help: 'Session event rollup jobs active',
            name: 'rejourney_queue_health_session_event_rollup_active_jobs',
            value: queueHealth.sessionEventRollupActive,
        },
        {
            help: 'Session event rollup jobs failed',
            name: 'rejourney_queue_health_session_event_rollup_failed_jobs',
            value: queueHealth.sessionEventRollupFailed,
        },
        {
            help: 'Session effects jobs waiting or delayed',
            name: 'rejourney_queue_health_session_effects_waiting_jobs',
            value: queueHealth.sessionEffectsWaiting,
        },
        {
            help: 'Session effects jobs active',
            name: 'rejourney_queue_health_session_effects_active_jobs',
            value: queueHealth.sessionEffectsActive,
        },
        {
            help: 'Session effects jobs failed',
            name: 'rejourney_queue_health_session_effects_failed_jobs',
            value: queueHealth.sessionEffectsFailed,
        },
        {
            help: 'Stale pending replay artifacts detected by lifecycle monitoring',
            name: 'rejourney_queue_health_stale_pending_replay_artifacts',
            value: queueHealth.stalePendingReplayArtifacts,
        },
    ];
}

export async function collectBullQueueCountMetrics(): Promise<WorkerMetric[]> {
    const {
        FLUSH_QUEUE_NAME,
        INGEST_QUEUE_NAME,
        REPLAY_QUEUE_NAME,
        SESSION_EFFECTS_QUEUE_NAME,
        SESSION_EVENT_ROLLUP_QUEUE_NAME,
        getFlushQueueCounts,
        getIngestQueueCounts,
        getReplayQueueCounts,
        getSessionEffectsQueueCounts,
        getSessionEventRollupQueueCounts,
    } = await import('./artifactBullQueue.js');

    const queueCounts: Array<{ counts: BullQueueCounts; queue: string }> = await Promise.all([
        getIngestQueueCounts().then((counts) => ({ queue: INGEST_QUEUE_NAME, counts })),
        getReplayQueueCounts().then((counts) => ({ queue: REPLAY_QUEUE_NAME, counts })),
        getFlushQueueCounts().then((counts) => ({ queue: FLUSH_QUEUE_NAME, counts })),
        getSessionEffectsQueueCounts().then((counts) => ({ queue: SESSION_EFFECTS_QUEUE_NAME, counts })),
        getSessionEventRollupQueueCounts().then((counts) => ({ queue: SESSION_EVENT_ROLLUP_QUEUE_NAME, counts })),
    ]);

    const metrics: WorkerMetric[] = [];
    for (const { queue, counts } of queueCounts) {
        for (const state of ['waiting', 'delayed', 'active', 'failed'] as const) {
            metrics.push({
                help: 'BullMQ jobs by queue and state, sampled by worker heartbeat',
                labels: { queue, state },
                name: 'rejourney_bullmq_queue_jobs',
                value: counts[state],
            });
        }
    }

    return metrics;
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

        body += renderWorkerMetrics(extraMetrics);

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

        // Query BullMQ queue counts instead of ingest_jobs table.
        const { getFlushQueueCounts, getIngestQueueCounts, getReplayQueueCounts, getSessionEffectsQueueCounts, getSessionEventRollupQueueCounts } = await import('./artifactBullQueue.js');
        const [ingestCounts, replayCounts, flushCounts, sessionEffectsCounts, sessionEventRollupCounts] = await Promise.all([
            getIngestQueueCounts(),
            getReplayQueueCounts(),
            getFlushQueueCounts(),
            getSessionEffectsQueueCounts(),
            getSessionEventRollupQueueCounts(),
        ]);

        // BullMQ states → logical queue health mapping:
        //   waiting + delayed  → "pending" (ready or scheduled)
        //   active             → "processing"
        //   failed             → "dlq / failed" (all retries exhausted)
        const pendingJobs    = ingestCounts.waiting + ingestCounts.delayed + flushCounts.waiting + flushCounts.delayed;
        const sessionEffectsWaiting = sessionEffectsCounts.waiting + sessionEffectsCounts.delayed;
        const sessionEffectsActive = sessionEffectsCounts.active;
        const sessionEffectsFailed = sessionEffectsCounts.failed;
        const sessionEventRollupWaiting = sessionEventRollupCounts.waiting + sessionEventRollupCounts.delayed;
        const sessionEventRollupActive = sessionEventRollupCounts.active;
        const sessionEventRollupFailed = sessionEventRollupCounts.failed;
        const processingJobs = ingestCounts.active + replayCounts.active + flushCounts.active + sessionEffectsActive + sessionEventRollupActive;
        const dlqJobs        = ingestCounts.failed + replayCounts.failed + flushCounts.failed + sessionEffectsFailed + sessionEventRollupFailed;
        const failedJobs     = dlqJobs; // same concept in BullMQ — exhausted jobs
        const replayWaiting = replayCounts.waiting + replayCounts.delayed;
        const replayKindBase = Math.floor(replayWaiting / 3);
        const replayKindRemainder = replayWaiting % 3;
        const replayPendingByKind = {
            // Replay-queue waiting jobs can be screenshots, hierarchy, or rrweb.
            // Report an approximation here; exact split would require a job scan.
            rrweb: replayKindBase + (replayKindRemainder > 0 ? 1 : 0),
            screenshots: replayKindBase + (replayKindRemainder > 1 ? 1 : 0),
            hierarchy: replayKindBase,
        };
        // Oldest-pending-age is not cheaply available from BullMQ getJobCounts;
        // set to null to avoid a full job scan on every heartbeat.
        const oldestPendingAge: number | null = null;
        const oldestReplayPendingAge: number | null = null;

        // Stale replay artifacts: uses recording_artifacts_pending_stalled_idx
        const staleResult = await db.execute(sql`
            SELECT
                COUNT(*)::int                                          AS stale_count,
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::float  AS oldest_age_seconds
            FROM recording_artifacts
            WHERE status = 'pending'
              AND upload_completed_at IS NULL
              AND kind IN ('screenshots', 'hierarchy', 'rrweb')
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
            || replayPendingByKind.rrweb > 100
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
            sessionEffectsWaiting,
            sessionEffectsActive,
            sessionEffectsFailed,
            sessionEventRollupWaiting,
            sessionEventRollupActive,
            sessionEventRollupFailed,
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
            sessionEffectsWaiting: 0,
            sessionEffectsActive: 0,
            sessionEffectsFailed: 0,
            sessionEventRollupWaiting: 0,
            sessionEventRollupActive: 0,
            sessionEventRollupFailed: 0,
            oldestPendingAge: null,
            oldestReplayPendingAge: null,
            stalePendingReplayArtifacts: 0,
            oldestStalePendingReplayArtifactAge: null,
            replayPendingByKind: {
                screenshots: 0,
                hierarchy: 0,
                rrweb: 0,
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

    const message = `pending=${queueHealth.pendingJobs},dlq=${queueHealth.dlqJobs},replay_screenshots=${queueHealth.replayPendingByKind.screenshots},replay_hierarchy=${queueHealth.replayPendingByKind.hierarchy},replay_rrweb=${queueHealth.replayPendingByKind.rrweb},session_effects_waiting=${queueHealth.sessionEffectsWaiting},session_effects_active=${queueHealth.sessionEffectsActive},stale_replay_pending=${queueHealth.stalePendingReplayArtifacts}`;
    const metrics = [
        ...buildQueueHealthWorkerMetrics(queueHealth),
        ...await collectBullQueueCountMetrics(),
    ];

    await pingWorker('ingestWorker', status, message, processingTime, metrics);

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
