import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, passthrough } = vi.hoisted(() => ({
    passthrough: (_req: unknown, _res: unknown, next: () => void) => next(),
    mocks: {
        teamRow: vi.fn(),
        getTeamSubscription: vi.fn(),
        getTeamSessionUsage: vi.fn(),
        invalidateSessionCache: vi.fn(),
        cancelSubscription: vi.fn(),
        audit: vi.fn(),
    },
}));

vi.mock('../db/client.js', () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: mocks.teamRow }) }) }),
    },
    users: {},
    teams: { id: 'id', billingCycleAnchor: 'billing_cycle_anchor' },
}));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config.js', () => ({ config: {} }));
vi.mock('../middleware/index.js', () => ({
    sessionAuth: passthrough,
    requireTeamAccess: passthrough,
    requireBillingAdmin: passthrough,
    asyncHandler: (fn: unknown) => fn,
    ApiError: class ApiError extends Error {},
}));
vi.mock('../middleware/validation.js', () => ({ validate: () => passthrough }));
vi.mock('../middleware/rateLimit.js', () => ({ adminRateLimiter: passthrough }));
vi.mock('../services/auditLog.js', () => ({ auditFromRequest: mocks.audit }));
vi.mock('../services/stripe.js', () => ({}));
vi.mock('../services/stripeHostedCheckout.js', () => ({}));
vi.mock('../services/stripeProducts.js', () => ({
    getTeamSubscription: mocks.getTeamSubscription,
    cancelSubscription: mocks.cancelSubscription,
}));
vi.mock('../services/quotaCheck.js', () => ({
    getTeamSessionUsage: mocks.getTeamSessionUsage,
    invalidateSessionCache: mocks.invalidateSessionCache,
}));

import stripeBillingRoutes from '../routes/stripeBilling.js';

type Handler = (req: any, res: any, next: () => void) => unknown;

function routeHandler(method: string, path: string): Handler {
    const layer = (stripeBillingRoutes as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }>;
    }).stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
    if (!layer?.route) throw new Error(`route not found: ${method} ${path}`);
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle;
}

function response() {
    return { json: vi.fn(), setHeader: vi.fn() };
}

const subscription = {
    teamId: 'team-1',
    priceId: 'price_1',
    productId: 'prod_1',
    planName: 'growth',
    displayName: 'Growth',
    priceCents: 4900,
    sessionLimit: 50000,
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

const usage = {
    sessionsUsed: 10,
    sessionsCaptured: 40,
    sessionReplaysUsed: 10,
    sessionLimit: 50000,
    sessionReplayLimit: 50000,
    planSessionLimit: 50000,
    sessionReplayPlanLimit: 50000,
    bonusSessionsActive: 0,
    sessionsRemaining: 49990,
    sessionReplaysRemaining: 49990,
    percentUsed: 0,
    sessionReplayPercentUsed: 0,
    isAtLimit: false,
    isReplayAtLimit: false,
    isNearLimit: false,
    isReplayNearLimit: false,
    planName: 'growth',
    allowed: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.teamRow.mockResolvedValue([{ billingCycleAnchor: null }]);
    mocks.getTeamSubscription.mockResolvedValue(subscription);
    mocks.getTeamSessionUsage.mockResolvedValue(usage);
    mocks.invalidateSessionCache.mockResolvedValue(undefined);
    mocks.cancelSubscription.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
});

describe('GET /:teamId/billing/plan', () => {
    it('reads the plan without wiping the ingest replay-limit cache', async () => {
        const res = response();
        await routeHandler('get', '/:teamId/billing/plan')({ params: { teamId: 'team-1' } }, res, vi.fn());

        expect(mocks.invalidateSessionCache).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledTimes(1);
    });

    it('resolves the subscription once and reuses it for usage', async () => {
        const res = response();
        await routeHandler('get', '/:teamId/billing/plan')({ params: { teamId: 'team-1' } }, res, vi.fn());

        expect(mocks.getTeamSubscription).toHaveBeenCalledTimes(1);
        expect(mocks.getTeamSessionUsage).toHaveBeenCalledWith('team-1', { subscription });
        const body = res.json.mock.calls[0][0];
        expect(body.plan.planName).toBe('growth');
        expect(body.usage).toEqual({
            sessionsUsed: 10,
            sessionsCaptured: 40,
            sessionReplaysUsed: 10,
            sessionLimit: 50000,
            sessionReplayLimit: 50000,
            planSessionLimit: 50000,
            sessionReplayPlanLimit: 50000,
            bonusSessionsActive: 0,
            sessionsRemaining: 49990,
            sessionReplaysRemaining: 49990,
            percentUsed: 0,
            sessionReplayPercentUsed: 0,
            isAtLimit: false,
            isReplayAtLimit: false,
            isNearLimit: false,
            isReplayNearLimit: false,
        });
    });
});

describe('DELETE /:teamId/billing/subscription', () => {
    it('clears the ingest replay-limit cache after canceling', async () => {
        const res = response();
        await routeHandler('delete', '/:teamId/billing/subscription')(
            { params: { teamId: 'team-1' }, body: { immediate: true } },
            res,
            vi.fn(),
        );

        expect(mocks.cancelSubscription).toHaveBeenCalledWith('team-1', true);
        expect(mocks.invalidateSessionCache).toHaveBeenCalledWith('team-1');
        expect(mocks.cancelSubscription.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.invalidateSessionCache.mock.invocationCallOrder[0]);
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('still succeeds when cache invalidation fails', async () => {
        mocks.invalidateSessionCache.mockRejectedValue(new Error('redis down'));
        const res = response();
        await routeHandler('delete', '/:teamId/billing/subscription')(
            { params: { teamId: 'team-1' }, body: {} },
            res,
            vi.fn(),
        );

        expect(res.json).toHaveBeenCalledWith({ success: true });
    });
});
