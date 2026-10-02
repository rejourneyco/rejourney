import { describe, expect, it } from 'vitest';
import { sendOtpSchema } from '../validation/auth.js';
describe('OTP compatibility after advertising removal', () => {
    it('accepts old clients but discards advertising identifiers and consent', () => {
        expect(sendOtpSchema.parse({ email: 'test@example.com', attribution: { gclid: 'old-click' }, googleAdsConsent: 'accepted' })).toEqual({ email: 'test@example.com' });
    });
});
