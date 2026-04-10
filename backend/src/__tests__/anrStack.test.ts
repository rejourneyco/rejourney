import { describe, expect, it } from 'vitest';
import { generateANRFingerprintFromStackTrace, resolveAnrStackTrace } from '../services/anrStack.js';

describe('anrStack', () => {
    it('prefers the explicit stack trace over placeholder thread state', () => {
        const stackTrace = resolveAnrStackTrace({
            threadState: 'blocked',
            stack: 'at com.example.checkout.PaymentFragment.submit(PaymentFragment.kt:87)',
            deviceMetadata: {
                stack: 'at com.example.Legacy.fallback(Legacy.kt:12)',
            },
        });

        expect(stackTrace).toBe('at com.example.checkout.PaymentFragment.submit(PaymentFragment.kt:87)');
    });

    it('falls back to device metadata stack for legacy rows', () => {
        const stackTrace = resolveAnrStackTrace({
            threadState: 'blocked',
            deviceMetadata: {
                stack: 'at com.example.Legacy.fallback(Legacy.kt:12)',
            },
        });

        expect(stackTrace).toBe('at com.example.Legacy.fallback(Legacy.kt:12)');
    });

    it('extracts distinct fingerprints from java and kotlin stack frames', () => {
        const paymentFingerprint = generateANRFingerprintFromStackTrace([
            'java.lang.Thread.sleep(Native Method)',
            'at com.example.checkout.PaymentFragment.submit(PaymentFragment.kt:87)',
            'at com.example.checkout.PaymentViewModel.save(PaymentViewModel.kt:42)',
        ].join('\n'));
        const profileFingerprint = generateANRFingerprintFromStackTrace([
            'java.lang.Thread.sleep(Native Method)',
            'at com.example.profile.ProfileFragment.refresh(ProfileFragment.kt:14)',
            'at com.example.profile.ProfileViewModel.load(ProfileViewModel.kt:22)',
        ].join('\n'));

        expect(paymentFingerprint).not.toBe(profileFingerprint);
        expect(paymentFingerprint).toContain('com.example.checkout.PaymentFragment.submit');
        expect(profileFingerprint).toContain('com.example.profile.ProfileFragment.refresh');
    });

    it('keeps placeholder-only ANRs in the generic blocked bucket', () => {
        expect(generateANRFingerprintFromStackTrace('blocked')).toBe('anr:ANR:main_thread_blocked');
    });
});
