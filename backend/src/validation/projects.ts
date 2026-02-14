/**
 * Project Validation Schemas
 */

import { z } from 'zod';

export const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    bundleId: z.string().optional(),
    packageName: z.string().optional(),
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
    bundleId: z.string().min(1).max(255).optional(),
    packageName: z.string().min(1).max(255).optional(),
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
