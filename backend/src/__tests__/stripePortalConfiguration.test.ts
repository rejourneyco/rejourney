import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const state: { stripeClient?: any } = {};
    return {
        state,
        StripeConstructor: vi.fn(() => state.stripeClient),
        dbSelect: vi.fn(),
        dbFrom: vi.fn(),
        dbWhere: vi.fn(),
        dbLimit: vi.fn(),
        eq: vi.fn(),
        invalidateStripeSubscriptionCache: vi.fn(),
    };
});

vi.mock('stripe', () => ({
    default: mocks.StripeConstructor,
}));

vi.mock('drizzle-orm', () => ({
    eq: mocks.eq,
    and: vi.fn(),
    inArray: vi.fn(),
}));

vi.mock('../config.js', () => ({
    config: {
        NODE_ENV: 'production',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    },
}));

vi.mock('../db/client.js', () => ({
    db: {
        select: mocks.dbSelect,
    },
    teams: {
        id: 'teams.id',
        stripeCustomerId: 'teams.stripeCustomerId',
        stripeSubscriptionId: 'teams.stripeSubscriptionId',
    },
    stripeWebhookEvents: {},
    billingUsage: {},
    users: {},
    teamMembers: {},
}));

vi.mock('../db/redis.js', () => ({
    invalidateStripeSubscriptionCache: mocks.invalidateStripeSubscriptionCache,
}));

vi.mock('../logger.js', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../services/videoRetention.js', () => ({
    FREE_VIDEO_RETENTION_TIER: 1,
    parseVideoRetentionTier: vi.fn(),
    syncTeamVideoRetention: vi.fn(),
}));

import { createBillingPortalPlanChangeSession } from '../services/stripe.js';

describe('createBillingPortalPlanChangeSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.dbSelect.mockReturnValue({ from: mocks.dbFrom });
        mocks.dbFrom.mockReturnValue({ where: mocks.dbWhere });
        mocks.dbWhere.mockReturnValue({ limit: mocks.dbLimit });
        mocks.dbLimit.mockResolvedValue([{
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_123',
        }]);
        mocks.invalidateStripeSubscriptionCache.mockResolvedValue(undefined);
        mocks.eq.mockReturnValue({ sql: 'teams.id = team_123' });

        mocks.state.stripeClient = {
            subscriptions: {
                retrieve: vi.fn().mockResolvedValue({
                    id: 'sub_123',
                    items: {
                        data: [{
                            id: 'si_123',
                            quantity: 1,
                        }],
                    },
                }),
            },
            billingPortal: {
                configurations: {
                    list: vi.fn().mockResolvedValue({ data: [] }),
                    create: vi.fn().mockResolvedValue({ id: 'bpc_plan_change' }),
                    update: vi.fn(),
                },
                sessions: {
                    create: vi.fn().mockResolvedValue({
                        url: 'https://billing.stripe.test/session',
                    }),
                },
            },
        };
    });

    it('creates and passes a managed plan-change portal configuration in production', async () => {
        const url = await createBillingPortalPlanChangeSession({
            teamId: 'team_123',
            priceId: 'price_growth',
            returnUrl: 'https://rejourney.test/dashboard/billing/return',
            changeType: 'upgrade',
            portalProducts: [{
                productId: 'prod_growth',
                priceIds: ['price_growth'],
            }],
        });

        expect(url).toBe('https://billing.stripe.test/session');
        expect(mocks.state.stripeClient.billingPortal.configurations.create).toHaveBeenCalledWith({
            default_return_url: 'https://rejourney.test/dashboard/billing/return',
            features: expect.objectContaining({
                invoice_history: { enabled: true },
                payment_method_update: { enabled: true },
                subscription_cancel: {
                    enabled: true,
                    mode: 'at_period_end',
                    proration_behavior: 'none',
                },
                subscription_update: {
                    enabled: true,
                    billing_cycle_anchor: 'now',
                    default_allowed_updates: ['price'],
                    products: [{
                        product: 'prod_growth',
                        prices: ['price_growth'],
                        adjustable_quantity: { enabled: false },
                    }],
                    proration_behavior: 'none',
                    schedule_at_period_end: {
                        conditions: [{ type: 'decreasing_item_amount' }],
                    },
                },
            }),
            metadata: {
                rejourney_managed: 'plan_change_v1:upgrade:prod_growth:price_growth',
            },
            name: 'Rejourney upgrade price_growth',
        });
        expect(mocks.state.stripeClient.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
            configuration: 'bpc_plan_change',
            customer: 'cus_123',
        }));
    });
});
