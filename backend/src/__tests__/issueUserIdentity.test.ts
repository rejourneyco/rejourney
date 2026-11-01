import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// Sessions the fake database answers from; each select renders its WHERE clause so the
// fake can read the project, session ids and device ids it was asked for.
const { state, fakeDb } = vi.hoisted(() => {
    const state = {
        sessions: [] as Array<{ id: string; projectId: string; userDisplayId?: string | null; deviceId?: string | null; anonymousHash?: string | null; anonymousDisplayId?: string | null; startedAt: number }>,
        queries: [] as Array<{ kind: 'latest' | 'sessions' | 'deviceUsers'; params: unknown[] }>,
        fail: false,
        dialect: undefined as undefined | { sqlToQuery: (query: SQL) => { sql: string; params: unknown[] } },
    };
    const paramsOf = (condition: unknown) => state.dialect!.sqlToQuery(condition as SQL).params;
    const hasUser = (row: { userDisplayId?: string | null }) => Boolean(row.userDisplayId?.trim());
    const latestByDevice = (projectId: string, devices: unknown[]) => {
        const latest = new Map<string, (typeof state.sessions)[number]>();
        for (const row of state.sessions) {
            if (row.projectId !== projectId || !row.deviceId || !devices.includes(row.deviceId) || !hasUser(row)) continue;
            const current = latest.get(row.deviceId);
            if (!current || row.startedAt > current.startedAt) latest.set(row.deviceId, row);
        }
        return latest;
    };
    const fakeDb = {
        select: (fields: Record<string, unknown>) => ({
            from: () => ({
                where: (condition: unknown) => {
                    const params = paramsOf(condition);
                    if ('userId' in fields) {
                        return {
                            orderBy: () => ({
                                limit: async () => {
                                    state.queries.push({ kind: 'latest', params });
                                    if (state.fail) throw new Error('database unavailable');
                                    const row = latestByDevice(params[0] as string, [params[1]]).get(params[1] as string);
                                    return row ? [{ userId: row.userDisplayId }] : [];
                                },
                            }),
                        };
                    }
                    state.queries.push({ kind: 'sessions', params });
                    const [projectId, ...ids] = params;
                    return Promise.resolve(state.sessions.filter((row) => row.projectId === projectId && ids.includes(row.id)));
                },
            }),
        }),
        selectDistinctOn: () => ({
            from: () => ({
                where: (condition: unknown) => ({
                    orderBy: async () => {
                        const params = paramsOf(condition);
                        state.queries.push({ kind: 'deviceUsers', params });
                        const [projectId, ...devices] = params;
                        return [...latestByDevice(projectId as string, devices).values()]
                            .map((row) => ({ device: row.deviceId, userId: row.userDisplayId }));
                    },
                }),
            }),
        }),
    };
    return { state, fakeDb };
});

vi.mock('../db/client.js', async () => ({ ...(await vi.importActual<object>('../db/schema.js')), db: fakeDb }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
    clearIssueDeviceUserCache,
    issueUserIdFromIdentity,
    resolveIssueUserId,
    resolveIssueUserIdsForSessions,
} from '../services/issueTracker.js';

beforeEach(() => {
    state.dialect = new PgDialect();
    state.queries = [];
    state.fail = false;
    state.sessions = [
        // Device A: anonymous first, then signed in as alice.
        { id: 's-a1', projectId: 'p1', deviceId: 'device-a', anonymousHash: 'anon-a', startedAt: 1 },
        { id: 's-a2', projectId: 'p1', deviceId: 'device-a', userDisplayId: 'alice', anonymousHash: 'anon-a', startedAt: 2 },
        // Device B never signs in.
        { id: 's-b1', projectId: 'p1', deviceId: 'device-b', anonymousHash: 'anon-b', startedAt: 3 },
        // Device C has only a display anonymous id.
        { id: 's-c1', projectId: 'p1', deviceId: 'device-c', anonymousDisplayId: 'guest-c', startedAt: 4 },
        // Same device id signed in under another project: never crosses projects.
        { id: 's-x1', projectId: 'p2', deviceId: 'device-b', userDisplayId: 'mallory', startedAt: 5 },
        // Nothing identifies it.
        { id: 's-none', projectId: 'p1', startedAt: 6 },
    ];
    clearIssueDeviceUserCache();
});

describe('resolveIssueUserId', () => {
    it("uses the session's own user id without a lookup", async () => {
        await expect(resolveIssueUserId('p1', { userDisplayId: ' alice ', deviceId: 'device-a' })).resolves.toBe('alice');
        expect(state.queries).toEqual([]);
    });

    it("keys a pre-sign-in session to the user later seen on its device", async () => {
        await expect(resolveIssueUserId('p1', { deviceId: 'device-a', anonymousHash: 'anon-a' })).resolves.toBe('alice');
        expect(state.queries).toEqual([{ kind: 'latest', params: ['p1', 'device-a'] }]);
    });

    it('falls back to anonymous ids, then the device id, within the project', async () => {
        await expect(resolveIssueUserId('p1', { deviceId: 'device-b', anonymousHash: 'anon-b' })).resolves.toBe('anon-b');
        await expect(resolveIssueUserId('p1', { deviceId: 'device-c', anonymousDisplayId: 'guest-c' })).resolves.toBe('guest-c');
        await expect(resolveIssueUserId('p1', { deviceId: 'device-c' })).resolves.toBe('device-c');
        await expect(resolveIssueUserId('p1', {})).resolves.toBeUndefined();
        await expect(resolveIssueUserId('p1', undefined)).resolves.toBeUndefined();
    });

    it('caches the device lookup briefly so loops query once per device', async () => {
        for (let i = 0; i < 5; i++) {
            await expect(resolveIssueUserId('p1', { deviceId: 'device-a' })).resolves.toBe('alice');
            await expect(resolveIssueUserId('p1', { deviceId: 'device-b', anonymousHash: 'anon-b' })).resolves.toBe('anon-b');
        }
        expect(state.queries.map((query) => query.params[1])).toEqual(['device-a', 'device-b']);
    });

    it('falls back without failing ingest when the lookup errors', async () => {
        state.fail = true;
        await expect(resolveIssueUserId('p1', { deviceId: 'device-a', anonymousHash: 'anon-a' })).resolves.toBe('anon-a');
    });
});

describe('issueUserIdFromIdentity', () => {
    it('applies the person key order', () => {
        const session = { userDisplayId: null, deviceId: 'd', anonymousHash: 'h', anonymousDisplayId: 'g' };
        expect(issueUserIdFromIdentity({ ...session, userDisplayId: 'u' }, 'device-user')).toBe('u');
        expect(issueUserIdFromIdentity(session, 'device-user')).toBe('device-user');
        expect(issueUserIdFromIdentity(session, null)).toBe('h');
        expect(issueUserIdFromIdentity({ ...session, anonymousHash: ' ' }, null)).toBe('g');
        expect(issueUserIdFromIdentity({ deviceId: 'd' }, null)).toBe('d');
    });
});

describe('resolveIssueUserIdsForSessions', () => {
    it('keys every session of the project by person in two lookups', async () => {
        const keys = await resolveIssueUserIdsForSessions('p1', ['s-a1', 's-a2', 's-b1', 's-c1', 's-x1', 's-none', 's-a1']);

        expect(Object.fromEntries(keys)).toEqual({
            's-a1': 'alice',
            's-a2': 'alice',
            's-b1': 'anon-b',
            's-c1': 'guest-c',
        });
        expect(state.queries.map((query) => query.kind)).toEqual(['sessions', 'deviceUsers']);
        // Only devices whose sessions lack a user id are looked up.
        expect(state.queries[1].params).toEqual(['p1', 'device-a', 'device-b', 'device-c']);
    });

    it('skips the lookups when there are no sessions', async () => {
        await expect(resolveIssueUserIdsForSessions('p1', [])).resolves.toEqual(new Map());
        expect(state.queries).toEqual([]);
    });
});
