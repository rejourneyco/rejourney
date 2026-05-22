import { getClickHouseClient, isClickHouseConfigured } from '../src/db/clickhouse.js';

function readArg(name: string): string | undefined {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length).trim() : undefined;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function validateDate(name: string, value?: string): string | undefined {
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${name} must be YYYY-MM-DD`);
    }
    return value;
}

function normalizeEndpointSql(column: string = 'endpoint'): string {
    return `
        replaceRegexpAll(
            replaceRegexpAll(
                replaceRegexpAll(
                    replaceRegexpAll(
                        ${column},
                        '(/api/extractors/feeds/)[^/]+(/listings/?)',
                        '\\\\1:feed\\\\2'
                    ),
                    '/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(/|$)',
                    '/:id\\\\1'
                ),
                '/[0-9A-Fa-f]{16,}(/|$)',
                '/:id\\\\1'
            ),
            '/[0-9]+(/|$)',
            '/:id\\\\1'
        )
    `;
}

function productEndpointCondition(column: string = 'endpoint'): string {
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

function projectCondition(projectId?: string): string {
    return projectId ? 'AND project_id = {projectId:UUID}' : '';
}

function importedDateConditions(since?: string, until?: string): string {
    return `
        ${since ? 'AND date >= {since:Date}' : ''}
        ${until ? 'AND date < {until:Date}' : ''}
    `;
}

function rawDateConditions(since?: string, until?: string): string {
    return `
        ${since ? 'AND event_date >= {since:Date}' : ''}
        ${until ? 'AND event_date < {until:Date}' : ''}
        AND inserted_at <= toDateTime64({rawWatermark:String}, 3, 'UTC')
    `;
}

async function command(query: string, queryParams: Record<string, unknown>): Promise<void> {
    await getClickHouseClient().command({
        query,
        query_params: queryParams,
    });
}

async function main(): Promise<void> {
    if (!isClickHouseConfigured()) {
        console.log('[clickhouse-rollup-backfill] ClickHouse disabled; skipping');
        return;
    }

    const since = validateDate('--since', readArg('since') || process.env.CLICKHOUSE_ROLLUP_BACKFILL_SINCE);
    const until = validateDate('--until', readArg('until') || process.env.CLICKHOUSE_ROLLUP_BACKFILL_UNTIL);
    const projectId = readArg('project-id') || process.env.CLICKHOUSE_ROLLUP_BACKFILL_PROJECT_ID;
    const replace = hasFlag('replace') || process.env.CLICKHOUSE_ROLLUP_BACKFILL_REPLACE === 'true';
    const dryRun = hasFlag('dry-run');
    const rawWatermark = new Date().toISOString().slice(0, 23).replace('T', ' ');
    const queryParams = {
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(projectId ? { projectId } : {}),
        rawWatermark,
    };

    console.log('[clickhouse-rollup-backfill] starting', {
        since: since || null,
        until: until || null,
        projectId: projectId || null,
        replace,
        rawWatermark,
        dryRun,
    });

    if (dryRun) return;

    if (replace) {
        if (since || until || projectId) {
            throw new Error('--replace only supports a full-table rebuild; omit --since, --until, and --project-id');
        }
        await command('TRUNCATE TABLE rejourney.api_endpoint_daily_rollups', {});
    }

    await command(
        `
            INSERT INTO rejourney.api_endpoint_daily_rollups
            (
                project_id,
                date,
                endpoint,
                region,
                status_code,
                total_calls,
                total_errors,
                sum_latency_ms,
                updated_at
            )
            SELECT
                project_id,
                date,
                ${normalizeEndpointSql()} AS endpoint,
                region,
                toUInt16(0) AS status_code,
                toUInt64(sum(total_calls)) AS total_calls,
                toUInt64(greatest(
                    toInt64(sum(total_errors)) -
                    toInt64(sum(arraySum(arrayMap(
                        statusCodePair -> tupleElement(statusCodePair, 2),
                        arrayFilter(
                            statusCodePair -> toUInt16OrZero(tupleElement(statusCodePair, 1)) > 0,
                            JSONExtractKeysAndValues(status_code_breakdown_json, 'UInt64')
                        )
                    )))),
                    0
                )) AS total_errors,
                toUInt64(sum(sum_latency_ms)) AS sum_latency_ms,
                now64(3) AS updated_at
            FROM rejourney.api_endpoint_daily_stats_imported
            WHERE 1 = 1
              ${projectCondition(projectId)}
              ${importedDateConditions(since, until)}
              ${productEndpointCondition()}
            GROUP BY project_id, date, endpoint, region
        `,
        queryParams,
    );

    await command(
        `
            INSERT INTO rejourney.api_endpoint_daily_rollups
            (
                project_id,
                date,
                endpoint,
                region,
                status_code,
                total_calls,
                total_errors,
                sum_latency_ms,
                updated_at
            )
            SELECT
                project_id,
                date,
                endpoint,
                region,
                status_code,
                toUInt64(0) AS total_calls,
                toUInt64(sum(status_errors)) AS total_errors,
                toUInt64(0) AS sum_latency_ms,
                now64(3) AS updated_at
            FROM
            (
                SELECT
                    project_id,
                    date,
                    ${normalizeEndpointSql()} AS endpoint,
                    region,
                    toUInt16OrZero(tupleElement(statusCodePair, 1)) AS status_code,
                    toUInt64(tupleElement(statusCodePair, 2)) AS status_errors
                FROM rejourney.api_endpoint_daily_stats_imported
                ARRAY JOIN JSONExtractKeysAndValues(status_code_breakdown_json, 'UInt64') AS statusCodePair
                WHERE 1 = 1
                  ${projectCondition(projectId)}
                  ${importedDateConditions(since, until)}
                  ${productEndpointCondition()}
                  AND status_code_breakdown_json != '{}'
                  AND status_code_breakdown_json != ''
                  AND toUInt16OrZero(tupleElement(statusCodePair, 1)) > 0
            )
            GROUP BY project_id, date, endpoint, region, status_code
        `,
        queryParams,
    );

    await command(
        `
            INSERT INTO rejourney.api_endpoint_daily_rollups
            (
                project_id,
                date,
                endpoint,
                region,
                status_code,
                total_calls,
                total_errors,
                sum_latency_ms,
                updated_at
            )
            SELECT
                project_id,
                event_date AS date,
                ${normalizeEndpointSql()} AS endpoint,
                region,
                status_code,
                toUInt64(count()) AS total_calls,
                toUInt64(countIf(is_error = 1)) AS total_errors,
                toUInt64(sum(duration_ms)) AS sum_latency_ms,
                max(inserted_at) AS updated_at
            FROM rejourney.api_endpoint_request_events
            WHERE 1 = 1
              ${projectCondition(projectId)}
              ${rawDateConditions(since, until)}
              ${productEndpointCondition()}
            GROUP BY project_id, date, endpoint, region, status_code
        `,
        queryParams,
    );

    console.log('[clickhouse-rollup-backfill] complete');
}

main().catch((error) => {
    console.error('[clickhouse-rollup-backfill] failed', error);
    process.exit(1);
});
