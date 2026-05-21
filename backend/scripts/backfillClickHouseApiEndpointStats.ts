import { pool } from '../src/db/client.js';
import {
    closeClickHouseClient,
    getClickHouseClient,
    isClickHouseConfigured,
} from '../src/db/clickhouse.js';
import { config } from '../src/config.js';

type PgApiEndpointDailyStatRow = {
    id: string;
    project_id: string;
    date: string;
    endpoint: string;
    region: string;
    total_calls: string;
    total_errors: string;
    sum_latency_ms: string;
    status_code_breakdown_json: string;
    p50_latency_ms: number | null;
    p90_latency_ms: number | null;
    p99_latency_ms: number | null;
};

type ClickHouseApiEndpointDailyStatImportRow = {
    project_id: string;
    date: string;
    endpoint: string;
    region: string;
    total_calls: string;
    total_errors: string;
    sum_latency_ms: string;
    status_code_breakdown_json: string;
    p50_latency_ms: number | null;
    p90_latency_ms: number | null;
    p99_latency_ms: number | null;
};

type BackfillOptions = {
    sinceDate?: string;
    untilDate: string;
    projectId?: string;
    batchSize: number;
    dryRun: boolean;
};

function readArg(name: string): string | undefined {
    const prefix = `--${name}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);

    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0) return process.argv[index + 1];
    return undefined;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function parseDateArg(value: string | undefined, label: string): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new Error(`${label} must use YYYY-MM-DD format`);
    }
    return trimmed;
}

function parseProjectId(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
        throw new Error('--project-id must be a UUID');
    }
    return trimmed;
}

function parseBatchSize(value: string | undefined): number {
    const parsed = Number.parseInt(value || '5000', 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
        throw new Error('--batch-size must be an integer from 1 to 100000');
    }
    return parsed;
}

function parseOptions(): BackfillOptions {
    const sinceDate = parseDateArg(
        readArg('since') || process.env.CLICKHOUSE_BACKFILL_SINCE,
        '--since',
    );
    const untilDate = parseDateArg(
        readArg('until') || process.env.CLICKHOUSE_BACKFILL_UNTIL || config.CLICKHOUSE_CUTOVER_DATE,
        '--until or CLICKHOUSE_CUTOVER_DATE',
    );

    if (!untilDate) {
        throw new Error('Set --until YYYY-MM-DD or CLICKHOUSE_CUTOVER_DATE before running the backfill');
    }
    if (sinceDate && sinceDate >= untilDate) {
        throw new Error('--since must be earlier than --until');
    }

    return {
        sinceDate,
        untilDate,
        projectId: parseProjectId(readArg('project-id') || process.env.CLICKHOUSE_BACKFILL_PROJECT_ID),
        batchSize: parseBatchSize(readArg('batch-size') || process.env.CLICKHOUSE_BACKFILL_BATCH_SIZE),
        dryRun: hasFlag('dry-run') || process.env.CLICKHOUSE_BACKFILL_DRY_RUN === 'true',
    };
}

async function readPostgresBatch(options: BackfillOptions, cursor: {
    lastDate: string | null;
    lastId: string | null;
}): Promise<PgApiEndpointDailyStatRow[]> {
    const result = await pool.query<PgApiEndpointDailyStatRow>(
        `
            SELECT
                id::text AS id,
                project_id::text AS project_id,
                date::text AS date,
                endpoint,
                region,
                total_calls::text AS total_calls,
                total_errors::text AS total_errors,
                sum_latency_ms::text AS sum_latency_ms,
                COALESCE(status_code_breakdown, '{}'::jsonb)::text AS status_code_breakdown_json,
                p50_latency_ms,
                p90_latency_ms,
                p99_latency_ms
            FROM api_endpoint_daily_stats
            WHERE date < $1::date
              AND ($2::date IS NULL OR date >= $2::date)
              AND ($3::uuid IS NULL OR project_id = $3::uuid)
              AND ($4::date IS NULL OR (date, id) > ($4::date, $5::uuid))
            ORDER BY date ASC, id ASC
            LIMIT $6
        `,
        [
            options.untilDate,
            options.sinceDate ?? null,
            options.projectId ?? null,
            cursor.lastDate,
            cursor.lastId,
            options.batchSize,
        ],
    );

    return result.rows;
}

function toClickHouseRows(rows: PgApiEndpointDailyStatRow[]): ClickHouseApiEndpointDailyStatImportRow[] {
    return rows.map((row) => ({
        project_id: row.project_id,
        date: row.date,
        endpoint: row.endpoint,
        region: row.region || 'unknown',
        total_calls: row.total_calls,
        total_errors: row.total_errors,
        sum_latency_ms: row.sum_latency_ms,
        status_code_breakdown_json: row.status_code_breakdown_json || '{}',
        p50_latency_ms: row.p50_latency_ms,
        p90_latency_ms: row.p90_latency_ms,
        p99_latency_ms: row.p99_latency_ms,
    }));
}

async function insertClickHouseBatch(options: BackfillOptions, rows: PgApiEndpointDailyStatRow[]): Promise<void> {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const settings = {
        input_format_json_read_numbers_as_strings: 1 as const,
        ...(config.CLICKHOUSE_ASYNC_INSERT ? { async_insert: 1 as const, wait_for_async_insert: 1 as const } : {}),
        insert_deduplication_token: [
            'api-endpoint-daily-stats-backfill',
            options.sinceDate ?? 'begin',
            options.untilDate,
            options.projectId ?? 'all',
            first?.date ?? 'empty',
            first?.id ?? 'empty',
            last?.date ?? 'empty',
            last?.id ?? 'empty',
            'v1',
        ].join(':'),
    };

    await getClickHouseClient().insert({
        table: 'api_endpoint_daily_stats_imported',
        values: toClickHouseRows(rows),
        format: 'JSONEachRow',
        clickhouse_settings: settings,
    });
}

async function main(): Promise<void> {
    const options = parseOptions();
    if (!options.dryRun && !isClickHouseConfigured()) {
        throw new Error('ClickHouse is not enabled or CLICKHOUSE_URL is missing');
    }

    console.log(
        [
            '[clickhouse-backfill-api-stats] starting',
            `since=${options.sinceDate ?? 'beginning'}`,
            `untilExclusive=${options.untilDate}`,
            `project=${options.projectId ?? 'all'}`,
            `batchSize=${options.batchSize}`,
            `dryRun=${options.dryRun}`,
        ].join(' '),
    );

    const cursor = { lastDate: null as string | null, lastId: null as string | null };
    let totalRows = 0;
    let batchNumber = 0;

    while (true) {
        const rows = await readPostgresBatch(options, cursor);
        if (rows.length === 0) break;

        batchNumber += 1;
        totalRows += rows.length;

        const last = rows[rows.length - 1];
        cursor.lastDate = last.date;
        cursor.lastId = last.id;

        if (!options.dryRun) {
            await insertClickHouseBatch(options, rows);
        }

        console.log(
            `[clickhouse-backfill-api-stats] batch=${batchNumber} rows=${rows.length} total=${totalRows} lastDate=${cursor.lastDate}`,
        );
    }

    console.log(`[clickhouse-backfill-api-stats] completed rows=${totalRows} dryRun=${options.dryRun}`);
}

main()
    .then(async () => {
        await Promise.allSettled([closeClickHouseClient(), pool.end()]);
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[clickhouse-backfill-api-stats] failed', err);
        await Promise.allSettled([closeClickHouseClient(), pool.end()]);
        process.exit(1);
    });
