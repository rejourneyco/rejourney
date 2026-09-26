import { describe, expect, it } from 'vitest';
import {
    deriveGameplayIntervals,
    gameplayIdOfTelemetryEvent,
    gameplayIntervalAt,
    gameplayIntervalOverlapping,
    gameplayMarkersFromEvents,
    isGameplayMarkerEvent,
    isGameplayTelemetryEvent,
    normalizeGameplayOutcome,
    parseGameplayMarker,
    type GameplayMarker,
} from '../utils/gameplayIntervals.js';

const start = (at: number, gameplayId: string | null = 'a', extra: Partial<GameplayMarker> = {}): GameplayMarker => ({
    phase: 'start', gameplayId, name: 'level', outcome: null, continued: false, at, ...extra,
});
const end = (at: number, gameplayId: string | null = 'a', outcome: string | null = 'completed'): GameplayMarker => ({
    phase: 'end', gameplayId, name: 'level', outcome, continued: false, at,
});

describe('gameplay markers', () => {
    it('parses the SDK wire contract and ignores other events', () => {
        const event = { type: 'gameplay', phase: 'END', gameplayId: 'f'.repeat(32), name: ' level_3 ', outcome: 'failed', durationMs: 900, timestamp: 5 };
        expect(isGameplayMarkerEvent(event)).toBe(true);
        expect(parseGameplayMarker(event, 5)).toEqual({ phase: 'end', gameplayId: 'f'.repeat(32), name: 'level_3', outcome: 'failed', continued: false, at: 5 });
        expect(parseGameplayMarker({ ...event, phase: 'pause' }, 5)).toBeNull();
        expect(parseGameplayMarker(event, null)).toBeNull();
        expect(parseGameplayMarker({ type: 'custom', name: 'gameplay', phase: 'start' }, 5)).toBeNull();
        expect(parseGameplayMarker({ type: 'gameplay', phase: 'start', continued: true }, 1)).toMatchObject({ phase: 'start', continued: true, outcome: null });
    });

    it('detects input recorded during play wherever the SDK put the segment id', () => {
        expect(isGameplayTelemetryEvent({ type: 'touch', gameplayId: 'abc' })).toBe(true);
        expect(isGameplayTelemetryEvent({ type: 'touch', properties: { gameplayId: 'abc' } })).toBe(true);
        expect(isGameplayTelemetryEvent({ type: 'touch', payload: { gameplayId: 'abc' } })).toBe(true);
        expect(isGameplayTelemetryEvent({ type: 'touch', gameplayId: '' })).toBe(false);
        expect(isGameplayTelemetryEvent({ type: 'touch' })).toBe(false);
        expect(isGameplayTelemetryEvent(null)).toBe(false);
        expect(gameplayIdOfTelemetryEvent({ properties: { gameplayId: 'abc' } })).toBe('abc');
    });

    it('orders markers by time and keeps event order for ties', () => {
        const markers = gameplayMarkersFromEvents([
            { type: 'gameplay', phase: 'start', gameplayId: 'b', timestamp: 20 },
            { type: 'touch', timestamp: 5 },
            { type: 'gameplay', phase: 'end', gameplayId: 'a', timestamp: 20 },
            { type: 'gameplay', phase: 'start', gameplayId: 'a', timestamp: 10 },
        ], (event) => Number(event.timestamp));
        expect(markers.map((marker) => `${marker.phase}:${marker.gameplayId}@${marker.at}`)).toEqual(['start:a@10', 'start:b@20', 'end:a@20']);
    });

    it('normalizes outcomes to a closed vocabulary', () => {
        expect(normalizeGameplayOutcome('Completed')).toBe('completed');
        expect(normalizeGameplayOutcome('session_end')).toBe('session_end');
        expect(normalizeGameplayOutcome('boss_defeated')).toBe('other');
        expect(normalizeGameplayOutcome(null)).toBeNull();
    });
});

describe('gameplay intervals', () => {
    it('pairs starts and ends into non-overlapping intervals', () => {
        const intervals = deriveGameplayIntervals([start(10), end(20), start(30, 'b'), end(45, 'b', 'quit')], { start: 0, end: 100 });
        expect(intervals).toEqual([
            { index: 0, gameplayId: 'a', name: 'level', start: 10, end: 20, outcome: 'completed', continued: false, startInferred: false, endInferred: false },
            { index: 1, gameplayId: 'b', name: 'level', start: 30, end: 45, outcome: 'quit', continued: false, startInferred: false, endInferred: false },
        ]);
    });

    it('runs an interval without an end marker to the session end', () => {
        const [interval] = deriveGameplayIntervals([start(10, 'a', { continued: true })], { start: 0, end: 90 });
        expect(interval).toMatchObject({ start: 10, end: 90, outcome: null, continued: true, endInferred: true });
        const [open] = deriveGameplayIntervals([start(10), start(10, 'a')], { start: 0, end: null });
        expect(open).toMatchObject({ start: 10, end: 10, endInferred: true });
    });

    it('closes the open segment when a new one starts without its end marker', () => {
        const intervals = deriveGameplayIntervals([start(10, 'a'), start(25, 'b'), end(40, 'b')], { start: 0, end: 60 });
        expect(intervals.map((interval) => [interval.gameplayId, interval.start, interval.end, interval.endInferred])).toEqual([
            ['a', 10, 25, true],
            ['b', 25, 40, false],
        ]);
    });

    it('keeps the SDK superseded pair as two adjacent intervals', () => {
        const intervals = deriveGameplayIntervals([start(10, 'a'), end(25, 'a', 'superseded'), start(25, 'b'), end(40, 'b')], { start: 0, end: 60 });
        expect(intervals.map((interval) => [interval.gameplayId, interval.start, interval.end, interval.outcome])).toEqual([
            ['a', 10, 25, 'superseded'],
            ['b', 25, 40, 'completed'],
        ]);
    });

    it('reaches back when a start marker was lost, and ignores duplicate and stray ends', () => {
        const intervals = deriveGameplayIntervals([
            start(10, 'a'), end(20, 'a'), end(20, 'a'),
            end(50, 'b', 'failed'),
            start(60, 'c'), end(65, 'z'), end(70, 'c'),
        ], { start: 0, end: 100 });
        expect(intervals.map((interval) => [interval.gameplayId, interval.start, interval.end, interval.startInferred])).toEqual([
            ['a', 10, 20, false],
            ['b', 20, 50, true],
            ['c', 60, 70, false],
        ]);
        const [orphan] = deriveGameplayIntervals([end(30, 'x')], { start: 5, end: 100 });
        expect(orphan).toMatchObject({ start: 5, end: 30, startInferred: true, continued: true });
    });

    it('clamps markers recorded before the session start', () => {
        const [interval] = deriveGameplayIntervals([start(-500), end(40)], { start: 0, end: 100 });
        expect(interval).toMatchObject({ start: 0, end: 40 });
    });

    it('finds the interval containing a time, bounds inclusive', () => {
        const intervals = deriveGameplayIntervals([start(10), end(20), start(30, 'b'), end(40, 'b')], { start: 0, end: 100 });
        expect(gameplayIntervalAt(intervals, 10)?.gameplayId).toBe('a');
        expect(gameplayIntervalAt(intervals, 20)?.gameplayId).toBe('a');
        expect(gameplayIntervalAt(intervals, 25)).toBeNull();
        expect(gameplayIntervalAt(intervals, 35)?.gameplayId).toBe('b');
        expect(gameplayIntervalAt(intervals, 41)).toBeNull();
        expect(gameplayIntervalAt(intervals, null)).toBeNull();
        expect(gameplayIntervalAt([], 10)).toBeNull();
        expect(gameplayIntervalOverlapping(intervals, 0, 10)).toBeNull();
        expect(gameplayIntervalOverlapping(intervals, 5, 11)?.gameplayId).toBe('a');
        expect(gameplayIntervalOverlapping(intervals, 21, 30)).toBeNull();
        expect(gameplayIntervalOverlapping(intervals, 21, 31)?.gameplayId).toBe('b');
    });
});
