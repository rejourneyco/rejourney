import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    selectResults: [] as unknown[][],
    redisGet: vi.fn(async (_key: string): Promise<string | null> => null),
    redisSetex: vi.fn(async (_key: string, _ttl: number, _value: string) => 'OK'),
    redisDel: vi.fn(async (..._keys: string[]) => 1),
}));

function queryBuilder(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy']) {
        builder[method] = () => builder;
    }
    builder.limit = async () => rows;
    builder.then = (resolve: (value: unknown[]) => unknown, reject: (err: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
    return builder;
}

vi.mock('../db/client.js', () => ({
    db: {
        select: vi.fn(() => queryBuilder(mocks.selectResults.shift() ?? [])),
    },
    userSessions: { token: 'token', userId: 'userId' },
    users: { id: 'id' },
    apiKeys: {},
    projects: {},
    teams: { id: 'id', ownerUserId: 'ownerUserId' },
    teamMembers: { teamId: 'teamId', userId: 'userId' },
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ get: mocks.redisGet, setex: mocks.redisSetex, del: mocks.redisDel }),
}));

vi.mock('../logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireTeamOwner, sessionAuth } from '../middleware/auth.js';
import {
    SESSION_AUTH_CACHE_MAX_TTL_SECONDS,
    evictSessionAuthCache,
    sessionAuthCacheKey,
    sessionAuthCacheTtlSeconds,
} from '../services/sessionAuthCache.js';

function createResponse() {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response & typeof res;
}

async function runOwnerCheck(userId: string) {
    const req = { params: { teamId: 'team-1' }, body: {}, user: { id: userId, email: 'x@example.com', roles: [] } } as unknown as Request;
    const res = createResponse();
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    await requireTeamOwner(req, res, next);
    return { res, next };
}

describe('requireTeamOwner', () => {
    beforeEach(() => {
        mocks.selectResults = [];
        vi.clearAllMocks();
    });

    it('allows the team\'s recorded owner', async () => {
        mocks.selectResults.push([{ role: 'owner' }], [{ ownerUserId: 'owner-user' }]);
        const { next, res } = await runOwnerCheck('owner-user');
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects a member whose membership row says owner but who is not the recorded owner', async () => {
        mocks.selectResults.push([{ role: 'owner' }], [{ ownerUserId: 'owner-user' }]);
        const { next, res } = await runOwnerCheck('escalated-admin');
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects admins and non-members', async () => {
        mocks.selectResults.push([{ role: 'admin' }], [{ ownerUserId: 'owner-user' }]);
        expect((await runOwnerCheck('admin-user')).res.status).toHaveBeenCalledWith(403);

        mocks.selectResults.push([]);
        expect((await runOwnerCheck('stranger')).res.status).toHaveBeenCalledWith(403);
    });
});

describe('session auth cache', () => {
    beforeEach(() => {
        mocks.selectResults = [];
        vi.clearAllMocks();
    });

    it('caps how long a session lookup is cached', () => {
        const now = Date.parse('2026-10-01T00:00:00.000Z');
        expect(sessionAuthCacheTtlSeconds(new Date(now + 30 * 24 * 3600 * 1000), now)).toBe(SESSION_AUTH_CACHE_MAX_TTL_SECONDS);
        expect(sessionAuthCacheTtlSeconds(new Date(now + 60 * 1000), now)).toBe(60);
        expect(sessionAuthCacheTtlSeconds(new Date(now - 1000), now)).toBeLessThanOrEqual(0);
    });

    it('caches DB lookups under the key logout evicts, with the capped TTL', async () => {
        mocks.selectResults.push([{
            session: { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
            user: { id: 'user-1', email: 'u@example.com', displayName: null, roles: [] },
        }]);
        const req = { cookies: { session: 'tok-123' }, headers: {} } as unknown as Request;
        const res = createResponse();
        const next = vi.fn();
        await sessionAuth(req, res, next as unknown as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
        expect(mocks.redisSetex).toHaveBeenCalledWith(sessionAuthCacheKey('tok-123'), SESSION_AUTH_CACHE_MAX_TTL_SECONDS, expect.any(String));
    });

    it('evicting a token removes the cached lookup so the session stops authenticating', async () => {
        const cache = new Map<string, string>();
        mocks.redisGet.mockImplementation(async (key: string) => cache.get(key) ?? null);
        mocks.redisDel.mockImplementation(async (...keys: string[]) => {
            keys.forEach((key) => cache.delete(key));
            return keys.length;
        });
        cache.set(sessionAuthCacheKey('tok-123'), JSON.stringify({
            userId: 'user-1',
            email: 'u@example.com',
            roles: [],
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }));

        await evictSessionAuthCache('tok-123');
        expect(mocks.redisDel).toHaveBeenCalledWith('session:tok-123');

        // The DB row was deleted by logout, so the fallback lookup finds nothing.
        mocks.selectResults.push([]);
        const req = { cookies: { session: 'tok-123' }, headers: {} } as unknown as Request;
        const res = createResponse();
        const next = vi.fn();
        await sessionAuth(req, res, next as unknown as NextFunction);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('ignores empty token lists and survives Redis failures', async () => {
        await evictSessionAuthCache([]);
        expect(mocks.redisDel).not.toHaveBeenCalled();
        mocks.redisDel.mockRejectedValueOnce(new Error('redis down'));
        await expect(evictSessionAuthCache(['a', 'b'])).resolves.toBeUndefined();
        expect(mocks.redisDel).toHaveBeenCalledWith('session:a', 'session:b');
    });
});
