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

type RawReadsAfter = {
    date: string;
    timestamp: string;
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

function getClickHouseRawReadsAfter(): RawReadsAfter | undefined {
    const rawReadsAfter = config.CLICKHOUSE_RAW_READS_AFTER?.trim();
    if (!rawReadsAfter) return undefined;

    const parsed = new Date(rawReadsAfter);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid CLICKHOUSE_RAW_READS_AFTER value: ${rawReadsAfter}`);
    }

    const iso = parsed.toISOString();
    return {
        date: iso.slice(0, 10),
        timestamp: iso.slice(0, 23).replace('T', ' '),
    };
}

function buildRawCutoverCondition(rawReadsAfter?: RawReadsAfter): string {
    if (!rawReadsAfter) return 'AND event_date >= {cutoverDate:Date}';

    return `
              AND (
                event_date >= {cutoverDate:Date}
                OR (
                  event_date = {rawReadsAfterDate:Date}
                  AND inserted_at > toDateTime64({rawReadsAfter:String}, 3, 'UTC')
                )
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

    const cutoverDate = getClickHouseCutoverDate();
    const rawReadsAfter = cutoverDate ? getClickHouseRawReadsAfter() : undefined;
    const queryParams = {
        projectIds: params.projectIds,
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(cutoverDate ? { cutoverDate } : {}),
        ...(rawReadsAfter ? {
            rawReadsAfterDate: rawReadsAfter.date,
            rawReadsAfter: rawReadsAfter.timestamp,
        } : {}),
    };
    const query = cutoverDate
        ? `
            SELECT
                endpoint,
                toUInt16(0) AS statusCode,
                toUInt64(sum(total_calls)) AS totalCalls,
                toUInt64(sum(total_errors)) AS totalErrors,
                toUInt64(sum(sum_latency_ms)) AS sumLatencyMs,
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
                toUInt64(count()) AS totalCalls,
                toUInt64(countIf(is_error = 1)) AS totalErrors,
                toUInt64(sum(duration_ms)) AS sumLatencyMs,
                '' AS statusCodeBreakdownJson
            FROM api_endpoint_request_events
            WHERE project_id IN {projectIds:Array(UUID)}
              ${buildRawCutoverCondition(rawReadsAfter)}
              ${buildRawDateCondition(params.startDate)}
            GROUP BY endpoint, status_code
        `
        : `
            SELECT
                endpoint,
                status_code AS statusCode,
                toUInt64(count()) AS totalCalls,
                toUInt64(countIf(is_error = 1)) AS totalErrors,
                toUInt64(sum(duration_ms)) AS sumLatencyMs,
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
    const rawReadsAfter = cutoverDate ? getClickHouseRawReadsAfter() : undefined;
    const queryParams = {
        projectId: params.projectId,
        startDate: params.startDate,
        ...(cutoverDate ? { cutoverDate } : {}),
        ...(rawReadsAfter ? {
            rawReadsAfterDate: rawReadsAfter.date,
            rawReadsAfter: rawReadsAfter.timestamp,
        } : {}),
    };
    const query = cutoverDate
        ? `
            SELECT
                region,
                toUInt64(sum(totalCalls)) AS totalCalls,
                toUInt64(sum(sumLatencyMs)) AS sumLatencyMs
            FROM
            (
                SELECT
                    region,
                    toUInt64(sum(total_calls)) AS totalCalls,
                    toUInt64(sum(sum_latency_ms)) AS sumLatencyMs
                FROM api_endpoint_daily_stats_imported FINAL
                WHERE project_id = {projectId:UUID}
                  AND date < {cutoverDate:Date}
                  AND date >= {startDate:Date}
                GROUP BY region

                UNION ALL

                SELECT
                    region,
                    toUInt64(count()) AS totalCalls,
                    toUInt64(sum(duration_ms)) AS sumLatencyMs
                FROM api_endpoint_request_events
                WHERE project_id = {projectId:UUID}
                  ${buildRawCutoverCondition(rawReadsAfter)}
                  AND event_date >= {startDate:Date}
                GROUP BY region
            )
            GROUP BY region
        `
        : `
            SELECT
                region,
                toUInt64(count()) AS totalCalls,
                toUInt64(sum(duration_ms)) AS sumLatencyMs
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
