import { eq, sql } from 'drizzle-orm';
import { db, projects, recordingArtifacts, sessionMetrics, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import { updateDeviceUsage } from './recording.js';
import { getTeamSessionUsage, incrementProjectSessionReplayIfNeeded } from './quotaCheck.js';
import { canOpenReplayFromSessionFields } from './replayAvailability.js';
import { resolveReplayRetention } from './replayRetention.js';
import {
    discardSmartCaptureVisualArtifacts,
    isSmartCaptureEntitled,
    isSmartCaptureBufferAtLimit,
    resolveSmartCaptureDecision,
    type ReplayRetentionState,
    type SmartCaptureDecision,
} from './smartCapture.js';
import { deriveSessionPresentationState } from './sessionPresentationState.js';
import {
    deriveSessionEvidenceState,
    loadSessionWorkAggregate,
    SESSION_LIVE_INGEST_WINDOW_MS,
} from './sessionEvidence.js';
import { computeSessionDurationSeconds, hasStoredClosedTiming, resolveAuthoritativeSessionClose, selectMaxObservabilityMinutes } from './sessionTiming.js';
import { loadSuccessorSessionStartedAt } from './sessionTimingQuery.js';

export const SESSION_FINALIZE_IDLE_MS = SESSION_LIVE_INGEST_WINDOW_MS;

type ReconcileSessionResult = {
    sessionId: string;
    replayAvailable: boolean;
    replayRetentionState: ReplayRetentionState | null;
    finalized: boolean;
    status: string;
};

type TouchSessionOptions = {
    at?: Date;
    updatedAt?: Date;
    endedAt?: Date | null;
    durationSeconds?: number | null;
    backgroundTimeSeconds?: number | null;
    reopen?: boolean;
};

async function ensureMetricsRow(sessionId: string) {
    await db.insert(sessionMetrics).values({ sessionId }).onConflictDoNothing();
}

export async function markSessionIngestActivity(sessionId: string, options: TouchSessionOptions = {}): Promise<void> {
    const at = options.at ?? new Date();
    const updatedAt = options.updatedAt ?? new Date();
    const update: Record<string, unknown> = {
        lastIngestActivityAt: at,
        updatedAt,
    };

    if (options.endedAt !== undefined) {
        update.endedAt = options.endedAt;
    }
    if (options.durationSeconds !== undefined && options.durationSeconds !== null) {
        update.durationSeconds = Math.max(1, Math.round(options.durationSeconds));
    }
    if (options.backgroundTimeSeconds !== undefined && options.backgroundTimeSeconds !== null) {
        update.backgroundTimeSeconds = Math.max(0, Math.round(options.backgroundTimeSeconds));
    }
    if (options.reopen) {
        update.status = 'processing';
        update.endedAt = null;
        update.durationSeconds = null;
    }

    await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL synchronous_commit = local`);
        await tx.update(sessions)
            .set(update)
            .where(eq(sessions.id, sessionId));
    });
}

export async function reconcileSessionState(sessionId: string, now = new Date()): Promise<ReconcileSessionResult | null> {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!session) return null;
    if (session.status === 'deleted') {
        return {
            sessionId,
            replayAvailable: Boolean(session.replayAvailable),
            replayRetentionState: session.replayRetentionState as ReplayRetentionState | null,
            finalized: false,
            status: session.status,
        };
    }

    if (session.status === 'completed') {
        if (canOpenReplayFromSessionFields(session)) {
            await incrementProjectSessionReplayIfNeeded(sessionId);
        }
        return {
            sessionId,
            replayAvailable: Boolean(session.replayAvailable),
            replayRetentionState: session.replayRetentionState as ReplayRetentionState | null,
            finalized: true,
            status: session.status,
        };
    }

    await ensureMetricsRow(sessionId);
    const [aggregate, successorStartedAt, metrics] = await Promise.all([
        loadSessionWorkAggregate(sessionId),
        loadSuccessorSessionStartedAt({
            sessionId: session.id,
            projectId: session.projectId,
            deviceId: session.deviceId,
            startedAt: session.startedAt,
        }),
        db.select().from(sessionMetrics).where(eq(sessionMetrics.sessionId, sessionId)).limit(1).then((rows) => rows[0] ?? null),
    ]);

    const evidence = deriveSessionEvidenceState({
        aggregate,
        finalizationIdleMs: SESSION_FINALIZE_IDLE_MS,
        now,
        session,
        successorStartedAt,
    });
    const {
        activeJobCount,
        activeReplayJobCount,
        hasReplayArtifacts,
        latestClientEvidenceEndMs,
        openArtifactCount,
        openReplayArtifactCount,
        readyHierarchyCount,
        readyScreenshotBytes,
        readyScreenshotCount,
        readyWebReplayBytes,
        readyWebReplayCount,
        smartCaptureEvidenceSettled,
        supersededByNewerVisitorSession,
    } = evidence;

    const [project] = await db.select({
        id: projects.id,
        teamId: projects.teamId,
        maxRecordingMinutes: projects.maxRecordingMinutes,
        webMaxObservabilityMinutes: projects.webMaxObservabilityMinutes,
        smartCaptureEnabled: projects.smartCaptureEnabled,
        smartCaptureMode: projects.smartCaptureMode,
        smartCapturePreset: projects.smartCapturePreset,
        smartCaptureRules: projects.smartCaptureRules,
        smartCaptureDecisionWindowHours: projects.smartCaptureDecisionWindowHours,
    })
        .from(projects)
        .where(eq(projects.id, session.projectId))
        .limit(1);
    const maxRecordingMinutes = selectMaxObservabilityMinutes(project, session.platform);

    const smartCaptureEntitled = project?.teamId ? await isSmartCaptureEntitled(project.teamId) : false;
    let smartCaptureDecision: SmartCaptureDecision = project
        ? await resolveSmartCaptureDecision({
            project,
            session,
            metrics,
            hasReplayArtifacts,
            entitled: smartCaptureEntitled,
            canDiscardUnmatched: smartCaptureEvidenceSettled,
            now,
        })
        : {
            status: 'not_applicable',
            reason: 'project_not_found',
            ruleId: null,
            decidedAt: null,
            shouldExposeReplay: hasReplayArtifacts,
            shouldDiscardVisualArtifacts: false,
        };

    const smartCaptureBufferAtLimit = smartCaptureDecision.status === 'pending' && project?.teamId
        ? await isSmartCaptureBufferAtLimit(project.teamId, session.id)
        : false;
    const replayQuotaAtLimit = Boolean(
        project?.teamId
        && hasReplayArtifacts
        && smartCaptureDecision.shouldExposeReplay
        && smartCaptureDecision.status !== 'pending'
        && !session.replayQuotaCountedAt
        && (await getTeamSessionUsage(project.teamId)).isReplayAtLimit
    );
    const replayRetention = resolveReplayRetention({
        hasReplayArtifacts,
        hasReplayQuotaCounted: Boolean(session.replayQuotaCountedAt),
        now,
        replayQuotaAtLimit,
        replayQuotaBillingExhausted: Boolean(session.replayQuotaBillingExhausted),
        smartCaptureBufferAtLimit,
        smartCaptureDecision,
    });
    smartCaptureDecision = replayRetention.smartCaptureDecision;
    const {
        replayAvailable,
        replayQuotaBillingExhausted,
        replayRetentionState,
    } = replayRetention;

    const normalizedStatus = session.status === 'pending' ? 'processing' : session.status;

    const presentationState = deriveSessionPresentationState({
        status: normalizedStatus,
        platform: session.platform,
        replayAvailable,
        replayRetentionState,
        recordingDeleted: session.recordingDeleted,
        isReplayExpired: session.isReplayExpired,
        lastIngestActivityAt: session.lastIngestActivityAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        hasPendingWork: aggregate.hasPendingWork,
        hasPendingProcessingWork: aggregate.hasPendingProcessingWork,
        hasPendingReplayWork: aggregate.hasPendingReplayWork,
        supersededByNewerVisitorSession,
        maxSessionDurationMs: maxRecordingMinutes * 60_000,
        now,
    });
    const shouldFinalize = presentationState.shouldFinalize;

    const resolvedClose = resolveAuthoritativeSessionClose({
        startedAt: session.startedAt,
        lastIngestActivityAt: session.lastIngestActivityAt,
        latestReplayEndMs: latestClientEvidenceEndMs,
        storedBackgroundTimeSeconds: session.backgroundTimeSeconds,
        maxRecordingMinutes,
        successorStartedAt: supersededByNewerVisitorSession ? successorStartedAt : null,
    });
    const hasLaterWebClientEvidence = Boolean(
        session.platform === 'web'
        && session.endedAt
        && latestClientEvidenceEndMs
        && Number(latestClientEvidenceEndMs) > session.endedAt.getTime() + 1000
    );
    const storedDurationMatchesBackground = !hasStoredClosedTiming({
        endedAt: session.endedAt,
        durationSeconds: session.durationSeconds,
    }) || session.durationSeconds === computeSessionDurationSeconds(
        session.startedAt,
        session.endedAt ?? session.startedAt,
        session.backgroundTimeSeconds ?? 0,
    );
    const preserveStoredCloseTiming = hasStoredClosedTiming({
        endedAt: session.endedAt,
        durationSeconds: session.durationSeconds,
    }) && !hasLaterWebClientEvidence && storedDurationMatchesBackground;

    const sessionUpdate: Record<string, unknown> = {
        replayAvailable,
        replayQuotaBillingExhausted,
        replayRetentionState,
        smartCaptureStatus: smartCaptureDecision.status,
        smartCaptureReason: smartCaptureDecision.reason,
        smartCaptureRuleId: smartCaptureDecision.ruleId,
        smartCaptureDecidedAt: smartCaptureDecision.decidedAt,
        replaySegmentCount: readyScreenshotCount + readyWebReplayCount,
        replayStorageBytes: readyScreenshotBytes + readyWebReplayBytes,
        updatedAt: now,
    };

    if (shouldFinalize) {
        sessionUpdate.status = 'ready';
        sessionUpdate.endedAt = preserveStoredCloseTiming ? session.endedAt : resolvedClose.endedAt;
        sessionUpdate.backgroundTimeSeconds = preserveStoredCloseTiming
            ? (session.backgroundTimeSeconds ?? 0)
            : resolvedClose.backgroundTimeSeconds;
        sessionUpdate.durationSeconds = preserveStoredCloseTiming
            ? session.durationSeconds
            : resolvedClose.durationSeconds;
    } else if (session.status !== 'failed') {
        sessionUpdate.status = 'processing';
    }

    await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL synchronous_commit = local`);
        await tx.update(sessions)
            .set(sessionUpdate)
            .where(eq(sessions.id, sessionId));
        await tx.update(sessionMetrics)
            .set({
                screenshotSegmentCount: readyScreenshotCount,
                screenshotTotalBytes: readyScreenshotBytes,
                hierarchySnapshotCount: readyHierarchyCount,
            })
            .where(eq(sessionMetrics.sessionId, sessionId));
    });

    if (replayRetention.shouldDiscardVisualArtifacts) {
        await discardSmartCaptureVisualArtifacts(sessionId);
    }

    if (replayRetention.shouldCountReplay) {
        await incrementProjectSessionReplayIfNeeded(sessionId);
    }

    if (shouldFinalize) {
        if (session.status !== 'ready') {
            const minutesRecorded = Math.max(
                0,
                Math.ceil(computeSessionDurationSeconds(session.startedAt, resolvedClose.endedAt, resolvedClose.backgroundTimeSeconds) / 60),
            );
            await updateDeviceUsage(session.deviceId, session.projectId, {
                requestCount: 1,
                minutesRecorded,
            });
        }
    }

    logger.info({
        sessionId,
        replayAvailable,
        replayRetentionState,
        smartCaptureStatus: smartCaptureDecision.status,
        smartCaptureReason: smartCaptureDecision.reason,
        readyScreenshotCount,
        readyWebReplayCount,
        openArtifactCount,
        activeJobCount,
        openReplayArtifactCount,
        activeReplayJobCount,
        status: shouldFinalize ? 'ready' : session.status === 'failed' ? 'failed' : 'processing',
    }, shouldFinalize ? 'session.finalized' : 'session.reconciled');

    return {
        sessionId,
        replayAvailable,
        replayRetentionState,
        finalized: shouldFinalize,
        status: shouldFinalize ? 'ready' : session.status === 'failed' ? 'failed' : 'processing',
    };
}

export async function reconcileDueSessions(batchSize = 500, maxBatches = 20): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - SESSION_FINALIZE_IDLE_MS);
    let processed = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
        const result = await db.execute(sql`
            select s.id
            from ${sessions} s
            left join ${projects} p on p.id = s.project_id
            where s.status in ('processing', 'pending')
            and (
                (
                    s.last_ingest_activity_at <= ${cutoff}
                    and (
                        coalesce(s.platform, '') <> 'web'
                        or s.ended_at is not null
                        or s.started_at <= (${now}::timestamp - make_interval(
                            mins => least(30, greatest(1, coalesce(p.web_max_observability_minutes, p.max_recording_minutes, 30)))
                        ))
                        or (
                            coalesce(s.device_id, s.anonymous_hash, s.user_display_id) is not null
                            and exists (
                                select 1
                                from ${sessions} s2
                                where s2.project_id = s.project_id
                                  and coalesce(s2.device_id, s2.anonymous_hash, s2.user_display_id) = coalesce(s.device_id, s.anonymous_hash, s.user_display_id)
                                  and (
                                      s2.started_at > s.started_at
                                      or (s2.started_at = s.started_at and s2.id > s.id)
                                  )
                            )
                        )
                    )
                )
                or (
                    s.replay_available = true
                    and (
                        coalesce(s.platform, '') <> 'web'
                        or s.ended_at is not null
                        or s.started_at <= (${now}::timestamp - make_interval(
                            mins => least(30, greatest(1, coalesce(p.web_max_observability_minutes, p.max_recording_minutes, 30)))
                        ))
                    )
                    and not exists (
                        select 1 from ${recordingArtifacts} ra
                        where ra.session_id = s.id
                          and ra.kind in ('screenshots', 'hierarchy', 'rrweb')
                          and ra.status in ('pending', 'buffered', 'uploaded')
                    )
                    and exists (
                        select 1 from ${recordingArtifacts} ra
                        where ra.session_id = s.id
                          and ra.kind in ('screenshots', 'rrweb')
                          and ra.status = 'ready'
                          and coalesce(ra.ready_at, ra.verified_at, ra.upload_completed_at, ra.created_at) <= ${cutoff}
                    )
                )
            )
            order by coalesce(s.last_ingest_activity_at, s.started_at) asc, s.id asc
            limit ${batchSize}
        `);
        const rows = (result as any).rows as Array<{ id: string }> | undefined;
        const list = rows ?? [];
        if (list.length === 0) break;

        for (const row of list) {
            await reconcileSessionState(row.id);
        }

        processed += list.length;
        if (list.length < batchSize) break;
    }

    return processed;
}

export async function reconcileDueSmartCaptureSessions(batchSize = 250, maxBatches = 4): Promise<number> {
    const now = new Date();
    const evidenceCutoff = new Date(now.getTime() - SESSION_FINALIZE_IDLE_MS);
    let processed = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
        const result = await db.execute(sql`
            select s.id
            from ${sessions} s
            join ${projects} p on p.id = s.project_id
            where s.smart_capture_status = 'pending'
              and p.deleted_at is null
              and (
                (
                    s.smart_capture_reason = 'waiting_for_session_evidence'
                    and coalesce(s.last_ingest_activity_at, s.started_at) <= ${evidenceCutoff}
                )
                or (
                    coalesce(s.smart_capture_reason, '') <> 'waiting_for_session_evidence'
                    and s.started_at <= (${now}::timestamp - make_interval(
                        hours => least(168, greatest(1, coalesce(p.smart_capture_decision_window_hours, 168)))
                    ))
                )
              )
            order by s.started_at asc, s.id asc
            limit ${batchSize}
        `);
        const rows = (result as any).rows as Array<{ id: string }> | undefined;
        const list = rows ?? [];
        if (list.length === 0) break;

        for (const row of list) {
            await reconcileSessionState(row.id, now);
        }

        processed += list.length;
        if (list.length < batchSize) break;
    }

    return processed;
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
                    coalesce(s.ended_at, s.started_at),
                    coalesce(s.updated_at, s.started_at)
                ) as activity_at
            from ${sessions} s
            left join ${recordingArtifacts} ra on ra.session_id = s.id
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
                bool_or(ra.kind in ('screenshots', 'rrweb') and ra.status = 'ready') as has_replay
            from ${recordingArtifacts} ra
            group by ra.session_id
        )
        update ${sessions} s
        set replay_available = case
                when coalesce(s.replay_quota_billing_exhausted, false) then false
                else coalesce(replay.has_replay, false)
            end,
            replay_retention_state = case
                when coalesce(s.replay_quota_billing_exhausted, false) then 'analytics_only'
                when coalesce(replay.has_replay, false) then 'saved'
                else 'not_available'
            end
        from replay
        where s.id = replay.session_id
    `);

    await db.execute(sql`
        update ${sessions} s
        set replay_available = false,
            replay_retention_state = case
                when coalesce(s.replay_quota_billing_exhausted, false) then 'analytics_only'
                else 'not_available'
            end
        where coalesce(s.replay_quota_billing_exhausted, false)
           or not exists (
                select 1
                from ${recordingArtifacts} ra
                where ra.session_id = s.id
                  and ra.kind in ('screenshots', 'rrweb')
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

export async function backfillSessionReconciliationState(): Promise<void> {
    let processed = 0;
    while (true) {
        const batchCount = await reconcileDueSessions(500, 20);
        processed += batchCount;
        if (batchCount === 0) break;
    }

    logger.info({ processed }, 'Backfilled due session reconciliation state');
}
