import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, sessionMetrics } from '../db/client.js';
import { logger } from '../logger.js';
import { apiKeyAuth, requireScope, asyncHandler, ApiError } from '../middleware/index.js';
import { ingestFaultProjectRateLimiter } from '../middleware/rateLimit.js';
import { ensureIngestSession } from '../services/ingestSessionLifecycle.js';
import { trackANRAsIssue, trackCrashAsIssue } from '../services/issueTracker.js';
import { assertSessionAcceptsNewIngestWork } from '../services/sessionIngestImmutability.js';
import { mergeAnrDeviceMetadata, resolveAnrStackTrace } from '../services/anrStack.js';
import { normalizeClientEpochMsForSession } from '../services/sessionClock.js';
import { persistAnrOccurrence, persistCrashOccurrence } from '../services/stabilityIngest.js';

const router = Router();

router.post(
    '/fault',
    apiKeyAuth,
    requireScope('ingest'),
    ingestFaultProjectRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.project!.id;
        const incident = req.body;

        if (!incident || !incident.category || !incident.sessionId) {
            throw ApiError.badRequest('Missing required fields: category, sessionId');
        }

        const sessionId = incident.sessionId;
        const normalizedCategory = String(incident.category || '').trim().toLowerCase();
        const isAnrIncident = normalizedCategory === 'anr'
            || normalizedCategory === 'app_not_responding'
            || normalizedCategory === 'application_not_responding';

        const { session: faultSession } = await ensureIngestSession(projectId, sessionId, undefined, undefined, {
            initialStatus: 'processing',
        });
        assertSessionAcceptsNewIngestWork(faultSession);
        const serverNow = new Date();
        const normalizedIncidentTimestamp = normalizeClientEpochMsForSession(
            incident.timestampMs,
            faultSession,
            serverNow,
        );
        const timestamp = new Date(normalizedIncidentTimestamp.value ?? serverNow.getTime());

        const stackTrace = Array.isArray(incident.frames)
            ? incident.frames.join('\n')
            : typeof incident.frames === 'string'
                ? incident.frames
                : null;
        const sessionMetadata = {
            platform: faultSession.platform,
            model: faultSession.deviceModel,
            deviceModel: faultSession.deviceModel,
            osVersion: faultSession.osVersion,
            systemVersion: faultSession.osVersion,
            appVersion: faultSession.appVersion,
            sdkVersion: faultSession.sdkVersion,
        };

        if (isAnrIncident) {
            const durationMs = incident.context?.durationMs
                ? parseInt(incident.context.durationMs, 10)
                : 5000;
            const stackTrace = resolveAnrStackTrace({
                threadState: incident.context?.threadState,
                frames: incident.frames,
                deviceMetadata: incident.context,
            });

            const deviceMetadata = {
                ...sessionMetadata,
                ...mergeAnrDeviceMetadata(incident.context, stackTrace, incident.context?.threadState),
            };
            const persisted = await persistAnrOccurrence({
                sessionId,
                projectId,
                incidentId: incident.incidentId,
                timestamp,
                durationMs,
                threadState: stackTrace,
                deviceMetadata,
                status: 'open',
                occurrenceCount: 1,
            });
            if (!persisted.inserted) {
                logger.info({ projectId, sessionId, category: normalizedCategory, durationMs }, 'Fault report deduplicated');
                res.json({ ok: true, deduplicated: true });
                return;
            }

            await db.update(sessionMetrics)
                .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + 1` })
                .where(eq(sessionMetrics.sessionId, sessionId));

            trackANRAsIssue({
                projectId,
                durationMs,
                stackTrace: stackTrace || undefined,
                timestamp,
                sessionId,
                deviceModel: faultSession.deviceModel || undefined,
                osVersion: faultSession.osVersion || undefined,
                appVersion: faultSession.appVersion || undefined,
                userId: faultSession.userDisplayId || faultSession.anonymousHash || faultSession.deviceId || undefined,
            }).catch(() => {});

            logger.info({ projectId, sessionId, category: normalizedCategory, durationMs }, 'Fault report ingested');
        } else {
            const deviceMetadata = {
                ...sessionMetadata,
                ...(incident.context && typeof incident.context === 'object' ? incident.context : {}),
            };
            const persisted = await persistCrashOccurrence({
                sessionId,
                projectId,
                incidentId: incident.incidentId,
                timestamp,
                exceptionName: incident.identifier || 'Unknown',
                reason: incident.detail || null,
                stackTrace,
                deviceMetadata,
                status: 'open',
                occurrenceCount: 1,
            });
            if (!persisted.inserted) {
                logger.info(
                    { projectId, sessionId, category: normalizedCategory, identifier: incident.identifier },
                    'Fault report deduplicated',
                );
                res.json({ ok: true, deduplicated: true });
                return;
            }

            await db.update(sessionMetrics)
                .set({ crashCount: sql`COALESCE(${sessionMetrics.crashCount}, 0) + 1` })
                .where(eq(sessionMetrics.sessionId, sessionId));

            trackCrashAsIssue({
                projectId,
                exceptionName: incident.identifier || 'Unknown',
                reason: incident.detail,
                stackTrace: stackTrace || undefined,
                timestamp,
                sessionId,
                deviceModel: faultSession.deviceModel || undefined,
                osVersion: faultSession.osVersion || undefined,
                appVersion: faultSession.appVersion || undefined,
                userId: faultSession.userDisplayId || faultSession.anonymousHash || faultSession.deviceId || undefined,
            }).catch(() => {});

            logger.info({ projectId, sessionId, category: normalizedCategory, identifier: incident.identifier }, 'Fault report ingested');
        }

        res.json({ ok: true });
    })
);

export default router;
