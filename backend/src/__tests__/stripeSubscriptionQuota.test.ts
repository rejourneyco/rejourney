import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: { STRIPE_SECRET_KEY: '' }, cached: vi.fn(), cacheSet: vi.fn().mockResolvedValue(undefined),
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
const paidTeam = { id: 'team_test', stripeSubscriptionId: 'sub_test', stripePriceId: 'price_test', billingCycleAnchor: null };
const price = { id: 'price_test', metadata: { session_limit: '20000', retention_tier: '2' },
    product: { id: 'prod_test', name: 'Starter', active: true, metadata: {} } };
const subscription = { id: 'sub_test', status: 'active', items: { data: [{ price }] }, schedule: null,
    current_period_start: 1780272000, current_period_end: 1782864000, cancel_at_period_end: false };
const service = () => import('../services/stripeProducts.js');
function teamRow(team = paidTeam) {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [team] }) }) });
}
beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); mocks.config.STRIPE_SECRET_KEY = '';
    mocks.cached.mockResolvedValue(null); mocks.retrieve.mockResolvedValue(subscription);
    mocks.list.mockResolvedValue({ data: [] }); teamRow();
    mocks.update.mockReturnValue({ set: () => ({ where: async () => undefined }) });
});
describe('subscription quota resolution', () => {
    it('retries a paid subscription on a cold worker without credentials instead of using the free cap', async () => {
        const { getTeamSubscription } = await service();
        await expect(getTeamSubscription('team_test')).rejects.toMatchObject({ statusCode: 503 });
        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });
    it('uses a verified shared paid subscription without calling Stripe', async () => {
        mocks.cached.mockResolvedValue({ cacheVersion: 3, sessionLimit: 20000,
            subscriptionId: 'sub_test', subscriptionStatus: 'active', currentPeriodStart: null, currentPeriodEnd: null });
        const { getTeamSubscription } = await service();
        expect((await getTeamSubscription('team_test')).sessionLimit).toBe(20000);
        expect(mocks.select).not.toHaveBeenCalled();
    });
    it('does not trust a subscription cached by the former free-cap fallback', async () => {
        mocks.cached.mockResolvedValue({ cacheVersion: 2, sessionLimit: 5000 });
        const { getTeamSubscription } = await service();
        await expect(getTeamSubscription('team_test')).rejects.toMatchObject({ statusCode: 503 });
    });
    it('still returns free limits for a confirmed unsubscribed account', async () => {
        teamRow({ ...paidTeam, stripeSubscriptionId: null } as any);
        const { getTeamSubscription } = await service();
        expect((await getTeamSubscription('team_test')).sessionLimit).toBe(5000);
        expect(mocks.cacheSet).toHaveBeenCalled();
    });
    it('retries a Stripe outage when no verified paid plan is available', async () => {
        mocks.config.STRIPE_SECRET_KEY = 'sk_test'; mocks.retrieve.mockRejectedValue(new Error('Temporary outage'));
        const { getTeamSubscription } = await service();
        await expect(getTeamSubscription('team_test')).rejects.toMatchObject({ statusCode: 503 });
        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });
    it('preserves verified catalog limits during a subscription lookup outage', async () => {
        mocks.config.STRIPE_SECRET_KEY = 'sk_test'; mocks.retrieve.mockRejectedValue(new Error('Temporary outage'));
        mocks.list.mockResolvedValue({ data: [price] });
        const { getTeamSubscription } = await service();
        expect((await getTeamSubscription('team_test')).sessionLimit).toBe(20000);
    });
    it.each(['', '0', '-1', 'bad', '20000oops', '1.5'])('retries invalid paid quota metadata (%s)', async (limit) => {
        mocks.config.STRIPE_SECRET_KEY = 'sk_test';
        mocks.retrieve.mockResolvedValue({ ...subscription, items: { data: [{ price: {
            ...price, metadata: { ...price.metadata, session_limit: limit },
        } }] } });
        const { getTeamSubscription } = await service();
        await expect(getTeamSubscription('team_test')).rejects.toMatchObject({ statusCode: 503 });
        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });
    it('retries a subscribed account with no items and no matching catalog plan', async () => {
        mocks.config.STRIPE_SECRET_KEY = 'sk_test'; mocks.retrieve.mockResolvedValue({ ...subscription, items: { data: [] } });
        const { getTeamSubscription } = await service();
        await expect(getTeamSubscription('team_test')).rejects.toMatchObject({ statusCode: 503 });
    });
    it.each(['incomplete', 'unpaid'])('preserves actual free limits for a confirmed %s subscription', async (status) => {
        mocks.config.STRIPE_SECRET_KEY = 'sk_test'; mocks.retrieve.mockResolvedValue({ ...subscription, status });
        const { getTeamSubscription } = await service(); const result = await getTeamSubscription('team_test');
        expect(result.sessionLimit).toBe(5000); expect(result.subscriptionStatus).toBe(status);
        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });
    it('resolves and caches valid paid limits from Stripe', async () => {
        mocks.config.STRIPE_SECRET_KEY = 'sk_test'; const { getTeamSubscription } = await service();
        expect((await getTeamSubscription('team_test')).sessionLimit).toBe(20000);
        expect(mocks.cacheSet).toHaveBeenCalledWith('team_test', expect.objectContaining({ cacheVersion: 3, sessionLimit: 20000 }));
    });
});
