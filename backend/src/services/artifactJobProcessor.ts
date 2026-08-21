import { eq, sql } from 'drizzle-orm';
import { gunzipSync } from 'zlib';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { downloadFromS3ForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { ensureHierarchyArtifactCompressed } from './hierarchyArtifactCompression.js';
import { summarizeEventsArtifact } from './ingestEventArtifactProcessor.js';
import { processAnrsArtifact, processCrashesArtifact } from './ingestFaultArtifactProcessors.js';
import { processRecoveredReplayArtifact } from './ingestReplayArtifactProcessor.js';
import { normalizeScreenshotArchiveClockFieldsInStorage } from './screenshotFrames.js';
import { runArtifactCompletionEffects } from './artifactCompletionEffects.js';
import { canOpenReplayFromSessionFields } from './replayAvailability.js';
import { reconcileSessionState } from './sessionReconciliation.js';
import { enqueueSessionEventRollupJob } from './sessionEventRollupQueue.js';
import { enqueueSessionEffectsJob } from './sessionEffectsQueue.js';
import type { ArtifactJobData, Job } from './artifactBullQueue.js';
import { normalizeArtifactPayloadClockFieldsInStorage } from './artifactPayloadClockNormalization.js';

// ─── Job context type ─────────────────────────────────────────────────────────

/**
 * Lightweight job descriptor passed into the processor context.
 * Previously this was typeof ingestJobs.$inferSelect; now it's the BullMQ job data
 * plus the fields that sub-processors need (kind, sessionId).
 */
export type ArtifactJobContext = {
    id: string;           // BullMQ job ID
    artifactId: string;
    sessionId: string;
    kind: string;
    s3ObjectKey: string;
    endpointId: string | null;
    attemptsMade: number;
};

type ArtifactProcessorContext = {
    artifact: typeof recordingArtifacts.$inferSelect;
    job: ArtifactJobContext;
    log: any;
    projectId: string;
    s3Key: string;
    session: Pick<
        typeof sessions.$inferSelect,
        | 'anonymousHash'
        | 'appVersion'
        | 'deviceId'
        | 'deviceModel'
        | 'id'
        | 'metadata'
        | 'osVersion'
        | 'platform'
        | 'projectId'
        | 'sdkVersion'
        | 'startedAt'
        | 'userDisplayId'
    >;
};

type ArtifactProcessorResult = {
    endTime?: number | null;
    sizeBytes: number;
    startTime?: number | null;
};

type ArtifactProcessor = (context: ArtifactProcessorContext) => Promise<ArtifactProcessorResult>;


function parseMaybeGzippedJson(data: Buffer, s3ObjectKey?: string | null): any {
    const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
        Boolean(s3ObjectKey?.endsWith('.gz'));

    if (!isGzipped) return JSON.parse(data.toString('utf8'));

    try {
        return JSON.parse(gunzipSync(data).toString('utf8'));
    } catch {
        return JSON.parse(data.toString('utf8'));
    }
}

function validateRrwebArtifactPayload(
    data: Buffer,
    s3ObjectKey?: string | null,
    parsedPayload?: unknown,
): number {
    const parsed = parsedPayload === undefined
        ? parseMaybeGzippedJson(data, s3ObjectKey)
        : parsedPayload;
    const events = Array.isArray(parsed) ? parsed : parsed?.events;

    if (!Array.isArray(events) || events.length === 0) {
        throw new Error('rrweb artifact payload must contain at least one event');
    }

    if (!Array.isArray(parsed) && parsed?.format !== 'rrweb') {
        throw new Error('rrweb artifact payload missing rrweb format marker');
    }

    const invalidEvent = events.find((event) => (
        !event ||
        typeof event !== 'object' ||
        !Number.isFinite(Number((event as { timestamp?: unknown }).timestamp))
    ));
    if (invalidEvent) {
        throw new Error('rrweb artifact payload contains an event without a numeric timestamp');
    }

    return events.length;
}

export const artifactProcessors: Record<string, ArtifactProcessor> = {
    events: async (context) => {
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for events');
        const normalized = await normalizeArtifactPayloadClockFieldsInStorage({
            artifactId: context.job.artifactId,
            data,
            endpointId: context.artifact.endpointId,
            kind: 'events',
            log: context.log,
            projectId: context.projectId,
            s3Key: context.s3Key,
            session: context.session,
        });
        const summary = summarizeEventsArtifact(normalized.data, normalized.parsed ?? undefined);
        return {
            ...summary,
            sizeBytes: normalized.uploadedSizeBytes ?? normalized.data.length,
        };
    },
    crashes: async (context) => {
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for crashes');
        const normalized = await normalizeArtifactPayloadClockFieldsInStorage({
            artifactId: context.job.artifactId,
            data,
            endpointId: context.artifact.endpointId,
            kind: 'crashes',
            log: context.log,
            projectId: context.projectId,
            s3Key: context.s3Key,
            session: context.session,
        });
        await processCrashesArtifact(
            context.job,
            context.session,
            context.projectId,
            context.s3Key,
            normalized.data,
            context.log,
            normalized.parsed ?? undefined,
        );
        return { sizeBytes: normalized.uploadedSizeBytes ?? normalized.data.length };
    },
    anrs: async (context) => {
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for anrs');
        const normalized = await normalizeArtifactPayloadClockFieldsInStorage({
            artifactId: context.job.artifactId,
            data,
            endpointId: context.artifact.endpointId,
            kind: 'anrs',
            log: context.log,
            projectId: context.projectId,
            s3Key: context.s3Key,
            session: context.session,
        });
        context.log.info('Processing ANRs artifact');
        await processAnrsArtifact(
            context.job,
            context.session,
            context.projectId,
            context.s3Key,
            normalized.data,
            context.log,
            normalized.parsed ?? undefined,
        );
        return { sizeBytes: normalized.uploadedSizeBytes ?? normalized.data.length };
    },
    screenshots: async (context) => {
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for screenshots');
        const normalized = await normalizeScreenshotArchiveClockFieldsInStorage({
            artifactId: context.job.artifactId,
            data,
            endpointId: context.artifact.endpointId,
            log: context.log,
            projectId: context.projectId,
            s3Key: context.s3Key,
            session: context.session,
        });
        await processRecoveredReplayArtifact({
            artifactId: context.job.artifactId,
            data: normalized.data,
            expectedFrameCount: context.artifact.frameCount,
            job: context.job,
            log: context.log,
            sessionStartTime: context.session.startedAt.getTime(),
        });
        return { sizeBytes: normalized.uploadedSizeBytes ?? data.length };
    },
    hierarchy: async (context) => {
        const repairResult = await ensureHierarchyArtifactCompressed({
            projectId: context.projectId,
            s3Key: context.s3Key,
            endpointId: context.artifact.endpointId,
            artifactId: context.job.artifactId,
            sessionId: context.job.sessionId,
        });
        const data = repairResult.data;
        if (!data) throw new Error('Artifact payload missing from S3 for hierarchy');
        const normalized = await normalizeArtifactPayloadClockFieldsInStorage({
            artifactId: context.job.artifactId,
            data,
            endpointId: context.artifact.endpointId,
            kind: 'hierarchy',
            log: context.log,
            projectId: context.projectId,
            s3Key: context.s3Key,
            session: context.session,
        });
        await processRecoveredReplayArtifact({
            artifactId: context.job.artifactId,
            data: normalized.data,
            expectedFrameCount: context.artifact.frameCount,
            job: context.job,
            log: context.log,
            parsedPayload: normalized.parsed ?? undefined,
            sessionStartTime: context.session.startedAt.getTime(),
        });
        const sizeBytes = normalized.uploadedSizeBytes ?? repairResult.sizeBytes ?? data.length;
        return { sizeBytes };
    },
    rrweb: async (context) => {
        const data = await downloadFromS3ForArtifact(context.projectId, context.s3Key, context.artifact.endpointId);
        if (!data) throw new Error('Artifact payload missing from S3 for rrweb');
        const normalized = await normalizeArtifactPayloadClockFieldsInStorage({
            artifactId: context.job.artifactId,
            data,
            endpointId: context.artifact.endpointId,
            kind: 'rrweb',
            log: context.log,
            projectId: context.projectId,
            s3Key: context.s3Key,
            session: context.session,
        });
        const eventCount = validateRrwebArtifactPayload(
            normalized.data,
            context.s3Key,
            normalized.parsed ?? undefined,
        );
        context.log.info({ eventCount }, 'RRWeb artifact verified');
        return { sizeBytes: normalized.uploadedSizeBytes ?? normalized.data.length };
    },
};

export function getArtifactProcessor(kind: string | null | undefined): ArtifactProcessor | null {
    if (!kind) return null;
    return artifactProcessors[kind] ?? null;
}

function shouldRepairReadyEventsArtifact(
    kind: string | null | undefined,
    artifact: typeof recordingArtifacts.$inferSelect,
): boolean {
    return kind === 'events' && (artifact.startTime == null || artifact.endTime == null);
}

function shouldDeferSessionEffects(kind: string | null | undefined): boolean {
    return kind === 'crashes' || kind === 'anrs';
}

function isReplayArtifactKind(kind: string | null | undefined): boolean {
    return kind === 'screenshots' || kind === 'hierarchy' || kind === 'rrweb';
}

export async function runArtifactProcessorByKind(
    kind: string | null | undefined,
    context: ArtifactProcessorContext,
): Promise<ArtifactProcessorResult> {
    const processor = getArtifactProcessor(kind);
    if (!processor) {
        throw new Error(`Unsupported artifact kind: ${kind}`);
    }
    return processor(context);
}

// ─── BullMQ-native processor entry point ─────────────────────────────────────

/**
 * Process one artifact job dispatched from a BullMQ Worker.
 *
 * BullMQ handles the job lifecycle automatically:
 *   - Moving the job to "active" when this function is entered
 *   - Marking it "completed" when this function resolves
 *   - Scheduling a retry (with exponential backoff) when this function throws
 *   - Moving to "failed" queue after all attempts are exhausted
 *
 * We therefore do NOT update ingest_jobs here.  All Postgres writes go to
 * recording_artifacts and the session/metrics tables, exactly as before.
 */
export async function processArtifactJobFromBullMQ(
    bullJob: Job<ArtifactJobData>,
    config: { workerId: string; maxAttempts: number },
): Promise<void> {
    const { artifactId, sessionId, s3ObjectKey, kind, endpointId } = bullJob.data;
    const attemptsMade = bullJob.attemptsMade ?? 0;  // 0-indexed; first attempt = 0

    // Build a context object shaped like the old ArtifactJobContext so all
    // sub-processors (ingestEventArtifactProcessor, etc.) work without changes.
    const jobCtx: ArtifactJobContext = {
        id: bullJob.id ?? artifactId,
        artifactId,
        sessionId,
        kind,
        s3ObjectKey,
        endpointId: endpointId ?? null,
        attemptsMade,
    };

    const log = logger.child({
        jobId: jobCtx.id,
        sessionId,
        artifactId,
        kind,
        attemptNumber: attemptsMade + 1,
        maxAttempts: config.maxAttempts,
        workerId: config.workerId,
    });

    // Validate required fields before touching DB
    if (!sessionId) throw new Error('Artifact job missing sessionId');
    if (!artifactId) throw new Error('Artifact job missing artifactId');
    if (!s3ObjectKey) throw new Error('Artifact job missing s3ObjectKey');

    const [sessionResult] = await db
        .select({
            session: {
                anonymousHash: sessions.anonymousHash,
                appVersion: sessions.appVersion,
                deviceId: sessions.deviceId,
                deviceModel: sessions.deviceModel,
                id: sessions.id,
                metadata: sessions.metadata,
                osVersion: sessions.osVersion,
                platform: sessions.platform,
                projectId: sessions.projectId,
                sdkVersion: sessions.sdkVersion,
                startedAt: sessions.startedAt,
                userDisplayId: sessions.userDisplayId,
            },
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        // Session deleted — nothing to process; let BullMQ mark completed
        log.warn('Session not found, skipping artifact job');
        return;
    }

    const { session } = sessionResult;
    const projectId = session.projectId;

    const [artifact] = await db
        .select()
        .from(recordingArtifacts)
        .where(eq(recordingArtifacts.id, artifactId))
        .limit(1);

    if (!artifact) {
        throw new Error('Artifact not found');
    }

    const artifactLog = log.child({
        projectId,
        s3Key: s3ObjectKey,
        endpointId: endpointId ?? null,
    });

    // If the artifact is already in ready state, just run completion effects.
    // Some buffered web event artifacts can reach ready without their derived
    // client timing fields. Repair those once so lifecycle math and metrics do
    // not miss foreground/background evidence.
    if (artifact.status === 'ready') {
        if (shouldRepairReadyEventsArtifact(kind, artifact)) {
            const repairResult = await runArtifactProcessorByKind(kind, {
                artifact,
                job: jobCtx,
                log: artifactLog,
                projectId,
                s3Key: s3ObjectKey,
                session,
            });
            await db.update(recordingArtifacts)
                .set({
                    endTime: artifact.endTime ?? repairResult.endTime ?? null,
                    sizeBytes: artifact.sizeBytes ?? repairResult.sizeBytes,
                    startTime: artifact.startTime ?? repairResult.startTime ?? null,
                    verifiedAt: artifact.verifiedAt ?? new Date(),
                })
                .where(eq(recordingArtifacts.id, artifactId));
            artifactLog.info(
                { event: 'artifact.ready_event_repaired', actualObjectSize: repairResult.sizeBytes },
                'artifact.ready_event_repaired',
            );
        }
        if (kind === 'events') {
            const eventRollupRequested = Boolean((artifact as any).eventRollupRequestedAt);
            const eventRollupProcessed = Boolean((artifact as any).eventRollupProcessedAt);
            if (eventRollupRequested && !eventRollupProcessed) {
                const sessionEventRollupQueued = await enqueueSessionEventRollupJob(session.id);
                artifactLog.info(
                    { event: 'artifact.ready_event_rollup_deferred', sessionEventRollupQueued },
                    'artifact.ready_event_rollup_deferred',
                );
                return;
            }

            const sessionEffectsQueued = await enqueueSessionEffectsJob(session.id);
            artifactLog.info(
                { event: 'artifact.ready_session_effects_deferred', sessionEffectsQueued },
                'artifact.ready_session_effects_deferred',
            );
            return;
        }
        if (shouldDeferSessionEffects(kind)) {
            const sessionEffectsQueued = await enqueueSessionEffectsJob(session.id);
            artifactLog.info(
                { event: 'artifact.ready_session_effects_deferred', sessionEffectsQueued },
                'artifact.ready_session_effects_deferred',
            );
            return;
        }
        const reconcileResult = await reconcileSessionState(session.id);
        await runArtifactCompletionEffects({
            kind,
            replayAvailable: canOpenReplayFromSessionFields(reconcileResult),
            sessionId: session.id,
        });
        artifactLog.info('Artifact already ready; running completion effects');
        return;
    }

    // Run the kind-specific processor — throws on failure, BullMQ retries
    const processorResult = await runArtifactProcessorByKind(kind, {
        artifact,
        job: jobCtx,
        log: artifactLog,
        projectId,
        s3Key: s3ObjectKey,
        session,
    });
    const { sizeBytes } = processorResult;

    const completedAt = new Date();
    const readyUpdate: Record<string, unknown> = {
        status: 'ready',
        readyAt: completedAt,
        uploadCompletedAt: artifact.uploadCompletedAt ?? completedAt,
        verifiedAt: artifact.verifiedAt ?? completedAt,
        sizeBytes,
    };
    if (kind === 'events') {
        readyUpdate.eventRollupRequestedAt = completedAt;
        readyUpdate.endTime = processorResult.endTime ?? null;
        readyUpdate.startTime = processorResult.startTime ?? null;
    }

    // Mark artifact as ready in Postgres (skip SyncRep wait — idempotent on replay)
    await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL synchronous_commit = local`);
        await tx.update(recordingArtifacts)
            .set(readyUpdate)
            .where(eq(recordingArtifacts.id, artifactId));
    });

    // On final failure (all attempts exhausted), also mark artifact as failed.
    // We check this AFTER processing succeeds (this branch is never reached on fail),
    // but handle the DLQ case via the 'failed' worker event in startArtifactWorker.ts.
    // The artifact stays "uploaded" until retry succeeds or we mark it failed via
    // the markArtifactFailedAfterExhausted helper below.

    if (kind === 'events') {
        const sessionEventRollupQueued = await enqueueSessionEventRollupJob(session.id);
        artifactLog.info(
            {
                event: 'artifact.processed',
                replayArtifact: false,
                actualObjectSize: sizeBytes,
                sessionEventRollupQueued,
            },
            'artifact.processed',
        );
        return;
    }

    if (shouldDeferSessionEffects(kind)) {
        const sessionEffectsQueued = await enqueueSessionEffectsJob(session.id);
        artifactLog.info(
            {
                event: 'artifact.processed',
                replayArtifact: false,
                actualObjectSize: sizeBytes,
                sessionEffectsQueued,
            },
            'artifact.processed',
        );
        return;
    }

    const reconcileResult = await reconcileSessionState(session.id);
    await runArtifactCompletionEffects({
        kind,
        replayAvailable: canOpenReplayFromSessionFields(reconcileResult),
        sessionId: session.id,
    });

    artifactLog.info(
        {
            event: 'artifact.processed',
            replayArtifact: isReplayArtifactKind(kind),
            actualObjectSize: sizeBytes,
        },
        'artifact.processed',
    );

    // BullMQ marks job completed on normal return — no explicit call needed.
}

/**
 * Called from the BullMQ 'failed' event (in startArtifactWorker.ts) once
 * a job has exhausted all retry attempts.  Marks the recording_artifact row
 * as 'failed' so the session lifecycle worker won't keep trying to recover it.
 */
export async function markArtifactFailedAfterExhausted(
    artifactId: string,
    errMsg: string,
): Promise<void> {
    try {
        const [artifact] = await db.update(recordingArtifacts)
            .set({ status: 'failed' })
            .where(sql`${recordingArtifacts.id} = ${artifactId} and ${recordingArtifacts.status} <> 'ready'`)
            .returning({
                kind: recordingArtifacts.kind,
                sessionId: recordingArtifacts.sessionId,
            });
        if (!artifact) {
            logger.warn(
                { event: 'artifact.exhausted_ignored', artifactId, errMsg: errMsg.slice(0, 400) },
                'artifact.exhausted_ignored',
            );
            return;
        }
        if (isReplayArtifactKind(artifact.kind)) {
            await reconcileSessionState(artifact.sessionId);
        }
        logger.warn(
            {
                event: 'artifact.exhausted',
                artifactId,
                errMsg: errMsg.slice(0, 400),
                kind: artifact?.kind ?? null,
                sessionId: artifact?.sessionId ?? null,
            },
            'artifact.exhausted',
        );
    } catch (err) {
        logger.error({ err, artifactId }, 'Failed to mark artifact as failed after job exhausted');
    }
}
