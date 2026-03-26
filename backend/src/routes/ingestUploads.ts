import { Router } from 'express';
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, projects, sessionMetrics, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import { getIdempotencyStatus, setIdempotencyStatus } from '../db/redis.js';
import { generateS3Key, getEndpointForProject } from '../db/s3.js';
import { apiKeyAuth, requireScope, asyncHandler, ApiError } from '../middleware/index.js';
import { ingestDeviceRateLimiter, ingestProjectRateLimiter } from '../middleware/rateLimit.js';
import { updateDeviceUsage } from '../services/recording.js';
import { ensureIngestSession } from '../services/ingestSessionLifecycle.js';
import { checkAndEnforceSessionLimit, checkBillingStatus, incrementProjectSessionCount } from '../services/quotaCheck.js';
import { enforceIngestByteBudget } from '../services/ingestByteBudget.js';
import { completeArtifactUpload, registerPendingArtifact } from '../services/ingestArtifactLifecycle.js';
import { buildArtifactUploadRelayUrl } from '../services/ingestUploadRelay.js';
import {
    extractDeviceIdFromUploadToken,
    parseBatchId,
    parseRequestedSizeBytes,
    parseSegmentId,
} from '../services/ingestProtocol.js';
import { buildSdkTelemetryMergeSet, normalizeSdkTelemetry } from '../services/ingestSdkTelemetry.js';
import { getRequestIp } from '../utils/requestIp.js';

const router = Router();

router.post(
    '/presign',
    apiKeyAuth,
    requireScope('ingest'),
    ingestProjectRateLimiter,
    ingestDeviceRateLimiter,
    asyncHandler(async (req, res) => {
        const data = req.body;
        const projectId = req.project!.id;
        const teamId = req.project!.teamId;

        if (!data.contentType || data.batchNumber === undefined || data.sizeBytes === undefined) {
            throw ApiError.badRequest('Missing required fields: contentType, batchNumber, sizeBytes');
        }

        const requestedSizeBytes = parseRequestedSizeBytes(data.sizeBytes);
        const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        if (!project.rejourneyEnabled) {
            throw ApiError.forbidden('Rejourney is disabled for this project');
        }

        const billingStatus = await checkBillingStatus(teamId);
        if (!billingStatus.canRecord) {
            throw ApiError.paymentRequired(billingStatus.reason || 'Recording blocked - billing issue');
        }

        await checkAndEnforceSessionLimit(teamId);

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            const existing = await getIdempotencyStatus(projectId, idempotencyKey);
            if (existing?.status === 'done') {
                res.json({
                    skipUpload: true,
                    deduplicated: true,
                    sessionId: data.sessionId || null,
                    reason: 'Already processed',
                });
                return;
            }
            if (existing?.status === 'processing') {
                res.status(202).json({ message: 'Processing', retryAfter: 5 });
                return;
            }
        }

        const deviceAuthId = extractDeviceIdFromUploadToken(req);
        await enforceIngestByteBudget({
            projectId,
            deviceId: deviceAuthId,
            clientIp: getRequestIp(req),
            bytes: requestedSizeBytes,
            endpoint: 'presign',
        });

        let sessionId = data.sessionId;
        if (!sessionId || sessionId === '') {
            sessionId = `session_${Date.now()}_${randomBytes(16).toString('hex')}`;
        }

        const { session, created: isNewSession } = await ensureIngestSession(projectId, sessionId, req, {
            userId: data.userId,
            platform: data.platform,
            deviceModel: data.deviceModel,
            appVersion: data.appVersion,
            osVersion: data.osVersion,
            networkType: data.networkType,
            deviceId: deviceAuthId || undefined,
            isSampledIn: data.isSampledIn ?? true,
        });

        if (session.status === 'failed' || session.status === 'deleted') {
            throw ApiError.badRequest('Session is no longer accepting data');
        }

        if (isNewSession && project.rejourneyEnabled) {
            await incrementProjectSessionCount(projectId, teamId, 1);
            logger.debug({ projectId, teamId, sessionId: session.id }, 'Session counted for billing');

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
        const endpoint = await getEndpointForProject(projectId);

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
    ingestProjectRateLimiter,
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

        if (normalizedSdkTelemetry) {
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
        if (deviceId && session && !session.deviceId) {
            db.update(sessions)
                .set({ deviceId })
                .where(eq(sessions.id, sessionId))
                .catch(() => {});
        }

        const userId = req.body.userId;
        if (userId && userId !== 'anonymous' && typeof userId === 'string' && !userId.startsWith('anon_')) {
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
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry),
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
    ingestProjectRateLimiter,
    ingestDeviceRateLimiter,
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

        const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        if (!project.rejourneyEnabled) {
            throw ApiError.forbidden('Rejourney is disabled for this project');
        }

        if (!project.recordingEnabled && data.kind === 'screenshots') {
            res.json({
                skipUpload: true,
                sessionId: data.sessionId,
                reason: 'Recording disabled for project',
            });
            return;
        }

        const billingStatus = await checkBillingStatus(teamId);
        if (!billingStatus.canRecord) {
            throw ApiError.paymentRequired(billingStatus.reason || 'Recording blocked - billing issue');
        }

        await checkAndEnforceSessionLimit(teamId);

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            const existing = await getIdempotencyStatus(projectId, idempotencyKey);
            if (existing?.status === 'done') {
                res.json({
                    skipUpload: true,
                    deduplicated: true,
                    sessionId: data.sessionId,
                    reason: 'Already processed',
                });
                return;
            }
            if (existing?.status === 'processing') {
                res.status(202).json({ message: 'Processing', retryAfter: 5 });
                return;
            }
        }

        const segmentDeviceId = extractDeviceIdFromUploadToken(req);
        await enforceIngestByteBudget({
            projectId,
            deviceId: segmentDeviceId,
            clientIp: getRequestIp(req),
            bytes: requestedSizeBytes,
            endpoint: 'segment/presign',
        });

        const { session, created: isNewSession } = await ensureIngestSession(projectId, data.sessionId, req, {
            platform: data.platform,
            deviceModel: data.deviceModel,
            appVersion: data.appVersion,
            deviceId: segmentDeviceId || undefined,
        });

        if (session.status === 'failed' || session.status === 'deleted') {
            throw ApiError.badRequest('Session is no longer accepting data');
        }

        if (isNewSession && project.rejourneyEnabled) {
            await incrementProjectSessionCount(projectId, teamId, 1);
            logger.debug({ projectId, teamId, sessionId: session.id }, 'Session counted for billing');

            updateDeviceUsage(segmentDeviceId || session.deviceId || null, projectId, {
                sessionsStarted: 1,
            }).catch(() => {});
        }

        if (data.kind === 'screenshots' && !session.isSampledIn) {
            res.json({
                skipUpload: true,
                sessionId: data.sessionId,
                reason: 'Session sampled out - recording disabled for this session',
            });
            return;
        }

        if (data.kind === 'screenshots' && project.maxRecordingMinutes) {
            const maxRecordingMs = project.maxRecordingMinutes * 60 * 1000;
            const sessionStartMs = session.startedAt.getTime();
            const segmentStartMs = Number(data.startTime);
            const elapsedMs = segmentStartMs - sessionStartMs;

            if (elapsedMs > maxRecordingMs) {
                logger.info({
                    sessionId: data.sessionId,
                    segmentStartMs,
                    sessionStartMs,
                    elapsedMs,
                    maxRecordingMs,
                    maxRecordingMinutes: project.maxRecordingMinutes,
                }, 'Segment rejected - exceeds max recording duration');

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

        const timestampInt = Math.floor(Number(data.startTime));
        const filename = `${timestampInt}.${extension}`;
        const s3Key = generateS3Key(teamId, projectId, session.id, subFolder, filename);
        const endpoint = await getEndpointForProject(projectId);

        const segmentId = `seg_${session.id}_${data.kind}_${data.startTime}_${randomBytes(4).toString('hex')}`;
        const startTimeInt = Math.floor(Number(data.startTime));
        const endTimeInt = data.endTime ? Math.floor(Number(data.endTime)) : null;

        const artifact = await registerPendingArtifact({
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

        logger.info({
            sessionId: session.id,
            artifactId: artifact.id,
            segmentId,
            kind: data.kind,
            startTime: data.startTime,
            endTime: data.endTime,
            frameCount: data.frameCount,
            sizeBytes: requestedSizeBytes,
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
    ingestProjectRateLimiter,
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

        if (normalizedSdkTelemetry) {
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
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry),
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
