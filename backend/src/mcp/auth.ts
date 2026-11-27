/**
 * MCP bearer-token verification (resource-server side).
 *
 * The MCP endpoint accepts ONLY `rjm_`-prefixed access tokens looked up through
 * an injectable store. Dashboard session tokens (which `sessionAuth` accepts as
 * `Authorization: Bearer <token>`) never reach the store, and cookies are never
 * read. HTTP handling (401 + `WWW-Authenticate` challenge) is done by the SDK's
 * `requireBearerAuth`; this module only supplies its `OAuthTokenVerifier`.
 */

import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';

export const MCP_TOKEN_PREFIX = 'rjm_';

/** What an access token resolves to. One grant = user + team + project list + scopes. */
export interface McpGrant {
    grantId: string;
    clientId: string;
    userId: string;
    teamId: string;
    /** Project ids this connection may read. */
    projectIds: string[];
    scopes: string[];
    /**
     * Team switch "mask end-user identifiers": emails, user ids and city-level
     * location are removed from every result. Absent means off.
     */
    maskIdentifiers?: boolean;
    /** RFC 8707 resource the token was issued for. */
    resource: string;
    /** Seconds since epoch. */
    expiresAt: number;
}

/**
 * Token lookup seam. Production: SHA-256 hash lookup in Postgres/Redis.
 * Tests: an in-memory map. Must return null for unknown or revoked tokens.
 */
export interface McpTokenStore {
    findByAccessToken(token: string): Promise<McpGrant | null>;
}

const INVALID_TOKEN_MESSAGE = 'Invalid access token';

export function createMcpTokenVerifier(store: McpTokenStore): OAuthTokenVerifier {
    return {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
            // Prefix gate first: anything that is not an MCP token (dashboard
            // session tokens included) is refused without touching the store.
            if (!token.startsWith(MCP_TOKEN_PREFIX)) {
                throw new OAuthError(OAuthErrorCode.InvalidToken, INVALID_TOKEN_MESSAGE);
            }

            const grant = await store.findByAccessToken(token);
            if (!grant) {
                throw new OAuthError(OAuthErrorCode.InvalidToken, INVALID_TOKEN_MESSAGE);
            }

            return {
                token,
                clientId: grant.clientId,
                scopes: grant.scopes,
                expiresAt: grant.expiresAt,
                resource: new URL(grant.resource),
                extra: { grant },
            };
        },
    };
}

/** Reads the grant that `createMcpTokenVerifier` attached to the SDK's AuthInfo. */
export function grantFromAuthInfo(authInfo: AuthInfo | undefined): McpGrant | null {
    const grant = authInfo?.extra?.grant;
    if (!grant || typeof grant !== 'object') return null;
    return grant as McpGrant;
}
