vi.mock('../services/activitySnapshots.js', () => ({ snapshotActivityDay: vi.fn(async () => undefined) }));
vi.mock('../services/engagementSegments.js', () => ({ gradeEngagementByDay: vi.fn(async () => []) }));
vi.mock('../services/engagementRollupRegrade.js', () => ({ regradeEngagementRollups: vi.fn(async () => true) }));
vi.mock('../services/activityIdentityRegrade.js', () => ({ regradeActivityIdentity: vi.fn(async () => true) }));
vi.mock('../services/issueIdentityRegrade.js', () => ({ regradeIssueIdentity: vi.fn(async () => true) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbSelect: vi.fn(),
    writeRollup: vi.fn(),
    existingUniqueUsers: vi.fn(async (): Promise<number | null> => null),
}));

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn() }));
vi.mock('../db/client.js', () => ({ db: { select: mocks.dbSelect }, sessionMetrics: {}, sessions: {} }));
vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ eval: vi.fn(async () => 1), get: vi.fn(async () => null), set: vi.fn(async () => 'OK') }),
}));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/monitoring.js', () => ({ pingWorker: vi.fn(async () => undefined) }));
vi.mock('../services/clickhouseProductRollupsSink.js', () => ({ writeProductAnalyticsDailyRollupInputToClickHouse: mocks.writeRollup }));
vi.mock('../services/productRollupsClickHouse.js', () => ({
    queryProductDailyUniqueUserCountFromClickHouse: mocks.existingUniqueUsers,
    queryProductDailyStatsFromClickHouse: vi.fn(async () => []),
}));

import { runDailyRollup } from '../jobs/statsAggregator.js';

function session(id: string, identity: Record<string, string | Date | null>) {
    return { id, status: 'ready', events: [], screensVisited: [], startedAt: new Date('2026-01-15T10:00:00Z'), ...identity };
}

function mockDay(daySessions: unknown[]) {
    mocks.dbSelect
        .mockImplementationOnce(() => ({ from: () => ({ where: () => ({ groupBy: async () => [{ projectId: 'project-1' }] }) }) }))
        .mockImplementationOnce(() => ({ from: () => ({ leftJoin: () => ({ where: async () => daySessions }) }) }));
}

describe('daily rollup unique users', () => {
    beforeEach(() => {
        mocks.dbSelect.mockReset();
        mocks.writeRollup.mockReset();
        mocks.existingUniqueUsers.mockReset();
    });

    it('counts people: pre-sign-in sessions join their user and web sessions without a device count', async () => {
        mockDay([
            session('s1', { deviceId: 'dev-a', startedAt: new Date('2026-01-15T08:00:00Z') }),
            session('s2', { deviceId: 'dev-a', userDisplayId: 'alice', startedAt: new Date('2026-01-15T09:00:00Z') }),
            session('s3', { deviceId: 'dev-b', userDisplayId: 'alice' }),
            session('s4', { deviceId: 'dev-c' }),
            session('w1', { anonymousHash: 'web-visitor' }),
            session('w2', {}),
        ]);

        await expect(runDailyRollup(new Date('2026-01-15T00:00:00Z'))).resolves.toBe('completed');

        // alice, dev-c, web-visitor and the unidentified (unscrubbed) w2.
        expect(mocks.writeRollup).toHaveBeenCalledWith(expect.objectContaining({ uniqueUserCount: 4, source: 'stats_aggregator' }));
    });

    it('leaves scrubbed sessions uncounted and keeps the identity-scrub protection', async () => {
        mocks.existingUniqueUsers.mockResolvedValue(7);
        mockDay([
            session('s1', { deviceId: 'dev-a', userDisplayId: 'alice' }),
            session('scrubbed', { identityScrubbedAt: new Date('2026-01-20T00:00:00Z') }),
        ]);

        await expect(runDailyRollup(new Date('2026-01-15T00:00:00Z'))).resolves.toBe('completed');

        expect(mocks.existingUniqueUsers).toHaveBeenCalledWith({ projectId: 'project-1', date: '2026-01-15' });
        expect(mocks.writeRollup).toHaveBeenCalledWith(expect.objectContaining({ uniqueUserCount: 7 }));
    });
});
