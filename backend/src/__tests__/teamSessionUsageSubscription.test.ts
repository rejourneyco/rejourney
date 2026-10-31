import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    select: vi.fn(),
    getTeamSubscription: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    sql: vi.fn(),
}));
vi.mock('../db/client.js', () => ({
    db: { select: mocks.select },
    teams: {},
    users: {},
    projects: {},
    projectUsage: {},
    billingNotifications: {},
    teamMembers: {},
    sessions: {},
    billingCutovers: {},
}));
vi.mock('../db/redis.js', () => ({
    getSessionLimitCacheWithLock: vi.fn(),
    invalidateSessionLimitCache: vi.fn(),
    getBillingStatusCache: vi.fn(),
    setBillingStatusCache: vi.fn(),
    getBillingPeriodCache: vi.fn(),
    setBillingPeriodCache: vi.fn(),
}));
vi.mock('../services/stripeProducts.js', () => ({ getTeamSubscription: mocks.getTeamSubscription }));
vi.mock('../services/email.js', () => ({ sendBillingWarningEmail: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/index.js', () => ({ ApiError: class ApiError extends Error {} }));

import { getTeamSessionUsage } from '../services/quotaCheck.js';

const paidTeam = {
    billingCycleAnchor: null,
    ownerUserId: 'owner-1',
    stripeSubscriptionId: 'sub_1',
    bonusSessions: 0,
    bonusSessionsBillingPeriod: null,
    stripeCurrentPeriodStart: null,
    stripeCurrentPeriodEnd: null,
};

function subscription(sessionLimit: number) {
    return {
        teamId: 'team-1',
        priceId: 'price_1',
        productId: 'prod_1',
        planName: 'growth',
        displayName: 'Growth',
        priceCents: 4900,
        sessionLimit,
        videoRetentionTier: 2,
        videoRetentionDays: 30,
        videoRetentionLabel: '30 days',
        isCustom: false,
        smartCaptureEnabled: false,
        subscriptionId: 'sub_1',
        subscriptionStatus: 'active',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        scheduledPriceId: null,
        scheduledPlanName: null,
    };
}

// team row (limit) -> team projects (where) -> usage aggregate (where)
function mockPaidTeamQueries() {
    mocks.select
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [paidTeam] }) }) })
        .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: 'project-1' }] }) })
        .mockReturnValueOnce({
            from: () => ({ where: async () => [{ totalSessionReplays: 120, totalSessionsCaptured: 400 }] }),
        });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReset();
    mocks.getTeamSubscription.mockResolvedValue(subscription(50000));
});

describe('getTeamSessionUsage subscription reuse', () => {
    it('uses a subscription the caller already resolved instead of fetching it again', async () => {
        mockPaidTeamQueries();
        const usage = await getTeamSessionUsage('team-1', { subscription: subscription(20000) });

        expect(mocks.getTeamSubscription).not.toHaveBeenCalled();
        expect(usage.sessionLimit).toBe(20000);
        expect(usage.planSessionLimit).toBe(20000);
        expect(usage.sessionReplaysUsed).toBe(120);
        expect(usage.sessionsCaptured).toBe(400);
        expect(usage.sessionsRemaining).toBe(19880);
        expect(usage.planName).toBe('growth');
    });

    it('still resolves the subscription itself when none is passed', async () => {
        mockPaidTeamQueries();
        const usage = await getTeamSessionUsage('team-1');

        expect(mocks.getTeamSubscription).toHaveBeenCalledWith('team-1');
        expect(usage.sessionLimit).toBe(50000);
        expect(usage.sessionsRemaining).toBe(49880);
    });
});
