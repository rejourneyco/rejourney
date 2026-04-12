import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, projects, sessionMetrics, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import { apiKeyAuth, requireScope, asyncHandler } from '../middleware/index.js';
import { ingestLifecycleProjectRateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validation.js';
import { endSessionSchema } from '../validation/ingest.js';
import { normalizeIngestSdkVersion, resolveLifecycleSession } from '../services/ingestSessionLifecycle.js';
import { extractDeviceIdFromUploadToken } from '../services/ingestProtocol.js';
import { buildSdkTelemetryMergeSet, normalizeSdkTelemetry } from '../services/ingestSdkTelemetry.js';
import {
    buildSessionEndMetricsMergeSet,
    normalizeLifecycleVersion,
    normalizeSessionEndReason,
    summarizeSessionEndMetrics,
} from '../services/ingestSessionEnd.js';
import { loadSessionWorkAggregate } from '../services/sessionPresentationState.js';
import { hasStoredClosedTiming, resolveAuthoritativeSessionClose } from '../services/sessionTiming.js';
import { loadSuccessorSessionStartedAt } from '../services/sessionTimingQuery.js';
import { markSessionIngestActivity, reconcileSessionState } from '../services/sessionReconciliation.js';
import { isSessionIngestImmutable } from '../services/sessionIngestImmutability.js';
import { getRedisDiagnosticsForLog } from '../db/redis.js';

const router = Router();

router.post(
    '/session/end',
    apiKeyAuth,
    requireScope('ingest'),
    ingestLifecycleProjectRateLimiter,
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

        const preserveStoredCloseTiming = hasStoredClosedTiming({
            endedAt: session.endedAt,
            durationSeconds: session.durationSeconds,
        });

        if (preserveStoredCloseTiming) {
            log.info({
                preservedEndedAt: session.endedAt.toISOString(),
                preservedDurationSeconds: session.durationSeconds,
                preservedBackgroundTimeSeconds: session.backgroundTimeSeconds ?? 0,
                endReason,
                lifecycleVersion,
                metricsSummary,
                hadSdkTelemetry: Boolean(normalizedSdkTelemetry),
            }, 'Session already finalized; preserving stored close timing');

            res.json({
                success: true,
                durationSeconds: session.durationSeconds,
                backgroundTimeSeconds: session.backgroundTimeSeconds ?? 0,
            });
            return;
        }

        const [project] = await db.select({ maxRecordingMinutes: projects.maxRecordingMinutes })
            .from(projects)
            .where(eq(projects.id, session.projectId))
            .limit(1);
        const aggregate = await loadSessionWorkAggregate(session.id);
        const successorStartedAt = await loadSuccessorSessionStartedAt({
            sessionId: session.id,
            projectId: session.projectId,
            deviceId: session.deviceId,
            startedAt: session.startedAt,
        });
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: session.startedAt,
            lastIngestActivityAt: session.lastIngestActivityAt,
            latestReplayEndMs: aggregate.latestReplayArtifactEndMs,
            reportedEndedAt: data.endedAt,
            totalBackgroundTimeMs: data.totalBackgroundTimeMs,
            closeAnchorAtMs: data.closeAnchorAtMs,
            storedBackgroundTimeSeconds: session.backgroundTimeSeconds,
            maxRecordingMinutes: project?.maxRecordingMinutes ?? 10,
            successorStartedAt,
        });

        log.info({
            wallClockSeconds: resolvedClose.wallClockSeconds,
            backgroundTimeSeconds: resolvedClose.backgroundTimeSeconds,
            durationSeconds: resolvedClose.durationSeconds,
            endReason,
            lifecycleVersion,
            metricsSummary,
            hadSdkTelemetry: Boolean(normalizedSdkTelemetry),
            resolverSource: resolvedClose.source,
            usedReportedEndedAt: resolvedClose.usedReportedEndedAt,
            successorCapApplied: resolvedClose.successorCapApplied,
        }, 'Session duration breakdown (durationSeconds = playable time)');

        await markSessionIngestActivity(session.id, {
            at: resolvedClose.endedAt,
            updatedAt: new Date(),
            endedAt: resolvedClose.endedAt,
            durationSeconds: resolvedClose.durationSeconds,
            backgroundTimeSeconds: resolvedClose.backgroundTimeSeconds,
        });
        await reconcileSessionState(session.id);

        log.info({
            durationSeconds: resolvedClose.durationSeconds,
            backgroundTimeSeconds: resolvedClose.backgroundTimeSeconds,
            endReason,
            lifecycleVersion,
            metricsSummary,
            resolverSource: resolvedClose.source,
        }, 'Session ended');

        res.json({
            success: true,
            durationSeconds: resolvedClose.durationSeconds,
            backgroundTimeSeconds: resolvedClose.backgroundTimeSeconds,
        });
    })
);

export default router;
