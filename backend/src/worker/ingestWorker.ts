/**
 * Ingest Worker
 * 
 * Processes ingest jobs from the queue:
 * - Downloads artifacts from S3
 * - Extracts metrics (rage taps, screens, API calls)
 * - Updates session metrics + daily stats
 * - Computes UX scores
 */

import { eq, and, or, isNull, lte, asc, sql } from 'drizzle-orm';
import { db, pool, ingestJobs, sessions, sessionMetrics, projects, recordingArtifacts, crashes, anrs, errors, appDailyStats, apiEndpointDailyStats, screenTouchHeatmaps } from '../db/client.js';
import { evaluateAndPromoteSession } from '../services/replayPromotion.js';
import { analyzeProjectFunnel } from '../services/funnelAnalysis.js';
import { updateDeviceUsage } from '../services/recording.js';
import { createHash } from 'crypto';
import { downloadFromS3ForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { pingWorker, checkQueueHealth } from '../services/monitoring.js';
import { trackErrorAsIssue, trackCrashAsIssue, trackANRAsIssue } from '../services/issueTracker.js';
import { getUniqueScreenCount, mergeScreenPaths, normalizeScreenPath } from '../utils/screenPaths.js';
import { invalidateFrameCache, prewarmSessionScreenshotFrames } from '../services/screenshotFrames.js';

const POLL_INTERVAL_MS = 500;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;
const MAX_SCREEN_PATH_LENGTH = 200;
const JOB_PROCESS_CONCURRENCY = Number(process.env.RJ_INGEST_JOB_CONCURRENCY ?? 4);

// Auto-finalization is a primary, critical session-closing path.
// In real-world mobile lifecycle behavior, /session/end is often not delivered.
const AUTO_FINALIZE_AFTER_MS = Number(process.env.RJ_AUTO_FINALIZE_AFTER_MS ?? 60_000);
const AUTO_FINALIZE_INTERVAL_MS = Number(process.env.RJ_AUTO_FINALIZE_INTERVAL_MS ?? 10_000);

let lastAutoFinalizeAt = 0;

let isRunning = true;

type StaleSessionRow = {
    sessionId: string;
    projectId: string;
    teamId: string;
    sessionDeviceId: string | null;
    startedAt: Date;
    lastArtifactAt: Date;
    pendingJobs: number;
    rejourneyEnabled: boolean | null;
    deletedAt: Date | null;
};

async function finalizeStaleSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - AUTO_FINALIZE_AFTER_MS);
    const minStartedAt = new Date(Date.now() - 10_000);

    const result = await db.execute(sql`
        select
            s.id as "sessionId",
            s.project_id as "projectId",
            p.team_id as "teamId",
            s.device_id as "sessionDeviceId",
            s.started_at as "startedAt",
            max(ra.created_at) as "lastArtifactAt",
            sum(case when ij.status in ('pending','processing') then 1 else 0 end) as "pendingJobs",
            p.rejourney_enabled as "rejourneyEnabled",
            p.deleted_at as "deletedAt"
        from sessions s
        join projects p on p.id = s.project_id
        left join recording_artifacts ra on ra.session_id = s.id
        left join ingest_jobs ij on ij.session_id = s.id
        where s.ended_at is null
          and s.status = 'processing'
          and s.started_at <= ${minStartedAt}
        group by s.id, s.project_id, p.team_id, s.device_id, s.started_at, p.rejourney_enabled, p.deleted_at
        having max(ra.created_at) is not null
           and max(ra.created_at) <= ${cutoff}
           and sum(case when ij.status in ('pending','processing') then 1 else 0 end) = 0
        limit 100
    `);

    const rows = (result as any).rows as StaleSessionRow[] | undefined;
    if (!rows || rows.length === 0) return;

    logger.info({ count: rows.length, cutoff }, 'Auto-finalizing stale sessions (missing /session/end)');

    for (const row of rows) {
        if (!isRunning) return;

        const endedAt = new Date(row.lastArtifactAt);
        let durationSeconds = Math.round((endedAt.getTime() - new Date(row.startedAt).getTime()) / 1000);
        if (durationSeconds <= 0) durationSeconds = 1;

        await db.update(sessions)
            .set({
                endedAt,
                durationSeconds,
                backgroundTimeSeconds: 0,
                status: 'ready',
                updatedAt: new Date(),
            })
            .where(eq(sessions.id, row.sessionId));

        // Keep device usage aligned with /session/end behavior even when auto-finalized.
        const minutesRecorded = Math.max(0, Math.ceil(durationSeconds / 60));
        await updateDeviceUsage(row.sessionDeviceId, row.projectId, {
            requestCount: 1,
            minutesRecorded,
        });

        // CRITICAL: Mark any pending artifacts as ready and create ingest jobs
        // This handles the case where app was terminated after S3 upload but before /batch/complete
        const pendingArtifacts = await db.select()
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, row.sessionId),
                eq(recordingArtifacts.status, 'pending')
            ));

        for (const artifact of pendingArtifacts) {
            // Mark artifact as ready
            await db.update(recordingArtifacts)
                .set({
                    status: 'ready',
                    readyAt: new Date(),
                })
                .where(eq(recordingArtifacts.id, artifact.id));

            // Create ingest job to process the artifact (if not already exists)
            const [existingJob] = await db.select({ id: ingestJobs.id })
                .from(ingestJobs)
                .where(eq(ingestJobs.artifactId, artifact.id))
                .limit(1);

            if (!existingJob) {
                await db.insert(ingestJobs).values({
                    projectId: row.projectId,
                    sessionId: row.sessionId,
                    artifactId: artifact.id,
                    kind: artifact.kind,
                    payloadRef: artifact.s3ObjectKey,
                    status: 'pending',
                });
                logger.debug({ artifactId: artifact.id, kind: artifact.kind, sessionId: row.sessionId },
                    'Created ingest job for orphaned artifact during auto-finalization');
            }
        }

        if (pendingArtifacts.length > 0) {
            logger.info({ sessionId: row.sessionId, artifactCount: pendingArtifacts.length },
                'Recovered pending artifacts during auto-finalization');
        }

        // Note: Sessions are counted at first chunk upload, not at finalization.
        // No additional billing logic needed here.

        logger.info({ sessionId: row.sessionId, durationSeconds, endedAt }, 'Auto-finalized session');

        // Evaluate promotion with the same scoring path used by /session/end
        // so replay decisions stay consistent across close paths.
        try {
            const result = await evaluateAndPromoteSession(row.sessionId, row.projectId, durationSeconds);
            logger.info({ sessionId: row.sessionId, promoted: result.promoted, reason: result.reason }, 'Auto-finalize promotion evaluated');
        } catch (err) {
            logger.error({ sessionId: row.sessionId, err }, 'Failed to evaluate promotion after auto-finalize');
        }
    }
}

async function autoFinalizeIfDue(): Promise<void> {
    const now = Date.now();
    if (now - lastAutoFinalizeAt < AUTO_FINALIZE_INTERVAL_MS) return;
    lastAutoFinalizeAt = now;
    try {
        await finalizeStaleSessions();
    } catch (err) {
        logger.error({ err }, 'Auto-finalize stale sessions failed');
    }
}

/**
 * Process a single artifact job
 */
async function processArtifactJob(job: any): Promise<boolean> {
    const log = logger.child({ jobId: job.id, sessionId: job.sessionId, kind: job.kind });

    try {
        log.debug('Processing artifact job');

        // Mark as processing
        await db.update(ingestJobs)
            .set({
                status: 'processing',
                attempts: (job.attempts || 0) + 1,
            })
            .where(eq(ingestJobs.id, job.id));

        // Get session with project and metrics
        const [sessionResult] = await db
            .select({
                session: sessions,
                project: projects,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(projects, eq(sessions.projectId, projects.id))
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(eq(sessions.id, job.sessionId!))
            .limit(1);

        if (!sessionResult) {
            log.warn('Session not found, marking job as failed');
            await db.update(ingestJobs)
                .set({ status: 'failed', errorMsg: 'Session not found' })
                .where(eq(ingestJobs.id, job.id));
            return false;
        }

        const { session, project, metrics } = sessionResult;
        const projectId = project?.id || session.projectId;
        const s3Key = job.payloadRef;

        // Fetch artifact for endpointId (pins download to same endpoint as upload for k3s load balancing)
        const [artifact] = await db
            .select({ endpointId: recordingArtifacts.endpointId })
            .from(recordingArtifacts)
            .where(eq(recordingArtifacts.id, job.artifactId))
            .limit(1);

        // Download from artifact's endpoint (or project default for legacy artifacts)
        const data = await downloadFromS3ForArtifact(projectId, s3Key, artifact?.endpointId);
        if (!data) {
            log.warn('No data found in S3');
            await db.update(recordingArtifacts)
                .set({ status: 'ready', readyAt: new Date() })
                .where(eq(recordingArtifacts.id, job.artifactId));
            await db.update(ingestJobs)
                .set({ status: 'done', updatedAt: new Date() })
                .where(eq(ingestJobs.id, job.id));
            return true;
        }

        // Process based on kind
        if (job.kind === 'events') {
            await processEventsArtifact(job, session, metrics, projectId, data, log);
        } else if (job.kind === 'crashes') {
            await processCrashesArtifact(job, session, projectId, s3Key, data, log);
        } else if (job.kind === 'anrs') {
            log.info({ sessionId: session.id, kind: job.kind }, 'Processing ANRs artifact');
            await processAnrsArtifact(job, session, projectId, s3Key, data, log);
        } else if (job.kind === 'screenshots' || job.kind === 'hierarchy') {
            // These jobs can be created during auto-finalization when /segment/complete
            // was never called. Re-apply the same counters as ingest route finalization.
            await processRecoveredReplayArtifact(job, session, data, log);
        }

        // Mark artifact + job as done
        await db.update(recordingArtifacts)
            .set({ status: 'ready', readyAt: new Date() })
            .where(eq(recordingArtifacts.id, job.artifactId));

        await db.update(ingestJobs)
            .set({ status: 'done', updatedAt: new Date() })
            .where(eq(ingestJobs.id, job.id));

        // Check if this was the last pending job for the session
        const [pendingResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(ingestJobs)
            .where(
                and(
                    eq(ingestJobs.sessionId, session.id),
                    or(
                        eq(ingestJobs.status, 'pending'),
                        eq(ingestJobs.status, 'processing')
                    )
                )
            );

        if (Number(pendingResult?.count ?? 0) === 0) {
            // Trigger promotion evaluation immediately
            // This replaces the 5s polling loop in evaluation service
            logger.info({ sessionId: session.id }, 'No more pending ingest jobs, triggering promotion evaluation');
            evaluateAndPromoteSession(session.id, projectId, session.durationSeconds || 0).catch(err => {
                logger.error({ err, sessionId: session.id }, 'Promotion evaluation failed after final job');
            });

            // Pre-extract screenshot frames in worker path so replay open stays fast.
            prewarmSessionScreenshotFrames(session.id)
                .then((ok) => {
                    if (ok) {
                        logger.info({ sessionId: session.id }, 'Prewarmed screenshot frames after ingest completion');
                    }
                })
                .catch((err) => {
                    logger.warn({ err, sessionId: session.id }, 'Failed to prewarm screenshot frames');
                });

            // LAZY FUNNEL LEARNING
            // Randomly trigger funnel analysis (5% chance) to keep the "Happy Path" up to date
            if (Math.random() < 0.05) {
                analyzeProjectFunnel(projectId).catch(err => {
                    logger.error({ err, projectId }, 'Failed to lazy-analyze project funnel');
                });
            }
        }

        log.debug('Artifact job completed');
        return true;

    } catch (err) {
        log.error({ err }, 'Artifact job processing failed');

        // Sanitize error message to remove null bytes (which PostgreSQL rejects)
        // eslint-disable-next-line no-control-regex
        const errorMsg = String(err).replace(/\x00/g, '').substring(0, 1000);

        if (job.attempts >= MAX_ATTEMPTS) {
            await db.update(ingestJobs)
                .set({ status: 'dlq', errorMsg })
                .where(eq(ingestJobs.id, job.id));
            log.warn('Job moved to DLQ after max attempts');
        } else {
            const nextRunAt = new Date(Date.now() + Math.pow(2, job.attempts) * 1000);
            await db.update(ingestJobs)
                .set({ status: 'pending', nextRunAt, errorMsg })
                .where(eq(ingestJobs.id, job.id));
        }

        return false;
    }
}

/**
 * Process events artifact - extract metrics, update session
 */
async function processEventsArtifact(job: any, session: any, metrics: any, projectId: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const eventsData = payload.events || [];
    const deviceInfo = payload.deviceInfo;

    // Update session metadata from device info
    if (deviceInfo) {
        const sessionUpdates: any = { updatedAt: new Date() };
        if (deviceInfo.appVersion) sessionUpdates.appVersion = deviceInfo.appVersion;
        if (deviceInfo.model) sessionUpdates.deviceModel = deviceInfo.model;
        if (deviceInfo.platform) sessionUpdates.platform = deviceInfo.platform;
        if ((!session.deviceId || session.deviceId === '') && (deviceInfo.deviceId || deviceInfo.vendorId || deviceInfo.deviceHash)) {
            sessionUpdates.deviceId = deviceInfo.deviceId || deviceInfo.vendorId || deviceInfo.deviceHash;
        }
        if (deviceInfo.systemVersion) sessionUpdates.osVersion = deviceInfo.systemVersion;
        else if (deviceInfo.osVersion) sessionUpdates.osVersion = deviceInfo.osVersion;

        await db.update(sessions).set(sessionUpdates).where(eq(sessions.id, job.sessionId));

        if (deviceInfo.networkType) {
            await db.update(sessionMetrics)
                .set({
                    networkType: deviceInfo.networkType,
                    cellularGeneration: deviceInfo.cellularGeneration,
                    isConstrained: deviceInfo.isConstrained,
                    isExpensive: deviceInfo.isExpensive,
                })
                .where(eq(sessionMetrics.sessionId, job.sessionId));
        }
    }

    // Extract event metrics
    let touchCount = 0, scrollCount = 0, gestureCount = 0, inputCount = 0;
    let networkTotalCount = 0, networkSuccessCount = 0, networkErrorCount = 0;
    let networkTotalDuration = 0, networkDurationCount = 0;
    let errorCount = 0, rageTapCount = 0, customEventCount = 0;
    let deadTapCount = 0;
    let appStartupTimeMs: number | null = null;
    const recentTaps: { x: number; y: number; timestamp: number }[] = [];
    const screenPath: string[] = [];
    const endpointStats: Record<string, { calls: number; errors: number; latencySum: number }> = {};

    // Collect errors for batch insert
    const errorEvents: Array<{
        timestamp: Date;
        errorType: string;
        errorName: string;
        message: string;
        stack?: string;
        screenName?: string;
    }> = [];

    // Collect ANRs for batch insert
    const anrEvents: Array<{
        timestamp: Date;
        durationMs: number;
        threadState?: string;
        stack?: string;
        screenName?: string;
    }> = [];

    // Track current screen for touch coordinate association
    let currentScreen: string | null = null;

    // Screen touch heatmap data: screenName -> { touchBuckets, rageTapBuckets, touchCount, rageTapCount, firstSeenMs }
    const screenHeatmapData: Record<string, {
        touchBuckets: Record<string, number>;
        rageTapBuckets: Record<string, number>;
        totalTouches: number;
        totalRageTaps: number;
        firstSeenMs: number | null; // Timestamp when this screen was first seen in this session
    }> = {};

    // Helper to bucket coordinates to grid cells (50 columns x 100 rows for fine-grained heatmaps)
    const bucketCoordinate = (x: number, y: number, screenWidth: number, screenHeight: number): string => {
        // Normalize to 0-1 range
        const normX = Math.max(0, Math.min(1, x / screenWidth));
        const normY = Math.max(0, Math.min(1, y / screenHeight));
        // Bucket to fine grid (50 columns x 100 rows) for more precise heatmap data
        const bucketX = Math.floor(normX * 50) / 50;
        const bucketY = Math.floor(normY * 100) / 100;
        return `${bucketX.toFixed(2)},${bucketY.toFixed(2)}`;
    };

    // Default screen dimensions (can be overridden by device info)
    const screenWidth = deviceInfo?.screenWidth || 375;
    const screenHeight = deviceInfo?.screenHeight || 812;

    for (const event of eventsData) {
        const type = (event.type || '').toLowerCase();
        const gestureType = (event.gestureType || '').toLowerCase();

        if (type === 'navigation') {
            const screenName = event.screen || event.screenName || event.payload?.screenName || event.payload?.name || event.payload?.route;
            if (screenName) {
                const trimmedScreen = String(screenName).trim();
                if (!trimmedScreen) {
                    continue;
                }
                if (screenPath.length === 0 || screenPath[screenPath.length - 1] !== trimmedScreen) {
                    screenPath.push(trimmedScreen);
                }
                currentScreen = trimmedScreen;
                // Initialize heatmap data for this screen if not exists (capture first-seen timestamp)
                if (!screenHeatmapData[trimmedScreen]) {
                    // Extract timestamp from event - it could be in various formats
                    let eventTimestampMs: number | null = null;
                    if (event.timestamp) {
                        // Timestamp could be ms since epoch or Date string
                        const ts = event.timestamp;
                        if (typeof ts === 'number') {
                            // If timestamp is less than year 2000 in ms, it's probably seconds
                            eventTimestampMs = ts > 946684800000 ? ts : ts * 1000;
                        } else if (typeof ts === 'string') {
                            const parsed = Date.parse(ts);
                            if (!isNaN(parsed)) eventTimestampMs = parsed;
                        }
                    }
                    screenHeatmapData[trimmedScreen] = {
                        touchBuckets: {},
                        rageTapBuckets: {},
                        totalTouches: 0,
                        totalRageTaps: 0,
                        firstSeenMs: eventTimestampMs ? Math.round(eventTimestampMs) : null,
                    };
                }
            }
        }

        if (type === 'motion' || type === 'scroll_motion' || type === 'pan_motion') {
            if (type.includes('scroll')) scrollCount++;
        } else if (type === 'touch' || type === 'tap' || gestureType === 'tap' || gestureType === 'single_tap') {
            touchCount++;
            const tapX = event.x || event.touches?.[0]?.x || 0;
            const tapY = event.y || event.touches?.[0]?.y || 0;
            const tapTime = event.timestamp || 0;

            // Check for rage tap (multiple taps in same area within 500ms)
            while (recentTaps.length > 0 && tapTime - recentTaps[0].timestamp > 500) recentTaps.shift();
            const nearbyTaps = recentTaps.filter(t => Math.abs(t.x - tapX) < 50 && Math.abs(t.y - tapY) < 50);
            const isRageTap = nearbyTaps.length >= 1;
            if (isRageTap) rageTapCount++;
            recentTaps.push({ x: tapX, y: tapY, timestamp: tapTime });

            // Record touch coordinate for heatmap (if we have a current screen)
            if (currentScreen && tapX > 0 && tapY > 0) {
                const bucket = bucketCoordinate(tapX, tapY, screenWidth, screenHeight);
                if (!screenHeatmapData[currentScreen]) {
                    screenHeatmapData[currentScreen] = {
                        touchBuckets: {},
                        rageTapBuckets: {},
                        totalTouches: 0,
                        totalRageTaps: 0,
                        firstSeenMs: null, // Will be set by navigation event
                    };
                }
                screenHeatmapData[currentScreen].touchBuckets[bucket] =
                    (screenHeatmapData[currentScreen].touchBuckets[bucket] || 0) + 1;
                screenHeatmapData[currentScreen].totalTouches++;

                if (isRageTap) {
                    screenHeatmapData[currentScreen].rageTapBuckets[bucket] =
                        (screenHeatmapData[currentScreen].rageTapBuckets[bucket] || 0) + 1;
                    screenHeatmapData[currentScreen].totalRageTaps++;
                }
            }
        } else if (type === 'scroll') {
            scrollCount++;
        } else if (type === 'gesture') {
            gestureCount++;
            if (gestureType === 'dead_tap') {
                deadTapCount++;
            } else if (gestureType.includes('scroll') || gestureType.includes('swipe')) {
                scrollCount++;
            }
            // Extract touch coordinates from gesture events (iOS SDK sends touches in the touches array)
            // This is critical for heatmap data - gestures with tap-like types have coordinate data
            if (gestureType === 'tap' || gestureType === 'single_tap' || gestureType === 'double_tap' ||
                gestureType === 'long_press' || gestureType.includes('tap')) {
                touchCount++;
                // Extract coordinates from the touches array
                const touches = event.touches || [];
                if (Array.isArray(touches) && touches.length > 0) {
                    for (const touch of touches) {
                        const tapX = touch.x || 0;
                        const tapY = touch.y || 0;
                        const tapTime = touch.timestamp || event.timestamp || 0;

                        if (currentScreen && tapX > 0 && tapY > 0) {
                            const bucket = bucketCoordinate(tapX, tapY, screenWidth, screenHeight);
                            if (!screenHeatmapData[currentScreen]) {
                                screenHeatmapData[currentScreen] = {
                                    touchBuckets: {},
                                    rageTapBuckets: {},
                                    totalTouches: 0,
                                    totalRageTaps: 0,
                                    firstSeenMs: null,
                                };
                            }
                            screenHeatmapData[currentScreen].touchBuckets[bucket] =
                                (screenHeatmapData[currentScreen].touchBuckets[bucket] || 0) + 1;
                            screenHeatmapData[currentScreen].totalTouches++;

                            // Track for rage tap detection
                            while (recentTaps.length > 0 && tapTime - recentTaps[0].timestamp > 500) recentTaps.shift();
                            const nearbyTaps = recentTaps.filter(t => Math.abs(t.x - tapX) < 50 && Math.abs(t.y - tapY) < 50);
                            if (nearbyTaps.length >= 1) {
                                rageTapCount++;
                                screenHeatmapData[currentScreen].rageTapBuckets[bucket] =
                                    (screenHeatmapData[currentScreen].rageTapBuckets[bucket] || 0) + 1;
                                screenHeatmapData[currentScreen].totalRageTaps++;
                            }
                            recentTaps.push({ x: tapX, y: tapY, timestamp: tapTime });
                        }
                    }
                } else {
                    // Fallback: try to get coordinates from event directly
                    const tapX = event.x || 0;
                    const tapY = event.y || 0;
                    if (currentScreen && tapX > 0 && tapY > 0) {
                        const bucket = bucketCoordinate(tapX, tapY, screenWidth, screenHeight);
                        if (!screenHeatmapData[currentScreen]) {
                            screenHeatmapData[currentScreen] = {
                                touchBuckets: {},
                                rageTapBuckets: {},
                                totalTouches: 0,
                                totalRageTaps: 0,
                                firstSeenMs: null,
                            };
                        }
                        screenHeatmapData[currentScreen].touchBuckets[bucket] =
                            (screenHeatmapData[currentScreen].touchBuckets[bucket] || 0) + 1;
                        screenHeatmapData[currentScreen].totalTouches++;
                    }
                }
            }
        } else if (type === 'rage_tap') {
            rageTapCount++;
            // Also record rage tap coordinates for heatmap
            const tapX = event.x || event.touches?.[0]?.x || 0;
            const tapY = event.y || event.touches?.[0]?.y || 0;
            if (currentScreen && tapX > 0 && tapY > 0) {
                const bucket = bucketCoordinate(tapX, tapY, screenWidth, screenHeight);
                if (!screenHeatmapData[currentScreen]) {
                    screenHeatmapData[currentScreen] = {
                        touchBuckets: {},
                        rageTapBuckets: {},
                        totalTouches: 0,
                        totalRageTaps: 0,
                        firstSeenMs: null,
                    };
                }
                screenHeatmapData[currentScreen].rageTapBuckets[bucket] =
                    (screenHeatmapData[currentScreen].rageTapBuckets[bucket] || 0) + 1;
                screenHeatmapData[currentScreen].totalRageTaps++;
            }
        } else if (type === 'dead_tap' || gestureType === 'dead_tap') {
            deadTapCount++;
        } else if (type === 'api_call' || type === 'network_request') {
            networkTotalCount++;
            if (event.duration && typeof event.duration === 'number') {
                networkTotalDuration += event.duration;
                networkDurationCount++;
            }
            const isError = event.success === false || (event.statusCode && event.statusCode >= 400);
            if (event.success === true || (event.statusCode && event.statusCode >= 200 && event.statusCode < 400)) {
                networkSuccessCount++;
            } else if (isError) {
                networkErrorCount++;
            }

            const method = (event.method || 'GET').toUpperCase();
            let url = event.url || event.endpoint || '';
            try { url = new URL(url).pathname; } catch { /* use as-is if not valid URL */ }
            if (url) {
                const endpoint = `${method} ${url}`;
                if (!endpointStats[endpoint]) endpointStats[endpoint] = { calls: 0, errors: 0, latencySum: 0 };
                endpointStats[endpoint].calls++;
                if (isError) endpointStats[endpoint].errors++;
                if (event.duration) endpointStats[endpoint].latencySum += event.duration;
            }
        } else if (type === 'error') {
            errorCount++;
            // Collect error details for batch insert
            const errorName = event.name || 'Error';
            const errorMessage = event.message || 'Unknown error';
            const errorType = errorName === 'UnhandledRejection' ? 'promise_rejection'
                : errorName.includes('Exception') ? 'unhandled_exception'
                    : 'js_error';
            errorEvents.push({
                timestamp: new Date(event.timestamp || Date.now()),
                errorType,
                errorName,
                message: errorMessage,
                stack: event.stack,
                screenName: currentScreen || undefined,
            });
        } else if (type === 'anr') {
            anrEvents.push({
                timestamp: new Date(event.timestamp || Date.now()),
                durationMs: event.durationMs || 5000,
                threadState: event.threadState || 'blocked',
                stack: event.stack,
                screenName: currentScreen || undefined,
            });
        } else if (['keyboard_typing', 'keyboard_show', 'keyboard_hide', 'input', 'text_input'].includes(type)) {
            inputCount++;
        } else if (type === 'custom') {
            customEventCount++;
        } else if (type === 'app_startup') {
            // Extract app startup time
            const durationMs = event.durationMs || event.duration;
            if (durationMs && typeof durationMs === 'number' && durationMs > 0) {
                // Store in updates - will be applied to session_metrics
                appStartupTimeMs = durationMs;
                log.info({ appStartupTimeMs: durationMs, platform: event.platform }, 'Captured app startup time');
            }
        } else if (type === 'user_identity_changed') {
            // Update session's userId when user identity changes mid-session
            const newUserId = event.userId || event.details?.userId;
            if (newUserId && newUserId !== 'anonymous' && typeof newUserId === 'string') {
                if (newUserId.startsWith('anon_')) {
                    // It's an anonymous ID, update anonymousDisplayId instead
                    await db.update(sessions)
                        .set({ anonymousDisplayId: newUserId, updatedAt: new Date() })
                        .where(eq(sessions.id, job.sessionId));
                    log.info({ anonymousId: newUserId }, 'Session anonymousId updated from user_identity_changed event');
                } else {
                    // It's a real user ID
                    await db.update(sessions)
                        .set({ userDisplayId: newUserId, updatedAt: new Date() })
                        .where(eq(sessions.id, job.sessionId));
                    log.info({ userId: newUserId }, 'Session userId updated from user_identity_changed event');
                }
            }
        }
    }

    // Update session metrics
    const existingMetrics = metrics || { touchCount: 0, scrollCount: 0, gestureCount: 0, inputCount: 0, rageTapCount: 0, deadTapCount: 0, apiTotalCount: 0, apiSuccessCount: 0, apiErrorCount: 0, errorCount: 0, customEventCount: 0, apiAvgResponseMs: 0, screensVisited: [] };

    const updates: any = {
        touchCount: (existingMetrics.touchCount || 0) + touchCount,
        scrollCount: (existingMetrics.scrollCount || 0) + scrollCount,
        gestureCount: (existingMetrics.gestureCount || 0) + gestureCount,
        inputCount: (existingMetrics.inputCount || 0) + inputCount,
        rageTapCount: (existingMetrics.rageTapCount || 0) + rageTapCount,
        deadTapCount: (existingMetrics.deadTapCount || 0) + deadTapCount,
        apiTotalCount: (existingMetrics.apiTotalCount || 0) + networkTotalCount,
        apiSuccessCount: (existingMetrics.apiSuccessCount || 0) + networkSuccessCount,
        apiErrorCount: (existingMetrics.apiErrorCount || 0) + networkErrorCount,
        errorCount: (existingMetrics.errorCount || 0) + errorCount,
        customEventCount: (existingMetrics.customEventCount || 0) + customEventCount,
    };

    if (networkDurationCount > 0) {
        const currentTotalCalls = existingMetrics.apiTotalCount || 0;
        const currentAvg = existingMetrics.apiAvgResponseMs || 0;
        const currentTotalDuration = currentAvg * currentTotalCalls;
        const newTotalDuration = currentTotalDuration + networkTotalDuration;
        const newTotalCalls = currentTotalCalls + networkDurationCount;
        updates.apiAvgResponseMs = newTotalDuration / newTotalCalls;
    }



    // Store app startup time if captured
    if (appStartupTimeMs !== null) {
        updates.appStartupTimeMs = appStartupTimeMs;
    }

    const normalizedScreenPath = normalizeScreenPath(screenPath, { maxLength: MAX_SCREEN_PATH_LENGTH });
    if (normalizedScreenPath.length > 0) {
        const existingScreens = (existingMetrics.screensVisited as string[]) || [];
        updates.screensVisited = mergeScreenPaths(existingScreens, normalizedScreenPath, MAX_SCREEN_PATH_LENGTH);
    }

    // Compute UX score
    let uxScore = 100;
    uxScore -= Math.min(updates.rageTapCount * 15, 45);
    uxScore -= Math.min(updates.deadTapCount * 8, 24);
    uxScore -= Math.min(updates.errorCount * 10, 30);
    uxScore -= Math.min(updates.apiErrorCount * 5, 20);
    uxScore += Math.min((updates.touchCount || 0) + (updates.scrollCount || 0), 10);
    uxScore = Math.max(0, Math.min(100, Math.round(uxScore)));

    const interactionScore = Math.min(100, updates.touchCount * 2 + updates.scrollCount * 2 + updates.gestureCount * 3);
    const screensForScore = (updates.screensVisited as string[]) || (existingMetrics.screensVisited as string[]) || [];
    const explorationScore = Math.min(100, getUniqueScreenCount(screensForScore) * 20);

    updates.uxScore = uxScore;
    updates.interactionScore = interactionScore;
    updates.explorationScore = explorationScore;

    // Track artifact size
    updates.eventsSizeBytes = (existingMetrics.eventsSizeBytes || 0) + data.length;

    await db.update(sessionMetrics).set(updates).where(eq(sessionMetrics.sessionId, job.sessionId));

    // Batch upsert endpoint stats (single transaction)
    if (Object.keys(endpointStats).length > 0) {
        const today = new Date().toISOString().split('T')[0];
        for (const [endpoint, stats] of Object.entries(endpointStats)) {
            await db.insert(apiEndpointDailyStats).values({
                projectId,
                date: today as any,
                endpoint,
                region: 'unknown', // Default region - will be enriched later if geo data available
                totalCalls: BigInt(stats.calls),
                totalErrors: BigInt(stats.errors),
                sumLatencyMs: BigInt(Math.round(stats.latencySum)),
            }).onConflictDoUpdate({
                target: [apiEndpointDailyStats.projectId, apiEndpointDailyStats.date, apiEndpointDailyStats.endpoint, apiEndpointDailyStats.region],
                set: {
                    totalCalls: sql`${apiEndpointDailyStats.totalCalls} + ${stats.calls}`,
                    totalErrors: sql`${apiEndpointDailyStats.totalErrors} + ${stats.errors}`,
                    sumLatencyMs: sql`${apiEndpointDailyStats.sumLatencyMs} + ${Math.round(stats.latencySum)}`,
                    updatedAt: new Date(),
                }
            });
        }
    }

    // Batch upsert screen touch heatmap data
    if (Object.keys(screenHeatmapData).length > 0) {
        const sessionDate = new Date().toISOString().split('T')[0];
        for (const [screenName, heatmapStats] of Object.entries(screenHeatmapData)) {
            if (heatmapStats.totalTouches > 0 || heatmapStats.totalRageTaps > 0) {
                // === DATABASE PERSISTENCE (Postgres) ===
                try {
                    // Use atomic SQL update with JSONB merge logic to avoid OOM for large heatmaps
                    // This pushes the aggregation work to the database instead of Node.js RAM
                    await db.insert(screenTouchHeatmaps)
                        .values({
                            projectId,
                            screenName,
                            date: sessionDate as any,
                            touchBuckets: heatmapStats.touchBuckets,
                            rageTapBuckets: heatmapStats.rageTapBuckets,
                            totalTouches: heatmapStats.totalTouches,
                            totalRageTaps: heatmapStats.totalRageTaps,
                            sampleSessionId: job.sessionId,
                            screenFirstSeenMs: heatmapStats.firstSeenMs,
                            updatedAt: new Date(),
                        })
                        .onConflictDoUpdate({
                            target: [screenTouchHeatmaps.projectId, screenTouchHeatmaps.screenName, screenTouchHeatmaps.date],
                            set: {
                                // Merge and sum JSONB keys directly in SQL
                                touchBuckets: sql`(
                                    SELECT jsonb_object_agg(key, value)
                                    FROM (
                                        SELECT key, SUM(value::int) as value
                                        FROM (
                                            SELECT * FROM jsonb_each_text(${screenTouchHeatmaps.touchBuckets}::jsonb)
                                            UNION ALL
                                            SELECT * FROM jsonb_each_text(EXCLUDED.touch_buckets::jsonb)
                                        ) AS combined
                                        GROUP BY key
                                    ) AS aggregated
                                )`,
                                rageTapBuckets: sql`(
                            SELECT jsonb_object_agg(key, value)
                                    FROM(
                                SELECT key, SUM(value:: int) as value
                                        FROM(
                                    SELECT * FROM jsonb_each_text(${screenTouchHeatmaps.rageTapBuckets}:: jsonb)
                                            UNION ALL
                                            SELECT * FROM jsonb_each_text(EXCLUDED.rage_tap_buckets:: jsonb)
                                ) AS combined
                                        GROUP BY key
                            ) AS aggregated
                        )`,
                                totalTouches: sql`${screenTouchHeatmaps.totalTouches} + EXCLUDED.total_touches`,
                                totalRageTaps: sql`${screenTouchHeatmaps.totalRageTaps} + EXCLUDED.total_rage_taps`,
                                // Keep the earlier sample session if already present
                                sampleSessionId: sql`COALESCE(${screenTouchHeatmaps.sampleSessionId}, EXCLUDED.sample_session_id)`,
                                screenFirstSeenMs: sql`COALESCE(${screenTouchHeatmaps.screenFirstSeenMs}, EXCLUDED.screen_first_seen_ms)`,
                                updatedAt: new Date(),
                            }
                        });
                } catch (err) {
                    log.error({ err, screenName }, 'Failed to upsert screen heatmap');
                }
            }
        }
        log.debug({ screenCount: Object.keys(screenHeatmapData).length }, 'Screen touch heatmap data saved');
    }

    // Batch insert errors into errors table
    if (errorEvents.length > 0) {
        for (const errorEvent of errorEvents) {
            // Create fingerprint for grouping similar errors
            const fingerprintData = `${projectId}:${errorEvent.errorName}:${errorEvent.message} `;
            const fingerprint = createHash('sha256').update(fingerprintData).digest('hex').slice(0, 64);

            await db.insert(errors).values({
                sessionId: job.sessionId,
                projectId,
                timestamp: errorEvent.timestamp,
                errorType: errorEvent.errorType,
                errorName: errorEvent.errorName,
                message: errorEvent.message,
                stack: errorEvent.stack,
                screenName: errorEvent.screenName || undefined,
                deviceModel: deviceInfo?.model ?? 'unknown',
                osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion || 'unknown',
                appVersion: deviceInfo?.appVersion ?? 'unknown',
                fingerprint,
                status: 'open',
            });

            // Track as an issue for the Issues Feed
            trackErrorAsIssue({
                projectId,
                errorName: errorEvent.errorName,
                message: errorEvent.message,
                errorType: errorEvent.errorType,
                stack: errorEvent.stack,
                screenName: errorEvent.screenName,
                timestamp: errorEvent.timestamp,
                sessionId: job.sessionId,
                deviceModel: deviceInfo?.model,
                osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion,
                appVersion: deviceInfo?.appVersion,
                fingerprint,
            }).catch(() => { }); // Fire and forget
        }
        log.debug({ errorCount: errorEvents.length }, 'Error events saved to errors table');
    }

    // Batch insert ANRs into anrs table
    if (anrEvents.length > 0) {
        for (const anrEvent of anrEvents) {
            await db.insert(anrs).values({
                sessionId: job.sessionId,
                projectId,
                timestamp: anrEvent.timestamp,
                durationMs: anrEvent.durationMs,
                threadState: anrEvent.threadState || null,
                deviceMetadata: {
                    model: deviceInfo?.model,
                    osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion,
                    appVersion: deviceInfo?.appVersion,
                    stack: anrEvent.stack,
                    screenName: anrEvent.screenName,
                },
                status: 'open',
                occurrenceCount: 1,
            });

            trackANRAsIssue({
                projectId,
                durationMs: anrEvent.durationMs,
                threadState: anrEvent.threadState,
                timestamp: anrEvent.timestamp,
                sessionId: job.sessionId,
                deviceModel: deviceInfo?.model,
                osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion,
                appVersion: deviceInfo?.appVersion,
            }).catch(() => { }); // Fire and forget
        }

        // Update ANR count in session metrics
        await db.update(sessionMetrics)
            .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + ${anrEvents.length}` })
            .where(eq(sessionMetrics.sessionId, job.sessionId));

        log.debug({ anrCount: anrEvents.length }, 'ANR events saved to anrs table');
    }

    log.debug({ eventsCount: eventsData.length, touchCount, rageTapCount }, 'Events artifact processed');
}

async function processRecoveredReplayArtifact(
    job: any,
    session: any,
    data: Buffer,
    log: any
) {
    const [artifact] = await db
        .select()
        .from(recordingArtifacts)
        .where(eq(recordingArtifacts.id, job.artifactId))
        .limit(1);

    if (!artifact) {
        log.warn({ artifactId: job.artifactId, kind: job.kind }, 'Artifact missing while recovering replay counters');
        return;
    }

    if (job.kind === 'screenshots') {
        const sizeBytes = Number(data.length || artifact.sizeBytes || 0);

        await db.update(sessions)
            .set({
                replaySegmentCount: sql`COALESCE(${sessions.replaySegmentCount}, 0) + 1`,
                replayStorageBytes: sql`COALESCE(${sessions.replayStorageBytes}, 0) + ${sizeBytes}`,
            })
            .where(eq(sessions.id, job.sessionId));

        await db.update(sessionMetrics)
            .set({
                screenshotSegmentCount: sql`COALESCE(${sessionMetrics.screenshotSegmentCount}, 0) + 1`,
                screenshotTotalBytes: sql`COALESCE(${sessionMetrics.screenshotTotalBytes}, 0) + ${sizeBytes}`,
            })
            .where(eq(sessionMetrics.sessionId, job.sessionId));

        if (artifact.endTime && session.endedAt) {
            const segmentEndDate = new Date(artifact.endTime);
            if (segmentEndDate > session.endedAt) {
                const newDuration = Math.round((segmentEndDate.getTime() - session.startedAt.getTime()) / 1000);
                await db.update(sessions)
                    .set({
                        endedAt: segmentEndDate,
                        durationSeconds: newDuration > 0 ? newDuration : session.durationSeconds,
                    })
                    .where(eq(sessions.id, job.sessionId));
            }
        }

        invalidateFrameCache(job.sessionId).catch(err => {
            logger.warn({ err, sessionId: job.sessionId }, 'Failed to invalidate frame cache during replay artifact recovery');
        });

        log.info({ sessionId: job.sessionId, artifactId: artifact.id, sizeBytes }, 'Recovered screenshot artifact counters');
        return;
    }

    if (job.kind === 'hierarchy') {
        await db.update(sessionMetrics)
            .set({
                hierarchySnapshotCount: sql`COALESCE(${sessionMetrics.hierarchySnapshotCount}, 0) + 1`,
            })
            .where(eq(sessionMetrics.sessionId, job.sessionId));

        log.info({ sessionId: job.sessionId, artifactId: artifact.id }, 'Recovered hierarchy artifact counters');
    }
}

/**
 * Process crashes artifact - insert crash records
 */
async function processCrashesArtifact(job: any, _session: any, projectId: string, s3ObjectKey: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const crashList = payload.crashes || (Array.isArray(payload) ? payload : [payload]);

    let crashSessionId = job.sessionId;
    if (payload.sessionId && payload.sessionId.length > 0) {
        crashSessionId = payload.sessionId;
        const [crashSession] = await db.select().from(sessions).where(eq(sessions.id, crashSessionId)).limit(1);
        if (!crashSession) {
            await db.insert(sessions).values({
                id: crashSessionId,
                projectId,
                status: 'processing',
                platform: 'ios',
            });
            await db.insert(sessionMetrics).values({ sessionId: crashSessionId });
        }
    }

    for (const crash of crashList) {
        // Extract device info from crash metadata
        const deviceMeta = crash.deviceMetadata || {};
        const deviceModel = deviceMeta.model || deviceMeta.deviceModel;
        const osVersion = deviceMeta.systemVersion || deviceMeta.osVersion;
        const appVersion = deviceMeta.appVersion;

        // Format stack trace as string for display
        // iOS sends as array of frame strings, Android sends as single string
        let stackTraceStr: string | null = null;
        if (crash.stackTrace) {
            if (Array.isArray(crash.stackTrace)) {
                stackTraceStr = crash.stackTrace.join('\n');
            } else if (typeof crash.stackTrace === 'string') {
                stackTraceStr = crash.stackTrace;
            }
        }

        await db.insert(crashes).values({
            sessionId: crashSessionId,
            projectId,
            timestamp: new Date(crash.timestamp || Date.now()),
            exceptionName: crash.exceptionName || 'Unknown Exception',
            reason: crash.reason,
            stackTrace: stackTraceStr,
            fingerprint: crash.fingerprint || null,
            s3ObjectKey,
            deviceMetadata: crash.deviceMetadata,
            status: 'open',
            occurrenceCount: 1
        });

        // Track as an issue for the Issues Feed
        trackCrashAsIssue({
            projectId,
            exceptionName: crash.exceptionName || 'Unknown Exception',
            reason: crash.reason,
            stackTrace: stackTraceStr || undefined,
            timestamp: new Date(crash.timestamp || Date.now()),
            sessionId: crashSessionId,
            deviceModel,
            osVersion,
            appVersion,
        }).catch(() => { }); // Fire and forget
    }

    // Update crash count in session metrics
    await db.update(sessionMetrics)
        .set({ crashCount: sql`${sessionMetrics.crashCount} + ${crashList.length} ` })
        .where(eq(sessionMetrics.sessionId, crashSessionId));


    // Update daily stats
    const period = new Date().toISOString().split('T')[0];
    await db.insert(appDailyStats).values({
        projectId,
        date: period as any,
        totalCrashes: crashList.length
    }).onConflictDoUpdate({
        target: [appDailyStats.projectId, appDailyStats.date],
        set: { totalCrashes: sql`${appDailyStats.totalCrashes} + ${crashList.length} ` }
    });

    log.debug({ crashCount: crashList.length }, 'Crashes artifact processed');
}

/**
 * Process ANRs artifact - insert ANR records
 */
async function processAnrsArtifact(job: any, _session: any, projectId: string, s3ObjectKey: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const anrList = payload.anrs || (Array.isArray(payload) ? payload : [payload]);

    let anrSessionId = job.sessionId;
    if (payload.sessionId && payload.sessionId.length > 0) {
        anrSessionId = payload.sessionId;
        const [anrSession] = await db.select().from(sessions).where(eq(sessions.id, anrSessionId)).limit(1);
        if (!anrSession) {
            const inferredPlatform =
                (anrList?.[0]?.platform as string | undefined) ||
                (payload.platform as string | undefined) ||
                'unknown';
            await db.insert(sessions).values({
                id: anrSessionId,
                projectId,
                status: 'processing',
                platform: inferredPlatform,
            });
            await db.insert(sessionMetrics).values({ sessionId: anrSessionId });
        }
    }

    for (const anr of anrList) {
        // Extract device info from ANR metadata
        const deviceMeta = anr.deviceMetadata || {};
        const deviceModel = deviceMeta.model || deviceMeta.deviceModel;
        const osVersion = deviceMeta.systemVersion || deviceMeta.osVersion;
        const appVersion = deviceMeta.appVersion;

        await db.insert(anrs).values({
            sessionId: anrSessionId,
            projectId,
            timestamp: new Date(anr.timestamp || Date.now()),
            durationMs: anr.durationMs || 5000,
            threadState: anr.threadState,
            s3ObjectKey,
            deviceMetadata: anr.deviceMetadata,
            status: 'open',
            occurrenceCount: 1
        });

        // Track as an issue for the Issues Feed
        trackANRAsIssue({
            projectId,
            durationMs: anr.durationMs || 5000,
            threadState: anr.threadState,
            timestamp: new Date(anr.timestamp || Date.now()),
            sessionId: anrSessionId,
            deviceModel,
            osVersion,
            appVersion,
        }).catch(() => { }); // Fire and forget
    }

    // Ensure session_metrics row exists (upsert pattern)
    await db.insert(sessionMetrics).values({
        sessionId: anrSessionId,
    }).onConflictDoNothing();

    // Update ANR count in session metrics
    const updateResult = await db.update(sessionMetrics)
        .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + ${anrList.length} ` })
        .where(eq(sessionMetrics.sessionId, anrSessionId));

    log.info({ anrSessionId, anrCount: anrList.length, updateResult }, 'Updated session_metrics anrCount');


    // Update daily stats
    const period = new Date().toISOString().split('T')[0];
    await db.insert(appDailyStats).values({
        projectId,
        date: period as any,
        totalAnrs: anrList.length
    }).onConflictDoUpdate({
        target: [appDailyStats.projectId, appDailyStats.date],
        set: { totalAnrs: sql`COALESCE(${appDailyStats.totalAnrs}, 0) + ${anrList.length} ` }
    });

    log.info({ anrCount: anrList.length, anrSessionId, projectId }, 'ANRs artifact processed');
}

/**
 * Poll and process jobs
 */
// Track heartbeat timing
let lastHeartbeatAt = 0;
const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute

async function sendHeartbeat(): Promise<void> {
    const now = Date.now();
    if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeatAt = now;

    try {
        const queueHealth = await checkQueueHealth();
        const message = `pending = ${queueHealth.pendingJobs}, dlq = ${queueHealth.dlqJobs} `;
        await pingWorker('ingestWorker', 'up', message);
    } catch (err) {
        logger.debug({ err }, 'Failed to send heartbeat');
    }
}

async function pollJobs(): Promise<void> {
    while (isRunning) {
        try {
            // Send heartbeat
            await sendHeartbeat();

            const jobs = await db
                .select()
                .from(ingestJobs)
                .where(
                    and(
                        eq(ingestJobs.status, 'pending'),
                        or(
                            isNull(ingestJobs.nextRunAt),
                            lte(ingestJobs.nextRunAt, new Date())
                        )
                    )
                )
                .orderBy(asc(ingestJobs.createdAt))
                .limit(BATCH_SIZE);

            if (jobs.length > 0) {
                logger.info({ count: jobs.length }, 'Processing ingest jobs');
                const seenSessionIds = new Set<string>();
                const runnableJobs = jobs.filter((job) => {
                    const key = job.sessionId || `job:${job.id}`;
                    if (seenSessionIds.has(key)) return false;
                    seenSessionIds.add(key);
                    return true;
                });

                let cursor = 0;
                const workerCount = Math.max(1, Math.min(JOB_PROCESS_CONCURRENCY, runnableJobs.length));

                async function workerLoop() {
                    while (isRunning && cursor < runnableJobs.length) {
                        const idx = cursor++;
                        await processArtifactJob(runnableJobs[idx]);
                    }
                }

                await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
            }

            // Primary close path: finalize sessions that have uploads completed but never
            // received /session/end from a clean app shutdown.
            await autoFinalizeIfDue();

            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        } catch (err) {
            logger.error({ err }, 'Error polling ingest jobs');
            await pingWorker('ingestWorker', 'down', String(err)).catch(() => { });
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}

// Graceful shutdown
async function shutdown(signal: string) {
    logger.info({ signal }, 'Ingest worker shutting down...');
    isRunning = false;
    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start worker
logger.info('🔄 Ingest worker started (optimized)');
pollJobs().catch((err) => {
    logger.error({ err }, 'Ingest worker fatal error');
    process.exit(1);
});
