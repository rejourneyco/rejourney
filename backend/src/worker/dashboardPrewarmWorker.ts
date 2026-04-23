import { closeRedis, getRedis, initRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { pingWorker, type WorkerMetric } from '../services/monitoring.js';
import {
    OVERVIEW_PREWARM_SCOPE_LIMIT,
    acquireDashboardPrewarmLock,
    collectDashboardPrewarmCandidates,
    refreshOverviewCacheFromShadow,
    releaseDashboardPrewarmLock,
} from '../services/dashboardPrewarm.js';
import { config } from '../config.js';

const WORKER_NAME = 'dashboardPrewarmWorker';
const LOCK_TTL_SECONDS = 50;
const RUN_BUDGET_MS = 45_000;

type RunSummary = {
    candidateCount: number;
    completedAt: string;
    durationMs: number;
    errorCount: number;
    missingCount: number;
    skipReason: string;
    staleCount: number;
    startedAt: string;
    warmedCount: number;
};

async function storeRunSummary(summary: RunSummary): Promise<void> {
    const redis = getRedis();
    await redis
        .multi()
        .set(`${WORKER_NAME}:last_run`, summary.completedAt)
        .set(`${WORKER_NAME}:last_summary`, JSON.stringify(summary), 'EX', 24 * 60 * 60)
        .exec();
}

function buildRunMetrics(summary: RunSummary): WorkerMetric[] {
    return [
        {
            name: 'worker_run_count',
            help: 'Number of dashboard prewarm runs represented by this heartbeat.',
            type: 'counter',
            value: 1,
        },
        {
            name: 'worker_warm_count',
            help: 'Number of dashboard overview caches refreshed during this run.',
            value: summary.warmedCount,
        },
        {
            name: 'worker_error_count',
            help: 'Number of refresh attempts that failed during this run.',
            value: summary.errorCount,
        },
        {
            name: 'worker_candidate_count',
            help: 'Number of hot scope candidates considered during this run.',
            value: summary.candidateCount,
        },
        {
            name: 'worker_skip_reason',
            help: 'Whether this run exited early for the labeled reason.',
            labels: { reason: summary.skipReason || 'none' },
            value: 1,
        },
    ];
}

export async function runDashboardPrewarmCycle(): Promise<RunSummary> {
    const startedAt = new Date();
    let lockToken: string | null = null;
    let candidateCount = 0;
    let warmedCount = 0;
    let missingCount = 0;
    let staleCount = 0;
    let errorCount = 0;
    let skipReason = 'none';

    await initRedis();
    const redis = getRedis();

    try {
        if (!config.RJ_DASHBOARD_PREWARM_ENABLED) {
            skipReason = 'disabled';
            return {
                candidateCount,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt.getTime(),
                errorCount,
                missingCount,
                skipReason,
                staleCount,
                startedAt: startedAt.toISOString(),
                warmedCount,
            };
        }

        const lock = await acquireDashboardPrewarmLock(redis, LOCK_TTL_SECONDS);
        if (!lock.acquired) {
            skipReason = 'lock_busy';
            return {
                candidateCount,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt.getTime(),
                errorCount,
                missingCount,
                skipReason,
                staleCount,
                startedAt: startedAt.toISOString(),
                warmedCount,
            };
        }
        lockToken = lock.token;

        const scopeLimit = Math.max(1, Math.min(config.RJ_DASHBOARD_PREWARM_SCOPE_LIMIT, OVERVIEW_PREWARM_SCOPE_LIMIT));
        const candidates = await collectDashboardPrewarmCandidates({
            redisClient: redis,
            lookbackMinutes: config.RJ_DASHBOARD_PREWARM_LOOKBACK_MINUTES,
            nowMs: Date.now(),
            scopeLimit,
        });

        candidateCount = candidates.length;
        if (candidates.length === 0) {
            skipReason = 'no_hot_scopes';
        }

        for (const candidate of candidates) {
            if ((Date.now() - startedAt.getTime()) >= RUN_BUDGET_MS) {
                skipReason = skipReason === 'none' ? 'budget_exhausted' : skipReason;
                break;
            }

            try {
                const result = await refreshOverviewCacheFromShadow(candidate.liveCacheKey, {
                    redisClient: redis,
                });

                if (result === 'warmed') {
                    warmedCount += 1;
                } else if (result === 'missing') {
                    missingCount += 1;
                } else if (result === 'stale') {
                    staleCount += 1;
                } else {
                    errorCount += 1;
                }
            } catch (error) {
                errorCount += 1;
                logger.warn({ error, candidate }, 'Dashboard prewarm candidate refresh failed');
            }
        }

        return {
            candidateCount,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            errorCount,
            missingCount,
            skipReason,
            staleCount,
            startedAt: startedAt.toISOString(),
            warmedCount,
        };
    } finally {
        if (lockToken) {
            await releaseDashboardPrewarmLock(lockToken, redis).catch((error) => {
                logger.warn({ error }, 'Failed to release dashboard prewarm lock');
            });
        }
    }
}

async function main(): Promise<void> {
    logger.info('Dashboard prewarm worker starting');

    try {
        const summary = await runDashboardPrewarmCycle();
        await storeRunSummary(summary);

        logger.info(summary, 'Dashboard prewarm worker complete');

        const message = `warmed=${summary.warmedCount},missing=${summary.missingCount},stale=${summary.staleCount},errors=${summary.errorCount},skip=${summary.skipReason}`;
        await pingWorker(WORKER_NAME, 'up', message, summary.durationMs, buildRunMetrics(summary)).catch(() => {});
        await closeRedis().catch(() => {});
        process.exit(0);
    } catch (error) {
        logger.error({ error }, 'Dashboard prewarm worker fatal error');
        await pingWorker(WORKER_NAME, 'down', String((error as Error)?.message ?? error)).catch(() => {});
        await closeRedis().catch(() => {});
        process.exit(1);
    }
}

main();
