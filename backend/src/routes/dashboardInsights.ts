/**
 * Dashboard Insights Routes
 * 
 * Provides quantitative insight endpoints for the dashboard.
 * Transforms raw session telemetry into ranked, comparable metrics.
 */

import { Router } from 'express';
import { eq, gte, lte, and, desc, asc, inArray } from 'drizzle-orm';
import { db, sessions, sessionMetrics, projects, teamMembers, appDailyStats, recordingArtifacts, screenTouchHeatmaps, apiEndpointDailyStats } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { asyncHandler, ApiError } from '../middleware/index.js';
import { logger } from '../logger.js';
import { sessionAuth } from '../middleware/auth.js';

const router = Router();
const redis = getRedis();
const CACHE_TTL = 180; // 3 minutes for insights

/**
 * Returns the last date (YYYY-MM-DD) for which daily rollups are guaranteed
 * to have completed. This is derived from the `stats:daily_rollup:last_run`
 * marker written by the statsAggregator job and falls back to "yesterday"
 * if the marker is missing or invalid.
 */
async function getLastRolledUpDate(): Promise<string> {
    try {
        const lastRun = await redis.get('stats:daily_rollup:last_run');
        if (lastRun) {
            const parsed = new Date(lastRun);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString().split('T')[0];
            }
        }
    } catch (err) {
        logger.warn({ err }, 'Failed to read last daily rollup time from Redis (insights)');
    }

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    return yesterday.toISOString().split('T')[0];
}

// Helper to get time filter
function getTimeFilter(timeRange?: string): Date | undefined {
    if (!timeRange || timeRange === 'all') return undefined;
    const now = new Date();
    const days = timeRange === '1h' ? 1 / 24 :
        timeRange === '24h' ? 1 :
            timeRange === '7d' ? 7 :
                timeRange === '14d' ? 14 :
                    timeRange === '30d' ? 30 :
                        timeRange === '90d' ? 90 : undefined;
    if (days) {
        now.setTime(now.getTime() - days * 24 * 60 * 60 * 1000);
        return now;
    }
    return undefined;
}

// Helper to verify project access
async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
    const [project] = await db
        .select({ teamId: projects.teamId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) return false;

    const [membership] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(
            eq(teamMembers.teamId, project.teamId),
            eq(teamMembers.userId, userId)
        ))
        .limit(1);

    return !!membership;
}

// Helper to get accessible project IDs
async function getAccessibleProjectIds(userId: string): Promise<string[]> {
    const membership = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId));

    const teamIds = membership.map(m => m.teamId);
    if (teamIds.length === 0) return [];

    const accessibleProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.teamId, teamIds));

    return accessibleProjects.map(p => p.id);
}

/**
 * GET /api/insights/friction-heatmap
 * 
 * Screens ranked by friction (rage taps, errors, exits)
 */
router.get(
    '/friction-heatmap',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange, realtime } = req.query;
        const isRealtime = realtime === 'true';

        const projectIds = projectId
            ? [projectId as string]
            : await getAccessibleProjectIds(req.user!.id);

        if (projectIds.length === 0) {
            res.json({ screens: [] });
            return;
        }

        if (projectId && !(await verifyProjectAccess(projectId as string, req.user!.id))) {
            throw ApiError.forbidden('Access denied');
        }

        const cacheKey = `insights:friction:${projectIds.sort().join(',')}:${isRealtime ? 'realtime' : (timeRange || '7d')}`;

        // For realtime, use shorter cache TTL
        if (!isRealtime) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                res.json(JSON.parse(cached));
                return;
            }
        }

        // For realtime mode, use fixed 30-minute window; otherwise use timeRange
        let startedAfter: Date | undefined;
        if (isRealtime) {
            startedAfter = new Date(Date.now() - 30 * 60 * 1000); // Last 30 minutes
        } else {
            startedAfter = getTimeFilter(timeRange as string || '7d');
        }

        // Get session data with screens visited
        const conditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));

        const sessionData = await db
            .select({
                id: sessions.id,
                metrics: sessionMetrics
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .limit(5000);

        // Aggregate per-screen exposure from observed session paths.
        const screenStats: Record<string, {
            visits: number;
            approxRageTaps: number;
            errors: number;
            exits: number;
            sessionIds: string[];
        }> = {};

        for (const s of sessionData) {
            const screensVisited = s.metrics?.screensVisited || [];
            const lastScreen = screensVisited[screensVisited.length - 1];

            for (const screen of screensVisited) {
                if (!screenStats[screen]) {
                    screenStats[screen] = { visits: 0, approxRageTaps: 0, errors: 0, exits: 0, sessionIds: [] };
                }
                screenStats[screen].visits++;

                // Error/rage are tracked per session. Use proportional distribution as fallback,
                // but prefer real per-screen rage from touch heatmap rows below.
                const perScreenRage = Math.ceil((s.metrics?.rageTapCount || 0) / Math.max(screensVisited.length, 1));
                const perScreenErrors = Math.ceil((s.metrics?.errorCount || 0) / Math.max(screensVisited.length, 1));

                screenStats[screen].approxRageTaps += perScreenRage;
                screenStats[screen].errors += perScreenErrors;

                if (screenStats[screen].sessionIds.length < 20) {
                    screenStats[screen].sessionIds.push(s.id);
                }
            }

            // Track exit screen
            if (lastScreen && screenStats[lastScreen]) {
                screenStats[lastScreen].exits++;
            }
        }

        // Keep the candidate set bounded before joining with heatmap rows.
        const candidateScreens = Object.entries(screenStats)
            .sort((a, b) => b[1].visits - a[1].visits)
            .slice(0, 60);

        // Batch query to find screenshot artifacts for any of the sessions in the top screens
        // Collect all candidate session IDs (flattened)
        const allSessionIds = candidateScreens.flatMap(([, s]) => s.sessionIds);
        const uniqueSessionIds = [...new Set(allSessionIds)];

        logger.info({
            screenCount: candidateScreens.length,
            uniqueSessionCount: uniqueSessionIds.length
        }, 'Searching for screenshot artifacts for heatmap screens');

        // Get available screenshot artifacts for these sessions
        // We only need one valid frame per session to check availability
        const frameArtifacts = uniqueSessionIds.length > 0
            ? await db
                .select({
                    id: recordingArtifacts.id,
                    sessionId: recordingArtifacts.sessionId,
                })
                .from(recordingArtifacts)
                .where(and(
                    inArray(recordingArtifacts.sessionId, uniqueSessionIds),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready')
                ))
                // Limit strictly to avoid massive results, but enough to cover screens
                .limit(2000)
            : [];

        logger.info({
            foundArtifactCount: frameArtifacts.length
        }, 'Found screenshot artifacts for heatmap');

        // Map session IDs to their frame artifact ID
        const sessionFrameMap = new Map<string, string>();
        for (const artifact of frameArtifacts) {
            // Just take the first one found for each session
            if (!sessionFrameMap.has(artifact.sessionId)) {
                sessionFrameMap.set(artifact.sessionId, artifact.id);
            }
        }

        // Query touch heatmap data for candidate screens.
        const screenNames = candidateScreens.map(([name]) => name);
        const heatmapData = screenNames.length > 0
            ? await db
                .select({
                    screenName: screenTouchHeatmaps.screenName,
                    touchBuckets: screenTouchHeatmaps.touchBuckets,
                    rageTapBuckets: screenTouchHeatmaps.rageTapBuckets,
                    totalTouches: screenTouchHeatmaps.totalTouches,
                    totalRageTaps: screenTouchHeatmaps.totalRageTaps,
                    sampleSessionId: screenTouchHeatmaps.sampleSessionId,
                })
                .from(screenTouchHeatmaps)
                .where(and(
                    inArray(screenTouchHeatmaps.projectId, projectIds),
                    inArray(screenTouchHeatmaps.screenName, screenNames),
                    startedAfter ? gte(screenTouchHeatmaps.date, startedAfter.toISOString().split('T')[0] as any) : undefined
                ))
            : [];

        // Aggregate heatmap data by screen (combine multiple days)
        const screenHeatmapMap = new Map<string, {
            touchBuckets: Record<string, number>;
            rageTapBuckets: Record<string, number>;
            totalTouches: number;
            totalRageTaps: number;
            sampleSessionId: string | null;
        }>();

        for (const row of heatmapData) {
            const existing = screenHeatmapMap.get(row.screenName);
            if (existing) {
                // Merge buckets
                const touchB = row.touchBuckets as Record<string, number> || {};
                const rageB = row.rageTapBuckets as Record<string, number> || {};
                for (const [key, val] of Object.entries(touchB)) {
                    existing.touchBuckets[key] = (existing.touchBuckets[key] || 0) + val;
                }
                for (const [key, val] of Object.entries(rageB)) {
                    existing.rageTapBuckets[key] = (existing.rageTapBuckets[key] || 0) + val;
                }
                existing.totalTouches += row.totalTouches;
                existing.totalRageTaps += row.totalRageTaps;
            } else {
                screenHeatmapMap.set(row.screenName, {
                    touchBuckets: { ...(row.touchBuckets as Record<string, number> || {}) },
                    rageTapBuckets: { ...(row.rageTapBuckets as Record<string, number> || {}) },
                    totalTouches: row.totalTouches,
                    totalRageTaps: row.totalRageTaps,
                    sampleSessionId: row.sampleSessionId,
                });
            }
        }

        const scoredScreens = candidateScreens
            .map(([name, stats]) => {
                const heatmap = screenHeatmapMap.get(name);
                const rageTaps = Math.max(stats.approxRageTaps, heatmap?.totalRageTaps || 0);
                const visits = stats.visits;
                const exitRate = visits > 0 ? (stats.exits / visits) * 100 : 0;
                const rageTapRatePer100 = visits > 0 ? (rageTaps / visits) * 100 : 0;
                const errorRatePer100 = visits > 0 ? (stats.errors / visits) * 100 : 0;
                const incidentRatePer100 = rageTapRatePer100 + errorRatePer100;
                const impactScore = Number(
                    ((incidentRatePer100 * 0.7 + exitRate * 0.3) * Math.log10(visits + 9)).toFixed(1)
                );
                const estimatedAffectedSessions = Math.min(
                    visits,
                    Math.round(
                        visits * Math.min(0.95, (incidentRatePer100 / 100) + ((exitRate / 100) * 0.35))
                    )
                );

                const signalStats = [
                    { key: 'rage_taps', value: rageTapRatePer100 },
                    { key: 'errors', value: errorRatePer100 },
                    { key: 'exits', value: exitRate },
                ].sort((a, b) => b.value - a.value);

                const topSignal = signalStats[0];
                const runnerUpSignal = signalStats[1];
                const primarySignal = topSignal.value - runnerUpSignal.value < 2
                    ? 'mixed'
                    : topSignal.key;

                const confidence = visits >= 150 ? 'high' : visits >= 50 ? 'medium' : 'low';

                return {
                    name,
                    visits,
                    rageTaps,
                    errors: stats.errors,
                    exitRate: Number(exitRate.toFixed(1)),
                    frictionScore: impactScore,
                    impactScore,
                    rageTapRatePer100: Number(rageTapRatePer100.toFixed(1)),
                    errorRatePer100: Number(errorRatePer100.toFixed(1)),
                    estimatedAffectedSessions,
                    primarySignal,
                    confidence,
                    sessionIds: stats.sessionIds.slice(0, 10),
                };
            })
            .sort((a, b) => b.impactScore - a.impactScore)
            .slice(0, 15);

        // Helper to convert bucket data to hotspot array
        const bucketsToHotspots = (
            touchBuckets: Record<string, number>,
            rageTapBuckets: Record<string, number>
        ): Array<{ x: number; y: number; intensity: number; isRageTap: boolean }> => {
            const hotspots: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }> = [];
            const maxCount = Math.max(1, ...Object.values(touchBuckets));

            for (const [bucket, count] of Object.entries(touchBuckets)) {
                const [xStr, yStr] = bucket.split(',');
                const x = parseFloat(xStr);
                const y = parseFloat(yStr);
                if (!isNaN(x) && !isNaN(y)) {
                    const isRageTap = (rageTapBuckets[bucket] || 0) > 0;
                    hotspots.push({
                        x,
                        y,
                        intensity: Math.min(1, count / maxCount),
                        isRageTap,
                    });
                }
            }

            return hotspots;
        };

        // Build final response with frame URLs and touch hotspots
        const screens = scoredScreens.map((screen) => {
            let screenshotUrl: string | null = null;

            // Find a session that has screenshot artifacts for getting screen screenshot
            for (const sessionId of screen.sessionIds) {
                const artifactId = sessionFrameMap.get(sessionId);
                if (artifactId) {
                    screenshotUrl = `/api/session/thumbnail/${sessionId}`;
                    break; // Found one!
                }
            }

            // Get touch hotspot data for this screen
            const heatmap = screenHeatmapMap.get(screen.name);
            const touchHotspots = heatmap
                ? bucketsToHotspots(heatmap.touchBuckets, heatmap.rageTapBuckets)
                : [];

            // If no screenshot from artifacts but we have heatmap data with a sample session, try that
            if (!screenshotUrl && heatmap?.sampleSessionId) {
                const artifactId = sessionFrameMap.get(heatmap.sampleSessionId);
                if (artifactId) {
                    screenshotUrl = `/api/session/thumbnail/${heatmap.sampleSessionId}`;
                }
            }

            return {
                name: screen.name,
                visits: screen.visits,
                rageTaps: screen.rageTaps,
                errors: screen.errors,
                exitRate: screen.exitRate,
                frictionScore: screen.frictionScore,
                impactScore: screen.impactScore,
                rageTapRatePer100: screen.rageTapRatePer100,
                errorRatePer100: screen.errorRatePer100,
                estimatedAffectedSessions: screen.estimatedAffectedSessions,
                primarySignal: screen.primarySignal,
                confidence: screen.confidence,
                sessionIds: screen.sessionIds,
                screenshotUrl,
                touchHotspots,
            };
        });

        const response = { screens };

        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

        // Force browser to bypass cache
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        res.json(response);
    })
);

/**
 * GET /api/insights/alltime-heatmap
 * 
 * All-time aggregated touch heatmaps from the screen_touch_heatmaps table.
 * Independent of time filter - aggregates all historical touch data.
 * Cached for 5 minutes for performance.
 */
router.get(
    '/alltime-heatmap',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.query;

        const projectIds = projectId
            ? [projectId as string]
            : await getAccessibleProjectIds(req.user!.id);

        if (projectIds.length === 0) {
            res.json({ screens: [], lastUpdated: new Date().toISOString() });
            return;
        }

        if (projectId && !(await verifyProjectAccess(projectId as string, req.user!.id))) {
            throw ApiError.forbidden('Access denied');
        }

        const cacheKey = `insights:alltime-heatmap:${projectIds.sort().join(',')}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Query all heatmap data from screen_touch_heatmaps (no date filter - all time)
        const heatmapData = await db
            .select({
                screenName: screenTouchHeatmaps.screenName,
                touchBuckets: screenTouchHeatmaps.touchBuckets,
                rageTapBuckets: screenTouchHeatmaps.rageTapBuckets,
                totalTouches: screenTouchHeatmaps.totalTouches,
                totalRageTaps: screenTouchHeatmaps.totalRageTaps,
                sampleSessionId: screenTouchHeatmaps.sampleSessionId,
                screenFirstSeenMs: screenTouchHeatmaps.screenFirstSeenMs,
            })
            .from(screenTouchHeatmaps)
            .where(inArray(screenTouchHeatmaps.projectId, projectIds));

        // Aggregate heatmap data by screen (combine all days)
        const screenHeatmapMap = new Map<string, {
            touchBuckets: Record<string, number>;
            rageTapBuckets: Record<string, number>;
            totalTouches: number;
            totalRageTaps: number;
            sampleSessionId: string | null;
            screenFirstSeenMs: number | null;
        }>();

        for (const row of heatmapData) {
            const existing = screenHeatmapMap.get(row.screenName);
            if (existing) {
                // Merge buckets
                const touchB = row.touchBuckets as Record<string, number> || {};
                const rageB = row.rageTapBuckets as Record<string, number> || {};
                for (const [key, val] of Object.entries(touchB)) {
                    existing.touchBuckets[key] = (existing.touchBuckets[key] || 0) + val;
                }
                for (const [key, val] of Object.entries(rageB)) {
                    existing.rageTapBuckets[key] = (existing.rageTapBuckets[key] || 0) + val;
                }
                existing.totalTouches += row.totalTouches;
                existing.totalRageTaps += row.totalRageTaps;
                // Keep most recent sample session and its timestamp
                if (row.sampleSessionId) {
                    existing.sampleSessionId = row.sampleSessionId;
                    existing.screenFirstSeenMs = row.screenFirstSeenMs;
                }
            } else {
                screenHeatmapMap.set(row.screenName, {
                    touchBuckets: { ...(row.touchBuckets as Record<string, number> || {}) },
                    rageTapBuckets: { ...(row.rageTapBuckets as Record<string, number> || {}) },
                    totalTouches: row.totalTouches,
                    totalRageTaps: row.totalRageTaps,
                    sampleSessionId: row.sampleSessionId,
                    screenFirstSeenMs: row.screenFirstSeenMs,
                });
            }
        }

        // Get unique sample session IDs for screenshot lookup
        const sampleSessionIds = Array.from(screenHeatmapMap.values())
            .filter(s => s.sampleSessionId)
            .map(s => s.sampleSessionId as string);
        const uniqueSessionIds = [...new Set(sampleSessionIds)].slice(0, 100);

        logger.info({
            sampleSessionIdsCount: sampleSessionIds.length,
            uniqueSessionIdsCount: uniqueSessionIds.length,
            uniqueSessionIds: uniqueSessionIds.slice(0, 10), // First 10 for logging
        }, '[alltime-heatmap] Sample session IDs from heatmap data');

        // First, try to get artifacts for sample session IDs
        const sampleFrameArtifacts = uniqueSessionIds.length > 0
            ? await db
                .select({
                    id: recordingArtifacts.id,
                    sessionId: recordingArtifacts.sessionId,
                    kind: recordingArtifacts.kind,
                    status: recordingArtifacts.status,
                })
                .from(recordingArtifacts)
                .where(and(
                    inArray(recordingArtifacts.sessionId, uniqueSessionIds),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready')
                ))
                .limit(500)
            : [];

        logger.info({
            artifactsFound: sampleFrameArtifacts.length,
            artifacts: sampleFrameArtifacts.map(a => ({ sessionId: a.sessionId, id: a.id, kind: a.kind, status: a.status })),
        }, '[alltime-heatmap] Screenshot artifacts found for sample sessions');

        // Map session IDs to their frame artifact availability
        const sessionFrameMap = new Map<string, boolean>();
        for (const artifact of sampleFrameArtifacts) {
            sessionFrameMap.set(artifact.sessionId, true);
        }

        logger.info({
            sessionFrameMapSize: sessionFrameMap.size,
            sessionsWithArtifacts: Array.from(sessionFrameMap.keys()),
        }, '[alltime-heatmap] Session frame map populated');

        // For screens without valid sample sessions, find recent sessions that visited those screens
        const screenNames = Array.from(screenHeatmapMap.keys());
        const screenSessionMap = new Map<string, string[]>();

        // Query recent sessions that have screenshot artifacts and visited these screens
        if (screenNames.length > 0) {
            // Find recent sessions with ready screenshot artifacts for these projects
            // Note: screensVisited is on sessionMetrics, not sessions
            const recentSessionsWithScreenshots = await db
                .select({
                    sessionId: sessions.id,
                    screensVisited: sessionMetrics.screensVisited,
                })
                .from(sessions)
                .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .innerJoin(recordingArtifacts, and(
                    eq(recordingArtifacts.sessionId, sessions.id),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready')
                ))
                .where(inArray(sessions.projectId, projectIds))
                .orderBy(desc(sessions.createdAt))
                .limit(500);

            // Map each screen to sessions that visited it (with valid screenshots)
            for (const row of recentSessionsWithScreenshots) {
                const visited = row.screensVisited || [];
                for (const screen of visited) {
                    if (screenNames.includes(screen)) {
                        if (!screenSessionMap.has(screen)) {
                            screenSessionMap.set(screen, []);
                        }
                        const arr = screenSessionMap.get(screen)!;
                        if (arr.length < 5 && !arr.includes(row.sessionId)) {
                            arr.push(row.sessionId);
                        }
                        // Also mark as available
                        sessionFrameMap.set(row.sessionId, true);
                    }
                }
            }
        }

        // Helper to convert bucket data to hotspot array
        const bucketsToHotspots = (
            touchBuckets: Record<string, number>,
            rageTapBuckets: Record<string, number>
        ): Array<{ x: number; y: number; intensity: number; isRageTap: boolean }> => {
            const hotspots: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }> = [];
            const maxCount = Math.max(1, ...Object.values(touchBuckets));

            for (const [bucket, count] of Object.entries(touchBuckets)) {
                const [xStr, yStr] = bucket.split(',');
                const x = parseFloat(xStr);
                const y = parseFloat(yStr);
                if (!isNaN(x) && !isNaN(y)) {
                    const isRageTap = (rageTapBuckets[bucket] || 0) > 0;
                    hotspots.push({
                        x,
                        y,
                        intensity: Math.min(1, count / maxCount),
                        isRageTap,
                    });
                }
            }

            return hotspots;
        };

        // Build response
        const screens = Array.from(screenHeatmapMap.entries())
            .map(([screenName, data]) => {
                let screenshotUrl: string | null = null;
                let screenshotSource = 'none';
                let timestampParam = '';

                // Add timestamp parameter if we have screen first seen time
                if (data.screenFirstSeenMs) {
                    timestampParam = `?ts=${data.screenFirstSeenMs}`;
                }

                // First, try sample session if it has screenshot artifacts
                if (data.sampleSessionId && sessionFrameMap.has(data.sampleSessionId)) {
                    screenshotUrl = `/api/session/thumbnail/${data.sampleSessionId}${timestampParam}`;
                    screenshotSource = 'sampleSession';
                }

                // Fallback: try sessions from screenSessionMap that visited this screen
                // Note: fallback sessions won't have the correct timestamp for this specific screen
                if (!screenshotUrl) {
                    const fallbackSessions = screenSessionMap.get(screenName) || [];
                    for (const sessionId of fallbackSessions) {
                        if (sessionFrameMap.has(sessionId)) {
                            // Fallback sessions don't have screen-specific timestamp, use default
                            screenshotUrl = `/api/session/thumbnail/${sessionId}`;
                            screenshotSource = 'fallbackSession';
                            break;
                        }
                    }
                }

                logger.info({
                    screenName,
                    sampleSessionId: data.sampleSessionId,
                    screenFirstSeenMs: data.screenFirstSeenMs,
                    hasSampleInFrameMap: data.sampleSessionId ? sessionFrameMap.has(data.sampleSessionId) : false,
                    screenshotUrl,
                    screenshotSource,
                }, '[alltime-heatmap] Screenshot URL assignment for screen');

                const touchHotspots = bucketsToHotspots(data.touchBuckets, data.rageTapBuckets);

                return {
                    name: screenName,
                    visits: data.totalTouches,
                    rageTaps: data.totalRageTaps,
                    errors: 0, // Not tracked in touch heatmaps
                    exitRate: 0, // Not available
                    frictionScore: data.totalRageTaps * 3,
                    screenshotUrl,
                    touchHotspots,
                };
            })
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 15); // Top 15 screens

        logger.info({
            totalScreens: screens.length,
            screensWithUrls: screens.filter(s => s.screenshotUrl).length,
            screensWithoutUrls: screens.filter(s => !s.screenshotUrl).length,
            screenSummary: screens.map(s => ({ name: s.name, screenshotUrl: s.screenshotUrl })),
        }, '[alltime-heatmap] Final response summary');

        const response = {
            screens,
            lastUpdated: new Date().toISOString(),
        };

        // Cache for 5 minutes (all-time data doesn't change frequently)
        await redis.set(cacheKey, JSON.stringify(response), 'EX', 300);

        res.json(response);
    })
);


/**
 * GET /api/insights/trends
 * 
 * Session quality trends over time (for charts)
 */
router.get(
    '/trends',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        const projectIds = projectId
            ? [projectId as string]
            : await getAccessibleProjectIds(req.user!.id);

        if (projectIds.length === 0) {
            res.json({ daily: [] });
            return;
        }

        if (projectId && !(await verifyProjectAccess(projectId as string, req.user!.id))) {
            throw ApiError.forbidden('Access denied');
        }

        const normalizedTimeRange = typeof timeRange === 'string' ? timeRange : undefined;

        // Redis caching for fast page loads
        const cacheKey = `insights:trends:${projectIds.sort().join(',')}:${normalizedTimeRange || '30d'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const days = normalizedTimeRange === '24h' ? 1
            : normalizedTimeRange === '7d' ? 7
                : normalizedTimeRange === '30d' ? 30
                    : normalizedTimeRange === '90d' ? 90
                        : undefined;

        // For bounded windows fetch extra 30 days to compute MAU.
        // "all" intentionally loads the full available timeline.
        let startStr: string | undefined;
        let queryStartStr: string | undefined;
        if (typeof days === 'number') {
            const extendedDays = days + 30;
            const start = new Date();
            start.setDate(start.getDate() - extendedDays);
            startStr = start.toISOString().split('T')[0];

            const queryStart = new Date();
            queryStart.setDate(queryStart.getDate() - days);
            queryStartStr = queryStart.toISOString().split('T')[0];
        }

        const lastRolledUpDate = await getLastRolledUpDate();

        const dailyConditions = [inArray(appDailyStats.projectId, projectIds), lte(appDailyStats.date, lastRolledUpDate)];
        if (startStr) {
            dailyConditions.push(gte(appDailyStats.date, startStr));
        }

        const stats = await db
            .select()
            .from(appDailyStats)
            .where(and(...dailyConditions))
            .orderBy(asc(appDailyStats.date));

        // Aggregate by date
        const dailyMap: Record<string, {
            sessions: number;
            crashes: number;
            rageTaps: number;
            deadTaps: number;
            avgUxScore: number;
            count: number;
            uniqueUserIds: Set<string>;
            dau: number;
            // NEW: Additional metrics for overview graphs
            avgApiResponseMs: number;
            apiErrorRate: number;
            avgDurationSeconds: number;
            errorCount: number;
            appVersionBreakdown: Record<string, number>;
            totalApiCalls: number; // NEW: Total API calls for the day
        }> = {};

        // First pass: Aggregate stats per day
        for (const s of stats) {
            const date = s.date;
            if (!dailyMap[date]) {
                dailyMap[date] = {
                    sessions: 0,
                    crashes: 0,
                    rageTaps: 0,
                    deadTaps: 0,
                    avgUxScore: 0,
                    count: 0,
                    uniqueUserIds: new Set<string>(),
                    dau: 0,
                    // NEW: Additional metrics for overview graphs
                    avgApiResponseMs: 0,
                    apiErrorRate: 0,
                    avgDurationSeconds: 0,
                    errorCount: 0,
                    appVersionBreakdown: {} as Record<string, number>,
                    totalApiCalls: 0,
                };
            }
            dailyMap[date].sessions += s.totalSessions;
            dailyMap[date].crashes += s.totalCrashes || 0;
            dailyMap[date].rageTaps += s.totalRageTaps || 0;
            dailyMap[date].deadTaps += s.totalDeadTaps || 0;
            dailyMap[date].avgUxScore += s.avgUxScore || 0;
            dailyMap[date].count++;
            // NEW: Aggregate additional metrics (weighted sum, divide later)
            dailyMap[date].avgApiResponseMs += (s.avgApiResponseMs || 0) * s.totalSessions;
            dailyMap[date].apiErrorRate += (s.avgApiErrorRate || 0) * s.totalSessions;
            dailyMap[date].avgDurationSeconds += (s.avgDurationSeconds || 0) * s.totalSessions;
            dailyMap[date].errorCount += s.totalErrors || 0;

            // Merge app version breakdown
            if (s.appVersionBreakdown) {
                for (const [version, count] of Object.entries(s.appVersionBreakdown)) {
                    dailyMap[date].appVersionBreakdown[version] = (dailyMap[date].appVersionBreakdown[version] || 0) + count;
                }
            }

            // Merge unique user IDs for DAU
            if (s.uniqueUserIds && Array.isArray(s.uniqueUserIds)) {
                (s.uniqueUserIds as string[]).forEach((uid: string) => dailyMap[date].uniqueUserIds.add(uid));
            }
        }

        const apiConditions = [inArray(apiEndpointDailyStats.projectId, projectIds)];
        if (startStr) {
            apiConditions.push(gte(apiEndpointDailyStats.date, startStr));
        }

        // Fetch API endpoint stats for total calls
        const apiStats = await db
            .select({
                date: apiEndpointDailyStats.date,
                totalCalls: apiEndpointDailyStats.totalCalls,
            })
            .from(apiEndpointDailyStats)
            .where(and(...apiConditions));

        // Merge API stats into dailyMap
        for (const s of apiStats) {
            const date = s.date;
            // Initialize day if it doesn't exist (e.g. only API calls, no sessions)
            if (!dailyMap[date]) {
                dailyMap[date] = {
                    sessions: 0,
                    crashes: 0,
                    rageTaps: 0,
                    deadTaps: 0,
                    avgUxScore: 0,
                    count: 0,
                    uniqueUserIds: new Set<string>(),
                    dau: 0,
                    avgApiResponseMs: 0,
                    apiErrorRate: 0,
                    avgDurationSeconds: 0,
                    errorCount: 0,
                    appVersionBreakdown: {} as Record<string, number>,
                    totalApiCalls: 0,
                };
            }
            dailyMap[date].totalApiCalls += Number(s.totalCalls);
        }

        // Calculate DAU for each day
        Object.values(dailyMap).forEach(day => {
            day.dau = day.uniqueUserIds.size;
        });

        // Convert to sorted array of all dates (including the buffer period)
        const allDates = Object.keys(dailyMap).sort();
        const dateIndex = new Map(allDates.map((date, index) => [date, index]));

        // Build final daily stats with MAU
        const daily = allDates
            .filter(date => !queryStartStr || date >= queryStartStr) // Only return requested range
            .map(date => {
                const data = dailyMap[date];

                // Calculate MAU: Sliding window of last 30 days ending on `date`
                const mauSet = new Set<string>();

                // Find index of current date
                const currentIndex = dateIndex.get(date) ?? 0;

                // Look back up to 30 days (or as far as we have data)
                // Since we fetched extra 30 days, we should have coverage
                for (let i = currentIndex; i >= 0; i--) {
                    const lookbackDate = allDates[i];
                    const daysDiff = (new Date(date).getTime() - new Date(lookbackDate).getTime()) / (1000 * 60 * 60 * 24);

                    if (daysDiff <= 30) {
                        // Add IDs from this past day
                        dailyMap[lookbackDate]?.uniqueUserIds.forEach(uid => mauSet.add(uid));
                    } else {
                        break;
                    }
                }

                // Weighted averages
                const totalSessions = Math.max(1, data.sessions);
                const avgApiResponseMs = Math.round(data.avgApiResponseMs / totalSessions);
                const apiErrorRate = data.apiErrorRate / totalSessions;
                const avgDurationSeconds = Math.round(data.avgDurationSeconds / totalSessions);

                // Calculate average UX score properly
                const avgUxScore = data.count > 0 ? Math.round(data.avgUxScore / data.count) : 0;

                return {
                    date,
                    sessions: data.sessions,
                    crashes: data.crashes,
                    rageTaps: data.rageTaps,
                    deadTaps: data.deadTaps,
                    avgUxScore: avgUxScore,
                    dau: data.dau,
                    mau: mauSet.size,
                    // NEW fields
                    avgApiResponseMs,
                    apiErrorRate,
                    avgDurationSeconds,
                    errorCount: data.errorCount,
                    appVersionBreakdown: data.appVersionBreakdown,
                    totalApiCalls: data.totalApiCalls, // Pass through
                };
            });

        const response = { daily };
        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

        // Force browser to bypass cache
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        res.json(response);
    })
);

export default router;
