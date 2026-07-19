import { describe, expect, it } from 'vitest';

import { googleAdsAttributionSchema, sendOtpSchema } from '../validation/auth.js';

const validAttribution = {
    gclid: 'click-123',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'campaign-456',
    matchtype: 'e',
    device: 'c',
    capturedAt: '2026-07-18T20:00:00.000Z',
    landingPage: 'https://rejourney.co/web-session-replay',
};

describe('Google Ads attribution validation', () => {
    it('accepts bounded click and ValueTrack data on OTP signup', () => {
        const result = sendOtpSchema.parse({
            email: 'person@example.com',
            attribution: validAttribution,
            googleAdsConsent: 'accepted',
        });

        expect(result.attribution).toEqual(validAttribution);
        expect(result.googleAdsConsent).toBe('accepted');
    });

    it('rejects unknown or oversized attribution fields', () => {
        expect(() => googleAdsAttributionSchema.parse({
            ...validAttribution,
            unexpected: 'value',
        })).toThrow();

        expect(() => googleAdsAttributionSchema.parse({
            ...validAttribution,
            gclid: 'x'.repeat(256),
        })).toThrow();

        expect(() => sendOtpSchema.parse({
            email: 'person@example.com',
            googleAdsConsent: 'granted',
        })).toThrow();
    });
});
