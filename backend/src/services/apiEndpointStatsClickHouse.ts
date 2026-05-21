import { getClickHouseClient, isClickHouseReadsEnabled } from '../db/clickhouse.js';
import { config } from '../config.js';

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

function buildRawDateCondition(startDate?: string): string {
    return startDate ? 'AND event_date >= {startDate:Date}' : '';
}

function buildImportedDateCondition(startDate?: string): string {
    return startDate ? 'AND date >= {startDate:Date}' : '';
}

function getClickHouseCutoverDate(): string | undefined {
    const cutoverDate = config.CLICKHOUSE_CUTOVER_DATE?.trim();
    if (!cutoverDate) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate)) {
        throw new Error(`Invalid CLICKHOUSE_CUTOVER_DATE value: ${cutoverDate}`);
    }
    return cutoverDate;
}

export function canReadApiEndpointStatsFromClickHouse(): boolean {
    return isClickHouseReadsEnabled();
}

export async function queryApiEndpointStatusRowsFromClickHouse(params: {
    projectIds: string[];
    startDate?: string;
}): Promise<ClickHouseEndpointStatusRow[]> {
    if (!canReadApiEndpointStatsFromClickHouse() || params.projectIds.length === 0) return [];

    const cutoverDate = getClickHouseCutoverDate();
    const queryParams = {
        projectIds: params.projectIds,
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(cutoverDate ? { cutoverDate } : {}),
    };
    const query = cutoverDate
        ? `
            SELECT
                endpoint,
                toUInt16(0) AS statusCode,
                sum(total_calls) AS totalCalls,
                sum(total_errors) AS totalErrors,
                sum(sum_latency_ms) AS sumLatencyMs,
                status_code_breakdown_json AS statusCodeBreakdownJson
            FROM api_endpoint_daily_stats_imported FINAL
            WHERE project_id IN {projectIds:Array(UUID)}
              AND date < {cutoverDate:Date}
              ${buildImportedDateCondition(params.startDate)}
            GROUP BY endpoint, status_code_breakdown_json

            UNION ALL

            SELECT
                endpoint,
                status_code AS statusCode,
                count() AS totalCalls,
                countIf(is_error = 1) AS totalErrors,
                sum(duration_ms) AS sumLatencyMs,
                '' AS statusCodeBreakdownJson
            FROM api_endpoint_request_events
            WHERE project_id IN {projectIds:Array(UUID)}
              AND event_date >= {cutoverDate:Date}
              ${buildRawDateCondition(params.startDate)}
            GROUP BY endpoint, status_code
        `
        : `
            SELECT
                endpoint,
                status_code AS statusCode,
                count() AS totalCalls,
                countIf(is_error = 1) AS totalErrors,
                sum(duration_ms) AS sumLatencyMs,
                '' AS statusCodeBreakdownJson
            FROM api_endpoint_request_events
            WHERE project_id IN {projectIds:Array(UUID)}
              ${buildRawDateCondition(params.startDate)}
            GROUP BY endpoint, status_code
        `;

    const result = await getClickHouseClient().query({
        query,
        query_params: queryParams,
        format: 'JSONEachRow',
    });

    return await result.json<ClickHouseEndpointStatusRow>();
}

export async function queryRegionStatsFromClickHouse(params: {
    projectId: string;
    startDate: string;
}): Promise<ClickHouseRegionStatsRow[]> {
    if (!canReadApiEndpointStatsFromClickHouse()) return [];

    const cutoverDate = getClickHouseCutoverDate();
    const queryParams = {
        projectId: params.projectId,
        startDate: params.startDate,
        ...(cutoverDate ? { cutoverDate } : {}),
    };
    const query = cutoverDate
        ? `
            SELECT
                region,
                sum(totalCalls) AS totalCalls,
                sum(sumLatencyMs) AS sumLatencyMs
            FROM
            (
                SELECT
                    region,
                    sum(total_calls) AS totalCalls,
                    sum(sum_latency_ms) AS sumLatencyMs
                FROM api_endpoint_daily_stats_imported FINAL
                WHERE project_id = {projectId:UUID}
                  AND date < {cutoverDate:Date}
                  AND date >= {startDate:Date}
                GROUP BY region

                UNION ALL

                SELECT
                    region,
                    count() AS totalCalls,
                    sum(duration_ms) AS sumLatencyMs
                FROM api_endpoint_request_events
                WHERE project_id = {projectId:UUID}
                  AND event_date >= {cutoverDate:Date}
                  AND event_date >= {startDate:Date}
                GROUP BY region
            )
            GROUP BY region
        `
        : `
            SELECT
                region,
                count() AS totalCalls,
                sum(duration_ms) AS sumLatencyMs
            FROM api_endpoint_request_events
            WHERE project_id = {projectId:UUID}
              AND event_date >= {startDate:Date}
            GROUP BY region
        `;

    const result = await getClickHouseClient().query({
        query,
        query_params: queryParams,
        format: 'JSONEachRow',
    });

    return await result.json<ClickHouseRegionStatsRow>();
}
