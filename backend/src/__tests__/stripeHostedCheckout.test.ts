import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isStripeEnabled: vi.fn(),
    syncCheckoutSessionForTeam: vi.fn(),
    getStripePlan: vi.fn(),
    previewPlanChange: vi.fn(),
    createCheckoutSession: vi.fn(),
}));

vi.mock('../services/stripe.js', () => ({
    isStripeEnabled: mocks.isStripeEnabled,
    syncCheckoutSessionForTeam: mocks.syncCheckoutSessionForTeam,
}));

vi.mock('../services/stripeProducts.js', () => ({
    getStripePlan: mocks.getStripePlan,
    previewPlanChange: mocks.previewPlanChange,
    createCheckoutSession: mocks.createCheckoutSession,
}));

import { ApiError } from '../middleware/errorHandler.js';
import {
    completeHostedCheckoutForTeam,
    createHostedCheckoutForTeam,
} from '../services/stripeHostedCheckout.js';

describe('createHostedCheckoutForTeam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isStripeEnabled.mockReturnValue(true);
        mocks.getStripePlan.mockResolvedValue({
            priceId: 'price_starter',
            priceCents: 500,
        });
        mocks.previewPlanChange.mockResolvedValue({
            changeType: 'new',
        });
        mocks.createCheckoutSession.mockResolvedValue({
            sessionId: 'cs_test_123',
            url: 'https://checkout.stripe.com/test/session',
        });
        mocks.syncCheckoutSessionForTeam.mockResolvedValue({
            sessionId: 'cs_test_123',
            teamId: 'team_123',
            customerId: 'cus_123',
            subscriptionId: 'sub_123',
            subscriptionStatus: 'active',
            provisioned: true,
        });
    });

    it('passes plan and caller-provided return URLs through to Stripe checkout', async () => {
        const result = await createHostedCheckoutForTeam({
            teamId: 'team_123',
            planName: 'starter',
            successUrl: 'https://app.rejourney.test/dashboard/billing/return?flow=checkout&status=success',
            cancelUrl: 'https://app.rejourney.test/dashboard/billing/return?flow=checkout&status=canceled',
        });

        expect(mocks.getStripePlan).toHaveBeenCalledWith('starter');
        expect(mocks.previewPlanChange).toHaveBeenCalledWith('team_123', 'price_starter');
        expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
            'team_123',
            'price_starter',
            'https://app.rejourney.test/dashboard/billing/return?flow=checkout&status=success',
            'https://app.rejourney.test/dashboard/billing/return?flow=checkout&status=canceled',
        );
        expect(result).toEqual({
            sessionId: 'cs_test_123',
            url: 'https://checkout.stripe.com/test/session',
        });
    });

    it('rejects non-new subscription changes', async () => {
        mocks.previewPlanChange.mockResolvedValue({
            changeType: 'upgrade',
        });

        await expect(createHostedCheckoutForTeam({
            teamId: 'team_123',
            planName: 'starter',
            successUrl: 'https://app.rejourney.test/success',
            cancelUrl: 'https://app.rejourney.test/cancel',
        })).rejects.toMatchObject({
            statusCode: 400,
            message: 'Hosted checkout is only available for first-time paid subscriptions',
        } satisfies Partial<ApiError>);
    });

    it('syncs a completed checkout session back into the team state', async () => {
        const result = await completeHostedCheckoutForTeam({
            teamId: 'team_123',
            sessionId: 'cs_test_123',
        });

        expect(mocks.syncCheckoutSessionForTeam).toHaveBeenCalledWith('team_123', 'cs_test_123');
        expect(result).toEqual({
            success: true,
            provisioned: true,
            subscriptionStatus: 'active',
            subscriptionId: 'sub_123',
            customerId: 'cus_123',
        });
    });
});
