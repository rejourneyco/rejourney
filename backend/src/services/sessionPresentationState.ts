import { sql } from 'drizzle-orm';
import { db, ingestJobs, recordingArtifacts, sessions } from '../db/client.js';

export const SESSION_LIVE_INGEST_WINDOW_MS = 60_000;

export type SessionWorkAggregate = {
    readyScreenshotCount: number;
    readyScreenshotBytes: number;
    readyHierarchyCount: number;
    openArtifactCount: number;
    activeJobCount: number;
    openReplayArtifactCount: number;
    activeReplayJobCount: number;
    latestReplayArtifactEndMs: number | null;
    latestReadyAt: Date | null;
    hasPendingWork: boolean;
    hasPendingReplayWork: boolean;
};

type SessionAggregateRow = {
    readyScreenshotCount: number | string | null;
    readyScreenshotBytes: number | string | null;
    readyHierarchyCount: number | string | null;
    openArtifactCount: number | string | null;
    activeJobCount: number | string | null;
    openReplayArtifactCount: number | string | null;
    activeReplayJobCount: number | string | null;
    latestReplayArtifactEndMs: number | string | null;
    latestReadyAt: Date | string | null;
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
    replayAvailable?: boolean | null;
    recordingDeleted?: boolean | null;
    isReplayExpired?: boolean | null;
    explicitEndedAt?: Date | string | null;
    finalizedAt?: Date | string | null;
    lastIngestActivityAt?: Date | string | null;
    replayAvailableAt?: Date | string | null;
    startedAt?: Date | string | null;
    hasPendingWork?: boolean;
    hasPendingReplayWork?: boolean;
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
                  and ra.kind = 'hierarchy'
                  and ra.status = 'ready'
            ), 0) as "readyHierarchyCount",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.status in ('pending', 'uploaded')
            ), 0) as "openArtifactCount",
            coalesce((
                select count(*)::int
                from ${ingestJobs} ij
                where ij.session_id = s.id
                  and ij.status in ('pending', 'processing')
            ), 0) as "activeJobCount",
            coalesce((
                select count(*)::int
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'hierarchy')
                  and ra.status in ('pending', 'uploaded')
            ), 0) as "openReplayArtifactCount",
            coalesce((
                select count(*)::int
                from ${ingestJobs} ij
                inner join ${recordingArtifacts} ra on ra.id = ij.artifact_id
                where ij.session_id = s.id
                  and ij.status in ('pending', 'processing')
                  and ra.kind in ('screenshots', 'hierarchy')
            ), 0) as "activeReplayJobCount",
            (
                select max(ra.end_time)
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'hierarchy')
            ) as "latestReplayArtifactEndMs",
            (
                select max(coalesce(ra.ready_at, ra.verified_at, ra.upload_completed_at, ra.created_at))
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind = 'screenshots'
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

    return {
        readyScreenshotCount: toFiniteNumber(row?.readyScreenshotCount) ?? 0,
        readyScreenshotBytes: toFiniteNumber(row?.readyScreenshotBytes) ?? 0,
        readyHierarchyCount: toFiniteNumber(row?.readyHierarchyCount) ?? 0,
        openArtifactCount,
        activeJobCount,
        openReplayArtifactCount,
        activeReplayJobCount,
        latestReplayArtifactEndMs: toFiniteNumber(row?.latestReplayArtifactEndMs),
        latestReadyAt: toDateOrNull(row?.latestReadyAt),
        hasPendingWork: openArtifactCount > 0 || activeJobCount > 0,
        hasPendingReplayWork: openReplayArtifactCount > 0 || activeReplayJobCount > 0,
    };
}

export function deriveSessionPresentationState(
    input: DeriveSessionPresentationStateInput
): SessionPresentationState {
    const now = input.now ?? new Date();
    const explicitEndedAt = toDateOrNull(input.explicitEndedAt);
    const finalizedAt = toDateOrNull(input.finalizedAt);
    const lastIngestActivityAt = toDateOrNull(input.lastIngestActivityAt);
    const cutoffMs = now.getTime() - SESSION_LIVE_INGEST_WINDOW_MS;
    const liveClockMs = lastIngestActivityAt?.getTime() ?? 0;
    const hasPendingWork = Boolean(input.hasPendingWork);
    const hasPendingReplayWork = Boolean(input.hasPendingReplayWork);
    const canOpenReplay = Boolean(input.replayAvailable) && !input.recordingDeleted && !input.isReplayExpired;
    const status = input.status ?? 'processing';
    const serverClosed =
        status === 'ready'
        || status === 'failed'
        || status === 'deleted'
        || finalizedAt != null;
    const isLiveIngest =
        !serverClosed
        && !explicitEndedAt
        && liveClockMs > cutoffMs;
    /**
     * Finalize when ingest has been quiet — not when replay first became available.
     * Using replayAvailableAt here kept sessions "hot" forever after the first frame
     * and let new replay segments extend the timeline indefinitely.
     */
    const isIngestQuiescent = liveClockMs <= cutoffMs;
    const isIdle = isIngestQuiescent;
    const shouldFinalize =
        !hasPendingReplayWork
        && (Boolean(explicitEndedAt) || Boolean(finalizedAt) || isIngestQuiescent);

    let effectiveStatus = status;
    if (effectiveStatus !== 'failed' && effectiveStatus !== 'deleted') {
        if (shouldFinalize) {
            effectiveStatus = 'ready';
        } else if (isLiveIngest || hasPendingReplayWork || effectiveStatus === 'processing' || effectiveStatus === 'pending') {
            effectiveStatus = 'processing';
        }
    }

    return {
        effectiveStatus,
        isLiveIngest,
        isBackgroundProcessing: !isLiveIngest && hasPendingWork,
        canOpenReplay,
        hasPendingWork,
        hasPendingReplayWork,
        isIdle,
        shouldFinalize,
    };
}
