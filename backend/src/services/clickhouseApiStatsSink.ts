import { getClickHouseClient, isClickHouseDualWriteEnabled } from '../db/clickhouse.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export type ClickHouseApiEndpointEventRow = {
    project_id: string;
    event_date: string;
    event_time: string;
    session_id: string;
    artifact_id: string;
    event_index: number;
    method: string;
    path: string;
    endpoint: string;
    region: string;
    status_code: number;
    is_error: 0 | 1;
    duration_ms: number;
    source: string;
    schema_version: number;
};

function toClickHouseDateTime(value: Date): string {
    return value.toISOString().replace('T', ' ').replace('Z', '');
}

export function buildClickHouseApiEndpointEventRow(params: {
    projectId: string;
    sessionId: string;
    artifactId: string;
    eventIndex: number;
    method: string;
    path: string;
    statusCode: number;
    isError: boolean;
    durationMs: number;
    eventAt: Date | null;
    region?: string | null;
}): ClickHouseApiEndpointEventRow {
    const eventAt = params.eventAt && Number.isFinite(params.eventAt.getTime())
        ? params.eventAt
        : new Date();
    const method = params.method.trim().toUpperCase() || 'GET';
    const path = params.path.trim() || '/';
    const statusCode = Number.isFinite(params.statusCode)
        ? Math.max(0, Math.min(999, Math.trunc(params.statusCode)))
        : 0;
    const durationMs = Number.isFinite(params.durationMs)
        ? Math.max(0, Math.round(params.durationMs))
        : 0;

    return {
        project_id: params.projectId,
        event_date: eventAt.toISOString().slice(0, 10),
        event_time: toClickHouseDateTime(eventAt),
        session_id: params.sessionId,
        artifact_id: params.artifactId,
        event_index: Math.max(0, Math.trunc(params.eventIndex)),
        method,
        path,
        endpoint: `${method} ${path}`,
        region: params.region?.trim() || 'unknown',
        status_code: statusCode,
        is_error: params.isError ? 1 : 0,
        duration_ms: durationMs,
        source: 'event_artifact',
        schema_version: 1,
    };
}

export async function writeApiEndpointEventsToClickHouse(params: {
    artifactId: string;
    rows: ClickHouseApiEndpointEventRow[];
}): Promise<void> {
    if (!isClickHouseDualWriteEnabled() || params.rows.length === 0) return;

    try {
        const settings = {
            ...(config.CLICKHOUSE_ASYNC_INSERT ? { async_insert: 1 as const, wait_for_async_insert: 1 as const } : {}),
            insert_deduplication_token: `api-endpoint-events:${params.artifactId}:v1`,
        };

        await getClickHouseClient().insert({
            table: 'api_endpoint_request_events',
            values: params.rows,
            format: 'JSONEachRow',
            clickhouse_settings: settings,
        });
    } catch (err) {
        logger.warn({
            err,
            artifactId: params.artifactId,
            rowCount: params.rows.length,
        }, 'ClickHouse API endpoint event insert failed');
    }
}
