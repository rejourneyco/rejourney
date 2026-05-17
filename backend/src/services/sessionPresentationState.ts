import { sql } from 'drizzle-orm';
import { db, recordingArtifacts, sessions } from '../db/client.js';

/** Inactivity window before fail-safe session finalization (no ingest touches). */
export const SESSION_LIVE_INGEST_WINDOW_MS = 60_000;

export type SessionWorkAggregate = {
    readyScreenshotCount: number;
    readyScreenshotBytes: number;
    readyWebReplayCount: number;
    readyWebReplayBytes: number;
    readyHierarchyCount: number;
    openArtifactCount: number;
    activeJobCount: number;
    openReplayArtifactCount: number;
    activeReplayJobCount: number;
    latestReplayArtifactEndMs: number | null;
    latestEventArtifactEndMs: number | null;
    latestReadyAt: Date | null;
    readyEventArtifactMissingDerivedCount: number;
    hasPendingProcessingWork: boolean;
    hasPendingWork: boolean;
    hasPendingReplayWork: boolean;
};

type SessionAggregateRow = {
    readyScreenshotCount: number | string | null;
    readyScreenshotBytes: number | string | null;
    readyWebReplayCount: number | string | null;
    readyWebReplayBytes: number | string | null;
    readyHierarchyCount: number | string | null;
    openArtifactCount: number | string | null;
    activeJobCount: number | string | null;
    openReplayArtifactCount: number | string | null;
    activeReplayJobCount: number | string | null;
    latestReplayArtifactEndMs: number | string | null;
    latestEventArtifactEndMs: number | string | null;
    latestReadyAt: Date | string | null;
    readyEventArtifactMissingDerivedCount: number | string | null;
};

export type SessionPresentationState = {
    effectiveStatus: string;
    isLiveIngest: boolean;
    isBackgroundProcessing: boolean;
    canOpenReplay: boolean;
    hasPendingWork: boolean;
    hasPendingReplayWork: boolean;
    isIdle: boolean;
    shouldFinalize: boolean;
};

type DeriveSessionPresentationStateInput = {
    status?: string | null;
    platform?: string | null;
    replayAvailable?: boolean | null;
    recordingDeleted?: boolean | null;
    isReplayExpired?: boolean | null;
    lastIngestActivityAt?: Date | string | null;
    startedAt?: Date | string | null;
    /** Server-resolved session end; recording is closed even if workers keep bumping lastIngestActivityAt. */
    endedAt?: Date | string | null;
    hasPendingWork?: boolean;
    /**
     * Work that should be shown as user-visible background processing. This is
     * intentionally narrower than hasPendingWork so an orphaned pending events
     * preflight can still block detail caching without making a ready replay look busy.
     */
    hasPendingProcessingWork?: boolean;
    hasPendingReplayWork?: boolean;
    /** Visitor started a newer session; do not treat stale ingest touches on this row as "live". */
    supersededByNewerVisitorSession?: boolean;
    /**
     * Web sessions can go quiet for more than the live-ingest badge window and
     * still be resumed by the same tab. Keep finalization separate from "not live".
     */
    maxSessionDurationMs?: number;
    now?: Date;
};

function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function loadSessionWorkAggregate(sessionId: string): Promise<SessionWorkAggregate> {
    const result = await db.execute(sql`
        select
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'screenshots'
                  and ra.status = 'ready'
            ), 0) as "readyScreenshotCount",
            coalesce((
                select sum(coalesce(ra.size_bytes, ra.declared_size_bytes, 0))::bigint
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'screenshots'
                  and ra.status = 'ready'
            ), 0) as "readyScreenshotBytes",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'rrweb'
                  and ra.status = 'ready'
            ), 0) as "readyWebReplayCount",
            coalesce((
                select sum(coalesce(ra.size_bytes, ra.declared_size_bytes, 0))::bigint
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'rrweb'
                  and ra.status = 'ready'
            ), 0) as "readyWebReplayBytes",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'hierarchy'
                  and ra.status = 'ready'
            ), 0) as "readyHierarchyCount",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.status in ('pending', 'buffered', 'uploaded')
            ), 0) as "openArtifactCount",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.status = 'uploaded'
            ), 0) as "activeJobCount",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'hierarchy', 'rrweb')
                  and ra.status in ('pending', 'buffered', 'uploaded')
            ), 0) as "openReplayArtifactCount",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'hierarchy', 'rrweb')
                  and ra.status = 'uploaded'
            ), 0) as "activeReplayJobCount",
            (
                select max(ra.end_time)
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'hierarchy', 'rrweb')
            ) as "latestReplayArtifactEndMs",
            (
                select max(coalesce(ra.end_time, ra.timestamp))
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'events'
                  and ra.status = 'ready'
            ) as "latestEventArtifactEndMs",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'events'
                  and ra.status = 'ready'
                  and (ra.start_time is null or ra.end_time is null)
            ), 0) as "readyEventArtifactMissingDerivedCount",
            (
                select max(coalesce(ra.ready_at, ra.verified_at, ra.upload_completed_at, ra.created_at))
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'rrweb')
                  and ra.status = 'ready'
            ) as "latestReadyAt"
        from ${sessions} s
        where s.id = ${sessionId}
    `);

    const row = ((result as any).rows as SessionAggregateRow[] | undefined)?.[0];
    const openArtifactCount = toFiniteNumber(row?.openArtifactCount) ?? 0;
    const activeJobCount = toFiniteNumber(row?.activeJobCount) ?? 0;
    const openReplayArtifactCount = toFiniteNumber(row?.openReplayArtifactCount) ?? 0;
    const activeReplayJobCount = toFiniteNumber(row?.activeReplayJobCount) ?? 0;
    const readyEventArtifactMissingDerivedCount = toFiniteNumber(row?.readyEventArtifactMissingDerivedCount) ?? 0;

    const hasPendingProcessingWork =
        activeJobCount > 0
        || openReplayArtifactCount > 0
        || activeReplayJobCount > 0
        || readyEventArtifactMissingDerivedCount > 0;

    return {
        readyScreenshotCount: toFiniteNumber(row?.readyScreenshotCount) ?? 0,
        readyScreenshotBytes: toFiniteNumber(row?.readyScreenshotBytes) ?? 0,
        readyWebReplayCount: toFiniteNumber(row?.readyWebReplayCount) ?? 0,
        readyWebReplayBytes: toFiniteNumber(row?.readyWebReplayBytes) ?? 0,
        readyHierarchyCount: toFiniteNumber(row?.readyHierarchyCount) ?? 0,
        openArtifactCount,
        activeJobCount,
        openReplayArtifactCount,
        activeReplayJobCount,
        latestReplayArtifactEndMs: toFiniteNumber(row?.latestReplayArtifactEndMs),
        latestEventArtifactEndMs: toFiniteNumber(row?.latestEventArtifactEndMs),
        latestReadyAt: toDateOrNull(row?.latestReadyAt),
        readyEventArtifactMissingDerivedCount,
        hasPendingProcessingWork,
        hasPendingWork: openArtifactCount > 0 || activeJobCount > 0 || readyEventArtifactMissingDerivedCount > 0,
        hasPendingReplayWork: openReplayArtifactCount > 0 || activeReplayJobCount > 0,
    };
}

export function deriveSessionPresentationState(
    input: DeriveSessionPresentationStateInput
): SessionPresentationState {
    const now = input.now ?? new Date();
    const lastIngestActivityAt = toDateOrNull(input.lastIngestActivityAt);
    const startedAt = toDateOrNull(input.startedAt);
    const cutoffMs = now.getTime() - SESSION_LIVE_INGEST_WINDOW_MS;
    const liveClockMs = lastIngestActivityAt?.getTime() ?? 0;
    const hasPendingWork = Boolean(input.hasPendingWork);
    const hasPendingProcessingWork = input.hasPendingProcessingWork ?? hasPendingWork;
    const hasPendingReplayWork = Boolean(input.hasPendingReplayWork);
    const canOpenReplay = Boolean(input.replayAvailable) && !input.recordingDeleted && !input.isReplayExpired;
    const status = input.status === 'pending' ? 'processing' : (input.status ?? 'processing');
    const hardTerminal = status === 'failed' || status === 'deleted';
    const superseded = Boolean(input.supersededByNewerVisitorSession);
    const recordingClosed = toDateOrNull(input.endedAt) != null;
    const isWebSession = input.platform === 'web';
    const defaultMaxSessionDurationMs = isWebSession ? 30 * 60_000 : SESSION_LIVE_INGEST_WINDOW_MS;
    const maxSessionDurationMs = Math.max(
        SESSION_LIVE_INGEST_WINDOW_MS,
        toFiniteNumber(input.maxSessionDurationMs) ?? defaultMaxSessionDurationMs,
    );
    const maxSessionWindowElapsed = Boolean(
        startedAt
        && now.getTime() - startedAt.getTime() >= maxSessionDurationMs
    );
    const isLiveIngest =
        !superseded
        && !recordingClosed
        && !hardTerminal
        && status !== 'ready'
        && status !== 'completed'
        && liveClockMs > cutoffMs;
    const isIngestQuiescent = superseded || recordingClosed || liveClockMs <= cutoffMs;
    const isIdle = isIngestQuiescent;
    const canFinalizeIdleSession =
        !isWebSession
        || recordingClosed
        || superseded
        || maxSessionWindowElapsed;
    const shouldFinalize =
        status !== 'completed'
        && !hasPendingReplayWork
        && isIngestQuiescent
        && canFinalizeIdleSession
        && (status === 'ready' || !hardTerminal);

    let effectiveStatus = status;
    if (effectiveStatus !== 'failed' && effectiveStatus !== 'deleted' && effectiveStatus !== 'completed') {
        if (shouldFinalize) {
            effectiveStatus = 'ready';
        } else if (isLiveIngest || hasPendingReplayWork || effectiveStatus === 'processing') {
            effectiveStatus = 'processing';
        }
    }

    return {
        effectiveStatus,
        isLiveIngest,
        isBackgroundProcessing: !isLiveIngest && hasPendingProcessingWork,
        canOpenReplay,
        hasPendingWork,
        hasPendingReplayWork,
        isIdle,
        shouldFinalize,
    };
}
