/**
 * Drizzle ORM Database Client
 *
 * Exposes two Drizzle instances:
 *   - `db`     — primary (read/write). Always points at DATABASE_URL.
 *   - `dbRead` — read-only path. Points at DATABASE_URL_READ if set, else
 *                falls back to `db`. Used by dashboard analytics queries to
 *                offload heavy aggregations onto the standby. Writes via
 *                `dbRead` will fail at the Postgres standby with
 *                "cannot execute INSERT in a read-only transaction" — which
 *                is the desired guardrail.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config, isDevelopment } from '../config.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

const { Pool } = pg;

const SENSITIVE_DB_PARAM_COLUMNS = [
    'api_key_encrypted',
    'access_token_encrypted',
    'refresh_token_encrypted',
    'hashed_key',
];

function hasSensitiveQueryParams(query: string): boolean {
    const normalized = query.toLowerCase();
    return SENSITIVE_DB_PARAM_COLUMNS.some((column) => normalized.includes(`"${column}"`));
}

const drizzleLogger = isDevelopment ? {
    logQuery: (query: string, params: unknown[]) => {
        logger.debug({
            query,
            params: hasSensitiveQueryParams(query) ? '[REDACTED_SENSITIVE_QUERY_PARAMS]' : params,
        }, 'Database query');
    },
} : undefined;

// Primary (read/write) connection pool.
const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX ?? '50'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '15000'),
});

pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle database client');
});

export const db = drizzle({
    client: pool,
    schema,
    logger: drizzleLogger,
});

// Read-replica connection pool. Created only when DATABASE_URL_READ is set
// (api-dashboard pods); otherwise dbRead aliases db so all existing call sites
// keep working unchanged.
let readPool: pg.Pool | null = null;

if (config.DATABASE_URL_READ && config.DATABASE_URL_READ !== config.DATABASE_URL) {
    readPool = new Pool({
        connectionString: config.DATABASE_URL_READ,
        max: parseInt(process.env.DB_POOL_MAX_READ ?? process.env.DB_POOL_MAX ?? '30'),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '15000'),
    });

    readPool.on('error', (err) => {
        logger.error({ err }, 'Unexpected error on idle read-replica database client');
    });

    logger.info('Read-replica pool configured (dbRead targets DATABASE_URL_READ)');
}

export const dbRead = readPool
    ? drizzle({ client: readPool, schema, logger: drizzleLogger })
    : db;

// Export pool for direct access when needed (e.g., raw queries, health checks)
export { pool };

// Export schema for use in queries
export * from './schema.js';
