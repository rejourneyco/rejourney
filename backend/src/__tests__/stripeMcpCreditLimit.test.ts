import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: { STRIPE_SECRET_KEY: 'sk_test' }, cached: vi.fn(), cacheSet: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(), retrieve: vi.fn(), list: vi.fn(), update: vi.fn(),
}));
vi.mock('../config.js', () => ({ config: mocks.config }));
vi.mock('stripe', () => ({ default: vi.fn(function () {
    return { subscriptions: { retrieve: mocks.retrieve }, prices: { list: mocks.list } };
}) }));
vi.mock('../db/client.js', () => ({ db: { select: mocks.select, update: mocks.update },
    teams: { id: 'id' }, projects: {}, projectUsage: {}, users: {}, teamMembers: {},
}));
vi.mock('../db/redis.js', () => ({ getStripeSubscriptionCache: mocks.cached,
    setStripeSubscriptionCache: mocks.cacheSet, invalidateStripeSubscriptionCache: vi.fn(),
}));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/videoRetention.js', () => ({
    FREE_VIDEO_RETENTION_TIER: 1, parseVideoRetentionTier: (value: string) => Number(value),
    normalizeVideoRetentionTier: (value: number) => value || 1,
    getVideoRetentionDetailsForTier: vi.fn().mockResolvedValue({ tier: 2, days: 14, label: '14 days' }),
    syncTeamVideoRetention: vi.fn(),
}));

function stripePrice(id: string, planName: string, metadata: Record<string, string> = {}, unitAmount = 500) {
    return {
        id,
        unit_amount: unitAmount,
        recurring: { interval: 'month' },
        metadata: { session_limit: '25000', retention_tier: '2', ...metadata },
        product: { id: `prod_${planName}`, name: planName.charAt(0).toUpperCase() + planName.slice(1), active: true,
            metadata: { plan_name: planName } },
    };
}

const paidTeam = { id: 'team_test', stripeSubscriptionId: 'sub_test', stripePriceId: 'price_growth', billingCycleAnchor: new Date() };
function subscriptionWith(price: ReturnType<typeof stripePrice>) {
    return { id: 'sub_test', status: 'active', items: { data: [{ price }] }, schedule: null,
        current_period_start: 1780272000, current_period_end: 1782864000, cancel_at_period_end: false };
}

const service = () => import('../services/stripeProducts.js');

beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); mocks.config.STRIPE_SECRET_KEY = 'sk_test';
    mocks.cached.mockResolvedValue(null);
    mocks.list.mockResolvedValue({ data: [] });
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [paidTeam] }) }) });
    mocks.update.mockReturnValue({ set: () => ({ where: async () => undefined }) });
});

describe('parseMcpCreditLimit', () => {
    it('reads a valid mcp_credit_limit from price metadata', async () => {
        const { parseMcpCreditLimit } = await service();
        expect(parseMcpCreditLimit({ id: 'p', metadata: { mcp_credit_limit: '6000' } }, 'growth')).toBe(6000);
        expect(parseMcpCreditLimit({ id: 'p', metadata: { mcp_credit_limit: '12345' } }, 'starter')).toBe(12345);
    });

    it.each([
        ['starter', 2000], ['growth', 6000], ['pro', 20000], ['scale', 75000], ['Pro', 20000],
        ['enterprise-acme', 75000], ['custom', 75000],
    ])('falls back to the default for %s when the key is missing', async (planName, expected) => {
        const { parseMcpCreditLimit } = await service();
        expect(parseMcpCreditLimit({ id: 'p', metadata: {} }, planName)).toBe(expected);
    });

    it.each(['', '0', '-5', 'lots', '1.5', '2000x'])('falls back when the key is invalid (%s)', async (raw) => {
        const { parseMcpCreditLimit } = await service();
        expect(parseMcpCreditLimit({ id: 'p', metadata: { mcp_credit_limit: raw } }, 'growth')).toBe(6000);
    });

    it('exports the free allowance', async () => {
        const { FREE_TIER_MCP_CREDITS } = await service();
        expect(FREE_TIER_MCP_CREDITS).toBe(300);
    });
});

describe('getStripePlans mcpCreditLimit', () => {
    it('reads the key, falls back for a missing key instead of skipping the plan, and adds free at 300', async () => {
        mocks.list.mockResolvedValue({ data: [
            stripePrice('price_starter', 'starter', { mcp_credit_limit: '2000' }),
            stripePrice('price_pro', 'pro'),
            stripePrice('price_custom', 'acme', { mcp_credit_limit: 'oops' }),
        ] });
        const { getStripePlans } = await service();
        const plans = await getStripePlans(true);
        const byName = Object.fromEntries(plans.map((p) => [p.name, p.mcpCreditLimit]));
        expect(byName).toEqual({ free: 300, starter: 2000, pro: 20000, acme: 75000 });
    });

    it('returns the free plan at 300 when Stripe is disabled', async () => {
        mocks.config.STRIPE_SECRET_KEY = '';
        const { getStripePlans } = await service();
        expect((await getStripePlans(true)).map((p) => p.mcpCreditLimit)).toEqual([300]);
    });
});

describe('getTeamSubscription mcpCreditLimit', () => {
    it('resolves a paid plan value from the subscription price', async () => {
        mocks.retrieve.mockResolvedValue(subscriptionWith(stripePrice('price_growth', 'growth', { mcp_credit_limit: '6000' })));
        const { getTeamSubscription } = await service();
        const sub = await getTeamSubscription('team_test');
        expect(sub.mcpCreditLimit).toBe(6000);
        expect(mocks.cacheSet).toHaveBeenCalledWith('team_test', expect.objectContaining({ cacheVersion: 4, mcpCreditLimit: 6000 }));
    });

    it('falls back by plan name when the subscription price lacks the key', async () => {
        mocks.retrieve.mockResolvedValue(subscriptionWith(stripePrice('price_scale', 'scale')));
        const { getTeamSubscription } = await service();
        expect((await getTeamSubscription('team_test')).mcpCreditLimit).toBe(75000);
    });

    it('gives a team without a subscription the free allowance', async () => {
        mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ ...paidTeam, stripeSubscriptionId: null }] }) }) });
        const { getTeamSubscription } = await service();
        const sub = await getTeamSubscription('team_test');
        expect(sub.planName).toBe('free');
        expect(sub.mcpCreditLimit).toBe(300);
    });

    it('ignores subscription cache entries written before mcpCreditLimit existed', async () => {
        mocks.cached.mockResolvedValue({ cacheVersion: 3, sessionLimit: 20000, planName: 'growth',
            subscriptionId: 'sub_test', subscriptionStatus: 'active', currentPeriodStart: null, currentPeriodEnd: null });
        mocks.retrieve.mockResolvedValue(subscriptionWith(stripePrice('price_growth', 'growth', { mcp_credit_limit: '6000' })));
        const { getTeamSubscription } = await service();
        expect((await getTeamSubscription('team_test')).mcpCreditLimit).toBe(6000);
        expect(mocks.retrieve).toHaveBeenCalled();
    });
});
