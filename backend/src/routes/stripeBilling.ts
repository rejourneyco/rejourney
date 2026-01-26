/**
 * Stripe Billing Routes
 * 
 * Stripe-specific billing endpoints:
 * - Customer setup
 * - Payment methods  
 * - Billing portal
 * - Free tier status (session-based)
 * - Plan management (via Stripe Products)
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, users, teams } from '../db/client.js';
import { logger } from '../logger.js';
import { isSelfHosted, config } from '../config.js';
import { sessionAuth, requireTeamAccess, requireBillingAdmin, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { adminRateLimiter } from '../middleware/rateLimit.js';
import { teamIdParamSchema } from '../validation/teams.js';
import {
    isStripeEnabled,
    getOrCreateCustomer,
    attachPaymentMethod,
    detachPaymentMethod,
    customerHasPaymentMethods,
    listPaymentMethods,
    createBillingPortalSession,
    createSetupIntent,
} from '../services/stripe.js';
import {
    FREE_TIER_SESSIONS,
    isFreeTierExhausted,
    getTeamBillingPeriodDates,
} from '../utils/billing.js';
import {
    getStripePlans,
    getStripePlan,
    getTeamSubscription,
    previewPlanChange,
    executePlanChange,
    createCheckoutSession,
    cancelSubscription,
    type StripePlan,
} from '../services/stripeProducts.js';
import { getTeamSessionUsage } from '../services/quotaCheck.js';

const router = Router();

// =============================================================================
// Stripe Status
// =============================================================================

/**
 * Check Stripe status
 * GET /api/teams/:teamId/billing/stripe/status
 */
router.get(
    '/:teamId/billing/stripe/status',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

        // Check payment method - fallback to Stripe if not in local DB
        let hasPaymentMethod = !!team?.stripePaymentMethodId;
        if (!hasPaymentMethod && team?.stripeCustomerId) {
            hasPaymentMethod = await customerHasPaymentMethods(team.stripeCustomerId);
        }

        res.json({
            enabled: isStripeEnabled(),
            selfHosted: isSelfHosted,
            hasCustomer: !!team?.stripeCustomerId,
            hasPaymentMethod,
            paymentFailed: !!team?.paymentFailedAt,
            hasSubscription: !!team?.stripeSubscriptionId,
        });
    })
);

// =============================================================================
// Customer Setup
// =============================================================================

/**
 * Initialize Stripe customer for a team
 * POST /api/teams/:teamId/billing/stripe/setup
 */
router.post(
    '/:teamId/billing/stripe/setup',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    adminRateLimiter,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;
        const userId = req.user!.id;

        // Get team and user info
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!team || !user) {
            throw ApiError.notFound('Team or user not found');
        }

        // Use team billing email or user email
        const email = team.billingEmail || user.email;
        const teamName = team.name || `Team ${teamId}`;

        const customerId = await getOrCreateCustomer(teamId, email, teamName);

        if (!customerId) {
            throw ApiError.internal('Failed to create Stripe customer');
        }

        logger.info({ teamId, userId, customerId }, 'Stripe customer created/retrieved');

        res.json({
            success: true,
            customerId,
        });
    })
);

// =============================================================================
// Payment Methods
// =============================================================================

/**
 * List payment methods for a team
 * GET /api/teams/:teamId/billing/stripe/payment-methods
 */
router.get(
    '/:teamId/billing/stripe/payment-methods',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;

        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

        if (!team?.stripeCustomerId) {
            res.json({ paymentMethods: [], defaultPaymentMethodId: null });
            return;
        }

        const paymentMethods = await listPaymentMethods(team.stripeCustomerId);

        res.json({
            paymentMethods: paymentMethods.map(pm => ({
                id: pm.id,
                type: pm.type,
                // Card details
                brand: pm.card?.brand,
                last4: pm.card?.last4,
                expiryMonth: pm.card?.exp_month,
                expiryYear: pm.card?.exp_year,
                // Link details
                email: pm.link?.email,
                isDefault: pm.id === team.stripePaymentMethodId,
            })),
            defaultPaymentMethodId: team.stripePaymentMethodId,
        });
    })
);

/**
 * Attach a payment method to a team
 * POST /api/teams/:teamId/billing/stripe/payment-methods
 */
router.post(
    '/:teamId/billing/stripe/payment-methods',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    adminRateLimiter,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;
        const { paymentMethodId } = req.body;

        if (!paymentMethodId) {
            throw ApiError.badRequest('paymentMethodId is required');
        }

        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

        if (!team?.stripeCustomerId) {
            throw ApiError.badRequest('Team does not have a Stripe customer. Run setup first.');
        }

        await attachPaymentMethod(team.stripeCustomerId, paymentMethodId, teamId);

        logger.info({ teamId, paymentMethodId }, 'Payment method attached');

        res.json({ success: true });
    })
);

/**
 * Create a SetupIntent for adding a payment method via Stripe Elements
 * POST /api/teams/:teamId/billing/stripe/setup-intent
 */
router.post(
    '/:teamId/billing/stripe/setup-intent',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    adminRateLimiter,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;

        // Get or create Stripe customer first
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);

        if (!team || !user) {
            throw ApiError.notFound('Team or user not found');
        }

        // Ensure customer exists
        let customerId = team.stripeCustomerId;
        if (!customerId) {
            const email = team.billingEmail || user.email;
            const teamName = team.name || `Team ${teamId}`;
            customerId = await getOrCreateCustomer(teamId, email, teamName);

            if (!customerId) {
                throw ApiError.internal('Failed to create Stripe customer');
            }
        }

        // Create SetupIntent
        const result = await createSetupIntent(customerId, teamId);

        if (!result) {
            throw ApiError.internal('Failed to create setup intent');
        }

        res.json({
            clientSecret: result.clientSecret,
        });
    })
);

/**
 * Remove a payment method
 * DELETE /api/teams/:teamId/billing/stripe/payment-methods/:paymentMethodId
 */
router.delete(
    '/:teamId/billing/stripe/payment-methods/:paymentMethodId',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    adminRateLimiter,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;
        const { paymentMethodId } = req.params;

        await detachPaymentMethod(paymentMethodId, teamId);

        logger.info({ teamId, paymentMethodId }, 'Payment method removed');

        res.json({ success: true });
    })
);

// =============================================================================
// Billing Portal
// =============================================================================

/**
 * Create Stripe Billing Portal session
 * POST /api/teams/:teamId/billing/stripe/portal
 */
router.post(
    '/:teamId/billing/stripe/portal',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;
        const { returnUrl } = req.body;

        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

        if (!team?.stripeCustomerId) {
            throw ApiError.badRequest('Team does not have a Stripe customer');
        }

        const defaultReturnUrl = `${config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080'}/dashboard/billing`;
        const portalUrl = await createBillingPortalSession(
            team.stripeCustomerId,
            returnUrl || defaultReturnUrl
        );

        if (!portalUrl) {
            throw ApiError.internal('Failed to create billing portal session');
        }

        res.json({ url: portalUrl });
    })
);

// =============================================================================
// Checkout Session (for new subscriptions)
// =============================================================================

/**
 * Create a Stripe Checkout Session for subscribing to a plan
 * POST /api/teams/:teamId/billing/checkout
 */
router.post(
    '/:teamId/billing/checkout',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    asyncHandler(async (req, res) => {
        if (isSelfHosted || !isStripeEnabled()) {
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const teamId = req.params.teamId;
        const { planName } = req.body;

        if (!planName) {
            throw ApiError.badRequest('planName is required');
        }

        // Look up the plan by name to get the priceId
        const plan = await getStripePlan(planName);
        if (!plan) {
            throw ApiError.badRequest(`Plan not found: ${planName}`);
        }

        const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
        const successUrl = `${baseUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${baseUrl}/settings/billing?canceled=true`;

        const result = await createCheckoutSession(teamId, plan.priceId, successUrl, cancelUrl);

        if (!result) {
            throw ApiError.internal('Failed to create checkout session');
        }

        res.json({
            sessionId: result.sessionId,
            url: result.url,
        });
    })
);

// =============================================================================
// Free Tier Status (User-Level, Session-Based)
// =============================================================================

/**
 * Get free tier usage for current user (account owner)
 * Free tier combines sessions from all free teams owned by the account owner
 * GET /api/billing/free-tier
 */
router.get(
    '/free-tier',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const userId = req.user!.id;

        // Get all teams owned by this user
        const ownedTeams = await db
            .select({
                id: teams.id,
                stripeSubscriptionId: teams.stripeSubscriptionId,
                billingCycleAnchor: teams.billingCycleAnchor,
            })
            .from(teams)
            .where(eq(teams.ownerUserId, userId));

        // Filter to only free teams (no active subscription)
        const freeTeamIds = ownedTeams
            .filter(team => !team.stripeSubscriptionId)
            .map(team => team.id);

        // Calculate total sessions across all free teams
        // Each team uses its own billing period based on its anchor
        let totalSessionsUsed = 0;

        if (freeTeamIds.length > 0) {
            // Calculate free tier usage across all free teams
            const { calculateOwnerFreeTierUsage } = await import('../services/quotaCheck.js');
            totalSessionsUsed = await calculateOwnerFreeTierUsage(userId);
        }

        const sessionsRemaining = Math.max(0, FREE_TIER_SESSIONS - totalSessionsUsed);
        const percentUsed = Math.min(100, Math.round((totalSessionsUsed / FREE_TIER_SESSIONS) * 100));

        res.json({
            freeTierSessions: FREE_TIER_SESSIONS,
            sessionsUsed: totalSessionsUsed,
            sessionsRemaining,
            percentUsed,
            isExhausted: isFreeTierExhausted(totalSessionsUsed),
            freeTeamCount: freeTeamIds.length,
            totalOwnedTeamCount: ownedTeams.length,
        });
    })
);

/**
 * Get whether a user can record (based on team plan and session limits)
 */
export async function canUserRecord(userId: string, teamId: string): Promise<{
    canRecord: boolean;
    reason?: string;
    sessionsRemaining: number;
    hasPaymentMethod: boolean;
}> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    if (!user || !team) {
        return { canRecord: false, reason: 'User or team not found', sessionsRemaining: 0, hasPaymentMethod: false };
    }

    const hasPaymentMethod = !!team.stripePaymentMethodId;
    const paymentFailed = !!team.paymentFailedAt;

    if (paymentFailed) {
        return {
            canRecord: false,
            reason: 'Payment failed - please update your payment method',
            sessionsRemaining: 0,
            hasPaymentMethod,
        };
    }

    const usage = await getTeamSessionUsage(teamId);

    if (usage.isAtLimit) {
        return {
            canRecord: false,
            reason: `Session limit reached (${usage.sessionsUsed}/${usage.sessionLimit}). Please upgrade your plan.`,
            sessionsRemaining: 0,
            hasPaymentMethod,
        };
    }

    return {
        canRecord: true,
        sessionsRemaining: usage.sessionsRemaining,
        hasPaymentMethod,
    };
}

// =============================================================================
// Plan Management (Stripe Products)
// =============================================================================

/**
 * Get all available billing plans (from Stripe)
 * GET /api/billing/plans?forceRefresh=true
 */
router.get(
    '/plans',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const forceRefresh = req.query.forceRefresh === 'true';

        if (forceRefresh) {
            logger.info('Force refreshing Stripe plans cache');
        }

        const plans = await getStripePlans(forceRefresh);

        logger.debug({
            planCount: plans.length,
            planNames: plans.map(p => p.name)
        }, 'Returning available plans');

        res.json({
            plans: plans.map((plan: StripePlan) => ({
                priceId: plan.priceId,
                productId: plan.productId,
                name: plan.name,
                displayName: plan.displayName,
                priceCents: plan.priceCents,
                sessionLimit: plan.sessionLimit,
                interval: plan.interval,
                isCustom: plan.isCustom,
            })),
        });
    })
);

/**
 * Get current subscription for a team
 * GET /api/teams/:teamId/billing/plan
 */
router.get(
    '/:teamId/billing/plan',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        // Get team's billing cycle anchor
        const [team] = await db
            .select({ billingCycleAnchor: teams.billingCycleAnchor })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        const billingPeriod = getTeamBillingPeriodDates(team?.billingCycleAnchor ?? null);

        // Get team's subscription from Stripe
        const subscription = await getTeamSubscription(teamId);

        // Invalidate session cache to ensure fresh plan data
        try {
            const { invalidateSessionCache } = await import('../services/quotaCheck.js');
            await invalidateSessionCache(teamId);
        } catch (err) {
            // Don't fail if cache invalidation fails
            logger.warn({ err, teamId }, 'Failed to invalidate session cache');
        }

        // Get current session usage
        const usage = await getTeamSessionUsage(teamId);

        // Avoid stale responses (browser 304/ETag caching)
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');

        res.json({
            plan: {
                priceId: subscription.priceId,
                productId: subscription.productId,
                planName: subscription.planName,
                displayName: subscription.displayName,
                priceCents: subscription.priceCents,
                sessionLimit: subscription.sessionLimit,
                isCustom: subscription.isCustom,
                subscriptionId: subscription.subscriptionId,
                subscriptionStatus: subscription.subscriptionStatus,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                scheduledPriceId: subscription.scheduledPriceId,
                scheduledPlanName: subscription.scheduledPlanName,
            },
            usage: {
                sessionsUsed: usage.sessionsUsed,
                sessionLimit: usage.sessionLimit,
                sessionsRemaining: usage.sessionsRemaining,
                percentUsed: usage.percentUsed,
                isAtLimit: usage.isAtLimit,
                isNearLimit: usage.isNearLimit,
            },
            billingCycle: {
                start: subscription.currentPeriodStart?.toISOString() || billingPeriod.start.toISOString(),
                end: subscription.currentPeriodEnd?.toISOString() || billingPeriod.end.toISOString(),
                period: billingPeriod.periodString,
            },
        });
    })
);

/**
 * Preview a plan change
 * POST /api/teams/:teamId/billing/plan/preview
 */
router.post(
    '/:teamId/billing/plan/preview',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;
        const { planName } = req.body;

        if (!planName) {
            throw ApiError.badRequest('planName is required');
        }

        try {
            const preview = await previewPlanChange(teamId, planName);
            res.json(preview);
        } catch (err: any) {
            logger.error({ err, teamId, planName }, 'Failed to preview plan change');
            // Re-throw as ApiError for proper error handling
            if (err instanceof ApiError) {
                throw err;
            }
            throw ApiError.internal(err.message || 'Failed to preview plan change');
        }
    })
);

/**
 * Execute a plan change
 * PUT /api/teams/:teamId/billing/plan
 */
router.put(
    '/:teamId/billing/plan',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    adminRateLimiter,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;
        const { planName, confirmed } = req.body;
        const userId = (req as any).user?.id;

        if (!planName) {
            throw ApiError.badRequest('planName is required');
        }

        if (!confirmed) {
            throw ApiError.badRequest('Plan change must be confirmed. Use preview endpoint first.');
        }

        const result = await executePlanChange(teamId, planName, userId);

        logger.info({
            teamId,
            planName,
            changeType: result.changeType,
            userId,
        }, 'Plan change executed');

        res.json(result);
    })
);

/**
 * Cancel subscription (at period end)
 * DELETE /api/teams/:teamId/billing/subscription
 */
router.delete(
    '/:teamId/billing/subscription',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireBillingAdmin,
    adminRateLimiter,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;
        const { immediate } = req.body;

        await cancelSubscription(teamId, immediate === true);

        logger.info({ teamId, immediate }, 'Subscription canceled');

        res.json({ success: true });
    })
);

export default router;
