/**
 * Shared parsing for dashboard `timeRange` query params (days lookback).
 */

/** When a chart uses `all` / `max` but must stay bounded (e.g. regional rollups). */
export const ANALYTICS_LONG_WINDOW_DAYS = 730;

/**
 * Explicit bounded windows. Returns undefined for `all`, `max`, or unknown —
 * callers then decide unbounded vs default vs long cap.
 */
export function boundedTimeRangeToDays(timeRange: string): number | undefined {
    switch (timeRange) {
        case '24h':
            return 1;
        case '7d':
            return 7;
        case '30d':
            return 30;
        case '90d':
            return 90;
        case '180d':
            return 180;
        case '1y':
        case '365d':
            return 365;
        default:
            return undefined;
    }
}
