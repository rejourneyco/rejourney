import { describe, expect, it } from 'vitest';
import { buildCompressedBackgroundGaps } from './replayTimeCompression';
import { createReplaySessionClock, rrwebPlaybackOffsetMs } from './replaySessionClock';

const start = 1_000;
const gaps = buildCompressedBackgroundGaps([
    { type: 'app_background', timestamp: start + 10_000 },
    { type: 'app_foreground', timestamp: start + 70_000 },
    { type: 'app_background', timestamp: start + 80_000 },
    { type: 'app_foreground', timestamp: start + 140_000 },
], start);

function clock(overrides = {}) {
    return createReplaySessionClock({ startedAt: start, playbackDurationSeconds: 34,
        sessionDurationSeconds: 30, backgroundGaps: gaps, ...overrides });
}

describe('replay session clock', () => {
    it('shows the list active duration while retaining the two-second Away pauses', () => {
        const result = clock();
        expect(result.durationSeconds).toBe(30);
        expect(result.secondsAt(0)).toBe(0);
        expect(result.secondsAt(10)).toBe(10);
        expect(result.secondsAt(11)).toBe(10);
        expect(result.secondsAt(12)).toBe(10);
        expect(result.secondsAt(22)).toBe(20);
        expect(result.secondsAt(23)).toBe(20);
        expect(result.secondsAt(24)).toBe(20);
        expect(result.secondsAt(34)).toBe(30);
    });
    it('does not add more active duration for additional background transitions', () => {
        const multipleGaps = buildCompressedBackgroundGaps(Array.from({ length: 7 }, (_, i) => [
            { type: 'app_background', timestamp: start + (i + 1) * 10_000 + i * 60_000 },
            { type: 'app_foreground', timestamp: start + (i + 1) * 10_000 + (i + 1) * 60_000 },
        ]).flat(), start);
        const result = clock({ playbackDurationSeconds: 94, sessionDurationSeconds: 80, backgroundGaps: multipleGaps });
        expect(result.durationSeconds).toBe(80);
        expect(result.secondsAt(94)).toBe(80);
        expect(result.secondsAt(11)).toBe(10);
    });
    it('normalizes fractional capture timing to the API rounded duration', () => {
        const result = clock({ playbackDurationSeconds: 33.6 });
        expect(result.secondsAt(33.6)).toBe(30);
        expect(result.secondsAt(11)).toBeCloseTo(10 * 30 / 29.6);
        expect(result.secondsAt(12)).toBeCloseTo(result.secondsAt(11));
    });
    it('holds the active clock through a terminal background interval', () => {
        const terminal = buildCompressedBackgroundGaps([
            { type: 'app_background', timestamp: start + 10_000 },
        ], start, undefined, { terminalEndMs: start + 70_000 });
        const result = clock({ playbackDurationSeconds: 12, sessionDurationSeconds: 10, backgroundGaps: terminal });
        expect(result.secondsAt(10)).toBe(10);
        expect(result.secondsAt(11)).toBe(10);
        expect(result.secondsAt(12)).toBe(10);
    });
    it('keeps the displayed total stable while replay segments and lifecycle events load', () => {
        const result = clock({ playbackDurationSeconds: 150, backgroundGaps: [] });
        expect(result.durationSeconds).toBe(30);
        expect(result.secondsAt(150)).toBe(30);
        expect(clock().durationSeconds).toBe(result.durationSeconds);
    });
    it('uses observed active time if no authoritative duration exists', () => {
        const result = clock({ sessionDurationSeconds: Number.NaN });
        expect(result.durationSeconds).toBe(30);
        expect(result.secondsAt(34)).toBe(30);
    });
    it('clamps seeks and handles missing playback evidence', () => {
        expect(clock().secondsAt(-10)).toBe(0);
        expect(clock().secondsAt(100)).toBe(30);
        expect(clock().secondsAt(Number.NaN)).toBe(0);
        expect(clock({ playbackDurationSeconds: 0 }).secondsAt(10)).toBe(0);
    });
});

describe('rrweb session timeline offset', () => {
    const input = { timeSeconds: 5, durationSeconds: 30, firstEventTimestamp: start + 2_000, sessionStartedAt: start };
    it('keeps the first frame still until its session-relative capture time', () => {
        expect(rrwebPlaybackOffsetMs({ ...input, timeSeconds: 0 })).toBe(0);
        expect(rrwebPlaybackOffsetMs({ ...input, timeSeconds: 1 })).toBe(0);
        expect(rrwebPlaybackOffsetMs({ ...input, timeSeconds: 2 })).toBe(0);
        expect(rrwebPlaybackOffsetMs(input)).toBe(3_000);
    });
    it('keeps seeks aligned when rrweb starts later than the session', () => {
        expect(rrwebPlaybackOffsetMs({ ...input, timeSeconds: 25 })).toBe(23_000);
        expect(rrwebPlaybackOffsetMs({ ...input, timeSeconds: 100 })).toBe(28_000);
        expect(rrwebPlaybackOffsetMs({ ...input, timeSeconds: -1 })).toBe(0);
    });
    it('skips evidence before the session boundary', () => {
        expect(rrwebPlaybackOffsetMs({ ...input, firstEventTimestamp: start - 1_000 })).toBe(6_000);
    });
    it('preserves offsets when the first event already starts at the session boundary', () => {
        expect(rrwebPlaybackOffsetMs({ ...input, firstEventTimestamp: start })).toBe(5_000);
    });
});
