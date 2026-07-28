import { describe, expect, it } from 'vitest';

import {
    buildGoogleAdsDataManagerEvent,
    dataManagerStatusAfterIngest,
    GOOGLE_ADS_UPLOAD_EVENT_NAMES,
    hasGoogleAdsMeasurementConsent,
    hashGoogleAdsEmail,
    isWithinGoogleAdsActivationWindow,
} from '../services/googleAdsConversions.js';

describe('Google Ads conversion payloads', () => {
    it('normalizes and hashes email identifiers as uppercase SHA-256 hex', () => {
        expect(hashGoogleAdsEmail(' Test@Example.COM ')).toBe(
            '973DFE463EC85785F5F95AF5BA3906EEDB2D931C24E69824A89EA65DBA4E813B',
        );
    });

    it('includes click IDs, consent, money, and deterministic transaction data', () => {
        const event = buildGoogleAdsDataManagerEvent({
            row: {
                eventName: 'subscription_started',
                transactionId: 'subscription_started:sub_123',
                occurredAt: new Date('2026-07-18T12:00:00.000Z'),
                eventSource: 'OTHER',
                valueCents: 2900,
                currency: 'usd',
            },
            email: 'buyer@example.com',
            attribution: { gclid: 'click-123' },
        });

        expect(event).toMatchObject({
            destinationReferences: ['subscription_started'],
            transactionId: 'subscription_started:sub_123',
            eventTimestamp: '2026-07-18T12:00:00.000Z',
            adIdentifiers: { gclid: 'click-123' },
            consent: {
                adUserData: 'CONSENT_GRANTED',
                adPersonalization: 'CONSENT_GRANTED',
            },
            currency: 'USD',
            conversionValue: 29,
            conversionCount: 1,
            eventSource: 'OTHER',
        });
    });

    it('uploads completed signups through the server-side outbox', () => {
        expect(GOOGLE_ADS_UPLOAD_EVENT_NAMES).toContain('signup_completed');

        const event = buildGoogleAdsDataManagerEvent({
            row: {
                eventName: 'signup_completed',
                transactionId: 'signup_completed:user-123',
                occurredAt: new Date('2026-07-27T16:30:05.473Z'),
                eventSource: 'WEB',
                valueCents: null,
                currency: null,
            },
            email: 'new-user@example.com',
            attribution: {
                gclid: 'click-123',
                gbraid: 'braid-123',
            },
        });

        expect(event).toMatchObject({
            destinationReferences: ['signup_completed'],
            transactionId: 'signup_completed:user-123',
            eventTimestamp: '2026-07-27T16:30:05.473Z',
            adIdentifiers: {
                gclid: 'click-123',
                gbraid: 'braid-123',
            },
            conversionCount: 1,
            eventSource: 'WEB',
        });
    });

    it('enforces the seven-day activation window', () => {
        const signup = new Date('2026-07-01T00:00:00.000Z');
        expect(isWithinGoogleAdsActivationWindow(signup, new Date('2026-07-08T00:00:00.000Z'))).toBe(true);
        expect(isWithinGoogleAdsActivationWindow(signup, new Date('2026-07-08T00:00:00.001Z'))).toBe(false);
        expect(isWithinGoogleAdsActivationWindow(signup, new Date('2026-06-30T23:59:59.999Z'))).toBe(false);
    });

    it('does not poll validate-only request IDs', () => {
        expect(dataManagerStatusAfterIngest(true)).toBe('validated');
        expect(dataManagerStatusAfterIngest(false)).toBe('accepted');
    });

    it('allows server-side Ads milestones without a stored prompt choice during initial testing', () => {
        expect(hasGoogleAdsMeasurementConsent(null)).toBe(true);
    });
});
