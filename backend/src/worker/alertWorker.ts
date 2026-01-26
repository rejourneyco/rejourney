/**
 * Alert Worker
 * 
 * A lightweight worker that checks for spike conditions every 15 minutes
 * to provide faster alerting than the daily rollup.
 * 
 * Checks:
 * - Error rate spikes (comparing last 15 min vs previous hour)
 * - API latency degradation (comparing last 15 min vs previous hour)
 * - High crash/ANR rates
 */

import { eq, gte, and, sql, desc } from 'drizzle-orm';
import { db, pool, sessions, sessionMetrics, issues } from '../db/client.js';
import { getRedis, initRedis, closeRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { pingWorker } from '../services/monitoring.js';
import {
    triggerErrorSpikeAlert,
    triggerApiDegradationAlert
} from '../services/alertService.js';

// Worker state
let isRunning = false;
let lastRunTime: Date | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let workerShouldRun = true;

// Thresholds
const ERROR_SPIKE_THRESHOLD = 2.0; // 2x increase triggers alert
const LATENCY_SPIKE_THRESHOLD = 2.0; // 2x increase triggers alert
const MIN_SESSIONS_FOR_ALERT = 5; // Minimum sessions in period to trigger alert
const RUN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

interface ProjectMetrics {
    projectId: string;
    errorRate: number;
    avgLatencyMs: number;
    sessionCount: number;
}

/**
 * Get metrics for the last N minutes for all active projects
 */
async function getRecentMetrics(minutesAgo: number): Promise<ProjectMetrics[]> {
    const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000);

    const results = await db
        .select({
            projectId: sessions.projectId,
            errorRate: sql<number>`avg(coalesce(${sessionMetrics.apiErrorCount}::float / nullif(${sessionMetrics.apiTotalCount}, 0), 0))`,
            avgLatencyMs: sql<number>`avg(${sessionMetrics.apiAvgResponseMs})`,
            sessionCount: sql<number>`count(*)::int`,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(gte(sessions.startedAt, cutoff))
        .groupBy(sessions.projectId);

    return results.map(r => ({
        projectId: r.projectId,
        errorRate: r.errorRate || 0,
        avgLatencyMs: r.avgLatencyMs || 0,
        sessionCount: r.sessionCount || 0,
    }));
}

/**
 * Compare current metrics with baseline and trigger alerts if needed
 */
async function checkForSpikes(): Promise<void> {
    try {
        // Get metrics for last 15 minutes (current)
        const currentMetrics = await getRecentMetrics(15);

        // Get metrics for previous hour (45 min before current window)
        const baselineMetrics = await getRecentMetrics(60);

        // Create lookup for baseline
        const baselineLookup = new Map<string, ProjectMetrics>();
        for (const m of baselineMetrics) {
            baselineLookup.set(m.projectId, m);
        }

        for (const current of currentMetrics) {
            // Skip if not enough sessions
            if (current.sessionCount < MIN_SESSIONS_FOR_ALERT) {
                continue;
            }

            const baseline = baselineLookup.get(current.projectId);
            if (!baseline || baseline.sessionCount < MIN_SESSIONS_FOR_ALERT) {
                continue;
            }

            // Check error rate spike
            if (baseline.errorRate > 0 && current.errorRate > 0) {
                const errorMultiplier = current.errorRate / baseline.errorRate;
                if (errorMultiplier >= ERROR_SPIKE_THRESHOLD) {
                    logger.info({
                        projectId: current.projectId,
                        currentErrorRate: current.errorRate,
                        baselineErrorRate: baseline.errorRate,
                        multiplier: errorMultiplier,
                    }, 'Error spike detected');

                    await triggerErrorSpikeAlert(
                        current.projectId,
                        current.errorRate * 100,
                        baseline.errorRate * 100
                    );
                }
            }

            // Check latency spike
            if (baseline.avgLatencyMs > 0 && current.avgLatencyMs > 0) {
                const latencyMultiplier = current.avgLatencyMs / baseline.avgLatencyMs;
                if (latencyMultiplier >= LATENCY_SPIKE_THRESHOLD) {
                    logger.info({
                        projectId: current.projectId,
                        currentLatency: current.avgLatencyMs,
                        baselineLatency: baseline.avgLatencyMs,
                        multiplier: latencyMultiplier,
                    }, 'Latency spike detected');

                    await triggerApiDegradationAlert(
                        current.projectId,
                        current.avgLatencyMs,
                        baseline.avgLatencyMs
                    );
                }
            }
        }
    } catch (error) {
        logger.error({ error }, 'Failed to check for spikes');
    }
}

/**
 * Check for high-priority new issues
 * Alerts on first occurrence of critical issues
 */
async function checkForNewCriticalIssues(): Promise<void> {
    try {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        // Get issues created in the last 15 minutes that are high/critical priority
        const newCriticalIssues = await db
            .select({
                projectId: issues.projectId,
                issueType: issues.issueType,
                title: issues.title,
                priority: issues.priority,
                eventCount: issues.eventCount,
            })
            .from(issues)
            .where(and(
                gte(issues.firstSeen, fifteenMinutesAgo),
                sql`${issues.priority} IN ('high', 'critical')`
            ))
            .orderBy(desc(issues.firstSeen));

        // Issues are already triggering alerts in issueTracker.ts
        // This is just for logging/monitoring
        if (newCriticalIssues.length > 0) {
            logger.info({
                count: newCriticalIssues.length,
                issues: newCriticalIssues.map(i => ({
                    projectId: i.projectId,
                    type: i.issueType,
                    priority: i.priority
                }))
            }, 'New critical issues in last 15 minutes');
        }
    } catch (error) {
        logger.error({ error }, 'Failed to check for new critical issues');
    }
}

/**
 * Run the alert worker check
 */
export async function runAlertCheck(): Promise<void> {
    if (isRunning) {
        logger.debug('Alert check already running, skipping');
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    const redis = getRedis();

    try {
        await checkForSpikes();
        await checkForNewCriticalIssues();

        lastRunTime = new Date();
        await redis.set('alerts:worker:last_run', lastRunTime.toISOString());

        const duration = Date.now() - startTime;
        logger.debug({ duration }, 'Alert check completed');

        // Send heartbeat on successful run
        await pingWorker('alertWorker', 'up', `duration=${duration}ms`);
    } catch (error) {
        logger.error({ error }, 'Alert check failed');
        await pingWorker('alertWorker', 'down', String(error)).catch(() => { });
    } finally {
        isRunning = false;
    }
}

/**
 * Start the alert worker (runs every 15 minutes)
 * Used when running as part of the API server
 */
export function startAlertWorker(): void {
    if (intervalHandle) {
        logger.warn('Alert worker already started');
        return;
    }

    // Run immediately on startup (after a short delay)
    setTimeout(() => {
        runAlertCheck().catch((err) => {
            logger.error({ err }, 'Initial alert check failed');
        });
    }, 30000); // Wait 30 seconds after startup

    // Then run every 15 minutes
    intervalHandle = setInterval(() => {
        runAlertCheck().catch((err) => {
            logger.error({ err }, 'Scheduled alert check failed');
        });
    }, RUN_INTERVAL_MS);

    logger.info({ intervalMs: RUN_INTERVAL_MS }, 'Alert worker started');
}

/**
 * Stop the alert worker
 */
export function stopAlertWorker(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        logger.info('Alert worker stopped');
    }
}

/**
 * Get alert worker status
 */
export function getAlertWorkerStatus(): {
    lastRunTime: Date | null;
    isRunning: boolean;
} {
    return { lastRunTime, isRunning };
}

// ========================================
// Standalone Execution Mode
// ========================================
// When run directly (node dist/worker/alertWorker.js), starts as a standalone worker process

/**
 * Main worker loop for standalone execution
 */
async function runStandaloneWorker(): Promise<void> {
    // Initialize Redis connection
    await initRedis();

    // Run first check after a brief startup delay
    await new Promise(resolve => setTimeout(resolve, 5000));

    while (workerShouldRun) {
        try {
            await runAlertCheck();
        } catch (err) {
            logger.error({ err }, 'Alert worker error');
            await pingWorker('alertWorker', 'down', String(err)).catch(() => { });
        }

        // Wait for next interval
        await new Promise(resolve => setTimeout(resolve, RUN_INTERVAL_MS));
    }
}

// Graceful shutdown for standalone mode
async function shutdown(signal: string) {
    logger.info({ signal }, 'Alert worker shutting down...');
    workerShouldRun = false;
    stopAlertWorker();

    await closeRedis();
    await pool.end();
    process.exit(0);
}

// Only run standalone if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info('🔔 Alert worker started (standalone mode)');
    runStandaloneWorker().catch((err) => {
        logger.error({ err }, 'Alert worker fatal error');
        process.exit(1);
    });
}
