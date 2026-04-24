/**
 * Aggregated dashboard overview route.
 *
 * Collapses the general dashboard's startup fan-out into a single browser
 * request, while keeping heavyweight detail routes separate.
 */

import { Router } from 'express';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db, issues, projects, sessionMetrics, sessions, teamMembers, errors as jsErrors, crashes as appCrashes } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { config } from '../config.js';
import {
    OVERVIEW_CACHE_TTL_SECONDS,
    buildOverviewCacheKey,
    persistOverviewCachePayload,
} from '../services/dashboardOverviewCache.js';
import { boundedTimeRangeToDays } from '../utils/analyticsTimeRange.js';
import { buildRetentionCohortRows } from '../services/retentionCohorts.js';
import { generateAnonymousName } from '../utils/anonymousName.js';

const router = Router();
const redis = getRedis();

const RETENTION_PREVIEW_CACHE_TTL_SECONDS = 900;
const ISSUE_PREVIEW_LIMIT = 18;
const SESSION_PREVIEW_LIMIT = 60;
const RETENTION_PREVIEW_ROWS = 4;
const RETENTION_PREVIEW_WEEKS = 4;
const OVERVIEW_RESPONSE_CACHE_CONTROL = 'private, max-age=30, stale-while-revalidate=60';
const STABILITY_OVERVIEW_ROW_LIMIT = 2000;

async function getAccessibleProjectIds(userId: string): Promise<string[]> {
    const memberships = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId));

    const teamIds = memberships.map((membership) => membership.teamId);
    if (teamIds.length === 0) {
        return [];
    }

    const accessibleProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

    return accessibleProjects.map((project) => project.id);
}

function buildStartedAfter(timeRange?: string): Date | undefined {
    if (!timeRange) return undefined;
    const days = boundedTimeRangeToDays(timeRange);
    if (typeof days !== 'number') return undefined;

    const startedAfter = new Date();
    startedAfter.setDate(startedAfter.getDate() - days);
    return startedAfter;
}

function buildObservabilityRange(timeRange?: string): string | undefined {
    if (!timeRange || timeRange === 'all') return undefined;
    return timeRange;
}

function jsonSafeStringify(value: unknown): string {
    return JSON.stringify(value, (_key, currentValue) =>
        typeof currentValue === 'bigint' ? Number(currentValue) : currentValue,
    );
}

function setOverviewCacheHeaders(res: { setHeader: (name: string, value: string) => void }): void {
    res.setHeader('Cache-Control', OVERVIEW_RESPONSE_CACHE_CONTROL);
}

async function respondWithOverviewCache<T>({
    cacheKey,
    routeName,
    res,
    build,
    ttlSeconds = OVERVIEW_CACHE_TTL_SECONDS,
    logContext,
}: {
    cacheKey: string;
    routeName: string;
    res: { setHeader: (name: string, value: string) => void; json: (body: unknown) => void };
    build: () => Promise<T>;
    ttlSeconds?: number;
    logContext?: Record<string, unknown>;
}): Promise<void> {
    setOverviewCacheHeaders(res);

    const cached = await redis.get(cacheKey);
    if (cached) {
        res.setHeader('X-Rejourney-Overview-Cache', 'hit');
        res.json(JSON.parse(cached));
        return;
    }

    const startedAt = Date.now();
    const payload = await build();
    const serializedPayload = jsonSafeStringify(payload);

    await persistOverviewCachePayload(cacheKey, serializedPayload, {
        redisClient: redis,
        ttlSeconds,
    });

    logger.info(
        {
            routeName,
            durationMs: Date.now() - startedAt,
            ...logContext,
        },
        '[overview] bootstrap ready',
    );

    res.setHeader('X-Rejourney-Overview-Cache', 'miss');
    res.json(JSON.parse(serializedPayload));
}

function buildIdentityKey(row: {
    userDisplayId?: string | null;
    anonymousHash?: string | null;
    deviceId?: string | null;
    fallbackId: string;
}): string {
    return row.userDisplayId || row.anonymousHash || row.deviceId || row.fallbackId;
}

function normalizeIssueCount(value: number | null | undefined): number {
    return Number(value || 0);
}

async function fetchOverviewSection<T>(
    cookieHeader: string | undefined,
    path: string,
): Promise<T> {
    const url = new URL(path, `http://127.0.0.1:${config.PORT}`);
    const headers = new Headers({ accept: 'application/json' });

    if (cookieHeader) {
        headers.set('cookie', cookieHeader);
    }

    const response = await fetch(url, {
        headers,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${path} returned ${response.status}${body ? `: ${body}` : ''}`);
    }

    return response.json() as Promise<T>;
}

async function resolveOverviewScope(
    req: {
        query: Record<string, unknown>;
        headers: { cookie?: string };
        user?: { id: string };
    },
    options?: { requireProjectId?: boolean },
): Promise<{
    userId: string;
    normalizedProjectId?: string;
    normalizedTimeRange?: string;
    accessibleProjectIds: string[];
    scopedProjectIds: string[];
    params: URLSearchParams;
    obsParams: URLSearchParams;
    cookieHeader?: string;
}> {
    const normalizedProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const normalizedTimeRange = typeof req.query.timeRange === 'string' ? req.query.timeRange : undefined;

    if (options?.requireProjectId && !normalizedProjectId) {
        throw ApiError.badRequest('projectId is required');
    }

    const accessibleProjectIds = await getAccessibleProjectIds(req.user!.id);
    if (normalizedProjectId && !accessibleProjectIds.includes(normalizedProjectId)) {
        throw ApiError.forbidden('Access denied');
    }

    const scopedProjectIds = normalizedProjectId ? [normalizedProjectId] : accessibleProjectIds;
    const params = new URLSearchParams();
    if (normalizedProjectId) {
        params.set('projectId', normalizedProjectId);
    }
    if (normalizedTimeRange) {
        params.set('timeRange', normalizedTimeRange);
    }

    const observabilityRange = buildObservabilityRange(normalizedTimeRange);
    const obsParams = new URLSearchParams(params);
    if (normalizedTimeRange && !observabilityRange) {
        obsParams.delete('timeRange');
    }
    if (observabilityRange) {
        obsParams.set('timeRange', observabilityRange);
    }

    return {
        userId: req.user!.id,
        normalizedProjectId,
        normalizedTimeRange,
        accessibleProjectIds,
        scopedProjectIds,
        params,
        obsParams,
        cookieHeader: req.headers.cookie,
    };
}

async function loadRetentionPreview(projectIds: string[], timeRange?: string): Promise<{ rows: Array<{ weekStartKey: string; users: number; retention: Array<number | null> }> }> {
    if (projectIds.length === 0) {
        return { rows: [] };
    }

    const cacheKey = `overview:retention-preview:${projectIds.slice().sort().join(',')}:${timeRange || 'all'}:v1`;
    const cached = await redis.get(cacheKey);
    if (cached) {
        return JSON.parse(cached);
    }

    // Overview preview intentionally stays bounded even for all-time windows.
    const previewDays = Math.min(boundedTimeRangeToDays(timeRange || '') ?? 90, 90);
    const startedAfter = new Date(Date.now() - (previewDays * 24 * 60 * 60 * 1000));

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

    const activityRows = await db
        .select({
            userKey: scopedIdentitySql,
            weekStartKey: weekStartKeySql,
        })
        .from(sessions)
        .where(and(
            inArray(sessions.projectId, projectIds),
            gte(sessions.startedAt, startedAfter),
            sql`${scopedIdentitySql} is not null`,
        ))
        .groupBy(scopedIdentitySql, weekStartKeySql)
        .orderBy(weekStartKeySql);

    const response = {
        rows: buildRetentionCohortRows(activityRows, {
            weeks: RETENTION_PREVIEW_WEEKS,
            maxRows: RETENTION_PREVIEW_ROWS,
        }),
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', RETENTION_PREVIEW_CACHE_TTL_SECONDS);
    return response;
}

async function loadIssuePreview(projectIds: string[], timeRange?: string) {
    if (projectIds.length === 0) {
        return [];
    }

    const conditions = [inArray(issues.projectId, projectIds)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(issues.lastSeen, startedAfter));
    }

    const issueRows = await db
        .select({
            id: issues.id,
            projectId: issues.projectId,
            fingerprint: issues.fingerprint,
            issueType: issues.issueType,
            title: issues.title,
            subtitle: issues.subtitle,
            culprit: issues.culprit,
            status: issues.status,
            firstSeen: issues.firstSeen,
            lastSeen: issues.lastSeen,
            eventCount: issues.eventCount,
            userCount: issues.userCount,
            events24h: issues.events24h,
            events90d: issues.events90d,
            sampleSessionId: issues.sampleSessionId,
            sampleAppVersion: issues.sampleAppVersion,
            dailyEvents: issues.dailyEvents,
            affectedDevices: issues.affectedDevices,
            affectedVersions: issues.affectedVersions,
        })
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.eventCount), desc(issues.lastSeen))
        .limit(ISSUE_PREVIEW_LIMIT);

    return issueRows.map((issue) => ({
        ...issue,
        firstSeen: issue.firstSeen.toISOString(),
        lastSeen: issue.lastSeen.toISOString(),
        eventCount: Number(issue.eventCount),
    }));
}

async function loadSessionPreview(projectIds: string[], timeRange?: string) {
    if (projectIds.length === 0) {
        return [];
    }

    const conditions = [inArray(sessions.projectId, projectIds)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(sessions.startedAt, startedAfter));
    }

    const rows = await db
        .select({
            session: {
                id: sessions.id,
                projectId: sessions.projectId,
                startedAt: sessions.startedAt,
                endedAt: sessions.endedAt,
                durationSeconds: sessions.durationSeconds,
                platform: sessions.platform,
                appVersion: sessions.appVersion,
                deviceModel: sessions.deviceModel,
                osVersion: sessions.osVersion,
                userDisplayId: sessions.userDisplayId,
                anonymousDisplayId: sessions.anonymousDisplayId,
                anonymousHash: sessions.anonymousHash,
                deviceId: sessions.deviceId,
                geoCity: sessions.geoCity,
                geoRegion: sessions.geoRegion,
                geoCountry: sessions.geoCountry,
                geoCountryCode: sessions.geoCountryCode,
                geoLatitude: sessions.geoLatitude,
                geoLongitude: sessions.geoLongitude,
                geoTimezone: sessions.geoTimezone,
                status: sessions.status,
                recordingDeleted: sessions.recordingDeleted,
                recordingDeletedAt: sessions.recordingDeletedAt,
                retentionDays: sessions.retentionDays,
                retentionTier: sessions.retentionTier,
                isReplayExpired: sessions.isReplayExpired,
                replayAvailable: sessions.replayAvailable,
            },
            metrics: sessionMetrics,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(and(...conditions))
        .orderBy(desc(sessions.startedAt))
        .limit(SESSION_PREVIEW_LIMIT);

    return rows.map(({ session, metrics }) => ({
        id: session.id,
        projectId: session.projectId,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString(),
        durationSeconds: session.durationSeconds ?? 0,
        platform: session.platform,
        appVersion: session.appVersion,
        deviceModel: session.deviceModel,
        osVersion: session.osVersion ?? undefined,
        userId: session.userDisplayId ?? undefined,
        anonymousId: session.anonymousDisplayId || session.anonymousHash || undefined,
        anonymousDisplayName: session.deviceId && !session.userDisplayId
            ? generateAnonymousName(session.deviceId)
            : undefined,
        deviceId: session.deviceId ?? undefined,
        geoLocation: session.geoCity
            ? {
                city: session.geoCity,
                region: session.geoRegion,
                country: session.geoCountry,
                countryCode: session.geoCountryCode,
                latitude: session.geoLatitude,
                longitude: session.geoLongitude,
                timezone: session.geoTimezone,
            }
            : null,
        totalEvents: metrics?.totalEvents ?? 0,
        errorCount: metrics?.errorCount ?? 0,
        touchCount: metrics?.touchCount ?? 0,
        scrollCount: metrics?.scrollCount ?? 0,
        gestureCount: metrics?.gestureCount ?? 0,
        inputCount: metrics?.inputCount ?? 0,
        apiSuccessCount: metrics?.apiSuccessCount ?? 0,
        apiErrorCount: metrics?.apiErrorCount ?? 0,
        apiTotalCount: metrics?.apiTotalCount ?? 0,
        apiAvgResponseMs: metrics?.apiAvgResponseMs ?? 0,
        rageTapCount: metrics?.rageTapCount ?? 0,
        deadTapCount: metrics?.deadTapCount ?? 0,
        screensVisited: metrics?.screensVisited ?? [],
        interactionScore: metrics?.interactionScore ?? 0,
        explorationScore: metrics?.explorationScore ?? 0,
        customEventCount: metrics?.customEventCount ?? 0,
        crashCount: metrics?.crashCount ?? 0,
        anrCount: metrics?.anrCount ?? 0,
        appStartupTimeMs: metrics?.appStartupTimeMs ?? undefined,
        networkType: metrics?.networkType ?? undefined,
        cellularGeneration: metrics?.cellularGeneration ?? undefined,
        isConstrained: metrics?.isConstrained ?? undefined,
        isExpensive: metrics?.isExpensive ?? undefined,
        status: session.status,
        recordingDeleted: session.recordingDeleted,
        recordingDeletedAt: session.recordingDeletedAt?.toISOString() ?? null,
        retentionDays: session.retentionDays ?? undefined,
        retentionTier: session.retentionTier ?? undefined,
        isReplayExpired: session.isReplayExpired,
        hasSuccessfulRecording: Boolean(session.replayAvailable) && !session.recordingDeleted && !session.isReplayExpired,
        effectiveStatus: session.status,
        isLiveIngest: false,
        isBackgroundProcessing: false,
        canOpenReplay: Boolean(session.replayAvailable) && !session.recordingDeleted && !session.isReplayExpired,
    }));
}

function toRatePer100(value: number, total: number): number {
    if (total <= 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
}

function getHeatmapPrimarySignal(rageRate: number, errorRate: number, exitRate: number): 'rage_taps' | 'errors' | 'exits' | 'mixed' {
    const ordered = [
        { key: 'rage_taps' as const, value: rageRate },
        { key: 'errors' as const, value: errorRate },
        { key: 'exits' as const, value: exitRate },
    ].sort((a, b) => b.value - a.value);

    if (!ordered[0] || ordered[0].value <= 0) return 'mixed';
    if ((ordered[0].value - ordered[1].value) < 2) return 'mixed';
    return ordered[0].key;
}

function getHeatmapPriority(impactScore: number, affectedSessions: number): 'critical' | 'high' | 'watch' {
    if (impactScore >= 45 || affectedSessions >= 120) return 'critical';
    if (impactScore >= 20 || affectedSessions >= 40) return 'high';
    return 'watch';
}

function getHeatmapConfidence(visits: number, hotspotCount: number): 'high' | 'medium' | 'low' {
    if (visits >= 150 || hotspotCount >= 8) return 'high';
    if (visits >= 40 || hotspotCount >= 3) return 'medium';
    return 'low';
}

type HeatmapScreenSource = {
    name: string;
    visits: number;
    rageTaps: number;
    errors: number;
    exitRate: number;
    frictionScore: number;
    screenshotUrl: string | null;
    sessionIds?: string[];
    touchHotspots?: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }>;
};

function mergeHeatmapScreen(
    name: string,
    alltime: HeatmapScreenSource | undefined,
    rangeData: HeatmapScreenSource | undefined,
    includeTouchHotspots: boolean,
) {
    const rangeVisits = normalizeIssueCount(rangeData?.visits);
    const rangeRageTaps = normalizeIssueCount(rangeData?.rageTaps);
    const rangeErrors = normalizeIssueCount(rangeData?.errors);
    const rangeExitRate = Number((rangeData?.exitRate ?? 0).toFixed?.(1) ?? rangeData?.exitRate ?? 0);
    const rangeRageTapRatePer100 = toRatePer100(rangeRageTaps, rangeVisits);
    const rangeErrorRatePer100 = toRatePer100(rangeErrors, rangeVisits);
    const rangeIncidentRatePer100 = Number((rangeRageTapRatePer100 + rangeErrorRatePer100 + rangeExitRate).toFixed(1));
    const rangeEstimatedAffectedSessions = Math.max(rangeRageTaps, rangeErrors, Math.round(rangeVisits * (rangeExitRate / 100)));
    const rangeImpactScore = Number((rangeIncidentRatePer100 * Math.log10(rangeVisits + 9)).toFixed(1));
    const touchHotspots = includeTouchHotspots
        ? (alltime?.touchHotspots ?? rangeData?.touchHotspots ?? [])
        : [];

    return {
        name,
        visits: normalizeIssueCount(alltime?.visits ?? rangeData?.visits),
        rageTaps: normalizeIssueCount(alltime?.rageTaps ?? rangeData?.rageTaps),
        errors: normalizeIssueCount(alltime?.errors ?? rangeData?.errors),
        exitRate: Number((alltime?.exitRate ?? rangeData?.exitRate ?? 0).toFixed?.(1) ?? alltime?.exitRate ?? rangeData?.exitRate ?? 0),
        frictionScore: Number((alltime?.frictionScore ?? rangeData?.frictionScore ?? 0).toFixed?.(1) ?? alltime?.frictionScore ?? rangeData?.frictionScore ?? 0),
        screenshotUrl: alltime?.screenshotUrl ?? rangeData?.screenshotUrl ?? null,
        sessionIds: alltime?.sessionIds ?? rangeData?.sessionIds ?? [],
        touchHotspots,
        rangeVisits,
        rangeRageTaps,
        rangeErrors,
        rangeExitRate,
        rangeFrictionScore: Number((rangeData?.frictionScore ?? rangeImpactScore).toFixed?.(1) ?? rangeData?.frictionScore ?? rangeImpactScore),
        rangeImpactScore,
        rangeRageTapRatePer100,
        rangeErrorRatePer100,
        rangeIncidentRatePer100,
        rangeEstimatedAffectedSessions,
        primarySignal: getHeatmapPrimarySignal(rangeRageTapRatePer100, rangeErrorRatePer100, rangeExitRate),
        confidence: getHeatmapConfidence(rangeVisits, touchHotspots.length),
        priority: getHeatmapPriority(rangeImpactScore, rangeEstimatedAffectedSessions),
        evidenceSessionId: rangeData?.sessionIds?.[0] ?? alltime?.sessionIds?.[0] ?? null,
    };
}

async function fetchHeatmapSources(
    cookieHeader: string | undefined,
    projectId: string,
    timeRange?: string,
): Promise<{
    allTime: { screens?: HeatmapScreenSource[]; lastUpdated?: string };
    friction: { screens?: HeatmapScreenSource[] };
    failedSections: string[];
}> {
    const frictionParams = new URLSearchParams({ projectId });
    if (timeRange) {
        frictionParams.set('timeRange', timeRange);
    }

    const [allTimeResult, frictionResult] = await Promise.allSettled([
        fetchOverviewSection<{ screens?: HeatmapScreenSource[]; lastUpdated?: string }>(
            cookieHeader,
            `/api/insights/alltime-heatmap?${new URLSearchParams({ projectId }).toString()}`,
        ),
        fetchOverviewSection<{ screens?: HeatmapScreenSource[] }>(
            cookieHeader,
            `/api/insights/friction-heatmap?${frictionParams.toString()}`,
        ),
    ]);

    const failedSections: string[] = [];
    if (allTimeResult.status === 'rejected') failedSections.push('all-time touches');
    if (frictionResult.status === 'rejected') failedSections.push('friction range');

    if (allTimeResult.status === 'rejected') {
        logger.warn({ err: allTimeResult.reason, projectId, timeRange }, '[overview] heatmap all-time load failed');
    }
    if (frictionResult.status === 'rejected') {
        logger.warn({ err: frictionResult.reason, projectId, timeRange }, '[overview] heatmap friction load failed');
    }

    return {
        allTime: allTimeResult.status === 'fulfilled' ? allTimeResult.value : {},
        friction: frictionResult.status === 'fulfilled' ? frictionResult.value : {},
        failedSections,
    };
}

async function loadHeatmapSummary(
    cookieHeader: string | undefined,
    projectId: string,
    timeRange?: string,
) {
    const { allTime, friction, failedSections } = await fetchHeatmapSources(cookieHeader, projectId, timeRange);
    const alltimeMap = new Map<string, HeatmapScreenSource>((allTime.screens || []).map((screen) => [screen.name, screen]));
    const frictionMap = new Map<string, HeatmapScreenSource>((friction.screens || []).map((screen) => [screen.name, screen]));
    const screenNames = Array.from(new Set([...alltimeMap.keys(), ...frictionMap.keys()]));

    return {
        screens: screenNames.map((name) => mergeHeatmapScreen(name, alltimeMap.get(name), frictionMap.get(name), false)),
        lastUpdated: allTime.lastUpdated ?? new Date().toISOString(),
        failedSections,
    };
}

async function loadHeatmapScreenDetail(
    cookieHeader: string | undefined,
    projectId: string,
    screenName: string,
    timeRange?: string,
) {
    const { allTime, friction, failedSections } = await fetchHeatmapSources(cookieHeader, projectId, timeRange);
    const alltimeScreen = (allTime.screens || []).find((screen) => screen.name === screenName);
    const frictionScreen = (friction.screens || []).find((screen) => screen.name === screenName);

    if (!alltimeScreen && !frictionScreen) {
        return {
            screen: null,
            failedSections,
        };
    }

    return {
        screen: mergeHeatmapScreen(screenName, alltimeScreen, frictionScreen, true),
        failedSections,
    };
}

async function loadErrorsOverview(projectIds: string[], timeRange?: string) {
    if (projectIds.length === 0) {
        return {
            groups: [],
            summary: { issues: 0, events: 0, users: 0 },
            truncated: false,
        };
    }

    const conditions = [inArray(jsErrors.projectId, projectIds)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(jsErrors.timestamp, startedAfter));
    }

    const rows = await db
        .select({
            error: {
                id: jsErrors.id,
                sessionId: jsErrors.sessionId,
                projectId: jsErrors.projectId,
                timestamp: jsErrors.timestamp,
                errorType: jsErrors.errorType,
                errorName: jsErrors.errorName,
                message: jsErrors.message,
                stack: jsErrors.stack,
                screenName: jsErrors.screenName,
                deviceModel: jsErrors.deviceModel,
                osVersion: jsErrors.osVersion,
                appVersion: jsErrors.appVersion,
                fingerprint: jsErrors.fingerprint,
                status: jsErrors.status,
                createdAt: jsErrors.createdAt,
            },
            userDisplayId: sessions.userDisplayId,
            anonymousHash: sessions.anonymousHash,
            deviceId: sessions.deviceId,
        })
        .from(jsErrors)
        .leftJoin(sessions, eq(jsErrors.sessionId, sessions.id))
        .where(and(...conditions))
        .orderBy(desc(jsErrors.timestamp))
        .limit(STABILITY_OVERVIEW_ROW_LIMIT);

    type ErrorGroup = {
        fingerprint: string;
        errorName: string;
        message: string;
        count: number;
        users: Set<string>;
        firstSeen: Date;
        lastOccurred: Date;
        affectedDevices: Record<string, number>;
        affectedVersions: Record<string, number>;
        screens: Set<string>;
        sampleError: {
            id: string;
            sessionId: string | null;
            timestamp: string;
            deviceModel: string | null;
            appVersion: string | null;
            stack: string | null;
            screenName: string | null;
        };
    };

    const grouped = new Map<string, ErrorGroup>();
    const impactedUsers = new Set<string>();

    for (const row of rows) {
        const key = row.error.fingerprint || `${row.error.errorName}:${row.error.message}`;
        const identity = buildIdentityKey({
            userDisplayId: row.userDisplayId,
            anonymousHash: row.anonymousHash,
            deviceId: row.deviceId,
            fallbackId: row.error.sessionId || row.error.id,
        });
        impactedUsers.add(identity);

        let group = grouped.get(key);
        if (!group) {
            group = {
                fingerprint: key,
                errorName: row.error.errorName,
                message: row.error.message,
                count: 0,
                users: new Set<string>(),
                firstSeen: row.error.timestamp,
                lastOccurred: row.error.timestamp,
                affectedDevices: {},
                affectedVersions: {},
                screens: new Set<string>(),
                sampleError: {
                    id: row.error.id,
                    sessionId: row.error.sessionId,
                    timestamp: row.error.timestamp.toISOString(),
                    deviceModel: row.error.deviceModel,
                    appVersion: row.error.appVersion,
                    stack: row.error.stack,
                    screenName: row.error.screenName,
                },
            };
            grouped.set(key, group);
        }

        group.count += 1;
        group.users.add(identity);
        if (row.error.timestamp < group.firstSeen) group.firstSeen = row.error.timestamp;
        if (row.error.timestamp > group.lastOccurred) {
            group.lastOccurred = row.error.timestamp;
            group.sampleError = {
                id: row.error.id,
                sessionId: row.error.sessionId,
                timestamp: row.error.timestamp.toISOString(),
                deviceModel: row.error.deviceModel,
                appVersion: row.error.appVersion,
                stack: row.error.stack,
                screenName: row.error.screenName,
            };
        }

        const deviceLabel = row.error.deviceModel || 'Unknown';
        const versionLabel = row.error.appVersion || 'Unknown';
        group.affectedDevices[deviceLabel] = (group.affectedDevices[deviceLabel] || 0) + 1;
        group.affectedVersions[versionLabel] = (group.affectedVersions[versionLabel] || 0) + 1;
        if (row.error.screenName) {
            group.screens.add(row.error.screenName);
        }
    }

    const groups = Array.from(grouped.values())
        .sort((a, b) => b.lastOccurred.getTime() - a.lastOccurred.getTime())
        .map((group) => ({
            fingerprint: group.fingerprint,
            errorName: group.errorName,
            message: group.message,
            count: group.count,
            users: Array.from(group.users),
            firstSeen: group.firstSeen.toISOString(),
            lastOccurred: group.lastOccurred.toISOString(),
            affectedDevices: group.affectedDevices,
            affectedVersions: group.affectedVersions,
            screens: Array.from(group.screens),
            sampleError: group.sampleError,
        }));

    return {
        groups,
        summary: {
            issues: groups.length,
            events: rows.length,
            users: impactedUsers.size,
        },
        truncated: rows.length >= STABILITY_OVERVIEW_ROW_LIMIT,
    };
}

async function loadCrashesOverview(projectIds: string[], timeRange?: string) {
    if (projectIds.length === 0) {
        return {
            groups: [],
            summary: { issues: 0, events: 0, users: 0 },
            truncated: false,
        };
    }

    const conditions = [inArray(appCrashes.projectId, projectIds)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(appCrashes.timestamp, startedAfter));
    }

    const rows = await db
        .select({
            crash: {
                id: appCrashes.id,
                sessionId: appCrashes.sessionId,
                projectId: appCrashes.projectId,
                timestamp: appCrashes.timestamp,
                exceptionName: appCrashes.exceptionName,
                reason: appCrashes.reason,
                deviceMetadata: appCrashes.deviceMetadata,
                status: appCrashes.status,
                stackTrace: appCrashes.stackTrace,
                fingerprint: appCrashes.fingerprint,
            },
            userDisplayId: sessions.userDisplayId,
            anonymousHash: sessions.anonymousHash,
            deviceId: sessions.deviceId,
        })
        .from(appCrashes)
        .leftJoin(sessions, eq(appCrashes.sessionId, sessions.id))
        .where(and(...conditions))
        .orderBy(desc(appCrashes.timestamp))
        .limit(STABILITY_OVERVIEW_ROW_LIMIT);

    type CrashGroup = {
        key: string;
        name: string;
        sampleCrashId: string;
        sampleSessionId: string;
        count: number;
        users: Set<string>;
        firstSeen: Date;
        lastOccurred: Date;
        affectedDevices: Record<string, number>;
        affectedVersions: Record<string, number>;
    };

    const grouped = new Map<string, CrashGroup>();
    const impactedUsers = new Set<string>();

    for (const row of rows) {
        if (!row.crash.sessionId) continue;
        const key = row.crash.fingerprint || `${row.crash.exceptionName}:${row.crash.reason || ''}`;
        const identity = buildIdentityKey({
            userDisplayId: row.userDisplayId,
            anonymousHash: row.anonymousHash,
            deviceId: row.deviceId,
            fallbackId: row.crash.sessionId || row.crash.id,
        });
        impactedUsers.add(identity);

        const deviceMetadata = (row.crash.deviceMetadata || {}) as { model?: string; deviceModel?: string; appVersion?: string };
        const deviceModel = deviceMetadata.model || deviceMetadata.deviceModel || 'Unknown';
        const appVersion = deviceMetadata.appVersion || 'Unknown';
        let group = grouped.get(key);
        if (!group) {
            group = {
                key,
                name: row.crash.exceptionName || 'Crash',
                sampleCrashId: row.crash.id,
                sampleSessionId: row.crash.sessionId,
                count: 0,
                users: new Set<string>(),
                firstSeen: row.crash.timestamp,
                lastOccurred: row.crash.timestamp,
                affectedDevices: {},
                affectedVersions: {},
            };
            grouped.set(key, group);
        }

        group.count += 1;
        group.users.add(identity);
        if (row.crash.timestamp < group.firstSeen) group.firstSeen = row.crash.timestamp;
        if (row.crash.timestamp > group.lastOccurred) {
            group.lastOccurred = row.crash.timestamp;
            group.sampleCrashId = row.crash.id;
            group.sampleSessionId = row.crash.sessionId;
        }
        group.affectedDevices[deviceModel] = (group.affectedDevices[deviceModel] || 0) + 1;
        group.affectedVersions[appVersion] = (group.affectedVersions[appVersion] || 0) + 1;
    }

    const groups = Array.from(grouped.values())
        .sort((a, b) => b.lastOccurred.getTime() - a.lastOccurred.getTime())
        .map((group) => ({
            id: group.key,
            name: group.name,
            sampleCrashId: group.sampleCrashId,
            sampleSessionId: group.sampleSessionId,
            count: group.count,
            users: Array.from(group.users),
            firstSeen: group.firstSeen.toISOString(),
            lastOccurred: group.lastOccurred.toISOString(),
            affectedDevices: group.affectedDevices,
            affectedVersions: group.affectedVersions,
        }));

    return {
        groups,
        summary: {
            issues: groups.length,
            events: rows.length,
            users: impactedUsers.size,
        },
        truncated: rows.length >= STABILITY_OVERVIEW_ROW_LIMIT,
    };
}

function toApiInsightsRange(value?: string): string | undefined {
    if (!value || value === 'all') return undefined;
    return value;
}

function toApiTrendsRange(value?: string): string {
    if (!value) return '30d';
    if (value === '24h') return '7d';
    if (value === 'all') return 'all';
    return value;
}

function toRegionRange(value?: string): string {
    if (!value) return '30d';
    if (value === '24h') return '7d';
    if (value === 'all') return 'all';
    return value;
}

function toDevicesRange(value?: string): string | undefined {
    if (!value) return undefined;
    if (value === 'all') return 'max';
    return value;
}

function toDevicesTrendsRange(value?: string): string {
    if (!value) return '30d';
    if (value === '24h') return '7d';
    if (value === '7d') return '30d';
    if (value === '30d') return '90d';
    if (value === '90d' || value === '180d' || value === '1y') return value;
    return 'all';
}

function toJourneyRange(value?: string): string | undefined {
    if (!value || value === 'all') return undefined;
    return value;
}

function toJourneyTrendsRange(value?: string): string {
    if (!value) return '30d';
    if (value === '24h') return '7d';
    if (value === '7d') return '30d';
    if (value === '30d') return '90d';
    if (value === '90d' || value === '180d' || value === '1y') return value;
    return 'all';
}

router.get(
    '/general',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req);
        if (scope.scopedProjectIds.length === 0) {
            setOverviewCacheHeaders(res);
            res.json({
                trends: { daily: [] },
                overviewObs: null,
                deepMetrics: null,
                engagementTrends: null,
                geoSummary: null,
                retention: { rows: [] },
                issues: [],
                sessions: [],
                failedSections: [],
            });
            return;
        }

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('general', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'general',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const sections = await Promise.allSettled([
                    fetchOverviewSection(scope.cookieHeader, `/api/insights/trends?${scope.params.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/growth-observability?${new URLSearchParams({ ...Object.fromEntries(scope.obsParams), mode: 'summary' }).toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/observability-deep-metrics?${new URLSearchParams({ ...Object.fromEntries(scope.obsParams), mode: 'summary' }).toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/user-engagement-trends?${scope.obsParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/geo-summary?${scope.obsParams.toString()}`),
                    loadRetentionPreview(scope.scopedProjectIds, scope.normalizedTimeRange),
                    loadIssuePreview(scope.scopedProjectIds, scope.normalizedTimeRange),
                    loadSessionPreview(scope.scopedProjectIds, scope.normalizedTimeRange),
                ]);

                const failedSections: string[] = [];
                const [
                    trendsResult,
                    overviewObsResult,
                    deepMetricsResult,
                    engagementResult,
                    geoResult,
                    retentionResult,
                    issuesResult,
                    sessionsResult,
                ] = sections;

                const response = {
                    trends: trendsResult.status === 'fulfilled' ? trendsResult.value : { daily: [] },
                    overviewObs: overviewObsResult.status === 'fulfilled' ? overviewObsResult.value : null,
                    deepMetrics: deepMetricsResult.status === 'fulfilled' ? deepMetricsResult.value : null,
                    engagementTrends: engagementResult.status === 'fulfilled' ? engagementResult.value : null,
                    geoSummary: geoResult.status === 'fulfilled' ? geoResult.value : null,
                    retention: retentionResult.status === 'fulfilled' ? retentionResult.value : { rows: [] },
                    issues: issuesResult.status === 'fulfilled' ? issuesResult.value : [],
                    sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : [],
                    failedSections,
                };

                if (trendsResult.status !== 'fulfilled') failedSections.push('activity trends');
                if (overviewObsResult.status !== 'fulfilled') failedSections.push('observability');
                if (deepMetricsResult.status !== 'fulfilled') failedSections.push('deep metrics');
                if (engagementResult.status !== 'fulfilled') failedSections.push('engagement segments');
                if (geoResult.status !== 'fulfilled') failedSections.push('geographic activity');
                if (retentionResult.status !== 'fulfilled') failedSections.push('retention cohorts');
                if (issuesResult.status !== 'fulfilled') failedSections.push('top issues');
                if (sessionsResult.status !== 'fulfilled') failedSections.push('recommended sessions');

                for (const [sectionName, result] of [
                    ['trends', trendsResult],
                    ['overviewObs', overviewObsResult],
                    ['deepMetrics', deepMetricsResult],
                    ['engagementTrends', engagementResult],
                    ['geoSummary', geoResult],
                    ['retention', retentionResult],
                    ['issues', issuesResult],
                    ['sessions', sessionsResult],
                ] as const) {
                    if (result.status === 'rejected') {
                        logger.warn({ err: result.reason, sectionName, projectId: scope.normalizedProjectId, timeRange: scope.normalizedTimeRange }, '[overview] section load failed');
                    }
                }

                return response;
            },
        });
    }),
);

router.get(
    '/api',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const apiRange = toApiInsightsRange(scope.normalizedTimeRange);
        const trendsRange = toApiTrendsRange(scope.normalizedTimeRange);
        const regionRange = toRegionRange(scope.normalizedTimeRange);

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('api', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'api',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const endpointParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (apiRange) endpointParams.set('timeRange', apiRange);
                const regionParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (regionRange) regionParams.set('timeRange', regionRange);
                const trendsParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (trendsRange) trendsParams.set('timeRange', trendsRange);

                const [
                    endpointStatsResult,
                    deepMetricsResult,
                    regionStatsResult,
                    latencyByLocationResult,
                    trendsResult,
                ] = await Promise.allSettled([
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/api-endpoint-stats?${endpointParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/observability-deep-metrics?${new URLSearchParams({ ...Object.fromEntries(endpointParams), mode: 'full' }).toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/region-performance?${regionParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/latency-by-location?${endpointParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/insights/trends?${trendsParams.toString()}`),
                ]);

                const failedSections: string[] = [];
                if (endpointStatsResult.status !== 'fulfilled') failedSections.push('endpoint stats');
                if (deepMetricsResult.status !== 'fulfilled') failedSections.push('deep metrics');
                if (regionStatsResult.status !== 'fulfilled') failedSections.push('regional latency');
                if (latencyByLocationResult.status !== 'fulfilled') failedSections.push('geo latency');
                if (trendsResult.status !== 'fulfilled') failedSections.push('traffic trends');

                for (const [sectionName, result] of [
                    ['endpointStats', endpointStatsResult],
                    ['deepMetrics', deepMetricsResult],
                    ['regionStats', regionStatsResult],
                    ['latencyByLocation', latencyByLocationResult],
                    ['trends', trendsResult],
                ] as const) {
                    if (result.status === 'rejected') {
                        logger.warn({ err: result.reason, sectionName, projectId: scope.normalizedProjectId, timeRange: scope.normalizedTimeRange }, '[overview] api section load failed');
                    }
                }

                return {
                    endpointStats: endpointStatsResult.status === 'fulfilled' ? endpointStatsResult.value : null,
                    deepMetrics: deepMetricsResult.status === 'fulfilled' ? deepMetricsResult.value : null,
                    regionStats: regionStatsResult.status === 'fulfilled' ? regionStatsResult.value : null,
                    latencyByLocation: latencyByLocationResult.status === 'fulfilled' ? latencyByLocationResult.value : null,
                    trends: trendsResult.status === 'fulfilled' ? trendsResult.value : { daily: [] },
                    failedSections,
                };
            },
        });
    }),
);

router.get(
    '/devices',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const deviceRange = toDevicesRange(scope.normalizedTimeRange);
        const trendsRange = toDevicesTrendsRange(scope.normalizedTimeRange);
        const insightsRange = toApiInsightsRange(scope.normalizedTimeRange);

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('devices', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'devices',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const deviceParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (deviceRange) deviceParams.set('timeRange', deviceRange);

                const deepMetricsParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, mode: 'summary' });
                if (insightsRange) deepMetricsParams.set('timeRange', insightsRange);

                const trendsParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, timeRange: trendsRange });

                const [summaryResult, deepMetricsResult, matrixResult, trendsResult] = await Promise.allSettled([
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/device-summary?${deviceParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/observability-deep-metrics?${deepMetricsParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/device-issues-matrix?${deviceParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/insights/trends?${trendsParams.toString()}`),
                ]);

                const failedSections: string[] = [];
                if (summaryResult.status !== 'fulfilled') failedSections.push('device summary');
                if (deepMetricsResult.status !== 'fulfilled') failedSections.push('release risk');
                if (matrixResult.status !== 'fulfilled') failedSections.push('issue matrix');
                if (trendsResult.status !== 'fulfilled') failedSections.push('trends');

                return {
                    summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
                    deepMetrics: deepMetricsResult.status === 'fulfilled' ? deepMetricsResult.value : null,
                    matrix: matrixResult.status === 'fulfilled' ? matrixResult.value : null,
                    trends: trendsResult.status === 'fulfilled' ? trendsResult.value : { daily: [] },
                    failedSections,
                };
            },
        });
    }),
);

router.get(
    '/geo',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const range = toApiInsightsRange(scope.normalizedTimeRange);

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('geo', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'geo',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const params = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (range) params.set('timeRange', range);

                const [issuesResult, latencyByLocationResult] = await Promise.allSettled([
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/geo-issues?${params.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/latency-by-location?${params.toString()}`),
                ]);

                const failedSections: string[] = [];
                if (issuesResult.status !== 'fulfilled') failedSections.push('issue regions');
                if (latencyByLocationResult.status !== 'fulfilled') failedSections.push('latency regions');

                return {
                    issues: issuesResult.status === 'fulfilled' ? issuesResult.value : { locations: [], countries: [], summary: { totalIssues: 0, byType: { crashes: 0, anrs: 0, errors: 0, rageTaps: 0, apiErrors: 0 } } },
                    latencyByLocation: latencyByLocationResult.status === 'fulfilled' ? latencyByLocationResult.value : { regions: [], summary: { avgLatency: 0, totalRequests: 0 } },
                    failedSections,
                };
            },
        });
    }),
);

router.get(
    '/journeys',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const journeyRange = toJourneyRange(scope.normalizedTimeRange);
        const trendsRange = toJourneyTrendsRange(scope.normalizedTimeRange);

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('journeys', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'journeys',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const journeyParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, mode: 'summary' });
                if (journeyRange) journeyParams.set('timeRange', journeyRange);

                const engagementParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (journeyRange) engagementParams.set('timeRange', journeyRange);

                const trendsParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, timeRange: trendsRange });

                const [journeyResult, userEngagementResult, trendsResult] = await Promise.allSettled([
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/journey-observability?${journeyParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/user-engagement-trends?${engagementParams.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/insights/trends?${trendsParams.toString()}`),
                ]);

                const failedSections: string[] = [];
                if (journeyResult.status !== 'fulfilled') failedSections.push('journey graph');
                if (userEngagementResult.status !== 'fulfilled') failedSections.push('user segments');
                if (trendsResult.status !== 'fulfilled') failedSections.push('trend window');

                return {
                    journey: journeyResult.status === 'fulfilled' ? journeyResult.value : null,
                    userEngagement: userEngagementResult.status === 'fulfilled' ? userEngagementResult.value : null,
                    trends: trendsResult.status === 'fulfilled' ? trendsResult.value : { daily: [] },
                    failedSections,
                };
            },
        });
    }),
);

router.get(
    '/heatmaps',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('heatmaps', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'heatmaps',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadHeatmapSummary(scope.cookieHeader, scope.normalizedProjectId!, scope.normalizedTimeRange),
        });
    }),
);

router.get(
    '/heatmaps/screen',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const screenName = typeof req.query.screenName === 'string' ? req.query.screenName : undefined;
        if (!screenName) {
            throw ApiError.badRequest('screenName is required');
        }

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey(`heatmaps:screen:${screenName}`, scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'heatmaps-screen',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                screenName,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadHeatmapScreenDetail(scope.cookieHeader, scope.normalizedProjectId!, screenName, scope.normalizedTimeRange),
        });
    }),
);

router.get(
    '/errors',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('errors', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'errors',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadErrorsOverview(scope.scopedProjectIds, scope.normalizedTimeRange),
        });
    }),
);

router.get(
    '/crashes',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('crashes', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'crashes',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadCrashesOverview(scope.scopedProjectIds, scope.normalizedTimeRange),
        });
    }),
);

router.get(
    '/anrs',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('anrs', scope.scopedProjectIds, scope.normalizedTimeRange),
            routeName: 'anrs',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const params = new URLSearchParams({ timeRange: scope.normalizedTimeRange || '30d', limit: '100' });
                const response = await fetchOverviewSection<{ anrs: unknown[]; totalGroups?: number; totalEvents?: number }>(
                    scope.cookieHeader,
                    `/api/projects/${scope.normalizedProjectId}/anrs?${params.toString()}`,
                );

                const anrRows = Array.isArray(response.anrs) ? response.anrs as Array<{ occurrenceCount?: number; userCount?: number }> : [];
                return {
                    anrs: response.anrs || [],
                    summary: {
                        issues: response.totalGroups ?? anrRows.length,
                        events: response.totalEvents ?? anrRows.reduce((sum, row) => sum + Number(row.occurrenceCount || 0), 0),
                        users: anrRows.reduce((sum, row) => sum + Number(row.userCount || 0), 0),
                    },
                };
            },
        });
    }),
);

export default router;
