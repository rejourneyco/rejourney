/**
 * Postgres implementations of the sign-in stores.
 *
 *  - `PostgresOAuthStore`: everything `oidc-provider` persists, in
 *    `mcp_oauth_records` (bearer credentials keyed by their SHA-256, see
 *    adapter.ts). Used by the API, which runs the authorization server.
 *  - `PostgresGrantRecordStore`: the Rejourney side of a grant (team and
 *    projects), in `mcp_grants`.
 *  - `createPostgresTokenStore`: the MCP server's token check. One indexed
 *    query joins the access-token record to its grant, so a token whose grant
 *    was revoked, or that expired or was revoked itself, resolves to nothing.
 *
 * Expiry is judged by the database clock, so pods with skewed clocks agree.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { mcpGrants, mcpOAuthRecords } from '../../db/schema.js';
import type { McpGrant, McpTokenStore } from '../auth.js';
import type { McpWriteDb } from '../data/db.js';
import { oauthStorageKey } from './adapter.js';
import type { McpGrantRecord, McpGrantRecordStore } from './grants.js';
import { OAuthRecordConflictError } from './store.js';
import type { OAuthPayload, OAuthStore, OAuthUpsertOptions } from './store.js';

const notExpired = sql`(${mcpOAuthRecords.expiresAt} is null or ${mcpOAuthRecords.expiresAt} > now())`;

function stringOrNull(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function withConsumed(row: { payload: OAuthPayload; consumedAt: Date | null } | undefined): OAuthPayload | undefined {
    if (!row) return undefined;
    return row.consumedAt ? { ...row.payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) } : { ...row.payload };
}

export class PostgresOAuthStore implements OAuthStore {
    constructor(private readonly db: McpWriteDb) {}

    async upsert(model: string, key: string, payload: OAuthPayload, options: OAuthUpsertOptions = {}): Promise<void> {
        const expiresAt = options.expiresInSeconds === undefined
            ? null
            : sql`now() + make_interval(secs => ${Math.max(0, Math.floor(options.expiresInSeconds))})`;
        const values = {
            model,
            key,
            payload,
            grantId: stringOrNull(payload.grantId, 128),
            uid: stringOrNull(payload.uid, 128),
            userCode: stringOrNull(payload.userCode, 128),
            expiresAt: expiresAt as unknown as Date | null,
        };
        const set = {
            payload,
            grantId: values.grantId,
            uid: values.uid,
            userCode: values.userCode,
            expiresAt: values.expiresAt,
            // Re-saving a record (a session, say) never un-consumes it; an
            // insert-only record that had expired starts fresh.
            ...(options.insertOnly ? { consumedAt: null } : {}),
        };
        const rows = await this.db
            .insert(mcpOAuthRecords)
            .values(values)
            .onConflictDoUpdate({
                target: [mcpOAuthRecords.model, mcpOAuthRecords.key],
                set,
                ...(options.insertOnly
                    ? { setWhere: sql`${mcpOAuthRecords.expiresAt} is not null and ${mcpOAuthRecords.expiresAt} <= now()` }
                    : {}),
            })
            .returning({ key: mcpOAuthRecords.key });
        if (options.insertOnly && rows.length === 0) {
            throw new OAuthRecordConflictError(`${model} record already exists`);
        }
    }

    private async findWhere(model: string, where: ReturnType<typeof eq>): Promise<OAuthPayload | undefined> {
        const [row] = await this.db
            .select({ payload: mcpOAuthRecords.payload, consumedAt: mcpOAuthRecords.consumedAt })
            .from(mcpOAuthRecords)
            .where(and(eq(mcpOAuthRecords.model, model), where, notExpired))
            .limit(1);
        return withConsumed(row);
    }

    find(model: string, key: string): Promise<OAuthPayload | undefined> {
        return this.findWhere(model, eq(mcpOAuthRecords.key, key));
    }

    findByUid(model: string, uid: string): Promise<OAuthPayload | undefined> {
        return this.findWhere(model, eq(mcpOAuthRecords.uid, uid));
    }

    findByUserCode(model: string, userCode: string): Promise<OAuthPayload | undefined> {
        return this.findWhere(model, eq(mcpOAuthRecords.userCode, userCode));
    }

    async consume(model: string, key: string): Promise<void> {
        const rows = await this.db
            .update(mcpOAuthRecords)
            .set({ consumedAt: sql`now()` as unknown as Date })
            .where(and(eq(mcpOAuthRecords.model, model), eq(mcpOAuthRecords.key, key), isNull(mcpOAuthRecords.consumedAt), notExpired))
            .returning({ key: mcpOAuthRecords.key });
        if (rows.length === 0) throw new OAuthRecordConflictError(`${model} record not found or already consumed`);
    }

    async destroy(model: string, key: string): Promise<void> {
        await this.db.delete(mcpOAuthRecords).where(and(eq(mcpOAuthRecords.model, model), eq(mcpOAuthRecords.key, key)));
    }

    async revokeByGrantId(model: string, grantId: string): Promise<void> {
        await this.db.delete(mcpOAuthRecords).where(and(eq(mcpOAuthRecords.model, model), eq(mcpOAuthRecords.grantId, grantId)));
    }

    /** Every record of every model that belongs to the grant: tokens, codes, the grant itself. */
    async revokeAllForGrant(grantId: string): Promise<void> {
        await this.db.delete(mcpOAuthRecords).where(eq(mcpOAuthRecords.grantId, grantId));
    }

    /** Removes records past their expiry, at most `limit` per call. Returns how many went. */
    async deleteExpired(limit = 5_000): Promise<number> {
        const result = await this.db.execute(sql`
            with doomed as (
                select model, key from mcp_oauth_records
                where expires_at is not null and expires_at <= now()
                limit ${limit}
            )
            delete from mcp_oauth_records r using doomed
            where r.model = doomed.model and r.key = doomed.key
        `);
        return Number((result as { rowCount?: number }).rowCount ?? 0);
    }
}

export class PostgresGrantRecordStore implements McpGrantRecordStore {
    constructor(private readonly db: McpWriteDb) {}

    async save(record: McpGrantRecord): Promise<void> {
        await this.db
            .insert(mcpGrants)
            .values({
                grantId: record.grantId,
                clientId: record.clientId,
                clientName: record.clientName ? record.clientName.slice(0, 255) : null,
                userId: record.userId,
                teamId: record.teamId,
                projectIds: [...record.projectIds],
                scopes: [...record.scopes],
                createdAt: new Date(record.createdAt),
            })
            .onConflictDoNothing({ target: mcpGrants.grantId });
    }

    async find(grantId: string): Promise<McpGrantRecord | null> {
        const [row] = await this.db
            .select()
            .from(mcpGrants)
            .where(and(eq(mcpGrants.grantId, grantId), isNull(mcpGrants.revokedAt)))
            .limit(1);
        if (!row) return null;
        return {
            grantId: row.grantId,
            clientId: row.clientId,
            clientName: row.clientName ?? undefined,
            userId: row.userId,
            teamId: row.teamId,
            projectIds: row.projectIds,
            scopes: row.scopes,
            createdAt: row.createdAt.getTime(),
        };
    }

    /** Marks the grant revoked; its tokens stop working at the next call. */
    async delete(grantId: string, revokedByUserId?: string): Promise<void> {
        await this.db
            .update(mcpGrants)
            .set({ revokedAt: sql`now()` as unknown as Date, revokedByUserId: revokedByUserId ?? null })
            .where(and(eq(mcpGrants.grantId, grantId), isNull(mcpGrants.revokedAt)));
    }
}

export interface PostgresTokenStoreOptions {
    /** How long a lookup may be reused. Revocation takes effect within this. Default 5 s. */
    cacheMs?: number;
    maxEntries?: number;
    now?: () => number;
}

/**
 * The MCP server's token check. Hash the presented token, look up the
 * access-token record and its live grant in one query.
 */
export function createPostgresTokenStore(db: McpWriteDb, options: PostgresTokenStoreOptions = {}): McpTokenStore {
    const cacheMs = options.cacheMs ?? 5_000;
    const maxEntries = options.maxEntries ?? 10_000;
    const now = options.now ?? Date.now;
    const cache = new Map<string, { at: number; grant: McpGrant | null }>();

    async function load(key: string): Promise<McpGrant | null> {
        const [row] = await db
            .select({
                payload: mcpOAuthRecords.payload,
                grantId: mcpGrants.grantId,
                clientId: mcpGrants.clientId,
                userId: mcpGrants.userId,
                teamId: mcpGrants.teamId,
                projectIds: mcpGrants.projectIds,
                scopes: mcpGrants.scopes,
            })
            .from(mcpOAuthRecords)
            .innerJoin(mcpGrants, and(eq(mcpGrants.grantId, mcpOAuthRecords.grantId), isNull(mcpGrants.revokedAt)))
            .where(and(
                eq(mcpOAuthRecords.model, 'AccessToken'),
                eq(mcpOAuthRecords.key, key),
                isNull(mcpOAuthRecords.consumedAt),
                notExpired,
            ))
            .limit(1);
        if (!row) return null;
        const { accountId, clientId, aud, scope, exp, kind } = row.payload as Record<string, unknown>;
        if (
            kind !== 'AccessToken'
            || accountId !== row.userId
            || clientId !== row.clientId
            || typeof aud !== 'string'
            || typeof exp !== 'number'
            || exp * 1000 <= now()
        ) {
            return null;
        }
        // The token's scopes, never wider than what the grant record holds.
        const granted = new Set(row.scopes);
        const tokenScopes = typeof scope === 'string' ? scope.split(' ').filter((entry) => granted.has(entry)) : [];
        return {
            grantId: row.grantId,
            clientId: row.clientId,
            userId: row.userId,
            teamId: row.teamId,
            projectIds: row.projectIds,
            scopes: tokenScopes,
            resource: aud,
            expiresAt: exp,
        };
    }

    return {
        async findByAccessToken(token: string): Promise<McpGrant | null> {
            const key = oauthStorageKey('AccessToken', token);
            if (cacheMs > 0) {
                const hit = cache.get(key);
                if (hit && now() - hit.at < cacheMs && (!hit.grant || hit.grant.expiresAt * 1000 > now())) return hit.grant;
            }
            const grant = await load(key);
            if (cacheMs > 0) {
                if (cache.size >= maxEntries) cache.clear();
                cache.set(key, { at: now(), grant });
            }
            return grant;
        },
    };
}
