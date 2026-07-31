export type StabilityTrendKind =
    | 'crash'
    | 'anr'
    | 'error'
    | 'api_error_rate'
    | 'api_latency';

export interface StabilityTrend {
    signalKey: string;
    kind: StabilityTrendKind;
    title: string;
    subtitle?: string | null;
    shortId?: string | null;
    issueId?: string | null;
    dashboardPath: string;
    currentValue: number;
    baselineValue: number;
    growthPercent: number;
    occurrences?: number | null;
    affectedUsers?: number | null;
    affectedSessions?: number | null;
    appVersion?: string | null;
    lastSeen?: Date | null;
}

export interface RisingIssueWindow {
    currentOccurrences: number;
    baselineOccurrences: number;
    currentAffectedUsers: number;
    baselineWindowCount?: number;
}

export const STABILITY_DIGEST_WEEKLY_CAP = 3;
export const STABILITY_DIGEST_WINDOW_DAYS = 7;
export const STABILITY_CURRENT_WINDOW_HOURS = 6;
export const STABILITY_BASELINE_WINDOW_HOURS = 42;
export const STABILITY_MIN_ISSUE_OCCURRENCES = 5;
export const STABILITY_MIN_AFFECTED_USERS = 2;
export const STABILITY_MIN_GROWTH_MULTIPLIER = 2;
export const STABILITY_MIN_API_SESSIONS = 20;
export const STABILITY_MIN_API_ERRORS = 5;
export const STABILITY_MIN_API_ERROR_RATE_PERCENT = 5;
export const STABILITY_MIN_API_LATENCY_MS = 1000;

export function normalizedBaselineValue(
    baselineOccurrences: number,
    baselineWindowCount = 7,
): number {
    if (!Number.isFinite(baselineOccurrences) || baselineOccurrences <= 0) return 0;
    return baselineOccurrences / Math.max(1, baselineWindowCount);
}

export function growthPercent(currentValue: number, baselineValue: number): number {
    if (!Number.isFinite(currentValue) || currentValue <= 0) return 0;
    if (!Number.isFinite(baselineValue) || baselineValue <= 0) return currentValue * 100;
    return Math.max(0, ((currentValue - baselineValue) / baselineValue) * 100);
}

export function qualifiesAsRisingIssue(window: RisingIssueWindow): boolean {
    if (window.currentOccurrences < STABILITY_MIN_ISSUE_OCCURRENCES) return false;
    if (window.currentAffectedUsers < STABILITY_MIN_AFFECTED_USERS) return false;

    const baseline = normalizedBaselineValue(
        window.baselineOccurrences,
        window.baselineWindowCount,
    );
    if (baseline === 0) return true;

    return window.currentOccurrences / baseline >= STABILITY_MIN_GROWTH_MULTIPLIER;
}

export function qualifiesAsApiErrorTrend(input: {
    currentRatePercent: number;
    baselineRatePercent: number;
    currentSessions: number;
    currentErrors: number;
}): boolean {
    if (input.currentSessions < STABILITY_MIN_API_SESSIONS) return false;
    if (input.currentErrors < STABILITY_MIN_API_ERRORS) return false;
    if (input.currentRatePercent < STABILITY_MIN_API_ERROR_RATE_PERCENT) return false;
    if (input.baselineRatePercent <= 0) return true;
    return input.currentRatePercent / input.baselineRatePercent >= STABILITY_MIN_GROWTH_MULTIPLIER;
}

export function qualifiesAsApiLatencyTrend(input: {
    currentLatencyMs: number;
    baselineLatencyMs: number;
    currentSessions: number;
}): boolean {
    if (input.currentSessions < STABILITY_MIN_API_SESSIONS) return false;
    if (input.currentLatencyMs < STABILITY_MIN_API_LATENCY_MS) return false;
    if (input.baselineLatencyMs <= 0) return false;
    return input.currentLatencyMs / input.baselineLatencyMs >= STABILITY_MIN_GROWTH_MULTIPLIER;
}

function trendScore(trend: StabilityTrend): number {
    const severityWeight =
        trend.kind === 'crash' ? 5 :
            trend.kind === 'anr' ? 4 :
                trend.kind === 'error' ? 3 :
                    2;
    const impact =
        Math.max(1, trend.affectedUsers || 0) * 4 +
        Math.max(1, trend.occurrences || trend.affectedSessions || 0);
    const growth = Math.max(1, Math.min(10, trend.growthPercent / 100));
    return severityWeight * impact * growth;
}

export function rankStabilityTrends(trends: StabilityTrend[]): StabilityTrend[] {
    return trends
        .slice()
        .sort((a, b) =>
            trendScore(b) - trendScore(a) ||
            (b.affectedUsers || 0) - (a.affectedUsers || 0) ||
            (b.occurrences || 0) - (a.occurrences || 0) ||
            a.title.localeCompare(b.title)
        );
}

export function selectStabilityDigestTrends(input: {
    trends: StabilityTrend[];
    recentDigestCount: number;
    recentlyReportedSignalKeys: Iterable<string>;
    maxItems?: number;
}): {
    trends: StabilityTrend[];
    reason?: 'weekly_cap' | 'already_reported';
} {
    if (input.recentDigestCount >= STABILITY_DIGEST_WEEKLY_CAP) {
        return { trends: [], reason: 'weekly_cap' };
    }

    const recentlyReported = new Set(input.recentlyReportedSignalKeys);
    const trends = rankStabilityTrends(input.trends)
        .filter((trend) => !recentlyReported.has(trend.signalKey))
        .slice(0, input.maxItems ?? 5);
    if (trends.length === 0) {
        return { trends: [], reason: 'already_reported' };
    }
    return { trends };
}
