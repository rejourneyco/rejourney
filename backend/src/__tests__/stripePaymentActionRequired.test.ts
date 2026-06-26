import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const state: { stripeClient?: any; selectCall: number } = { selectCall: 0 };
    return {
        state,
        StripeConstructor: vi.fn(() => state.stripeClient),
        dbSelect: vi.fn(),
        dbUpdate: vi.fn(),
        dbInsert: vi.fn(),
        updateSet: vi.fn(),
        updateWhere: vi.fn(),
        insertValues: vi.fn(),
        eq: vi.fn(),
        and: vi.fn(),
        inArray: vi.fn(),
        invalidateSessionCache: vi.fn(),
        sendPaymentActionRequiredEmail: vi.fn(),
    };
});

vi.mock('stripe', () => ({
    default: mocks.StripeConstructor,
}));

vi.mock('drizzle-orm', () => ({
    eq: mocks.eq,
    and: mocks.and,
    inArray: mocks.inArray,
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
        update: mocks.dbUpdate,
        insert: mocks.dbInsert,
    },
    teams: {
        id: 'teams.id',
        name: 'teams.name',
        stripePriceId: 'teams.stripePriceId',
        stripeSubscriptionId: 'teams.stripeSubscriptionId',
        billingEmail: 'teams.billingEmail',
        ownerUserId: 'teams.ownerUserId',
        paymentFailedAt: 'teams.paymentFailedAt',
        updatedAt: 'teams.updatedAt',
    },
    stripeWebhookEvents: {
        id: 'stripeWebhookEvents.id',
        type: 'stripeWebhookEvents.type',
    },
    billingUsage: {},
    users: {
        id: 'users.id',
        email: 'users.email',
    },
    teamMembers: {
        teamId: 'teamMembers.teamId',
        userId: 'teamMembers.userId',
        role: 'teamMembers.role',
    },
}));

vi.mock('../db/redis.js', () => ({
    invalidateStripeSubscriptionCache: vi.fn(),
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

vi.mock('../services/quotaCheck.js', () => ({
    invalidateSessionCache: mocks.invalidateSessionCache,
}));

vi.mock('../services/email.js', () => ({
    sendPaymentActionRequiredEmail: mocks.sendPaymentActionRequiredEmail,
}));

import { handleWebhookEvent } from '../services/stripe.js';

describe('invoice.payment_action_required webhook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.selectCall = 0;

        mocks.eq.mockReturnValue({ sql: 'eq' });
        mocks.and.mockReturnValue({ sql: 'and' });
        mocks.inArray.mockReturnValue({ sql: 'inArray' });

        mocks.updateWhere.mockResolvedValue(undefined);
        mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
        mocks.dbUpdate.mockReturnValue({ set: mocks.updateSet });

        mocks.insertValues.mockResolvedValue(undefined);
        mocks.dbInsert.mockReturnValue({ values: mocks.insertValues });

        mocks.dbSelect.mockImplementation(() => {
            mocks.state.selectCall += 1;

            if (mocks.state.selectCall === 1) {
                return {
                    from: vi.fn(() => ({
                        where: vi.fn(() => ({
                            limit: vi.fn().mockResolvedValue([]),
                        })),
                    })),
                };
            }

            if (mocks.state.selectCall === 2) {
                return {
                    from: vi.fn(() => ({
                        where: vi.fn(() => ({
                            limit: vi.fn().mockResolvedValue([{
                                id: 'team_123',
                                name: 'Growth Team',
                                stripePriceId: 'price_starter',
                                billingEmail: 'billing@example.com',
                                ownerUserId: 'user_owner',
                            }]),
                        })),
                    })),
                };
            }

            return {
                from: vi.fn(() => ({
                    innerJoin: vi.fn(() => ({
                        where: vi.fn().mockResolvedValue([
                            { email: 'admin@example.com' },
                        ]),
                    })),
                })),
            };
        });

        mocks.state.stripeClient = {
            subscriptions: {
                retrieve: vi.fn().mockResolvedValue({
                    id: 'sub_123',
                    status: 'past_due',
                    items: {
                        data: [{
                            price: {
                                id: 'price_growth',
                                nickname: 'Growth',
                                metadata: { plan_name: 'growth' },
                            },
                        }],
                    },
                }),
            },
            invoices: {
                retrieve: vi.fn(),
            },
        };
    });

    it('emails the payment link without clearing the paid plan on upgrade authentication', async () => {
        await handleWebhookEvent({
            id: 'evt_payment_action',
            type: 'invoice.payment_action_required',
            data: {
                object: {
                    id: 'in_123',
                    subscription: 'sub_123',
                    billing_reason: 'subscription_update',
                    amount_due: 1500,
                    amount_remaining: 1500,
                    currency: 'usd',
                    customer_email: 'stripe-customer@example.com',
                    hosted_invoice_url: 'https://invoice.stripe.test/in_123',
                    lines: {
                        data: [{
                            price: {
                                nickname: 'Growth',
                                metadata: { plan_name: 'growth' },
                            },
                        }],
                    },
                },
            },
        } as any);

        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            paymentFailedAt: expect.any(Date),
            updatedAt: expect.any(Date),
        }));
        expect(mocks.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
            stripePriceId: null,
        }));
        expect(mocks.invalidateSessionCache).toHaveBeenCalledWith('team_123');
        expect(mocks.sendPaymentActionRequiredEmail).toHaveBeenCalledWith(
            ['admin@example.com', 'billing@example.com', 'stripe-customer@example.com'],
            {
                teamName: 'Growth Team',
                planName: 'Growth',
                amountDueCents: 1500,
                currency: 'usd',
                invoiceUrl: 'https://invoice.stripe.test/in_123',
            },
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
            id: 'evt_payment_action',
            type: 'invoice.payment_action_required',
        }));
    });
});
