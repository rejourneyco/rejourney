/**
 * Resource-server view of the authorization server's storage.
 *
 * The MCP server validates an access token by reading the token record the
 * authorization server wrote, directly from the shared store. It needs neither
 * `oidc-provider` nor the provider's signing keys, which keeps the `mcp-server`
 * pod minimal.
 */

import type { McpGrant, McpTokenStore } from '../auth.js';
import { oauthStorageKey } from './adapter.js';
import type { McpGrantRecordStore } from './grants.js';
import type { OAuthStore } from './store.js';

export interface StoreBackedTokenStoreOptions {
    store: OAuthStore;
    grants: McpGrantRecordStore;
    now?: () => number;
}

export function createStoreBackedTokenStore(options: StoreBackedTokenStoreOptions): McpTokenStore {
    const now = options.now ?? Date.now;

    return {
        async findByAccessToken(token: string): Promise<McpGrant | null> {
            const payload = await options.store.find('AccessToken', oauthStorageKey('AccessToken', token));
            if (!payload || payload.kind !== 'AccessToken' || payload.consumed) return null;

            const { accountId, clientId, grantId, aud, scope, exp } = payload;
            if (
                typeof accountId !== 'string'
                || typeof clientId !== 'string'
                || typeof grantId !== 'string'
                || typeof aud !== 'string'
                || typeof exp !== 'number'
                || exp * 1000 <= now()
            ) {
                return null;
            }

            // The Rejourney grant record is deleted when the grant is revoked,
            // so a token outliving its grant resolves to nothing.
            const record = await options.grants.find(grantId);
            if (!record || record.userId !== accountId) return null;

            return {
                grantId,
                clientId,
                userId: accountId,
                teamId: record.teamId,
                projectIds: record.projectIds,
                scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
                maskIdentifiers: record.maskIdentifiers === true,
                resource: aud,
                expiresAt: exp,
            };
        },
    };
}
