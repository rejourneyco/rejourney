import { coerceTimestampToDate } from './sessionClientEvidence.js';

export const MAX_REPORTED_END_DRIFT_MS = 15_000;

export function computeSessionDurationSeconds(
    startedAt: Date,
    endedAt: Date,
    backgroundTimeSeconds: number | null | undefined
): number {
    const wallClockSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const backgroundSeconds = Math.max(0, Number(backgroundTimeSeconds ?? 0));
    return Math.max(1, wallClockSeconds - backgroundSeconds);
}

export function resolveStoredOrDerivedSessionDurationSeconds(params: {
    durationSeconds: number | null;
    startedAt: Date;
    endedAt: Date | null;
    explicitEndedAt: Date | null;
    finalizedAt: Date | null;
    lastIngestActivityAt: Date | null;
    backgroundTimeSeconds: number | null;
    /**
     * Max segment end_ms from ready replay artifacts (screenshots/hierarchy).
     * Prefer this over `lastIngestActivityAt` for open sessions: ingest bookkeeping
     * can run long after the last frame while the client never calls /session/end.
     */
    latestReplayEndMs?: number | null;
}): number {
    const direct = params.durationSeconds;
    if (direct != null && direct > 0) return direct;

    const replayEndMs = Number(params.latestReplayEndMs);
    const replayEnd = Number.isFinite(replayEndMs) && replayEndMs > 0 ? new Date(replayEndMs) : null;

    const end =
        params.endedAt
        ?? params.explicitEndedAt
        ?? replayEnd
        ?? params.finalizedAt
        ?? null;

    if (end) {
        return computeSessionDurationSeconds(params.startedAt, end, params.backgroundTimeSeconds);
    }

    return Math.max(0, direct ?? 0);
}

function latestDate(...values: Array<Date | null | undefined>): Date | null {
    let latest: Date | null = null;
    for (const value of values) {
        if (!value || !Number.isFinite(value.getTime())) continue;
        if (!latest || value.getTime() > latest.getTime()) {
            latest = value;
        }
    }
    return latest;
}

function normalizeBackgroundTimeSeconds(value: number | null | undefined): number {
    return Math.max(0, Math.round(Number(value ?? 0) || 0));
}

function normalizeReportedBackgroundTimeSeconds(value: unknown): number | null {
    if (value === undefined) return null;
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.max(0, Math.round(ms / 1000));
}

function clampToUpperBound(startedAt: Date, candidate: Date, upperBound: Date | null): Date {
    if (!upperBound) return candidate;
    if (upperBound.getTime() < startedAt.getTime()) return startedAt;
    if (candidate.getTime() > upperBound.getTime()) return upperBound;
    return candidate;
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
    const endedAt = coerceTimestampToDate(endedAtInput);
    if (endedAt) {
        return endedAt;
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

export type AuthoritativeSessionCloseParams = {
    startedAt: Date;
    persistedEndedAt?: Date | null;
    explicitEndedAtCap?: Date | null;
    lastIngestActivityAt?: Date | null;
    lastClientEventAt?: Date | null;
    lastClientForegroundAt?: Date | null;
    lastClientBackgroundAt?: Date | null;
    latestReplayEndMs?: number | null;
    reportedEndedAt?: unknown;
    totalBackgroundTimeMs?: unknown;
    endReason?: string | null;
    closeAnchorAtMs?: unknown;
    storedBackgroundTimeSeconds?: number | null;
    maxRecordingMinutes: number;
    successorStartedAt?: Date | null;
    now?: Date;
};

export type AuthoritativeSessionClose = {
    endedAt: Date;
    evidenceEndedAt: Date | null;
    reportedEndedAt: Date | null;
    backgroundTimeSeconds: number;
    durationSeconds: number;
    wallClockSeconds: number;
    source:
        | 'close_anchor'
        | 'recovery_background'
        | 'recovery_replay'
        | 'recovery_event'
        | 'recovery_persisted'
        | 'recovery_ingest'
        | 'backend_evidence'
        | 'reported'
        | 'persisted'
        | 'ingest_activity'
        | 'fallback_now';
    successorCapApplied: boolean;
    usedReportedEndedAt: boolean;
};

export function resolveAuthoritativeSessionClose(params: AuthoritativeSessionCloseParams): AuthoritativeSessionClose {
    const reportedEndedAt = coerceTimestampToDate(params.reportedEndedAt);
    const closeAnchorAt = coerceTimestampToDate(params.closeAnchorAtMs);
    const latestReplayEndedAt = Number.isFinite(params.latestReplayEndMs)
        && Number(params.latestReplayEndMs) > 0
        ? new Date(Number(params.latestReplayEndMs))
        : null;
    const persistedEndedAt = params.persistedEndedAt ?? null;
    const lastIngestActivityAt = params.lastIngestActivityAt ?? null;
    const lastClientEventAt = params.lastClientEventAt ?? null;
    const lastClientForegroundAt = params.lastClientForegroundAt ?? null;
    const lastClientBackgroundAt = params.lastClientBackgroundAt ?? null;
    const backgroundBoundary = lastClientBackgroundAt
        && (!lastClientForegroundAt || lastClientBackgroundAt.getTime() >= lastClientForegroundAt.getTime())
        ? lastClientBackgroundAt
        : null;

    const strongestBackendEvidence = latestDate(
        backgroundBoundary,
        latestReplayEndedAt,
        lastClientEventAt,
    );

    let endedAt: Date | null = null;
    let evidenceEndedAt: Date | null = null;
    let source: AuthoritativeSessionClose['source'] = 'fallback_now';
    let usedReportedEndedAt = false;

    if (closeAnchorAt) {
        endedAt = closeAnchorAt;
        evidenceEndedAt = closeAnchorAt;
        source = 'close_anchor';
    } else if (params.endReason === 'background_timeout' && backgroundBoundary) {
        endedAt = backgroundBoundary;
        evidenceEndedAt = backgroundBoundary;
        source = 'backend_evidence';
    } else if (params.endReason === 'recovery_finalize') {
        endedAt = backgroundBoundary
            ?? latestReplayEndedAt
            ?? lastClientEventAt
            ?? persistedEndedAt
            ?? lastIngestActivityAt
            ?? params.now
            ?? new Date();
        evidenceEndedAt = backgroundBoundary ?? latestReplayEndedAt ?? lastClientEventAt ?? persistedEndedAt ?? lastIngestActivityAt;
        source = backgroundBoundary
            ? 'recovery_background'
            : latestReplayEndedAt
                ? 'recovery_replay'
                : lastClientEventAt
                    ? 'recovery_event'
                    : persistedEndedAt
                        ? 'recovery_persisted'
                        : lastIngestActivityAt
                            ? 'recovery_ingest'
                            : 'fallback_now';
    } else if (strongestBackendEvidence) {
        evidenceEndedAt = strongestBackendEvidence;
        source = 'backend_evidence';
        if (reportedEndedAt) {
            const clampedMs = Math.min(
                Math.max(reportedEndedAt.getTime(), strongestBackendEvidence.getTime()),
                strongestBackendEvidence.getTime() + MAX_REPORTED_END_DRIFT_MS,
            );
            endedAt = new Date(clampedMs);
            usedReportedEndedAt = true;
        } else {
            endedAt = strongestBackendEvidence;
        }
    } else if (reportedEndedAt) {
        endedAt = reportedEndedAt;
        source = 'reported';
        usedReportedEndedAt = true;
    } else if (persistedEndedAt) {
        endedAt = persistedEndedAt;
        source = 'persisted';
    } else if (lastIngestActivityAt) {
        endedAt = lastIngestActivityAt;
        source = 'ingest_activity';
    } else {
        endedAt = params.now ?? new Date();
        source = 'fallback_now';
    }

    let boundedEndedAt = clampSessionEndedAt(params.startedAt, endedAt, params.maxRecordingMinutes);
    const explicitEndedAtCap = params.explicitEndedAtCap ?? null;
    boundedEndedAt = clampToUpperBound(params.startedAt, boundedEndedAt, explicitEndedAtCap);
    const successorStartedAt = params.successorStartedAt ?? null;
    const cappedBySuccessor = successorStartedAt && boundedEndedAt.getTime() > successorStartedAt.getTime();
    boundedEndedAt = clampToUpperBound(params.startedAt, boundedEndedAt, successorStartedAt);

    const storedBackgroundSeconds = normalizeBackgroundTimeSeconds(params.storedBackgroundTimeSeconds);
    const reportedBackgroundSeconds = normalizeReportedBackgroundTimeSeconds(params.totalBackgroundTimeMs);
    const anchoredBeforeReportedSeconds = reportedEndedAt && boundedEndedAt.getTime() < reportedEndedAt.getTime()
        ? Math.max(0, Math.round((reportedEndedAt.getTime() - boundedEndedAt.getTime()) / 1000))
        : 0;
    const adjustedReportedBackgroundSeconds = reportedBackgroundSeconds == null
        ? null
        : Math.max(0, reportedBackgroundSeconds - anchoredBeforeReportedSeconds);
    const backgroundTimeSeconds = adjustedReportedBackgroundSeconds == null
        ? storedBackgroundSeconds
        : Math.max(storedBackgroundSeconds, adjustedReportedBackgroundSeconds ?? 0);
    const wallClockSeconds = Math.round((boundedEndedAt.getTime() - params.startedAt.getTime()) / 1000);
    const durationSeconds = computeSessionDurationSeconds(params.startedAt, boundedEndedAt, backgroundTimeSeconds);

    return {
        endedAt: boundedEndedAt,
        evidenceEndedAt,
        reportedEndedAt,
        backgroundTimeSeconds,
        durationSeconds,
        wallClockSeconds,
        source,
        successorCapApplied: Boolean(cappedBySuccessor),
        usedReportedEndedAt,
    };
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
