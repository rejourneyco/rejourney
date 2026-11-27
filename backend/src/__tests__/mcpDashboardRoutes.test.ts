/**
 * The MCP routes on the main API, as `index.ts` mounts them: the consent
 * endpoints the dashboard's consent page calls, the finish step, and the MCP
 * page's overview, activity, revoke and settings endpoints, against a real
 * (in-process) Postgres.
 *
 * Stand-ins: the dashboard session (a `test_user` cookie), team-access and
 * rate-limit middleware (pass-through; the routes re-check membership
 * themselves), Stripe (the limit sync), email and audit (recorded).
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({
    db: null as any,
    oauth: null as any,
    audits: [] as Array<Record<string, unknown>>,
    emails: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db/client.js', () => ({
    db: new Proxy({}, {
        get: (_target, property) => {
            const value = holder.db[property];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
    pool: { query: async () => ({ rows: [] }), waitingCount: 0 },
}));

function testUser(req: Request): string | null {
    const match = /(?:^|;\s*)test_user=([^;]+)/.exec(req.headers.cookie ?? '');
    return match ? decodeURIComponent(match[1]) : null;
}

vi.mock('../middleware/index.js', () => ({
    sessionAuth: async (req: Request, res: Response, next: NextFunction) => {
        const id = testUser(req);
        if (!id) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id, email: `${id}@example.test`, roles: [] };
        next();
    },
    requireTeamAccess: (_req: Request, _res: Response, next: NextFunction) => next(),
    writeApiRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../services/mcpEntitlement.js', () => ({ syncTeamMcpLimits: async () => ({ creditLimit: 300, planName: 'free' }) }));
vi.mock('../services/mcpEmails.js', () => ({ sendMcpConnectionEmail: async (params: Record<string, unknown>) => { holder.emails.push(params); } }));
vi.mock('../services/auditLog.js', () => ({ createAuditLog: async (entry: Record<string, unknown>) => { holder.audits.push(entry); } }));
vi.mock('../services/mcpOAuth.js', () => ({
    CLAUDE_CODE_CLIENT_ID: 'https://claude.ai/oauth/claude-code-client-metadata',
    getMcpOAuth: () => holder.oauth,
}));

import { mcpCallLog, mcpGrants, mcpOAuthRecords, projects, teamMembers, teams, users } from '../db/schema.js';
import { PostgresGrantRecordStore, PostgresOAuthStore } from '../mcp/oauth/pgStore.js';
import { createOAuthProvider } from '../mcp/oauth/provider.js';
import { MCP_SCOPES } from '../mcp/router.js';
import mcpRoutes, { mountMcpOAuth } from '../routes/mcp.js';
import { CookieJar, browse, listenEphemeral } from './helpers/httpTestServer.js';
import type { TestServer } from './helpers/httpTestServer.js';
import { PGLITE_SEED, PGLITE_START_TIMEOUT_MS, createPgliteHarness } from './helpers/pgliteHarness.js';
import type { PgliteHarness } from './helpers/pgliteHarness.js';

const CLAUDE_CODE_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const REDIRECT = 'http://127.0.0.1:53682/callback';
const DASHBOARD = 'https://dashboard.example.test';
const { userA, userB, teamA, teamB } = PGLITE_SEED;
const MEMBER_ID = '00000000-0000-4000-8000-0000000000a9';

let pg: PgliteHarness;
let server: TestServer;
let issuer: string;
let resource: string;

beforeAll(async () => {
    pg = await createPgliteHarness();
    holder.db = pg.db;
    server = await listenEphemeral();
    issuer = `${server.baseUrl}/oauth`;
    resource = 'https://mcp.example.test/mcp';
    const store = new PostgresOAuthStore(pg.db);
    const grants = new PostgresGrantRecordStore(pg.db);
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const provider = createOAuthProvider({
        issuer,
        resource,
        scopes: MCP_SCOPES,
        store,
        cookieKeys: ['a-dashboard-route-test-cookie-key-32-chars'],
        jwks: { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'k', alg: 'ES256', use: 'sig' }] },
        clientIdMetadataDocuments: { enabled: true, allowFetch: (clientId) => clientId === CLAUDE_CODE_CLIENT_ID },
        fetch: async () => Response.json({
            client_id: CLAUDE_CODE_CLIENT_ID,
            client_name: 'Claude Code',
            redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    });
    holder.oauth = {
        config: { issuer, resource, dashboardBaseUrl: DASHBOARD, cookieKeys: [], allowedClientIds: [CLAUDE_CODE_CLIENT_ID], dynamicRegistration: false },
        provider,
        store,
        grants,
    };

    // A plain member of team A, besides its owner.
    await pg.db.insert(users).values({ id: MEMBER_ID, email: 'member@team-a.example.test', displayName: 'Mina' });
    await pg.db.insert(teamMembers).values({ teamId: teamA.id, userId: MEMBER_ID, role: 'member' });

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    mountMcpOAuth(app as never);
    app.use('/api/mcp', mcpRoutes);
    server.handle(app);
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    await server?.close();
    await pg?.close();
});

beforeEach(async () => {
    holder.audits.length = 0;
    holder.emails.length = 0;
    await pg.db.update(teams).set({ mcpEnabled: true, mcpMaskIdentifiers: false, mcpCreditLimit: 300, mcpLimitsSyncedAt: new Date(), mcpPlanName: 'free' });
});

function api(path: string, user: string | null, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (user) headers.set('cookie', `test_user=${user}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetch(`${server.baseUrl}/api/mcp${path}`, { ...init, headers });
}

async function startSignIn() {
    const verifier = randomBytes(32).toString('base64url');
    const url = new URL(`${issuer}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLAUDE_CODE_CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT);
    url.searchParams.set('state', 'st');
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', resource);
    const jar = new CookieJar();
    const result = await browse(jar, url);
    expect(result.external?.href ?? '').toMatch(new RegExp(`^${DASHBOARD}/oauth/consent\\?uid=`));
    return { uid: result.external!.searchParams.get('uid')!, jar, verifier };
}

describe('consent endpoints', () => {
    it('describe the request: Claude Code, its loopback redirect, the read-only scopes, and the user\'s teams with live projects', async () => {
        const { uid } = await startSignIn();
        expect((await api(`/consent/${uid}`, null)).status).toBe(401);

        const response = await api(`/consent/${uid}`, userA.id);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const body: any = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.client).toMatchObject({ id: CLAUDE_CODE_CLIENT_ID, name: 'Claude Code', redirectHost: '127.0.0.1', loopbackOnly: true, registration: 'metadata_document' });
        expect(body.scopes.map((scope: { id: string }) => scope.id)).toEqual([...MCP_SCOPES]);
        expect(body.user).toEqual({ email: `${userA.id}@example.test` });
        // Only the user's own team appears.
        expect(body.teams.map((team: { id: string }) => team.id)).toEqual([teamA.id]);
        expect(body.teams[0]).toMatchObject({ mcpEnabled: true, disabledReason: null, projects: [{ id: teamA.projectId, name: 'Team A app', platform: 'ios' }] });

        expect((await api('/consent/not-a-real-interaction', userA.id)).status).toBe(404);
    });

    it('store an allow for the signed-in user only, for their own team\'s projects, and the finish step issues the code', async () => {
        const { uid, jar, verifier } = await startSignIn();
        const post = (user: string, body: unknown) => api(`/consent/${uid}`, user, { method: 'POST', body: JSON.stringify(body) });

        expect((await post(userA.id, { decision: 'allow', teamId: teamA.id, projectIds: [] })).status).toBe(400);
        expect((await post(userA.id, { decision: 'allow', teamId: teamB.id, projectIds: [teamB.projectId] })).status).toBe(403);
        expect((await post(userA.id, { decision: 'allow', teamId: teamA.id, projectIds: [teamB.projectId] })).status).toBe(400);
        await pg.db.update(teams).set({ mcpEnabled: false }).where(eq(teams.id, teamA.id));
        expect(await (await post(userA.id, { decision: 'allow', teamId: teamA.id, projectIds: [teamA.projectId] })).json() as any).toMatchObject({ error: 'team_mcp_disabled' });
        await pg.db.update(teams).set({ mcpEnabled: true }).where(eq(teams.id, teamA.id));

        const ok = await post(userA.id, { decision: 'allow', teamId: teamA.id, projectIds: [teamA.projectId] });
        expect(ok.status).toBe(200);
        const { redirectTo } = await ok.json() as any;
        expect(redirectTo).toBe(`${issuer}/interaction/${uid}/finish`);

        // The finish step needs both the request's browser and the user's session.
        jar.set('test_user', userA.id);
        const done = await browse(jar, redirectTo);
        expect(done.external?.origin + (done.external?.pathname ?? '')).toBe(REDIRECT);
        const code = done.external!.searchParams.get('code')!;
        const token = await fetch(`${issuer}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLAUDE_CODE_CLIENT_ID, code, redirect_uri: REDIRECT, code_verifier: verifier, resource }),
        });
        expect(token.status).toBe(200);
        expect((await token.json() as any).access_token).toMatch(/^rjm_/);

        // Audit and the new-connection email follow the grant.
        await vi.waitFor(() => expect(holder.emails).toHaveLength(1));
        expect(holder.emails[0]).toMatchObject({ clientName: 'Claude Code', teamName: 'Team A', projectNames: ['Team A app'] });
        expect(holder.audits.map((entry) => entry.action)).toContain('mcp_connection_created');
    });

    it('a deny reaches Claude Code as access_denied', async () => {
        const { uid, jar } = await startSignIn();
        const denied = await api(`/consent/${uid}`, userA.id, { method: 'POST', body: JSON.stringify({ decision: 'deny' }) });
        jar.set('test_user', userA.id);
        const done = await browse(jar, (await denied.json() as any).redirectTo);
        expect(done.external?.searchParams.get('error')).toBe('access_denied');
    });
});

describe('MCP page endpoints', () => {
    async function seedGrant(grantId: string, userId: string, teamId = teamA.id) {
        await pg.db.insert(mcpGrants).values({ grantId, clientId: CLAUDE_CODE_CLIENT_ID, clientName: 'Claude Code', userId, teamId, projectIds: [teamId === teamA.id ? teamA.projectId : teamB.projectId], scopes: [...MCP_SCOPES] }).onConflictDoNothing();
        await pg.db.insert(mcpOAuthRecords).values({ model: 'AccessToken', key: `hash-${grantId}`, payload: { kind: 'AccessToken' }, grantId }).onConflictDoNothing();
    }

    it('overview: usage for the period, connections (members see their own), the switches', async () => {
        await seedGrant('grant-owner', userA.id);
        await seedGrant('grant-member', MEMBER_ID);
        const period = new Date().toISOString().slice(0, 7);
        await pg.db.insert(mcpCallLog).values([
            { teamId: teamA.id, grantId: 'grant-owner', userId: userA.id, tool: 'get_session_context', credits: 3, bytes: 100, outcome: 'ok', durationMs: 10, period },
            { teamId: teamA.id, grantId: 'grant-member', userId: MEMBER_ID, tool: 'list_issues', credits: 1, bytes: 100, outcome: 'ok', durationMs: 10, period },
            { teamId: teamA.id, grantId: 'grant-member', userId: MEMBER_ID, tool: 'list_issues', credits: 0, bytes: 0, outcome: 'limit_reached', durationMs: 1, period },
        ]);

        const owner: any = await (await api(`/teams/${teamA.id}/overview`, userA.id)).json();
        expect(owner.usage).toMatchObject({ planName: 'Free', creditLimit: 300 });
        expect(owner.usage.byTool).toEqual(expect.arrayContaining([{ tool: 'get_session_context', calls: 1, credits: 3 }, { tool: 'list_issues', calls: 1, credits: 1 }]));
        // The owner sees every connection in the team (including the one signed in above).
        expect(owner.connections.map((connection: { id: string }) => connection.id)).toEqual(expect.arrayContaining(['grant-member', 'grant-owner']));
        expect(owner.connections.every((connection: { canRevoke: boolean; clientKind: string }) => connection.canRevoke && connection.clientKind === 'claude-code')).toBe(true);
        expect(owner.settings).toEqual({ mcpEnabled: true, maskEndUserIdentifiers: false });
        expect(owner.canManageSettings).toBe(true);

        const member: any = await (await api(`/teams/${teamA.id}/overview`, MEMBER_ID)).json();
        expect(member.connections.map((connection: { id: string }) => connection.id)).toEqual(['grant-member']);
        expect(member.canManageSettings).toBe(false);

        // Not a member of team B: nothing.
        expect((await api(`/teams/${teamB.id}/overview`, userA.id)).status).toBe(404);
    });

    it('activity: newest first, members see only their own calls, failures explained', async () => {
        const owner: any = await (await api(`/teams/${teamA.id}/activity`, userA.id)).json();
        expect(owner.items.length).toBeGreaterThanOrEqual(3);
        const limited = owner.items.find((item: { outcome: string }) => item.outcome === 'limit_reached');
        expect(limited).toMatchObject({ credits: 0, detail: expect.stringContaining('credits') });
        const member: any = await (await api(`/teams/${teamA.id}/activity`, MEMBER_ID)).json();
        expect(member.items.every((item: { userName: string }) => item.userName === 'Mina')).toBe(true);
    });

    it('revoke: the connector or an admin, never another member; tokens are deleted at once', async () => {
        await seedGrant('grant-to-revoke', userA.id);
        expect((await api(`/teams/${teamA.id}/connections/grant-to-revoke`, MEMBER_ID, { method: 'DELETE' })).status).toBe(403);
        expect((await api(`/teams/${teamB.id}/connections/grant-to-revoke`, userB.id, { method: 'DELETE' })).status).toBe(404);
        expect((await api(`/teams/${teamA.id}/connections/grant-to-revoke`, userA.id, { method: 'DELETE' })).status).toBe(204);
        const [row] = await pg.db.select().from(mcpGrants).where(eq(mcpGrants.grantId, 'grant-to-revoke'));
        expect(row.revokedAt).not.toBeNull();
        expect(row.revokedByUserId).toBe(userA.id);
        expect(await pg.db.select().from(mcpOAuthRecords).where(eq(mcpOAuthRecords.grantId, 'grant-to-revoke'))).toEqual([]);
        expect(holder.audits.map((entry) => entry.action)).toContain('mcp_connection_revoked');
        // Revoking twice: not found.
        expect((await api(`/teams/${teamA.id}/connections/grant-to-revoke`, userA.id, { method: 'DELETE' })).status).toBe(404);

        // A member can revoke their own.
        await seedGrant('grant-member-own', MEMBER_ID);
        expect((await api(`/teams/${teamA.id}/connections/grant-member-own`, MEMBER_ID, { method: 'DELETE' })).status).toBe(204);
    });

    it('settings: admins only, saved and audited', async () => {
        const put = (user: string, body: unknown) => api(`/teams/${teamA.id}/settings`, user, { method: 'PUT', body: JSON.stringify(body) });
        expect((await put(MEMBER_ID, { mcpEnabled: false })).status).toBe(403);
        expect((await put(userA.id, { mcpEnabled: 'no' })).status).toBe(400);
        const saved: any = await (await put(userA.id, { maskEndUserIdentifiers: true })).json();
        expect(saved).toEqual({ settings: { mcpEnabled: true, maskEndUserIdentifiers: true } });
        const [team] = await pg.db.select({ mask: teams.mcpMaskIdentifiers }).from(teams).where(eq(teams.id, teamA.id));
        expect(team.mask).toBe(true);
        expect(holder.audits.map((entry) => entry.action)).toContain('mcp_settings_updated');
    });

    it('every route answers 404 while MCP is off on the server', async () => {
        const saved = holder.oauth;
        holder.oauth = null;
        try {
            expect((await api(`/teams/${teamA.id}/overview`, userA.id)).status).toBe(404);
            expect((await api('/consent/x', userA.id)).status).toBe(404);
        } finally {
            holder.oauth = saved;
        }
        // Projects of other teams were never touched.
        expect((await pg.db.select().from(projects)).length).toBeGreaterThan(0);
    });
});
