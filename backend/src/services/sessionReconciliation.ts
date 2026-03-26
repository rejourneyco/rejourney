import { eq, sql } from 'drizzle-orm';
import { db, ingestJobs, projects, recordingArtifacts, sessionMetrics, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import { updateDeviceUsage } from './recording.js';

export const SESSION_FINALIZE_IDLE_MS = 60_000;

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

type ReconcileSessionResult = {
    sessionId: string;
    replayAvailable: boolean;
    finalized: boolean;
    status: string;
};

type TouchSessionOptions = {
    at?: Date;
    explicitEndedAt?: Date | null;
    backgroundTimeSeconds?: number | null;
    closeSource?: string | null;
    reopen?: boolean;
};

function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : null;
}

function computeDurationSeconds(
    startedAt: Date,
    endedAt: Date,
    backgroundTimeSeconds: number | null | undefined
): number {
    const wallClockSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const backgroundSeconds = Math.max(0, Number(backgroundTimeSeconds ?? 0));
    return Math.max(1, wallClockSeconds - backgroundSeconds);
}

/** Caps bogus end times (bad client timestamps, wrong artifact max(end_time)) to project max recording + slack. */
function clampSessionEndedAt(startedAt: Date, candidate: Date, maxRecordingMinutes: number): Date {
    const capMs = Math.max(120_000, maxRecordingMinutes * 60 * 1000 + 120_000);
    const upper = new Date(startedAt.getTime() + capMs);
    const t = candidate.getTime();
    if (t < startedAt.getTime()) return startedAt;
    if (t > upper.getTime()) return upper;
    return candidate;
}

async function ensureMetricsRow(sessionId: string) {
    await db.insert(sessionMetrics).values({ sessionId }).onConflictDoNothing();
}

async function loadSessionAggregate(sessionId: string): Promise<SessionAggregateRow> {
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
                from ingest_jobs ij
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

    const rows = (result as any).rows as SessionAggregateRow[] | undefined;
    return rows?.[0] ?? {
        readyScreenshotCount: 0,
        readyScreenshotBytes: 0,
        readyHierarchyCount: 0,
        openArtifactCount: 0,
        activeJobCount: 0,
        openReplayArtifactCount: 0,
        activeReplayJobCount: 0,
        latestReplayArtifactEndMs: null,
        latestReadyAt: null,
    };
}

export async function markSessionIngestActivity(sessionId: string, options: TouchSessionOptions = {}): Promise<void> {
    const at = options.at ?? new Date();
    const update: Record<string, unknown> = {
        lastIngestActivityAt: at,
        updatedAt: at,
    };

    if (options.explicitEndedAt !== undefined) {
        update.explicitEndedAt = options.explicitEndedAt;
    }
    if (options.backgroundTimeSeconds !== undefined && options.backgroundTimeSeconds !== null) {
        update.backgroundTimeSeconds = Math.max(0, Math.round(options.backgroundTimeSeconds));
    }
    if (options.closeSource !== undefined) {
        update.closeSource = options.closeSource;
    }
    if (options.reopen) {
        update.status = 'processing';
        update.finalizedAt = null;
        if (options.closeSource === undefined) {
            update.closeSource = null;
        }
    }

    await db.update(sessions)
        .set(update)
        .where(eq(sessions.id, sessionId));
}

export async function reconcileSessionState(sessionId: string, now = new Date()): Promise<ReconcileSessionResult | null> {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!session) return null;
    if (session.status === 'deleted') {
        return {
            sessionId,
            replayAvailable: Boolean(session.replayAvailable),
            finalized: Boolean(session.finalizedAt),
            status: session.status,
        };
    }

    await ensureMetricsRow(sessionId);
    const aggregate = await loadSessionAggregate(sessionId);

    const readyScreenshotCount = toFiniteNumber(aggregate.readyScreenshotCount) ?? 0;
    const readyScreenshotBytes = toFiniteNumber(aggregate.readyScreenshotBytes) ?? 0;
    const readyHierarchyCount = toFiniteNumber(aggregate.readyHierarchyCount) ?? 0;
    const openArtifactCount = toFiniteNumber(aggregate.openArtifactCount) ?? 0;
    const activeJobCount = toFiniteNumber(aggregate.activeJobCount) ?? 0;
    const openReplayArtifactCount = toFiniteNumber(aggregate.openReplayArtifactCount) ?? 0;
    const activeReplayJobCount = toFiniteNumber(aggregate.activeReplayJobCount) ?? 0;

    const [project] = await db.select({ maxRecordingMinutes: projects.maxRecordingMinutes })
        .from(projects)
        .where(eq(projects.id, session.projectId))
        .limit(1);
    const maxRecordingMinutes = project?.maxRecordingMinutes ?? 10;

    const replayAvailable = readyScreenshotCount > 0;
    const replayAvailableAt = replayAvailable
        ? session.replayAvailableAt
            ?? toDateOrNull(aggregate.latestReadyAt)
            ?? session.lastIngestActivityAt
            ?? now
        : null;

    // Events / faults can keep uploading after replay is ready; only replay artifacts block "done" once we have screenshots.
    const noPendingWork = replayAvailable
        ? openReplayArtifactCount === 0 && activeReplayJobCount === 0
        : openArtifactCount === 0 && activeJobCount === 0;
    const isExplicitlyEnded = Boolean(session.explicitEndedAt);
    const latestReadyAtDate = toDateOrNull(aggregate.latestReadyAt);
    const activityClockForIdle = replayAvailable
        ? (latestReadyAtDate ?? session.lastIngestActivityAt)
        : session.lastIngestActivityAt;
    const isIdle = Boolean(activityClockForIdle)
        && activityClockForIdle.getTime() <= now.getTime() - SESSION_FINALIZE_IDLE_MS;
    const shouldFinalize = noPendingWork && (isExplicitlyEnded || isIdle);

    const latestReplayEndMs = toFiniteNumber(aggregate.latestReplayArtifactEndMs);
    const rawDerivedEndedAt = session.explicitEndedAt
        ?? (latestReplayEndMs ? new Date(latestReplayEndMs) : null)
        ?? session.lastIngestActivityAt
        ?? session.endedAt
        ?? now;
    const derivedEndedAt = clampSessionEndedAt(session.startedAt, rawDerivedEndedAt, maxRecordingMinutes);

    const sessionUpdate: Record<string, unknown> = {
        replayAvailable,
        replayAvailableAt,
        replaySegmentCount: readyScreenshotCount,
        replayStorageBytes: readyScreenshotBytes,
        updatedAt: now,
    };

    if (shouldFinalize) {
        sessionUpdate.status = 'ready';
        sessionUpdate.endedAt = derivedEndedAt;
        sessionUpdate.durationSeconds = computeDurationSeconds(session.startedAt, derivedEndedAt, session.backgroundTimeSeconds);
        sessionUpdate.finalizedAt = session.finalizedAt ?? now;
        sessionUpdate.closeSource = session.explicitEndedAt ? 'explicit' : 'inactivity';
    } else if (session.status !== 'failed') {
        sessionUpdate.status = 'processing';
        sessionUpdate.finalizedAt = null;
    }

    await db.update(sessions)
        .set(sessionUpdate)
        .where(eq(sessions.id, sessionId));

    await db.update(sessionMetrics)
        .set({
            screenshotSegmentCount: readyScreenshotCount,
            screenshotTotalBytes: readyScreenshotBytes,
            hierarchySnapshotCount: readyHierarchyCount,
        })
        .where(eq(sessionMetrics.sessionId, sessionId));

    if (shouldFinalize && !session.finalizedAt) {
        const minutesRecorded = Math.max(
            0,
            Math.ceil(computeDurationSeconds(session.startedAt, derivedEndedAt, session.backgroundTimeSeconds) / 60),
        );
        await updateDeviceUsage(session.deviceId, session.projectId, {
            requestCount: 1,
            minutesRecorded,
        });
    }

    logger.info({
        sessionId,
        replayAvailable,
        readyScreenshotCount,
        openArtifactCount,
        activeJobCount,
        openReplayArtifactCount,
        activeReplayJobCount,
        status: shouldFinalize ? 'ready' : session.status === 'failed' ? 'failed' : 'processing',
    }, shouldFinalize ? 'session.finalized' : 'session.reconciled');

    return {
        sessionId,
        replayAvailable,
        finalized: shouldFinalize,
        status: shouldFinalize ? 'ready' : session.status === 'failed' ? 'failed' : 'processing',
    };
}

export async function reconcileDueSessions(limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - SESSION_FINALIZE_IDLE_MS);
    const result = await db.execute(sql`
        select s.id
        from ${sessions} s
        where s.status in ('processing', 'pending')
        and (
            s.explicit_ended_at is not null
            or s.last_ingest_activity_at <= ${cutoff}
            or (
                s.replay_available = true
                and not exists (
                    select 1 from ${recordingArtifacts} ra
                    where ra.session_id = s.id
                      and ra.kind in ('screenshots', 'hierarchy')
                      and ra.status in ('pending', 'uploaded')
                )
                and not exists (
                    select 1 from ${ingestJobs} ij
                    inner join ${recordingArtifacts} ra on ra.id = ij.artifact_id
                    where ij.session_id = s.id
                      and ij.status in ('pending', 'processing')
                      and ra.kind in ('screenshots', 'hierarchy')
                )
                and exists (
                    select 1 from ${recordingArtifacts} ra
                    where ra.session_id = s.id
                      and ra.kind = 'screenshots'
                      and ra.status = 'ready'
                      and coalesce(ra.ready_at, ra.verified_at, ra.upload_completed_at, ra.created_at) <= ${cutoff}
                )
            )
        )
        limit ${limit}
    `);
    const rows = (result as any).rows as Array<{ id: string }> | undefined;
    const list = rows ?? [];
    for (const row of list) {
        await reconcileSessionState(row.id);
    }
    return list.length;
}

export async function backfillArtifactDrivenLifecycleState(): Promise<void> {
    await db.execute(sql`
        insert into ${sessionMetrics} (session_id)
        select s.id
        from ${sessions} s
        on conflict (session_id) do nothing
    `);

    await db.execute(sql`
        with activity as (
            select
                s.id as session_id,
                greatest(
                    coalesce(max(ra.created_at), s.started_at),
                    coalesce(max(ra.upload_completed_at), s.started_at),
                    coalesce(max(ra.ready_at), s.started_at),
                    coalesce(max(ij.updated_at), s.started_at),
                    coalesce(s.explicit_ended_at, s.started_at),
                    coalesce(s.ended_at, s.started_at),
                    coalesce(s.updated_at, s.started_at)
                ) as activity_at
            from ${sessions} s
            left join ${recordingArtifacts} ra on ra.session_id = s.id
            left join ingest_jobs ij on ij.session_id = s.id
            group by s.id
        )
        update ${sessions} s
        set last_ingest_activity_at = activity.activity_at
        from activity
        where s.id = activity.session_id
    `);

    await db.execute(sql`
        with replay as (
            select
                ra.session_id,
                bool_or(ra.kind = 'screenshots' and ra.status = 'ready') as has_replay,
                max(case when ra.kind = 'screenshots' and ra.status = 'ready' then coalesce(ra.ready_at, ra.verified_at, ra.upload_completed_at, ra.created_at) end) as available_at
            from ${recordingArtifacts} ra
            group by ra.session_id
        )
        update ${sessions} s
        set
            replay_available = coalesce(replay.has_replay, false),
            replay_available_at = case
                when coalesce(replay.has_replay, false) then coalesce(s.replay_available_at, replay.available_at)
                else null
            end
        from replay
        where s.id = replay.session_id
    `);

    await db.execute(sql`
        update ${sessions} s
        set
            replay_available = false,
            replay_available_at = null
        where not exists (
            select 1
            from ${recordingArtifacts} ra
            where ra.session_id = s.id
              and ra.kind = 'screenshots'
              and ra.status = 'ready'
        )
    `);

    let processed = 0;
    while (true) {
        const batchCount = await reconcileDueSessions(5000);
        processed += batchCount;
        if (batchCount < 5000) break;
    }

    logger.info({ processed }, 'Backfilled artifact-driven session lifecycle state');
}
