/**
 * Demo Routes
 * 
 * Public demo endpoints for showcasing the dashboard without authentication.
 * Only the specified DEMO_SESSION_ID can be accessed through these endpoints.
 */

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, sessions, sessionMetrics, projects, recordingArtifacts, crashes } from '../db/client.js';
import { getSignedDownloadUrlForProject } from '../db/s3.js';
import { logger } from '../logger.js';
import { asyncHandler } from '../middleware/index.js';
import { generateAnonymousName } from '../utils/anonymousName.js';

const router = Router();

// Demo session ID - Replace this with a real session ID from your database
// This session should showcase interesting user behavior (taps, scrolls, errors, etc.)
const DEMO_SESSION_ID = process.env.DEMO_SESSION_ID || 'demo-session-placeholder';
const DEMO_PROJECT_NAME = 'ShopFlow Mobile';

/**
 * Get demo session details
 * GET /api/demo/session
 * 
 * Public endpoint - no auth required
 * Returns session data and signed S3 URL for the hardcoded demo session
 */
router.get(
    '/session',
    asyncHandler(async (_req, res) => {
        // Get the demo session
        const [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
                project: projects
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
            .leftJoin(projects, eq(projects.id, sessions.projectId))
            .where(eq(sessions.id, DEMO_SESSION_ID))
            .limit(1);

        if (!sessionResult) {
            // Return mock demo data if no real demo session is configured
            logger.warn('Demo session not found, returning mock data');
            res.json({
                session: createMockDemoSession(),
                artifactUrl: null,
                isPlaceholder: true
            });
            return;
        }

        const { session, metrics, project } = sessionResult;

        // Get recording artifacts
        const artifactsList = await db
            .select()
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, session.id),
                eq(recordingArtifacts.status, 'ready')
            ));

        // Generate signed URL for the main artifact using project's endpoint
        let artifactUrl: string | null = null;

        if (artifactsList.length > 0) {
            const mainArtifact = artifactsList.find(a => a.kind === 'screenshots') || artifactsList[0];
            try {
                artifactUrl = await getSignedDownloadUrlForProject(session.projectId, mainArtifact.s3ObjectKey, 3600);
            } catch (err) {
                logger.error({ err }, 'Failed to generate signed URL for demo session');
            }
        }

        // Get session crashes for demo
        const sessionCrashes = await db
            .select()
            .from(crashes)
            .where(eq(crashes.sessionId, session.id));

        // Return session data
        res.json({
            session: {
                id: session.id,
                projectId: session.projectId,
                projectName: project?.name || DEMO_PROJECT_NAME,
                userId: session.userDisplayId || null,
                anonymousId: session.anonymousHash,
                deviceId: session.deviceId,
                anonymousDisplayName: session.deviceId && !session.userDisplayId ? generateAnonymousName(session.deviceId) : null,
                platform: session.platform,
                appVersion: session.appVersion,
                osVersion: session.osVersion,
                deviceModel: session.deviceModel,
                startedAt: session.startedAt.toISOString(),
                endedAt: session.endedAt?.toISOString(),
                durationSeconds: session.durationSeconds,
                status: session.status,
                geoLocation: session.geoCity ? {
                    city: session.geoCity,
                    region: session.geoRegion,
                    country: session.geoCountry,
                    countryCode: session.geoCountryCode,
                    latitude: session.geoLatitude,
                    longitude: session.geoLongitude
                } : null,
                stats: {
                    duration: String(session.durationSeconds ?? 0),
                    eventCount: metrics?.totalEvents ?? 0,
                    touchCount: metrics?.touchCount ?? 0,
                    scrollCount: metrics?.scrollCount ?? 0,
                    rageTapCount: metrics?.rageTapCount ?? 0,
                    api: {
                        total: metrics?.apiTotalCount ?? 0,
                        successful: metrics?.apiSuccessCount ?? 0,
                        failed: metrics?.apiErrorCount ?? 0,
                        avgDuration: metrics?.apiAvgResponseMs ?? 0
                    }
                },
                crashes: sessionCrashes.map(c => ({
                    id: c.id,
                    timestamp: c.timestamp.toISOString(),
                    exceptionName: c.exceptionName,
                    reason: c.reason,
                    status: c.status
                }))
            },
            artifactUrl,
            artifacts: artifactsList.map(a => ({
                id: a.id,
                kind: a.kind,
                status: a.status
            })),
            isPlaceholder: false
        });
    })
);

/**
 * Get demo session screenshot artifact
 * GET /api/demo/session/artifact
 *
 * Redirects to signed S3 URL for the demo session's screenshot archive.
 */
router.get(
    '/session/artifact',
    asyncHandler(async (_req, res) => {
        // Get demo session to retrieve its projectId
        const [sessionResult] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, DEMO_SESSION_ID))
            .limit(1);

        if (!sessionResult) {
            res.status(404).json({ error: 'Demo session not found' });
            return;
        }

        const artifactsList = await db
            .select()
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, DEMO_SESSION_ID),
                eq(recordingArtifacts.status, 'ready'),
                eq(recordingArtifacts.kind, 'screenshots')
            ));

        if (artifactsList.length === 0) {
            res.status(404).json({ error: 'Demo session artifact not found' });
            return;
        }

        try {
            const signedUrl = await getSignedDownloadUrlForProject(sessionResult.projectId, artifactsList[0].s3ObjectKey, 3600);
            if (!signedUrl) {
                res.status(503).json({ error: 'S3 not configured' });
                return;
            }
            res.redirect(signedUrl);
        } catch (err) {
            logger.error({ err }, 'Failed to generate signed URL for demo artifact');
            res.status(500).json({ error: 'Failed to generate artifact URL' });
        }
    })
);

/**
 * Create mock demo session data when no real demo session is configured
 */
function createMockDemoSession() {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    return {
        id: 'demo-mock-session',
        projectId: 'demo-project',
        projectName: DEMO_PROJECT_NAME,
        userId: 'demo-user-001',
        anonymousId: null,
        deviceId: 'demo-device-001',
        anonymousDisplayName: null, // Has userId, so no anonymous name
        platform: 'ios',
        appVersion: '2.1.0',
        osVersion: '17.2',
        deviceModel: 'iPhone 15 Pro',
        startedAt: thirtyMinutesAgo.toISOString(),
        endedAt: now.toISOString(),
        durationSeconds: 1800,
        status: 'completed',
        geoLocation: {
            city: 'Austin',
            region: 'Texas',
            country: 'United States',
            countryCode: 'US',
            latitude: 30.2672,
            longitude: -97.7431
        },
        stats: {
            duration: '1800',
            eventCount: 156,
            touchCount: 89,
            scrollCount: 34,
            rageTapCount: 3,
            api: {
                total: 47,
                successful: 44,
                failed: 3,
                avgDuration: 245
            }
        },
        crashes: [{
            id: 'demo-crash-001',
            timestamp: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
            exceptionName: 'PaymentProcessingError',
            reason: 'Invalid card number format',
            status: 'open'
        }]
    };
}

export default router;
