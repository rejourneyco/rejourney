/**
 * Auth Validation Schemas
 */

import { z } from 'zod';

// Fingerprint data schema - collected from browser for duplicate account detection
const fingerprintSchema = z.object({
    timezone: z.string().max(100).optional(),
    browserFingerprint: z.string().max(64).optional(),
    screenResolution: z.string().max(20).optional(),
    language: z.string().max(50).optional(),
    platform: z.string().max(50).optional(),
}).optional();

export const googleAdsAttributionSchema = z.object({
    gclid: z.string().trim().max(255).optional(),
    gbraid: z.string().trim().max(255).optional(),
    wbraid: z.string().trim().max(255).optional(),
    utm_source: z.string().trim().max(255).optional(),
    utm_medium: z.string().trim().max(255).optional(),
    utm_campaign: z.string().trim().max(255).optional(),
    utm_content: z.string().trim().max(255).optional(),
    utm_term: z.string().trim().max(255).optional(),
    matchtype: z.string().trim().max(32).optional(),
    device: z.string().trim().max(32).optional(),
    network: z.string().trim().max(32).optional(),
    loc: z.string().trim().max(64).optional(),
    capturedAt: z.string().datetime(),
    landingPage: z.string().url().max(2048),
}).strict();

function isValidTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

const userTimeZoneSchema = z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string()
        .trim()
        .max(100)
        .refine(isValidTimeZone, 'Invalid time zone')
        .nullable()
        .optional(),
);

export const sendOtpSchema = z.object({
    email: z.string().email('Invalid email address'),
    fingerprint: fingerprintSchema,
    attribution: googleAdsAttributionSchema.optional(),
    googleAdsConsent: z.literal('accepted').optional(),
});

export const verifyOtpSchema = z.object({
    email: z.string().email('Invalid email address'),
    code: z.string().length(10, 'OTP must be 10 characters').regex(/^[A-Z0-9]+$/, 'OTP must be alphanumeric'),
    fingerprint: fingerprintSchema,
});

export const oauthCallbackSchema = z.object({
    code: z.string().min(1, 'Authorization code required'),
    state: z.string().optional(),
});

export const updateMeSchema = z.object({
    timezone: userTimeZoneSchema,
});

export type FingerprintData = z.infer<typeof fingerprintSchema>;
export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
