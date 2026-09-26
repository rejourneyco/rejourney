import { describe, expect, it } from 'vitest';
import {
    buildGameplayIntervals,
    describeGameplayMarker,
    formatGameplayDuration,
    gameplayIntervalAt,
    gameplayOutcomeLabel,
    isGameplayInput,
    isGameplayMarker,
} from './gameplayIntervals';

const start = (timestamp: number, gameplayId = 'a', extra: Record<string, unknown> = {}) => ({ type: 'gameplay', phase: 'start', gameplayId, name: 'arena', timestamp, ...extra });
const end = (timestamp: number, gameplayId = 'a', outcome = 'completed') => ({ type: 'gameplay', phase: 'end', gameplayId, name: 'arena', outcome, durationMs: 1500, timestamp });

describe('replay gameplay intervals', () => {
    it('pairs markers and runs an open segment to the session end', () => {
        const intervals = buildGameplayIntervals([
            { type: 'touch', timestamp: 1_050 },
            start(1_100), end(2_600),
            start(4_000, 'b', { continued: true }),
        ], { start: 1_000, end: 9_000 });
        expect(intervals).toEqual([
            { index: 0, gameplayId: 'a', name: 'arena', outcome: 'completed', continued: false, start: 1_100, end: 2_600, startInferred: false, endInferred: false },
            { index: 1, gameplayId: 'b', name: 'arena', outcome: null, continued: true, start: 4_000, end: 9_000, startInferred: false, endInferred: true },
        ]);
        expect(gameplayIntervalAt(intervals, 2_600)?.gameplayId).toBe('a');
        expect(gameplayIntervalAt(intervals, 3_000)).toBeNull();
    });

    it('matches the backend rules for missing and stray markers', () => {
        const intervals = buildGameplayIntervals([
            start(10), end(20), end(20),
            end(50, 'b', 'failed'),
            start(60, 'c'), end(65, 'z'), start(62, 'd'),
        ], { start: 0, end: 100 });
        expect(intervals.map((interval) => [interval.gameplayId, interval.start, interval.end, interval.startInferred, interval.endInferred])).toEqual([
            ['a', 10, 20, false, false],
            ['b', 20, 50, true, false],
            ['c', 60, 62, false, true],
            ['d', 62, 100, false, true],
        ]);
    });

    it('recognizes markers and input recorded during play', () => {
        expect(isGameplayMarker(start(1))).toBe(true);
        expect(isGameplayMarker({ type: 'custom', name: 'gameplay' })).toBe(false);
        expect(isGameplayInput({ type: 'touch', gameplayId: 'a' })).toBe(true);
        expect(isGameplayInput({ type: 'touch', properties: { gameplayId: 'a' } })).toBe(true);
        expect(isGameplayInput({ type: 'touch' })).toBe(false);
        expect(isGameplayInput(start(1))).toBe(false);
    });

    it('describes markers for the activity list', () => {
        expect(describeGameplayMarker(start(1))).toBe('arena');
        expect(describeGameplayMarker(start(1, 'a', { continued: true }))).toBe('arena · continued from an earlier session');
        expect(describeGameplayMarker(end(2))).toBe('arena · Completed · 1.5s');
        expect(gameplayOutcomeLabel('session_end')).toBe('Recording stopped');
        expect(gameplayOutcomeLabel('boss_defeated')).toBe('boss defeated');
        expect(gameplayOutcomeLabel(null)).toBe('Still playing at session end');
        expect(formatGameplayDuration(95_000)).toBe('1m 35s');
    });
});
