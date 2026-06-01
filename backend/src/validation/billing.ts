/**
 * Billing Validation Schemas
 * 
 * Replay-based billing - no spend caps, fixed session replay limits per plan
 */

import { z } from 'zod';

export const updateQuotaSchema = z.object({
    sessionLimit: z.number().int().positive().nullable().optional(), // Legacy alias for session replay limit (typically set by plan)
    storageCap: z.number().int().positive().nullable().optional(),
    requestCap: z.number().int().positive().nullable().optional(),
});

export const billingPeriodParamSchema = z.object({
    period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be YYYY-MM format').optional(),
});

export type UpdateQuotaInput = z.infer<typeof updateQuotaSchema>;
