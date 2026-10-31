import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, passthrough } = vi.hoisted(() => ({
    passthrough: (_req: unknown, _res: unknown, next: () => void) => next(),
    mocks: {
        selectRows: [] as unknown[][],
        stored: null as Record<string, unknown> | null,
        getWorkspaceCache: vi.fn(),
        setWorkspaceCache: vi.fn(),
        invalidateWorkspaceCache: vi.fn(),
    },
}));

vi.mock('../db/client.js', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit: async () => mocks.selectRows.shift() ?? [] }),
            }),
        }),
        insert: () => ({
            values: (payload: Record<string, unknown>) => {
                // Mimic the jsonb round trip of the stored row.
                mocks.stored = JSON.parse(JSON.stringify(payload));
                return { onConflictDoUpdate: async () => undefined };
            },
        }),
    },
    teamMembers: {},
    projects: {},
    uiWorkspaces: {},
}));
vi.mock('../db/redis.js', () => ({
    getWorkspaceCache: mocks.getWorkspaceCache,
    setWorkspaceCache: mocks.setWorkspaceCache,
    invalidateWorkspaceCache: mocks.invalidateWorkspaceCache,
}));
vi.mock('../middleware/index.js', () => ({
    sessionAuth: passthrough,
    asyncHandler: (fn: unknown) => fn,
    ApiError: class ApiError extends Error {
        static forbidden(message: string) { return new this(message); }
    },
}));
vi.mock('../middleware/validation.js', () => ({ validate: () => passthrough }));
vi.mock('../middleware/rateLimit.js', () => ({ writeApiRateLimiter: passthrough }));

import workspaceRoutes from '../routes/uiWorkspace.js';

type Handler = (req: any, res: any, next: () => void) => unknown;

function routeHandler(method: string, path: string): Handler {
    const layer = (workspaceRoutes as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }>;
    }).stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
    if (!layer?.route) throw new Error(`route not found: ${method} ${path}`);
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle;
}

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const user = { id: 'user-1' };

const putBody = {
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    workspaceKey: 'default',
    tabs: [
        { id: 'issues', title: 'Issues', path: '/dashboard/issues' },
        { id: 'analytics-api', title: 'API', path: '/dashboard/analytics/api?range=7d' },
        { id: 'sessions', title: 'Sessions', path: '/dashboard/sessions' },
    ],
    activeTabId: 'issues',
    recentlyClosed: [{ id: 'geo', title: 'Geo', path: '/dashboard/analytics/geo' }],
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [];
    mocks.stored = null;
    mocks.getWorkspaceCache.mockResolvedValue(null);
    mocks.setWorkspaceCache.mockResolvedValue(undefined);
    mocks.invalidateWorkspaceCache.mockResolvedValue(undefined);
});

// PUT used to write the saved state through to the GET cache, but two
// overlapping PUTs could then leave the older state cached. PUT deletes the
// entry instead and the next GET repopulates it from the database.
describe('PUT /workspace cache invalidation', () => {
    it('invalidates the GET cache instead of writing the saved state into it', async () => {
        mocks.selectRows = [[{ teamId: TEAM_ID }], [{ id: PROJECT_ID }]];
        const res = { json: vi.fn() };

        await routeHandler('put', '/workspace')({ body: putBody, user }, res, vi.fn());

        expect(mocks.setWorkspaceCache).not.toHaveBeenCalled();
        expect(mocks.invalidateWorkspaceCache).toHaveBeenCalledWith('user-1', TEAM_ID, PROJECT_ID, 'default');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    it('repopulates the cache from the stored row on the next GET', async () => {
        mocks.selectRows = [[{ teamId: TEAM_ID }], [{ id: PROJECT_ID }]];
        await routeHandler('put', '/workspace')({ body: putBody, user }, { json: vi.fn() }, vi.fn());

        mocks.selectRows = [[{ teamId: TEAM_ID }], [{ id: PROJECT_ID }], [mocks.stored]];
        const getRes = { json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
        await routeHandler('get', '/workspace')(
            { query: { teamId: TEAM_ID, projectId: PROJECT_ID, key: 'default' }, user },
            getRes,
            vi.fn(),
        );

        expect(mocks.setWorkspaceCache).toHaveBeenCalledTimes(1);
        const [userId, teamId, projectId, key, json] = mocks.setWorkspaceCache.mock.calls[0];
        expect([userId, teamId, projectId, key]).toEqual(['user-1', TEAM_ID, PROJECT_ID, 'default']);
        expect(JSON.parse(json)).toEqual({
            tabs: [
                { id: 'general', title: 'General', path: '/dashboard/general' },
                { id: 'analytics-api', title: 'API', path: '/dashboard/api?range=7d' },
                { id: 'sessions', title: 'Sessions', path: '/dashboard/sessions' },
            ],
            activeTabId: 'general',
            recentlyClosed: [{ id: 'geo', title: 'Geo', path: '/dashboard/geo' }],
            workspaceKey: 'default',
        });
        expect(getRes.json).toHaveBeenCalledWith(JSON.parse(json));
    });
});
