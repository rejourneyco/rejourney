/**
 * Stripe Products Billing Service
 * 
 * Handles all billing operations using Stripe Products/Prices as the source of truth.
 * This replaces the old hardcoded BILLING_PLANS and database-driven plans.
 * 
 * Key concepts:
 * - Plans are Stripe Products with associated Prices
 * - Session limits are stored in Stripe Price metadata (session_limit)
 * - Subscriptions track which Price a team is on
 * - Custom enterprise pricing uses custom Stripe Prices
 */

import Stripe from 'stripe';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { config, isSelfHosted } from '../config.js';
import { logger } from '../logger.js';
import { db, teams, projects, projectUsage, users, teamMembers } from '../db/client.js';
import { getTeamBillingPeriod } from '../utils/billing.js';
import { ApiError } from '../middleware/errorHandler.js';

// =============================================================================
// Types
// =============================================================================

export interface StripePlan {
    priceId: string;
    productId: string;
    name: string;           // Product name (e.g., 'Starter')
    displayName: string;    // Display name
    sessionLimit: number;   // From price metadata
    priceCents: number;     // Unit amount
    interval: 'month' | 'year';
    isCustom: boolean;      // Custom enterprise price
    sortOrder: number;      // For display ordering
}

export interface TeamSubscriptionInfo {
    teamId: string;
    priceId: string | null;
    productId: string | null;
    planName: string;
    displayName: string;
    sessionLimit: number;
    priceCents: number;
    isCustom: boolean;
    subscriptionId: string | null;
    subscriptionStatus: string | null;  // 'active', 'past_due', 'canceled', etc.
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    scheduledPriceId: string | null;    // If there's a pending plan change
    scheduledPlanName: string | null;    // Plan name of scheduled change
}

export interface PlanChangePreview {
    currentPlan: StripePlan; // Always present (free plan if no subscription)
    newPlan: StripePlan;
    changeType: 'upgrade' | 'downgrade' | 'same' | 'new';
    chargeAmountCents: number;
    creditAmountCents: number;
    effectiveDate: Date;
    isImmediate: boolean;
    requiresPaymentMethod: boolean;
    hasPaymentMethod: boolean;
    currentUsage: {
        sessionsUsed: number;
        sessionLimit: number;
        daysRemainingInCycle: number;
    };
    warnings: string[];
}

export interface PlanChangeResult {
    success: boolean;
    subscriptionId: string;
    plan: StripePlan;
    changeType: 'upgrade' | 'downgrade' | 'new';
    effectiveDate: Date;
    isImmediate: boolean;
    message: string;
}

// =============================================================================
// Constants
// =============================================================================

// Free tier session limit (for users without a subscription)
export const FREE_TIER_SESSIONS = 5000;

// Standard plan names for ordering
const PLAN_ORDER = ['free', 'starter', 'growth', 'pro'];

// Cache for Stripe prices (refreshed periodically)
let priceCache: StripePlan[] | null = null;
let priceCacheExpiry: number = 0;
const PRICE_CACHE_TTL_MS = 1 * 60 * 1000; // 1 minutes

// =============================================================================
// Stripe Client
// =============================================================================

let stripe: Stripe | null = null;

function getStripe(): Stripe | null {
    if (isSelfHosted) return null;

    if (!config.STRIPE_SECRET_KEY) {
        logger.warn('STRIPE_SECRET_KEY not configured - Stripe disabled');
        return null;
    }

    if (!stripe) {
        stripe = new Stripe(config.STRIPE_SECRET_KEY, {
            apiVersion: '2023-10-16' as any,
            typescript: true,
        });
    }

    return stripe;
}

export function isStripeEnabled(): boolean {
    return getStripe() !== null;
}

// =============================================================================
// Plan Retrieval (from Stripe)
// =============================================================================

/**
 * Fetch all active billing plans from Stripe
 * Plans are Products with active Prices that have session_limit metadata
 */
export async function getStripePlans(forceRefresh = false): Promise<StripePlan[]> {
    // Return cached if valid
    if (!forceRefresh && priceCache && Date.now() < priceCacheExpiry) {
        return priceCache;
    }

    const client = getStripe();
    if (!client) {
        // In self-hosted mode, return a single free plan
        return [getFreePlan()];
    }

    try {
        // Fetch active prices with their products
        const prices = await client.prices.list({
            active: true,
            expand: ['data.product'],
            limit: 100,
        });

        const plans: StripePlan[] = [];

        for (const price of prices.data) {
            // Skip prices without session_limit metadata
            const sessionLimit = price.metadata?.session_limit;
            if (!sessionLimit) {
                logger.debug({ priceId: price.id, priceName: price.nickname }, 'Skipping price without session_limit metadata');
                continue;
            }

            // Get product info
            const product = price.product as Stripe.Product;
            if (!product || typeof product === 'string') {
                logger.debug({ priceId: price.id }, 'Skipping price with invalid product');
                continue;
            }

            if (!product.active) {
                logger.debug({ priceId: price.id, productId: product.id, productName: product.name }, 'Skipping inactive product');
                continue;
            }

            // Get plan name from product metadata, price metadata, or product name
            // Check both product and price metadata (some setups use price metadata)
            const planName = product.metadata?.plan_name
                || price.metadata?.plan_name
                || product.name.toLowerCase();

            // Determine sort order from metadata or name
            let sortOrder = parseInt(product.metadata?.sort_order || price.metadata?.sort_order || '99');
            if (sortOrder === 99) {
                const idx = PLAN_ORDER.indexOf(planName);
                sortOrder = idx >= 0 ? idx : 99;
            }

            // Use plan_name from metadata for display, fallback to capitalized planName
            const displayName = product.metadata?.plan_name
                ? product.metadata.plan_name.charAt(0).toUpperCase() + product.metadata.plan_name.slice(1)
                : price.metadata?.plan_name
                    ? price.metadata.plan_name.charAt(0).toUpperCase() + price.metadata.plan_name.slice(1)
                    : planName.charAt(0).toUpperCase() + planName.slice(1);

            const plan: StripePlan = {
                priceId: price.id,
                productId: product.id,
                name: planName,
                displayName: displayName,
                sessionLimit: parseInt(sessionLimit),
                priceCents: price.unit_amount || 0,
                interval: price.recurring?.interval === 'year' ? 'year' : 'month',
                isCustom: product.metadata?.is_custom === 'true' || price.metadata?.is_custom === 'true',
                sortOrder,
            };

            logger.debug({
                priceId: price.id,
                planName: plan.name,
                productName: product.name,
                sessionLimit: plan.sessionLimit,
                priceCents: plan.priceCents
            }, 'Found Stripe plan');

            plans.push(plan);
        }

        // Sort by sort order
        plans.sort((a, b) => a.sortOrder - b.sortOrder);

        // Add free plan at the start if not present
        if (!plans.some(p => p.priceCents === 0)) {
            plans.unshift(getFreePlan());
        }

        // Cache the result
        priceCache = plans;
        priceCacheExpiry = Date.now() + PRICE_CACHE_TTL_MS;

        logger.info({
            planCount: plans.length,
            plans: plans.map(p => ({ name: p.name, priceId: p.priceId, sessionLimit: p.sessionLimit }))
        }, 'Fetched Stripe plans');
        return plans;

    } catch (err) {
        logger.error({ err }, 'Failed to fetch Stripe plans');
        // Return cached if available, otherwise just free plan
        return priceCache || [getFreePlan()];
    }
}

/**
 * Get a specific plan by price ID or name
 */
export async function getStripePlan(priceIdOrName: string): Promise<StripePlan | null> {
    const plans = await getStripePlans();

    logger.debug({
        searchTerm: priceIdOrName,
        availablePlans: plans.map(p => ({ name: p.name, priceId: p.priceId }))
    }, 'Searching for Stripe plan');

    // Try by price ID first
    let plan = plans.find(p => p.priceId === priceIdOrName);
    if (plan) {
        logger.debug({ priceIdOrName, foundPlan: plan.name }, 'Found plan by price ID');
        return plan;
    }

    // Try by name (case-insensitive)
    const searchName = priceIdOrName.toLowerCase().trim();
    plan = plans.find(p => p.name.toLowerCase().trim() === searchName);

    if (plan) {
        logger.debug({ priceIdOrName, foundPlan: plan.name }, 'Found plan by name');
        return plan;
    }

    logger.warn({
        priceIdOrName,
        availablePlans: plans.map(p => p.name),
        availablePriceIds: plans.map(p => p.priceId)
    }, 'Plan not found');

    return null;
}

/**
 * Get the free plan (virtual - no Stripe Price)
 */
function getFreePlan(): StripePlan {
    return {
        priceId: 'free',
        productId: 'free',
        name: 'free',
        displayName: 'Free',
        sessionLimit: FREE_TIER_SESSIONS,
        priceCents: 0,
        interval: 'month',
        isCustom: false,
        sortOrder: 0,
    };
}

/**
 * Invalidate the price cache
 */
export function invalidatePriceCache(): void {
    priceCache = null;
    priceCacheExpiry = 0;
}

// =============================================================================
// Team Subscription Management
// =============================================================================

/**
 * Get subscription info for a team
 */
export async function getTeamSubscription(teamId: string): Promise<TeamSubscriptionInfo> {
    const client = getStripe();

    // Get team from database
    const [team] = await db
        .select({
            id: teams.id,
            stripeSubscriptionId: teams.stripeSubscriptionId,
            stripePriceId: teams.stripePriceId,
            stripeCustomerId: teams.stripeCustomerId,
            stripePaymentMethodId: teams.stripePaymentMethodId,
            billingCycleAnchor: teams.billingCycleAnchor,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    logger.debug({
        teamId,
        hasSubscriptionId: !!team.stripeSubscriptionId,
        subscriptionId: team.stripeSubscriptionId,
        priceId: team.stripePriceId,
        hasStripeClient: !!client,
        isStripeEnabled: isStripeEnabled()
    }, 'Getting team subscription');

    // Default to free plan
    const result: TeamSubscriptionInfo = {
        teamId,
        priceId: null,
        productId: null,
        planName: 'free',
        displayName: 'Free',
        sessionLimit: FREE_TIER_SESSIONS,
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

    // If no subscription ID, return free plan
    if (!team.stripeSubscriptionId) {
        return result;
    }

    // If Stripe is disabled but we have a price ID, try to use cached plan data
    if (!client) {
        if (team.stripePriceId && team.stripePriceId !== 'free') {
            try {
                const plan = await getStripePlan(team.stripePriceId);
                if (plan) {
                    result.priceId = plan.priceId;
                    result.productId = plan.productId;
                    result.planName = plan.name;
                    result.displayName = plan.displayName;
                    result.sessionLimit = plan.sessionLimit;
                    result.priceCents = plan.priceCents;
                    result.isCustom = plan.isCustom;
                    result.subscriptionId = team.stripeSubscriptionId;
                    result.subscriptionStatus = 'active'; // Assume active if we can't check
                    // Use billing cycle anchor for period dates if available
                    if (team.billingCycleAnchor) {
                        const anchor = new Date(team.billingCycleAnchor);
                        result.currentPeriodStart = anchor;
                        // Estimate period end (assuming monthly)
                        const periodEnd = new Date(anchor);
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                        result.currentPeriodEnd = periodEnd;
                    }
                }
            } catch (err) {
                logger.warn({ err, teamId, priceId: team.stripePriceId }, 'Failed to get plan from cache when Stripe disabled');
            }
        }
        return result;
    }

    try {
        // Fetch subscription from Stripe
        // NOTE: Stripe limits nested expands to max depth 4.
        // Keep expands shallow here; resolve schedule/price details with follow-up calls.
        const subscription = await client.subscriptions.retrieve(team.stripeSubscriptionId, {
            expand: ['items.data.price.product', 'schedule'],
        });

        logger.debug({
            teamId,
            subscriptionId: subscription.id,
            status: subscription.status,
            hasItems: subscription.items.data.length > 0
        }, 'Retrieved subscription from Stripe');

        if (subscription.status === 'canceled') {
            // Subscription was canceled, revert to free
            logger.info({ teamId, subscriptionId: subscription.id }, 'Subscription is canceled, returning free plan');
            return result;
        }

        // Get the primary subscription item
        const item = subscription.items.data[0];
        if (!item) {
            logger.warn({ teamId, subscriptionId: subscription.id }, 'Subscription has no items, falling back to DB priceId');
            // Fallback to database priceId if available
            if (team.stripePriceId && team.stripePriceId !== 'free') {
                try {
                    const plan = await getStripePlan(team.stripePriceId);
                    if (plan) {
                        result.priceId = plan.priceId;
                        result.productId = plan.productId;
                        result.planName = plan.name;
                        result.displayName = plan.displayName;
                        result.sessionLimit = plan.sessionLimit;
                        result.priceCents = plan.priceCents;
                        result.isCustom = plan.isCustom;
                        result.subscriptionId = team.stripeSubscriptionId;
                        result.subscriptionStatus = subscription.status;
                        if (team.billingCycleAnchor) {
                            const anchor = new Date(team.billingCycleAnchor);
                            result.currentPeriodStart = anchor;
                            const periodEnd = new Date(anchor);
                            periodEnd.setMonth(periodEnd.getMonth() + 1);
                            result.currentPeriodEnd = periodEnd;
                        }
                        return result;
                    }
                } catch (err) {
                    logger.warn({ err, teamId, priceId: team.stripePriceId }, 'Failed to get plan from cache');
                }
            }
            return result;
        }

        const price = item.price;
        const product = price.product as Stripe.Product;

        // Get session limit from price metadata
        const sessionLimit = parseInt(price.metadata?.session_limit || '0') || FREE_TIER_SESSIONS;

        result.priceId = price.id;
        result.productId = product.id;
        // Use plan_name from metadata for both planName and displayName
        const planNameFromMeta = product.metadata?.plan_name || price.metadata?.plan_name;
        result.planName = planNameFromMeta || product.name.toLowerCase();
        // Display name should use plan_name metadata (capitalized), not product name
        result.displayName = planNameFromMeta
            ? planNameFromMeta.charAt(0).toUpperCase() + planNameFromMeta.slice(1)
            : product.name;
        result.sessionLimit = sessionLimit;
        result.priceCents = price.unit_amount || 0;
        result.isCustom = product.metadata?.is_custom === 'true';
        result.subscriptionId = subscription.id;
        result.subscriptionStatus = subscription.status;
        result.currentPeriodStart = new Date((subscription as any).current_period_start * 1000);
        result.currentPeriodEnd = new Date((subscription as any).current_period_end * 1000);
        result.cancelAtPeriodEnd = subscription.cancel_at_period_end;

        // Check for scheduled changes
        let schedule: Stripe.SubscriptionSchedule | null = null;
        if (subscription.schedule) {
            if (typeof subscription.schedule === 'string') {
                // Stripe may still return an ID here; retrieve explicitly
                try {
                    schedule = await client.subscriptionSchedules.retrieve(subscription.schedule, {
                        // Keep expand shallow (no product). We'll resolve plan name via getStripePlan(priceId).
                        expand: ['phases.items.price'],
                    });
                } catch (err) {
                    logger.warn({ err, teamId, scheduleId: subscription.schedule }, 'Failed to retrieve subscription schedule');
                }
            } else {
                schedule = subscription.schedule as Stripe.SubscriptionSchedule;
            }
        }

        logger.debug(
            {
                teamId,
                subscriptionId: subscription.id,
                scheduleRefType: subscription.schedule ? typeof subscription.schedule : null,
                scheduleId: schedule?.id || null,
                schedulePhasesCount: schedule?.phases?.length ?? 0,
            },
            'Stripe subscription schedule inspection'
        );

        if (schedule?.phases && schedule.phases.length > 1) {
            const nextPhase = schedule.phases[1];
            const nextItem = nextPhase?.items?.[0];
            if (nextItem?.price) {
                const nextPrice = typeof nextItem.price === 'string' ? null : nextItem.price;
                const nextPriceId = nextPrice?.id || (typeof nextItem.price === 'string' ? nextItem.price : '');

                if (nextPriceId && nextPriceId !== price.id) {
                    logger.info(
                        {
                            teamId,
                            subscriptionId: subscription.id,
                            currentPriceId: price.id,
                            nextPriceId,
                        },
                        'Detected scheduled plan change from subscription schedule'
                    );
                    result.scheduledPriceId = nextPriceId;

                    // Resolve scheduled plan name by priceId (avoid deep expands).
                    try {
                        const scheduledPlan = await getStripePlan(nextPriceId);
                        result.scheduledPlanName = scheduledPlan?.name || null;
                    } catch {
                        // Fallback: if we have a non-deleted expanded price, try metadata
                        if (nextPrice && 'metadata' in nextPrice && !nextPrice.deleted) {
                            result.scheduledPlanName = nextPrice.metadata?.plan_name || null;
                        } else {
                            result.scheduledPlanName = null;
                        }
                    }
                }
            }
        }

        return result;

    } catch (err: any) {
        logger.error({
            err,
            teamId,
            subscriptionId: team.stripeSubscriptionId,
            priceId: team.stripePriceId,
            errorCode: err?.code,
            errorMessage: err?.message,
            errorType: err?.type
        }, 'Failed to fetch subscription from Stripe');

        // Fallback: If Stripe API fails but we have price ID in DB, try to use cached plan data
        if (team.stripePriceId && team.stripePriceId !== 'free') {
            try {
                const plan = await getStripePlan(team.stripePriceId);
                if (plan) {
                    logger.info({ teamId, priceId: team.stripePriceId, planName: plan.name }, 'Using cached plan data as fallback after Stripe API failure');
                    result.priceId = plan.priceId;
                    result.productId = plan.productId;
                    result.planName = plan.name;
                    result.displayName = plan.displayName;
                    result.sessionLimit = plan.sessionLimit;
                    result.priceCents = plan.priceCents;
                    result.isCustom = plan.isCustom;
                    result.subscriptionId = team.stripeSubscriptionId;
                    result.subscriptionStatus = 'active'; // Assume active if we can't check
                    // Use billing cycle anchor for period dates if available
                    if (team.billingCycleAnchor) {
                        const anchor = new Date(team.billingCycleAnchor);
                        result.currentPeriodStart = anchor;
                        // Estimate period end (assuming monthly)
                        const periodEnd = new Date(anchor);
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                        result.currentPeriodEnd = periodEnd;
                    }
                    return result;
                } else {
                    logger.warn({ teamId, priceId: team.stripePriceId }, 'Plan not found in cache for fallback');
                }
            } catch (fallbackErr) {
                logger.warn({ err: fallbackErr, teamId, priceId: team.stripePriceId }, 'Failed to get plan from cache as fallback');
            }
        } else {
            logger.warn({ teamId, hasPriceId: !!team.stripePriceId }, 'No priceId in DB for fallback');
        }

        return result;
    }
}

/**
 * Get session limit for a team
 */
export async function getTeamSessionLimit(teamId: string): Promise<number> {
    const sub = await getTeamSubscription(teamId);
    return sub.sessionLimit;
}

// =============================================================================
// Subscription Operations
// =============================================================================

/**
 * Create a Stripe Checkout Session for a new subscription
 */
export async function createCheckoutSession(
    teamId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string
): Promise<{ sessionId: string; url: string } | null> {
    const client = getStripe();
    if (!client) return null;

    // Get team info
    const [team] = await db
        .select({
            id: teams.id,
            stripeCustomerId: teams.stripeCustomerId,
            billingEmail: teams.billingEmail,
            ownerUserId: teams.ownerUserId,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    try {
        const session = await client.checkout.sessions.create({
            mode: 'subscription',
            customer: team.stripeCustomerId || undefined,
            customer_email: !team.stripeCustomerId ? team.billingEmail || undefined : undefined,
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            subscription_data: {
                metadata: {
                    teamId,
                },
            },
            metadata: {
                teamId,
            },
            allow_promotion_codes: true,
        });

        logger.info({ teamId, priceId, sessionId: session.id }, 'Checkout session created');

        return {
            sessionId: session.id,
            url: session.url!,
        };

    } catch (err) {
        logger.error({ err, teamId, priceId }, 'Failed to create checkout session');
        throw err;
    }
}

/**
 * Preview a plan change
 */
export async function previewPlanChange(
    teamId: string,
    newPriceId: string
): Promise<PlanChangePreview> {
    try {
        // Convert plan name to price ID if needed
        let plan: StripePlan | null;
        try {
            plan = await getStripePlan(newPriceId);
            if (!plan) {
                logger.error({ teamId, newPriceId }, 'Plan not found in Stripe');
                throw new Error(`Plan not found: ${newPriceId}. Make sure the plan exists in your Stripe dashboard.`);
            }
        } catch (err: any) {
            logger.error({ err, teamId, newPriceId }, 'Failed to get Stripe plan');
            throw new Error(`Failed to get plan: ${err.message}`);
        }

        const actualPriceId = plan.priceId;
        logger.debug({ teamId, planName: newPriceId, priceId: actualPriceId }, 'Resolved plan to price ID for preview');

        // Get current subscription
        let currentSub: TeamSubscriptionInfo;
        try {
            currentSub = await getTeamSubscription(teamId);
        } catch (err: any) {
            logger.error({ err, teamId }, 'Failed to get team subscription');
            throw new Error(`Failed to get current subscription: ${err.message}`);
        }

        // Use the resolved plan
        const newPlan = plan;

        // Get team for payment method check
        const [team] = await db
            .select({
                stripePaymentMethodId: teams.stripePaymentMethodId,
                stripeCustomerId: teams.stripeCustomerId,
            })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        const hasPaymentMethod = !!team?.stripePaymentMethodId;
        const requiresPaymentMethod = newPlan.priceCents > 0;

        // Determine change type
        let changeType: 'upgrade' | 'downgrade' | 'same' | 'new';
        let isImmediate = true;
        let chargeAmountCents = 0;
        const creditAmountCents = 0;

        // If no subscription, this is always a new subscription (even if going to free)
        if (!currentSub.subscriptionId) {
            // New subscription - going from free tier to a paid plan
            if (newPlan.priceCents > 0) {
                changeType = 'new';
                chargeAmountCents = newPlan.priceCents;
            } else {
                // Already on free, trying to go to free - same plan
                changeType = 'same';
            }
        } else if (currentSub.priceId === actualPriceId) {
            // Same price ID
            changeType = 'same';
        } else {
            // Check if there's already a scheduled downgrade to this same plan
            if (currentSub.scheduledPriceId === actualPriceId) {
                throw new Error(`You already have a scheduled downgrade to ${newPlan.displayName}. You cannot schedule the same plan change again.`);
            }

            // Has existing subscription - determine if upgrade or downgrade
            const currentIdx = PLAN_ORDER.indexOf(currentSub.planName);
            const newIdx = PLAN_ORDER.indexOf(newPlan.name);

            // Upgrade if: higher in plan order OR higher price OR more sessions
            const isHigherPlan = newIdx > currentIdx && newIdx >= 0 && currentIdx >= 0;
            const isHigherPrice = newPlan.priceCents > currentSub.priceCents;
            const isMoreSessions = newPlan.sessionLimit > currentSub.sessionLimit;

            if (isHigherPlan || isHigherPrice || isMoreSessions) {
                changeType = 'upgrade';
                isImmediate = true;
                chargeAmountCents = newPlan.priceCents;
            } else {
                changeType = 'downgrade';
                isImmediate = false; // Downgrades take effect at period end
            }
        }

        // Calculate days remaining
        let daysRemainingInCycle = 0;
        if (currentSub.currentPeriodEnd) {
            daysRemainingInCycle = Math.max(0, Math.ceil(
                (currentSub.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            ));
        }

        // Build warnings
        const warnings: string[] = [];

        if (changeType === 'new' || changeType === 'upgrade') {
            if (!hasPaymentMethod && requiresPaymentMethod) {
                warnings.push('You must add a payment method before subscribing to a paid plan.');
            } else if (chargeAmountCents > 0) {
                warnings.push(`You'll be charged $${(chargeAmountCents / 100).toFixed(2)} now.`);
            }
            if (changeType === 'upgrade') {
                warnings.push('Your billing cycle will reset and unused sessions will not carry over.');
            } else if (changeType === 'new') {
                warnings.push('Unused sessions from your free tier will not carry over.');
            }
        }

        if (changeType === 'downgrade') {
            warnings.push(`Your downgrade will take effect on ${currentSub.currentPeriodEnd?.toLocaleDateString() || 'the next billing cycle'}.`);
            warnings.push(`You'll keep your current ${currentSub.sessionLimit.toLocaleString()} session limit until then.`);
        }

        // Always return a currentPlan, even for free tier
        const currentPlan: StripePlan = currentSub.priceId ? {
            priceId: currentSub.priceId,
            productId: currentSub.productId!,
            name: currentSub.planName,
            displayName: currentSub.displayName,
            sessionLimit: currentSub.sessionLimit,
            priceCents: currentSub.priceCents,
            interval: 'month' as const,
            isCustom: currentSub.isCustom,
            sortOrder: PLAN_ORDER.indexOf(currentSub.planName),
        } : getFreePlan(); // Return free plan if no subscription

        return {
            currentPlan,
            newPlan,
            changeType,
            chargeAmountCents,
            creditAmountCents,
            effectiveDate: changeType === 'downgrade' && currentSub.currentPeriodEnd
                ? currentSub.currentPeriodEnd
                : new Date(),
            isImmediate,
            requiresPaymentMethod,
            hasPaymentMethod,
            currentUsage: {
                sessionsUsed: 0, // TODO: Get from billing_usage
                sessionLimit: currentSub.sessionLimit,
                daysRemainingInCycle,
            },
            warnings,
        };
    } catch (err: any) {
        logger.error({ err, teamId, newPriceId }, 'Error in previewPlanChange');
        // Re-throw with more context
        if (err.message) {
            throw err;
        }
        throw new Error(`Failed to preview plan change: ${err.message || 'Unknown error'}`);
    }
}

/**
 * Execute a plan change (upgrade or downgrade)
 */
export async function executePlanChange(
    teamId: string,
    newPriceId: string,
    confirmedByUserId: string
): Promise<PlanChangeResult> {
    const client = getStripe();
    if (!client) {
        throw new Error('Stripe is not enabled');
    }

    // Check plan change cooldown (1 minute) to prevent abuse
    const PLAN_CHANGE_COOLDOWN_MS = 1 * 60 * 1000; // 1 minute
    const { getRedis } = await import('../db/redis.js');
    const redis = getRedis();
    const cooldownKey = `plan_change_cooldown:${teamId}`;

    try {
        const lastChange = await redis.get(cooldownKey);
        if (lastChange) {
            const waitMs = PLAN_CHANGE_COOLDOWN_MS - (Date.now() - parseInt(lastChange));
            if (waitMs > 0) {
                const waitMinutes = Math.ceil(waitMs / 60000);
                throw ApiError.tooManyRequests(
                    `Please wait ${waitMinutes} minute${waitMinutes !== 1 ? 's' : ''} before making another plan change.`,
                    Math.ceil(waitMs / 1000) // retryAfter in seconds
                );
            }
        }
    } catch (err: any) {
        // If it's our own cooldown error (ApiError), rethrow it
        if (err instanceof ApiError) {
            throw err;
        }
        // Otherwise log and continue (Redis failure shouldn't block plan changes)
        logger.warn({ err, teamId }, 'Failed to check plan change cooldown');
    }

    // Convert plan name to price ID if needed
    let plan: StripePlan | null;
    try {
        plan = await getStripePlan(newPriceId);
        if (!plan) {
            logger.error({ teamId, newPriceId }, 'Plan not found in Stripe');
            throw new Error(`Plan not found: ${newPriceId}. Make sure the plan exists in your Stripe dashboard.`);
        }
    } catch (err: any) {
        logger.error({ err, teamId, newPriceId }, 'Failed to get Stripe plan');
        throw new Error(`Failed to get plan: ${err.message}`);
    }

    const actualPriceId = plan.priceId;
    logger.debug({ teamId, planName: newPriceId, priceId: actualPriceId }, 'Resolved plan to price ID');

    let preview: PlanChangePreview;
    try {
        preview = await previewPlanChange(teamId, actualPriceId);
    } catch (err: any) {
        logger.error({ err, teamId, actualPriceId }, 'Failed to preview plan change');
        throw new Error(`Failed to preview plan change: ${err.message}`);
    }

    if (preview.changeType === 'same') {
        throw new Error('You are already on this plan');
    }

    // Additional safety check: prevent scheduling downgrade to same plan already scheduled
    if (preview.changeType === 'downgrade') {
        const currentSub = await getTeamSubscription(teamId);
        if (currentSub.scheduledPriceId === actualPriceId) {
            throw new Error(`You already have a scheduled downgrade to ${preview.newPlan.displayName}. You cannot schedule the same plan change again.`);
        }
    }

    if (preview.requiresPaymentMethod && !preview.hasPaymentMethod) {
        throw new Error('Payment method required');
    }

    // Get team info
    const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    let subscription: Stripe.Subscription;
    let effectiveDate = new Date();

    if (preview.changeType === 'new') {
        // Create new subscription
        if (!team.stripeCustomerId) {
            throw new Error('Team must have a Stripe customer');
        }

        // For free plan, don't create a subscription
        if (actualPriceId === 'free') {
            throw new Error('Cannot create subscription for free plan. Cancel existing subscription instead.');
        }

        try {
            subscription = await client.subscriptions.create({
                customer: team.stripeCustomerId,
                items: [{ price: actualPriceId }],
                default_payment_method: team.stripePaymentMethodId || undefined,
                metadata: { teamId },
            });
        } catch (err: any) {
            logger.error({ err, teamId, customerId: team.stripeCustomerId, priceId: actualPriceId }, 'Failed to create Stripe subscription');
            if (err.code === 'resource_missing') {
                throw new Error(`Stripe price not found: ${actualPriceId}. Make sure the price exists in your Stripe dashboard.`);
            }
            throw new Error(`Failed to create subscription: ${err.message}`);
        }

    } else {
        // Update existing subscription
        if (!team.stripeSubscriptionId) {
            throw new Error('Team does not have an active subscription');
        }

        // Retrieve subscription with expanded data needed for both upgrades and downgrades
        const currentSub = await client.subscriptions.retrieve(team.stripeSubscriptionId, {
            expand: ['items.data.price', 'schedule'],
        });
        const itemId = currentSub.items.data[0]?.id;
        const currentPriceId = typeof currentSub.items.data[0]?.price === 'string'
            ? currentSub.items.data[0].price
            : currentSub.items.data[0]?.price?.id;

        if (!itemId || !currentPriceId) {
            throw new Error('Subscription has no items or price');
        }

        if (preview.changeType === 'upgrade') {
            // Immediate upgrade - charge full price of new plan (no prorations)
            // This resets the billing anchor to now (fresh start, no session carryover)
            try {
                subscription = await client.subscriptions.update(team.stripeSubscriptionId, {
                    items: [{
                        id: itemId,
                        price: actualPriceId,
                    }],
                    proration_behavior: 'none',
                    billing_cycle_anchor: 'now', // Reset billing cycle on upgrade
                });
            } catch (err: any) {
                logger.error({ err, teamId, subscriptionId: team.stripeSubscriptionId, priceId: actualPriceId }, 'Failed to update Stripe subscription');
                if (err.code === 'resource_missing') {
                    throw new Error(`Stripe price not found: ${actualPriceId}. Make sure the price exists in your Stripe dashboard.`);
                }
                throw new Error(`Failed to update subscription: ${err.message}`);
            }

            // Update billing cycle anchor in our database
            const subData = subscription as any;
            let newAnchor = new Date(subData.current_period_start * 1000);

            // Edge case: Validate anchor is not in future
            const now = new Date();
            if (newAnchor > now) {
                logger.warn({ teamId, newAnchor, now }, 'Billing anchor in future, using current time');
                newAnchor = now;
            }

            const newPeriod = getTeamBillingPeriod(newAnchor);

            // Reset session count to 0 for this team by clearing projectUsage for the new period
            // Get all projects for this team
            const teamProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(and(eq(projects.teamId, teamId), isNull(projects.deletedAt)));

            const projectIds = teamProjects.map(p => p.id);

            if (projectIds.length > 0) {
                // Delete any existing usage records for the new period
                await db
                    .delete(projectUsage)
                    .where(and(
                        inArray(projectUsage.projectId, projectIds),
                        eq(projectUsage.period, newPeriod)
                    ));
            }

            // Invalidate cache for this team
            const { invalidateSessionCache } = await import('./quotaCheck.js');
            await invalidateSessionCache(teamId);

            await db
                .update(teams)
                .set({
                    billingCycleAnchor: newAnchor,
                    updatedAt: new Date(),
                })
                .where(eq(teams.id, teamId));

            // Update newAnchor variable for logging (use the validated one)
            const finalAnchor = newAnchor;

            logger.info({
                teamId,
                newPeriod,
                newAnchor: finalAnchor,
            }, 'Upgrade completed: billing cycle reset and session count cleared');


        } else if (actualPriceId === 'free') {
            // Downgrade to Free plan = cancel subscription at period end
            await client.subscriptions.update(team.stripeSubscriptionId, {
                cancel_at_period_end: true,
            });

            effectiveDate = new Date((currentSub as any).current_period_end * 1000);

            subscription = currentSub;

            logger.info({
                teamId,
                subscriptionId: team.stripeSubscriptionId,
                effectiveDate,
            }, 'Downgrade to Free scheduled: subscription will cancel at period end');

        } else {
            // Downgrade at period end using subscription schedule
            try {
                // Check if there's already a schedule attached
                let scheduleId: string | null = null;

                if (currentSub.schedule) {
                    scheduleId = typeof currentSub.schedule === 'string'
                        ? currentSub.schedule
                        : (currentSub.schedule as Stripe.SubscriptionSchedule).id;
                }

                if (scheduleId) {
                    // Cancel existing schedule and create new one
                    try {
                        await client.subscriptionSchedules.cancel(scheduleId);
                        logger.info({ teamId, scheduleId }, 'Cancelled existing subscription schedule');
                    } catch (err: any) {
                        // If schedule is already canceled or doesn't exist, that's fine
                        if (err.code !== 'resource_missing') {
                            logger.warn({ err, teamId, scheduleId }, 'Failed to cancel existing schedule, continuing anyway');
                        }
                    }
                }

                // Create a schedule that changes the price at period end
                const schedule = await client.subscriptionSchedules.create({
                    from_subscription: team.stripeSubscriptionId,
                });

                // Get current period dates
                const currentPeriodStart = (currentSub as any).current_period_start;
                const currentPeriodEnd = (currentSub as any).current_period_end;

                // Update schedule to change price at next phase
                // Use proration_behavior: 'none' to ensure no charge on downgrade
                await client.subscriptionSchedules.update(schedule.id, {
                    phases: [
                        {
                            // Current phase until period end - no proration
                            items: [{ price: currentPriceId, quantity: 1 }],
                            start_date: currentPeriodStart,
                            end_date: currentPeriodEnd,
                            proration_behavior: 'none',
                        },
                        {
                            // New phase with downgraded price - starts at period end
                            items: [{ price: actualPriceId, quantity: 1 }],
                            start_date: currentPeriodEnd,
                        },
                    ],
                });

                effectiveDate = new Date(currentPeriodEnd * 1000);

                // Keep current subscription for now - webhook will update when it changes
                subscription = currentSub;

                logger.info({
                    teamId,
                    scheduleId: schedule.id,
                    newPriceId: actualPriceId,
                    effectiveDate,
                }, 'Downgrade scheduled for period end');
            } catch (err: any) {
                logger.error({ err, teamId, subscriptionId: team.stripeSubscriptionId, newPriceId: actualPriceId }, 'Failed to create subscription schedule for downgrade');
                if (err.code === 'resource_missing') {
                    throw new Error(`Stripe price not found: ${actualPriceId}. Make sure the price exists in your Stripe dashboard.`);
                }
                throw new Error(`Failed to schedule downgrade: ${err.message}`);
            }
        }
    }

    // Update team in database
    // For downgrades, keep current price until webhook handles the actual change
    const updateData: Record<string, any> = {
        stripeSubscriptionId: subscription.id,
        updatedAt: new Date(),
    };

    if (preview.changeType !== 'downgrade') {
        updateData.stripePriceId = actualPriceId;
    }

    await db
        .update(teams)
        .set(updateData)
        .where(eq(teams.id, teamId));

    // Invalidate Redis cache for session limits (needed for all plan changes)
    try {
        const { invalidateSessionCache } = await import('./quotaCheck.js');
        await invalidateSessionCache(teamId);
    } catch (err) {
        logger.warn({ err, teamId }, 'Failed to invalidate session cache');
    }

    logger.info({
        teamId,
        subscriptionId: subscription.id,
        priceId: actualPriceId,
        planName: plan.name,
        changeType: preview.changeType,
        confirmedByUserId,
    }, 'Plan change executed');

    // Set cooldown to prevent rapid plan changes (5 minutes TTL)
    try {
        await redis.set(cooldownKey, Date.now().toString(), 'PX', PLAN_CHANGE_COOLDOWN_MS);
    } catch (err) {
        logger.warn({ err, teamId }, 'Failed to set plan change cooldown');
    }

    // Send plan change email notification
    try {
        const [team] = await db
            .select({
                name: teams.name,
                billingEmail: teams.billingEmail,
                ownerUserId: teams.ownerUserId,
                stripeSubscriptionId: teams.stripeSubscriptionId,
            })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        if (team) {
            let recipientEmails: string[] = [];

            // Get billing admins (owner, admin, billing_admin roles)
            const members = await db
                .select({ email: users.email })
                .from(teamMembers)
                .innerJoin(users, eq(teamMembers.userId, users.id))
                .where(and(
                    eq(teamMembers.teamId, teamId),
                    inArray(teamMembers.role, ['owner', 'admin', 'billing_admin'])
                ));
            recipientEmails = members.map(m => m.email).filter(Boolean);

            // Add billing email if not in list
            if (team.billingEmail && !recipientEmails.includes(team.billingEmail)) {
                recipientEmails.push(team.billingEmail);
            }

            // If no members found, try to get owner email
            if (recipientEmails.length === 0 && team.ownerUserId) {
                const [owner] = await db
                    .select({ email: users.email })
                    .from(users)
                    .where(eq(users.id, team.ownerUserId))
                    .limit(1);
                if (owner?.email) {
                    recipientEmails.push(owner.email);
                }
            }

            // Deduplicate and filter empty
            recipientEmails = [...new Set(recipientEmails.filter(email => !!email))];

            if (recipientEmails.length > 0) {
                const { sendPlanChangeEmail } = await import('./email.js');
                await sendPlanChangeEmail(
                    recipientEmails,
                    team.name || 'Your Team',
                    preview.changeType as 'upgrade' | 'downgrade' | 'new',
                    preview.currentPlan.displayName,
                    preview.newPlan.displayName,
                    effectiveDate,
                    preview.isImmediate
                );
                logger.info({
                    teamId,
                    recipientsCount: recipientEmails.length,
                    changeType: preview.changeType,
                    isImmediate: preview.isImmediate
                }, 'Plan change email sent successfully');
            } else {
                logger.warn({ teamId }, 'No email recipients found for plan change notification');
            }
        }
    } catch (err) {
        // Don't fail plan change if email fails, but log the error
        logger.error({ err, teamId, changeType: preview.changeType }, 'Failed to send plan change email');
    }

    return {
        success: true,
        subscriptionId: subscription.id,
        plan: preview.newPlan,
        changeType: preview.changeType as 'upgrade' | 'downgrade' | 'new',
        effectiveDate,
        isImmediate: preview.isImmediate,
        message: preview.changeType === 'upgrade'
            ? `Successfully upgraded to ${preview.newPlan.displayName}.`
            : preview.changeType === 'downgrade'
                ? `Downgrade to ${preview.newPlan.displayName} scheduled for ${effectiveDate.toLocaleDateString()}.`
                : `Successfully subscribed to ${preview.newPlan.displayName}.`,
    };
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
    teamId: string,
    immediate: boolean = false
): Promise<void> {
    const client = getStripe();
    if (!client) return;

    const [team] = await db
        .select({ stripeSubscriptionId: teams.stripeSubscriptionId })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team?.stripeSubscriptionId) {
        return; // No subscription to cancel
    }

    if (immediate) {
        await client.subscriptions.cancel(team.stripeSubscriptionId);
    } else {
        await client.subscriptions.update(team.stripeSubscriptionId, {
            cancel_at_period_end: true,
        });
    }

    if (immediate) {
        // Clear subscription from team
        await db
            .update(teams)
            .set({
                stripeSubscriptionId: null,
                stripePriceId: null,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, teamId));
    }

    logger.info({ teamId, immediate }, 'Subscription canceled');
}

// =============================================================================
// Customer Management (re-exported for convenience)
// =============================================================================

export { createCustomer, getOrCreateCustomer, attachPaymentMethod, listPaymentMethods } from './stripe.js';
