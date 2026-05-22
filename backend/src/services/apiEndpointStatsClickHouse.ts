import { getClickHouseClient, isClickHouseReadsEnabled } from '../db/clickhouse.js';

export type ClickHouseEndpointStatusRow = {
    endpoint: string;
    statusCode: number;
    totalCalls: string | number;
    totalErrors: string | number;
    sumLatencyMs: string | number;
    statusCodeBreakdownJson?: string;
};

export type ClickHouseRegionStatsRow = {
    region: string;
    totalCalls: string | number;
    sumLatencyMs: string | number;
};

export type ClickHouseDailyApiCallsRow = {
    date: string;
    totalCalls: string | number;
};

export type ClickHouseSlowApiEndpointRow = {
    endpoint: string;
    totalCalls: string | number;
    totalErrors: string | number;
    avgLatency: string | number;
};

function buildDateCondition(column: string, startDate?: string, endDate?: string): string {
    return `
        ${startDate ? `AND ${column} >= {startDate:Date}` : ''}
        ${endDate ? `AND ${column} <= {endDate:Date}` : ''}
    `;
}

function buildEndpointProductAnalyticsCondition(column: string = 'endpoint'): string {
    return `
        AND lower(${column}) NOT LIKE '%rejourney%'
        AND lower(${column}) NOT LIKE '%/api/ingest%'
        AND lower(${column}) NOT LIKE '%/upload/artifacts%'
        AND NOT match(
            lower(${column}),
            '\\\\.(jpg|jpeg|png|gif|webp|avif|svg|ico|css|js|map|woff2?|ttf|otf|mp4|webm|mov|m4v|mp3|wav|pdf)($|[?#])'
        )
    `;
}

export function canReadApiEndpointStatsFromClickHouse(): boolean {
    return isClickHouseReadsEnabled();
}

export async function queryApiEndpointStatusRowsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
}): Promise<ClickHouseEndpointStatusRow[]> {
    if (!canReadApiEndpointStatsFromClickHouse() || params.projectIds.length === 0) return [];

    const query = `
        SELECT
            endpoint,
            status_code AS statusCode,
            toUInt64(sum(total_calls)) AS totalCalls,
            toUInt64(sum(total_errors)) AS totalErrors,
            toUInt64(sum(sum_latency_ms)) AS sumLatencyMs,
            '' AS statusCodeBreakdownJson
        FROM api_endpoint_daily_rollups
        WHERE project_id IN {projectIds:Array(UUID)}
          ${buildDateCondition('date', params.startDate)}
          ${buildEndpointProductAnalyticsCondition()}
        GROUP BY endpoint, status_code
    `;

    const result = await getClickHouseClient().query({
        query,
        query_params: {
            projectIds: params.projectIds,
            ...(params.startDate ? { startDate: params.startDate } : {}),
        },
        format: 'JSONEachRow',
    });

    return await result.json<ClickHouseEndpointStatusRow>();
}

export async function queryRegionStatsFromClickHouse(params: {
    projectId: string;
    startDate: string;
}): Promise<ClickHouseRegionStatsRow[]> {
    if (!canReadApiEndpointStatsFromClickHouse()) return [];

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                region,
                toUInt64(sum(total_calls)) AS totalCalls,
                toUInt64(sum(sum_latency_ms)) AS sumLatencyMs
            FROM api_endpoint_daily_rollups
            WHERE project_id = {projectId:UUID}
              ${buildDateCondition('date', params.startDate)}
              ${buildEndpointProductAnalyticsCondition()}
            GROUP BY region
        `,
        query_params: {
            projectId: params.projectId,
            startDate: params.startDate,
        },
        format: 'JSONEachRow',
    });

    return await result.json<ClickHouseRegionStatsRow>();
}

export async function queryDailyApiCallsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
    endDate?: string;
}): Promise<ClickHouseDailyApiCallsRow[]> {
    if (!canReadApiEndpointStatsFromClickHouse() || params.projectIds.length === 0) return [];

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                toString(rollupDate) AS date,
                totalCalls
            FROM
            (
                SELECT
                    date AS rollupDate,
                    toUInt64(sum(total_calls)) AS totalCalls
                FROM api_endpoint_daily_rollups
                WHERE project_id IN {projectIds:Array(UUID)}
                  ${buildDateCondition('date', params.startDate, params.endDate)}
                  ${buildEndpointProductAnalyticsCondition()}
                GROUP BY rollupDate
            )
        `,
        query_params: {
            projectIds: params.projectIds,
            ...(params.startDate ? { startDate: params.startDate } : {}),
            ...(params.endDate ? { endDate: params.endDate } : {}),
        },
        format: 'JSONEachRow',
    });

    return await result.json<ClickHouseDailyApiCallsRow>();
}

export async function querySlowApiEndpointsFromClickHouse(params: {
    projectId: string;
    startDate: string;
    limit?: number;
    minCalls?: number;
}): Promise<ClickHouseSlowApiEndpointRow[]> {
    if (!canReadApiEndpointStatsFromClickHouse()) return [];

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                endpoint,
                toUInt64(sum(total_calls)) AS totalCalls,
                toUInt64(sum(total_errors)) AS totalErrors,
                sum(sum_latency_ms) / nullIf(sum(total_calls), 0) AS avgLatency
            FROM api_endpoint_daily_rollups
            WHERE project_id = {projectId:UUID}
              ${buildDateCondition('date', params.startDate)}
              ${buildEndpointProductAnalyticsCondition()}
            GROUP BY endpoint
            HAVING totalCalls >= {minCalls:UInt32}
               AND (
                    avgLatency > 500
                    OR totalErrors / nullIf(totalCalls, 0) > 0.05
               )
            ORDER BY totalErrors DESC, avgLatency DESC
            LIMIT {limit:UInt32}
        `,
        query_params: {
            projectId: params.projectId,
            startDate: params.startDate,
            minCalls: params.minCalls ?? 10,
            limit: params.limit ?? 50,
        },
        format: 'JSONEachRow',
    });

    return await result.json<ClickHouseSlowApiEndpointRow>();
}

export async function querySlowestApiEndpointsFromClickHouse(params: {
    projectId: string;
    date: string;
    limit?: number;
}): Promise<Array<{ endpoint: string; latency: string | number }>> {
    if (!canReadApiEndpointStatsFromClickHouse()) return [];

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                endpoint,
                sum(sum_latency_ms) / nullIf(sum(total_calls), 0) AS latency
            FROM api_endpoint_daily_rollups
            WHERE project_id = {projectId:UUID}
              AND date = {date:Date}
              ${buildEndpointProductAnalyticsCondition()}
            GROUP BY endpoint
            HAVING sum(total_calls) > 0
            ORDER BY latency DESC
            LIMIT {limit:UInt32}
        `,
        query_params: {
            projectId: params.projectId,
            date: params.date,
            limit: params.limit ?? 5,
        },
        format: 'JSONEachRow',
    });

    return await result.json<{ endpoint: string; latency: string | number }>();
}
