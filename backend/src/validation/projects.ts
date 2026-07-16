/**
 * Project Validation Schemas
 */

import { z } from 'zod';
import { normalizeWebAllowedDomain, normalizeWebAllowedDomains } from '../utils/webAllowedDomains.js';

// ── App identifier validation ────────────────────────────────────────────────
// Accept input that matches EITHER iOS bundle ID OR Android package name format.
//
// iOS bundle ID:  letters, digits, hyphens, periods  (single-segment OK)
// Android pkg:    letters, digits, underscores, periods; each segment starts with a letter; ≥2 segments
//
// Combined UX rules:
//   • Length 3-155
//   • Must contain at least one period (.)
//   • Allowed chars: A-Z a-z 0-9 . - _
//   • Cannot start or end with .
//   • No consecutive dots (..)

const IOS_BUNDLE_REGEX = /^[A-Za-z0-9.-]{1,155}$/;
const ANDROID_PACKAGE_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** Validate an app identifier (bundle ID or package name). Returns null if valid, error string otherwise. */
function validateAppIdentifier(value: string): string | null {
    if (value.length < 3) return 'Identifier must be at least 3 characters';
    if (value.length > 155) return 'Identifier cannot exceed 155 characters';
    if (!value.includes('.')) return 'Identifier must contain at least one period (e.g. com.example.app)';
    if (value.startsWith('.') || value.endsWith('.')) return 'Identifier cannot start or end with a period';
    if (value.includes('..')) return 'Identifier cannot contain consecutive periods';

    const isValidIos = IOS_BUNDLE_REGEX.test(value);
    const isValidAndroid = ANDROID_PACKAGE_REGEX.test(value);

    if (!isValidIos && !isValidAndroid) {
        return 'Invalid identifier. Only letters, numbers, periods, hyphens, and underscores are allowed.';
    }
    return null;
}

const appIdentifierSchema = z
    .string()
    .refine(
        (val) => validateAppIdentifier(val) === null,
        (val) => ({ message: validateAppIdentifier(val) || 'Invalid identifier' })
    );

const textInputMaskingSchema = z.enum(['all', 'secure_only']);
const imageVideoMaskingSchema = z.enum(['none', 'all']);
const recordingFpsSchema = z.number().int().min(1).max(3);
const mobileMaxObservabilityMinutesSchema = z.number().int().min(1).max(10);
const webMaxObservabilityMinutesSchema = z.number().int().min(1).max(30);
export const smartCaptureModeSchema = z.enum(['record_all', 'smart_capture', 'analytics_only']);
export const smartCapturePresetSchema = z.enum(['none', 'high_friction', 'onboarding_risk', 'churn_risk', 'checkout_risk', 'minimum_signal']);
export const smartCaptureRuleSchema = z.object({
    id: z.string().trim().min(1).max(120).optional(),
    type: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    color: z.string().trim().min(1).max(24).optional(),
    enabled: z.boolean().optional().default(true),
    immediate: z.boolean().optional(),
    condition: z.record(z.string(), z.unknown()).optional(),
    operator: z.string().trim().max(24).optional(),
    value: z.union([z.string().max(255), z.number(), z.boolean()]).optional(),
    windowHours: z.number().int().min(1).max(168).optional(),
    captureRate: z.number().min(0).max(100).optional(),
}).passthrough();
export const smartCaptureConfigSchema = z.object({
    enabled: z.boolean().optional().default(false),
    mode: smartCaptureModeSchema.optional().default('record_all'),
    preset: smartCapturePresetSchema.optional().default('none'),
    rules: z.array(smartCaptureRuleSchema).max(20).optional().default([]),
    decisionWindowHours: z.number().int().min(1).max(168).optional().default(168),
});
const webAllowedDomainSchema = z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => normalizeWebAllowedDomain(value) !== null, {
        message: 'Allowed domain must be a valid host, URL, localhost, or wildcard subdomain',
    })
    .transform((value) => normalizeWebAllowedDomain(value)!);
const webAllowedDomainsSchema = z
    .array(webAllowedDomainSchema)
    .max(25, 'At most 25 web allowed domains are supported')
    .transform((values) => normalizeWebAllowedDomains(values));

export const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    bundleId: appIdentifierSchema.optional(),
    packageName: appIdentifierSchema.optional(),
    teamId: z.string().uuid().optional(),
    webDomain: webAllowedDomainSchema.optional(),
    webAllowedDomains: webAllowedDomainsSchema.optional(),
    platforms: z.array(z.enum(['ios', 'android', 'web', 'react-native'])).optional(),
    rejourneyEnabled: z.boolean().optional().default(true),
    recordingEnabled: z.boolean().optional().default(true),
    textInputMasking: textInputMaskingSchema.optional().default('all'),
    imageVideoMasking: imageVideoMaskingSchema.optional().default('none'),
    recordingFps: recordingFpsSchema.optional().default(1),
    sampleRate: z.number().int().min(0).max(100).optional().default(100),
    maxRecordingMinutes: mobileMaxObservabilityMinutesSchema.optional().default(10),
    webMaxObservabilityMinutes: webMaxObservabilityMinutesSchema.optional().default(30),
}).superRefine((data, ctx) => {
    if (data.platforms?.includes('android') && !data.platforms.includes('react-native')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['platforms'],
            message: 'Android is supported through React Native. Select react-native instead of Native Android.',
        });
    }
    if (data.platforms?.includes('web')) {
        const domains = normalizeWebAllowedDomains([
            ...(data.webAllowedDomains ?? []),
            ...(data.webDomain ? [data.webDomain] : []),
        ]);
        if (domains.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['webAllowedDomains'],
                message: 'At least one allowed domain is required when Web is selected',
            });
        }
    }
});

export const updateProjectSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    teamId: z.string().uuid().optional(),
    bundleId: appIdentifierSchema.nullable().optional(),
    packageName: appIdentifierSchema.nullable().optional(),
    webDomain: webAllowedDomainSchema.nullable().optional(),
    webAllowedDomains: webAllowedDomainsSchema.nullable().optional(),
    platforms: z.array(z.enum(['ios', 'android', 'web', 'react-native'])).optional(),
    rejourneyEnabled: z.boolean().optional(),
    recordingEnabled: z.boolean().optional(),
    textInputMasking: textInputMaskingSchema.optional(),
    imageVideoMasking: imageVideoMaskingSchema.optional(),
    recordingFps: recordingFpsSchema.optional(),
    sampleRate: z.number().int().min(0).max(100).optional(),
    maxRecordingMinutes: mobileMaxObservabilityMinutesSchema.optional(),
    webMaxObservabilityMinutes: webMaxObservabilityMinutesSchema.optional(),
}).superRefine((data, ctx) => {
    if (data.platforms?.includes('android') && !data.platforms.includes('react-native')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['platforms'],
            message: 'Android is supported through React Native. Select react-native instead of Native Android.',
        });
    }
});

export const projectIdParamSchema = z.object({
    id: z.string().uuid('Invalid project ID'),
});

export const requestDeleteProjectOtpSchema = z.object({
    confirmText: z.string().min(1, 'Confirmation text is required'),
});

export const sendProjectSetupEmailSchema = z.object({
    email: z.string().trim().email('Invalid email address'),
    aiPrompt: z.string().trim().min(1, 'AI setup prompt is required').max(50000, 'AI setup prompt is too long'),
});

export const deleteProjectSchema = z.object({
    confirmText: z.string().min(1, 'Confirmation text is required'),
    otpCode: z
        .string()
        .length(10, 'OTP must be 10 characters')
        .regex(/^[A-Z0-9]+$/, 'OTP must be alphanumeric'),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type SmartCaptureConfigInput = z.infer<typeof smartCaptureConfigSchema>;
export type SendProjectSetupEmailInput = z.infer<typeof sendProjectSetupEmailSchema>;
