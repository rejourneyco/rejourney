import { ApiError } from '../middleware/errorHandler.js';
import { isStripeEnabled, syncCheckoutSessionForTeam } from './stripe.js';
import {
    createCheckoutSession,
    getStripePlan,
    previewPlanChange,
} from './stripeProducts.js';

export async function createHostedCheckoutForTeam({
    teamId,
    planName,
    successUrl,
    cancelUrl,
}: {
    teamId: string;
    planName: string;
    successUrl: string;
    cancelUrl: string;
}): Promise<{ sessionId: string; url: string }> {
    if (!isStripeEnabled()) {
        throw ApiError.serviceUnavailable('Stripe is not enabled');
    }

    if (!planName) {
        throw ApiError.badRequest('planName is required');
    }

    if (!successUrl || !cancelUrl) {
        throw ApiError.badRequest('successUrl and cancelUrl are required');
    }

    const plan = await getStripePlan(planName);
    if (!plan) {
        throw ApiError.badRequest(`Plan not found: ${planName}`);
    }

    if (plan.priceCents <= 0) {
        throw ApiError.badRequest('Checkout is only available for paid plans');
    }

    const preview = await previewPlanChange(teamId, plan.priceId);
    if (preview.changeType !== 'new') {
        throw ApiError.badRequest('Hosted checkout is only available for first-time paid subscriptions');
    }

    const result = await createCheckoutSession(teamId, plan.priceId, successUrl, cancelUrl);
    if (!result) {
        throw ApiError.internal('Failed to create checkout session');
    }

    return result;
}

export async function completeHostedCheckoutForTeam({
    teamId,
    sessionId,
}: {
    teamId: string;
    sessionId: string;
}): Promise<{
    success: boolean;
    provisioned: boolean;
    subscriptionStatus: string | null;
    subscriptionId: string | null;
    customerId: string | null;
}> {
    if (!isStripeEnabled()) {
        throw ApiError.serviceUnavailable('Stripe is not enabled');
    }

    if (!sessionId) {
        throw ApiError.badRequest('sessionId is required');
    }

    try {
        const result = await syncCheckoutSessionForTeam(teamId, sessionId);
        return {
            success: true,
            provisioned: result.provisioned,
            subscriptionStatus: result.subscriptionStatus,
            subscriptionId: result.subscriptionId,
            customerId: result.customerId,
        };
    } catch (err: any) {
        throw ApiError.badRequest(err?.message || 'Failed to complete checkout session');
    }
}
