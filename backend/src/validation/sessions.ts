/**
 * Session Validation Schemas
 */

import { z } from 'zod';

export const timeRangeSchema = z.enum(['24h', '7d', '30d', '90d', '1y', 'all']).optional();

export const sessionsQuerySchema = z.object({
    timeRange: timeRangeSchema,
    projectId: z.string().uuid().optional(),
    platform: z.enum(['ios', 'android']).optional(),
    status: z.enum(['pending', 'processing', 'ready', 'failed', 'deleted']).optional(),
    limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
    offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
});

export const sessionIdParamSchema = z.object({
    id: z.string({ required_error: 'Session ID is required' }),
});

export const networkGroupBySchema = z.object({
    groupBy: z.enum(['host', 'path']).optional(),
});

export const dashboardStatsQuerySchema = z.object({
    timeRange: timeRangeSchema,
    projectId: z.string().uuid().optional(),
});

export type SessionsQuery = z.infer<typeof sessionsQuerySchema>;
export type DashboardStatsQuery = z.infer<typeof dashboardStatsQuerySchema>;
