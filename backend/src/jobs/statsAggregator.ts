/**
 * Stats Aggregator Job
 * 
 * Handles daily product analytics rollups at midnight UTC.
 */

import { eq, gte, and, lte } from 'drizzle-orm';
import { db, sessions, sessionMetrics } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { triggerErrorSpikeAlert, triggerApiDegradationAlert } from '../services/alertService.js';
import { pingWorker } from '../services/monitoring.js';
import { writeProductAnalyticsDailyRollupInputToClickHouse } from '../services/clickhouseProductRollupsSink.js';
import {
    queryProductDailyStatsFromClickHouse,
    queryProductDailyUniqueUserCountFromClickHouse,
} from '../services/productRollupsClickHouse.js';
import { protectUniqueUserCountAfterIdentityScrub } from '../services/rollupIdentityProtection.js';

// Track last run time
let lastRunTime: Date | null = null;
let lastDailyRollupTime: Date | null = null;
let isRunning = false;

const redis = getRedis();

async function resolveUniqueUserCountForRollup(params: {
    projectId: string;
    date: string;
    computedUniqueUserCount: number;
    identityScrubbedSessionCount: number;
}): Promise<{ uniqueUserCount: number; source: string }> {
    if (params.identityScrubbedSessionCount <= 0) {
        return { uniqueUserCount: params.computedUniqueUserCount, source: 'stats_aggregator' };
    }

    let existingUniqueUserCount: number | null = null;
    try {
        existingUniqueUserCount = await queryProductDailyUniqueUserCountFromClickHouse({
            projectId: params.projectId,
            date: params.date,
        });
    } catch (err) {
        logger.warn({
            err,
            projectId: params.projectId,
            date: params.date,
        }, 'Failed to read existing unique-user rollup before identity-scrub protection');
    }

    const protectedCount = protectUniqueUserCountAfterIdentityScrub({
        computedUniqueUserCount: params.computedUniqueUserCount,
        existingUniqueUserCount,
        identityScrubbedSessionCount: params.identityScrubbedSessionCount,
    });

    if (protectedCount.preservedExisting) {
        logger.info({
            projectId: params.projectId,
            date: params.date,
            computedUniqueUserCount: params.computedUniqueUserCount,
            existingUniqueUserCount,
            identityScrubbedSessionCount: params.identityScrubbedSessionCount,
        }, 'Preserved existing daily unique-user rollup after session identity scrub');
    }

    return {
        uniqueUserCount: protectedCount.uniqueUserCount,
        source: protectedCount.preservedExisting ? 'stats_aggregator_identity_preserved' : 'stats_aggregator',
    };
}

/**
 * Compute percentile values for a given array
 */
function computePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] || 0;
}

/**
 * Compute daily stats rollup for a specific project and date
 */
async function computeDailyRollup(projectId: string, date: Date): Promise<void> {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const dateStr = startOfDay.toISOString().split('T')[0]; // YYYY-MM-DD

    try {
        // Get all sessions for the day with their metrics and device info
        const daySessions = await db
            .select({
                id: sessions.id,
                status: sessions.status,
                durationSeconds: sessions.durationSeconds,
                deviceModel: sessions.deviceModel,
                osVersion: sessions.osVersion,
                platform: sessions.platform,
                appVersion: sessions.appVersion,
                geoCountry: sessions.geoCountry,
                deviceId: sessions.deviceId,
                identityScrubbedAt: sessions.identityScrubbedAt,
                interactionScore: sessionMetrics.interactionScore,
                uxScore: sessionMetrics.uxScore,
                apiErrorCount: sessionMetrics.apiErrorCount,
                apiTotalCount: sessionMetrics.apiTotalCount,
                errorCount: sessionMetrics.errorCount,
                crashCount: sessionMetrics.crashCount,
                anrCount: sessionMetrics.anrCount,
                rageTapCount: sessionMetrics.rageTapCount,
                deadTapCount: sessionMetrics.deadTapCount,
                touchCount: sessionMetrics.touchCount,
                scrollCount: sessionMetrics.scrollCount,
                gestureCount: sessionMetrics.gestureCount,
                inputCount: sessionMetrics.inputCount,
                screensVisited: sessionMetrics.screensVisited,
                apiAvgResponseMs: sessionMetrics.apiAvgResponseMs,
                events: sessions.events,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(
                and(
                    eq(sessions.projectId, projectId),
                    gte(sessions.startedAt, startOfDay),
                    lte(sessions.startedAt, endOfDay)
                )
            );

        if (daySessions.length === 0) {
            logger.debug({ projectId, date: dateStr }, 'No sessions for daily rollup');
            return;
        }

        // Compute aggregate metrics
        const totalSessions = daySessions.length;
        const completedSessions = daySessions.filter(s => s.status === 'ready').length;

        // Engagement Segments
        let bouncers = 0;
        let casuals = 0;
        let explorers = 0;
        let loyalists = 0;

        // JSONB Breakdowns
        const deviceModelBreakdown: Record<string, number> = {};
        const osVersionBreakdown: Record<string, number> = {};
        const platformBreakdown: Record<string, number> = {};
        const appVersionBreakdown: Record<string, number> = {};
        const screenViewBreakdown: Record<string, number> = {};
        const screenTransitionBreakdown: Record<string, number> = {};
        const entryScreenBreakdown: Record<string, number> = {};
        const exitScreenBreakdown: Record<string, number> = {};
        const geoCountryBreakdown: Record<string, number> = {};
        const customEventBreakdown: Record<string, number> = {};
        const uniqueUserSet = new Set<string>();
        let identityScrubbedSessionCount = 0;

        for (const s of daySessions) {
            const dur = s.durationSeconds || 0;
            const screens = s.screensVisited || [];
            if (s.identityScrubbedAt) {
                identityScrubbedSessionCount++;
            }

            // Engagement segments
            if (dur < 10) {
                bouncers++;
            } else if (dur > 180) {
                loyalists++;
            } else if (dur > 60 || screens.length > 3) {
                explorers++;
            } else {
                casuals++;
            }

            // Device breakdown
            const model = s.deviceModel || 'Unknown';
            deviceModelBreakdown[model] = (deviceModelBreakdown[model] || 0) + 1;

            // OS version breakdown
            const osVer = s.osVersion || 'Unknown';
            osVersionBreakdown[osVer] = (osVersionBreakdown[osVer] || 0) + 1;

            // Platform breakdown
            const plat = s.platform || 'unknown';
            platformBreakdown[plat] = (platformBreakdown[plat] || 0) + 1;

            // App version breakdown
            const appVer = s.appVersion || 'Unknown';
            appVersionBreakdown[appVer] = (appVersionBreakdown[appVer] || 0) + 1;

            // Geo country breakdown
            if (s.geoCountry) {
                geoCountryBreakdown[s.geoCountry] = (geoCountryBreakdown[s.geoCountry] || 0) + 1;
            }

            // Custom Events breakdown
            const evs = Array.isArray(s.events) ? s.events : [];
            for (const ev of evs) {
                if (ev && ev.type === 'custom' && typeof ev.name === 'string') {
                    customEventBreakdown[ev.name] = (customEventBreakdown[ev.name] || 0) + 1;
                }
            }

            // Unique users tracking
            if (s.deviceId) {
                uniqueUserSet.add(s.deviceId);
            }

            // Screen visit breakdowns
            if (screens.length > 0) {
                // Entry screen
                entryScreenBreakdown[screens[0]] = (entryScreenBreakdown[screens[0]] || 0) + 1;

                // Exit screen
                const exitScreen = screens[screens.length - 1];
                exitScreenBreakdown[exitScreen] = (exitScreenBreakdown[exitScreen] || 0) + 1;

                // Screen views
                for (const screen of screens) {
                    screenViewBreakdown[screen] = (screenViewBreakdown[screen] || 0) + 1;
                }

                // Screen transitions
                for (let i = 0; i < screens.length - 1; i++) {
                    const from = screens[i];
                    const to = screens[i + 1];
                    if (from !== to) {
                        const key = `${from}→${to}`;
                        screenTransitionBreakdown[key] = (screenTransitionBreakdown[key] || 0) + 1;
                    }
                }
            }
        }

        const durations = daySessions.map(s => s.durationSeconds || 0).filter(d => d > 0);
        const interactionScores = daySessions.map(s => s.interactionScore || 0).filter(i => i > 0);
        const uxScores = daySessions.map(s => s.uxScore || 0).filter(u => u > 0);

        const avgDurationSeconds = durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : null;

        const avgInteractionScore = interactionScores.length > 0
            ? interactionScores.reduce((a, b) => a + b, 0) / interactionScores.length
            : null;

        const avgUxScore = uxScores.length > 0
            ? uxScores.reduce((a, b) => a + b, 0) / uxScores.length
            : null;

        // Compute API error rate and total counts
        const totalApiCalls = daySessions.reduce((acc, s) => acc + (s.apiTotalCount || 0), 0);
        const totalApiErrors = daySessions.reduce((acc, s) => acc + (s.apiErrorCount || 0), 0);
        const avgApiErrorRate = totalApiCalls > 0 ? totalApiErrors / totalApiCalls : null;

        // Compute average API response time (weighted by call count)
        const apiResponseTimes = daySessions.filter(s => (s.apiTotalCount || 0) > 0 && (s.apiAvgResponseMs || 0) > 0);
        const avgApiResponseMs = apiResponseTimes.length > 0
            ? apiResponseTimes.reduce((sum, s) => sum + (s.apiAvgResponseMs || 0) * (s.apiTotalCount || 1), 0) /
            apiResponseTimes.reduce((sum, s) => sum + (s.apiTotalCount || 1), 0)
            : null;

        const totalErrors = daySessions.reduce((acc, s) => acc + (s.errorCount || 0), 0);
        const totalCrashes = daySessions.reduce((acc, s) => acc + (s.crashCount || 0), 0);
        const totalAnrs = daySessions.reduce((acc, s) => acc + (s.anrCount || 0), 0);
        const totalRageTaps = daySessions.reduce((acc, s) => acc + (s.rageTapCount || 0), 0);
        const totalDeadTaps = daySessions.reduce((acc, s) => acc + (s.deadTapCount || 0), 0);

        // Percentiles
        const p50Duration = computePercentile(durations, 50);
        const p90Duration = computePercentile(durations, 90);
        const p50InteractionScore = computePercentile(interactionScores, 50);
        const p90InteractionScore = computePercentile(interactionScores, 90);

        // Interaction Breakdown
        const totalTouches = daySessions.reduce((sum, s) => sum + (s.touchCount || 0), 0);
        const totalScrolls = daySessions.reduce((sum, s) => sum + (s.scrollCount || 0), 0);
        const totalGestures = daySessions.reduce((sum, s) => sum + (s.gestureCount || 0), 0);
        const totalInteractions = totalTouches + totalScrolls + totalGestures + daySessions.reduce((sum, s) => sum + (s.inputCount || 0), 0);
        const uniqueUserRollup = await resolveUniqueUserCountForRollup({
            projectId,
            date: dateStr,
            computedUniqueUserCount: uniqueUserSet.size,
            identityScrubbedSessionCount,
        });

        await writeProductAnalyticsDailyRollupInputToClickHouse({
            projectId,
            date: dateStr,
            totalSessions,
            completedSessions,
            avgDurationSeconds,
            avgInteractionScore,
            avgUxScore,
            avgApiErrorRate,
            avgApiResponseMs,
            p50Duration,
            p90Duration,
            p50InteractionScore,
            p90InteractionScore,
            totalErrors,
            totalRageTaps,
            totalDeadTaps,
            totalCrashes,
            totalAnrs,
            totalBouncers: bouncers,
            totalCasuals: casuals,
            totalExplorers: explorers,
            totalLoyalists: loyalists,
            totalTouches,
            totalScrolls,
            totalGestures,
            totalInteractions,
            uniqueUserCount: uniqueUserRollup.uniqueUserCount,
            deviceModelBreakdown,
            osVersionBreakdown,
            platformBreakdown,
            appVersionBreakdown,
            screenViewBreakdown,
            screenTransitionBreakdown,
            entryScreenBreakdown,
            exitScreenBreakdown,
            geoCountryBreakdown,
            customEventBreakdown,
            source: uniqueUserRollup.source,
        });

        logger.debug({ projectId, date: dateStr, totalSessions }, 'Daily rollup completed');
    } catch (err) {
        logger.error({ err, projectId, date: dateStr }, 'Failed to compute daily rollup');
        throw err;
    }
}

/**
 * Run daily rollup for all projects for a specific date
 */
export async function runDailyRollup(date?: Date): Promise<void> {
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday by default

    logger.info({ date: targetDate.toISOString() }, 'Starting daily rollup');

    try {
        // Get all projects with sessions on that date
        const startOfDay = new Date(targetDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const projectsWithSessions = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(
                and(
                    gte(sessions.startedAt, startOfDay),
                    lte(sessions.startedAt, endOfDay)
                )
            )
            .groupBy(sessions.projectId);

        const projectIds = projectsWithSessions.map(p => p.projectId);
        logger.info({ projectCount: projectIds.length, date: targetDate.toISOString() }, 'Projects for daily rollup');

        // Process in batches
        const batchSize = 10;
        for (let i = 0; i < projectIds.length; i += batchSize) {
            const batch = projectIds.slice(i, i + batchSize);
            await Promise.all(batch.map(pid => computeDailyRollup(pid, targetDate)));
        }

        lastDailyRollupTime = new Date();
        const rolledUpDateStr = targetDate.toISOString().split('T')[0];

        // Cache the last rollup execution timestamp and the actual rolled-up date
        await Promise.all([
            redis.set('stats:daily_rollup:last_run', lastDailyRollupTime.toISOString()),
            redis.set('stats:daily_rollup:last_rolled_up_date', rolledUpDateStr),
        ]);

        // Check for error spikes and API degradation for each project
        await checkAlertsAfterRollup(projectIds, targetDate);

        logger.info({ projectCount: projectIds.length }, 'Daily rollup completed');
    } catch (err) {
        logger.error({ err }, 'Daily rollup failed');
    }
}

/**
 * Check for error rate spikes and API degradation after daily rollup
 * Compares today's metrics with the previous 7-day average
 */
async function checkAlertsAfterRollup(projectIds: string[], targetDate: Date): Promise<void> {
    const dateStr = targetDate.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(targetDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const currentWindowStart = new Date(`${dateStr}T00:00:00.000Z`);
    const currentWindowEnd = new Date(currentWindowStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const baselineWindowStart = new Date(`${sevenDaysAgoStr}T00:00:00.000Z`);
    const baselineWindowEnd = new Date(currentWindowStart.getTime() - 1);

    for (const projectId of projectIds) {
        try {
            const dailyStats = await queryProductDailyStatsFromClickHouse({
                projectIds: [projectId],
                startDate: sevenDaysAgoStr,
                endDate: dateStr,
            });
            const previousStats = dailyStats.sort((a, b) => b.date.localeCompare(a.date));
            const todayStats = previousStats.find((row) => row.date === dateStr);

            if (!todayStats || todayStats.totalSessions < 10) {
                // Skip projects with insufficient data
                continue;
            }

            // Need at least 3 days of data for comparison
            if (previousStats.length < 3) {
                continue;
            }

            // Calculate 7-day averages (excluding today)
            const historicalStats = previousStats.slice(1); // Exclude today
            const avgErrorRate = historicalStats.reduce((sum, s) => sum + (s.avgApiErrorRate || 0), 0) / historicalStats.length;
            const avgLatency = historicalStats.reduce((sum, s) => sum + (s.avgApiResponseMs || 0), 0) / historicalStats.length;

            // Check for error spike
            const todayErrorRate = todayStats.avgApiErrorRate || 0;
            if (avgErrorRate > 0 && todayErrorRate > avgErrorRate) {
                await triggerErrorSpikeAlert(projectId, todayErrorRate * 100, avgErrorRate * 100, {
                    currentWindowStart,
                    currentWindowEnd,
                    baselineWindowStart,
                    baselineWindowEnd,
                });
            }

            // Check for API degradation
            const todayLatency = todayStats.avgApiResponseMs || 0;
            if (avgLatency > 0 && todayLatency > avgLatency) {
                await triggerApiDegradationAlert(projectId, todayLatency, avgLatency);
            }

        } catch (error) {
            logger.error({ error, projectId }, 'Failed to check alerts for project');
        }
    }
}

/**
 * Backfill daily stats for the last N days
 */
export async function backfillDailyStats(days: number = 30): Promise<void> {
    logger.info({ days }, 'Starting daily stats backfill');

    for (let i = 1; i <= days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        await runDailyRollup(date);
    }

    logger.info({ days }, 'Daily stats backfill completed');
}




/**
 * Check if daily rollup should run (once per day at midnight UTC)
 */
async function shouldRunDailyRollup(): Promise<boolean> {
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];

    try {
        const lastRunStr = await redis.get('stats:daily_rollup:last_run');
        if (lastRunStr) {
            const lastRunDate = new Date(lastRunStr).toISOString().split('T')[0];
            if (lastRunDate === todayDate) {
                return false; // Already ran today
            }
        }
    } catch (err) {
        logger.error({ err }, 'Failed to check last rollup time from Redis');
        // Fallback to memory
        if (lastDailyRollupTime) {
            const lastRunDate = lastDailyRollupTime.toISOString().split('T')[0];
            if (lastRunDate === todayDate) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Run the aggregation job (primarily handles daily rollup)
 */
export async function runStatsAggregation(): Promise<void> {
    if (isRunning) {
        logger.warn('Stats aggregation already running, skipping');
        return;
    }

    isRunning = true;
    const startTime = Date.now();

    try {
        // Check if daily rollup should run
        if (await shouldRunDailyRollup()) {
            logger.info('Triggering daily rollup');
            await runDailyRollup();
        }

        const duration = Date.now() - startTime;
        lastRunTime = new Date();
        logger.debug({ duration }, 'Stats aggregation completed');

        // Send heartbeat on successful run
        await pingWorker('statsAggregator', 'up', `duration=${duration}ms`);
    } catch (err) {
        logger.error({ err }, 'Stats aggregation failed');
        await pingWorker('statsAggregator', 'down', String(err)).catch(() => { });
    } finally {
        isRunning = false;
    }
}


/**
 * Start the cron job (runs every 5 minutes)
 */
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startStatsAggregationJob(): void {
    if (intervalHandle) {
        logger.warn('Stats aggregation job already started');
        return;
    }

    const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    // Run immediately on startup
    setTimeout(() => {
        runStatsAggregation().catch((err) => {
            logger.error({ err }, 'Initial stats aggregation failed');
        });
    }, 10000); // Wait 10 seconds after startup

    // Then run every 5 minutes
    intervalHandle = setInterval(() => {
        runStatsAggregation().catch((err) => {
            logger.error({ err }, 'Scheduled stats aggregation failed');
        });
    }, INTERVAL_MS);

    logger.info({ intervalMs: INTERVAL_MS }, 'Stats aggregation job started');
}

export function stopStatsAggregationJob(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        logger.info('Stats aggregation job stopped');
    }
}

export function getStatsJobStatus(): { lastRunTime: Date | null; lastDailyRollupTime: Date | null; isRunning: boolean } {
    return { lastRunTime, lastDailyRollupTime, isRunning };
}
