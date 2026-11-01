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

describe('free-tier pooled limit', () => {
    it("pools every free team's active bonus, so a lapsed team is not exhausted by a sibling's usage", async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        try {
            mocks.getTeamSubscription.mockResolvedValue({ ...subscription(5000), planName: 'free', subscriptionId: null });
            const lapsed = { ...paidTeam, stripeSubscriptionId: null, bonusSessions: 100000, bonusSessionsBillingPeriod: '2026-11' };
            const anchor = new Date('2026-04-11T12:00:00Z');
            mocks.select
                // team row
                .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [lapsed] }) }) })
                // owner's teams, their projects, the sibling's usage this cycle
                .mockReturnValueOnce({ from: () => ({ where: async () => [
                    { id: 'team-1', stripeSubscriptionId: null, billingCycleAnchor: null },
                    { id: 'team-2', stripeSubscriptionId: null, billingCycleAnchor: anchor },
                ] }) })
                .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: 'p2', teamId: 'team-2' }] }) })
                .mockReturnValueOnce({ from: () => ({ where: async () => [{ totalSessionReplays: 93378, totalSessionsCaptured: 106505 }] }) })
                // free teams' bonuses: this team's November bonus and the sibling's active cycle bonus
                .mockReturnValueOnce({ from: () => ({ where: async () => [
                    { bonusSessions: 100000, bonusSessionsBillingPeriod: '2026-11', billingCycleAnchor: null },
                    { bonusSessions: 310000, bonusSessionsBillingPeriod: '2026-10-08', billingCycleAnchor: anchor },
                ] }) });

            const usage = await getTeamSessionUsage('team-1');
            expect(usage.sessionReplaysUsed).toBe(93378);
            expect(usage.bonusSessionsActive).toBe(410000);
            expect(usage.sessionReplayLimit).toBe(415000);
        } finally {
            vi.useRealTimers();
        }
    });
});
