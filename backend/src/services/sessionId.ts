function parseSessionTimestamp(sessionId: string): number | null {
    const match = /^session_(\d+)(?:_|$)/.exec(sessionId);
    if (!match?.[1]) {
        return null;
    }

    const timestampMs = Number.parseInt(match[1], 10);
    return Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : null;
}

export function parseSessionStartedAtOrNull(sessionId: string): Date | null {
    const timestampMs = parseSessionTimestamp(sessionId);
    return timestampMs != null ? new Date(timestampMs) : null;
}

export function parseSessionStartedAt(sessionId: string, fallback: Date = new Date()): Date {
    return parseSessionStartedAtOrNull(sessionId) ?? fallback;
}
