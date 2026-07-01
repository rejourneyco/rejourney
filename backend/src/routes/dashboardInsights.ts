/**
 * Dashboard Insights Routes
 * 
 * Provides quantitative insight endpoints for the dashboard.
 * Transforms raw session telemetry into ranked, comparable metrics.
 */

import { Router } from 'express';
import { gunzipSync } from 'zlib';
import { eq, gte, and, desc, asc, inArray, sql, type SQL } from 'drizzle-orm';
import { db, sessions, sessionMetrics, projects, teamMembers, recordingArtifacts } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { downloadFromS3ForArtifact } from '../db/s3.js';
import { asyncHandler, ApiError } from '../middleware/index.js';
import { logger } from '../logger.js';
import { sessionAuth } from '../middleware/auth.js';
import { boundedTimeRangeToDays } from '../utils/analyticsTimeRange.js';
import { buildRetentionCohortRows } from '../services/retentionCohorts.js';
import {
    buildHeatmapScreenshotUrl,
    findHeatmapPreviewTimestampInEvents,
    type HeatmapPreviewEventEntry,
} from '../utils/heatmapPreview.js';
import { queryDailyApiCallsFromClickHouse } from '../services/apiEndpointStatsClickHouse.js';
import {
    queryProductDailyStatsFromClickHouse,
    queryScreenTouchHeatmapsFromClickHouse,
} from '../services/productRollupsClickHouse.js';
import { normalizeHeatmapScreenName, normalizeHeatmapScreenPath } from '../utils/heatmapScreens.js';

const router = Router();
const redis = getRedis();
const CACHE_TTL = 300; // 5 minutes - matches analytics, reduces cold cache on tab switch
const RETENTION_COHORT_WEEKS = 6;
const RETENTION_COHORT_ROWS = 6;
const HEATMAP_PREVIEW_SESSION_LIMIT = 8;
const HEATMAP_PREVIEW_EVENT_ARTIFACT_LIMIT_PER_SESSION = 12;
const HEATMAP_PREVIEW_INTERACTION_PREROLL_MS = 250;
const HEATMAP_PREVIEW_ROUTE_SETTLE_MS = 2_000;

function productRollupSourceKey(): string {
    return 'ch-product-rollup';
}

/**
 * Returns the last date (YYYY-MM-DD) for which daily rollups are guaranteed
 * to have completed. This is derived from the `stats:daily_rollup:last_run`
 * marker written by the statsAggregator job and falls back to "yesterday"
 * if the marker is missing or invalid.
 */
async function getLastRolledUpDate(): Promise<string> {
    try {
        // 1. Try to get the actual date that was last rolled up
        const lastRolledUpDate = await redis.get('stats:daily_rollup:last_rolled_up_date');
        if (lastRolledUpDate && /^\d{4}-\d{2}-\d{2}$/.test(lastRolledUpDate)) {
            return lastRolledUpDate;
        }

        // 2. Fallback to deriving from execution timestamp (legacy behavior)
        const lastRun = await redis.get('stats:daily_rollup:last_run');
        if (lastRun) {
            const parsed = new Date(lastRun);
            if (!Number.isNaN(parsed.getTime())) {
                // If it ran today, it processed yesterday's data
                const processedDate = new Date(parsed);
                processedDate.setUTCDate(processedDate.getUTCDate() - 1);
                return processedDate.toISOString().split('T')[0];
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

function buildSessionPlatformCondition(platform?: string): SQL | undefined {
    if (!platform || platform === 'all') return undefined;
    if (platform === 'mobile') return inArray(sessions.platform, ['ios', 'android']);
    return eq(sessions.platform, platform);
}

type HeatmapPreviewEvidence = {
    sessionId: string;
    screenFirstSeenMs: number;
    screenshotUrl: string;
};

function parseMaybeGzippedArtifactJson(data: Buffer, s3ObjectKey?: string | null): any {
    const isGzipped = (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) || Boolean(s3ObjectKey?.endsWith('.gz'));
    if (!isGzipped) return JSON.parse(data.toString('utf8'));

    try {
        return JSON.parse(gunzipSync(data).toString('utf8'));
    } catch {
        return JSON.parse(data.toString('utf8'));
    }
}

function extractArtifactEvents(parsedArtifact: any): any[] {
    if (Array.isArray(parsedArtifact)) return parsedArtifact;
    if (Array.isArray(parsedArtifact?.events)) return parsedArtifact.events;
    return [];
}

function addUniqueHeatmapSessionId(target: string[], seen: Set<string>, sessionId: string | null | undefined): void {
    const normalized = sessionId?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    target.push(normalized);
}

async function resolveHeatmapPreviewEvidenceByScreen(
    projectIds: string[],
    candidatesByScreen: Map<string, string[]>,
): Promise<Map<string, HeatmapPreviewEvidence>> {
    const normalizedCandidatesByScreen = new Map<string, string[]>();
    const allCandidateSessionIds: string[] = [];
    const seenSessionIds = new Set<string>();

    for (const [screenName, candidateSessionIds] of candidatesByScreen.entries()) {
        const normalizedScreenName = normalizeHeatmapScreenName(screenName);
        if (!normalizedScreenName) continue;

        const orderedSessionIds: string[] = [];
        const screenSeenSessionIds = new Set<string>();
        for (const sessionId of candidateSessionIds) {
            if (orderedSessionIds.length >= HEATMAP_PREVIEW_SESSION_LIMIT) break;
            addUniqueHeatmapSessionId(orderedSessionIds, screenSeenSessionIds, sessionId);
        }
        if (orderedSessionIds.length === 0) continue;

        normalizedCandidatesByScreen.set(normalizedScreenName, orderedSessionIds);
        for (const sessionId of orderedSessionIds) {
            addUniqueHeatmapSessionId(allCandidateSessionIds, seenSessionIds, sessionId);
        }
    }

    if (allCandidateSessionIds.length === 0 || projectIds.length === 0) return new Map();

    const [sessionRows, screenshotRows, eventArtifactRows] = await Promise.all([
        db
            .select({
                sessionId: sessions.id,
                projectId: sessions.projectId,
                startedAt: sessions.startedAt,
                endedAt: sessions.endedAt,
                lastIngestActivityAt: sessions.lastIngestActivityAt,
            })
            .from(sessions)
            .where(and(
                inArray(sessions.id, allCandidateSessionIds),
                inArray(sessions.projectId, projectIds),
                eq(sessions.recordingDeleted, false),
            )),
        db
            .select({ sessionId: recordingArtifacts.sessionId })
            .from(recordingArtifacts)
            .where(and(
                inArray(recordingArtifacts.sessionId, allCandidateSessionIds),
                eq(recordingArtifacts.kind, 'screenshots'),
                eq(recordingArtifacts.status, 'ready'),
            ))
            .groupBy(recordingArtifacts.sessionId),
        db
            .select({
                id: recordingArtifacts.id,
                sessionId: recordingArtifacts.sessionId,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                endpointId: recordingArtifacts.endpointId,
                startTime: recordingArtifacts.startTime,
                timestamp: recordingArtifacts.timestamp,
                createdAt: recordingArtifacts.createdAt,
            })
            .from(recordingArtifacts)
            .where(and(
                inArray(recordingArtifacts.sessionId, allCandidateSessionIds),
                eq(recordingArtifacts.kind, 'events'),
                eq(recordingArtifacts.status, 'ready'),
            ))
            .orderBy(recordingArtifacts.sessionId, recordingArtifacts.startTime, recordingArtifacts.timestamp, recordingArtifacts.createdAt),
    ]);

    const sessionById = new Map(sessionRows.map((row) => [row.sessionId, row]));
    const sessionsWithScreenshots = new Set(screenshotRows.map((row) => row.sessionId));
    const eventArtifactsBySession = new Map<string, typeof eventArtifactRows>();
    for (const artifact of eventArtifactRows) {
        const list = eventArtifactsBySession.get(artifact.sessionId) ?? [];
        if (list.length < HEATMAP_PREVIEW_EVENT_ARTIFACT_LIMIT_PER_SESSION) {
            list.push(artifact);
            eventArtifactsBySession.set(artifact.sessionId, list);
        }
    }

    const eventsByArtifactId = new Map<string, Promise<any[]>>();
    const loadArtifactEvents = (artifact: (typeof eventArtifactRows)[number], projectId: string): Promise<any[]> => {
        let cached = eventsByArtifactId.get(artifact.id);
        if (!cached) {
            const next = downloadFromS3ForArtifact(projectId, artifact.s3ObjectKey, artifact.endpointId)
                .then((data: Buffer | null) => {
                    if (!data) return [];
                    return extractArtifactEvents(parseMaybeGzippedArtifactJson(data, artifact.s3ObjectKey));
                })
                .catch((err: unknown) => {
                    logger.warn(
                        {
                            err,
                            sessionId: artifact.sessionId,
                            artifactId: artifact.id,
                        },
                        '[heatmap-preview] failed to read events artifact while resolving screen preview',
                    );
                    return [];
                });
            eventsByArtifactId.set(artifact.id, next);
            cached = next;
        }
        return cached;
    };
    const sessionEventEntriesBySession = new Map<string, Promise<HeatmapPreviewEventEntry[]>>();
    const loadSessionEventEntries = (
        sessionId: string,
        projectId: string,
        artifacts: typeof eventArtifactRows,
    ): Promise<HeatmapPreviewEventEntry[]> => {
        let cached = sessionEventEntriesBySession.get(sessionId);
        if (!cached) {
            cached = (async () => {
                const entries: HeatmapPreviewEventEntry[] = [];
                for (const artifact of artifacts) {
                    const artifactStartMs = artifact.startTime ?? artifact.timestamp ?? null;
                    const events = await loadArtifactEvents(artifact, projectId);
                    for (const event of events) {
                        entries.push({ event, artifactStartMs });
                    }
                }
                return entries;
            })();
            sessionEventEntriesBySession.set(sessionId, cached);
        }
        return cached;
    };

    const evidenceByScreen = new Map<string, HeatmapPreviewEvidence>();
    for (const [normalizedScreenName, candidateSessionIds] of normalizedCandidatesByScreen.entries()) {
        for (const sessionId of candidateSessionIds) {
            const session = sessionById.get(sessionId);
            if (!session || !sessionsWithScreenshots.has(sessionId)) continue;

            const artifacts = eventArtifactsBySession.get(sessionId) ?? [];
            if (artifacts.length === 0) continue;

            const sessionStartMs = session.startedAt.getTime();
            const sessionEndMs =
                session.endedAt?.getTime()
                ?? session.lastIngestActivityAt?.getTime()
                ?? null;

            const eventEntries = await loadSessionEventEntries(sessionId, session.projectId, artifacts);
            const screenFirstSeenMs = findHeatmapPreviewTimestampInEvents({
                events: eventEntries,
                normalizedScreenName,
                sessionStartMs,
                sessionEndMs,
                interactionPrerollMs: HEATMAP_PREVIEW_INTERACTION_PREROLL_MS,
                routeSettleMs: HEATMAP_PREVIEW_ROUTE_SETTLE_MS,
            });
            if (!screenFirstSeenMs) continue;

            const screenshotUrl = buildHeatmapScreenshotUrl(sessionId, screenFirstSeenMs, { requireTimestamp: true });
            if (screenshotUrl) {
                evidenceByScreen.set(normalizedScreenName, {
                    sessionId,
                    screenFirstSeenMs,
                    screenshotUrl,
                });
                break;
            }
        }
    }

    return evidenceByScreen;
}

function getHeatmapMinVisits(sessionCount: number, isRealtime = false): number {
    if (isRealtime) return 2;
    if (sessionCount >= 500) return 5;
    if (sessionCount >= 100) return 3;
    return 1;
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
        const platform = typeof req.query.platform === 'string' && req.query.platform !== 'all'
            ? req.query.platform
            : undefined;

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

        const cacheKey = `insights:friction:${productRollupSourceKey()}:${projectIds.sort().join(',')}:${isRealtime ? 'realtime' : (timeRange || '7d')}:${platform || 'all'}:v6`;

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
        const platformCondition = buildSessionPlatformCondition(platform);
        if (platformCondition) conditions.push(platformCondition);

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
            const screensVisited = normalizeHeatmapScreenPath(s.metrics?.screensVisited || []);
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
        const minVisits = getHeatmapMinVisits(sessionData.length, isRealtime);
        const candidateScreens = Object.entries(screenStats)
            .filter(([, stats]) => stats.visits >= minVisits)
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
        // IMPORTANT: Filter out sessions with recordingDeleted=true to avoid
        // orphaned artifacts whose S3 data has been removed by retention worker
        const frameArtifacts = uniqueSessionIds.length > 0
            ? await db
                .select({
                    id: recordingArtifacts.id,
                    sessionId: recordingArtifacts.sessionId,
                })
                .from(recordingArtifacts)
                .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
                .where(and(
                    inArray(recordingArtifacts.sessionId, uniqueSessionIds),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready'),
                    eq(sessions.recordingDeleted, false)
                ))
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

        // Query touch heatmap data and fold high-cardinality web route variants
        // into the same normalized candidate names used by session paths.
        const candidateScreenNames = new Set(candidateScreens.map(([name]) => name));
        const heatmapData = candidateScreenNames.size > 0
            ? await queryScreenTouchHeatmapsFromClickHouse({
                projectIds,
                startDate: startedAfter?.toISOString().split('T')[0],
            })
            : [];

        // Aggregate heatmap data by screen (combine multiple days)
        const screenHeatmapMap = new Map<string, {
            touchBuckets: Record<string, number>;
            rageTapBuckets: Record<string, number>;
            totalTouches: number;
            totalRageTaps: number;
            sampleSessionId: string | null;
            screenFirstSeenMs: number | null;
            pageWidth: number | null;
            pageHeight: number | null;
            viewportWidth: number | null;
            viewportHeight: number | null;
        }>();

        for (const row of heatmapData) {
            const normalizedScreenName = normalizeHeatmapScreenName(row.screenName);
            if (!normalizedScreenName || !candidateScreenNames.has(normalizedScreenName)) continue;
            const existing = screenHeatmapMap.get(normalizedScreenName);
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
                existing.pageWidth = Math.max(existing.pageWidth ?? 0, row.pageWidth ?? 0) || existing.pageWidth;
                existing.pageHeight = Math.max(existing.pageHeight ?? 0, row.pageHeight ?? 0) || existing.pageHeight;
                existing.viewportWidth = Math.max(existing.viewportWidth ?? 0, row.viewportWidth ?? 0) || existing.viewportWidth;
                existing.viewportHeight = Math.max(existing.viewportHeight ?? 0, row.viewportHeight ?? 0) || existing.viewportHeight;
                if (!existing.sampleSessionId && row.sampleSessionId) {
                    existing.sampleSessionId = row.sampleSessionId;
                    existing.screenFirstSeenMs = row.screenFirstSeenMs;
                }
            } else {
                screenHeatmapMap.set(normalizedScreenName, {
                    touchBuckets: { ...(row.touchBuckets as Record<string, number> || {}) },
                    rageTapBuckets: { ...(row.rageTapBuckets as Record<string, number> || {}) },
                    totalTouches: row.totalTouches,
                    totalRageTaps: row.totalRageTaps,
                    sampleSessionId: row.sampleSessionId,
                    screenFirstSeenMs: row.screenFirstSeenMs,
                    pageWidth: row.pageWidth,
                    pageHeight: row.pageHeight,
                    viewportWidth: row.viewportWidth,
                    viewportHeight: row.viewportHeight,
                });
            }
        }

        const heatmapSampleSessionIds = Array.from(new Set(
            Array.from(screenHeatmapMap.values())
                .map((heatmap) => heatmap.sampleSessionId)
                .filter((sessionId): sessionId is string => Boolean(sessionId))
        ));
        const missingSampleSessionIds = heatmapSampleSessionIds.filter((sessionId) => !sessionFrameMap.has(sessionId));

        if (missingSampleSessionIds.length > 0) {
            const sampleFrameArtifacts = await db
                .select({
                    id: recordingArtifacts.id,
                    sessionId: recordingArtifacts.sessionId,
                })
                .from(recordingArtifacts)
                .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
                .where(and(
                    inArray(recordingArtifacts.sessionId, missingSampleSessionIds),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready'),
                    eq(sessions.recordingDeleted, false)
                ))
                .limit(missingSampleSessionIds.length);

            for (const artifact of sampleFrameArtifacts) {
                if (!sessionFrameMap.has(artifact.sessionId)) {
                    sessionFrameMap.set(artifact.sessionId, artifact.id);
                }
            }
        }

        const scoredScreens = candidateScreens
            .map(([name, stats]) => {
                const heatmap = screenHeatmapMap.get(name);
                const rageTaps = Math.max(stats.approxRageTaps, heatmap?.totalRageTaps || 0);
                const touchCount = heatmap?.totalTouches || 0;
                if (touchCount <= 0 && rageTaps <= 0 && stats.errors <= 0) {
                    return null;
                }
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
            .filter((screen): screen is NonNullable<typeof screen> => screen !== null)
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

        const previewCandidatesByScreen = new Map<string, string[]>();
        for (const screen of scoredScreens) {
            const heatmap = screenHeatmapMap.get(screen.name);
            const candidates: string[] = [];
            const seen = new Set<string>();
            addUniqueHeatmapSessionId(candidates, seen, heatmap?.sampleSessionId);
            for (const sessionId of screen.sessionIds) {
                if (!sessionFrameMap.has(sessionId)) continue;
                addUniqueHeatmapSessionId(candidates, seen, sessionId);
            }
            if (candidates.length > 0) {
                previewCandidatesByScreen.set(screen.name, candidates);
            }
        }
        const previewEvidenceByScreen = await resolveHeatmapPreviewEvidenceByScreen(projectIds, previewCandidatesByScreen);

        // Build final response with screen-specific frame URLs and touch hotspots.
        const screens = scoredScreens.map((screen) => {
            let screenshotUrl: string | null = null;
            const heatmap = screenHeatmapMap.get(screen.name);
            const previewEvidence = previewEvidenceByScreen.get(screen.name);
            let evidenceSessionId = previewEvidence?.sessionId ?? null;
            let screenFirstSeenMs = previewEvidence?.screenFirstSeenMs ?? null;

            if (previewEvidence) {
                screenshotUrl = previewEvidence.screenshotUrl;
            } else if (heatmap?.sampleSessionId && heatmap.screenFirstSeenMs && sessionFrameMap.has(heatmap.sampleSessionId)) {
                screenshotUrl = buildHeatmapScreenshotUrl(heatmap.sampleSessionId, heatmap.screenFirstSeenMs, { requireTimestamp: true });
                if (screenshotUrl) {
                    evidenceSessionId = heatmap.sampleSessionId;
                    screenFirstSeenMs = heatmap.screenFirstSeenMs;
                }
            }

            // Get touch hotspot data for this screen
            const touchHotspots = heatmap
                ? bucketsToHotspots(heatmap.touchBuckets, heatmap.rageTapBuckets)
                : [];

            const sessionIds = evidenceSessionId
                ? [evidenceSessionId, ...screen.sessionIds.filter((sessionId) => sessionId !== evidenceSessionId)]
                : screen.sessionIds;

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
                sessionIds,
                screenshotUrl,
                screenFirstSeenMs,
                touchHotspots,
                pageWidth: heatmap?.pageWidth ?? null,
                pageHeight: heatmap?.pageHeight ?? null,
                viewportWidth: heatmap?.viewportWidth ?? null,
                viewportHeight: heatmap?.viewportHeight ?? null,
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
 * All-time aggregated touch heatmaps from ClickHouse product rollups.
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

        const cacheKey = `insights:alltime-heatmap:${productRollupSourceKey()}:${projectIds.sort().join(',')}:v6`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Query all heatmap data from ClickHouse (no date filter - all time)
        const heatmapData = await queryScreenTouchHeatmapsFromClickHouse({ projectIds });

        // Aggregate heatmap data by screen (combine all days)
        const screenHeatmapMap = new Map<string, {
            touchBuckets: Record<string, number>;
            rageTapBuckets: Record<string, number>;
            totalTouches: number;
            totalRageTaps: number;
            sampleSessionId: string | null;
            screenFirstSeenMs: number | null;
            pageWidth: number | null;
            pageHeight: number | null;
            viewportWidth: number | null;
            viewportHeight: number | null;
        }>();

        for (const row of heatmapData) {
            const normalizedScreenName = normalizeHeatmapScreenName(row.screenName);
            if (!normalizedScreenName) continue;
            const existing = screenHeatmapMap.get(normalizedScreenName);
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
                existing.pageWidth = Math.max(existing.pageWidth ?? 0, row.pageWidth ?? 0) || existing.pageWidth;
                existing.pageHeight = Math.max(existing.pageHeight ?? 0, row.pageHeight ?? 0) || existing.pageHeight;
                existing.viewportWidth = Math.max(existing.viewportWidth ?? 0, row.viewportWidth ?? 0) || existing.viewportWidth;
                existing.viewportHeight = Math.max(existing.viewportHeight ?? 0, row.viewportHeight ?? 0) || existing.viewportHeight;
                // Keep most recent sample session and its timestamp
                if (row.sampleSessionId) {
                    existing.sampleSessionId = row.sampleSessionId;
                    existing.screenFirstSeenMs = row.screenFirstSeenMs;
                }
            } else {
                screenHeatmapMap.set(normalizedScreenName, {
                    touchBuckets: { ...(row.touchBuckets as Record<string, number> || {}) },
                    rageTapBuckets: { ...(row.rageTapBuckets as Record<string, number> || {}) },
                    totalTouches: row.totalTouches,
                    totalRageTaps: row.totalRageTaps,
                    sampleSessionId: row.sampleSessionId,
                    screenFirstSeenMs: row.screenFirstSeenMs,
                    pageWidth: row.pageWidth,
                    pageHeight: row.pageHeight,
                    viewportWidth: row.viewportWidth,
                    viewportHeight: row.viewportHeight,
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
        // Filter out sessions with recordingDeleted=true to avoid orphaned artifacts
        const sampleFrameArtifacts = uniqueSessionIds.length > 0
            ? await db
                .select({
                    id: recordingArtifacts.id,
                    sessionId: recordingArtifacts.sessionId,
                    kind: recordingArtifacts.kind,
                    status: recordingArtifacts.status,
                })
                .from(recordingArtifacts)
                .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
                .where(and(
                    inArray(recordingArtifacts.sessionId, uniqueSessionIds),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready'),
                    eq(sessions.recordingDeleted, false)
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
                .where(and(
                    inArray(sessions.projectId, projectIds),
                    eq(sessions.recordingDeleted, false)
                ))
                .orderBy(desc(sessions.createdAt))
                .limit(500);

            // Map each screen to sessions that visited it (with valid screenshots)
            for (const row of recentSessionsWithScreenshots) {
                const visited = normalizeHeatmapScreenPath(row.screensVisited || []);
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

        const previewCandidatesByScreen = new Map<string, string[]>();
        for (const [screenName, data] of screenHeatmapMap.entries()) {
            const candidates: string[] = [];
            const seen = new Set<string>();
            if (data.sampleSessionId && sessionFrameMap.has(data.sampleSessionId)) {
                addUniqueHeatmapSessionId(candidates, seen, data.sampleSessionId);
            }
            for (const sessionId of screenSessionMap.get(screenName) || []) {
                if (!sessionFrameMap.has(sessionId)) continue;
                addUniqueHeatmapSessionId(candidates, seen, sessionId);
            }
            if (candidates.length > 0) {
                previewCandidatesByScreen.set(screenName, candidates);
            }
        }
        const previewEvidenceByScreen = await resolveHeatmapPreviewEvidenceByScreen(projectIds, previewCandidatesByScreen);

        // Build response
        const screens = Array.from(screenHeatmapMap.entries())
            .filter(([, data]) => data.totalTouches > 0)
            .map(([screenName, data]) => {
                let screenshotUrl: string | null = null;
                let screenshotSource = 'none';
                const previewEvidence = previewEvidenceByScreen.get(screenName);
                let evidenceSessionId = previewEvidence?.sessionId ?? null;
                let screenFirstSeenMs = previewEvidence?.screenFirstSeenMs ?? null;

                if (previewEvidence) {
                    screenshotUrl = previewEvidence.screenshotUrl;
                    screenshotSource = 'screenEvent';
                } else if (data.sampleSessionId && data.screenFirstSeenMs && sessionFrameMap.has(data.sampleSessionId)) {
                    screenshotUrl = buildHeatmapScreenshotUrl(data.sampleSessionId, data.screenFirstSeenMs, { requireTimestamp: true });
                    screenshotSource = 'sampleSession';
                    if (screenshotUrl) {
                        evidenceSessionId = data.sampleSessionId;
                        screenFirstSeenMs = data.screenFirstSeenMs;
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
                    sessionIds: evidenceSessionId ? [evidenceSessionId] : [],
                    screenFirstSeenMs,
                    touchHotspots,
                    pageWidth: data.pageWidth ?? null,
                    pageHeight: data.pageHeight ?? null,
                    viewportWidth: data.viewportWidth ?? null,
                    viewportHeight: data.viewportHeight ?? null,
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
 * GET /api/insights/retention-cohorts
 *
 * Weekly retention cohorts based on full activity in the selected time window.
 */
router.get(
    '/retention-cohorts',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange, platform } = req.query;

        const projectIds = projectId
            ? [projectId as string]
            : await getAccessibleProjectIds(req.user!.id);

        if (projectIds.length === 0) {
            res.json({ rows: [] });
            return;
        }

        if (projectId && !(await verifyProjectAccess(projectId as string, req.user!.id))) {
            throw ApiError.forbidden('Access denied');
        }

        const normalizedTimeRange = typeof timeRange === 'string' ? timeRange : undefined;
        const normalizedPlatform = typeof platform === 'string' && platform !== 'all' ? platform : undefined;
        const cacheKey = `insights:retention-cohorts:${projectIds.sort().join(',')}:${normalizedTimeRange || '30d'}:${normalizedPlatform || 'all'}:v2`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const days = normalizedTimeRange ? boundedTimeRangeToDays(normalizedTimeRange) : undefined;
        const startedAfter = typeof days === 'number'
            ? new Date(Date.now() - (days * 24 * 60 * 60 * 1000))
            : undefined;

        const rawIdentitySql = sql<string>`
            coalesce(
                nullif(trim(${sessions.userDisplayId}), ''),
                nullif(trim(${sessions.anonymousDisplayId}), ''),
                nullif(trim(${sessions.anonymousHash}), ''),
                nullif(trim(${sessions.deviceId}), '')
            )
        `;
        const scopedIdentitySql = sql<string>`
            case
                when ${rawIdentitySql} is null then null
                else ${sessions.projectId} || ':' || ${rawIdentitySql}
            end
        `;
        const weekStartKeySql = sql<string>`
            to_char(
                (
                    date_trunc('day', ${sessions.startedAt})
                    - (extract(dow from ${sessions.startedAt})::int * interval '1 day')
                )::date,
                'YYYY-MM-DD'
            )
        `;

        const conditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) {
            conditions.push(gte(sessions.startedAt, startedAfter));
        }
        if (normalizedPlatform === 'mobile') {
            conditions.push(inArray(sessions.platform, ['ios', 'android']));
        } else if (normalizedPlatform) {
            conditions.push(eq(sessions.platform, normalizedPlatform));
        }

        const activityRows = await db
            .select({
                userKey: scopedIdentitySql,
                weekStartKey: weekStartKeySql,
            })
            .from(sessions)
            .where(and(...conditions, sql`${scopedIdentitySql} is not null`))
            .groupBy(scopedIdentitySql, weekStartKeySql)
            .orderBy(asc(weekStartKeySql), asc(scopedIdentitySql));

        const response = {
            rows: buildRetentionCohortRows(activityRows, {
                weeks: RETENTION_COHORT_WEEKS,
                maxRows: RETENTION_COHORT_ROWS,
            }),
        };

        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);
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
        const normalizedPlatform = typeof req.query.platform === 'string' && req.query.platform !== 'all'
            ? req.query.platform
            : undefined;

        // Redis caching for fast page loads
        const cacheKey = `insights:trends:${productRollupSourceKey()}:${projectIds.sort().join(',')}:${normalizedTimeRange || '30d'}:${normalizedPlatform || 'all'}:v7-gdpr-identity`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const days = normalizedTimeRange ? boundedTimeRangeToDays(normalizedTimeRange) : undefined;

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

        if (normalizedPlatform) {
            type TrendDay = {
                sessions: number;
                crashes: number;
                rageTaps: number;
                deadTaps: number;
                avgUxScore: number;
                uniqueUserIds: Set<string>;
                avgApiResponseMs: number;
                apiErrorRate: number;
                avgDurationSeconds: number;
                errorCount: number;
                appVersionBreakdown: Record<string, number>;
                appVersionDauBreakdown: Record<string, number>;
                countryDauBreakdown: Record<string, number>;
                totalApiCalls: number;
            };
            const ensureDay = (map: Record<string, TrendDay>, date: string): TrendDay => {
                if (!map[date]) {
                    map[date] = {
                        sessions: 0,
                        crashes: 0,
                        rageTaps: 0,
                        deadTaps: 0,
                        avgUxScore: 0,
                        uniqueUserIds: new Set<string>(),
                        avgApiResponseMs: 0,
                        apiErrorRate: 0,
                        avgDurationSeconds: 0,
                        errorCount: 0,
                        appVersionBreakdown: {},
                        appVersionDauBreakdown: {},
                        countryDauBreakdown: {},
                        totalApiCalls: 0,
                    };
                }
                return map[date];
            };

            const sessionDate = sql<string>`(${sessions.startedAt}::date)::text`;
            const identitySql = sql<string>`coalesce(
                nullif(trim(${sessions.userDisplayId}), ''),
                nullif(trim(${sessions.anonymousHash}), ''),
                nullif(trim(${sessions.anonymousDisplayId}), ''),
                nullif(trim(${sessions.deviceId}), ''),
                CASE WHEN ${sessions.identityScrubbedAt} IS NULL THEN ${sessions.id} ELSE NULL END
            )`;
            const platformCondition = buildSessionPlatformCondition(normalizedPlatform);
            const rawConditions: SQL[] = [
                inArray(sessions.projectId, projectIds),
                sql`${sessionDate} <= ${lastRolledUpDate}`,
            ];
            if (startStr) rawConditions.push(sql`${sessionDate} >= ${startStr}`);
            if (platformCondition) rawConditions.push(platformCondition);

            const rawDailyRows = await db
                .select({
                    date: sessionDate,
                    sessions: sql<number>`count(*)::int`,
                    crashes: sql<number>`sum(coalesce(${sessionMetrics.crashCount}, 0))::int`,
                    rageTaps: sql<number>`sum(coalesce(${sessionMetrics.rageTapCount}, 0))::int`,
                    deadTaps: sql<number>`sum(coalesce(${sessionMetrics.deadTapCount}, 0))::int`,
                    avgUxScore: sql<number>`avg(coalesce(${sessionMetrics.uxScore}, 0))`,
                    avgDurationSeconds: sql<number>`avg(coalesce(${sessions.durationSeconds}, 0))`,
                    errorCount: sql<number>`sum(coalesce(${sessionMetrics.errorCount}, 0))::int`,
                    totalApiCalls: sql<number>`sum(coalesce(${sessionMetrics.apiTotalCount}, 0))::int`,
                    apiErrors: sql<number>`sum(coalesce(${sessionMetrics.apiErrorCount}, 0))::int`,
                    weightedApiResponseMs: sql<number>`sum(coalesce(${sessionMetrics.apiAvgResponseMs}, 0)::numeric * coalesce(${sessionMetrics.apiTotalCount}, 0)::numeric)`,
                })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
                .where(and(...rawConditions))
                .groupBy(sessionDate)
                .orderBy(asc(sessionDate));

            const normalizedVersion = sql<string>`COALESCE(NULLIF(${sessions.appVersion}, ''), 'Unknown')`;
            const versionRows = await db
                .select({
                    date: sessionDate,
                    version: normalizedVersion,
                    sessions: sql<number>`count(*)::int`,
                    uniqueUsers: sql<number>`count(distinct ${identitySql})::int`,
                })
                .from(sessions)
                .where(and(...rawConditions))
                .groupBy(sessionDate, normalizedVersion);

            const normalizedCountry = sql<string>`COALESCE(NULLIF(${sessions.geoCountry}, ''), 'Unknown')`;
            const countryRows = await db
                .select({
                    date: sessionDate,
                    country: normalizedCountry,
                    uniqueUsers: sql<number>`count(distinct ${identitySql})::int`,
                })
                .from(sessions)
                .where(and(...rawConditions, sql`${sessions.geoCountry} IS NOT NULL`))
                .groupBy(sessionDate, normalizedCountry);

            const userRows = await db
                .select({
                    date: sessionDate,
                    userKey: identitySql,
                })
                .from(sessions)
                .where(and(...rawConditions, sql`${identitySql} IS NOT NULL`))
                .groupBy(sessionDate, identitySql);

            const dailyMap: Record<string, TrendDay> = {};
            for (const row of rawDailyRows) {
                const day = ensureDay(dailyMap, row.date);
                const totalApiCalls = Number(row.totalApiCalls || 0);
                day.sessions = Number(row.sessions || 0);
                day.crashes = Number(row.crashes || 0);
                day.rageTaps = Number(row.rageTaps || 0);
                day.deadTaps = Number(row.deadTaps || 0);
                day.avgUxScore = Number(row.avgUxScore || 0);
                day.avgDurationSeconds = Number(row.avgDurationSeconds || 0);
                day.errorCount = Number(row.errorCount || 0);
                day.totalApiCalls = totalApiCalls;
                day.avgApiResponseMs = totalApiCalls > 0
                    ? Math.round(Number(row.weightedApiResponseMs || 0) / totalApiCalls)
                    : 0;
                day.apiErrorRate = totalApiCalls > 0 ? Number(row.apiErrors || 0) / totalApiCalls : 0;
            }
            for (const row of versionRows) {
                const day = ensureDay(dailyMap, row.date);
                day.appVersionBreakdown[row.version] = Number(row.sessions || 0);
                day.appVersionDauBreakdown[row.version] = Number(row.uniqueUsers || 0);
            }
            for (const row of countryRows) {
                ensureDay(dailyMap, row.date).countryDauBreakdown[row.country] = Number(row.uniqueUsers || 0);
            }
            for (const row of userRows) {
                ensureDay(dailyMap, row.date).uniqueUserIds.add(row.userKey);
            }

            const allDates = Object.keys(dailyMap).sort();
            const dateIndex = new Map(allDates.map((date, index) => [date, index]));
            const daily = allDates
                .filter(date => !queryStartStr || date >= queryStartStr)
                .map(date => {
                    const data = dailyMap[date];
                    const mauSet = new Set<string>();
                    const currentIndex = dateIndex.get(date) ?? 0;
                    for (let i = currentIndex; i >= 0; i--) {
                        const lookbackDate = allDates[i];
                        const daysDiff = (new Date(date).getTime() - new Date(lookbackDate).getTime()) / (1000 * 60 * 60 * 24);
                        if (daysDiff <= 30) {
                            dailyMap[lookbackDate]?.uniqueUserIds.forEach(uid => mauSet.add(uid));
                        } else {
                            break;
                        }
                    }

                    return {
                        date,
                        sessions: data.sessions,
                        crashes: data.crashes,
                        rageTaps: data.rageTaps,
                        deadTaps: data.deadTaps,
                        avgUxScore: Math.round(data.avgUxScore),
                        dau: data.uniqueUserIds.size,
                        mau: mauSet.size,
                        avgApiResponseMs: data.avgApiResponseMs,
                        apiErrorRate: data.apiErrorRate,
                        avgDurationSeconds: Math.round(data.avgDurationSeconds),
                        errorCount: data.errorCount,
                        appVersionBreakdown: data.appVersionBreakdown,
                        appVersionDauBreakdown: data.appVersionDauBreakdown,
                        countryDauBreakdown: data.countryDauBreakdown,
                        totalApiCalls: data.totalApiCalls,
                    };
                });

            const response = { daily, dataCompleteThrough: lastRolledUpDate };
            await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.json(response);
            return;
        }

        const stats = await queryProductDailyStatsFromClickHouse({
            projectIds,
            startDate: startStr,
            endDate: lastRolledUpDate,
        });

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
            appVersionDauBreakdown: Record<string, number>;
            countryDauBreakdown: Record<string, number>;
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
                    appVersionDauBreakdown: {} as Record<string, number>,
                    countryDauBreakdown: {} as Record<string, number>,
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
            dailyMap[date].dau += Number(s.uniqueUserCount || 0);

            // Merge app version breakdown
            if (s.appVersionBreakdown) {
                for (const [version, count] of Object.entries(s.appVersionBreakdown)) {
                    dailyMap[date].appVersionBreakdown[version] = (dailyMap[date].appVersionBreakdown[version] || 0) + count;
                    dailyMap[date].appVersionDauBreakdown[version] = (dailyMap[date].appVersionDauBreakdown[version] || 0) + count;
                }
            }

            if (s.geoCountryBreakdown) {
                for (const [country, count] of Object.entries(s.geoCountryBreakdown)) {
                    dailyMap[date].countryDauBreakdown[country] = (dailyMap[date].countryDauBreakdown[country] || 0) + count;
                }
            }
        }

        const apiStats = await queryDailyApiCallsFromClickHouse({
            projectIds,
            startDate: startStr,
            endDate: lastRolledUpDate,
        });

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
                    appVersionDauBreakdown: {} as Record<string, number>,
                    countryDauBreakdown: {} as Record<string, number>,
                    totalApiCalls: 0,
                };
            }
            dailyMap[date].totalApiCalls += Number(s.totalCalls);
        }

        // Convert to sorted array of all dates (including the buffer period)
        const allDates = Object.keys(dailyMap).sort();
        const dateIndex = new Map(allDates.map((date, index) => [date, index]));

        // Build final daily stats with MAU
        const daily = allDates
            .filter(date => !queryStartStr || date >= queryStartStr) // Only return requested range
            .map(date => {
                const data = dailyMap[date];

                // Calculate MAU: Sliding window of last 30 days ending on `date`
                let aggregateMau = 0;

                // Find index of current date
                const currentIndex = dateIndex.get(date) ?? 0;

                // Look back up to 30 days (or as far as we have data)
                // Since we fetched extra 30 days, we should have coverage
                for (let i = currentIndex; i >= 0; i--) {
                    const lookbackDate = allDates[i];
                    const daysDiff = (new Date(date).getTime() - new Date(lookbackDate).getTime()) / (1000 * 60 * 60 * 24);

                    if (daysDiff <= 30) {
                        // Add IDs from this past day
                        const lookbackDay = dailyMap[lookbackDate];
                        aggregateMau += lookbackDay?.dau || 0;
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
                    mau: aggregateMau,
                    // NEW fields
                    avgApiResponseMs,
                    apiErrorRate,
                    avgDurationSeconds,
                    errorCount: data.errorCount,
                    appVersionBreakdown: data.appVersionBreakdown,
                    appVersionDauBreakdown: data.appVersionDauBreakdown,
                    countryDauBreakdown: data.countryDauBreakdown,
                    totalApiCalls: data.totalApiCalls, // Pass through
                };
            });

        const response = {
            daily,
            dataCompleteThrough: lastRolledUpDate,
        };
        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

        // Force browser to bypass cache
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        res.json(response);
    })
);

export default router;
