import { getClickHouseClient, isClickHouseConfigured } from '../db/clickhouse.js';

export type ProductAnalyticsDailyStatsRow = {
    projectId: string;
    date: string;
    totalSessions: number;
    completedSessions: number;
    avgDurationSeconds: number | null;
    avgInteractionScore: number | null;
    avgUxScore: number | null;
    avgApiErrorRate: number | null;
    avgApiResponseMs: number | null;
    p50Duration: number | null;
    p90Duration: number | null;
    p50InteractionScore: number | null;
    p90InteractionScore: number | null;
    totalErrors: number;
    totalRageTaps: number;
    totalDeadTaps: number;
    totalCrashes: number;
    totalAnrs: number;
    totalBouncers: number;
    totalCasuals: number;
    totalExplorers: number;
    totalLoyalists: number;
    totalTouches: number;
    totalScrolls: number;
    totalGestures: number;
    totalInteractions: number;
    uniqueUserCount: number;
    deviceModelBreakdown: Record<string, number>;
    osVersionBreakdown: Record<string, number>;
    platformBreakdown: Record<string, number>;
    appVersionBreakdown: Record<string, number>;
    screenViewBreakdown: Record<string, number>;
    screenTransitionBreakdown: Record<string, number>;
    entryScreenBreakdown: Record<string, number>;
    exitScreenBreakdown: Record<string, number>;
    geoCountryBreakdown: Record<string, number>;
    customEventBreakdown: Record<string, number>;
};

export type ProductAnalyticsAllTimeStatsRow = Omit<ProductAnalyticsDailyStatsRow, 'date' | 'completedSessions' | 'p50Duration' | 'p90Duration' | 'p50InteractionScore' | 'p90InteractionScore'> & {
    totalUsers: number;
    totalEvents: number;
    avgSessionDurationSeconds: number;
};

export type ProductScreenTouchHeatmapRow = {
    projectId: string;
    screenName: string;
    touchBuckets: Record<string, number>;
    rageTapBuckets: Record<string, number>;
    totalTouches: number;
    totalRageTaps: number;
    sampleSessionId: null;
    screenFirstSeenMs: number | null;
    pageWidth: number | null;
    pageHeight: number | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
};

export type ProductDeviceUsageDailyRow = {
    projectId: string;
    period: string;
    bytesUploaded: number;
    minutesRecorded: number;
    sessionsStarted: number;
    requestCount: number;
};

type ClickHouseDailyRow = {
    projectId: string;
    date: string;
    totalSessions: string | number;
    completedSessions: string | number;
    avgDurationSeconds: string | number | null;
    avgInteractionScore: string | number | null;
    avgUxScore: string | number | null;
    avgApiErrorRate: string | number | null;
    avgApiResponseMs: string | number | null;
    p50Duration: string | number | null;
    p90Duration: string | number | null;
    p50InteractionScore: string | number | null;
    p90InteractionScore: string | number | null;
    totalErrors: string | number;
    totalRageTaps: string | number;
    totalDeadTaps: string | number;
    totalCrashes: string | number;
    totalAnrs: string | number;
    totalBouncers: string | number;
    totalCasuals: string | number;
    totalExplorers: string | number;
    totalLoyalists: string | number;
    totalTouches: string | number;
    totalScrolls: string | number;
    totalGestures: string | number;
    totalInteractions: string | number;
    uniqueUserCount: string | number;
};

type ClickHouseDimensionRow = {
    projectId: string;
    date: string;
    dimensionType: keyof DimensionFieldMap;
    dimensionValue: string;
    count: string | number;
};

type ClickHouseHeatmapBucketRow = {
    projectId: string;
    screenName: string;
    eventKind: 'touch' | 'rage_tap';
    bucketX: string | number;
    bucketY: string | number;
    count: string | number;
    screenFirstSeenMs: string | number;
    pageWidth: string | number;
    pageHeight: string | number;
    viewportWidth: string | number;
    viewportHeight: string | number;
};

type DimensionFieldMap = {
    device_model: 'deviceModelBreakdown';
    os_version: 'osVersionBreakdown';
    platform: 'platformBreakdown';
    app_version: 'appVersionBreakdown';
    screen_view: 'screenViewBreakdown';
    screen_transition: 'screenTransitionBreakdown';
    entry_screen: 'entryScreenBreakdown';
    exit_screen: 'exitScreenBreakdown';
    geo_country: 'geoCountryBreakdown';
    custom_event: 'customEventBreakdown';
};

const DIMENSION_FIELD_MAP: DimensionFieldMap = {
    device_model: 'deviceModelBreakdown',
    os_version: 'osVersionBreakdown',
    platform: 'platformBreakdown',
    app_version: 'appVersionBreakdown',
    screen_view: 'screenViewBreakdown',
    screen_transition: 'screenTransitionBreakdown',
    entry_screen: 'entryScreenBreakdown',
    exit_screen: 'exitScreenBreakdown',
    geo_country: 'geoCountryBreakdown',
    custom_event: 'customEventBreakdown',
};

function toNumber(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function emptyBreakdowns(): Pick<ProductAnalyticsDailyStatsRow,
    'deviceModelBreakdown' |
    'osVersionBreakdown' |
    'platformBreakdown' |
    'appVersionBreakdown' |
    'screenViewBreakdown' |
    'screenTransitionBreakdown' |
    'entryScreenBreakdown' |
    'exitScreenBreakdown' |
    'geoCountryBreakdown' |
    'customEventBreakdown'
> {
    return {
        deviceModelBreakdown: {},
        osVersionBreakdown: {},
        platformBreakdown: {},
        appVersionBreakdown: {},
        screenViewBreakdown: {},
        screenTransitionBreakdown: {},
        entryScreenBreakdown: {},
        exitScreenBreakdown: {},
        geoCountryBreakdown: {},
        customEventBreakdown: {},
    };
}

function buildDateCondition(column: string, startDate?: string, endDate?: string): string {
    return `
        ${startDate ? `AND ${column} >= {startDate:Date}` : ''}
        ${endDate ? `AND ${column} <= {endDate:Date}` : ''}
    `;
}

function dailyRowFromClickHouse(row: ClickHouseDailyRow): ProductAnalyticsDailyStatsRow {
    return {
        projectId: row.projectId,
        date: row.date,
        totalSessions: toNumber(row.totalSessions),
        completedSessions: toNumber(row.completedSessions),
        avgDurationSeconds: toNullableNumber(row.avgDurationSeconds),
        avgInteractionScore: toNullableNumber(row.avgInteractionScore),
        avgUxScore: toNullableNumber(row.avgUxScore),
        avgApiErrorRate: toNullableNumber(row.avgApiErrorRate),
        avgApiResponseMs: toNullableNumber(row.avgApiResponseMs),
        p50Duration: toNullableNumber(row.p50Duration),
        p90Duration: toNullableNumber(row.p90Duration),
        p50InteractionScore: toNullableNumber(row.p50InteractionScore),
        p90InteractionScore: toNullableNumber(row.p90InteractionScore),
        totalErrors: toNumber(row.totalErrors),
        totalRageTaps: toNumber(row.totalRageTaps),
        totalDeadTaps: toNumber(row.totalDeadTaps),
        totalCrashes: toNumber(row.totalCrashes),
        totalAnrs: toNumber(row.totalAnrs),
        totalBouncers: toNumber(row.totalBouncers),
        totalCasuals: toNumber(row.totalCasuals),
        totalExplorers: toNumber(row.totalExplorers),
        totalLoyalists: toNumber(row.totalLoyalists),
        totalTouches: toNumber(row.totalTouches),
        totalScrolls: toNumber(row.totalScrolls),
        totalGestures: toNumber(row.totalGestures),
        totalInteractions: toNumber(row.totalInteractions),
        uniqueUserCount: toNumber(row.uniqueUserCount),
        ...emptyBreakdowns(),
    };
}

export function canReadProductRollupsFromClickHouse(): boolean {
    return isClickHouseConfigured();
}

export async function queryProductDailyStatsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
    endDate?: string;
}): Promise<ProductAnalyticsDailyStatsRow[]> {
    if (!canReadProductRollupsFromClickHouse() || params.projectIds.length === 0) return [];

    const dailyResult = await getClickHouseClient().query({
        query: `
            SELECT
                projectId,
                toString(rollupDate) AS date,
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
                totalBouncers,
                totalCasuals,
                totalExplorers,
                totalLoyalists,
                totalTouches,
                totalScrolls,
                totalGestures,
                totalInteractions,
                uniqueUserCount
            FROM
            (
                SELECT
                    toString(project_id) AS projectId,
                    date AS rollupDate,
                    argMax(total_sessions, updated_at) AS totalSessions,
                    argMax(completed_sessions, updated_at) AS completedSessions,
                    argMax(avg_duration_seconds, updated_at) AS avgDurationSeconds,
                    argMax(avg_interaction_score, updated_at) AS avgInteractionScore,
                    argMax(avg_ux_score, updated_at) AS avgUxScore,
                    argMax(avg_api_error_rate, updated_at) AS avgApiErrorRate,
                    argMax(avg_api_response_ms, updated_at) AS avgApiResponseMs,
                    argMax(p50_duration, updated_at) AS p50Duration,
                    argMax(p90_duration, updated_at) AS p90Duration,
                    argMax(p50_interaction_score, updated_at) AS p50InteractionScore,
                    argMax(p90_interaction_score, updated_at) AS p90InteractionScore,
                    argMax(total_errors, updated_at) AS totalErrors,
                    argMax(total_rage_taps, updated_at) AS totalRageTaps,
                    argMax(total_dead_taps, updated_at) AS totalDeadTaps,
                    argMax(total_crashes, updated_at) AS totalCrashes,
                    argMax(total_anrs, updated_at) AS totalAnrs,
                    argMax(total_bouncers, updated_at) AS totalBouncers,
                    argMax(total_casuals, updated_at) AS totalCasuals,
                    argMax(total_explorers, updated_at) AS totalExplorers,
                    argMax(total_loyalists, updated_at) AS totalLoyalists,
                    argMax(total_touches, updated_at) AS totalTouches,
                    argMax(total_scrolls, updated_at) AS totalScrolls,
                    argMax(total_gestures, updated_at) AS totalGestures,
                    argMax(total_interactions, updated_at) AS totalInteractions,
                    argMax(unique_user_count, updated_at) AS uniqueUserCount
                FROM app_daily_rollups
                WHERE project_id IN {projectIds:Array(UUID)}
                  ${buildDateCondition('date', params.startDate, params.endDate)}
                GROUP BY project_id, rollupDate
            )
            ORDER BY rollupDate ASC
        `,
        query_params: {
            projectIds: params.projectIds,
            ...(params.startDate ? { startDate: params.startDate } : {}),
            ...(params.endDate ? { endDate: params.endDate } : {}),
        },
        format: 'JSONEachRow',
    });

    const dailyRows = (await dailyResult.json<ClickHouseDailyRow>()).map(dailyRowFromClickHouse);
    if (dailyRows.length === 0) return [];

    const byKey = new Map(dailyRows.map((row) => [`${row.projectId}:${row.date}`, row]));
    const dimensionResult = await getClickHouseClient().query({
        query: `
            SELECT
                projectId,
                toString(rollupDate) AS date,
                dimensionType,
                dimensionValue,
                count
            FROM
            (
                SELECT
                    toString(project_id) AS projectId,
                    date AS rollupDate,
                    dimension_type AS dimensionType,
                    dimension_value AS dimensionValue,
                    argMax(count, updated_at) AS count
                FROM app_dimension_daily_rollups
                WHERE project_id IN {projectIds:Array(UUID)}
                  ${buildDateCondition('date', params.startDate, params.endDate)}
                GROUP BY project_id, rollupDate, dimension_type, dimension_value
            )
        `,
        query_params: {
            projectIds: params.projectIds,
            ...(params.startDate ? { startDate: params.startDate } : {}),
            ...(params.endDate ? { endDate: params.endDate } : {}),
        },
        format: 'JSONEachRow',
    });

    for (const dimension of await dimensionResult.json<ClickHouseDimensionRow>()) {
        const row = byKey.get(`${dimension.projectId}:${dimension.date}`);
        const field = DIMENSION_FIELD_MAP[dimension.dimensionType];
        if (!row || !field) continue;
        row[field][dimension.dimensionValue] = toNumber(dimension.count);
    }

    return dailyRows;
}

export async function queryProductAllTimeStatsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
    endDate?: string;
}): Promise<ProductAnalyticsAllTimeStatsRow[]> {
    const dailyRows = await queryProductDailyStatsFromClickHouse(params);
    const byProject = new Map<string, ProductAnalyticsAllTimeStatsRow>();

    const mergeBreakdown = (target: Record<string, number>, source: Record<string, number>) => {
        for (const [key, value] of Object.entries(source)) {
            target[key] = (target[key] || 0) + value;
        }
    };

    for (const row of dailyRows) {
        let aggregate = byProject.get(row.projectId);
        if (!aggregate) {
            aggregate = {
                projectId: row.projectId,
                totalSessions: 0,
                totalUsers: 0,
                totalEvents: 0,
                totalErrors: 0,
                totalRageTaps: 0,
                totalDeadTaps: 0,
                totalCrashes: 0,
                totalAnrs: 0,
                totalBouncers: 0,
                totalCasuals: 0,
                totalExplorers: 0,
                totalLoyalists: 0,
                totalTouches: 0,
                totalScrolls: 0,
                totalGestures: 0,
                totalInteractions: 0,
                uniqueUserCount: 0,
                avgSessionDurationSeconds: 0,
                avgDurationSeconds: null,
                avgInteractionScore: null,
                avgUxScore: null,
                avgApiErrorRate: null,
                avgApiResponseMs: null,
                ...emptyBreakdowns(),
            };
            byProject.set(row.projectId, aggregate);
        }

        const previousSessions = aggregate.totalSessions;
        const nextSessions = previousSessions + row.totalSessions;
        const weightAverage = (current: number | null, incoming: number | null): number | null => {
            if (incoming === null) return current;
            if (nextSessions === 0) return incoming;
            return (((current ?? 0) * previousSessions) + incoming * row.totalSessions) / nextSessions;
        };

        aggregate.totalSessions = nextSessions;
        aggregate.totalUsers += row.uniqueUserCount;
        aggregate.uniqueUserCount += row.uniqueUserCount;
        aggregate.totalErrors += row.totalErrors;
        aggregate.totalRageTaps += row.totalRageTaps;
        aggregate.totalDeadTaps += row.totalDeadTaps;
        aggregate.totalCrashes += row.totalCrashes;
        aggregate.totalAnrs += row.totalAnrs;
        aggregate.totalBouncers += row.totalBouncers;
        aggregate.totalCasuals += row.totalCasuals;
        aggregate.totalExplorers += row.totalExplorers;
        aggregate.totalLoyalists += row.totalLoyalists;
        aggregate.totalTouches += row.totalTouches;
        aggregate.totalScrolls += row.totalScrolls;
        aggregate.totalGestures += row.totalGestures;
        aggregate.totalInteractions += row.totalInteractions;
        aggregate.avgDurationSeconds = weightAverage(aggregate.avgDurationSeconds, row.avgDurationSeconds);
        aggregate.avgSessionDurationSeconds = aggregate.avgDurationSeconds ?? 0;
        aggregate.avgInteractionScore = weightAverage(aggregate.avgInteractionScore, row.avgInteractionScore);
        aggregate.avgUxScore = weightAverage(aggregate.avgUxScore, row.avgUxScore);
        aggregate.avgApiErrorRate = weightAverage(aggregate.avgApiErrorRate, row.avgApiErrorRate);
        aggregate.avgApiResponseMs = weightAverage(aggregate.avgApiResponseMs, row.avgApiResponseMs);
        mergeBreakdown(aggregate.deviceModelBreakdown, row.deviceModelBreakdown);
        mergeBreakdown(aggregate.osVersionBreakdown, row.osVersionBreakdown);
        mergeBreakdown(aggregate.platformBreakdown, row.platformBreakdown);
        mergeBreakdown(aggregate.appVersionBreakdown, row.appVersionBreakdown);
        mergeBreakdown(aggregate.screenViewBreakdown, row.screenViewBreakdown);
        mergeBreakdown(aggregate.screenTransitionBreakdown, row.screenTransitionBreakdown);
        mergeBreakdown(aggregate.entryScreenBreakdown, row.entryScreenBreakdown);
        mergeBreakdown(aggregate.exitScreenBreakdown, row.exitScreenBreakdown);
        mergeBreakdown(aggregate.geoCountryBreakdown, row.geoCountryBreakdown);
        mergeBreakdown(aggregate.customEventBreakdown, row.customEventBreakdown);
    }

    return Array.from(byProject.values());
}

export async function queryScreenTouchHeatmapsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
    endDate?: string;
}): Promise<ProductScreenTouchHeatmapRow[]> {
    if (!canReadProductRollupsFromClickHouse() || params.projectIds.length === 0) return [];

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                toString(project_id) AS projectId,
                screen_name AS screenName,
                event_kind AS eventKind,
                bucket_x AS bucketX,
                bucket_y AS bucketY,
                toUInt64(sum(bucket_count)) AS count,
                minIf(screen_first_seen_ms, screen_first_seen_ms > 0) AS screenFirstSeenMs,
                max(page_width) AS pageWidth,
                max(page_height) AS pageHeight,
                max(viewport_width) AS viewportWidth,
                max(viewport_height) AS viewportHeight
            FROM screen_touch_heatmap_daily_rollups
            WHERE project_id IN {projectIds:Array(UUID)}
              ${buildDateCondition('date', params.startDate, params.endDate)}
            GROUP BY project_id, screen_name, event_kind, bucket_x, bucket_y
        `,
        query_params: {
            projectIds: params.projectIds,
            ...(params.startDate ? { startDate: params.startDate } : {}),
            ...(params.endDate ? { endDate: params.endDate } : {}),
        },
        format: 'JSONEachRow',
    });

    const byScreen = new Map<string, ProductScreenTouchHeatmapRow>();
    for (const bucket of await result.json<ClickHouseHeatmapBucketRow>()) {
        const key = `${bucket.projectId}:${bucket.screenName}`;
        let row = byScreen.get(key);
        if (!row) {
            row = {
                projectId: bucket.projectId,
                screenName: bucket.screenName,
                touchBuckets: {},
                rageTapBuckets: {},
                totalTouches: 0,
                totalRageTaps: 0,
                sampleSessionId: null,
                screenFirstSeenMs: null,
                pageWidth: null,
                pageHeight: null,
                viewportWidth: null,
                viewportHeight: null,
            };
            byScreen.set(key, row);
        }

        const bucketKey = `${(toNumber(bucket.bucketX) / 100).toFixed(2)},${(toNumber(bucket.bucketY) / 100).toFixed(2)}`;
        const count = toNumber(bucket.count);
        if (bucket.eventKind === 'rage_tap') {
            row.rageTapBuckets[bucketKey] = count;
            row.totalRageTaps += count;
        } else {
            row.touchBuckets[bucketKey] = count;
            row.totalTouches += count;
        }

        const firstSeenMs = toNumber(bucket.screenFirstSeenMs);
        row.screenFirstSeenMs = row.screenFirstSeenMs === null && firstSeenMs > 0
            ? firstSeenMs
            : row.screenFirstSeenMs;
        row.pageWidth = toNumber(bucket.pageWidth) || row.pageWidth;
        row.pageHeight = toNumber(bucket.pageHeight) || row.pageHeight;
        row.viewportWidth = toNumber(bucket.viewportWidth) || row.viewportWidth;
        row.viewportHeight = toNumber(bucket.viewportHeight) || row.viewportHeight;
    }

    return Array.from(byScreen.values());
}

export async function queryDeviceUsageDailyRollupsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
    endDate?: string;
}): Promise<ProductDeviceUsageDailyRow[]> {
    if (!canReadProductRollupsFromClickHouse() || params.projectIds.length === 0) return [];

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                projectId,
                toString(rollupPeriod) AS period,
                bytesUploaded,
                minutesRecorded,
                sessionsStarted,
                requestCount
            FROM
            (
                SELECT
                    toString(project_id) AS projectId,
                    period AS rollupPeriod,
                    toUInt64(sum(bytes_uploaded)) AS bytesUploaded,
                    toUInt64(sum(minutes_recorded)) AS minutesRecorded,
                    toUInt64(sum(sessions_started)) AS sessionsStarted,
                    toUInt64(sum(request_count)) AS requestCount
                FROM device_usage_daily_rollups
                WHERE project_id IN {projectIds:Array(UUID)}
                  ${buildDateCondition('period', params.startDate, params.endDate)}
                GROUP BY project_id, rollupPeriod
            )
            ORDER BY rollupPeriod ASC
        `,
        query_params: {
            projectIds: params.projectIds,
            ...(params.startDate ? { startDate: params.startDate } : {}),
            ...(params.endDate ? { endDate: params.endDate } : {}),
        },
        format: 'JSONEachRow',
    });

    return (await result.json<{
        projectId: string;
        period: string;
        bytesUploaded: string | number;
        minutesRecorded: string | number;
        sessionsStarted: string | number;
        requestCount: string | number;
    }>()).map((row) => ({
        projectId: row.projectId,
        period: row.period,
        bytesUploaded: toNumber(row.bytesUploaded),
        minutesRecorded: toNumber(row.minutesRecorded),
        sessionsStarted: toNumber(row.sessionsStarted),
        requestCount: toNumber(row.requestCount),
    }));
}
