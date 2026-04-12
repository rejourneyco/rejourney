/**
 * Sessions Routes
 * 
 * Session listing, details, and dashboard stats
 */

import { Buffer } from 'node:buffer';

import { Router } from 'express';
import { eq, and, or, inArray, gte, lt, isNull, desc, asc, sql, getTableColumns } from 'drizzle-orm';

import { db, sessions, sessionMetrics, recordingArtifacts, projects, teamMembers, crashes, anrs, errors } from '../db/client.js';
import { gunzipSync } from 'zlib';

import {
    getSignedDownloadUrl,
    getSignedDownloadUrlForProject,
    downloadFromS3ForArtifact,
    getObjectSizeBytesForArtifact,
} from '../db/s3.js';
import {
    getScreenshotFrameCount,
    getSessionScreenshotFrames,
    triggerSessionScreenshotFramePrewarm,
    type ScreenshotFrameUrlMode,
} from '../services/screenshotFrames.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter, networkRateLimiter } from '../middleware/rateLimit.js';
import { sessionIdParamSchema, networkGroupBySchema } from '../validation/sessions.js';
import { generateAnonymousName } from '../utils/anonymousName.js';
import { logger } from '../logger.js';
import { getRedis } from '../db/redis.js';
import {
    getSessionArchiveIssueFilterCondition,
    normalizeSessionArchiveIssueFilter,
    sessionArchiveIssueFilterUsesMetrics,
} from '../services/sessionArchiveFilters.js';
import { hasSuccessfulRecording } from '../services/replayAvailability.js';
import {
    deriveSessionPresentationState,
    loadSessionWorkAggregate,
    type SessionPresentationState,
} from '../services/sessionPresentationState.js';
import { durationSecondsForDisplay } from '../services/sessionTiming.js';
import {
    archiveKeysetMatchesRequest,
    archiveListSortNeedsMetricsJoin,
    archiveListSortSqlExpr,
    buildArchiveListKeysetCondition,
    buildArchiveTextSearchCondition,
    encodeArchiveListCursor,
    extractArchiveSortKeyFromRow,
    normalizeArchiveListSortDir,
    normalizeArchiveListSortKey,
    parseArchiveListCursor,
} from '../services/sessionArchiveListSort.js';
import { hasNewerSessionForSameVisitor } from '../services/sessionTimingQuery.js';
import { resolveAnrStackTrace } from '../services/anrStack.js';

const router = Router();

/** Archive list: omit `events` / `metadata` JSONB — they are large and unused for the table (detail API loads full rows). */
const sessionsArchiveListColumns = (() => {
    const { events: _events, metadata: _metadata, ...cols } = getTableColumns(sessions);
    return cols;
})();

/** Correlated subselect: last frame time from replay artifacts (not ingest wall clock). */
const archiveListLatestReplayEndMsSql = sql<number | null>`(
    select max(${recordingArtifacts.endTime})
    from ${recordingArtifacts}
    where ${eq(recordingArtifacts.sessionId, sessions.id)}
      and ${inArray(recordingArtifacts.kind, ['screenshots', 'hierarchy'])}
)`.as('latestReplayArtifactEndMs');

/** `device_id` → `anonymous_hash` → `user_display_id` — matches how the dashboard distinguishes visitors. */
const archiveVisitorIdentitySql = sql<string>`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId})`;

/** True when a strictly later session exists for the same project + visitor (archive list LIVE badge). */
const archiveListHasNewerVisitorSessionSql = sql<boolean>`(
    EXISTS (
        SELECT 1 FROM sessions s2
        WHERE s2.project_id = ${sessions.projectId}
          AND coalesce(s2.device_id, s2.anonymous_hash, s2.user_display_id) IS NOT NULL
          AND coalesce(s2.device_id, s2.anonymous_hash, s2.user_display_id) = ${archiveVisitorIdentitySql}
          AND (
            s2.started_at > ${sessions.startedAt}
            OR (s2.started_at = ${sessions.startedAt} AND s2.id > ${sessions.id})
          )
    )
)`.as('hasNewerSessionOnVisitor');

type ArchiveListSessionForFirstCheck = Pick<
    typeof sessions.$inferSelect,
    'id' | 'projectId' | 'deviceId' | 'anonymousHash' | 'userDisplayId'
>;

/**
 * Session ids that are the chronologically first row for each (project, visitor) among identities present on this page.
 */
async function resolveArchiveFirstSessionIds(rows: Array<{ session: ArchiveListSessionForFirstCheck }>): Promise<Set<string>> {
    const firstIds = new Set<string>();
    const byProject = new Map<string, Set<string>>();

    for (const { session: s } of rows) {
        const identity = s.deviceId || s.anonymousHash || s.userDisplayId;
        if (!identity) continue;
        if (!byProject.has(s.projectId)) byProject.set(s.projectId, new Set());
        byProject.get(s.projectId)!.add(identity);
    }

    for (const [projectId, identitySet] of byProject) {
        const identities = [...identitySet];
        if (identities.length === 0) continue;

        const rowList = await db
            .select({
                id: sessions.id,
                ident: archiveVisitorIdentitySql,
                startedAt: sessions.startedAt,
            })
            .from(sessions)
            .where(
                and(
                    eq(sessions.projectId, projectId),
                    or(...identities.map((ident) => sql`${archiveVisitorIdentitySql} = ${ident}`))
                )
            )
            .orderBy(archiveVisitorIdentitySql, sessions.startedAt, sessions.id);

        const seenIdent = new Set<string>();
        for (const row of rowList) {
            const ident = row.ident;
            if (!ident || seenIdent.has(ident)) continue;
            seenIdent.add(ident);
            firstIds.add(row.id);
        }
    }

    return firstIds;
}

/**
 * Get time range filter for queries
 */
function getTimeRangeFilter(timeRange?: string): Date | undefined {
    if (!timeRange || timeRange === 'all') return undefined;

    const now = Date.now();
    const ranges: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        '90d': 90 * 24 * 60 * 60 * 1000,
        '1y': 365 * 24 * 60 * 60 * 1000,
    };

    const ms = ranges[timeRange];
    return ms ? new Date(now - ms) : undefined;
}

function buildSessionArchiveBaseConditions(
    filters: {
        timeRange?: string;
        projectId?: string;
        platform?: string;
        status?: string;
        hasRecording?: string;
        metaKey?: string;
        metaValue?: string;
        eventName?: string;
        date?: string;
        eventCountOp?: string;
        eventCountValue?: string;
        eventPropKey?: string;
        eventPropValue?: string;
        issueFilter?: string;
        /** Case-insensitive substring match across id, user display, device, model, anonymous fields */
        q?: string;
    },
    accessibleProjectIds: string[]
) {
    const {
        timeRange,
        projectId,
        platform,
        status,
        hasRecording,
        metaKey,
        metaValue,
        eventName,
        date,
        eventCountOp,
        eventCountValue,
        eventPropKey,
        eventPropValue,
        issueFilter,
        q,
    } = filters;

    const startedAfter = getTimeRangeFilter(timeRange);
    const baseConditions = [
        projectId ? eq(sessions.projectId, projectId) : inArray(sessions.projectId, accessibleProjectIds),
    ];

    if (date) {
        const startOfDay = new Date(`${date}T00:00:00.000Z`);
        const endOfDay = new Date(`${date}T23:59:59.999Z`);
        baseConditions.push(gte(sessions.startedAt, startOfDay));
        baseConditions.push(lt(sessions.startedAt, endOfDay));
    } else if (startedAfter) {
        baseConditions.push(gte(sessions.startedAt, startedAfter));
    }

    if (platform) baseConditions.push(eq(sessions.platform, platform));
    if (status) baseConditions.push(eq(sessions.status, status));

    const recordingFilter = hasRecording;
    if (recordingFilter === 'true') {
        baseConditions.push(eq(sessions.replayAvailable, true));
    }

    if (metaKey) {
        if (metaValue !== undefined && metaValue !== '') {
            let parsedValue: any = metaValue;
            if (metaValue === 'true') parsedValue = true;
            else if (metaValue === 'false') parsedValue = false;
            else if (!isNaN(Number(metaValue))) parsedValue = Number(metaValue);

            baseConditions.push(sql`${sessions.metadata} @> ${JSON.stringify({ [metaKey]: parsedValue })}::jsonb`);
        } else {
            baseConditions.push(sql`${sessions.metadata} ? ${metaKey}`);
        }
    }

    if (eventName) {
        if (eventPropKey && eventPropValue !== undefined && eventPropValue !== '') {
            let parsedPropValue: any = eventPropValue;
            if (eventPropValue === 'true') parsedPropValue = true;
            else if (eventPropValue === 'false') parsedPropValue = false;
            else if (!isNaN(Number(eventPropValue))) parsedPropValue = Number(eventPropValue);
            baseConditions.push(sql`${sessions.events} @> ${JSON.stringify([{ name: eventName, properties: { [eventPropKey]: parsedPropValue } }])}::jsonb`);
        } else if (eventPropKey) {
            baseConditions.push(sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${sessions.events}) AS elem
                WHERE elem->>'name' = ${eventName}
                AND elem->'properties' ? ${eventPropKey}
            )`);
        } else {
            baseConditions.push(sql`${sessions.events} @> ${JSON.stringify([{ name: eventName }])}::jsonb`);
        }
    } else if (eventPropKey) {
        if (eventPropValue !== undefined && eventPropValue !== '') {
            let parsedPropValue: any = eventPropValue;
            if (eventPropValue === 'true') parsedPropValue = true;
            else if (eventPropValue === 'false') parsedPropValue = false;
            else if (!isNaN(Number(eventPropValue))) parsedPropValue = Number(eventPropValue);
            baseConditions.push(sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${sessions.events}) AS elem
                WHERE elem->'properties' @> ${JSON.stringify({ [eventPropKey]: parsedPropValue })}::jsonb
            )`);
        } else {
            baseConditions.push(sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${sessions.events}) AS elem
                WHERE elem->'properties' ? ${eventPropKey}
            )`);
        }
    }

    const hasEventCountFilter = eventCountOp && eventCountValue !== undefined && eventCountValue !== '';
    const parsedEventCountValue = hasEventCountFilter ? parseInt(eventCountValue) : NaN;
    const eventCountCondition = (() => {
        if (!hasEventCountFilter || isNaN(parsedEventCountValue)) return null;
        switch (eventCountOp) {
            case 'eq': return sql`${sessionMetrics.customEventCount} = ${parsedEventCountValue}`;
            case 'gt': return sql`${sessionMetrics.customEventCount} > ${parsedEventCountValue}`;
            case 'lt': return sql`${sessionMetrics.customEventCount} < ${parsedEventCountValue}`;
            case 'gte': return sql`${sessionMetrics.customEventCount} >= ${parsedEventCountValue}`;
            case 'lte': return sql`${sessionMetrics.customEventCount} <= ${parsedEventCountValue}`;
            default: return null;
        }
    })();
    if (eventCountCondition) baseConditions.push(eventCountCondition);

    const normalizedIssueFilter = normalizeSessionArchiveIssueFilter(issueFilter);
    const issueFilterCondition = getSessionArchiveIssueFilterCondition(normalizedIssueFilter);
    if (issueFilterCondition) baseConditions.push(issueFilterCondition);

    const textSearch = typeof q === 'string' ? buildArchiveTextSearchCondition(q) : null;
    if (textSearch) baseConditions.push(textSearch);

    return {
        baseConditions,
        needsMetricsJoin: Boolean(
            eventCountCondition
            || sessionArchiveIssueFilterUsesMetrics(normalizedIssueFilter)
        ),
    };
}

const DETAIL_FETCH_CONCURRENCY = Number(process.env.RJ_REPLAY_DETAIL_FETCH_CONCURRENCY ?? 6);
const frameModeFromEnv = (process.env.RJ_REPLAY_FRAME_URL_MODE || 'proxy').toLowerCase();
const DEFAULT_FRAME_URL_MODE: ScreenshotFrameUrlMode = frameModeFromEnv === 'signed' ? 'signed' : 'proxy';
const SESSION_CORE_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_CORE_CACHE_TTL_SECONDS ?? 300);
const SESSION_DETAIL_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_DETAIL_CACHE_TTL_SECONDS ?? 300);
const FRAME_AUTH_CACHE_TTL_SECONDS = Number(process.env.RJ_FRAME_AUTH_CACHE_TTL_SECONDS ?? 60);

function resolveFrameUrlMode(raw: unknown): ScreenshotFrameUrlMode {
    if (typeof raw !== 'string') return DEFAULT_FRAME_URL_MODE;
    const mode = raw.toLowerCase();
    if (mode === 'signed' || mode === 'proxy' || mode === 'none') return mode;
    return DEFAULT_FRAME_URL_MODE;
}

function buildSessionDetailCacheKey(kind: 'core' | 'timeline' | 'hierarchy', sessionId: string): string {
    if (kind === 'core') return `session_core:${sessionId}`;
    return `session_${kind}:${sessionId}`;
}

async function readCachedSessionDetail(kind: 'core' | 'timeline' | 'hierarchy', sessionId: string): Promise<string | null> {
    try {
        return await getRedis().get(buildSessionDetailCacheKey(kind, sessionId));
    } catch (err) {
        logger.warn({ err, kind, sessionId }, '[sessions] Failed to read session detail cache');
        return null;
    }
}

async function writeCachedSessionDetail(kind: 'core' | 'timeline' | 'hierarchy', sessionId: string, payload: unknown): Promise<void> {
    try {
        const ttl = kind === 'core' ? SESSION_CORE_CACHE_TTL_SECONDS : SESSION_DETAIL_CACHE_TTL_SECONDS;
        await getRedis().setex(buildSessionDetailCacheKey(kind, sessionId), ttl, JSON.stringify(payload));
    } catch (err) {
        logger.warn({ err, kind, sessionId }, '[sessions] Failed to write session detail cache');
    }
}

async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];
    const output: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Math.max(1, Math.min(concurrency, items.length));

    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor++;
            output[index] = await mapper(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));
    return output;
}

async function getAuthorizedSession(userId: string, sessionId: string) {
    const [sessionResult] = await db
        .select({
            session: sessions,
            metrics: sessionMetrics,
            teamId: projects.teamId,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        throw ApiError.notFound('Session not found');
    }

    const [membership] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, sessionResult.teamId), eq(teamMembers.userId, userId)))
        .limit(1);

    if (!membership) {
        throw ApiError.forbidden('No access to this session');
    }

    return sessionResult;
}

async function getAuthorizedSessionForFrames(userId: string, sessionId: string) {
    const cacheKey = `session_frame_auth:${sessionId}:${userId}`;
    try {
        const redis = getRedis();
        const cachedProjectId = await redis.get(cacheKey);
        if (cachedProjectId) {
            const [session] = await db
                .select({
                    session: sessions,
                })
                .from(sessions)
                .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, cachedProjectId)))
                .limit(1);

            if (session) {
                return {
                    session: session.session,
                    metrics: null,
                    teamId: null,
                };
            }
        }
    } catch (err) {
        logger.warn({ err, sessionId, userId }, '[sessions] Frame auth cache lookup failed, falling back to DB');
    }

    const sessionResult = await getAuthorizedSession(userId, sessionId);

    try {
        const redis = getRedis();
        await redis.setex(
            `session_frame_auth:${sessionId}:${userId}`,
            FRAME_AUTH_CACHE_TTL_SECONDS,
            sessionResult.session.projectId
        );
    } catch (err) {
        logger.warn({ err, sessionId, userId }, '[sessions] Failed to cache frame auth projectId');
    }

    return sessionResult;
}

async function getReadyArtifacts(sessionId: string) {
    return db
        .select()
        .from(recordingArtifacts)
        .where(and(eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.status, 'ready')));
}

function buildMetricsPayload(metrics: any) {
    const screensVisited: string[] = Array.isArray(metrics?.screensVisited) ? metrics.screensVisited : [];
    return metrics
        ? {
            totalEvents: metrics.totalEvents,
            touchCount: metrics.touchCount,
            scrollCount: metrics.scrollCount,
            gestureCount: metrics.gestureCount,
            inputCount: metrics.inputCount,
            navigationCount: screensVisited.length,
            errorCount: metrics.errorCount,
            rageTapCount: metrics.rageTapCount,
            deadTapCount: metrics.deadTapCount ?? 0,
            apiSuccessCount: metrics.apiSuccessCount,
            apiErrorCount: metrics.apiErrorCount,
            apiTotalCount: metrics.apiTotalCount,
            screensVisited,
            uniqueScreensCount: new Set(screensVisited).size,
            interactionScore: metrics.interactionScore,
            explorationScore: metrics.explorationScore,
            uxScore: metrics.uxScore,
            customEventCount: metrics.customEventCount ?? 0,
            crashCount: metrics.crashCount || 0,
        }
        : null;
}

function buildSessionPresentationPayload(presentationState: SessionPresentationState) {
    return {
        effectiveStatus: presentationState.effectiveStatus,
        isLiveIngest: presentationState.isLiveIngest,
        isBackgroundProcessing: presentationState.isBackgroundProcessing,
        canOpenReplay: presentationState.canOpenReplay,
    };
}

function buildSessionBasePayload(
    session: any,
    metrics: any,
    screenshotFrames: Array<{ timestamp: number; url: string; index: number }>,
    readyScreenshotArtifacts = false,
    presentationState?: SessionPresentationState,
    latestReplayEndMs: number | null = null
) {
    const hasRecording = screenshotFrames.length > 0;
    const playbackMode = hasRecording ? 'screenshots' : 'none';
    const successfulRecording = hasSuccessfulRecording(session, metrics, readyScreenshotArtifacts);
    const durationSeconds = durationSecondsForDisplay({
        ...session,
        latestReplayEndMs,
        replayAvailable: session.replayAvailable,
    });
    const sessionPresentationState = presentationState ?? deriveSessionPresentationState({
        status: session.status,
        replayAvailable: session.replayAvailable,
        recordingDeleted: session.recordingDeleted,
        isReplayExpired: session.isReplayExpired,
        lastIngestActivityAt: session.lastIngestActivityAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        hasPendingWork: false,
        hasPendingReplayWork: false,
    });

    return {
        id: session.id,
        projectId: session.projectId,
        userId: session.userDisplayId || null,
        anonymousId: session.anonymousDisplayId || session.anonymousHash,
        anonymousDisplayName: session.deviceId && !session.userDisplayId ? generateAnonymousName(session.deviceId) : null,
        platform: session.platform,
        appVersion: session.appVersion,
        hasRecording,
        playbackMode,
        deviceInfo: {
            model: session.deviceModel,
            os: session.platform,
            systemVersion: session.osVersion,
            appVersion: session.appVersion,
        },
        osVersion: session.osVersion,
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
        startTime: session.startedAt.getTime(),
        endTime: session.endedAt?.getTime(),
        duration: durationSeconds,
        backgroundTime: session.backgroundTimeSeconds ?? 0,
        playableDuration: durationSeconds,
        status: session.status,
        ...buildSessionPresentationPayload(sessionPresentationState),
        // Session-level JSONB metadata and custom events stored in the sessions table
        metadata: session.metadata,
        events: [] as any[],
        networkRequests: [] as any[],
        batches: [] as any[],
        artifactUrls: {
            events: null as string | null,
            eventsBatches: [] as string[],
        },
        screenshotFrames,
        hierarchySnapshots: [] as Array<{ timestamp: number; screenName: string | null; rootElement: any }>,
        metrics: buildMetricsPayload(metrics),
        crashes: [] as any[],
        anrs: [] as any[],
        retentionTier: session.retentionTier,
        retentionDays: session.retentionDays,
        recordingDeleted: session.recordingDeleted,
        recordingDeletedAt: session.recordingDeletedAt?.toISOString() ?? null,
        isReplayExpired: session.isReplayExpired,
        hasSuccessfulRecording: successfulRecording,
    };
}

async function loadScreenshotReplayBootstrap(
    session: any,
    screenshotArtifactCount: number,
    frameUrlMode: ScreenshotFrameUrlMode
) {
    const hasRecording = Boolean(session.replayAvailable) && !session.isReplayExpired && !session.recordingDeleted;
    if (!hasRecording) {
        return {
            hasRecording: false,
            playbackMode: 'none' as const,
            screenshotFrames: [] as Array<{ timestamp: number; url: string; index: number }>,
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: 0,
            totalSegments: 0,
        };
    }

    const screenshotFrameCount = await getScreenshotFrameCount(session.id);
    const framesResult = await getSessionScreenshotFrames(session.id, {
        urlMode: frameUrlMode,
        buildOnCacheMiss: false,
    });

    if (!framesResult) {
        triggerSessionScreenshotFramePrewarm(session.id);
        return {
            hasRecording: true,
            playbackMode: 'screenshots' as const,
            screenshotFrames: [] as Array<{ timestamp: number; url: string; index: number }>,
            screenshotFramesStatus: 'preparing' as const,
            screenshotFrameCount,
            processedSegments: 0,
            totalSegments: screenshotArtifactCount,
        };
    }

    if (framesResult.status === 'building') {
        triggerSessionScreenshotFramePrewarm(session.id);
    }

    return {
        hasRecording: true,
        playbackMode: 'screenshots' as const,
        screenshotFrames: framesResult.frames,
        screenshotFramesStatus: framesResult.status === 'ready' ? 'ready' as const : 'preparing' as const,
        screenshotFrameCount: Math.max(screenshotFrameCount, framesResult.totalFrames),
        processedSegments: framesResult.processedSegments,
        totalSegments: framesResult.totalSegments,
    };
}

async function computeSessionStats(
    session: any,
    metrics: any,
    artifactsList: any[],
    includeMissingHead: boolean
) {
    const bytesByKind: Record<string, number> = {};
    let totalBytes = 0;
    const addBytes = (kind: string, bytes: number) => {
        bytesByKind[kind] = (bytesByKind[kind] || 0) + bytes;
        totalBytes += bytes;
    };

    const artifactsMissingSize: any[] = [];
    for (const artifact of artifactsList) {
        if (typeof artifact.sizeBytes === 'number' && Number.isFinite(artifact.sizeBytes)) {
            addBytes(artifact.kind, artifact.sizeBytes);
        } else {
            artifactsMissingSize.push(artifact);
        }
    }

    if (includeMissingHead && artifactsMissingSize.length > 0) {
        const headSizes = await mapWithConcurrency(
            artifactsMissingSize,
            DETAIL_FETCH_CONCURRENCY,
            async (artifact) => {
                const size = await getObjectSizeBytesForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                return {
                    kind: artifact.kind,
                    size,
                };
            }
        );

        for (const head of headSizes) {
            if (typeof head.size === 'number' && Number.isFinite(head.size)) {
                addBytes(head.kind, head.size);
            }
        }
    }

    return {
        duration: String(session.durationSeconds ?? 0),
        durationMinutes: String(((session.durationSeconds ?? 0) / 60).toFixed(2)),
        eventCount: metrics?.totalEvents ?? 0,
        totalSizeKB: String(totalBytes / 1024),
        eventsSizeKB: String((bytesByKind.events || 0) / 1024),
        screenshotSizeKB: String((bytesByKind.screenshots || 0) / 1024),
        hierarchySizeKB: String((bytesByKind.hierarchy || 0) / 1024),
        networkSizeKB: String((bytesByKind.network || 0) / 1024),
        networkStats: {
            total: metrics?.apiTotalCount ?? 0,
            successful: metrics?.apiSuccessCount ?? 0,
            failed: metrics?.apiErrorCount ?? 0,
            avgDuration: metrics?.apiAvgResponseMs ?? 0,
        },
    };
}

function normalizeEventsForTimeline(
    allEvents: any[],
    sessionStartMs: number,
    sessionEndMs: number
) {
    const coerceToEpochMs = (raw: unknown, fallbackMs: number): number => {
        const n = typeof raw === 'string' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
        if (!Number.isFinite(n) || n <= 0) return fallbackMs;

        if (n >= 10_000_000_000) return Math.round(n);

        const candidates = [
            Math.round(n * 1000),
            Math.round(sessionStartMs + n),
            Math.round(sessionStartMs + n * 1000),
        ];

        const minOk = sessionStartMs - 60_000;
        const maxOk = sessionEndMs + 60_000;
        for (const c of candidates) {
            if (c >= minOk && c <= maxOk) return c;
        }

        return Math.round(n * 1000);
    };

    const normalizedEvents = allEvents
        .map((e, idx) => {
            const rawType = (e?.type ?? e?.name ?? '').toString();
            const type = rawType.length > 0 ? rawType.toLowerCase() : 'unknown';
            const rawTs = e?.timestamp ?? e?.ts ?? e?.time;
            const timestamp = coerceToEpochMs(rawTs, sessionStartMs);
            const payload = e?.payload ?? e?.payloadInline ?? e?.details ?? e?.properties ?? null;
            const properties = payload && typeof payload === 'object' ? payload : (e?.details ?? e?.properties ?? null);

            return {
                ...e,
                id: e?.id || `evt_${idx}_${Math.random().toString(16).slice(2)}`,
                type,
                timestamp,
                payload,
                properties,
                gestureType: e?.gestureType || properties?.gestureType || payload?.gestureType || null,
                targetLabel: e?.targetLabel || properties?.targetLabel || payload?.targetLabel || null,
                touches: e?.touches || properties?.touches || payload?.touches || null,
                frustrationKind: e?.frustrationKind || properties?.frustrationKind || payload?.frustrationKind || null,
                screen:
                    e?.screen ||
                    properties?.screen ||
                    payload?.screen ||
                    properties?.screenName ||
                    payload?.screenName ||
                    e?.screenName ||
                    null,
            };
        })
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return { normalizedEvents, coerceToEpochMs };
}

function getFaultTextValue(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase().slice(0, 240);
}

function buildFaultDedupeSignature(event: any): string {
    const type = (event?.type ?? '').toString().toLowerCase();
    const timestamp = Number.isFinite(event?.timestamp)
        ? Math.round(Number(event.timestamp) / 250) * 250
        : 0;
    const name = getFaultTextValue(
        event?.name ??
        event?.properties?.errorName ??
        event?.properties?.exceptionName
    );
    const message = getFaultTextValue(
        event?.message ??
        event?.reason ??
        event?.properties?.message ??
        event?.properties?.reason
    );
    const stackHead = getFaultTextValue(
        ((event?.stack ??
            event?.properties?.stack ??
            event?.properties?.stackTrace ??
            event?.properties?.threadState ??
            '') as string)
            .split('\n')[0]
    );
    return `${type}|${timestamp}|${name}|${message}|${stackHead}`;
}

function mergeEventsWithFaults(normalizedEvents: any[], faultEvents: any[]) {
    const seen = new Set<string>();
    for (const event of normalizedEvents) {
        seen.add(buildFaultDedupeSignature(event));
    }

    const merged = [...normalizedEvents];
    for (const faultEvent of faultEvents) {
        const signature = buildFaultDedupeSignature(faultEvent);
        if (seen.has(signature)) continue;
        seen.add(signature);
        merged.push(faultEvent);
    }

    return merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function buildSessionFaultEvents(
    sessionCrashes: any[],
    sessionAnrs: any[],
    sessionErrors: any[],
    sessionStartMs: number,
    coerceToEpochMs: (raw: unknown, fallbackMs: number) => number
) {
    const crashEvents = sessionCrashes.map((crashRow) => {
        const timestamp = coerceToEpochMs(crashRow.timestamp?.getTime?.() ?? crashRow.timestamp, sessionStartMs);
        const properties: any = {
            crashId: crashRow.id,
            exceptionName: crashRow.exceptionName,
            reason: crashRow.reason,
            stackTrace: crashRow.stackTrace,
            status: crashRow.status,
            deviceMetadata: crashRow.deviceMetadata ?? null,
            consoleMarker: 'RJ_CRASH',
        };
        const primaryMessage = [crashRow.exceptionName || 'Crash', crashRow.reason || '']
            .filter(Boolean)
            .join(': ');
        return {
            id: `crash_evt_${crashRow.id}`,
            type: 'crash',
            timestamp,
            name: crashRow.exceptionName || 'Crash',
            message: primaryMessage || 'Crash detected',
            level: 'error',
            stack: crashRow.stackTrace || undefined,
            properties,
            payload: properties,
        };
    });

    const anrEvents = sessionAnrs.map((anrRow) => {
        const timestamp = coerceToEpochMs(anrRow.timestamp?.getTime?.() ?? anrRow.timestamp, sessionStartMs);
        const stackTrace = resolveAnrStackTrace({
            threadState: anrRow.threadState,
            deviceMetadata: anrRow.deviceMetadata,
        });
        const properties: any = {
            anrId: anrRow.id,
            durationMs: anrRow.durationMs,
            threadState: stackTrace ?? anrRow.threadState,
            stackTrace: stackTrace ?? undefined,
            status: anrRow.status,
            consoleMarker: 'RJ_ANR',
        };
        const detail = Number.isFinite(anrRow.durationMs)
            ? `ANR detected (${anrRow.durationMs} ms blocked)`
            : 'ANR detected';
        return {
            id: `anr_evt_${anrRow.id}`,
            type: 'anr',
            timestamp,
            name: 'ANR',
            message: detail,
            level: 'error',
            stack: stackTrace || undefined,
            durationMs: anrRow.durationMs,
            threadState: stackTrace ?? anrRow.threadState,
            properties,
            payload: properties,
        };
    });

    const errorEvents = sessionErrors.map((errorRow) => {
        const timestamp = coerceToEpochMs(errorRow.timestamp?.getTime?.() ?? errorRow.timestamp, sessionStartMs);
        const properties: any = {
            errorId: errorRow.id,
            errorType: errorRow.errorType,
            errorName: errorRow.errorName,
            message: errorRow.message,
            stack: errorRow.stack,
            screenName: errorRow.screenName,
            status: errorRow.status,
            consoleMarker: 'RJ_ERROR',
        };
        const name = errorRow.errorName || 'Error';
        const message = errorRow.message || 'Runtime error';
        return {
            id: `error_evt_${errorRow.id}`,
            type: 'error',
            timestamp,
            name,
            message,
            level: 'error',
            stack: errorRow.stack || undefined,
            screen: errorRow.screenName || null,
            properties,
            payload: properties,
        };
    });

    return [...crashEvents, ...anrEvents, ...errorEvents];
}

function mapCrashRowsForPayload(sessionCrashes: any[]) {
    return sessionCrashes.map((crashRow) => ({
        id: crashRow.id,
        timestamp: crashRow.timestamp.getTime(),
        exceptionName: crashRow.exceptionName,
        reason: crashRow.reason,
        stackTrace: crashRow.stackTrace,
        status: crashRow.status,
        deviceMetadata: crashRow.deviceMetadata,
    }));
}

function mapAnrRowsForPayload(sessionAnrs: any[]) {
    return sessionAnrs.map((anrRow) => ({
        id: anrRow.id,
        timestamp: anrRow.timestamp.getTime(),
        durationMs: anrRow.durationMs,
        threadState: resolveAnrStackTrace({
            threadState: anrRow.threadState,
            deviceMetadata: anrRow.deviceMetadata,
        }),
        status: anrRow.status,
    }));
}

function maxReplayEndMsFromArtifacts(
    artifacts: Array<{ kind: string; endTime?: number | null; startTime?: number | null }>
): number | null {
    let max: number | null = null;
    for (const a of artifacts) {
        if (a.kind !== 'screenshots' && a.kind !== 'hierarchy') continue;
        const t = a.endTime ?? a.startTime ?? null;
        if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
            max = max === null ? t : Math.max(max, t);
        }
    }
    return max;
}

async function loadTimelinePayload(session: any, artifactsList: any[]) {
    const eventsArtifacts = artifactsList.filter((a) => a.kind === 'events');
    const networkArtifacts = artifactsList.filter((a) => a.kind === 'network');

    const [sessionCrashes, sessionAnrs, sessionErrors, parsedEventsBatches, parsedNetworkBatches] = await Promise.all([
        db.select().from(crashes).where(eq(crashes.sessionId, session.id)).orderBy(desc(crashes.timestamp)),
        db.select().from(anrs).where(eq(anrs.sessionId, session.id)).orderBy(desc(anrs.timestamp)),
        db.select().from(errors).where(eq(errors.sessionId, session.id)).orderBy(desc(errors.timestamp)),
        mapWithConcurrency(eventsArtifacts, DETAIL_FETCH_CONCURRENCY, async (artifact) => {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) return [] as any[];
                const parsed = JSON.parse(data.toString());
                if (Array.isArray(parsed)) return parsed;
                if (Array.isArray(parsed?.events)) return parsed.events;
                return [] as any[];
            } catch {
                return [] as any[];
            }
        }),
        mapWithConcurrency(networkArtifacts, DETAIL_FETCH_CONCURRENCY, async (artifact) => {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) return [] as any[];
                const parsed = JSON.parse(data.toString());
                if (Array.isArray(parsed)) return parsed;
                if (Array.isArray(parsed?.networkRequests)) return parsed.networkRequests;
                return [] as any[];
            } catch {
                return [] as any[];
            }
        }),
    ]);

    // Core Telemetry events from artifacts
    const artifactEvents = parsedEventsBatches.flat();

    // Custom app-level events persisted on the session record (sessions.events JSONB).
    // These typically come from Rejourney.logEvent() and are not always included in
    // the raw telemetry artifacts, so we merge them here for the timeline.
    const sessionEventsJson: any = (session as any).events;
    const sessionEvents: any[] = Array.isArray(sessionEventsJson) ? sessionEventsJson : [];

    // Avoid double-including custom events that already exist in the artifact payloads.
    const seenCustomKeys = new Set<string>();
    for (const e of artifactEvents) {
        const type = (e?.type || '').toString().toLowerCase();
        if (type === 'custom') {
            const key = `${e.name ?? ''}|${e.timestamp ?? ''}`;
            seenCustomKeys.add(key);
        }
    }

    const extraSessionEvents: any[] = [];
    for (const e of sessionEvents) {
        const type = (e?.type || '').toString().toLowerCase();
        if (type !== 'custom') continue;
        const key = `${e.name ?? ''}|${e.timestamp ?? ''}`;
        if (seenCustomKeys.has(key)) continue;
        extraSessionEvents.push(e);
    }

    const allEvents = [...artifactEvents, ...extraSessionEvents];
    const allNetwork = parsedNetworkBatches.flat();

    const sessionStartMs = session.startedAt.getTime();
    const timelineReplayEndMs = maxReplayEndMsFromArtifacts(artifactsList);
    const sessionEndMs =
        session.endedAt?.getTime()
        ?? (timelineReplayEndMs != null && timelineReplayEndMs > 0 ? timelineReplayEndMs : undefined)
        ?? session.lastIngestActivityAt?.getTime()
        ?? (sessionStartMs + ((session.durationSeconds ?? 0) * 1000));

    const { normalizedEvents, coerceToEpochMs } = normalizeEventsForTimeline(allEvents, sessionStartMs, sessionEndMs);
    const faultEvents = buildSessionFaultEvents(
        sessionCrashes,
        sessionAnrs,
        sessionErrors,
        sessionStartMs,
        coerceToEpochMs
    );
    const mergedEvents = mergeEventsWithFaults(normalizedEvents, faultEvents);

    const networkRequests = [
        ...allNetwork.map((n) => ({ ...n, timestamp: n.timestamp || Date.now() })),
        ...mergedEvents.filter((e) => e.type === 'network_request' || e.type === 'api_request'),
    ]
        .map((e) => {
            const payload = e.payload || e.payloadInline || e;
            const rawUrl = payload.url || e.url || '';
            const safeUrl = (() => {
                if (!rawUrl) return null;
                try {
                    return new URL(rawUrl);
                } catch {
                    try {
                        return new URL(rawUrl, 'http://localhost');
                    } catch {
                        return null;
                    }
                }
            })();
            const requestBodySize =
                payload.requestBodySize ??
                payload.requestSize ??
                e.requestBodySize ??
                e.requestSize ??
                0;
            const responseBodySize =
                payload.responseBodySize ??
                payload.responseSize ??
                e.responseBodySize ??
                e.responseSize ??
                0;
            return {
                id: e.id || `net_${Math.random()}`,
                url: rawUrl,
                method: payload.method || e.method || 'GET',
                statusCode: payload.statusCode || e.statusCode,
                duration: payload.duration || e.duration || 0,
                success: (payload.success ?? e.success) ?? ((payload.statusCode || e.statusCode) < 400),
                timestamp: (e.timestamp || payload.timestamp) || 0,
                host: payload.urlHost || payload.host || safeUrl?.hostname || '',
                path: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                urlHost: payload.urlHost || payload.host || safeUrl?.hostname || '',
                urlPath: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                requestBodySize,
                responseBodySize,
                requestSize: requestBodySize,
                responseSize: responseBodySize,
                error: payload.error || e.error,
            };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

    return {
        events: mergedEvents,
        networkRequests,
        crashes: mapCrashRowsForPayload(sessionCrashes),
        anrs: mapAnrRowsForPayload(sessionAnrs),
    };
}

async function loadHierarchyPayload(session: any, artifactsList: any[]) {
    const hierarchyArtifacts = artifactsList
        .filter((a) => a.kind === 'hierarchy')
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const snapshots = await mapWithConcurrency(
        hierarchyArtifacts,
        DETAIL_FETCH_CONCURRENCY,
        async (artifact) => {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) return null;
                const parsed = JSON.parse(data.toString());
                const rootElement = parsed.rootElement || parsed.root || parsed;
                return {
                    timestamp: artifact.timestamp || parsed.timestamp || 0,
                    screenName: parsed.screenName || null,
                    rootElement,
                };
            } catch {
                return null;
            }
        }
    );

    return snapshots
        .filter((snapshot): snapshot is { timestamp: number; screenName: string | null; rootElement: any } => Boolean(snapshot))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/**
 * Export sessions as CSV
 * GET /api/sessions/export
 */
router.get(
    '/export',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const {
            timeRange,
            projectId,
            platform,
            status,
            hasRecording,
            metaKey,
            metaValue,
            eventName,
            date,
            eventCountOp,
            eventCountValue,
            eventPropKey,
            eventPropValue,
            issueFilter,
            q,
            sort: sortRaw,
            sortDir: sortDirRaw,
        } = req.query as any;

        const sortKey = normalizeArchiveListSortKey(sortRaw);
        const sortDir = normalizeArchiveListSortDir(sortDirRaw);
        const exportSortExpr = archiveListSortSqlExpr(sortKey);
        const exportOrderPrimary = sortDir === 'desc' ? desc(exportSortExpr) : asc(exportSortExpr);
        const exportOrderSecondary = sortDir === 'desc' ? desc(sessions.id) : asc(sessions.id);

        // Get user's accessible project IDs
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.status(404).send('No accessible projects');
            return;
        }

        const accessibleProjectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const accessibleProjectIds = accessibleProjectsList.map((p) => p.id);

        if (accessibleProjectIds.length === 0) {
            res.status(404).send('No accessible projects');
            return;
        }

        const { baseConditions } = buildSessionArchiveBaseConditions(
            {
                timeRange,
                projectId,
                platform,
                status,
                hasRecording,
                metaKey,
                metaValue,
                eventName,
                date,
                eventCountOp,
                eventCountValue,
                eventPropKey,
                eventPropValue,
                issueFilter,
                q: typeof q === 'string' ? q : undefined,
            },
            accessibleProjectIds
        );

        // Get sessions with metrics - NO LIMIT for export
        const sessionsList = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...baseConditions))
            .orderBy(exportOrderPrimary, exportOrderSecondary);

        // Set Headers for CSV Download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="sessions_export_${new Date().toISOString().split('T')[0]}.csv"`);

        // CSV Header
        res.write('Session ID,User ID,Anonymous ID,Device Model,OS,App Version,Duration (sec),Screens Visited,Network Type,API Success,API Error,Rage Taps,Crashes,Errors,UX Score,Date,Time\n');

        // CSV Rows
        for (const { session: s, metrics: m } of sessionsList) {
            const userId = s.userDisplayId || '';
            const anonymousId = s.anonymousHash || '';
            const displayName = s.deviceId && !s.userDisplayId ? generateAnonymousName(s.deviceId) : '';
            const userLabel = userId || displayName || 'Anonymous';

            const row = [
                s.id,
                userLabel, // Combined User/Anon label to match UI broadly, or just IDs
                anonymousId,
                s.deviceModel || 'Unknown',
                s.platform || '',
                s.appVersion || '',
                s.durationSeconds || 0,
                (m?.screensVisited?.length || 0),
                m?.networkType || '',
                m?.apiSuccessCount || 0,
                m?.apiErrorCount || 0,
                m?.rageTapCount || 0,
                m?.deadTapCount || 0,
                m?.crashCount || 0,
                m?.errorCount || 0,
                m?.uxScore || 0,
                s.startedAt.toISOString().split('T')[0], // Date
                s.startedAt.toISOString().split('T')[1].split('.')[0], // Time
            ].map(val => `"${String(val).replace(/"/g, '""')}"`) // Escape quotes
                .join(',');

            res.write(row + '\n');
        }

        res.end();
    })
);

/**
 * Get sessions list
 * GET /api/sessions
 */
router.get(
    '/',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const {
            timeRange,
            projectId,
            platform,
            status,
            limit = 50,
            offset = 0,
            cursor,
            hasRecording,
            metaKey,
            metaValue,
            eventName,
            date,
            eventCountOp,
            eventCountValue,
            eventPropKey,
            eventPropValue,
            issueFilter,
            q,
            sort: sortRaw,
            sortDir: sortDirRaw,
            includeTotal: includeTotalRaw,
            countOnly: countOnlyRaw,
        } = req.query as any;
        const parsedLimit = Math.min(parseInt(limit) || 50, 300); // Max 300 per request
        const includeTotal = includeTotalRaw !== 'false' && includeTotalRaw !== '0';
        const countOnly = countOnlyRaw === 'true' || countOnlyRaw === '1';
        const sortKey = normalizeArchiveListSortKey(sortRaw);
        const sortDir = normalizeArchiveListSortDir(sortDirRaw);

        // Get user's accessible project IDs
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.json({ sessions: [], nextCursor: null, hasMore: false, totalCount: 0 });
            return;
        }

        const accessibleProjectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const accessibleProjectIds = accessibleProjectsList.map((p) => p.id);

        if (accessibleProjectIds.length === 0) {
            res.json({ sessions: [], nextCursor: null, hasMore: false, totalCount: 0 });
            return;
        }

        const { baseConditions, needsMetricsJoin } = buildSessionArchiveBaseConditions(
            {
                timeRange,
                projectId,
                platform,
                status,
                hasRecording,
                metaKey,
                metaValue,
                eventName,
                date,
                eventCountOp,
                eventCountValue,
                eventPropKey,
                eventPropValue,
                issueFilter,
                q: typeof q === 'string' ? q : undefined,
            },
            accessibleProjectIds
        );

        const needsMetricsJoinEffective = needsMetricsJoin || archiveListSortNeedsMetricsJoin(sortKey);
        const sortExpr = archiveListSortSqlExpr(sortKey);
        const orderPrimary = sortDir === 'desc' ? desc(sortExpr) : asc(sortExpr);
        const orderSecondary = sortDir === 'desc' ? desc(sessions.id) : asc(sessions.id);

        const dataConditions = [...baseConditions];
        if (cursor) {
            const parsedCursor = parseArchiveListCursor(cursor);
            if (parsedCursor && archiveKeysetMatchesRequest(parsedCursor, sortKey, sortDir)) {
                const keysetSql = buildArchiveListKeysetCondition(sortKey, sortDir, parsedCursor);
                if (keysetSql) dataConditions.push(keysetSql);
            }
        }

        const runCountQuery = () =>
            needsMetricsJoinEffective
                ? db
                      .select({ count: sql<number>`count(*)::int` })
                      .from(sessions)
                      .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
                      .where(and(...baseConditions))
                : db
                      .select({ count: sql<number>`count(*)::int` })
                      .from(sessions)
                      .where(and(...baseConditions));

        if (countOnly) {
            const countResult = await runCountQuery();
            res.json({
                sessions: [],
                nextCursor: null,
                hasMore: false,
                totalCount: countResult[0]?.count ?? 0,
            });
            return;
        }

        // List payload: one correlated EXISTS for visitor supersession (stops false LIVE on old rows). Omit events/metadata JSONB.
        const dataQuery = db
            .select({
                session: { ...sessionsArchiveListColumns },
                metrics: sessionMetrics,
                latestReplayArtifactEndMs: archiveListLatestReplayEndMsSql,
                hasNewerSessionOnVisitor: archiveListHasNewerVisitorSessionSql,
                archiveSortKey: sortExpr.as('archive_sort_key'),
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...dataConditions))
            .orderBy(orderPrimary, orderSecondary)
            .limit(parsedLimit + 1)
            .offset(cursor ? 0 : parseInt(offset) || 0);

        const [sessionsList, countRows] = includeTotal
            ? await Promise.all([dataQuery, runCountQuery()])
            : [await dataQuery, null];

        const totalCount = includeTotal ? (countRows![0]?.count ?? 0) : null;

        // Determine if there are more results
        const hasMore = sessionsList.length > parsedLimit;
        const resultSessions = hasMore ? sessionsList.slice(0, parsedLimit) : sessionsList;
        const lastListRow = resultSessions[resultSessions.length - 1];
        let nextCursor: string | null = null;
        if (hasMore && lastListRow) {
            const { kt, kn } = extractArchiveSortKeyFromRow(sortKey, {
                archiveSortKey: lastListRow.archiveSortKey,
                session: lastListRow.session,
            });
            nextCursor = encodeArchiveListCursor({
                sortKey,
                sortDir,
                id: lastListRow.session.id,
                kt,
                kn,
            });
        }

        const firstSessionIds = await resolveArchiveFirstSessionIds(resultSessions);

        // Transform to API format
        const sessionsData = resultSessions.map(
            ({ session: s, metrics: m, latestReplayArtifactEndMs, hasNewerSessionOnVisitor }) => {
            const durationSec = durationSecondsForDisplay({
                ...s,
                latestReplayEndMs: latestReplayArtifactEndMs,
                replayAvailable: s.replayAvailable,
            });
            const successfulRecording = hasSuccessfulRecording(s, m, false);
            /**
             * Archive list intentionally skips per-row artifact/job EXISTS (perf). Do not infer
             * pending work from `status === 'processing'` — that forced hasPendingReplayWork=true,
             * blocked shouldFinalize in deriveSessionPresentationState, and kept rows "LIVE" /
             * background-processing in the UI long after ingest went quiet.
             */
            const presentationState = deriveSessionPresentationState({
                status: s.status,
                replayAvailable: s.replayAvailable,
                recordingDeleted: s.recordingDeleted,
                isReplayExpired: s.isReplayExpired,
                lastIngestActivityAt: s.lastIngestActivityAt,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                hasPendingWork: false,
                hasPendingReplayWork: false,
                supersededByNewerVisitorSession: Boolean(hasNewerSessionOnVisitor),
            });
            return {
                id: s.id,
                projectId: s.projectId,
                userId: s.userDisplayId || null,
                anonymousId: s.anonymousDisplayId || s.anonymousHash,
                deviceId: s.deviceId,
                anonymousDisplayName: s.deviceId && !s.userDisplayId ? generateAnonymousName(s.deviceId) : null,
                platform: s.platform,
                appVersion: s.appVersion,
                deviceModel: s.deviceModel,
                osVersion: s.osVersion,
                startedAt: s.startedAt.toISOString(),
                endedAt: s.endedAt?.toISOString(),
                durationSeconds: durationSec,
                backgroundTimeSeconds: s.backgroundTimeSeconds ?? 0,
                // playableDuration is now same as durationSeconds (background already excluded)
                playableDuration: durationSec,
                status: s.status,
                ...buildSessionPresentationPayload(presentationState),
                isFirstSession: firstSessionIds.has(s.id),
                // Metrics
                touchCount: m?.touchCount ?? 0,
                scrollCount: m?.scrollCount ?? 0,
                gestureCount: m?.gestureCount ?? 0,
                inputCount: m?.inputCount ?? 0,
                errorCount: m?.errorCount ?? 0,
                rageTapCount: m?.rageTapCount ?? 0,
                deadTapCount: m?.deadTapCount ?? 0,
                apiSuccessCount: m?.apiSuccessCount ?? 0,
                apiErrorCount: m?.apiErrorCount ?? 0,
                apiTotalCount: m?.apiTotalCount ?? 0,
                apiAvgResponseMs: m?.apiAvgResponseMs ?? 0,
                interactionScore: m?.interactionScore ?? 0,
                explorationScore: m?.explorationScore ?? 0,
                uxScore: m?.uxScore ?? 0,
                screensVisited: m?.screensVisited ?? [],
                customEventCount: m?.customEventCount ?? 0,
                crashCount: m?.crashCount ?? 0,
                anrCount: m?.anrCount ?? 0,
                appStartupTimeMs: m?.appStartupTimeMs ?? null,
                // Network
                networkType: m?.networkType ?? null,
                cellularGeneration: m?.cellularGeneration ?? null,
                // Geo
                geoLocation: s.geoCity
                    ? {
                        city: s.geoCity,
                        region: s.geoRegion,
                        country: s.geoCountry,
                        countryCode: s.geoCountryCode,
                        latitude: s.geoLatitude,
                        longitude: s.geoLongitude,
                        timezone: s.geoTimezone,
                    }
                    : null,
                // Retention
                retentionTier: s.retentionTier,
                retentionDays: s.retentionDays,
                recordingDeleted: s.recordingDeleted,
                recordingDeletedAt: s.recordingDeletedAt?.toISOString() ?? null,
                isReplayExpired: s.isReplayExpired,
                hasSuccessfulRecording: successfulRecording,
                // Stats
                stats: {
                    duration: String(durationSec),
                    durationMinutes: String((durationSec / 60).toFixed(2)),
                    eventCount: m?.totalEvents ?? 0,
                    screenshotSegmentCount: m?.screenshotSegmentCount ?? 0,
                    totalSizeKB: String(((m?.eventsSizeBytes ?? 0) + (m?.screenshotTotalBytes ?? 0)) / 1024),
                    eventsSizeKB: String((m?.eventsSizeBytes ?? 0) / 1024),
                    screenshotSizeKB: String((m?.screenshotTotalBytes ?? 0) / 1024),
                    networkStats: {
                        total: m?.apiTotalCount ?? 0,
                        successful: m?.apiSuccessCount ?? 0,
                        failed: m?.apiErrorCount ?? 0,
                        avgDuration: m?.apiAvgResponseMs ?? 0,
                    },
                },
            };
        });

        res.json({
            sessions: sessionsData,
            nextCursor,
            hasMore,
            totalCount,
        });
    })
);

/**
 * Get session details
 * GET /api/session/:id
 */
router.get(
    '/:id',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        // Get session with project info
        const [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
                teamId: projects.teamId,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .where(eq(sessions.id, req.params.id))
            .limit(1);

        if (!sessionResult) {
            throw ApiError.notFound('Session not found');
        }

        const session = sessionResult.session;
        const metrics = sessionResult.metrics;
        const [aggregate, supersededByNewerVisitorSession] = await Promise.all([
            loadSessionWorkAggregate(session.id),
            hasNewerSessionForSameVisitor({
                projectId: session.projectId,
                sessionId: session.id,
                startedAt: session.startedAt,
                deviceId: session.deviceId,
                anonymousHash: session.anonymousHash,
                userDisplayId: session.userDisplayId,
            }),
        ]);
        const presentationState = deriveSessionPresentationState({
            status: session.status,
            replayAvailable: session.replayAvailable,
            recordingDeleted: session.recordingDeleted,
            isReplayExpired: session.isReplayExpired,
            lastIngestActivityAt: session.lastIngestActivityAt,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            hasPendingWork: aggregate.hasPendingWork,
            hasPendingReplayWork: aggregate.hasPendingReplayWork,
            supersededByNewerVisitorSession,
        });

        // Verify user has access
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, sessionResult.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('No access to this session');
        }

        // Get crashes for this session
        const sessionCrashes = await db
            .select()
            .from(crashes)
            .where(eq(crashes.sessionId, session.id))
            .orderBy(desc(crashes.timestamp));

        // Get ANRs for this session (used for timeline markers + player overlay)
        const sessionAnrs = await db
            .select()
            .from(anrs)
            .where(eq(anrs.sessionId, session.id))
            .orderBy(desc(anrs.timestamp));

        const sessionErrors = await db
            .select()
            .from(errors)
            .where(eq(errors.sessionId, session.id))
            .orderBy(desc(errors.timestamp));

        // Get recording artifacts
        const artifactsList = await db
            .select()
            .from(recordingArtifacts)
            .where(and(eq(recordingArtifacts.sessionId, session.id), eq(recordingArtifacts.status, 'ready')));

        // Get signed URLs for artifacts if not expired
        const eventsUrls: string[] = [];
        const allEvents: any[] = [];
        const allNetwork: any[] = [];

        const hierarchySnapshots: { timestamp: number; screenName: string | null; rootElement: any }[] = [];

        // Session data artifacts are loaded when present. Retention can purge all
        // artifact rows later while keeping the session row and metrics intact.
        const eventsArtifacts = artifactsList.filter((a) => a.kind === 'events');
        const hierarchyArtifacts = artifactsList.filter((a) => a.kind === 'hierarchy');
        const networkArtifacts = artifactsList.filter((a) => a.kind === 'network');
        // Screenshot artifacts only exist if recording is still retained.
        const screenshotArtifacts = (!session.isReplayExpired && !session.recordingDeleted)
            ? artifactsList.filter((a) => a.kind === 'screenshots')
            : [];

        // Compute total storage used in S3 for this session's artifacts.
        // Prefer `recording_artifacts.size_bytes` (populated during ingest), and fall back to S3 HEAD.
        const bytesByKind: Record<string, number> = {};
        let totalBytes = 0;
        const addBytes = (kind: string, bytes: number) => {
            bytesByKind[kind] = (bytesByKind[kind] || 0) + bytes;
            totalBytes += bytes;
        };

        const artifactsMissingSize = artifactsList.filter((a) => a.sizeBytes == null);
        for (const a of artifactsList) {
            if (typeof a.sizeBytes === 'number' && Number.isFinite(a.sizeBytes)) {
                addBytes(a.kind, a.sizeBytes);
            }
        }

        // Only HEAD objects for the ones missing size_bytes (avoid downloading payloads).
        // Keep it sequential to avoid hammering MinIO in dev.
        for (const a of artifactsMissingSize) {
            const size = await getObjectSizeBytesForArtifact(session.projectId, a.s3ObjectKey, a.endpointId);
            if (typeof size === 'number' && Number.isFinite(size)) {
                addBytes(a.kind, size);
            }
        }

        // Download and parse all event artifacts that remain after retention.
        for (const artifact of eventsArtifacts) {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (data) {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.events) {
                        allEvents.push(...parsed.events);
                    } else if (Array.isArray(parsed)) {
                        allEvents.push(...parsed);
                    }
                }
                const url = artifact.endpointId
                    ? await getSignedDownloadUrl(artifact.endpointId, artifact.s3ObjectKey)
                    : await getSignedDownloadUrlForProject(session.projectId, artifact.s3ObjectKey);
                if (url) eventsUrls.push(url);
            } catch (err) {
                logger.warn(
                    {
                        err,
                        event: 'sessions.signed_url_or_events_artifact_failed',
                        sessionId: session.id,
                        projectId: session.projectId,
                        artifactKind: artifact.kind,
                        s3ObjectKeySuffix: artifact.s3ObjectKey?.slice(-64),
                    },
                    'sessions.signed_url_or_events_artifact_failed',
                );
            }
        }

        // Download and parse all network artifacts that remain after retention.
        for (const artifact of networkArtifacts) {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (data) {
                    const parsed = JSON.parse(data.toString());
                    if (Array.isArray(parsed)) {
                        allNetwork.push(...parsed);
                    } else if (parsed.networkRequests) { // handled just in case
                        allNetwork.push(...parsed.networkRequests);
                    }
                }
            } catch (err) {
                logger.warn(
                    {
                        err,
                        event: 'sessions.network_artifact_download_failed',
                        sessionId: session.id,
                        projectId: session.projectId,
                        artifactKind: artifact.kind,
                    },
                    'sessions.network_artifact_download_failed',
                );
            }
        }

        // Extract screenshot frames for image-based playback (iOS sessions)
        // Screenshots are the only supported visual replay mode.
        let screenshotFrames: Array<{ timestamp: number; url: string; index: number }> = [];

        logger.info({
            sessionId: session.id,
            totalScreenshotArtifacts: screenshotArtifacts.length,
            screenshotArtifactsCount: screenshotArtifacts.length,
            isReplayExpired: session.isReplayExpired,
            recordingDeleted: session.recordingDeleted,
        }, '[sessions] Screenshot extraction debug');

        if (screenshotArtifacts.length > 0 && !session.isReplayExpired && !session.recordingDeleted) {
            // Extract frames from screenshot archives
            logger.info({ sessionId: session.id }, '[sessions] Attempting to extract screenshot frames');
            const framesResult = await getSessionScreenshotFrames(session.id, { urlMode: 'none' });
            logger.info({
                sessionId: session.id,
                framesResult: framesResult ? { totalFrames: framesResult.totalFrames, cached: framesResult.cached } : null,
            }, '[sessions] Screenshot frames extraction result');
            if (framesResult && framesResult.frames.length > 0) {
                // Use proxy URLs instead of direct S3 URLs to avoid CSP issues
                // Frontend will fetch via the archive-backed frame extractor route.
                screenshotFrames = framesResult.frames.map(f => ({
                    timestamp: f.timestamp,
                    // Use relative URL that will be resolved by the API base URL
                    url: `/api/session/frame/${session.id}/${f.timestamp}`,
                    index: f.index,
                }));
            }
        }

        // Download and embed hierarchy snapshots that remain after retention.
        hierarchyArtifacts.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        for (const artifact of hierarchyArtifacts) {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (data) {
                    const parsed = (() => {
                        // Check for GZip compression (magic bytes: 0x1f 0x8b) or file extension
                        const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
                            artifact.s3ObjectKey.endsWith('.gz');

                        if (isGzipped) {
                            try {
                                const decompressed = gunzipSync(data);
                                return JSON.parse(decompressed.toString());
                            } catch {
                                // Fallback to raw parsing if decompression fails (might be mislabeled)
                                return JSON.parse(data.toString());
                            }
                        }
                        return JSON.parse(data.toString());
                    })();

                    // Support both 'rootElement' (expected) and 'root' (Android SDK legacy)
                    const rootElement = parsed.rootElement || parsed.root || parsed;
                    hierarchySnapshots.push({
                        timestamp: artifact.timestamp || parsed.timestamp || 0,
                        screenName: parsed.screenName || null,
                        rootElement,
                    });
                }
            } catch {
                // Silently skip failed artifacts - they may be corrupted or missing
            }
        }

        allEvents.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
        allNetwork.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

        const eventsUrl = eventsUrls.length > 0 ? eventsUrls[0] : null;

        const sessionStartMs = session.startedAt.getTime();
        const replayEndMs = aggregate.latestReplayArtifactEndMs;
        const sessionEndMs =
            session.endedAt?.getTime()
            ?? (replayEndMs != null && replayEndMs > 0 ? replayEndMs : undefined)
            ?? session.lastIngestActivityAt?.getTime()
            ?? (sessionStartMs + ((session.durationSeconds ?? 0) * 1000));

        const coerceToEpochMs = (raw: unknown, fallbackMs: number): number => {
            const n = typeof raw === 'string' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
            if (!Number.isFinite(n) || n <= 0) return fallbackMs;

            // Already epoch millis
            if (n >= 10_000_000_000) return Math.round(n);

            // Candidates for smaller values: epoch seconds, relative ms, relative seconds
            const candidates = [
                Math.round(n * 1000),
                Math.round(sessionStartMs + n),
                Math.round(sessionStartMs + n * 1000),
            ];

            const minOk = sessionStartMs - 60_000;
            const maxOk = sessionEndMs + 60_000;
            for (const c of candidates) {
                if (c >= minOk && c <= maxOk) return c;
            }

            // Fall back to epoch seconds heuristic
            return Math.round(n * 1000);
        };

        const normalizeEvent = (e: any, idx: number) => {
            const rawType = (e?.type ?? e?.name ?? '').toString();
            const type = rawType.length > 0 ? rawType.toLowerCase() : 'unknown';

            const rawTs = e?.timestamp ?? e?.ts ?? e?.time;
            const timestamp = coerceToEpochMs(rawTs, sessionStartMs);

            // SDK payloads vary: `payload`, `payloadInline`, `details`, or `properties`.
            const payload = e?.payload ?? e?.payloadInline ?? e?.details ?? e?.properties ?? null;
            const properties = payload && typeof payload === 'object' ? payload : (e?.details ?? e?.properties ?? null);

            return {
                // Spread all original event fields first, then override with normalized values
                ...e,
                id: e?.id || `evt_${idx}_${Math.random().toString(16).slice(2)}`,
                type,
                timestamp,
                payload,
                properties,
                // Include gestureType for timeline color coding
                gestureType: e?.gestureType || properties?.gestureType || payload?.gestureType || null,
                // Include targetLabel for tap identification
                targetLabel: e?.targetLabel || properties?.targetLabel || payload?.targetLabel || null,
                // Include touches for coordinate data
                touches: e?.touches || properties?.touches || payload?.touches || null,
                // Include frustration info
                frustrationKind: e?.frustrationKind || properties?.frustrationKind || payload?.frustrationKind || null,
                // Include screen info for navigation events
                screen:
                    e?.screen ||
                    properties?.screen ||
                    payload?.screen ||
                    properties?.screenName ||
                    payload?.screenName ||
                    e?.screenName ||
                    null,
            };
        };

        const normalizedEvents = allEvents
            .map((e, idx) => normalizeEvent(e, idx))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const faultEvents = buildSessionFaultEvents(
            sessionCrashes,
            sessionAnrs,
            sessionErrors,
            sessionStartMs,
            coerceToEpochMs
        );

        const mergedEvents = mergeEventsWithFaults(normalizedEvents, faultEvents);

        const readyScreenshotArtifacts = artifactsList.some((artifact) => artifact.kind === 'screenshots');
        const hasRecording = Boolean(session.replayAvailable) && !session.isReplayExpired && !session.recordingDeleted;
        const playbackMode = hasRecording ? 'screenshots' : 'none';
        const successfulRecording = hasSuccessfulRecording(session, metrics, readyScreenshotArtifacts);
        const durationSeconds = durationSecondsForDisplay({
            ...session,
            latestReplayEndMs: aggregate.latestReplayArtifactEndMs,
            replayAvailable: session.replayAvailable,
        });

        res.json({
            id: session.id,
            projectId: session.projectId,
            userId: session.userDisplayId || null,
            anonymousId: session.anonymousDisplayId || session.anonymousHash,
            anonymousDisplayName: session.deviceId && !session.userDisplayId ? generateAnonymousName(session.deviceId) : null,
            platform: session.platform,
            appVersion: session.appVersion,
            hasRecording, // Indicates whether visual replay is available
            playbackMode, // 'screenshots' or 'none' - determines which player to use
            deviceInfo: {
                model: session.deviceModel,
                os: session.platform,
                systemVersion: session.osVersion,
                appVersion: session.appVersion,
            },
            osVersion: session.osVersion,
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
            startTime: session.startedAt.getTime(),
            endTime: session.endedAt?.getTime(),
            duration: durationSeconds,
            backgroundTime: session.backgroundTimeSeconds ?? 0,
            // playableDuration is now same as durationSeconds (background already excluded at ingest time)
            playableDuration: durationSeconds,
            status: session.status,
            ...buildSessionPresentationPayload(presentationState),
            // Session-level JSONB metadata accumulated from custom "$user_property" events
            metadata: session.metadata,
            events: mergedEvents,
            networkRequests: [
                ...allNetwork.map(n => ({ ...n, timestamp: n.timestamp || Date.now() })),
                ...mergedEvents.filter((e) => e.type === 'network_request' || e.type === 'api_request')
            ].map((e) => {
                const payload = e.payload || e.payloadInline || e; // S3 network artifacts might be flat
                const rawUrl = payload.url || e.url || '';
                const safeUrl = (() => {
                    if (!rawUrl) return null;
                    try {
                        return new URL(rawUrl);
                    } catch {
                        try {
                            return new URL(rawUrl, 'http://localhost');
                        } catch {
                            return null;
                        }
                    }
                })();
                const requestBodySize =
                    payload.requestBodySize ??
                    payload.requestSize ??
                    e.requestBodySize ??
                    e.requestSize ??
                    0;
                const responseBodySize =
                    payload.responseBodySize ??
                    payload.responseSize ??
                    e.responseBodySize ??
                    e.responseSize ??
                    0;
                return {
                    id: e.id || `net_${Math.random()}`,
                    url: rawUrl,
                    method: payload.method || e.method || 'GET',
                    statusCode: payload.statusCode || e.statusCode,
                    duration: payload.duration || e.duration || 0,
                    success: (payload.success ?? e.success) ?? ((payload.statusCode || e.statusCode) < 400),
                    timestamp: (e.timestamp || payload.timestamp) || 0,
                    host: payload.urlHost || payload.host || safeUrl?.hostname || '',
                    path: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                    urlHost: payload.urlHost || payload.host || safeUrl?.hostname || '',
                    urlPath: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                    requestBodySize,
                    responseBodySize,
                    // Keep legacy fields for existing clients.
                    requestSize: requestBodySize,
                    responseSize: responseBodySize,
                    error: payload.error || e.error,
                };
            }).sort((a, b) => a.timestamp - b.timestamp),
            batches: [],
            artifactUrls: {
                events: eventsUrl,
                eventsBatches: eventsUrls,
            },
            // Visual capture data - screenshot frames only.
            screenshotFrames, // Array of { timestamp, url, index } for image-based playback
            hierarchySnapshots,
            metrics: metrics
                ? {
                    totalEvents: metrics.totalEvents,
                    touchCount: metrics.touchCount,
                    scrollCount: metrics.scrollCount,
                    gestureCount: metrics.gestureCount,
                    inputCount: metrics.inputCount,
                    navigationCount: metrics.screensVisited?.length ?? 0,
                    errorCount: metrics.errorCount,
                    rageTapCount: metrics.rageTapCount,
                    deadTapCount: metrics.deadTapCount ?? 0,
                    apiSuccessCount: metrics.apiSuccessCount,
                    apiErrorCount: metrics.apiErrorCount,
                    apiTotalCount: metrics.apiTotalCount,
                    screensVisited: metrics.screensVisited,
                    uniqueScreensCount: new Set(metrics.screensVisited).size,
                    interactionScore: metrics.interactionScore,
                    explorationScore: metrics.explorationScore,
                    uxScore: metrics.uxScore,
                    customEventCount: metrics.customEventCount ?? 0,
                    crashCount: metrics.crashCount || 0,
                }
                : null,
            crashes: mapCrashRowsForPayload(sessionCrashes),
            anrs: mapAnrRowsForPayload(sessionAnrs),
            stats: {
                duration: String(session.durationSeconds ?? 0),
                durationMinutes: String(((session.durationSeconds ?? 0) / 60).toFixed(2)),
                eventCount: metrics?.totalEvents ?? 0,
                totalSizeKB: String(totalBytes / 1024),
                eventsSizeKB: String((bytesByKind.events || 0) / 1024),
                screenshotSizeKB: String((bytesByKind.screenshots || 0) / 1024),
                hierarchySizeKB: String((bytesByKind.hierarchy || 0) / 1024),
                networkSizeKB: String((bytesByKind.network || 0) / 1024),
                networkStats: {
                    total: metrics?.apiTotalCount ?? 0,
                    successful: metrics?.apiSuccessCount ?? 0,
                    failed: metrics?.apiErrorCount ?? 0,
                    avgDuration: metrics?.apiAvgResponseMs ?? 0,
                },
            },
            retentionTier: session.retentionTier,
            retentionDays: session.retentionDays,
            recordingDeleted: session.recordingDeleted,
            recordingDeletedAt: session.recordingDeletedAt?.toISOString() ?? null,
            isReplayExpired: session.isReplayExpired,
            hasSuccessfulRecording: successfulRecording,
        });
    })
);

/**
 * Get lightweight session payload for replay bootstrap
 * GET /api/session/:id/core
 */
router.get(
    '/:id/core',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, metrics } = await getAuthorizedSession(req.user!.id, req.params.id);
        const cached = await readCachedSessionDetail('core', session.id);
        if (cached) {
            res.setHeader('X-Replay-Core-Cache', 'hit');
            res.type('json').send(cached);
            return;
        }

        const [artifactsList, aggregate, supersededByNewerVisitorSession] = await Promise.all([
            getReadyArtifacts(session.id),
            loadSessionWorkAggregate(session.id),
            hasNewerSessionForSameVisitor({
                projectId: session.projectId,
                sessionId: session.id,
                startedAt: session.startedAt,
                deviceId: session.deviceId,
                anonymousHash: session.anonymousHash,
                userDisplayId: session.userDisplayId,
            }),
        ]);

        const screenshotArtifacts = artifactsList.filter((a) => a.kind === 'screenshots');
        const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
        const replayBootstrap = await loadScreenshotReplayBootstrap(
            session,
            screenshotArtifacts.length,
            frameUrlMode
        );

        const basePayload = buildSessionBasePayload(
            session,
            metrics,
            replayBootstrap.screenshotFrames,
            screenshotArtifacts.length > 0,
            deriveSessionPresentationState({
                status: session.status,
                replayAvailable: session.replayAvailable,
                recordingDeleted: session.recordingDeleted,
                isReplayExpired: session.isReplayExpired,
                lastIngestActivityAt: session.lastIngestActivityAt,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                hasPendingWork: aggregate.hasPendingWork,
                hasPendingReplayWork: aggregate.hasPendingReplayWork,
                supersededByNewerVisitorSession,
            }),
            aggregate.latestReplayArtifactEndMs
        );
        const stats = await computeSessionStats(session, metrics, artifactsList, false);
        const responseBody = {
            ...basePayload,
            hasRecording: replayBootstrap.hasRecording,
            playbackMode: replayBootstrap.playbackMode,
            screenshotFrames: replayBootstrap.screenshotFrames,
            screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
            screenshotFrameCount: replayBootstrap.screenshotFrameCount,
            screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
            screenshotFramesTotalSegments: replayBootstrap.totalSegments,
            stats,
        };

        res.json(responseBody);

        if (replayBootstrap.screenshotFramesStatus !== 'preparing') {
            await writeCachedSessionDetail('core', session.id, responseBody);
        }
    })
);

/**
 * Get session timeline payload (events, network, crashes, ANRs)
 * GET /api/session/:id/timeline
 */
router.get(
    '/:id/timeline',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        const cached = await readCachedSessionDetail('timeline', session.id);
        if (cached) {
            res.type('json').send(cached);
            return;
        }

        const artifactsList = await getReadyArtifacts(session.id);
        const timeline = await loadTimelinePayload(session, artifactsList);
        await writeCachedSessionDetail('timeline', session.id, timeline);
        res.json(timeline);
    })
);

/**
 * Get view hierarchy payload
 * GET /api/session/:id/hierarchy
 */
router.get(
    '/:id/hierarchy',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        const cached = await readCachedSessionDetail('hierarchy', session.id);
        if (cached) {
            res.type('json').send(cached);
            return;
        }

        const artifactsList = await getReadyArtifacts(session.id);
        const hierarchySnapshots = await loadHierarchyPayload(session, artifactsList);
        const responseBody = { hierarchySnapshots };
        await writeCachedSessionDetail('hierarchy', session.id, responseBody);
        res.json(responseBody);
    })
);

/**
 * Get screenshot frame bootstrap/progress payload
 * GET /api/session/:id/frames
 */
router.get(
    '/:id/frames',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        const artifactsList = await getReadyArtifacts(session.id);
        const screenshotArtifacts = artifactsList.filter((a) => a.kind === 'screenshots');
        const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
        const replayBootstrap = await loadScreenshotReplayBootstrap(
            session,
            screenshotArtifacts.length,
            frameUrlMode
        );

        res.json({
            screenshotFrames: replayBootstrap.screenshotFrames,
            screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
            screenshotFrameCount: replayBootstrap.screenshotFrameCount,
            screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
            screenshotFramesTotalSegments: replayBootstrap.totalSegments,
        });
    })
);

/**
 * Get detailed session stats (includes S3 HEAD fallback for legacy artifacts missing size_bytes)
 * GET /api/session/:id/stats
 */
router.get(
    '/:id/stats',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, metrics } = await getAuthorizedSession(req.user!.id, req.params.id);
        const artifactsList = await getReadyArtifacts(session.id);
        const stats = await computeSessionStats(session, metrics, artifactsList, true);
        res.json({ stats });
    })
);

/**
 * Get session network requests
 * GET /api/session/:id/network
 */
router.get(
    '/:id/network',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    validate(networkGroupBySchema, 'query'),
    networkRateLimiter,
    asyncHandler(async (req, res) => {
        const { groupBy } = req.query;

        const [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
                teamId: projects.teamId,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .where(eq(sessions.id, req.params.id))
            .limit(1);

        if (!sessionResult) {
            throw ApiError.notFound('Session not found');
        }

        // Verify access
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, sessionResult.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('No access to this session');
        }

        const metrics = sessionResult.metrics;

        res.json({
            sessionId: sessionResult.session.id,
            summary: {
                total: metrics?.apiTotalCount ?? 0,
                successful: metrics?.apiSuccessCount ?? 0,
                failed: metrics?.apiErrorCount ?? 0,
                avgDuration: metrics?.apiAvgResponseMs ?? 0,
            },
            groupBy: groupBy || null,
            groups: [],
        });
    })
);



/**
 * Get frame image by timestamp (proxy)
 * GET /api/session/frame/:sessionId/:timestamp
 */
router.get(
    '/frame/:sessionId/:artifactId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId, artifactId: rawArtifactId } = req.params;

        // The parameter is now typically the timestamp, e.g. "1710000000000" or "1710000000000.jpg"
        const isTimestamp = /^\d+(\.jpg)?$/.test(rawArtifactId);
        const targetTimestampMs = isTimestamp ? parseInt(rawArtifactId.replace(/\.jpg$/, ''), 10) : NaN;

        const redis = getRedis();
        let cacheKey = '';
        
        if (isTimestamp && !isNaN(targetTimestampMs)) {
            cacheKey = `screenshot_frame_data:${sessionId}:${targetTimestampMs}`;
            try {
                // ioredis getBuffer is required for binary data
                const cachedFrame = await redis.getBuffer(cacheKey);
                if (cachedFrame) {
                    res.setHeader('Content-Type', 'image/jpeg');
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                    return res.send(cachedFrame);
                }
            } catch (err) {
                logger.warn({ err, sessionId }, '[sessions] Failed to read frame from Redis cache');
            }
        }

        // Access check
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);
        if (teamIds.length === 0) throw ApiError.notFound('Frame not found');

        const [sessionRows, replayEndRows] = await Promise.all([
            db
                .select({
                    projectId: sessions.projectId,
                    startedAt: sessions.startedAt,
                    endedAt: sessions.endedAt,
                    lastIngestActivityAt: sessions.lastIngestActivityAt,
                })
                .from(sessions)
                .where(and(eq(sessions.id, sessionId), inArray(sessions.projectId,
                    db.select({ id: projects.id }).from(projects).where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)))
                )))
                .limit(1),
            db
                .select({ maxEnd: sql<number | null>`max(${recordingArtifacts.endTime})` })
                .from(recordingArtifacts)
                .where(and(
                    eq(recordingArtifacts.sessionId, sessionId),
                    inArray(recordingArtifacts.kind, ['screenshots', 'hierarchy']),
                    eq(recordingArtifacts.status, 'ready'),
                )),
        ]);

        const session = sessionRows[0];
        const replayEndRow = replayEndRows[0];
        if (!session) throw ApiError.notFound('Frame not found');
        const sessionStartMs = session.startedAt.getTime();
        const replayEndMs = replayEndRow?.maxEnd ?? null;
        const effectiveSessionEnd = session.endedAt
            ?? (replayEndMs != null && replayEndMs > 0 ? new Date(replayEndMs) : null)
            ?? (session.lastIngestActivityAt && session.lastIngestActivityAt > session.startedAt ? session.lastIngestActivityAt : null);
        const sessionEndMs = effectiveSessionEnd ? effectiveSessionEnd.getTime() : Number.MAX_SAFE_INTEGER;
        const lowerBoundMs = Math.max(0, sessionStartMs - 30_000);
        const upperBoundMs = sessionEndMs + 120_000;

        // If it was a legacy artifact ID, act as normal S3 fetch
        if (!isTimestamp || isNaN(targetTimestampMs)) {
            const artifactId = rawArtifactId.replace(/\.json\.gz$/, '').replace(/\.jpg$/, '');
            const [artifact] = await db
                .select()
                .from(recordingArtifacts)
                .where(and(eq(recordingArtifacts.id, artifactId), eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.kind, 'frames')))
                .limit(1);

            if (!artifact) throw ApiError.notFound('Frame not found');

            const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
            if (!data) throw ApiError.notFound('Frame data not found in storage');
            
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.send(data);
        }

        // On cache miss, fetch the screenshot archive that contains this timestamp
        const artifacts = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                endpointId: recordingArtifacts.endpointId,
                startTime: recordingArtifacts.startTime,
                endTime: recordingArtifacts.endTime,
                timestamp: recordingArtifacts.timestamp,
            })
            .from(recordingArtifacts)
            .where(
                and(
                    eq(recordingArtifacts.sessionId, sessionId),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready')
                )
            )
            .orderBy(recordingArtifacts.startTime, recordingArtifacts.timestamp, recordingArtifacts.createdAt);

        if (artifacts.length === 0) throw ApiError.notFound('No ready screenshot artifacts found for session');

        let bestArtifact = artifacts[0];
        for (const artifact of artifacts) {
            const artifactStartMs = artifact.startTime ?? artifact.timestamp ?? sessionStartMs;
            const artifactEndMs = artifact.endTime ?? artifactStartMs + 10_000;
            
            if (targetTimestampMs >= artifactStartMs && targetTimestampMs <= artifactEndMs) {
                bestArtifact = artifact;
                break;
            }
            if (artifactStartMs > targetTimestampMs) break;
            bestArtifact = artifact;
        }

        const archiveData = await downloadFromS3ForArtifact(session.projectId, bestArtifact.s3ObjectKey, bestArtifact.endpointId);
        if (!archiveData) throw ApiError.notFound('Screenshot archive not found in storage');

        // Extract all frames and cache them!
        const { extractFramesFromArchive } = await import('../services/screenshotFrames.js');
        const frames = await extractFramesFromArchive(archiveData, sessionStartMs);
        
        let targetFrameData: Buffer | null = null;
        let minDiff = Number.MAX_SAFE_INTEGER;

        // Cache all extracted frames for immediate playback
        for (const frame of frames) {
            if (frame.timestamp < lowerBoundMs || frame.timestamp > upperBoundMs) {
                continue;
            }
            const frameCacheKey = `screenshot_frame_data:${sessionId}:${frame.timestamp}`;
            try {
                // Cache for 10 minutes - typical replay session duration
                await redis.setex(frameCacheKey, 600, frame.data);
            } catch (err) {
                logger.warn({ err, sessionId }, '[sessions] Failed to write extracted frame to Redis cache');
            }

            // Also search for the requested frame
            const diff = Math.abs(frame.timestamp - targetTimestampMs);
            if (diff < minDiff) {
                minDiff = diff;
                targetFrameData = frame.data;
            }
        }

        if (!targetFrameData) throw ApiError.notFound('Frame data not found inside archive');

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.send(targetFrameData);
    })
);

/**
 * Get screenshot thumbnail for a session
 * GET /api/session/thumbnail/:sessionId
 *
 * Extracts a thumbnail from screenshot archives.
 * Query params:
 *   - t: Kept for backwards compatibility (ignored for screenshot archives)
 *   - ts: Absolute timestamp in ms (epoch) - if provided, extracts frame at this time
 *   - w: Width in pixels (default: 375)
 *   - format: Ignored (responses are JPEG)
 */
router.get(
    '/thumbnail/:sessionId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        const requestStartedAt = Date.now();
        const timeOffset = parseFloat(req.query.t as string) || 0.5;
        const absoluteTimestampMs = req.query.ts ? parseInt(req.query.ts as string, 10) : null;
        const width = parseInt(req.query.w as string, 10) || 375;
        const format: 'jpeg' = 'jpeg';

        logger.info(
            {
                sessionId,
                userId: req.user!.id,
                query: req.query,
                timeOffset,
                absoluteTimestampMs,
                width,
                format,
            },
            '[sessions] Thumbnail request received'
        );

        // Verify session access
        const [session] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            logger.warn({ sessionId, userId: req.user!.id }, '[sessions] Thumbnail request session not found');
            throw ApiError.notFound('Session not found');
        }

        logger.info(
            { sessionId, projectId: session.projectId, userId: req.user!.id },
            '[sessions] Thumbnail request session resolved'
        );

        // Verify user has access to project
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map(m => m.teamId);
        if (teamIds.length === 0) {
            logger.warn({ sessionId, userId: req.user!.id }, '[sessions] Thumbnail request denied because user has no team memberships');
            throw ApiError.forbidden('Access denied');
        }

        logger.info(
            {
                sessionId,
                userId: req.user!.id,
                teamMembershipCount: teamIds.length,
                teamIds,
            },
            '[sessions] Thumbnail request team memberships resolved'
        );

        const [project] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(
                eq(projects.id, session.projectId),
                inArray(projects.teamId, teamIds)
            ))
            .limit(1);

        if (!project) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    userId: req.user!.id,
                    teamIds,
                },
                '[sessions] Thumbnail request denied because project is not accessible to user'
            );
            throw ApiError.forbidden('Access denied');
        }

        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                userId: req.user!.id,
                durationMs: Date.now() - requestStartedAt,
            },
            '[sessions] Thumbnail request authorization succeeded'
        );

        // Import thumbnail service
        const { getSessionThumbnail, getThumbnailAtTimestamp } = await import('../services/sessionThumbnail.js');

        let thumbnail: Buffer | null = null;

        // If absolute timestamp provided, use getThumbnailAtTimestamp for screen-specific frames
        if (absoluteTimestampMs && !isNaN(absoluteTimestampMs)) {
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    width,
                    format,
                },
                '[sessions] Attempting timestamped thumbnail extraction'
            );
            thumbnail = await getThumbnailAtTimestamp(sessionId, absoluteTimestampMs, {
                width,
                format,
            });
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    thumbnailFound: Boolean(thumbnail),
                    durationMs: Date.now() - requestStartedAt,
                },
                '[sessions] Timestamped thumbnail extraction finished'
            );
        }

        // Fallback to first available screenshot extraction
        if (!thumbnail) {
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    timeOffset,
                    width,
                    format,
                },
                '[sessions] Falling back to generic session thumbnail extraction'
            );
            thumbnail = await getSessionThumbnail(sessionId, {
                timeOffset,
                width,
                format,
            });
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    thumbnailFound: Boolean(thumbnail),
                    durationMs: Date.now() - requestStartedAt,
                },
                '[sessions] Generic thumbnail extraction finished'
            );
        }

        if (!thumbnail) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    timeOffset,
                    width,
                    format,
                    durationMs: Date.now() - requestStartedAt,
                },
                '[sessions] Thumbnail request returning 404 because no thumbnail was available'
            );
            throw ApiError.notFound('No thumbnail available for this session');
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                responseBytes: thumbnail.length,
                absoluteTimestampMs,
                durationMs: Date.now() - requestStartedAt,
            },
            '[sessions] Thumbnail request succeeded'
        );
        res.send(thumbnail);
    })
);

/**
 * Get cover photo for a session (alias for thumbnail)
 * GET /api/session/cover/:sessionId
 *
 * This is a convenience endpoint used by MiniSessionCard and other components.
 * Extracts a thumbnail from the session's first screenshot archive frame.
 */
router.get(
    '/cover/:sessionId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId } = req.params;

        // Verify session access
        const [session] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            throw ApiError.notFound('Session not found');
        }

        // Verify user has access to project
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map(m => m.teamId);
        if (teamIds.length === 0) {
            throw ApiError.forbidden('Access denied');
        }

        const [project] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(
                eq(projects.id, session.projectId),
                inArray(projects.teamId, teamIds)
            ))
            .limit(1);

        if (!project) {
            throw ApiError.forbidden('Access denied');
        }

        // Import and use thumbnail service
        const { getSessionThumbnail } = await import('../services/sessionThumbnail.js');

        const thumbnail = await getSessionThumbnail(sessionId, {
            timeOffset: 0.5,
            width: 375,
            format: 'jpeg',
        });

        if (!thumbnail) {
            throw ApiError.notFound('No cover photo available for this session');
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
        res.send(thumbnail);
    })
);

/**
 * GET /sessions/:id/frame/:frameTimestamp
 * 
 * Proxy endpoint for screenshot frames - avoids CSP issues by serving
 * images through the API instead of direct S3 URLs.
 */
router.get(
    '/:id/frame/:frameTimestamp',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const sessionId = req.params.id;
        const frameTimestamp = req.params.frameTimestamp;

        // Verify access, then delegate to the archive-aware frame endpoint.
        await getAuthorizedSessionForFrames(req.user!.id, sessionId);
        return res.redirect(307, `/api/session/frame/${sessionId}/${frameTimestamp}`);
    })
);


export default router;
