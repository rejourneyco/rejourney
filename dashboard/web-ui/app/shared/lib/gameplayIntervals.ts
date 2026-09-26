/**
 * Gameplay intervals for the replay, from SDK gameplay markers.
 *
 * Games mark where play starts and stops (Unity `Rejourney.StartGameplay` and
 * `Rejourney.EndGameplay`): `{ type: 'gameplay', phase: 'start' | 'end', gameplayId, name?, outcome?, timestamp }`.
 * Input recorded during play carries the segment's `gameplayId`. The rules match
 * the backend (`backend/src/utils/gameplayIntervals.ts`): a start while a segment
 * is open closes it, an end without a start reaches back to the previous interval
 * or the session start, and a segment still open runs to the session end.
 */

type GameplayEventLike = {
    type?: unknown;
    phase?: unknown;
    gameplayId?: unknown;
    name?: unknown;
    outcome?: unknown;
    continued?: unknown;
    durationMs?: unknown;
    timestamp?: unknown;
    properties?: Record<string, unknown> | null;
    payload?: Record<string, unknown> | null;
};

export type ReplayGameplayInterval = {
    index: number;
    gameplayId: string | null;
    name: string | null;
    /** The end marker's outcome; null when the end was inferred. */
    outcome: string | null;
    continued: boolean;
    start: number;
    end: number;
    startInferred: boolean;
    endInferred: boolean;
};

const text = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
};

export const isGameplayMarker = (event: GameplayEventLike | null | undefined): boolean =>
    typeof event?.type === 'string' && event.type.trim().toLowerCase() === 'gameplay';

export const gameplayMarkerPhase = (event: GameplayEventLike | null | undefined): 'start' | 'end' | null => {
    if (!isGameplayMarker(event)) return null;
    const phase = typeof event?.phase === 'string' ? event.phase.trim().toLowerCase() : '';
    return phase === 'start' || phase === 'end' ? phase : null;
};

/** Input recorded during play carries the segment id wherever the SDK put it. */
export const isGameplayInput = (event: GameplayEventLike | null | undefined): boolean => {
    if (!event || isGameplayMarker(event)) return false;
    const id = event.gameplayId ?? event.properties?.gameplayId ?? event.payload?.gameplayId;
    return typeof id === 'string' && id.length > 0;
};

export function buildGameplayIntervals(
    events: readonly GameplayEventLike[],
    bounds: { start: number; end: number | null },
): ReplayGameplayInterval[] {
    const markers = events
        .map((event, order) => ({ event, order, phase: gameplayMarkerPhase(event), at: Number(event.timestamp) }))
        .filter((entry): entry is typeof entry & { phase: 'start' | 'end' } => entry.phase !== null && Number.isFinite(entry.at))
        .sort((a, b) => (a.at - b.at) || (a.order - b.order));

    type Open = Pick<ReplayGameplayInterval, 'gameplayId' | 'name' | 'start' | 'continued' | 'startInferred'>;
    const intervals: ReplayGameplayInterval[] = [];
    let open: Open | null = null;
    let floor = bounds.start;
    let lastClosedId: string | null = null;
    let lastAt = bounds.start;
    const close = (segment: Open, end: number, outcome: string | null, endInferred: boolean) => {
        const interval = { ...segment, index: intervals.length, end: Math.max(segment.start, end), outcome, endInferred };
        intervals.push(interval);
        floor = interval.end;
        lastClosedId = interval.gameplayId;
        open = null;
    };
    for (const { event, phase, at: rawAt } of markers) {
        const at = Math.max(rawAt, floor);
        lastAt = Math.max(lastAt, at);
        const gameplayId = text(event.gameplayId, 64);
        const name = text(event.name, 128);
        // `open` is reassigned inside close(); read it without flow narrowing.
        const current = open as Open | null;
        if (phase === 'start') {
            if (current && gameplayId && gameplayId === current.gameplayId) continue;
            if (current) close(current, at, null, true);
            open = { gameplayId, name, start: at, continued: event.continued === true, startInferred: false };
        } else if (current) {
            if (gameplayId && current.gameplayId && gameplayId !== current.gameplayId) continue;
            close(current, at, text(event.outcome, 64), false);
        } else {
            if (gameplayId && gameplayId === lastClosedId) continue;
            close({ gameplayId, name, start: floor, continued: true, startInferred: true }, at, text(event.outcome, 64), false);
        }
    }
    const remaining = open as Open | null;
    if (remaining) close(remaining, bounds.end ?? lastAt, null, true);
    return intervals;
}

export const gameplayIntervalAt = (intervals: readonly ReplayGameplayInterval[], timestamp: number): ReplayGameplayInterval | null =>
    intervals.find((interval) => interval.start <= timestamp && timestamp <= interval.end) ?? null;

const OUTCOME_LABELS: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    quit: 'Quit',
    abandoned: 'Abandoned',
    ended: 'Ended',
    superseded: 'Replaced by the next segment',
    session_end: 'Recording stopped',
};

export const gameplayOutcomeLabel = (outcome: string | null): string =>
    outcome ? OUTCOME_LABELS[outcome.toLowerCase()] ?? outcome.replace(/_/g, ' ') : 'Still playing at session end';

export const describeGameplayMarker = (event: GameplayEventLike): string => {
    const phase = gameplayMarkerPhase(event);
    const name = text(event.name, 128);
    if (phase === 'start') {
        return [name ?? 'Gameplay', event.continued === true ? 'continued from an earlier session' : null].filter(Boolean).join(' · ');
    }
    const duration = Number(event.durationMs);
    return [
        name ?? 'Gameplay',
        gameplayOutcomeLabel(text(event.outcome, 64)),
        Number.isFinite(duration) && duration >= 0 ? formatGameplayDuration(duration) : null,
    ].filter(Boolean).join(' · ');
};

export const formatGameplayDuration = (milliseconds: number): string => {
    const seconds = Math.max(0, milliseconds) / 1000;
    if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
};
