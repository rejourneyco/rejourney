/**
 * Rejourney MCP server entrypoint (separate `mcp-server` Deployment).
 *
 * The app contains ONLY the MCP router and health probes. There is no cookie
 * parser, no CSRF middleware and no dashboard session auth: the MCP endpoint
 * authenticates with `Authorization: Bearer rjm_…` and nothing else.
 *
 * Everything the server reads is injected: the token store, the scoped data
 * layer, the access checker and metering. Run directly, this file wires them
 * to the configured database (the dedicated `rejourney_mcp` role, a small
 * pool), Redis and object storage.
 */

import { pathToFileURL } from 'node:url';
import compression from 'compression';
import express from 'express';
import type { Express } from 'express';
import { createMcpRouter } from './mcp/router.js';
import type { McpRouterOptions } from './mcp/router.js';

export interface McpAppOptions extends McpRouterOptions {
    /** Resolves when dependencies are reachable; rejects otherwise. */
    checkReady?: () => Promise<void>;
}

export function createMcpApp(options: McpAppOptions): Express {
    const app = express();
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    // Results are JSON and compress 5 to 8 times.
    app.use(compression({ threshold: 1024 }));

    app.get('/health/live', (_req, res) => {
        res.json({ status: 'ok', service: 'mcp-server', timestamp: new Date().toISOString() });
    });

    app.get('/health/ready', async (_req, res) => {
        try {
            await options.checkReady?.();
            res.json({ status: 'ok', service: 'mcp-server', timestamp: new Date().toISOString() });
        } catch {
            res.status(503).json({ status: 'error', service: 'mcp-server', timestamp: new Date().toISOString() });
        }
    });

    app.use(createMcpRouter(options));

    app.use((_req, res) => {
        res.status(404).json({ error: 'not_found' });
    });

    return app;
}

function isMainModule(): boolean {
    const entry = process.argv[1];
    return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
    const publicUrl = process.env.MCP_PUBLIC_URL;
    const authorizationServerIssuer = process.env.MCP_AUTHORIZATION_SERVER_ISSUER;
    const dashboardBaseUrl = process.env.PUBLIC_DASHBOARD_URL;
    if (!publicUrl || !authorizationServerIssuer || !dashboardBaseUrl) {
        console.error('MCP_PUBLIC_URL, MCP_AUTHORIZATION_SERVER_ISSUER and PUBLIC_DASHBOARD_URL are required');
        process.exit(1);
    }
    // A small pool: the role is capped at 12 connections across all pods, and
    // a call should fail fast rather than queue behind a busy database.
    process.env.DB_POOL_MAX ??= process.env.MCP_DB_POOL_MAX ?? '6';
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS ??= '3000';

    // Loaded here, not at the top of the file, so importing `createMcpApp`
    // (tests, tooling) opens no database pool and loads no storage client.
    const [
        { db, pool },
        { getRedis, initRedis },
        { createScopedData },
        { createDbAccessChecker },
        { createS3ArtifactReader },
        { createPostgresTokenStore },
        { createKillSwitches, createMetering },
    ] = await Promise.all([
        import('./db/client.js'),
        import('./db/redis.js'),
        import('./mcp/data/scoped.js'),
        import('./mcp/context.js'),
        import('./mcp/artifacts/reader.js'),
        import('./mcp/oauth/pgStore.js'),
        import('./mcp/metering.js'),
    ]);

    const logError = (where: string) => (error: Error) => {
        console.error(JSON.stringify({ level: 'error', service: 'mcp-server', where, name: error.name, message: error.message.slice(0, 300) }));
    };

    let redis: ReturnType<typeof getRedis> | null = null;
    try {
        await initRedis();
        redis = getRedis();
    } catch (error) {
        // Metering falls back to Postgres; per-minute and per-user limits pause.
        logError('redis.init')(error instanceof Error ? error : new Error(String(error)));
    }

    const metering = createMetering({
        db,
        redis,
        dashboardBaseUrl,
        onError: (error, where) => logError(`metering.${where}`)(error),
    });
    const enabled = process.env.MCP_ENABLED === 'true';
    const disabledTools = (process.env.MCP_DISABLED_TOOLS ?? '').split(',').map((tool) => tool.trim()).filter(Boolean);

    const app = createMcpApp({
        publicUrl,
        authorizationServerIssuer,
        dashboardBaseUrl,
        tokenStore: createPostgresTokenStore(db),
        data: createScopedData(db, { artifacts: createS3ArtifactReader(db) }),
        access: createDbAccessChecker(db),
        usage: metering.usage,
        gate: metering.gate,
        switches: createKillSwitches({ enabled, disabledTools, redis, onError: logError('switches') }),
        // Refused first when connections are queueing: ingest and the dashboard come before MCP.
        shouldShed: () => pool.waitingCount > 8,
        checkReady: async () => {
            await pool.query('SELECT 1');
        },
        onToolCall: (record) => {
            console.log(JSON.stringify({
                level: 'info', service: 'mcp-server', kind: 'tool_call', tool: record.tool, outcome: record.outcome,
                credits: record.credits, bytes: record.bytes, durationMs: record.durationMs, teamId: record.teamId, requestId: record.requestId,
            }));
        },
        onError: (error, requestId) => {
            console.error(JSON.stringify({ level: 'error', service: 'mcp-server', requestId: requestId ?? null, name: error.name }));
        },
    });

    const port = Number(process.env.PORT ?? 3002);
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`mcp-server listening on ${port}${enabled ? '' : ' (MCP_ENABLED is not "true": every tool call is refused)'}`);
    });
    // Longer than the proxy in front keeps idle connections (Traefik: 90 s by
    // default is its own limit towards us, Cloudflare reuses for up to 100 s).
    // Node's 5 s default closes a connection the proxy is about to reuse, which
    // the client sees as a reset or a 502.
    server.keepAliveTimeout = 120_000;
    server.headersTimeout = 125_000;

    const shutdown = () => {
        server.close(() => {
            void metering.flush().finally(() => process.exit(0));
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

if (isMainModule()) {
    void main();
}
