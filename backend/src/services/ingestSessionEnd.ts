import { sql } from 'drizzle-orm';
import { sessionMetrics } from '../db/client.js';
import { normalizeEndReason, toFiniteNumber, toNonNegativeInt } from './ingestSdkTelemetry.js';
import { computeSessionDurationSeconds, resolveReportedSessionEndedAt } from './sessionTiming.js';

export type SessionDurationBreakdown = {
    endedAt: Date;
    wallClockSeconds: number;
    backgroundTimeSeconds: number;
    durationSeconds: number;
};

export type SessionEndMetricsMergeOptions = {
    trustClientFrustrationCounts?: boolean;
};

export function shouldTrustClientFrustrationCountsForPlatform(platform: unknown): boolean {
    const normalized = String(platform || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    // Swift 0.2.x and RN 1.2.x can report keyboard typing as client-side rage
    // in /session/end metrics. Mobile event artifacts are the compatibility
    // source of truth because the backend can filter UIKit keyboard labels there.
    return ![
        'ios',
        'android',
        'swift',
        'swiftui',
        'expo',
        'rn',
        'react-native',
        'reactnative',
        'react-native-ios',
        'react-native-android',
        'mobile',
        'native',
    ].includes(normalized);
}

export function normalizeLifecycleVersion(value: unknown): number {
    return Math.max(1, toNonNegativeInt(value) ?? 1);
}

export function normalizeSessionEndReason(value: unknown): string {
    return normalizeEndReason(value) ?? 'legacy';
}

function enumValue(value: unknown, allowed: readonly string[]): string | undefined {
    return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}

export function calculateSessionDurationBreakdown(
    startedAt: Date,
    endedAtInput: unknown,
    totalBackgroundTimeMs: unknown,
    fallbackEndedAt?: Date | null
): SessionDurationBreakdown {
    const endedAt = resolveReportedSessionEndedAt(endedAtInput, fallbackEndedAt);
    const wallClockSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const backgroundTimeSeconds = Math.round((Number(totalBackgroundTimeMs) || 0) / 1000);
    const durationSeconds = computeSessionDurationSeconds(startedAt, endedAt, backgroundTimeSeconds);

    return {
        endedAt,
        wallClockSeconds,
        backgroundTimeSeconds,
        durationSeconds,
    };
}

export function buildSessionEndMetricsMergeSet(
    metrics: any,
    options: SessionEndMetricsMergeOptions = {}
): Record<string, unknown> {
    const updates: Record<string, unknown> = {};
    if (!metrics || typeof metrics !== 'object') {
        return updates;
    }

    const touchCount = toNonNegativeInt(metrics.touchCount);
    if (touchCount !== undefined) updates.touchCount = touchCount;
    const scrollCount = toNonNegativeInt(metrics.scrollCount);
    if (scrollCount !== undefined) updates.scrollCount = scrollCount;
    const gestureCount = toNonNegativeInt(metrics.gestureCount);
    if (gestureCount !== undefined) updates.gestureCount = gestureCount;
    const inputCount = toNonNegativeInt(metrics.inputCount);
    if (inputCount !== undefined) updates.inputCount = inputCount;
    const errorCount = toNonNegativeInt(metrics.errorCount);
    if (errorCount !== undefined) updates.errorCount = errorCount;
    if (options.trustClientFrustrationCounts !== false) {
        const rageTapCount = toNonNegativeInt(metrics.rageTapCount);
        if (rageTapCount !== undefined) updates.rageTapCount = rageTapCount;
    }
    const apiSuccessCount = toNonNegativeInt(metrics.apiSuccessCount);
    if (apiSuccessCount !== undefined) updates.apiSuccessCount = apiSuccessCount;
    const apiErrorCount = toNonNegativeInt(metrics.apiErrorCount);
    if (apiErrorCount !== undefined) updates.apiErrorCount = apiErrorCount;
    const apiTotalCount = toNonNegativeInt(metrics.apiTotalCount);
    if (apiTotalCount !== undefined) updates.apiTotalCount = apiTotalCount;
    const framesCaptured = toNonNegativeInt(metrics.framesCaptured);
    if (framesCaptured !== undefined) updates.framesCaptured = framesCaptured;
    const framesSkippedDuplicate = toNonNegativeInt(metrics.framesSkippedDuplicate);
    if (framesSkippedDuplicate !== undefined) updates.framesSkippedDuplicate = framesSkippedDuplicate;
    const framesSkippedThrottle = toNonNegativeInt(metrics.framesSkippedThrottle);
    if (framesSkippedThrottle !== undefined) updates.framesSkippedThrottle = framesSkippedThrottle;
    const framesSkippedBacklog = toNonNegativeInt(metrics.framesSkippedBacklog);
    if (framesSkippedBacklog !== undefined) updates.framesSkippedBacklog = framesSkippedBacklog;
    const framesSkippedMapMoving = toNonNegativeInt(metrics.framesSkippedMapMoving);
    if (framesSkippedMapMoving !== undefined) updates.framesSkippedMapMoving = framesSkippedMapMoving;

    const thermalStates = ['nominal', 'fair', 'serious', 'critical', 'unknown'] as const;
    for (const key of ['thermalStateStart', 'thermalStatePeak', 'thermalStateEnd'] as const) {
        const value = enumValue(metrics[key], thermalStates);
        if (value !== undefined) updates[key] = value;
    }
    const thermalThrottledDurationMs = toNonNegativeInt(metrics.thermalThrottledDurationMs);
    if (thermalThrottledDurationMs !== undefined) updates.thermalThrottledDurationMs = thermalThrottledDurationMs;
    const memoryPressurePeak = enumValue(metrics.memoryPressurePeak, ['normal', 'warning', 'critical']);
    if (memoryPressurePeak !== undefined) updates.memoryPressurePeak = memoryPressurePeak;
    const memoryPressureEventCount = toNonNegativeInt(metrics.memoryPressureEventCount);
    if (memoryPressureEventCount !== undefined) updates.memoryPressureEventCount = memoryPressureEventCount;
    for (const key of ['memoryHeadroomMbBucketStart', 'memoryHeadroomMbBucketMin', 'memoryHeadroomMbBucketEnd'] as const) {
        const value = toNonNegativeInt(metrics[key]);
        if (value !== undefined && value <= 8192) updates[key] = value;
    }
    const fontScaleBucket = enumValue(metrics.fontScaleBucket, ['compact', 'standard', 'large', 'accessibility']);
    if (fontScaleBucket !== undefined) updates.fontScaleBucket = fontScaleBucket;
    const uiStyle = enumValue(metrics.uiStyle, ['light', 'dark', 'unspecified']);
    if (uiStyle !== undefined) updates.uiStyle = uiStyle;
    const layoutDirection = enumValue(metrics.layoutDirection, ['ltr', 'rtl']);
    if (layoutDirection !== undefined) updates.layoutDirection = layoutDirection;
    for (const key of ['orientationStart', 'orientationEnd'] as const) {
        const value = enumValue(metrics[key], ['portrait', 'landscape', 'unknown']);
        if (value !== undefined) updates[key] = value;
    }
    const orientationChangeCount = toNonNegativeInt(metrics.orientationChangeCount);
    if (orientationChangeCount !== undefined) updates.orientationChangeCount = orientationChangeCount;
    const displayMaxRefreshRateHz = toNonNegativeInt(metrics.displayMaxRefreshRateHz);
    if (displayMaxRefreshRateHz !== undefined && displayMaxRefreshRateHz > 0 && displayMaxRefreshRateHz <= 1000) {
        updates.displayMaxRefreshRateHz = displayMaxRefreshRateHz;
    }
    for (const key of ['batteryLevelStartPercent', 'batteryLevelEndPercent'] as const) {
        const value = toNonNegativeInt(metrics[key]);
        if (value !== undefined && value <= 100) updates[key] = value;
    }
    const batteryDeltaPercent = toFiniteNumber(metrics.batteryDeltaPercent);
    if (batteryDeltaPercent !== undefined && Number.isInteger(batteryDeltaPercent) && batteryDeltaPercent >= -100 && batteryDeltaPercent <= 100) {
        updates.batteryDeltaPercent = batteryDeltaPercent;
    }
    for (const key of ['batteryStateStart', 'batteryStateEnd'] as const) {
        const value = enumValue(metrics[key], ['charging', 'full', 'unplugged', 'unknown']);
        if (value !== undefined) updates[key] = value;
    }
    if (typeof metrics.chargingStateChanged === 'boolean') updates.chargingStateChanged = metrics.chargingStateChanged;
    if (typeof metrics.lowPowerModeObserved === 'boolean') updates.lowPowerModeObserved = metrics.lowPowerModeObserved;
    if (Array.isArray(metrics.screensVisited)) {
        updates.screensVisited = metrics.screensVisited;
    }
    const interactionScore = toFiniteNumber(metrics.interactionScore);
    if (interactionScore !== undefined) updates.interactionScore = interactionScore;
    const explorationScore = toFiniteNumber(metrics.explorationScore);
    if (explorationScore !== undefined) updates.explorationScore = explorationScore;
    const uxScore = toFiniteNumber(metrics.uxScore);
    if (uxScore !== undefined) updates.uxScore = uxScore;

    const reportedCrashCount = toNonNegativeInt(metrics.crashCount);
    if (reportedCrashCount !== undefined) {
        updates.crashCount = sql`GREATEST(COALESCE(${sessionMetrics.crashCount}, 0), ${reportedCrashCount})`;
    }
    const reportedAnrCount = toNonNegativeInt(metrics.anrCount);
    if (reportedAnrCount !== undefined) {
        updates.anrCount = sql`GREATEST(COALESCE(${sessionMetrics.anrCount}, 0), ${reportedAnrCount})`;
    }

    return updates;
}

export function summarizeSessionEndMetrics(
    metrics: any,
    options: SessionEndMetricsMergeOptions = {}
): Record<string, number> {
    if (!metrics || typeof metrics !== 'object') {
        return {};
    }

    const summaryEntries = Object.entries({
        touchCount: toNonNegativeInt(metrics.touchCount),
        scrollCount: toNonNegativeInt(metrics.scrollCount),
        gestureCount: toNonNegativeInt(metrics.gestureCount),
        inputCount: toNonNegativeInt(metrics.inputCount),
        errorCount: toNonNegativeInt(metrics.errorCount),
        rageTapCount: options.trustClientFrustrationCounts === false ? undefined : toNonNegativeInt(metrics.rageTapCount),
        crashCount: toNonNegativeInt(metrics.crashCount),
        anrCount: toNonNegativeInt(metrics.anrCount),
        apiTotalCount: toNonNegativeInt(metrics.apiTotalCount),
        framesCaptured: toNonNegativeInt(metrics.framesCaptured),
        framesSkippedDuplicate: toNonNegativeInt(metrics.framesSkippedDuplicate),
        framesSkippedThrottle: toNonNegativeInt(metrics.framesSkippedThrottle),
        framesSkippedBacklog: toNonNegativeInt(metrics.framesSkippedBacklog),
        framesSkippedMapMoving: toNonNegativeInt(metrics.framesSkippedMapMoving),
    }).filter(([, value]) => value !== undefined) as Array<[string, number]>;

    return Object.fromEntries(summaryEntries);
}
