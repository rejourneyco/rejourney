import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, sessionMetrics, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import { apiKeyAuth, requireScope, asyncHandler } from '../middleware/index.js';
import { ingestProjectRateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validation.js';
import { endSessionSchema } from '../validation/ingest.js';
import { normalizeIngestSdkVersion, resolveLifecycleSession } from '../services/ingestSessionLifecycle.js';
import { extractDeviceIdFromUploadToken } from '../services/ingestProtocol.js';
import { buildSdkTelemetryMergeSet, normalizeSdkTelemetry } from '../services/ingestSdkTelemetry.js';
import {
    buildSessionEndMetricsMergeSet,
    calculateSessionDurationBreakdown,
    normalizeLifecycleVersion,
    normalizeSessionEndReason,
    summarizeSessionEndMetrics,
} from '../services/ingestSessionEnd.js';
import { preserveExistingSessionEndedAt } from '../services/sessionTiming.js';
import { markSessionIngestActivity, reconcileSessionState } from '../services/sessionReconciliation.js';
import { isSessionIngestImmutable } from '../services/sessionIngestImmutability.js';
import { getRedisDiagnosticsForLog } from '../db/redis.js';

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
            log.info(
                {
                    event: 'ingest.session_end_ignored',
                    reason: 'session_not_found',
                    resolution: lifecycle.resolution,
                    ...getRedisDiagnosticsForLog(),
                },
                'Ignoring stale unknown session during /session/end',
            );
            res.json({ success: true, ignored: true, reason: 'session_not_found' });
            return;
        }

        const session = lifecycle.session;

        if (isSessionIngestImmutable(session)) {
            log.info(
                {
                    event: 'ingest.session_end_idempotent',
                    reason: 'session_immutable',
                },
                'Ignoring duplicate /session/end for closed session',
            );
            res.json({
                success: true,
                ignored: true,
                reason: 'session_immutable',
            });
            return;
        }

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

        const endSdkVersion = normalizeIngestSdkVersion(data.sdkVersion);
        if (endSdkVersion && !session.sdkVersion) {
            await db.update(sessions)
                .set({ sdkVersion: endSdkVersion, updatedAt: new Date() })
                .where(eq(sessions.id, session.id));
        }

        const endedAtFallback =
            session.explicitEndedAt
            ?? session.endedAt
            ?? session.lastIngestActivityAt
            ?? null;

        const { endedAt, wallClockSeconds, backgroundTimeSeconds, durationSeconds } = calculateSessionDurationBreakdown(
            session.startedAt,
            data.endedAt,
            data.totalBackgroundTimeMs,
            endedAtFallback,
        );
        const effectiveEndedAt = preserveExistingSessionEndedAt(endedAt, session.endedAt);
        const preservedExistingEnd = effectiveEndedAt.getTime() !== endedAt.getTime();
        const effectiveWallClockSeconds = Math.round((effectiveEndedAt.getTime() - session.startedAt.getTime()) / 1000);
        const effectiveDurationSeconds = Math.max(1, effectiveWallClockSeconds - backgroundTimeSeconds);

        log.info({
            wallClockSeconds: effectiveWallClockSeconds,
            backgroundTimeSeconds,
            durationSeconds: effectiveDurationSeconds,
            reportedWallClockSeconds: wallClockSeconds,
            reportedDurationSeconds: durationSeconds,
            endReason,
            lifecycleVersion,
            metricsSummary,
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry),
            preservedExistingEnd,
        }, 'Session duration breakdown (durationSeconds = playable time)');

        await markSessionIngestActivity(session.id, {
            at: preservedExistingEnd
                ? (session.lastIngestActivityAt ?? session.endedAt ?? new Date())
                : new Date(),
            explicitEndedAt: effectiveEndedAt,
            backgroundTimeSeconds,
            closeSource: 'explicit',
        });
        await reconcileSessionState(session.id);

        log.info({
            durationSeconds: effectiveDurationSeconds,
            backgroundTimeSeconds,
            endReason,
            lifecycleVersion,
            metricsSummary,
            preservedExistingEnd,
        }, 'Session ended');

        res.json({ success: true, durationSeconds: effectiveDurationSeconds, backgroundTimeSeconds });
    })
);

export default router;
