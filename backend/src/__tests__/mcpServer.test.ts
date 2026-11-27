/**
 * MCP server transport and auth: the official TypeScript SDK serving the tool
 * registry over stateless Streamable HTTP, to both protocol eras, behind
 * `rjm_` bearer auth. The tools themselves are covered in mcpTools.test.ts.
 *
 * Runs fully in-process: the app listens on an ephemeral loopback port and the
 * official MCP client SDK connects to it over real HTTP.
 */
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Client,
    StreamableHTTPClientTransport,
    discoverOAuthProtectedResourceMetadata,
    extractWWWAuthenticateParams,
} from '@modelcontextprotocol/client';
import { createMcpApp } from '../mcpServer.js';
import type { McpGrant, McpTokenStore } from '../mcp/auth.js';
import type { McpContext } from '../mcp/context.js';
import type { ProjectSummary } from '../mcp/data/types.js';
import { buildProtectedResourceMetadata } from '../mcp/router.js';
import { MCP_TOOL_NAMES } from '../mcp/tools/registry.js';
import { listenEphemeral, readJson } from './helpers/httpTestServer.js';
import { grantTrustingAccess, projectsOnlyData } from './helpers/mcpStubs.js';

const ISSUER = 'https://api.example.test';
const TOKEN_A = 'rjm_test_token_team_a';
const TOKEN_B = 'rjm_test_token_team_b';
const TOKEN_EXPIRED = 'rjm_test_token_expired';
const TOKEN_OTHER_RESOURCE = 'rjm_test_token_other_resource';
// Shaped like a dashboard session token: opaque hex, no `rjm_` prefix.
const DASHBOARD_SESSION_TOKEN = 'a3f1c2d4e5b6978877665544332211000ffeeddccbbaa99887766554433221100';

/** Every tool result carries this; the output layer fills it in. */
const META = { tookMs: expect.any(Number), credits: 0, truncated: false, cached: false };

const PROJECTS: Record<string, ProjectSummary> = {
    'project-a': { id: 'project-a', name: 'Team A app', platforms: ['ios', 'android'] },
    'project-b': { id: 'project-b', name: 'Team B app', platforms: ['web'] },
};

interface RunningApp {
    baseUrl: string;
    mcpUrl: string;
    close: () => Promise<void>;
}

/** Listens first so the app can be configured with its own real public URL. */
async function startApp(build: (baseUrl: string) => Express): Promise<RunningApp> {
    const server = await listenEphemeral();
    server.handle(build(server.baseUrl));
    return { baseUrl: server.baseUrl, mcpUrl: `${server.baseUrl}/mcp`, close: server.close };
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

const grants = new Map<string, McpGrant>();
const findByAccessToken = vi.fn(async (token: string) => grants.get(token) ?? null);
const tokenStore: McpTokenStore = { findByAccessToken };
const listProjects = vi.fn(async (ctx: McpContext) => ctx.allowedProjectIds.map((id) => PROJECTS[id]).filter(Boolean));
const serverErrors: Error[] = [];

let app: RunningApp;

function grant(overrides: Partial<McpGrant>): McpGrant {
    return {
        grantId: 'grant-a',
        clientId: 'client-test',
        userId: 'user-a',
        teamId: 'team-a',
        projectIds: ['project-a'],
        scopes: ['sessions:read'],
        resource: app.mcpUrl,
        expiresAt: nowSeconds() + 3600,
        ...overrides,
    };
}

const JSON_RPC_HEADERS = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
};

function rawPost(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(app.mcpUrl, {
        method: 'POST',
        headers: { ...JSON_RPC_HEADERS, ...headers },
        body: JSON.stringify(body),
    });
}

const LEGACY_TOOLS_LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

function connectClient(token: string, mode: 'legacy' | 'auto') {
    const client = new Client({ name: 'spike-test-client', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StreamableHTTPClientTransport(new URL(app.mcpUrl), {
        authProvider: { token: async () => token },
    });
    return { client, connect: () => client.connect(transport) };
}

beforeAll(async () => {
    app = await startApp((baseUrl) =>
        createMcpApp({
            publicUrl: `${baseUrl}/mcp`,
            authorizationServerIssuer: ISSUER,
            tokenStore,
            dashboardBaseUrl: 'https://dashboard.example.test',
            access: grantTrustingAccess,
            data: projectsOnlyData(listProjects),
            onError: (error) => serverErrors.push(error),
        }),
    );

    grants.set(TOKEN_A, grant({}));
    grants.set(TOKEN_B, grant({ grantId: 'grant-b', userId: 'user-b', teamId: 'team-b', projectIds: ['project-b'] }));
    grants.set(TOKEN_EXPIRED, grant({ expiresAt: nowSeconds() - 60 }));
    grants.set(TOKEN_OTHER_RESOURCE, grant({ resource: 'https://api.example.test/' }));
    // Even if a dashboard session token somehow existed in the MCP store, the
    // prefix gate must refuse it before any lookup.
    grants.set(DASHBOARD_SESSION_TOKEN, grant({}));
});

afterAll(async () => {
    await app.close();
});

beforeEach(() => {
    findByAccessToken.mockClear();
    listProjects.mockClear();
    serverErrors.length = 0;
});

describe('MCP endpoint bearer auth', () => {
    it('(a) answers 401 with a WWW-Authenticate resource_metadata challenge when no token is sent', async () => {
        const res = await rawPost(LEGACY_TOOLS_LIST);

        expect(res.status).toBe(401);
        const challenge = res.headers.get('www-authenticate') ?? '';
        const expectedMetadataUrl = `${app.baseUrl}/.well-known/oauth-protected-resource/mcp`;
        expect(challenge).toMatch(/^Bearer /);
        expect(challenge).toContain(`resource_metadata="${expectedMetadataUrl}"`);
        // The official client parses the challenge to the same URL.
        expect(extractWWWAuthenticateParams(res).resourceMetadataUrl?.href).toBe(expectedMetadataUrl);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(await res.json()).toMatchObject({ error: 'invalid_token' });
        expect(findByAccessToken).not.toHaveBeenCalled();
        expect(listProjects).not.toHaveBeenCalled();
    });

    it('(b) refuses a dashboard-style token without the rjm_ prefix and never looks it up', async () => {
        const res = await rawPost(LEGACY_TOOLS_LIST, { Authorization: `Bearer ${DASHBOARD_SESSION_TOKEN}` });

        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toContain('resource_metadata="');
        expect(await res.json()).toMatchObject({ error: 'invalid_token' });
        expect(findByAccessToken).not.toHaveBeenCalled();
    });

    it('refuses unknown, expired and wrong-audience rjm_ tokens with the same 401 challenge', async () => {
        for (const token of ['rjm_unknown_token', TOKEN_EXPIRED, TOKEN_OTHER_RESOURCE]) {
            const res = await rawPost(LEGACY_TOOLS_LIST, { Authorization: `Bearer ${token}` });
            expect(res.status, token).toBe(401);
            expect(res.headers.get('www-authenticate'), token).toContain('resource_metadata="');
            expect(await res.json(), token).toMatchObject({ error: 'invalid_token' });
        }
        expect(listProjects).not.toHaveBeenCalled();
    });

    it('rejects non-Bearer schemes', async () => {
        const res = await rawPost(LEGACY_TOOLS_LIST, { Authorization: `Basic ${Buffer.from(`${TOKEN_A}:`).toString('base64')}` });
        expect(res.status).toBe(401);
    });
});

describe('MCP endpoint via the official client SDK', () => {
    it('(c) a 2026-07-28 client connects, lists tools and calls list_projects', async () => {
        const { client, connect } = connectClient(TOKEN_A, 'auto');
        await connect();
        try {
            expect(client.getProtocolEra()).toBe('modern');
            expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
            expect(client.getServerVersion()).toMatchObject({ name: 'rejourney' });

            const { tools } = await client.listTools();
            expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
            const [tool] = tools;
            expect(tool.name).toBe('list_projects');
            expect(tool.title).toBe('List projects');
            expect(tool.annotations?.readOnlyHint).toBe(true);
            expect(tool.annotations?.openWorldHint).toBe(false);
            expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
            expect(tool.outputSchema).toMatchObject({
                type: 'object',
                additionalProperties: false,
                required: ['projects', 'meta'],
            });

            const result = await client.callTool({ name: 'list_projects', arguments: {} });
            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toEqual({ projects: [PROJECTS['project-a']], meta: META });
            const content = result.content as Array<{ type: string; text: string }>;
            expect(content).toHaveLength(1);
            expect(content[0].type).toBe('text');
            // The JSON, then one line saying how long the call took.
            const [json, timing] = content[0].text.split('\n');
            expect(JSON.parse(json)).toEqual(result.structuredContent);
            expect(timing).toMatch(/^\(took \d+ ms, 0 credits\)$/);
        } finally {
            await client.close();
        }
        expect(serverErrors).toEqual([]);
    });

    it('(d) a 2025-era initialize-based client is served by the same endpoint and factory', async () => {
        const { client, connect } = connectClient(TOKEN_A, 'legacy');
        await connect();
        try {
            expect(client.getProtocolEra()).toBe('legacy');
            expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');

            const { tools } = await client.listTools();
            expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
            expect(tools[0].annotations?.readOnlyHint).toBe(true);

            const result = await client.callTool({ name: 'list_projects', arguments: {} });
            expect(result.structuredContent).toEqual({ projects: [PROJECTS['project-a']], meta: META });
        } finally {
            await client.close();
        }
        expect(serverErrors).toEqual([]);
    });

    it('scopes the result to the grant behind the token', async () => {
        const { client, connect } = connectClient(TOKEN_B, 'auto');
        await connect();
        try {
            const result = await client.callTool({ name: 'list_projects', arguments: {} });
            expect(result.structuredContent).toEqual({ projects: [PROJECTS['project-b']], meta: META });
            expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-b', allowedProjectIds: ['project-b'] }));
        } finally {
            await client.close();
        }
    });

    it('rejects unexpected arguments against the strict input schema', async () => {
        const { client, connect } = connectClient(TOKEN_A, 'auto');
        await connect();
        try {
            const outcome = await client
                .callTool({ name: 'list_projects', arguments: { projectId: 'project-b' } })
                .then((result) => ({ result }), (error: Error) => ({ error }));
            const failed = 'error' in outcome || outcome.result.isError === true;
            expect(failed).toBe(true);
            expect(listProjects).not.toHaveBeenCalled();
        } finally {
            await client.close();
        }
    });
});

describe('MCP endpoint wire behaviour', () => {
    it('(d) answers a raw 2025-06-18 initialize handshake statelessly', async () => {
        const res = await rawPost(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: { name: 'raw-legacy-client', version: '0.0.1' },
                },
            },
            { Authorization: `Bearer ${TOKEN_A}` },
        );

        expect(res.status).toBe(200);
        // Stateless: no session is created for legacy clients.
        expect(res.headers.get('mcp-session-id')).toBeNull();
        // JSON, not an SSE stream, for the 2025 era too.
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        const payload = await readJson(res);
        expect(payload.result.protocolVersion).toBe('2025-06-18');
        expect(payload.result.serverInfo.name).toBe('rejourney');
        expect(payload.result.capabilities.tools).toBeDefined();
    });

    it('(d) answers a raw 2025-era tools/call without a prior initialize, as JSON', async () => {
        const res = await rawPost(
            { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
            { Authorization: `Bearer ${TOKEN_A}`, 'MCP-Protocol-Version': '2025-06-18' },
        );

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect((await readJson(res)).result.structuredContent).toEqual({ projects: [PROJECTS['project-a']], meta: META });
    });

    it('refuses a POST that is not application/json', async () => {
        const res = await rawPost(LEGACY_TOOLS_LIST, { Authorization: `Bearer ${TOKEN_A}`, 'Content-Type': 'text/plain' });
        expect(res.status).toBe(415);
        expect(listProjects).not.toHaveBeenCalled();
    });

    it('answers a modern tools/call with a plain JSON body, not an SSE stream', async () => {
        const res = await rawPost(
            {
                jsonrpc: '2.0',
                id: 7,
                method: 'tools/call',
                params: {
                    name: 'list_projects',
                    arguments: {},
                    _meta: {
                        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                        'io.modelcontextprotocol/clientInfo': { name: 'raw-modern-client', version: '0.0.1' },
                        'io.modelcontextprotocol/clientCapabilities': {},
                    },
                },
            },
            {
                Authorization: `Bearer ${TOKEN_A}`,
                'MCP-Protocol-Version': '2026-07-28',
                'Mcp-Method': 'tools/call',
                'Mcp-Name': 'list_projects',
            },
        );

        const text = await res.text();
        expect(res.status, text).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(JSON.parse(text).result.structuredContent).toEqual({ projects: [PROJECTS['project-a']], meta: META });
    });

    it('refuses subscriptions/listen instead of opening a long-lived stream', async () => {
        const res = await rawPost(
            {
                jsonrpc: '2.0',
                id: 9,
                method: 'subscriptions/listen',
                params: {
                    notifications: { toolsListChanged: true },
                    _meta: {
                        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                        'io.modelcontextprotocol/clientInfo': { name: 'raw-modern-client', version: '0.0.1' },
                        'io.modelcontextprotocol/clientCapabilities': {},
                    },
                },
            },
            { Authorization: `Bearer ${TOKEN_A}`, 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'subscriptions/listen' },
        );

        // The exchange completes at once with an in-band error: a finite JSON body, not an event stream.
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(await readJson(res)).toMatchObject({ id: 9, error: { code: -32603, message: 'Subscription limit reached' } });
    });

    it('does not offer GET (no standalone SSE stream) or DELETE', async () => {
        for (const method of ['GET', 'DELETE']) {
            const res = await fetch(app.mcpUrl, {
                method,
                headers: { Authorization: `Bearer ${TOKEN_A}`, Accept: 'text/event-stream' },
            });
            expect(res.status, method).toBe(405);
            await res.arrayBuffer();
        }
    });

    it('(e) treats a request carrying a Cookie header exactly like one without', async () => {
        const cookie = `session=${DASHBOARD_SESSION_TOKEN}; csrf=abc123`;

        // A dashboard session cookie is not a credential here.
        const bare = await rawPost(LEGACY_TOOLS_LIST);
        const withCookie = await rawPost(LEGACY_TOOLS_LIST, { Cookie: cookie });
        expect(withCookie.status).toBe(401);
        expect(withCookie.headers.get('www-authenticate')).toBe(bare.headers.get('www-authenticate'));
        expect(withCookie.headers.get('set-cookie')).toBeNull();
        expect(await withCookie.json()).toEqual(await bare.json());
        expect(findByAccessToken).not.toHaveBeenCalled();

        // With a valid bearer token the cookie changes nothing either.
        const call = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_projects', arguments: {} } };
        const authed = await rawPost(call, { Authorization: `Bearer ${TOKEN_A}` });
        const authedWithCookie = await rawPost(call, { Authorization: `Bearer ${TOKEN_A}`, Cookie: cookie });
        expect(authed.status).toBe(200);
        expect(authedWithCookie.status).toBe(200);
        expect(authedWithCookie.headers.get('set-cookie')).toBeNull();
        // Identical apart from the measured time.
        const withoutTiming = (body: string) => body.replace(/tookMs\\?":\d+/g, 'tookMs":0').replace(/\(took \d+ ms/g, '(took 0 ms');
        const authedBody = await authed.text();
        expect(authedBody).toContain('project-a');
        expect(withoutTiming(await authedWithCookie.text())).toBe(withoutTiming(authedBody));
        expect(findByAccessToken.mock.calls.map(([token]) => token)).toEqual([TOKEN_A, TOKEN_A]);
    });
});

describe('OAuth protected resource metadata (RFC 9728)', () => {
    it('(f) serves the document at the path-aware and root well-known locations', async () => {
        for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
            const res = await fetch(`${app.baseUrl}${path}`);
            expect(res.status, path).toBe(200);
            expect(res.headers.get('content-type'), path).toMatch(/^application\/json/);
            expect(res.headers.get('access-control-allow-origin'), path).toBe('*');
            expect(await res.json(), path).toEqual({
                resource: app.mcpUrl,
                authorization_servers: [ISSUER],
                scopes_supported: ['sessions:read', 'replay:read', 'issues:read', 'analytics:read'],
                bearer_methods_supported: ['header'],
                resource_name: 'Rejourney MCP',
            });
        }
    });

    it('(f) is discoverable by the official client from the MCP URL alone', async () => {
        const metadata = await discoverOAuthProtectedResourceMetadata(app.mcpUrl);
        expect(metadata.resource).toBe(app.mcpUrl);
        expect(metadata.authorization_servers).toEqual([ISSUER]);
    });

    it('(f) uses the configured public URL as the resource', () => {
        expect(
            buildProtectedResourceMetadata({
                publicUrl: 'https://mcp.example.test/mcp',
                authorizationServerIssuer: ISSUER,
            }),
        ).toMatchObject({ resource: 'https://mcp.example.test/mcp', authorization_servers: [ISSUER] });
    });

    it('needs no token and refuses non-GET methods', async () => {
        const res = await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/mcp`, { method: 'POST' });
        expect(res.status).toBe(405);
    });
});

describe('MCP server app surface', () => {
    it('serves health probes and nothing else', async () => {
        const live = await fetch(`${app.baseUrl}/health/live`);
        expect(live.status).toBe(200);
        expect(await live.json()).toMatchObject({ status: 'ok', service: 'mcp-server' });

        const ready = await fetch(`${app.baseUrl}/health/ready`);
        expect(ready.status).toBe(200);

        for (const path of ['/api/projects', '/api/auth/me', '/health']) {
            const res = await fetch(`${app.baseUrl}${path}`, { headers: { Authorization: `Bearer ${TOKEN_A}` } });
            expect(res.status, path).toBe(404);
        }
    });
});
