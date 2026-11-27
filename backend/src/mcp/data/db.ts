/**
 * The database handle the MCP data layer accepts.
 *
 * Only `select` is exposed, so the layer cannot write whatever its code says.
 * Both the production node-postgres client and the in-process PGlite client
 * used by tests satisfy it.
 */

import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';

export type McpDb = Pick<PgAsyncDatabase<any, any, any>, 'select'>;

/**
 * The handle for the few MCP tables the server writes (sign-in records,
 * metering, the call log). Never handed to tools.
 */
export type McpWriteDb = Pick<PgAsyncDatabase<any, any, any>, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
