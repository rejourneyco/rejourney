/**
 * Gameplay intervals from SDK gameplay markers.
 *
 * Games mark where play starts and stops (Unity `Rejourney.StartGameplay` and
 * `Rejourney.EndGameplay`). Input during play is game input, not interface use,
 * so frustration inference, heatmaps and research exports leave it out.
 *
 * Wire contract, one event per boundary:
 *   { type: 'gameplay', phase: 'start', gameplayId, name?, continued, startedAt, properties?, timestamp }
 *   { type: 'gameplay', phase: 'end', gameplayId, name?, outcome, durationMs, properties?, timestamp }
 *
 * Every recording session that records during a segment carries its own start
 * marker (`continued: true` when the segment began before the session), and
 * touches recorded during play carry the segment's `gameplayId`. An interval
 * without an end marker lasts until the session ends.
 */

export const GAMEPLAY_EVENT_TYPE = 'gameplay';
export const GAMEPLAY_OUTCOMES = ['completed', 'failed', 'quit', 'abandoned', 'ended', 'superseded', 'session_end'] as const;
export type GameplayOutcome = typeof GAMEPLAY_OUTCOMES[number] | 'other';

export type GameplayMarker = {
    phase: 'start' | 'end';
    gameplayId: string | null;
    name: string | null;
    outcome: string | null;
    continued: boolean;
    /** Time on the caller's axis: epoch or session-elapsed milliseconds. */
    at: number;
};

export type GameplayInterval = {
    index: number;
    gameplayId: string | null;
    name: string | null;
    start: number;
    end: number;
    /** The end marker's outcome; null when the end was inferred. */
    outcome: string | null;
    continued: boolean;
    /** The start marker was missing; the interval reaches back to the previous one or the session start. */
    startInferred: boolean;
    /** The end marker was missing; the interval runs to the next start or the session end. */
    endInferred: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
}

export function isGameplayMarkerEvent(event: unknown): boolean {
    const type = record(event)?.type;
    return typeof type === 'string' && type.trim().toLowerCase() === GAMEPLAY_EVENT_TYPE;
}

/** Input recorded during play carries the segment's id. */
export function isGameplayTelemetryEvent(event: unknown): boolean {
    const data = record(event);
    if (!data) return false;
    const id = data.gameplayId ?? record(data.properties)?.gameplayId ?? record(data.payload)?.gameplayId;
    return typeof id === 'string' && id.length > 0;
}

export function gameplayIdOfTelemetryEvent(event: unknown): string | null {
    const data = record(event);
    if (!data) return null;
    return text(data.gameplayId ?? record(data.properties)?.gameplayId ?? record(data.payload)?.gameplayId, 64);
}

export function parseGameplayMarker(event: unknown, at: number | null): GameplayMarker | null {
    if (at === null || !Number.isFinite(at) || !isGameplayMarkerEvent(event)) return null;
    const data = event as Record<string, unknown>;
    const phase = typeof data.phase === 'string' ? data.phase.trim().toLowerCase() : '';
    if (phase !== 'start' && phase !== 'end') return null;
    return {
        phase,
        gameplayId: text(data.gameplayId, 64),
        name: text(data.name, 128),
        outcome: phase === 'end' ? text(data.outcome, 64) : null,
        continued: data.continued === true,
        at,
    };
}

/** Markers from raw events in time order; ties keep the events' order. */
export function gameplayMarkersFromEvents(
    events: readonly unknown[],
    timestampOf: (event: Record<string, unknown>) => number | null,
): GameplayMarker[] {
    const markers: { marker: GameplayMarker; order: number }[] = [];
    events.forEach((event, order) => {
        const data = record(event);
        if (!data || !isGameplayMarkerEvent(data)) return;
        const marker = parseGameplayMarker(data, timestampOf(data));
        if (marker) markers.push({ marker, order });
    });
    return markers
        .sort((a, b) => (a.marker.at - b.marker.at) || (a.order - b.order))
        .map((entry) => entry.marker);
}

export function normalizeGameplayOutcome(outcome: string | null | undefined): GameplayOutcome | null {
    if (!outcome) return null;
    const value = outcome.trim().toLowerCase();
    return (GAMEPLAY_OUTCOMES as readonly string[]).includes(value) ? value as GameplayOutcome : 'other';
}

/**
 * Pair markers (in time order) into non-overlapping intervals.
 *
 * A start while a segment is open closes it there. An end with no open start
 * (its start marker was lost) reaches back to the previous interval or the
 * bounds' start, so input is never counted as interface use because a marker
 * went missing. A segment still open at the end runs to the bounds' end.
 */
export function deriveGameplayIntervals(
    markers: readonly GameplayMarker[],
    bounds: { start: number; end: number | null },
): GameplayInterval[] {
    type Open = Pick<GameplayInterval, 'gameplayId' | 'name' | 'start' | 'continued' | 'startInferred'>;
    const intervals: GameplayInterval[] = [];
    let open: Open | null = null;
    let floor = bounds.start;
    let lastClosedId: string | null = null;
    let lastAt = bounds.start;
    const close = (segment: Open, end: number, outcome: string | null, endInferred: boolean) => {
        const interval: GameplayInterval = {
            ...segment, index: intervals.length, end: Math.max(segment.start, end), outcome, endInferred,
        };
        intervals.push(interval);
        floor = interval.end;
        lastClosedId = interval.gameplayId;
        open = null;
    };
    for (const marker of markers) {
        const at = Math.max(marker.at, floor);
        lastAt = Math.max(lastAt, at);
        // `open` is reassigned inside close(); read it without flow narrowing.
        const current = open as Open | null;
        if (marker.phase === 'start') {
            // A repeated start for the open segment (a re-sent marker) keeps the earliest one.
            if (current && marker.gameplayId && marker.gameplayId === current.gameplayId) continue;
            if (current) close(current, at, null, true);
            open = { gameplayId: marker.gameplayId, name: marker.name, start: at, continued: marker.continued, startInferred: false };
        } else if (current) {
            // An end for another segment does not close this one.
            if (marker.gameplayId && current.gameplayId && marker.gameplayId !== current.gameplayId) continue;
            close(current, at, marker.outcome, false);
        } else {
            if (marker.gameplayId && marker.gameplayId === lastClosedId) continue;
            close({ gameplayId: marker.gameplayId, name: marker.name, start: floor, continued: true, startInferred: true }, at, marker.outcome, false);
        }
    }
    const remaining = open as Open | null;
    if (remaining) close(remaining, bounds.end ?? lastAt, null, true);
    return intervals;
}

/** The interval containing `at` (bounds inclusive), or null. `intervals` must come from deriveGameplayIntervals. */
export function gameplayIntervalAt(intervals: readonly GameplayInterval[], at: number | null | undefined): GameplayInterval | null {
    if (at === null || at === undefined || !Number.isFinite(at) || intervals.length === 0) return null;
    let low = 0;
    let high = intervals.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const interval = intervals[middle];
        if (at < interval.start) high = middle - 1;
        else if (at > interval.end) low = middle + 1;
        else return interval;
    }
    return null;
}

/** Whether any interval overlaps [start, end), for rows that only carry a time bucket. */
export function gameplayIntervalOverlapping(intervals: readonly GameplayInterval[], start: number, end: number): GameplayInterval | null {
    for (const interval of intervals) {
        if (interval.start >= end) break;
        if (interval.end >= start) return interval;
    }
    return null;
}
