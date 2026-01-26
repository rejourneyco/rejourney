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
    max: 20, // Maximum number of connections in the pool
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error if connection takes longer than 2 seconds
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

// Graceful shutdown
process.on('beforeExit', async () => {
    await pool.end();
});

// Export schema for use in queries
export * from './schema.js';
