import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const state: { stripeClient?: any; teamRows: unknown[][]; order: string[] } = { teamRows: [], order: [] };
    return {
        state,
        // A regular function so `new Stripe()` works with Vitest 4 mocks.
        StripeConstructor: vi.fn(function () { return state.stripeClient; }),
        dbSelect: vi.fn(),
        dbUpdate: vi.fn(),
        dbInsert: vi.fn(),
        updateSet: vi.fn(),
        invalidateStripeSubscriptionCache: vi.fn(),
        invalidateSessionCache: vi.fn(),
        syncTeamMcpLimits: vi.fn(),
        loggerError: vi.fn(),
    };
});

vi.mock('stripe', () => ({ default: mocks.StripeConstructor }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({ sql: 'eq' })), and: vi.fn(() => ({ sql: 'and' })), inArray: vi.fn() }));
vi.mock('../config.js', () => ({
    config: { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_test_123' },
}));
vi.mock('../db/client.js', () => ({
    db: { select: mocks.dbSelect, update: mocks.dbUpdate, insert: mocks.dbInsert },
    teams: {
        id: 'teams.id', stripePriceId: 'teams.stripePriceId', stripeSubscriptionId: 'teams.stripeSubscriptionId',
        billingCycleAnchor: 'teams.billingCycleAnchor', paymentFailedAt: 'teams.paymentFailedAt',
    },
    stripeWebhookEvents: { id: 'stripeWebhookEvents.id' },
    billingUsage: {},
    users: {},
    teamMembers: {},
}));
vi.mock('../db/redis.js', () => ({ invalidateStripeSubscriptionCache: mocks.invalidateStripeSubscriptionCache }));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), error: mocks.loggerError, info: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/videoRetention.js', () => ({
    FREE_VIDEO_RETENTION_TIER: 1,
    parseVideoRetentionTier: (value: unknown) => (value ? Number(value) : null),
    syncTeamVideoRetention: vi.fn(),
}));
vi.mock('../services/quotaCheck.js', () => ({ invalidateSessionCache: mocks.invalidateSessionCache }));
vi.mock('../services/mcpEntitlement.js', () => ({ syncTeamMcpLimits: mocks.syncTeamMcpLimits }));

import { handleWebhookEvent } from '../services/stripe.js';

const growthPrice = { id: 'price_growth', metadata: { plan_name: 'growth', retention_tier: '2', mcp_credit_limit: '6000' } };
const subscription = (status: string) => ({
    id: 'sub_1',
    status,
    metadata: { teamId: 'team_1' },
    items: { data: [{ price: growthPrice }] },
    current_period_start: 1780272000,
    current_period_end: 1782864000,
});

function event(type: string, object: unknown, id = `evt_${type}`) {
    return { id, type, data: { object } } as any;
}

async function expectSyncAfterCacheClear(teamId = 'team_1') {
    await vi.waitFor(() => expect(mocks.syncTeamMcpLimits).toHaveBeenCalledWith(teamId));
    expect(mocks.invalidateStripeSubscriptionCache).toHaveBeenCalledWith(teamId);
    expect(mocks.state.order.indexOf('invalidate')).toBeGreaterThanOrEqual(0);
    expect(mocks.state.order.indexOf('invalidate')).toBeLessThan(mocks.state.order.indexOf('sync'));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.order = [];
    // First select is the idempotency check (not processed); later ones return queued team rows.
    mocks.state.teamRows = [[]];
    mocks.dbSelect.mockImplementation(() => {
        const rows = mocks.state.teamRows.shift() ?? [];
        return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
    });
    mocks.updateSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.dbUpdate.mockReturnValue({ set: mocks.updateSet });
    mocks.dbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mocks.invalidateStripeSubscriptionCache.mockImplementation(async () => { mocks.state.order.push('invalidate'); });
    mocks.syncTeamMcpLimits.mockImplementation(async () => {
        mocks.state.order.push('sync');
        return { creditLimit: 6000, planName: 'growth' };
    });
    mocks.state.stripeClient = {
        subscriptions: { retrieve: vi.fn().mockResolvedValue({ ...subscription('active'), default_payment_method: 'pm_1' }) },
        prices: { retrieve: vi.fn() },
    };
});

describe('Stripe webhooks sync MCP limits', () => {
    it('customer.subscription.updated clears the subscription cache, then syncs', async () => {
        mocks.state.teamRows.push([{ stripePriceId: 'price_starter', billingCycleAnchor: null, paymentFailedAt: null }]);
        await handleWebhookEvent(event('customer.subscription.updated', subscription('active')));
        await expectSyncAfterCacheClear();
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ stripePriceId: 'price_growth' }));
    });

    it('customer.subscription.updated to unpaid clears the cache, then syncs', async () => {
        await handleWebhookEvent(event('customer.subscription.updated', subscription('unpaid')));
        await expectSyncAfterCacheClear();
    });

    it('customer.subscription.deleted clears the cache, then syncs', async () => {
        await handleWebhookEvent(event('customer.subscription.deleted', subscription('canceled')));
        await expectSyncAfterCacheClear();
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ stripeSubscriptionId: null, stripePriceId: null }));
    });

    it('customer.subscription.created clears the cache, then syncs', async () => {
        await handleWebhookEvent(event('customer.subscription.created', subscription('active')));
        await expectSyncAfterCacheClear();
    });

    it('checkout.session.completed clears the cache, then syncs', async () => {
        await handleWebhookEvent(event('checkout.session.completed', {
            id: 'cs_1', mode: 'subscription', metadata: { teamId: 'team_1' }, subscription: 'sub_1', customer: 'cus_1',
        }));
        await expectSyncAfterCacheClear();
    });

    it('does not fail the webhook when the MCP sync fails', async () => {
        mocks.syncTeamMcpLimits.mockRejectedValue(new Error('sync broke'));
        await expect(handleWebhookEvent(event('customer.subscription.deleted', subscription('canceled')))).resolves.toBeUndefined();
        await vi.waitFor(() => expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.objectContaining({ teamId: 'team_1' }),
            'Failed to sync MCP limits after billing change',
        ));
        expect(mocks.dbInsert).toHaveBeenCalled();
    });

    it('does not sync for unrelated events', async () => {
        await handleWebhookEvent(event('payment_intent.created', { id: 'pi_1' }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(mocks.syncTeamMcpLimits).not.toHaveBeenCalled();
    });
});
