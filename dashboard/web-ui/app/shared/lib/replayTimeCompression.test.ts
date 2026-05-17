import { describe, expect, it } from 'vitest';
import {
    buildCompressedBackgroundGaps,
    compressReplayEvents,
    compressReplayTimestamp,
    formatBackgroundGapDuration,
} from './replayTimeCompression';

describe('replay time compression', () => {
    it('compresses a background interval to a two second replay gap', () => {
        const sessionStart = 1_000;
        const gaps = buildCompressedBackgroundGaps([
            { type: 'session_start', timestamp: sessionStart },
            { type: 'app_background', timestamp: 11_000 },
            { type: 'app_foreground', timestamp: 5 * 60_000 + 11_000 },
        ], sessionStart);

        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toMatchObject({
            startedAt: 11_000,
            endedAt: 311_000,
            durationMs: 300_000,
            compressedStartAt: 11_000,
            compressedEndAt: 13_000,
        });
        expect(compressReplayTimestamp(311_000, gaps)).toBe(13_000);
        expect(compressReplayTimestamp(321_000, gaps)).toBe(23_000);
    });

    it('holds the replay still by dropping rrweb-style events inside the gap', () => {
        const gaps = buildCompressedBackgroundGaps([
            { type: 'app_background', timestamp: 10_000 },
            { type: 'app_foreground', timestamp: 70_000 },
        ], 0);

        const compressed = compressReplayEvents([
            { type: 2, timestamp: 5_000 },
            { type: 3, timestamp: 30_000 },
            { type: 3, timestamp: 80_000 },
        ] as any[], gaps);

        expect(compressed).toHaveLength(2);
        expect(compressed[0].timestamp).toBe(5_000);
        expect(compressed[1].timestamp).toBe(22_000);
    });

    it('formats hidden durations for the replay overlay', () => {
        expect(formatBackgroundGapDuration(45_000)).toBe('45s');
        expect(formatBackgroundGapDuration(125_000)).toBe('2m 5s');
        expect(formatBackgroundGapDuration(3_600_000)).toBe('1h');
    });

    it('builds every web hide/show gap from lifecycle events in a noisy timeline', () => {
        const sessionStart = 1_778_985_147_821;
        const gaps = buildCompressedBackgroundGaps([
            { type: 'session_start', timestamp: sessionStart },
            { type: 'network_request', timestamp: 1_778_985_400_000 },
            { type: 'app_background', timestamp: 1_778_985_400_957 },
            { type: 'app_foreground', timestamp: 1_778_985_442_004 },
            { type: 'app_background', timestamp: 1_778_985_445_497 },
            { type: 'anr', timestamp: 1_778_985_462_076 },
            { type: 'app_foreground', timestamp: 1_778_985_488_570 },
            { type: 'app_background', timestamp: 1_778_985_500_833 },
            { type: 'app_foreground', timestamp: 1_778_985_522_302 },
        ], sessionStart);

        expect(gaps.map((gap) => gap.durationMs)).toEqual([41_047, 43_073, 21_469]);
        expect(gaps.map((gap) => gap.compressedDurationMs)).toEqual([2_000, 2_000, 2_000]);
    });

    it('compresses an open-ended background interval at the end of a session', () => {
        const gaps = buildCompressedBackgroundGaps([
            { type: 'session_start', timestamp: 1_000 },
            { type: 'app_background', timestamp: 13_000 },
        ], 1_000, 2_000, { terminalEndMs: 50_000 });

        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toMatchObject({
            startedAt: 13_000,
            endedAt: 50_000,
            durationMs: 37_000,
            compressedStartAt: 13_000,
            compressedEndAt: 15_000,
        });
        expect(compressReplayTimestamp(50_000, gaps)).toBe(15_000);
    });
});
