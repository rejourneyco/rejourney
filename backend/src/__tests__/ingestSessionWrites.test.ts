import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ensureIngestSession write shaping: the no-op metadata guard, RETURNING in
 * place of the follow-up SELECT, the user-display-id write, and the
 * once-per-session geo lookup. Statements are rendered by the real drizzle
 * query builder, so the asserted SQL is what Postgres receives.
 */

const state = vi.hoisted(() => ({
    statements: [] as Array<{ sql: string; params: unknown[] }>,
    updateReturning: [] as any[][],
    selectResults: [] as any[][],
    selectCount: 0,
    lookupGeoIp: null as any,
    setIngestSessionCache: null as any,
    setSessionExistsCache: null as any,
    requestIp: '8.8.8.8' as string | null,
}));

vi.mock('../db/client.js', async () => {
    const schema = await import('../db/schema.js');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const builder = drizzle.mock();
    const db = {
        update: (table: any) => ({
            set: (payload: Record<string, unknown>) => ({
                where: (condition: any) => {
                    const base = builder.update(table).set(payload as any).where(condition);
                    const record = (query: { sql: string; params: unknown[] }) => {
                        state.statements.push({ sql: query.sql, params: query.params });
                    };
                    return {
                        returning: async (selection: any) => {
                            record(base.returning(selection).toSQL());
                            return state.updateReturning.shift() ?? [];
                        },
                        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
                            try {
                                record(base.toSQL());
                                return Promise.resolve(undefined).then(resolve, reject);
                            } catch (err) {
                                return Promise.reject(err).then(resolve, reject);
                            }
                        },
                    };
                },
            }),
        }),
        select: () => {
            state.selectCount += 1;
            const chain: any = {};
            chain.from = () => chain;
            chain.innerJoin = () => chain;
            chain.leftJoin = () => chain;
            chain.where = () => chain;
            chain.limit = async () => state.selectResults.shift() ?? [];
            return chain;
        },
        insert: () => {
            throw new Error('insert not expected in these tests');
        },
    };
    return { ...schema, db, dbRead: db, pool: {} };
});

vi.mock('../db/redis.js', () => {
    state.setIngestSessionCache = vi.fn(async () => undefined);
    state.setSessionExistsCache = vi.fn(async () => undefined);
    return {
        setIngestSessionCache: state.setIngestSessionCache,
        setSessionExistsCache: state.setSessionExistsCache,
    };
});

vi.mock('../middleware/index.js', () => ({
    ApiError: class ApiError extends Error {
        static conflict(message: string) { return new ApiError(message); }
        static internal(message: string) { return new ApiError(message); }
    },
}));

vi.mock('../utils/requestIp.js', () => ({
    getRequestIp: () => state.requestIp,
}));

vi.mock('../logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/recording.js', () => {
    state.lookupGeoIp = vi.fn(async () => undefined);
    return { lookupGeoIp: state.lookupGeoIp };
});

vi.mock('../services/visitorLedger.js', () => ({
    assignSessionVisitorForRow: vi.fn(async () => null),
    isVisitorLedgerWriteEnabled: vi.fn(() => false),
}));

import {
    buildEnsureSessionUpdateCondition,
    buildSessionMetadataPatch,
    ensureIngestSession,
    ingestSessionSelection,
    sessionHasGeo,
    setSessionUserDisplayIdIfChanged,
} from '../services/ingestSessionLifecycle.js';

const PROJECT_ID = '00000000-0000-4000-8000-0000000000c1';
const SESSION_ID = `session_${Date.now() - 30_000}_abc`;

function cachedSession(overrides: Record<string, unknown> = {}) {
    return {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        platform: 'ios',
        deviceModel: 'iPhone15,2',
        osVersion: '17.4',
        appVersion: '1.2.3',
        sdkVersion: '1.5.1',
        deviceId: 'device-1',
        userDisplayId: null,
        anonymousDisplayId: null,
        isSampledIn: true,
        observeOnly: false,
        replayQuotaBillingExhausted: false,
        startedAt: new Date(Date.now() - 30_000),
        metadata: { sdkVersion: '1.5.1', appVersion: '1.2.3', customKey: 'kept' },
        geoCountryCode: null,
        visitorSessionOrdinal: 1,
        __ingestSessionCacheHit: true,
        ...overrides,
    };
}

const request = (headers: Record<string, string> = {}) => ({ headers });

describe('ensureIngestSession metadata writes', () => {
    beforeEach(() => {
        state.statements.length = 0;
        state.updateReturning.length = 0;
        state.selectResults.length = 0;
        state.selectCount = 0;
        state.requestIp = '8.8.8.8';
        state.lookupGeoIp.mockClear();
        state.setIngestSessionCache.mockClear();
        state.setSessionExistsCache.mockClear();
    });

    it('issues no statement and no SELECT when the request repeats stored metadata', async () => {
        const session = cachedSession();

        const result = await ensureIngestSession(
            PROJECT_ID, SESSION_ID, request(), { sdkVersion: '1.5.1', appVersion: '1.2.3' }, undefined, session,
        );

        expect(state.statements).toEqual([]);
        expect(state.selectCount).toBe(0);
        expect(result).toEqual({ session, created: false });
        expect(state.setIngestSessionCache).not.toHaveBeenCalled();
    });

    it('guards a metadata-only merge with containment and takes the fresh row from RETURNING', async () => {
        const session = cachedSession();
        const fresh = { ...cachedSession({ __ingestSessionCacheHit: undefined }), metadata: { sdkVersion: '1.5.2', appVersion: '1.2.3', customKey: 'kept', networkType: 'wifi' } };
        state.updateReturning.push([fresh]);

        const result = await ensureIngestSession(
            PROJECT_ID, SESSION_ID, request(), { sdkVersion: '1.5.2', networkType: 'wifi', appVersion: '1.2.3' }, undefined, session,
        );

        expect(state.statements).toHaveLength(1);
        const [statement] = state.statements;
        expect(statement.sql.startsWith(
            'update "sessions" set "metadata" = "sessions"."metadata" || $1::jsonb '
            + 'where "sessions"."id" = $2 AND NOT ("sessions"."metadata" @> $3::jsonb) returning ',
        )).toBe(true);
        const patch = JSON.stringify({ networkType: 'wifi', sdkVersion: '1.5.2' });
        expect(statement.params).toEqual([patch, SESSION_ID, patch]);
        // RETURNING projects exactly the ingest hot-path columns, so no re-SELECT is needed.
        const returned = statement.sql.slice(statement.sql.indexOf(' returning ') + ' returning '.length);
        expect(returned.split(', ')).toHaveLength(Object.keys(ingestSessionSelection).length);
        expect(returned).toContain('"metadata"');
        expect(returned).not.toContain('"events"');
        expect(state.selectCount).toBe(0);

        expect(result.session).toBe(fresh);
        expect(result.created).toBe(false);
        expect(state.setIngestSessionCache).toHaveBeenCalledWith(PROJECT_ID, fresh);
    });

    it('treats zero returned rows as "already stored": no SELECT, no cache refresh, merged local copy', async () => {
        const session = cachedSession();
        state.updateReturning.push([]);

        const result = await ensureIngestSession(
            PROJECT_ID, SESSION_ID, request(), { sdkVersion: '1.5.2' }, undefined, session,
        );

        expect(state.statements).toHaveLength(1);
        expect(state.selectCount).toBe(0);
        expect(result.created).toBe(false);
        expect(result.session.metadata).toEqual({ sdkVersion: '1.5.2', appVersion: '1.2.3', customKey: 'kept' });
        expect(result.session.id).toBe(SESSION_ID);
        // The stale cached copy is not re-cached, so its TTL is not extended.
        expect(state.setIngestSessionCache).not.toHaveBeenCalled();
        // The caller's object is not mutated.
        expect(session.metadata).toEqual({ sdkVersion: '1.5.1', appVersion: '1.2.3', customKey: 'kept' });
    });

    it('is idempotent: a repeat call with the returned row sends nothing', async () => {
        const fresh = cachedSession({ metadata: { sdkVersion: '1.5.2', appVersion: '1.2.3' } });
        state.updateReturning.push([fresh]);

        const first = await ensureIngestSession(
            PROJECT_ID, SESSION_ID, request(), { sdkVersion: '1.5.2' }, undefined, cachedSession(),
        );
        const second = await ensureIngestSession(
            PROJECT_ID, SESSION_ID, request(), { sdkVersion: '1.5.2' }, undefined, first.session,
        );

        expect(state.statements).toHaveLength(1);
        expect(second.session).toBe(first.session);
    });

    it('writes unconditionally (still with RETURNING) when a column changes alongside metadata', async () => {
        const session = cachedSession({ appVersion: null, metadata: {} });
        const fresh = cachedSession({ metadata: { appVersion: '1.2.3' } });
        state.updateReturning.push([fresh]);

        const result = await ensureIngestSession(
            PROJECT_ID, SESSION_ID, request(), { appVersion: '1.2.3' }, undefined, session,
        );

        expect(state.statements).toHaveLength(1);
        expect(state.statements[0].sql.startsWith(
            'update "sessions" set "app_version" = $1, "metadata" = "sessions"."metadata" || $2::jsonb '
            + 'where "sessions"."id" = $3 returning ',
        )).toBe(true);
        expect(state.statements[0].params).toEqual(['1.2.3', JSON.stringify({ appVersion: '1.2.3' }), SESSION_ID]);
        expect(state.selectCount).toBe(0);
        expect(result.session).toBe(fresh);
    });

    it('only builds the containment guard for a non-empty, metadata-only write', () => {
        const render = (condition: any) => condition?.queryChunks ? 'sql' : 'eq';
        // Flat scalars only: `||` then equals a no-op exactly when `@>` holds.
        const patch = buildSessionMetadataPatch({ metadata: { browser: 'Chrome' } }, {
            browser: 'Firefox',
            connectionSaveData: false,
        });
        expect(patch).toEqual({ browser: 'Firefox', connectionSaveData: false });
        expect(Object.values(patch).every((value) => typeof value === 'string' || typeof value === 'boolean')).toBe(true);

        expect(render(buildEnsureSessionUpdateCondition('s', { metadata: {} }, patch))).toBe('sql');
        expect(buildEnsureSessionUpdateCondition('s', { metadata: {} }, {}))
            .toEqual(buildEnsureSessionUpdateCondition('s', { platform: 'ios' }, {}));
        expect(buildEnsureSessionUpdateCondition('s', { metadata: {}, platform: 'ios' }, patch))
            .toEqual(buildEnsureSessionUpdateCondition('s', { platform: 'ios' }, {}));
    });
});

describe('batch-complete user display id', () => {
    beforeEach(() => {
        state.statements.length = 0;
    });

    it('sends nothing when the stored id already matches', async () => {
        await expect(setSessionUserDisplayIdIfChanged({ id: SESSION_ID, userDisplayId: 'user-1' }, 'user-1')).resolves.toBe(false);
        expect(state.statements).toEqual([]);
    });

    it('writes a new or changed id with an IS DISTINCT FROM row filter', async () => {
        const now = new Date('2026-11-27T12:00:00.000Z');

        await expect(setSessionUserDisplayIdIfChanged({ id: SESSION_ID, userDisplayId: null }, 'user-1', now)).resolves.toBe(true);
        await expect(setSessionUserDisplayIdIfChanged({ id: SESSION_ID, userDisplayId: 'user-0' }, 'user-1', now)).resolves.toBe(true);

        expect(state.statements).toHaveLength(2);
        expect(state.statements[0]).toEqual({
            sql: 'update "sessions" set "user_display_id" = $1, "updated_at" = $2 '
                + 'where "sessions"."id" = $3 AND "sessions"."user_display_id" IS DISTINCT FROM $4',
            params: ['user-1', '2026-11-27T12:00:00.000Z', SESSION_ID, 'user-1'],
        });
        expect(state.statements[1]).toEqual(state.statements[0]);
    });
});

describe('geo lookup once per session', () => {
    beforeEach(() => {
        state.statements.length = 0;
        state.selectCount = 0;
        state.requestIp = '8.8.8.8';
        state.lookupGeoIp.mockClear();
    });

    it('loads the geo marker with the existing hot-path projection instead of a new query', () => {
        expect(ingestSessionSelection).toHaveProperty('geoCountryCode');
        expect(ingestSessionSelection).not.toHaveProperty('events');
    });

    it('recognises a stored country as "geo resolved"', () => {
        expect(sessionHasGeo({ geoCountryCode: 'US' })).toBe(true);
        expect(sessionHasGeo({ geoCountryCode: 'PS/IL' })).toBe(true);
        expect(sessionHasGeo({ geoCountryCode: null })).toBe(false);
        expect(sessionHasGeo({ geoCountryCode: '' })).toBe(false);
        // Rows cached before this field existed behave as "not resolved yet".
        expect(sessionHasGeo({})).toBe(false);
        expect(sessionHasGeo(null)).toBe(false);
    });

    it('runs the lookup while the session has no geo', async () => {
        await ensureIngestSession(PROJECT_ID, SESSION_ID, request(), undefined, undefined, cachedSession());

        expect(state.lookupGeoIp).toHaveBeenCalledTimes(1);
        expect(state.lookupGeoIp).toHaveBeenCalledWith(SESSION_ID, '8.8.8.8');
        expect(state.selectCount).toBe(0);
    });

    it('skips the lookup for every later request once geo is stored, even from a new IP', async () => {
        const session = cachedSession({ geoCountryCode: 'US' });

        await ensureIngestSession(PROJECT_ID, SESSION_ID, request(), undefined, undefined, session);
        state.requestIp = '1.1.1.1';
        await ensureIngestSession(PROJECT_ID, SESSION_ID, request(), undefined, undefined, session);

        expect(state.lookupGeoIp).not.toHaveBeenCalled();
        expect(state.selectCount).toBe(0);
    });

    it('still honours the SDK geo opt-out and requests without a client IP', async () => {
        await ensureIngestSession(PROJECT_ID, SESSION_ID, request({ 'x-rj-no-geo': '1' }), undefined, undefined, cachedSession());
        state.requestIp = null;
        await ensureIngestSession(PROJECT_ID, SESSION_ID, request(), undefined, undefined, cachedSession());

        expect(state.lookupGeoIp).not.toHaveBeenCalled();
    });
});
