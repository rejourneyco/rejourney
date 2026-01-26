/**
 * Ingest Validation Schemas
 */

import { z } from 'zod';

export const endSessionSchema = z.object({
    sessionId: z.string(),
    endedAt: z.number().optional(),
    totalBackgroundTimeMs: z.number().optional(), // Background time in milliseconds for billing exclusion
    metrics: z.object({
        totalEvents: z.number().int().optional(),
        touchCount: z.number().int().optional(),
        scrollCount: z.number().int().optional(),
        gestureCount: z.number().int().optional(),
        inputCount: z.number().int().optional(),
        errorCount: z.number().int().optional(),
        rageTapCount: z.number().int().optional(),
        apiSuccessCount: z.number().int().optional(),
        apiErrorCount: z.number().int().optional(),
        apiTotalCount: z.number().int().optional(),
        screensVisited: z.array(z.string()).optional(),
        interactionScore: z.number().optional(),
        explorationScore: z.number().optional(),
        uxScore: z.number().optional(),
    }).optional(),
    // SDK Telemetry - health metrics from the SDK for observability
    sdkTelemetry: z.object({
        uploadSuccessCount: z.number().int().optional(),
        uploadFailureCount: z.number().int().optional(),
        retryAttemptCount: z.number().int().optional(),
        circuitBreakerOpenCount: z.number().int().optional(),
        memoryEvictionCount: z.number().int().optional(),
        offlinePersistCount: z.number().int().optional(),
        sessionStartCount: z.number().int().optional(),
        crashCount: z.number().int().optional(),
        uploadSuccessRate: z.number().optional(),
        avgUploadDurationMs: z.number().optional(),
        currentQueueDepth: z.number().int().optional(),
        lastUploadTime: z.number().nullable().optional(),
        lastRetryTime: z.number().nullable().optional(),
        totalBytesUploaded: z.number().optional(),
        totalBytesEvicted: z.number().optional(),
    }).optional(),
});


export type EndSessionInput = z.infer<typeof endSessionSchema>;
