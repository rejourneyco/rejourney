import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { config } from '../config.js';
import { logger } from '../logger.js';

let client: ClickHouseClient | null = null;

export function isClickHouseConfigured(): boolean {
    return config.CLICKHOUSE_ENABLED && Boolean(config.CLICKHOUSE_URL);
}

export function isClickHouseDualWriteEnabled(): boolean {
    return isClickHouseConfigured() && config.CLICKHOUSE_DUAL_WRITE_ENABLED;
}

export function isClickHouseReadsEnabled(): boolean {
    return isClickHouseConfigured() && config.CLICKHOUSE_READS_ENABLED;
}

export function getClickHouseClient(): ClickHouseClient {
    if (!isClickHouseConfigured()) {
        throw new Error('ClickHouse is not enabled or CLICKHOUSE_URL is missing');
    }

    if (!client) {
        client = createClient({
            url: config.CLICKHOUSE_URL,
            username: config.CLICKHOUSE_USER,
            password: config.CLICKHOUSE_PASSWORD ?? '',
            database: config.CLICKHOUSE_DATABASE,
            application: 'rejourney-backend',
            request_timeout: config.CLICKHOUSE_REQUEST_TIMEOUT_MS,
            max_open_connections: Number(process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS ?? 4),
            compression: {
                response: true,
                request: false,
            },
        });
    }

    return client;
}

export async function pingClickHouse(): Promise<boolean> {
    if (!isClickHouseConfigured()) return false;
    const result = await getClickHouseClient().ping({ select: true });
    if (!result.success) {
        logger.warn({ err: result.error }, 'ClickHouse ping failed');
        return false;
    }
    return true;
}

export async function closeClickHouseClient(): Promise<void> {
    if (!client) return;
    await client.close();
    client = null;
}

