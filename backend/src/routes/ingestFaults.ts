import { Router } from 'express';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, anrs, crashes, sessionMetrics } from '../db/client.js';
import { logger } from '../logger.js';
import { apiKeyAuth, requireScope, asyncHandler, ApiError } from '../middleware/index.js';
import { ingestProjectRateLimiter } from '../middleware/rateLimit.js';
import { ensureIngestSession } from '../services/ingestSessionLifecycle.js';
import { trackANRAsIssue, trackCrashAsIssue } from '../services/issueTracker.js';
import { assertSessionAcceptsNewIngestWork } from '../services/sessionIngestImmutability.js';

const router = Router();

router.post(
    '/fault',
    apiKeyAuth,
    requireScope('ingest'),
    ingestProjectRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.project!.id;
        const incident = req.body;

        if (!incident || !incident.category || !incident.sessionId) {
            throw ApiError.badRequest('Missing required fields: category, sessionId');
        }

        const sessionId = incident.sessionId;
        const timestamp = new Date(incident.timestampMs || Date.now());
        const normalizedCategory = String(incident.category || '').trim().toLowerCase();
        const isAnrIncident = normalizedCategory === 'anr'
            || normalizedCategory === 'app_not_responding'
            || normalizedCategory === 'application_not_responding';

        const { session: faultSession } = await ensureIngestSession(projectId, sessionId, undefined, undefined, {
            initialStatus: 'processing',
        });
        assertSessionAcceptsNewIngestWork(faultSession);

        const stackTrace = Array.isArray(incident.frames)
            ? incident.frames.join('\n')
            : typeof incident.frames === 'string'
                ? incident.frames
                : null;

        if (isAnrIncident) {
            const durationMs = incident.context?.durationMs
                ? parseInt(incident.context.durationMs, 10)
                : 5000;

            const dedupeWindowMs = 30_000;
            const minTs = new Date(timestamp.getTime() - dedupeWindowMs);
            const maxTs = new Date(timestamp.getTime() + dedupeWindowMs);
            const [existingAnr] = await db
                .select({ id: anrs.id })
                .from(anrs)
                .where(and(
                    eq(anrs.sessionId, sessionId),
                    gte(anrs.timestamp, minTs),
                    lte(anrs.timestamp, maxTs),
                    sql`ABS(COALESCE(${anrs.durationMs}, 0) - ${durationMs}) <= 500`,
                ))
                .limit(1);
            if (existingAnr) {
                logger.info({ projectId, sessionId, category: normalizedCategory, durationMs }, 'Fault report deduplicated');
                res.json({ ok: true, deduplicated: true });
                return;
            }

            await db.insert(anrs).values({
                sessionId,
                projectId,
                timestamp,
                durationMs,
                threadState: incident.context?.threadState || null,
                deviceMetadata: incident.context || null,
                status: 'open',
                occurrenceCount: 1,
            });

            await db.update(sessionMetrics)
                .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + 1` })
                .where(eq(sessionMetrics.sessionId, sessionId));

            trackANRAsIssue({
                projectId,
                durationMs,
                threadState: incident.context?.threadState,
                timestamp,
                sessionId,
            }).catch(() => {});

            logger.info({ projectId, sessionId, category: normalizedCategory, durationMs }, 'Fault report ingested');
        } else {
            await db.insert(crashes).values({
                sessionId,
                projectId,
                timestamp,
                exceptionName: incident.identifier || 'Unknown',
                reason: incident.detail || null,
                stackTrace,
                deviceMetadata: incident.context || null,
                status: 'open',
                occurrenceCount: 1,
            });

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
            }).catch(() => {});

            logger.info({ projectId, sessionId, category: normalizedCategory, identifier: incident.identifier }, 'Fault report ingested');
        }

        res.json({ ok: true });
    })
);

export default router;
