import { describe, expect, it } from 'vitest';

import {
    buildGoogleAdsDataManagerEvent,
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

    it('enforces the seven-day activation window', () => {
        const signup = new Date('2026-07-01T00:00:00.000Z');
        expect(isWithinGoogleAdsActivationWindow(signup, new Date('2026-07-08T00:00:00.000Z'))).toBe(true);
        expect(isWithinGoogleAdsActivationWindow(signup, new Date('2026-07-08T00:00:00.001Z'))).toBe(false);
        expect(isWithinGoogleAdsActivationWindow(signup, new Date('2026-06-30T23:59:59.999Z'))).toBe(false);
    });
});
