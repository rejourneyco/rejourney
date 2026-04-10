import { describe, expect, it } from 'vitest';

import {
    derivePlanChangePreviewState,
    type StripePlan,
    type TeamSubscriptionInfo,
} from '../services/stripeProducts.js';

const freeSubscription: TeamSubscriptionInfo = {
    teamId: 'team_123',
    priceId: null,
    productId: null,
    planName: 'free',
    displayName: 'Free',
    sessionLimit: 5000,
    videoRetentionTier: 1,
    videoRetentionDays: 7,
    videoRetentionLabel: '7 days',
    priceCents: 0,
    isCustom: false,
    subscriptionId: null,
    subscriptionStatus: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    scheduledPriceId: null,
    scheduledPlanName: null,
};

const starterPlan: StripePlan = {
    priceId: 'price_starter',
    productId: 'prod_starter',
    name: 'starter',
    displayName: 'Starter',
    sessionLimit: 25000,
    videoRetentionTier: 2,
    videoRetentionDays: 14,
    videoRetentionLabel: '14 days',
    priceCents: 500,
    interval: 'month',
    isCustom: false,
    sortOrder: 1,
};

describe('derivePlanChangePreviewState', () => {
    it('treats first-time paid subscriptions as checkout-based new plans', () => {
        const result = derivePlanChangePreviewState(
            freeSubscription,
            starterPlan,
            starterPlan.priceId,
            false,
        );

        expect(result.changeType).toBe('new');
        expect(result.requiresPaymentMethod).toBe(false);
        expect(result.chargeAmountCents).toBe(500);
        expect(result.warnings).toContain(
            "You'll enter payment details and confirm any required authentication in secure Stripe Checkout."
        );
    });

    it('still requires a saved payment method for in-app paid upgrades', () => {
        const currentSub: TeamSubscriptionInfo = {
            ...freeSubscription,
            priceId: 'price_growth',
            productId: 'prod_growth',
            planName: 'growth',
            displayName: 'Growth',
            sessionLimit: 100000,
            videoRetentionTier: 3,
            videoRetentionDays: 30,
            videoRetentionLabel: '30 days',
            priceCents: 1500,
            subscriptionId: 'sub_123',
            subscriptionStatus: 'active',
            currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
        };

        const proPlan: StripePlan = {
            ...starterPlan,
            priceId: 'price_pro',
            productId: 'prod_pro',
            name: 'pro',
            displayName: 'Pro',
            sessionLimit: 350000,
            videoRetentionTier: 4,
            videoRetentionDays: 60,
            videoRetentionLabel: '60 days',
            priceCents: 3500,
            sortOrder: 3,
        };

        const result = derivePlanChangePreviewState(
            currentSub,
            proPlan,
            proPlan.priceId,
            false,
        );

        expect(result.changeType).toBe('upgrade');
        expect(result.requiresPaymentMethod).toBe(true);
        expect(result.warnings).toContain('You must add a payment method before upgrading to a paid plan.');
    });
});
