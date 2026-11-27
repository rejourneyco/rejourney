/**
 * OAuth 2.1 authorization server for MCP, built on `oidc-provider`.
 *
 * Public clients only, PKCE (S256) mandatory, one resource (the MCP endpoint),
 * opaque audience-bound access tokens, rotating refresh tokens with reuse
 * detection. Client registration: static clients, optional RFC 7591 dynamic
 * registration, optional Client ID Metadata Documents (experimental upstream).
 */

import Provider, { errors } from 'oidc-provider';
import type { ClientMetadata, Configuration, JWKS } from 'oidc-provider';
import { MCP_TOKEN_PREFIX } from '../auth.js';
import { createOAuthAdapterFactory } from './adapter.js';
import type { OAuthStore } from './store.js';

/** Refresh tokens get their own prefix so they can never pass the MCP endpoint's `rjm_` gate. */
export const MCP_REFRESH_TOKEN_PREFIX = 'rjmr_';

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const AUTHORIZATION_ROUTE = '/authorize';

/** The experimental CIMD draft this code was written against (`oidc-provider` 9.15.1). */
const CIMD_DRAFT_ACK = 'draft-03';

export interface OAuthProviderOptions {
    /** Issuer identifier. Its path must equal the Express mount path, e.g. `https://api.rejourney.co/oauth`. */
    issuer: string;
    /** The one resource tokens are issued for (RFC 8707), e.g. `https://mcp.rejourney.co/mcp`. */
    resource: string;
    /** Scopes the resource understands. */
    scopes: readonly string[];
    store: OAuthStore;
    /** Signing keys for the provider's cookies. */
    cookieKeys: string[];
    /** Signing keys (private JWKs). Required in production; omitted, the library falls back to a development key. */
    jwks?: JWKS;
    staticClients?: ClientMetadata[];
    /** RFC 7591 dynamic client registration (compatibility path). */
    dynamicRegistration?: boolean;
    /** Client ID Metadata Documents: `client_id` is an HTTPS URL to the client's metadata. */
    clientIdMetadataDocuments?: {
        enabled: boolean;
        /** Gate every fetch (allow-list, SSRF guard, rate limit). */
        allowFetch?: (clientId: string) => boolean | Promise<boolean>;
    };
    /** Outbound fetch used for client metadata documents. Inject a guarded implementation. */
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

type TokenModel = { prototype: { generateTokenId(): string } };

/**
 * `oidc-provider` has no option for a token prefix: an opaque token's value is
 * its generated id. Wrapping the model's `generateTokenId` is the smallest
 * hook that changes the value everywhere (response, storage id, lookups).
 * It is not a documented extension point, so the version is pinned and
 * `mcpOAuthProvider.test.ts` asserts the prefix on every issued token.
 */
function prefixTokenIds(model: unknown, prefix: string): void {
    const { prototype } = model as TokenModel;
    const original = prototype.generateTokenId;
    prototype.generateTokenId = function generatePrefixedTokenId(this: unknown): string {
        return `${prefix}${original.call(this)}`;
    };
}

export function createOAuthProvider(options: OAuthProviderOptions): Provider {
    const mountPath = new URL(options.issuer).pathname.replace(/\/$/, '');
    const resourceScope = options.scopes.join(' ');
    // No ID tokens are issued, but every client still gets a signing algorithm,
    // and it must match the configured key: production uses one EC P-256 key.
    const signingKey = options.jwks?.keys?.[0] as { kty?: string } | undefined;
    const signingAlg = signingKey?.kty === 'EC' ? 'ES256' : 'RS256';

    const configuration: Configuration = {
        adapter: createOAuthAdapterFactory(options.store),
        clients: options.staticClients ?? [],
        clientDefaults: {
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            // `oidc-provider` matches loopback redirect URIs without the port
            // only for `native` clients, and its own default is `web`. MCP
            // clients such as Claude Code publish `http://127.0.0.1/callback`
            // with no `application_type` and listen on a random port, so
            // clients that do not say otherwise are treated as native. Native
            // clients may only use http on loopback hosts and always get the
            // consent prompt.
            application_type: 'native',
            id_token_signed_response_alg: signingAlg,
        },
        responseTypes: ['code'],
        // The resource's scopes are also registered with the authorization
        // server itself: client metadata (`scope`, as sent by the official MCP
        // client during dynamic registration) is validated against this list,
        // and it becomes `scopes_supported` in the server metadata.
        scopes: ['offline_access', ...options.scopes],
        // Every client must use PKCE. `oidc-provider` 9 only implements S256.
        pkce: { required: () => true },
        cookies: { keys: options.cookieKeys },
        jwks: options.jwks,
        routes: {
            authorization: AUTHORIZATION_ROUTE,
            token: '/token',
            registration: '/register',
            revocation: '/revoke',
            jwks: '/jwks',
        },
        ttl: {
            AccessToken: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            AuthorizationCode: 60,
            RefreshToken: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
            Grant: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
            Interaction: 10 * 60,
            // The dashboard session is the real login; keep the provider's own short.
            Session: 10 * 60,
        },
        // Rotate on every use. A consumed refresh token presented again fails
        // and the whole grant is revoked (default `revokeGrantPolicy`).
        rotateRefreshToken: true,
        // MCP clients rarely ask for `offline_access`; issue a refresh token
        // to any client registered for the refresh_token grant.
        issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed('refresh_token'),
        interactions: {
            // Handled by `createOAuthRouter`; the interaction cookie is scoped to this path.
            url: (_ctx, interaction) => `${mountPath}/interaction/${interaction.uid}`,
        },
        findAccount: async (_ctx, sub) => ({ accountId: sub, claims: async () => ({ sub }) }),
        fetch: options.fetch,
        features: {
            devInteractions: { enabled: false },
            userinfo: { enabled: false },
            revocation: { enabled: true },
            resourceIndicators: {
                enabled: true,
                // Clients that omit `resource` (pre-2025-06 MCP clients) still get a token for the MCP endpoint.
                defaultResource: () => options.resource,
                useGrantedResource: () => true,
                getResourceServerInfo: (_ctx, resourceIndicator) => {
                    if (resourceIndicator !== options.resource) {
                        throw new errors.InvalidTarget();
                    }
                    return {
                        scope: resourceScope,
                        audience: options.resource,
                        accessTokenFormat: 'opaque',
                        accessTokenTTL: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
                    };
                },
            },
            registration: {
                enabled: options.dynamicRegistration === true,
                initialAccessToken: false,
                // No RFC 7592 management, so no long-lived registration token to store.
                issueRegistrationAccessToken: false,
            },
            clientIdMetadataDocument: {
                enabled: options.clientIdMetadataDocuments?.enabled === true,
                ack: CIMD_DRAFT_ACK,
                allowFetch: async (_ctx, clientId) => (await options.clientIdMetadataDocuments?.allowFetch?.(clientId)) ?? true,
            },
        },
    };

    const provider = new Provider(options.issuer, configuration);

    // An authorization request with no `scope` would otherwise end in
    // `access_denied` after consent ("no scope was granted"). Treat it as a
    // request for everything the resource offers; consent decides what is granted.
    provider.use(async (ctx, next) => {
        if (ctx.method === 'GET' && ctx.path === AUTHORIZATION_ROUTE && !ctx.query.scope) {
            ctx.query = { ...ctx.query, scope: resourceScope };
        }
        await next();
    });

    prefixTokenIds(provider.AccessToken, MCP_TOKEN_PREFIX);
    prefixTokenIds(provider.RefreshToken, MCP_REFRESH_TOKEN_PREFIX);
    return provider;
}
