import { sql } from 'drizzle-orm';
import { sessionMetrics } from '../db/client.js';
import { normalizeEndReason, toFiniteNumber, toNonNegativeInt } from './ingestSdkTelemetry.js';

export type SessionDurationBreakdown = {
    endedAt: Date;
    wallClockSeconds: number;
    backgroundTimeSeconds: number;
    durationSeconds: number;
};

export function normalizeLifecycleVersion(value: unknown): number {
    return Math.max(1, toNonNegativeInt(value) ?? 1);
}

export function normalizeSessionEndReason(value: unknown): string {
    return normalizeEndReason(value) ?? 'legacy';
}

export function calculateSessionDurationBreakdown(
    startedAt: Date,
    endedAtInput: unknown,
    totalBackgroundTimeMs: unknown
): SessionDurationBreakdown {
    const endedAt = endedAtInput ? new Date(endedAtInput as string | number | Date) : new Date();
    const wallClockSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const backgroundTimeSeconds = Math.round((Number(totalBackgroundTimeMs) || 0) / 1000);
    let durationSeconds = Math.max(0, wallClockSeconds - backgroundTimeSeconds);

    if (durationSeconds <= 0) {
        durationSeconds = 1;
    }

    return {
        endedAt,
        wallClockSeconds,
        backgroundTimeSeconds,
        durationSeconds,
    };
}

export function buildSessionEndMetricsMergeSet(metrics: any): Record<string, unknown> {
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
    const rageTapCount = toNonNegativeInt(metrics.rageTapCount);
    if (rageTapCount !== undefined) updates.rageTapCount = rageTapCount;
    const apiSuccessCount = toNonNegativeInt(metrics.apiSuccessCount);
    if (apiSuccessCount !== undefined) updates.apiSuccessCount = apiSuccessCount;
    const apiErrorCount = toNonNegativeInt(metrics.apiErrorCount);
    if (apiErrorCount !== undefined) updates.apiErrorCount = apiErrorCount;
    const apiTotalCount = toNonNegativeInt(metrics.apiTotalCount);
    if (apiTotalCount !== undefined) updates.apiTotalCount = apiTotalCount;
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

export function summarizeSessionEndMetrics(metrics: any): Record<string, number> {
    if (!metrics || typeof metrics !== 'object') {
        return {};
    }

    const summaryEntries = Object.entries({
        touchCount: toNonNegativeInt(metrics.touchCount),
        scrollCount: toNonNegativeInt(metrics.scrollCount),
        gestureCount: toNonNegativeInt(metrics.gestureCount),
        inputCount: toNonNegativeInt(metrics.inputCount),
        errorCount: toNonNegativeInt(metrics.errorCount),
        rageTapCount: toNonNegativeInt(metrics.rageTapCount),
        crashCount: toNonNegativeInt(metrics.crashCount),
        anrCount: toNonNegativeInt(metrics.anrCount),
        apiTotalCount: toNonNegativeInt(metrics.apiTotalCount),
    }).filter(([, value]) => value !== undefined) as Array<[string, number]>;

    return Object.fromEntries(summaryEntries);
}
