export type SessionClientEvidence = {
    maxClientEventAt: Date | null;
    maxClientForegroundAt: Date | null;
    maxClientBackgroundAt: Date | null;
    artifactBackgroundSeconds: number;
};

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

export function collectSessionClientEvidence(eventsData: unknown[]): SessionClientEvidence {
    let maxClientEventAt: Date | null = null;
    let maxClientForegroundAt: Date | null = null;
    let maxClientBackgroundAt: Date | null = null;
    let artifactBackgroundSeconds = 0;

    for (const rawEvent of eventsData) {
        if (!rawEvent || typeof rawEvent !== 'object') continue;
        const event = rawEvent as Record<string, unknown>;
        const timestamp = coerceTimestampToDate(event.timestamp);
        maxClientEventAt = maxDate(maxClientEventAt, timestamp);

        const type = String(event.type || '').toLowerCase();
        if (type === 'app_foreground') {
            maxClientForegroundAt = maxDate(maxClientForegroundAt, timestamp);
            const backgroundMs = Number(event.totalBackgroundTime);
            if (Number.isFinite(backgroundMs) && backgroundMs > 0) {
                artifactBackgroundSeconds += Math.max(0, Math.round(backgroundMs / 1000));
            }
        } else if (type === 'app_background') {
            maxClientBackgroundAt = maxDate(maxClientBackgroundAt, timestamp);
        }
    }

    return {
        maxClientEventAt,
        maxClientForegroundAt,
        maxClientBackgroundAt,
        artifactBackgroundSeconds,
    };
}
