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
    bundleId: appIdentifierSchema.optional(),
    packageName: appIdentifierSchema.optional(),
    webDomain: webAllowedDomainSchema.nullable().optional(),
    webAllowedDomains: webAllowedDomainsSchema.nullable().optional(),
    rejourneyEnabled: z.boolean().optional(),
    recordingEnabled: z.boolean().optional(),
    textInputMasking: textInputMaskingSchema.optional(),
    imageVideoMasking: imageVideoMaskingSchema.optional(),
    recordingFps: recordingFpsSchema.optional(),
    sampleRate: z.number().int().min(0).max(100).optional(),
    maxRecordingMinutes: mobileMaxObservabilityMinutesSchema.optional(),
    webMaxObservabilityMinutes: webMaxObservabilityMinutesSchema.optional(),
});

export const projectIdParamSchema = z.object({
    id: z.string().uuid('Invalid project ID'),
});

export const requestDeleteProjectOtpSchema = z.object({
    confirmText: z.string().min(1, 'Confirmation text is required'),
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
