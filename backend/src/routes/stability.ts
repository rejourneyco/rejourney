import { Router } from 'express';
import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import {
    anrs,
    crashes,
    dbRead,
    errors,
    projects,
    sessions,
    teamMembers,
} from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { asyncHandler, ApiError, sessionAuth } from '../middleware/index.js';
import { resolveAnrStackTrace } from '../services/anrStack.js';
import {
    buildStabilityIssues,
    canonicalizeStabilityOccurrences,
    decodeStabilityCursor,
    encodeStabilityCursor,
    type LegacyStabilityRow,
    type StabilityIssue,
    type StabilityIssueType,
} from '../services/stabilityAnalytics.js';

const router = Router();

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const STABILITY_CACHE_TTL_SECONDS = 15;
const stabilityIssueLoads = new Map<string, Promise<StabilityIssue[]>>();
const redis = getRedis();

function parseLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(parsed, MAX_PAGE_SIZE);
}

function buildCutoff(timeRange: unknown): Date | null {
    const normalized = typeof timeRange === 'string' ? timeRange : '30d';
    if (normalized === 'all') return null;

    const millisecondsByRange: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1_000,
        '7d': 7 * 24 * 60 * 60 * 1_000,
        '30d': 30 * 24 * 60 * 60 * 1_000,
        '90d': 90 * 24 * 60 * 60 * 1_000,
    };
    const durationMs = millisecondsByRange[normalized] || millisecondsByRange['30d'];
    return new Date(Date.now() - durationMs);
}

function parseTypes(value: unknown): Set<StabilityIssueType> {
    const requested = typeof value === 'string'
        ? value.split(',').map((item) => item.trim().toLowerCase())
        : [];
    const allowed = new Set<StabilityIssueType>(['crash', 'error', 'anr']);
    const parsed = requested.filter((item): item is StabilityIssueType => allowed.has(item as StabilityIssueType));
    return new Set(parsed.length > 0 ? parsed : allowed);
}

function buildPlatformCondition(platform: unknown): SQL | undefined {
    if (typeof platform !== 'string' || !platform || platform === 'all') return undefined;
    if (platform === 'mobile') return inArray(sessions.platform, ['ios', 'android']);
    return eq(sessions.platform, platform);
}

async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
    const [project] = await dbRead
        .select({ teamId: projects.teamId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    if (!project) throw ApiError.notFound('Project not found');

    const [membership] = await dbRead
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(
            eq(teamMembers.teamId, project.teamId),
            eq(teamMembers.userId, userId),
        ))
        .limit(1);
    if (!membership) throw ApiError.forbidden('Access denied');
}

const sessionProjection = {
    platform: sessions.platform,
    deviceModel: sessions.deviceModel,
    osVersion: sessions.osVersion,
    appVersion: sessions.appVersion,
    sdkVersion: sessions.sdkVersion,
    userDisplayId: sessions.userDisplayId,
    anonymousHash: sessions.anonymousHash,
    deviceId: sessions.deviceId,
    replayAvailable: sessions.replayAvailable,
    replayRetentionState: sessions.replayRetentionState,
    recordingDeleted: sessions.recordingDeleted,
    isReplayExpired: sessions.isReplayExpired,
    isSampledIn: sessions.isSampledIn,
    observeOnly: sessions.observeOnly,
    replayQuotaBillingExhausted: sessions.replayQuotaBillingExhausted,
};

function sessionFromRow(row: Record<string, unknown>): LegacyStabilityRow['session'] {
    return {
        platform: row.platform as string | null,
        deviceModel: row.deviceModel as string | null,
        osVersion: row.osVersion as string | null,
        appVersion: row.appVersion as string | null,
        sdkVersion: row.sdkVersion as string | null,
        userDisplayId: row.userDisplayId as string | null,
        anonymousHash: row.anonymousHash as string | null,
        deviceId: row.deviceId as string | null,
        replayAvailable: row.replayAvailable as boolean | null,
        replayRetentionState: row.replayRetentionState as string | null,
        recordingDeleted: row.recordingDeleted as boolean | null,
        isReplayExpired: row.isReplayExpired as boolean | null,
        isSampledIn: row.isSampledIn as boolean | null,
        observeOnly: row.observeOnly as boolean | null,
        replayQuotaBillingExhausted: row.replayQuotaBillingExhausted as boolean | null,
    };
}

async function loadLegacyRows(params: {
    projectId: string;
    timeRange?: unknown;
    platform?: unknown;
    types: Set<StabilityIssueType>;
}): Promise<LegacyStabilityRow[]> {
    const cutoff = buildCutoff(params.timeRange);
    const platformCondition = buildPlatformCondition(params.platform);

    const tasks: Array<Promise<LegacyStabilityRow[]>> = [];

    if (params.types.has('crash')) {
        const conditions: SQL[] = [eq(crashes.projectId, params.projectId)];
        if (cutoff) conditions.push(gte(crashes.timestamp, cutoff));
        if (platformCondition) conditions.push(platformCondition);

        tasks.push(
            dbRead
                .select({
                    id: crashes.id,
                    projectId: crashes.projectId,
                    sessionId: crashes.sessionId,
                    incidentId: crashes.incidentId,
                    timestamp: crashes.timestamp,
                    exceptionName: crashes.exceptionName,
                    reason: crashes.reason,
                    stackTrace: crashes.stackTrace,
                    fingerprint: crashes.fingerprint,
                    deviceMetadata: crashes.deviceMetadata,
                    status: crashes.status,
                    occurrenceCount: crashes.occurrenceCount,
                    ...sessionProjection,
                })
                .from(crashes)
                .leftJoin(sessions, eq(crashes.sessionId, sessions.id))
                .where(and(...conditions))
                .then((rows) => rows.map((row) => ({
                    id: row.id,
                    type: 'crash' as const,
                    projectId: row.projectId,
                    sessionId: row.sessionId,
                    incidentId: row.incidentId,
                    timestamp: row.timestamp,
                    name: row.exceptionName,
                    message: row.reason,
                    stackTrace: row.stackTrace,
                    fingerprint: row.fingerprint,
                    status: row.status,
                    occurrenceCount: row.occurrenceCount,
                    eventMetadata: row.deviceMetadata as Record<string, unknown> | null,
                    session: sessionFromRow(row),
                    source: 'crash_artifact',
                }))),
        );
    }

    if (params.types.has('error')) {
        const conditions: SQL[] = [eq(errors.projectId, params.projectId)];
        if (cutoff) conditions.push(gte(errors.timestamp, cutoff));
        if (platformCondition) conditions.push(platformCondition);

        tasks.push(
            dbRead
                .select({
                    id: errors.id,
                    projectId: errors.projectId,
                    sessionId: errors.sessionId,
                    incidentId: errors.incidentId,
                    timestamp: errors.timestamp,
                    errorName: errors.errorName,
                    exceptionCategory: errors.exceptionCategory,
                    source: errors.source,
                    isHandled: errors.isHandled,
                    message: errors.message,
                    stack: errors.stack,
                    fingerprint: errors.fingerprint,
                    screenName: errors.screenName,
                    eventDeviceModel: errors.deviceModel,
                    eventOsVersion: errors.osVersion,
                    eventAppVersion: errors.appVersion,
                    status: errors.status,
                    occurrenceCount: errors.occurrenceCount,
                    ...sessionProjection,
                })
                .from(errors)
                .leftJoin(sessions, eq(errors.sessionId, sessions.id))
                .where(and(...conditions))
                .then((rows) => rows.map((row) => ({
                    id: row.id,
                    type: 'error' as const,
                    projectId: row.projectId,
                    sessionId: row.sessionId,
                    incidentId: row.incidentId,
                    timestamp: row.timestamp,
                    name: row.exceptionCategory || row.errorName,
                    message: row.message,
                    stackTrace: row.stack,
                    fingerprint: row.fingerprint,
                    status: row.status,
                    occurrenceCount: row.occurrenceCount,
                    screenName: row.screenName,
                    eventMetadata: {
                        deviceModel: row.eventDeviceModel,
                        osVersion: row.eventOsVersion,
                        appVersion: row.eventAppVersion,
                        source: row.source,
                        isHandled: row.isHandled,
                    },
                    session: sessionFromRow(row),
                    source: row.source || 'events_artifact',
                }))),
        );
    }

    if (params.types.has('anr')) {
        const conditions: SQL[] = [eq(anrs.projectId, params.projectId)];
        if (cutoff) conditions.push(gte(anrs.timestamp, cutoff));
        if (platformCondition) conditions.push(platformCondition);

        tasks.push(
            dbRead
                .select({
                    id: anrs.id,
                    projectId: anrs.projectId,
                    sessionId: anrs.sessionId,
                    incidentId: anrs.incidentId,
                    timestamp: anrs.timestamp,
                    durationMs: anrs.durationMs,
                    threadState: anrs.threadState,
                    deviceMetadata: anrs.deviceMetadata,
                    status: anrs.status,
                    occurrenceCount: anrs.occurrenceCount,
                    ...sessionProjection,
                })
                .from(anrs)
                .leftJoin(sessions, eq(anrs.sessionId, sessions.id))
                .where(and(...conditions))
                .then((rows) => rows.map((row) => {
                    const metadata = row.deviceMetadata as Record<string, unknown> | null;
                    return {
                        id: row.id,
                        type: 'anr' as const,
                        projectId: row.projectId,
                        sessionId: row.sessionId,
                        incidentId: row.incidentId,
                        timestamp: row.timestamp,
                        name: 'Application Not Responding',
                        message: `Main thread blocked for ${row.durationMs}ms`,
                        stackTrace: resolveAnrStackTrace({
                            threadState: row.threadState,
                            deviceMetadata: metadata,
                        }),
                        durationMs: row.durationMs,
                        status: row.status,
                        occurrenceCount: row.occurrenceCount,
                        eventMetadata: metadata,
                        screenName: typeof metadata?.screenName === 'string' ? metadata.screenName : null,
                        session: sessionFromRow(row),
                        source: 'anr_artifact',
                    };
                })),
        );
    }

    const result = await Promise.all(tasks);
    return result.flat();
}

function withoutOccurrences(issue: StabilityIssue): Omit<StabilityIssue, 'occurrences'> {
    const summary = { ...issue };
    Reflect.deleteProperty(summary, 'occurrences');
    return summary;
}

function filterIssues(issues: StabilityIssue[], query: Record<string, unknown>): StabilityIssue[] {
    const release = typeof query.release === 'string' ? query.release.trim().toLowerCase() : '';
    const device = typeof query.device === 'string' ? query.device.trim().toLowerCase() : '';
    const status = typeof query.status === 'string' ? query.status.trim().toLowerCase() : '';
    const search = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';

    return issues.filter((issue) => {
        if (status && status !== 'all' && issue.status.toLowerCase() !== status) return false;
        if (release && release !== 'all' && !Object.keys(issue.affectedVersions).some((value) => value.toLowerCase() === release)) return false;
        if (device && device !== 'all' && !Object.keys(issue.affectedDevices).some((value) => value.toLowerCase().includes(device))) return false;
        if (search) {
            const haystack = [
                issue.title,
                issue.message,
                issue.culprit,
                issue.fingerprint,
                ...Object.keys(issue.affectedDevices),
                ...Object.keys(issue.affectedVersions),
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });
}

async function loadIssuesForRequest(
    projectId: string,
    query: Record<string, unknown>,
): Promise<StabilityIssue[]> {
    const cacheInput = JSON.stringify({
        projectId,
        timeRange: query.timeRange ?? '30d',
        platform: query.platform ?? 'all',
        types: query.types ?? query.type ?? 'crash,error,anr',
        release: query.release ?? '',
        device: query.device ?? '',
        status: query.status ?? '',
        q: query.q ?? '',
    });
    const cacheKey = `stability:issues:v1:${createHash('sha256').update(cacheInput).digest('hex')}`;

    try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as StabilityIssue[];
    } catch {
        // Analytics must remain available when Redis is unavailable.
    }

    const existingLoad = stabilityIssueLoads.get(cacheKey);
    if (existingLoad) return existingLoad;

    const load = (async () => {
        const rows = await loadLegacyRows({
            projectId,
            timeRange: query.timeRange,
            platform: query.platform,
            types: parseTypes(query.types ?? query.type),
        });
        const issues = filterIssues(buildStabilityIssues(rows), query);
        try {
            await redis.set(cacheKey, JSON.stringify(issues), 'EX', STABILITY_CACHE_TTL_SECONDS);
        } catch {
            // The database result is still valid without the performance cache.
        }
        return issues;
    })();
    stabilityIssueLoads.set(cacheKey, load);
    try {
        return await load;
    } finally {
        stabilityIssueLoads.delete(cacheKey);
    }
}

async function loadSessionHealth(
    projectId: string,
    query: Record<string, unknown>,
): Promise<{
    totalSessions: number;
    totalUsers: number;
}> {
    const conditions: SQL[] = [eq(sessions.projectId, projectId)];
    const cutoff = buildCutoff(query.timeRange);
    if (cutoff) conditions.push(gte(sessions.startedAt, cutoff));
    const platformCondition = buildPlatformCondition(query.platform);
    if (platformCondition) conditions.push(platformCondition);

    const [row] = await dbRead
        .select({
            totalSessions: sql<number>`count(distinct ${sessions.id})`,
            totalUsers: sql<number>`count(distinct coalesce(
                ${sessions.userDisplayId},
                ${sessions.anonymousHash},
                ${sessions.deviceId},
                ${sessions.id}
            ))`,
        })
        .from(sessions)
        .where(and(...conditions));

    return {
        totalSessions: Number(row?.totalSessions || 0),
        totalUsers: Number(row?.totalUsers || 0),
    };
}

router.get(
    '/projects/:projectId/stability/issues',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        await assertProjectAccess(projectId, req.user!.id);

        const [issues, sessionHealth] = await Promise.all([
            loadIssuesForRequest(projectId, req.query),
            loadSessionHealth(projectId, req.query),
        ]);
        const offset = decodeStabilityCursor(req.query.cursor);
        const limit = parseLimit(req.query.limit);
        const page = issues.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        const allOccurrences = issues.flatMap((issue) => issue.occurrences);
        const impactedUsers = new Set(allOccurrences.map((occurrence) => occurrence.userId || occurrence.sessionId || occurrence.id));
        const impactedSessions = new Set(allOccurrences.map((occurrence) => occurrence.sessionId).filter(Boolean));
        const crashOccurrences = allOccurrences.filter((occurrence) => occurrence.type === 'crash');
        const crashedSessions = new Set(crashOccurrences.map((occurrence) => occurrence.sessionId).filter(Boolean));
        const crashedUsers = new Set(crashOccurrences.map((occurrence) => occurrence.userId || occurrence.sessionId || occurrence.id));
        const totalSessions = sessionHealth.totalSessions;
        const totalUsers = sessionHealth.totalUsers;
        const crashFreeSessions = Math.max(0, totalSessions - crashedSessions.size);
        const crashFreeUsers = Math.max(0, totalUsers - crashedUsers.size);

        res.json({
            issues: page.map(withoutOccurrences),
            nextCursor: nextOffset < issues.length ? encodeStabilityCursor(nextOffset) : null,
            summary: {
                issues: issues.length,
                events: issues.reduce((sum, issue) => sum + issue.eventCount, 0),
                users: impactedUsers.size,
                sessions: impactedSessions.size,
                completeDiagnostics: issues.filter((issue) => issue.diagnosticState === 'complete').length,
                incompleteDiagnostics: issues.filter((issue) => issue.diagnosticState === 'incomplete').length,
                totalSessions,
                crashFreeSessions,
                crashFreeSessionRate: totalSessions > 0 ? (crashFreeSessions / totalSessions) * 100 : 100,
                totalUsers,
                crashFreeUsers,
                crashFreeUserRate: totalUsers > 0 ? (crashFreeUsers / totalUsers) * 100 : 100,
            },
        });
    }),
);

router.get(
    '/projects/:projectId/stability/issues/:issueId',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, issueId } = req.params;
        await assertProjectAccess(projectId, req.user!.id);
        const issue = (await loadIssuesForRequest(projectId, req.query)).find((candidate) => candidate.id === issueId);
        if (!issue) throw ApiError.notFound('Stability issue not found');
        res.json({ issue: withoutOccurrences(issue) });
    }),
);

router.get(
    '/projects/:projectId/stability/issues/:issueId/occurrences',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, issueId } = req.params;
        await assertProjectAccess(projectId, req.user!.id);
        const issue = (await loadIssuesForRequest(projectId, req.query)).find((candidate) => candidate.id === issueId);
        if (!issue) throw ApiError.notFound('Stability issue not found');

        const offset = decodeStabilityCursor(req.query.cursor);
        const limit = parseLimit(req.query.limit);
        const occurrences = issue.occurrences.slice(offset, offset + limit);
        const nextOffset = offset + occurrences.length;
        res.json({
            occurrences,
            total: issue.occurrences.length,
            nextCursor: nextOffset < issue.occurrences.length ? encodeStabilityCursor(nextOffset) : null,
        });
    }),
);

router.get(
    '/projects/:projectId/stability/occurrences/:occurrenceId',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, occurrenceId } = req.params;
        await assertProjectAccess(projectId, req.user!.id);
        const rows = await loadLegacyRows({
            projectId,
            timeRange: req.query.timeRange ?? 'all',
            platform: req.query.platform,
            types: parseTypes(req.query.types ?? req.query.type),
        });
        const occurrence = canonicalizeStabilityOccurrences(rows)
            .find((candidate) => candidate.id === occurrenceId || candidate.sourceIds.includes(occurrenceId));
        if (!occurrence) throw ApiError.notFound('Stability occurrence not found');
        res.json({ occurrence });
    }),
);

export default router;
