/**
 * Live read-only test server for the MCP tools. NOT a production entrypoint.
 *
 * It exists so the unreleased tool layer can be exercised against real data
 * before sign-in, consent and metering are built. It runs the real router,
 * scoped data layer, access checker and storage reader, with two differences:
 *
 *  - tokens come from MCP_TEST_GRANTS (a JSON map of `rjm_…` token to grant)
 *    instead of the OAuth token store;
 *  - it refuses to start unless its database session is read-only and has a
 *    statement timeout, so a bug in unreleased code cannot write or hang.
 *
 * Set PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=5000"
 * and connect directly to Postgres (PgBouncer rejects startup options).
 */

import express from 'express';
import { MCP_TOKEN_PREFIX } from '../auth.js';
import type { McpGrant, McpTokenStore } from '../auth.js';
import { MCP_SCOPES, createMcpRouter } from '../router.js';

interface TestGrantInput {
    userId: string;
    teamId: string;
    projectIds: string[];
    maskIdentifiers?: boolean;
    label?: string;
}

function readGrants(publicUrl: string): Map<string, McpGrant> {
    const raw = process.env.MCP_TEST_GRANTS;
    if (!raw) throw new Error('MCP_TEST_GRANTS is required');
    const parsed = JSON.parse(raw) as Record<string, TestGrantInput>;
    const grants = new Map<string, McpGrant>();
    for (const [token, input] of Object.entries(parsed)) {
        if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length < 40) {
            throw new Error('test tokens must start with rjm_ and be at least 40 characters');
        }
        grants.set(token, {
            grantId: `live-test-${input.label ?? grants.size + 1}`,
            clientId: 'live-test-client',
            userId: input.userId,
            teamId: input.teamId,
            projectIds: input.projectIds,
            scopes: [...MCP_SCOPES],
            maskIdentifiers: input.maskIdentifiers ?? false,
            resource: publicUrl,
            expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
        });
    }
    if (grants.size === 0) throw new Error('MCP_TEST_GRANTS has no grants');
    return grants;
}

async function assertReadOnlySession(): Promise<string> {
    const { pool } = await import('../../db/client.js');
    const client = await pool.connect();
    try {
        const readOnly = (await client.query('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only;
        const timeout = (await client.query('SHOW statement_timeout')).rows[0]?.statement_timeout;
        if (readOnly !== 'on') throw new Error(`refusing to start: default_transaction_read_only is ${String(readOnly)}`);
        if (!timeout || timeout === '0') throw new Error('refusing to start: statement_timeout is not set');
        let writeBlocked = false;
        try {
            await client.query('CREATE TEMP TABLE mcp_live_test_probe (x int)');
        } catch {
            writeBlocked = true;
        }
        if (!writeBlocked) throw new Error('refusing to start: a write succeeded on a session that must be read-only');
        return `read_only=${readOnly} statement_timeout=${timeout}`;
    } finally {
        client.release();
    }
}

async function main(): Promise<void> {
    const publicUrl = process.env.MCP_PUBLIC_URL ?? 'http://127.0.0.1:8787/mcp';
    const dashboardBaseUrl = process.env.PUBLIC_DASHBOARD_URL ?? 'https://rejourney.co';
    const grants = readGrants(publicUrl);
    const sessionState = await assertReadOnlySession();

    const [{ db }, { createScopedData }, { createDbAccessChecker }, { createS3ArtifactReader }] = await Promise.all([
        import('../../db/client.js'),
        import('../data/scoped.js'),
        import('../context.js'),
        import('../artifacts/reader.js'),
    ]);

    const tokenStore: McpTokenStore = {
        async findByAccessToken(token) {
            return grants.get(token) ?? null;
        },
    };

    // Built here rather than through mcpServer.ts: that module starts the
    // production server when it is the entry file, which it is inside a bundle.
    const app = express();
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.get('/health/live', (_req, res) => {
        res.json({ status: 'ok', service: 'mcp-live-test' });
    });
    app.use(createMcpRouter({
        publicUrl,
        authorizationServerIssuer: process.env.MCP_AUTHORIZATION_SERVER_ISSUER ?? 'https://api.rejourney.co',
        dashboardBaseUrl,
        tokenStore,
        data: createScopedData(db, { artifacts: createS3ArtifactReader(db) }),
        access: createDbAccessChecker(db),
        onToolCall: (record) => {
            console.log(JSON.stringify({ kind: 'tool_call', at: new Date().toISOString(), ...record }));
        },
        onError: (error, requestId) => {
            console.error(JSON.stringify({ kind: 'error', at: new Date().toISOString(), requestId: requestId ?? null, name: error.name, message: error.message.slice(0, 500) }));
        },
    }));
    app.use((_req, res) => {
        res.status(404).json({ error: 'not_found' });
    });

    const port = Number(process.env.PORT ?? 8787);
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(JSON.stringify({ kind: 'started', port, grants: grants.size, session: sessionState }));
    });
    server.keepAliveTimeout = 120_000;
    server.headersTimeout = 125_000;
}

main().catch((error: unknown) => {
    console.error(JSON.stringify({ kind: 'fatal', message: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
});
