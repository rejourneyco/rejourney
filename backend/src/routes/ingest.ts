/**
 * Ingest Routes
 * 
 * SDK session recording upload endpoints
 * 
 * Session Counting (Billing):
 * - Sessions are counted when rejourneyEnabled=true (regardless of recordingEnabled)
 * - Sessions are counted on first chunk upload (/presign endpoint)
 * - Sessions are NOT counted for duplicate session IDs
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db, sessions, sessionMetrics, projects, recordingArtifacts, ingestJobs } from '../db/client.js';

import { logger } from '../logger.js';
import { getIdempotencyStatus, setIdempotencyStatus } from '../db/redis.js';
import { generateS3Key, getSignedUploadUrl } from '../db/s3.js';
import { apiKeyAuth, requireScope, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { ingestProjectRateLimiter, ingestDeviceRateLimiter } from '../middleware/rateLimit.js';
import { endSessionSchema } from '../validation/ingest.js';
import { updateDeviceUsage, ensureIngestSession } from '../services/recording.js';
import { evaluateAndPromoteSession } from '../services/replayPromotion.js';
import { checkAndEnforceSessionLimit, checkBillingStatus, incrementProjectSessionCount } from '../services/quotaCheck.js';

const router = Router();

/**
 * Extract device UUID from upload token header
 * Token format: base64(JSON{deviceId, projectId, iat, exp}).signature
 */
function extractDeviceIdFromToken(req: any): string | null {
    const token = req.headers['x-upload-token'] as string;
    if (!token) return null;

    try {
        const [payloadB64] = token.split('.');
        if (!payloadB64) return null;

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
        return payload.deviceId || null;
    } catch {
        return null;
    }
}

// NOTE: evaluateAndPromoteSession is now imported from ../services/replayPromotion.js

// Helper functions moved to services/recording.ts

/**
 * Get presigned URL for uploading batch data
 * POST /api/ingest/presign
 * 
 * Production SDK flow: SDK requests presigned URL, uploads directly to S3,
 * then calls /batch/complete to finalize. Includes full security checks.
 */
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

        // Validate required fields
        if (!data.contentType || data.batchNumber === undefined || !data.sizeBytes) {
            throw ApiError.badRequest('Missing required fields: contentType, batchNumber, sizeBytes');
        }

        // Check project exists and is enabled
        const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        if (!project.rejourneyEnabled) {
            throw ApiError.forbidden('Rejourney is disabled for this project');
        }

        // If recording is disabled and this is a video upload, tell SDK to skip
        // Note: Video segments use /segment/presign endpoint which has similar check
        if (!project.recordingEnabled && data.contentType === 'video') {
            res.json({
                skipUpload: true,
                sessionId: data.sessionId || null,
                reason: 'Recording disabled for project'
            });
            return;
        }

        // =====================================================
        // BILLING CHECK - Same as /session/start
        // =====================================================
        const billingStatus = await checkBillingStatus(teamId);
        if (!billingStatus.canRecord) {
            throw ApiError.paymentRequired(billingStatus.reason || 'Recording blocked - billing issue');
        }

        // =====================================================
        // SESSION LIMIT CHECK - Uses distributed locking to prevent race conditions
        // =====================================================
        await checkAndEnforceSessionLimit(teamId);

        // =====================================================
        // IDEMPOTENCY CHECK (optional header for retry safety)
        // =====================================================
        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            const existing = await getIdempotencyStatus(projectId, idempotencyKey);
            if (existing?.status === 'done') {
                // Return cached response - SDK can skip this upload
                res.json({
                    skipUpload: true,
                    deduplicated: true,
                    sessionId: data.sessionId || null,
                    reason: 'Already processed'
                });
                return;
            }
            if (existing?.status === 'processing') {
                res.status(202).json({ message: 'Processing', retryAfter: 5 });
                return;
            }
        }

        // =====================================================
        // SESSION HANDLING
        // =====================================================
        let sessionId = data.sessionId;
        if (!sessionId || sessionId === '') {
            // Generate a session ID server-side with 128 bits of entropy
            // SECURITY: Using 16 bytes (128 bits) makes session IDs practically impossible to guess
            sessionId = `session_${randomBytes(16).toString('hex')}`;
        }

        // CRITICAL: Extract deviceId BEFORE session creation so it's set on new sessions
        // This ensures fresh sessions get the funny anonymous name instead of "anon_xxx"
        const deviceAuthId = extractDeviceIdFromToken(req);

        // Pass any available metadata from the presign request for richer session creation
        const { session, created: isNewSession } = await ensureIngestSession(projectId, sessionId, req, {
            userId: data.userId,
            platform: data.platform,
            deviceModel: data.deviceModel,
            appVersion: data.appVersion,
            osVersion: data.osVersion,
            networkType: data.networkType,
            deviceId: deviceAuthId || undefined,
        });

        // Session state validation
        if (session.status === 'failed' || session.status === 'deleted') {
            throw ApiError.badRequest('Session is no longer accepting data');
        }

        // =====================================================
        // SESSION COUNTING - Count on first chunk upload
        // Sessions are counted when rejourneyEnabled=true (regardless of recordingEnabled)
        // Only count new sessions (not duplicate uploads for the same session)
        // =====================================================
        if (isNewSession && project.rejourneyEnabled) {
            // Increment session count for this project/team
            await incrementProjectSessionCount(projectId, teamId, 1);
            logger.debug({ projectId, teamId, sessionId: session.id }, 'Session counted for billing');
        }

        // =====================================================
        // DEVICE AUTH TRACKING
        // =====================================================
        // deviceAuthId already extracted above for session creation
        if (deviceAuthId) {
            // Track upload attempt for device analytics
            updateDeviceUsage(deviceAuthId, { requestCount: 1 }).catch(() => { });
        }

        // =====================================================
        // GENERATE PRESIGNED URL
        // =====================================================
        const contentTypeMap: Record<string, string> = {
            events: 'events',
            crashes: 'crashes',
            anrs: 'anrs',
        };
        const kind = contentTypeMap[data.contentType] || 'events';

        // Generate batch ID for tracking (includes all info needed to parse later)
        const batchId = `batch_${session.id}_${data.contentType}_${data.batchNumber}_${randomBytes(4).toString('hex')}`;

        // Generate S3 key
        const filename = `${data.contentType}_${data.batchNumber}_${Date.now()}.json.gz`;
        const s3Key = generateS3Key(teamId, projectId, session.id, kind, filename);

        // Get presigned upload URL (1 hour expiry)
        const presignResult = await getSignedUploadUrl(projectId, s3Key, 'application/gzip', 3600);

        if (!presignResult) {
            throw ApiError.internal('Failed to generate presigned URL');
        }

        // Store pending batch info in database for /batch/complete to finalize
        await db.insert(recordingArtifacts).values({
            sessionId: session.id,
            kind,
            s3ObjectKey: s3Key,
            sizeBytes: data.sizeBytes,
            status: 'pending', // Will be marked 'ready' when /batch/complete is called
            timestamp: Date.now(),
        });

        logger.info({
            sessionId: session.id,
            batchId,
            contentType: data.contentType,
            batchNumber: data.batchNumber,
            sizeBytes: data.sizeBytes,
            isKeyframe: data.isKeyframe,
            deviceId: deviceAuthId,
        }, 'Presigned URL generated');

        // Mark idempotency key as processing (will be marked 'done' when /batch/complete is called)
        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'processing');
        }

        res.json({
            presignedUrl: presignResult.url,
            batchId,
            sessionId: session.id,
            s3Key,
            endpointId: presignResult.endpointId,
        });
    })
);

/**
 * Complete batch upload (called after SDK uploads to S3)
 * POST /api/ingest/batch/complete
 */
router.post(
    '/batch/complete',
    apiKeyAuth,
    requireScope('ingest'),
    ingestProjectRateLimiter,
    asyncHandler(async (req, res) => {
        const { batchId, actualSizeBytes, eventCount, frameCount } = req.body;
        const projectId = req.project!.id;

        if (!batchId) {
            throw ApiError.badRequest('batchId is required');
        }

        // Parse session ID from batchId (format: batch_{sessionId}_{contentType}_{batchNumber}_{random})
        const parts = batchId.split('_');
        if (parts.length < 4) {
            throw ApiError.badRequest('Invalid batchId format');
        }

        // Extract session ID (parts 1 and 2, since session_timestamp_hex format)
        const sessionId = `${parts[1]}_${parts[2]}_${parts[3]}`;

        // Verify session belongs to project
        const [session] = await db
            .select()
            .from(sessions)
            .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
            .limit(1);

        if (!session) {
            throw ApiError.notFound('Session not found');
        }

        // Update session metrics if counts provided
        if (eventCount > 0) {
            await db.update(sessionMetrics)
                .set({
                    totalEvents: sql`${sessionMetrics.totalEvents} + ${eventCount}`,
                })
                .where(eq(sessionMetrics.sessionId, sessionId));
        }

        // Mark artifacts as ready (find by batch ID pattern in s3ObjectKey)
        // Since we store the batchNumber in the filename, we can match on it
        const contentType = parts[4]; // events, crashes, anrs
        const batchNumber = parts[5];

        if (contentType && batchNumber) {
            const keyPattern = `${contentType}_${batchNumber}_`;

            // Find the artifact to update and create an ingest job for
            const [artifact] = await db.select()
                .from(recordingArtifacts)
                .where(and(
                    eq(recordingArtifacts.sessionId, sessionId),
                    sql`${recordingArtifacts.s3ObjectKey} LIKE ${`%${keyPattern}%`}`
                ))
                .limit(1);

            if (artifact) {
                // Mark artifact as ready
                await db.update(recordingArtifacts)
                    .set({
                        status: 'ready',
                        readyAt: new Date(),
                        sizeBytes: actualSizeBytes || 0,
                    })
                    .where(eq(recordingArtifacts.id, artifact.id));

                // CRITICAL: Create ingest job so worker processes the artifact
                // This extracts device info, metrics, and other session data from the payload
                await db.insert(ingestJobs).values({
                    projectId,
                    sessionId,
                    artifactId: artifact.id,
                    kind: contentType,
                    payloadRef: artifact.s3ObjectKey,
                    status: 'pending',
                });

                logger.debug({ artifactId: artifact.id, kind: contentType }, 'Ingest job created for artifact');
            }
        }

        // =====================================================
        // CRITICAL: Update session identity (restored from old logic)
        // =====================================================

        // Update session deviceId if it's missing but we have one from the token
        const deviceId = extractDeviceIdFromToken(req);
        if (deviceId && !session.deviceId) {
            db.update(sessions)
                .set({ deviceId })
                .where(eq(sessions.id, sessionId))
                .catch(() => { }); // Fire-and-forget
        }

        // Synchronously update userDisplayId if userId is provided in the request.
        // This is MORE RELIABLE than relying on the async worker to process
        // user_identity_changed events, which may not complete before session list is queried.
        const userId = req.body.userId;
        if (userId && userId !== 'anonymous' && typeof userId === 'string' && !userId.startsWith('anon_')) {
            db.update(sessions)
                .set({ userDisplayId: userId, updatedAt: new Date() })
                .where(eq(sessions.id, sessionId))
                .catch(() => { }); // Fire-and-forget but still reliable
        }

        // Device usage tracking (non-blocking, atomic upsert)
        updateDeviceUsage(deviceId, {
            bytesUploaded: actualSizeBytes || 0,
            requestCount: 1,
        }).catch(() => { }); // Fire-and-forget for performance

        // Mark idempotency key as done after successful processing
        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'done', batchId);
        }

        logger.debug({ sessionId, batchId, eventCount, frameCount, actualSizeBytes, deviceId, userId }, 'Batch completed');

        res.json({ success: true });
    })
);

// NOTE: /api/ingest/batch endpoint removed - using presign flow instead
// The presign flow (presign -> S3 upload -> batch/complete) is the production path
// used by iOS and Android SDKs for better scalability and offline support.

// =============================================================================
// VIDEO SEGMENT ENDPOINTS
// =============================================================================

/**
 * Get presigned URL for uploading video segment or hierarchy snapshot
 * POST /api/ingest/segment/presign
 * 
 * Supports two artifact types:
 * - video: H.264 encoded video segment (.mp4)
 * - hierarchy: View hierarchy snapshot (.json.gz)
 */
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

        // Validate required fields
        if (!data.sessionId || !data.kind || data.startTime === undefined || data.sizeBytes === undefined) {
            throw ApiError.badRequest('Missing required fields: sessionId, kind, startTime, sizeBytes');
        }

        // Validate kind is video or hierarchy
        if (data.kind !== 'video' && data.kind !== 'hierarchy') {
            throw ApiError.badRequest('kind must be "video" or "hierarchy"');
        }

        // Check project exists and is enabled
        const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        if (!project.rejourneyEnabled) {
            throw ApiError.forbidden('Rejourney is disabled for this project');
        }

        // Video recording requires recordingEnabled
        if (!project.recordingEnabled && data.kind === 'video') {
            res.json({
                skipUpload: true,
                sessionId: data.sessionId,
                reason: 'Recording disabled for project'
            });
            return;
        }

        // Billing and quota checks
        const billingStatus = await checkBillingStatus(teamId);
        if (!billingStatus.canRecord) {
            throw ApiError.paymentRequired(billingStatus.reason || 'Recording blocked - billing issue');
        }

        await checkAndEnforceSessionLimit(teamId);

        // Idempotency check
        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            const existing = await getIdempotencyStatus(projectId, idempotencyKey);
            if (existing?.status === 'done') {
                res.json({
                    skipUpload: true,
                    deduplicated: true,
                    sessionId: data.sessionId,
                    reason: 'Already processed'
                });
                return;
            }
            if (existing?.status === 'processing') {
                res.status(202).json({ message: 'Processing', retryAfter: 5 });
                return;
            }
        }

        // Extract deviceId for session creation
        const segmentDeviceId = extractDeviceIdFromToken(req);

        // Ensure session exists
        const { session } = await ensureIngestSession(projectId, data.sessionId, req, {
            platform: data.platform,
            deviceModel: data.deviceModel,
            appVersion: data.appVersion,
            deviceId: segmentDeviceId || undefined,
        });

        if (session.status === 'failed' || session.status === 'deleted') {
            throw ApiError.badRequest('Session is no longer accepting data');
        }

        // Generate S3 key based on artifact type
        // Pattern: sessions/{sessionId}/segments/{timestamp}.mp4 or hierarchy/{timestamp}.json
        let extension = data.kind === 'video' ? 'mp4' : 'json';
        let contentType = data.kind === 'video' ? 'video/mp4' : 'application/json';

        // Handle GZip compression for hierarchy
        if (data.kind === 'hierarchy' && data.compression === 'gzip') {
            extension = 'json.gz';
            contentType = 'application/gzip';
        }

        const subFolder = data.kind === 'video' ? 'segments' : 'hierarchy';
        const timestampInt = Math.floor(Number(data.startTime));
        const filename = `${timestampInt}.${extension}`;
        const s3Key = `sessions/${session.id}/${subFolder}/${filename}`;

        // Get presigned upload URL (1 hour expiry)
        const presignResult = await getSignedUploadUrl(projectId, s3Key, contentType, 3600);

        if (!presignResult) {
            throw ApiError.internal('Failed to generate presigned URL');
        }

        // Generate segment ID for tracking
        const segmentId = `seg_${session.id}_${data.kind}_${data.startTime}_${randomBytes(4).toString('hex')}`;

        // Convert float timestamps to integers (bigint columns don't accept decimals)
        const startTimeInt = Math.floor(Number(data.startTime));
        const endTimeInt = data.endTime ? Math.floor(Number(data.endTime)) : null;

        // Store pending artifact in database
        await db.insert(recordingArtifacts).values({
            sessionId: session.id,
            kind: data.kind,
            s3ObjectKey: s3Key,
            sizeBytes: data.sizeBytes,
            status: 'pending',
            timestamp: startTimeInt,
            startTime: startTimeInt,
            endTime: endTimeInt,
            frameCount: data.frameCount || null,
        });

        // Track device usage
        const deviceAuthId = extractDeviceIdFromToken(req);
        if (deviceAuthId) {
            updateDeviceUsage(deviceAuthId, { requestCount: 1 }).catch(() => { });
        }

        // Mark idempotency as processing
        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'processing');
        }

        logger.info({
            sessionId: session.id,
            segmentId,
            kind: data.kind,
            startTime: data.startTime,
            endTime: data.endTime,
            frameCount: data.frameCount,
            sizeBytes: data.sizeBytes,
        }, 'Video segment presigned URL generated');

        res.json({
            presignedUrl: presignResult.url,
            segmentId,
            sessionId: session.id,
            s3Key,
            endpointId: presignResult.endpointId,
        });
    })
);

/**
 * Complete video segment upload
 * POST /api/ingest/segment/complete
 */
router.post(
    '/segment/complete',
    apiKeyAuth,
    requireScope('ingest'),
    ingestProjectRateLimiter,
    asyncHandler(async (req, res) => {
        const { segmentId, actualSizeBytes, frameCount } = req.body;
        const projectId = req.project!.id;

        if (!segmentId) {
            throw ApiError.badRequest('segmentId is required');
        }

        // Parse segment ID: seg_{sessionId}_{kind}_{startTime}_{random}
        // Session ID format: session_<timestamp>_<hex> (e.g., session_1767894620887_191A071A)
        // Example segmentId: seg_session_1767894620887_191A071A_video_1767894621000_abcd1234
        const parts = segmentId.split('_');
        if (parts.length < 7) {
            throw ApiError.badRequest('Invalid segmentId format');
        }

        // Extract session ID (parts[1] + parts[2] + parts[3] = session_timestamp_hex)
        const sessionId = `${parts[1]}_${parts[2]}_${parts[3]}`;
        const kind = parts[4]; // video or hierarchy
        const startTime = parseInt(parts[5], 10);

        // Verify session belongs to project
        const [session] = await db
            .select()
            .from(sessions)
            .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
            .limit(1);

        if (!session) {
            throw ApiError.notFound('Session not found');
        }

        // Find and update the artifact
        const [artifact] = await db.select()
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, kind),
                eq(recordingArtifacts.startTime, startTime),
                eq(recordingArtifacts.status, 'pending')
            ))
            .limit(1);

        if (!artifact) {
            throw ApiError.notFound('Artifact not found or already completed');
        }

        // Mark artifact as ready
        await db.update(recordingArtifacts)
            .set({
                status: 'ready',
                readyAt: new Date(),
                sizeBytes: actualSizeBytes || artifact.sizeBytes,
                frameCount: frameCount || artifact.frameCount,
            })
            .where(eq(recordingArtifacts.id, artifact.id));

        // Update session metrics for video segments
        if (kind === 'video') {
            await db.update(sessions)
                .set({
                    segmentCount: sql`COALESCE(${sessions.segmentCount}, 0) + 1`,
                    videoStorageBytes: sql`COALESCE(${sessions.videoStorageBytes}, 0) + ${actualSizeBytes || artifact.sizeBytes || 0}`,
                })
                .where(eq(sessions.id, sessionId));

            await db.update(sessionMetrics)
                .set({
                    videoSegmentCount: sql`COALESCE(${sessionMetrics.videoSegmentCount}, 0) + 1`,
                    videoTotalBytes: sql`COALESCE(${sessionMetrics.videoTotalBytes}, 0) + ${actualSizeBytes || artifact.sizeBytes || 0}`,
                })
                .where(eq(sessionMetrics.sessionId, sessionId));


            // Extend session's endedAt if this segment ends later than current endedAt
            // This handles cases where video segments are uploaded after session/end is called
            const segmentEndTime = artifact.endTime;
            if (segmentEndTime && session.endedAt) {
                const segmentEndDate = new Date(segmentEndTime);
                if (segmentEndDate > session.endedAt) {
                    const newDuration = Math.round((segmentEndDate.getTime() - session.startedAt.getTime()) / 1000);
                    await db.update(sessions)
                        .set({
                            endedAt: segmentEndDate,
                            durationSeconds: newDuration > 0 ? newDuration : session.durationSeconds,
                        })
                        .where(eq(sessions.id, sessionId));

                    logger.debug({
                        sessionId,
                        oldEndedAt: session.endedAt.getTime(),
                        newEndedAt: segmentEndTime,
                        newDuration,
                    }, 'Extended session endedAt based on video segment');
                }
            }
        } else if (kind === 'hierarchy') {
            await db.update(sessionMetrics)
                .set({
                    hierarchySnapshotCount: sql`COALESCE(${sessionMetrics.hierarchySnapshotCount}, 0) + 1`,
                })
                .where(eq(sessionMetrics.sessionId, sessionId));
        }

        // Device usage tracking
        const deviceId = extractDeviceIdFromToken(req);
        updateDeviceUsage(deviceId, {
            bytesUploaded: actualSizeBytes || artifact.sizeBytes || 0,
            requestCount: 1,
        }).catch(() => { });

        // Mark idempotency as done
        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (idempotencyKey) {
            await setIdempotencyStatus(projectId, idempotencyKey, 'done', segmentId);
        }

        // Note: Promotion evaluation happens in /session/end via evaluateAndPromoteSession()
        // This ensures all ingest jobs are processed before evaluation

        logger.debug({
            sessionId,
            segmentId,
            kind,
            startTime,
            actualSizeBytes,
            frameCount,
        }, 'Video segment completed');

        res.json({ success: true });
    })
);

/**
 * End session
 * POST /api/ingest/session/end
 */
router.post(
    '/session/end',
    apiKeyAuth,
    requireScope('ingest'),
    ingestProjectRateLimiter,
    validate(endSessionSchema),
    asyncHandler(async (req, res) => {
        const data = req.body;
        const projectId = req.project!.id;

        const [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(eq(sessions.id, data.sessionId))
            .limit(1);

        if (!sessionResult || sessionResult.session.projectId !== projectId) {
            throw ApiError.notFound('Session not found');
        }

        const session = sessionResult.session;
        const metrics = sessionResult.metrics;

        // Idempotency / safety: if the session was already finalized (e.g. auto-finalized after app kill),
        // do not overwrite endedAt/duration or double-bill.
        if (session.endedAt) {
            res.json({
                success: true,
                alreadyEnded: true,
                endedAt: session.endedAt.getTime(),
                durationSeconds: session.durationSeconds ?? null,
            });
            return;
        }

        const endedAt = data.endedAt ? new Date(data.endedAt) : new Date();
        const wallClockSeconds = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000);

        // Parse background time from SDK (comes as milliseconds, convert to seconds)
        const backgroundTimeMs = data.totalBackgroundTimeMs || 0;
        const backgroundTimeSeconds = Math.round(backgroundTimeMs / 1000);

        // duration_seconds is the PLAYABLE duration (wall clock minus background time)
        // This is the source of truth for how long the user actually interacted with the app
        let durationSeconds = Math.max(0, wallClockSeconds - backgroundTimeSeconds);

        // Sanity check: If duration is 0 or negative but we have data, defaulting to at least 1 second
        // so it shows up in dashboard correctly. This can happen with very short test sessions.
        if (durationSeconds <= 0) {
            durationSeconds = 1;
        }

        logger.info({
            sessionId: session.id,
            wallClockSeconds,
            backgroundTimeSeconds,
            durationSeconds,
        }, 'Session duration breakdown (durationSeconds = playable time)');

        await db.update(sessions)
            .set({
                endedAt,
                durationSeconds,
                backgroundTimeSeconds,
                status: 'ready',
            })
            .where(eq(sessions.id, session.id));

        if (data.metrics && metrics) {
            await db.update(sessionMetrics)
                .set({
                    touchCount: data.metrics.touchCount ?? metrics.touchCount,
                    scrollCount: data.metrics.scrollCount ?? metrics.scrollCount,
                    gestureCount: data.metrics.gestureCount ?? metrics.gestureCount,
                    inputCount: data.metrics.inputCount ?? metrics.inputCount,
                    errorCount: data.metrics.errorCount ?? metrics.errorCount,
                    rageTapCount: data.metrics.rageTapCount ?? metrics.rageTapCount,
                    apiSuccessCount: data.metrics.apiSuccessCount ?? metrics.apiSuccessCount,
                    apiErrorCount: data.metrics.apiErrorCount ?? metrics.apiErrorCount,
                    apiTotalCount: data.metrics.apiTotalCount ?? metrics.apiTotalCount,
                    screensVisited: data.metrics.screensVisited ?? metrics.screensVisited,
                    interactionScore: data.metrics.interactionScore ?? metrics.interactionScore,
                    explorationScore: data.metrics.explorationScore ?? metrics.explorationScore,
                    uxScore: data.metrics.uxScore ?? metrics.uxScore,
                })
                .where(eq(sessionMetrics.sessionId, session.id));
        }

        // Save SDK telemetry if provided
        if (data.sdkTelemetry) {
            await db.update(sessionMetrics)
                .set({
                    sdkUploadSuccessCount: data.sdkTelemetry.uploadSuccessCount ?? 0,
                    sdkUploadFailureCount: data.sdkTelemetry.uploadFailureCount ?? 0,
                    sdkRetryAttemptCount: data.sdkTelemetry.retryAttemptCount ?? 0,
                    sdkCircuitBreakerOpenCount: data.sdkTelemetry.circuitBreakerOpenCount ?? 0,
                    sdkMemoryEvictionCount: data.sdkTelemetry.memoryEvictionCount ?? 0,
                    sdkOfflinePersistCount: data.sdkTelemetry.offlinePersistCount ?? 0,
                    sdkUploadSuccessRate: data.sdkTelemetry.uploadSuccessRate ?? null,
                    sdkAvgUploadDurationMs: data.sdkTelemetry.avgUploadDurationMs ?? null,
                    sdkTotalBytesUploaded: data.sdkTelemetry.totalBytesUploaded ? BigInt(data.sdkTelemetry.totalBytesUploaded) : null,
                    sdkTotalBytesEvicted: data.sdkTelemetry.totalBytesEvicted ? BigInt(data.sdkTelemetry.totalBytesEvicted) : null,
                })
                .where(eq(sessionMetrics.sessionId, session.id));

            logger.debug({
                sessionId: session.id,
                uploadSuccessRate: data.sdkTelemetry.uploadSuccessRate,
                retryAttempts: data.sdkTelemetry.retryAttemptCount,
                circuitBreakerOpens: data.sdkTelemetry.circuitBreakerOpenCount,
            }, 'SDK telemetry saved');
        }

        // NOTE: Session counting has moved to first chunk upload (/presign endpoint)
        // No billing increment needed at session end - sessions are counted when they start uploading

        // Track session duration for analytics (not billing)
        const deviceAuthId = extractDeviceIdFromToken(req);
        updateDeviceUsage(deviceAuthId, { requestCount: 1 }).catch(() => { });

        // Evaluate session for promotion - this is THE single place where promotion is decided
        // Uses the unified function that waits for ingest jobs and evaluates with complete metrics
        if (!session.replayPromoted) {
            await evaluateAndPromoteSession(session.id, projectId, durationSeconds);
        }

        logger.info({ sessionId: session.id, durationSeconds, backgroundTimeSeconds }, 'Session ended');

        res.json({ success: true, durationSeconds, backgroundTimeSeconds });
    })
);

/**
 * Evaluate session for replay promotion
 * POST /api/ingest/replay/evaluate
 * 
 * Called by SDK to check/trigger promotion evaluation.
 * Uses the unified evaluateAndPromoteSession function which waits for
 * ingest jobs to complete before evaluating with complete metrics.
 */
router.post(
    '/replay/evaluate',
    apiKeyAuth,
    requireScope('ingest'),
    asyncHandler(async (req, res) => {
        const { sessionId } = req.body;
        const projectId = req.project!.id;

        if (!sessionId) {
            throw ApiError.badRequest('sessionId is required');
        }

        // Verify session belongs to project
        const [session] = await db
            .select()
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session || session.projectId !== projectId) {
            throw ApiError.notFound('Session not found');
        }

        // Use the unified evaluation function
        // This waits for ingest jobs, fetches complete metrics, and evaluates
        const result = await evaluateAndPromoteSession(
            sessionId,
            projectId,
            session.durationSeconds ?? 0
        );

        res.json({
            promoted: result.promoted,
            reason: result.reason,
            score: result.score,
        });
    })
);

export default router;
