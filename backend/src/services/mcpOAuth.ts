/**
 * The OAuth authorization server for MCP, as the main API runs it.
 *
 * Built once per process from the environment, only when `MCP_ENABLED=true`:
 *
 *   MCP_PUBLIC_URL                   the MCP endpoint, the one resource tokens are for
 *   MCP_AUTHORIZATION_SERVER_ISSUER  e.g. https://api.rejourney.co/oauth (its path is the mount point)
 *   MCP_OAUTH_COOKIE_KEYS            comma-separated keys for the provider's cookies
 *   MCP_OAUTH_JWKS                   {"keys":[...private JWK...]}; required in production
 *   MCP_ALLOWED_CLIENT_IDS           client metadata document URLs allowed to sign in;
 *                                    default: Claude Code's
 *   MCP_DYNAMIC_REGISTRATION         "true" to also allow RFC 7591 registration (off by default)
 *
 * Only Claude Code is supported, so by default the only client that can sign
 * in is the one whose metadata document Claude Code publishes, and nothing
 * else is ever fetched.
 */

import type { JWKS } from 'oidc-provider';
import { db } from '../db/client.js';
import { logger } from '../logger.js';
import { PostgresGrantRecordStore, PostgresOAuthStore } from '../mcp/oauth/pgStore.js';
import { createOAuthProvider } from '../mcp/oauth/provider.js';
import { MCP_SCOPES } from '../mcp/router.js';

export const CLAUDE_CODE_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';

export interface McpApiConfig {
    issuer: string;
    resource: string;
    dashboardBaseUrl: string;
    cookieKeys: string[];
    jwks?: JWKS;
    allowedClientIds: string[];
    dynamicRegistration: boolean;
}

export function readMcpApiConfig(env: NodeJS.ProcessEnv = process.env): McpApiConfig | null {
    if (env.MCP_ENABLED !== 'true') return null;
    const issuer = env.MCP_AUTHORIZATION_SERVER_ISSUER;
    const resource = env.MCP_PUBLIC_URL;
    const dashboardBaseUrl = (env.PUBLIC_DASHBOARD_URL ?? '').split(',')[0]?.trim();
    const cookieKeys = (env.MCP_OAUTH_COOKIE_KEYS ?? '').split(',').map((key) => key.trim()).filter((key) => key.length >= 32);
    if (!issuer || !resource || !dashboardBaseUrl || cookieKeys.length === 0) {
        logger.error('MCP_ENABLED is true but MCP_AUTHORIZATION_SERVER_ISSUER, MCP_PUBLIC_URL, PUBLIC_DASHBOARD_URL or MCP_OAUTH_COOKIE_KEYS is missing; MCP sign-in stays off');
        return null;
    }
    let jwks: JWKS | undefined;
    if (env.MCP_OAUTH_JWKS) {
        try {
            jwks = JSON.parse(env.MCP_OAUTH_JWKS) as JWKS;
        } catch {
            logger.error('MCP_OAUTH_JWKS is not valid JSON; MCP sign-in stays off');
            return null;
        }
    } else if (env.NODE_ENV === 'production') {
        logger.error('MCP_OAUTH_JWKS is required in production; MCP sign-in stays off');
        return null;
    }
    const allowed = (env.MCP_ALLOWED_CLIENT_IDS ?? CLAUDE_CODE_CLIENT_ID).split(',').map((id) => id.trim()).filter(Boolean);
    return {
        issuer: issuer.replace(/\/$/, ''),
        resource,
        dashboardBaseUrl: dashboardBaseUrl.replace(/\/$/, ''),
        cookieKeys,
        jwks,
        allowedClientIds: allowed,
        dynamicRegistration: env.MCP_DYNAMIC_REGISTRATION === 'true',
    };
}

/**
 * Fetch for client metadata documents: only allow-listed HTTPS URLs, no
 * redirects, 5 s, 64 KB. Anything else is refused before a socket opens.
 */
export function createMetadataFetch(allowedClientIds: readonly string[]) {
    const allowed = new Set(allowedClientIds);
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input instanceof Request ? input.url : input);
        if (!allowed.has(url) || !url.startsWith('https://')) {
            return new Response('not allowed', { status: 403 });
        }
        const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5_000) });
        const body = await response.arrayBuffer();
        if (body.byteLength > 64 * 1024) return new Response('too large', { status: 502 });
        return new Response(body, { status: response.status, headers: response.headers });
    };
}

export interface McpOAuth {
    config: McpApiConfig;
    provider: ReturnType<typeof createOAuthProvider>;
    store: PostgresOAuthStore;
    grants: PostgresGrantRecordStore;
}

let instance: McpOAuth | null | undefined;

/** The process's authorization server, or null when MCP is off or misconfigured. */
export function getMcpOAuth(): McpOAuth | null {
    if (instance !== undefined) return instance;
    const config = readMcpApiConfig();
    if (!config) {
        instance = null;
        return instance;
    }
    const store = new PostgresOAuthStore(db);
    const grants = new PostgresGrantRecordStore(db);
    const provider = createOAuthProvider({
        issuer: config.issuer,
        resource: config.resource,
        scopes: MCP_SCOPES,
        store,
        cookieKeys: config.cookieKeys,
        jwks: config.jwks,
        dynamicRegistration: config.dynamicRegistration,
        clientIdMetadataDocuments: {
            enabled: true,
            allowFetch: (clientId) => config.allowedClientIds.includes(clientId),
        },
        fetch: createMetadataFetch(config.allowedClientIds),
    });
    // Behind Traefik and Cloudflare: trust X-Forwarded-Proto so issued URLs are https.
    provider.proxy = true;
    instance = { config, provider, store, grants };
    return instance;
}

/** Tests only. */
export function resetMcpOAuthForTests(next?: McpOAuth | null): void {
    instance = next === undefined ? undefined : next;
}
