import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { eq, sql } from 'drizzle-orm';
import { db, sessions, sessionMetrics, anrs, errors, apiEndpointDailyStats, screenTouchHeatmaps, recordingArtifacts } from '../db/client.js';
import { trackANRAsIssue, trackErrorAsIssue } from './issueTracker.js';
import { normalizeIngestSdkVersion } from './ingestSessionLifecycle.js';
import { getUniqueScreenCount, mergeScreenPaths, normalizeScreenPath } from '../utils/screenPaths.js';
import { shouldExcludeNetworkEventFromProductAnalytics } from '../utils/internalToolEndpointFilter.js';
import { mergeAnrDeviceMetadata, resolveAnrStackTrace } from './anrStack.js';
import { extractSessionIdentityChange } from './sessionIdentityEvents.js';
import {
    buildClickHouseApiEndpointEventRow,
    writeApiEndpointEventsToClickHouse,
    type ClickHouseApiEndpointEventRow,
} from './clickhouseApiStatsSink.js';
import {
    coerceTimestampToDate,
    extractBackgroundDurationSeconds,
    extractCumulativeBackgroundSeconds,
} from './sessionClientEvidence.js';
const MAX_SCREEN_PATH_LENGTH = 200;
const UNKNOWN_STATUS_CODE_KEY = 'unknown';
const WEB_ATTRIBUTION_METADATA_KEYS = [
    'webReferral',
    'webReferrer',
    'webReferrerDomain',
    'webAttributionSource',
    'webAttributionMedium',
    'webAttributionCampaign',
    'webAttributionTerm',
    'webAttributionContent',
    'webAttributionCampaignId',
    'webAttributionSourcePlatform',
    'webAttributionCreativeFormat',
    'webAttributionMarketingTactic',
    'webAttributionChannel',
    'webLandingRoute',
    'webEntryPath',
    'webEntryUrl',
    'webNavigationType',
    'utm_id',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_source_platform',
    'utm_creative_format',
    'utm_marketing_tactic',
] as const;

function parseMaybeGzippedJson(data: Buffer): any {
    const isGzipped = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
    const raw = isGzipped ? gunzipSync(data).toString('utf8') : data.toString('utf8');
    return JSON.parse(raw);
}

function normalizeMetadataString(value: unknown, maxLength = 512): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
}

function hostnameFromUrl(value: unknown): string | null {
    const raw = normalizeMetadataString(value, 2048);
    if (!raw) return null;
    try {
        return new URL(raw).hostname;
    } catch {
        try {
            return new URL(`https://${raw}`).hostname;
        } catch {
            return null;
        }
    }
}

function extractWebAttribution(event: any): any | null {
    const attribution = event?.attribution || event?.payload?.attribution || event?.properties?.attribution;
    return attribution && typeof attribution === 'object' ? attribution : null;
}

export function buildWebAttributionMetadata(event: any): Record<string, string> {
    const attribution = extractWebAttribution(event);
    if (!attribution) return {};

    const entryQuery = attribution.entryQuery && typeof attribution.entryQuery === 'object' ? attribution.entryQuery : {};
    const readQueryValue = (queryKey: string) => {
        const directValue = normalizeMetadataString(entryQuery[queryKey]) || normalizeMetadataString(entryQuery[queryKey.toLowerCase()]);
        if (directValue) return directValue;
        const normalizedKey = queryKey.toLowerCase();
        for (const [key, value] of Object.entries(entryQuery)) {
            if (key.toLowerCase() === normalizedKey) {
                return normalizeMetadataString(value);
            }
        }
        return null;
    };
    const readAttributionValue = (field: string, queryKey: string) => (
        normalizeMetadataString(attribution[field]) ||
        readQueryValue(queryKey)
    );
    const source = readAttributionValue('source', 'utm_source');
    const medium = readAttributionValue('medium', 'utm_medium');
    const campaign = readAttributionValue('campaign', 'utm_campaign');
    const term = readAttributionValue('term', 'utm_term');
    const content = readAttributionValue('content', 'utm_content');
    const campaignId = readAttributionValue('campaignId', 'utm_id');
    const sourcePlatform = readAttributionValue('sourcePlatform', 'utm_source_platform');
    const creativeFormat = readAttributionValue('creativeFormat', 'utm_creative_format');
    const marketingTactic = readAttributionValue('marketingTactic', 'utm_marketing_tactic');
    const referrerDomain =
        normalizeMetadataString(attribution.referrerDomain) ||
        hostnameFromUrl(attribution.referrer);
    const channel = normalizeMetadataString(attribution.channel, 128);
    const webReferral =
        referrerDomain ||
        normalizeMetadataString(source, 256) ||
        (channel === 'direct' ? 'Direct' : null);

    const updates: Record<string, string> = {};
    const assign = (key: typeof WEB_ATTRIBUTION_METADATA_KEYS[number], value: unknown, maxLength = 512) => {
        const normalized = normalizeMetadataString(value, maxLength);
        if (normalized) updates[key] = normalized;
    };

    assign('webReferral', webReferral);
    assign('webReferrer', attribution.referrer, 2048);
    assign('webReferrerDomain', referrerDomain);
    assign('webAttributionSource', source);
    assign('webAttributionMedium', medium);
    assign('webAttributionCampaign', campaign);
    assign('webAttributionTerm', term);
    assign('webAttributionContent', content);
    assign('webAttributionCampaignId', campaignId);
    assign('webAttributionSourcePlatform', sourcePlatform);
    assign('webAttributionCreativeFormat', creativeFormat);
    assign('webAttributionMarketingTactic', marketingTactic);
    assign('webAttributionChannel', channel);
    assign('webLandingRoute', attribution.landingRoute);
    assign('webEntryPath', attribution.entryPath);
    assign('webEntryUrl', attribution.entryUrl, 2048);
    assign('webNavigationType', attribution.navigationType, 128);
    assign('utm_id', campaignId);
    assign('utm_source', source);
    assign('utm_medium', medium);
    assign('utm_campaign', campaign);
    assign('utm_term', term);
    assign('utm_content', content);
    assign('utm_source_platform', sourcePlatform);
    assign('utm_creative_format', creativeFormat);
    assign('utm_marketing_tactic', marketingTactic);

    return updates;
}

function buildDeviceMetadataUpdates(deviceInfo: any): Record<string, string | boolean> {
    const updates: Record<string, string | boolean> = {};
    const assign = (key: string, value: unknown, maxLength = 512) => {
        if (typeof value === 'boolean') {
            updates[key] = value;
            return;
        }
        if (value === null || value === undefined) return;
        const normalized = String(value).trim();
        if (normalized) updates[key] = normalized.slice(0, maxLength);
    };

    assign('browser', deviceInfo?.browser, 128);
    assign('browserVersion', deviceInfo?.browserVersion, 128);
    assign('os', deviceInfo?.os, 128);
    assign('osVersion', deviceInfo?.systemVersion || deviceInfo?.osVersion, 128);
    assign('networkType', deviceInfo?.networkType, 128);
    assign('effectiveConnectionType', deviceInfo?.effectiveConnectionType, 128);
    assign('connectionSaveData', deviceInfo?.connectionSaveData);
    assign('sdkVersion', normalizeIngestSdkVersion(deviceInfo?.sdkVersion), 50);
    assign('appVersion', deviceInfo?.appVersion || deviceInfo?.sdkVersion, 128);
    assign('userAgent', deviceInfo?.userAgent, 2048);

    return updates;
}

function normalizeErrorStatusCodeKey(statusCode: unknown, isError: boolean): string | null {
    const parsed = Number(statusCode);
    if (Number.isFinite(parsed) && parsed >= 400) {
        return String(Math.trunc(parsed));
    }
    return isError ? UNKNOWN_STATUS_CODE_KEY : null;
}

function maxDate(current: Date | null, candidate: Date | null): Date | null {
    if (!candidate) return current;
    return !current || candidate.getTime() > current.getTime() ? candidate : current;
}

function minDate(current: Date | null, candidate: Date | null): Date | null {
    if (!candidate) return current;
    return !current || candidate.getTime() < current.getTime() ? candidate : current;
}

function capBackgroundSecondsToElapsed(
    backgroundSeconds: number,
    startedAt: Date | string | null | undefined,
    at: Date | null,
): number {
    const start = startedAt instanceof Date ? startedAt : startedAt ? new Date(String(startedAt)) : null;
    if (!start || !at || !Number.isFinite(start.getTime()) || !Number.isFinite(at.getTime())) {
        return backgroundSeconds;
    }
    const elapsedSeconds = Math.max(0, Math.round((at.getTime() - start.getTime()) / 1000));
    return Math.min(backgroundSeconds, elapsedSeconds);
}

export async function processEventsArtifact(job: any, session: any, metrics: any, projectId: string, data: Buffer, log: any) {
    const payload = parseMaybeGzippedJson(data);
    const eventsData = payload.events || [];
    const deviceInfo = payload.deviceInfo;
    // Update session metadata from device info
    if (deviceInfo) {
        const sessionUpdates: any = { updatedAt: new Date() };
        const deviceAppVersion = deviceInfo.appVersion || deviceInfo.sdkVersion;
        if (deviceAppVersion) sessionUpdates.appVersion = deviceAppVersion;
        if (deviceInfo.model) sessionUpdates.deviceModel = deviceInfo.model;
        if (deviceInfo.platform) sessionUpdates.platform = deviceInfo.platform;
        if ((!session.deviceId || session.deviceId === '') && (deviceInfo.deviceId || deviceInfo.vendorId || deviceInfo.deviceHash)) {
            sessionUpdates.deviceId = deviceInfo.deviceId || deviceInfo.vendorId || deviceInfo.deviceHash;
        }
        if (deviceInfo.systemVersion) sessionUpdates.osVersion = deviceInfo.systemVersion;
        else if (deviceInfo.osVersion) sessionUpdates.osVersion = deviceInfo.osVersion;
        else if (deviceInfo.os && deviceInfo.os !== 'web') sessionUpdates.osVersion = deviceInfo.os;

        const fromDeviceInfo = normalizeIngestSdkVersion(deviceInfo.sdkVersion);
        if (fromDeviceInfo && !session.sdkVersion) {
            sessionUpdates.sdkVersion = fromDeviceInfo;
        }
        const deviceMetadataUpdates = buildDeviceMetadataUpdates(deviceInfo);
        if (Object.keys(deviceMetadataUpdates).length > 0) {
            sessionUpdates.metadata = sql`${sessions.metadata} || ${JSON.stringify(deviceMetadataUpdates)}::jsonb`;
        }

        await db.update(sessions).set(sessionUpdates).where(eq(sessions.id, job.sessionId));

        if (deviceInfo.networkType) {
            await db.update(sessionMetrics)
                .set({
                    networkType: deviceInfo.networkType,
                    cellularGeneration: deviceInfo.cellularGeneration,
                    isConstrained: deviceInfo.isConstrained,
                    isExpensive: deviceInfo.isExpensive,
                })
                .where(eq(sessionMetrics.sessionId, job.sessionId));
        }
    }

    // Extract event metrics
    let touchCount = 0, scrollCount = 0, gestureCount = 0, inputCount = 0;
    let networkTotalCount = 0, networkSuccessCount = 0, networkErrorCount = 0;
    let networkTotalDuration = 0, networkDurationCount = 0;
    let errorCount = 0, rageTapCount = 0, customEventCount = 0;
    let deadTapCount = 0;
    let appStartupTimeMs: number | null = null;
    let observedBackgroundTimeSeconds: number | null = null;
    let earliestClientEventAt: Date | null = null;
    let latestClientEventAt: Date | null = null;
    const recentTaps: { x: number; y: number; timestamp: number }[] = [];
    const screenPath: string[] = [];
    const endpointStats: Record<string, { calls: number; errors: number; latencySum: number; statusCodeBreakdown: Record<string, number> }> = {};
    const clickHouseApiEndpointRows: ClickHouseApiEndpointEventRow[] = [];

    // Collect errors for batch insert
    const errorEvents: Array<{
        timestamp: Date;
        errorType: string;
        errorName: string;
        message: string;
        stack?: string;
        screenName?: string;
    }> = [];

    // Collect ANRs for batch insert
    const anrEvents: Array<{
        timestamp: Date;
        durationMs: number;
        threadState?: string;
        stackTrace?: string;
        rawThreadState?: string;
        screenName?: string;
    }> = [];

    // Track current screen for touch coordinate association
    let currentScreen: string | null = null;

    type HeatmapCoordinateFrame = {
        width: number;
        height: number;
        pageWidth: number | null;
        pageHeight: number | null;
        viewportWidth: number;
        viewportHeight: number;
        usesPageCoordinates: boolean;
    };

    // Screen touch heatmap data: screenName -> aggregated coordinate buckets and the largest observed frame dimensions.
    const screenHeatmapData: Record<string, {
        touchBuckets: Record<string, number>;
        rageTapBuckets: Record<string, number>;
        totalTouches: number;
        totalRageTaps: number;
        firstSeenMs: number | null; // Timestamp when this screen was first seen in this session
        pageWidth: number | null;
        pageHeight: number | null;
        viewportWidth: number | null;
        viewportHeight: number | null;
    }> = {};

    // Helper to bucket coordinates to grid cells (50 columns x 100 rows for fine-grained heatmaps)
    const bucketCoordinate = (x: number, y: number, frame: HeatmapCoordinateFrame): string => {
        // Normalize to 0-1 range
        const normX = Math.max(0, Math.min(1, x / frame.width));
        const normY = Math.max(0, Math.min(1, y / frame.height));
        // Bucket to fine grid (50 columns x 100 rows) for more precise heatmap data
        const bucketX = Math.floor(normX * 50) / 50;
        const bucketY = Math.floor(normY * 100) / 100;
        return `${bucketX.toFixed(2)},${bucketY.toFixed(2)}`;
    };

    const coercePositiveNumber = (value: unknown): number | null => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const coerceNumber = (value: unknown): number | null => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const eventTimestampMs = (event: any): number | null => {
        const eventAt = coerceTimestampToDate(event?.timestamp);
        return eventAt ? Math.round(eventAt.getTime()) : null;
    };

    const normalizedScreenFromEvent = (event: any): string | null => {
        const rawScreenName =
            event?.screen ||
            event?.screenName ||
            event?.payload?.screenName ||
            event?.payload?.name ||
            event?.payload?.route;
        if (!rawScreenName) return null;
        const trimmed = String(rawScreenName).trim();
        return trimmed.length > 0 ? trimmed : null;
    };

    const ensureHeatmapStats = (screenName: string, firstSeenMs: number | null) => {
        if (!screenHeatmapData[screenName]) {
            screenHeatmapData[screenName] = {
                touchBuckets: {},
                rageTapBuckets: {},
                totalTouches: 0,
                totalRageTaps: 0,
                firstSeenMs,
                pageWidth: null,
                pageHeight: null,
                viewportWidth: null,
                viewportHeight: null,
            };
        } else if (!screenHeatmapData[screenName].firstSeenMs && firstSeenMs) {
            screenHeatmapData[screenName].firstSeenMs = firstSeenMs;
        }
        return screenHeatmapData[screenName];
    };

    const recordScreenSeen = (screenName: string | null, firstSeenMs: number | null): string | null => {
        if (!screenName) return null;
        if (screenPath.length === 0 || screenPath[screenPath.length - 1] !== screenName) {
            screenPath.push(screenName);
        }
        currentScreen = screenName;
        ensureHeatmapStats(screenName, firstSeenMs);
        return screenName;
    };

    const getCoordinateFrame = (event: any): HeatmapCoordinateFrame => {
        const viewportWidth = coercePositiveNumber(
            event?.viewportWidth ??
            event?.payload?.viewportWidth ??
            deviceInfo?.viewportWidth ??
            deviceInfo?.screenWidth ??
            375
        ) ?? 375;
        const viewportHeight = coercePositiveNumber(
            event?.viewportHeight ??
            event?.payload?.viewportHeight ??
            deviceInfo?.viewportHeight ??
            deviceInfo?.screenHeight ??
            812
        ) ?? 812;
        const documentWidth = coercePositiveNumber(event?.documentWidth ?? event?.payload?.documentWidth);
        const documentHeight = coercePositiveNumber(event?.documentHeight ?? event?.payload?.documentHeight);
        const scrollX = coerceNumber(event?.scrollX ?? event?.payload?.scrollX) ?? 0;
        const scrollY = coerceNumber(event?.scrollY ?? event?.payload?.scrollY) ?? 0;
        const hasDocumentFrame = Boolean(documentWidth && documentHeight);
        const usesPageCoordinates = Boolean(
            hasDocumentFrame &&
            (
                (documentWidth ?? 0) > viewportWidth * 1.02 ||
                (documentHeight ?? 0) > viewportHeight * 1.02 ||
                scrollX > 0 ||
                scrollY > 0
            )
        );

        return {
            width: usesPageCoordinates ? documentWidth! : viewportWidth,
            height: usesPageCoordinates ? documentHeight! : viewportHeight,
            pageWidth: usesPageCoordinates ? documentWidth : null,
            pageHeight: usesPageCoordinates ? documentHeight : null,
            viewportWidth,
            viewportHeight,
            usesPageCoordinates,
        };
    };

    const updateHeatmapFrameStats = (
        stats: (typeof screenHeatmapData)[string],
        frame: HeatmapCoordinateFrame,
    ) => {
        stats.viewportWidth = Math.max(stats.viewportWidth ?? 0, Math.round(frame.viewportWidth));
        stats.viewportHeight = Math.max(stats.viewportHeight ?? 0, Math.round(frame.viewportHeight));
        if (frame.usesPageCoordinates && frame.pageWidth && frame.pageHeight) {
            stats.pageWidth = Math.max(stats.pageWidth ?? 0, Math.round(frame.pageWidth));
            stats.pageHeight = Math.max(stats.pageHeight ?? 0, Math.round(frame.pageHeight));
        }
    };

    const addHeatmapTouch = (
        screenName: string | null,
        x: unknown,
        y: unknown,
        event: any,
        isRageTap: boolean,
        firstSeenMs: number | null,
    ) => {
        if (!screenName) return;
        const tapX = Number(x);
        const tapY = Number(y);
        if (!Number.isFinite(tapX) || !Number.isFinite(tapY) || tapX < 0 || tapY < 0) return;

        const frame = getCoordinateFrame(event);
        const scrollX = frame.usesPageCoordinates ? (coerceNumber(event?.scrollX ?? event?.payload?.scrollX) ?? 0) : 0;
        const scrollY = frame.usesPageCoordinates ? (coerceNumber(event?.scrollY ?? event?.payload?.scrollY) ?? 0) : 0;
        const bucket = bucketCoordinate(tapX + scrollX, tapY + scrollY, frame);
        const stats = ensureHeatmapStats(screenName, firstSeenMs);
        updateHeatmapFrameStats(stats, frame);
        stats.touchBuckets[bucket] = (stats.touchBuckets[bucket] || 0) + 1;
        stats.totalTouches++;

        if (isRageTap) {
            stats.rageTapBuckets[bucket] = (stats.rageTapBuckets[bucket] || 0) + 1;
            stats.totalRageTaps++;
        }
    };

    for (let eventIndex = 0; eventIndex < eventsData.length; eventIndex++) {
        const event = eventsData[eventIndex];
        const eventAt = coerceTimestampToDate(event.timestamp);
        earliestClientEventAt = minDate(earliestClientEventAt, eventAt);
        latestClientEventAt = maxDate(latestClientEventAt, eventAt);

        const type = (event.type || '').toLowerCase();
        const gestureType = (event.gestureType || '').toLowerCase();

        if (type === 'navigation') {
            recordScreenSeen(normalizedScreenFromEvent(event), eventTimestampMs(event));
        }

        if (type === 'motion' || type === 'scroll_motion' || type === 'pan_motion') {
            if (type.includes('scroll')) scrollCount++;
        } else if (type === 'touch' || type === 'tap' || type === 'click' || gestureType === 'tap' || gestureType === 'single_tap') {
            touchCount++;
            const firstSeenMs = eventTimestampMs(event);
            const touchScreen = recordScreenSeen(normalizedScreenFromEvent(event), firstSeenMs) || currentScreen;
            const tapX = event.x || event.touches?.[0]?.x || 0;
            const tapY = event.y || event.touches?.[0]?.y || 0;
            const tapTime = event.timestamp || 0;

            // Check for rage tap (multiple taps in same area within 500ms)
            while (recentTaps.length > 0 && tapTime - recentTaps[0].timestamp > 500) recentTaps.shift();
            const nearbyTaps = recentTaps.filter(t => Math.abs(t.x - tapX) < 50 && Math.abs(t.y - tapY) < 50);
            const isRageTap = nearbyTaps.length >= 1;
            if (isRageTap) rageTapCount++;
            recentTaps.push({ x: tapX, y: tapY, timestamp: tapTime });

            // Record touch coordinate for heatmap (if we have a current screen)
            addHeatmapTouch(touchScreen, tapX, tapY, event, isRageTap, firstSeenMs);
        } else if (type === 'scroll') {
            scrollCount++;
        } else if (type === 'gesture') {
            gestureCount++;
            if (gestureType === 'dead_tap') {
                deadTapCount++;
            } else if (gestureType.includes('scroll') || gestureType.includes('swipe')) {
                scrollCount++;
            }
            const firstSeenMs = eventTimestampMs(event);
            const gestureScreen = recordScreenSeen(normalizedScreenFromEvent(event), firstSeenMs) || currentScreen;
            // Extract touch coordinates from gesture events (iOS SDK sends touches in the touches array)
            // This is critical for heatmap data - gestures with tap-like types have coordinate data
            if (gestureType === 'tap' || gestureType === 'single_tap' || gestureType === 'double_tap' ||
                gestureType === 'long_press' || gestureType.includes('tap')) {
                touchCount++;
                // Extract coordinates from the touches array
                const touches = event.touches || [];
                if (Array.isArray(touches) && touches.length > 0) {
                    for (const touch of touches) {
                        const tapX = touch.x || 0;
                        const tapY = touch.y || 0;
                        const tapTime = touch.timestamp || event.timestamp || 0;

                        if (gestureScreen) {
                            // Track for rage tap detection
                            while (recentTaps.length > 0 && tapTime - recentTaps[0].timestamp > 500) recentTaps.shift();
                            const nearbyTaps = recentTaps.filter(t => Math.abs(t.x - tapX) < 50 && Math.abs(t.y - tapY) < 50);
                            const isRageTap = nearbyTaps.length >= 1;
                            if (isRageTap) {
                                rageTapCount++;
                            }
                            addHeatmapTouch(gestureScreen, tapX, tapY, event, isRageTap, firstSeenMs);
                            recentTaps.push({ x: tapX, y: tapY, timestamp: tapTime });
                        }
                    }
                } else {
                    // Fallback: try to get coordinates from event directly
                    const tapX = event.x || 0;
                    const tapY = event.y || 0;
                    addHeatmapTouch(gestureScreen, tapX, tapY, event, false, firstSeenMs);
                }
            }
        } else if (type === 'rage_tap' || type === 'rage_click') {
            rageTapCount++;
            // Also record rage tap coordinates for heatmap
            const firstSeenMs = eventTimestampMs(event);
            const rageScreen = recordScreenSeen(normalizedScreenFromEvent(event), firstSeenMs) || currentScreen;
            const tapX = event.x || event.touches?.[0]?.x || 0;
            const tapY = event.y || event.touches?.[0]?.y || 0;
            addHeatmapTouch(rageScreen, tapX, tapY, event, true, firstSeenMs);
        } else if (type === 'dead_tap' || gestureType === 'dead_tap') {
            deadTapCount++;
        } else if (type === 'api_call' || type === 'network_request') {
            if (shouldExcludeNetworkEventFromProductAnalytics(event)) {
                continue;
            }

            const method = (event.method || 'GET').toUpperCase();
            let url = event.url || event.endpoint || '';
            try { url = new URL(url).pathname; } catch { /* use as-is if not valid URL */ }

            networkTotalCount++;
            if (event.duration && typeof event.duration === 'number') {
                networkTotalDuration += event.duration;
                networkDurationCount++;
            }
            const parsedStatusCode = Number(event.statusCode);
            const hasNumericStatusCode = Number.isFinite(parsedStatusCode);
            const isError = event.success === false || (hasNumericStatusCode && parsedStatusCode >= 400);
            if (event.success === true || (hasNumericStatusCode && parsedStatusCode >= 200 && parsedStatusCode < 400)) {
                networkSuccessCount++;
            } else if (isError) {
                networkErrorCount++;
            }

            if (url) {
                const endpoint = `${method} ${url}`;
                if (!endpointStats[endpoint]) {
                    endpointStats[endpoint] = {
                        calls: 0,
                        errors: 0,
                        latencySum: 0,
                        statusCodeBreakdown: {},
                    };
                }
                endpointStats[endpoint].calls++;
                if (isError) endpointStats[endpoint].errors++;
                const errorStatusCodeKey = normalizeErrorStatusCodeKey(event.statusCode, isError);
                if (errorStatusCodeKey) {
                    endpointStats[endpoint].statusCodeBreakdown[errorStatusCodeKey] =
                        (endpointStats[endpoint].statusCodeBreakdown[errorStatusCodeKey] || 0) + 1;
                }
                if (event.duration) endpointStats[endpoint].latencySum += event.duration;

                clickHouseApiEndpointRows.push(buildClickHouseApiEndpointEventRow({
                    projectId,
                    sessionId: job.sessionId,
                    artifactId: job.artifactId,
                    eventIndex,
                    method,
                    path: url,
                    statusCode: hasNumericStatusCode ? parsedStatusCode : 0,
                    isError,
                    durationMs: Number(event.duration || 0),
                    eventAt,
                    region: 'unknown',
                }));
            }
        } else if (type === 'error' || type === 'resource_error') {
            errorCount++;
            // Collect error details for batch insert
            const errorName = event.name || (type === 'resource_error' ? 'ResourceError' : 'Error');
            const errorMessage = event.message || 'Unknown error';
            const errorType = type === 'resource_error' ? 'resource_error'
                : errorName === 'UnhandledRejection' ? 'promise_rejection'
                    : errorName.includes('Exception') ? 'unhandled_exception'
                        : 'js_error';
            errorEvents.push({
                timestamp: new Date(event.timestamp || Date.now()),
                errorType,
                errorName,
                message: errorMessage,
                stack: event.stack,
                screenName: currentScreen || undefined,
            });
        } else if (type === 'anr' || type === 'long_task' || type === 'ui_freeze') {
            const durationMs = Math.max(0, Math.round(Number(event.durationMs) || 0));
            const threadState = typeof event.threadState === 'string' ? event.threadState : '';
            const isWebLongTask =
                deviceInfo?.platform === 'web' &&
                (type === 'long_task' || threadState === 'main_thread_long_task');

            if (isWebLongTask) {
                continue;
            }

            const stackTrace = resolveAnrStackTrace({
                threadState: event.threadState,
                stack: event.stack,
            });
            anrEvents.push({
                timestamp: new Date(event.timestamp || Date.now()),
                durationMs: durationMs || 5000,
                threadState: stackTrace || event.threadState || 'blocked',
                stackTrace: stackTrace || undefined,
                rawThreadState: typeof event.threadState === 'string' ? event.threadState : undefined,
                screenName: currentScreen || undefined,
            });
        } else if (['keyboard_typing', 'keyboard_show', 'keyboard_hide', 'input', 'text_input'].includes(type)) {
            inputCount++;
        } else if (type === 'custom') {
            customEventCount++;
        } else if (type === 'app_startup') {
            // Extract app startup time
            const durationMs = Number(event.durationMs ?? event.duration ?? event.payload?.durationMs);
            if (Number.isFinite(durationMs) && durationMs > 0) {
                // Store in updates - will be applied to session_metrics
                appStartupTimeMs = Math.round(durationMs);
                log.info({ appStartupTimeMs, platform: event.platform }, 'Captured app startup time');
            }
        } else if (type === 'app_foreground') {
            const totalBackgroundSeconds = extractCumulativeBackgroundSeconds(event);
            if (totalBackgroundSeconds !== null) {
                const cappedBackgroundSeconds = capBackgroundSecondsToElapsed(
                    totalBackgroundSeconds,
                    session.startedAt,
                    eventAt,
                );
                observedBackgroundTimeSeconds = Math.max(
                    observedBackgroundTimeSeconds ?? 0,
                    cappedBackgroundSeconds,
                );
            } else {
                const durationBackgroundSeconds = extractBackgroundDurationSeconds(event);
                if (durationBackgroundSeconds !== null) {
                    const cumulativeBackgroundSeconds = (observedBackgroundTimeSeconds ?? 0) + durationBackgroundSeconds;
                    const cappedBackgroundSeconds = capBackgroundSecondsToElapsed(
                        cumulativeBackgroundSeconds,
                        session.startedAt,
                        eventAt,
                    );
                    observedBackgroundTimeSeconds = Math.max(
                        observedBackgroundTimeSeconds ?? 0,
                        cappedBackgroundSeconds,
                    );
                }
            }
        } else if (type === 'user_identity_changed') {
            const identityChange = extractSessionIdentityChange(event);
            if (identityChange.type === 'clear') {
                await db.update(sessions)
                    .set({ userDisplayId: null, anonymousDisplayId: null, updatedAt: new Date() })
                    .where(eq(sessions.id, job.sessionId));
                log.info('Session identity cleared from user_identity_changed event');
            } else if (identityChange.type === 'anonymous') {
                await db.update(sessions)
                    .set({ anonymousDisplayId: identityChange.anonymousDisplayId, userDisplayId: null, updatedAt: new Date() })
                    .where(eq(sessions.id, job.sessionId));
                log.info({ anonymousId: identityChange.anonymousDisplayId }, 'Session anonymousId updated from user_identity_changed event');
            } else if (identityChange.type === 'user') {
                await db.update(sessions)
                    .set({ userDisplayId: identityChange.userDisplayId, anonymousDisplayId: null, updatedAt: new Date() })
                    .where(eq(sessions.id, job.sessionId));
                log.info({ userId: identityChange.userDisplayId }, 'Session userId updated from user_identity_changed event');
            }
        }
    }

    // Update session metrics
    const existingMetrics = metrics || { touchCount: 0, scrollCount: 0, gestureCount: 0, inputCount: 0, rageTapCount: 0, deadTapCount: 0, apiTotalCount: 0, apiSuccessCount: 0, apiErrorCount: 0, errorCount: 0, customEventCount: 0, apiAvgResponseMs: 0, screensVisited: [] };

    const updates: any = {
        touchCount: (existingMetrics.touchCount || 0) + touchCount,
        scrollCount: (existingMetrics.scrollCount || 0) + scrollCount,
        gestureCount: (existingMetrics.gestureCount || 0) + gestureCount,
        inputCount: (existingMetrics.inputCount || 0) + inputCount,
        rageTapCount: (existingMetrics.rageTapCount || 0) + rageTapCount,
        deadTapCount: (existingMetrics.deadTapCount || 0) + deadTapCount,
        apiTotalCount: (existingMetrics.apiTotalCount || 0) + networkTotalCount,
        apiSuccessCount: (existingMetrics.apiSuccessCount || 0) + networkSuccessCount,
        apiErrorCount: (existingMetrics.apiErrorCount || 0) + networkErrorCount,
        errorCount: (existingMetrics.errorCount || 0) + errorCount,
        customEventCount: (existingMetrics.customEventCount || 0) + customEventCount,
    };

    if (networkDurationCount > 0) {
        const currentTotalCalls = existingMetrics.apiTotalCount || 0;
        const currentAvg = existingMetrics.apiAvgResponseMs || 0;
        const currentTotalDuration = currentAvg * currentTotalCalls;
        const newTotalDuration = currentTotalDuration + networkTotalDuration;
        const newTotalCalls = currentTotalCalls + networkDurationCount;
        updates.apiAvgResponseMs = newTotalDuration / newTotalCalls;
    }



    // Store app startup time if captured
    if (appStartupTimeMs !== null) {
        updates.appStartupTimeMs = appStartupTimeMs;
    }

    const normalizedScreenPath = normalizeScreenPath(screenPath, { maxLength: MAX_SCREEN_PATH_LENGTH });
    if (normalizedScreenPath.length > 0) {
        const existingScreens = (existingMetrics.screensVisited as string[]) || [];
        updates.screensVisited = mergeScreenPaths(existingScreens, normalizedScreenPath, MAX_SCREEN_PATH_LENGTH);
    }

    // Compute UX score
    let uxScore = 100;
    uxScore -= Math.min(updates.rageTapCount * 15, 45);
    uxScore -= Math.min(updates.deadTapCount * 8, 24);
    uxScore -= Math.min(updates.errorCount * 10, 30);
    uxScore -= Math.min(updates.apiErrorCount * 5, 20);
    uxScore += Math.min((updates.touchCount || 0) + (updates.scrollCount || 0), 10);
    uxScore = Math.max(0, Math.min(100, Math.round(uxScore)));

    const interactionScore = Math.min(100, updates.touchCount * 2 + updates.scrollCount * 2 + updates.gestureCount * 3);
    const screensForScore = (updates.screensVisited as string[]) || (existingMetrics.screensVisited as string[]) || [];
    const explorationScore = Math.min(100, getUniqueScreenCount(screensForScore) * 20);

    updates.uxScore = uxScore;
    updates.interactionScore = interactionScore;
    updates.explorationScore = explorationScore;

    // Track artifact size
    updates.eventsSizeBytes = (existingMetrics.eventsSizeBytes || 0) + data.length;

    await db.update(sessionMetrics).set(updates).where(eq(sessionMetrics.sessionId, job.sessionId));

    // Batch upsert endpoint stats (single transaction)
    if (Object.keys(endpointStats).length > 0) {
        const today = new Date().toISOString().split('T')[0];
        for (const [endpoint, stats] of Object.entries(endpointStats)) {
            await db.insert(apiEndpointDailyStats).values({
                projectId,
                date: today as any,
                endpoint,
                region: 'unknown', // Default region - will be enriched later if geo data available
                totalCalls: BigInt(stats.calls),
                totalErrors: BigInt(stats.errors),
                sumLatencyMs: BigInt(Math.round(stats.latencySum)),
                statusCodeBreakdown: stats.statusCodeBreakdown,
            }).onConflictDoUpdate({
                target: [apiEndpointDailyStats.projectId, apiEndpointDailyStats.date, apiEndpointDailyStats.endpoint, apiEndpointDailyStats.region],
                set: {
                    totalCalls: sql`${apiEndpointDailyStats.totalCalls} + ${stats.calls}`,
                    totalErrors: sql`${apiEndpointDailyStats.totalErrors} + ${stats.errors}`,
                    sumLatencyMs: sql`${apiEndpointDailyStats.sumLatencyMs} + ${Math.round(stats.latencySum)}`,
                    statusCodeBreakdown: sql`(
                        SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
                        FROM (
                            SELECT key, SUM(value::int) AS value
                            FROM (
                                SELECT * FROM jsonb_each_text(COALESCE(${apiEndpointDailyStats.statusCodeBreakdown}, '{}'::jsonb))
                                UNION ALL
                                SELECT * FROM jsonb_each_text(${JSON.stringify(stats.statusCodeBreakdown)}::jsonb)
                            ) AS combined
                            GROUP BY key
                        ) AS aggregated
                    )`,
                    updatedAt: new Date(),
                }
            });
        }
    }

    await writeApiEndpointEventsToClickHouse({
        artifactId: job.artifactId,
        rows: clickHouseApiEndpointRows,
    });

    // Batch upsert screen touch heatmap data
    if (Object.keys(screenHeatmapData).length > 0) {
        const sessionDate = new Date().toISOString().split('T')[0];
        for (const [screenName, heatmapStats] of Object.entries(screenHeatmapData)) {
            if (heatmapStats.totalTouches > 0 || heatmapStats.totalRageTaps > 0) {
                // === DATABASE PERSISTENCE (Postgres) ===
                try {
                    // Use atomic SQL update with JSONB merge logic to avoid OOM for large heatmaps
                    // This pushes the aggregation work to the database instead of Node.js RAM
                    await db.insert(screenTouchHeatmaps)
                        .values({
                            projectId,
                            screenName,
                            date: sessionDate as any,
                            touchBuckets: heatmapStats.touchBuckets,
                            rageTapBuckets: heatmapStats.rageTapBuckets,
                            totalTouches: heatmapStats.totalTouches,
                            totalRageTaps: heatmapStats.totalRageTaps,
                            sampleSessionId: job.sessionId,
                            screenFirstSeenMs: heatmapStats.firstSeenMs,
                            pageWidth: heatmapStats.pageWidth,
                            pageHeight: heatmapStats.pageHeight,
                            viewportWidth: heatmapStats.viewportWidth,
                            viewportHeight: heatmapStats.viewportHeight,
                            updatedAt: new Date(),
                        })
                        .onConflictDoUpdate({
                            target: [screenTouchHeatmaps.projectId, screenTouchHeatmaps.screenName, screenTouchHeatmaps.date],
                            set: {
                                // Merge and sum JSONB keys directly in SQL
                                touchBuckets: sql`(
                                    SELECT jsonb_object_agg(key, value)
                                    FROM (
                                        SELECT key, SUM(value::int) as value
                                        FROM (
                                            SELECT * FROM jsonb_each_text(${screenTouchHeatmaps.touchBuckets}::jsonb)
                                            UNION ALL
                                            SELECT * FROM jsonb_each_text(EXCLUDED.touch_buckets::jsonb)
                                        ) AS combined
                                        GROUP BY key
                                    ) AS aggregated
                                )`,
                                rageTapBuckets: sql`(
                            SELECT jsonb_object_agg(key, value)
                                    FROM(
                                SELECT key, SUM(value:: int) as value
                                        FROM(
                                    SELECT * FROM jsonb_each_text(${screenTouchHeatmaps.rageTapBuckets}:: jsonb)
                                            UNION ALL
                                            SELECT * FROM jsonb_each_text(EXCLUDED.rage_tap_buckets:: jsonb)
                                ) AS combined
                                        GROUP BY key
                            ) AS aggregated
                        )`,
                                totalTouches: sql`${screenTouchHeatmaps.totalTouches} + EXCLUDED.total_touches`,
                                totalRageTaps: sql`${screenTouchHeatmaps.totalRageTaps} + EXCLUDED.total_rage_taps`,
                                // Keep the earlier sample session if already present
                                sampleSessionId: sql`COALESCE(${screenTouchHeatmaps.sampleSessionId}, EXCLUDED.sample_session_id)`,
                                screenFirstSeenMs: sql`COALESCE(${screenTouchHeatmaps.screenFirstSeenMs}, EXCLUDED.screen_first_seen_ms)`,
                                pageWidth: sql`NULLIF(GREATEST(COALESCE(${screenTouchHeatmaps.pageWidth}, 0), COALESCE(EXCLUDED.page_width, 0)), 0)`,
                                pageHeight: sql`NULLIF(GREATEST(COALESCE(${screenTouchHeatmaps.pageHeight}, 0), COALESCE(EXCLUDED.page_height, 0)), 0)`,
                                viewportWidth: sql`NULLIF(GREATEST(COALESCE(${screenTouchHeatmaps.viewportWidth}, 0), COALESCE(EXCLUDED.viewport_width, 0)), 0)`,
                                viewportHeight: sql`NULLIF(GREATEST(COALESCE(${screenTouchHeatmaps.viewportHeight}, 0), COALESCE(EXCLUDED.viewport_height, 0)), 0)`,
                                updatedAt: new Date(),
                            }
                        });
                } catch (err) {
                    log.error({ err, screenName }, 'Failed to upsert screen heatmap');
                }
            }
        }
        log.debug({ screenCount: Object.keys(screenHeatmapData).length }, 'Screen touch heatmap data saved');
    }

    // Batch insert errors into errors table
    if (errorEvents.length > 0) {
        for (const errorEvent of errorEvents) {
            // Create fingerprint for grouping similar errors
            const fingerprintData = `${projectId}:${errorEvent.errorName}:${errorEvent.message} `;
            const fingerprint = createHash('sha256').update(fingerprintData).digest('hex').slice(0, 64);

            await db.insert(errors).values({
                sessionId: job.sessionId,
                projectId,
                timestamp: errorEvent.timestamp,
                errorType: errorEvent.errorType,
                errorName: errorEvent.errorName,
                message: errorEvent.message,
                stack: errorEvent.stack,
                screenName: errorEvent.screenName || undefined,
                deviceModel: deviceInfo?.model ?? 'unknown',
                osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion || 'unknown',
                appVersion: deviceInfo?.appVersion ?? 'unknown',
                fingerprint,
                status: 'open',
            });

            // Track as an issue for the Issues Feed
            trackErrorAsIssue({
                projectId,
                errorName: errorEvent.errorName,
                message: errorEvent.message,
                errorType: errorEvent.errorType,
                stack: errorEvent.stack,
                screenName: errorEvent.screenName,
                timestamp: errorEvent.timestamp,
                sessionId: job.sessionId,
                deviceModel: deviceInfo?.model,
                osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion,
                appVersion: deviceInfo?.appVersion,
                fingerprint,
            }).catch(() => { }); // Fire and forget
        }
        log.debug({ errorCount: errorEvents.length }, 'Error events saved to errors table');
    }

    // Batch insert ANRs into anrs table
    if (anrEvents.length > 0) {
        for (const anrEvent of anrEvents) {
            await db.insert(anrs).values({
                sessionId: job.sessionId,
                projectId,
                timestamp: anrEvent.timestamp,
                durationMs: anrEvent.durationMs,
                threadState: anrEvent.threadState || null,
                deviceMetadata: mergeAnrDeviceMetadata({
                    model: deviceInfo?.model,
                    osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion,
                    appVersion: deviceInfo?.appVersion,
                    screenName: anrEvent.screenName,
                }, anrEvent.stackTrace || anrEvent.threadState || null, anrEvent.rawThreadState),
                status: 'open',
                occurrenceCount: 1,
            });

            trackANRAsIssue({
                projectId,
                durationMs: anrEvent.durationMs,
                stackTrace: anrEvent.stackTrace || anrEvent.threadState,
                timestamp: anrEvent.timestamp,
                sessionId: job.sessionId,
                deviceModel: deviceInfo?.model,
                osVersion: deviceInfo?.systemVersion || deviceInfo?.osVersion,
                appVersion: deviceInfo?.appVersion,
            }).catch(() => { }); // Fire and forget
        }

        // Update ANR count in session metrics
        await db.update(sessionMetrics)
            .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + ${anrEvents.length}` })
            .where(eq(sessionMetrics.sessionId, job.sessionId));

        log.debug({ anrCount: anrEvents.length }, 'ANR events saved to anrs table');
    }

    // Process custom events and metadata
    const customEventsForStorage: any[] = [];
    const metadataUpdates: Record<string, any> = {};

    for (const event of eventsData) {
        const type = (event.type || '').toLowerCase();
        const eventName = (event.name || '').toLowerCase();

        if (type === 'session_start') {
            Object.assign(metadataUpdates, buildWebAttributionMetadata(event));
        }

        // Native SDK sends metadata as: {type: "custom", name: "$user_property", payload: "{...}"}
        // Also handle if sent directly as type: "$user_property"
        if (type === '$user_property' || eventName === '$user_property') {
            let props = event.properties || event.payload || {};
            // Native SDK sends payload as JSON string — parse it
            if (typeof props === 'string') {
                try { props = JSON.parse(props); } catch { props = {}; }
            }
            if (props.key && props.value !== undefined) {
                metadataUpdates[props.key] = props.value;
            } else {
                // Filter out internal fields before merging
                const rest = { ...props };
                delete rest.key;
                delete rest.value;
                Object.assign(metadataUpdates, rest);
            }
        }
        else if (type === 'custom' || (![
            'navigation', 'screen_view', 'motion', 'scroll_motion', 'pan_motion',
            'touch', 'tap', 'scroll', 'gesture', 'rage_tap', 'dead_tap',
            'api_call', 'network_request', 'error', 'anr',
            'keyboard_typing', 'keyboard_show', 'keyboard_hide', 'input', 'text_input',
            'app_startup', 'user_identity_changed', 'app_foreground', 'app_background', 'session_start'
        ].includes(type) && !type.startsWith('$') && !eventName.startsWith('$'))) {
            customEventsForStorage.push(event);
        }
    }

    if (customEventsForStorage.length > 0 || Object.keys(metadataUpdates).length > 0) {
        try {
            const updates: any = {};

            if (customEventsForStorage.length > 0) {
                updates.events = sql`
                    CASE 
                        WHEN jsonb_typeof(${sessions.events}) = 'array' AND jsonb_array_length(${sessions.events}) < 2000 THEN 
                            ${sessions.events} || ${JSON.stringify(customEventsForStorage)}::jsonb
                        ELSE ${sessions.events}
                    END
                `;
            }

            if (Object.keys(metadataUpdates).length > 0) {
                updates.metadata = sql`${sessions.metadata} || ${JSON.stringify(metadataUpdates)}::jsonb`;
                const webReferralForColumn = normalizeMetadataString(metadataUpdates.webReferral, 255);
                if (webReferralForColumn) {
                    updates.webReferral = webReferralForColumn;
                }
            }

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = new Date();
            }

            await db.update(sessions)
                .set(updates)
                .where(eq(sessions.id, job.sessionId));

            log.debug({
                customEventsCount: customEventsForStorage.length,
                metadataKeysCount: Object.keys(metadataUpdates).length
            }, 'Updated session custom events and metadata');
        } catch (err) {
            log.error({ err }, 'Failed to update session custom events and metadata');
        }
    }

    if (observedBackgroundTimeSeconds !== null) {
        const mergedBackgroundSeconds = sql<number>`
            GREATEST(COALESCE(${sessions.backgroundTimeSeconds}, 0), ${observedBackgroundTimeSeconds})
        `;
        const elapsedSeconds = sql<number>`
            ROUND(EXTRACT(EPOCH FROM (${sessions.endedAt} - ${sessions.startedAt})))::int
        `;

        await db.update(sessions)
            .set({
                backgroundTimeSeconds: mergedBackgroundSeconds,
                durationSeconds: sql`
                    CASE
                        WHEN ${sessions.endedAt} IS NOT NULL THEN
                            GREATEST(1, ${elapsedSeconds} - ${mergedBackgroundSeconds})
                        ELSE ${sessions.durationSeconds}
                    END
                `,
                updatedAt: new Date(),
            })
            .where(eq(sessions.id, job.sessionId));
    }

    if (earliestClientEventAt || latestClientEventAt) {
        await db.update(recordingArtifacts)
            .set({
                startTime: earliestClientEventAt?.getTime() ?? null,
                endTime: latestClientEventAt?.getTime() ?? null,
            })
            .where(eq(recordingArtifacts.id, job.artifactId));
    }

    log.debug({ eventsCount: eventsData.length, touchCount, rageTapCount }, 'Events artifact processed');
}
