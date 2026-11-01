import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ results: [] as unknown[][] }));

// Every select chain resolves to the next queued result, whatever builder methods it uses.
vi.mock('../db/client.js', () => {
    const chain = (): any => {
        const result = mocks.results.shift() ?? [];
        const builder: any = new Proxy({}, {
            get: (_target, prop) => (prop === 'then'
                ? (resolve: (value: unknown) => void) => resolve(result)
                : () => builder),
        });
        return builder;
    };
    return { db: { select: vi.fn(chain) }, anrs: {}, projects: {}, teamMembers: {}, sessions: {} };
});
vi.mock('drizzle-orm', () => ({
    and: vi.fn(), desc: vi.fn(), eq: vi.fn(), gte: vi.fn(), inArray: vi.fn(),
    sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn() }),
}));

import anrRoutes from '../routes/anrs.js';

type RouteStack = { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> };

async function listAnrs(): Promise<any> {
    const layer = (anrRoutes as unknown as RouteStack).stack.find((candidate) => candidate.route?.path === '/projects/:projectId/anrs');
    const handler = layer!.route!.stack[layer!.route!.stack.length - 1].handle;
    return new Promise((resolve, reject) => {
        handler({ params: { projectId: 'p1' }, query: { timeRange: '30d' }, user: { id: 'u1' } }, { json: resolve }, reject);
    });
}

function anrRow(id: string, sessionId: string, threadState: string, identity: Record<string, unknown>) {
    return {
        anr: {
            id, sessionId, projectId: 'p1', timestamp: new Date('2026-10-30T10:00:00Z'), durationMs: 5000,
            threadState, deviceMetadata: null, status: 'open', occurrenceCount: 1,
        },
        replayAvailable: false,
        ...identity,
    };
}

describe('ANR list user counts', () => {
    beforeEach(() => {
        mocks.results = [];
    });

    it('counts a person once per group and once across groups', async () => {
        mocks.results.push(
            [{ id: 'p1', teamId: 't1' }],
            [{ id: 'm1' }],
            [
                anrRow('a1', 's1', 'main\n  at Slow.run', { deviceId: 'dev-a', startedAt: new Date('2026-10-30T08:00:00Z') }),
                anrRow('a2', 's2', 'main\n  at Slow.run', { deviceId: 'dev-a', userDisplayId: 'alice', startedAt: new Date('2026-10-30T09:00:00Z') }),
                anrRow('a3', 's2', 'main\n  at Other.wait', { deviceId: 'dev-a', userDisplayId: 'alice', startedAt: new Date('2026-10-30T09:00:00Z') }),
                anrRow('a4', 's3', 'main\n  at Other.wait', { deviceId: 'dev-b' }),
            ],
        );

        const body = await listAnrs();

        expect(body.anrs.map((anr: { userCount: number }) => anr.userCount).sort()).toEqual([1, 2]);
        // Summing userCount would give 3; alice is in both groups.
        expect(body.totalUsers).toBe(2);
    });
});
