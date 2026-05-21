import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@clickhouse/client';
import { config } from '../src/config.js';
import { getClickHouseClient, isClickHouseConfigured } from '../src/db/clickhouse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'clickhouse');

const clusterName = process.env.CLICKHOUSE_CLUSTER?.trim();

function getOnClusterClause(): string {
    if (!clusterName) return '';
    if (!/^[A-Za-z0-9_]+$/.test(clusterName)) {
        throw new Error(`Invalid CLICKHOUSE_CLUSTER value: ${clusterName}`);
    }
    return ` ON CLUSTER ${clusterName}`;
}

function splitSqlStatements(sql: string): string[] {
    return sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.trim())
        .filter(Boolean);
}

function prepareClusterStatement(statement: string): string {
    if (!clusterName) return statement;

    const onCluster = getOnClusterClause();
    let prepared = statement
        .replace(
            /^CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\b/i,
            `CREATE DATABASE IF NOT EXISTS $1${onCluster}`,
        )
        .replace(
            /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_.]+)\s*\(/i,
            `CREATE TABLE IF NOT EXISTS $1${onCluster}\n(`,
        );

    if (/\bapi_endpoint_request_events\b/i.test(prepared)) {
        prepared = prepared.replace(
            /\bENGINE\s*=\s*MergeTree\b/i,
            "ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/api_endpoint_request_events', '{replica}')",
        );
    }

    if (/\bapi_endpoint_daily_stats_imported\b/i.test(prepared)) {
        prepared = prepared.replace(
            /\bENGINE\s*=\s*ReplacingMergeTree\s*\(\s*imported_at\s*\)/i,
            "ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/{database}/api_endpoint_daily_stats_imported', '{replica}', imported_at)",
        );
    }

    return prepared;
}

async function ensureMigrationTable(): Promise<void> {
    const onCluster = getOnClusterClause();
    const migrationEngine = clusterName
        ? "ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/{database}/schema_migrations', '{replica}', applied_at)"
        : 'ReplacingMergeTree(applied_at)';
    const bootstrapClient = createClient({
        url: config.CLICKHOUSE_URL!,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD ?? '',
        database: 'default',
        request_timeout: config.CLICKHOUSE_REQUEST_TIMEOUT_MS,
    });

    try {
        await bootstrapClient.command({
            query: `
                CREATE DATABASE IF NOT EXISTS rejourney${onCluster}
            `,
        });
    } finally {
        await bootstrapClient.close();
    }

    await getClickHouseClient().command({
        query: `
            CREATE TABLE IF NOT EXISTS rejourney.schema_migrations${onCluster}
            (
                filename String,
                checksum String,
                applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
            )
            ENGINE = ${migrationEngine}
            ORDER BY filename
        `,
    });
}

async function migrationAlreadyApplied(filename: string, checksum: string): Promise<boolean> {
    const result = await getClickHouseClient().query({
        query: `
            SELECT count() AS count
            FROM rejourney.schema_migrations
            WHERE filename = {filename:String}
              AND checksum = {checksum:String}
        `,
        query_params: { filename, checksum },
        format: 'JSONEachRow',
    });
    const rows = await result.json<{ count: string | number }>();
    return Number(rows[0]?.count || 0) > 0;
}

async function recordMigration(filename: string, checksum: string): Promise<void> {
    await getClickHouseClient().insert({
        table: 'rejourney.schema_migrations',
        values: [{ filename, checksum }],
        format: 'JSONEachRow',
    });
}

async function applyMigration(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const sql = fs.readFileSync(filePath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    if (await migrationAlreadyApplied(filename, checksum)) {
        console.log(`[clickhouse-setup] ${filename} already applied`);
        return;
    }

    console.log(`[clickhouse-setup] applying ${filename}`);
    for (const statement of splitSqlStatements(sql)) {
        await getClickHouseClient().command({ query: prepareClusterStatement(statement) });
    }
    await recordMigration(filename, checksum);
}

async function main() {
    if (!isClickHouseConfigured()) {
        console.log('[clickhouse-setup] ClickHouse disabled; skipping setup');
        return;
    }

    await ensureMigrationTable();
    const files = fs.readdirSync(migrationsDir)
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort()
        .map((name) => path.join(migrationsDir, name));

    for (const file of files) {
        await applyMigration(file);
    }

    console.log(`[clickhouse-setup] applied ${files.length} ClickHouse migration files`);
}

main().catch((error) => {
    console.error('[clickhouse-setup] failed', error);
    process.exit(1);
});
