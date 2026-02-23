/**
 * Sessions Routes
 * 
 * Session listing, details, and dashboard stats
 */

import { Router } from 'express';
import { eq, and, inArray, gte, lt, isNull, desc } from 'drizzle-orm';

import { db, sessions, sessionMetrics, recordingArtifacts, projects, teamMembers, crashes, anrs, errors } from '../db/client.js';
import { gunzipSync } from 'zlib';

import { getSignedDownloadUrlForProject, downloadFromS3ForProject, getObjectSizeBytesForProject } from '../db/s3.js';
import { getSessionScreenshotFrames, type ScreenshotFrameUrlMode } from '../services/screenshotFrames.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter, networkRateLimiter } from '../middleware/rateLimit.js';
import { sessionIdParamSchema, networkGroupBySchema } from '../validation/sessions.js';
import { generateAnonymousName } from '../utils/anonymousName.js';
import { logger } from '../logger.js';

const router = Router();

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

const DETAIL_FETCH_CONCURRENCY = Number(process.env.RJ_REPLAY_DETAIL_FETCH_CONCURRENCY ?? 6);
const frameModeFromEnv = (process.env.RJ_REPLAY_FRAME_URL_MODE || 'proxy').toLowerCase();
const DEFAULT_FRAME_URL_MODE: ScreenshotFrameUrlMode = frameModeFromEnv === 'signed' ? 'signed' : 'proxy';

function resolveFrameUrlMode(raw: unknown): ScreenshotFrameUrlMode {
    if (typeof raw !== 'string') return DEFAULT_FRAME_URL_MODE;
    const mode = raw.toLowerCase();
    if (mode === 'signed' || mode === 'proxy' || mode === 'none') return mode;
    return DEFAULT_FRAME_URL_MODE;
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

function buildSessionBasePayload(
    session: any,
    metrics: any,
    screenshotFrames: Array<{ timestamp: number; url: string; index: number }>
) {
    const hasRecording = screenshotFrames.length > 0;
    const playbackMode = hasRecording ? 'screenshots' : 'none';

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
        duration: session.durationSeconds,
        backgroundTime: session.backgroundTimeSeconds ?? 0,
        playableDuration: session.durationSeconds ?? 0,
        status: session.status,
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
        replayPromoted: session.replayPromoted,
        replayPromotedReason: session.replayPromotedReason ?? null,
        replayPromotionScore: session.replayPromotionScore ?? 0,
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
                const size = await getObjectSizeBytesForProject(session.projectId, artifact.s3ObjectKey);
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
        const properties: any = {
            anrId: anrRow.id,
            durationMs: anrRow.durationMs,
            threadState: anrRow.threadState,
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
            stack: anrRow.threadState || undefined,
            durationMs: anrRow.durationMs,
            threadState: anrRow.threadState,
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
        threadState: anrRow.threadState,
        status: anrRow.status,
    }));
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
                const data = await downloadFromS3ForProject(session.projectId, artifact.s3ObjectKey);
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
                const data = await downloadFromS3ForProject(session.projectId, artifact.s3ObjectKey);
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

    const allEvents = parsedEventsBatches.flat();
    const allNetwork = parsedNetworkBatches.flat();

    const sessionStartMs = session.startedAt.getTime();
    const sessionEndMs = session.endedAt?.getTime()
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
                const data = await downloadFromS3ForProject(session.projectId, artifact.s3ObjectKey);
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

type FrameProxyCacheEntry = {
    data: Buffer;
    expiresAt: number;
};

const FRAME_PROXY_CACHE_TTL_MS = Number(process.env.RJ_FRAME_PROXY_CACHE_TTL_MS ?? 5 * 60 * 1000);
const FRAME_PROXY_CACHE_MAX_ENTRIES = Number(process.env.RJ_FRAME_PROXY_CACHE_MAX_ENTRIES ?? 400);
const frameProxyCache = new Map<string, FrameProxyCacheEntry>();

function getFrameFromProxyCache(cacheKey: string): Buffer | null {
    const entry = frameProxyCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        frameProxyCache.delete(cacheKey);
        return null;
    }
    return entry.data;
}

function setFrameProxyCache(cacheKey: string, data: Buffer) {
    if (frameProxyCache.size >= FRAME_PROXY_CACHE_MAX_ENTRIES) {
        const oldestKey = frameProxyCache.keys().next().value;
        if (oldestKey) frameProxyCache.delete(oldestKey);
    }
    frameProxyCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + FRAME_PROXY_CACHE_TTL_MS,
    });
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
        const { timeRange, projectId, platform, status } = req.query as any;

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

        // Build where conditions
        const startedAfter = getTimeRangeFilter(timeRange);
        const conditions = [
            projectId ? eq(sessions.projectId, projectId) : inArray(sessions.projectId, accessibleProjectIds),
        ];

        if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));
        if (platform) conditions.push(eq(sessions.platform, platform));
        if (status) conditions.push(eq(sessions.status, status));

        // Get sessions with metrics - NO LIMIT for export
        const sessionsList = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .orderBy(desc(sessions.startedAt));

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
        const { timeRange, projectId, platform, status, limit = 50, offset = 0, cursor, sortBy } = req.query as any;
        const parsedLimit = Math.min(parseInt(limit) || 50, 200); // Max 200 per request

        // Get user's accessible project IDs
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.json({ sessions: [], nextCursor: null, hasMore: false });
            return;
        }

        const accessibleProjectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const accessibleProjectIds = accessibleProjectsList.map((p) => p.id);

        if (accessibleProjectIds.length === 0) {
            res.json({ sessions: [], nextCursor: null, hasMore: false });
            return;
        }

        // Build where conditions
        const startedAfter = getTimeRangeFilter(timeRange);
        const conditions = [
            projectId ? eq(sessions.projectId, projectId) : inArray(sessions.projectId, accessibleProjectIds),
        ];

        if (startedAfter) conditions.push(gte(sessions.startedAt, startedAfter));
        if (platform) conditions.push(eq(sessions.platform, platform));
        if (status) conditions.push(eq(sessions.status, status));
        if (cursor) conditions.push(lt(sessions.id, cursor));

        // Get sessions with metrics
        const sessionsList = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...conditions))
            .orderBy(sortBy === 'score' ? desc(sessions.replayPromotionScore) : desc(sessions.startedAt))
            .limit(parsedLimit + 1)
            .offset(cursor ? 0 : parseInt(offset) || 0);

        // Determine if there are more results
        const hasMore = sessionsList.length > parsedLimit;
        const resultSessions = hasMore ? sessionsList.slice(0, parsedLimit) : sessionsList;
        const nextCursor = hasMore ? resultSessions[resultSessions.length - 1].session.id : null;

        // Transform to API format
        const sessionsData = resultSessions.map(({ session: s, metrics: m }) => ({
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
            durationSeconds: s.durationSeconds,
            backgroundTimeSeconds: s.backgroundTimeSeconds ?? 0,
            // playableDuration is now same as durationSeconds (background already excluded)
            playableDuration: s.durationSeconds ?? 0,
            status: s.status,
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
            // Replay promotion status
            replayPromoted: s.replayPromoted,
            replayPromotedReason: s.replayPromotedReason ?? null,
            replayPromotionScore: s.replayPromotionScore ?? 0,
            // Stats
            stats: {
                duration: String(s.durationSeconds ?? 0),
                durationMinutes: String(((s.durationSeconds ?? 0) / 60).toFixed(2)),
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
        }));

        res.json({
            sessions: sessionsData,
            nextCursor,
            hasMore,
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

        // Always load session data artifacts (events, hierarchy, network) - these are retained indefinitely.
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
            const size = await getObjectSizeBytesForProject(session.projectId, a.s3ObjectKey);
            if (typeof size === 'number' && Number.isFinite(size)) {
                addBytes(a.kind, size);
            }
        }

        // Download and parse all event artifacts (always available)
        for (const artifact of eventsArtifacts) {
            try {
                const data = await downloadFromS3ForProject(session.projectId, artifact.s3ObjectKey);
                if (data) {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.events) {
                        allEvents.push(...parsed.events);
                    } else if (Array.isArray(parsed)) {
                        allEvents.push(...parsed);
                    }
                }
                const url = await getSignedDownloadUrlForProject(session.projectId, artifact.s3ObjectKey);
                if (url) eventsUrls.push(url);
            } catch {
                // Silently skip failed artifacts - they may be corrupted or missing
            }
        }

        // Download and parse all network artifacts (always available)
        for (const artifact of networkArtifacts) {
            try {
                const data = await downloadFromS3ForProject(session.projectId, artifact.s3ObjectKey);
                if (data) {
                    const parsed = JSON.parse(data.toString());
                    if (Array.isArray(parsed)) {
                        allNetwork.push(...parsed);
                    } else if (parsed.networkRequests) { // handled just in case
                        allNetwork.push(...parsed.networkRequests);
                    }
                }
            } catch {
                // Silently skip failed artifacts - they may be corrupted or missing
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
                // Frontend will fetch via /api/sessions/:sessionId/frame/:timestamp
                screenshotFrames = framesResult.frames.map(f => ({
                    timestamp: f.timestamp,
                    // Use relative URL that will be resolved by the API base URL
                    url: `/api/sessions/${session.id}/frame/${f.timestamp}`,
                    index: f.index,
                }));
            }
        }

        // Download and embed hierarchy snapshots (always available)
        hierarchyArtifacts.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        for (const artifact of hierarchyArtifacts) {
            try {
                const data = await downloadFromS3ForProject(session.projectId, artifact.s3ObjectKey);
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
        const sessionEndMs = session.endedAt?.getTime()
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

        // Determine if this session has replay data (screenshots only).
        // A session without segments may still have analytics data (events, metrics)
        const hasRecording = screenshotFrames.length > 0;
        const playbackMode = screenshotFrames.length > 0 ? 'screenshots' : 'none';

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
            duration: session.durationSeconds,
            backgroundTime: session.backgroundTimeSeconds ?? 0,
            // playableDuration is now same as durationSeconds (background already excluded at ingest time)
            playableDuration: session.durationSeconds ?? 0,
            status: session.status,
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
            // Replay promotion status
            replayPromoted: session.replayPromoted,
            replayPromotedReason: session.replayPromotedReason ?? null,
            replayPromotionScore: session.replayPromotionScore ?? 0,
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
        const artifactsList = await getReadyArtifacts(session.id);
        const screenshotArtifacts = artifactsList.filter((a) => a.kind === 'screenshots');

        let screenshotFrames: Array<{ timestamp: number; url: string; index: number }> = [];
        if (screenshotArtifacts.length > 0 && !session.isReplayExpired && !session.recordingDeleted) {
            const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
            const framesResult = await getSessionScreenshotFrames(session.id, { urlMode: frameUrlMode });
            if (framesResult) {
                screenshotFrames = framesResult.frames;
            }
        }

        const basePayload = buildSessionBasePayload(session, metrics, screenshotFrames);
        const stats = await computeSessionStats(session, metrics, artifactsList, false);
        res.json({
            ...basePayload,
            stats,
        });
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
        const artifactsList = await getReadyArtifacts(session.id);
        const timeline = await loadTimelinePayload(session, artifactsList);
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
        const artifactsList = await getReadyArtifacts(session.id);
        const hierarchySnapshots = await loadHierarchyPayload(session, artifactsList);
        res.json({ hierarchySnapshots });
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
 * Get frame image by artifact ID
 * GET /api/session/frame/:sessionId/:artifactId
 * 
 * Serves raw frame data (HEIC or JPEG). Client-side decoding handles HEIC conversion.
 */
router.get(
    '/frame/:sessionId/:artifactId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId, artifactId: rawArtifactId } = req.params;

        const artifactId = rawArtifactId.replace(/\.json\.gz$/, '').replace(/\.jpg$/, '');

        // Get user's accessible project IDs
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            throw ApiError.notFound('Frame not found');
        }

        const accessibleProjectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const accessibleProjectIds = accessibleProjectsList.map((p) => p.id);

        // Find the artifact with access check
        const [artifact] = await db
            .select({
                artifact: recordingArtifacts,
                projectId: sessions.projectId,
            })
            .from(recordingArtifacts)
            .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
            .where(
                and(
                    eq(recordingArtifacts.id, artifactId),
                    eq(recordingArtifacts.sessionId, sessionId),
                    eq(recordingArtifacts.kind, 'frames'),
                    inArray(sessions.projectId, accessibleProjectIds)
                )
            )
            .limit(1);

        if (!artifact) {
            throw ApiError.notFound('Frame not found');
        }

        const s3Key = artifact.artifact.s3ObjectKey;

        // Download from S3
        const data = await downloadFromS3ForProject(artifact.projectId, s3Key);
        if (!data) {
            throw ApiError.notFound('Frame data not found in storage');
        }

        const dataStr = data.toString();

        // Handle JSON artifact format (with embedded base64 image)
        try {
            const parsed = JSON.parse(dataStr);

            // Handle JSON artifacts that wrap a base64 image
            if (parsed.data && typeof parsed.data === 'string') {
                const dataUrl = parsed.data;
                let mimeType = 'image/jpeg';

                const isHeic = dataUrl.startsWith('data:image/heic;base64,') || parsed.format === 'heic';
                const isWebp = dataUrl.startsWith('data:image/webp;base64,') || parsed.format === 'webp';

                if (isHeic) {
                    // Extract base64 HEIC data and serve as HEIC (client will decode)
                    let base64Data = dataUrl;
                    if (base64Data.includes(',')) {
                        base64Data = base64Data.split(',')[1];
                    }
                    const heicBuffer = Buffer.from(base64Data, 'base64');
                    res.setHeader('Content-Type', 'image/heic');
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                    res.send(heicBuffer);
                    return;
                }

                if (isWebp) {
                    // Extract base64 WebP data and serve as WebP (browsers natively support)
                    let base64Data = dataUrl;
                    if (base64Data.includes(',')) {
                        base64Data = base64Data.split(',')[1];
                    }
                    const webpBuffer = Buffer.from(base64Data, 'base64');
                    res.setHeader('Content-Type', 'image/webp');
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                    res.send(webpBuffer);
                    return;
                }

                // Non-HEIC image in JSON wrapper
                const commaIndex = dataUrl.indexOf(',');
                const base64Part = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;

                if (commaIndex >= 0 && dataUrl.startsWith('data:')) {
                    const prefix = dataUrl.slice(5, commaIndex);
                    const semicolonIndex = prefix.indexOf(';');
                    mimeType = semicolonIndex >= 0 ? prefix.slice(0, semicolonIndex) : prefix;
                }

                const imageBuffer = Buffer.from(base64Part, 'base64');

                res.setHeader('Content-Type', mimeType || 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                res.send(imageBuffer);
                return;
            }
        } catch {
            // Not JSON, fall through to raw data
        }

        // Fallback: serve raw data
        let contentType = 'image/jpeg';

        if (s3Key.endsWith('.json.gz')) {
            contentType = 'application/json';
        } else if (s3Key.includes('webp')) {
            contentType = 'image/webp';
        } else if (s3Key.includes('heic')) {
            contentType = 'image/heic';
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(data);
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
        const timeOffset = parseFloat(req.query.t as string) || 0.5;
        const absoluteTimestampMs = req.query.ts ? parseInt(req.query.ts as string, 10) : null;
        const width = parseInt(req.query.w as string, 10) || 375;
        const format: 'jpeg' = 'jpeg';

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

        // Import thumbnail service
        const { getSessionThumbnail, getThumbnailAtTimestamp } = await import('../services/sessionThumbnail.js');

        let thumbnail: Buffer | null = null;

        // If absolute timestamp provided, use getThumbnailAtTimestamp for screen-specific frames
        if (absoluteTimestampMs && !isNaN(absoluteTimestampMs)) {
            thumbnail = await getThumbnailAtTimestamp(sessionId, absoluteTimestampMs, {
                width,
                format,
            });
        }

        // Fallback to first available screenshot extraction
        if (!thumbnail) {
            thumbnail = await getSessionThumbnail(sessionId, {
                timeOffset,
                width,
                format,
            });
        }

        if (!thumbnail) {
            throw ApiError.notFound('No thumbnail available for this session');
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
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

        // Verify session access before serving frame bytes.
        const { session } = await getAuthorizedSession(req.user!.id, sessionId);

        // Construct frame S3 key
        const frameKey = `sessions/${sessionId}/frames/${frameTimestamp}.jpg`;

        const cacheKey = `${session.projectId}:${frameKey}`;
        const cached = getFrameFromProxyCache(cacheKey);
        const frameData = cached ?? await downloadFromS3ForProject(session.projectId, frameKey);
        if (!frameData) throw ApiError.notFound('Frame not found');
        if (!cached) setFrameProxyCache(cacheKey, frameData);

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(frameData);
    })
);


export default router;
