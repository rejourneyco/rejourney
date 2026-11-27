/**
 * Everything an MCP tool test needs, in-process: a PGlite database built from
 * the drizzle schema and filled by the demo seed, the real MCP app listening on
 * a loopback port, an in-memory token store, and official MCP clients.
 *
 *   const h = await startMcpToolHarness();
 *   const result = await h.call(h.tokens.a, 'list_projects', {});
 *   await h.close();
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryArtifactReader } from '../../mcp/artifacts/reader.js';
import type { McpGrant } from '../../mcp/auth.js';
import { createDbAccessChecker } from '../../mcp/context.js';
import { createScopedData } from '../../mcp/data/scoped.js';
import type { McpScopedData } from '../../mcp/data/types.js';
import { seedMcpDemo } from '../../mcp/demo/seed.js';
import type { DemoSeedManifest } from '../../mcp/demo/seed.js';
import type { McpErrorPayload } from '../../mcp/errors.js';
import type { McpRouterOptions } from '../../mcp/router.js';
import { MCP_SCOPES } from '../../mcp/router.js';
import { InMemoryUsageProvider } from '../../mcp/usage.js';
import type { McpCallRecord } from '../../mcp/usage.js';
import { createMcpApp } from '../../mcpServer.js';
import { listenEphemeral } from './httpTestServer.js';
import { createPgliteHarness } from './pgliteHarness.js';
import type { PgliteHarness } from './pgliteHarness.js';

/** The instant the seeded data ends at, and the server's clock in tests. */
export const MCP_TEST_NOW = new Date('2026-11-20T12:00:00.000Z');
export const MCP_TEST_DASHBOARD_URL = 'https://dashboard.example.test';

export interface ToolCallOutcome {
    isError: boolean;
    /** `structuredContent` of a successful call. */
    data: Record<string, any>;
    /** The text block exactly as sent. */
    text: string;
    /** Parsed error payload of a failed call. */
    error?: McpErrorPayload['error'];
    /** The whole result as JSON text, for leak scans. */
    raw: string;
    _meta?: Record<string, unknown>;
}

export interface McpToolHarness {
    pg: PgliteHarness;
    manifest: DemoSeedManifest;
    artifacts: InMemoryArtifactReader;
    usage: InMemoryUsageProvider;
    data: McpScopedData;
    mcpUrl: string;
    /** Bearer tokens: team A owner, team B owner, and team A with identifier masking on. */
    tokens: { a: string; b: string; aMasked: string };
    grants: Map<string, McpGrant>;
    /** Adds a token with a grant derived from team A's, with overrides. */
    addToken(token: string, overrides: Partial<McpGrant>): void;
    call(token: string, tool: string, args?: Record<string, unknown>): Promise<ToolCallOutcome>;
    client(token: string): Promise<Client>;
    /** Database round trips since the last reset. */
    dbRoundTrips(): number;
    resetDbRoundTrips(): void;
    serverErrors: Array<{ error: Error; requestId?: string }>;
    calls: McpCallRecord[];
    close(): Promise<void>;
}

export type HarnessAppOptions = Partial<
    Pick<McpRouterOptions, 'toolDeadlineMs' | 'maxConcurrentTools' | 'toolSlotWaitMs' | 'busyRetrySeconds' | 'bytesPerCredit' | 'data' | 'access'>
> & {
    /** Access-check cache lifetime. Default 0: every call checks the database. */
    accessCacheTtlMs?: number;
    /** Wraps the scoped data layer, e.g. to slow a call down. */
    wrapData?: (data: McpScopedData) => McpScopedData;
};

export async function startMcpToolHarness(options: HarnessAppOptions = {}): Promise<McpToolHarness> {
    const pg = await createPgliteHarness({ seed: false });
    const artifacts = new InMemoryArtifactReader();
    const manifest = await seedMcpDemo(pg.db, { now: MCP_TEST_NOW, artifacts });

    // Count round trips at the driver: every statement drizzle sends goes through here.
    let roundTrips = 0;
    const originalQuery = pg.client.query.bind(pg.client);
    pg.client.query = ((...args: Parameters<typeof originalQuery>) => {
        roundTrips += 1;
        return originalQuery(...args);
    }) as typeof pg.client.query;

    const usage = new InMemoryUsageProvider({
        creditsUsed: 120,
        creditsLimit: 2000,
        periodStart: new Date('2026-11-01T00:00:00.000Z'),
        periodEnd: new Date('2026-12-01T00:00:00.000Z'),
    });
    const baseData = createScopedData(pg.db, { artifacts });
    const data = options.wrapData ? options.wrapData(baseData) : baseData;
    const serverErrors: McpToolHarness['serverErrors'] = [];
    const calls: McpCallRecord[] = [];
    const grants = new Map<string, McpGrant>();

    const server = await listenEphemeral();
    const mcpUrl = `${server.baseUrl}/mcp`;
    server.handle(
        createMcpApp({
            publicUrl: mcpUrl,
            authorizationServerIssuer: 'https://api.example.test',
            dashboardBaseUrl: MCP_TEST_DASHBOARD_URL,
            tokenStore: { findByAccessToken: async (token) => grants.get(token) ?? null },
            data: options.data ?? data,
            access: options.access ?? createDbAccessChecker(pg.db, { ttlMs: options.accessCacheTtlMs ?? 0 }),
            usage,
            now: () => MCP_TEST_NOW,
            toolDeadlineMs: options.toolDeadlineMs,
            maxConcurrentTools: options.maxConcurrentTools,
            toolSlotWaitMs: options.toolSlotWaitMs,
            busyRetrySeconds: options.busyRetrySeconds,
            bytesPerCredit: options.bytesPerCredit,
            onError: (error, requestId) => serverErrors.push({ error, requestId }),
            onToolCall: (record) => calls.push(record),
        }),
    );

    const grantFor = (team: DemoSeedManifest['teamA'], overrides: Partial<McpGrant> = {}): McpGrant => ({
        grantId: `grant-${team.key}`,
        clientId: 'client-test',
        userId: team.users[0].id,
        teamId: team.id,
        projectIds: team.projects.map((project) => project.id),
        scopes: [...MCP_SCOPES],
        resource: mcpUrl,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        ...overrides,
    });
    const tokens = { a: 'rjm_test_team_a', b: 'rjm_test_team_b', aMasked: 'rjm_test_team_a_masked' };
    grants.set(tokens.a, grantFor(manifest.teamA));
    grants.set(tokens.b, grantFor(manifest.teamB));
    grants.set(tokens.aMasked, grantFor(manifest.teamA, { grantId: 'grant-a-masked', maskIdentifiers: true }));

    const clients = new Map<string, Promise<Client>>();
    const clientFor = (token: string): Promise<Client> => {
        let existing = clients.get(token);
        if (!existing) {
            existing = (async () => {
                const client = new Client({ name: 'mcp-tool-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
                await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: { token: async () => token } }));
                return client;
            })();
            clients.set(token, existing);
        }
        return existing;
    };

    return {
        pg,
        manifest,
        artifacts,
        usage,
        data: baseData,
        mcpUrl,
        tokens,
        grants,
        addToken(token, overrides) {
            grants.set(token, grantFor(manifest.teamA, overrides));
        },
        client: clientFor,
        async call(token, tool, args = {}) {
            const client = await clientFor(token);
            const result = await client.callTool({ name: tool, arguments: args });
            const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
            const text = content.map((block) => block.text ?? '').join('\n');
            const isError = result.isError === true;
            let error: McpErrorPayload['error'] | undefined;
            if (isError) {
                try {
                    error = (JSON.parse(text) as McpErrorPayload).error;
                } catch {
                    // The SDK's own input-validation errors are plain text.
                }
            }
            return {
                isError,
                data: (result.structuredContent ?? {}) as Record<string, any>,
                text,
                error,
                raw: JSON.stringify(result),
                _meta: result._meta as Record<string, unknown> | undefined,
            };
        },
        dbRoundTrips: () => roundTrips,
        resetDbRoundTrips: () => {
            roundTrips = 0;
        },
        serverErrors,
        calls,
        async close() {
            for (const pending of clients.values()) {
                await (await pending).close().catch(() => undefined);
            }
            await server.close();
            await pg.close();
        },
    };
}
