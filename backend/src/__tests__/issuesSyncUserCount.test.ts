import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, passthrough } = vi.hoisted(() => ({
    passthrough: (_req: unknown, _res: unknown, next: () => void) => next(),
    mocks: {
        rowsByTable: new Map<unknown, unknown[]>(),
        updates: [] as Array<Record<string, any>>,
        inserted: [] as Array<Record<string, any>>,
        personIds: new Map<string, string>(),
        resolvedSessions: [] as string[][],
    },
}));

vi.mock('../db/client.js', async () => {
    const schema = await vi.importActual<Record<string, unknown>>('../db/schema.js');
    // Every select chain resolves to the rows registered for the table it reads.
    const chain = (rows: () => unknown[]): any => new Proxy({}, {
        get: (_target, prop) => {
            if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(rows());
            return () => chain(rows);
        },
    });
    return {
        ...schema,
        db: {
            select: () => ({ from: (table: unknown) => chain(() => mocks.rowsByTable.get(table) ?? []) }),
            selectDistinct: () => ({ from: () => chain(() => []) }),
            update: () => ({
                set: (values: Record<string, any>) => {
                    mocks.updates.push(values);
                    return chain(() => []);
                },
            }),
            insert: () => ({ values: () => chain(() => []) }),
        },
    };
});
vi.mock('../middleware/index.js', () => ({
    sessionAuth: passthrough,
    asyncHandler: (fn: unknown) => fn,
    ApiError: class ApiError extends Error {
        static badRequest(message: string) { return new this(message); }
        static notFound(message: string) { return new this(message); }
        static forbidden(message: string) { return new this(message); }
    },
}));
vi.mock('../middleware/rateLimit.js', () => ({ writeApiRateLimiter: passthrough }));
vi.mock('../services/issueTracker.js', async () => ({
    ...(await vi.importActual<object>('../services/issueTracker.js')),
    insertIssueWithShortId: vi.fn(async (values: Record<string, any>) => {
        mocks.inserted.push(values);
        return { id: `issue-${mocks.inserted.length}`, shortId: `APP-${mocks.inserted.length}` };
    }),
    resolveIssueUserIdsForSessions: vi.fn(async (_projectId: string, sessionIds: string[]) => {
        mocks.resolvedSessions.push(sessionIds);
        return mocks.personIds;
    }),
}));
vi.mock('../services/apiEndpointStatsClickHouse.js', () => ({ querySlowApiEndpointsFromClickHouse: vi.fn(async () => []) }));
vi.mock('../services/productRollupsClickHouse.js', () => ({ queryScreenTouchHeatmapsFromClickHouse: vi.fn(async () => []) }));

import { anrs, crashes, errors, issues, projects, teamMembers } from '../db/schema.js';
import issueRoutes from '../routes/issues.js';

type Handler = (req: any, res: any, next: () => void) => unknown;

function syncHandler(): Handler {
    const layer = (issueRoutes as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }>;
    }).stack.find((entry) => entry.route?.path === '/general/sync' && entry.route.methods.post);
    if (!layer?.route) throw new Error('sync route not found');
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const crash = (sessionId: string | null, minutes: number) => ({
    id: `crash-${sessionId}-${minutes}`,
    sessionId,
    projectId: PROJECT_ID,
    timestamp: at(minutes),
    exceptionName: 'NSInvalidArgumentException',
    reason: 'boom',
    deviceMetadata: { model: 'iPhone', appVersion: '1.0' },
});

async function runSync() {
    const res = { json: vi.fn() };
    await syncHandler()({ query: { projectId: PROJECT_ID }, user: { id: 'user-1' } }, res, vi.fn());
    return res;
}

beforeEach(() => {
    mocks.rowsByTable = new Map<unknown, unknown[]>([
        [projects, [{ id: PROJECT_ID, teamId: 'team-1', name: 'App' }]],
        [teamMembers, [{ teamId: 'team-1', userId: 'user-1' }]],
        [errors, []],
        [anrs, []],
        [issues, []],
    ]);
    mocks.updates = [];
    mocks.inserted = [];
    mocks.resolvedSessions = [];
    // s-anon is alice before sign-in; s-bob signed in; s-guest never did.
    mocks.personIds = new Map([['s-anon', 'alice'], ['s-alice', 'alice'], ['s-bob', 'bob']]);
});

describe('POST /general/sync affected users', () => {
    it('counts distinct people instead of writing 1', async () => {
        mocks.rowsByTable.set(crashes, [
            crash('s-anon', 50),
            crash('s-alice', 40),
            crash('s-alice', 30),
            crash('s-bob', 20),
            crash('s-guest', 10),
            crash(null, 5),
        ]);

        const res = await runSync();

        expect(res.json).toHaveBeenCalled();
        expect(mocks.resolvedSessions).toEqual([['s-anon', 's-alice', 's-alice', 's-bob', 's-guest']]);
        expect(mocks.inserted).toHaveLength(1);
        // alice (before and after sign-in), bob, and the unidentified session s-guest.
        expect(mocks.inserted[0].userCount).toBe(3);
        expect(mocks.inserted[0].eventCount).toBe(BigInt(6));
    });

    it('writes the person count onto an existing issue', async () => {
        mocks.rowsByTable.set(issues, [{ id: 'issue-existing', shortId: 'APP-1' }]);
        mocks.rowsByTable.set(crashes, [crash('s-anon', 30), crash('s-alice', 20), crash('s-bob', 10)]);

        await runSync();

        const issueUpdate = mocks.updates.find((values) => 'userCount' in values);
        expect(issueUpdate?.userCount).toBe(2);
    });
});
