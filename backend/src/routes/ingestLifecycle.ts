import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, sessionMetrics } from '../db/client.js';
import { logger } from '../logger.js';
import { apiKeyAuth, requireScope, asyncHandler, ApiError } from '../middleware/index.js';
import { ingestProjectRateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validation.js';
import { endSessionSchema } from '../validation/ingest.js';
import { resolveLifecycleSession } from '../services/ingestSessionLifecycle.js';
import { extractDeviceIdFromUploadToken } from '../services/ingestProtocol.js';
import { buildSdkTelemetryMergeSet, normalizeSdkTelemetry } from '../services/ingestSdkTelemetry.js';
import {
    buildSessionEndMetricsMergeSet,
    calculateSessionDurationBreakdown,
    normalizeLifecycleVersion,
    normalizeSessionEndReason,
    summarizeSessionEndMetrics,
} from '../services/ingestSessionEnd.js';
import { markSessionIngestActivity, reconcileSessionState } from '../services/sessionReconciliation.js';

const router = Router();

router.post(
    '/session/end',
    apiKeyAuth,
    requireScope('ingest'),
    ingestProjectRateLimiter,
    validate(endSessionSchema),
    asyncHandler(async (req, res) => {
        const data = req.body;
        const projectId = req.project!.id;
        const lifecycle = await resolveLifecycleSession(projectId, data.sessionId, req, {
            deviceId: extractDeviceIdFromUploadToken(req) || undefined,
        });
        const log = logger.child({
            route: '/api/ingest/session/end',
            projectId,
            sessionId: data.sessionId,
            resolution: lifecycle.resolution,
        });

        if (lifecycle.resolution === 'materialized') {
            log.info('Materialized recent missing session during /session/end');
        }

        if (!lifecycle.session) {
            log.info('Ignoring stale unknown session during /session/end');
            res.json({ success: true, ignored: true, reason: 'session_not_found' });
            return;
        }

        const session = lifecycle.session;
        const normalizedSdkTelemetry = normalizeSdkTelemetry(data.sdkTelemetry);
        const lifecycleVersion = normalizeLifecycleVersion(data.lifecycleVersion);
        const endReason = normalizeSessionEndReason(data.endReason);
        const metricsUpdates = buildSessionEndMetricsMergeSet(data.metrics);
        const metricsSummary = summarizeSessionEndMetrics(data.metrics);

        if (data.metrics || normalizedSdkTelemetry) {
            await db.insert(sessionMetrics)
                .values({ sessionId: session.id })
                .onConflictDoNothing();
        }

        if (Object.keys(metricsUpdates).length > 0) {
            await db.update(sessionMetrics)
                .set(metricsUpdates)
                .where(eq(sessionMetrics.sessionId, session.id));
        }

        if (normalizedSdkTelemetry) {
            const sdkUpdates = buildSdkTelemetryMergeSet(normalizedSdkTelemetry);
            if (Object.keys(sdkUpdates).length > 0) {
                await db.update(sessionMetrics)
                    .set(sdkUpdates)
                    .where(eq(sessionMetrics.sessionId, session.id));
            }

            log.debug({
                uploadSuccessRate: normalizedSdkTelemetry.uploadSuccessRate,
                retryAttempts: normalizedSdkTelemetry.retryAttemptCount,
                circuitBreakerOpens: normalizedSdkTelemetry.circuitBreakerOpenCount,
            }, 'SDK telemetry saved');
        }

        const { endedAt, wallClockSeconds, backgroundTimeSeconds, durationSeconds } = calculateSessionDurationBreakdown(
            session.startedAt,
            data.endedAt,
            data.totalBackgroundTimeMs,
        );

        log.info({
            wallClockSeconds,
            backgroundTimeSeconds,
            durationSeconds,
            endReason,
            lifecycleVersion,
            metricsSummary,
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry),
        }, 'Session duration breakdown (durationSeconds = playable time)');

        await markSessionIngestActivity(session.id, {
            at: new Date(),
            explicitEndedAt: endedAt,
            backgroundTimeSeconds,
            closeSource: 'explicit',
        });
        await reconcileSessionState(session.id);

        log.info({
            durationSeconds,
            backgroundTimeSeconds,
            endReason,
            lifecycleVersion,
            metricsSummary,
        }, 'Session ended');

        res.json({ success: true, durationSeconds, backgroundTimeSeconds });
    })
);

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

        const lifecycle = await resolveLifecycleSession(projectId, sessionId, req, {
            deviceId: extractDeviceIdFromUploadToken(req) || undefined,
        });
        const log = logger.child({
            route: '/api/ingest/replay/evaluate',
            projectId,
            sessionId,
            resolution: lifecycle.resolution,
        });

        if (lifecycle.resolution === 'materialized') {
            log.info('Materialized recent missing session during /replay/evaluate');
        }

        if (!lifecycle.session) {
            log.info('Ignoring stale unknown session during /replay/evaluate');
            res.json({
                promoted: false,
                reason: 'no_recording_data',
                score: 0,
                ignored: true,
            });
            return;
        }

        const promoted = Boolean(lifecycle.session.replayAvailable);
        const reason = promoted ? 'successful_recording' : 'no_recording_data';

        log.info({
            replayAvailable: Boolean(lifecycle.session.replayAvailable),
            promoted,
            reason,
        }, 'Replay evaluate resolved');

        res.json({
            promoted,
            reason,
            score: promoted ? 1 : 0,
        });
    })
);

export default router;
