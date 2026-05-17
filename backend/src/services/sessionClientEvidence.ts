export type SessionClientEvidence = {
    maxClientEventAt: Date | null;
    maxClientForegroundAt: Date | null;
    maxClientBackgroundAt: Date | null;
    artifactBackgroundSeconds: number;
};

const BACKGROUND_TOTAL_MS_FIELDS = [
    'totalBackgroundTimeMs',
    'totalBackgroundTime',
    'backgroundTimeMs',
] as const;
const BACKGROUND_DURATION_MS_FIELDS = [
    'backgroundDurationMs',
    'backgroundDuration',
] as const;

function maxDate(current: Date | null, candidate: Date | null): Date | null {
    if (!candidate) return current;
    if (!current || candidate.getTime() > current.getTime()) {
        return candidate;
    }
    return current;
}

export function coerceTimestampToDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value : null;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return null;
        const ms = value >= 10_000_000_000 ? value : value * 1000;
        const parsed = new Date(ms);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
            return coerceTimestampToDate(numeric);
        }
        const parsed = new Date(trimmed);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readMsFromEvent(event: Record<string, unknown>, fields: readonly string[]): number | null {
    const payload = asRecord(event.payload);
    for (const field of fields) {
        const raw = event[field] ?? payload?.[field];
        const numeric = Number(raw);
        if (Number.isFinite(numeric) && numeric >= 0) {
            return numeric;
        }
    }
    return null;
}

function msToSeconds(value: number | null): number | null {
    if (value === null) return null;
    return Math.max(0, Math.round(value / 1000));
}

export function extractCumulativeBackgroundSeconds(event: Record<string, unknown>): number | null {
    return msToSeconds(readMsFromEvent(event, BACKGROUND_TOTAL_MS_FIELDS));
}

export function extractBackgroundDurationSeconds(event: Record<string, unknown>): number | null {
    return msToSeconds(readMsFromEvent(event, BACKGROUND_DURATION_MS_FIELDS));
}

export function collectSessionClientEvidence(eventsData: unknown[]): SessionClientEvidence {
    let maxClientEventAt: Date | null = null;
    let maxClientForegroundAt: Date | null = null;
    let maxClientBackgroundAt: Date | null = null;
    let maxCumulativeBackgroundSeconds = 0;
    let summedDurationBackgroundSeconds = 0;

    for (const rawEvent of eventsData) {
        if (!rawEvent || typeof rawEvent !== 'object') continue;
        const event = rawEvent as Record<string, unknown>;
        const timestamp = coerceTimestampToDate(event.timestamp);
        maxClientEventAt = maxDate(maxClientEventAt, timestamp);

        const type = String(event.type || '').toLowerCase();
        if (type === 'app_foreground') {
            maxClientForegroundAt = maxDate(maxClientForegroundAt, timestamp);
            const cumulativeSeconds = extractCumulativeBackgroundSeconds(event);
            if (cumulativeSeconds !== null) {
                maxCumulativeBackgroundSeconds = Math.max(maxCumulativeBackgroundSeconds, cumulativeSeconds);
            } else {
                const durationSeconds = extractBackgroundDurationSeconds(event);
                if (durationSeconds !== null) {
                    summedDurationBackgroundSeconds += durationSeconds;
                }
            }
        } else if (type === 'app_background') {
            maxClientBackgroundAt = maxDate(maxClientBackgroundAt, timestamp);
        }
    }

    return {
        maxClientEventAt,
        maxClientForegroundAt,
        maxClientBackgroundAt,
        artifactBackgroundSeconds: Math.max(maxCumulativeBackgroundSeconds, summedDurationBackgroundSeconds),
    };
}
