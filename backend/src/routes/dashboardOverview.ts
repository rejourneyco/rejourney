/**
 * Aggregated dashboard overview route.
 *
 * Collapses the general dashboard's startup fan-out into a single browser
 * request, while keeping heavyweight detail routes separate.
 */

import { Router } from 'express';
import { and, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, dbRead, projects, recordingArtifacts, sessionMetrics, sessions, teamMembers, errors as jsErrors, crashes as appCrashes, screenTouchHeatmaps, alertHistory } from '../db/client.js';
import { getClickHouseClient, isClickHouseReadsEnabled } from '../db/clickhouse.js';
import { getRedis } from '../db/redis.js';
import { downloadFromS3ForArtifact } from '../db/s3.js';
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
import { buildHeatmapScreenshotUrl } from '../utils/heatmapPreview.js';
import { normalizeHeatmapScreenName, normalizeHeatmapScreenPath } from '../utils/heatmapScreens.js';
import {
    buildWebAttentionHeatmap,
    dimensionsFromRrwebEnvelope,
    extractRrwebEventsFromArtifact,
    type WebAttentionHeatmapDimensions,
    type WebAttentionTouchPrior,
} from '../utils/webAttentionHeatmap.js';
import {
    buildMobileAttentionHeatmap,
    extractMobileEventsFromArtifact,
    extractMobileHierarchySnapshotsFromArtifact,
    type MobileAttentionSessionInput,
} from '../utils/mobileAttentionHeatmap.js';

const router = Router();
const redis = getRedis();

const RETENTION_PREVIEW_CACHE_TTL_SECONDS = 900;
const SESSION_PREVIEW_LIMIT = 120;
const RETENTION_PREVIEW_ROWS = 4;
const RETENTION_PREVIEW_WEEKS = 4;
const OVERVIEW_RESPONSE_CACHE_CONTROL = 'private, max-age=30, stale-while-revalidate=60';
const WEB_ATTENTION_CACHE_TTL_SECONDS = 600;
const WEB_ATTENTION_SESSION_SCAN_LIMIT = 250;
const WEB_ATTENTION_SAMPLE_SESSION_LIMIT = 12;
const WEB_ATTENTION_MAX_ARTIFACTS = 30;
const WEB_ATTENTION_MAX_ARTIFACTS_PER_SESSION = 3;
const WEB_ATTENTION_DOWNLOAD_CONCURRENCY = 6;
// Mild tilt toward recent sessions: 0 = uniform random, 1 = strongly favor newest.
// Kept low so the sample still represents the whole window, just leaning slightly recent.
const WEB_ATTENTION_RECENCY_BIAS = 0.4;

// Weighted-reservoir sample (Efraimidis-Spirakis) with a gentle recency tilt.
// `items` must be ordered most-recent-first; earlier (more recent) items get slightly
// higher selection weight, but every item retains a real chance of being picked.
function sampleRecencyWeightedSubset<T>(items: T[], limit: number): T[] {
    if (items.length <= limit) return items.slice();
    const n = items.length;
    return items
        .map((item, index) => {
            const rankFraction = n > 1 ? index / (n - 1) : 0;
            const weight = 1 - WEB_ATTENTION_RECENCY_BIAS * rankFraction;
            const key = Math.pow(Math.random(), 1 / Math.max(weight, 1e-6));
            return { item, key };
        })
        .sort((a, b) => b.key - a.key)
        .slice(0, limit)
        .map((entry) => entry.item);
}

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

function buildSessionPlatformCondition(platform?: string): SQL | undefined {
    if (!platform || platform === 'all') return undefined;
    if (platform === 'mobile') return inArray(sessions.platform, ['ios', 'android']);
    return eq(sessions.platform, platform);
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

function getFailedSections(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') return [];
    const failedSections = (payload as { failedSections?: unknown }).failedSections;
    if (!Array.isArray(failedSections)) return [];
    return failedSections.filter((section): section is string => typeof section === 'string' && section.length > 0);
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
    const cached = await redis.get(cacheKey);
    if (cached) {
        setOverviewCacheHeaders(res);
        res.setHeader('X-Rejourney-Overview-Cache', 'hit');
        res.json(JSON.parse(cached));
        return;
    }

    const startedAt = Date.now();
    const payload = await build();
    const serializedPayload = jsonSafeStringify(payload);
    const failedSections = getFailedSections(payload);

    if (failedSections.length === 0) {
        await persistOverviewCachePayload(cacheKey, serializedPayload, {
            redisClient: redis,
            ttlSeconds,
        });
        setOverviewCacheHeaders(res);
        res.setHeader('X-Rejourney-Overview-Cache', 'miss');
    } else {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Rejourney-Overview-Cache', 'bypass');
        logger.warn(
            {
                routeName,
                failedSections,
                ...logContext,
            },
            '[overview] degraded payload not cached',
        );
    }

    logger.info(
        {
            routeName,
            durationMs: Date.now() - startedAt,
            ...logContext,
        },
        '[overview] bootstrap ready',
    );

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
    const url = new URL(path, `http://localhost:${config.PORT}`);
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
    normalizedPlatform?: string;
    accessibleProjectIds: string[];
    scopedProjectIds: string[];
    params: URLSearchParams;
    obsParams: URLSearchParams;
    cookieHeader?: string;
}> {
    const normalizedProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const normalizedTimeRange = typeof req.query.timeRange === 'string' ? req.query.timeRange : undefined;
    const rawPlatform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const normalizedPlatform = rawPlatform && rawPlatform !== 'all' ? rawPlatform : undefined;

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
    if (normalizedPlatform) {
        params.set('platform', normalizedPlatform);
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
        normalizedPlatform,
        accessibleProjectIds,
        scopedProjectIds,
        params,
        obsParams,
        cookieHeader: req.headers.cookie,
    };
}

async function loadRetentionPreview(projectIds: string[], timeRange?: string, platform?: string): Promise<{ rows: Array<{ weekStartKey: string; users: number; retention: Array<number | null> }> }> {
    if (projectIds.length === 0) {
        return { rows: [] };
    }

    const cacheKey = `overview:retention-preview:${projectIds.slice().sort().join(',')}:${timeRange || 'all'}:${platform || 'all'}:v1`;
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

    const conditions: SQL[] = [
        inArray(sessions.projectId, projectIds),
        gte(sessions.startedAt, startedAfter),
        sql`${scopedIdentitySql} is not null`,
    ];
    const platformCondition = buildSessionPlatformCondition(platform);
    if (platformCondition) conditions.push(platformCondition);

    const activityRows = await db
        .select({
            userKey: scopedIdentitySql,
            weekStartKey: weekStartKeySql,
        })
        .from(sessions)
        .where(and(...conditions))
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

async function loadUserFirstSeenMap(
    projectIds: string[],
    sessionRows: Array<{
        userDisplayId: string | null;
        anonymousDisplayId: string | null;
        anonymousHash: string | null;
        deviceId: string | null;
    }>,
): Promise<Map<string, Date>> {
    const resultMap = new Map<string, Date>();

    const userIds = [...new Set(sessionRows.filter((s) => s.userDisplayId).map((s) => s.userDisplayId!))];
    const anonDisplayIds = [...new Set(sessionRows.filter((s) => !s.userDisplayId && s.anonymousDisplayId).map((s) => s.anonymousDisplayId!))];
    const anonHashes = [...new Set(sessionRows.filter((s) => !s.userDisplayId && !s.anonymousDisplayId && s.anonymousHash).map((s) => s.anonymousHash!))];
    const deviceIds = [...new Set(sessionRows.filter((s) => !s.userDisplayId && !s.anonymousDisplayId && !s.anonymousHash && s.deviceId).map((s) => s.deviceId!))];

    const legs: ReturnType<typeof sql>[] = [];

    if (userIds.length > 0) {
        legs.push(sql`
            SELECT 'user' AS kind, ${sessions.userDisplayId} AS key, min(${sessions.startedAt}) AS first_seen
            FROM ${sessions}
            WHERE ${inArray(sessions.projectId, projectIds)} AND ${inArray(sessions.userDisplayId, userIds)}
            GROUP BY ${sessions.userDisplayId}
        `);
    }
    if (anonDisplayIds.length > 0) {
        legs.push(sql`
            SELECT 'anon' AS kind, ${sessions.anonymousDisplayId} AS key, min(${sessions.startedAt}) AS first_seen
            FROM ${sessions}
            WHERE ${inArray(sessions.projectId, projectIds)} AND ${inArray(sessions.anonymousDisplayId, anonDisplayIds)}
            GROUP BY ${sessions.anonymousDisplayId}
        `);
    }
    if (anonHashes.length > 0) {
        legs.push(sql`
            SELECT 'hash' AS kind, ${sessions.anonymousHash} AS key, min(${sessions.startedAt}) AS first_seen
            FROM ${sessions}
            WHERE ${inArray(sessions.projectId, projectIds)} AND ${inArray(sessions.anonymousHash, anonHashes)}
            GROUP BY ${sessions.anonymousHash}
        `);
    }
    if (deviceIds.length > 0) {
        legs.push(sql`
            SELECT 'device' AS kind, ${sessions.deviceId} AS key, min(${sessions.startedAt}) AS first_seen
            FROM ${sessions}
            WHERE ${inArray(sessions.projectId, projectIds)} AND ${inArray(sessions.deviceId, deviceIds)}
            GROUP BY ${sessions.deviceId}
        `);
    }

    if (legs.length === 0) return resultMap;

    const unionQuery = legs.reduce((acc, leg, i) => i === 0 ? leg : sql`${acc} UNION ALL ${leg}`);
    const result = await dbRead.execute<{ kind: string; key: string; first_seen: Date }>(unionQuery);
    const rows: Array<{ kind: string; key: string; first_seen: Date }> = Array.isArray(result) ? result : (result as any).rows ?? [];

    for (const row of rows) {
        if (row.key) {
            resultMap.set(`${row.kind}:${row.key}`, new Date(row.first_seen));
        }
    }

    return resultMap;
}

async function loadSessionPreview(projectIds: string[], timeRange?: string, platform?: string) {
    if (projectIds.length === 0) {
        return [];
    }

    const conditions = [
        inArray(sessions.projectId, projectIds),
        eq(sessions.replayAvailable, true),
        eq(sessions.recordingDeleted, false),
        eq(sessions.isReplayExpired, false),
    ];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(sessions.startedAt, startedAfter));
    }
    const platformCondition = buildSessionPlatformCondition(platform);
    if (platformCondition) {
        conditions.push(platformCondition as any);
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
                sdkVersion: sessions.sdkVersion,
                webReferral: sql<string | null>`nullif(coalesce(
                    ${sessions.webReferral},
                    ${sessions.metadata}->>'webReferral',
                    ${sessions.metadata}->>'webReferrerDomain',
                    ${sessions.metadata}->>'webAttributionSource'
                ), '')`,
                webLandingRoute: sql<string | null>`nullif(coalesce(
                    ${sessions.metadata}->>'webLandingRoute',
                    ${sessions.metadata}->>'webEntryPath'
                ), '')`,
                metadata: sessions.metadata,
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
            metrics: {
                totalEvents: sessionMetrics.totalEvents,
                errorCount: sessionMetrics.errorCount,
                touchCount: sessionMetrics.touchCount,
                scrollCount: sessionMetrics.scrollCount,
                gestureCount: sessionMetrics.gestureCount,
                inputCount: sessionMetrics.inputCount,
                apiSuccessCount: sessionMetrics.apiSuccessCount,
                apiErrorCount: sessionMetrics.apiErrorCount,
                apiTotalCount: sessionMetrics.apiTotalCount,
                apiAvgResponseMs: sessionMetrics.apiAvgResponseMs,
                rageTapCount: sessionMetrics.rageTapCount,
                deadTapCount: sessionMetrics.deadTapCount,
                screensVisited: sessionMetrics.screensVisited,
                interactionScore: sessionMetrics.interactionScore,
                explorationScore: sessionMetrics.explorationScore,
                customEventCount: sessionMetrics.customEventCount,
                crashCount: sessionMetrics.crashCount,
                anrCount: sessionMetrics.anrCount,
                appStartupTimeMs: sessionMetrics.appStartupTimeMs,
                networkType: sessionMetrics.networkType,
                cellularGeneration: sessionMetrics.cellularGeneration,
                isConstrained: sessionMetrics.isConstrained,
                isExpensive: sessionMetrics.isExpensive,
            },
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(and(...conditions))
        .orderBy(desc(sessions.startedAt))
        .limit(SESSION_PREVIEW_LIMIT);

    const firstSeenMap = await loadUserFirstSeenMap(projectIds, rows.map((r) => r.session));

    return rows.map(({ session, metrics }) => {
        const identityKey = session.userDisplayId
            ? `user:${session.userDisplayId}`
            : session.anonymousDisplayId
            ? `anon:${session.anonymousDisplayId}`
            : session.anonymousHash
            ? `hash:${session.anonymousHash}`
            : session.deviceId
            ? `device:${session.deviceId}`
            : null;
        const userFirstSeenAt = identityKey ? firstSeenMap.get(identityKey) : undefined;
        return {
        id: session.id,
        projectId: session.projectId,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString(),
        durationSeconds: session.durationSeconds ?? 0,
        platform: session.platform,
        appVersion: session.appVersion,
        sdkVersion: session.sdkVersion ?? undefined,
        deviceModel: session.deviceModel,
        osVersion: session.osVersion ?? undefined,
        webReferral: session.webReferral ?? undefined,
        webLandingRoute: session.webLandingRoute ?? undefined,
        metadata: session.metadata ?? undefined,
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
        userFirstSeenAt: userFirstSeenAt?.toISOString(),
        };
    });
}


const TOP_USERS_LIMIT = 20;

async function loadTopUsersPreview(projectIds: string[], timeRange?: string, platform?: string) {
    if (projectIds.length === 0) return [];

    const startedAfter = buildStartedAfter(timeRange);
    const startedAfterClause = startedAfter ? sql`AND ${sessions.startedAt} >= ${startedAfter}` : sql``;
    const platformClause = platform === 'mobile'
        ? sql`AND ${sessions.platform} IN ('ios', 'android')`
        : platform
            ? sql`AND ${sessions.platform} = ${platform}`
            : sql``;

    const topRows = await dbRead.execute<{
        user_key: string;
        session_count: number;
        total_duration_seconds: number | null;
        id: string;
        project_id: string;
        started_at: Date;
        ended_at: Date | null;
        duration_seconds: number | null;
        platform: string | null;
        app_version: string | null;
        device_model: string | null;
        os_version: string | null;
        sdk_version: string | null;
        web_referral: string | null;
        web_landing_route: string | null;
        metadata: Record<string, unknown> | null;
        user_display_id: string | null;
        anonymous_display_id: string | null;
        anonymous_hash: string | null;
        device_id: string | null;
        geo_city: string | null;
        geo_region: string | null;
        geo_country: string | null;
        geo_country_code: string | null;
        geo_latitude: number | null;
        geo_longitude: number | null;
        geo_timezone: string | null;
        status: string;
        recording_deleted: boolean;
        recording_deleted_at: Date | null;
        retention_days: number | null;
        retention_tier: string | null;
        is_replay_expired: boolean;
        replay_available: boolean | null;
    }>(sql`
        WITH filtered AS (
            SELECT
                ${sessions.id},
                ${sessions.projectId},
                ${sessions.startedAt},
                ${sessions.endedAt},
                ${sessions.durationSeconds},
                ${sessions.platform},
                ${sessions.appVersion},
                ${sessions.deviceModel},
                ${sessions.osVersion},
                ${sessions.sdkVersion},
                nullif(coalesce(
                    ${sessions.webReferral},
                    ${sessions.metadata}->>'webReferral',
                    ${sessions.metadata}->>'webReferrerDomain',
                    ${sessions.metadata}->>'webAttributionSource'
                ), '') AS web_referral,
                nullif(coalesce(
                    ${sessions.metadata}->>'webLandingRoute',
                    ${sessions.metadata}->>'webEntryPath'
                ), '') AS web_landing_route,
                ${sessions.metadata},
                ${sessions.userDisplayId},
                ${sessions.anonymousDisplayId},
                ${sessions.anonymousHash},
                ${sessions.deviceId},
                ${sessions.geoCity},
                ${sessions.geoRegion},
                ${sessions.geoCountry},
                ${sessions.geoCountryCode},
                ${sessions.geoLatitude},
                ${sessions.geoLongitude},
                ${sessions.geoTimezone},
                ${sessions.status},
                ${sessions.recordingDeleted},
                ${sessions.recordingDeletedAt},
                ${sessions.retentionDays},
                ${sessions.retentionTier},
                ${sessions.isReplayExpired},
                ${sessions.replayAvailable},
                CASE
                    WHEN nullif(trim(${sessions.userDisplayId}), '') IS NOT NULL THEN 'user:' || nullif(trim(${sessions.userDisplayId}), '')
                    WHEN nullif(trim(${sessions.anonymousDisplayId}), '') IS NOT NULL THEN 'anon:' || nullif(trim(${sessions.anonymousDisplayId}), '')
                    WHEN nullif(trim(${sessions.anonymousHash}), '') IS NOT NULL THEN 'hash:' || nullif(trim(${sessions.anonymousHash}), '')
                    WHEN nullif(trim(${sessions.deviceId}), '') IS NOT NULL THEN 'device:' || nullif(trim(${sessions.deviceId}), '')
                    ELSE NULL
                END AS user_key
            FROM ${sessions}
            WHERE ${inArray(sessions.projectId, projectIds)}
              ${startedAfterClause}
              ${platformClause}
              AND ${sessions.replayAvailable} = true
              AND ${sessions.recordingDeleted} = false
              AND ${sessions.isReplayExpired} = false
        ),
        ranked AS (
            SELECT
                user_key,
                cast(count(*) as int) AS session_count,
                cast(sum(coalesce(duration_seconds, 0)) as int) AS total_duration_seconds,
                max(started_at) AS latest_started_at
            FROM filtered
            WHERE user_key IS NOT NULL
            GROUP BY user_key
            ORDER BY count(*) DESC, max(started_at) DESC
            LIMIT ${TOP_USERS_LIMIT}
        ),
        latest AS (
            SELECT DISTINCT ON (filtered.user_key) filtered.*
            FROM filtered
            JOIN ranked ON ranked.user_key = filtered.user_key
            ORDER BY filtered.user_key, filtered.started_at DESC, filtered.id DESC
        )
        SELECT
            ranked.user_key,
            ranked.session_count,
            ranked.total_duration_seconds,
            latest.id,
            latest.project_id,
            latest.started_at,
            latest.ended_at,
            latest.duration_seconds,
            latest.platform,
            latest.app_version,
            latest.device_model,
            latest.os_version,
            latest.sdk_version,
            latest.web_referral,
            latest.web_landing_route,
            latest.metadata,
            latest.user_display_id,
            latest.anonymous_display_id,
            latest.anonymous_hash,
            latest.device_id,
            latest.geo_city,
            latest.geo_region,
            latest.geo_country,
            latest.geo_country_code,
            latest.geo_latitude,
            latest.geo_longitude,
            latest.geo_timezone,
            latest.status,
            latest.recording_deleted,
            latest.recording_deleted_at,
            latest.retention_days,
            latest.retention_tier,
            latest.is_replay_expired,
            latest.replay_available
        FROM ranked
        JOIN latest ON latest.user_key = ranked.user_key
        ORDER BY ranked.session_count DESC, ranked.latest_started_at DESC
    `);

    const topResult: Array<{
        user_key: string; session_count: number; total_duration_seconds: number | null;
        id: string; project_id: string; started_at: Date; ended_at: Date | null;
        duration_seconds: number | null; platform: string | null; app_version: string | null;
        device_model: string | null; os_version: string | null; sdk_version: string | null;
        web_referral: string | null; web_landing_route: string | null; metadata: Record<string, unknown> | null;
        user_display_id: string | null;
        anonymous_display_id: string | null; anonymous_hash: string | null; device_id: string | null;
        geo_city: string | null; geo_region: string | null; geo_country: string | null;
        geo_country_code: string | null; geo_latitude: number | null; geo_longitude: number | null;
        geo_timezone: string | null; status: string; recording_deleted: boolean;
        recording_deleted_at: Date | null; retention_days: number | null; retention_tier: string | null;
        is_replay_expired: boolean; replay_available: boolean | null;
    }> = Array.isArray(topRows) ? topRows : (topRows as any).rows ?? [];

    if (topResult.length === 0) return [];

    const firstSeenMap = await loadUserFirstSeenMap(
        projectIds,
        topResult.map((r) => ({
            userDisplayId: r.user_display_id,
            anonymousDisplayId: r.anonymous_display_id,
            anonymousHash: r.anonymous_hash,
            deviceId: r.device_id,
        })),
    );

    return topResult.map((latest) => {
        const identityKey = latest.user_display_id
            ? `user:${latest.user_display_id}`
            : latest.anonymous_display_id
            ? `anon:${latest.anonymous_display_id}`
            : latest.anonymous_hash
            ? `hash:${latest.anonymous_hash}`
            : `device:${latest.device_id}`;
        const userFirstSeenAt = firstSeenMap.get(identityKey);

        return {
                sessionCount: latest.session_count,
                totalDurationSeconds: latest.total_duration_seconds ?? 0,
                userFirstSeenAt: userFirstSeenAt?.toISOString(),
                latestSession: {
                    id: latest.id,
                    projectId: latest.project_id,
                    startedAt: new Date(latest.started_at).toISOString(),
                    endedAt: latest.ended_at ? new Date(latest.ended_at).toISOString() : undefined,
                    durationSeconds: latest.duration_seconds ?? 0,
                    platform: latest.platform,
                    appVersion: latest.app_version,
                    sdkVersion: latest.sdk_version ?? undefined,
                    deviceModel: latest.device_model,
                    osVersion: latest.os_version ?? undefined,
                    webReferral: latest.web_referral ?? undefined,
                    webLandingRoute: latest.web_landing_route ?? undefined,
                    metadata: latest.metadata ?? undefined,
                    userId: latest.user_display_id ?? undefined,
                    anonymousId: latest.anonymous_display_id || latest.anonymous_hash || undefined,
                    anonymousDisplayName: latest.device_id && !latest.user_display_id
                        ? generateAnonymousName(latest.device_id)
                        : undefined,
                    deviceId: latest.device_id ?? undefined,
                    geoLocation: latest.geo_city
                        ? {
                            city: latest.geo_city,
                            region: latest.geo_region,
                            country: latest.geo_country,
                            countryCode: latest.geo_country_code,
                            latitude: latest.geo_latitude,
                            longitude: latest.geo_longitude,
                            timezone: latest.geo_timezone,
                        }
                        : null,
                    status: latest.status,
                    recordingDeleted: latest.recording_deleted,
                    recordingDeletedAt: latest.recording_deleted_at
                        ? new Date(latest.recording_deleted_at).toISOString()
                        : null,
                    retentionDays: latest.retention_days ?? undefined,
                    retentionTier: latest.retention_tier ?? undefined,
                    isReplayExpired: latest.is_replay_expired,
                    hasSuccessfulRecording: Boolean(latest.replay_available) && !latest.recording_deleted && !latest.is_replay_expired,
                    effectiveStatus: latest.status,
                    isLiveIngest: false,
                    isBackgroundProcessing: false,
                    canOpenReplay: Boolean(latest.replay_available) && !latest.recording_deleted && !latest.is_replay_expired,
                    userFirstSeenAt: userFirstSeenAt?.toISOString(),
                    // Minimal metric stubs — Top Users display doesn't need these
                    totalEvents: 0, errorCount: 0, touchCount: 0, scrollCount: 0,
                    gestureCount: 0, inputCount: 0, apiSuccessCount: 0, apiErrorCount: 0,
                    apiTotalCount: 0, apiAvgResponseMs: 0, rageTapCount: 0, deadTapCount: 0,
                    screensVisited: [], interactionScore: 0, explorationScore: 0,
                    customEventCount: 0, crashCount: 0, anrCount: 0,
                },
            };
    });
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
    screenFirstSeenMs?: number | null;
    touchHotspots?: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }>;
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
};

type HeatmapIterationScreen = {
    name: string;
    screenshotUrl: string | null;
    screenFirstSeenMs?: number | null;
    touchHotspots?: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }>;
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
    visits: number;
    touches: number;
    rageTaps: number;
    errors: number;
    incidentRatePer100: number;
    lastSeenAt: string | null;
    evidenceSessionId: string | null;
};

type HeatmapIterationVersion = {
    appVersion: string;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    sessions: number;
    screens: HeatmapIterationScreen[];
};

type HeatmapIterationSummary = {
    overall: HeatmapIterationScreen[];
    versions: HeatmapIterationVersion[];
};

function mergeHeatmapScreen(
    name: string,
    alltime: HeatmapScreenSource | undefined,
    rangeData: HeatmapScreenSource | undefined,
    includeTouchHotspots: boolean,
) {
    const evidenceSource = rangeData?.sessionIds?.[0]
        ? rangeData
        : alltime?.sessionIds?.[0]
            ? alltime
            : rangeData ?? alltime;
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
        sessionIds: evidenceSource?.sessionIds ?? alltime?.sessionIds ?? rangeData?.sessionIds ?? [],
        screenFirstSeenMs: evidenceSource?.screenFirstSeenMs ?? alltime?.screenFirstSeenMs ?? rangeData?.screenFirstSeenMs ?? null,
        touchHotspots,
        pageWidth: alltime?.pageWidth ?? rangeData?.pageWidth ?? null,
        pageHeight: alltime?.pageHeight ?? rangeData?.pageHeight ?? null,
        viewportWidth: alltime?.viewportWidth ?? rangeData?.viewportWidth ?? null,
        viewportHeight: alltime?.viewportHeight ?? rangeData?.viewportHeight ?? null,
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
        evidenceSessionId: evidenceSource?.sessionIds?.[0] ?? null,
    };
}

function createHeatmapIterationScreen(name: string): HeatmapIterationScreen {
    return {
        name,
        screenshotUrl: null,
        screenFirstSeenMs: null,
        touchHotspots: [],
        pageWidth: null,
        pageHeight: null,
        viewportWidth: null,
        viewportHeight: null,
        visits: 0,
        touches: 0,
        rageTaps: 0,
        errors: 0,
        incidentRatePer100: 0,
        lastSeenAt: null,
        evidenceSessionId: null,
    };
}

function updateHeatmapIterationScreen(
    screen: HeatmapIterationScreen,
    values: {
        touches: number;
        rageTaps: number;
        errors: number;
        startedAt: Date;
        evidenceSessionId: string | null;
        screenshotSessionId: string | null;
    },
) {
    screen.visits += 1;
    screen.touches += Math.max(0, values.touches);
    screen.rageTaps += Math.max(0, values.rageTaps);
    screen.errors += Math.max(0, values.errors);
    screen.incidentRatePer100 = toRatePer100(screen.rageTaps + screen.errors, screen.visits);

    const startedAtIso = values.startedAt.toISOString();
    if (!screen.lastSeenAt || startedAtIso > screen.lastSeenAt) {
        screen.lastSeenAt = startedAtIso;
    }
    if (!screen.evidenceSessionId && values.evidenceSessionId) {
        screen.evidenceSessionId = values.evidenceSessionId;
    }
    if (!screen.screenshotUrl && values.screenshotSessionId) {
        screen.screenshotUrl = buildHeatmapScreenshotUrl(values.screenshotSessionId);
    }
}

async function loadHeatmapIterationSummary(
    projectId: string,
    timeRange?: string,
    platform?: string,
): Promise<HeatmapIterationSummary> {
    const conditions = [eq(sessions.projectId, projectId)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(sessions.startedAt, startedAfter));
    }
    const platformCondition = buildSessionPlatformCondition(platform);
    if (platformCondition) {
        conditions.push(platformCondition as any);
    }

    const rows = await db
        .select({
            sessionId: sessions.id,
            appVersion: sessions.appVersion,
            startedAt: sessions.startedAt,
            replayAvailable: sessions.replayAvailable,
            recordingDeleted: sessions.recordingDeleted,
            isReplayExpired: sessions.isReplayExpired,
            screensVisited: sessionMetrics.screensVisited,
            touchCount: sessionMetrics.touchCount,
            rageTapCount: sessionMetrics.rageTapCount,
            errorCount: sessionMetrics.errorCount,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(and(...conditions))
        .orderBy(desc(sessions.startedAt))
        .limit(5000);

    const replayReadySessionIds = Array.from(new Set(
        rows
            .filter((row) => Boolean(row.replayAvailable) && !row.recordingDeleted && !row.isReplayExpired)
            .map((row) => row.sessionId)
    ));
    const screenshotSessionIds = new Set<string>();

    if (replayReadySessionIds.length > 0) {
        const screenshotRows = await db
            .select({ sessionId: recordingArtifacts.sessionId })
            .from(recordingArtifacts)
            .where(and(
                inArray(recordingArtifacts.sessionId, replayReadySessionIds),
                eq(recordingArtifacts.kind, 'screenshots'),
                eq(recordingArtifacts.status, 'ready'),
            ))
            .groupBy(recordingArtifacts.sessionId)
            .limit(replayReadySessionIds.length);

        for (const row of screenshotRows) {
            screenshotSessionIds.add(row.sessionId);
        }
    }

    const overallMap = new Map<string, HeatmapIterationScreen>();
    const versionMap = new Map<string, {
        appVersion: string;
        firstSeenAt: string | null;
        lastSeenAt: string | null;
        sessions: number;
        screens: Map<string, HeatmapIterationScreen>;
    }>();

    for (const row of rows) {
        const visitedScreens = Array.from(new Set(normalizeHeatmapScreenPath(row.screensVisited || [])));
        if (visitedScreens.length === 0) continue;

        const appVersion = row.appVersion?.trim() || 'Unknown';
        const replayReady = Boolean(row.replayAvailable) && !row.recordingDeleted && !row.isReplayExpired;
        const evidenceSessionId = replayReady ? row.sessionId : null;
        const screenshotSessionId = replayReady && screenshotSessionIds.has(row.sessionId) ? row.sessionId : null;
        const perScreenTouches = Math.ceil((row.touchCount || 0) / visitedScreens.length);
        const perScreenRageTaps = Math.ceil((row.rageTapCount || 0) / visitedScreens.length);
        const perScreenErrors = Math.ceil((row.errorCount || 0) / visitedScreens.length);
        const startedAtIso = row.startedAt.toISOString();

        let version = versionMap.get(appVersion);
        if (!version) {
            version = {
                appVersion,
                firstSeenAt: startedAtIso,
                lastSeenAt: startedAtIso,
                sessions: 0,
                screens: new Map<string, HeatmapIterationScreen>(),
            };
            versionMap.set(appVersion, version);
        }
        version.sessions += 1;
        if (!version.firstSeenAt || startedAtIso < version.firstSeenAt) version.firstSeenAt = startedAtIso;
        if (!version.lastSeenAt || startedAtIso > version.lastSeenAt) version.lastSeenAt = startedAtIso;

        for (const screenName of visitedScreens) {
            let overall = overallMap.get(screenName);
            if (!overall) {
                overall = createHeatmapIterationScreen(screenName);
                overallMap.set(screenName, overall);
            }
            updateHeatmapIterationScreen(overall, {
                touches: perScreenTouches,
                rageTaps: perScreenRageTaps,
                errors: perScreenErrors,
                startedAt: row.startedAt,
                evidenceSessionId,
                screenshotSessionId,
            });

            let versionScreen = version.screens.get(screenName);
            if (!versionScreen) {
                versionScreen = createHeatmapIterationScreen(screenName);
                version.screens.set(screenName, versionScreen);
            }
            updateHeatmapIterationScreen(versionScreen, {
                touches: perScreenTouches,
                rageTaps: perScreenRageTaps,
                errors: perScreenErrors,
                startedAt: row.startedAt,
                evidenceSessionId,
                screenshotSessionId,
            });
        }
    }

    const sortScreens = (items: HeatmapIterationScreen[]) => items.sort((a, b) => {
        if (b.incidentRatePer100 !== a.incidentRatePer100) return b.incidentRatePer100 - a.incidentRatePer100;
        return b.visits - a.visits;
    });

    const overall = sortScreens(Array.from(overallMap.values())).slice(0, 60);
    const retainedScreenNames = new Set(overall.map((screen) => screen.name));

    return {
        overall,
        versions: Array.from(versionMap.values())
            .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
            .map((version) => ({
                appVersion: version.appVersion,
                firstSeenAt: version.firstSeenAt,
                lastSeenAt: version.lastSeenAt,
                sessions: version.sessions,
                screens: sortScreens(Array.from(version.screens.values()).filter((screen) => retainedScreenNames.has(screen.name))).slice(0, 40),
            }))
            .filter((version) => version.screens.length > 0),
    };
}

function applyHeatmapIterationScreenshots(
    iteration: HeatmapIterationSummary,
    alltimeMap: Map<string, HeatmapScreenSource>,
    frictionMap: Map<string, HeatmapScreenSource>,
): HeatmapIterationSummary {
    const applyScreenshot = (screen: HeatmapIterationScreen): HeatmapIterationScreen => {
        const fallbackSource = alltimeMap.get(screen.name) ?? frictionMap.get(screen.name);
        const fallbackScreenshot = fallbackSource?.screenshotUrl ?? null;
        const fallbackHotspots = fallbackSource?.touchHotspots ?? [];
        return {
            ...screen,
            screenshotUrl: screen.screenshotUrl ?? fallbackScreenshot,
            screenFirstSeenMs: screen.screenFirstSeenMs ?? fallbackSource?.screenFirstSeenMs ?? null,
            touchHotspots: screen.touchHotspots?.length ? screen.touchHotspots : fallbackHotspots,
            pageWidth: screen.pageWidth ?? fallbackSource?.pageWidth ?? null,
            pageHeight: screen.pageHeight ?? fallbackSource?.pageHeight ?? null,
            viewportWidth: screen.viewportWidth ?? fallbackSource?.viewportWidth ?? null,
            viewportHeight: screen.viewportHeight ?? fallbackSource?.viewportHeight ?? null,
        };
    };

    return {
        overall: iteration.overall.map(applyScreenshot),
        versions: iteration.versions.map((version) => ({
            ...version,
            screens: version.screens.map(applyScreenshot),
        })),
    };
}

async function fetchHeatmapSources(
    cookieHeader: string | undefined,
    projectId: string,
    timeRange?: string,
    platform?: string,
): Promise<{
    allTime: { screens?: HeatmapScreenSource[]; lastUpdated?: string };
    friction: { screens?: HeatmapScreenSource[] };
    failedSections: string[];
}> {
    const frictionParams = new URLSearchParams({ projectId });
    if (timeRange) {
        frictionParams.set('timeRange', timeRange);
    }
    if (platform) {
        frictionParams.set('platform', platform);
    }

    const [allTimeResult, frictionResult] = await Promise.allSettled([
        platform
            ? Promise.resolve({ screens: [], lastUpdated: undefined })
            : fetchOverviewSection<{ screens?: HeatmapScreenSource[]; lastUpdated?: string }>(
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
    platform?: string,
) {
    const [{ allTime, friction, failedSections }, rawScreenIteration] = await Promise.all([
        fetchHeatmapSources(cookieHeader, projectId, timeRange, platform),
        loadHeatmapIterationSummary(projectId, timeRange, platform),
    ]);
    const alltimeMap = new Map<string, HeatmapScreenSource>((allTime.screens || []).map((screen) => [screen.name, screen]));
    const frictionMap = new Map<string, HeatmapScreenSource>((friction.screens || []).map((screen) => [screen.name, screen]));
    const screenIteration = applyHeatmapIterationScreenshots(rawScreenIteration, alltimeMap, frictionMap);
    const includeAllTimeOnlyScreens = !timeRange || timeRange === 'all';
    const screenNames = new Set<string>(frictionMap.keys());
    if (includeAllTimeOnlyScreens) {
        for (const name of alltimeMap.keys()) {
            screenNames.add(name);
        }
    }

    return {
        screens: Array.from(screenNames).map((name) => mergeHeatmapScreen(name, alltimeMap.get(name), frictionMap.get(name), true)),
        screenIteration,
        lastUpdated: allTime.lastUpdated ?? new Date().toISOString(),
        failedSections,
    };
}

async function loadHeatmapScreenDetail(
    cookieHeader: string | undefined,
    projectId: string,
    screenName: string,
    timeRange?: string,
    platform?: string,
) {
    const { allTime, friction, failedSections } = await fetchHeatmapSources(cookieHeader, projectId, timeRange, platform);
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

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(items[index], index);
        }
    }));

    return results;
}

type WebAttentionPrior = Partial<WebAttentionHeatmapDimensions> & WebAttentionTouchPrior;

function emptyWebAttentionHeatmap(
    dimensions: Partial<WebAttentionHeatmapDimensions> = {},
    reason: string | null = null,
) {
    return {
        hotspots: [],
        sampledSessions: 0,
        avgSessionDurationMs: null,
        dwellByDepth: [],
        eventCount: 0,
        generatedAt: new Date().toISOString(),
        confidence: 'low' as const,
        pageWidth: dimensions.pageWidth ?? dimensions.viewportWidth ?? null,
        pageHeight: dimensions.pageHeight ?? dimensions.viewportHeight ?? null,
        viewportWidth: dimensions.viewportWidth ?? null,
        viewportHeight: dimensions.viewportHeight ?? null,
        reason,
    };
}

function mergeBucketMap(target: Record<string, number>, source: Record<string, number> | null | undefined): void {
    if (!source || typeof source !== 'object') return;
    for (const [bucket, rawValue] of Object.entries(source)) {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value <= 0) continue;
        target[bucket] = (target[bucket] ?? 0) + value;
    }
}

function hasTouchPriorSignal(prior: WebAttentionTouchPrior): boolean {
    return Number(prior.totalTouches ?? 0) > 0 ||
        Number(prior.totalRageTaps ?? 0) > 0 ||
        Object.keys(prior.touchBuckets ?? {}).length > 0 ||
        Object.keys(prior.rageTapBuckets ?? {}).length > 0;
}

function dimensionsFromAttentionPrior(prior: WebAttentionPrior): Partial<WebAttentionHeatmapDimensions> {
    return {
        pageWidth: prior.pageWidth,
        pageHeight: prior.pageHeight,
        viewportWidth: prior.viewportWidth,
        viewportHeight: prior.viewportHeight,
    };
}

function attentionFromPriorOrEmpty(
    prior: WebAttentionPrior,
    normalizedScreenName: string,
    emptyReason: string,
) {
    const dimensions = dimensionsFromAttentionPrior(prior);
    if (!hasTouchPriorSignal(prior)) {
        return emptyWebAttentionHeatmap(dimensions, emptyReason);
    }

    const result = buildWebAttentionHeatmap([], dimensions, prior, normalizedScreenName);
    return {
        ...result,
        reason: result.hotspots.length > 0 ? null : emptyReason,
    };
}

function mobileAttentionFromPriorOrEmpty(
    prior: WebAttentionPrior,
    normalizedScreenName: string,
    emptyReason: string,
) {
    const dimensions = dimensionsFromAttentionPrior(prior);
    const result = buildMobileAttentionHeatmap([], dimensions, hasTouchPriorSignal(prior) ? prior : null, normalizedScreenName);
    return {
        ...result,
        reason: result.hotspots.length > 0 ? null : emptyReason,
    };
}

async function loadWebAttentionPrior(
    projectId: string,
    normalizedScreenName: string,
    timeRange?: string,
): Promise<WebAttentionPrior> {
    const startedAfter = buildStartedAfter(timeRange);
    const rows = await db
        .select({
            screenName: screenTouchHeatmaps.screenName,
            touchBuckets: screenTouchHeatmaps.touchBuckets,
            rageTapBuckets: screenTouchHeatmaps.rageTapBuckets,
            totalTouches: screenTouchHeatmaps.totalTouches,
            totalRageTaps: screenTouchHeatmaps.totalRageTaps,
            pageWidth: screenTouchHeatmaps.pageWidth,
            pageHeight: screenTouchHeatmaps.pageHeight,
            viewportWidth: screenTouchHeatmaps.viewportWidth,
            viewportHeight: screenTouchHeatmaps.viewportHeight,
        })
        .from(screenTouchHeatmaps)
        .where(and(
            eq(screenTouchHeatmaps.projectId, projectId),
            startedAfter ? gte(screenTouchHeatmaps.date, startedAfter.toISOString().split('T')[0] as any) : undefined,
        ))
        .limit(5000);

    const matched = rows.filter((row) => normalizeHeatmapScreenName(row.screenName) === normalizedScreenName);
    const prior: WebAttentionPrior = {
        touchBuckets: {},
        rageTapBuckets: {},
        totalTouches: 0,
        totalRageTaps: 0,
    };

    for (const row of matched) {
        mergeBucketMap(prior.touchBuckets!, row.touchBuckets as Record<string, number> | null | undefined);
        mergeBucketMap(prior.rageTapBuckets!, row.rageTapBuckets as Record<string, number> | null | undefined);
        prior.totalTouches = Number(prior.totalTouches ?? 0) + Number(row.totalTouches ?? 0);
        prior.totalRageTaps = Number(prior.totalRageTaps ?? 0) + Number(row.totalRageTaps ?? 0);
        prior.pageWidth = Math.max(prior.pageWidth ?? 0, row.pageWidth ?? 0) || prior.pageWidth;
        prior.pageHeight = Math.max(prior.pageHeight ?? 0, row.pageHeight ?? 0) || prior.pageHeight;
        prior.viewportWidth = Math.max(prior.viewportWidth ?? 0, row.viewportWidth ?? 0) || prior.viewportWidth;
        prior.viewportHeight = Math.max(prior.viewportHeight ?? 0, row.viewportHeight ?? 0) || prior.viewportHeight;
    }

    return prior;
}

async function loadWebAttentionHeatmap(
    projectId: string,
    screenName: string,
    timeRange?: string,
    platform?: string,
    appVersion?: string,
) {
    const normalizedScreenName = normalizeHeatmapScreenName(screenName);
    if (!normalizedScreenName) {
        throw ApiError.badRequest('screenName is invalid');
    }
    if (platform && platform !== 'web') {
        return emptyWebAttentionHeatmap({}, 'attention maps are web-only');
    }

    const attentionPrior = await loadWebAttentionPrior(projectId, normalizedScreenName, timeRange);
    const fallbackDimensions = dimensionsFromAttentionPrior(attentionPrior);
    const startedAfter = buildStartedAfter(timeRange);
    const conditions: SQL[] = [
        eq(sessions.projectId, projectId),
        eq(sessions.platform, 'web'),
        eq(sessions.replayAvailable, true),
        eq(sessions.recordingDeleted, false),
        eq(sessions.isReplayExpired, false),
    ];
    if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));
    if (appVersion) conditions.push(eq(sessions.appVersion, appVersion));

    const candidateRows = await db
        .select({
            sessionId: sessions.id,
            startedAt: sessions.startedAt,
            endedAt: sessions.endedAt,
            durationSeconds: sessions.durationSeconds,
            screensVisited: sessionMetrics.screensVisited,
        })
        .from(sessions)
        .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
        .where(and(...conditions))
        .orderBy(desc(sessions.startedAt))
        .limit(WEB_ATTENTION_SESSION_SCAN_LIMIT);

    const matchedRows = candidateRows
        .filter((row) => normalizeHeatmapScreenPath(row.screensVisited || []).includes(normalizedScreenName))
    const matchedSessionIds = matchedRows.map((row) => row.sessionId);
    const durationMsBySessionId = new Map(
        matchedRows.map((row) => {
            const durationMsFromColumn = Number(row.durationSeconds ?? 0) > 0
                ? Number(row.durationSeconds) * 1000
                : null;
            const durationMsFromDates = row.endedAt instanceof Date && row.endedAt.getTime() > row.startedAt.getTime()
                ? row.endedAt.getTime() - row.startedAt.getTime()
                : null;
            return [row.sessionId, durationMsFromColumn ?? durationMsFromDates] as const;
        }),
    );
    // Sample rather than always taking the most recent sessions: a small representative subset
    // is enough to score an attention wash and avoids downloading every matching replay. The
    // sampler leans slightly toward recent sessions but still spans the whole matched window.
    const sampledSessionIds = sampleRecencyWeightedSubset(matchedSessionIds, WEB_ATTENTION_SAMPLE_SESSION_LIMIT);

    if (sampledSessionIds.length === 0) {
        return attentionFromPriorOrEmpty(attentionPrior, normalizedScreenName, 'no replay sessions matched this route');
    }

    const artifactRows = await db
        .select({
            id: recordingArtifacts.id,
            sessionId: recordingArtifacts.sessionId,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
            startTime: recordingArtifacts.startTime,
            createdAt: recordingArtifacts.createdAt,
        })
        .from(recordingArtifacts)
        .where(and(
            inArray(recordingArtifacts.sessionId, sampledSessionIds),
            eq(recordingArtifacts.kind, 'rrweb'),
            eq(recordingArtifacts.status, 'ready'),
        ))
        .orderBy(recordingArtifacts.createdAt)
        .limit(WEB_ATTENTION_MAX_ARTIFACTS);

    if (artifactRows.length === 0) {
        return attentionFromPriorOrEmpty(attentionPrior, normalizedScreenName, 'matched sessions have no ready rrweb artifacts');
    }

    const artifactsBySession = new Map<string, typeof artifactRows>();
    for (const artifact of artifactRows) {
        const list = artifactsBySession.get(artifact.sessionId) ?? [];
        list.push(artifact);
        artifactsBySession.set(artifact.sessionId, list);
    }

    const sessionInputs = (await mapWithConcurrency(sampledSessionIds, WEB_ATTENTION_DOWNLOAD_CONCURRENCY, async (sessionId) => {
        const artifacts = (artifactsBySession.get(sessionId) || [])
            .sort((a, b) => (a.startTime ?? a.createdAt.getTime()) - (b.startTime ?? b.createdAt.getTime()))
            .slice(0, WEB_ATTENTION_MAX_ARTIFACTS_PER_SESSION);
        if (artifacts.length === 0) return null;

        const events: any[] = [];
        let dimensions: Partial<WebAttentionHeatmapDimensions> = { ...fallbackDimensions };

        for (const artifact of artifacts) {
            try {
                const data = await downloadFromS3ForArtifact(projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) continue;
                const extracted = extractRrwebEventsFromArtifact(data, artifact.s3ObjectKey);
                events.push(...extracted.events);
                const rrwebDimensions = dimensionsFromRrwebEnvelope(extracted.page, extracted.viewport);
                dimensions = {
                    pageWidth: rrwebDimensions.pageWidth ?? dimensions.pageWidth,
                    pageHeight: rrwebDimensions.pageHeight ?? dimensions.pageHeight,
                    viewportWidth: rrwebDimensions.viewportWidth ?? dimensions.viewportWidth,
                    viewportHeight: rrwebDimensions.viewportHeight ?? dimensions.viewportHeight,
                };
            } catch (err) {
                logger.warn(
                    {
                        err,
                        projectId,
                        sessionId,
                        artifactId: artifact.id,
                    },
                    '[overview] failed to load rrweb artifact for attention heatmap',
                );
            }
        }

        return events.length > 0
            ? { events, dimensions, durationMs: durationMsBySessionId.get(sessionId) ?? null }
            : null;
    })).filter((input): input is NonNullable<typeof input> => input !== null);

    if (sessionInputs.length === 0) {
        return attentionFromPriorOrEmpty(attentionPrior, normalizedScreenName, 'rrweb artifacts could not be read');
    }

    return {
        ...buildWebAttentionHeatmap(sessionInputs, fallbackDimensions, attentionPrior, normalizedScreenName),
        reason: null,
    };
}

function synthesizeScreenshotTimestamps(artifacts: Array<{
    startTime: number | null;
    endTime: number | null;
    frameCount: number | null;
    timestamp: number | null;
}>): number[] {
    const timestamps: number[] = [];
    for (const artifact of artifacts) {
        const start = Number(artifact.startTime ?? artifact.timestamp ?? 0);
        if (!Number.isFinite(start) || start <= 0) continue;
        const end = Number(artifact.endTime ?? 0);
        const frameCount = Math.max(1, Math.min(120, Number(artifact.frameCount ?? 1) || 1));
        if (Number.isFinite(end) && end > start && frameCount > 1) {
            const step = (end - start) / Math.max(1, frameCount - 1);
            for (let index = 0; index < frameCount; index += 1) {
                timestamps.push(Math.round(start + step * index));
            }
        } else {
            timestamps.push(Math.round(start));
        }
    }
    return timestamps;
}

async function loadMobileAttentionHeatmap(
    projectId: string,
    screenName: string,
    timeRange?: string,
    platform?: string,
    appVersion?: string,
) {
    const normalizedScreenName = normalizeHeatmapScreenName(screenName);
    if (!normalizedScreenName) {
        throw ApiError.badRequest('screenName is invalid');
    }

    const attentionPrior = await loadWebAttentionPrior(projectId, normalizedScreenName, timeRange);
    const fallbackDimensions = dimensionsFromAttentionPrior(attentionPrior);
    const startedAfter = buildStartedAfter(timeRange);
    const platformCondition = platform === 'ios' || platform === 'android'
        ? eq(sessions.platform, platform)
        : inArray(sessions.platform, ['ios', 'android']);
    const conditions: SQL[] = [
        eq(sessions.projectId, projectId),
        platformCondition,
        eq(sessions.replayAvailable, true),
        eq(sessions.recordingDeleted, false),
        eq(sessions.isReplayExpired, false),
    ];
    if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));
    if (appVersion) conditions.push(eq(sessions.appVersion, appVersion));

    const candidateRows = await db
        .select({
            sessionId: sessions.id,
            platform: sessions.platform,
            startedAt: sessions.startedAt,
            endedAt: sessions.endedAt,
            durationSeconds: sessions.durationSeconds,
            screensVisited: sessionMetrics.screensVisited,
        })
        .from(sessions)
        .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
        .where(and(...conditions))
        .orderBy(desc(sessions.startedAt))
        .limit(WEB_ATTENTION_SESSION_SCAN_LIMIT);

    const matchedRows = candidateRows
        .filter((row) => normalizeHeatmapScreenPath(row.screensVisited || []).includes(normalizedScreenName));
    const matchedSessionIds = matchedRows.map((row) => row.sessionId);
    const rowBySessionId = new Map(matchedRows.map((row) => [row.sessionId, row] as const));
    const durationMsBySessionId = new Map(
        matchedRows.map((row) => {
            const durationMsFromColumn = Number(row.durationSeconds ?? 0) > 0
                ? Number(row.durationSeconds) * 1000
                : null;
            const durationMsFromDates = row.endedAt instanceof Date && row.endedAt.getTime() > row.startedAt.getTime()
                ? row.endedAt.getTime() - row.startedAt.getTime()
                : null;
            return [row.sessionId, durationMsFromColumn ?? durationMsFromDates] as const;
        }),
    );
    const sampledSessionIds = sampleRecencyWeightedSubset(matchedSessionIds, WEB_ATTENTION_SAMPLE_SESSION_LIMIT);

    if (sampledSessionIds.length === 0) {
        return mobileAttentionFromPriorOrEmpty(attentionPrior, normalizedScreenName, 'no replay sessions matched this screen');
    }

    const artifactRows = await db
        .select({
            id: recordingArtifacts.id,
            sessionId: recordingArtifacts.sessionId,
            kind: recordingArtifacts.kind,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
            timestamp: recordingArtifacts.timestamp,
            startTime: recordingArtifacts.startTime,
            endTime: recordingArtifacts.endTime,
            frameCount: recordingArtifacts.frameCount,
            createdAt: recordingArtifacts.createdAt,
        })
        .from(recordingArtifacts)
        .where(and(
            inArray(recordingArtifacts.sessionId, sampledSessionIds),
            inArray(recordingArtifacts.kind, ['events', 'hierarchy', 'screenshots']),
            eq(recordingArtifacts.status, 'ready'),
        ))
        .orderBy(recordingArtifacts.createdAt)
        .limit(WEB_ATTENTION_MAX_ARTIFACTS * 3);

    if (artifactRows.length === 0) {
        return mobileAttentionFromPriorOrEmpty(attentionPrior, normalizedScreenName, 'matched sessions have no ready mobile replay artifacts');
    }

    const artifactsBySession = new Map<string, typeof artifactRows>();
    for (const artifact of artifactRows) {
        const list = artifactsBySession.get(artifact.sessionId) ?? [];
        list.push(artifact);
        artifactsBySession.set(artifact.sessionId, list);
    }

    const sessionInputs = (await mapWithConcurrency(sampledSessionIds, WEB_ATTENTION_DOWNLOAD_CONCURRENCY, async (sessionId) => {
        const artifacts = (artifactsBySession.get(sessionId) || [])
            .sort((a, b) => (a.startTime ?? a.timestamp ?? a.createdAt.getTime()) - (b.startTime ?? b.timestamp ?? b.createdAt.getTime()));
        if (artifacts.length === 0) return null;

        const events: any[] = [];
        const hierarchySnapshots: NonNullable<MobileAttentionSessionInput['hierarchySnapshots']> = [];
        const screenshotTimestamps = synthesizeScreenshotTimestamps(
            artifacts
                .filter((artifact) => artifact.kind === 'screenshots')
                .map((artifact) => ({
                    startTime: artifact.startTime,
                    endTime: artifact.endTime,
                    frameCount: artifact.frameCount,
                    timestamp: artifact.timestamp,
                })),
        );
        let deviceInfo: Record<string, unknown> | null = null;
        let dimensions: Partial<WebAttentionHeatmapDimensions> = { ...fallbackDimensions };

        for (const artifact of artifacts.filter((item) => item.kind === 'events' || item.kind === 'hierarchy').slice(0, WEB_ATTENTION_MAX_ARTIFACTS_PER_SESSION * 4)) {
            try {
                const data = await downloadFromS3ForArtifact(projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) continue;
                if (artifact.kind === 'events') {
                    const extracted = extractMobileEventsFromArtifact(data, artifact.s3ObjectKey);
                    events.push(...extracted.events);
                    if (!deviceInfo && extracted.deviceInfo) {
                        deviceInfo = extracted.deviceInfo;
                        dimensions = {
                            ...dimensions,
                            viewportWidth: Number(extracted.deviceInfo.viewportWidth ?? extracted.deviceInfo.screenWidth) || dimensions.viewportWidth,
                            viewportHeight: Number(extracted.deviceInfo.viewportHeight ?? extracted.deviceInfo.screenHeight) || dimensions.viewportHeight,
                        };
                    }
                } else if (artifact.kind === 'hierarchy') {
                    hierarchySnapshots.push(...extractMobileHierarchySnapshotsFromArtifact(data, artifact.s3ObjectKey, artifact.timestamp));
                }
            } catch (err) {
                logger.warn(
                    {
                        err,
                        projectId,
                        sessionId,
                        artifactId: artifact.id,
                        artifactKind: artifact.kind,
                    },
                    '[overview] failed to load mobile artifact for attention heatmap',
                );
            }
        }

        return events.length > 0 || hierarchySnapshots.length > 0 || screenshotTimestamps.length > 0
            ? {
                events,
                hierarchySnapshots,
                screenshotTimestamps,
                dimensions,
                durationMs: durationMsBySessionId.get(sessionId) ?? null,
                platform: rowBySessionId.get(sessionId)?.platform ?? null,
                deviceInfo,
            } satisfies MobileAttentionSessionInput
            : null;
    })).filter((input): input is NonNullable<typeof input> => input !== null);

    if (sessionInputs.length === 0) {
        return mobileAttentionFromPriorOrEmpty(attentionPrior, normalizedScreenName, 'mobile replay artifacts could not be read');
    }

    return {
        ...buildMobileAttentionHeatmap(sessionInputs, fallbackDimensions, attentionPrior, normalizedScreenName),
        reason: null,
    };
}

async function loadAttentionHeatmap(
    projectId: string,
    screenName: string,
    timeRange?: string,
    platform?: string,
    appVersion?: string,
) {
    if (platform === 'mobile' || platform === 'ios' || platform === 'android') {
        return loadMobileAttentionHeatmap(projectId, screenName, timeRange, platform, appVersion);
    }
    return loadWebAttentionHeatmap(projectId, screenName, timeRange, platform, appVersion);
}

const STABILITY_OVERVIEW_FP_LIMIT = 50;
const STABILITY_OVERVIEW_DETAIL_LIMIT = 500;

function canOpenReplayFromSessionFields(session: {
    replayAvailable?: boolean | null;
    recordingDeleted?: boolean | null;
    isReplayExpired?: boolean | null;
}): boolean {
    return Boolean(session.replayAvailable) && !session.recordingDeleted && !session.isReplayExpired;
}

async function loadErrorsOverview(projectIds: string[], timeRange?: string, platform?: string) {
    if (projectIds.length === 0) {
        return {
            groups: [],
            summary: { issues: 0, events: 0, users: 0 },
            truncated: false,
        };
    }

    const conditions: SQL[] = [inArray(jsErrors.projectId, projectIds)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(jsErrors.timestamp, startedAfter));
    }
    const platformCondition = buildSessionPlatformCondition(platform);
    if (platformCondition) conditions.push(platformCondition);

    const fpExpr = sql<string>`coalesce(${jsErrors.fingerprint}, ${jsErrors.errorName} || ':' || ${jsErrors.message})`;

    // Query A: aggregate counts per fingerprint — no session join, returns ~50 rows
    const aggregateRows = await db
        .select({
            fp: fpExpr,
            errorName: jsErrors.errorName,
            message: jsErrors.message,
            eventCount: sql<number>`cast(count(*) as int)`,
            firstSeen: sql<Date>`min(${jsErrors.timestamp})`,
            lastOccurred: sql<Date>`max(${jsErrors.timestamp})`,
            totalEvents: sql<number>`cast(count(*) as int)`,
        })
        .from(jsErrors)
        .leftJoin(sessions, eq(jsErrors.sessionId, sessions.id))
        .where(and(...conditions))
        .groupBy(fpExpr, jsErrors.errorName, jsErrors.message)
        .orderBy(desc(sql`count(*)`))
        .limit(STABILITY_OVERVIEW_FP_LIMIT);

    if (aggregateRows.length === 0) {
        return { groups: [], summary: { issues: 0, events: 0, users: 0 }, truncated: false };
    }

    const topFps = aggregateRows.map((r) => r.fp);
    const totalEvents = aggregateRows.reduce((sum, r) => sum + Number(r.eventCount), 0);

    // Query B: detail rows for top fps only, with session join for user identity (~500 rows max)
    const detailRows = await db
        .select({
            fp: fpExpr,
            id: jsErrors.id,
            sessionId: jsErrors.sessionId,
            timestamp: jsErrors.timestamp,
            deviceModel: jsErrors.deviceModel,
            appVersion: jsErrors.appVersion,
            stack: jsErrors.stack,
            screenName: jsErrors.screenName,
            replayAvailable: sessions.replayAvailable,
            recordingDeleted: sessions.recordingDeleted,
            isReplayExpired: sessions.isReplayExpired,
            userDisplayId: sessions.userDisplayId,
            anonymousHash: sessions.anonymousHash,
            deviceId: sessions.deviceId,
        })
        .from(jsErrors)
        .leftJoin(sessions, eq(jsErrors.sessionId, sessions.id))
        .where(and(...conditions, inArray(fpExpr, topFps)))
        .orderBy(desc(jsErrors.timestamp))
        .limit(STABILITY_OVERVIEW_DETAIL_LIMIT);

    type ErrorDetail = {
        users: Set<string>;
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
            canOpenReplay: boolean;
        } | null;
        sampleTs: Date | null;
    };

    const detailMap = new Map<string, ErrorDetail>();
    const impactedUsers = new Set<string>();

    for (const row of detailRows) {
        const identity = buildIdentityKey({
            userDisplayId: row.userDisplayId,
            anonymousHash: row.anonymousHash,
            deviceId: row.deviceId,
            fallbackId: row.sessionId || row.id,
        });
        impactedUsers.add(identity);
        const canOpenReplay = canOpenReplayFromSessionFields(row);

        let detail = detailMap.get(row.fp);
        if (!detail) {
            detail = { users: new Set(), affectedDevices: {}, affectedVersions: {}, screens: new Set(), sampleError: null, sampleTs: null };
            detailMap.set(row.fp, detail);
        }

        detail.users.add(identity);
        const deviceLabel = row.deviceModel || 'Unknown';
        const versionLabel = row.appVersion || 'Unknown';
        detail.affectedDevices[deviceLabel] = (detail.affectedDevices[deviceLabel] || 0) + 1;
        detail.affectedVersions[versionLabel] = (detail.affectedVersions[versionLabel] || 0) + 1;
        if (row.screenName) detail.screens.add(row.screenName);

        // Prefer the newest replayable occurrence; fall back to the newest occurrence.
        if (!detail.sampleError || (!detail.sampleError.canOpenReplay && canOpenReplay)) {
            detail.sampleError = {
                id: row.id,
                sessionId: row.sessionId,
                timestamp: new Date(row.timestamp).toISOString(),
                deviceModel: row.deviceModel,
                appVersion: row.appVersion,
                stack: row.stack,
                screenName: row.screenName,
                canOpenReplay,
            };
            detail.sampleTs = new Date(row.timestamp);
        }
    }

    const groups = aggregateRows.map((agg) => {
        const detail = detailMap.get(agg.fp);
        return {
            fingerprint: agg.fp,
            errorName: agg.errorName,
            message: agg.message,
            count: Number(agg.eventCount),
            users: detail ? Array.from(detail.users) : [],
            firstSeen: new Date(agg.firstSeen).toISOString(),
            lastOccurred: new Date(agg.lastOccurred).toISOString(),
            affectedDevices: detail?.affectedDevices ?? {},
            affectedVersions: detail?.affectedVersions ?? {},
            screens: detail ? Array.from(detail.screens) : [],
            sampleError: detail?.sampleError ?? null,
        };
    }).sort((a, b) => new Date(b.lastOccurred).getTime() - new Date(a.lastOccurred).getTime());

    return {
        groups,
        summary: {
            issues: groups.length,
            events: totalEvents,
            users: impactedUsers.size,
        },
        truncated: aggregateRows.length >= STABILITY_OVERVIEW_FP_LIMIT,
    };
}

async function loadCrashesOverview(projectIds: string[], timeRange?: string, platform?: string) {
    if (projectIds.length === 0) {
        return {
            groups: [],
            summary: { issues: 0, events: 0, users: 0 },
            truncated: false,
        };
    }

    const conditions: SQL[] = [inArray(appCrashes.projectId, projectIds)];
    const startedAfter = buildStartedAfter(timeRange);
    if (startedAfter) {
        conditions.push(gte(appCrashes.timestamp, startedAfter));
    }
    const platformCondition = buildSessionPlatformCondition(platform);
    if (platformCondition) conditions.push(platformCondition);

    const crashFpExpr = sql<string>`coalesce(${appCrashes.fingerprint}, ${appCrashes.exceptionName} || ':' || coalesce(${appCrashes.reason}, ''))`;

    // Query A: aggregate counts per fingerprint — no session join, returns ~50 rows
    const aggregateRows = await db
        .select({
            fp: crashFpExpr,
            exceptionName: appCrashes.exceptionName,
            eventCount: sql<number>`cast(count(*) as int)`,
            firstSeen: sql<Date>`min(${appCrashes.timestamp})`,
            lastOccurred: sql<Date>`max(${appCrashes.timestamp})`,
        })
        .from(appCrashes)
        .leftJoin(sessions, eq(appCrashes.sessionId, sessions.id))
        .where(and(...conditions))
        .groupBy(crashFpExpr, appCrashes.exceptionName)
        .orderBy(desc(sql`count(*)`))
        .limit(STABILITY_OVERVIEW_FP_LIMIT);

    if (aggregateRows.length === 0) {
        return { groups: [], summary: { issues: 0, events: 0, users: 0 }, truncated: false };
    }

    const topFps = aggregateRows.map((r) => r.fp);
    const totalEvents = aggregateRows.reduce((sum, r) => sum + Number(r.eventCount), 0);

    // Query B: detail rows for top fps only, with session join for user identity (~500 rows max)
    const detailRows = await db
        .select({
            fp: crashFpExpr,
            id: appCrashes.id,
            sessionId: appCrashes.sessionId,
            timestamp: appCrashes.timestamp,
            deviceMetadata: appCrashes.deviceMetadata,
            replayAvailable: sessions.replayAvailable,
            recordingDeleted: sessions.recordingDeleted,
            isReplayExpired: sessions.isReplayExpired,
            userDisplayId: sessions.userDisplayId,
            anonymousHash: sessions.anonymousHash,
            deviceId: sessions.deviceId,
        })
        .from(appCrashes)
        .leftJoin(sessions, eq(appCrashes.sessionId, sessions.id))
        .where(and(...conditions, inArray(crashFpExpr, topFps)))
        .orderBy(desc(appCrashes.timestamp))
        .limit(STABILITY_OVERVIEW_DETAIL_LIMIT);

    type CrashDetail = {
        sampleCrashId: string;
        sampleSessionId: string;
        canOpenReplay: boolean;
        users: Set<string>;
        affectedDevices: Record<string, number>;
        affectedVersions: Record<string, number>;
        seenSample: boolean;
    };

    const detailMap = new Map<string, CrashDetail>();
    const impactedUsers = new Set<string>();

    for (const row of detailRows) {
        if (!row.sessionId) continue;
        const canOpenReplay = canOpenReplayFromSessionFields(row);
        const identity = buildIdentityKey({
            userDisplayId: row.userDisplayId,
            anonymousHash: row.anonymousHash,
            deviceId: row.deviceId,
            fallbackId: row.sessionId || row.id,
        });
        impactedUsers.add(identity);

        const deviceMetadata = (row.deviceMetadata || {}) as { model?: string; deviceModel?: string; appVersion?: string };
        const deviceModel = deviceMetadata.model || deviceMetadata.deviceModel || 'Unknown';
        const appVersion = deviceMetadata.appVersion || 'Unknown';

        let detail = detailMap.get(row.fp);
        if (!detail) {
            detail = { sampleCrashId: row.id, sampleSessionId: row.sessionId, canOpenReplay, users: new Set(), affectedDevices: {}, affectedVersions: {}, seenSample: false };
            detailMap.set(row.fp, detail);
        }

        // Prefer the newest replayable occurrence; fall back to the newest occurrence.
        if (!detail.seenSample || (!detail.canOpenReplay && canOpenReplay)) {
            detail.sampleCrashId = row.id;
            detail.sampleSessionId = row.sessionId;
            detail.canOpenReplay = canOpenReplay;
            detail.seenSample = true;
        }

        detail.users.add(identity);
        detail.affectedDevices[deviceModel] = (detail.affectedDevices[deviceModel] || 0) + 1;
        detail.affectedVersions[appVersion] = (detail.affectedVersions[appVersion] || 0) + 1;
    }

    const groups = aggregateRows.map((agg) => {
        const detail = detailMap.get(agg.fp);
        return {
            id: agg.fp,
            name: agg.exceptionName || 'Crash',
            sampleCrashId: detail?.sampleCrashId ?? '',
            sampleSessionId: detail?.sampleSessionId ?? '',
            canOpenReplay: detail?.canOpenReplay ?? false,
            count: Number(agg.eventCount),
            users: detail ? Array.from(detail.users) : [],
            firstSeen: new Date(agg.firstSeen).toISOString(),
            lastOccurred: new Date(agg.lastOccurred).toISOString(),
            affectedDevices: detail?.affectedDevices ?? {},
            affectedVersions: detail?.affectedVersions ?? {},
        };
    }).sort((a, b) => new Date(b.lastOccurred).getTime() - new Date(a.lastOccurred).getTime());

    return {
        groups,
        summary: {
            issues: groups.length,
            events: totalEvents,
            users: impactedUsers.size,
        },
        truncated: aggregateRows.length >= STABILITY_OVERVIEW_FP_LIMIT,
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
                failedSections: [],
            });
            return;
        }

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('general', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}` : undefined),
            routeName: 'general',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const observabilityMode = scope.normalizedPlatform ? 'full' : 'summary';
                const sections = await Promise.allSettled([
                    fetchOverviewSection(scope.cookieHeader, `/api/insights/trends?${scope.params.toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/growth-observability?${new URLSearchParams({ ...Object.fromEntries(scope.obsParams), mode: observabilityMode }).toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/observability-deep-metrics?${new URLSearchParams({ ...Object.fromEntries(scope.obsParams), mode: observabilityMode }).toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/user-engagement-trends?${new URLSearchParams({ ...Object.fromEntries(scope.obsParams), mode: observabilityMode }).toString()}`),
                    fetchOverviewSection(scope.cookieHeader, `/api/analytics/geo-summary?${scope.obsParams.toString()}`),
                    loadRetentionPreview(scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform),
                ]);

                const failedSections: string[] = [];
                const [
                    trendsResult,
                    overviewObsResult,
                    deepMetricsResult,
                    engagementResult,
                    geoResult,
                    retentionResult,
                ] = sections;

                const response = {
                    trends: trendsResult.status === 'fulfilled' ? trendsResult.value : { daily: [] },
                    overviewObs: overviewObsResult.status === 'fulfilled' ? overviewObsResult.value : null,
                    deepMetrics: deepMetricsResult.status === 'fulfilled' ? deepMetricsResult.value : null,
                    engagementTrends: engagementResult.status === 'fulfilled' ? engagementResult.value : null,
                    geoSummary: geoResult.status === 'fulfilled' ? geoResult.value : null,
                    retention: retentionResult.status === 'fulfilled' ? retentionResult.value : { rows: [] },
                    issues: [],
                    failedSections,
                };

                if (trendsResult.status !== 'fulfilled') failedSections.push('activity trends');
                if (overviewObsResult.status !== 'fulfilled') failedSections.push('observability');
                if (deepMetricsResult.status !== 'fulfilled') failedSections.push('deep metrics');
                if (engagementResult.status !== 'fulfilled') failedSections.push('engagement segments');
                if (geoResult.status !== 'fulfilled') failedSections.push('geographic activity');
                if (retentionResult.status !== 'fulfilled') failedSections.push('retention cohorts');

                for (const [sectionName, result] of [
                    ['trends', trendsResult],
                    ['overviewObs', overviewObsResult],
                    ['deepMetrics', deepMetricsResult],
                    ['engagementTrends', engagementResult],
                    ['geoSummary', geoResult],
                    ['retention', retentionResult],
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
    '/general/heavy',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req);
        const requestedSection = req.query.section === 'sessions' || req.query.section === 'topUsers'
            ? req.query.section
            : undefined;
        if (scope.scopedProjectIds.length === 0) {
            setOverviewCacheHeaders(res);
            res.json({ sessions: [], topUsers: [], failedSections: [] });
            return;
        }

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey(
                requestedSection ? `general:heavy:${requestedSection}` : 'general:heavy',
                scope.scopedProjectIds,
                scope.normalizedTimeRange,
                scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}` : undefined,
            ),
            routeName: requestedSection ? `general:heavy:${requestedSection}` : 'general:heavy',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const failedSections: string[] = [];
                const [sessionsResult, topUsersResult] = await Promise.allSettled([
                    requestedSection === 'topUsers'
                        ? Promise.resolve([])
                        : loadSessionPreview(scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform),
                    requestedSection === 'sessions'
                        ? Promise.resolve([])
                        : loadTopUsersPreview(scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform),
                ]);

                if (requestedSection !== 'topUsers' && sessionsResult.status !== 'fulfilled') {
                    failedSections.push('recommended sessions');
                    logger.warn({ err: sessionsResult.reason, projectId: scope.normalizedProjectId, timeRange: scope.normalizedTimeRange }, '[overview] heavy sessions load failed');
                }
                if (requestedSection !== 'sessions' && topUsersResult.status !== 'fulfilled') {
                    failedSections.push('top users');
                    logger.warn({ err: topUsersResult.reason, projectId: scope.normalizedProjectId, timeRange: scope.normalizedTimeRange }, '[overview] top users load failed');
                }

                return {
                    sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : [],
                    topUsers: topUsersResult.status === 'fulfilled' ? topUsersResult.value : [],
                    failedSections,
                };
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
            cacheKey: buildOverviewCacheKey('api', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}` : undefined),
            routeName: 'api',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const endpointParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (apiRange) endpointParams.set('timeRange', apiRange);
                if (scope.normalizedPlatform) endpointParams.set('platform', scope.normalizedPlatform);
                const regionParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (regionRange) regionParams.set('timeRange', regionRange);
                if (scope.normalizedPlatform) regionParams.set('platform', scope.normalizedPlatform);
                const trendsParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (trendsRange) trendsParams.set('timeRange', trendsRange);
                if (scope.normalizedPlatform) trendsParams.set('platform', scope.normalizedPlatform);

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
        const platformFilter = typeof req.query.platform === 'string' && req.query.platform !== 'all'
            ? req.query.platform
            : undefined;

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('devices', scope.scopedProjectIds, scope.normalizedTimeRange, platformFilter ? `${platformFilter}:v2` : 'v2'),
            routeName: 'devices',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const deviceParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (deviceRange) deviceParams.set('timeRange', deviceRange);
                if (platformFilter) deviceParams.set('platform', platformFilter);

                const deepMetricsParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, mode: platformFilter ? 'full' : 'summary' });
                if (insightsRange) deepMetricsParams.set('timeRange', insightsRange);
                if (platformFilter) deepMetricsParams.set('platform', platformFilter);

                const trendsParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, timeRange: trendsRange });
                if (platformFilter) trendsParams.set('platform', platformFilter);

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
            cacheKey: buildOverviewCacheKey('geo', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}` : undefined),
            routeName: 'geo',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const params = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (range) params.set('timeRange', range);
                if (scope.normalizedPlatform) params.set('platform', scope.normalizedPlatform);

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
            cacheKey: buildOverviewCacheKey('journeys', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}` : undefined),
            routeName: 'journeys',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const journeyParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, mode: 'summary' });
                if (journeyRange) journeyParams.set('timeRange', journeyRange);
                if (scope.normalizedPlatform) journeyParams.set('platform', scope.normalizedPlatform);

                const engagementParams = new URLSearchParams({ projectId: scope.normalizedProjectId! });
                if (journeyRange) engagementParams.set('timeRange', journeyRange);
                if (scope.normalizedPlatform) engagementParams.set('platform', scope.normalizedPlatform);

                const trendsParams = new URLSearchParams({ projectId: scope.normalizedProjectId!, timeRange: trendsRange });
                if (scope.normalizedPlatform) trendsParams.set('platform', scope.normalizedPlatform);

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
            cacheKey: buildOverviewCacheKey('heatmaps', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}:v9` : 'v9'),
            routeName: 'heatmaps',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadHeatmapSummary(scope.cookieHeader, scope.normalizedProjectId!, scope.normalizedTimeRange, scope.normalizedPlatform),
        });
    }),
);

router.get(
    '/heatmaps/attention',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const screenName = typeof req.query.screenName === 'string' ? req.query.screenName : undefined;
        if (!screenName) {
            throw ApiError.badRequest('screenName is required');
        }

        const normalizedScreenName = normalizeHeatmapScreenName(screenName);
        if (!normalizedScreenName) {
            throw ApiError.badRequest('screenName is invalid');
        }

        const rawAppVersion = typeof req.query.appVersion === 'string' ? req.query.appVersion.trim() : '';
        const appVersion = rawAppVersion && rawAppVersion !== 'all' ? rawAppVersion : undefined;

        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey(
                `heatmaps:attention:${normalizedScreenName}`,
                scope.scopedProjectIds,
                scope.normalizedTimeRange,
                `${scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}:` : ''}${appVersion ? `ver:${appVersion}:` : ''}v6`,
            ),
            routeName: 'heatmaps-attention',
            res,
            ttlSeconds: WEB_ATTENTION_CACHE_TTL_SECONDS,
            logContext: {
                projectId: scope.normalizedProjectId,
                screenName: normalizedScreenName,
                timeRange: scope.normalizedTimeRange,
                appVersion,
            },
            build: async () => loadAttentionHeatmap(
                scope.normalizedProjectId!,
                normalizedScreenName,
                scope.normalizedTimeRange,
                scope.normalizedPlatform,
                appVersion,
            ),
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
            cacheKey: buildOverviewCacheKey(`heatmaps:screen:${screenName}`, scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}:v6` : 'v6'),
            routeName: 'heatmaps-screen',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                screenName,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadHeatmapScreenDetail(scope.cookieHeader, scope.normalizedProjectId!, screenName, scope.normalizedTimeRange, scope.normalizedPlatform),
        });
    }),
);

router.get(
    '/errors',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('errors', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}:v2` : 'v2'),
            routeName: 'errors',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadErrorsOverview(scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform),
        });
    }),
);

router.get(
    '/crashes',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('crashes', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}:v2` : 'v2'),
            routeName: 'crashes',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => loadCrashesOverview(scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform),
        });
    }),
);

router.get(
    '/anrs',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        await respondWithOverviewCache({
            cacheKey: buildOverviewCacheKey('anrs', scope.scopedProjectIds, scope.normalizedTimeRange, scope.normalizedPlatform ? `platform:${scope.normalizedPlatform}:v2` : 'v2'),
            routeName: 'anrs',
            res,
            logContext: {
                projectId: scope.normalizedProjectId,
                timeRange: scope.normalizedTimeRange,
            },
            build: async () => {
                const params = new URLSearchParams({ timeRange: scope.normalizedTimeRange || '30d', limit: '100' });
                if (scope.normalizedPlatform) params.set('platform', scope.normalizedPlatform);
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

router.get(
    '/api-error-spikes',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const scope = await resolveOverviewScope(req, { requireProjectId: true });
        const projectId = scope.normalizedProjectId;
        if (!projectId) throw ApiError.badRequest('projectId required');

        const days = boundedTimeRangeToDays(scope.normalizedTimeRange || '') ?? 30;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Recent error_spike alerts for this project
        const recentSpikes = await dbRead
            .select({ id: alertHistory.id, sentAt: alertHistory.sentAt })
            .from(alertHistory)
            .where(
                and(
                    eq(alertHistory.projectId, projectId),
                    eq(alertHistory.alertType, 'error_spike'),
                    gte(alertHistory.sentAt, cutoff),
                )
            )
            .orderBy(desc(alertHistory.sentAt))
            .limit(20);

        if (recentSpikes.length === 0) {
            return res.json({ spikes: [] });
        }

        const spikes = await Promise.all(recentSpikes.map(async (spike) => {
            const spikeTime = spike.sentAt;
            const windowStart = new Date(spikeTime.getTime() - 90 * 60 * 1000);
            const windowEnd   = new Date(spikeTime.getTime() + 15 * 60 * 1000);

            // Per-5-minute bucketed error rate for the sparkline trend
            const trendRows = await dbRead.execute(sql`
                SELECT
                    date_trunc('hour', s.started_at) + INTERVAL '5 min' * FLOOR(EXTRACT(MINUTE FROM s.started_at) / 5) AS bucket,
                    sum(sm.api_error_count)::int  AS error_count,
                    sum(sm.api_total_count)::int  AS total_count,
                    CASE WHEN sum(sm.api_total_count) > 0
                         THEN round((sum(sm.api_error_count)::numeric / sum(sm.api_total_count)) * 100, 2)
                         ELSE 0
                    END AS error_rate
                FROM sessions s
                JOIN session_metrics sm ON sm.session_id = s.id
                WHERE s.project_id = ${projectId}
                  AND s.started_at BETWEEN ${windowStart} AND ${windowEnd}
                GROUP BY 1
                ORDER BY 1
            `);

            const trend = (trendRows.rows as Array<{ bucket: Date; error_count: number; total_count: number; error_rate: number }>).map(r => ({
                bucket: r.bucket instanceof Date ? r.bucket.toISOString() : String(r.bucket),
                errorCount: Number(r.error_count),
                totalCount: Number(r.total_count),
                errorRate:  Number(r.error_rate),
            }));

            // Current window (last 15 min before spike) vs baseline (prev 60 min)
            const currentBuckets = trend.filter(t => new Date(t.bucket) >= new Date(spikeTime.getTime() - 15 * 60 * 1000));
            const baselineBuckets = trend.filter(t => new Date(t.bucket) < new Date(spikeTime.getTime() - 15 * 60 * 1000));
            const avgRate = (buckets: typeof trend) => {
                const withData = buckets.filter(b => b.totalCount > 0);
                return withData.length ? withData.reduce((s, b) => s + b.errorRate, 0) / withData.length : 0;
            };
            const currentRate  = avgRate(currentBuckets);
            const previousRate = avgRate(baselineBuckets);
            const percentIncrease = previousRate > 0 ? ((currentRate - previousRate) / previousRate) * 100 : 100;
            const affectedSessions = trend.reduce((s, b) => s + b.totalCount, 0);

            // Top failing endpoints from ClickHouse (best-effort, skip if not configured)
            let topEndpoints: Array<{ method: string; endpoint: string; errorCount: number }> = [];
            if (isClickHouseReadsEnabled()) {
                try {
                    const ch = getClickHouseClient();
                    const chResult = await ch.query({
                        query: `
                            SELECT method, endpoint, countIf(is_error = 1) AS error_count
                            FROM rejourney.api_endpoint_request_events
                            WHERE project_id = {projectId: String}
                              AND event_time BETWEEN {start: DateTime64(3)} AND {end: DateTime64(3)}
                            GROUP BY method, endpoint
                            HAVING error_count > 0
                            ORDER BY error_count DESC
                            LIMIT 5
                        `,
                        query_params: {
                            projectId,
                            start: windowStart.toISOString().replace('T', ' ').replace('Z', ''),
                            end:   windowEnd.toISOString().replace('T', ' ').replace('Z', ''),
                        },
                        format: 'JSONEachRow',
                    });
                    const rows = await chResult.json<{ method: string; endpoint: string; error_count: string }>();
                    topEndpoints = rows.map(r => ({
                        method:     r.method,
                        endpoint:   r.endpoint,
                        errorCount: Number(r.error_count),
                    }));
                } catch {
                    // ClickHouse unavailable — omit endpoints, still return spike
                }
            }

            return {
                id:               spike.id,
                detectedAt:       spikeTime.toISOString(),
                currentRate:      Math.round(currentRate * 10) / 10,
                previousRate:     Math.round(previousRate * 10) / 10,
                percentIncrease:  Math.round(percentIncrease),
                affectedSessions,
                trend,
                topEndpoints,
            };
        }));

        return res.json({ spikes });
    }),
);

export default router;
