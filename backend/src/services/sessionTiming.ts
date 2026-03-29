export function computeSessionDurationSeconds(
    startedAt: Date,
    endedAt: Date,
    backgroundTimeSeconds: number | null | undefined
): number {
    const wallClockSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const backgroundSeconds = Math.max(0, Number(backgroundTimeSeconds ?? 0));
    return Math.max(1, wallClockSeconds - backgroundSeconds);
}

export function clampSessionEndedAt(startedAt: Date, candidate: Date, maxRecordingMinutes: number): Date {
    const capMs = Math.max(120_000, maxRecordingMinutes * 60 * 1000 + 120_000);
    const upper = new Date(startedAt.getTime() + capMs);
    const t = candidate.getTime();
    if (!Number.isFinite(t) || t < startedAt.getTime()) return startedAt;
    if (t > upper.getTime()) return upper;
    return candidate;
}

export function resolveReportedSessionEndedAt(
    endedAtInput: unknown,
    fallbackEndedAt?: Date | null
): Date {
    if (endedAtInput) {
        const endedAt = new Date(endedAtInput as string | number | Date);
        if (Number.isFinite(endedAt.getTime())) {
            return endedAt;
        }
    }

    if (fallbackEndedAt && Number.isFinite(fallbackEndedAt.getTime())) {
        return fallbackEndedAt;
    }

    return new Date();
}

export function preserveExistingSessionEndedAt(
    reportedEndedAt: Date,
    persistedEndedAt?: Date | null,
    allowedExtensionMs = 60_000
): Date {
    if (!persistedEndedAt || !Number.isFinite(persistedEndedAt.getTime())) {
        return reportedEndedAt;
    }

    if (!Number.isFinite(reportedEndedAt.getTime())) {
        return persistedEndedAt;
    }

    if (reportedEndedAt.getTime() > persistedEndedAt.getTime() + allowedExtensionMs) {
        return persistedEndedAt;
    }

    return reportedEndedAt;
}

type SelectSessionEndedAtParams = {
    startedAt: Date;
    explicitEndedAt?: Date | null;
    latestReplayEndMs?: number | null;
    persistedEndedAt?: Date | null;
    lastIngestActivityAt?: Date | null;
    maxRecordingMinutes: number;
    now?: Date;
};

export function selectSessionEndedAt(params: SelectSessionEndedAtParams): Date {
    const latestReplayEndedAt = Number.isFinite(params.latestReplayEndMs)
        && Number(params.latestReplayEndMs) > 0
        ? new Date(Number(params.latestReplayEndMs))
        : null;
    const boundedExplicitEndedAt = params.explicitEndedAt
        ? preserveExistingSessionEndedAt(params.explicitEndedAt, params.persistedEndedAt)
        : null;

    const rawCandidate = boundedExplicitEndedAt
        ?? latestReplayEndedAt
        ?? params.persistedEndedAt
        ?? params.lastIngestActivityAt
        ?? params.now
        ?? new Date();

    return clampSessionEndedAt(params.startedAt, rawCandidate, params.maxRecordingMinutes);
}
