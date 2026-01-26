/**
 * Stripe Webhook Routes
 * 
 * Handles Stripe webhook events for billing
 */

import { Router, raw } from 'express';
import { isSelfHosted } from '../config.js';
import { logger } from '../logger.js';
import { constructWebhookEvent, handleWebhookEvent, isStripeEnabled } from '../services/stripe.js';
import { ApiError, asyncHandler } from '../middleware/index.js';

const router = Router();

/**
 * Stripe Webhook Endpoint
 * POST /api/webhooks/stripe
 * 
 * Note: This endpoint uses raw body parsing for signature verification
 */
router.post(
    '/stripe',
    raw({ type: 'application/json' }),
    asyncHandler(async (req, res) => {
        logger.info({ 
            path: req.path, 
            method: req.method,
            headers: Object.keys(req.headers),
            hasBody: !!req.body 
        }, 'Stripe webhook endpoint hit');

        // Return 503 if Stripe is disabled (self-hosted mode)
        if (isSelfHosted || !isStripeEnabled()) {
            logger.warn({ isSelfHosted, isStripeEnabled: isStripeEnabled() }, 'Stripe webhook received but Stripe is not enabled');
            throw ApiError.serviceUnavailable('Stripe is not enabled');
        }

        const signature = req.headers['stripe-signature'] as string;
        const bodyType = typeof req.body;
        const hasBuffer = Buffer.isBuffer(req.body);

        logger.info({
            hasSignature: !!signature,
            bodyType,
            hasBuffer,
            contentType: req.headers['content-type'],
            bodyLength: req.body?.length || 0
        }, 'Stripe webhook raw check');

        if (!signature) {
            logger.error('Missing stripe-signature header');
            throw ApiError.badRequest('Missing stripe-signature header');
        }

        try {
            const event = constructWebhookEvent(req.body, signature);

            if (!event) {
                throw ApiError.badRequest('Failed to construct webhook event');
            }

            logger.info({ eventId: event.id, eventType: event.type }, 'Received Stripe webhook');

            // Handle the event
            await handleWebhookEvent(event);

            // Return 200 to acknowledge receipt
            res.json({ received: true });
        } catch (err: any) {
            logger.error({ err }, 'Stripe webhook error');

            // Return 400 for signature verification failures
            if (err.type === 'StripeSignatureVerificationError') {
                throw ApiError.badRequest('Invalid webhook signature');
            }

            throw err;
        }
    })
);

export default router;
