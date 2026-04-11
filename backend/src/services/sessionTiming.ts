import { coerceTimestampToDate } from './sessionClientEvidence.js';

export function computeSessionDurationSeconds(
    startedAt: Date,
    endedAt: Date,
    backgroundTimeSeconds: number | null | undefined
): number {
    const wallClockSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const backgroundSeconds = Math.max(0, Number(backgroundTimeSeconds ?? 0));
    return Math.max(1, wallClockSeconds - backgroundSeconds);
}

export function hasStoredClosedTiming(params: {
    endedAt?: Date | null;
    durationSeconds?: number | null;
}): boolean {
    return Boolean(
        params.endedAt instanceof Date
        && Number.isFinite(params.endedAt.getTime())
        && typeof params.durationSeconds === 'number'
        && params.durationSeconds > 0
    );
}

export function resolveStoredOrDerivedSessionDurationSeconds(params: {
    durationSeconds: number | null;
    startedAt: Date;
    endedAt: Date | null;
    lastIngestActivityAt: Date | null;
    backgroundTimeSeconds: number | null;
    /**
     * Max segment end_ms from replay artifacts (screenshots/hierarchy).
     */
    latestReplayEndMs?: number | null;
}): number {
    const direct = params.durationSeconds;
    if (direct != null && direct > 0) return direct;

    const replayEndMs = Number(params.latestReplayEndMs);
    const replayEnd = Number.isFinite(replayEndMs) && replayEndMs > 0 ? new Date(replayEndMs) : null;

    const end = params.endedAt ?? replayEnd ?? null;

    if (end) {
        return computeSessionDurationSeconds(params.startedAt, end, params.backgroundTimeSeconds);
    }

    return Math.max(0, direct ?? 0);
}

/**
 * Playable length for dashboard/API when `ended_at` was closed with a structural cap
 * but replay artifacts end much earlier (short real recording).
 */
export function durationSecondsForDisplay(params: {
    durationSeconds: number | null;
    startedAt: Date;
    endedAt: Date | null;
    lastIngestActivityAt: Date | null;
    backgroundTimeSeconds: number | null;
    latestReplayEndMs?: number | null;
    replayAvailable?: boolean | null;
}): number {
    const wall = resolveStoredOrDerivedSessionDurationSeconds(params);
    const replayMs = Number(params.latestReplayEndMs);
    if (!params.replayAvailable || !params.endedAt || !Number.isFinite(replayMs) || replayMs <= 0) {
        return wall;
    }
    const replayEnd = new Date(replayMs);
    if (params.endedAt.getTime() - replayEnd.getTime() < 2 * 60 * 1000) {
        return wall;
    }
    const fromReplay = computeSessionDurationSeconds(params.startedAt, replayEnd, params.backgroundTimeSeconds);
    if (fromReplay > 0 && wall > fromReplay + 120) {
        return fromReplay;
    }
    return wall;
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

export function clampSessionEndedAt(startedAt: Date, candidate: Date, maxRecordingMinutes: number): Date {
    const capMs = Math.max(120_000, maxRecordingMinutes * 60 * 1000 + 120_000);
    const upper = new Date(startedAt.getTime() + capMs);
    const t = candidate.getTime();
    if (!Number.isFinite(t) || t < startedAt.getTime()) return startedAt;
    if (t > upper.getTime()) return upper;
    return candidate;
}

/** Latest instant allowed by project recording policy (deterministic; not wall clock). */
export function recordingPolicyUpperBoundEndedAt(startedAt: Date, maxRecordingMinutes: number): Date {
    const farFuture = new Date(startedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    return clampSessionEndedAt(startedAt, farFuture, maxRecordingMinutes);
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

export type AuthoritativeSessionCloseParams = {
    startedAt: Date;
    lastIngestActivityAt?: Date | null;
    latestReplayEndMs?: number | null;
    /** `/session/end` body — optional hint */
    reportedEndedAt?: unknown;
    closeAnchorAtMs?: unknown;
    totalBackgroundTimeMs?: unknown;
    storedBackgroundTimeSeconds?: number | null;
    maxRecordingMinutes: number;
    /** Next session on same device+project; caps ended_at so timelines do not overlap. */
    successorStartedAt?: Date | null;
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
        | 'reported'
        | 'replay_end'
        | 'ingest_activity'
        | 'recording_cap';
    successorCapApplied: boolean;
    usedReportedEndedAt: boolean;
};

/**
 * Server-first end time: optional `/session/end` hints, then replay end, then last ingest,
 * then recording policy upper bound (never wall clock — avoids "ends when worker ran").
 * Finally min() with successor session start when the same device has a later session.
 */
export function resolveAuthoritativeSessionClose(params: AuthoritativeSessionCloseParams): AuthoritativeSessionClose {
    const reportedEndedAt = coerceTimestampToDate(params.reportedEndedAt);
    const closeAnchorAt = coerceTimestampToDate(params.closeAnchorAtMs);
    const latestReplayEndedAt = Number.isFinite(params.latestReplayEndMs)
        && Number(params.latestReplayEndMs) > 0
        ? new Date(Number(params.latestReplayEndMs))
        : null;
    const lastIngestActivityAt = params.lastIngestActivityAt ?? null;
    const policyUpper = recordingPolicyUpperBoundEndedAt(params.startedAt, params.maxRecordingMinutes);

    let endedAt: Date;
    let source: AuthoritativeSessionClose['source'];
    let usedReportedEndedAt = false;

    if (closeAnchorAt) {
        endedAt = closeAnchorAt;
        source = 'close_anchor';
    } else if (reportedEndedAt) {
        endedAt = reportedEndedAt;
        source = 'reported';
        usedReportedEndedAt = true;
    } else if (latestReplayEndedAt) {
        endedAt = latestReplayEndedAt;
        source = 'replay_end';
    } else if (lastIngestActivityAt) {
        endedAt = lastIngestActivityAt;
        source = 'ingest_activity';
    } else {
        endedAt = policyUpper;
        source = 'recording_cap';
    }

    let boundedEndedAt = clampSessionEndedAt(params.startedAt, endedAt, params.maxRecordingMinutes);

    const successor = params.successorStartedAt ?? null;
    let successorCapApplied = false;
    if (
        successor
        && Number.isFinite(successor.getTime())
        && successor.getTime() > params.startedAt.getTime()
    ) {
        const before = boundedEndedAt.getTime();
        boundedEndedAt = new Date(Math.min(boundedEndedAt.getTime(), successor.getTime()));
        if (boundedEndedAt.getTime() !== before) {
            successorCapApplied = true;
        }
    }

    const storedBackgroundSeconds = normalizeBackgroundTimeSeconds(params.storedBackgroundTimeSeconds);
    const reportedBackgroundSeconds = normalizeReportedBackgroundTimeSeconds(params.totalBackgroundTimeMs);
    const anchoredBeforeReportedSeconds =
        source === 'close_anchor'
        && reportedEndedAt
        && boundedEndedAt.getTime() < reportedEndedAt.getTime()
            ? Math.max(0, Math.round((reportedEndedAt.getTime() - boundedEndedAt.getTime()) / 1000))
            : 0;
    const adjustedReportedBackgroundSeconds = reportedBackgroundSeconds == null
        ? null
        : Math.max(0, reportedBackgroundSeconds - anchoredBeforeReportedSeconds);
    const backgroundTimeSeconds = adjustedReportedBackgroundSeconds == null
        ? storedBackgroundSeconds
        : Math.max(storedBackgroundSeconds, adjustedReportedBackgroundSeconds);

    const wallClockSeconds = Math.round((boundedEndedAt.getTime() - params.startedAt.getTime()) / 1000);
    const durationSeconds = computeSessionDurationSeconds(params.startedAt, boundedEndedAt, backgroundTimeSeconds);

    return {
        endedAt: boundedEndedAt,
        evidenceEndedAt: latestReplayEndedAt,
        reportedEndedAt,
        backgroundTimeSeconds,
        durationSeconds,
        wallClockSeconds,
        source,
        successorCapApplied,
        usedReportedEndedAt,
    };
}

type SelectSessionEndedAtParams = {
    startedAt: Date;
    latestReplayEndMs?: number | null;
    persistedEndedAt?: Date | null;
    lastIngestActivityAt?: Date | null;
    maxRecordingMinutes: number;
};

export function selectSessionEndedAt(params: SelectSessionEndedAtParams): Date {
    const latestReplayEndedAt = Number.isFinite(params.latestReplayEndMs)
        && Number(params.latestReplayEndMs) > 0
        ? new Date(Number(params.latestReplayEndMs))
        : null;

    const policyUpper = recordingPolicyUpperBoundEndedAt(params.startedAt, params.maxRecordingMinutes);
    const rawCandidate =
        latestReplayEndedAt
        ?? params.persistedEndedAt
        ?? params.lastIngestActivityAt
        ?? policyUpper;

    return clampSessionEndedAt(params.startedAt, rawCandidate, params.maxRecordingMinutes);
}
