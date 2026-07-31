/**
 * Stability alert worker.
 *
 * Every 15 minutes it looks for issue groups and API health metrics that rose
 * materially during the latest six-hour window. It passes all qualifying
 * signals to the project-level digest sender; individual ingest occurrences
 * never send email.
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import {
    alertSettings,
    db,
    issueEvents,
    issues,
    pool,
    sessionMetrics,
    sessions,
} from '../db/client.js';
import { getClickHouseClient, isClickHouseReadsEnabled } from '../db/clickhouse.js';
import { closeRedis, getRedis, initRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { triggerStabilityDigestEmail } from '../services/alertService.js';
import { pingWorker } from '../services/monitoring.js';
import {
    growthPercent,
    normalizedBaselineValue,
    qualifiesAsApiErrorTrend,
    qualifiesAsApiLatencyTrend,
    qualifiesAsRisingIssue,
    STABILITY_BASELINE_WINDOW_HOURS,
    STABILITY_CURRENT_WINDOW_HOURS,
    type StabilityTrend,
} from '../services/stabilityTrends.js';
import {
    buildClickHouseIgnoredEndpointCondition,
    normalizeIgnoredApiEndpointPatterns,
} from '../utils/apiEndpointIgnoreRules.js';

let isRunning = false;
let workerShouldRun = true;

const RUN_INTERVAL_MS = 15 * 60 * 1000;
const BASELINE_WINDOW_COUNT =
    STABILITY_BASELINE_WINDOW_HOURS / STABILITY_CURRENT_WINDOW_HOURS;

interface ProjectMetrics {
    projectId: string;
    errorRatePercent: number;
    avgLatencyMs: number;
    apiErrorCount: number;
    apiRequestCount: number;
    sessionCount: number;
    windowStart: Date;
    windowEnd: Date;
}

interface EndpointErrorMetrics {
    errorRatePercent: number;
    errorCount: number;
    requestCount: number;
}

function addTrend(
    trendsByProject: Map<string, StabilityTrend[]>,
    projectId: string,
    trend: StabilityTrend,
): void {
    const trends = trendsByProject.get(projectId) || [];
    trends.push(trend);
    trendsByProject.set(projectId, trends);
}

function topAffectedVersion(value: Record<string, number> | null): string | null {
    if (!value) return null;
    const [top] = Object.entries(value).sort((a, b) => b[1] - a[1]);
    return top?.[0] || null;
}

async function getProjectMetrics(
    windowHours: number,
    offsetHours = 0,
): Promise<ProjectMetrics[]> {
    const windowEnd = new Date(Date.now() - offsetHours * 60 * 60 * 1000);
    const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);

    const results = await db
        .select({
            projectId: sessions.projectId,
            apiErrorCount: sql<number>`coalesce(sum(${sessionMetrics.apiErrorCount}), 0)::int`,
            apiRequestCount: sql<number>`coalesce(sum(${sessionMetrics.apiTotalCount}), 0)::int`,
            errorRatePercent: sql<number>`
                coalesce(
                    (sum(${sessionMetrics.apiErrorCount})::double precision /
                        nullif(sum(${sessionMetrics.apiTotalCount}), 0)) * 100,
                    0
                )
            `,
            avgLatencyMs: sql<number>`
                coalesce(
                    sum(${sessionMetrics.apiAvgResponseMs} * ${sessionMetrics.apiTotalCount}) /
                        nullif(sum(${sessionMetrics.apiTotalCount}), 0),
                    0
                )
            `,
            sessionCount: sql<number>`count(*)::int`,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(and(
            gte(sessions.startedAt, windowStart),
            lte(sessions.startedAt, windowEnd),
        ))
        .groupBy(sessions.projectId);

    return results.map((row) => ({
        projectId: row.projectId,
        errorRatePercent: Number(row.errorRatePercent || 0),
        avgLatencyMs: Number(row.avgLatencyMs || 0),
        apiErrorCount: Number(row.apiErrorCount || 0),
        apiRequestCount: Number(row.apiRequestCount || 0),
        sessionCount: Number(row.sessionCount || 0),
        windowStart,
        windowEnd,
    }));
}

async function getFilteredEndpointErrorMetrics(input: {
    projectId: string;
    start: Date;
    end: Date;
    ignoredApiEndpoints: string[];
}): Promise<EndpointErrorMetrics | null> {
    if (!isClickHouseReadsEnabled()) return null;

    const ignoredCondition = buildClickHouseIgnoredEndpointCondition(
        input.ignoredApiEndpoints,
        'endpoint',
        'stabilityIgnoredEndpoint',
        'method',
        'path',
    );
    const result = await getClickHouseClient().query({
        query: `
            SELECT
                countIf(is_error = 1) AS error_count,
                count() AS request_count,
                if(
                    count() > 0,
                    round((countIf(is_error = 1) / count()) * 100, 4),
                    0
                ) AS error_rate
            FROM rejourney.api_endpoint_request_events
            WHERE project_id = {projectId: String}
              AND event_time BETWEEN {start: DateTime64(3)} AND {end: DateTime64(3)}
              ${ignoredCondition.condition}
        `,
        query_params: {
            projectId: input.projectId,
            start: input.start.toISOString().replace('T', ' ').replace('Z', ''),
            end: input.end.toISOString().replace('T', ' ').replace('Z', ''),
            ...ignoredCondition.queryParams,
        },
        format: 'JSONEachRow',
    });
    const [row] = await result.json<{
        error_count: string;
        request_count: string;
        error_rate: string;
    }>();
    if (!row) return { errorRatePercent: 0, errorCount: 0, requestCount: 0 };
    return {
        errorRatePercent: Number(row.error_rate || 0),
        errorCount: Number(row.error_count || 0),
        requestCount: Number(row.request_count || 0),
    };
}

async function collectRisingIssueTrends(
    trendsByProject: Map<string, StabilityTrend[]>,
    detectedAt: Date,
): Promise<void> {
    const currentStart = new Date(
        detectedAt.getTime() - STABILITY_CURRENT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const baselineStart = new Date(
        currentStart.getTime() - STABILITY_BASELINE_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const rows = await db
        .select({
            issueId: issues.id,
            projectId: issues.projectId,
            shortId: issues.shortId,
            issueType: issues.issueType,
            title: issues.title,
            subtitle: issues.subtitle,
            culprit: issues.culprit,
            affectedVersions: issues.affectedVersions,
            lastSeen: issues.lastSeen,
            currentOccurrences: sql<number>`
                count(${issueEvents.id}) filter (
                    where ${issueEvents.timestamp} >= ${currentStart}
                )::int
            `,
            baselineOccurrences: sql<number>`
                count(${issueEvents.id}) filter (
                    where ${issueEvents.timestamp} < ${currentStart}
                )::int
            `,
            currentAffectedUsers: sql<number>`
                count(distinct coalesce(${issueEvents.userId}, ${issueEvents.sessionId})) filter (
                    where ${issueEvents.timestamp} >= ${currentStart}
                )::int
            `,
            currentAffectedSessions: sql<number>`
                count(distinct ${issueEvents.sessionId}) filter (
                    where ${issueEvents.timestamp} >= ${currentStart}
                )::int
            `,
        })
        .from(issues)
        .innerJoin(issueEvents, eq(issueEvents.issueId, issues.id))
        .where(and(
            gte(issueEvents.timestamp, baselineStart),
            lte(issueEvents.timestamp, detectedAt),
            sql`${issues.issueType} in ('crash', 'anr', 'error')`,
            sql`${issues.status} not in ('resolved', 'ignored')`,
        ))
        .groupBy(
            issues.id,
            issues.projectId,
            issues.shortId,
            issues.issueType,
            issues.title,
            issues.subtitle,
            issues.culprit,
            issues.affectedVersions,
            issues.lastSeen,
        );

    for (const row of rows) {
        const currentOccurrences = Number(row.currentOccurrences || 0);
        const baselineOccurrences = Number(row.baselineOccurrences || 0);
        const currentAffectedUsers = Number(row.currentAffectedUsers || 0);
        if (!qualifiesAsRisingIssue({
            currentOccurrences,
            baselineOccurrences,
            currentAffectedUsers,
            baselineWindowCount: BASELINE_WINDOW_COUNT,
        })) {
            continue;
        }

        const baseline = normalizedBaselineValue(
            baselineOccurrences,
            BASELINE_WINDOW_COUNT,
        );
        addTrend(trendsByProject, row.projectId, {
            signalKey: `issue:${row.issueId}`,
            kind: row.issueType as 'crash' | 'anr' | 'error',
            title: row.title,
            subtitle: row.subtitle || row.culprit,
            shortId: row.shortId,
            issueId: row.issueId,
            dashboardPath: `/general/${row.issueId}`,
            currentValue: currentOccurrences,
            baselineValue: baseline,
            growthPercent: growthPercent(currentOccurrences, baseline),
            occurrences: currentOccurrences,
            affectedUsers: currentAffectedUsers,
            affectedSessions: Number(row.currentAffectedSessions || 0),
            appVersion: topAffectedVersion(
                row.affectedVersions as Record<string, number> | null,
            ),
            lastSeen: row.lastSeen,
        });
    }
}

async function collectApiTrends(
    trendsByProject: Map<string, StabilityTrend[]>,
): Promise<void> {
    const [currentMetrics, baselineMetrics] = await Promise.all([
        getProjectMetrics(STABILITY_CURRENT_WINDOW_HOURS),
        getProjectMetrics(
            STABILITY_BASELINE_WINDOW_HOURS,
            STABILITY_CURRENT_WINDOW_HOURS,
        ),
    ]);
    const baselineByProject = new Map(
        baselineMetrics.map((metrics) => [metrics.projectId, metrics]),
    );

    for (const current of currentMetrics) {
        const baseline = baselineByProject.get(current.projectId);
        if (!baseline) continue;

        let currentErrorRate = current.errorRatePercent;
        let baselineErrorRate = baseline.errorRatePercent;
        let currentErrorCount = current.apiErrorCount;
        let canEvaluateErrorTrend = true;

        const [settings] = await db
            .select({ ignoredApiEndpoints: alertSettings.ignoredApiEndpoints })
            .from(alertSettings)
            .where(eq(alertSettings.projectId, current.projectId))
            .limit(1);
        const ignoredApiEndpoints = normalizeIgnoredApiEndpointPatterns(
            settings?.ignoredApiEndpoints ?? [],
        );

        if (ignoredApiEndpoints.length > 0) {
            try {
                const [filteredCurrent, filteredBaseline] = await Promise.all([
                    getFilteredEndpointErrorMetrics({
                        projectId: current.projectId,
                        start: current.windowStart,
                        end: current.windowEnd,
                        ignoredApiEndpoints,
                    }),
                    getFilteredEndpointErrorMetrics({
                        projectId: baseline.projectId,
                        start: baseline.windowStart,
                        end: baseline.windowEnd,
                        ignoredApiEndpoints,
                    }),
                ]);
                if (!filteredCurrent || !filteredBaseline) {
                    canEvaluateErrorTrend = false;
                } else {
                    currentErrorRate = filteredCurrent.errorRatePercent;
                    baselineErrorRate = filteredBaseline.errorRatePercent;
                    currentErrorCount = filteredCurrent.errorCount;
                }
            } catch (error) {
                canEvaluateErrorTrend = false;
                logger.warn(
                    { projectId: current.projectId, error },
                    'Skipped API error trend because ignored endpoint filtering failed',
                );
            }
        }

        if (canEvaluateErrorTrend && qualifiesAsApiErrorTrend({
            currentRatePercent: currentErrorRate,
            baselineRatePercent: baselineErrorRate,
            currentSessions: current.sessionCount,
            currentErrors: currentErrorCount,
        })) {
            addTrend(trendsByProject, current.projectId, {
                signalKey: 'api:error-rate',
                kind: 'api_error_rate',
                title: 'API error rate is rising quickly',
                subtitle: `Error responses rose from ${baselineErrorRate.toFixed(1)}% to ${currentErrorRate.toFixed(1)}% in the latest six-hour window.`,
                dashboardPath: '/api',
                currentValue: currentErrorRate,
                baselineValue: baselineErrorRate,
                growthPercent: growthPercent(currentErrorRate, baselineErrorRate),
                occurrences: currentErrorCount,
                affectedSessions: current.sessionCount,
            });
        }

        if (qualifiesAsApiLatencyTrend({
            currentLatencyMs: current.avgLatencyMs,
            baselineLatencyMs: baseline.avgLatencyMs,
            currentSessions: current.sessionCount,
        })) {
            addTrend(trendsByProject, current.projectId, {
                signalKey: 'api:latency',
                kind: 'api_latency',
                title: 'API latency is rising quickly',
                subtitle: `Average latency rose from ${Math.round(baseline.avgLatencyMs).toLocaleString()} ms to ${Math.round(current.avgLatencyMs).toLocaleString()} ms in the latest six-hour window.`,
                dashboardPath: '/api',
                currentValue: current.avgLatencyMs,
                baselineValue: baseline.avgLatencyMs,
                growthPercent: growthPercent(
                    current.avgLatencyMs,
                    baseline.avgLatencyMs,
                ),
                affectedSessions: current.sessionCount,
            });
        }
    }
}

async function checkForRisingStabilityIssues(): Promise<void> {
    const detectedAt = new Date();
    const trendsByProject = new Map<string, StabilityTrend[]>();
    await Promise.all([
        collectRisingIssueTrends(trendsByProject, detectedAt),
        collectApiTrends(trendsByProject),
    ]);

    for (const [projectId, trends] of trendsByProject) {
        const result = await triggerStabilityDigestEmail({
            projectId,
            detectedAt,
            trends,
        });
        logger.debug(
            {
                projectId,
                detectedTrendCount: trends.length,
                sentTrendCount: result.trendCount,
                sent: result.sent,
                reason: result.reason,
            },
            'Stability trend digest evaluated',
        );
    }
}

export async function runAlertCheck(): Promise<void> {
    if (isRunning) {
        logger.debug('Alert check already running, skipping');
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    const redis = getRedis();

    try {
        await checkForRisingStabilityIssues();
        await redis.set('alerts:worker:last_run', new Date().toISOString());

        const duration = Date.now() - startTime;
        logger.debug({ duration }, 'Stability alert check completed');
        await pingWorker('alertWorker', 'up', `duration=${duration}ms`);
    } catch (error) {
        logger.error({ error }, 'Stability alert check failed');
        await pingWorker('alertWorker', 'down', String(error)).catch(() => { });
    } finally {
        isRunning = false;
    }
}

async function runStandaloneWorker(): Promise<void> {
    await initRedis();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    while (workerShouldRun) {
        try {
            await runAlertCheck();
        } catch (error) {
            logger.error({ error }, 'Stability alert worker error');
            await pingWorker('alertWorker', 'down', String(error)).catch(() => { });
        }
        await new Promise((resolve) => setTimeout(resolve, RUN_INTERVAL_MS));
    }
}

async function shutdown(signal: string) {
    logger.info({ signal }, 'Stability alert worker shutting down');
    workerShouldRun = false;
    await closeRedis();
    await pool.end();
    process.exit(0);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    logger.info('Stability alert worker started in standalone mode');
    runStandaloneWorker().catch((error) => {
        logger.error({ error }, 'Stability alert worker fatal error');
        process.exit(1);
    });
}
