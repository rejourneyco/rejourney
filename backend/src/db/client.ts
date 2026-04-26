/**
 * Drizzle ORM Database Client
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config, isDevelopment } from '../config.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

const { Pool } = pg;

// Create PostgreSQL connection pool
const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX ?? '50'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Log pool errors
pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle database client');
});

// Create Drizzle instance with schema for relational queries
export const db = drizzle({
    client: pool,
    schema,
    logger: isDevelopment ? {
        logQuery: (query: string, params: unknown[]) => {
            logger.debug({ query, params }, 'Database query');
        },
    } : undefined,
});

// Export pool for direct access when needed (e.g., raw queries, health checks)
export { pool };

// Export schema for use in queries
export * from './schema.js';
