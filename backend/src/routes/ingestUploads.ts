import { Router } from 'express';
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, projects, sessionMetrics, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import {
    getIdempotencyStatus,
    setIdempotencyStatus,
    getSessionExistsCache,
    setSessionExistsCache,
} from '../db/redis.js';
import { generateS3Key, getEndpointForSession } from '../db/s3.js';
import { apiKeyAuth, requireScope, asyncHandler, ApiError } from '../middleware/index.js';
import {
    ingestBatchDeviceRateLimiter,
    ingestBatchProjectRateLimiter,
    ingestSegmentProjectRateLimiter,
    ingestSegmentDeviceRateLimiter,
} from '../middleware/rateLimit.js';
import { updateDeviceUsage } from '../services/recording.js';
import { ensureIngestSession, maybeBackfillSessionStartedAt } from '../services/ingestSessionLifecycle.js';
import { checkAndEnforceSessionLimit, checkBillingStatus, incrementProjectSessionCount } from '../services/quotaCheck.js';
import { enforceIngestByteBudget } from '../services/ingestByteBudget.js';
import {
    completeArtifactUpload,
    prepareReplayArtifactForUpload,
    registerPendingArtifact,
} from '../services/ingestArtifactLifecycle.js';
import {
    ARTIFACT_UPLOAD_URL_TTL_SECONDS,
    buildArtifactUploadRelayUrl,
    getUploadRelayBuildContext,
} from '../services/ingestUploadRelay.js';
import {
    buildReplaySegmentId,
    extractDeviceIdFromUploadToken,
    parseBatchId,
    parseRequestedSizeBytes,
    parseSegmentId,
} from '../services/ingestProtocol.js';
import { buildSdkTelemetryMergeSet, normalizeSdkTelemetry } from '../services/ingestSdkTelemetry.js';
import { getRequestIp } from '../utils/requestIp.js';
import { getRedisDiagnosticsForLog } from '../db/redis.js';
import {
    assertSessionAcceptsNewIngestWork,
    isSessionIngestImmutable,
} from '../services/sessionIngestImmutability.js';
const router = Router();

function logIngestPresignSkip(meta: {
    route: string;
    projectId: string;
    reason: string;
    sessionId?: string | null;
    kind?: string;
    deduplicated?: boolean;
    extra?: Record<string, unknown>;
}): void {
    logger.info(
        {
            event: 'ingest.presign_skip',
            ...meta,
            ...getRedisDiagnosticsForLog(),
        },
        'ingest.presign_skip',
    );
}

async function findExistingProjectSession(projectId: string, sessionId?: string | null) {
    if (!sessionId) {
        return null;
    }

    // Fast path: Redis existence flag avoids a DB round-trip for every presign
    // after the first. We cache "this sessionId is valid for this projectId" for
    // 1 hour — subsequent chunks of the same session all hit Redis instead of DB.
    const cachedExists = await getSessionExistsCache(projectId, sessionId);
    if (cachedExists) {
        // Return a minimal stub — callers only use this to skip billing/limit checks.
        // ensureIngestSession will fetch (or reuse) the full row via its own logic.
        return { id: sessionId, projectId } as any;
    }

    const [session] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
        .limit(1);

    if (session) {
        // Populate cache for all future chunks of this session (fire-and-forget)
        setSessionExistsCache(projectId, sessionId).catch(() => {});
    }

    return session ?? null;
}

router.post(
    '/presign',
    apiKeyAuth,
    requireScope('ingest'),
    ingestBatchProjectRateLimiter,
    ingestBatchDeviceRateLimiter,
    asyncHandler(async (req, res) => {
        const data = req.body;
        const projectId = req.project!.id;
        const teamId = req.project!.teamId;

        if (!data.contentType || data.batchNumber === undefined || data.sizeBytes === undefined) {
            throw ApiError.badRequest('Missing required fields: contentType, batchNumber, sizeBytes');
        }

        const requestedSizeBytes = parseRequestedSizeBytes(data.sizeBytes);

        const providedSessionId = typeof data.sessionId === 'string' && data.sessionId !== ''
            ? data.sessionId
            : null;
        const sessionId = providedSessionId ?? `session_${Date.now()}_${randomBytes(16).toString('hex')}`;

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            const existing = await getIdempotencyStatus(projectId, idempotencyKey);
            if (existing?.status === 'done') {
                logIngestPresignSkip({
                    route: '/api/ingest/presign',
                    projectId,
                    reason: 'idempotency_already_done',
                    sessionId: data.sessionId || null,
                    deduplicated: true,
                });
                res.json({
                    skipUpload: true,
                    deduplicated: true,
                    sessionId: data.sessionId || null,
                    reason: 'Already processed',
                });
                return;
            }
            if (existing?.status === 'processing') {
                logger.info(
                    {
                        event: 'ingest.presign_idempotency_processing',
                        route: '/api/ingest/presign',
                        projectId,
                        sessionId: data.sessionId || null,
                        ...getRedisDiagnosticsForLog(),
                    },
                    'ingest.presign_idempotency_processing',
                );
                res.status(202).json({ message: 'Processing', retryAfter: 5 });
                return;
            }
        }

        const deviceAuthId = extractDeviceIdFromUploadToken(req);

        // Run the byte-budget check, project lookup, and session lookup in parallel —
        // all three are independent and together they were the first sequential wall
        // of DB round-trips on this hot path.
        const [, [project], existingSession] = await Promise.all([
            enforceIngestByteBudget({
                projectId,
                deviceId: deviceAuthId,
                clientIp: getRequestIp(req),
                bytes: requestedSizeBytes,
                endpoint: 'presign',
            }),
            db.select().from(projects).where(eq(projects.id, projectId)).limit(1),
            findExistingProjectSession(projectId, providedSessionId),
        ]);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        if (!project.rejourneyEnabled) {
            throw ApiError.forbidden('Rejourney is disabled for this project');
        }

        if (!existingSession) {
            // Billing check and session-limit check are independent — run together.
            const [billingStatus] = await Promise.all([
                checkBillingStatus(teamId),
                checkAndEnforceSessionLimit(teamId),
            ]);
            if (!billingStatus.canRecord) {
                throw ApiError.paymentRequired(billingStatus.reason || 'Recording blocked - billing issue');
            }
        }

        // Pass the already-fetched session so ensureIngestSession skips its own SELECT.
        const { session, created: isNewSession } = await ensureIngestSession(projectId, sessionId, req, {
            userId: data.userId,
            platform: data.platform,
            deviceModel: data.deviceModel,
            appVersion: data.appVersion,
            osVersion: data.osVersion,
            networkType: data.networkType,
            deviceId: deviceAuthId || undefined,
            sdkVersion: typeof data.sdkVersion === 'string' ? data.sdkVersion : undefined,
        }, undefined, existingSession);

        assertSessionAcceptsNewIngestWork(session);

        if (isNewSession && project.rejourneyEnabled) {
            incrementProjectSessionCount(projectId, teamId, 1)
                .then(() => {
                    logger.debug({ projectId, teamId, sessionId: session.id }, 'Session counted for billing');
                })
                .catch((err) => {
                    logger.warn({ err, projectId, teamId, sessionId: session.id }, 'Failed to increment project session count');
                });

            updateDeviceUsage(deviceAuthId || session.deviceId || null, projectId, {
                sessionsStarted: 1,
            }).catch(() => {});
        }

        if (deviceAuthId) {
            updateDeviceUsage(deviceAuthId, projectId, { requestCount: 1 }).catch(() => {});
        }

        const contentTypeMap: Record<string, string> = {
            events: 'events',
            crashes: 'crashes',
            anrs: 'anrs',
        };
        const kind = contentTypeMap[data.contentType] || 'events';
        const batchId = `batch_${session.id}_${data.contentType}_${data.batchNumber}_${randomBytes(4).toString('hex')}`;
        const filename = `${data.contentType}_${data.batchNumber}_${Date.now()}.json.gz`;
        const s3Key = generateS3Key(teamId, projectId, session.id, kind, filename);
        const endpoint = await getEndpointForSession(session.id, projectId);

        const artifact = await registerPendingArtifact({
            sessionId: session.id,
            kind,
            s3ObjectKey: s3Key,
            endpointId: endpoint.id,
            clientUploadId: batchId,
            declaredSizeBytes: requestedSizeBytes,
            timestamp: Date.now(),
        });
        const presignedUrl = buildArtifactUploadRelayUrl({
            artifactId: artifact.id,
            projectId,
            sessionId: session.id,
            kind,
        });

        logger.info({
            sessionId: session.id,
            artifactId: artifact.id,
            batchId,
            contentType: data.contentType,
            batchNumber: data.batchNumber,
            sizeBytes: requestedSizeBytes,
            isKeyframe: data.isKeyframe,
            deviceId: deviceAuthId,
        }, 'Presigned URL generated');

        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'processing');
        }

        res.json({
            presignedUrl,
            batchId,
            sessionId: session.id,
            s3Key,
            endpointId: endpoint.id,
        });
    })
);

router.post(
    '/batch/complete',
    apiKeyAuth,
    requireScope('ingest'),
    ingestBatchProjectRateLimiter,
    asyncHandler(async (req, res) => {
        const { batchId, actualSizeBytes, eventCount, frameCount, sdkTelemetry } = req.body;
        const projectId = req.project!.id;
        const normalizedSdkTelemetry = normalizeSdkTelemetry(sdkTelemetry);

        if (!batchId) {
            throw ApiError.badRequest('batchId is required');
        }

        const { sessionId, contentType, batchNumber } = parseBatchId(batchId);
        const log = logger.child({
            route: '/api/ingest/batch/complete',
            projectId,
            sessionId,
            batchId,
            contentType,
            batchNumber,
        });

        const [session] = await db
            .select()
            .from(sessions)
            .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
            .limit(1);

        const sessionOpen = Boolean(session && !isSessionIngestImmutable(session));
        if (normalizedSdkTelemetry && sessionOpen) {
            const sdkUpdates = buildSdkTelemetryMergeSet(normalizedSdkTelemetry);
            if (Object.keys(sdkUpdates).length > 0) {
                await db.update(sessionMetrics)
                    .set(sdkUpdates)
                    .where(eq(sessionMetrics.sessionId, sessionId));
            }
        }

        const completion = await completeArtifactUpload({
            projectId,
            clientUploadId: batchId,
            actualSizeBytes: actualSizeBytes ?? null,
        });

        const deviceId = extractDeviceIdFromUploadToken(req);
        if (sessionOpen && deviceId && session && !session.deviceId) {
            db.update(sessions)
                .set({ deviceId })
                .where(eq(sessions.id, sessionId))
                .catch(() => {});
        }

        const userId = req.body.userId;
        if (
            sessionOpen
            && userId
            && userId !== 'anonymous'
            && typeof userId === 'string'
            && !userId.startsWith('anon_')
        ) {
            db.update(sessions)
                .set({ userDisplayId: userId, updatedAt: new Date() })
                .where(eq(sessions.id, sessionId))
                .catch(() => {});
        }

        updateDeviceUsage(deviceId, projectId, {
            bytesUploaded: actualSizeBytes || 0,
            requestCount: 1,
        }).catch(() => {});

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'done', batchId);
        }

        log.info({
            eventCount,
            frameCount,
            actualSizeBytes,
            deviceId,
            userId,
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry && sessionOpen),
            queued: completion.queued,
            alreadyCompleted: completion.alreadyCompleted,
            ignored: completion.ignored,
        }, 'Batch completed');

        res.json({
            success: true,
            queued: completion.queued,
            alreadyCompleted: completion.alreadyCompleted,
        });
    })
);

router.post(
    '/segment/presign',
    apiKeyAuth,
    requireScope('ingest'),
    ingestSegmentProjectRateLimiter,
    ingestSegmentDeviceRateLimiter,
    asyncHandler(async (req, res) => {
        const data = req.body;
        const projectId = req.project!.id;
        const teamId = req.project!.teamId;

        if (!data.sessionId || !data.kind || data.startTime === undefined || data.sizeBytes === undefined) {
            throw ApiError.badRequest('Missing required fields: sessionId, kind, startTime, sizeBytes');
        }

        const requestedSizeBytes = parseRequestedSizeBytes(data.sizeBytes);
        if (data.kind !== 'screenshots' && data.kind !== 'hierarchy') {
            throw ApiError.badRequest('kind must be "screenshots" or "hierarchy"');
        }

        // Project lookup runs in parallel with the idempotency Redis check below — but
        // we need the project before we can check recordingEnabled, so kick it off early
        // and await it after the idempotency fast-paths.
        const projectPromise = db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            const existing = await getIdempotencyStatus(projectId, idempotencyKey);
            if (existing?.status === 'done') {
                logIngestPresignSkip({
                    route: '/api/ingest/segment/presign',
                    projectId,
                    reason: 'idempotency_already_done',
                    sessionId: data.sessionId,
                    kind: data.kind,
                    deduplicated: true,
                });
                res.json({
                    skipUpload: true,
                    deduplicated: true,
                    sessionId: data.sessionId,
                    reason: 'Already processed',
                });
                return;
            }
            if (existing?.status === 'processing') {
                logger.info(
                    {
                        event: 'ingest.presign_idempotency_processing',
                        route: '/api/ingest/segment/presign',
                        projectId,
                        sessionId: data.sessionId,
                        kind: data.kind,
                        ...getRedisDiagnosticsForLog(),
                    },
                    'ingest.presign_idempotency_processing',
                );
                res.status(202).json({ message: 'Processing', retryAfter: 5 });
                return;
            }
        }

        const segmentDeviceId = extractDeviceIdFromUploadToken(req);

        // Byte-budget check, project resolution, and session lookup are all independent
        // — run them in parallel to collapse three serial round-trips into one wall-clock wait.
        const [, [project], existingSession] = await Promise.all([
            enforceIngestByteBudget({
                projectId,
                deviceId: segmentDeviceId,
                clientIp: getRequestIp(req),
                bytes: requestedSizeBytes,
                endpoint: 'segment/presign',
            }),
            projectPromise,
            findExistingProjectSession(projectId, data.sessionId),
        ]);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        if (!project.rejourneyEnabled) {
            throw ApiError.forbidden('Rejourney is disabled for this project');
        }

        if (!project.recordingEnabled && data.kind === 'screenshots') {
            logIngestPresignSkip({
                route: '/api/ingest/segment/presign',
                projectId,
                reason: 'recording_disabled_for_project',
                sessionId: data.sessionId,
                kind: data.kind,
            });
            res.json({
                skipUpload: true,
                sessionId: data.sessionId,
                reason: 'Recording disabled for project',
            });
            return;
        }

        if (!existingSession) {
            // Billing check and session-limit check are independent — run together.
            const [billingStatus] = await Promise.all([
                checkBillingStatus(teamId),
                checkAndEnforceSessionLimit(teamId),
            ]);
            if (!billingStatus.canRecord) {
                throw ApiError.paymentRequired(billingStatus.reason || 'Recording blocked - billing issue');
            }
        }

        // Pass the already-fetched session so ensureIngestSession skips its own SELECT.
        let { session, created: isNewSession } = await ensureIngestSession(projectId, data.sessionId, req, {
            platform: data.platform,
            deviceModel: data.deviceModel,
            appVersion: data.appVersion,
            deviceId: segmentDeviceId || undefined,
            sdkVersion: typeof data.sdkVersion === 'string' ? data.sdkVersion : undefined,
        }, undefined, existingSession);

        const startTimeInt = Math.floor(Number(data.startTime));
        const endTimeInt = data.endTime ? Math.floor(Number(data.endTime)) : null;
        // Pass the session we already have so maybeBackfillSessionStartedAt skips its SELECT
        // when the timestamp is already correct (the common case).
        const backfilledSession = await maybeBackfillSessionStartedAt(session.id, startTimeInt, session);
        if (backfilledSession) {
            session = backfilledSession;
        }

        assertSessionAcceptsNewIngestWork(session);

        if (isNewSession && project.rejourneyEnabled) {
            incrementProjectSessionCount(projectId, teamId, 1)
                .then(() => {
                    logger.debug({ projectId, teamId, sessionId: session.id }, 'Session counted for billing');
                })
                .catch((err) => {
                    logger.warn({ err, projectId, teamId, sessionId: session.id }, 'Failed to increment project session count');
                });

            updateDeviceUsage(segmentDeviceId || session.deviceId || null, projectId, {
                sessionsStarted: 1,
            }).catch(() => {});
        }

        if (data.kind === 'screenshots' && !session.isSampledIn) {
            logIngestPresignSkip({
                route: '/api/ingest/segment/presign',
                projectId,
                reason: 'session_sampled_out',
                sessionId: data.sessionId,
                kind: data.kind,
            });
            res.json({
                skipUpload: true,
                sessionId: data.sessionId,
                reason: 'Session sampled out - recording disabled for this session',
            });
            return;
        }

        if ((data.kind === 'screenshots' || data.kind === 'hierarchy') && project.maxRecordingMinutes) {
            const maxRecordingMs = project.maxRecordingMinutes * 60 * 1000;
            const sessionStartMs = session.startedAt.getTime();
            const segmentStartMs = Number(data.startTime);
            const segmentEndMs = endTimeInt ?? segmentStartMs;
            const wallGraceMs = 120_000;
            const elapsedStartMs = segmentStartMs - sessionStartMs;
            const elapsedEndMs = segmentEndMs - sessionStartMs;

            if (elapsedStartMs > maxRecordingMs) {
                logIngestPresignSkip({
                    route: '/api/ingest/segment/presign',
                    projectId,
                    reason: 'exceeds_max_recording_duration',
                    sessionId: data.sessionId,
                    kind: data.kind,
                    extra: {
                        segmentStartMs,
                        segmentEndMs,
                        sessionStartMs,
                        elapsedStartMs,
                        maxRecordingMs,
                        maxRecordingMinutes: project.maxRecordingMinutes,
                    },
                });

                res.json({
                    skipUpload: true,
                    sessionId: data.sessionId,
                    reason: `Recording limit exceeded (${project.maxRecordingMinutes} minutes max)`,
                });
                return;
            }

            if (elapsedEndMs > maxRecordingMs + wallGraceMs) {
                logIngestPresignSkip({
                    route: '/api/ingest/segment/presign',
                    projectId,
                    reason: 'exceeds_max_recording_duration_end',
                    sessionId: data.sessionId,
                    kind: data.kind,
                    extra: {
                        segmentStartMs,
                        segmentEndMs,
                        sessionStartMs,
                        elapsedEndMs,
                        maxRecordingMs,
                        wallGraceMs,
                        maxRecordingMinutes: project.maxRecordingMinutes,
                    },
                });

                res.json({
                    skipUpload: true,
                    sessionId: data.sessionId,
                    reason: `Recording limit exceeded (${project.maxRecordingMinutes} minutes max)`,
                });
                return;
            }
        }

        let extension: string;
        let subFolder: string;

        switch (data.kind) {
            case 'screenshots':
                extension = 'tar.gz';
                subFolder = 'screenshots';
                break;
            case 'hierarchy':
                extension = data.compression === 'gzip' ? 'json.gz' : 'json';
                subFolder = 'hierarchy';
                break;
            default:
                extension = 'bin';
                subFolder = 'other';
        }

        const segmentId = buildReplaySegmentId({
            sessionId: session.id,
            kind: data.kind,
            startTime: startTimeInt,
            endTime: endTimeInt,
            frameCount: data.frameCount,
            declaredSizeBytes: requestedSizeBytes,
        });
        const filename = `${startTimeInt}.${extension}`;
        const s3Key = generateS3Key(teamId, projectId, session.id, subFolder, filename);
        const endpoint = await getEndpointForSession(session.id, projectId);

        const preparation = await prepareReplayArtifactForUpload({
            projectId,
            sessionId: session.id,
            kind: data.kind,
            s3ObjectKey: s3Key,
            endpointId: endpoint.id,
            clientUploadId: segmentId,
            declaredSizeBytes: requestedSizeBytes,
            timestamp: startTimeInt,
            startTime: startTimeInt,
            endTime: endTimeInt,
            frameCount: data.frameCount || null,
        });
        if (preparation.action === 'skip') {
            if (idempotencyKey) {
                await setIdempotencyStatus(projectId, idempotencyKey, 'done', segmentId);
            }

            logIngestPresignSkip({
                route: '/api/ingest/segment/presign',
                projectId,
                reason: 'replay_segment_already_processed',
                sessionId: session.id,
                kind: data.kind,
                deduplicated: true,
                extra: { segmentId },
            });

            res.json({
                skipUpload: true,
                deduplicated: true,
                sessionId: session.id,
                segmentId,
                reason: 'Already processed',
            });
            return;
        }

        const artifact = preparation.artifact;
        const presignedUrl = buildArtifactUploadRelayUrl({
            artifactId: artifact.id,
            projectId,
            sessionId: session.id,
            kind: data.kind,
        });

        if (segmentDeviceId) {
            updateDeviceUsage(segmentDeviceId, projectId, { requestCount: 1 }).catch(() => {});
        }

        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'processing');
        }

        const relayCtx = getUploadRelayBuildContext();
        logger.info(
            {
                event: 'ingest.replay_relay_url_issued',
                sessionId: session.id,
                projectId,
                artifactId: artifact.id,
                segmentId,
                kind: data.kind,
                preparationAction: preparation.action,
                isSampledIn: session.isSampledIn,
                recordingEnabled: project.recordingEnabled,
                relayHost: relayCtx.relayHost,
                relayBaseUrl: relayCtx.relayBaseUrl,
                publicBaseSource: relayCtx.publicBaseSource,
                uploadPathTemplate: `/upload/artifacts/${artifact.id}`,
                tokenTtlSeconds: ARTIFACT_UPLOAD_URL_TTL_SECONDS,
                startTime: data.startTime,
                endTime: data.endTime,
                frameCount: data.frameCount,
                sizeBytes: requestedSizeBytes,
                s3KeySuffix: s3Key.length > 80 ? s3Key.slice(-80) : s3Key,
                endpointId: endpoint.id,
            },
            'ingest.replay_relay_url_issued',
        );

        logger.info({
            sessionId: session.id,
            artifactId: artifact.id,
            segmentId,
            kind: data.kind,
            startTime: data.startTime,
            endTime: data.endTime,
            frameCount: data.frameCount,
            sizeBytes: requestedSizeBytes,
            action: preparation.action,
        }, 'Replay segment presigned URL generated');

        res.json({
            presignedUrl,
            segmentId,
            sessionId: session.id,
            s3Key,
            endpointId: endpoint.id,
        });
    })
);

router.post(
    '/segment/complete',
    apiKeyAuth,
    requireScope('ingest'),
    ingestSegmentProjectRateLimiter,
    asyncHandler(async (req, res) => {
        const { segmentId, actualSizeBytes, frameCount, sdkTelemetry } = req.body;
        const projectId = req.project!.id;
        const normalizedSdkTelemetry = normalizeSdkTelemetry(sdkTelemetry);

        if (!segmentId) {
            throw ApiError.badRequest('segmentId is required');
        }

        const { sessionId, kind, startTime } = parseSegmentId(segmentId);
        const log = logger.child({
            route: '/api/ingest/segment/complete',
            projectId,
            sessionId,
            segmentId,
            kind,
            startTime,
        });

        const [segSession] = await db
            .select()
            .from(sessions)
            .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
            .limit(1);
        const segSessionOpen = Boolean(segSession && !isSessionIngestImmutable(segSession));
        if (normalizedSdkTelemetry && segSessionOpen) {
            const sdkUpdates = buildSdkTelemetryMergeSet(normalizedSdkTelemetry);
            if (Object.keys(sdkUpdates).length > 0) {
                await db.update(sessionMetrics)
                    .set(sdkUpdates)
                    .where(eq(sessionMetrics.sessionId, sessionId));
            }
        }

        const completion = await completeArtifactUpload({
            projectId,
            clientUploadId: segmentId,
            actualSizeBytes: actualSizeBytes ?? null,
            frameCount: frameCount ?? null,
        });

        const deviceId = extractDeviceIdFromUploadToken(req);
        updateDeviceUsage(deviceId, projectId, {
            bytesUploaded: actualSizeBytes || 0,
            requestCount: 1,
        }).catch(() => {});

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'done', segmentId);
        }

        log.info({
            actualSizeBytes,
            frameCount,
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry && segSessionOpen),
            queued: completion.queued,
            alreadyCompleted: completion.alreadyCompleted,
            ignored: completion.ignored,
        }, 'Replay segment completed');

        res.json({
            success: true,
            queued: completion.queued,
            alreadyCompleted: completion.alreadyCompleted,
        });
    })
);

export default router;
