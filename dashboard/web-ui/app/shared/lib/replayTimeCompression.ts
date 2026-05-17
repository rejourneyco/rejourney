export const COMPRESSED_BACKGROUND_GAP_MS = 2_000;

export type ReplayTimestampedEvent = {
    type?: unknown;
    timestamp?: unknown;
};

export type CompressedBackgroundGap = {
    startedAt: number;
    endedAt: number;
    durationMs: number;
    compressedStartAt: number;
    compressedEndAt: number;
    compressedDurationMs: number;
};

export type BuildCompressedBackgroundGapOptions = {
    terminalEndMs?: number | null;
};

function eventType(event: ReplayTimestampedEvent): string {
    return typeof event.type === 'string' ? event.type.toLowerCase() : '';
}

function finiteTimestamp(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function createCompressedGap(
    startedAt: number,
    endedAt: number,
    removedMs: number,
    compressedGapMs: number,
): CompressedBackgroundGap | null {
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return null;

    const durationMs = endedAt - startedAt;
    const compressedDurationMs = Math.min(compressedGapMs, durationMs);
    const compressedStartAt = startedAt - removedMs;
    return {
        startedAt,
        endedAt,
        durationMs,
        compressedStartAt,
        compressedEndAt: compressedStartAt + compressedDurationMs,
        compressedDurationMs,
    };
}

export function buildCompressedBackgroundGaps(
    events: ReplayTimestampedEvent[],
    sessionStartMs: number,
    compressedGapMs = COMPRESSED_BACKGROUND_GAP_MS,
    options: BuildCompressedBackgroundGapOptions = {},
): CompressedBackgroundGap[] {
    if (!Number.isFinite(sessionStartMs)) return [];

    const orderedEvents = [...events]
        .filter((event) => typeof event.timestamp === 'number' && Number.isFinite(event.timestamp))
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    const gaps: CompressedBackgroundGap[] = [];
    let backgroundStartedAt: number | null = null;
    let removedMs = 0;

    for (const event of orderedEvents) {
        const type = eventType(event);
        const timestamp = Number(event.timestamp);

        if (type === 'app_background' && backgroundStartedAt === null) {
            backgroundStartedAt = timestamp;
            continue;
        }

        if (type !== 'app_foreground' || backgroundStartedAt === null || timestamp <= backgroundStartedAt) {
            continue;
        }

        const durationMs = timestamp - backgroundStartedAt;
        const compressedDurationMs = Math.min(compressedGapMs, durationMs);
        const compressedStartAt = backgroundStartedAt - removedMs;
        const gap = createCompressedGap(backgroundStartedAt, timestamp, removedMs, compressedGapMs);
        if (!gap) continue;

        gaps.push(gap);
        removedMs += gap.durationMs - gap.compressedDurationMs;
        backgroundStartedAt = null;
    }

    const terminalEndMs = finiteTimestamp(options.terminalEndMs);
    if (backgroundStartedAt !== null && terminalEndMs !== null && terminalEndMs > backgroundStartedAt) {
        const gap = createCompressedGap(backgroundStartedAt, terminalEndMs, removedMs, compressedGapMs);
        if (gap) gaps.push(gap);
    }

    return gaps;
}

export function isTimestampInsideCompressedBackgroundGap(timestamp: number, gaps: CompressedBackgroundGap[]): boolean {
    return gaps.some((gap) => timestamp > gap.startedAt && timestamp < gap.endedAt);
}

export function compressReplayTimestamp(timestamp: number, gaps: CompressedBackgroundGap[]): number {
    let removedMs = 0;

    for (const gap of gaps) {
        if (timestamp < gap.startedAt) {
            break;
        }

        if (timestamp <= gap.endedAt) {
            return gap.compressedStartAt + Math.min(timestamp - gap.startedAt, gap.compressedDurationMs);
        }

        removedMs += gap.durationMs - gap.compressedDurationMs;
    }

    return timestamp - removedMs;
}

export function compressReplayEvents<T extends ReplayTimestampedEvent>(events: T[], gaps: CompressedBackgroundGap[]): T[] {
    if (gaps.length === 0) return events;

    const compressedEvents: T[] = [];

    for (const event of events) {
        if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
            compressedEvents.push(event);
            continue;
        }

        const timestamp = event.timestamp;
        if (isTimestampInsideCompressedBackgroundGap(timestamp, gaps)) {
            continue;
        }

        compressedEvents.push({
            ...event,
            timestamp: compressReplayTimestamp(timestamp, gaps),
        });
    }

    return compressedEvents;
}

export function formatBackgroundGapDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
