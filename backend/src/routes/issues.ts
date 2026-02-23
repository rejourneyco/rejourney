/**
 * Issues Routes
 *
 * API endpoints for the Issues Feed page - aggregated error/crash/ANR tracking
 */

import { Router } from 'express';
import { eq, and, desc, asc, sql, or, ilike, gte, inArray } from 'drizzle-orm';
import { db, issues, issueEvents, projects, teamMembers, users, errors, crashes, anrs, sessions, recordingArtifacts, sessionMetrics, apiEndpointDailyStats, screenTouchHeatmaps } from '../db/client.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { writeApiRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * GET /api/general
 * Get paginated list of issues with filtering and search
 */
router.get(
    '/general',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const projectId = req.query.projectId as string;
        const status = req.query.status as string; // 'unresolved', 'resolved', 'ignored', 'ongoing'
        const issueType = req.query.type as string; // 'error', 'crash', 'anr', 'rage_tap'
        const priority = req.query.priority as string; // 'low', 'medium', 'high', 'critical'
        const environment = req.query.environment as string;
        const search = req.query.search as string;
        const sortBy = (req.query.sortBy as string) || 'lastSeen'; // 'lastSeen', 'firstSeen', 'eventCount', 'userCount'
        const sortOrder = (req.query.sortOrder as string) || 'desc';
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = parseInt(req.query.offset as string) || 0;
        const timeRange = req.query.timeRange as string; // '24h', '7d', '30d', '90d', 'all'

        if (!projectId) {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify access to project
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Build conditions array
        const conditions = [eq(issues.projectId, projectId)];

        // Status filter
        if (status) {
            conditions.push(eq(issues.status, status));
        }

        // Issue type filter
        if (issueType) {
            conditions.push(eq(issues.issueType, issueType));
        }

        // Priority filter
        if (priority) {
            conditions.push(eq(issues.priority, priority));
        }

        // Environment filter
        if (environment) {
            conditions.push(eq(issues.environment, environment));
        }

        // Search filter
        if (search) {
            conditions.push(
                or(
                    ilike(issues.title, `%${search}%`),
                    ilike(issues.subtitle, `%${search}%`),
                    ilike(issues.culprit, `%${search}%`),
                    ilike(issues.shortId, `%${search}%`)
                )!
            );
        }

        // Time range filter
        if (timeRange && timeRange !== 'all') {
            const now = new Date();
            let cutoff: Date;
            switch (timeRange) {
                case '24h':
                    cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case '90d':
                    cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    cutoff = new Date(0);
            }
            conditions.push(gte(issues.lastSeen, cutoff));
        }

        // Determine sort column and order
        let orderByColumn: any;
        switch (sortBy) {
            case 'firstSeen':
                orderByColumn = issues.firstSeen;
                break;
            case 'eventCount':
                orderByColumn = issues.eventCount;
                break;
            case 'userCount':
                orderByColumn = issues.userCount;
                break;
            case 'lastSeen':
            default:
                orderByColumn = issues.lastSeen;
        }

        const orderFn = sortOrder === 'asc' ? asc : desc;

        // Query issues with assignee info
        const issueList = await db
            .select({
                id: issues.id,
                projectId: issues.projectId,
                shortId: issues.shortId,
                fingerprint: issues.fingerprint,
                issueType: issues.issueType,
                title: issues.title,
                subtitle: issues.subtitle,
                culprit: issues.culprit,
                screenName: issues.screenName,
                status: issues.status,
                isHandled: issues.isHandled,
                priority: issues.priority,
                environment: issues.environment,
                firstSeen: issues.firstSeen,
                lastSeen: issues.lastSeen,
                eventCount: issues.eventCount,
                userCount: issues.userCount,
                events24h: issues.events24h,
                events90d: issues.events90d,
                dailyEvents: issues.dailyEvents,
                affectedVersions: issues.affectedVersions,
                affectedDevices: issues.affectedDevices,
                sampleSessionId: issues.sampleSessionId,
                sampleAppVersion: issues.sampleAppVersion,
                assigneeId: issues.assigneeId,
                assigneeEmail: users.email,
                assigneeName: users.displayName,
            })
            .from(issues)
            .leftJoin(users, eq(issues.assigneeId, users.id))
            .where(and(...conditions))
            .orderBy(orderFn(orderByColumn))
            .limit(limit)
            .offset(offset);

        // For sparkline release markers, fetch first-seen timestamps for the app versions
        // represented in the current issue list (single grouped query, not per issue).
        const issueAppVersions = Array.from(
            new Set(
                issueList
                    .map((issue) => issue.sampleAppVersion)
                    .filter((version): version is string => Boolean(version)),
            ),
        );

        const versionFirstSeenByAppVersion = new Map<string, Date>();
        if (issueAppVersions.length > 0) {
            const versionFirstSeenRows = await db
                .select({
                    appVersion: sessions.appVersion,
                    firstSeenAt: sql<Date>`min(${sessions.startedAt})`,
                })
                .from(sessions)
                .where(
                    and(
                        eq(sessions.projectId, projectId),
                        inArray(sessions.appVersion, issueAppVersions),
                    ),
                )
                .groupBy(sessions.appVersion);

            for (const row of versionFirstSeenRows) {
                if (!row.appVersion || !row.firstSeenAt) continue;
                versionFirstSeenByAppVersion.set(row.appVersion, new Date(row.firstSeenAt));
            }
        }

        // Get total count
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(issues)
            .where(and(...conditions));

        // Get summary stats for the filtered results
        const [stats] = await db
            .select({
                totalUnresolved: sql<number>`count(*) FILTER (WHERE status IN ('unresolved', 'ongoing'))`,
                totalResolved: sql<number>`count(*) FILTER (WHERE status = 'resolved')`,
                totalIgnored: sql<number>`count(*) FILTER (WHERE status = 'ignored')`,
            })
            .from(issues)
            .where(eq(issues.projectId, projectId));

        res.json({
            issues: issueList.map(issue => ({
                ...issue,
                eventCount: Number(issue.eventCount),
                sampleAppVersionFirstSeenAt: issue.sampleAppVersion
                    ? (versionFirstSeenByAppVersion.get(issue.sampleAppVersion) ?? null)
                    : null,
                assignee: issue.assigneeId ? {
                    id: issue.assigneeId,
                    email: issue.assigneeEmail,
                    displayName: issue.assigneeName,
                } : null,
            })),
            total: Number(count),
            stats: {
                unresolved: Number(stats?.totalUnresolved || 0),
                resolved: Number(stats?.totalResolved || 0),
                ignored: Number(stats?.totalIgnored || 0),
            },
        });
    })
);

/**
 * GET /api/general/:issueId
 * Get a single issue with full details
 */
router.get(
    '/general/:issueId',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { issueId } = req.params;

        const [issue] = await db
            .select({
                id: issues.id,
                projectId: issues.projectId,
                shortId: issues.shortId,
                fingerprint: issues.fingerprint,
                issueType: issues.issueType,
                title: issues.title,
                subtitle: issues.subtitle,
                culprit: issues.culprit,
                screenName: issues.screenName,
                componentName: issues.componentName,
                status: issues.status,
                isHandled: issues.isHandled,
                priority: issues.priority,
                environment: issues.environment,
                firstSeen: issues.firstSeen,
                lastSeen: issues.lastSeen,
                eventCount: issues.eventCount,
                userCount: issues.userCount,
                events24h: issues.events24h,
                events90d: issues.events90d,
                dailyEvents: issues.dailyEvents,
                affectedVersions: issues.affectedVersions,
                affectedDevices: issues.affectedDevices,
                sampleSessionId: issues.sampleSessionId,
                sampleStackTrace: issues.sampleStackTrace,
                sampleDeviceModel: issues.sampleDeviceModel,
                sampleOsVersion: issues.sampleOsVersion,
                sampleAppVersion: issues.sampleAppVersion,
                assigneeId: issues.assigneeId,
            })
            .from(issues)
            .where(eq(issues.id, issueId))
            .limit(1);

        if (!issue) {
            throw ApiError.notFound('Issue not found');
        }

        // Verify access
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, issue.projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Get recent events for this issue
        const recentEvents = await db
            .select()
            .from(issueEvents)
            .where(eq(issueEvents.issueId, issueId))
            .orderBy(desc(issueEvents.timestamp))
            .limit(20);

        res.json({
            ...issue,
            eventCount: Number(issue.eventCount),
            recentEvents,
        });
    })
);

/**
 * PATCH /api/general/:issueId
 * Update issue status, assignee, or priority
 */
router.patch(
    '/general/:issueId',
    sessionAuth,
    writeApiRateLimiter,
    asyncHandler(async (req, res) => {
        const { issueId } = req.params;
        const { status, priority, assigneeId } = req.body;

        const [issue] = await db
            .select()
            .from(issues)
            .where(eq(issues.id, issueId))
            .limit(1);

        if (!issue) {
            throw ApiError.notFound('Issue not found');
        }

        // Verify access
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, issue.projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Build update object
        const updates: Record<string, any> = { updatedAt: new Date() };

        if (status && ['unresolved', 'resolved', 'ignored', 'ongoing'].includes(status)) {
            updates.status = status;
        }

        if (priority && ['low', 'medium', 'high', 'critical'].includes(priority)) {
            updates.priority = priority;
        }

        if (assigneeId !== undefined) {
            updates.assigneeId = assigneeId || null;
        }

        const [updated] = await db
            .update(issues)
            .set(updates)
            .where(eq(issues.id, issueId))
            .returning();

        // Convert BigInt to number for JSON serialization
        res.json({
            ...updated,
            eventCount: Number(updated.eventCount),
        });
    })
);

/**
 * POST /api/general/bulk-update
 * Bulk update multiple issues
 */
router.post(
    '/general/bulk-update',
    sessionAuth,
    writeApiRateLimiter,
    asyncHandler(async (req, res) => {
        const { issueIds, status, priority, assigneeId } = req.body;

        if (!issueIds || !Array.isArray(issueIds) || issueIds.length === 0) {
            throw ApiError.badRequest('issueIds array is required');
        }

        // Get issues to verify access
        const issuesToUpdate = await db
            .select({ id: issues.id, projectId: issues.projectId })
            .from(issues)
            .where(inArray(issues.id, issueIds));

        if (issuesToUpdate.length === 0) {
            throw ApiError.notFound('No issues found');
        }

        // Verify access to all projects
        const projectIds = [...new Set(issuesToUpdate.map(i => i.projectId))];
        for (const projectId of projectIds) {
            const [project] = await db
                .select()
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!project) continue;

            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
                .limit(1);

            if (!membership) {
                throw ApiError.forbidden('Access denied to one or more issues');
            }
        }

        // Build update object
        const updates: Record<string, any> = { updatedAt: new Date() };

        if (status && ['unresolved', 'resolved', 'ignored', 'ongoing'].includes(status)) {
            updates.status = status;
        }

        if (priority && ['low', 'medium', 'high', 'critical'].includes(priority)) {
            updates.priority = priority;
        }

        if (assigneeId !== undefined) {
            updates.assigneeId = assigneeId || null;
        }

        await db
            .update(issues)
            .set(updates)
            .where(inArray(issues.id, issueIds));

        res.json({ updated: issueIds.length });
    })
);

/**
 * GET /api/general/environments
 * Get list of environments for a project
 */
router.get(
    '/general/environments',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const projectId = req.query.projectId as string;

        if (!projectId) {
            throw ApiError.badRequest('projectId is required');
        }

        const environments = await db
            .selectDistinct({ environment: issues.environment })
            .from(issues)
            .where(and(eq(issues.projectId, projectId), sql`environment IS NOT NULL`));

        res.json({
            environments: environments
                .map(e => e.environment)
                .filter((e): e is string => e !== null),
        });
    })
);

/**
 * POST /api/general/sync
 * Sync existing errors/crashes/anrs into the issues table
 * This is a comprehensive sync that rebuilds issue aggregations from source data
 */
router.post(
    '/general/sync',
    sessionAuth,
    writeApiRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.query.projectId as string;

        if (!projectId) {
            throw ApiError.badRequest('projectId is required');
        }

        // Verify access
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        const projectName = project.name.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 20);
        const now = new Date();
        const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const cutoff90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Helper to get date string
        const getDateStr = (date: Date) => date.toISOString().split('T')[0];

        // Track unique fingerprints and their aggregated data
        interface IssueAggregate {
            fingerprint: string;
            issueType: 'error' | 'crash' | 'anr' | 'rage_tap';
            title: string;
            subtitle?: string;
            culprit?: string;
            screenName?: string;
            componentName?: string;
            isHandled: boolean;
            firstSeen: Date;
            lastSeen: Date;
            eventCount: number;
            events24h: number;
            events90d: number;
            userIds: Set<string>;
            dailyEvents: Record<string, number>;
            affectedVersions: Record<string, number>;
            affectedDevices: Record<string, number>;
            sampleSessionId?: string;
            sampleStackTrace?: string;
            sampleDeviceModel?: string;
            sampleOsVersion?: string;
            sampleAppVersion?: string;
        }

        const aggregates = new Map<string, IssueAggregate>();

        // Helper to update aggregate
        const updateAggregate = (
            fingerprint: string,
            data: {
                issueType: 'error' | 'crash' | 'anr' | 'rage_tap';
                title: string;
                subtitle?: string;
                culprit?: string;
                screenName?: string;
                componentName?: string;
                isHandled: boolean;
                timestamp: Date;
                sessionId?: string;
                userId?: string;
                stackTrace?: string;
                deviceModel?: string;
                osVersion?: string;
                appVersion?: string;
            }
        ) => {
            const dateStr = getDateStr(data.timestamp);
            let agg = aggregates.get(fingerprint);

            if (!agg) {
                agg = {
                    fingerprint,
                    issueType: data.issueType,
                    title: data.title,
                    subtitle: data.subtitle,
                    culprit: data.culprit,
                    screenName: data.screenName,
                    componentName: data.componentName,
                    isHandled: data.isHandled,
                    firstSeen: data.timestamp,
                    lastSeen: data.timestamp,
                    eventCount: 0,
                    events24h: 0,
                    events90d: 0,
                    userIds: new Set(),
                    dailyEvents: {},
                    affectedVersions: {},
                    affectedDevices: {},
                    sampleSessionId: data.sessionId,
                    sampleStackTrace: data.stackTrace,
                    sampleDeviceModel: data.deviceModel,
                    sampleOsVersion: data.osVersion,
                    sampleAppVersion: data.appVersion,
                };
                aggregates.set(fingerprint, agg);
            }

            // Update counts
            agg.eventCount++;
            if (data.timestamp >= cutoff24h) agg.events24h++;
            if (data.timestamp >= cutoff90d) agg.events90d++;

            // Update timestamps
            if (data.timestamp < agg.firstSeen) agg.firstSeen = data.timestamp;
            if (data.timestamp > agg.lastSeen) {
                agg.lastSeen = data.timestamp;
                // Update sample to most recent
                if (data.sessionId) agg.sampleSessionId = data.sessionId;
                if (data.stackTrace) agg.sampleStackTrace = data.stackTrace;
                if (data.deviceModel) agg.sampleDeviceModel = data.deviceModel;
                if (data.osVersion) agg.sampleOsVersion = data.osVersion;
                if (data.appVersion) agg.sampleAppVersion = data.appVersion;
            }

            // Track user
            if (data.userId) agg.userIds.add(data.userId);

            // Daily events for sparkline (only last 90 days)
            if (data.timestamp >= cutoff90d) {
                agg.dailyEvents[dateStr] = (agg.dailyEvents[dateStr] || 0) + 1;
            }

            // Affected versions
            if (data.appVersion) {
                agg.affectedVersions[data.appVersion] = (agg.affectedVersions[data.appVersion] || 0) + 1;
            }

            // Affected devices
            if (data.deviceModel) {
                agg.affectedDevices[data.deviceModel] = (agg.affectedDevices[data.deviceModel] || 0) + 1;
            }
        };

        // Helper to generate fingerprint
        const generateFingerprint = (type: string, name: string, message: string): string => {
            const normalized = `${type}:${name}:${(message || '').slice(0, 100).toLowerCase().replace(/[0-9]/g, 'N')}`;
            return normalized;
        };

        // Process all errors
        const errorsList = await db
            .select({
                id: errors.id,
                sessionId: errors.sessionId,
                timestamp: errors.timestamp,
                errorType: errors.errorType,
                errorName: errors.errorName,
                message: errors.message,
                stack: errors.stack,
                screenName: errors.screenName,
                componentName: errors.componentName,
                deviceModel: errors.deviceModel,
                osVersion: errors.osVersion,
                appVersion: errors.appVersion,
                fingerprint: errors.fingerprint,
            })
            .from(errors)
            .where(eq(errors.projectId, projectId));

        for (const error of errorsList) {
            const fingerprint = error.fingerprint || generateFingerprint('error', error.errorName, error.message);

            updateAggregate(fingerprint, {
                issueType: 'error',
                title: error.errorName,
                subtitle: error.message?.slice(0, 200),
                culprit: error.componentName || error.screenName || undefined,
                screenName: error.screenName || undefined,
                componentName: error.componentName || undefined,
                isHandled: error.errorType !== 'unhandled_exception',
                timestamp: error.timestamp,
                sessionId: error.sessionId || undefined,
                stackTrace: error.stack || undefined,
                deviceModel: error.deviceModel || undefined,
                osVersion: error.osVersion || undefined,
                appVersion: error.appVersion || undefined,
            });
        }

        // Process all crashes
        const crashList = await db
            .select()
            .from(crashes)
            .where(eq(crashes.projectId, projectId));

        for (const crash of crashList) {
            const fingerprint = generateFingerprint('crash', crash.exceptionName, crash.reason || '');

            // Extract device info from deviceMetadata JSONB
            const deviceMeta = (crash.deviceMetadata as Record<string, any>) || {};
            const deviceModel = deviceMeta.model || deviceMeta.deviceModel;
            const osVersion = deviceMeta.systemVersion || deviceMeta.osVersion;
            const appVersion = deviceMeta.appVersion;

            updateAggregate(fingerprint, {
                issueType: 'crash',
                title: crash.exceptionName,
                subtitle: crash.reason?.slice(0, 200),
                isHandled: false,
                timestamp: crash.timestamp,
                sessionId: crash.sessionId || undefined,
                deviceModel,
                osVersion,
                appVersion,
            });
        }

        // Process all ANRs
        const anrList = await db
            .select()
            .from(anrs)
            .where(eq(anrs.projectId, projectId));

        for (const anr of anrList) {
            const fingerprint = generateFingerprint('anr', 'ANR', anr.threadState?.slice(0, 100) || anr.id);

            // Extract device info from deviceMetadata JSONB
            const deviceMeta = (anr.deviceMetadata as Record<string, any>) || {};
            const deviceModel = deviceMeta.model || deviceMeta.deviceModel;
            const osVersion = deviceMeta.systemVersion || deviceMeta.osVersion;
            const appVersion = deviceMeta.appVersion;

            updateAggregate(fingerprint, {
                issueType: 'anr',
                title: 'Application Not Responding',
                subtitle: `Blocked for ${anr.durationMs}ms`,
                isHandled: false,
                timestamp: anr.timestamp,
                sessionId: anr.sessionId || undefined,
                stackTrace: anr.threadState || undefined,
                deviceModel,
                osVersion,
                appVersion,
            });
        }

        // Helper to calculate priority
        const calculatePriority = (eventCount: number, lastSeen: Date): 'low' | 'medium' | 'high' | 'critical' => {
            const hoursSinceLastSeen = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);
            if (eventCount >= 1000 && hoursSinceLastSeen < 24) return 'critical';
            if (eventCount >= 100 && hoursSinceLastSeen < 24) return 'high';
            if (eventCount >= 10 || hoursSinceLastSeen < 72) return 'medium';
            return 'low';
        };

        // Now upsert all aggregates into issues table
        let created = 0;
        let updated = 0;

        for (const agg of aggregates.values()) {
            // Check if issue exists
            const [existing] = await db
                .select({ id: issues.id, shortId: issues.shortId })
                .from(issues)
                .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, agg.fingerprint)))
                .limit(1);

            const priority = calculatePriority(agg.eventCount, agg.lastSeen);
            const status = agg.events24h > 0 ? 'ongoing' : 'unresolved';

            if (existing) {
                // Update existing issue
                await db
                    .update(issues)
                    .set({
                        title: agg.title,
                        subtitle: agg.subtitle,
                        culprit: agg.culprit,
                        screenName: agg.screenName,
                        componentName: agg.componentName,
                        isHandled: agg.isHandled,
                        firstSeen: agg.firstSeen,
                        lastSeen: agg.lastSeen,
                        eventCount: BigInt(agg.eventCount),
                        userCount: agg.userIds.size || 1,
                        events24h: agg.events24h,
                        events90d: agg.events90d,
                        dailyEvents: agg.dailyEvents,
                        affectedVersions: agg.affectedVersions,
                        affectedDevices: agg.affectedDevices,
                        sampleSessionId: agg.sampleSessionId,
                        sampleStackTrace: agg.sampleStackTrace,
                        sampleDeviceModel: agg.sampleDeviceModel,
                        sampleOsVersion: agg.sampleOsVersion,
                        sampleAppVersion: agg.sampleAppVersion,
                        priority,
                        status,
                        updatedAt: new Date(),
                    })
                    .where(eq(issues.id, existing.id));
                updated++;
            } else {
                // Generate short ID
                const nextIdResult = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(issues)
                    .where(eq(issues.projectId, projectId));
                const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                const shortId = `${projectName}-${nextNum}`;

                // Create new issue
                await db.insert(issues).values({
                    projectId,
                    shortId,
                    fingerprint: agg.fingerprint,
                    issueType: agg.issueType,
                    title: agg.title,
                    subtitle: agg.subtitle,
                    culprit: agg.culprit,
                    screenName: agg.screenName,
                    componentName: agg.componentName,
                    isHandled: agg.isHandled,
                    priority,
                    status,
                    firstSeen: agg.firstSeen,
                    lastSeen: agg.lastSeen,
                    eventCount: BigInt(agg.eventCount),
                    userCount: agg.userIds.size || 1,
                    events24h: agg.events24h,
                    events90d: agg.events90d,
                    dailyEvents: agg.dailyEvents,
                    affectedVersions: agg.affectedVersions,
                    affectedDevices: agg.affectedDevices,
                    sampleSessionId: agg.sampleSessionId,
                    sampleStackTrace: agg.sampleStackTrace,
                    sampleDeviceModel: agg.sampleDeviceModel,
                    sampleOsVersion: agg.sampleOsVersion,
                    sampleAppVersion: agg.sampleAppVersion,
                });
                created++;
            }
        }

        // =====================================================================
        // INSIGHTS GENERATION
        // Detect patterns: slow APIs, high rage tap screens, slow startup,
        // device/OS/version correlations with issues
        // =====================================================================
        let insightsCreated = 0;

        const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // 1. SLOW API ENDPOINTS (Avg Latency > 500ms or error rate > 5%)
        try {
            const slowApis = await db
                .select({
                    endpoint: apiEndpointDailyStats.endpoint,
                    totalCalls: sql<number>`sum(${apiEndpointDailyStats.totalCalls})`,
                    totalErrors: sql<number>`sum(${apiEndpointDailyStats.totalErrors})`,
                    avgLatency: sql<number>`sum(${apiEndpointDailyStats.sumLatencyMs})::float / NULLIF(sum(${apiEndpointDailyStats.totalCalls}), 0)`,
                })
                .from(apiEndpointDailyStats)
                .where(and(
                    eq(apiEndpointDailyStats.projectId, projectId),
                    gte(apiEndpointDailyStats.date, recentDate)
                ))
                .groupBy(apiEndpointDailyStats.endpoint)
                .having(sql`sum(${apiEndpointDailyStats.sumLatencyMs})::float / NULLIF(sum(${apiEndpointDailyStats.totalCalls}), 0) > 500 OR (sum(${apiEndpointDailyStats.totalErrors})::float / NULLIF(sum(${apiEndpointDailyStats.totalCalls}), 0)) > 0.05`);

            for (const api of slowApis) {
                const fingerprint = `api_latency:${api.endpoint}`;
                const avgLatency = Math.round(api.avgLatency || 0);
                const errorRate = Number(api.totalCalls) > 0 ? ((Number(api.totalErrors) || 0) / Number(api.totalCalls) * 100).toFixed(1) : '0';
                const isHighError = Number(errorRate) > 5;

                const [existing] = await db
                    .select({ id: issues.id })
                    .from(issues)
                    .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
                    .limit(1);

                if (!existing) {
                    const nextIdResult = await db
                        .select({ count: sql<number>`count(*)` })
                        .from(issues)
                        .where(eq(issues.projectId, projectId));
                    const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                    const shortId = `${projectName}-${nextNum}`;

                    await db.insert(issues).values({
                        projectId,
                        shortId,
                        fingerprint,
                        issueType: 'api_latency' as any,
                        title: isHighError ? `High Error Rate: ${api.endpoint}` : `Slow API: ${api.endpoint}`,
                        subtitle: isHighError ? `${errorRate}% error rate (${api.totalErrors} errors)` : `Avg latency: ${avgLatency}ms`,
                        culprit: api.endpoint,
                        isHandled: true,
                        priority: avgLatency > 2000 || Number(errorRate) > 20 ? 'critical' : avgLatency > 1000 || Number(errorRate) > 10 ? 'high' : 'medium',
                        status: 'unresolved',
                        firstSeen: now,
                        lastSeen: now,
                        eventCount: BigInt(api.totalCalls || 0),
                        userCount: 0,
                        events24h: 0,
                        events90d: Number(api.totalCalls) || 0,
                    });
                    insightsCreated++;
                }
            }
        } catch {
            // API stats may not exist, skip gracefully
        }

        // 2. HIGH RAGE TAP SCREENS (> 5 rage taps)
        try {
            const rageTapScreens = await db
                .select({
                    screenName: screenTouchHeatmaps.screenName,
                    totalRageTaps: sql<number>`sum(${screenTouchHeatmaps.totalRageTaps})`,
                    totalTouches: sql<number>`sum(${screenTouchHeatmaps.totalTouches})`,
                })
                .from(screenTouchHeatmaps)
                .where(and(
                    eq(screenTouchHeatmaps.projectId, projectId),
                    gte(screenTouchHeatmaps.date, recentDate)
                ))
                .groupBy(screenTouchHeatmaps.screenName)
                .having(sql`sum(${screenTouchHeatmaps.totalRageTaps}) > 5`);

            for (const screen of rageTapScreens) {
                const fingerprint = `ux_friction:${screen.screenName}`;
                const rageTapRate = Number(screen.totalTouches) > 0
                    ? ((Number(screen.totalRageTaps) || 0) / Number(screen.totalTouches) * 100).toFixed(1)
                    : '0';

                const [existing] = await db
                    .select({ id: issues.id })
                    .from(issues)
                    .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
                    .limit(1);

                if (!existing) {
                    const nextIdResult = await db
                        .select({ count: sql<number>`count(*)` })
                        .from(issues)
                        .where(eq(issues.projectId, projectId));
                    const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                    const shortId = `${projectName}-${nextNum}`;

                    await db.insert(issues).values({
                        projectId,
                        shortId,
                        fingerprint,
                        issueType: 'ux_friction' as any,
                        title: `Rage Clicks: ${screen.screenName}`,
                        subtitle: `${screen.totalRageTaps} rage taps (${rageTapRate}% of touches)`,
                        culprit: screen.screenName,
                        isHandled: true,
                        priority: Number(screen.totalRageTaps) > 30 ? 'high' : 'medium',
                        status: 'unresolved',
                        firstSeen: now,
                        lastSeen: now,
                        eventCount: BigInt(screen.totalRageTaps || 0),
                        userCount: 0,
                        events24h: 0,
                        events90d: Number(screen.totalRageTaps) || 0,
                    });
                    insightsCreated++;
                }
            }
        } catch {
            // Screen touch data may not exist, skip gracefully
        }

        // 3. DEVICE/OS/VERSION CORRELATIONS
        // Check if any specific device/OS/version has significantly more issues
        try {
            // Get total issue counts by device, OS, and version
            const deviceIssues = await db
                .select({
                    deviceModel: issues.sampleDeviceModel,
                    count: sql<number>`count(*)`,
                })
                .from(issues)
                .where(and(
                    eq(issues.projectId, projectId),
                    eq(issues.status, 'unresolved'),
                    inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                    sql`${issues.sampleDeviceModel} IS NOT NULL`
                ))
                .groupBy(issues.sampleDeviceModel)
                .orderBy(desc(sql`count(*)`))
                .limit(5);

            if (deviceIssues.length > 0) {
                const topDevice = deviceIssues[0];
                const totalIssuesCount = deviceIssues.reduce((sum, d) => sum + Number(d.count), 0);
                const topDevicePercentage = (Number(topDevice.count) / totalIssuesCount * 100).toFixed(0);

                // If one device has > 40% of issues, flag it
                if (topDevice.deviceModel && Number(topDevicePercentage) > 40 && Number(topDevice.count) >= 3) {
                    const fingerprint = `device_correlation:${topDevice.deviceModel}`;
                    const [existing] = await db
                        .select({ id: issues.id })
                        .from(issues)
                        .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
                        .limit(1);

                    const relatedVersions = await db
                        .select({
                            appVersion: issues.sampleAppVersion,
                            count: sql<number>`count(*)`,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleDeviceModel, topDevice.deviceModel),
                            sql`${issues.sampleAppVersion} IS NOT NULL`
                        ))
                        .groupBy(issues.sampleAppVersion)
                        .orderBy(desc(sql`count(*)`))
                        .limit(5);

                    const affectedVersions: Record<string, number> = {};
                    for (const v of relatedVersions) {
                        if (v.appVersion) {
                            affectedVersions[v.appVersion] = Number(v.count);
                        }
                    }

                    const [sampleIssueForDevice] = await db
                        .select({
                            sampleSessionId: issues.sampleSessionId,
                            sampleOsVersion: issues.sampleOsVersion,
                            sampleAppVersion: issues.sampleAppVersion,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleDeviceModel, topDevice.deviceModel),
                            sql`${issues.sampleSessionId} IS NOT NULL`
                        ))
                        .orderBy(desc(issues.lastSeen))
                        .limit(1);

                    const deviceCorrelationValues = {
                        issueType: 'performance' as any,
                        title: `Issues concentrated on ${topDevice.deviceModel}`,
                        subtitle: `${topDevicePercentage}% of issues (${topDevice.count} issues) affect this device`,
                        culprit: topDevice.deviceModel,
                        isHandled: true,
                        priority: Number(topDevicePercentage) > 60 ? 'high' : 'medium',
                        status: 'unresolved',
                        firstSeen: now,
                        lastSeen: now,
                        eventCount: BigInt(topDevice.count),
                        userCount: 0,
                        events24h: 0,
                        events90d: Number(topDevice.count),
                        affectedDevices: { [topDevice.deviceModel]: Number(topDevice.count) },
                        affectedVersions,
                        sampleSessionId: sampleIssueForDevice?.sampleSessionId ?? null,
                        sampleDeviceModel: topDevice.deviceModel,
                        sampleOsVersion: sampleIssueForDevice?.sampleOsVersion ?? null,
                        sampleAppVersion: sampleIssueForDevice?.sampleAppVersion ?? null,
                        updatedAt: now,
                    };

                    if (existing) {
                        await db
                            .update(issues)
                            .set(deviceCorrelationValues)
                            .where(eq(issues.id, existing.id));
                    } else {
                        const nextIdResult = await db
                            .select({ count: sql<number>`count(*)` })
                            .from(issues)
                            .where(eq(issues.projectId, projectId));
                        const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                        const shortId = `${projectName}-${nextNum}`;

                        await db.insert(issues).values({
                            projectId,
                            shortId,
                            fingerprint,
                            ...deviceCorrelationValues,
                        });
                        insightsCreated++;
                    }
                }
            }

            // Check OS version correlation
            const osIssues = await db
                .select({
                    osVersion: issues.sampleOsVersion,
                    count: sql<number>`count(*)`,
                })
                .from(issues)
                .where(and(
                    eq(issues.projectId, projectId),
                    eq(issues.status, 'unresolved'),
                    inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                    sql`${issues.sampleOsVersion} IS NOT NULL`
                ))
                .groupBy(issues.sampleOsVersion)
                .orderBy(desc(sql`count(*)`))
                .limit(5);

            if (osIssues.length > 0) {
                const topOS = osIssues[0];
                const totalCount = osIssues.reduce((sum, o) => sum + Number(o.count), 0);
                const topOSPercentage = (Number(topOS.count) / totalCount * 100).toFixed(0);

                if (topOS.osVersion && Number(topOSPercentage) > 50 && Number(topOS.count) >= 3) {
                    const fingerprint = `os_correlation:${topOS.osVersion}`;
                    const [existing] = await db
                        .select({ id: issues.id })
                        .from(issues)
                        .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
                        .limit(1);

                    const affectedDevicesRows = await db
                        .select({
                            deviceModel: issues.sampleDeviceModel,
                            count: sql<number>`count(*)`,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleOsVersion, topOS.osVersion),
                            sql`${issues.sampleDeviceModel} IS NOT NULL`
                        ))
                        .groupBy(issues.sampleDeviceModel)
                        .orderBy(desc(sql`count(*)`))
                        .limit(5);

                    const affectedDevices: Record<string, number> = {};
                    for (const d of affectedDevicesRows) {
                        if (d.deviceModel) {
                            affectedDevices[d.deviceModel] = Number(d.count);
                        }
                    }

                    const affectedVersionsRows = await db
                        .select({
                            appVersion: issues.sampleAppVersion,
                            count: sql<number>`count(*)`,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleOsVersion, topOS.osVersion),
                            sql`${issues.sampleAppVersion} IS NOT NULL`
                        ))
                        .groupBy(issues.sampleAppVersion)
                        .orderBy(desc(sql`count(*)`))
                        .limit(5);

                    const affectedVersions: Record<string, number> = {};
                    for (const v of affectedVersionsRows) {
                        if (v.appVersion) {
                            affectedVersions[v.appVersion] = Number(v.count);
                        }
                    }

                    const [sampleIssueForOs] = await db
                        .select({
                            sampleSessionId: issues.sampleSessionId,
                            sampleDeviceModel: issues.sampleDeviceModel,
                            sampleAppVersion: issues.sampleAppVersion,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleOsVersion, topOS.osVersion),
                            sql`${issues.sampleSessionId} IS NOT NULL`
                        ))
                        .orderBy(desc(issues.lastSeen))
                        .limit(1);

                    const osCorrelationValues = {
                        issueType: 'performance' as any,
                        title: `Issues concentrated on OS ${topOS.osVersion}`,
                        subtitle: `${topOSPercentage}% of issues (${topOS.count} issues) affect this OS version`,
                        culprit: topOS.osVersion,
                        isHandled: true,
                        priority: Number(topOSPercentage) > 70 ? 'high' : 'medium',
                        status: 'unresolved',
                        firstSeen: now,
                        lastSeen: now,
                        eventCount: BigInt(topOS.count),
                        userCount: 0,
                        events24h: 0,
                        events90d: Number(topOS.count),
                        affectedDevices,
                        affectedVersions,
                        sampleSessionId: sampleIssueForOs?.sampleSessionId ?? null,
                        sampleDeviceModel: sampleIssueForOs?.sampleDeviceModel ?? null,
                        sampleOsVersion: topOS.osVersion,
                        sampleAppVersion: sampleIssueForOs?.sampleAppVersion ?? null,
                        updatedAt: now,
                    };

                    if (existing) {
                        await db
                            .update(issues)
                            .set(osCorrelationValues)
                            .where(eq(issues.id, existing.id));
                    } else {
                        const nextIdResult = await db
                            .select({ count: sql<number>`count(*)` })
                            .from(issues)
                            .where(eq(issues.projectId, projectId));
                        const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                        const shortId = `${projectName}-${nextNum}`;

                        await db.insert(issues).values({
                            projectId,
                            shortId,
                            fingerprint,
                            ...osCorrelationValues,
                        });
                        insightsCreated++;
                    }
                }
            }

            // Check App Version correlation
            const versionIssues = await db
                .select({
                    appVersion: issues.sampleAppVersion,
                    count: sql<number>`count(*)`,
                })
                .from(issues)
                .where(and(
                    eq(issues.projectId, projectId),
                    eq(issues.status, 'unresolved'),
                    inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                    sql`${issues.sampleAppVersion} IS NOT NULL`
                ))
                .groupBy(issues.sampleAppVersion)
                .orderBy(desc(sql`count(*)`))
                .limit(5);

            if (versionIssues.length > 0) {
                const topVersion = versionIssues[0];
                const totalCount = versionIssues.reduce((sum, v) => sum + Number(v.count), 0);
                const topVersionPercentage = (Number(topVersion.count) / totalCount * 100).toFixed(0);

                if (topVersion.appVersion && Number(topVersionPercentage) > 50 && Number(topVersion.count) >= 3) {
                    const fingerprint = `version_correlation:${topVersion.appVersion}`;
                    const [existing] = await db
                        .select({ id: issues.id })
                        .from(issues)
                        .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
                        .limit(1);

                    const affectedDevicesRows = await db
                        .select({
                            deviceModel: issues.sampleDeviceModel,
                            count: sql<number>`count(*)`,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleAppVersion, topVersion.appVersion),
                            sql`${issues.sampleDeviceModel} IS NOT NULL`
                        ))
                        .groupBy(issues.sampleDeviceModel)
                        .orderBy(desc(sql`count(*)`))
                        .limit(5);

                    const affectedDevices: Record<string, number> = {};
                    for (const d of affectedDevicesRows) {
                        if (d.deviceModel) {
                            affectedDevices[d.deviceModel] = Number(d.count);
                        }
                    }

                    const [sampleIssueForVersion] = await db
                        .select({
                            sampleSessionId: issues.sampleSessionId,
                            sampleDeviceModel: issues.sampleDeviceModel,
                            sampleOsVersion: issues.sampleOsVersion,
                        })
                        .from(issues)
                        .where(and(
                            eq(issues.projectId, projectId),
                            eq(issues.status, 'unresolved'),
                            inArray(issues.issueType, ['error', 'crash', 'anr', 'rage_tap']),
                            eq(issues.sampleAppVersion, topVersion.appVersion),
                            sql`${issues.sampleSessionId} IS NOT NULL`
                        ))
                        .orderBy(desc(issues.lastSeen))
                        .limit(1);

                    const versionCorrelationValues = {
                        issueType: 'performance' as any,
                        title: `Issues concentrated on v${topVersion.appVersion}`,
                        subtitle: `${topVersionPercentage}% of issues (${topVersion.count} issues) affect this version`,
                        culprit: `v${topVersion.appVersion}`,
                        isHandled: true,
                        priority: Number(topVersionPercentage) > 70 ? 'high' : 'medium',
                        status: 'unresolved',
                        firstSeen: now,
                        lastSeen: now,
                        eventCount: BigInt(topVersion.count),
                        userCount: 0,
                        events24h: 0,
                        events90d: Number(topVersion.count),
                        affectedDevices,
                        affectedVersions: { [topVersion.appVersion]: Number(topVersion.count) },
                        sampleSessionId: sampleIssueForVersion?.sampleSessionId ?? null,
                        sampleDeviceModel: sampleIssueForVersion?.sampleDeviceModel ?? null,
                        sampleOsVersion: sampleIssueForVersion?.sampleOsVersion ?? null,
                        sampleAppVersion: topVersion.appVersion,
                        updatedAt: now,
                    };

                    if (existing) {
                        await db
                            .update(issues)
                            .set(versionCorrelationValues)
                            .where(eq(issues.id, existing.id));
                    } else {
                        const nextIdResult = await db
                            .select({ count: sql<number>`count(*)` })
                            .from(issues)
                            .where(eq(issues.projectId, projectId));
                        const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                        const shortId = `${projectName}-${nextNum}`;

                        await db.insert(issues).values({
                            projectId,
                            shortId,
                            fingerprint,
                            ...versionCorrelationValues,
                        });
                        insightsCreated++;
                    }
                }
            }
        } catch {
            // Device correlation may fail, skip gracefully
        }

        // 4. SLOW APP STARTUP (Avg > 2000ms)
        try {
            const [startupMetrics] = await db
                .select({
                    avgStartup: sql<number>`avg(${sessionMetrics.appStartupTimeMs})`,
                    sessionCount: sql<number>`count(*)`,
                })
                .from(sessionMetrics)
                .innerJoin(sessions, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(
                    eq(sessions.projectId, projectId),
                    gte(sessions.startedAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
                    sql`${sessionMetrics.appStartupTimeMs} IS NOT NULL`
                ));

            if (startupMetrics && startupMetrics.avgStartup > 2000 && startupMetrics.sessionCount > 5) {
                const fingerprint = `performance:app_startup`;
                const avgStartup = Math.round(startupMetrics.avgStartup);

                const [existing] = await db
                    .select({ id: issues.id })
                    .from(issues)
                    .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
                    .limit(1);

                if (!existing) {
                    const nextIdResult = await db
                        .select({ count: sql<number>`count(*)` })
                        .from(issues)
                        .where(eq(issues.projectId, projectId));
                    const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
                    const shortId = `${projectName}-${nextNum}`;

                    await db.insert(issues).values({
                        projectId,
                        shortId,
                        fingerprint,
                        issueType: 'performance' as any,
                        title: 'Slow App Startup',
                        subtitle: `Avg startup: ${avgStartup}ms (target: <2000ms)`,
                        culprit: 'App Launch',
                        isHandled: true,
                        priority: avgStartup > 4000 ? 'critical' : avgStartup > 3000 ? 'high' : 'medium',
                        status: 'unresolved',
                        firstSeen: now,
                        lastSeen: now,
                        eventCount: BigInt(startupMetrics.sessionCount),
                        userCount: 0,
                        events24h: 0,
                        events90d: startupMetrics.sessionCount,
                    });
                    insightsCreated++;
                }
            }
        } catch {
            // Startup metrics may not exist, skip gracefully
        }

        res.json({
            synced: created + updated,
            created,
            updated,
            insightsCreated,
            total: aggregates.size,
            sources: {
                errors: errorsList.length,
                crashes: crashList.length,
                anrs: anrList.length,
            }
        });
    })
);

/**
 * GET /api/general/:issueId/sessions
 * Get sessions related to an issue (for displaying cover photos)
 */
router.get(
    '/general/:issueId/sessions',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { issueId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);

        // Get the issue
        const [issue] = await db
            .select()
            .from(issues)
            .where(eq(issues.id, issueId))
            .limit(1);

        if (!issue) {
            throw ApiError.notFound('Issue not found');
        }

        // Verify access
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, issue.projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        // Get unique session IDs from issue events
        // Use a subquery approach to avoid PostgreSQL's DISTINCT + ORDER BY restriction
        const eventSessions = await db
            .select({ sessionId: issueEvents.sessionId })
            .from(issueEvents)
            .where(and(
                eq(issueEvents.issueId, issueId),
                sql`${issueEvents.sessionId} IS NOT NULL`
            ))
            .groupBy(issueEvents.sessionId)
            .orderBy(desc(sql`MAX(${issueEvents.timestamp})`))
            .limit(limit);

        // Also include the sample session
        const sessionIds = new Set<string>();
        for (const e of eventSessions) {
            if (e.sessionId) sessionIds.add(e.sessionId);
        }
        if (issue.sampleSessionId) {
            sessionIds.add(issue.sampleSessionId);
        }

        if (sessionIds.size === 0) {
            res.json({ sessions: [] });
            return;
        }

        // Get session details with metrics
        const sessionList = await db
            .select({
                id: sessions.id,
                deviceModel: sessions.deviceModel,
                platform: sessions.platform,
                durationSeconds: sessions.durationSeconds,
                uxScore: sessionMetrics.uxScore,
                createdAt: sessions.createdAt,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(inArray(sessions.id, Array.from(sessionIds)))
            .orderBy(desc(sessions.createdAt))
            .limit(limit);

        // Get thumbnail availability for sessions
        const frameArtifacts = await db
            .select({
                id: recordingArtifacts.id,
                sessionId: recordingArtifacts.sessionId,
            })
            .from(recordingArtifacts)
            .where(and(
                inArray(recordingArtifacts.sessionId, Array.from(sessionIds)),
                eq(recordingArtifacts.kind, 'screenshots'),
                eq(recordingArtifacts.status, 'ready')
            ))
            .limit(100);

        // Map session ID -> first available artifact for cover photo
        const sessionCoverMap = new Map<string, string>();
        for (const artifact of frameArtifacts) {
            if (!sessionCoverMap.has(artifact.sessionId)) {
                sessionCoverMap.set(artifact.sessionId, artifact.id);
            }
        }

        res.json({
            sessions: sessionList.map(s => ({
                id: s.id,
                deviceModel: s.deviceModel || 'Unknown Device',
                platform: s.platform || 'unknown',
                durationSeconds: s.durationSeconds || 0,
                uxScore: Math.round(s.uxScore || 0),
                createdAt: s.createdAt,
                // Use screenshot thumbnail endpoint when replay data exists.
                coverPhotoUrl: sessionCoverMap.has(s.id)
                    ? `/api/session/thumbnail/${s.id}`
                    : null,
            })),
        });
    })
);

export default router;
