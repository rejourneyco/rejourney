/**
 * Stripe Service
 * 
 * Handles all Stripe API interactions:
 * - Customer management
 * - Payment methods
 * - Usage-based billing
 * - Invoice generation
 * - Webhook processing
 * - Billing portal sessions
 */

import Stripe from 'stripe';
import { eq, and } from 'drizzle-orm';
import { config, isSelfHosted } from '../config.js';
import { logger } from '../logger.js';
import { db, teams, stripeWebhookEvents, billingUsage } from '../db/client.js';

// =============================================================================
// Stripe Client Initialization
// =============================================================================

let stripe: Stripe | null = null;

/**
 * Initialize Stripe client if not in self-hosted mode and keys are configured
 */
function getStripe(): Stripe | null {
    if (isSelfHosted) {
        return null;
    }

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

/**
 * Check if Stripe is enabled
 */
export function isStripeEnabled(): boolean {
    return getStripe() !== null;
}

// =============================================================================
// Customer Management
// =============================================================================

/**
 * Create a Stripe customer for a team
 */
export async function createCustomer(
    email: string,
    teamName: string,
    teamId: string,
    metadata?: Record<string, string>
): Promise<string | null> {
    const client = getStripe();
    if (!client) return null;

    try {
        const customer = await client.customers.create({
            email,
            name: teamName,
            metadata: {
                teamId,
                ...metadata,
            },
        });

        // Save customer ID to team
        await db.update(teams)
            .set({ stripeCustomerId: customer.id, billingEmail: email })
            .where(eq(teams.id, teamId));

        logger.info({ teamId, customerId: customer.id }, 'Stripe customer created');
        return customer.id;
    } catch (err) {
        logger.error({ err, teamId }, 'Failed to create Stripe customer');
        throw err;
    }
}

/**
 * Get or create a Stripe customer for a team
 */
export async function getOrCreateCustomer(
    teamId: string,
    email: string,
    teamName: string
): Promise<string | null> {
    const client = getStripe();
    if (!client) return null;

    // Check if team already has a Stripe customer
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    if (team?.stripeCustomerId) {
        return team.stripeCustomerId;
    }

    return createCustomer(email, teamName, teamId);
}

/**
 * Get a Stripe customer by ID
 */
export async function getCustomer(customerId: string): Promise<Stripe.Customer | null> {
    const client = getStripe();
    if (!client) return null;

    try {
        const customer = await client.customers.retrieve(customerId);
        if (customer.deleted) return null;
        return customer as Stripe.Customer;
    } catch (err) {
        logger.error({ err, customerId }, 'Failed to get Stripe customer');
        return null;
    }
}

/**
 * Update a Stripe customer
 */
export async function updateCustomer(
    customerId: string,
    updates: Stripe.CustomerUpdateParams
): Promise<void> {
    const client = getStripe();
    if (!client) return;

    try {
        await client.customers.update(customerId, updates);
        logger.debug({ customerId }, 'Stripe customer updated');
    } catch (err) {
        logger.error({ err, customerId }, 'Failed to update Stripe customer');
        throw err;
    }
}

// =============================================================================
// Payment Methods
// =============================================================================

/**
 * Attach a payment method to a customer
 */
export async function attachPaymentMethod(
    customerId: string,
    paymentMethodId: string,
    teamId: string
): Promise<void> {
    const client = getStripe();
    if (!client) return;

    try {
        // Attach payment method to customer
        await client.paymentMethods.attach(paymentMethodId, {
            customer: customerId,
        });

        // Set as default payment method
        await client.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });

        // Save to team
        await db.update(teams)
            .set({
                stripePaymentMethodId: paymentMethodId,
                paymentFailedAt: null,
            })
            .where(eq(teams.id, teamId));

        logger.info({ teamId, paymentMethodId }, 'Payment method attached');
    } catch (err) {
        logger.error({ err, customerId, paymentMethodId }, 'Failed to attach payment method');
        throw err;
    }
}

/**
 * Detach a payment method
 */
export async function detachPaymentMethod(
    paymentMethodId: string,
    teamId: string
): Promise<void> {
    const client = getStripe();
    if (!client) return;

    try {
        await client.paymentMethods.detach(paymentMethodId);

        // Clear from team if it was the default
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (team?.stripePaymentMethodId === paymentMethodId) {
            await db.update(teams)
                .set({ stripePaymentMethodId: null })
                .where(eq(teams.id, teamId));
        }

        logger.info({ teamId, paymentMethodId }, 'Payment method detached');
    } catch (err) {
        logger.error({ err, paymentMethodId }, 'Failed to detach payment method');
        throw err;
    }
}

/**
 * List payment methods for a customer (card and link)
 */
export async function listPaymentMethods(
    customerId: string
): Promise<Stripe.PaymentMethod[]> {
    const client = getStripe();
    if (!client) return [];

    try {
        const [cards, links] = await Promise.all([
            client.paymentMethods.list({
                customer: customerId,
                type: 'card',
            }),
            client.paymentMethods.list({
                customer: customerId,
                type: 'link',
            }),
        ]);

        return [...cards.data, ...links.data];
    } catch (err) {
        logger.error({ err, customerId }, 'Failed to list payment methods');
        return [];
    }
}

/**
 * Check if a customer has any payment methods in Stripe
 * This is a quick check that can be used as fallback when DB is out of sync
 */
export async function customerHasPaymentMethods(
    customerId: string
): Promise<boolean> {
    const client = getStripe();
    if (!client) return false;

    try {
        const cards = await client.paymentMethods.list({
            customer: customerId,
            type: 'card',
            limit: 1,
        });

        return cards.data.length > 0;
    } catch (err) {
        logger.error({ err, customerId }, 'Failed to check payment methods');
        return false;
    }
}

/**
 * Create a SetupIntent for adding a payment method via Stripe Payment Element
 * This allows users to securely add payment methods without leaving the app
 */
export async function createSetupIntent(
    customerId: string,
    teamId: string
): Promise<{ clientSecret: string } | null> {
    const client = getStripe();
    if (!client) return null;

    try {
        const setupIntent = await client.setupIntents.create({
            customer: customerId,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never', // Only allow payment methods that don't require redirects (cards, wallets)
            },
            usage: 'off_session', // For subscription billing
            metadata: {
                teamId,
            },
        });

        if (!setupIntent.client_secret) {
            logger.error({ teamId, customerId }, 'SetupIntent created without client_secret');
            return null;
        }

        logger.info({ teamId, setupIntentId: setupIntent.id }, 'SetupIntent created');
        return { clientSecret: setupIntent.client_secret };
    } catch (err) {
        logger.error({ err, teamId, customerId }, 'Failed to create SetupIntent');
        throw err;
    }
}

// =============================================================================
// Billing Portal
// =============================================================================

/**
 * Create a Stripe Billing Portal session
 */
export async function createBillingPortalSession(
    customerId: string,
    returnUrl: string
): Promise<string | null> {
    const client = getStripe();
    if (!client) return null;

    try {
        const session = await client.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
        return session.url;
    } catch (err) {
        logger.error({ err, customerId }, 'Failed to create billing portal session');
        throw err;
    }
}

// =============================================================================
// Subscriptions (Session-Based Plans)
// =============================================================================

/**
 * Create a subscription for a team on a specific plan
 * Used when a team upgrades from free tier to a paid plan
 * 
 * @param teamId - Team ID
 * @param priceId - Stripe Price ID for the plan
 * @returns Stripe Subscription or null if not enabled
 */
export async function createSubscription(
    teamId: string,
    priceId: string
): Promise<Stripe.Subscription | null> {
    const client = getStripe();
    if (!client) return null;

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    if (!team?.stripeCustomerId) {
        logger.warn({ teamId }, 'Cannot create subscription - no Stripe customer');
        return null;
    }

    if (!team?.stripePaymentMethodId) {
        logger.warn({ teamId }, 'Cannot create subscription - no payment method');
        return null;
    }

    try {
        const subscription = await client.subscriptions.create({
            customer: team.stripeCustomerId,
            items: [{ price: priceId }],
            default_payment_method: team.stripePaymentMethodId,
            metadata: {
                teamId,
            },
        });

        // Update team with subscription ID
        await db.update(teams)
            .set({
                stripeSubscriptionId: subscription.id,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, teamId));

        logger.info({ teamId, subscriptionId: subscription.id, priceId }, 'Subscription created');
        return subscription;
    } catch (err) {
        logger.error({ err, teamId, priceId }, 'Failed to create subscription');
        throw err;
    }
}

/**
 * Update a team's subscription to a different plan
 * 
 * @param teamId - Team ID
 * @param newPriceId - Stripe Price ID for the new plan
 * @returns Updated Stripe Subscription or null
 */
export async function updateSubscription(
    teamId: string,
    newPriceId: string
): Promise<Stripe.Subscription | null> {
    const client = getStripe();
    if (!client) return null;

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    if (!team?.stripeSubscriptionId) {
        logger.warn({ teamId }, 'Cannot update subscription - no existing subscription');
        return null;
    }

    try {
        // Get current subscription to find the item ID
        const subscription = await client.subscriptions.retrieve(team.stripeSubscriptionId);
        const itemId = subscription.items.data[0]?.id;

        if (!itemId) {
            logger.warn({ teamId, subscriptionId: team.stripeSubscriptionId }, 'Subscription has no items');
            return null;
        }

        // Update the subscription item with the new price
        const updatedSubscription = await client.subscriptions.update(team.stripeSubscriptionId, {
            items: [{
                id: itemId,
                price: newPriceId,
            }],
            proration_behavior: 'none',
        });

        logger.info({ teamId, subscriptionId: team.stripeSubscriptionId, newPriceId }, 'Subscription updated');
        return updatedSubscription;
    } catch (err) {
        logger.error({ err, teamId, newPriceId }, 'Failed to update subscription');
        throw err;
    }
}

/**
 * Cancel a team's subscription
 * 
 * @param teamId - Team ID
 * @param immediate - If true, cancel immediately. If false, cancel at period end.
 * @returns Cancelled Stripe Subscription or null
 */
export async function cancelSubscription(
    teamId: string,
    immediate: boolean = false
): Promise<Stripe.Subscription | null> {
    const client = getStripe();
    if (!client) return null;

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    if (!team?.stripeSubscriptionId) {
        logger.warn({ teamId }, 'Cannot cancel subscription - no existing subscription');
        return null;
    }

    try {
        let subscription: Stripe.Subscription;

        if (immediate) {
            subscription = await client.subscriptions.cancel(team.stripeSubscriptionId);
        } else {
            subscription = await client.subscriptions.update(team.stripeSubscriptionId, {
                cancel_at_period_end: true,
            });
        }

        logger.info({ teamId, subscriptionId: team.stripeSubscriptionId, immediate }, 'Subscription cancelled');
        return subscription;
    } catch (err) {
        logger.error({ err, teamId }, 'Failed to cancel subscription');
        throw err;
    }
}

// =============================================================================
// Webhook Handling
// =============================================================================

/**
 * Construct webhook event from payload and signature
 */
export function constructWebhookEvent(
    payload: Buffer | string,
    signature: string
): Stripe.Event | null {
    const client = getStripe();
    if (!client || !config.STRIPE_WEBHOOK_SECRET) return null;

    try {
        return client.webhooks.constructEvent(
            payload,
            signature,
            config.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        logger.error({ err }, 'Failed to construct webhook event');
        throw err;
    }
}

/**
 * Check if a webhook event has already been processed (idempotency)
 */
export async function isWebhookProcessed(eventId: string): Promise<boolean> {
    const [existing] = await db.select()
        .from(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.id, eventId))
        .limit(1);

    return !!existing;
}

/**
 * Mark a webhook event as processed
 */
export async function markWebhookProcessed(
    eventId: string,
    eventType: string,
    metadata?: Record<string, any>
): Promise<void> {
    await db.insert(stripeWebhookEvents).values({
        id: eventId,
        type: eventType,
        metadata: metadata || null,
    });
}

/**
 * Handle a Stripe webhook event
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
    // Check idempotency
    if (await isWebhookProcessed(event.id)) {
        logger.debug({ eventId: event.id }, 'Skipping already processed webhook');
        return;
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
                break;

            case 'invoice.paid':
                await handleInvoicePaid(event.data.object as Stripe.Invoice);
                break;

            case 'invoice.payment_failed':
                await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
                break;

            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;

            case 'customer.subscription.created':
                // New subscription created - handle initial setup
                await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
                break;

            case 'payment_method.attached':
                await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
                break;

            case 'payment_method.detached':
                await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
                break;

            default:
                logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
        }

        // Mark as processed
        await markWebhookProcessed(event.id, event.type);
    } catch (err) {
        logger.error({ err, eventId: event.id, eventType: event.type }, 'Error handling webhook event');
        throw err;
    }
}

/**
 * Handle checkout.session.completed webhook
 * Called when a Stripe Checkout Session completes successfully
 * This is the primary event for subscriptions created via Checkout
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // Only handle subscription mode checkouts
    if (session.mode !== 'subscription') {
        logger.debug({ sessionId: session.id, mode: session.mode }, 'Checkout session is not subscription mode, skipping');
        return;
    }

    const teamId = session.metadata?.teamId;
    const subscriptionId = typeof session.subscription === 'string' 
        ? session.subscription 
        : session.subscription?.id;

    if (!teamId) {
        logger.warn({ sessionId: session.id }, 'Checkout session missing teamId metadata');
        return;
    }

    if (!subscriptionId) {
        logger.warn({ sessionId: session.id, teamId }, 'Checkout session missing subscription ID');
        return;
    }

    try {
        // Update team with subscription ID immediately
        await db.update(teams)
            .set({
                stripeSubscriptionId: subscriptionId,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, teamId));

        logger.info({
            teamId,
            sessionId: session.id,
            subscriptionId,
        }, 'Checkout session completed - subscription ID updated');

        // The subscription.created event will handle setting up billing cycle anchor and price
        // But we update subscription ID here immediately for faster sync
    } catch (err) {
        logger.error({ err, sessionId: session.id, teamId }, 'Failed to handle checkout session completed');
        throw err;
    }
}

/**
 * Handle payment_method.attached webhook
 * Updates the team's default payment method when added via Stripe portal
 */
async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    const customerId = typeof paymentMethod.customer === 'string'
        ? paymentMethod.customer
        : paymentMethod.customer?.id;

    if (!customerId) {
        logger.debug({ paymentMethodId: paymentMethod.id }, 'Payment method has no customer');
        return;
    }

    // Find team with this customer ID
    const [team] = await db.select()
        .from(teams)
        .where(eq(teams.stripeCustomerId, customerId))
        .limit(1);

    if (!team) {
        logger.debug({ customerId }, 'No team found for Stripe customer');
        return;
    }

    // Only set as default if team doesn't have one yet
    if (!team.stripePaymentMethodId) {
        await db.update(teams)
            .set({
                stripePaymentMethodId: paymentMethod.id,
                paymentFailedAt: null,
            })
            .where(eq(teams.id, team.id));

        logger.info({ teamId: team.id, paymentMethodId: paymentMethod.id }, 'Payment method set as default via webhook');
    } else {
        logger.debug({ teamId: team.id }, 'Team already has payment method, not overwriting');
    }
}

/**
 * Handle payment_method.detached webhook
 * Clears the team's payment method if it was the default
 */
async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    // Find team with this payment method
    const [team] = await db.select()
        .from(teams)
        .where(eq(teams.stripePaymentMethodId, paymentMethod.id))
        .limit(1);

    if (team) {
        await db.update(teams)
            .set({ stripePaymentMethodId: null })
            .where(eq(teams.id, team.id));

        logger.info({ teamId: team.id, paymentMethodId: paymentMethod.id }, 'Payment method cleared via webhook');
    }
}

/**
 * Handle invoice.paid event
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const teamId = invoice.metadata?.teamId;
    if (!teamId) {
        logger.warn({ invoiceId: invoice.id }, 'Invoice missing teamId metadata');
        return;
    }

    // Clear payment failed status
    await db.update(teams)
        .set({ paymentFailedAt: null })
        .where(eq(teams.id, teamId));

    // Update billing usage with paid status
    const period = invoice.metadata?.period;
    if (period) {
        // Update only the specific period's record, not all records for this team
        await db.update(billingUsage)
            .set({ invoiceStatus: 'paid' })
            .where(and(
                eq(billingUsage.teamId, teamId),
                eq(billingUsage.period, period)
            ));
    }

    logger.info({ teamId, invoiceId: invoice.id }, 'Invoice paid');
}

/**
 * Handle invoice.payment_failed event - NO GRACE PERIOD, immediate pause
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const teamId = invoice.metadata?.teamId;
    if (!teamId) {
        logger.warn({ invoiceId: invoice.id }, 'Invoice missing teamId metadata');
        return;
    }

    // Set payment failed status immediately (no grace period per user decision)
    await db.update(teams)
        .set({ paymentFailedAt: new Date() })
        .where(eq(teams.id, teamId));

    logger.warn({ teamId, invoiceId: invoice.id }, 'Invoice payment failed - recording paused');
}

/**
 * Handle subscription created event (from invoice)
 * Sets up initial billing cycle anchor for new subscriptions
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    const teamId = subscription.metadata?.teamId;

    if (!teamId) {
        logger.debug({ subscriptionId: subscription.id }, 'Subscription missing teamId metadata');
        return;
    }

    try {
        const subData = subscription as any;
        const newAnchor = new Date(subData.current_period_start * 1000);

        // Set billing cycle anchor and subscription ID for new subscription
        await db.update(teams)
            .set({
                stripeSubscriptionId: subscription.id,
                billingCycleAnchor: newAnchor,
                stripePriceId: subscription.items.data[0]?.price.id || null,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, teamId));

        logger.info({
            teamId,
            subscriptionId: subscription.id,
            anchor: newAnchor,
        }, 'New subscription created - billing cycle anchor set');
    } catch (err) {
        logger.error({ err, subscriptionId: subscription.id }, 'Failed to handle subscription created');
    }
}

/**
 * Handle subscription updated event
 * Syncs subscription state (price changes, status changes, scheduled downgrades completing)
 * 
 * IMPORTANT: For downgrades, we do NOT reset the billing cycle anchor
 * The billing cycle continues from the same date, only the price changes
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const subData = subscription as any;
    const teamId = subData.metadata?.teamId;

    // Try to find team by subscription ID or metadata
    let targetTeamId = teamId;

    if (!targetTeamId) {
        const [team] = await db.select({ id: teams.id, billingCycleAnchor: teams.billingCycleAnchor })
            .from(teams)
            .where(eq(teams.stripeSubscriptionId, subscription.id))
            .limit(1);

        if (!team) {
            logger.debug({ subscriptionId: subscription.id }, 'No team found for subscription');
            return;
        }

        targetTeamId = team.id;
    }

    // Get current price ID from subscription
    const priceId = subscription.items.data[0]?.price.id;

    // Get current team state to check if this is a downgrade
    const [currentTeam] = await db
        .select({
            stripePriceId: teams.stripePriceId,
            billingCycleAnchor: teams.billingCycleAnchor,
        })
        .from(teams)
        .where(eq(teams.id, targetTeamId))
        .limit(1);

    if (!currentTeam) {
        logger.warn({ teamId: targetTeamId }, 'Team not found for subscription update');
        return;
    }

    // Determine if this is a downgrade (price decreased) or upgrade (price increased)
    const isDowngrade = currentTeam.stripePriceId && priceId &&
        currentTeam.stripePriceId !== priceId;

    // For downgrades: keep the same billing cycle anchor (don't reset)
    // For upgrades: billing cycle was already reset in executePlanChange
    // For new subscriptions: set the anchor
    const updateData: Record<string, any> = {
        stripePriceId: priceId || null,
        updatedAt: new Date(),
    };

    if (!currentTeam.billingCycleAnchor) {
        // New subscription - set anchor
        updateData.billingCycleAnchor = new Date(subData.current_period_start * 1000);
    } else if (!isDowngrade) {
        // Upgrade or other change - update anchor (upgrades already reset it, but sync it)
        updateData.billingCycleAnchor = new Date(subData.current_period_start * 1000);
    }
    // For downgrades: explicitly do NOT update billingCycleAnchor

    await db.update(teams)
        .set(updateData)
        .where(eq(teams.id, targetTeamId));

    // Invalidate cache when subscription changes
    const { invalidateSessionCache } = await import('./quotaCheck.js');
    await invalidateSessionCache(targetTeamId);

    logger.info({
        teamId: targetTeamId,
        subscriptionId: subscription.id,
        status: subscription.status,
        priceId,
        isDowngrade,
        billingCyclePreserved: isDowngrade,
    }, 'Subscription updated via webhook');
}

/**
 * Handle subscription deleted event
 * Occurs when a subscription is canceled (either immediately or at period end)
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const subData = subscription as any;
    const teamId = subData.metadata?.teamId;

    let targetTeamId = teamId;

    if (!targetTeamId) {
        const [team] = await db.select({ id: teams.id })
            .from(teams)
            .where(eq(teams.stripeSubscriptionId, subscription.id))
            .limit(1);

        if (!team) {
            logger.debug({ subscriptionId: subscription.id }, 'No team found for deleted subscription');
            return;
        }

        targetTeamId = team.id;
    }

    // Clear subscription info - team returns to free tier
    await db.update(teams)
        .set({
            stripeSubscriptionId: null,
            stripePriceId: null,
            // Keep billingCycleAnchor - free tier continues from same date
            updatedAt: new Date(),
        })
        .where(eq(teams.id, targetTeamId));

    // Invalidate cache
    const { invalidateSessionCache } = await import('./quotaCheck.js');
    await invalidateSessionCache(targetTeamId);

    logger.info({
        teamId: targetTeamId,
        subscriptionId: subscription.id,
    }, 'Subscription deleted - team returned to free tier');
}
