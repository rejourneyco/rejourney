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

export const sendOtpSchema = z.object({
    email: z.string().email('Invalid email address'),
    fingerprint: fingerprintSchema,
    turnstileToken: z.string().min(1, 'Turnstile token required').optional(),
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

export type FingerprintData = z.infer<typeof fingerprintSchema>;
export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;

