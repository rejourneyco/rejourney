/**
 * Project Validation Schemas
 */

import { z } from 'zod';

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

const IOS_BUNDLE_REGEX = /^[A-Za-z0-9.\-]{1,155}$/;
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

export const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    bundleId: appIdentifierSchema.optional(),
    packageName: appIdentifierSchema.optional(),
    teamId: z.string().uuid().optional(),
    webDomain: z.string().url().optional(),
    platforms: z.array(z.enum(['ios', 'android', 'web', 'react-native'])).optional(),
    rejourneyEnabled: z.boolean().optional().default(true),
    recordingEnabled: z.boolean().optional().default(true),
    sampleRate: z.number().int().min(0).max(100).optional().default(100),
    healthyReplaysPromoted: z.number().min(0).max(1).optional().default(0.05),
    maxRecordingMinutes: z.number().int().min(1).max(10).optional().default(10),
});

export const updateProjectSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    teamId: z.string().uuid().optional(),
    bundleId: appIdentifierSchema.optional(),
    packageName: appIdentifierSchema.optional(),
    webDomain: z.string().url().nullable().optional(),
    rejourneyEnabled: z.boolean().optional(),
    recordingEnabled: z.boolean().optional(),
    sampleRate: z.number().int().min(0).max(100).optional(),
    healthyReplaysPromoted: z.number().min(0).max(1).optional(),
    maxRecordingMinutes: z.number().int().min(1).max(10).optional(),
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
