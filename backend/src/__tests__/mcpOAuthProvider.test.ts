/**
 * OAuth 2.1 authorization server spike: `oidc-provider` mounted on Express,
 * exercised end to end over real HTTP on an ephemeral loopback port.
 *
 * Covers authorization code + PKCE, resource-bound opaque tokens, refresh
 * rotation with reuse detection, the negative cases, loopback redirect URIs,
 * dynamic registration, Client ID Metadata Documents, and the hand-off to the
 * MCP resource server from `mcpServer.test.ts`.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Client,
    StreamableHTTPClientTransport,
    UnauthorizedError,
    discoverAuthorizationServerMetadata,
} from '@modelcontextprotocol/client';
import type { OAuthClientProvider } from '@modelcontextprotocol/client';
import { createMcpApp } from '../mcpServer.js';
import { csrfProtection } from '../middleware/csrf.js';
import { hashOAuthCredential } from '../mcp/oauth/adapter.js';
import { InMemoryMcpGrantRecordStore } from '../mcp/oauth/grants.js';
import { createOAuthProvider } from '../mcp/oauth/provider.js';
import { createOAuthMetadataHandler, createOAuthRouter, oauthMetadataPath } from '../mcp/oauth/router.js';
import type { ConsentDecision, ConsentRequest } from '../mcp/oauth/router.js';
import { InMemoryOAuthStore } from '../mcp/oauth/store.js';
import { createStoreBackedTokenStore } from '../mcp/oauth/tokenStore.js';
import { MCP_SCOPES } from '../mcp/router.js';
import { CookieJar, browse, listenEphemeral, readJson } from './helpers/httpTestServer.js';
import type { TestServer } from './helpers/httpTestServer.js';
import { grantTrustingAccess, projectsOnlyData } from './helpers/mcpStubs.js';

const TEST_USER = { userId: 'user-test-1', teamId: 'team-test-1' };
const GRANTED_PROJECTS = ['project-alpha', 'project-beta'];

const WEB_CLIENT = 'spike-web-client';
const WEB_REDIRECT = 'https://client.example.test/callback';
const NATIVE_CLIENT = 'spike-native-client';
const WEB_LOOPBACK_CLIENT = 'spike-web-loopback-client';
const CIMD_CLIENT_ID = 'https://client.example.test/oauth/client-metadata.json';
const CIMD_BLOCKED_CLIENT_ID = 'https://blocked.example.test/oauth/client-metadata.json';
// Claude Code's published Client ID Metadata Document, verbatim (fetched 2026-11-26).
// Served to the provider by the injected fetch below; tests never touch the network.
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

const store = new InMemoryOAuthStore();
const grants = new InMemoryMcpGrantRecordStore();
const consentRequests: ConsentRequest[] = [];
let nextDecision: ConsentDecision;

const metadataFetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === CIMD_CLIENT_ID) {
        return Response.json(
            {
                client_id: CIMD_CLIENT_ID,
                client_name: 'Spike CIMD client',
                redirect_uris: ['https://client.example.test/cimd/callback'],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            },
            { headers: { 'cache-control': 'max-age=60' } },
        );
    }
    if (url === CLAUDE_CODE_CLIENT_ID) {
        return Response.json(CLAUDE_CODE_METADATA);
    }
    return new Response('not found', { status: 404 });
});

let asServer: TestServer;
let mcpServer: TestServer;
/** Same provider, mounted behind the body parsers the main API applies globally. */
let parsedBodyServer: TestServer;
let issuer: string;
let resource: string;

function approve(overrides: Partial<Extract<ConsentDecision, { approved: true }>> = {}): ConsentDecision {
    return { approved: true, ...TEST_USER, projectIds: GRANTED_PROJECTS, scopes: ['sessions:read', 'issues:read'], ...overrides };
}

function pkcePair() {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

interface AuthorizeOptions {
    clientId?: string;
    redirectUri?: string;
    scope?: string | null;
    resource?: string | null;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
}

function authorizeUrl(options: AuthorizeOptions, state: string): URL {
    const url = new URL(`${issuer}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', options.clientId ?? WEB_CLIENT);
    url.searchParams.set('redirect_uri', options.redirectUri ?? WEB_REDIRECT);
    url.searchParams.set('state', state);
    if (options.scope !== null) url.searchParams.set('scope', options.scope ?? 'sessions:read issues:read');
    if (options.resource !== null) url.searchParams.set('resource', options.resource ?? resource);
    if (options.codeChallenge !== null && options.codeChallenge !== undefined) {
        url.searchParams.set('code_challenge', options.codeChallenge);
    }
    if (options.codeChallengeMethod !== null) {
        url.searchParams.set('code_challenge_method', options.codeChallengeMethod ?? 'S256');
    }
    return url;
}

/** Runs the browser half of the flow: authorize -> interaction (stub consent) -> resume -> redirect to the client. */
async function authorize(options: AuthorizeOptions = {}) {
    const pkce = pkcePair();
    const state = randomBytes(8).toString('hex');
    const jar = new CookieJar();
    const result = await browse(jar, authorizeUrl({ codeChallenge: pkce.challenge, ...options }, state));
    return { ...result, pkce, state, jar };
}

function tokenRequest(params: Record<string, string>): Promise<Response> {
    return fetch(`${issuer}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
    });
}

interface TokenSet {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
}

/** Authorizes and exchanges the code: the happy path most tests start from. */
async function obtainTokens(options: AuthorizeOptions = {}): Promise<TokenSet & { code: string; verifier: string; redirectUri: string }> {
    const redirectUri = options.redirectUri ?? WEB_REDIRECT;
    const clientId = options.clientId ?? WEB_CLIENT;
    const flow = await authorize(options);
    const code = flow.external?.searchParams.get('code');
    if (!code) throw new Error(`No authorization code: ${flow.response.status} ${flow.external?.href ?? flow.trail.join(' -> ')}`);

    const response = await tokenRequest({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: flow.pkce.verifier,
        resource,
    });
    const body = await response.json();
    if (response.status !== 200) throw new Error(`Token exchange failed: ${response.status} ${JSON.stringify(body)}`);
    return { ...(body as TokenSet), code, verifier: flow.pkce.verifier, redirectUri };
}

beforeAll(async () => {
    asServer = await listenEphemeral();
    mcpServer = await listenEphemeral();
    issuer = `${asServer.baseUrl}/oauth`;
    resource = `${mcpServer.baseUrl}/mcp`;

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

    const provider = createOAuthProvider({
        issuer,
        resource,
        scopes: MCP_SCOPES,
        store,
        cookieKeys: ['spike-cookie-signing-key'],
        jwks: { keys: [privateKey.export({ format: 'jwk' })] },
        staticClients: [
            { client_id: WEB_CLIENT, redirect_uris: [WEB_REDIRECT], token_endpoint_auth_method: 'none' },
            {
                client_id: NATIVE_CLIENT,
                application_type: 'native',
                redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'],
                token_endpoint_auth_method: 'none',
            },
            {
                client_id: WEB_LOOPBACK_CLIENT,
                application_type: 'web',
                redirect_uris: ['http://127.0.0.1:3000/callback'],
                token_endpoint_auth_method: 'none',
            },
        ],
        dynamicRegistration: true,
        clientIdMetadataDocuments: {
            enabled: true,
            allowFetch: (clientId) => new URL(clientId).hostname !== 'blocked.example.test',
        },
        fetch: metadataFetch,
    });

    const oauthRouter = createOAuthRouter({
        provider,
        resource,
        grants,
        resolveConsent: async (request) => {
            consentRequests.push(request);
            return nextDecision;
        },
    });

    const asApp = express();
    asApp.get(oauthMetadataPath(issuer), createOAuthMetadataHandler(provider));
    asApp.use('/oauth', oauthRouter);
    asServer.handle(asApp);

    parsedBodyServer = await listenEphemeral();
    const parsedBodyApp = express();
    parsedBodyApp.use(express.json({ limit: '5mb' }));
    parsedBodyApp.use(express.urlencoded({ extended: true, limit: '5mb' }));
    parsedBodyApp.use('/oauth', oauthRouter);
    parsedBodyServer.handle(parsedBodyApp);

    // The MCP resource server from part 1, validating tokens straight from the shared store.
    mcpServer.handle(
        createMcpApp({
            publicUrl: resource,
            authorizationServerIssuer: issuer,
            tokenStore: createStoreBackedTokenStore({ store, grants }),
            dashboardBaseUrl: 'https://dashboard.example.test',
            access: grantTrustingAccess,
            data: projectsOnlyData(async (ctx) =>
                ctx.allowedProjectIds.map((id) => ({ id, name: `Name of ${id}`, platforms: ['ios'] })),
            ),
        }),
    );
});

afterAll(async () => {
    await asServer.close();
    await mcpServer.close();
    await parsedBodyServer.close();
});

beforeEach(() => {
    nextDecision = approve();
    consentRequests.length = 0;
    metadataFetch.mockClear();
});

describe('authorization server metadata', () => {
    it('is served at the RFC 8414 path-issuer location and describes the configured features', async () => {
        const res = await fetch(`${asServer.baseUrl}/.well-known/oauth-authorization-server/oauth`);
        expect(res.status).toBe(200);
        const metadata = await readJson(res);

        expect(metadata).toMatchObject({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            registration_endpoint: `${issuer}/register`,
            revocation_endpoint: `${issuer}/revoke`,
            code_challenge_methods_supported: ['S256'],
            authorization_response_iss_parameter_supported: true,
            client_id_metadata_document_supported: true,
            response_types_supported: ['code'],
        });
        expect(metadata.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
        expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
    });

    it('is also served natively as OIDC discovery under the mount path', async () => {
        const res = await fetch(`${issuer}/.well-known/openid-configuration`);
        expect(res.status).toBe(200);
        expect((await readJson(res)).issuer).toBe(issuer);
    });

    it('is discoverable by the official MCP client from the issuer', async () => {
        const metadata = await discoverAuthorizationServerMetadata(issuer);
        expect(metadata?.issuer).toBe(issuer);
        expect(metadata?.token_endpoint).toBe(`${issuer}/token`);
    });
});

describe('authorization code + PKCE flow', () => {
    it('authorize -> interaction -> code -> token yields an opaque, audience-bound access token', async () => {
        const flow = await authorize();

        // authorize -> stub interaction -> resume -> client redirect
        expect(flow.trail.map((href) => new URL(href).pathname.replace(/\/[\w-]{20,}$/, '/:uid'))).toEqual([
            '/oauth/authorize',
            '/oauth/interaction/:uid',
            '/oauth/authorize/:uid',
        ]);
        expect(flow.external?.origin + flow.external!.pathname).toBe(WEB_REDIRECT);
        expect(flow.external?.searchParams.get('state')).toBe(flow.state);
        // RFC 9207: the issuer is echoed in the authorization response.
        expect(flow.external?.searchParams.get('iss')).toBe(issuer);
        const code = flow.external?.searchParams.get('code');
        expect(code).toBeTruthy();

        // The stub consent step saw the request and recorded what was granted.
        expect(consentRequests).toHaveLength(1);
        expect(consentRequests[0]).toMatchObject({
            clientId: WEB_CLIENT,
            redirectUri: WEB_REDIRECT,
            requestedScopes: ['sessions:read', 'issues:read'],
            resource,
        });

        const res = await tokenRequest({
            grant_type: 'authorization_code',
            client_id: WEB_CLIENT,
            code: code!,
            redirect_uri: WEB_REDIRECT,
            code_verifier: flow.pkce.verifier,
            resource,
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toContain('no-store');
        const tokens = (await res.json()) as TokenSet;

        expect(tokens.token_type).toBe('Bearer');
        expect(tokens.expires_in).toBe(3600);
        expect(tokens.scope.split(' ').sort()).toEqual(['issues:read', 'sessions:read']);
        // Opaque, prefixed, not a JWT.
        expect(tokens.access_token).toMatch(/^rjm_[A-Za-z0-9_-]{43}$/);
        expect(tokens.access_token.split('.')).toHaveLength(1);
        expect(tokens.refresh_token).toMatch(/^rjmr_[A-Za-z0-9_-]{43}$/);

        // Audience-bound and hashed at rest: stored under SHA-256(token), never in the clear.
        const stored = store.dump('AccessToken').find((record) => record.key === hashOAuthCredential(tokens.access_token));
        expect(stored?.payload).toMatchObject({
            kind: 'AccessToken',
            aud: resource,
            accountId: TEST_USER.userId,
            clientId: WEB_CLIENT,
        });
        expect(stored?.payload.jti).toBeUndefined();
        const everything = JSON.stringify(
            ['AccessToken', 'RefreshToken', 'AuthorizationCode', 'Grant', 'Session', 'Interaction'].map((model) => store.dump(model)),
        );
        expect(everything).not.toContain(tokens.access_token);
        expect(everything).not.toContain(tokens.refresh_token);
        expect(everything).not.toContain(code!);

        // The Rejourney side of the grant: user, team and the approved projects.
        const grantId = stored?.payload.grantId as string;
        expect(await grants.find(grantId)).toMatchObject({
            grantId,
            clientId: WEB_CLIENT,
            ...TEST_USER,
            projectIds: GRANTED_PROJECTS,
            scopes: ['sessions:read', 'issues:read'],
        });
    });

    it('binds the token to the MCP resource even when the client omits the resource parameter', async () => {
        const flow = await authorize({ resource: null });
        const code = flow.external?.searchParams.get('code');
        expect(code).toBeTruthy();

        const res = await tokenRequest({
            grant_type: 'authorization_code',
            client_id: WEB_CLIENT,
            code: code!,
            redirect_uri: WEB_REDIRECT,
            code_verifier: flow.pkce.verifier,
        });
        expect(res.status).toBe(200);
        const tokens = (await res.json()) as TokenSet;
        const stored = store.dump('AccessToken').find((record) => record.key === hashOAuthCredential(tokens.access_token));
        expect(stored?.payload.aud).toBe(resource);
    });

    it('treats a request with no scope as a request for the resource scopes, limited by consent', async () => {
        const flow = await authorize({ scope: null });
        const code = flow.external?.searchParams.get('code');
        expect(code, flow.external?.href).toBeTruthy();
        expect(consentRequests[0].requestedScopes).toEqual([...MCP_SCOPES]);

        const res = await tokenRequest({
            grant_type: 'authorization_code',
            client_id: WEB_CLIENT,
            code: code!,
            redirect_uri: WEB_REDIRECT,
            code_verifier: flow.pkce.verifier,
            resource,
        });
        expect(res.status).toBe(200);
        const tokens = (await res.json()) as TokenSet;
        // Only what the consent step granted, not everything that was requested.
        expect(tokens.scope.split(' ').sort()).toEqual(['issues:read', 'sessions:read']);
    });

    it('returns access_denied to the client when the user declines', async () => {
        nextDecision = { approved: false };
        const flow = await authorize();
        expect(flow.external?.searchParams.get('error')).toBe('access_denied');
        expect(flow.external?.searchParams.get('code')).toBeNull();
        expect(flow.external?.searchParams.get('iss')).toBe(issuer);
    });
});

describe('refresh token rotation', () => {
    it('rotates on every use, rejects reuse of the old token, and revokes the grant', async () => {
        const first = await obtainTokens();

        const refreshed = await tokenRequest({
            grant_type: 'refresh_token',
            client_id: WEB_CLIENT,
            refresh_token: first.refresh_token,
            resource,
        });
        expect(refreshed.status).toBe(200);
        const second = (await refreshed.json()) as TokenSet;
        expect(second.refresh_token).toMatch(/^rjmr_/);
        expect(second.refresh_token).not.toBe(first.refresh_token);
        expect(second.access_token).toMatch(/^rjm_/);
        expect(second.access_token).not.toBe(first.access_token);

        const tokenStore = createStoreBackedTokenStore({ store, grants });
        const live = await tokenStore.findByAccessToken(second.access_token);
        expect(live).toMatchObject({ userId: TEST_USER.userId, projectIds: GRANTED_PROJECTS, resource });

        // Replay the rotated-out refresh token.
        const reuse = await tokenRequest({
            grant_type: 'refresh_token',
            client_id: WEB_CLIENT,
            refresh_token: first.refresh_token,
            resource,
        });
        expect(reuse.status).toBe(400);
        expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' });

        // Reuse detection revoked the whole grant: the newest tokens are dead too.
        const afterReuse = await tokenRequest({
            grant_type: 'refresh_token',
            client_id: WEB_CLIENT,
            refresh_token: second.refresh_token,
            resource,
        });
        expect(afterReuse.status).toBe(400);
        expect(await afterReuse.json()).toMatchObject({ error: 'invalid_grant' });
        expect(await tokenStore.findByAccessToken(second.access_token)).toBeNull();
        expect(await tokenStore.findByAccessToken(first.access_token)).toBeNull();
        expect(await grants.find(live!.grantId)).toBeNull();
    });
});

describe('negative cases', () => {
    it('rejects a wrong code_verifier', async () => {
        const flow = await authorize();
        const res = await tokenRequest({
            grant_type: 'authorization_code',
            client_id: WEB_CLIENT,
            code: flow.external!.searchParams.get('code')!,
            redirect_uri: WEB_REDIRECT,
            code_verifier: pkcePair().verifier,
            resource,
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    });

    it('rejects a token request whose redirect_uri differs from the authorization request', async () => {
        const flow = await authorize();
        const res = await tokenRequest({
            grant_type: 'authorization_code',
            client_id: WEB_CLIENT,
            code: flow.external!.searchParams.get('code')!,
            redirect_uri: 'https://client.example.test/other-callback',
            code_verifier: flow.pkce.verifier,
            resource,
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    });

    it('refuses an unregistered redirect_uri at the authorization endpoint without redirecting to it', async () => {
        const flow = await authorize({ redirectUri: 'https://attacker.example.test/callback' });
        expect(flow.external).toBeUndefined();
        expect(flow.response.status).toBe(400);
        expect(await flow.response.text()).toContain('invalid_redirect_uri');
        expect(consentRequests).toHaveLength(0);
    });

    it('rejects a replayed authorization code and revokes the tokens it produced', async () => {
        const first = await obtainTokens();

        const replay = await tokenRequest({
            grant_type: 'authorization_code',
            client_id: WEB_CLIENT,
            code: first.code,
            redirect_uri: first.redirectUri,
            code_verifier: first.verifier,
            resource,
        });
        expect(replay.status).toBe(400);
        expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });

        const tokenStore = createStoreBackedTokenStore({ store, grants });
        expect(await tokenStore.findByAccessToken(first.access_token)).toBeNull();
        const refresh = await tokenRequest({
            grant_type: 'refresh_token',
            client_id: WEB_CLIENT,
            refresh_token: first.refresh_token,
            resource,
        });
        expect(refresh.status).toBe(400);
    });

    it('rejects an authorization request without PKCE (no downgrade)', async () => {
        const jar = new CookieJar();
        const result = await browse(jar, authorizeUrl({ codeChallenge: null, codeChallengeMethod: null }, 'state-1'));
        expect(result.external?.searchParams.get('error')).toBe('invalid_request');
        expect(result.external?.searchParams.get('code')).toBeNull();
        expect(consentRequests).toHaveLength(0);
    });

    it('rejects the plain PKCE method', async () => {
        const jar = new CookieJar();
        const result = await browse(
            jar,
            authorizeUrl({ codeChallenge: pkcePair().verifier, codeChallengeMethod: 'plain' }, 'state-2'),
        );
        expect(result.external?.searchParams.get('error')).toBe('invalid_request');
        expect(consentRequests).toHaveLength(0);
    });

    it('rejects a resource other than the MCP endpoint', async () => {
        const flow = await authorize({ resource: 'https://api.example.test/' });
        expect(flow.external?.searchParams.get('error')).toBe('invalid_target');
        expect(consentRequests).toHaveLength(0);
    });
});

describe('loopback redirect URIs', () => {
    it('native client: http://127.0.0.1:<any port>/callback matches a portless registration', async () => {
        const redirectUri = 'http://127.0.0.1:53124/callback';
        const tokens = await obtainTokens({ clientId: NATIVE_CLIENT, redirectUri });
        expect(tokens.access_token).toMatch(/^rjm_/);
    });

    it('native client: http://localhost:<any port>/callback matches too, but a different path does not', async () => {
        const ok = await authorize({ clientId: NATIVE_CLIENT, redirectUri: 'http://localhost:41000/callback' });
        expect(ok.external?.searchParams.get('code')).toBeTruthy();

        const wrongPath = await authorize({ clientId: NATIVE_CLIENT, redirectUri: 'http://127.0.0.1:53124/other' });
        expect(wrongPath.external).toBeUndefined();
        expect(wrongPath.response.status).toBe(400);
        expect(await wrongPath.response.text()).toContain('invalid_redirect_uri');
    });

    it('web client: a loopback redirect on a different port is rejected (exact match only)', async () => {
        const exact = await authorize({ clientId: WEB_LOOPBACK_CLIENT, redirectUri: 'http://127.0.0.1:3000/callback' });
        expect(exact.external?.searchParams.get('code')).toBeTruthy();

        const otherPort = await authorize({ clientId: WEB_LOOPBACK_CLIENT, redirectUri: 'http://127.0.0.1:3001/callback' });
        expect(otherPort.external).toBeUndefined();
        expect(otherPort.response.status).toBe(400);
        expect(await otherPort.response.text()).toContain('invalid_redirect_uri');
    });
});

describe('client registration paths', () => {
    it('dynamic client registration (RFC 7591) issues a public client that completes the flow', async () => {
        const res = await fetch(`${issuer}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_name: 'Dynamically registered spike client',
                redirect_uris: ['https://dcr.example.test/callback'],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            }),
        });
        expect(res.status).toBe(201);
        const registered = await readJson(res);
        expect(registered.client_id).toEqual(expect.any(String));
        expect(registered.client_secret).toBeUndefined();
        expect(registered.token_endpoint_auth_method).toBe('none');
        expect(registered.registration_access_token).toBeUndefined();

        const tokens = await obtainTokens({ clientId: registered.client_id, redirectUri: 'https://dcr.example.test/callback' });
        expect(tokens.access_token).toMatch(/^rjm_/);
    });

    it('Client ID Metadata Document: an HTTPS URL client_id is resolved by fetching its document', async () => {
        const tokens = await obtainTokens({ clientId: CIMD_CLIENT_ID, redirectUri: 'https://client.example.test/cimd/callback' });
        expect(tokens.access_token).toMatch(/^rjm_/);

        expect(metadataFetch).toHaveBeenCalled();
        const [url, init] = metadataFetch.mock.calls[0];
        expect(String(url)).toBe(CIMD_CLIENT_ID);
        // The library never follows redirects when fetching the document.
        expect(init?.redirect).toBe('manual');
        expect(consentRequests[0].clientId).toBe(CIMD_CLIENT_ID);
    });

    it('Client ID Metadata Document: the allowFetch hook can block a client_id before any fetch', async () => {
        const flow = await authorize({ clientId: CIMD_BLOCKED_CLIENT_ID, redirectUri: 'https://blocked.example.test/callback' });
        expect(flow.external).toBeUndefined();
        expect(flow.response.status).toBe(400);
        expect(metadataFetch).not.toHaveBeenCalled();
        expect(consentRequests).toHaveLength(0);
    });

    it('Client ID Metadata Document: a redirect_uri not listed in the document is refused', async () => {
        const flow = await authorize({ clientId: CIMD_CLIENT_ID, redirectUri: 'https://attacker.example.test/callback' });
        expect(flow.external).toBeUndefined();
        expect(flow.response.status).toBe(400);
    });
});

describe('mounting inside the main API', () => {
    it('token and registration endpoints still work when the host app has already parsed the body', async () => {
        const flow = await authorize();
        const token = await fetch(`${parsedBodyServer.baseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: WEB_CLIENT,
                code: flow.external!.searchParams.get('code')!,
                redirect_uri: WEB_REDIRECT,
                code_verifier: flow.pkce.verifier,
                resource,
            }),
        });
        expect(token.status).toBe(200);
        expect((await readJson(token)).access_token).toMatch(/^rjm_/);

        const registration = await fetch(`${parsedBodyServer.baseUrl}/oauth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ redirect_uris: ['https://parsed.example.test/callback'], token_endpoint_auth_method: 'none' }),
        });
        expect(registration.status).toBe(201);
    });
});

describe("main API middleware the mount is exempted from", () => {
    const run = (method: string, path: string) => {
        const status = vi.fn().mockReturnThis();
        const json = vi.fn().mockReturnThis();
        const next = vi.fn();
        const request = { method, path, originalUrl: path, headers: {}, cookies: {} };
        csrfProtection(request as never, { status, json, cookie: vi.fn() } as never, next);
        return { status, next };
    };

    it('lets AI clients reach the token and revocation endpoints without a browser CSRF token', () => {
        for (const path of ['/oauth/token', '/oauth/revoke', '/.well-known/oauth-authorization-server/oauth']) {
            const { status, next } = run('POST', path);
            expect(next, path).toHaveBeenCalled();
            expect(status, path).not.toHaveBeenCalled();
        }
    });

    it('still protects the dashboard API, including the consent decision', () => {
        for (const path of ['/api/mcp/consent/abc', '/api/mcp/teams/t/settings', '/oauthx/token', '/api/oauth/token']) {
            const { status, next } = run('POST', path);
            expect(status, path).toHaveBeenCalledWith(403);
            expect(next, path).not.toHaveBeenCalled();
        }
    });
});

describe('official MCP client SDK running the whole OAuth flow', () => {
    /** In-memory `OAuthClientProvider`: captures the authorization URL instead of opening a browser. */
    class RecordingOAuthClient implements OAuthClientProvider {
        authorizationUrl: URL | undefined;
        private information: Awaited<ReturnType<OAuthClientProvider['clientInformation']>>;
        private currentTokens: Awaited<ReturnType<OAuthClientProvider['tokens']>>;
        private verifier = '';

        constructor(readonly redirectUrl: string, readonly clientMetadataUrl?: string) {}

        get clientMetadata() {
            return {
                client_name: 'Spike SDK client',
                redirect_uris: [this.redirectUrl],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            };
        }

        clientInformation() {
            return this.information;
        }

        saveClientInformation(information: NonNullable<typeof this.information>) {
            this.information = information;
        }

        tokens() {
            return this.currentTokens;
        }

        saveTokens(tokens: NonNullable<typeof this.currentTokens>) {
            this.currentTokens = tokens;
        }

        redirectToAuthorization(authorizationUrl: URL) {
            this.authorizationUrl = authorizationUrl;
        }

        saveCodeVerifier(codeVerifier: string) {
            this.verifier = codeVerifier;
        }

        codeVerifier() {
            return this.verifier;
        }
    }

    async function connectThroughOAuth(oauth: RecordingOAuthClient) {
        // 1. Unauthenticated connect: the SDK reads the 401 challenge, discovers the
        //    resource and authorization server metadata, resolves a client and
        //    builds the authorization URL.
        const firstTransport = new StreamableHTTPClientTransport(new URL(resource), { authProvider: oauth });
        const firstClient = new Client({ name: 'spike-sdk-oauth', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
        const firstAttempt = await firstClient.connect(firstTransport).then(() => undefined, (error: unknown) => error);
        expect(firstAttempt, String((firstAttempt as Error | undefined)?.message)).toBeInstanceOf(UnauthorizedError);
        expect(oauth.authorizationUrl).toBeDefined();

        // 2. The "browser": authorize -> stub consent -> redirect back to the client.
        const visit = await browse(new CookieJar(), oauth.authorizationUrl!);
        expect(visit.external?.searchParams.get('code')).toBeTruthy();

        // 3. Redeem the code (the SDK checks `iss`, sends the PKCE verifier and `resource`).
        await firstTransport.finishAuth(visit.external!.searchParams);

        // 4. Reconnect with the stored tokens.
        const client = new Client({ name: 'spike-sdk-oauth', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
        await client.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider: oauth }));
        return { client, authorizationUrl: oauth.authorizationUrl!, callback: visit.external! };
    }

    it('via dynamic client registration', async () => {
        nextDecision = approve({ projectIds: ['project-beta'] });
        const oauth = new RecordingOAuthClient('http://127.0.0.1:53999/callback');
        const { client, authorizationUrl } = await connectThroughOAuth(oauth);
        try {
            expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(`${issuer}/authorize`);
            expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
            expect(authorizationUrl.searchParams.get('resource')).toBe(resource);
            expect(metadataFetch).not.toHaveBeenCalled();

            const result = await client.callTool({ name: 'list_projects', arguments: {} });
            expect(result.structuredContent).toMatchObject({
                projects: [{ id: 'project-beta', name: 'Name of project-beta', platforms: ['ios'] }],
            });
            const issued = await oauth.tokens();
            expect(issued?.access_token).toMatch(/^rjm_/);
            expect(issued?.refresh_token).toMatch(/^rjmr_/);
            // The SDK asked for every advertised scope; the token carries only the consented ones.
            expect(authorizationUrl.searchParams.get('scope')?.split(' ')).toEqual([...MCP_SCOPES, 'offline_access']);
            expect(issued?.scope?.split(' ').filter((scope) => scope !== 'offline_access').sort()).toEqual(['issues:read', 'sessions:read']);
        } finally {
            await client.close();
        }
    });

    it("via Claude Code's published metadata document and a loopback redirect on an ephemeral port", async () => {
        nextDecision = approve({ projectIds: ['project-alpha'] });
        const oauth = new RecordingOAuthClient('http://127.0.0.1:53999/callback', CLAUDE_CODE_CLIENT_ID);
        const { client, authorizationUrl, callback } = await connectThroughOAuth(oauth);
        try {
            // No registration happened: the client_id is the metadata document URL.
            expect(authorizationUrl.searchParams.get('client_id')).toBe(CLAUDE_CODE_CLIENT_ID);
            expect(metadataFetch.mock.calls.map(([url]) => String(url))).toContain(CLAUDE_CODE_CLIENT_ID);
            expect(callback.origin + callback.pathname).toBe('http://127.0.0.1:53999/callback');
            expect(consentRequests[0]).toMatchObject({
                clientId: CLAUDE_CODE_CLIENT_ID,
                redirectUri: 'http://127.0.0.1:53999/callback',
            });

            const result = await client.callTool({ name: 'list_projects', arguments: {} });
            expect(result.structuredContent).toMatchObject({
                projects: [{ id: 'project-alpha', name: 'Name of project-alpha', platforms: ['ios'] }],
            });
        } finally {
            await client.close();
        }
    });
});

describe('hand-off to the MCP resource server', () => {
    async function callListProjects(token: string) {
        const client = new Client({ name: 'spike-oauth-client', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
        const transport = new StreamableHTTPClientTransport(new URL(resource), { authProvider: { token: async () => token } });
        await client.connect(transport);
        try {
            return await client.callTool({ name: 'list_projects', arguments: {} });
        } finally {
            await client.close();
        }
    }

    it('an access token issued by the flow is accepted by /mcp and scoped to the approved projects', async () => {
        nextDecision = approve({ projectIds: ['project-alpha'] });
        const tokens = await obtainTokens();

        const result = await callListProjects(tokens.access_token);
        expect(result.structuredContent).toMatchObject({
            projects: [{ id: 'project-alpha', name: 'Name of project-alpha', platforms: ['ios'] }],
        });
    });

    it('a refresh token is never accepted by /mcp', async () => {
        const tokens = await obtainTokens();
        const res = await fetch(resource, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${tokens.refresh_token}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        });
        expect(res.status).toBe(401);
    });

    it('revoking the refresh token at the revocation endpoint cuts off /mcp at once', async () => {
        const tokens = await obtainTokens();
        expect((await callListProjects(tokens.access_token)).isError).toBeFalsy();

        const revoke = await fetch(`${issuer}/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: WEB_CLIENT, token: tokens.refresh_token, token_type_hint: 'refresh_token' }),
        });
        expect(revoke.status).toBe(200);

        const res = await fetch(resource, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${tokens.access_token}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        });
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toContain('resource_metadata="');
    });
});
