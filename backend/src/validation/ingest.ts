/**
 * Ingest Validation Schemas
 */

import { z } from 'zod';

const postgresCounter = z.number().int().min(0).max(2_147_483_647);

export const endSessionSchema = z.object({
    sessionId: z.string(),
    endedAt: z.number().optional(),
    closeAnchorAtMs: z.number().optional(),
    totalBackgroundTimeMs: z.number().optional(), // Background time in milliseconds for billing exclusion
    endReason: z.string().min(1).max(64).optional(), // Optional lifecycle reason (v2+ SDKs)
    lifecycleVersion: z.number().int().min(1).optional(), // Optional lifecycle contract version
    isSampledIn: z.boolean().optional(),
    metrics: z.object({
        totalEvents: z.number().int().optional(),
        touchCount: z.number().int().optional(),
        scrollCount: z.number().int().optional(),
        gestureCount: z.number().int().optional(),
        inputCount: z.number().int().optional(),
        errorCount: z.number().int().optional(),
        crashCount: z.number().int().optional(),
        anrCount: z.number().int().optional(),
        rageTapCount: z.number().int().optional(),
        apiSuccessCount: z.number().int().optional(),
        apiErrorCount: z.number().int().optional(),
        apiTotalCount: z.number().int().optional(),
        framesCaptured: postgresCounter.optional(),
        framesSkippedDuplicate: postgresCounter.optional(),
        framesSkippedThrottle: postgresCounter.optional(),
        framesSkippedBacklog: postgresCounter.optional(),
        framesSkippedMapMoving: postgresCounter.optional(),
        thermalStateStart: z.enum(['nominal', 'fair', 'serious', 'critical', 'unknown']).optional(),
        thermalStatePeak: z.enum(['nominal', 'fair', 'serious', 'critical', 'unknown']).optional(),
        thermalStateEnd: z.enum(['nominal', 'fair', 'serious', 'critical', 'unknown']).optional(),
        thermalThrottledDurationMs: z.number().int().nonnegative().optional(),
        memoryPressurePeak: z.enum(['normal', 'warning', 'critical']).optional(),
        memoryPressureEventCount: postgresCounter.optional(),
        memoryHeadroomMbBucketStart: z.number().int().min(0).max(8192).optional(),
        memoryHeadroomMbBucketMin: z.number().int().min(0).max(8192).optional(),
        memoryHeadroomMbBucketEnd: z.number().int().min(0).max(8192).optional(),
        fontScaleBucket: z.enum(['compact', 'standard', 'large', 'accessibility']).optional(),
        uiStyle: z.enum(['light', 'dark', 'unspecified']).optional(),
        layoutDirection: z.enum(['ltr', 'rtl']).optional(),
        orientationStart: z.enum(['portrait', 'landscape', 'unknown']).optional(),
        orientationEnd: z.enum(['portrait', 'landscape', 'unknown']).optional(),
        orientationChangeCount: postgresCounter.optional(),
        displayMaxRefreshRateHz: z.number().int().positive().max(1000).optional(),
        batteryLevelStartPercent: z.number().int().min(0).max(100).optional(),
        batteryLevelEndPercent: z.number().int().min(0).max(100).optional(),
        batteryDeltaPercent: z.number().int().min(-100).max(100).optional(),
        batteryStateStart: z.enum(['charging', 'full', 'unplugged', 'unknown']).optional(),
        batteryStateEnd: z.enum(['charging', 'full', 'unplugged', 'unknown']).optional(),
        chargingStateChanged: z.boolean().optional(),
        lowPowerModeObserved: z.boolean().optional(),
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
    /** Mobile package semver; optional for older SDKs */
    sdkVersion: z.string().max(50).optional(),
});

export const sdkPauseStateSchema = z.object({
    sessionId: z.string().min(1).max(64),
    pauseId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
    paused: z.boolean(),
    occurredAt: z.number().positive(),
    isSampledIn: z.boolean().optional(),
    sdkVersion: z.string().max(50).optional(),
});


export type EndSessionInput = z.infer<typeof endSessionSchema>;
export type SdkPauseStateInput = z.infer<typeof sdkPauseStateSchema>;
