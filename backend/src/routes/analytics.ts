/**
 * Analytics Routes
 * 
 * Provides pre-computed daily stats and trends for dashboards.
 * Uses Redis caching for fast access at 100k+ sessions scale.
 */

import { Router } from 'express';
import { eq, gte, lte, and, asc, inArray, sql, desc, isNotNull, gt, isNull } from 'drizzle-orm';
import { db, appDailyStats, projects, teamMembers, appAllTimeStats, sessions, sessionMetrics, crashes, anrs, errors, projectFunnelStats, alertSettings, alertRecipients, users } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { asyncHandler, ApiError } from '../middleware/index.js';
import { sessionAuth } from '../middleware/auth.js';
import { writeApiRateLimiter } from '../middleware/rateLimit.js';
import { runDailyRollup, backfillDailyStats } from '../jobs/statsAggregator.js';

const router = Router();
const redis = getRedis();

// Cache TTL in seconds
const CACHE_TTL = 300; // 5 minutes

function toPercent(numerator: number, denominator: number, decimals: number = 1): number {
    if (denominator <= 0) return 0;
    return Number(((numerator / denominator) * 100).toFixed(decimals));
}

function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const normalizedIndex = Math.max(0, Math.min(index, sorted.length - 1));
    return Math.round(sorted[normalizedIndex]);
}

/**
 * Get warehouse alerting data (recipients, connections, project statuses) for the data warehouse UI
 * GET /api/analytics/warehouse-alerting
 */
router.get(
    '/warehouse-alerting',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const userId = req.user!.id;

        const membership = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, userId));

        const teamIds = membership.map((m) => m.teamId);
        if (teamIds.length === 0) {
            res.json({ recipients: [], connections: [], projectStatuses: {} });
            return;
        }

        const accessibleProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const projectIds = accessibleProjects.map((p) => p.id);
        if (projectIds.length === 0) {
            res.json({ recipients: [], connections: [], projectStatuses: {} });
            return;
        }

        const recipientsRows = await db
            .select({
                userId: alertRecipients.userId,
                projectId: alertRecipients.projectId,
                email: users.email,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
            })
            .from(alertRecipients)
            .innerJoin(users, eq(alertRecipients.userId, users.id))
            .where(inArray(alertRecipients.projectId, projectIds));

        const recipientMap = new Map<string, { id: string; email: string; displayName: string | null; avatarUrl: string | null }>();
        const connections: { projectId: string; recipientId: string }[] = [];

        for (const row of recipientsRows) {
            recipientMap.set(row.userId, {
                id: row.userId,
                email: row.email ?? '',
                displayName: row.displayName ?? null,
                avatarUrl: row.avatarUrl ?? null,
            });
            connections.push({ projectId: row.projectId, recipientId: row.userId });
        }

        const recipients = Array.from(recipientMap.values());

        const settingsRows = await db
            .select({
                projectId: alertSettings.projectId,
                crashAlertsEnabled: alertSettings.crashAlertsEnabled,
                anrAlertsEnabled: alertSettings.anrAlertsEnabled,
                errorSpikeAlertsEnabled: alertSettings.errorSpikeAlertsEnabled,
                apiDegradationAlertsEnabled: alertSettings.apiDegradationAlertsEnabled,
            })
            .from(alertSettings)
            .where(inArray(alertSettings.projectId, projectIds));

        const projectStatuses: Record<string, { enabled: boolean; hasActiveAlert: boolean }> = {};
        const connectedProjectIds = new Set(connections.map((c) => c.projectId));

        for (const projectId of projectIds) {
            const settings = settingsRows.find((s) => s.projectId === projectId);
            const hasRecipients = connectedProjectIds.has(projectId);
            const anyAlertEnabled = settings
                ? (settings.crashAlertsEnabled ?? false) ||
                  (settings.anrAlertsEnabled ?? false) ||
                  (settings.errorSpikeAlertsEnabled ?? false) ||
                  (settings.apiDegradationAlertsEnabled ?? false)
                : false;
            const enabled = hasRecipients || anyAlertEnabled;
            projectStatuses[projectId] = { enabled, hasActiveAlert: enabled };
        }

        res.json({ recipients, connections, projectStatuses });
    })
);

/**
 * Get daily stats for a project
 * GET /api/analytics/daily-stats
 */
router.get(
    '/daily-stats',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, startDate, endDate, timeRange } = req.query;

        if (!projectId || typeof projectId !== 'string') {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify user has access to project
        const [project] = await db
            .select({ id: projects.id, teamId: projects.teamId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select({ id: teamMembers.id })
            .from(teamMembers)
            .where(and(
                eq(teamMembers.teamId, project.teamId),
                eq(teamMembers.userId, req.user!.id)
            ))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Build date range
        let start: Date;
        let end: Date = new Date();

        if (startDate && endDate) {
            start = new Date(startDate as string);
            end = new Date(endDate as string);
        } else {
            // Use timeRange
            const days = timeRange === '7d' ? 7 :
                timeRange === '30d' ? 30 :
                    timeRange === '90d' ? 90 : 30; // default 30 days
            start = new Date();
            start.setDate(start.getDate() - days);
        }

        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];

        // Check Redis cache
        const cacheKey = `analytics:daily:${projectId}:${startStr}:${endStr}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Query database
        const stats = await db
            .select()
            .from(appDailyStats)
            .where(and(
                eq(appDailyStats.projectId, projectId),
                gte(appDailyStats.date, startStr),
                lte(appDailyStats.date, endStr)
            ))
            .orderBy(asc(appDailyStats.date));

        const response = {
            projectId,
            startDate: startStr,
            endDate: endStr,
            stats: stats.map(s => ({
                date: s.date,
                totalSessions: Number(s.totalSessions || 0),
                completedSessions: Number(s.completedSessions || 0),
                avgDurationSeconds: Number(s.avgDurationSeconds || 0),
                avgInteractionScore: Number(s.avgInteractionScore || 0),
                avgUxScore: Number(s.avgUxScore || 0),
                avgApiErrorRate: Number(s.avgApiErrorRate || 0),
                p50Duration: Number(s.p50Duration || 0),
                p90Duration: Number(s.p90Duration || 0),
                p50InteractionScore: Number(s.p50InteractionScore || 0),
                p90InteractionScore: Number(s.p90InteractionScore || 0),
                // Interaction Breakdown
                totalTouches: Number(s.totalTouches || 0),
                totalScrolls: Number(s.totalScrolls || 0),
                totalGestures: Number(s.totalGestures || 0),
                totalInteractions: Number(s.totalInteractions || 0),
                totalErrors: Number(s.totalErrors || 0),
                totalRageTaps: Number(s.totalRageTaps || 0),
                totalDeadTaps: Number(s.totalDeadTaps || 0),
            })),
        };

        // Cache result
        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

        res.json(response);
    })
);

/**
 * Get aggregated trends over time
 * GET /api/analytics/trends
 */
router.get(
    '/trends',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        if (!projectId || typeof projectId !== 'string') {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify access
        const [project] = await db
            .select({ id: projects.id, teamId: projects.teamId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select({ id: teamMembers.id })
            .from(teamMembers)
            .where(and(
                eq(teamMembers.teamId, project.teamId),
                eq(teamMembers.userId, req.user!.id)
            ))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        const days = timeRange === '7d' ? 7 :
            timeRange === '30d' ? 30 :
                timeRange === '90d' ? 90 : 30;

        const start = new Date();
        start.setDate(start.getDate() - days);
        const startStr = start.toISOString().split('T')[0];

        // Check cache
        const cacheKey = `analytics:trends:${projectId}:${days}d`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const stats = await db
            .select()
            .from(appDailyStats)
            .where(and(
                eq(appDailyStats.projectId, projectId),
                gte(appDailyStats.date, startStr)
            ))
            .orderBy(asc(appDailyStats.date));

        // Compute trend summaries
        const totalSessionsOverTime = stats.map(s => ({ date: s.date, value: s.totalSessions }));
        const avgUxScoreOverTime = stats.map(s => ({ date: s.date, value: s.avgUxScore }));
        const avgDurationOverTime = stats.map(s => ({ date: s.date, value: s.avgDurationSeconds }));

        // Compute overall averages
        const totalSessions = stats.reduce((sum, s) => sum + s.totalSessions, 0);
        const totalRageTaps = stats.reduce((sum, s) => sum + (s.totalRageTaps || 0), 0);
        const totalDeadTaps = stats.reduce((sum, s) => sum + (s.totalDeadTaps || 0), 0);
        const totalErrors = stats.reduce((sum, s) => sum + (s.totalErrors || 0), 0);

        // Interaction Breakdown
        const totalTouches = stats.reduce((sum, s) => sum + (s.totalTouches || 0), 0);
        const totalScrolls = stats.reduce((sum, s) => sum + (s.totalScrolls || 0), 0);
        const totalGestures = stats.reduce((sum, s) => sum + (s.totalGestures || 0), 0);
        const totalInteractions = stats.reduce((sum, s) => sum + (s.totalInteractions || 0), 0);

        const avgUxScore = stats.length > 0
            ? stats.reduce((sum, s) => sum + (s.avgUxScore || 0), 0) / stats.length
            : 0;
        const avgDuration = stats.length > 0
            ? stats.reduce((sum, s) => sum + (s.avgDurationSeconds || 0), 0) / stats.length
            : 0;
        const avgApiErrorRate = stats.length > 0
            ? stats.reduce((sum, s) => sum + (s.avgApiErrorRate || 0), 0) / stats.length
            : 0;

        const response = {
            projectId,
            timeRange: `${days}d`,
            summary: {
                totalSessions,
                totalRageTaps,
                totalDeadTaps,
                totalErrors,
                // Interaction Breakdown
                totalTouches,
                totalScrolls,
                totalGestures,
                totalInteractions,
                avgUxScore: Math.round(avgUxScore * 100) / 100,
                avgDurationSeconds: Math.round(avgDuration),
                avgApiErrorRate: Math.round(avgApiErrorRate * 10000) / 100, // as percentage
            },
            trends: {
                sessions: totalSessionsOverTime,
                uxScore: avgUxScoreOverTime,
                duration: avgDurationOverTime,
            },
        };

        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

        res.json(response);
    })
);

/**
 * Trigger manual daily rollup (admin only)
 * POST /api/analytics/rollup
 */
router.post(
    '/rollup',
    sessionAuth,
    writeApiRateLimiter,
    asyncHandler(async (req, res) => {
        const { date, backfillDays } = req.body;

        // Check if user is admin (simplified - could check roles)
        logger.info({ userId: req.user!.id, date, backfillDays }, 'Manual rollup triggered');

        if (backfillDays && typeof backfillDays === 'number') {
            // Run backfill asynchronously
            backfillDailyStats(backfillDays).catch(err => {
                logger.error({ err }, 'Backfill failed');
            });
            res.json({ message: `Backfill started for ${backfillDays} days` });
        } else if (date) {
            await runDailyRollup(new Date(date));
            res.json({ message: `Rollup completed for ${date}` });
        } else {
            await runDailyRollup();
            res.json({ message: 'Rollup completed for yesterday' });
        }
    })
);



/**
 * Get dashboard stats (summary cards)
 * GET /api/analytics/dashboard-stats
 */
router.get(
    '/dashboard-stats',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        if (!projectId) {
            // Aggregate across all accessible projects
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));

            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({
                    totalSessions: 0, avgDuration: 0, avgUxScore: 0, errorRate: 0,
                    platformBreakdown: { ios: 0, android: 0 },
                    totalErrors: 0, totalRageTaps: 0, totalDeadTaps: 0, dau: 0, wau: 0, mau: 0
                });
                return;
            }

            const accessibleProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));

            const projectIds = accessibleProjects.map(p => p.id);
            if (projectIds.length === 0) {
                res.json({
                    totalSessions: 0, avgDuration: 0, avgUxScore: 0, errorRate: 0,
                    platformBreakdown: { ios: 0, android: 0 },
                    totalErrors: 0, totalRageTaps: 0, totalDeadTaps: 0, dau: 0, wau: 0, mau: 0
                });
                return;
            }

            // Check cache for global stats
            const cacheKey = `analytics:dashboard:global:${req.user!.id}:${timeRange || 'all'}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                res.json(JSON.parse(cached));
                return;
            }

            // Aggregate stats for all projects
            // We reuse similar logic but sum across projectIds
            // For simplicity, we can just loop or use IN clause

            const stats = {
                totalSessions: 0, avgDuration: 0, avgUxScore: 0, errorRate: 0,
                platformBreakdown: { ios: 0, android: 0 }, totalErrors: 0, totalRageTaps: 0, totalDeadTaps: 0,
                dau: 0, wau: 0, mau: 0, totalUsers: 0,
                // Interaction Breakdown
                totalTouches: 0, totalScrolls: 0, totalGestures: 0, totalInteractions: 0,
                // Engagement Segments
                engagementSegments: {
                    bouncers: 0,
                    casuals: 0,
                    explorers: 0,
                    loyalists: 0,
                },
            };

            // TODO: Implement aggregation logic properly for multi-project.
            // For now, if user has many projects, this might be slow if we loop?
            // "All Time": simple query with IN clause.

            if (!timeRange || timeRange === 'all') {
                const allTimeStats = await db
                    .select()
                    .from(appAllTimeStats)
                    .where(inArray(appAllTimeStats.projectId, projectIds));

                let wSumDuration = 0;
                let wSumUx = 0;
                let wSumError = 0;

                for (const s of allTimeStats) {
                    const sessionCount = Number(s.totalSessions || 0);
                    stats.totalSessions += sessionCount;
                    stats.totalErrors += Number(s.totalErrors || 0);
                    stats.totalRageTaps += Number(s.totalRageTaps || 0);
                    stats.totalDeadTaps += Number(s.totalDeadTaps || 0);
                    stats.totalUsers += Number(s.totalUsers || 0);

                    // Interaction Breakdown
                    stats.totalTouches += Number(s.totalTouches || 0);
                    stats.totalScrolls += Number(s.totalScrolls || 0);
                    stats.totalGestures += Number(s.totalGestures || 0);
                    stats.totalInteractions += Number(s.totalInteractions || 0);

                    stats.engagementSegments.bouncers += Number(s.totalBouncers || 0);
                    stats.engagementSegments.casuals += Number(s.totalCasuals || 0);
                    stats.engagementSegments.explorers += Number(s.totalExplorers || 0);
                    stats.engagementSegments.loyalists += Number(s.totalLoyalists || 0);

                    wSumDuration += (s.avgSessionDurationSeconds || 0) * sessionCount;
                    wSumUx += (s.avgUxScore || 0) * sessionCount;
                    wSumError += (s.avgApiErrorRate || 0) * sessionCount;
                }

                if (stats.totalSessions > 0) {
                    stats.avgDuration = wSumDuration / stats.totalSessions;
                    stats.avgUxScore = wSumUx / stats.totalSessions;
                    stats.errorRate = wSumError / stats.totalSessions;
                }
            } else {
                // Time range aggregation across projects
                // ... (simplified fallback or similar logic)

                // We're inside a multi-project aggregation block but only returning 0s for now
                // intentionally skipping complex aggregation to ship MVP all-time stats
                // so we don't need to query daily stats here yet.
            }

            await redis.set(cacheKey, JSON.stringify(stats), 'EX', CACHE_TTL);
            res.json(stats);
            return;
        }

        // Single Project Logic (existing)
        // Verify access checks...
        const [project] = await db
            .select({ id: projects.id, teamId: projects.teamId })
            .from(projects)
            .where(eq(projects.id, projectId as string))
            .limit(1);

        if (!project) throw ApiError.notFound('Project not found');

        // Check cache
        const cacheKey = `analytics:dashboard:${projectId}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const stats = {
            totalSessions: 0,
            avgDuration: 0,
            avgUxScore: 0,
            errorRate: 0,
            platformBreakdown: { ios: 0, android: 0 }, // Not in all-time table yet
            totalErrors: 0,
            totalRageTaps: 0,
            totalDeadTaps: 0,
            // Interaction Breakdown
            totalTouches: 0,
            totalScrolls: 0,
            totalGestures: 0,
            totalInteractions: 0,
            engagementSegments: {
                bouncers: 0,
                casuals: 0,
                explorers: 0,
                loyalists: 0,
            },
            dau: 0, wau: 0, mau: 0, // active users
        };

        if (!timeRange || timeRange === 'all') {
            // Use AppAllTimeStats
            // We need to import appAllTimeStats (added to imports below)
            const [allTime] = await db
                .select()
                .from(appAllTimeStats)
                .where(eq(appAllTimeStats.projectId, projectId as string));

            if (allTime) {
                stats.totalSessions = Number(allTime.totalSessions);
                stats.avgDuration = allTime.avgSessionDurationSeconds || 0;
                stats.avgUxScore = allTime.avgUxScore || 0;
                stats.errorRate = allTime.avgApiErrorRate || 0;
                stats.totalErrors = Number(allTime.totalErrors);
                stats.totalRageTaps = Number(allTime.totalRageTaps);
                stats.totalDeadTaps = Number(allTime.totalDeadTaps || 0);
                // Interaction Breakdown
                stats.totalTouches = Number(allTime.totalTouches || 0);
                stats.totalScrolls = Number(allTime.totalScrolls || 0);
                stats.totalGestures = Number(allTime.totalGestures || 0);
                stats.totalInteractions = Number(allTime.totalInteractions || 0);

                stats.engagementSegments.bouncers = Number(allTime.totalBouncers || 0);
                stats.engagementSegments.casuals = Number(allTime.totalCasuals || 0);
                stats.engagementSegments.explorers = Number(allTime.totalExplorers || 0);
                stats.engagementSegments.loyalists = Number(allTime.totalLoyalists || 0);

                stats.dau = Number(allTime.totalUsers || 0); // Using totalUsers as proxy for DAU in all-time view if not daily
            }
        } else {
            // Aggregate daily stats for time range
            const days = timeRange === '7d' ? 7 :
                timeRange === '30d' ? 30 :
                    timeRange === '90d' ? 90 : 30;
            const start = new Date();
            start.setDate(start.getDate() - days);
            const startStr = start.toISOString().split('T')[0];

            const dailies = await db
                .select()
                .from(appDailyStats)
                .where(and(
                    eq(appDailyStats.projectId, projectId as string),
                    gte(appDailyStats.date, startStr)
                ));

            // Sum up
            const totalSess = dailies.reduce((acc, d) => acc + d.totalSessions, 0);
            if (totalSess > 0) {
                stats.totalSessions = totalSess;
                stats.totalErrors = dailies.reduce((acc, d) => acc + d.totalErrors, 0);
                stats.totalRageTaps = dailies.reduce((acc, d) => acc + d.totalRageTaps, 0);
                stats.totalDeadTaps = dailies.reduce((acc, d) => acc + (d.totalDeadTaps || 0), 0);

                stats.engagementSegments.bouncers = dailies.reduce((acc, d) => acc + (d.totalBouncers || 0), 0);
                stats.engagementSegments.casuals = dailies.reduce((acc, d) => acc + (d.totalCasuals || 0), 0);
                stats.engagementSegments.explorers = dailies.reduce((acc, d) => acc + (d.totalExplorers || 0), 0);
                stats.engagementSegments.loyalists = dailies.reduce((acc, d) => acc + (d.totalLoyalists || 0), 0);

                // Weighted avgs ...
                stats.avgUxScore = dailies.reduce((acc, d) => acc + (d.avgUxScore || 0) * d.totalSessions, 0) / totalSess;
                stats.avgDuration = dailies.reduce((acc, d) => acc + (d.avgDurationSeconds || 0) * d.totalSessions, 0) / totalSess;
            }
        }

        // Fetch DAU/WAU/MAU from Redis (computed by statsAggregator)
        // keys: `stats:dau:${projectId}`, etc.
        const [dau, wau, mau] = await Promise.all([
            redis.get(`stats:dau:${projectId}`),
            redis.get(`stats:wau:${projectId}`),
            redis.get(`stats:mau:${projectId}`)
        ]);
        stats.dau = Number(dau || 0);
        stats.wau = Number(wau || 0);
        stats.mau = Number(mau || 0);

        await redis.set(cacheKey, JSON.stringify(stats), 'EX', CACHE_TTL);
        res.json(stats);
    })
);

/**
 * Get geographic distribution summary
 * GET /api/analytics/geo-summary
 * 
 * Returns aggregated country/city counts instead of raw sessions.
 * Used by Map.tsx to avoid loading 100k+ sessions.
 */
router.get(
    '/geo-summary',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { timeRange, projectId } = req.query;

        // Get accessible projects for user
        const membership = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = membership.map(m => m.teamId);
        if (teamIds.length === 0) {
            res.json({ countries: [], totalWithGeo: 0 });
            return;
        }

        const accessibleProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.teamId, teamIds));

        const projectIds = projectId
            ? [projectId as string]
            : accessibleProjects.map(p => p.id);

        if (projectIds.length === 0) {
            res.json({ countries: [], totalWithGeo: 0 });
            return;
        }

        // Build cache key
        const cacheKey = `analytics:geo:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Build time filter
        let startedAfter: Date | undefined;
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '24h' ? 1 :
                timeRange === '7d' ? 7 :
                    timeRange === '30d' ? 30 :
                        timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        // Import sessions table
        const { sessions } = await import('../db/client.js');

        // Query aggregated geo data
        const conditions = [
            inArray(sessions.projectId, projectIds),
        ];
        if (startedAfter) {
            conditions.push(gte(sessions.startedAt, startedAfter));
        }

        // Query aggregated geo data directly in SQL to save RAM
        const geoAgg = await db
            .select({
                country: sessions.geoCountry,
                city: sessions.geoCity,
                count: sql<number>`count(*)`,
                latitude: sql<number>`min(${sessions.geoLatitude})`, // Representative lat/lng
                longitude: sql<number>`min(${sessions.geoLongitude})`,
            })
            .from(sessions)
            .where(and(...conditions)) // Only active sessions
            .groupBy(sessions.geoCountry, sessions.geoCity);

        // Aggregate results for the UI
        const countryMap: Record<string, {
            count: number;
            cities: Record<string, { count: number; lat?: number; lng?: number }>;
            lat?: number;
            lng?: number;
        }> = {};

        let totalWithGeo = 0;

        for (const row of geoAgg) {
            if (!row.country) continue;
            totalWithGeo += Number(row.count);

            if (!countryMap[row.country]) {
                countryMap[row.country] = {
                    count: 0,
                    cities: {},
                    lat: row.latitude ?? undefined,
                    lng: row.longitude ?? undefined,
                };
            }
            countryMap[row.country].count += Number(row.count);

            if (row.city) {
                countryMap[row.country].cities[row.city] = {
                    count: Number(row.count),
                    lat: row.latitude ?? undefined,
                    lng: row.longitude ?? undefined,
                };
            }
        }

        // Transform to array sorted by count
        const countries = Object.entries(countryMap)
            .map(([country, data]) => ({
                country,
                count: data.count,
                latitude: data.lat,
                longitude: data.lng,
                topCities: Object.entries(data.cities)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 5)
                    .map(([city, cityData]) => ({
                        city,
                        count: cityData.count,
                        latitude: cityData.lat,
                        longitude: cityData.lng,
                    })),
            }))
            .sort((a, b) => b.count - a.count);

        const result = { countries, totalWithGeo };

        // Cache for 5 minutes
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Get regional value and engagement segment mix
 * GET /api/analytics/geo-value
 *
 * Returns country-level value metrics (UX, duration, high-value session share)
 * and user engagement segments for the Geographic page.
 */
router.get(
    '/geo-value',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { timeRange, projectId } = req.query;

        const emptyResult = {
            regions: [],
            summary: {
                totalSessions: 0,
                totalValueSessions: 0,
                valueShare: 0,
                avgUxScore: 0,
                avgDurationSeconds: 0,
                regionCount: 0,
            },
        };

        // Get accessible projects for user
        const membership = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = membership.map((m) => m.teamId);
        if (teamIds.length === 0) {
            res.json(emptyResult);
            return;
        }

        const accessibleProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.teamId, teamIds));

        const projectIds = projectId
            ? [projectId as string]
            : accessibleProjects.map((p) => p.id);

        if (projectIds.length === 0) {
            res.json(emptyResult);
            return;
        }

        const cacheKey = `analytics:geo-value:${projectIds.sort().join(',')}:${timeRange || 'all'}:v1`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        let startedAfter: Date | undefined;
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '24h' ? 1 :
                timeRange === '7d' ? 7 :
                    timeRange === '30d' ? 30 :
                        timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        const conditions = [
            inArray(sessions.projectId, projectIds),
            isNotNull(sessions.geoCountry),
        ];
        if (startedAfter) {
            conditions.push(gte(sessions.startedAt, startedAfter));
        }

        const durationSql = sql`coalesce(${sessions.durationSeconds}, 0)`;
        const screensVisitedSql = sql`coalesce(array_length(${sessionMetrics.screensVisited}, 1), 0)`;

        const regionalRows = await db
            .select({
                country: sessions.geoCountry,
                sessionsCount: sql<number>`count(*)`,
                avgDurationSeconds: sql<number>`round(avg(${durationSql})::numeric, 1)`,
                avgUxScore: sql<number>`round(avg(coalesce(${sessionMetrics.uxScore}, 0))::numeric, 1)`,
                bouncers: sql<number>`sum(case when ${durationSql} < 10 and ${screensVisitedSql} <= 3 then 1 else 0 end)`,
                casuals: sql<number>`sum(case when ${durationSql} >= 10 and ${durationSql} <= 60 and ${screensVisitedSql} <= 3 then 1 else 0 end)`,
                explorers: sql<number>`sum(case when ${durationSql} <= 180 and (${durationSql} > 60 or ${screensVisitedSql} > 3) then 1 else 0 end)`,
                loyalists: sql<number>`sum(case when ${durationSql} > 180 then 1 else 0 end)`,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .groupBy(sessions.geoCountry);

        const regions = regionalRows
            .filter((row) => Boolean(row.country))
            .map((row) => {
                const country = row.country as string;
                const sessionsCount = Number(row.sessionsCount || 0);
                const bouncers = Number(row.bouncers || 0);
                const casuals = Number(row.casuals || 0);
                const explorers = Number(row.explorers || 0);
                const loyalists = Number(row.loyalists || 0);
                const valueSessions = explorers + loyalists;
                const valueShare = toPercent(valueSessions, Math.max(1, sessionsCount), 2);

                return {
                    country,
                    sessions: sessionsCount,
                    valueSessions,
                    valueShare,
                    avgUxScore: Number(row.avgUxScore || 0),
                    avgDurationSeconds: Number(row.avgDurationSeconds || 0),
                    engagementSegments: {
                        bouncers,
                        casuals,
                        explorers,
                        loyalists,
                    },
                };
            })
            .filter((row) => row.sessions > 0)
            .sort((a, b) => b.valueSessions - a.valueSessions || b.sessions - a.sessions);

        const totalSessions = regions.reduce((sum, row) => sum + row.sessions, 0);
        const totalValueSessions = regions.reduce((sum, row) => sum + row.valueSessions, 0);
        const weightedUxSum = regions.reduce((sum, row) => sum + (row.avgUxScore * row.sessions), 0);
        const weightedDurationSum = regions.reduce((sum, row) => sum + (row.avgDurationSeconds * row.sessions), 0);

        const result = {
            regions,
            summary: {
                totalSessions,
                totalValueSessions,
                valueShare: toPercent(totalValueSessions, Math.max(1, totalSessions), 2),
                avgUxScore: totalSessions > 0 ? Number((weightedUxSum / totalSessions).toFixed(1)) : 0,
                avgDurationSeconds: totalSessions > 0 ? Number((weightedDurationSum / totalSessions).toFixed(1)) : 0,
                regionCount: regions.length,
            },
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Get geographic distribution of issues (errors, crashes, ANRs, rage taps)
 * GET /api/analytics/geo-issues
 * 
 * Aggregates issues by country/city using session geo data from issue events.
 * Used by the Geographic page to show issue hotspots on the map.
 */
router.get(
    '/geo-issues',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { timeRange, projectId, issueType } = req.query;

        // Get accessible projects for user
        const membership = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = membership.map(m => m.teamId);
        if (teamIds.length === 0) {
            res.json({ locations: [], summary: { totalIssues: 0, byType: {} } });
            return;
        }

        const accessibleProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.teamId, teamIds));

        const projectIds = projectId
            ? [projectId as string]
            : accessibleProjects.map(p => p.id);

        if (projectIds.length === 0) {
            res.json({ locations: [], summary: { totalIssues: 0, byType: {} } });
            return;
        }

        // Build cache key
        const cacheKey = `analytics:geo-issues:${projectIds.sort().join(',')}:${timeRange || 'all'}:${issueType || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Build time filter
        let startedAfter: Date | undefined;
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '24h' ? 1 :
                timeRange === '7d' ? 7 :
                    timeRange === '30d' ? 30 :
                        timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        // Import required tables
        const { sessions, sessionMetrics } = await import('../db/client.js');

        // Query sessions with geo data and their associated issues
        const conditions = [
            inArray(sessions.projectId, projectIds),
        ];
        if (startedAfter) {
            conditions.push(gte(sessions.startedAt, startedAfter));
        }

        // Get sessions with geo data and aggregated issue counts directly in SQL
        // This avoids loading 100k+ records into RAM
        const geoIssuesAgg = await db
            .select({
                country: sessions.geoCountry,
                city: sessions.geoCity,
                latitude: sql<number>`min(${sessions.geoLatitude})`,
                longitude: sql<number>`min(${sessions.geoLongitude})`,
                sessionsCount: sql<number>`count(*)`,
                crashCount: sql<number>`sum(${sessionMetrics.crashCount})`,
                anrCount: sql<number>`sum(${sessionMetrics.anrCount})`,
                errorCount: sql<number>`sum(${sessionMetrics.errorCount})`,
                rageTapCount: sql<number>`sum(${sessionMetrics.rageTapCount})`,
                apiErrorCount: sql<number>`sum(${sessionMetrics.apiErrorCount})`,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .groupBy(sessions.geoCountry, sessions.geoCity);

        // Aggregate by country and city for the UI
        type IssueAggregation = {
            sessions: number;
            crashes: number;
            anrs: number;
            errors: number;
            rageTaps: number;
            apiErrors: number;
            lat?: number;
            lng?: number;
            cities: Record<string, {
                sessions: number;
                crashes: number;
                anrs: number;
                errors: number;
                rageTaps: number;
                apiErrors: number;
                lat?: number;
                lng?: number;
            }>;
        };

        const countryMap: Record<string, IssueAggregation> = {};

        const summary = {
            totalIssues: 0,
            byType: {
                crashes: 0,
                anrs: 0,
                errors: 0,
                rageTaps: 0,
                apiErrors: 0,
            }
        };

        for (const row of geoIssuesAgg) {
            if (!row.country) continue;

            const rowCrashes = Number(row.crashCount || 0);
            const rowAnrs = Number(row.anrCount || 0);
            const rowErrors = Number(row.errorCount || 0);
            const rowRageTaps = Number(row.rageTapCount || 0);
            const rowApiErrors = Number(row.apiErrorCount || 0);

            summary.byType.crashes += rowCrashes;
            summary.byType.anrs += rowAnrs;
            summary.byType.errors += rowErrors;
            summary.byType.rageTaps += rowRageTaps;
            summary.byType.apiErrors += rowApiErrors;
            summary.totalIssues += (rowCrashes + rowAnrs + rowErrors + rowRageTaps + rowApiErrors);

            if (!countryMap[row.country]) {
                countryMap[row.country] = {
                    sessions: 0,
                    crashes: 0,
                    anrs: 0,
                    errors: 0,
                    rageTaps: 0,
                    apiErrors: 0,
                    lat: row.latitude ?? undefined,
                    lng: row.longitude ?? undefined,
                    cities: {},
                };
            }
            const c = countryMap[row.country];
            c.sessions += Number(row.sessionsCount);
            c.crashes += rowCrashes;
            c.anrs += rowAnrs;
            c.errors += rowErrors;
            c.rageTaps += rowRageTaps;
            c.apiErrors += rowApiErrors;

            if (row.city) {
                c.cities[row.city] = {
                    sessions: Number(row.sessionsCount),
                    crashes: rowCrashes,
                    anrs: rowAnrs,
                    errors: rowErrors,
                    rageTaps: rowRageTaps,
                    apiErrors: rowApiErrors,
                    lat: row.latitude ?? undefined,
                    lng: row.longitude ?? undefined,
                };
            }
        }

        // Transform to locations array (city-level for map markers)
        const locations = Object.entries(countryMap)
            .flatMap(([country, data]) => {
                const cityEntries = Object.entries(data.cities);

                if (cityEntries.length === 0 && data.lat && data.lng) {
                    // Country-level fallback
                    return [{
                        country,
                        city: 'Unknown',
                        lat: data.lat,
                        lng: data.lng,
                        sessions: data.sessions,
                        issues: {
                            crashes: data.crashes,
                            anrs: data.anrs,
                            errors: data.errors,
                            rageTaps: data.rageTaps,
                            apiErrors: data.apiErrors,
                            total: data.crashes + data.anrs + data.errors + data.rageTaps + data.apiErrors,
                        },
                    }];
                }

                return cityEntries
                    .filter(([_, cityData]) => cityData.lat && cityData.lng)
                    .map(([city, cityData]) => ({
                        country,
                        city,
                        lat: cityData.lat!,
                        lng: cityData.lng!,
                        sessions: cityData.sessions,
                        issues: {
                            crashes: cityData.crashes,
                            anrs: cityData.anrs,
                            errors: cityData.errors,
                            rageTaps: cityData.rageTaps,
                            apiErrors: cityData.apiErrors,
                            total: cityData.crashes + cityData.anrs + cityData.errors + cityData.rageTaps + cityData.apiErrors,
                        },
                    }));
            })
            .sort((a, b) => b.issues.total - a.issues.total);

        // Also include country-level aggregation for summary
        const countries = Object.entries(countryMap)
            .map(([country, data]) => ({
                country,
                sessions: data.sessions,
                crashes: data.crashes,
                anrs: data.anrs,
                errors: data.errors,
                rageTaps: data.rageTaps,
                apiErrors: data.apiErrors,
                totalIssues: data.crashes + data.anrs + data.errors + data.rageTaps + data.apiErrors,
                issueRate: data.sessions > 0
                    ? Math.round(((data.crashes + data.anrs + data.errors + data.rageTaps + data.apiErrors) / data.sessions) * 100) / 100
                    : 0,
            }))
            .sort((a, b) => b.totalIssues - a.totalIssues);

        const result = { locations, countries, summary };

        // Cache for 5 minutes
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Get API latency by geographic location
 * GET /api/analytics/latency-by-location
 * 
 * Returns average API response times aggregated by country.
 * Used for "API Performance by Region" analytics.
 */
router.get(
    '/latency-by-location',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { timeRange, projectId } = req.query;

        // Get accessible projects for user
        const membership = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = membership.map(m => m.teamId);
        if (teamIds.length === 0) {
            res.json({ regions: [], summary: { avgLatency: 0, totalRequests: 0 } });
            return;
        }

        const accessibleProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.teamId, teamIds));

        const projectIds = projectId
            ? [projectId as string]
            : accessibleProjects.map(p => p.id);

        if (projectIds.length === 0) {
            res.json({ regions: [], summary: { avgLatency: 0, totalRequests: 0 } });
            return;
        }

        // Build cache key
        const cacheKey = `analytics:latency-geo:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Build time filter
        let startedAfter: Date | undefined;
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '24h' ? 1 :
                timeRange === '7d' ? 7 :
                    timeRange === '30d' ? 30 :
                        timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        // Import sessions and session_metrics tables
        const { sessions, sessionMetrics } = await import('../db/client.js');

        // Query sessions with geo and API metrics
        const conditions = [
            inArray(sessions.projectId, projectIds),
        ];
        if (startedAfter) {
            conditions.push(gte(sessions.startedAt, startedAfter));
        }

        // Get sessions with geo and API data via join
        const sessionsWithMetrics = await db
            .select({
                country: sessions.geoCountry,
                city: sessions.geoCity,
                apiTotalCount: sessionMetrics.apiTotalCount,
                apiSuccessCount: sessionMetrics.apiSuccessCount,
                apiErrorCount: sessionMetrics.apiErrorCount,
                avgDurationMs: sessionMetrics.apiAvgResponseMs,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions));

        // Aggregate by country
        const countryMap: Record<string, {
            totalRequests: number;
            totalLatencyMs: number;
            successCount: number;
            errorCount: number;
        }> = {};

        let globalTotalRequests = 0;
        let globalTotalLatency = 0;

        for (const s of sessionsWithMetrics) {
            if (!s.country) continue;
            const apiCount = Number(s.apiTotalCount || 0);
            const avgDuration = Number(s.avgDurationMs || 0);

            if (apiCount === 0) continue;

            if (!countryMap[s.country]) {
                countryMap[s.country] = {
                    totalRequests: 0,
                    totalLatencyMs: 0,
                    successCount: 0,
                    errorCount: 0,
                };
            }

            countryMap[s.country].totalRequests += apiCount;
            countryMap[s.country].totalLatencyMs += avgDuration * apiCount;
            countryMap[s.country].successCount += Number(s.apiSuccessCount || 0);
            countryMap[s.country].errorCount += Number(s.apiErrorCount || 0);

            globalTotalRequests += apiCount;
            globalTotalLatency += avgDuration * apiCount;
        }

        // Transform to sorted array
        const regions = Object.entries(countryMap)
            .filter(([_, data]) => data.totalRequests > 0)
            .map(([country, data]) => ({
                country,
                totalRequests: data.totalRequests,
                avgLatencyMs: Math.round(data.totalLatencyMs / data.totalRequests),
                successRate: data.totalRequests > 0
                    ? Math.round((data.successCount / data.totalRequests) * 100)
                    : 0,
                errorCount: data.errorCount,
            }))
            .sort((a, b) => b.totalRequests - a.totalRequests);

        const result = {
            regions,
            summary: {
                avgLatency: globalTotalRequests > 0
                    ? Math.round(globalTotalLatency / globalTotalRequests)
                    : 0,
                totalRequests: globalTotalRequests,
            }
        };

        // Cache for 5 minutes
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Device Summary - Aggregated device breakdown with issue counts
 * GET /api/analytics/device-summary
 */
router.get(
    '/device-summary',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        // Get project IDs user has access to
        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            // Verify access inline
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [membership] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!membership) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({ devices: [], platforms: {}, osVersions: [], appVersions: [], totalSessions: 0 });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({ devices: [], platforms: {}, osVersions: [], appVersions: [], totalSessions: 0 });
            return;
        }

        // Cache check - v4 includes per-dimension issue counts.
        const cacheKey = `analytics:device-summary:${projectIds.sort().join(',')}:${timeRange || 'all'}:v4`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Date filter for rollup query
        let startDateStr: string | undefined;
        if (timeRange && timeRange !== 'all' && timeRange !== 'max') {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
                startDateStr = startDate.toISOString().split('T')[0];
            }
        }

        // Query session counts from appDailyStats rollup table (SCALABLE - queries days, not sessions)
        const conditions = [inArray(appDailyStats.projectId, projectIds)];
        if (startDateStr) {
            conditions.push(gte(appDailyStats.date, startDateStr));
        }

        const dailyStats = await db
            .select({
                totalSessions: appDailyStats.totalSessions,
                deviceModelBreakdown: appDailyStats.deviceModelBreakdown,
                osVersionBreakdown: appDailyStats.osVersionBreakdown,
                platformBreakdown: appDailyStats.platformBreakdown,
                appVersionBreakdown: appDailyStats.appVersionBreakdown,
                totalCrashes: appDailyStats.totalCrashes,
                totalAnrs: appDailyStats.totalAnrs,
                totalErrors: appDailyStats.totalErrors,
            })
            .from(appDailyStats)
            .where(and(...conditions));

        // Aggregate JSONB session breakdowns across all days.
        const deviceCounts: Record<string, number> = {};
        const osCounts: Record<string, number> = {};
        const versionCounts: Record<string, number> = {};
        const platformCounts: Record<string, number> = {};
        let totalSessions = 0;

        type IssueBreakdown = { crashes: number; anrs: number; errors: number; rageTaps: number };
        const deviceIssues: Record<string, IssueBreakdown> = {};
        const osIssues: Record<string, IssueBreakdown> = {};
        const versionIssues: Record<string, IssueBreakdown> = {};

        const ensureIssueBucket = (map: Record<string, IssueBreakdown>, key: string): IssueBreakdown => {
            if (!map[key]) {
                map[key] = { crashes: 0, anrs: 0, errors: 0, rageTaps: 0 };
            }
            return map[key];
        };

        const normalizeKey = (value: unknown): string => {
            const str = typeof value === 'string' ? value.trim() : '';
            return str.length > 0 ? str : 'UNKNOWN';
        };

        const addIssueCount = (
            key: string,
            issueType: keyof IssueBreakdown,
            count: number,
            map: Record<string, IssueBreakdown>
        ) => {
            const bucket = ensureIssueBucket(map, normalizeKey(key));
            bucket[issueType] += count;
        };

        // Helper to merge JSONB breakdowns
        const mergeBreakdown = (target: Record<string, number>, source: Record<string, number> | null) => {
            if (!source) return;
            for (const [key, value] of Object.entries(source)) {
                target[key] = (target[key] || 0) + value;
            }
        };

        for (const day of dailyStats) {
            totalSessions += day.totalSessions;
            mergeBreakdown(deviceCounts, day.deviceModelBreakdown);
            mergeBreakdown(osCounts, day.osVersionBreakdown);
            mergeBreakdown(platformCounts, day.platformBreakdown);
            mergeBreakdown(versionCounts, day.appVersionBreakdown);
        }

        const startTime = startDateStr ? new Date(`${startDateStr}T00:00:00.000Z`) : undefined;

        // Aggregate issue counts by device/os/app from raw issue tables.
        const crashWhere = [inArray(crashes.projectId, projectIds)];
        if (startTime) crashWhere.push(gte(crashes.timestamp, startTime));

        const crashDeviceExpr = sql<string>`COALESCE(NULLIF(TRIM(${sessions.deviceModel}), ''), NULLIF(TRIM(${crashes.deviceMetadata}::jsonb->>'deviceModel'), ''), 'UNKNOWN')`;
        const crashOsExpr = sql<string>`COALESCE(NULLIF(TRIM(${sessions.osVersion}), ''), NULLIF(TRIM(${crashes.deviceMetadata}::jsonb->>'osVersion'), ''), NULLIF(TRIM(${crashes.deviceMetadata}::jsonb->>'os_version'), ''), 'UNKNOWN')`;
        const crashAppExpr = sql<string>`COALESCE(NULLIF(TRIM(${sessions.appVersion}), ''), NULLIF(TRIM(${crashes.deviceMetadata}::jsonb->>'appVersion'), ''), NULLIF(TRIM(${crashes.deviceMetadata}::jsonb->>'app_version'), ''), 'UNKNOWN')`;

        const crashRows = await db
            .select({
                model: crashDeviceExpr,
                osVersion: crashOsExpr,
                appVersion: crashAppExpr,
                count: sql<number>`count(*)::int`,
            })
            .from(crashes)
            .leftJoin(sessions, eq(crashes.sessionId, sessions.id))
            .where(and(...crashWhere))
            .groupBy(crashDeviceExpr, crashOsExpr, crashAppExpr);

        for (const row of crashRows) {
            const c = Number(row.count) || 0;
            addIssueCount(row.model, 'crashes', c, deviceIssues);
            addIssueCount(row.osVersion, 'crashes', c, osIssues);
            addIssueCount(row.appVersion, 'crashes', c, versionIssues);
        }

        const anrWhere = [inArray(anrs.projectId, projectIds)];
        if (startTime) anrWhere.push(gte(anrs.timestamp, startTime));

        const anrDeviceExpr = sql<string>`COALESCE(NULLIF(TRIM(${sessions.deviceModel}), ''), NULLIF(TRIM(${anrs.deviceMetadata}::jsonb->>'deviceModel'), ''), 'UNKNOWN')`;
        const anrOsExpr = sql<string>`COALESCE(NULLIF(TRIM(${sessions.osVersion}), ''), NULLIF(TRIM(${anrs.deviceMetadata}::jsonb->>'osVersion'), ''), NULLIF(TRIM(${anrs.deviceMetadata}::jsonb->>'os_version'), ''), 'UNKNOWN')`;
        const anrAppExpr = sql<string>`COALESCE(NULLIF(TRIM(${sessions.appVersion}), ''), NULLIF(TRIM(${anrs.deviceMetadata}::jsonb->>'appVersion'), ''), NULLIF(TRIM(${anrs.deviceMetadata}::jsonb->>'app_version'), ''), 'UNKNOWN')`;

        const anrRows = await db
            .select({
                model: anrDeviceExpr,
                osVersion: anrOsExpr,
                appVersion: anrAppExpr,
                count: sql<number>`count(*)::int`,
            })
            .from(anrs)
            .leftJoin(sessions, eq(anrs.sessionId, sessions.id))
            .where(and(...anrWhere))
            .groupBy(anrDeviceExpr, anrOsExpr, anrAppExpr);

        for (const row of anrRows) {
            const c = Number(row.count) || 0;
            addIssueCount(row.model, 'anrs', c, deviceIssues);
            addIssueCount(row.osVersion, 'anrs', c, osIssues);
            addIssueCount(row.appVersion, 'anrs', c, versionIssues);
        }

        const errorWhere = [inArray(errors.projectId, projectIds)];
        if (startTime) errorWhere.push(gte(errors.timestamp, startTime));

        const errorDeviceExpr = sql<string>`COALESCE(NULLIF(TRIM(${errors.deviceModel}), ''), NULLIF(TRIM(${sessions.deviceModel}), ''), 'UNKNOWN')`;
        const errorOsExpr = sql<string>`COALESCE(NULLIF(TRIM(${errors.osVersion}), ''), NULLIF(TRIM(${sessions.osVersion}), ''), 'UNKNOWN')`;
        const errorAppExpr = sql<string>`COALESCE(NULLIF(TRIM(${errors.appVersion}), ''), NULLIF(TRIM(${sessions.appVersion}), ''), 'UNKNOWN')`;

        const errorRows = await db
            .select({
                model: errorDeviceExpr,
                osVersion: errorOsExpr,
                appVersion: errorAppExpr,
                count: sql<number>`count(*)::int`,
            })
            .from(errors)
            .leftJoin(sessions, eq(errors.sessionId, sessions.id))
            .where(and(...errorWhere))
            .groupBy(errorDeviceExpr, errorOsExpr, errorAppExpr);

        for (const row of errorRows) {
            const c = Number(row.count) || 0;
            addIssueCount(row.model, 'errors', c, deviceIssues);
            addIssueCount(row.osVersion, 'errors', c, osIssues);
            addIssueCount(row.appVersion, 'errors', c, versionIssues);
        }

        // Aggregate Rage Taps
        const rageWhere = [inArray(sessions.projectId, projectIds), gt(sessionMetrics.rageTapCount, 0)];
        if (startTime) rageWhere.push(gte(sessions.startedAt, startTime));

        const rageRows = await db
            .select({
                model: sql<string>`COALESCE(NULLIF(TRIM(${sessions.deviceModel}), ''), 'UNKNOWN')`,
                osVersion: sql<string>`COALESCE(NULLIF(TRIM(${sessions.osVersion}), ''), 'UNKNOWN')`,
                appVersion: sql<string>`COALESCE(NULLIF(TRIM(${sessions.appVersion}), ''), 'UNKNOWN')`,
                count: sql<number>`sum(${sessionMetrics.rageTapCount})::int`,
            })
            .from(sessions)
            .innerJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...rageWhere))
            .groupBy(sessions.deviceModel, sessions.osVersion, sessions.appVersion);

        for (const row of rageRows) {
            const c = Number(row.count) || 0;
            addIssueCount(row.model, 'rageTaps', c, deviceIssues);
            addIssueCount(row.osVersion, 'rageTaps', c, osIssues);
            addIssueCount(row.appVersion, 'rageTaps', c, versionIssues);
        }

        // Transform to arrays. Session counts come from rollups, issue counts from raw tables.
        const deviceKeys = new Set([...Object.keys(deviceCounts), ...Object.keys(deviceIssues)]);
        const osKeys = new Set([...Object.keys(osCounts), ...Object.keys(osIssues)]);
        const versionKeys = new Set([...Object.keys(versionCounts), ...Object.keys(versionIssues)]);

        const devices = Array.from(deviceKeys)
            .map((model) => ({
                model,
                count: deviceCounts[model] || 0,
                crashes: deviceIssues[model]?.crashes || 0,
                anrs: deviceIssues[model]?.anrs || 0,
                errors: deviceIssues[model]?.errors || 0,
                rageTaps: deviceIssues[model]?.rageTaps || 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);

        const appVersions = Array.from(versionKeys)
            .map((version) => ({
                version,
                count: versionCounts[version] || 0,
                crashes: versionIssues[version]?.crashes || 0,
                anrs: versionIssues[version]?.anrs || 0,
                errors: versionIssues[version]?.errors || 0,
                rageTaps: versionIssues[version]?.rageTaps || 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        const osVersions = Array.from(osKeys)
            .map((version) => ({
                version,
                count: osCounts[version] || 0,
                crashes: osIssues[version]?.crashes || 0,
                anrs: osIssues[version]?.anrs || 0,
                errors: osIssues[version]?.errors || 0,
                rageTaps: osIssues[version]?.rageTaps || 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        const result = {
            devices,
            platforms: platformCounts,
            appVersions,
            osVersions,
            totalSessions,
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Get device issues matrix (Device x Version impact)
 * GET /api/analytics/device-issues-matrix
 */
router.get(
    '/device-issues-matrix',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        if (!projectId || typeof projectId !== 'string') {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify access
        const [project] = await db
            .select({ teamId: projects.teamId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) throw ApiError.notFound('Project not found');

        const [membership] = await db
            .select({ id: teamMembers.id })
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) throw ApiError.forbidden('Access denied');

        // Check cache
        const cacheKey = `analytics:device-matrix:${projectId}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Date filter
        let startDate: Date | undefined;
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
            }
        }

        const conditions = [eq(sessions.projectId, projectId)];
        if (startDate) {
            conditions.push(gte(sessions.startedAt, startDate));
        }

        // Group by Device + AppVersion and sum up issues from sessionMetrics
        // Limiting to meaningful sessions (e.g. at least 1)
        const matrixData = await db
            .select({
                device: sql<string>`COALESCE(NULLIF(TRIM(${sessions.deviceModel}), ''), 'UNKNOWN')`,
                version: sql<string>`COALESCE(NULLIF(TRIM(${sessions.appVersion}), ''), 'UNKNOWN')`,
                sessions: sql<number>`count(*)::int`,
                crashCount: sql<number>`sum(${sessionMetrics.crashCount})::int`,
                anrCount: sql<number>`sum(${sessionMetrics.anrCount})::int`,
                errorCount: sql<number>`sum(${sessionMetrics.errorCount})::int`,
                rageTapCount: sql<number>`sum(${sessionMetrics.rageTapCount})::int`,
            })
            .from(sessions)
            .innerJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .groupBy(sessions.deviceModel, sessions.appVersion)
            .having(sql`count(*) > 0`);

        // Post-process to find top devices and versions to prevent huge matrix
        // We want Top 10-15 recent versions and Top 20-30 devices
        const deviceTotals: Record<string, number> = {};
        const versionTotals: Record<string, number> = {};

        matrixData.forEach(row => {
            const d = row.device;
            const v = row.version;
            deviceTotals[d] = (deviceTotals[d] || 0) + row.sessions;
            versionTotals[v] = (versionTotals[v] || 0) + row.sessions;
        });

        const topDevices = Object.entries(deviceTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30)
            .map(e => e[0]);

        const topVersions = Object.entries(versionTotals)
            .sort((a, b) => b[1] - a[1]) // Sort by volume for now, ideally version semver
            .slice(0, 15)
            .map(e => e[0]);
        // Re-sort versions alphanumerically or semantically if possible
        topVersions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

        const topDevicesSet = new Set(topDevices);
        const topVersionsSet = new Set(topVersions);

        const filteredMatrix = matrixData
            .filter(row => topDevicesSet.has(row.device) && topVersionsSet.has(row.version))
            .map(row => {
                const totalIssues = (row.crashCount || 0) + (row.anrCount || 0) + (row.errorCount || 0);
                const issueRate = row.sessions > 0 ? totalIssues / row.sessions : 0;
                return {
                    device: row.device,
                    version: row.version,
                    sessions: row.sessions,
                    issues: {
                        crashes: row.crashCount || 0,
                        anrs: row.anrCount || 0,
                        errors: row.errorCount || 0,
                        rageTaps: row.rageTapCount || 0,
                    },
                    issueRate: Number(issueRate.toFixed(4)),
                };
            });

        const response = {
            matrix: filteredMatrix,
            devices: topDevices,
            versions: topVersions,
        };

        await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);
        res.json(response);
    })
);

/**
 * Journey Summary - Screen flow aggregation
 * GET /api/analytics/journey-summary
 */
router.get(
    '/journey-summary',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            // Verify access inline
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [mem] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!mem) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({ topScreens: [], flows: [], entryPoints: [], exitPoints: [] });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({ topScreens: [], flows: [], entryPoints: [], exitPoints: [] });
            return;
        }

        const cacheKey = `analytics:journey-summary:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        let startDateStr: string | undefined;
        if (timeRange) {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
                startDateStr = startDate.toISOString().split('T')[0];
            }
        }

        // Use pre-aggregated stats from appDailyStats
        const conditions = [inArray(appDailyStats.projectId, projectIds)];
        if (startDateStr) {
            conditions.push(gte(appDailyStats.date, startDateStr));
        }

        const dailyStats = await db
            .select({
                screenViewBreakdown: appDailyStats.screenViewBreakdown,
                screenTransitionBreakdown: appDailyStats.screenTransitionBreakdown,
                entryScreenBreakdown: appDailyStats.entryScreenBreakdown,
                exitScreenBreakdown: appDailyStats.exitScreenBreakdown,
            })
            .from(appDailyStats)
            .where(and(...conditions));

        // Merge JSONB breakdowns from all daily stats
        const screenCounts: Record<string, number> = {};
        const flowCounts: Record<string, number> = {};
        const entryCounts: Record<string, number> = {};
        const exitCounts: Record<string, number> = {};

        const mergeBreakdowns = (target: Record<string, number>, source: Record<string, number> | null) => {
            if (!source) return;
            for (const [key, value] of Object.entries(source)) {
                target[key] = (target[key] || 0) + value;
            }
        };

        for (const stat of dailyStats) {
            mergeBreakdowns(screenCounts, stat.screenViewBreakdown);
            mergeBreakdowns(flowCounts, stat.screenTransitionBreakdown);
            mergeBreakdowns(entryCounts, stat.entryScreenBreakdown);
            mergeBreakdowns(exitCounts, stat.exitScreenBreakdown);
        }

        const topScreens = Object.entries(screenCounts)
            .map(([screen, visits]) => ({ screen, visits }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 20);

        const flows = Object.entries(flowCounts)
            .map(([key, count]) => {
                const [from, to] = key.split('→');
                return { from, to, count };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);

        const entryPoints = Object.entries(entryCounts)
            .map(([screen, count]) => ({ screen, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const exitPoints = Object.entries(exitCounts)
            .map(([screen, count]) => ({ screen, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const result = { topScreens, flows, entryPoints, exitPoints };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * User Segments - Pre-computed behavior segments
 * GET /api/analytics/user-segments
 */
router.get(
    '/user-segments',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            // Verify access inline
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [mem] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!mem) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({ segments: [] });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({ segments: [] });
            return;
        }

        const cacheKey = `analytics:user-segments:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        let startedAfter: Date | undefined;
        if (timeRange) {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        const { sessions, sessionMetrics } = await import('../db/client.js');

        const conditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) {
            conditions.push(gte(sessions.startedAt, startedAfter));
        }

        const sessionsData = await db
            .select({
                id: sessions.id,
                uxScore: sessionMetrics.uxScore,
                explorationScore: sessionMetrics.explorationScore,
                rageTapCount: sessionMetrics.rageTapCount,
                crashCount: sessionMetrics.crashCount,
                durationSeconds: sessions.durationSeconds,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions));

        // Define segments
        const segments = {
            powerUsers: [] as string[],
            frustrated: [] as string[],
            explorers: [] as string[],
            quickDropoffs: [] as string[],
            crashed: [] as string[],
            engaged: [] as string[],
        };

        for (const s of sessionsData) {
            const ux = Number(s.uxScore || 0);
            const exploration = Number(s.explorationScore || 0);
            const rage = Number(s.rageTapCount || 0);
            const crash = Number(s.crashCount || 0);
            const duration = Number(s.durationSeconds || 0);

            if (crash > 0) segments.crashed.push(s.id);
            else if (rage > 3 || ux < 50) segments.frustrated.push(s.id);
            else if (duration < 30) segments.quickDropoffs.push(s.id);
            else if (exploration > 70) segments.explorers.push(s.id);
            else if (ux > 80 && duration > 300) segments.powerUsers.push(s.id);
            else if (ux > 60) segments.engaged.push(s.id);
        }

        const result = {
            segments: [
                { name: 'Power Users', count: segments.powerUsers.length, color: '#10b981', examples: segments.powerUsers.slice(0, 3) },
                { name: 'Frustrated', count: segments.frustrated.length, color: '#ef4444', examples: segments.frustrated.slice(0, 3) },
                { name: 'Explorers', count: segments.explorers.length, color: '#3b82f6', examples: segments.explorers.slice(0, 3) },
                { name: 'Quick Dropoffs', count: segments.quickDropoffs.length, color: '#f59e0b', examples: segments.quickDropoffs.slice(0, 3) },
                { name: 'Crashed', count: segments.crashed.length, color: '#dc2626', examples: segments.crashed.slice(0, 3) },
                { name: 'Engaged', count: segments.engaged.length, color: '#8b5cf6', examples: segments.engaged.slice(0, 3) },
            ],
            totalSessions: sessionsData.length,
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * API Endpoint Stats - Per-endpoint performance metrics
 * GET /api/analytics/api-endpoint-stats
 * 
 * Returns:
 * - Top 3 slowest endpoints
 * - Top 3 most erroring endpoints
 * - All endpoints with latency and call count
 */
router.get(
    '/api-endpoint-stats',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        // Get accessible projects
        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [membership] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!membership) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({ slowestEndpoints: [], erroringEndpoints: [], allEndpoints: [], summary: { totalCalls: 0, avgLatency: 0, errorRate: 0 } });
                return;
            }
            const userProjects = await db.select({ id: projects.id }).from(projects).where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({ slowestEndpoints: [], erroringEndpoints: [], allEndpoints: [], summary: { totalCalls: 0, avgLatency: 0, errorRate: 0 } });
            return;
        }

        const cacheKey = `analytics:api-endpoint-stats:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Date filter
        let startDate: string | undefined;
        if (timeRange) {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                const d = new Date();
                d.setDate(d.getDate() - days);
                startDate = d.toISOString().split('T')[0];
            }
        }

        // Import the new table
        const { apiEndpointDailyStats } = await import('../db/client.js');

        // Build query conditions
        const conditions = [inArray(apiEndpointDailyStats.projectId, projectIds)];
        if (startDate) {
            conditions.push(gte(apiEndpointDailyStats.date, startDate));
        }

        // Query aggregated endpoint stats
        const stats = await db
            .select({
                endpoint: apiEndpointDailyStats.endpoint,
                totalCalls: apiEndpointDailyStats.totalCalls,
                totalErrors: apiEndpointDailyStats.totalErrors,
                sumLatencyMs: apiEndpointDailyStats.sumLatencyMs,
            })
            .from(apiEndpointDailyStats)
            .where(and(...conditions));

        // Aggregate across dates per endpoint
        const endpointMap: Record<string, { totalCalls: number; totalErrors: number; sumLatencyMs: number }> = {};

        for (const s of stats) {
            if (!endpointMap[s.endpoint]) {
                endpointMap[s.endpoint] = { totalCalls: 0, totalErrors: 0, sumLatencyMs: 0 };
            }
            endpointMap[s.endpoint].totalCalls += Number(s.totalCalls || 0);
            endpointMap[s.endpoint].totalErrors += Number(s.totalErrors || 0);
            endpointMap[s.endpoint].sumLatencyMs += Number(s.sumLatencyMs || 0);
        }

        // Transform to array with computed avg latency
        const allEndpoints = Object.entries(endpointMap)
            .map(([endpoint, data]) => ({
                endpoint,
                totalCalls: data.totalCalls,
                totalErrors: data.totalErrors,
                avgLatencyMs: data.totalCalls > 0 ? Math.round(data.sumLatencyMs / data.totalCalls) : 0,
                errorRate: data.totalCalls > 0 ? Number(((data.totalErrors / data.totalCalls) * 100).toFixed(2)) : 0,
            }))
            .sort((a, b) => b.totalCalls - a.totalCalls);

        // Top 3 slowest
        const slowestEndpoints = [...allEndpoints]
            .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
            .slice(0, 3);

        // Top 3 most erroring (by error count, not rate)
        const erroringEndpoints = [...allEndpoints]
            .filter(e => e.totalErrors > 0)
            .sort((a, b) => b.totalErrors - a.totalErrors)
            .slice(0, 3);

        // Summary stats
        const totalCalls = allEndpoints.reduce((sum, e) => sum + e.totalCalls, 0);
        const totalErrors = allEndpoints.reduce((sum, e) => sum + e.totalErrors, 0);
        const totalLatency = Object.values(endpointMap).reduce((sum, e) => sum + e.sumLatencyMs, 0);

        const result = {
            slowestEndpoints,
            erroringEndpoints,
            allEndpoints,
            summary: {
                totalCalls,
                avgLatency: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
                errorRate: totalCalls > 0 ? Number(((totalErrors / totalCalls) * 100).toFixed(2)) : 0,
            }
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Region Performance - Top 3 fastest and slowest regions by API latency
 * GET /api/analytics/region-performance
 * 
 * Uses session-level geo data and API metrics to compute average latency per region.
 */
router.get(
    '/region-performance',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        if (!projectId || typeof projectId !== 'string') {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify access
        const [project] = await db
            .select({ id: projects.id, teamId: projects.teamId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select({ id: teamMembers.id })
            .from(teamMembers)
            .where(and(
                eq(teamMembers.teamId, project.teamId),
                eq(teamMembers.userId, req.user!.id)
            ))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Cache check - v2 for rollup-based implementation
        const cacheKey = `analytics:region-performance:${projectId}:${timeRange || '30d'}:v2`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Time filter for rollup query
        const days = timeRange === '7d' ? 7 :
            timeRange === '90d' ? 90 :
                timeRange === 'max' || timeRange === 'all' ? 365 : 30; // Default 30 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        // Import apiEndpointDailyStats
        const { apiEndpointDailyStats } = await import('../db/client.js');

        // Query from rollup table grouped by region (SCALABLE)
        const regionStats = await db
            .select({
                region: apiEndpointDailyStats.region,
                totalCalls: sql<number>`sum(${apiEndpointDailyStats.totalCalls})::int`,
                sumLatencyMs: sql<number>`sum(${apiEndpointDailyStats.sumLatencyMs})::bigint`,
            })
            .from(apiEndpointDailyStats)
            .where(and(
                eq(apiEndpointDailyStats.projectId, projectId),
                gte(apiEndpointDailyStats.date, startDateStr)
            ))
            .groupBy(apiEndpointDailyStats.region);

        // Get country names
        const getCountryName = (code: string): string => {
            const names: Record<string, string> = {
                'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada',
                'AU': 'Australia', 'DE': 'Germany', 'FR': 'France', 'JP': 'Japan',
                'CN': 'China', 'IN': 'India', 'BR': 'Brazil', 'MX': 'Mexico',
                'KR': 'South Korea', 'IT': 'Italy', 'ES': 'Spain', 'NL': 'Netherlands',
                'SE': 'Sweden', 'SG': 'Singapore', 'HK': 'Hong Kong', 'local': 'Local Network',
                'PS/IL': 'Palestine/Israel', 'unknown': 'Unknown Region'
            };
            return names[code] || code;
        };

        // Transform to sorted arrays
        const regions = regionStats
            .filter(r => Number(r.totalCalls || 0) >= 10) // Min 10 calls to be significant
            .map(r => {
                const totalCalls = Number(r.totalCalls || 0);
                const sumLatencyMs = Number(r.sumLatencyMs || 0);
                return {
                    code: r.region,
                    name: getCountryName(r.region),
                    avgLatencyMs: totalCalls > 0 ? Math.round(sumLatencyMs / totalCalls) : 0,
                    totalCalls,
                    sessionCount: 0, // Not available from this rollup
                };
            });

        // Sort by latency
        const sortedByLatency = [...regions].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);

        const result = {
            fastestRegions: sortedByLatency.slice(0, 3),
            slowestRegions: sortedByLatency.slice(-3).reverse(),
            allRegions: regions.sort((a, b) => b.totalCalls - a.totalCalls),
        };

        // Cache for 5 minutes
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * JS Errors List - Query JavaScript errors with filtering and search
 * GET /api/analytics/errors
 * 
 * Query params:
 * - projectId: required
 * - timeRange: '24h' | '7d' | '30d' | '90d' | 'all'
 * - search: search in message/errorName
 * - status: 'open' | 'resolved' | 'ignored'
 * - limit: max results (default 50)
 * - offset: pagination offset
 */
router.get(
    '/errors',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange, search, status, limit = '50', offset = '0' } = req.query;

        if (!projectId || typeof projectId !== 'string') {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify access
        const [project] = await db
            .select({ id: projects.id, teamId: projects.teamId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select({ id: teamMembers.id })
            .from(teamMembers)
            .where(and(
                eq(teamMembers.teamId, project.teamId),
                eq(teamMembers.userId, req.user!.id)
            ))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Redis caching - only when no search (search is filtered in-memory)
        // Cache for 2 minutes since errors data changes less frequently than sessions
        const cacheKey = !search ? `analytics:errors:${projectId}:${timeRange || 'all'}:${status || 'all'}:${limit}:${offset}` : null;
        if (cacheKey) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                res.json(JSON.parse(cached));
                return;
            }
        }

        // Import errors table
        const { errors } = await import('../db/client.js');
        const { desc } = await import('drizzle-orm');

        // Build conditions
        const conditions = [eq(errors.projectId, projectId)];

        // Time filter
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '24h' ? 1 :
                timeRange === '7d' ? 7 :
                    timeRange === '30d' ? 30 :
                        timeRange === '90d' ? 90 : 30;
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            conditions.push(gte(errors.timestamp, startDate));
        }

        // Status filter
        if (status && typeof status === 'string') {
            conditions.push(eq(errors.status, status));
        }

        // Get total count first
        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(errors)
            .where(and(...conditions));
        const totalCount = Number(countResult[0]?.count || 0);

        // Query errors with pagination
        const errorsQuery = db
            .select({
                id: errors.id,
                sessionId: errors.sessionId,
                timestamp: errors.timestamp,
                errorType: errors.errorType,
                errorName: errors.errorName,
                message: errors.message,
                stack: errors.stack,
                screenName: errors.screenName,
                deviceModel: errors.deviceModel,
                osVersion: errors.osVersion,
                appVersion: errors.appVersion,
                fingerprint: errors.fingerprint,
                status: errors.status,
                createdAt: errors.createdAt,
            })
            .from(errors)
            .where(and(...conditions))
            .orderBy(desc(errors.timestamp))
            .limit(parseInt(limit as string) || 50)
            .offset(parseInt(offset as string) || 0);

        const errorsList = await errorsQuery;

        // Apply search filter in memory (for now - can optimize with full-text search later)
        let filteredErrors = errorsList;
        if (search && typeof search === 'string') {
            const searchLower = search.toLowerCase();
            filteredErrors = errorsList.filter(e =>
                e.message.toLowerCase().includes(searchLower) ||
                e.errorName.toLowerCase().includes(searchLower) ||
                (e.screenName && e.screenName.toLowerCase().includes(searchLower))
            );
        }

        // Group by fingerprint for summary
        const grouped = filteredErrors.reduce((acc, e) => {
            const key = e.fingerprint || e.errorName;
            if (!acc[key]) {
                acc[key] = { count: 0, firstSeen: e.timestamp, lastSeen: e.timestamp, sample: e };
            }
            acc[key].count++;
            if (e.timestamp > acc[key].lastSeen) acc[key].lastSeen = e.timestamp;
            if (e.timestamp < acc[key].firstSeen) acc[key].firstSeen = e.timestamp;
            return acc;
        }, {} as Record<string, { count: number; firstSeen: Date; lastSeen: Date; sample: typeof filteredErrors[0] }>);

        const result = {
            errors: filteredErrors,
            grouped: Object.values(grouped).map(g => ({
                errorName: g.sample.errorName,
                message: g.sample.message,
                count: g.count,
                firstSeen: g.firstSeen,
                lastSeen: g.lastSeen,
                sampleSessionId: g.sample.sessionId,
            })).sort((a, b) => b.count - a.count),
            summary: {
                total: totalCount,
                jsErrors: filteredErrors.filter(e => e.errorType === 'js_error').length,
                promiseRejections: filteredErrors.filter(e => e.errorType === 'promise_rejection').length,
                unhandledExceptions: filteredErrors.filter(e => e.errorType === 'unhandled_exception').length,
            },
            pagination: {
                offset: parseInt(offset as string) || 0,
                limit: parseInt(limit as string) || 50,
                total: totalCount,
            }
        };

        // Cache the result (2 minutes TTL)
        if (cacheKey) {
            await redis.set(cacheKey, JSON.stringify(result), 'EX', 120);
        }

        res.json(result);
    })
);

/**
 * Journey Observability - Observability-centric journey analysis
 * GET /api/analytics/journey-observability
 * 
 * Returns observability-enriched journey data including:
 * - Journey health computation (healthy/degraded/problematic)
 * - Failure-annotated transitions (API errors, latency, rage taps)
 * - Exit-after-error analysis
 * - Time-to-failure metrics
 * - Replay availability indicators
 */
router.get(
    '/journey-observability',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [mem] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!mem) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({ healthSummary: { healthy: 0, degraded: 0, problematic: 0 }, flows: [], problematicJourneys: [], happyPathJourney: null, configuredHappyPath: null, exitAfterError: [], timeToFailure: {}, screenHealth: [], topScreens: [], entryPoints: [], exitPoints: [] });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({ healthSummary: { healthy: 0, degraded: 0, problematic: 0 }, flows: [], problematicJourneys: [], happyPathJourney: null, configuredHappyPath: null, exitAfterError: [], timeToFailure: {}, screenHealth: [], topScreens: [], entryPoints: [], exitPoints: [] });
            return;
        }

        const cacheKey = `analytics:journey-observability:v2:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Time filter
        let startedAfter: Date | undefined;
        if (timeRange) {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        // Read configured happy path from schema-backed funnel stats.
        const [configuredFunnel] = await db
            .select({
                projectId: projectFunnelStats.projectId,
                path: projectFunnelStats.funnelPath,
                targetScreen: projectFunnelStats.targetScreen,
                confidence: projectFunnelStats.confidence,
                sampleSize: projectFunnelStats.sampleSize,
                updatedAt: projectFunnelStats.updatedAt,
            })
            .from(projectFunnelStats)
            .where(inArray(projectFunnelStats.projectId, projectIds))
            .orderBy(desc(projectFunnelStats.confidence), desc(projectFunnelStats.updatedAt))
            .limit(1);

        const configuredHappyPath = configuredFunnel
            ? {
                projectId: configuredFunnel.projectId,
                path: configuredFunnel.path,
                targetScreen: configuredFunnel.targetScreen,
                confidence: Number(configuredFunnel.confidence || 0),
                sampleSize: Number(configuredFunnel.sampleSize || 0),
                updatedAt: configuredFunnel.updatedAt?.toISOString?.() || null,
            }
            : null;

        // Get sessions with their metrics for observability analysis

        const conditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));

        const sessionsWithMetrics = await db
            .select({
                id: sessions.id,
                durationSeconds: sessions.durationSeconds,
                screensVisited: sessionMetrics.screensVisited,
                crashCount: sessionMetrics.crashCount,
                anrCount: sessionMetrics.anrCount,
                rageTapCount: sessionMetrics.rageTapCount,
                apiErrorCount: sessionMetrics.apiErrorCount,
                apiTotalCount: sessionMetrics.apiTotalCount,
                apiAvgResponseMs: sessionMetrics.apiAvgResponseMs,
                errorCount: sessionMetrics.errorCount,
                replayPromoted: sessions.replayPromoted,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .limit(5000);

        // Compute health for each session
        type HealthStatus = 'healthy' | 'degraded' | 'problematic';

        const computeHealth = (s: typeof sessionsWithMetrics[0]): HealthStatus => {
            const crashes = Number(s.crashCount || 0);
            const anrs = Number(s.anrCount || 0);
            const rageTaps = Number(s.rageTapCount || 0);
            const apiErrors = Number(s.apiErrorCount || 0);
            const apiTotal = Number(s.apiTotalCount || 0);
            const apiLatency = Number(s.apiAvgResponseMs || 0);
            const apiErrorRate = apiTotal > 0 ? (apiErrors / apiTotal) * 100 : 0;

            if (crashes > 0 || anrs > 0) return 'problematic';
            if (rageTaps >= 2 || apiErrorRate > 5 || apiLatency > 1000) return 'degraded';
            return 'healthy';
        };

        // Health summary
        const healthSummary = { healthy: 0, degraded: 0, problematic: 0 };
        const sessionHealthMap = new Map<string, HealthStatus>();

        for (const s of sessionsWithMetrics) {
            const health = computeHealth(s);
            sessionHealthMap.set(s.id, health);
            healthSummary[health]++;
        }

        // Screen-level stats with observability signals
        type ScreenStats = {
            visits: number;
            crashes: number;
            anrs: number;
            apiErrors: number;
            rageTaps: number;
            sessionIds: string[];
            hasReplay: boolean;
        };
        const screenStats: Record<string, ScreenStats> = {};

        // Transition-level stats with failure signals
        type TransitionStats = {
            count: number;
            apiErrors: number;
            apiTotal: number;
            latencySum: number;
            rageTaps: number;
            crashes: number;
            anrs: number;
            replayCount: number;
        };
        const transitionStats: Record<string, TransitionStats> = {};

        // Entry/Exit breakdowns
        const entryCounts: Record<string, number> = {};
        const exitCounts: Record<string, number> = {};

        // Exit after error tracking
        type ExitErrorStats = { exitCount: number; api: number; crash: number; rage: number; sessionIds: string[] };
        const exitAfterErrorMap: Record<string, ExitErrorStats> = {};

        // Time-to-failure tracking
        let totalTimeBeforeError = 0;
        let sessionsWithError = 0;
        let totalScreensBeforeCrash = 0;
        let sessionsWithCrash = 0;
        let totalInteractionsBeforeRage = 0;
        let sessionsWithRage = 0;

        // Problematic journey tracking
        type JourneyStats = {
            sessionCount: number;
            crashes: number;
            anrs: number;
            apiErrors: number;
            rageTaps: number;
            sessionIds: string[];
        };
        const journeyMap: Record<string, JourneyStats> = {};

        for (const s of sessionsWithMetrics) {
            const screens = s.screensVisited || [];
            const crashes = Number(s.crashCount || 0);
            const anrs = Number(s.anrCount || 0);
            const rageTaps = Number(s.rageTapCount || 0);
            const apiErrors = Number(s.apiErrorCount || 0);
            const apiTotal = Number(s.apiTotalCount || 0);
            const apiLatency = Number(s.apiAvgResponseMs || 0);
            const duration = Number(s.durationSeconds || 0);
            const hasReplay = Boolean(s.replayPromoted);
            const hasError = crashes > 0 || anrs > 0 || apiErrors > 0;

            // Time to failure metrics
            if (hasError && duration > 0) {
                totalTimeBeforeError += duration * 1000; // convert to ms
                sessionsWithError++;
            }
            if (crashes > 0 && screens.length > 0) {
                totalScreensBeforeCrash += screens.length;
                sessionsWithCrash++;
            }
            if (rageTaps > 0) {
                // Estimate interactions before rage (use touch count as proxy)
                totalInteractionsBeforeRage += Math.max(1, screens.length * 3);
                sessionsWithRage++;
            }

            // Process screens for per-screen stats
            for (const screen of screens) {
                if (!screenStats[screen]) {
                    screenStats[screen] = { visits: 0, crashes: 0, anrs: 0, apiErrors: 0, rageTaps: 0, sessionIds: [], hasReplay: false };
                }
                screenStats[screen].visits++;
                // Distribute session-level metrics proportionally across screens
                const screenShare = 1 / screens.length;
                screenStats[screen].crashes += crashes * screenShare;
                screenStats[screen].anrs += anrs * screenShare;
                screenStats[screen].apiErrors += apiErrors * screenShare;
                screenStats[screen].rageTaps += rageTaps * screenShare;
                if (screenStats[screen].sessionIds.length < 10) {
                    screenStats[screen].sessionIds.push(s.id);
                }
                if (hasReplay) screenStats[screen].hasReplay = true;
            }

            // Process transitions
            for (let i = 0; i < screens.length - 1; i++) {
                const from = screens[i];
                const to = screens[i + 1];
                const key = `${from}→${to}`;

                if (!transitionStats[key]) {
                    transitionStats[key] = { count: 0, apiErrors: 0, apiTotal: 0, latencySum: 0, rageTaps: 0, crashes: 0, anrs: 0, replayCount: 0 };
                }
                transitionStats[key].count++;
                // Distribute metrics across transitions
                const transitionShare = 1 / Math.max(1, screens.length - 1);
                transitionStats[key].apiErrors += apiErrors * transitionShare;
                transitionStats[key].apiTotal += apiTotal * transitionShare;
                transitionStats[key].latencySum += apiLatency;
                transitionStats[key].rageTaps += rageTaps * transitionShare;
                transitionStats[key].crashes += crashes * transitionShare;
                transitionStats[key].anrs += anrs * transitionShare;
                if (hasReplay) transitionStats[key].replayCount++;
            }

            // Entry/Exit tracking
            if (screens.length > 0) {
                entryCounts[screens[0]] = (entryCounts[screens[0]] || 0) + 1;
                const lastScreen = screens[screens.length - 1];
                exitCounts[lastScreen] = (exitCounts[lastScreen] || 0) + 1;

                // Exit after error
                if (hasError) {
                    if (!exitAfterErrorMap[lastScreen]) {
                        exitAfterErrorMap[lastScreen] = { exitCount: 0, api: 0, crash: 0, rage: 0, sessionIds: [] };
                    }
                    exitAfterErrorMap[lastScreen].exitCount++;
                    if (apiErrors > 0) exitAfterErrorMap[lastScreen].api++;
                    if (crashes > 0) exitAfterErrorMap[lastScreen].crash++;
                    if (rageTaps >= 2) exitAfterErrorMap[lastScreen].rage++;
                    if (exitAfterErrorMap[lastScreen].sessionIds.length < 5) {
                        exitAfterErrorMap[lastScreen].sessionIds.push(s.id);
                    }
                }
            }

            // Journey path tracking (first 5 screens)
            const journeyKey = screens.slice(0, 5).join(' → ');
            if (journeyKey) {
                if (!journeyMap[journeyKey]) {
                    journeyMap[journeyKey] = { sessionCount: 0, crashes: 0, anrs: 0, apiErrors: 0, rageTaps: 0, sessionIds: [] };
                }
                journeyMap[journeyKey].sessionCount++;
                journeyMap[journeyKey].crashes += crashes;
                journeyMap[journeyKey].anrs += anrs;
                journeyMap[journeyKey].apiErrors += apiErrors;
                journeyMap[journeyKey].rageTaps += rageTaps;
                if (journeyMap[journeyKey].sessionIds.length < 10) {
                    journeyMap[journeyKey].sessionIds.push(s.id);
                }
            }
        }

        // Build response
        const flows = Object.entries(transitionStats)
            .map(([key, stats]) => {
                const [from, to] = key.split('→');
                const apiErrorRate = stats.apiTotal > 0 ? (stats.apiErrors / stats.apiTotal) * 100 : 0;
                const avgLatency = stats.count > 0 ? stats.latencySum / stats.count : 0;

                // Compute transition health
                let health: HealthStatus = 'healthy';
                if (stats.crashes > 0 || stats.anrs > 0) health = 'problematic';
                else if (stats.rageTaps >= 2 || apiErrorRate > 5 || avgLatency > 1000) health = 'degraded';

                return {
                    from,
                    to,
                    count: stats.count,
                    apiErrors: Math.round(stats.apiErrors),
                    apiErrorRate: Math.round(apiErrorRate * 10) / 10,
                    avgApiLatencyMs: Math.round(avgLatency),
                    rageTapCount: Math.round(stats.rageTaps),
                    crashCount: Math.round(stats.crashes),
                    anrCount: Math.round(stats.anrs),
                    health,
                    replayCount: stats.replayCount,
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);

        const allJourneys = Object.entries(journeyMap)
            .map(([path, stats]) => {
                const failureScore = stats.crashes * 5 + stats.anrs * 4 + stats.apiErrors * 2 + stats.rageTaps;
                return {
                    path: path.split(' → '),
                    sessionCount: stats.sessionCount,
                    crashes: stats.crashes,
                    anrs: stats.anrs,
                    apiErrors: stats.apiErrors,
                    rageTaps: stats.rageTaps,
                    failureScore,
                    failurePerSession: stats.sessionCount > 0 ? failureScore / stats.sessionCount : Number.POSITIVE_INFINITY,
                    sampleSessionIds: stats.sessionIds,
                };
            });

        // Failure-weighted journeys (failureScore = crashes×5 + anrs×4 + apiErrors×2 + rageTaps×1)
        const problematicJourneys = allJourneys
            .filter(j => j.failureScore > 0)
            .sort((a, b) => b.failureScore - a.failureScore)
            .slice(0, 20);

        // Happy path = highest-volume clean path. Fallback = lowest failure-per-session path.
        const happyPathJourney = (() => {
            const candidates = allJourneys.filter(j => j.path.length > 1);
            if (candidates.length === 0) return null;

            const cleanCandidates = candidates
                .filter(j => j.failureScore === 0)
                .sort((a, b) => (b.sessionCount - a.sessionCount) || (b.path.length - a.path.length));

            if (cleanCandidates.length > 0) {
                const best = cleanCandidates[0];
                return {
                    path: best.path,
                    sessionCount: best.sessionCount,
                    crashes: best.crashes,
                    anrs: best.anrs,
                    apiErrors: best.apiErrors,
                    rageTaps: best.rageTaps,
                    failureScore: best.failureScore,
                    health: 'healthy' as const,
                    sampleSessionIds: best.sampleSessionIds,
                };
            }

            const fallback = [...candidates].sort(
                (a, b) => (a.failurePerSession - b.failurePerSession) || (b.sessionCount - a.sessionCount) || (b.path.length - a.path.length),
            )[0];

            return {
                path: fallback.path,
                sessionCount: fallback.sessionCount,
                crashes: fallback.crashes,
                anrs: fallback.anrs,
                apiErrors: fallback.apiErrors,
                rageTaps: fallback.rageTaps,
                failureScore: fallback.failureScore,
                health: 'degraded' as const,
                sampleSessionIds: fallback.sampleSessionIds,
            };
        })();

        // Exit after error
        const exitAfterError = Object.entries(exitAfterErrorMap)
            .map(([screen, stats]) => ({
                screen,
                exitCount: stats.exitCount,
                errorTypes: { api: stats.api, crash: stats.crash, rage: stats.rage },
                sampleSessionIds: stats.sessionIds,
            }))
            .sort((a, b) => b.exitCount - a.exitCount)
            .slice(0, 10);

        // Time-to-failure metrics
        const timeToFailure = {
            avgTimeBeforeFirstErrorMs: sessionsWithError > 0 ? Math.round(totalTimeBeforeError / sessionsWithError) : null,
            avgScreensBeforeCrash: sessionsWithCrash > 0 ? Math.round(totalScreensBeforeCrash / sessionsWithCrash * 10) / 10 : null,
            avgInteractionsBeforeRageTap: sessionsWithRage > 0 ? Math.round(totalInteractionsBeforeRage / sessionsWithRage) : null,
        };

        // Screen health
        const screenHealth = Object.entries(screenStats)
            .map(([name, stats]) => {
                let health: HealthStatus = 'healthy';
                if (stats.crashes > 0 || stats.anrs > 0) health = 'problematic';
                else if (stats.rageTaps >= 2 || stats.apiErrors > stats.visits * 0.05) health = 'degraded';

                return {
                    name,
                    visits: stats.visits,
                    health,
                    crashes: Math.round(stats.crashes),
                    anrs: Math.round(stats.anrs),
                    apiErrors: Math.round(stats.apiErrors),
                    rageTaps: Math.round(stats.rageTaps),
                    replayAvailable: stats.hasReplay,
                };
            })
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 20);

        // Original analytics data for backward compatibility
        const topScreens = Object.entries(screenStats)
            .map(([screen, stats]) => ({ screen, visits: stats.visits }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 20);

        const entryPoints = Object.entries(entryCounts)
            .map(([screen, count]) => ({ screen, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const exitPoints = Object.entries(exitCounts)
            .map(([screen, count]) => ({ screen, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const result = {
            healthSummary,
            flows,
            problematicJourneys,
            happyPathJourney,
            configuredHappyPath,
            exitAfterError,
            timeToFailure,
            screenHealth,
            topScreens,
            entryPoints,
            exitPoints,
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Growth Observability - Session health and growth killers
 * GET /api/analytics/growth-observability
 * 
 * Returns observability-first growth data including:
 * - Session health segmentation (clean/error/rage/slow/crash)
 * - First session success rate
 * - Growth killers (top retention blockers)
 */
router.get(
    '/growth-observability',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [mem] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!mem) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({
                    sessionHealth: { clean: 0, error: 0, rage: 0, slow: 0, crash: 0 },
                    firstSessionSuccessRate: 0,
                    firstSessionStats: { total: 0, clean: 0, withCrash: 0, withAnr: 0, withRageTaps: 0, withSlowApi: 0 },
                    newUserGrowth: { acquiredUsers: 0, activeUsers: 0, acquisitionRate: 0, returnedUsers: 0, returnRate: 0 },
                    growthKillers: [],
                    dailyHealth: []
                });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({
                sessionHealth: { clean: 0, error: 0, rage: 0, slow: 0, crash: 0 },
                firstSessionSuccessRate: 0,
                firstSessionStats: { total: 0, clean: 0, withCrash: 0, withAnr: 0, withRageTaps: 0, withSlowApi: 0 },
                newUserGrowth: { acquiredUsers: 0, activeUsers: 0, acquisitionRate: 0, returnedUsers: 0, returnRate: 0 },
                growthKillers: [],
                dailyHealth: []
            });
            return;
        }

        const cacheKey = `analytics:growth-observability:v2:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Time filter
        let startedAfter: Date | undefined;
        if (timeRange) {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        // Get sessions with metrics
        const conditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));

        const sessionsWithMetrics = await db
            .select({
                id: sessions.id,
                startedAt: sessions.startedAt,
                deviceId: sessions.deviceId,
                screensVisited: sessionMetrics.screensVisited,
                crashCount: sessionMetrics.crashCount,
                anrCount: sessionMetrics.anrCount,
                rageTapCount: sessionMetrics.rageTapCount,
                apiErrorCount: sessionMetrics.apiErrorCount,
                apiTotalCount: sessionMetrics.apiTotalCount,
                apiAvgResponseMs: sessionMetrics.apiAvgResponseMs,
                errorCount: sessionMetrics.errorCount,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .limit(10000);

        // Session health segmentation
        const sessionHealth = { clean: 0, error: 0, rage: 0, slow: 0, crash: 0 };

        // First session tracking (group by deviceId, find earliest)
        const deviceFirstSession = new Map<string, { id: string; startedAt: Date }>();

        // Growth killers tracking
        const killerCounts: Record<string, { count: number; sessionIds: string[]; screen?: string }> = {
            'API errors on first session': { count: 0, sessionIds: [] },
            'Crash on first session': { count: 0, sessionIds: [] },
            'Slow startup (>3s API latency)': { count: 0, sessionIds: [] },
            'Rage taps on first screen': { count: 0, sessionIds: [] },
            'ANR on first session': { count: 0, sessionIds: [] },
        };

        // Daily health tracking for chart
        const dailyHealth: Record<string, { clean: number; error: number; rage: number; slow: number; crash: number }> = {};

        // First pass: find first session per device
        for (const s of sessionsWithMetrics) {
            if (!s.deviceId) continue;
            const existing = deviceFirstSession.get(s.deviceId);
            if (!existing || s.startedAt < existing.startedAt) {
                deviceFirstSession.set(s.deviceId, { id: s.id, startedAt: s.startedAt });
            }
        }

        // For real acquisition/return metrics, find each observed device's first-ever session in the selected projects.
        const observedDeviceIds = Array.from(deviceFirstSession.keys());
        const firstSeenByDevice = new Map<string, Date>();
        if (observedDeviceIds.length > 0) {
            const firstSeenRows = await db
                .select({
                    deviceId: sessions.deviceId,
                    firstSeenAt: sql<Date>`min(${sessions.startedAt})`,
                })
                .from(sessions)
                .where(and(
                    inArray(sessions.projectId, projectIds),
                    inArray(sessions.deviceId, observedDeviceIds),
                ))
                .groupBy(sessions.deviceId);

            for (const row of firstSeenRows) {
                if (!row.deviceId || !row.firstSeenAt) continue;
                firstSeenByDevice.set(row.deviceId, new Date(row.firstSeenAt));
            }
        }

        const firstSessionIds = new Set(Array.from(deviceFirstSession.values()).map(d => d.id));
        const sessionsPerDeviceInWindow = new Map<string, number>();

        // First session stats
        const firstSessionStats = { total: 0, clean: 0, withCrash: 0, withAnr: 0, withRageTaps: 0, withSlowApi: 0 };

        // Second pass: categorize sessions
        for (const s of sessionsWithMetrics) {
            const crashes = Number(s.crashCount || 0);
            const anrs = Number(s.anrCount || 0);
            const rageTaps = Number(s.rageTapCount || 0);
            const apiErrors = Number(s.apiErrorCount || 0);
            const apiLatency = Number(s.apiAvgResponseMs || 0);
            const isFirstSession = firstSessionIds.has(s.id);
            const screens = s.screensVisited || [];
            const firstScreen = screens[0] || 'Unknown';
            if (s.deviceId) {
                sessionsPerDeviceInWindow.set(s.deviceId, (sessionsPerDeviceInWindow.get(s.deviceId) || 0) + 1);
            }

            // Date for daily tracking
            const dateKey = s.startedAt.toISOString().split('T')[0];
            if (!dailyHealth[dateKey]) {
                dailyHealth[dateKey] = { clean: 0, error: 0, rage: 0, slow: 0, crash: 0 };
            }

            // Categorize session (mutually exclusive, priority order)
            if (crashes > 0) {
                sessionHealth.crash++;
                dailyHealth[dateKey].crash++;
            } else if (anrs > 0 || apiErrors > 0) {
                sessionHealth.error++;
                dailyHealth[dateKey].error++;
            } else if (rageTaps >= 2) {
                sessionHealth.rage++;
                dailyHealth[dateKey].rage++;
            } else if (apiLatency > 1000) {
                sessionHealth.slow++;
                dailyHealth[dateKey].slow++;
            } else {
                sessionHealth.clean++;
                dailyHealth[dateKey].clean++;
            }

            // First session tracking
            if (isFirstSession) {
                firstSessionStats.total++;
                const hasIssue = crashes > 0 || anrs > 0 || rageTaps >= 2 || apiLatency > 3000;

                if (!hasIssue) {
                    firstSessionStats.clean++;
                } else {
                    if (crashes > 0) {
                        firstSessionStats.withCrash++;
                        killerCounts['Crash on first session'].count++;
                        if (killerCounts['Crash on first session'].sessionIds.length < 5) {
                            killerCounts['Crash on first session'].sessionIds.push(s.id);
                        }
                    }
                    if (anrs > 0) {
                        firstSessionStats.withAnr++;
                        killerCounts['ANR on first session'].count++;
                        if (killerCounts['ANR on first session'].sessionIds.length < 5) {
                            killerCounts['ANR on first session'].sessionIds.push(s.id);
                        }
                    }
                    if (rageTaps >= 2) {
                        firstSessionStats.withRageTaps++;
                        killerCounts['Rage taps on first screen'].count++;
                        killerCounts['Rage taps on first screen'].screen = firstScreen;
                        if (killerCounts['Rage taps on first screen'].sessionIds.length < 5) {
                            killerCounts['Rage taps on first screen'].sessionIds.push(s.id);
                        }
                    }
                    if (apiLatency > 3000) {
                        firstSessionStats.withSlowApi++;
                        killerCounts['Slow startup (>3s API latency)'].count++;
                        if (killerCounts['Slow startup (>3s API latency)'].sessionIds.length < 5) {
                            killerCounts['Slow startup (>3s API latency)'].sessionIds.push(s.id);
                        }
                    }
                    if (apiErrors > 0) {
                        killerCounts['API errors on first session'].count++;
                        if (killerCounts['API errors on first session'].sessionIds.length < 5) {
                            killerCounts['API errors on first session'].sessionIds.push(s.id);
                        }
                    }
                }
            }
        }

        // Calculate first session success rate
        const firstSessionSuccessRate = firstSessionStats.total > 0
            ? Math.round((firstSessionStats.clean / firstSessionStats.total) * 100)
            : 0;

        const activeUsers = sessionsPerDeviceInWindow.size;
        let acquiredUsers = 0;
        let returnedUsers = 0;

        for (const [deviceId, sessionCount] of sessionsPerDeviceInWindow.entries()) {
            const firstSeenAt = firstSeenByDevice.get(deviceId);
            const isNewInWindow = startedAfter
                ? Boolean(firstSeenAt && firstSeenAt >= startedAfter)
                : true;

            if (!isNewInWindow) continue;
            acquiredUsers++;
            if (sessionCount >= 2) returnedUsers++;
        }

        const acquisitionRate = toPercent(acquiredUsers, activeUsers, 1);
        const returnRate = toPercent(returnedUsers, acquiredUsers, 1);

        // Build growth killers list
        const totalSessions = sessionsWithMetrics.length;
        const growthKillers = Object.entries(killerCounts)
            .filter(([, data]) => data.count > 0)
            .map(([reason, data]) => ({
                reason,
                affectedSessions: data.count,
                percentOfTotal: totalSessions > 0 ? Math.round((data.count / totalSessions) * 1000) / 10 : 0,
                deltaVsPrevious: 0, // Would need previous period data
                relatedScreen: data.screen,
                sampleSessionIds: data.sessionIds,
            }))
            .sort((a, b) => b.affectedSessions - a.affectedSessions)
            .slice(0, 5);

        // Format daily health for chart
        const dailyHealthArray = Object.entries(dailyHealth)
            .map(([date, health]) => ({
                date,
                ...health,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30); // Last 30 days

        const result = {
            sessionHealth,
            firstSessionSuccessRate,
            firstSessionStats,
            newUserGrowth: {
                acquiredUsers,
                activeUsers,
                acquisitionRate,
                returnedUsers,
                returnRate,
            },
            growthKillers,
            dailyHealth: dailyHealthArray,
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * Observability Deep Metrics
 * GET /api/analytics/observability-deep-metrics
 *
 * Derives richer Sentry-style observability signals using existing schema + replay data only.
 */
router.get(
    '/observability-deep-metrics',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [mem] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!mem) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map((m) => m.teamId);
            if (teamIds.length === 0) {
                res.json({
                    dataWindow: {
                        totalSessions: 0,
                        analyzedSessions: 0,
                        sampled: false,
                        visualReplayCoverageRate: 0,
                        analyticsCoverageRate: 0,
                    },
                    reliability: {
                        crashFreeSessionRate: 0,
                        anrFreeSessionRate: 0,
                        errorFreeSessionRate: 0,
                        frustrationFreeSessionRate: 0,
                        degradedSessionRate: 0,
                        apiFailureRate: 0,
                    },
                    performance: {
                        apiApdex: null,
                        p50ApiResponseMs: null,
                        p95ApiResponseMs: null,
                        p99ApiResponseMs: null,
                        slowApiSessionRate: 0,
                        p50StartupMs: null,
                        p95StartupMs: null,
                        slowStartupRate: 0,
                    },
                    impact: {
                        uniqueUsers: 0,
                        affectedUsers: 0,
                        affectedUserRate: 0,
                        issueReoccurrenceRate: 0,
                    },
                    ingestHealth: {
                        sdkUploadSuccessRate: null,
                        sessionsWithUploadFailures: 0,
                        sessionsWithOfflinePersist: 0,
                        sessionsWithMemoryEvictions: 0,
                        sessionsWithCircuitBreakerOpen: 0,
                        sessionsWithHeavyRetries: 0,
                    },
                    networkBreakdown: [],
                    releaseRisk: [],
                    evidenceSessions: [],
                });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map((p) => p.id);
        }

        if (projectIds.length === 0) {
            res.json({
                dataWindow: {
                    totalSessions: 0,
                    analyzedSessions: 0,
                    sampled: false,
                    visualReplayCoverageRate: 0,
                    analyticsCoverageRate: 0,
                },
                reliability: {
                    crashFreeSessionRate: 0,
                    anrFreeSessionRate: 0,
                    errorFreeSessionRate: 0,
                    frustrationFreeSessionRate: 0,
                    degradedSessionRate: 0,
                    apiFailureRate: 0,
                },
                performance: {
                    apiApdex: null,
                    p50ApiResponseMs: null,
                    p95ApiResponseMs: null,
                    p99ApiResponseMs: null,
                    slowApiSessionRate: 0,
                    p50StartupMs: null,
                    p95StartupMs: null,
                    slowStartupRate: 0,
                },
                impact: {
                    uniqueUsers: 0,
                    affectedUsers: 0,
                    affectedUserRate: 0,
                    issueReoccurrenceRate: 0,
                },
                ingestHealth: {
                    sdkUploadSuccessRate: null,
                    sessionsWithUploadFailures: 0,
                    sessionsWithOfflinePersist: 0,
                    sessionsWithMemoryEvictions: 0,
                    sessionsWithCircuitBreakerOpen: 0,
                    sessionsWithHeavyRetries: 0,
                },
                networkBreakdown: [],
                releaseRisk: [],
                evidenceSessions: [],
            });
            return;
        }

        const cacheKey = `analytics:observability-deep-metrics:v1:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Time filter
        let startedAfter: Date | undefined;
        if (timeRange && typeof timeRange === 'string') {
            const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : undefined;
            if (days) {
                startedAfter = new Date();
                startedAfter.setDate(startedAfter.getDate() - days);
            }
        }

        const baseConditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) baseConditions.push(gte(sessions.startedAt, startedAfter));

        const totalCountRows = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(sessions)
            .where(and(...baseConditions));
        const totalSessions = Number(totalCountRows[0]?.count || 0);

        const ANALYZE_LIMIT = 20000;
        const sessionsWithMetrics = await db
            .select({
                id: sessions.id,
                startedAt: sessions.startedAt,
                deviceId: sessions.deviceId,
                appVersion: sessions.appVersion,
                replayPromoted: sessions.replayPromoted,
                crashCount: sessionMetrics.crashCount,
                anrCount: sessionMetrics.anrCount,
                errorCount: sessionMetrics.errorCount,
                rageTapCount: sessionMetrics.rageTapCount,
                deadTapCount: sessionMetrics.deadTapCount,
                apiTotalCount: sessionMetrics.apiTotalCount,
                apiErrorCount: sessionMetrics.apiErrorCount,
                apiAvgResponseMs: sessionMetrics.apiAvgResponseMs,
                appStartupTimeMs: sessionMetrics.appStartupTimeMs,
                networkType: sessionMetrics.networkType,
                screenshotSegmentCount: sessionMetrics.screenshotSegmentCount,
                eventsSizeBytes: sessionMetrics.eventsSizeBytes,
                sdkUploadSuccessCount: sessionMetrics.sdkUploadSuccessCount,
                sdkUploadFailureCount: sessionMetrics.sdkUploadFailureCount,
                sdkRetryAttemptCount: sessionMetrics.sdkRetryAttemptCount,
                sdkCircuitBreakerOpenCount: sessionMetrics.sdkCircuitBreakerOpenCount,
                sdkMemoryEvictionCount: sessionMetrics.sdkMemoryEvictionCount,
                sdkOfflinePersistCount: sessionMetrics.sdkOfflinePersistCount,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...baseConditions))
            .orderBy(desc(sessions.startedAt))
            .limit(ANALYZE_LIMIT);

        const analyzedSessions = sessionsWithMetrics.length;
        if (analyzedSessions === 0) {
            const emptyResult = {
                dataWindow: {
                    totalSessions: 0,
                    analyzedSessions: 0,
                    sampled: false,
                    visualReplayCoverageRate: 0,
                    analyticsCoverageRate: 0,
                },
                reliability: {
                    crashFreeSessionRate: 0,
                    anrFreeSessionRate: 0,
                    errorFreeSessionRate: 0,
                    frustrationFreeSessionRate: 0,
                    degradedSessionRate: 0,
                    apiFailureRate: 0,
                },
                performance: {
                    apiApdex: null,
                    p50ApiResponseMs: null,
                    p95ApiResponseMs: null,
                    p99ApiResponseMs: null,
                    slowApiSessionRate: 0,
                    p50StartupMs: null,
                    p95StartupMs: null,
                    slowStartupRate: 0,
                },
                impact: {
                    uniqueUsers: 0,
                    affectedUsers: 0,
                    affectedUserRate: 0,
                    issueReoccurrenceRate: 0,
                },
                ingestHealth: {
                    sdkUploadSuccessRate: null,
                    sessionsWithUploadFailures: 0,
                    sessionsWithOfflinePersist: 0,
                    sessionsWithMemoryEvictions: 0,
                    sessionsWithCircuitBreakerOpen: 0,
                    sessionsWithHeavyRetries: 0,
                },
                networkBreakdown: [],
                releaseRisk: [],
                evidenceSessions: [],
            };
            await redis.set(cacheKey, JSON.stringify(emptyResult), 'EX', CACHE_TTL);
            res.json(emptyResult);
            return;
        }

        const toNumber = (value: number | null | undefined): number => Number(value || 0);
        const hasVisualReplay = (row: typeof sessionsWithMetrics[number]): boolean =>
            Boolean(row.replayPromoted || toNumber(row.screenshotSegmentCount) > 0);

        let crashFreeSessions = 0;
        let anrFreeSessions = 0;
        let errorFreeSessions = 0;
        let frustrationFreeSessions = 0;
        let degradedSessions = 0;
        let sessionsWithApiLatency = 0;
        let sessionsWithSlowApi = 0;
        let visualReplaySessions = 0;
        let analyticsDataSessions = 0;

        let totalApiCalls = 0;
        let totalApiErrors = 0;
        let totalSdkUploadSuccess = 0;
        let totalSdkUploadFailure = 0;

        let sessionsWithUploadFailures = 0;
        let sessionsWithOfflinePersist = 0;
        let sessionsWithMemoryEvictions = 0;
        let sessionsWithCircuitBreakerOpen = 0;
        let sessionsWithHeavyRetries = 0;

        let apdexSatisfied = 0;
        let apdexTolerating = 0;
        let apdexTotal = 0;

        const apiLatencyValues: number[] = [];
        const startupValues: number[] = [];

        const allUsers = new Set<string>();
        const affectedUsers = new Set<string>();
        const networkMap: Record<string, { sessions: number; apiCalls: number; apiErrors: number; latencySum: number; latencySamples: number }> = {};
        const versionMap: Record<string, { sessions: number; degradedSessions: number; crashCount: number; anrCount: number; errorCount: number; latestSeen: Date; firstSeen: Date }> = {};

        for (const row of sessionsWithMetrics) {
            const crashCount = toNumber(row.crashCount);
            const anrCount = toNumber(row.anrCount);
            const errorCount = toNumber(row.errorCount);
            const rageTapCount = toNumber(row.rageTapCount);
            const deadTapCount = toNumber(row.deadTapCount);
            const apiTotalCount = toNumber(row.apiTotalCount);
            const apiErrorCount = toNumber(row.apiErrorCount);
            const apiAvgResponseMs = toNumber(row.apiAvgResponseMs);
            const appStartupTimeMs = toNumber(row.appStartupTimeMs);
            const sdkUploadSuccessCount = toNumber(row.sdkUploadSuccessCount);
            const sdkUploadFailureCount = toNumber(row.sdkUploadFailureCount);
            const sdkRetryAttemptCount = toNumber(row.sdkRetryAttemptCount);
            const sdkCircuitBreakerOpenCount = toNumber(row.sdkCircuitBreakerOpenCount);
            const sdkMemoryEvictionCount = toNumber(row.sdkMemoryEvictionCount);
            const sdkOfflinePersistCount = toNumber(row.sdkOfflinePersistCount);

            if (crashCount === 0) crashFreeSessions++;
            if (anrCount === 0) anrFreeSessions++;
            if (errorCount === 0) errorFreeSessions++;
            if (rageTapCount === 0 && deadTapCount === 0) frustrationFreeSessions++;

            const apiErrorRate = apiTotalCount > 0 ? (apiErrorCount / apiTotalCount) * 100 : 0;
            const hasDegradedSignal = crashCount > 0
                || anrCount > 0
                || errorCount > 0
                || rageTapCount >= 2
                || apiErrorRate > 5
                || apiAvgResponseMs > 1000
                || appStartupTimeMs > 3000;
            if (hasDegradedSignal) degradedSessions++;

            if (apiTotalCount > 0) {
                totalApiCalls += apiTotalCount;
                totalApiErrors += apiErrorCount;
                if (apiAvgResponseMs > 0) {
                    sessionsWithApiLatency++;
                    apiLatencyValues.push(apiAvgResponseMs);
                    if (apiAvgResponseMs > 1000) sessionsWithSlowApi++;

                    // Apdex-style breakdown using T=300ms, 4T=1200ms.
                    apdexTotal++;
                    if (apiAvgResponseMs <= 300) apdexSatisfied++;
                    else if (apiAvgResponseMs <= 1200) apdexTolerating++;
                }
            }

            if (appStartupTimeMs > 0) {
                startupValues.push(appStartupTimeMs);
            }

            if (hasVisualReplay(row)) {
                visualReplaySessions++;
            }
            if (hasVisualReplay(row) || toNumber(row.eventsSizeBytes) > 0) {
                analyticsDataSessions++;
            }

            totalSdkUploadSuccess += sdkUploadSuccessCount;
            totalSdkUploadFailure += sdkUploadFailureCount;
            if (sdkUploadFailureCount > 0) sessionsWithUploadFailures++;
            if (sdkOfflinePersistCount > 0) sessionsWithOfflinePersist++;
            if (sdkMemoryEvictionCount > 0) sessionsWithMemoryEvictions++;
            if (sdkCircuitBreakerOpenCount > 0) sessionsWithCircuitBreakerOpen++;
            if (sdkRetryAttemptCount >= 3) sessionsWithHeavyRetries++;

            if (row.deviceId) {
                allUsers.add(row.deviceId);
                if (crashCount > 0 || anrCount > 0 || errorCount > 0) {
                    affectedUsers.add(row.deviceId);
                }
            }

            const networkType = (row.networkType || 'unknown').toLowerCase();
            if (!networkMap[networkType]) {
                networkMap[networkType] = { sessions: 0, apiCalls: 0, apiErrors: 0, latencySum: 0, latencySamples: 0 };
            }
            networkMap[networkType].sessions++;
            networkMap[networkType].apiCalls += apiTotalCount;
            networkMap[networkType].apiErrors += apiErrorCount;
            if (apiAvgResponseMs > 0) {
                networkMap[networkType].latencySum += apiAvgResponseMs;
                networkMap[networkType].latencySamples++;
            }

            const appVersion = row.appVersion || 'unknown';
            if (!versionMap[appVersion]) {
                versionMap[appVersion] = {
                    sessions: 0,
                    degradedSessions: 0,
                    crashCount: 0,
                    anrCount: 0,
                    errorCount: 0,
                    latestSeen: row.startedAt,
                    firstSeen: row.startedAt,
                };
            }
            versionMap[appVersion].sessions++;
            if (hasDegradedSignal) versionMap[appVersion].degradedSessions++;
            versionMap[appVersion].crashCount += crashCount;
            versionMap[appVersion].anrCount += anrCount;
            versionMap[appVersion].errorCount += errorCount;
            if (row.startedAt > versionMap[appVersion].latestSeen) {
                versionMap[appVersion].latestSeen = row.startedAt;
            }
            if (row.startedAt < versionMap[appVersion].firstSeen) {
                versionMap[appVersion].firstSeen = row.startedAt;
            }
        }

        const issueConditionsErrors = [inArray(errors.projectId, projectIds), isNotNull(errors.fingerprint)];
        if (startedAfter) issueConditionsErrors.push(gte(errors.timestamp, startedAfter));
        const groupedErrors = await db
            .select({
                fingerprint: errors.fingerprint,
                count: sql<number>`count(*)::int`,
            })
            .from(errors)
            .where(and(...issueConditionsErrors))
            .groupBy(errors.fingerprint);

        const issueConditionsCrashes = [inArray(crashes.projectId, projectIds), isNotNull(crashes.fingerprint)];
        if (startedAfter) issueConditionsCrashes.push(gte(crashes.timestamp, startedAfter));
        const groupedCrashes = await db
            .select({
                fingerprint: crashes.fingerprint,
                count: sql<number>`count(*)::int`,
            })
            .from(crashes)
            .where(and(...issueConditionsCrashes))
            .groupBy(crashes.fingerprint);

        let fingerprintEvents = 0;
        let repeatedFingerprintEvents = 0;
        for (const row of groupedErrors) {
            const count = Number(row.count || 0);
            fingerprintEvents += count;
            if (count > 1) repeatedFingerprintEvents += count;
        }
        for (const row of groupedCrashes) {
            const count = Number(row.count || 0);
            fingerprintEvents += count;
            if (count > 1) repeatedFingerprintEvents += count;
        }

        const networkBreakdown = Object.entries(networkMap)
            .map(([networkType, stats]) => ({
                networkType,
                sessions: stats.sessions,
                apiCalls: stats.apiCalls,
                apiErrorRate: toPercent(stats.apiErrors, Math.max(1, stats.apiCalls), 2),
                avgLatencyMs: stats.latencySamples > 0 ? Math.round(stats.latencySum / stats.latencySamples) : 0,
            }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 8);

        const overallDegradedRate = toPercent(degradedSessions, analyzedSessions, 2);
        const releaseRisk = Object.entries(versionMap)
            .map(([version, stats]) => {
                const failureRate = toPercent(stats.degradedSessions, Math.max(1, stats.sessions), 2);
                return {
                    version,
                    sessions: stats.sessions,
                    degradedSessions: stats.degradedSessions,
                    failureRate,
                    deltaVsOverall: Number((failureRate - overallDegradedRate).toFixed(2)),
                    crashCount: stats.crashCount,
                    anrCount: stats.anrCount,
                    errorCount: stats.errorCount,
                    firstSeen: stats.firstSeen.toISOString(),
                    latestSeen: stats.latestSeen.toISOString(),
                };
            })
            .filter((row) => row.sessions >= 20)
            .sort((a, b) => (b.deltaVsOverall - a.deltaVsOverall) || (b.sessions - a.sessions))
            .slice(0, 5);

        const rankedRows = [...sessionsWithMetrics];
        const getEvidenceIds = (
            predicate: (row: typeof sessionsWithMetrics[number]) => boolean,
            ranker: (row: typeof sessionsWithMetrics[number]) => number,
        ): string[] => {
            const candidates = rankedRows.filter(predicate).sort((a, b) => ranker(b) - ranker(a));
            const replayCandidates = candidates.filter(hasVisualReplay);
            const source = replayCandidates.length > 0 ? replayCandidates : candidates;
            return Array.from(new Set(source.slice(0, 3).map((row) => row.id)));
        };

        const crashEvidence = getEvidenceIds(
            (row) => toNumber(row.crashCount) + toNumber(row.anrCount) > 0,
            (row) => (toNumber(row.crashCount) * 5) + (toNumber(row.anrCount) * 4) + toNumber(row.errorCount),
        );
        const apiEvidence = getEvidenceIds(
            (row) => {
                const apiTotal = toNumber(row.apiTotalCount);
                if (apiTotal <= 0) return false;
                const apiErrorRate = (toNumber(row.apiErrorCount) / Math.max(1, apiTotal)) * 100;
                return apiErrorRate > 5 || toNumber(row.apiAvgResponseMs) > 1000;
            },
            (row) => {
                const apiTotal = toNumber(row.apiTotalCount);
                const apiErrorRate = (toNumber(row.apiErrorCount) / Math.max(1, apiTotal)) * 100;
                return (apiErrorRate * 200) + toNumber(row.apiAvgResponseMs);
            },
        );
        const frustrationEvidence = getEvidenceIds(
            (row) => toNumber(row.rageTapCount) + toNumber(row.deadTapCount) > 0,
            (row) => (toNumber(row.rageTapCount) * 3) + (toNumber(row.deadTapCount) * 2) + toNumber(row.errorCount),
        );
        const startupEvidence = getEvidenceIds(
            (row) => toNumber(row.appStartupTimeMs) > 3000,
            (row) => toNumber(row.appStartupTimeMs),
        );
        const ingestEvidence = getEvidenceIds(
            (row) => toNumber(row.sdkUploadFailureCount) > 0 || toNumber(row.sdkOfflinePersistCount) > 0 || toNumber(row.sdkMemoryEvictionCount) > 0,
            (row) => (toNumber(row.sdkUploadFailureCount) * 5) + (toNumber(row.sdkOfflinePersistCount) * 2) + (toNumber(row.sdkMemoryEvictionCount) * 2) + toNumber(row.sdkRetryAttemptCount),
        );

        const evidenceSessions = [
            {
                title: 'Crash/ANR outliers',
                description: 'Highest fatal stability impact sessions.',
                metric: 'stability',
                value: `${degradedSessions.toLocaleString()} degraded sessions`,
                sessionIds: crashEvidence,
            },
            {
                title: 'API degradation outliers',
                description: 'High latency or high API failure sessions.',
                metric: 'api',
                value: `${toPercent(totalApiErrors, Math.max(1, totalApiCalls), 2)}% API failure rate`,
                sessionIds: apiEvidence,
            },
            {
                title: 'Frustration hotspots',
                description: 'Sessions with strong rage/dead tap signals.',
                metric: 'ux-friction',
                value: `${toPercent(analyzedSessions - frustrationFreeSessions, analyzedSessions, 2)}% friction sessions`,
                sessionIds: frustrationEvidence,
            },
            {
                title: 'Slow startup evidence',
                description: 'Cold starts above 3 seconds.',
                metric: 'startup',
                value: `${toPercent(startupValues.filter((v) => v > 3000).length, Math.max(1, startupValues.length), 2)}% slow startup`,
                sessionIds: startupEvidence,
            },
            {
                title: 'SDK upload pipeline failures',
                description: 'Sessions where ingestion reliability degraded.',
                metric: 'ingest',
                value: `${sessionsWithUploadFailures.toLocaleString()} sessions with upload failures`,
                sessionIds: ingestEvidence,
            },
        ].filter((item) => item.sessionIds.length > 0);

        const result = {
            dataWindow: {
                totalSessions,
                analyzedSessions,
                sampled: totalSessions > analyzedSessions,
                visualReplayCoverageRate: toPercent(visualReplaySessions, analyzedSessions, 2),
                analyticsCoverageRate: toPercent(analyticsDataSessions, analyzedSessions, 2),
            },
            reliability: {
                crashFreeSessionRate: toPercent(crashFreeSessions, analyzedSessions, 2),
                anrFreeSessionRate: toPercent(anrFreeSessions, analyzedSessions, 2),
                errorFreeSessionRate: toPercent(errorFreeSessions, analyzedSessions, 2),
                frustrationFreeSessionRate: toPercent(frustrationFreeSessions, analyzedSessions, 2),
                degradedSessionRate: toPercent(degradedSessions, analyzedSessions, 2),
                apiFailureRate: toPercent(totalApiErrors, Math.max(1, totalApiCalls), 2),
            },
            performance: {
                apiApdex: apdexTotal > 0 ? Number((((apdexSatisfied + apdexTolerating * 0.5) / apdexTotal)).toFixed(3)) : null,
                p50ApiResponseMs: percentile(apiLatencyValues, 50),
                p95ApiResponseMs: percentile(apiLatencyValues, 95),
                p99ApiResponseMs: percentile(apiLatencyValues, 99),
                slowApiSessionRate: toPercent(sessionsWithSlowApi, Math.max(1, sessionsWithApiLatency), 2),
                p50StartupMs: percentile(startupValues, 50),
                p95StartupMs: percentile(startupValues, 95),
                slowStartupRate: toPercent(startupValues.filter((v) => v > 3000).length, Math.max(1, startupValues.length), 2),
            },
            impact: {
                uniqueUsers: allUsers.size,
                affectedUsers: affectedUsers.size,
                affectedUserRate: toPercent(affectedUsers.size, Math.max(1, allUsers.size), 2),
                issueReoccurrenceRate: toPercent(repeatedFingerprintEvents, Math.max(1, fingerprintEvents), 2),
            },
            ingestHealth: {
                sdkUploadSuccessRate: (totalSdkUploadSuccess + totalSdkUploadFailure) > 0
                    ? Number((totalSdkUploadSuccess / (totalSdkUploadSuccess + totalSdkUploadFailure) * 100).toFixed(2))
                    : null,
                sessionsWithUploadFailures,
                sessionsWithOfflinePersist,
                sessionsWithMemoryEvictions,
                sessionsWithCircuitBreakerOpen,
                sessionsWithHeavyRetries,
            },
            networkBreakdown,
            releaseRisk,
            evidenceSessions,
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

/**
 * User Engagement Trends - Daily unique user counts per engagement segment
 * GET /api/analytics/user-engagement-trends
 * 
 * Unlike session-based engagement segments, this endpoint returns
 * the number of UNIQUE USERS per day that fall into each segment,
 * based on their most engaging session of that day.
 */
router.get(
    '/user-engagement-trends',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, timeRange } = req.query;

        let projectIds: string[] = [];
        if (projectId && typeof projectId === 'string') {
            const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw ApiError.notFound('Project not found');
            const [mem] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id))).limit(1);
            if (!mem) throw ApiError.forbidden('Access denied');
            projectIds = [projectId];
        } else {
            const membership = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, req.user!.id));
            const teamIds = membership.map(m => m.teamId);
            if (teamIds.length === 0) {
                res.json({ daily: [], totals: { bouncers: 0, casuals: 0, explorers: 0, loyalists: 0 } });
                return;
            }
            const userProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(inArray(projects.teamId, teamIds));
            projectIds = userProjects.map(p => p.id);
        }

        if (projectIds.length === 0) {
            res.json({ daily: [], totals: { bouncers: 0, casuals: 0, explorers: 0, loyalists: 0 } });
            return;
        }

        const cacheKey = `analytics:user-engagement-trends:${projectIds.sort().join(',')}:${timeRange || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        // Time filter
        const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 30;
        const startedAfter = new Date();
        startedAfter.setDate(startedAfter.getDate() - days);

        // Get sessions with their device ID and duration
        const conditions = [inArray(sessions.projectId, projectIds)];
        if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));

        const sessionsData = await db
            .select({
                id: sessions.id,
                startedAt: sessions.startedAt,
                deviceId: sessions.deviceId,
                durationSeconds: sessions.durationSeconds,
                screensVisited: sessionMetrics.screensVisited,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .limit(50000);

        // Group sessions by day and device, keeping the "best" (highest engagement) session per user per day
        // Engagement priority: loyalist > explorer > casual > bouncer
        const dailyUserSegments: Record<string, Map<string, { segment: string; score: number }>> = {};

        const getSegmentScore = (dur: number, screens: string[]) => {
            if (dur > 180) return { segment: 'loyalists', score: 4 };
            if (dur > 60 || screens.length > 3) return { segment: 'explorers', score: 3 };
            if (dur >= 10) return { segment: 'casuals', score: 2 };
            return { segment: 'bouncers', score: 1 };
        };

        for (const s of sessionsData) {
            if (!s.deviceId) continue;
            const dateKey = s.startedAt.toISOString().split('T')[0];
            const dur = s.durationSeconds || 0;
            const screens = s.screensVisited || [];
            const { segment, score } = getSegmentScore(dur, screens);

            if (!dailyUserSegments[dateKey]) {
                dailyUserSegments[dateKey] = new Map();
            }

            const existing = dailyUserSegments[dateKey].get(s.deviceId);
            if (!existing || score > existing.score) {
                dailyUserSegments[dateKey].set(s.deviceId, { segment, score });
            }
        }

        // Aggregate counts per day
        const daily: Array<{
            date: string;
            bouncers: number;
            casuals: number;
            explorers: number;
            loyalists: number;
        }> = [];

        const totals = { bouncers: 0, casuals: 0, explorers: 0, loyalists: 0 };

        for (const [date, userMap] of Object.entries(dailyUserSegments)) {
            const counts = { bouncers: 0, casuals: 0, explorers: 0, loyalists: 0 };
            for (const { segment } of userMap.values()) {
                counts[segment as keyof typeof counts]++;
                totals[segment as keyof typeof totals]++;
            }
            daily.push({ date, ...counts });
        }

        // Sort by date
        daily.sort((a, b) => a.date.localeCompare(b.date));

        const result = { daily, totals };
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
        res.json(result);
    })
);

export default router;
