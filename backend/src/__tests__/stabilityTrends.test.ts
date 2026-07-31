import { describe, expect, it } from 'vitest';
import {
    growthPercent,
    qualifiesAsApiErrorTrend,
    qualifiesAsApiLatencyTrend,
    qualifiesAsRisingIssue,
    rankStabilityTrends,
    selectStabilityDigestTrends,
} from '../services/stabilityTrends.js';

describe('stability trend qualification', () => {
    it('rejects individual occurrences and requires repeated multi-user impact', () => {
        expect(qualifiesAsRisingIssue({
            currentOccurrences: 1,
            baselineOccurrences: 0,
            currentAffectedUsers: 1,
        })).toBe(false);
        expect(qualifiesAsRisingIssue({
            currentOccurrences: 7,
            baselineOccurrences: 0,
            currentAffectedUsers: 2,
        })).toBe(true);
    });

    it('requires at least a twofold rise over the normalized baseline', () => {
        expect(qualifiesAsRisingIssue({
            currentOccurrences: 7,
            baselineOccurrences: 28,
            currentAffectedUsers: 3,
            baselineWindowCount: 7,
        })).toBe(false);
        expect(qualifiesAsRisingIssue({
            currentOccurrences: 8,
            baselineOccurrences: 28,
            currentAffectedUsers: 3,
            baselineWindowCount: 7,
        })).toBe(true);
    });

    it('rejects low-volume API noise even when the percentage multiplier is large', () => {
        expect(qualifiesAsApiErrorTrend({
            currentRatePercent: 10,
            baselineRatePercent: 1,
            currentSessions: 8,
            currentErrors: 2,
        })).toBe(false);
        expect(qualifiesAsApiErrorTrend({
            currentRatePercent: 10,
            baselineRatePercent: 4,
            currentSessions: 30,
            currentErrors: 8,
        })).toBe(true);
    });

    it('requires both material latency and a twofold rise', () => {
        expect(qualifiesAsApiLatencyTrend({
            currentLatencyMs: 800,
            baselineLatencyMs: 200,
            currentSessions: 30,
        })).toBe(false);
        expect(qualifiesAsApiLatencyTrend({
            currentLatencyMs: 1400,
            baselineLatencyMs: 600,
            currentSessions: 30,
        })).toBe(true);
    });

    it('ranks high-impact crash groups ahead of lower-impact signals', () => {
        const ranked = rankStabilityTrends([
            {
                signalKey: 'api:error-rate',
                kind: 'api_error_rate',
                title: 'API errors',
                dashboardPath: '/api',
                currentValue: 10,
                baselineValue: 2,
                growthPercent: growthPercent(10, 2),
                affectedSessions: 20,
            },
            {
                signalKey: 'issue:crash',
                kind: 'crash',
                title: 'Crash group',
                dashboardPath: '/general/crash',
                currentValue: 12,
                baselineValue: 1,
                growthPercent: growthPercent(12, 1),
                occurrences: 12,
                affectedUsers: 6,
            },
        ]);

        expect(ranked[0].signalKey).toBe('issue:crash');
    });

    it('enforces the rolling weekly cap and suppresses already-reported signals', () => {
        const trend = {
            signalKey: 'issue:crash',
            kind: 'crash' as const,
            title: 'Crash group',
            dashboardPath: '/general/crash',
            currentValue: 12,
            baselineValue: 1,
            growthPercent: 1100,
        };

        expect(selectStabilityDigestTrends({
            trends: [trend],
            recentDigestCount: 3,
            recentlyReportedSignalKeys: [],
        })).toEqual({ trends: [], reason: 'weekly_cap' });
        expect(selectStabilityDigestTrends({
            trends: [trend],
            recentDigestCount: 1,
            recentlyReportedSignalKeys: ['issue:crash'],
        })).toEqual({ trends: [], reason: 'already_reported' });
    });
});
