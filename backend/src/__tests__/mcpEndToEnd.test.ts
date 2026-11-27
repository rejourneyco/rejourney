/**
 * MCP end to end, as production wires it, on a real (in-process) Postgres and
 * an in-memory Redis:
 *
 *   Claude Code's client metadata document → /oauth/authorize → dashboard
 *   consent hand-off → stored decision → /oauth/interaction/:uid/finish →
 *   code + PKCE → rjm_ token (stored hashed in Postgres) → MCP tool calls
 *   checked against the live team row, metered in Redis and Postgres →
 *   limit reached → revoke → token refused.
 *
 * The only stand-ins are the dashboard session (a test user switch) and the
 * metadata fetch (Claude Code's published document, served locally).
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import express from 'express';
import RedisMock from 'ioredis-mock';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mcpCallLog, mcpGrants, mcpOAuthRecords, mcpUsagePeriods, teams } from '../db/schema.js';
import { createMcpApp } from '../mcpServer.js';
import { InMemoryArtifactReader } from '../mcp/artifacts/reader.js';
import { createDbAccessChecker } from '../mcp/context.js';
import { createScopedData } from '../mcp/data/scoped.js';
import { createKillSwitches, createMetering, MCP_SWITCHES_KEY } from '../mcp/metering.js';
import type { MeteringRedis } from '../mcp/metering.js';
import { PostgresGrantRecordStore, PostgresOAuthStore, createPostgresTokenStore } from '../mcp/oauth/pgStore.js';
import { createOAuthProvider } from '../mcp/oauth/provider.js';
import { CONSENT_DECISION_MODEL, createOAuthMetadataHandler, createOAuthRouter, oauthMetadataPath } from '../mcp/oauth/router.js';
import type { StoredConsentDecision } from '../mcp/oauth/router.js';
import { MCP_SCOPES } from '../mcp/router.js';
import { CookieJar, browse, listenEphemeral } from './helpers/httpTestServer.js';
import type { TestServer } from './helpers/httpTestServer.js';
import { PGLITE_SEED, PGLITE_START_TIMEOUT_MS, createPgliteHarness } from './helpers/pgliteHarness.js';
import type { PgliteHarness } from './helpers/pgliteHarness.js';

const CLAUDE_CODE_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const CLAUDE_CODE_METADATA = {
    client_id: CLAUDE_CODE_CLIENT_ID,
    client_name: 'Claude Code',
    client_uri: 'https://claude.ai',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
};
const REDIRECT = 'http://127.0.0.1:53682/callback';
const DASHBOARD = 'https://dashboard.example.test';
const { userA, userB, teamA } = PGLITE_SEED;

let pg: PgliteHarness;
let asServer: TestServer;
let mcpServer: TestServer;
let issuer: string;
let resource: string;
let store: PostgresOAuthStore;
let grants: PostgresGrantRecordStore;
let redis: InstanceType<typeof RedisMock>;
let metering: ReturnType<typeof createMetering>;
/** Who the dashboard session cookie belongs to; null = signed out. */
let sessionUser: { id: string } | null = null;
const grantsCreated: string[] = [];

beforeAll(async () => {
    pg = await createPgliteHarness();
    asServer = await listenEphemeral();
    mcpServer = await listenEphemeral();
    issuer = `${asServer.baseUrl}/oauth`;
    resource = `${mcpServer.baseUrl}/mcp`;
    store = new PostgresOAuthStore(pg.db);
    grants = new PostgresGrantRecordStore(pg.db);

    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const provider = createOAuthProvider({
        issuer,
        resource,
        scopes: MCP_SCOPES,
        store,
        cookieKeys: ['an-end-to-end-cookie-key-of-32-characters'],
        jwks: { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'test', alg: 'ES256', use: 'sig' }] },
        dynamicRegistration: false,
        clientIdMetadataDocuments: { enabled: true, allowFetch: (clientId) => clientId === CLAUDE_CODE_CLIENT_ID },
        fetch: async (input) => {
            const url = String(input instanceof Request ? input.url : input);
            return url === CLAUDE_CODE_CLIENT_ID ? Response.json(CLAUDE_CODE_METADATA) : new Response('no', { status: 404 });
        },
    });

    const asApp = express();
    asApp.use(express.json());
    asApp.use(express.urlencoded({ extended: true }));
    asApp.get(oauthMetadataPath(issuer), createOAuthMetadataHandler(provider));
    asApp.use('/oauth', createOAuthRouter({
        provider,
        resource,
        grants,
        dashboardConsent: {
            consentPageUrl: `${DASHBOARD}/oauth/consent`,
            resolveSessionUser: async () => sessionUser,
            takeDecision: async (uid) => {
                const payload = await store.find(CONSENT_DECISION_MODEL, uid);
                if (!payload) return null;
                await store.destroy(CONSENT_DECISION_MODEL, uid);
                return payload as unknown as StoredConsentDecision;
            },
            onGrantCreated: (record) => grantsCreated.push(record.grantId),
        },
    }));
    asServer.handle(asApp);

    redis = new RedisMock();
    metering = createMetering({ db: pg.db, redis: redis as unknown as MeteringRedis, dashboardBaseUrl: DASHBOARD });
    mcpServer.handle(createMcpApp({
        publicUrl: resource,
        authorizationServerIssuer: issuer,
        dashboardBaseUrl: DASHBOARD,
        tokenStore: createPostgresTokenStore(pg.db, { cacheMs: 0 }),
        data: createScopedData(pg.db, { artifacts: new InMemoryArtifactReader() }),
        access: createDbAccessChecker(pg.db, { ttlMs: 0 }),
        usage: metering.usage,
        gate: metering.gate,
        switches: createKillSwitches({ enabled: true, redis, cacheMs: 0 }),
    }));
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    await asServer?.close();
    await mcpServer?.close();
    await pg?.close();
});

beforeEach(async () => {
    sessionUser = { id: userA.id };
    await redis.flushall();
    await pg.db.update(teams).set({ mcpEnabled: true, mcpMaskIdentifiers: false, mcpCreditLimit: 300, mcpLimitsSyncedAt: new Date(), mcpPlanName: 'free' }).where(eq(teams.id, teamA.id));
});

function pkce() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Claude Code's side up to the consent page: returns the interaction id and the browser's cookies. */
async function startSignIn() {
    const { verifier, challenge } = pkce();
    const state = randomBytes(8).toString('hex');
    const url = new URL(`${issuer}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLAUDE_CODE_CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', resource);
    const jar = new CookieJar();
    const result = await browse(jar, url);
    expect(result.external?.origin, result.trail.join(' -> ')).toBe(DASHBOARD);
    expect(result.external?.pathname).toBe('/oauth/consent');
    const uid = result.external!.searchParams.get('uid')!;
    expect(uid).toBeTruthy();
    return { uid, jar, verifier, state };
}

/** What the consent page's POST stores. */
async function decide(uid: string, decision: StoredConsentDecision) {
    await store.upsert(CONSENT_DECISION_MODEL, uid, decision as unknown as Record<string, unknown>, { expiresInSeconds: 600 });
}

async function finish(uid: string, jar: CookieJar) {
    return browse(jar, `${issuer}/interaction/${uid}/finish`);
}

async function signIn() {
    const flow = await startSignIn();
    await decide(flow.uid, { userId: userA.id, decision: 'allow', teamId: teamA.id, projectIds: [teamA.projectId], scopes: [...MCP_SCOPES] });
    const done = await finish(flow.uid, flow.jar);
    const back = done.external!;
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe(flow.state);
    const code = back.searchParams.get('code');
    expect(code, back.href).toBeTruthy();
    const response = await fetch(`${issuer}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLAUDE_CODE_CLIENT_ID, code: code!, redirect_uri: REDIRECT, code_verifier: flow.verifier, resource }),
    });
    const tokens = await response.json() as { access_token: string; refresh_token: string };
    expect(response.status, JSON.stringify(tokens)).toBe(200);
    return tokens;
}

async function connect(token: string) {
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? '';
    return { isError: result.isError === true, text, json: (() => { try { return JSON.parse(text.split('\n')[0]); } catch { return null; } })() };
}

describe('sign-in through the dashboard consent page', () => {
    it('hands the browser to the consent page, then finishes with a token stored only as a hash', async () => {
        const tokens = await signIn();
        expect(tokens.access_token).toMatch(/^rjm_/);
        expect(tokens.refresh_token).toMatch(/^rjmr_/);

        const rows = await pg.db.select({ model: mcpOAuthRecords.model, key: mcpOAuthRecords.key, payload: mcpOAuthRecords.payload }).from(mcpOAuthRecords);
        const dump = JSON.stringify(rows);
        expect(dump).not.toContain(tokens.access_token);
        expect(dump).not.toContain(tokens.refresh_token);
        // No consent decision is left behind: it is single use.
        expect(rows.some((row) => row.model === CONSENT_DECISION_MODEL)).toBe(false);

        const [grant] = await pg.db.select().from(mcpGrants).where(eq(mcpGrants.userId, userA.id)).limit(1);
        expect(grant).toMatchObject({ clientId: CLAUDE_CODE_CLIENT_ID, clientName: 'Claude Code', teamId: teamA.id, projectIds: [teamA.projectId], revokedAt: null });
        expect(grantsCreated).toContain(grant.grantId);
    });

    it('sends the browser back to the consent page when no decision was made, the session is gone, or another user decided', async () => {
        const flow = await startSignIn();
        let result = await finish(flow.uid, flow.jar);
        expect(result.external?.pathname).toBe('/oauth/consent');

        await decide(flow.uid, { userId: userA.id, decision: 'allow', teamId: teamA.id, projectIds: [teamA.projectId], scopes: [...MCP_SCOPES] });
        sessionUser = null;
        result = await finish(flow.uid, flow.jar);
        expect(result.external?.pathname).toBe('/oauth/consent');

        sessionUser = { id: userB.id };
        result = await finish(flow.uid, flow.jar);
        expect(result.external?.pathname).toBe('/oauth/consent');
        // The decision was spent by that attempt: user A must decide again.
        sessionUser = { id: userA.id };
        result = await finish(flow.uid, flow.jar);
        expect(result.external?.pathname).toBe('/oauth/consent');
    });

    it('refuses to finish from a browser that did not start the request', async () => {
        const flow = await startSignIn();
        await decide(flow.uid, { userId: userA.id, decision: 'allow', teamId: teamA.id, projectIds: [teamA.projectId], scopes: [...MCP_SCOPES] });
        const stranger = await finish(flow.uid, new CookieJar());
        expect(stranger.external).toBeUndefined();
        expect(stranger.response.status).toBeGreaterThanOrEqual(400);
        // The real browser can still finish: the stranger did not consume it.
        const done = await finish(flow.uid, flow.jar);
        expect(done.external?.searchParams.get('code')).toBeTruthy();
    });

    it('returns access_denied to Claude Code when the user clicks Deny', async () => {
        const flow = await startSignIn();
        await decide(flow.uid, { userId: userA.id, decision: 'deny' });
        const done = await finish(flow.uid, flow.jar);
        expect(done.external?.searchParams.get('error')).toBe('access_denied');
    });

    it('only signs in Claude Code: another client id is refused before any consent', async () => {
        const url = new URL(`${issuer}/authorize`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', 'https://evil.example.test/client.json');
        url.searchParams.set('redirect_uri', 'https://evil.example.test/cb');
        url.searchParams.set('code_challenge', pkce().challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        const result = await browse(new CookieJar(), url);
        expect(result.external?.pathname ?? '').not.toBe('/oauth/consent');
        expect(result.response.status).toBeGreaterThanOrEqual(400);
    });
});

describe('the MCP server with Postgres tokens, live team switches and metering', () => {
    it('answers tools for the granted projects, and refuses everything once the connection is revoked', async () => {
        const tokens = await signIn();
        const client = await connect(tokens.access_token);
        const projects = await callTool(client, 'list_projects');
        expect(projects.isError).toBe(false);
        expect(projects.json.projects.map((project: { id: string }) => project.id)).toEqual([teamA.projectId]);

        const [grant] = await pg.db.select({ grantId: mcpGrants.grantId }).from(mcpGrants).where(eq(mcpGrants.userId, userA.id)).orderBy(mcpGrants.createdAt);
        const latest = (await pg.db.select({ grantId: mcpGrants.grantId, createdAt: mcpGrants.createdAt }).from(mcpGrants)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        expect(grant).toBeDefined();
        await grants.delete(latest.grantId, userA.id);
        await store.revokeAllForGrant(latest.grantId);

        const after = await fetch(resource, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        });
        expect(after.status).toBe(401);
        await client.close().catch(() => undefined);
    });

    it('meters credits, refuses at the limit with the reset date, keeps the free tools working, and records it all', async () => {
        await pg.db.update(teams).set({ mcpCreditLimit: 2 }).where(eq(teams.id, teamA.id));
        const tokens = await signIn();
        const client = await connect(tokens.access_token);
        const range = { projectId: teamA.projectId, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

        expect((await callTool(client, 'get_project_health', range)).isError).toBe(false);
        expect((await callTool(client, 'get_project_health', range)).isError).toBe(false);
        const refused = await callTool(client, 'get_project_health', range);
        expect(refused.isError).toBe(true);
        expect(refused.json.error.code).toBe('limit_reached');
        expect(refused.json.error.message).toMatch(/used 2 of its 2 MCP credits/);
        expect(refused.json.error.message).toContain(`${DASHBOARD}/dashboard/billing`);

        const usage = await callTool(client, 'get_usage');
        expect(usage.isError).toBe(false);
        expect(usage.json).toMatchObject({ creditsUsed: 2, creditsLimit: 2, creditsRemaining: 0, unlimited: false });
        expect((await callTool(client, 'list_projects')).isError).toBe(false);

        await metering.flush();
        // Free teams share one allowance per owner, per calendar month.
        const [period] = await pg.db.select().from(mcpUsagePeriods).where(eq(mcpUsagePeriods.scopeKey, `owner:${userA.id}`));
        expect(period).toMatchObject({ credits: 2 });
        const log = await pg.db.select({ tool: mcpCallLog.tool, outcome: mcpCallLog.outcome, credits: mcpCallLog.credits }).from(mcpCallLog).where(eq(mcpCallLog.teamId, teamA.id));
        expect(log.filter((row) => row.tool === 'get_project_health').map((row) => [row.outcome, row.credits]))
            .toEqual(expect.arrayContaining([['ok', 1], ['ok', 1], ['limit_reached', 0]]));
        const [grant] = await pg.db.select({ lastUsedAt: mcpGrants.lastUsedAt }).from(mcpGrants).where(and(eq(mcpGrants.userId, userA.id))).orderBy(mcpGrants.lastUsedAt);
        expect(grant).toBeDefined();
        await client.close().catch(() => undefined);
    });

    it('rebuilds the credit counter from Postgres when Redis loses it', async () => {
        await pg.db.update(teams).set({ mcpCreditLimit: 3 }).where(eq(teams.id, teamA.id));
        const tokens = await signIn();
        const client = await connect(tokens.access_token);
        const range = { projectId: teamA.projectId, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };
        // Three credits already spent this month according to Postgres; Redis has nothing.
        await metering.flush();
        const month = new Date().toISOString().slice(0, 7);
        await pg.db.insert(mcpUsagePeriods).values({ scopeKey: `owner:${userA.id}`, period: month, credits: 3, calls: 3, bytes: 0 })
            .onConflictDoUpdate({ target: [mcpUsagePeriods.scopeKey, mcpUsagePeriods.period], set: { credits: 3 } });
        await redis.flushall();
        const refused = await callTool(client, 'get_project_health', range);
        expect(refused.json?.error?.code).toBe('limit_reached');
        await client.close().catch(() => undefined);
    });

    it('applies the team switches at the next call: MCP off, and identifier masking on', async () => {
        const tokens = await signIn();
        const client = await connect(tokens.access_token);
        await pg.db.update(teams).set({ mcpEnabled: false }).where(eq(teams.id, teamA.id));
        const off = await callTool(client, 'list_projects');
        expect(off.json?.error?.code).toBe('disabled');
        await pg.db.update(teams).set({ mcpEnabled: true }).where(eq(teams.id, teamA.id));
        expect((await callTool(client, 'list_projects')).isError).toBe(false);

        // A switch in Redis turns one tool off without a deploy.
        await redis.hset(MCP_SWITCHES_KEY, 'tool:list_projects', 'off');
        expect((await callTool(client, 'list_projects')).json?.error?.code).toBe('disabled');
        await redis.hdel(MCP_SWITCHES_KEY, 'tool:list_projects');
        expect((await callTool(client, 'list_projects')).isError).toBe(false);
        await client.close().catch(() => undefined);
    });

    it('rotates refresh tokens, and a reused refresh token kills the connection', async () => {
        const tokens = await signIn();
        const refresh = (token: string) => fetch(`${issuer}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLAUDE_CODE_CLIENT_ID, refresh_token: token, resource }),
        });
        const first = await refresh(tokens.refresh_token);
        const rotated = await first.json() as { access_token: string; refresh_token: string };
        expect(first.status).toBe(200);
        expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
        expect((await callTool(await connect(rotated.access_token), 'list_projects')).isError).toBe(false);

        const replay = await refresh(tokens.refresh_token);
        expect(replay.status).toBe(400);
        // The whole grant is gone: the newest access token stops working too.
        const after = await fetch(resource, {
            method: 'POST',
            headers: { Authorization: `Bearer ${rotated.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        });
        expect(after.status).toBe(401);
    });
});
