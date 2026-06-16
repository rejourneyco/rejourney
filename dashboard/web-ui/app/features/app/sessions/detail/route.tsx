import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router';
import {
    ArrowLeft,
    ChevronRight,
    ChevronLeft,
    ChevronDown,
    VideoOff,
    Clock,
    Smartphone,
    Monitor,
    MonitorSmartphone,
    Zap,
    MousePointer2,
    Globe,
    AlertCircle,
    CircleX,
    Route as RouteIcon,
    Hand,
    AlertTriangle,
    Play,
    Pause,
    RotateCcw,
    RotateCw,
    Layers,
    Move,
    Maximize2,
    RefreshCw,
    GripHorizontal,
    Star,
    MapPin,
    Download,
    FileText,
    ListFilter,
    Terminal,
    Code,
    Check,
    Copy,
    Database,
    UserRound,
    Share2,
    Link2,
    Trash2,
    X,
} from 'lucide-react';
import { canOpenReplayFromSession } from '~/shared/lib/replayAvailability';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { api, type ReplayShareExpirationPreset, type ReplayShareLink, type ReplayShareVisibility } from '~/shared/api/client';
import DOMInspector, { HierarchySnapshot } from '~/shared/ui/core/DOMInspector';
import { TouchOverlay, TouchEvent as OverlayTouchEvent } from '~/shared/ui/core/TouchOverlay';
import { MarkerTooltip } from '~/shared/ui/core/MarkerTooltip';
import { SessionLoadingOverlay } from '~/features/app/sessions/shared/SessionLoadingOverlay';
import WebReplayPlayer from '~/shared/ui/core/WebReplayPlayer';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { useRrwebReplayEvents } from '~/shared/lib/rrwebReplayLoader';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';
import { getWebSessionEnvironment } from '~/shared/lib/webSessionEnvironment';
import { buildCollectedWebMetadata, getWebReferral, getWebUtmAttribution } from '~/shared/lib/webAttributionMetadata';
import {
    buildCompressedBackgroundGaps,
    compressReplayEvents,
    compressReplayTimestamp,
    expandCompressedReplayTimestamp,
    formatBackgroundGapDuration,
    isTimestampInsideCompressedBackgroundGap,
} from '~/shared/lib/replayTimeCompression';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';

// ============================================================================
// Types
// ============================================================================

interface SessionEvent {
    id?: string;
    type: string;
    name?: string;
    label?: string;
    timestamp: number;
    properties?: Record<string, any>;
    payload?: Record<string, any>;
    screen?: string;
    screenName?: string;
    url?: string;
    path?: string;
    urlPath?: string;
    urlHost?: string;
    gestureType?: string;
    frustrationKind?: string;
    targetLabel?: string;
    x?: number;
    y?: number;
    count?: number;
    touches?: Array<{ x: number; y: number; force?: number }>;
    level?: 'log' | 'warn' | 'error' | string;
    message?: string;
    stack?: string;
    rating?: number;
}

interface NetworkRequest {
    requestId: string;
    timestamp: number;
    method: string;
    url: string;
    urlPath?: string;
    urlHost?: string;
    statusCode: number;
    duration: number;
    success: boolean;
    requestBodySize?: number;
    responseBodySize?: number;
    requestSize?: number;
    responseSize?: number;
    host?: string;
    path?: string;
    errorMessage?: string;
}

interface FullSession {
    id: string;
    projectId?: string;
    userId: string;
    platform?: string;
    appVersion?: string;
    sdkVersion?: string;
    hasRecording?: boolean;
    /** Determines the visual replay renderer. */
    playbackMode?: 'screenshots' | 'rrweb' | 'none';
    deviceInfo: {
        model?: string;
        systemName?: string;
        os?: string;
        systemVersion?: string;
        osVersion?: string;
        browser?: string;
        browserVersion?: string;
        sdkVersion?: string;
        userAgent?: string;
        screenWidth?: number;
        screenHeight?: number;
        appVersion?: string;
    };
    geoInfo?: {
        city?: string;
        country?: string;
        region?: string;
    };
    geoLocation?: {
        city?: string;
        country?: string;
        region?: string;
        countryCode?: string;
        timezone?: string;
    };
    startTime: number;
    endTime?: number;
    /** Time spent in background (seconds) - excluded from playable duration */
    backgroundTime?: number;
    /** Playable duration in seconds (total duration - background time) */
    playableDuration?: number;
    events: SessionEvent[];
    networkRequests: NetworkRequest[];
    /** Screenshot frames for image-based playback (primary) */
    screenshotFrames?: {
        timestamp: number;
        url: string;
        proxyUrl?: string | null;
        index: number;
    }[];
    screenshotFramesStatus?: 'ready' | 'preparing' | 'none';
    screenshotFrameCount?: number;
    screenshotFramesProcessedSegments?: number;
    screenshotFramesTotalSegments?: number;
    rrwebReplay?: {
        events: any[];
        eventCount: number;
        segments: Array<{
            index: number;
            startTime: number | null;
            endTime: number | null;
            eventCount: number;
            sizeBytes: number | null;
            url: string | null;
        }>;
        page?: Record<string, unknown> | null;
        viewport?: Record<string, unknown> | null;
        /**
         * 'inline' — events array is server-populated (small sessions).
         * 'segments' — events array is empty; fetch each segment URL directly
         *              from R2 in parallel via loadRrwebSegmentsFromUrls().
         *              Used for sessions >~2MB so the dashboard pod isn't a bottleneck.
         */
        loadMode?: 'inline' | 'segments';
    };
    hierarchySnapshots?: {
        timestamp: number;
        screenName: string | null;
        screen?: { width?: number; height?: number; scale?: number };
        rootElement: any;
    }[];
    crashes?: {
        id: string;
        timestamp: number;
        exceptionName: string;
        reason: string;
        stackTrace?: string;
        status?: string;
    }[];
    anrs?: {
        id?: string;
        timestamp: number;
        durationMs?: number;
        threadState?: string;
        status?: string;
    }[];
    metrics?: {
        touchCount?: number;
        scrollCount?: number;
        gestureCount?: number;
        errorCount?: number;
        rageTapCount?: number;
        screensVisited?: string[];
        totalScreens?: number;
        interactionScore?: number;
    };
    interactionScore?: number;
    touchCount?: number;
    scrollCount?: number;
    gestureCount?: number;
    errorCount?: number;
    rageTapCount?: number;
    stats: {
        duration: string;
        eventCount: number;
        frameCount: number;
        networkStats?: {
            total: number;
            successful: number;
            failed: number;
            avgDuration: number;
        };
        totalSizeBytes?: number;
        eventsSizeBytes?: number;
        screenshotSizeBytes?: number;
        hierarchySizeBytes?: number;
        networkSizeBytes?: number;
        totalSizeKB?: string;
        eventsSizeKB?: string;
        screenshotSizeKB?: string;
        hierarchySizeKB?: string;
        networkSizeKB?: string;
        screenshotSegmentCount?: number;
    };
    screenCount?: number;
    screensVisited?: string[];
    webReferral?: string | null;
    webLandingRoute?: string | null;
    metadata?: Record<string, unknown>;
    share?: {
        visibility?: ReplayShareVisibility;
        expiresAt?: string | null;
    };
}

// ============================================================================
// Event Styling
// ============================================================================

function readSessionMetadataString(session: any, keys: string[]): string | null {
    const metadata = session?.metadata;
    if (!metadata || typeof metadata !== 'object') return null;
    for (const key of keys) {
        const value = metadata[key];
        if (value === null || value === undefined) continue;
        const normalized = String(value).trim();
        if (normalized) return normalized;
    }
    return null;
}

function normalizeReplayUrlLabel(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    try {
        const parsed = new URL(raw);
        return `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return raw;
    }
}

function getInitialRrwebReplayUrl(session: any): string | null {
    const rrwebEvents = session?.rrwebReplay?.events;
    if (!Array.isArray(rrwebEvents)) return null;

    for (const event of rrwebEvents) {
        const data = event?.data && typeof event.data === 'object' ? event.data : null;
        const normalized = normalizeReplayUrlLabel(data?.href ?? data?.url);
        if (normalized) return normalized;
    }

    return null;
}

function getWebReplayUrlFallback(session: any): string {
    const candidates = [
        session?.webEntryUrl,
        readSessionMetadataString(session, ['webEntryUrl']),
        getInitialRrwebReplayUrl(session),
        session?.webLandingRoute,
        readSessionMetadataString(session, ['webLandingRoute', 'webEntryPath']),
    ];

    for (const candidate of candidates) {
        const normalized = normalizeReplayUrlLabel(candidate);
        if (normalized) return normalized;
    }

    return '/';
}

function getReplayUrlFromEvent(event: SessionEvent): string | null {
    const properties = event.properties && typeof event.properties === 'object' ? event.properties : {};
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const candidates = [
        event.url,
        properties.url,
        payload.url,
        event.path,
        properties.path,
        payload.path,
        event.urlPath,
        properties.urlPath,
        payload.urlPath,
        event.screenName,
        properties.screenName,
        payload.screenName,
        event.screen,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeReplayUrlLabel(candidate);
        if (normalized) return normalized;
    }

    return null;
}

const EVENT_COLORS = {
    error: '#ef4444',
    apiError: '#ef4444',
    rageTap: '#f43f5e',
    deadTap: '#94a3b8',
    crash: '#b91c1c',
    anr: '#a855f7',
    apiSuccess: '#15803d',
    tap: '#3b82f6',
    scroll: '#3b82f6',
    gesture: '#3b82f6',
    swipe: '#3b82f6',
    pinch: '#3b82f6',
    pan: '#3b82f6',
    rotation: '#ec4899',
    appBackground: '#db2777',
    appForeground: '#047857',
    sessionStart: '#06b6d4',
    navigation: '#8b5cf6',
    deviceInfo: '#64748b',
    log: '#2563eb',
    custom: '#8b5cf6',
    default: '#6b7280',
} as const;

const normalizeEventType = (value: unknown): string =>
    typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';

const titleCaseToken = (value: string): string =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const getEventGestureKind = (event: SessionEvent): string => {
    const type = normalizeEventType(event.type);
    const gestureType = normalizeEventType(event.gestureType || event.properties?.gestureType || event.payload?.gestureType);
    const frustrationKind = normalizeEventType(event.frustrationKind || event.properties?.frustrationKind || event.payload?.frustrationKind);

    if (type === 'dead_tap' || gestureType === 'dead_tap' || frustrationKind === 'dead_tap') return 'dead_tap';
    if (type === 'rage_tap' || gestureType === 'rage_tap' || frustrationKind === 'rage_tap' || Boolean(frustrationKind)) return 'rage_tap';
    if (gestureType) return gestureType;
    if (type === 'tap' || type === 'touch') return 'tap';
    if (type === 'scroll') return 'scroll';
    if (type === 'gesture') return 'touch';
    return '';
};

const getGestureDisplayLabel = (event: SessionEvent): string | null => {
    const kind = getEventGestureKind(event);
    if (!kind) return null;

    if (kind === 'rage_tap') return 'Rage Tap';
    if (kind === 'dead_tap') return 'Dead Tap';
    if (kind.includes('double_tap')) return 'Double Tap';
    if (kind.includes('long_press')) return 'Long Press';
    if (kind.includes('tap')) return 'Tap';

    const direction = ['up', 'down', 'left', 'right'].find((part) => kind.endsWith(`_${part}`));
    const directionSuffix = direction ? ` ${titleCaseToken(direction)}` : '';

    if (kind.includes('scroll')) return `Scroll${directionSuffix}`;
    if (kind.includes('swipe')) return `Swipe${directionSuffix}`;
    if (kind.includes('pinch') || kind.includes('zoom')) return 'Pinch Zoom';
    if (kind.includes('rotat')) return 'Rotate';
    if (kind.includes('pan') || kind.includes('drag')) return `Pan${directionSuffix}`;
    if (kind === 'touch') return 'Touch';

    return kind.split('_').filter(Boolean).map(titleCaseToken).join(' ');
};

const isGestureEvent = (event: SessionEvent): boolean => {
    const type = normalizeEventType(event.type);
    return Boolean(getEventGestureKind(event)) || type === 'gesture' || type === 'touch';
};

const isFrustrationEvent = (event: SessionEvent): boolean => {
    const kind = getEventGestureKind(event);
    return kind === 'rage_tap' || kind === 'dead_tap';
};

const isAppBackgroundEvent = (event: SessionEvent): boolean =>
    normalizeEventType(event.type) === 'app_background';

const isAppForegroundEvent = (event: SessionEvent): boolean => {
    const type = normalizeEventType(event.type);
    return type === 'app_foreground' || type === 'session_start';
};

const isRouteNavigationEvent = (event: SessionEvent): boolean => {
    const type = normalizeEventType(event.type);
    return type === 'navigation' || type === 'screen_view';
};

const getEventColor = (event: SessionEvent): string => {
    const type = normalizeEventType(event.type);
    const gestureType = getEventGestureKind(event);

    if (gestureType === 'dead_tap') return EVENT_COLORS.deadTap;
    if (gestureType === 'rage_tap') return EVENT_COLORS.rageTap;
    if (type === 'crash') return EVENT_COLORS.crash;
    if (type === 'anr') return EVENT_COLORS.anr;
    if (type === 'error') return EVENT_COLORS.error;
    if (type === 'network_request') {
        const success = event.properties?.success ?? (event.properties?.statusCode < 400);
        return success ? EVENT_COLORS.apiSuccess : EVENT_COLORS.apiError;
    }
    if (isLogEvent(event)) return EVENT_COLORS.log;
    if (type === 'app_foreground' || type === 'session_start') return EVENT_COLORS.appForeground;
    if (type === 'app_background') return EVENT_COLORS.appBackground;
    if (type === 'navigation' || type === 'screen_view') return EVENT_COLORS.navigation;
    if (type === 'device_info') return EVENT_COLORS.deviceInfo;
    if (type === 'custom') return EVENT_COLORS.custom;

    // Gesture-specific colors (check gestureType first, then fall back to type)
    if (gestureType.includes('pinch') || gestureType.includes('zoom')) return EVENT_COLORS.pinch;
    if (gestureType.includes('rotat')) return EVENT_COLORS.rotation;
    if (gestureType.includes('pan')) return EVENT_COLORS.pan;
    if (gestureType.includes('swipe')) return EVENT_COLORS.swipe;
    if (gestureType.includes('scroll') || type === 'scroll') return EVENT_COLORS.scroll;
    if (gestureType.includes('tap') || type === 'tap' || type === 'touch') return EVENT_COLORS.tap;

    return EVENT_COLORS.default;
};

const getEventIcon = (event: SessionEvent) => {
    const type = normalizeEventType(event.type);
    const gestureType = getEventGestureKind(event);

    if (type === 'crash' || type === 'error' || type === 'anr') return AlertCircle;
    if (type === 'network_request') return Globe;
    if (isLogEvent(event)) return FileText;
    if (isRouteNavigationEvent(event)) return RouteIcon;
    if (isAppForegroundEvent(event) || type === 'app_background') return Play;
    if (type === 'device_info') return Smartphone;
    if (type === 'custom') return Star;
    if (gestureType === 'dead_tap') return CircleX;
    if (gestureType === 'rage_tap') return Zap;
    if (gestureType.includes('pinch') || gestureType.includes('zoom')) return Maximize2;
    if (gestureType.includes('rotat')) return RefreshCw;
    if (gestureType.includes('swipe')) return Move;
    if (gestureType.includes('pan') || gestureType.includes('drag')) return GripHorizontal;
    if (gestureType.includes('scroll') || type === 'scroll') return MousePointer2;
    if (gestureType.includes('long_press')) return Hand;
    if (gestureType.includes('tap') || type === 'tap' || type === 'touch') return Hand;

    return Monitor;
};

const getTimelineMarkerPriority = (event: SessionEvent): number => {
    const type = normalizeEventType(event.type);
    if (type === 'crash' || type === 'anr') return 5;
    if (type === 'error' || isFrustrationEvent(event)) return 4;
    if (type === 'network_request' && !(event.properties?.success ?? true)) return 3;
    if (type === 'navigation' || type === 'screen_view') return 2;
    if (isGestureEvent(event)) return 1;
    return 0;
};

const percentile = (values: number[], percentileValue: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const clampedPercentile = Math.max(0, Math.min(100, percentileValue));
    const index = Math.min(
        sorted.length - 1,
        Math.ceil((clampedPercentile / 100) * sorted.length) - 1
    );
    return sorted[Math.max(0, index)];
};

const getOrdinal = (n: number): string => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

const formatBytesToHuman = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${kb.toFixed(1)} KB`;
};

const parseKilobytesToBytes = (value: unknown): number | null => {
    const kb = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
    return Number.isFinite(kb) && kb >= 0 ? kb * 1024 : null;
};

const getCompressedStorageBytes = (stats: FullSession['stats'] | undefined): number => {
    if (!stats) return 0;

    if (typeof stats.totalSizeBytes === 'number' && Number.isFinite(stats.totalSizeBytes)) {
        return Math.max(0, stats.totalSizeBytes);
    }

    const totalFromKb = parseKilobytesToBytes(stats.totalSizeKB);
    if (totalFromKb != null) return totalFromKb;

    const knownKindBytes = [
        stats.eventsSizeBytes,
        stats.screenshotSizeBytes,
        stats.hierarchySizeBytes,
        stats.networkSizeBytes,
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

    if (knownKindBytes.length > 0) {
        return knownKindBytes.reduce((sum, value) => sum + value, 0);
    }

    return [
        stats.eventsSizeKB,
        stats.screenshotSizeKB,
        stats.hierarchySizeKB,
        stats.networkSizeKB,
    ].reduce((sum, value) => sum + (parseKilobytesToBytes(value) ?? 0), 0);
};

const formatCountCompact = (count: number): string => {
    if (!Number.isFinite(count)) return '0';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(Math.round(count));
};

// Upper bound for any playback clock. Real replay sessions never approach this,
// so it doubles as a guard against absolute timestamps (epoch seconds/ms) leaking
// in where a relative offset is expected — those would otherwise render as an
// absurd minute count (e.g. an epoch value formatting as "29667882:55").
const MAX_PLAYBACK_CLOCK_SECONDS = 24 * 60 * 60; // 24h

const formatPlaybackClock = (seconds: number): string => {
    if (!Number.isFinite(seconds)) return '00:00';
    // Clamp negatives to 0 and cap implausibly large values so a stray absolute
    // timestamp can never produce a giant, impossible clock readout.
    const clamped = Math.min(Math.max(0, seconds), MAX_PLAYBACK_CLOCK_SECONDS);
    const totalSecs = Math.floor(clamped);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isFaultType = (type: string): boolean =>
    type === 'crash' || type === 'anr' || type === 'error';

const isFaultEvent = (event: SessionEvent): boolean => {
    const type = (event.type || '').toLowerCase();
    return isFaultType(type);
};

const getFaultMarker = (event: SessionEvent): 'CRASH' | 'ANR' | 'ERROR' | null => {
    const type = (event.type || '').toLowerCase();
    if (type === 'crash') return 'CRASH';
    if (type === 'anr') return 'ANR';
    if (type === 'error') return 'ERROR';
    return null;
};

const getEventStackTrace = (event: SessionEvent): string | null => {
    const stackCandidate =
        event.stack ||
        event.properties?.stackTrace ||
        event.properties?.threadState ||
        event.properties?.stack ||
        event.payload?.stack ||
        null;
    if (typeof stackCandidate !== 'string' || !stackCandidate.trim()) return null;
    const lines = stackCandidate.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const maxLines = 18;
    const truncated = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
        truncated.push(`... (+${lines.length - maxLines} more lines)`);
    }
    return truncated.join('\n');
};

const getFaultConsoleSummary = (event: SessionEvent): string => {
    const marker = getFaultMarker(event);
    if (marker === 'CRASH') {
        const exceptionName = event.properties?.exceptionName || event.name || 'Crash';
        const reason = event.properties?.reason || event.message || '';
        return reason ? `${exceptionName}: ${reason}` : String(exceptionName);
    }
    if (marker === 'ANR') {
        const durationMs = event.properties?.durationMs;
        if (typeof durationMs === 'number' && durationMs > 0) {
            return `ANR detected (${durationMs} ms blocked)`;
        }
        return event.message || 'ANR detected';
    }
    if (marker === 'ERROR') {
        const errorName = event.properties?.errorName || event.name || 'Error';
        const message = event.properties?.message || event.message || '';
        return message ? `${errorName}: ${message}` : String(errorName);
    }
    return event.message || event.properties?.message || event.name || 'Log entry';
};

const getFaultBadgeStyles = (marker: 'CRASH' | 'ANR' | 'ERROR'): string => {
    if (marker === 'CRASH') return 'bg-red-100 text-red-700 border-red-300';
    if (marker === 'ANR') return 'bg-violet-100 text-violet-700 border-violet-300';
    return 'bg-pink-100 text-pink-700 border-pink-300';
};

const getFaultTerminalClass = (marker: 'CRASH' | 'ANR' | 'ERROR'): string => {
    if (marker === 'CRASH') return 'text-red-300';
    if (marker === 'ANR') return 'text-violet-300';
    return 'text-pink-300';
};

const buildFaultEventDedupKey = (event: SessionEvent): string | null => {
    const type = (event.type || '').toLowerCase();
    if (!isFaultType(type)) return null;
    const roundedTs = Number.isFinite(event.timestamp)
        ? Math.round(event.timestamp / 250) * 250
        : 0;
    const name = String(
        event.name ||
        event.properties?.errorName ||
        event.properties?.exceptionName ||
        ''
    ).trim().toLowerCase();
    const message = String(
        event.message ||
        event.properties?.message ||
        event.properties?.reason ||
        ''
    ).trim().toLowerCase().slice(0, 180);
    const stack = getEventStackTrace(event);
    const stackHead = stack ? stack.split('\n')[0].trim().toLowerCase().slice(0, 180) : '';
    return `${type}|${roundedTs}|${name}|${message}|${stackHead}`;
};

const mergeTimelineEvents = (
    primaryEvents: SessionEvent[],
    fallbackFaultEvents: SessionEvent[]
): SessionEvent[] => {
    const seenFaultKeys = new Set<string>();
    for (const event of primaryEvents) {
        const key = buildFaultEventDedupKey(event);
        if (key) seenFaultKeys.add(key);
    }

    const merged: SessionEvent[] = [...primaryEvents];
    for (const fallbackEvent of fallbackFaultEvents) {
        const key = buildFaultEventDedupKey(fallbackEvent);
        if (key && seenFaultKeys.has(key)) continue;
        if (key) seenFaultKeys.add(key);
        merged.push(fallbackEvent);
    }

    return merged.sort((a, b) => a.timestamp - b.timestamp);
};

const getLogLevel = (event: SessionEvent): string => {
    if (isFaultEvent(event)) return 'error';
    const type = (event.type || '').toLowerCase();
    if (type === 'network_request') {
        const statusCode = Number(event.properties?.statusCode);
        const success = event.properties?.success ?? (Number.isFinite(statusCode) ? statusCode < 400 : true);
        return success ? 'log' : 'error';
    }

    const level =
        event.level ||
        event.properties?.level ||
        event.properties?.severity ||
        event.properties?.logLevel ||
        'log';
    return String(level).toLowerCase();
};

const isLogEvent = (event: SessionEvent): boolean => {
    const type = (event.type || '').toLowerCase();
    if (isFaultType(type)) return true;
    return (
        type === 'log' ||
        type === 'console_log' ||
        type === 'console' ||
        type === 'console.warn' ||
        type === 'console.error'
    );
};

const isConsoleSupplementEvent = (event: SessionEvent): boolean => {
    const type = (event.type || '').toLowerCase();
    return (
        type === 'network_request' ||
        type === 'navigation' ||
        type === 'screen_view' ||
        type === 'app_foreground' ||
        type === 'app_background' ||
        type === 'app_terminated' ||
        type === 'session_end'
    );
};

const formatConsoleMessage = (event: SessionEvent): string => {
    const type = (event.type || '').toLowerCase();

    if (type === 'network_request') {
        const method = String(event.name || event.properties?.method || 'GET').toUpperCase();
        const endpoint = event.properties?.urlPath || event.properties?.url || event.targetLabel || 'request';
        const statusCode = event.properties?.statusCode;
        const duration = event.properties?.duration;
        const statusPart = statusCode ? ` -> ${statusCode}` : '';
        const durationPart = typeof duration === 'number' && duration >= 0 ? ` (${Math.round(duration)} ms)` : '';
        return `${method} ${endpoint}${statusPart}${durationPart}`;
    }

    if (type === 'navigation' || type === 'screen_view') {
        const targetScreen = event.screen || event.name || event.properties?.screen || event.targetLabel || 'unknown';
        return `Navigated to ${targetScreen}`;
    }

    if (type === 'app_foreground') return 'App entered foreground';
    if (type === 'app_background') return 'App moved to background';
    if (type === 'app_terminated' || type === 'session_end') return 'Session ended';

    return (
        event.message ||
        event.properties?.message ||
        event.name ||
        event.targetLabel ||
        JSON.stringify(event.properties || {})
    );
};

const getActivityEventTitle = (event: SessionEvent): string => {
    const type = normalizeEventType(event.type);
    const marker = getFaultMarker(event);
    const gestureLabel = getGestureDisplayLabel(event);
    if (gestureLabel) return gestureLabel;

    if (type === 'network_request') {
        return `${event.name || event.properties?.method || 'API Request'}`;
    }
    if (marker) return `Fault ${marker}`;
    if (isLogEvent(event)) return `Console ${getLogLevel(event)}`;
    if (type === 'custom') return event.name || 'Custom Event';
    if (type === 'navigation' || type === 'screen_view') return 'Navigation';
    if (type === 'app_foreground') return 'App Foreground';
    if (type === 'app_background') return 'App Background';

    return (event.type || 'event').replace(/_/g, ' ');
};

const toDisplayString = (value: unknown): string | null => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed && trimmed !== '{}' ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
};

const getNavigationRouteName = (event: SessionEvent): string => {
    const properties = event.properties || {};
    const payload = event.payload || {};
    const candidates = [
        event.screenName,
        event.screen,
        event.name,
        properties.screenName,
        properties.screen,
        properties.toScreen,
        properties.routeName,
        properties.route_screen,
        properties.path,
        properties.pathname,
        properties.urlPath,
        payload.screenName,
        payload.screen,
        payload.toScreen,
        payload.routeName,
        payload.path,
        payload.pathname,
        payload.urlPath,
        event.urlPath,
        event.path,
        event.targetLabel,
    ];

    for (const candidate of candidates) {
        const value = toDisplayString(candidate);
        if (value && normalizeEventType(value) !== 'navigation') return value;
    }

    return getReplayUrlFromEvent(event) || 'Unknown route';
};

const getEventTargetSummary = (event: SessionEvent): string | null => {
    const properties = event.properties || {};
    const genericNames = new Set(['gesture', 'tap', 'touch', 'rage_tap', 'dead_tap']);
    const name = toDisplayString(event.name);
    const candidates = [
        event.targetLabel,
        event.label,
        properties.targetLabel,
        properties.label,
        properties.target,
        properties.accessibilityLabel,
        properties.elementLabel,
        properties.buttonText,
        properties.text,
        properties.title,
        properties.viewName,
        name && !genericNames.has(normalizeEventType(name)) ? name : null,
    ];

    for (const candidate of candidates) {
        const value = toDisplayString(candidate);
        if (value) return value;
    }
    return null;
};

const getEventTouchSummary = (event: SessionEvent): string | null => {
    const firstTouch = getEventFirstTouchPoint(event);
    if (!firstTouch) return null;

    const rawTouches = event.touches || event.properties?.touches || event.payload?.touches || [];
    const touches = Array.isArray(rawTouches) ? rawTouches : [];
    const point = `x ${Math.round(firstTouch.x)}, y ${Math.round(firstTouch.y)}`;
    return touches.length > 1 ? `${touches.length} touches at ${point}` : `Touch at ${point}`;
};

const getEventFirstTouchPoint = (event: SessionEvent): { x: number; y: number } | null => {
    const rawTouches = event.touches || event.properties?.touches || event.payload?.touches || [];
    const touches = Array.isArray(rawTouches) ? rawTouches : [];
    const firstTouch = touches[0];

    const x = Number(firstTouch?.x ?? event.x ?? event.properties?.x ?? event.payload?.x);
    const y = Number(firstTouch?.y ?? event.y ?? event.properties?.y ?? event.payload?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
};

const isKeyboardAreaEvent = (event: SessionEvent): boolean => {
    // Dashboard-side mirror of backend compatibility logic. Already-shipped
    // Swift 0.2.x / RN 1.2.x sessions may only have UIKit keyboard labels in
    // raw touch artifacts; filter those from replay rage inference without
    // hiding ordinary app UI that mentions keyboards.
    const properties = event.properties || {};
    const payload = event.payload || {};
    const labelText = [
        event.label,
        event.name,
        event.targetLabel,
        properties.label,
        properties.targetLabel,
        properties.target,
        payload.label,
        payload.targetLabel,
        payload.target,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return labelText.includes('uikeyboard') ||
        labelText.includes('uiinputset') ||
        labelText.includes('uitexteffects') ||
        labelText.includes('uiremotekeyboard');
};

const getEventScreenSummary = (event: SessionEvent): string | null => {
    const properties = event.properties || {};
    const candidates = [
        event.screenName,
        event.screen,
        properties.screenName,
        properties.screen,
        properties.toScreen,
        properties.routeName,
        properties.viewController,
        properties.urlPath,
    ];

    for (const candidate of candidates) {
        const value = toDisplayString(candidate);
        if (value) return value;
    }
    return null;
};

const getReadablePropertiesSummary = (properties: Record<string, any> | undefined): string | null => {
    if (!properties || typeof properties !== 'object') return null;
    const ignoredKeys = new Set(['touches', 'targetLabel', 'gestureType', 'frustrationKind']);
    const parts = Object.entries(properties)
        .filter(([key, value]) => {
            if (ignoredKeys.has(key)) return false;
            if (value == null || value === '') return false;
            if (Array.isArray(value) && value.length === 0) return false;
            if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
            return true;
        })
        .slice(0, 3)
        .map(([key, value]) => {
            const label = key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim().toLowerCase();
            const display = toDisplayString(value) || (typeof value === 'object' ? JSON.stringify(value) : String(value));
            return `${label}: ${display}`;
        });

    return parts.length > 0 ? parts.join(' · ') : null;
};

const canNavigateToReplaySession = (session: any): boolean => {
    if (canOpenReplayFromSession(session)) return true;
    if (
        !session
        || session.canOpenReplay === false
        || (session.replayRetentionState && session.replayRetentionState !== 'saved')
        || session.smartCaptureStatus === 'discarded'
        || session.replayAvailable === false
        || session.recordingDeleted
        || session.isReplayExpired
    ) {
        return false;
    }
    if (session.hasRecording !== undefined) return Boolean(session.hasRecording);
    if (session.playbackMode && session.playbackMode !== 'none') return true;
    return Number(session.stats?.screenshotSegmentCount ?? 0) > 0;
};

const getActivityEventDetail = (event: SessionEvent): string | null => {
    const type = normalizeEventType(event.type);
    const marker = getFaultMarker(event);
    if (marker) return getFaultConsoleSummary(event);
    if (isLogEvent(event)) return event.message || event.properties?.message || event.name || 'Console message';

    if (type === 'network_request') {
        return event.properties?.urlPath || event.properties?.url || null;
    }

    const target = getEventTargetSummary(event);
    if (target) return target;

    if (isGestureEvent(event)) {
        const kind = getEventGestureKind(event);
        const touch = getEventTouchSummary(event);
        const screen = getEventScreenSummary(event);
        const context = [touch, screen ? `on ${screen}` : null].filter(Boolean).join(' · ');

        if (kind === 'rage_tap') {
            return context ? `Repeated taps in the same area · ${context}` : 'Repeated taps in the same area';
        }
        if (kind === 'dead_tap') {
            return context ? `Tap with no detected response · ${context}` : 'Tap with no detected response';
        }
        return context || null;
    }

    return getEventScreenSummary(event) || getReadablePropertiesSummary(event.properties);
};

const getTimelineMarkerType = (event: SessionEvent): string => {
    const gestureLabel = getGestureDisplayLabel(event);
    if (gestureLabel) return gestureLabel.toLowerCase().replace(/\s+/g, '_');
    return normalizeEventType(event.type) || 'event';
};

const createTimelineMarkerCounts = (): TimelineMarkerCounts => ({
    friction: 0,
    rageTap: 0,
    deadTap: 0,
    fault: 0,
    gesture: 0,
    api: 0,
    background: 0,
    navigation: 0,
    log: 0,
    other: 0,
});

const getTimelineMarkerCategory = (event: SessionEvent): TimelineMarkerCategory => {
    const type = normalizeEventType(event.type);
    const gestureKind = getEventGestureKind(event);
    if (gestureKind === 'rage_tap') return 'rageTap';
    if (gestureKind === 'dead_tap') return 'deadTap';
    if (isFaultEvent(event)) return 'fault';
    if (isGestureEvent(event)) return 'gesture';
    if (type === 'network_request') return 'api';
    if (isAppBackgroundEvent(event)) return 'background';
    if (type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background') return 'navigation';
    if (isLogEvent(event)) return 'log';
    return 'other';
};

const TIMELINE_MARKER_COUNT_LABELS: Array<[TimelineMarkerCategory, string, string]> = [
    ['rageTap', 'rage tap', 'rage taps'],
    ['deadTap', 'dead tap', 'dead taps'],
    ['fault', 'fault', 'faults'],
    ['gesture', 'gesture', 'gestures'],
    ['api', 'API', 'API'],
    ['background', 'background', 'background'],
    ['navigation', 'navigation', 'navigation'],
    ['log', 'log', 'logs'],
    ['other', 'event', 'events'],
];

const getTimelineMarkerCountSummary = (marker: TimelineMarkerView): string => {
    const parts = TIMELINE_MARKER_COUNT_LABELS
        .map(([category, singular, plural]) => {
            const count = marker.counts[category];
            if (!count) return null;
            const label = count === 1 ? singular : plural;
            return `${formatCountCompact(count)} ${label}`;
        })
        .filter(Boolean);
    return parts.join(' · ');
};

/** One-line summary for timeline export (all event types). */
const formatTimelineEventForExport = (event: SessionEvent): string => {
    const isoTime = new Date(event.timestamp).toISOString();
    const marker = getFaultMarker(event);
    const isLog = isLogEvent(event);
    const isNetwork = (event.type || '').toLowerCase() === 'network_request';
    const typeLabel = getActivityEventTitle(event);
    const summary = marker
        ? getFaultConsoleSummary(event)
        : isLog || isNetwork
            ? formatConsoleMessage(event)
            : getActivityEventDetail(event);
    const stack = getEventStackTrace(event);
    const message = stack ? `${summary || typeLabel}\n${stack}` : (summary || typeLabel);
    return `[${isoTime}] [${typeLabel}] ${message}`;
};

const isFeedbackType = (type: string): boolean =>
    type === 'feedback' || type === 'user_feedback';

const getLogBadgeStyles = (level: string): string => {
    if (level === 'error') return 'bg-red-50 text-red-700 border-red-200';
    if (level === 'warn' || level === 'warning') return 'bg-pink-50 text-pink-700 border-pink-200';
    return 'bg-blue-50 text-blue-700 border-blue-200';
};

const getTerminalLevelClass = (level: string): string => {
    if (level === 'error') return 'text-red-300';
    if (level === 'warn' || level === 'warning') return 'text-pink-300';
    return 'text-emerald-300';
};

type InsightLevel = 'good' | 'warning' | 'critical' | 'neutral';

const INSIGHT_LEVEL_STYLES: Record<InsightLevel, { badge: string; value: string; bar: string }> = {
    good: {
        badge: 'border-black bg-[#86efac] text-black',
        value: 'text-black',
        bar: 'bg-[#86efac]',
    },
    warning: {
        badge: 'border-black bg-[#f9a8d4] text-black',
        value: 'text-black',
        bar: 'bg-[#f9a8d4]',
    },
    critical: {
        badge: 'border-black bg-[#fecaca] text-black',
        value: 'text-black',
        bar: 'bg-[#fb7185]',
    },
    neutral: {
        badge: 'border-black bg-white text-black',
        value: 'text-slate-800',
        bar: 'bg-black',
    },
};

const PLAYBACK_STATE_COMMIT_INTERVAL_MS = 250;
const REPLAY_SKIP_SECONDS = 10;
const PLAYBACK_SPEED_OPTIONS = [0.5, 1, 1.5, 2, 4] as const;
const SPEED_MENU_WIDTH_PX = 92;
const SPEED_MENU_ESTIMATED_HEIGHT_PX = 172;
const SPEED_MENU_VIEWPORT_GAP_PX = 8;
// Failsafe: if the next screenshot frame still hasn't decoded after this long while
// buffering, resume playback anyway so a single broken/slow frame can't hang the replay.
const MAX_BUFFER_STALL_MS = 8000;
const MAX_TIMELINE_MARKERS = 36;
const TIMELINE_MARKER_DEFAULT_TRACK_WIDTH_PX = 900;
const TIMELINE_MARKER_BASE_SPACING_PX = 64;
const TIMELINE_MARKER_DENSE_SPACING_PX = 88;
const TIMELINE_MARKER_EXTREME_DENSE_SPACING_PX = 112;
const TIMELINE_MARKER_HOVER_RADIUS_PX = 14;
const TIMELINE_MARKER_STICKY_RADIUS_PX = 32;
const TIMELINE_MARKER_SWITCH_DISTANCE_DELTA_PX = 10;
const NAVIGATION_CLUSTER_THRESHOLD = 4;
const MAX_ACTIVITY_ROWS = 900;

type TimelineMarkerCategory = 'friction' | 'rageTap' | 'deadTap' | 'fault' | 'gesture' | 'api' | 'background' | 'navigation' | 'log' | 'other';
type TimelineMarkerCounts = Record<TimelineMarkerCategory, number>;

interface TimelineMarkerView {
    markerKey: string;
    event: SessionEvent;
    sourceIndex: number;
    priority: number;
    clusteredCount: number;
    counts: TimelineMarkerCounts;
    time: number;
    percent: number;
}

type TimelineHoveredMarker = TimelineMarkerView & { x: number };

type SessionLoadErrorKind = 'forbidden' | 'not_found' | 'unavailable' | 'unknown';
type ScreenshotPreloadProfile = {
    startup: number;
    lookahead: number;
    lookbehind: number;
    retainBehind: number;
    retainAhead: number;
    pruneThreshold: number;
};

function getScreenshotPreloadProfile(playbackRate: number): ScreenshotPreloadProfile {
    const nav = typeof navigator !== 'undefined'
        ? navigator as Navigator & {
            connection?: { effectiveType?: string; saveData?: boolean };
            deviceMemory?: number;
        }
        : null;
    const effectiveType = nav?.connection?.effectiveType?.toLowerCase();
    const saveData = Boolean(nav?.connection?.saveData);
    const slowNetwork = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g';
    const coarsePointer = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    const lowMemory = typeof nav?.deviceMemory === 'number' && nav.deviceMemory <= 4;

    const base = slowNetwork
        ? { startup: 2, lookahead: 6, retainAhead: 28, pruneThreshold: 72 }
        : coarsePointer || lowMemory
            ? { startup: 3, lookahead: 10, retainAhead: 44, pruneThreshold: 104 }
            : { startup: 4, lookahead: 18, retainAhead: 72, pruneThreshold: 160 };
    const rateMultiplier = Math.max(1, Math.min(2, playbackRate || 1));

    return {
        startup: base.startup,
        lookahead: Math.ceil(base.lookahead * rateMultiplier),
        lookbehind: 2,
        retainBehind: 36,
        retainAhead: Math.ceil(base.retainAhead * rateMultiplier),
        pruneThreshold: base.pruneThreshold,
    };
}

function scheduleDashboardIdleTask(callback: () => void, timeoutMs: number): () => void {
    if (typeof window === 'undefined') {
        callback();
        return () => undefined;
    }

    const browserWindow = window as Window & typeof globalThis & {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
    };
    let cancelled = false;
    const run = () => {
        if (!cancelled) callback();
    };

    if (typeof browserWindow.requestIdleCallback === 'function') {
        const idleId = browserWindow.requestIdleCallback(run, { timeout: timeoutMs });
        return () => {
            cancelled = true;
            browserWindow.cancelIdleCallback?.(idleId);
        };
    }

    const timeoutId = browserWindow.setTimeout(run, Math.min(timeoutMs, 350));
    return () => {
        cancelled = true;
        browserWindow.clearTimeout(timeoutId);
    };
}

function classifySessionLoadError(error: unknown): SessionLoadErrorKind {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('no access') || message.includes('forbidden')) return 'forbidden';
    if (message.includes('not found')) return 'not_found';
    if (message.includes('temporarily unavailable') || message.includes('failed to fetch')) return 'unavailable';
    return 'unknown';
}

function isAbortError(error: unknown): boolean {
    return (error as { name?: string } | null)?.name === 'AbortError';
}

const SHARE_EXPIRY_OPTIONS: Array<{ value: ReplayShareExpirationPreset; label: string }> = [
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: '90d', label: '90 days' },
    { value: 'never', label: 'Never' },
];

const SHARE_VISIBILITY_OPTIONS: Array<{ value: ReplayShareVisibility; label: string; description: string }> = [
    {
        value: 'replay_only',
        label: 'Replay only',
        description: 'Playback, timeline, and basic replay context.',
    },
    {
        value: 'full_workbench',
        label: 'Full details',
        description: 'Adds console logs, inspector, and metadata.',
    },
];

const SHARE_VISIBILITY_LABELS: Record<ReplayShareVisibility, string> = SHARE_VISIBILITY_OPTIONS.reduce(
    (labels, option) => ({ ...labels, [option.value]: option.label }),
    {} as Record<ReplayShareVisibility, string>,
);

function isShareLinkUsable(share: ReplayShareLink): boolean {
    if (share.revokedAt) return false;
    if (!share.expiresAt) return true;
    return new Date(share.expiresAt).getTime() > Date.now();
}

function formatShareLinkStatus(share: ReplayShareLink): string {
    if (share.revokedAt) return 'Revoked';
    if (!share.expiresAt) return 'Never expires';
    return `Expires ${new Date(share.expiresAt).toLocaleDateString()}`;
}

function formatShareLinkPreview(share: ReplayShareLink): string {
    if (!share.url) return 'Share URL unavailable';
    try {
        const url = new URL(share.url);
        return `${url.host}${url.pathname}`;
    } catch {
        return share.url;
    }
}

function upsertShareLink(links: ReplayShareLink[], next: ReplayShareLink): ReplayShareLink[] {
    const filtered = links.filter((link) => link.id !== next.id);
    return [next, ...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ============================================================================
// Main Component
// ============================================================================

export const RecordingDetail: React.FC<{ sessionId?: string; shareToken?: string }> = ({ sessionId, shareToken }) => {
    const { sessionId: paramId, shareToken: paramShareToken } = useParams<{ sessionId?: string; shareToken?: string }>();
    const id = sessionId || paramId;
    const activeShareToken = shareToken || paramShareToken;
    const isPublicShare = Boolean(activeShareToken);
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const isDemoReplay = pathPrefix === '/demo';
    const { sessions: contextSessions, selectedProject } = useSessionData();
    const manualRefreshVersion = useDashboardManualRefreshVersion();

    const handleBackClick = (e: React.MouseEvent) => {
        e.preventDefault();
        // If we navigated here from within the app, go back to preserve state
        if (window.history.state && window.history.state.idx > 0) {
            navigate(-1);
        } else {
            // Otherwise, default to the sessions list
            navigate(`${pathPrefix}/sessions`);
        }
    };

    // State
    const [fullSession, setFullSession] = useState<FullSession | null>(null);
    const [isCoreLoading, setIsCoreLoading] = useState(true);
    const [isTimelineLoading, setIsTimelineLoading] = useState(false);
    const [isHierarchyLoading, setIsHierarchyLoading] = useState(false);
    const [isStatsLoading, setIsStatsLoading] = useState(false);
    const [isFramesLoading, setIsFramesLoading] = useState(false);
    const [isReplayManifestLoading, setIsReplayManifestLoading] = useState(false);
    const [isReplayLoaderSettling, setIsReplayLoaderSettling] = useState(false);
    const [revealedReplaySessionId, setRevealedReplaySessionId] = useState<string | null>(null);
    const [sessionLoadError, setSessionLoadError] = useState<SessionLoadErrorKind | null>(null);
    const [activityFilter, setActivityFilter] = useState<string>('all');
    const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);
    const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<'timeline' | 'console' | 'inspector' | 'metadata'>('timeline');
    const [revealAllLogs, setRevealAllLogs] = useState(false);

    // Replay player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [speedMenuPosition, setSpeedMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [showTouchOverlay, setShowTouchOverlay] = useState(true);
    const [touchEvents, setTouchEvents] = useState<OverlayTouchEvent[]>([]);
    const [activitySearch, setActivitySearch] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredMarker, setHoveredMarker] = useState<TimelineHoveredMarker | null>(null);
    // True while playback is paused waiting on the upcoming screenshot frame to
    // finish decoding (or rrweb segments to download). Keeps the progress bar from
    // racing ahead of what's actually painted.
    const [isBuffering, setIsBuffering] = useState(false);
    const isBufferingRef = useRef(false);
    const bufferStallStartRef = useRef<number>(0);
    // Scrubber hover preview: a frame thumbnail + timestamp bubble that follows the cursor.
    const [scrubPreview, setScrubPreview] = useState<{ leftPercent: number; time: number; frameUrl: string | null } | null>(null);
    // Timeline marker categories the user has hidden via the legend, to de-clutter the scrubber.
    const [hiddenMarkerCategories, setHiddenMarkerCategories] = useState<Set<TimelineMarkerCategory>>(() => new Set());
    const [progressTrackWidth, setProgressTrackWidth] = useState(0);
    const [terminalCopied, setTerminalCopied] = useState(false);
    const [timelineCopied, setTimelineCopied] = useState(false);
    const [domCopied, setDomCopied] = useState(false);
    const [metadataCopied, setMetadataCopied] = useState(false);
    const [userIdCopied, setUserIdCopied] = useState(false);
    const [sessionIdCopied, setSessionIdCopied] = useState(false);
    const [replayUrlCopied, setReplayUrlCopied] = useState(false);
    const [showHeaderDetails, setShowHeaderDetails] = useState(false);
    const [showShareMenu, setShowShareMenu] = useState(false);
    const [teamLinkCopied, setTeamLinkCopied] = useState(false);
    const [shareLinks, setShareLinks] = useState<ReplayShareLink[]>([]);
    const [shareCanManage, setShareCanManage] = useState(false);
    const [shareLinksLoading, setShareLinksLoading] = useState(false);
    const [shareActionBusy, setShareActionBusy] = useState(false);
    const [shareError, setShareError] = useState<string | null>(null);
    const [selectedShareVisibility, setSelectedShareVisibility] = useState<ReplayShareVisibility>('replay_only');
    const [selectedShareExpiry, setSelectedShareExpiry] = useState<ReplayShareExpirationPreset>('7d');
    const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
    const [archiveNeighborSessions, setArchiveNeighborSessions] = useState<any[]>([]);

    // DOM Inspector state
    const [hierarchySnapshots, setHierarchySnapshots] = useState<HierarchySnapshot[]>([]);

    // Screenshot playback state
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const screenshotFrameCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const screenshotAnimationRef = useRef<number | null>(null);
    const webReplayAnimationRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number>(0);
    const lastPreloadCenterIndexRef = useRef<number>(-1);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const progressFillRef = useRef<HTMLDivElement>(null);
    const progressThumbRef = useRef<HTMLDivElement>(null);
    const progressTimeRef = useRef<HTMLSpanElement>(null);
    const activityViewportRef = useRef<HTMLDivElement>(null);
    const terminalViewportRef = useRef<HTMLDivElement>(null);
    const activeReplayRequestRef = useRef(0);
    const activeReplayAbortRef = useRef<AbortController | null>(null);
    const framePollTimeoutRef = useRef<number | null>(null);
    const replayDeferredTaskCleanupsRef = useRef<Array<() => void>>([]);
    const shareButtonRef = useRef<HTMLButtonElement>(null);
    const shareMenuRef = useRef<HTMLDivElement>(null);
    const speedButtonRef = useRef<HTMLButtonElement>(null);
    const revealedReplaySessionIdRef = useRef<string | null>(null);

    // Ref-based playback state to avoid stale closures in animation loop
    const currentPlaybackTimeRef = useRef<number>(0);
    const currentFrameIndexRef = useRef<number>(0);
    const lastPlaybackUiUpdateRef = useRef<number>(0);
    const lastPlaybackClockLabelRef = useRef<string>('');

    // Sync refs with state for external interactions (like seeking)
    useEffect(() => {
        currentPlaybackTimeRef.current = currentPlaybackTime;
    }, [currentPlaybackTime]);

    useEffect(() => {
        revealedReplaySessionIdRef.current = revealedReplaySessionId;
    }, [revealedReplaySessionId]);

    useEffect(() => {
        currentFrameIndexRef.current = currentFrameIndex;
    }, [currentFrameIndex]);

    const updateSpeedMenuPosition = useCallback(() => {
        if (typeof window === 'undefined') return;
        const button = speedButtonRef.current;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const maxLeft = Math.max(
            SPEED_MENU_VIEWPORT_GAP_PX,
            window.innerWidth - SPEED_MENU_WIDTH_PX - SPEED_MENU_VIEWPORT_GAP_PX,
        );
        const left = Math.min(
            maxLeft,
            Math.max(SPEED_MENU_VIEWPORT_GAP_PX, rect.right - SPEED_MENU_WIDTH_PX),
        );

        const maxTop = Math.max(
            SPEED_MENU_VIEWPORT_GAP_PX,
            window.innerHeight - SPEED_MENU_ESTIMATED_HEIGHT_PX - SPEED_MENU_VIEWPORT_GAP_PX,
        );
        const topAbove = rect.top - SPEED_MENU_ESTIMATED_HEIGHT_PX - SPEED_MENU_VIEWPORT_GAP_PX;
        const topBelow = rect.bottom + SPEED_MENU_VIEWPORT_GAP_PX;
        const hasRoomAbove = topAbove >= SPEED_MENU_VIEWPORT_GAP_PX;
        const hasRoomBelow = topBelow + SPEED_MENU_ESTIMATED_HEIGHT_PX <= window.innerHeight - SPEED_MENU_VIEWPORT_GAP_PX;
        const top = Math.min(
            maxTop,
            Math.max(SPEED_MENU_VIEWPORT_GAP_PX, hasRoomAbove || !hasRoomBelow ? topAbove : topBelow),
        );

        setSpeedMenuPosition({ top, left });
    }, []);

    const toggleSpeedMenu = useCallback(() => {
        if (showSpeedMenu) {
            setShowSpeedMenu(false);
            return;
        }
        updateSpeedMenuPosition();
        setShowSpeedMenu(true);
    }, [showSpeedMenu, updateSpeedMenuPosition]);

    useEffect(() => {
        if (!showSpeedMenu || typeof window === 'undefined' || typeof document === 'undefined') return;

        updateSpeedMenuPosition();

        const handleViewportChange = () => updateSpeedMenuPosition();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowSpeedMenu(false);
            }
        };

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showSpeedMenu, updateSpeedMenuPosition]);

    // Get basic session from context. Non-demo detail routes may not have the
    // archive list hydrated, so a small fallback fetch below keeps Prev/Next usable.
    const navigationSessions = contextSessions.length > 0 ? contextSessions : archiveNeighborSessions;
    const session: any = navigationSessions.find((item) => item.id === id) || null;
    const sessions: any[] = navigationSessions;

    // Fetch full session data
    const fetchFullSession = useCallback(async () => {
        if (!id && !activeShareToken) return;
        const requestId = activeReplayRequestRef.current + 1;
        activeReplayRequestRef.current = requestId;
        activeReplayAbortRef.current?.abort();
        const requestController = new AbortController();
        activeReplayAbortRef.current = requestController;
        const requestSignal = requestController.signal;

        for (const cleanup of replayDeferredTaskCleanupsRef.current) cleanup();
        replayDeferredTaskCleanupsRef.current = [];

        const scheduleReplayTask = (task: () => void, timeoutMs: number) => {
            const cancel = scheduleDashboardIdleTask(() => {
                if (requestSignal.aborted || activeReplayRequestRef.current !== requestId) return;
                task();
            }, timeoutMs);
            replayDeferredTaskCleanupsRef.current.push(cancel);
        };

        if (framePollTimeoutRef.current) {
            window.clearTimeout(framePollTimeoutRef.current);
            framePollTimeoutRef.current = null;
        }

        try {
            const currentReplayIdentity = activeShareToken ? `share:${activeShareToken}` : id || null;
            if (!currentReplayIdentity || revealedReplaySessionIdRef.current !== currentReplayIdentity) {
                setRevealedReplaySessionId(null);
            }
            setIsCoreLoading(true);
            setIsTimelineLoading(true);
            setIsHierarchyLoading(true);
            setIsStatsLoading(true);
            setIsFramesLoading(false);
            setSessionLoadError(null);
            setHierarchySnapshots([]);

            const transformHierarchySnapshots = (rawSnapshots: any[], sessionLike: any): HierarchySnapshot[] => {
                if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) return [];
                return rawSnapshots
                    .map((snap: any) => {
                        const rootData = Array.isArray(snap.rootElement)
                            ? snap.rootElement[0]
                            : snap.rootElement;
                        const rootNode = rootData?.root || rootData?.rootElement || (rootData && (rootData.class || rootData.type || rootData.children) ? rootData : null);
                        if (!rootNode) return null;
                        return {
                            timestamp: snap.timestamp || rootData.timestamp || 0,
                            screen: snap.screen || rootData.screen || {
                                width: sessionLike?.deviceInfo?.screenWidth || 375,
                                height: sessionLike?.deviceInfo?.screenHeight || 812,
                                scale: 3
                            },
                            root: rootNode,
                        };
                    })
                    .filter((snap: any): snap is HierarchySnapshot => snap !== null)
                    .sort((a: HierarchySnapshot, b: HierarchySnapshot) => a.timestamp - b.timestamp);
            };

            let resolvedSessionId = id || '';
            const replayRequestLabel = id || activeShareToken || 'shared';
            const currentMatchesLoadedSession = (prev: FullSession | null): prev is FullSession => (
                Boolean(prev && (!resolvedSessionId || prev.id === resolvedSessionId))
            );
            const coreMark = `replay_core_${replayRequestLabel}`;
            if (typeof performance !== 'undefined') performance.mark(coreMark);

            const scheduleFramePoll = (delayMs: number) => {
                if (framePollTimeoutRef.current) {
                    window.clearTimeout(framePollTimeoutRef.current);
                }

                framePollTimeoutRef.current = window.setTimeout(async () => {
                    if (requestSignal.aborted || activeReplayRequestRef.current !== requestId) return;
                    try {
                        const framesResult = activeShareToken
                            ? await api.getSharedReplayFrames(activeShareToken, { signal: requestSignal })
                            : await api.getSessionFrames(id!, { frameUrlMode: 'signed', signal: requestSignal });
                        if (activeReplayRequestRef.current !== requestId) return;

                        setFullSession((prev) => {
                            if (!currentMatchesLoadedSession(prev)) return prev;
                            return {
                                ...prev,
                                screenshotFrames: framesResult.screenshotFrames || prev.screenshotFrames || [],
                                screenshotFramesStatus: framesResult.screenshotFramesStatus,
                                screenshotFrameCount: framesResult.screenshotFrameCount,
                                screenshotFramesProcessedSegments: framesResult.screenshotFramesProcessedSegments,
                                screenshotFramesTotalSegments: framesResult.screenshotFramesTotalSegments,
                            };
                        });

                        const stillPreparing = framesResult.screenshotFramesStatus === 'preparing';
                        setIsFramesLoading(stillPreparing);
                        if (stillPreparing) {
                            scheduleFramePoll(framesResult.screenshotFrames.length > 0 ? 1800 : 700);
                        } else {
                            framePollTimeoutRef.current = null;
                        }
                    } catch (err) {
                        if (requestSignal.aborted || isAbortError(err)) return;
                        if (activeReplayRequestRef.current !== requestId) return;
                        console.error('Failed to fetch session frames:', err);
                        setIsFramesLoading(true);
                        scheduleFramePoll(2000);
                    }
                }, delayMs);
            };

            try {
                const coreResult = activeShareToken
                    ? await api.getSharedReplayCore(activeShareToken, { includeReplay: false, signal: requestSignal })
                    : await api.getSessionCore(id!, { frameUrlMode: 'signed', includeReplay: false, signal: requestSignal });
                if (activeReplayRequestRef.current !== requestId) return;
                resolvedSessionId = (coreResult as any)?.id || id || '';

                if (typeof performance !== 'undefined') {
                    performance.measure(`replay:getSessionCore:${replayRequestLabel}`, coreMark);
                }

                setFullSession(coreResult as any);
                setIsCoreLoading(false);
            } catch (err) {
                if (requestSignal.aborted || isAbortError(err)) return;
                if (activeReplayRequestRef.current !== requestId) return;
                const errorKind = classifySessionLoadError(err);
                setSessionLoadError(errorKind);
                setIsCoreLoading(false);
                setIsHierarchyLoading(false);
                setIsReplayManifestLoading(false);
                setIsTimelineLoading(false);
                setIsStatsLoading(false);
                if (errorKind === 'unknown' || errorKind === 'unavailable') {
                    console.error('Failed to fetch session core:', err);
                }
                return;
            }

            setIsReplayManifestLoading(true);
            const manifestPromise = activeShareToken
                ? api.getSharedReplayManifest(activeShareToken, { signal: requestSignal })
                : api.getSessionReplayManifest(id!, { frameUrlMode: 'signed', signal: requestSignal });
            void manifestPromise
                .then((manifest) => {
                    if (activeReplayRequestRef.current !== requestId) return;
                    setFullSession((prev) => {
                        if (!currentMatchesLoadedSession(prev)) return prev;
                        const playbackMode = manifest.playbackMode === 'video'
                            ? prev.playbackMode
                            : manifest.playbackMode;
                        return {
                            ...prev,
                            hasRecording: manifest.hasRecording,
                            playbackMode,
                            screenshotFrames: manifest.screenshotFrames || [],
                            screenshotFramesStatus: manifest.screenshotFramesStatus,
                            screenshotFrameCount: manifest.screenshotFrameCount,
                            screenshotFramesProcessedSegments: manifest.screenshotFramesProcessedSegments,
                            screenshotFramesTotalSegments: manifest.screenshotFramesTotalSegments,
                            rrwebReplay: manifest.rrwebReplay,
                        };
                    });

                    const preparingFrames =
                        manifest.playbackMode === 'screenshots' &&
                        manifest.screenshotFramesStatus === 'preparing';
                    setIsFramesLoading(preparingFrames);
                    if (preparingFrames) {
                        scheduleFramePoll(0);
                    }
                })
                .catch((err) => {
                    if (requestSignal.aborted || isAbortError(err)) return;
                    if (activeReplayRequestRef.current !== requestId) return;
                    console.error('Failed to fetch replay manifest:', err);
                })
                .finally(() => {
                    if (activeReplayRequestRef.current === requestId && !requestSignal.aborted) {
                        setIsReplayManifestLoading(false);
                    }
                });

            scheduleReplayTask(() => {
                const timelinePromise = activeShareToken
                    ? api.getSharedReplayTimeline(activeShareToken, { signal: requestSignal })
                    : api.getSessionTimeline(id!, { signal: requestSignal });
                void timelinePromise
                    .then((timelineResult) => {
                        if (activeReplayRequestRef.current !== requestId) return;
                        setFullSession((prev) => {
                            if (!currentMatchesLoadedSession(prev)) return prev;
                            return {
                                ...prev,
                                deviceInfo: {
                                    ...(prev.deviceInfo || {}),
                                    ...((timelineResult as any).deviceInfo || {}),
                                },
                                events: timelineResult.events || [],
                                networkRequests: timelineResult.networkRequests || [],
                                crashes: timelineResult.crashes || [],
                                anrs: timelineResult.anrs || [],
                            } as any;
                        });
                    })
                    .catch((err) => {
                        if (requestSignal.aborted || isAbortError(err)) return;
                        if (activeReplayRequestRef.current !== requestId) return;
                        console.error('Failed to fetch session timeline:', err);
                    })
                    .finally(() => {
                        if (activeReplayRequestRef.current === requestId && !requestSignal.aborted) {
                            setIsTimelineLoading(false);
                        }
                    });
            }, 350);

            scheduleReplayTask(() => {
                const statsPromise = activeShareToken
                    ? api.getSharedReplayStats(activeShareToken, { signal: requestSignal })
                    : api.getSessionStats(id!, { signal: requestSignal });
                void statsPromise
                    .then((statsResult) => {
                        if (activeReplayRequestRef.current !== requestId) return;
                        setFullSession((prev) => {
                            if (!currentMatchesLoadedSession(prev)) return prev;
                            return {
                                ...prev,
                                stats: {
                                    ...prev.stats,
                                    ...((statsResult.stats || {}) as any),
                                },
                            };
                        });
                    })
                    .catch((err) => {
                        if (requestSignal.aborted || isAbortError(err)) return;
                        if (activeReplayRequestRef.current !== requestId) return;
                        console.error('Failed to fetch session stats:', err);
                    })
                    .finally(() => {
                        if (activeReplayRequestRef.current === requestId && !requestSignal.aborted) {
                            setIsStatsLoading(false);
                        }
                    });
            }, 700);

            scheduleReplayTask(() => {
                const hierarchyPromise = activeShareToken
                    ? api.getSharedReplayHierarchy(activeShareToken, { signal: requestSignal })
                    : api.getSessionHierarchy(id!, { signal: requestSignal });
                void hierarchyPromise
                    .then((hierarchyResult) => {
                        if (activeReplayRequestRef.current !== requestId) return;
                        setFullSession((prev) => {
                            if (!currentMatchesLoadedSession(prev)) return prev;
                            const next: any = {
                                ...prev,
                                hierarchySnapshots: hierarchyResult.hierarchySnapshots || [],
                            };
                            setHierarchySnapshots(transformHierarchySnapshots(next.hierarchySnapshots, next));
                            return next;
                        });
                    })
                    .catch((err) => {
                        if (requestSignal.aborted || isAbortError(err)) return;
                        if (activeReplayRequestRef.current !== requestId) return;
                        console.error('Failed to fetch session hierarchy:', err);
                    })
                    .finally(() => {
                        if (activeReplayRequestRef.current === requestId && !requestSignal.aborted) {
                            setIsHierarchyLoading(false);
                        }
                    });
            }, 1000);
        } catch (err) {
            console.error('Failed to fetch session:', err);
        }
    }, [activeShareToken, id, manualRefreshVersion]);

    useEffect(() => {
        fetchFullSession();
    }, [fetchFullSession]);

    useEffect(() => {
        if (!id || isPublicShare || contextSessions.length > 0) {
            setArchiveNeighborSessions([]);
            return;
        }

        let cancelled = false;
        const projectId = fullSession?.projectId || selectedProject?.id;

        const loadNeighborSessions = async () => {
            try {
                const result = await api.getSessionsPaginated({
                    projectId,
                    limit: 300,
                    timeRange: 'all',
                    sort: 'date',
                    sortDir: 'desc',
                    includeTotal: false,
                });
                if (cancelled) return;
                setArchiveNeighborSessions(result.sessions || []);
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to load neighboring sessions:', err);
                setArchiveNeighborSessions([]);
            }
        };

        const cancelIdleLoad = scheduleDashboardIdleTask(() => {
            void loadNeighborSessions();
        }, 1500);

        return () => {
            cancelled = true;
            cancelIdleLoad();
        };
    }, [contextSessions.length, fullSession?.projectId, id, isPublicShare, selectedProject?.id]);

    useEffect(() => {
        return () => {
            activeReplayAbortRef.current?.abort();
            activeReplayAbortRef.current = null;
            for (const cleanup of replayDeferredTaskCleanupsRef.current) cleanup();
            replayDeferredTaskCleanupsRef.current = [];
            if (framePollTimeoutRef.current) {
                window.clearTimeout(framePollTimeoutRef.current);
                framePollTimeoutRef.current = null;
            }
        };
    }, []);

    // Detect rage taps for touch overlay and timeline.
    // This mirrors native SDK behavior: 3+ taps in the same area within 1s.
    const detectedRageTaps = useMemo(() => {
        const sessionEvents = fullSession?.events || [];
        const existingRageTaps = sessionEvents.filter((e) => {
            const type = normalizeEventType(e.type);
            return type === 'rage_tap' || getEventGestureKind(e) === 'rage_tap';
        });
        const taps = sessionEvents.filter(e => {
            // Keep replay inference compatible with older native SDKs that only
            // emitted `type: "touch", gestureType: "tap"` while ensuring
            // keyboard-area taps never become rage indicators.
            if (isKeyboardAreaEvent(e)) return false;
            const type = normalizeEventType(e.type);
            const gestureKind = getEventGestureKind(e);
            return (type === 'gesture' || type === 'touch' || type === 'tap') &&
                (gestureKind === 'tap' || gestureKind === 'double_tap');
        });
        const rageTaps: SessionEvent[] = [];

        for (let i = 0; i < taps.length; i++) {
            const current = taps[i];
            const currentPos = getEventFirstTouchPoint(current);
            if (!currentPos) continue;
            let count = 1;

            for (let j = i + 1; j < taps.length; j++) {
                const next = taps[j];
                if (next.timestamp - current.timestamp > 1000) break;
                const nextPos = getEventFirstTouchPoint(next);
                if (!nextPos) continue;
                const dist = Math.sqrt(Math.pow(nextPos.x - currentPos.x, 2) + Math.pow(nextPos.y - currentPos.y, 2));
                if (dist <= 50) count++;
            }

            if (count >= 3) {
                const alreadyHasRageMarker = existingRageTaps.some((rageEvent) => {
                    const ragePos = getEventFirstTouchPoint(rageEvent);
                    if (!ragePos) return false;
                    const dist = Math.sqrt(Math.pow(ragePos.x - currentPos.x, 2) + Math.pow(ragePos.y - currentPos.y, 2));
                    return Math.abs(rageEvent.timestamp - current.timestamp) <= 1000 && dist <= 50;
                });
                if (!alreadyHasRageMarker) {
                    rageTaps.push({
                        ...current,
                        id: `client_inferred_rage_${current.id || current.timestamp}`,
                        type: 'rage_tap',
                        gestureType: 'rage_tap',
                        frustrationKind: 'rage_tap',
                        count,
                    });
                }
                i += count - 1;
            }
        }
        return rageTaps;
    }, [fullSession]);

    // ========================================================================
    // ALL DATA PROCESSING MUST HAPPEN BEFORE ANY EARLY RETURNS (React hooks rule)
    // ========================================================================

    // Extract session data (safe even if null)
    const events = fullSession?.events || [];
    const networkRequests = fullSession?.networkRequests || [];

    // Build network events for timeline
    const networkEventsForTimeline: SessionEvent[] = useMemo(() => {
        return networkRequests
            .filter((req) => {
                // Must have a valid timestamp
                if (!req.timestamp || req.timestamp <= 0) return false;
                // Must have a URL to display
                if (!req.url && !req.urlPath) return false;
                // Filter out malformed entries with no meaningful data
                const hasValidStatus = typeof req.statusCode === 'number' && req.statusCode > 0;
                const hasValidUrl = Boolean(req.url || req.urlPath);
                return hasValidUrl || hasValidStatus;
            })
            .map((req) => ({
                type: 'network_request',
                name: req.method || 'GET',
                timestamp: req.timestamp,
                properties: {
                    url: req.url || '',
                    urlPath: req.urlPath || (req.url ? new URL(req.url, 'http://localhost').pathname : ''),
                    statusCode: req.statusCode,
                    success: req.success ?? (req.statusCode < 400),
                    duration: req.duration || 0,
                    responseBodySize: req.responseBodySize ?? req.responseSize,
                    requestBodySize: req.requestBodySize ?? req.requestSize,
                },
            }));
    }, [networkRequests]);

    // Note: detectedRageTaps is also used for timeline visualization.

    // Crash events for timeline
    const crashEvents: SessionEvent[] = useMemo(() => {
        return ((fullSession as any)?.crashes || []).map((c: any) => ({
            id: `crash_fallback_${c.id}`,
            type: 'crash',
            name: c.exceptionName || 'Crash',
            timestamp: c.timestamp,
            message: c.reason || c.exceptionName || 'Crash detected',
            stack: c.stackTrace || undefined,
            level: 'error',
            properties: {
                exceptionName: c.exceptionName,
                reason: c.reason,
                stackTrace: c.stackTrace,
                crashId: c.id,
                consoleMarker: 'RJ_CRASH',
            },
        }));
    }, [fullSession]);

    // ANR events for timeline
    const anrEvents: SessionEvent[] = useMemo(() => {
        return ((fullSession as any)?.anrs || []).map((a: any, index: number) => ({
            id: `anr_fallback_${a.id || `${a.timestamp}_${index}`}`,
            type: 'anr',
            name: 'ANR',
            timestamp: a.timestamp,
            message: typeof a.durationMs === 'number' && a.durationMs > 0
                ? `ANR detected (${a.durationMs} ms blocked)`
                : 'ANR detected',
            stack: a.threadState || undefined,
            level: 'error',
            properties: {
                anrId: a.id,
                durationMs: a.durationMs,
                threadState: a.threadState,
                status: a.status,
                consoleMarker: 'RJ_ANR',
            },
        }));
    }, [fullSession]);

    // All timeline events sorted
    const allTimelineEvents = useMemo(() => {
        return mergeTimelineEvents(
            [...events, ...networkEventsForTimeline, ...detectedRageTaps],
            [...crashEvents, ...anrEvents]
        );
    }, [events, networkEventsForTimeline, detectedRageTaps, crashEvents, anrEvents]);

    const replayBaseTime = fullSession?.startTime || (session?.startedAt ? new Date(session.startedAt).getTime() : Date.now());
    const startTime = replayBaseTime;

    const logEvents = useMemo(() => {
        const selected = allTimelineEvents.filter((event) => {
            if (isLogEvent(event)) return true;
            return isDemoReplay && isConsoleSupplementEvent(event);
        });

        const deduped = new Map<string, SessionEvent>();
        selected.forEach((event, index) => {
            const dedupKey = event.id
                ? `id:${event.id}`
                : `${event.type}|${event.timestamp}|${event.name || ''}|${event.targetLabel || ''}|${index}`;
            if (!deduped.has(dedupKey)) {
                deduped.set(dedupKey, event);
            }
        });

        return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
    }, [allTimelineEvents, isDemoReplay]);

    const terminalLogRows = useMemo(() => {
        return logEvents
            .map((event, index) => {
                const relativeSeconds = Math.max(0, (event.timestamp - replayBaseTime) / 1000);
                const level = getLogLevel(event);
                const marker = getFaultMarker(event);
                const stack = getEventStackTrace(event);
                const baseMessage = marker
                    ? getFaultConsoleSummary(event)
                    : formatConsoleMessage(event);
                const message = stack ? `${baseMessage}\n${stack}` : baseMessage;
                const levelTag = marker || level.toUpperCase();
                return {
                    id: `${event.timestamp}-${index}`,
                    timestamp: event.timestamp,
                    relativeSeconds,
                    level,
                    marker,
                    message,
                    line: `[${formatPlaybackClock(relativeSeconds)}] [${levelTag}] ${message}`,
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);
    }, [logEvents, replayBaseTime]);

    const visibleTerminalLogRows = useMemo(
        () => revealAllLogs
            ? terminalLogRows
            : terminalLogRows.filter((entry) => entry.relativeSeconds <= currentPlaybackTime + 0.05),
        [terminalLogRows, currentPlaybackTime, revealAllLogs]
    );

    const terminalVisibleRows = useMemo(
        () => revealAllLogs ? visibleTerminalLogRows : visibleTerminalLogRows.slice(-250),
        [visibleTerminalLogRows, revealAllLogs]
    );

    const visibleTerminalLogText = useMemo(
        () => visibleTerminalLogRows.map((entry) => entry.line).join('\n'),
        [visibleTerminalLogRows]
    );

    useEffect(() => {
        if (!isDemoReplay || !fullSession) return;
        const eventTypeCounts = allTimelineEvents.reduce<Record<string, number>>((acc, event) => {
            const type = (event.type || 'unknown').toLowerCase();
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        console.info('[DEMO_REPLAY] composed replay payload', {
            sessionId: fullSession.id,
            timelineEventCount: allTimelineEvents.length,
            consoleRowCount: terminalLogRows.length,
            logEventCount: logEvents.length,
            eventTypeCounts,
        });
    }, [isDemoReplay, fullSession, allTimelineEvents, terminalLogRows.length, logEvents.length]);

    useEffect(() => {
        const viewport = terminalViewportRef.current;
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight;
    }, [terminalVisibleRows.length]);

    useEffect(() => {
        if (!terminalCopied) return;
        const timer = window.setTimeout(() => setTerminalCopied(false), 1500);
        return () => window.clearTimeout(timer);
    }, [terminalCopied]);

    // Session metadata
    // Calculate duration for the timeline:
    // 1. If playableDuration is provided from backend, use it (excludes background time)
    // 2. Otherwise, calculate from screenshot frames, session end, or events
    const durationSeconds = useMemo(() => {
        // If backend provided playable duration, use it - this is the most accurate
        if (fullSession?.playableDuration && fullSession.playableDuration > 0) {
            return fullSession.playableDuration;
        }

        const sessionStart = fullSession?.startTime || 0;
        if (!sessionStart) return session?.durationSeconds || 0;

        // Collect all possible end times
        const candidates: number[] = [];

        // Screenshot frames duration (iOS sessions) - use first to last frame span
        if (fullSession?.screenshotFrames && fullSession.screenshotFrames.length > 0) {
            const firstFrame = fullSession.screenshotFrames[0];
            const lastFrame = fullSession.screenshotFrames[fullSession.screenshotFrames.length - 1];
            // Calculate duration from last frame timestamp relative to session start
            // Add a small buffer (500ms) to account for the last frame's display time
            const screenshotDuration = ((lastFrame.timestamp - sessionStart) / 1000) + 0.5;
            if (screenshotDuration > 0) {
                candidates.push(screenshotDuration);
            }
        }

        const rrwebEvents = fullSession?.rrwebReplay?.events || [];
        if (rrwebEvents.length > 0) {
            const lastReplayEvent = rrwebEvents[rrwebEvents.length - 1];
            const rrwebDuration = ((lastReplayEvent?.timestamp || sessionStart) - sessionStart) / 1000;
            if (rrwebDuration > 0) {
                candidates.push(rrwebDuration);
            }
        }

        // Session end time (fallback, may include background time)
        if (fullSession?.endTime && fullSession.endTime > sessionStart) {
            let duration = (fullSession.endTime - sessionStart) / 1000;
            // Subtract background time if available
            if (fullSession?.backgroundTime && fullSession.backgroundTime > 0) {
                duration -= fullSession.backgroundTime;
            }
            if (duration > 0) candidates.push(duration);
        }

        // Stats duration (fallback)
        if (fullSession?.stats?.duration) {
            const statsDur = parseFloat(fullSession.stats.duration);
            if (statsDur > 0) candidates.push(statsDur);
        }

        const hasVisualReplayEvidence =
            (fullSession?.screenshotFrames && fullSession.screenshotFrames.length > 0) ||
            rrwebEvents.length > 0;

        // For event-only sessions, let the event stream define the timeline.
        // For visual replay, telemetry-only events can arrive after the final
        // playable frame (for example an idle/background close marker). Those
        // should not stretch the player into a blank tail.
        if (!hasVisualReplayEvidence && allTimelineEvents.length > 0) {
            const lastEvent = allTimelineEvents[allTimelineEvents.length - 1];
            if (lastEvent?.timestamp && lastEvent.timestamp > sessionStart) {
                candidates.push((lastEvent.timestamp - sessionStart) / 1000);
            }
        }

        // Fallback
        if (candidates.length === 0) {
            return session?.durationSeconds || 60;
        }

        // Use the maximum so all events fit on the timeline
        return Math.max(...candidates);
    }, [fullSession, session, allTimelineEvents]);

    // Screenshot frames (primary playback mode for iOS)
    // Normalize timestamps to be relative to session start time.
    // Also filter out frames that fall outside the session window —
    // cross-session frame leakage can cause frames from a previous
    // session to appear, producing flickering during playback.
    const rawScreenshotFrames = useMemo(() => {
        const rawFrames = fullSession?.screenshotFrames || [];
        if (rawFrames.length === 0 || !fullSession?.startTime) return [];

        const sessionStart = fullSession.startTime;
        const sessionEnd = fullSession.endTime ?? Infinity;
        const upperBound = sessionEnd === Infinity ? Infinity : sessionEnd + 5000;

        return rawFrames
            .filter(f => f.timestamp >= sessionStart && f.timestamp <= upperBound)
            .map((f, idx) => ({
                ...f,
                relativeTime: (f.timestamp - sessionStart) / 1000,
            }))
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((f, idx) => ({ ...f, index: idx }));
    }, [fullSession?.screenshotFrames, fullSession?.startTime, fullSession?.endTime]);

    const screenshotRawEndMs = useMemo(() => {
        const sessionStart = fullSession?.startTime || 0;
        if (!sessionStart) return null;

        const candidates: number[] = [];
        const addCandidate = (value: unknown) => {
            if (typeof value === 'number' && Number.isFinite(value) && value > sessionStart) {
                candidates.push(value);
            }
        };

        addCandidate(fullSession?.endTime);
        addCandidate(sessionStart + durationSeconds * 1000);
        if (
            typeof fullSession?.playableDuration === 'number' &&
            Number.isFinite(fullSession.playableDuration) &&
            fullSession.playableDuration > 0 &&
            typeof fullSession?.backgroundTime === 'number' &&
            Number.isFinite(fullSession.backgroundTime) &&
            fullSession.backgroundTime > 0
        ) {
            addCandidate(sessionStart + (durationSeconds + fullSession.backgroundTime) * 1000);
        }

        const lastFrameTimestamp = rawScreenshotFrames[rawScreenshotFrames.length - 1]?.timestamp;
        addCandidate(lastFrameTimestamp);
        if (typeof lastFrameTimestamp === 'number') {
            addCandidate(lastFrameTimestamp + 500);
        }

        return candidates.length > 0 ? Math.max(...candidates) : null;
    }, [durationSeconds, fullSession?.backgroundTime, fullSession?.endTime, fullSession?.playableDuration, fullSession?.startTime, rawScreenshotFrames]);

    const screenshotReplayBackgroundGaps = useMemo(() => (
        buildCompressedBackgroundGaps(allTimelineEvents, fullSession?.startTime || 0, undefined, {
            terminalEndMs: screenshotRawEndMs,
        })
    ), [allTimelineEvents, fullSession?.startTime, screenshotRawEndMs]);

    const screenshotFrames = useMemo(() => {
        const sessionStart = fullSession?.startTime || 0;
        if (rawScreenshotFrames.length === 0 || !sessionStart) return [];

        return rawScreenshotFrames
            .filter((frame) => !isTimestampInsideCompressedBackgroundGap(frame.timestamp, screenshotReplayBackgroundGaps))
            .map((frame) => {
                const compressedTimestamp = compressReplayTimestamp(frame.timestamp, screenshotReplayBackgroundGaps);
                return {
                    ...frame,
                    rawRelativeTime: frame.relativeTime,
                    relativeTime: Math.max(0, (compressedTimestamp - sessionStart) / 1000),
                };
            })
            .sort((a, b) => a.relativeTime - b.relativeTime || a.timestamp - b.timestamp)
            .map((frame, index) => ({ ...frame, index }));
    }, [fullSession?.startTime, rawScreenshotFrames, screenshotReplayBackgroundGaps]);

    const screenshotReplayDurationSeconds = useMemo(() => {
        const sessionStart = fullSession?.startTime || 0;
        if (!sessionStart || screenshotReplayBackgroundGaps.length === 0 || typeof screenshotRawEndMs !== 'number') {
            return durationSeconds;
        }

        const compressedEnd = compressReplayTimestamp(screenshotRawEndMs, screenshotReplayBackgroundGaps);
        return Math.max(0, (compressedEnd - sessionStart) / 1000);
    }, [durationSeconds, fullSession?.startTime, screenshotRawEndMs, screenshotReplayBackgroundGaps]);

    const visualReplayPreparing = Boolean(
        fullSession?.playbackMode === 'screenshots' &&
        (fullSession?.screenshotFramesStatus === 'preparing' || isFramesLoading) &&
        screenshotFrames.length === 0
    );
    // useRrwebReplayEvents transparently returns either the server-inlined events
    // (small sessions, loadMode='inline') or events fetched in parallel from R2
    // (large sessions, loadMode='segments'). Consumers below treat both the same.
    const {
        events: rrwebReplayEvents,
        isLoading: rrwebSegmentsLoading,
        progress: rrwebSegmentProgress,
        error: rrwebSegmentError,
    } = useRrwebReplayEvents(fullSession?.rrwebReplay);
    const webReplayRawEndMs = useMemo(() => {
        const sessionStart = fullSession?.startTime || 0;
        if (!sessionStart) return null;

        const candidates: number[] = [];
        const addCandidate = (value: unknown) => {
            if (typeof value === 'number' && Number.isFinite(value) && value > sessionStart) {
                candidates.push(value);
            }
        };

        const explicitEndMs = typeof fullSession?.endTime === 'number' && Number.isFinite(fullSession.endTime)
            ? fullSession.endTime
            : null;

        addCandidate(explicitEndMs);
        addCandidate(sessionStart + durationSeconds * 1000);
        if (typeof fullSession?.backgroundTime === 'number' && Number.isFinite(fullSession.backgroundTime) && fullSession.backgroundTime > 0) {
            addCandidate(sessionStart + (durationSeconds + fullSession.backgroundTime) * 1000);
        }
        for (const event of rrwebReplayEvents) addCandidate(event?.timestamp);
        if (explicitEndMs === null && rrwebReplayEvents.length === 0) {
            for (const event of allTimelineEvents) addCandidate(event?.timestamp);
        }

        return candidates.length > 0 ? Math.max(...candidates) : null;
    }, [allTimelineEvents, durationSeconds, fullSession?.backgroundTime, fullSession?.endTime, fullSession?.startTime, rrwebReplayEvents]);
    const webReplayBackgroundGaps = useMemo(() => (
        buildCompressedBackgroundGaps(allTimelineEvents, fullSession?.startTime || 0, undefined, {
            terminalEndMs: webReplayRawEndMs,
        })
    ), [allTimelineEvents, fullSession?.startTime, webReplayRawEndMs]);
    const compressedRrwebReplayEvents = useMemo(() => (
        compressReplayEvents(rrwebReplayEvents, webReplayBackgroundGaps)
    ), [rrwebReplayEvents, webReplayBackgroundGaps]);
    const webReplayCompressedEndMs = useMemo(() => (
        typeof webReplayRawEndMs === 'number'
            ? compressReplayTimestamp(webReplayRawEndMs, webReplayBackgroundGaps)
            : null
    ), [webReplayBackgroundGaps, webReplayRawEndMs]);
    const webReplayDurationSeconds = useMemo(() => {
        const firstTimestamp = Number(compressedRrwebReplayEvents[0]?.timestamp);
        const replayStart = Number.isFinite(firstTimestamp) ? firstTimestamp : replayBaseTime;
        const candidates: number[] = [];
        const lastTimestamp = Number(compressedRrwebReplayEvents[compressedRrwebReplayEvents.length - 1]?.timestamp);
        if (Number.isFinite(lastTimestamp) && lastTimestamp > replayStart) {
            candidates.push((lastTimestamp - replayStart) / 1000);
        }
        if (typeof webReplayCompressedEndMs === 'number' && Number.isFinite(webReplayCompressedEndMs) && webReplayCompressedEndMs > replayStart) {
            candidates.push((webReplayCompressedEndMs - replayStart) / 1000);
        }
        return Math.max(0, ...candidates);
    }, [compressedRrwebReplayEvents, replayBaseTime, webReplayCompressedEndMs]);

    const displayedFrameCount = Math.max(
        screenshotFrames.length,
        fullSession?.screenshotFrameCount || 0
    );
    const rrwebReplaySegmentCount = fullSession?.rrwebReplay?.segments?.length ?? 0;
    const rrwebReplayEventCountHint = fullSession?.rrwebReplay?.eventCount ?? 0;
    const rrwebReplayExpectedSegmentCount = fullSession?.playbackMode === 'rrweb'
        ? Math.max(rrwebReplaySegmentCount, fullSession?.screenshotFramesTotalSegments ?? 0)
        : 0;
    const hasRrwebReplayReference = Boolean(
        fullSession?.playbackMode === 'rrweb' &&
        (
            rrwebReplayEvents.length > 0 ||
            rrwebReplaySegmentCount > 0 ||
            rrwebReplayExpectedSegmentCount > 0 ||
            rrwebReplayEventCountHint > 0 ||
            fullSession?.rrwebReplay?.loadMode === 'segments'
        )
    );
    const rrwebReplayFailed = Boolean(
        fullSession?.playbackMode === 'rrweb' &&
        rrwebReplayEvents.length === 0 &&
        rrwebSegmentError &&
        !isReplayManifestLoading &&
        !rrwebSegmentsLoading
    );
    const rrwebReplayPreparing = Boolean(
        fullSession?.playbackMode === 'rrweb' &&
        rrwebReplayEvents.length === 0 &&
        !rrwebReplayFailed &&
        (
            isReplayManifestLoading ||
            rrwebSegmentsLoading ||
            rrwebReplaySegmentCount > 0 ||
            rrwebReplayExpectedSegmentCount > 0 ||
            rrwebReplayEventCountHint > 0 ||
            fullSession?.rrwebReplay?.loadMode === 'segments'
        )
    );

    // Determine playback mode.
    const playbackMode = useMemo(() => {
        if (fullSession?.playbackMode === 'rrweb' && rrwebReplayEvents.length > 0) {
            return 'rrweb' as const;
        }
        if (fullSession?.playbackMode === 'screenshots' && screenshotFrames.length > 0) {
            return 'screenshots' as const;
        }
        if (screenshotFrames.length > 0) {
            return 'screenshots' as const;
        }
        return 'none' as const;
    }, [fullSession?.playbackMode, rrwebReplayEvents.length, screenshotFrames]);

    useEffect(() => {
        const track = progressRef.current;
        if (!track || typeof window === 'undefined') return;

        const updateWidth = () => {
            const width = Math.round(track.getBoundingClientRect().width);
            setProgressTrackWidth((currentWidth) => (
                Math.abs(currentWidth - width) > 4 ? width : currentWidth
            ));
        };

        updateWidth();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateWidth);
            return () => window.removeEventListener('resize', updateWidth);
        }

        const observer = new ResizeObserver(updateWidth);
        observer.observe(track);
        return () => observer.disconnect();
    }, [playbackMode]);

    const playbackDurationSeconds = playbackMode === 'rrweb'
        ? webReplayDurationSeconds
        : playbackMode === 'screenshots'
            ? screenshotReplayDurationSeconds
            : durationSeconds;
    const replayClockBaseTime = playbackMode === 'rrweb'
        ? Number(compressedRrwebReplayEvents[0]?.timestamp) || replayBaseTime
        : replayBaseTime;
    const eventTimestampToPlaybackSeconds = useCallback((timestamp: number) => {
        const playbackTimestamp = playbackMode === 'rrweb'
            ? compressReplayTimestamp(timestamp, webReplayBackgroundGaps)
            : playbackMode === 'screenshots'
                ? compressReplayTimestamp(timestamp, screenshotReplayBackgroundGaps)
                : timestamp;
        return Math.max(0, (playbackTimestamp - replayClockBaseTime) / 1000);
    }, [playbackMode, replayClockBaseTime, screenshotReplayBackgroundGaps, webReplayBackgroundGaps]);
    const eventFitsPlaybackWindow = useCallback((event: SessionEvent) => {
        if (playbackDurationSeconds <= 0) return false;
        const playbackTime = eventTimestampToPlaybackSeconds(event.timestamp);
        return Number.isFinite(playbackTime) && playbackTime >= 0 && playbackTime <= playbackDurationSeconds + 0.05;
    }, [eventTimestampToPlaybackSeconds, playbackDurationSeconds]);

    const currentPlaybackRawTimestamp = useMemo(() => {
        const sessionStart = fullSession?.startTime || replayBaseTime;
        const playbackTimestamp = sessionStart + currentPlaybackTime * 1000;
        if (playbackMode === 'screenshots') {
            return expandCompressedReplayTimestamp(playbackTimestamp, screenshotReplayBackgroundGaps);
        }
        return playbackTimestamp;
    }, [currentPlaybackTime, fullSession?.startTime, playbackMode, replayBaseTime, screenshotReplayBackgroundGaps]);

    const currentPlaybackRawTimeSeconds = useMemo(() => {
        const sessionStart = fullSession?.startTime || replayBaseTime;
        return Math.max(0, (currentPlaybackRawTimestamp - sessionStart) / 1000);
    }, [currentPlaybackRawTimestamp, fullSession?.startTime, replayBaseTime]);

    const activeScreenshotBackgroundGap = useMemo(() => {
        if (playbackMode !== 'screenshots' || screenshotReplayBackgroundGaps.length === 0) return null;
        const sessionStart = fullSession?.startTime || 0;
        if (!sessionStart) return null;

        const playbackTimestamp = sessionStart + currentPlaybackTime * 1000;
        if (!Number.isFinite(playbackTimestamp)) return null;
        return screenshotReplayBackgroundGaps.find((gap) => (
            playbackTimestamp >= gap.compressedStartAt && playbackTimestamp <= gap.compressedEndAt
        )) ?? null;
    }, [currentPlaybackTime, fullSession?.startTime, playbackMode, screenshotReplayBackgroundGaps]);

    // Has any visual recording?
    const hasRecording = playbackMode !== 'none' || visualReplayPreparing || rrwebReplayPreparing || rrwebReplayFailed || hasRrwebReplayReference;

    // Get device dimensions - try multiple fallbacks for Android compatibility
    // Android may not always have deviceInfo.screenWidth/Height or hierarchy snapshots
    const inferredDimensions = useMemo(() => {
        // 1. Try deviceInfo first (iOS always has this)
        if (fullSession?.deviceInfo?.screenWidth && fullSession?.deviceInfo?.screenHeight) {
            return {
                width: fullSession.deviceInfo.screenWidth,
                height: fullSession.deviceInfo.screenHeight
            };
        }

        // 2. Try hierarchy snapshots (Android sends dimensions here)
        if (hierarchySnapshots[0]?.screen?.width && hierarchySnapshots[0]?.screen?.height) {
            return {
                width: hierarchySnapshots[0].screen.width,
                height: hierarchySnapshots[0].screen.height
            };
        }

        // 3. Estimate from touch coordinates in events (last resort for Android without hierarchy)
        const gestureEvents = (fullSession?.events || []).filter((e: any) =>
            (e.type === 'touch' || e.type === 'gesture') &&
            (e.touches?.length > 0 || e.properties?.touches?.length > 0)
        );

        if (gestureEvents.length > 0) {
            let maxX = 0, maxY = 0;
            for (const e of gestureEvents) {
                const rawTouches = e.touches || e.properties?.touches || [];
                const touches = Array.isArray(rawTouches) ? rawTouches : [];
                for (const t of touches) {
                    if (typeof t.x === 'number' && t.x > maxX) maxX = t.x;
                    if (typeof t.y === 'number' && t.y > maxY) maxY = t.y;
                }
            }

            // If we have significant touch coordinates, estimate screen size
            // Assume touches don't go all the way to edges, so add 10% margin
            if (maxX > 100 && maxY > 100) {
                const estimatedWidth = Math.ceil(maxX * 1.1);
                const estimatedHeight = Math.ceil(maxY * 1.1);
                return { width: estimatedWidth, height: estimatedHeight };
            }
        }

	        // 4. Default fallback to common mobile dimensions
	        const platform = ((fullSession as any)?.platform || '').toLowerCase();
	        if (platform === 'web') {
	            const webWidth = Number((fullSession as any)?.deviceInfo?.screenWidth) || 1440;
	            const webHeight = Number((fullSession as any)?.deviceInfo?.screenHeight) || 900;
	            return { width: webWidth, height: webHeight };
	        }
	        if (platform === 'android') {
	            return { width: 1080, height: 2400 }; // Common Android resolution
	        }
        return { width: 375, height: 812 }; // iPhone X/11/12/13/14 default
    }, [fullSession, hierarchySnapshots]);

    const deviceWidth = inferredDimensions.width;
    const deviceHeight = inferredDimensions.height;
    const replayDeviceFitWidth = `calc(${(deviceWidth / Math.max(1, deviceHeight)) * 100}cqh + 0.25rem)`;

    const syncPlaybackChrome = useCallback((timeSeconds: number) => {
        const safeDuration = Math.max(0, playbackDurationSeconds);
        const clampedTime = safeDuration > 0
            ? Math.max(0, Math.min(timeSeconds, safeDuration))
            : 0;
        const progressRatio = safeDuration > 0 ? clampedTime / safeDuration : 0;
        const progressPercent = `${progressRatio * 100}%`;

        if (progressFillRef.current) {
            progressFillRef.current.style.transform = `scaleX(${progressRatio})`;
        }
        if (progressThumbRef.current) {
            progressThumbRef.current.style.left = progressPercent;
        }

        const clockLabel = formatPlaybackClock(clampedTime);
        if (progressTimeRef.current && lastPlaybackClockLabelRef.current !== clockLabel) {
            progressTimeRef.current.textContent = clockLabel;
            lastPlaybackClockLabelRef.current = clockLabel;
        }
    }, [playbackDurationSeconds]);

    useEffect(() => {
        syncPlaybackChrome(currentPlaybackTime);
    }, [currentPlaybackTime, syncPlaybackChrome]);

    const ensureScreenshotFrameImage = useCallback((
        frame: { url?: string; proxyUrl?: string | null } | undefined,
        fetchPriority: 'high' | 'low' | 'auto' = 'auto'
    ): HTMLImageElement | null => {
        if (!frame?.url) return null;

        const cache = screenshotFrameCacheRef.current;
        const cacheKey = `${frame.url}|${frame.proxyUrl || ''}`;
        const cachedImg = cache.get(cacheKey);
        if (cachedImg) return cachedImg;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        try {
            (img as any).fetchPriority = fetchPriority;
        } catch {
            // fetchPriority is a best-effort browser hint.
        }
        if (frame.proxyUrl && frame.proxyUrl !== frame.url) {
            img.addEventListener('error', () => {
                const currentSrc = img.currentSrc || img.src;
                if (!currentSrc.endsWith(frame.proxyUrl || '') && img.src !== frame.proxyUrl) {
                    img.src = frame.proxyUrl!;
                }
            }, { once: true });
        }
        img.src = frame.url;
        cache.set(cacheKey, img);
        return img;
    }, []);

    const warmScreenshotFramesAround = useCallback((
        centerIndex: number,
        fetchPriority: 'high' | 'low' | 'auto' = 'low'
    ) => {
        if (screenshotFrames.length === 0) return;
        if (fetchPriority !== 'high' && Math.abs(centerIndex - lastPreloadCenterIndexRef.current) < 6) {
            return;
        }

        lastPreloadCenterIndexRef.current = centerIndex;
        const preloadProfile = getScreenshotPreloadProfile(playbackRate);
        const startIndex = Math.max(0, centerIndex - preloadProfile.lookbehind);
        const endIndex = Math.min(
            screenshotFrames.length - 1,
            centerIndex + preloadProfile.lookahead
        );

        for (let index = startIndex; index <= endIndex; index++) {
            const priority = index === centerIndex ? fetchPriority : (fetchPriority === 'high' ? 'auto' : fetchPriority);
            ensureScreenshotFrameImage(screenshotFrames[index], priority);
        }

        const cache = screenshotFrameCacheRef.current;
        if (cache.size > preloadProfile.pruneThreshold) {
            const retainStart = Math.max(0, centerIndex - preloadProfile.retainBehind);
            const retainEnd = Math.min(
                screenshotFrames.length - 1,
                centerIndex + preloadProfile.retainAhead
            );
            const retainedUrls = new Set<string>();
            for (let index = retainStart; index <= retainEnd; index++) {
                retainedUrls.add(`${screenshotFrames[index].url}|${screenshotFrames[index].proxyUrl || ''}`);
            }
            for (const url of cache.keys()) {
                if (!retainedUrls.has(url)) {
                    cache.delete(url);
                }
            }
        }
    }, [ensureScreenshotFrameImage, playbackRate, screenshotFrames]);

    // Handle progress click/drag for visual playback
    const handleProgressInteraction = useCallback(
        (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
            if (!progressRef.current) return;

            const rect = progressRef.current.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

            const newTime = percent * playbackDurationSeconds;
            if (playbackMode === 'rrweb') {
                setCurrentPlaybackTime(newTime);
                currentPlaybackTimeRef.current = newTime;
                lastPlaybackUiUpdateRef.current = performance.now();
                syncPlaybackChrome(newTime);
                return;
            }

            if (screenshotFrames.length === 0) return;
            // Binary search for closest frame at or before the target time
            let left = 0;
            let right = screenshotFrames.length - 1;
            while (left < right) {
                const mid = Math.floor((left + right + 1) / 2);
                if (screenshotFrames[mid].relativeTime <= newTime) {
                    left = mid;
                } else {
                    right = mid - 1;
                }
            }
            setCurrentFrameIndex(left);
            // Use the user's target time, not the frame's time — prevents the
            // progress bar from snapping backward to the nearest frame.
            setCurrentPlaybackTime(newTime);
            // Immediately sync the ref so the animation tick loop doesn't
            // overwrite the seek with the old position before React re-renders.
            currentPlaybackTimeRef.current = newTime;
            currentFrameIndexRef.current = left;
            lastPlaybackUiUpdateRef.current = performance.now();
            syncPlaybackChrome(newTime);
            warmScreenshotFramesAround(left, 'high');
        },
        [playbackDurationSeconds, playbackMode, screenshotFrames, syncPlaybackChrome, warmScreenshotFramesAround]
    );

    const handleProgressMouseDown = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            setHoveredMarker((current) => (current ? null : current));
            setIsDragging(true);
            const previousBodyUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            handleProgressInteraction(e);

            const handleMouseMove = (ev: MouseEvent) => handleProgressInteraction(ev);
            const handleMouseUp = () => {
                setIsDragging(false);
                document.body.style.userSelect = previousBodyUserSelect;
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        },
        [handleProgressInteraction]
    );

    const handleProgressTouchStart = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            e.preventDefault();
            setHoveredMarker((current) => (current ? null : current));
            setIsDragging(true);
            const previousBodyUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            if (e.touches[0] && progressRef.current) {
                const rect = progressRef.current.getBoundingClientRect();
                const touch = e.touches[0];
                const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                const fakeEvent = { clientX: touch.clientX } as MouseEvent;
                handleProgressInteraction(Object.assign(fakeEvent, { currentTarget: progressRef.current }));
            }

            const handleTouchMove = (ev: TouchEvent) => {
                if (!ev.touches[0] || !progressRef.current) return;
                ev.preventDefault();
                const rect = progressRef.current.getBoundingClientRect();
                const touch = ev.touches[0];
                const fakeEvent = { clientX: touch.clientX } as MouseEvent;
                handleProgressInteraction(Object.assign(fakeEvent, { currentTarget: progressRef.current }));
            };
            const handleTouchEnd = () => {
                setIsDragging(false);
                document.body.style.userSelect = previousBodyUserSelect;
                document.removeEventListener('touchmove', handleTouchMove);
                document.removeEventListener('touchend', handleTouchEnd);
                document.removeEventListener('touchcancel', handleTouchEnd);
            };
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);
            document.addEventListener('touchcancel', handleTouchEnd);
        },
        [handleProgressInteraction]
    );

    // Toggle play/pause for visual playback
    const togglePlayPause = useCallback(() => {
        if (isPlaying) {
            setCurrentPlaybackTime(currentPlaybackTimeRef.current);
            syncPlaybackChrome(currentPlaybackTimeRef.current);
            lastPlaybackUiUpdateRef.current = performance.now();
        }

        setIsPlaying((playing) => !playing);
    }, [isPlaying, syncPlaybackChrome]);

    // Skip in visual playback
    const skip = useCallback(
        (seconds: number) => {
            const targetTime = Math.max(0, Math.min(currentPlaybackTimeRef.current + seconds, playbackDurationSeconds));
            if (playbackMode === 'rrweb') {
                setCurrentPlaybackTime(targetTime);
                currentPlaybackTimeRef.current = targetTime;
                lastPlaybackUiUpdateRef.current = performance.now();
                syncPlaybackChrome(targetTime);
                return;
            }

            if (screenshotFrames.length === 0) return;
            // Binary search for closest frame at or before the target time
            let left = 0;
            let right = screenshotFrames.length - 1;
            while (left < right) {
                const mid = Math.floor((left + right + 1) / 2);
                if (screenshotFrames[mid].relativeTime <= targetTime) {
                    left = mid;
                } else {
                    right = mid - 1;
                }
            }
            const idx = Math.max(0, Math.min(left, screenshotFrames.length - 1));
            setCurrentFrameIndex(idx);
            setCurrentPlaybackTime(targetTime);
            currentPlaybackTimeRef.current = targetTime;
            currentFrameIndexRef.current = idx;
            lastPlaybackUiUpdateRef.current = performance.now();
            syncPlaybackChrome(targetTime);
            warmScreenshotFramesAround(idx, 'high');
        },
        [playbackDurationSeconds, playbackMode, screenshotFrames, syncPlaybackChrome, warmScreenshotFramesAround]
    );

    // Restart visual playback
    const restart = useCallback(() => {
        if (playbackMode === 'rrweb') {
            setCurrentPlaybackTime(0);
            currentPlaybackTimeRef.current = 0;
            lastPlaybackUiUpdateRef.current = performance.now();
            syncPlaybackChrome(0);
            setIsPlaying(true);
            return;
        }

        if (screenshotFrames.length === 0) return;
        setCurrentFrameIndex(0);
        setCurrentPlaybackTime(0);
        currentPlaybackTimeRef.current = 0;
        currentFrameIndexRef.current = 0;
        lastPlaybackUiUpdateRef.current = performance.now();
        syncPlaybackChrome(0);
        warmScreenshotFramesAround(0, 'high');
        setIsPlaying(true);
    }, [playbackMode, screenshotFrames, syncPlaybackChrome, warmScreenshotFramesAround]);

    // Effect: Keyboard shortcut for play/pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target instanceof HTMLElement ? e.target : null;
            const isEditableTarget = !!target && (
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
                || target.isContentEditable
                || !!target.closest('[contenteditable="true"]')
            );
            if (isEditableTarget) return;
            if (playbackMode === 'none') return;

            if (e.code === 'Space') {
                if (target?.closest('button, a, [role="button"]')) return;
                e.preventDefault();
                togglePlayPause();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                skip(-REPLAY_SKIP_SECONDS);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                skip(REPLAY_SKIP_SECONDS);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [togglePlayPause, skip, playbackMode]);

    // ============================================================================
    // Screenshot Playback Effects
    // ============================================================================

    // Reset playback to 0:00 when switching sessions
    useEffect(() => {
        setCurrentPlaybackTime(0);
        setCurrentFrameIndex(0);
        currentPlaybackTimeRef.current = 0;
        currentFrameIndexRef.current = 0;
        lastPlaybackUiUpdateRef.current = 0;
        lastPreloadCenterIndexRef.current = -1;
        lastPlaybackClockLabelRef.current = '';
        screenshotFrameCacheRef.current.clear();
        isBufferingRef.current = false;
        setIsBuffering(false);
        setScrubPreview(null);
        syncPlaybackChrome(0);
    }, [id]);

    // Preload screenshot frames
    useEffect(() => {
        if (playbackMode !== 'screenshots' || screenshotFrames.length === 0) return;

        lastPreloadCenterIndexRef.current = -1;

        // Preload a small startup window immediately so opening replay paints fast.
        const preloadProfile = getScreenshotPreloadProfile(playbackRate);
        const preloadCount = Math.min(preloadProfile.startup, screenshotFrames.length);
        for (let index = 0; index < preloadCount; index++) {
            ensureScreenshotFrameImage(
                screenshotFrames[index],
                index === 0 ? 'high' : 'auto'
            );
        }

        // Then keep a rolling lookahead warm. This avoids flooding the browser
        // with every frame in a long replay while still staying ahead of play.
        let idleId: number | null = null;
        let timeoutId: number | null = null;
        const preloadLookahead = () => warmScreenshotFramesAround(currentFrameIndexRef.current, 'low');

        if ('requestIdleCallback' in window) {
            idleId = (window as any).requestIdleCallback(preloadLookahead, { timeout: 750 });
        } else {
            timeoutId = (globalThis as any).setTimeout(preloadLookahead, 100);
        }

        return () => {
            if (idleId !== null && 'cancelIdleCallback' in window) {
                (window as any).cancelIdleCallback(idleId);
            }
            if (timeoutId !== null) {
                (globalThis as any).clearTimeout(timeoutId);
            }
        };
    }, [ensureScreenshotFrameImage, playbackMode, playbackRate, screenshotFrames, warmScreenshotFramesAround]);

    // Update touch overlay for screenshot playback mode
    useEffect(() => {
        if (playbackMode !== 'screenshots' || !fullSession || !showTouchOverlay) {
            return;
        }

        const currentAbsoluteTime = currentPlaybackRawTimestamp;
        const screenWidth = deviceWidth;
        const screenHeight = deviceHeight;

        const recentTouchEvents = (fullSession.events || [])
            .filter((e) => {
                const eventTime = e.timestamp;
                const timeDiff = currentAbsoluteTime - eventTime;
                const type = normalizeEventType(e.type);
                const gestureKind = getEventGestureKind(e);
                const isFrustrationTap = type === 'rage_tap' || type === 'dead_tap' ||
                    gestureKind === 'rage_tap' || gestureKind === 'dead_tap';
                const isGestureEvent = type === 'touch' || type === 'gesture' || isFrustrationTap;
                const rawTouchesArr = e.touches ?? e.properties?.touches ?? [];
                const touchesArr = Array.isArray(rawTouchesArr) ? rawTouchesArr : [];
                // Use wider window for gesture events (swipe/scroll need more time to be visible)
                const maxAge = isFrustrationTap ? 1800 : (type === 'gesture') ? 1500 : 1000;
                return isGestureEvent && touchesArr.length > 0 && timeDiff >= 0 && timeDiff < maxAge;
            })
            .map((e) => {
                const rawTouchArray = e.touches || e.properties?.touches || [];
                const touchArray = Array.isArray(rawTouchArray) ? rawTouchArray : [];
                const type = normalizeEventType(e.type);
                const gestureKind = getEventGestureKind(e);
                let gestureType = e.gestureType || e.properties?.gestureType || e.frustrationKind || e.properties?.frustrationKind || 'tap';
                const props = e.properties || {};

                // Check if this is a rage tap
                const isRageTapEvent = detectedRageTaps.some(rt =>
                    Math.abs(rt.timestamp - e.timestamp) < 100
                );
                if (type === 'rage_tap' || gestureKind === 'rage_tap' || (isRageTapEvent && gestureType.includes('tap'))) {
                    gestureType = 'rage_tap';
                } else if (type === 'dead_tap' || gestureKind === 'dead_tap') {
                    gestureType = 'dead_tap';
                }

                const validTouches = touchArray
                    .filter((t: any) => {
                        const x = typeof t.x === 'number' ? t.x : 0;
                        const y = typeof t.y === 'number' ? t.y : 0;
                        return x > 5 && y > 5 && x < screenWidth * 3 && y < screenHeight * 3;
                    })
                    .map((t: any) => ({
                        x: t.x,
                        y: t.y,
                        timestamp: e.timestamp,
                        force: t.force,
                    }));

                if (validTouches.length === 0) return null;

                return {
                    id: (e as any).id || `touch-${e.timestamp}-${Math.random()}`,
                    timestamp: e.timestamp,
                    gestureType,
                    touches: validTouches,
                    targetLabel: e.targetLabel || e.label || props.targetLabel || props.label,
                    duration: props.duration || (e as any).duration,
                    velocity: props.velocity || (e as any).velocity,
                    maxForce: props.maxForce || (e as any).maxForce,
                    touchCount: validTouches.length,
                } as OverlayTouchEvent;
            })
            .filter((e): e is OverlayTouchEvent => e !== null);

        setTouchEvents(recentTouchEvents);
    }, [playbackMode, fullSession, currentPlaybackRawTimestamp, showTouchOverlay, detectedRageTaps, deviceWidth, deviceHeight]);

    const drawScreenshotFrame = useCallback((frameIndex: number) => {
        if (playbackMode !== 'screenshots' || !canvasRef.current || screenshotFrames.length === 0) {
            return;
        }

        const frame = screenshotFrames[frameIndex];
        if (!frame) {
            return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        warmScreenshotFramesAround(frameIndex, 'low');

        const img = ensureScreenshotFrameImage(frame, 'high');
        if (!img) {
            return;
        }

        const drawCurrentFrame = () => {
            if (currentFrameIndexRef.current !== frameIndex) return;
            if (!canvasRef.current) return;
            ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
            try {
                performance.mark(`replay:firstFramePaint:${id}`);
            } catch { }
        };

        if (img.complete && img.naturalWidth > 0) {
            drawCurrentFrame();
            return;
        }

        const handleLoad = () => {
            img.removeEventListener('error', handleError);
            drawCurrentFrame();
        };
        const handleError = (err: Event) => {
            img.removeEventListener('load', handleLoad);
            console.error('[SCREENSHOT] Frame load error:', frameIndex, frame.url, err);
        };
        img.addEventListener('load', handleLoad, { once: true });
        img.addEventListener('error', handleError, { once: true });
    }, [ensureScreenshotFrameImage, id, playbackMode, screenshotFrames, warmScreenshotFramesAround]);

    // Screenshot playback animation loop
    // Uses relativeTime (seconds from first frame) for proper real-time playback
    useEffect(() => {
        if (playbackMode !== 'screenshots' || !isPlaying || screenshotFrames.length === 0) {
            if (screenshotAnimationRef.current) {
                cancelAnimationFrame(screenshotAnimationRef.current);
                screenshotAnimationRef.current = null;
            }
            if (isBufferingRef.current) {
                isBufferingRef.current = false;
                setIsBuffering(false);
            }
            return;
        }

        lastFrameTimeRef.current = performance.now();
        lastPlaybackUiUpdateRef.current = lastFrameTimeRef.current;
        syncPlaybackChrome(currentPlaybackTimeRef.current);
        warmScreenshotFramesAround(currentFrameIndexRef.current, 'low');
        if (playbackDurationSeconds <= 0) {
            setIsPlaying(false);
            currentPlaybackTimeRef.current = 0;
            syncPlaybackChrome(0);
            return;
        }

        const tick = (now: number) => {
            const deltaSec = ((now - lastFrameTimeRef.current) / 1000) * playbackRate;
            lastFrameTimeRef.current = now;

            // Tentative next playback time (committed only once the frame it lands on
            // is actually decoded — see the buffering gate below).
            const nextPlaybackTime = currentPlaybackTimeRef.current + deltaSec;

            // Robust frame selection: Binary search for the closest frame at or before nextPlaybackTime
            let left = 0;
            let right = screenshotFrames.length - 1;
            let targetIdx = 0;

            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (screenshotFrames[mid].relativeTime <= nextPlaybackTime) {
                    targetIdx = mid;
                    left = mid + 1;
                } else {
                    right = mid - 1;
                }
            }

            // Buffering gate: never let the clock/progress bar advance onto a frame
            // whose image hasn't decoded yet. Instead, freeze on the current frame,
            // bump the missing frame to high priority, and resume once it's ready.
            // A failsafe timeout prevents a single broken frame from hanging forever.
            if (targetIdx !== currentFrameIndexRef.current) {
                const targetImg = ensureScreenshotFrameImage(screenshotFrames[targetIdx], 'high');
                const targetReady = !!targetImg && targetImg.complete && targetImg.naturalWidth > 0;
                if (!targetReady) {
                    if (!isBufferingRef.current) {
                        isBufferingRef.current = true;
                        bufferStallStartRef.current = now;
                        setIsBuffering(true);
                    }
                    warmScreenshotFramesAround(targetIdx, 'high');
                    if (now - bufferStallStartRef.current < MAX_BUFFER_STALL_MS) {
                        // Hold position — do not commit nextPlaybackTime.
                        syncPlaybackChrome(currentPlaybackTimeRef.current);
                        screenshotAnimationRef.current = requestAnimationFrame(tick);
                        return;
                    }
                    // Failsafe expired: fall through and advance anyway.
                }
            }

            if (isBufferingRef.current) {
                isBufferingRef.current = false;
                setIsBuffering(false);
            }

            // Commit the advanced clock now that the target frame is ready.
            currentPlaybackTimeRef.current = nextPlaybackTime;
            syncPlaybackChrome(nextPlaybackTime);

            if (targetIdx !== currentFrameIndexRef.current) {
                currentFrameIndexRef.current = targetIdx;
                drawScreenshotFrame(targetIdx);
                warmScreenshotFramesAround(targetIdx, 'low');
            }

            // Loop back to the start when playback reaches the end.
            if (nextPlaybackTime >= playbackDurationSeconds) {
                currentPlaybackTimeRef.current = 0;
                currentFrameIndexRef.current = 0;
                setCurrentPlaybackTime(0);
                setCurrentFrameIndex(0);
                lastPlaybackUiUpdateRef.current = now;
                syncPlaybackChrome(0);
                drawScreenshotFrame(0);
                warmScreenshotFramesAround(0, 'high');
                screenshotAnimationRef.current = requestAnimationFrame(tick);
                return;
            }

            // Keep the hot animation loop in refs. Committing playback time on
            // every RAF forces this large route to re-render 60 times/second,
            // which makes logs, touch overlays, and timeline sync feel laggy.
            if (now - lastPlaybackUiUpdateRef.current >= PLAYBACK_STATE_COMMIT_INTERVAL_MS) {
                setCurrentPlaybackTime(nextPlaybackTime);
                setCurrentFrameIndex(currentFrameIndexRef.current);
                lastPlaybackUiUpdateRef.current = now;
            }

            screenshotAnimationRef.current = requestAnimationFrame(tick);
        };

        screenshotAnimationRef.current = requestAnimationFrame(tick);

        return () => {
            if (screenshotAnimationRef.current) {
                cancelAnimationFrame(screenshotAnimationRef.current);
            }
        };
    }, [
        playbackMode,
        isPlaying,
        screenshotFrames,
        playbackRate,
        playbackDurationSeconds,
        drawScreenshotFrame,
        syncPlaybackChrome,
        warmScreenshotFramesAround,
        ensureScreenshotFrameImage,
    ]);

    // Browser replay clock. rrweb renders its own DOM; this keeps our controls
    // and timeline markers moving against the same playback time.
    useEffect(() => {
        if (playbackMode !== 'rrweb' || !isPlaying) {
            if (webReplayAnimationRef.current) {
                cancelAnimationFrame(webReplayAnimationRef.current);
                webReplayAnimationRef.current = null;
            }
            return;
        }

        lastFrameTimeRef.current = performance.now();
        lastPlaybackUiUpdateRef.current = lastFrameTimeRef.current;
        syncPlaybackChrome(currentPlaybackTimeRef.current);
        if (playbackDurationSeconds <= 0) {
            setIsPlaying(false);
            currentPlaybackTimeRef.current = 0;
            syncPlaybackChrome(0);
            return;
        }

        const tick = (now: number) => {
            const deltaSec = ((now - lastFrameTimeRef.current) / 1000) * playbackRate;
            lastFrameTimeRef.current = now;

            const nextPlaybackTime = currentPlaybackTimeRef.current + deltaSec;
            currentPlaybackTimeRef.current = nextPlaybackTime;
            syncPlaybackChrome(nextPlaybackTime);

            if (nextPlaybackTime >= playbackDurationSeconds) {
                currentPlaybackTimeRef.current = 0;
                setCurrentPlaybackTime(0);
                lastPlaybackUiUpdateRef.current = now;
                syncPlaybackChrome(0);
                webReplayAnimationRef.current = requestAnimationFrame(tick);
                return;
            }

            if (now - lastPlaybackUiUpdateRef.current >= PLAYBACK_STATE_COMMIT_INTERVAL_MS) {
                setCurrentPlaybackTime(nextPlaybackTime);
                lastPlaybackUiUpdateRef.current = now;
            }

            webReplayAnimationRef.current = requestAnimationFrame(tick);
        };

        webReplayAnimationRef.current = requestAnimationFrame(tick);

        return () => {
            if (webReplayAnimationRef.current) {
                cancelAnimationFrame(webReplayAnimationRef.current);
            }
        };
    }, [isPlaying, playbackDurationSeconds, playbackMode, playbackRate, syncPlaybackChrome]);

    // Draw current screenshot frame to canvas
    useEffect(() => {
        drawScreenshotFrame(currentFrameIndex);
    }, [drawScreenshotFrame, currentFrameIndex]);

    // Seek to a specific time in screenshot mode.
    // Displays the closest frame at or before the target time, but keeps the
    // progress bar at the exact requested position.
    const seekToScreenshotFrame = useCallback((targetRelativeTime: number) => {
        if (screenshotFrames.length === 0) return;

        // Binary search for closest frame by relativeTime
        let left = 0;
        let right = screenshotFrames.length - 1;

        while (left < right) {
            const mid = Math.floor((left + right + 1) / 2);
            if (screenshotFrames[mid].relativeTime <= targetRelativeTime) {
                left = mid;
            } else {
                right = mid - 1;
            }
        }

        setCurrentFrameIndex(left);
        setCurrentPlaybackTime(targetRelativeTime);
        currentPlaybackTimeRef.current = targetRelativeTime;
        currentFrameIndexRef.current = left;
        lastPlaybackUiUpdateRef.current = performance.now();
        syncPlaybackChrome(targetRelativeTime);
        warmScreenshotFramesAround(left, 'high');
    }, [screenshotFrames, syncPlaybackChrome, warmScreenshotFramesAround]);

    // Seek helper used by timeline and activity interactions
    const handleSeekToTime = useCallback((time: number) => {
        const clampedTime = Math.max(0, Math.min(time, playbackDurationSeconds));
        if (playbackMode === 'rrweb') {
            setCurrentPlaybackTime(clampedTime);
            currentPlaybackTimeRef.current = clampedTime;
            lastPlaybackUiUpdateRef.current = performance.now();
            syncPlaybackChrome(clampedTime);
            return;
        }
        seekToScreenshotFrame(clampedTime);
    }, [playbackDurationSeconds, playbackMode, seekToScreenshotFrame, syncPlaybackChrome]);

    // Effect: Seek to the first occurrence of the specified seekToType in query parameters once loaded
    useEffect(() => {
        if (!fullSession) return;
        if (playbackMode === 'none' || playbackDurationSeconds <= 0) return;
        const queryParams = new URLSearchParams(window.location.search);
        const seekToType = queryParams.get('seekToType');
        const seekToSeconds = Number.parseFloat(queryParams.get('seekTo') || '');
        const seekToTimestamp = Number.parseFloat(queryParams.get('seekToTimestamp') || '');

        const clearSeekParams = () => {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('seekTo');
            newUrl.searchParams.delete('seekToTimestamp');
            newUrl.searchParams.delete('seekToType');
            window.history.replaceState(null, '', newUrl.toString());
        };

        if (Number.isFinite(seekToTimestamp)) {
            const targetSeconds = eventTimestampToPlaybackSeconds(seekToTimestamp);
            if (Number.isFinite(targetSeconds) && targetSeconds >= 0) {
                handleSeekToTime(targetSeconds);
                clearSeekParams();
            }
            return;
        }

        if (Number.isFinite(seekToSeconds)) {
            handleSeekToTime(seekToSeconds);
            clearSeekParams();
            return;
        }

        if (!seekToType) return;

        if (seekToType === 'start') {
            handleSeekToTime(0);
            clearSeekParams();
            return;
        }

        if (allTimelineEvents.length === 0) return;

        const matchingEvent = allTimelineEvents.find((event) => {
            const type = (event.type || '').toLowerCase();
            const gestureType = getEventGestureKind(event);
            const marker = getFaultMarker(event);

            if (seekToType === 'crash' && (type === 'crash' || marker === 'CRASH')) return true;
            if (seekToType === 'anr' && (type === 'anr' || marker === 'ANR')) return true;
            if (seekToType === 'error' && (type === 'error' || marker === 'ERROR')) return true;
            if (seekToType === 'rage' && (type === 'rage_tap' || gestureType === 'rage_tap')) return true;
            if (seekToType === 'dead' && (type === 'dead_tap' || gestureType === 'dead_tap')) return true;
            if (seekToType === 'api' && (type === 'network_request' || type === 'api_call')) return true;
            return false;
        });

        if (matchingEvent) {
            const targetSeconds = eventTimestampToPlaybackSeconds(matchingEvent.timestamp);
            if (Number.isFinite(targetSeconds) && targetSeconds >= 0) {
                handleSeekToTime(targetSeconds);
                clearSeekParams();
            }
        }
    }, [fullSession, playbackMode, playbackDurationSeconds, allTimelineEvents, eventTimestampToPlaybackSeconds, handleSeekToTime]);

    // Step exactly one screenshot frame forward/back (pauses playback for precise inspection).
    const stepFrame = useCallback((delta: number) => {
        if (playbackMode !== 'screenshots' || screenshotFrames.length === 0) return;
        setIsPlaying(false);
        const nextIdx = Math.max(0, Math.min(currentFrameIndexRef.current + delta, screenshotFrames.length - 1));
        const frameTime = screenshotFrames[nextIdx]?.relativeTime ?? 0;
        seekToScreenshotFrame(frameTime);
    }, [playbackMode, screenshotFrames, seekToScreenshotFrame]);

    const formatPlaybackTime = formatPlaybackClock;

    // Progress percentage (progress fill/thumb positions are driven imperatively by
    // syncPlaybackChrome; effectiveDuration is still used for the time readout).
    const effectiveDuration = playbackDurationSeconds;

    const activityTabs = useMemo(() => {
        const counts = {
            all: 0,
            navigation: 0,
            touches: 0,
            network: 0,
            logs: logEvents.length,
            issues: 0,
        };

        for (const event of allTimelineEvents) {
            const type = normalizeEventType(event.type);
            if (!isFeedbackType(type)) counts.all++;
            if (type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background') {
                counts.navigation++;
            }
            if (isGestureEvent(event)) {
                counts.touches++;
            }
            if (type === 'network_request') {
                counts.network++;
            }
            if (
                type === 'crash' ||
                type === 'error' ||
                type === 'anr' ||
                isFrustrationEvent(event)
            ) {
                counts.issues++;
            }
        }

        return [
            { id: 'all', label: 'All', count: counts.all },
            { id: 'navigation', label: 'Navigation', count: counts.navigation },
            { id: 'touches', label: 'Touches', count: counts.touches },
            { id: 'network', label: 'Network', count: counts.network },
            { id: 'logs', label: 'Logs', count: counts.logs },
            { id: 'issues', label: 'Issues', count: counts.issues },
        ];
    }, [allTimelineEvents, logEvents.length]);

    // Filter activity feed once per filter/search change, not on every playback tick.
    const filteredActivity = useMemo(() => {
        const normalizedSearch = activitySearch.trim().toLowerCase();

        return allTimelineEvents.filter((e) => {
            const type = normalizeEventType(e.type);

            if (isFeedbackType(type)) return false;

            if (type === 'error') {
                const hasContent = e.name || e.properties?.message || e.properties?.reason || e.properties?.errorMessage;
                if (!hasContent) return false;
            }

            if (type === 'network_request') {
                const hasUrl = e.properties?.url || e.properties?.urlPath;
                if (!hasUrl) return false;
            }

            const gestureType = getEventGestureKind(e);
            const gestureLabel = (getGestureDisplayLabel(e) || '').toLowerCase();
            const eventTitle = getActivityEventTitle(e).toLowerCase();
            const gestureSearchText = [
                gestureType,
                gestureType.replace(/_/g, ' '),
                gestureLabel,
                gestureLabel ? `${gestureLabel}s` : '',
            ].filter(Boolean).join(' ');
            let matchesFilter = true;

            if (activityFilter === 'navigation') {
                matchesFilter = type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background';
            } else if (activityFilter === 'touches') {
                matchesFilter = isGestureEvent(e);
            } else if (activityFilter === 'network') {
                matchesFilter = type === 'network_request';
            } else if (activityFilter === 'logs') {
                matchesFilter = isLogEvent(e);
            } else if (activityFilter === 'issues') {
                matchesFilter = type === 'crash' || type === 'error' || type === 'anr' || isFrustrationEvent(e);
            }

            if (!matchesFilter) return false;
            if (!normalizedSearch) return true;

            const name = (e.name || '').toLowerCase();
            const target = (e.targetLabel || e.label || e.properties?.targetLabel || e.properties?.label || '').toLowerCase();
            const url = (e.properties?.url || e.properties?.urlPath || '').toLowerCase();
            const props = JSON.stringify(e.properties || {}).toLowerCase();
            const message = (e.message || e.properties?.message || '').toLowerCase();

            return (
                type.includes(normalizedSearch) ||
                eventTitle.includes(normalizedSearch) ||
                gestureSearchText.includes(normalizedSearch) ||
                name.includes(normalizedSearch) ||
                target.includes(normalizedSearch) ||
                url.includes(normalizedSearch) ||
                props.includes(normalizedSearch) ||
                gestureType.includes(normalizedSearch) ||
                message.includes(normalizedSearch)
            );
        });
    }, [activityFilter, activitySearch, allTimelineEvents]);

    const activeActivityIndex = useMemo(() => {
        if (filteredActivity.length === 0) return -1;
        let result = -1;

        for (let index = 0; index < filteredActivity.length; index++) {
            const event = filteredActivity[index];
            if (!event) continue;
            const playbackTime = eventTimestampToPlaybackSeconds(event.timestamp);
            if (playbackTime <= currentPlaybackTime + 0.05) {
                result = index;
                continue;
            }
            break;
        }

        return result >= 0 ? result : 0;
    }, [currentPlaybackTime, eventTimestampToPlaybackSeconds, filteredActivity]);

    const visibleActivityWindow = useMemo(() => {
        if (filteredActivity.length <= MAX_ACTIVITY_ROWS) {
            return {
                rows: filteredActivity,
                startIndex: 0,
                endIndex: filteredActivity.length,
                isWindowed: false,
            };
        }

        const centeredIndex = activeActivityIndex >= 0 ? activeActivityIndex : 0;
        const halfWindow = Math.floor(MAX_ACTIVITY_ROWS / 2);
        const startIndex = Math.max(
            0,
            Math.min(centeredIndex - halfWindow, filteredActivity.length - MAX_ACTIVITY_ROWS)
        );
        const endIndex = Math.min(filteredActivity.length, startIndex + MAX_ACTIVITY_ROWS);

        return {
            rows: filteredActivity.slice(startIndex, endIndex),
            startIndex,
            endIndex,
            isWindowed: true,
        };
    }, [activeActivityIndex, filteredActivity]);

    const timelineMarkers = useMemo(() => {
        const markerActivity = filteredActivity.filter((event) => (
            !isAppForegroundEvent(event)
            && eventFitsPlaybackWindow(event)
            && !hiddenMarkerCategories.has(getTimelineMarkerCategory(event))
        ));

        if (playbackDurationSeconds <= 0) return [];

        const toMarkerView = (
            event: SessionEvent,
            sourceIndex: number,
            clusteredCount: number,
            counts: TimelineMarkerCounts,
            markerKey: string
        ): TimelineMarkerView => {
            const time = eventTimestampToPlaybackSeconds(event.timestamp);
            const percent = Math.min(100, Math.max(0, (time / playbackDurationSeconds) * 100));
            return {
                markerKey,
                event,
                sourceIndex,
                priority: getTimelineMarkerPriority(event),
                clusteredCount,
                counts,
                time,
                percent,
            };
        };

        const trackWidth = progressTrackWidth || TIMELINE_MARKER_DEFAULT_TRACK_WIDTH_PX;
        const comfortableMarkerCount = Math.max(6, Math.floor(trackWidth / TIMELINE_MARKER_BASE_SPACING_PX));
        const densitySpacingPx = markerActivity.length > comfortableMarkerCount * 6
            ? TIMELINE_MARKER_EXTREME_DENSE_SPACING_PX
            : markerActivity.length > comfortableMarkerCount * 3
                ? TIMELINE_MARKER_DENSE_SPACING_PX
                : TIMELINE_MARKER_BASE_SPACING_PX;
        const targetMarkerCount = Math.max(
            6,
            Math.min(MAX_TIMELINE_MARKERS, Math.floor(trackWidth / densitySpacingPx))
        );

        if (markerActivity.length <= targetMarkerCount) {
            return markerActivity.map((event, index) => {
                const counts = createTimelineMarkerCounts();
                counts[getTimelineMarkerCategory(event)] = 1;
                return toMarkerView(event, index, 1, counts, `marker-${index}-${event.timestamp}`);
            });
        }

        const getTimelineBucket = (time: number) => Math.max(
            0,
            Math.min(targetMarkerCount - 1, Math.floor((time / playbackDurationSeconds) * targetMarkerCount))
        );
        const navigationBucketCounts = new Map<number, number>();
        for (const event of markerActivity) {
            if (!isRouteNavigationEvent(event)) continue;
            const time = eventTimestampToPlaybackSeconds(event.timestamp);
            if (time < 0 || time > playbackDurationSeconds + 0.05) continue;
            const bucket = getTimelineBucket(time);
            navigationBucketCounts.set(bucket, (navigationBucketCounts.get(bucket) ?? 0) + 1);
        }

        const buckets = new Map<number, {
            event: SessionEvent;
            sourceIndex: number;
            priority: number;
            clusteredCount: number;
            counts: TimelineMarkerCounts;
            bucket: number;
        }>();
        const standaloneMarkers: TimelineMarkerView[] = [];
        markerActivity.forEach((event, index) => {
            const time = eventTimestampToPlaybackSeconds(event.timestamp);
            if (time < 0 || time > playbackDurationSeconds + 0.05) return;
            const category = getTimelineMarkerCategory(event);
            if (category === 'api' || category === 'background') {
                const counts = createTimelineMarkerCounts();
                counts[category] = 1;
                standaloneMarkers.push(toMarkerView(event, index, 1, counts, `marker-${category}-${index}-${event.timestamp}`));
                return;
            }
            const bucket = getTimelineBucket(time);
            if (isRouteNavigationEvent(event) && (navigationBucketCounts.get(bucket) ?? 0) < NAVIGATION_CLUSTER_THRESHOLD) {
                const counts = createTimelineMarkerCounts();
                counts.navigation = 1;
                standaloneMarkers.push(toMarkerView(event, index, 1, counts, `marker-navigation-${index}-${event.timestamp}`));
                return;
            }

            const priority = getTimelineMarkerPriority(event);
            const existing = buckets.get(bucket);
            if (!existing) {
                const counts = createTimelineMarkerCounts();
                counts[category] = 1;
                buckets.set(bucket, {
                    event,
                    sourceIndex: index,
                    priority,
                    clusteredCount: 1,
                    counts,
                    bucket,
                });
            } else if (priority > existing.priority) {
                existing.counts[category] += 1;
                existing.clusteredCount += 1;
                existing.event = event;
                existing.sourceIndex = index;
                existing.priority = priority;
            } else {
                existing.counts[category] += 1;
                existing.clusteredCount += 1;
            }
        });

        const clusteredMarkers = Array.from(buckets.values())
            .sort((a, b) => a.bucket - b.bucket)
            .map((bucket) => toMarkerView(
                bucket.event,
                bucket.sourceIndex,
                bucket.clusteredCount,
                bucket.counts,
                `cluster-${bucket.bucket}-${bucket.sourceIndex}-${bucket.event.timestamp}`
            ));

        return [...clusteredMarkers, ...standaloneMarkers].sort((a, b) => (
            a.percent - b.percent || a.sourceIndex - b.sourceIndex
        ));
    }, [eventFitsPlaybackWindow, eventTimestampToPlaybackSeconds, filteredActivity, playbackDurationSeconds, progressTrackWidth, hiddenMarkerCategories]);

    const handleTimelineMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (isDragging) {
            setHoveredMarker((current) => (current ? null : current));
            setScrubPreview(null);
            return;
        }

        const track = progressRef.current;
        if (!track) return;

        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return;

        const pointerX = event.clientX - rect.left;
        if (pointerX < 0 || pointerX > rect.width) {
            setHoveredMarker((current) => (current ? null : current));
            setScrubPreview(null);
            return;
        }

        // Scrub preview: time bubble (both modes) + a frame thumbnail (screenshots only).
        if (playbackDurationSeconds > 0) {
            const ratio = pointerX / rect.width;
            const previewTime = ratio * playbackDurationSeconds;
            let frameUrl: string | null = null;
            if (playbackMode === 'screenshots' && screenshotFrames.length > 0) {
                let lo = 0;
                let hi = screenshotFrames.length - 1;
                while (lo < hi) {
                    const mid = Math.floor((lo + hi + 1) / 2);
                    if (screenshotFrames[mid].relativeTime <= previewTime) lo = mid;
                    else hi = mid - 1;
                }
                frameUrl = screenshotFrames[lo]?.url || null;
            }
            setScrubPreview({ leftPercent: ratio * 100, time: previewTime, frameUrl });
        }

        if (timelineMarkers.length === 0) {
            setHoveredMarker((current) => (current ? null : current));
            return;
        }

        let nearestMarker: TimelineMarkerView | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;

        for (const marker of timelineMarkers) {
            const markerX = (marker.percent / 100) * rect.width;
            const distance = Math.abs(markerX - pointerX);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestMarker = marker;
            }
        }

        setHoveredMarker((current) => {
            const currentMarker = current
                ? timelineMarkers.find((marker) => marker.markerKey === current.markerKey) || null
                : null;
            const currentDistance = currentMarker
                ? Math.abs((currentMarker.percent / 100) * rect.width - pointerX)
                : Number.POSITIVE_INFINITY;

            if (!nearestMarker || nearestDistance > TIMELINE_MARKER_HOVER_RADIUS_PX) {
                return currentMarker && currentDistance <= TIMELINE_MARKER_STICKY_RADIUS_PX
                    ? current
                    : null;
            }

            if (
                currentMarker &&
                currentDistance <= TIMELINE_MARKER_STICKY_RADIUS_PX &&
                nearestMarker.markerKey !== currentMarker.markerKey &&
                nearestDistance + TIMELINE_MARKER_SWITCH_DISTANCE_DELTA_PX >= currentDistance
            ) {
                return current;
            }

            return current?.markerKey === nearestMarker.markerKey
                ? current
                : { ...nearestMarker, x: nearestMarker.percent };
        });
    }, [isDragging, timelineMarkers, playbackDurationSeconds, playbackMode, screenshotFrames]);

    const clearTimelineHover = useCallback(() => {
        setHoveredMarker((current) => (current ? null : current));
        setScrubPreview(null);
    }, []);

    // Keep the activity stream synced with playback. Only scroll the inner
    // timeline pane so the main replay layout stays stable.
    useEffect(() => {
        if (activeWorkbenchTab !== 'timeline') return;
        if (activeActivityIndex < 0) return;
        const viewport = activityViewportRef.current;
        if (!viewport) return;

        const activeRow = viewport.querySelector<HTMLElement>(`[data-activity-index="${activeActivityIndex}"]`);
        if (!activeRow) return;

        const viewportRect = viewport.getBoundingClientRect();
        const rowRect = activeRow.getBoundingClientRect();
        const topBuffer = 56;
        const bottomBuffer = 72;
        const isAbove = rowRect.top < viewportRect.top + topBuffer;
        const isBelow = rowRect.bottom > viewportRect.bottom - bottomBuffer;

        if (!isAbove && !isBelow) return;

        const rowTopWithinViewport = rowRect.top - viewportRect.top + viewport.scrollTop;
        const rowCenter = rowTopWithinViewport + rowRect.height / 2;
        const targetScrollTop = Math.max(0, rowCenter - viewport.clientHeight / 2);

        viewport.scrollTo({
            top: targetScrollTop,
            behavior: isPlaying ? 'smooth' : 'auto',
        });
    }, [activeWorkbenchTab, activeActivityIndex, isPlaying]);

    const rawDeviceModel = fullSession?.deviceInfo?.model || session?.deviceModel || 'Unknown';
    const deviceModel = formatDeviceModel(rawDeviceModel, 'Unknown');
    const platform = (
        fullSession?.platform ||
        fullSession?.deviceInfo?.systemName ||
        fullSession?.deviceInfo?.os ||
        session?.platform ||
        'unknown'
    ).toLowerCase();
    const isWebSession = platform === 'web';
    const shortestDeviceSide = Math.min(deviceWidth, deviceHeight);
    const longestDeviceSide = Math.max(deviceWidth, deviceHeight);
    const deviceSideRatio = longestDeviceSide / Math.max(1, shortestDeviceSide);
    const isTabletReplayDevice = !isWebSession &&
        shortestDeviceSide >= 600 &&
        longestDeviceSide >= 900 &&
        deviceSideRatio <= 1.7;
    const replayDeviceSizingVars = {
        '--replay-device-fit-width': replayDeviceFitWidth,
        ...(isTabletReplayDevice ? {
            '--replay-device-base-width': '900px',
            '--replay-device-base-viewport-width': '92vw',
            '--replay-device-narrow-width': '900px',
            '--replay-device-narrow-viewport-width': '92vw',
            '--replay-device-min-width': '360px',
            '--replay-device-fluid-width': '82cqw',
            '--replay-device-max-width': '900px',
            '--replay-device-compact-min-width': '320px',
            '--replay-device-compact-fluid-width': '80cqw',
            '--replay-device-compact-max-width': '820px',
        } : {}),
    } as React.CSSProperties;
    const screenshotReplayShellMaxWidthClass = isTabletReplayDevice
        ? 'max-w-[900px] xl:max-w-none'
        : 'max-w-[360px] xl:max-w-none';
    const webEnvironment = isWebSession ? getWebSessionEnvironment(fullSession || session) : null;
    const appVersion = fullSession?.appVersion || fullSession?.deviceInfo?.appVersion || session?.appVersion || '';
    const rawOsVersion = fullSession?.deviceInfo?.osVersion || fullSession?.deviceInfo?.systemVersion || (session as any)?.osVersion || '';
    const platformLabel = platform === 'ios'
        ? 'iOS'
        : platform === 'android'
            ? 'Android'
            : platform === 'web'
                ? 'Web'
                : titleCaseToken(platform || 'unknown');
    const headerOsLabel = isWebSession && webEnvironment
        ? webEnvironment.osLabel
        : `${platformLabel}${rawOsVersion ? ` ${rawOsVersion}` : ''}`;
    const headerOsTitle = isWebSession && webEnvironment
        ? webEnvironment.osTitle
        : headerOsLabel;
    const headerDeviceLabel = isWebSession && webEnvironment
        ? `${webEnvironment.browserLabel} on ${webEnvironment.osLabel}`
        : deviceModel;
    const headerDeviceTitle = isWebSession && webEnvironment
        ? `${webEnvironment.browserTitle} on ${webEnvironment.osTitle}${webEnvironment.sdkVersionLabel ? ` · ${webEnvironment.sdkVersionLabel}` : ''}`
        : rawDeviceModel;
    const webReferral = getWebReferral(fullSession || session);
    const webUtm = isWebSession ? getWebUtmAttribution(fullSession || session) : null;
    const webOsChrome: 'macos' | 'windows' | 'other' | null = isWebSession
        ? (webEnvironment?.osLabel?.toLowerCase().startsWith('macos')
            ? 'macos'
            : webEnvironment?.osLabel?.toLowerCase().startsWith('windows')
                ? 'windows'
                : 'other')
        : null;
    const currentReplayUrl = useMemo(() => {
        const fallback = getWebReplayUrlFallback(fullSession || session);
        if (!isWebSession) return fallback;
        let bestUrl: string | null = null;
        for (const event of allTimelineEvents) {
            const playbackTime = eventTimestampToPlaybackSeconds(event.timestamp);
            if (playbackTime > currentPlaybackTime + 0.05) {
                break;
            }
            if (
                event.type !== 'navigation' &&
                event.type !== 'screen_view' &&
                event.type !== 'app_foreground' &&
                event.type !== 'app_background'
            ) {
                continue;
            }
            bestUrl = getReplayUrlFromEvent(event) || bestUrl;
        }
        return bestUrl || fallback;
    }, [isWebSession, currentPlaybackTime, eventTimestampToPlaybackSeconds, allTimelineEvents, fullSession, session]);
    const loadedSessionId = id || fullSession?.id || null;
    const replayIdentityKey = activeShareToken ? `share:${activeShareToken}` : loadedSessionId;
    const shareVisibility = fullSession?.share?.visibility ?? null;
    const isReplayOnlyShare = isPublicShare && shareVisibility !== 'full_workbench';
    const canShowWorkbenchTools = !isReplayOnlyShare;
    const teamReplayUrl = useMemo(() => {
        if (typeof window === 'undefined' || !loadedSessionId) return '';
        const dashboardPrefix = pathPrefix || '/dashboard';
        return `${window.location.origin}${dashboardPrefix}/sessions/${loadedSessionId}`;
    }, [loadedSessionId, pathPrefix]);
    const hasCurrentFullSession = Boolean(fullSession && (activeShareToken ? true : fullSession.id === id));
    const hasRevealedInitialReplay = Boolean(replayIdentityKey && revealedReplaySessionId === replayIdentityKey);

    useEffect(() => {
        if (isReplayOnlyShare && activeWorkbenchTab !== 'timeline') {
            setActiveWorkbenchTab('timeline');
        }
    }, [activeWorkbenchTab, isReplayOnlyShare]);

    const refreshShareLinks = useCallback(async () => {
        if (!loadedSessionId || isPublicShare || isDemoReplay) return;
        setShareLinksLoading(true);
        setShareError(null);
        try {
            const result = await api.getReplayShareLinks(loadedSessionId);
            setShareCanManage(result.canManage);
            setShareLinks(result.shares || []);
        } catch (err) {
            setShareError(err instanceof Error ? err.message : 'Could not load share links');
        } finally {
            setShareLinksLoading(false);
        }
    }, [isDemoReplay, isPublicShare, loadedSessionId]);

    useEffect(() => {
        if (!showShareMenu || typeof document === 'undefined') return;

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (shareMenuRef.current?.contains(target) || shareButtonRef.current?.contains(target)) return;
            setShowShareMenu(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowShareMenu(false);
            }
        };

        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showShareMenu]);

    const recordingDeleted = (fullSession as any)?.recordingDeleted || session?.recordingDeleted || false;
    const hasSuccessfulRecording =
        (fullSession as any)?.hasSuccessfulRecording
        ?? (session as any)?.hasSuccessfulRecording
        ?? false;
    const isReplayExpired = (fullSession as any)?.isReplayExpired || session?.isReplayExpired || recordingDeleted;
    const replayUnavailableReason: 'deleted' | 'no_recording_data' | null =
        recordingDeleted ? 'deleted' :
            !hasSuccessfulRecording ? 'no_recording_data' :
                null;
    const shouldWaitForReplayBootstrap = Boolean(
        hasCurrentFullSession &&
        !sessionLoadError &&
        !isReplayExpired &&
        !replayUnavailableReason &&
        !rrwebReplayFailed &&
        fullSession?.hasRecording !== false &&
        fullSession?.playbackMode !== 'none' &&
        (
            isReplayManifestLoading ||
            rrwebReplayPreparing ||
            visualReplayPreparing
        )
    );
    const shouldShowInitialReplayLoaderRaw = Boolean(
        !sessionLoadError &&
        (!hasCurrentFullSession || isCoreLoading || shouldWaitForReplayBootstrap)
    );

    useEffect(() => {
        const isRrwebReplay = fullSession?.playbackMode === 'rrweb' || rrwebReplaySegmentCount > 0 || rrwebReplayEvents.length > 0;

        if (shouldShowInitialReplayLoaderRaw || !isRrwebReplay) {
            setIsReplayLoaderSettling(false);
            return;
        }

        setIsReplayLoaderSettling(true);
        const settleTimer = window.setTimeout(() => {
            setIsReplayLoaderSettling(false);
            setRevealedReplaySessionId(replayIdentityKey ?? null);
        }, 140);

        return () => window.clearTimeout(settleTimer);
    }, [fullSession?.playbackMode, replayIdentityKey, rrwebReplayEvents.length, rrwebReplaySegmentCount, shouldShowInitialReplayLoaderRaw]);

    const shouldShowInitialReplayLoader = !hasRevealedInitialReplay && (shouldShowInitialReplayLoaderRaw || isReplayLoaderSettling);

    // ========================================================================
    // EARLY RETURNS (after all hooks)
    // ========================================================================

    // Block only with the single replay-opening loader. Once it clears, the theater
    // either has a playable visual replay or a final unavailable/error state.
    if (shouldShowInitialReplayLoader) {
        return (
            <SessionLoadingOverlay
                isCoreLoading={isCoreLoading || !hasCurrentFullSession}
                isFramesLoading={isFramesLoading || visualReplayPreparing}
                isReplayManifestLoading={isReplayManifestLoading}
                isRrwebSegmentsLoading={rrwebSegmentsLoading || (rrwebReplayPreparing && !isReplayManifestLoading)}
                framesProcessed={(fullSession as FullSession | null)?.screenshotFramesProcessedSegments}
                framesTotal={(fullSession as FullSession | null)?.screenshotFramesTotalSegments}
                rrwebSegmentsLoaded={rrwebSegmentProgress.loaded}
                rrwebSegmentsTotal={rrwebSegmentProgress.total || rrwebReplaySegmentCount}
                replayMode={fullSession?.playbackMode ?? null}
            />
        );
    }

    if (!session && !fullSession) {
        const message = sessionLoadError === 'forbidden'
            ? "You don't have access to this session"
            : sessionLoadError === 'unavailable'
                ? 'Session data is temporarily unavailable'
                : 'Session not found';
        const detail = sessionLoadError === 'forbidden'
            ? 'This replay belongs to another workspace or team.'
            : sessionLoadError === 'unavailable'
                ? 'The API could not load the replay right now. Your session was not cleared.'
                : null;

        return (
            <div className="min-h-screen flex items-center justify-center bg-transparent">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-600 font-semibold">{message}</p>
                    {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
                </div>
            </div>
        );
    }

    // ========================================================================
    // REMAINING COMPUTED VALUES (after early returns, no hooks)
    // ========================================================================

    const durationMinutes = Math.floor(durationSeconds / 60);
    const durationSecs = Math.floor(durationSeconds % 60);

    const geoLocation = fullSession?.geoLocation || fullSession?.geoInfo || session?.geoLocation || null;
    const geoDisplay = formatGeoDisplay(geoLocation);
    const sessionLocationLabel = geoDisplay.fullLabel;

    const rawReplayUserId = (fullSession?.userId ?? '').trim();
    const anonymousFallback = ((fullSession as any)?.anonymousDisplayName as string | undefined)?.trim() || '';
    const replayUserIdCopyValue =
        rawReplayUserId && rawReplayUserId.toLowerCase() !== 'anonymous'
            ? rawReplayUserId
            : anonymousFallback;
    const replayUserIdLabel = replayUserIdCopyValue || 'Anonymous';
    const replayUserIdShown = replayUserIdLabel;
    const canCopyReplayUserId = Boolean(replayUserIdCopyValue);

    // Calculate metrics
    const metrics = fullSession?.metrics || {};
    const timelineRageTapCount = allTimelineEvents.filter((event) => getEventGestureKind(event) === 'rage_tap').length;
    const hasLoadedTimelineEvents = Boolean(fullSession && Array.isArray(fullSession.events));
    const rageTapCount = hasLoadedTimelineEvents
        ? timelineRageTapCount
        : (
            metrics.rageTapCount ??
            fullSession?.rageTapCount ??
            session?.rageTapCount ??
            detectedRageTaps.length ??
            0
        );

    const recordedScreens =
        fullSession?.screensVisited ??
        metrics.screensVisited ??
        session?.screensVisited ??
        [];

    const inferredScreensVisited = Array.from(
        new Set(
            events
                .map((event) => {
                    const directScreen = (event as any).screen;
                    const contextScreen =
                        event.properties?.screenName ||
                        event.properties?.screen ||
                        event.properties?.toScreen ||
                        event.properties?.routeName;
                    return (directScreen || contextScreen || '').toString().trim();
                })
                .filter((screen): screen is string => screen.length > 0)
        )
    );
    const screensVisited = recordedScreens.length > 0 ? recordedScreens : inferredScreensVisited;
    const crashCount = fullSession?.crashes?.length || 0;
    const anrCount = fullSession?.anrs?.length || 0;
    const explicitErrorCount =
        metrics.errorCount ??
        fullSession?.errorCount ??
        session?.errorCount ??
        events.filter((event) => (event.type || '').toLowerCase() === 'error').length;

    const metricsDerivedInteractionCount =
        (metrics.touchCount ?? fullSession?.touchCount ?? session?.touchCount ?? 0) +
        (metrics.scrollCount ?? fullSession?.scrollCount ?? session?.scrollCount ?? 0) +
        (metrics.gestureCount ?? fullSession?.gestureCount ?? session?.gestureCount ?? 0);
    const inferredInteractionCount = events.filter((event) => {
        const type = normalizeEventType(event.type);
        return isGestureEvent(event) || type === 'input';
    }).length;
    const interactionCount = metricsDerivedInteractionCount > 0 ? metricsDerivedInteractionCount : inferredInteractionCount;

    const failedRequestCount = networkRequests.filter((request) => {
        const success = request.success ?? request.statusCode < 400;
        return !success;
    }).length;
    const apiErrorRate = networkRequests.length > 0 ? (failedRequestCount / networkRequests.length) * 100 : 0;
    const apiP95LatencyMs = percentile(
        networkRequests
            .map((request) => request.duration || 0)
            .filter((duration) => Number.isFinite(duration) && duration > 0),
        95
    );

    const issueSignals = crashCount + anrCount + explicitErrorCount + rageTapCount + failedRequestCount;
    const issueSignalsPerMinute = durationSeconds > 0 ? issueSignals / Math.max(1, durationSeconds / 60) : 0;

    const firstInteractionTimestamp = allTimelineEvents
        .filter((event) => {
            const type = normalizeEventType(event.type);
            return isGestureEvent(event) || type === 'input';
        })
        .map((event) => event.timestamp)
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= replayBaseTime)
        .sort((a, b) => a - b)[0];

    const inferredStartupMs =
        ((fullSession as any)?.appStartupTimeMs as number | undefined) ||
        ((session as any)?.appStartupTimeMs as number | undefined) ||
        (firstInteractionTimestamp ? Math.max(0, firstInteractionTimestamp - replayBaseTime) : null);

    const totalPayloadBytes = networkRequests.reduce((sum, request) => {
        const requestBytes = request.requestBodySize ?? request.requestSize ?? 0;
        const responseBytes = request.responseBodySize ?? request.responseSize ?? 0;
        return sum + requestBytes + responseBytes;
    }, 0);
    const compressedStorageBytes = getCompressedStorageBytes(fullSession?.stats);
    const compressedStorageLabel = formatBytesToHuman(compressedStorageBytes);
    const apiVolumePerMinute = durationSeconds > 0 ? networkRequests.length / Math.max(1, durationSeconds / 60) : 0;

    const endpointPerfRows = networkRequests
        .map((request) => {
            const endpointPath =
                request.urlPath ||
                request.path ||
                (() => {
                    try {
                        return new URL(request.url).pathname || request.url;
                    } catch {
                        return request.url || 'unknown';
                    }
                })();
            return {
                key: `${(request.method || 'GET').toUpperCase()} ${endpointPath}`,
                duration: request.duration || 0,
                isError: !(request.success ?? request.statusCode < 400),
            };
        })
        .filter((row) => row.duration > 0);

    const endpointSummary = Array.from(
        endpointPerfRows.reduce((map, row) => {
            const existing = map.get(row.key) || { key: row.key, count: 0, errors: 0, durations: [] as number[] };
            existing.count += 1;
            if (row.isError) existing.errors += 1;
            existing.durations.push(row.duration);
            map.set(row.key, existing);
            return map;
        }, new Map<string, { key: string; count: number; errors: number; durations: number[] }>())
            .values()
    )
        .map((row) => ({
            key: row.key,
            count: row.count,
            errors: row.errors,
            p95: percentile(row.durations, 95),
            avg: row.durations.reduce((sum, duration) => sum + duration, 0) / row.durations.length,
        }))
        .sort((a, b) => b.p95 - a.p95);
    const topSlowEndpoints = endpointSummary.slice(0, 3);
    const apiErrorLevel: InsightLevel = apiErrorRate > 8 ? 'critical' : apiErrorRate > 3 ? 'warning' : 'good';
    const apiLatencyLevel: InsightLevel = apiP95LatencyMs <= 0 ? 'neutral' : apiP95LatencyMs > 1000 ? 'critical' : apiP95LatencyMs > 500 ? 'warning' : 'good';
    const apiErrorGauge = Math.max(6, Math.min(100, apiErrorRate * 12));
    const apiLatencyGauge = apiP95LatencyMs > 0 ? Math.max(6, Math.min(100, apiP95LatencyMs / 12)) : 0;
    const apiErrorInsightStyle = INSIGHT_LEVEL_STYLES[apiErrorLevel];
    const apiLatencyInsightStyle = INSIGHT_LEVEL_STYLES[apiLatencyLevel];
    const apiErrorStatusLabel = apiErrorLevel === 'critical' ? 'High' : apiErrorLevel === 'warning' ? 'Moderate' : 'Low';
    const apiLatencyStatusLabel = apiLatencyLevel === 'critical' ? 'Slow' : apiLatencyLevel === 'warning' ? 'Variable' : apiLatencyLevel === 'neutral' ? 'N/A' : 'Fast';
    const sessionRiskLevel: InsightLevel = issueSignalsPerMinute > 3.5 ? 'critical' : issueSignalsPerMinute > 1.25 ? 'warning' : 'good';
    const sessionRiskStyle = INSIGHT_LEVEL_STYLES[sessionRiskLevel];
    const sessionRiskLabel = sessionRiskLevel === 'critical' ? 'High Pressure' : sessionRiskLevel === 'warning' ? 'Watchlist' : 'Stable';
    const sessionRiskGauge = Math.max(6, Math.min(100, issueSignalsPerMinute * 28));

    const formatEventTime = (timestamp: number) => {
        // Guard against non-finite or absolute-epoch timestamps slipping in: clamp
        // to [0, MAX] so a single bad event time can't render an impossible clock.
        const rawElapsed = Number.isFinite(timestamp) ? (timestamp - replayBaseTime) / 1000 : 0;
        const elapsed = Math.min(Math.max(0, rawElapsed), MAX_PLAYBACK_CLOCK_SECONDS);
        const mins = Math.floor(elapsed / 60);
        const secs = Math.floor(elapsed % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const playbackDisabled = !hasRecording || visualReplayPreparing || isReplayExpired || Boolean(replayUnavailableReason);
    const sortedSessions = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const currentSessionIndex = sortedSessions.findIndex((item) => item.id === id);
    const findReplayNeighborSessionId = (direction: -1 | 1): string | null => {
        if (currentSessionIndex < 0) return null;
        for (let index = currentSessionIndex + direction; index >= 0 && index < sortedSessions.length; index += direction) {
            const candidate = sortedSessions[index];
            if (canNavigateToReplaySession(candidate)) {
                return candidate.id || null;
            }
        }
        return null;
    };
    const previousSessionId = findReplayNeighborSessionId(-1);
    const nextSessionId = findReplayNeighborSessionId(1);

    const HighlightedText: React.FC<{ text: string; search: string }> = ({ text, search }) => {
        if (!search.trim() || !text) return <>{text}</>;
        const normalizedSearch = search.trim().toLowerCase();
        const escaped = escapeRegExp(search.trim());
        const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
        return (
            <>
                {parts.map((part, i) =>
                    part.toLowerCase() === normalizedSearch ? (
                        <mark key={i} className="bg-[#f9a8d4] text-slate-900 px-0.5 rounded-sm">{part}</mark>
                    ) : (
                        part
                    )
                )}
            </>
        );
    };

    const downloadTimelineEvents = () => {
        if (allTimelineEvents.length === 0) return;
        const lines = allTimelineEvents.map(formatTimelineEventForExport);
        const file = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-${(id || 'unknown').slice(0, 16)}-timeline.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const downloadAllTerminalLogs = () => {
        if (terminalLogRows.length === 0) return;
        const text = terminalLogRows.map(row => `[${formatPlaybackTime(row.relativeSeconds)}] [${row.marker || row.level.toUpperCase()}] ${row.message}`).join('\n');
        const file = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-${(id || 'unknown').slice(0, 16)}-console.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const copyAllTerminalLogs = async () => {
        if (terminalLogRows.length === 0) return;
        const text = terminalLogRows.map(row => `[${formatPlaybackTime(row.relativeSeconds)}] [${row.marker || row.level.toUpperCase()}] ${row.message}`).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setTerminalCopied(true);
            setTimeout(() => setTerminalCopied(false), 2000);
        } catch {
            setTerminalCopied(false);
        }
    };

    const copyTimelineEvents = async () => {
        if (allTimelineEvents.length === 0) return;
        const lines = allTimelineEvents.map(formatTimelineEventForExport);
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            setTimelineCopied(true);
            setTimeout(() => setTimelineCopied(false), 2000);
        } catch {
            setTimelineCopied(false);
        }
    };

    const downloadDOMHierarchy = () => {
        const absoluteTime = currentPlaybackRawTimestamp;
        const currentHierarchy = hierarchySnapshots.reduce((prev, curr) =>
            Math.abs(curr.timestamp - absoluteTime) < Math.abs(prev.timestamp - absoluteTime) ? curr : prev
            , hierarchySnapshots[0]);

        if (!currentHierarchy) return;

        const file = new Blob([JSON.stringify(currentHierarchy, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-${(id || 'unknown').slice(0, 16)}-dom-${Math.round(currentPlaybackRawTimeSeconds)}s.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const copyDOMHierarchy = async () => {
        const absoluteTime = currentPlaybackRawTimestamp;
        const currentHierarchy = hierarchySnapshots.reduce((prev, curr) =>
            Math.abs(curr.timestamp - absoluteTime) < Math.abs(prev.timestamp - absoluteTime) ? curr : prev
            , hierarchySnapshots[0]);

        if (!currentHierarchy) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(currentHierarchy, null, 2));
            setDomCopied(true);
            setTimeout(() => setDomCopied(false), 2000);
        } catch {
            setDomCopied(false);
        }
    };

    const rawMetadata = (fullSession as any)?.metadata as Record<string, unknown> | undefined;
    const metadata = isWebSession
        ? buildCollectedWebMetadata(fullSession || session)
        : rawMetadata && typeof rawMetadata === 'object'
            ? rawMetadata
            : undefined;
    const hasMetadata = Boolean(metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0);
    const metadataJson = hasMetadata ? JSON.stringify(metadata, null, 2) : '';

    const copyMetadata = async () => {
        if (!metadataJson) return;
        try {
            await navigator.clipboard.writeText(metadataJson);
            setMetadataCopied(true);
            setTimeout(() => setMetadataCopied(false), 2000);
        } catch {
            setMetadataCopied(false);
        }
    };

    const copySessionId = async () => {
        if (!id) return;
        try {
            await navigator.clipboard.writeText(id);
            setSessionIdCopied(true);
            setTimeout(() => setSessionIdCopied(false), 2000);
        } catch {
            setSessionIdCopied(false);
        }
    };

    const copyReplayUserId = async () => {
        if (!replayUserIdCopyValue) return;
        try {
            await navigator.clipboard.writeText(replayUserIdCopyValue);
            setUserIdCopied(true);
            setTimeout(() => setUserIdCopied(false), 2000);
        } catch {
            setUserIdCopied(false);
        }
    };

    const copyCurrentReplayUrl = async () => {
        const replayUrl = currentReplayUrl.trim();
        if (!replayUrl) return;
        try {
            await navigator.clipboard.writeText(replayUrl);
            setReplayUrlCopied(true);
            setTimeout(() => setReplayUrlCopied(false), 2000);
        } catch {
            setReplayUrlCopied(false);
        }
    };

    const copyTeamReplayLink = async () => {
        if (!teamReplayUrl) return;
        try {
            await navigator.clipboard.writeText(teamReplayUrl);
            setTeamLinkCopied(true);
            setTimeout(() => setTeamLinkCopied(false), 2000);
        } catch {
            setTeamLinkCopied(false);
        }
    };

    const copyUnlistedShareLink = async (share: ReplayShareLink) => {
        if (!share.url) return;
        try {
            await navigator.clipboard.writeText(share.url);
            setCopiedShareId(share.id);
            setTimeout(() => setCopiedShareId((current) => current === share.id ? null : current), 2000);
        } catch {
            setCopiedShareId(null);
        }
    };

    const createUnlistedShareLink = async () => {
        if (!loadedSessionId || !shareCanManage) return;
        setShareActionBusy(true);
        setShareError(null);
        try {
            const result = await api.createReplayShareLink(loadedSessionId, {
                visibility: selectedShareVisibility,
                expiresIn: selectedShareExpiry,
            });
            setShareLinks((current) => upsertShareLink(current, result.share));
            await copyUnlistedShareLink(result.share);
        } catch (err) {
            setShareError(err instanceof Error ? err.message : 'Could not create share link');
        } finally {
            setShareActionBusy(false);
        }
    };

    const revokeUnlistedShareLink = async (shareId: string) => {
        if (!loadedSessionId || !shareCanManage) return;
        setShareActionBusy(true);
        setShareError(null);
        try {
            const result = await api.revokeReplayShareLink(loadedSessionId, shareId);
            setShareLinks((current) => current.map((share) => share.id === result.share.id ? result.share : share));
        } catch (err) {
            setShareError(err instanceof Error ? err.message : 'Could not revoke share link');
        } finally {
            setShareActionBusy(false);
        }
    };

    const replayUrlCopyButton = (
        <button
            type="button"
            onClick={copyCurrentReplayUrl}
            disabled={!currentReplayUrl.trim()}
            className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-slate-500 transition hover:bg-black/5 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            title={currentReplayUrl.trim() ? 'Copy visited URL' : 'No URL to copy'}
            aria-label="Copy visited URL"
        >
            {replayUrlCopied ? (
                <Check className="h-3 w-3 text-emerald-600" strokeWidth={2.25} />
            ) : (
                <Copy className="h-3 w-3" strokeWidth={2.25} />
            )}
        </button>
    );

    const downloadMetadata = () => {
        if (!metadataJson) return;
        const file = new Blob([metadataJson], { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-${(id || 'unknown').slice(0, 16)}-metadata.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const activeShareLinks = shareLinks.filter(isShareLinkUsable);
    const selectedShareVisibilityOption =
        SHARE_VISIBILITY_OPTIONS.find((option) => option.value === selectedShareVisibility) ?? SHARE_VISIBILITY_OPTIONS[0];
    const selectedShareExpiryLabel =
        SHARE_EXPIRY_OPTIONS.find((option) => option.value === selectedShareExpiry)?.label ?? '7 days';
    const activeShareLinksLabel = activeShareLinks.length === 1 ? '1 active' : `${activeShareLinks.length} active`;
    const shareMenu = !isPublicShare ? (
        <div
            id="replay-share-menu"
            ref={shareMenuRef}
            className="replay-share-popover"
            role="dialog"
            aria-modal="false"
            aria-labelledby="replay-share-title"
        >
            <div className="replay-share-header">
                <div className="replay-share-header-icon">
                    <Share2 className="h-4 w-4" strokeWidth={2.4} />
                </div>
                <div className="min-w-0 flex-1">
                    <p id="replay-share-title" className="replay-share-title">Share replay</p>
                    <p className="replay-share-subtitle">Copy a team URL or create an unlisted public link.</p>
                </div>
                <button
                    type="button"
                    onClick={() => setShowShareMenu(false)}
                    className="replay-share-icon-action"
                    title="Close share panel"
                    aria-label="Close share panel"
                >
                    <X className="h-4 w-4" strokeWidth={2.3} />
                </button>
            </div>

            <div className="replay-share-body">
                <section className="replay-share-section replay-share-team-section" aria-label="Team link">
                    <div className="min-w-0">
                        <span className="replay-share-section-kicker">Team link</span>
                        <p className="replay-share-section-copy">For teammates who already have dashboard access.</p>
                    </div>
                    <button
                        type="button"
                        onClick={copyTeamReplayLink}
                        disabled={!teamReplayUrl}
                        className={`replay-share-action-button ${teamLinkCopied ? 'is-success' : ''}`}
                    >
                        {teamLinkCopied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                        <span>{teamLinkCopied ? 'Copied' : 'Copy team link'}</span>
                    </button>
                </section>

                <section className="replay-share-section" aria-label="Unlisted link settings">
                    <div className="replay-share-section-heading">
                        <div className="min-w-0">
                            <span className="replay-share-section-kicker">Unlisted link</span>
                            <p className="replay-share-section-copy">
                                {shareCanManage
                                    ? `${selectedShareVisibilityOption.label}. Expires in ${selectedShareExpiryLabel.toLowerCase()}.`
                                    : 'Owner or admin access is required to manage public links.'}
                            </p>
                        </div>
                        {shareLinksLoading ? <span className="replay-share-status-pill">Loading</span> : null}
                    </div>

                    {shareLinksLoading && !shareCanManage && activeShareLinks.length === 0 ? (
                        <div className="replay-share-empty-state">Loading share settings...</div>
                    ) : shareCanManage ? (
                        <>
                            <div className="replay-share-choice-grid">
                                {SHARE_VISIBILITY_OPTIONS.map((option) => {
                                    const isSelected = selectedShareVisibility === option.value;
                                    return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setSelectedShareVisibility(option.value)}
                                        className={`replay-share-choice ${isSelected ? 'is-selected' : ''}`}
                                        aria-pressed={isSelected}
                                    >
                                        <span className="replay-share-choice-title">{option.label}</span>
                                        <span className="replay-share-choice-description">{option.description}</span>
                                    </button>
                                    );
                                })}
                            </div>

                            <div className="replay-share-create-row">
                                <label className="replay-share-field">
                                    <span className="replay-share-field-label">
                                        <Clock className="h-3.5 w-3.5" strokeWidth={2.25} />
                                        Expires
                                    </span>
                                <select
                                    value={selectedShareExpiry}
                                    onChange={(event) => setSelectedShareExpiry(event.target.value as ReplayShareExpirationPreset)}
                                        className="replay-share-select"
                                    aria-label="Unlisted link expiry"
                                >
                                    {SHARE_EXPIRY_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                </label>
                                <button
                                    type="button"
                                    onClick={createUnlistedShareLink}
                                    disabled={shareActionBusy || !loadedSessionId}
                                    className="replay-share-create-button"
                                >
                                    <Share2 className="h-4 w-4" />
                                    <span>{shareActionBusy ? 'Working...' : 'Create & copy'}</span>
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="replay-share-empty-state">
                            Owner/admin required to create or revoke unlisted replay links.
                        </div>
                    )}
                </section>

                <section className="replay-share-section replay-share-links-section" aria-label="Active unlisted links">
                    <div className="replay-share-links-heading">
                        <span className="replay-share-section-kicker">Active links</span>
                        <span className="replay-share-links-count">{shareLinksLoading ? 'Loading' : activeShareLinksLabel}</span>
                    </div>

                    {activeShareLinks.length === 0 ? (
                        <div className="replay-share-empty-state">
                            {shareLinksLoading ? 'Checking existing links...' : 'No active unlisted links yet.'}
                        </div>
                    ) : (
                        <div className="replay-share-links-list">
                            {activeShareLinks.map((share) => (
                                <div key={share.id} className="replay-share-link-row">
                                    <div className="replay-share-link-icon">
                                        <Link2 className="h-4 w-4" strokeWidth={2.25} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="replay-share-link-meta">
                                            <span className="replay-share-link-kind">{SHARE_VISIBILITY_LABELS[share.visibility]}</span>
                                            <span className="replay-share-link-status">{formatShareLinkStatus(share)}</span>
                                        </div>
                                        <p className="replay-share-link-url" title={share.url || undefined}>
                                            {formatShareLinkPreview(share)}
                                        </p>
                                    </div>
                                    <div className="replay-share-link-actions">
                                        <button
                                            type="button"
                                            onClick={() => copyUnlistedShareLink(share)}
                                            className={`replay-share-link-action ${copiedShareId === share.id ? 'is-success' : ''}`}
                                            title="Copy unlisted link"
                                            aria-label="Copy unlisted link"
                                        >
                                            {copiedShareId === share.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                        </button>
                                        {shareCanManage ? (
                                            <button
                                                type="button"
                                                onClick={() => void revokeUnlistedShareLink(share.id)}
                                                disabled={shareActionBusy}
                                                className="replay-share-link-action is-danger"
                                                title="Revoke unlisted link"
                                                aria-label="Revoke unlisted link"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {shareError ? (
                    <div className="replay-share-error" role="alert">
                        <AlertCircle className="h-4 w-4" strokeWidth={2.25} />
                        <span>{shareError}</span>
                    </div>
                ) : null}
            </div>
        </div>
    ) : null;

    return (
        <div className="rejourney-replay-workbench replay-workbench-page flex min-h-screen flex-col bg-[#f8fafd] xl:h-full xl:min-h-0 xl:overflow-hidden">
            <div className="replay-workbench-header border-b border-slate-200 bg-white md:sticky md:top-0 md:z-40 xl:shrink-0">
                <div className="replay-header-shell mx-auto flex w-full max-w-[1920px] items-center gap-2 px-3 py-1.5 sm:px-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        {!isPublicShare ? (
                            <button
                                onClick={handleBackClick}
                                className="replay-header-icon-button flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 bg-white text-slate-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow"
                                aria-label="Back to sessions"
                                title="Back to sessions"
                            >
                                <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
                            </button>
                        ) : null}

                        <div className="flex min-w-0 items-center gap-2">
                            <h1 className="truncate text-[15px] font-black text-slate-950 sm:text-base">
                                {isPublicShare ? 'Shared Replay' : 'Replay Workbench'}
                            </h1>
                            <div className="hidden shrink-0 items-center gap-1 sm:flex">
                                <span className="replay-header-chip bg-[#e0f2fe] text-slate-950">
                                    {isWebSession ? webEnvironment?.browserLabel : platform.toUpperCase()}
                                </span>
                                {isWebSession && webEnvironment ? (
                                    <span className="replay-header-chip bg-[#fce7f3] text-slate-950">
                                        {webEnvironment.osLabel}
                                    </span>
                                ) : appVersion && (
                                    <span className="replay-header-chip bg-[#fce7f3] text-slate-950">
                                        v{appVersion}
                                    </span>
                                )}
                                <span className="replay-header-chip replay-header-duration-chip">
                                    {durationMinutes}m {durationSecs.toString().padStart(2, '0')}s
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="replay-header-actions relative flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                setShowHeaderDetails((open) => {
                                    const next = !open;
                                    if (next) setShowShareMenu(false);
                                    return next;
                                });
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            className="replay-header-details-button"
                            aria-expanded={showHeaderDetails}
                            aria-haspopup="menu"
                            aria-controls="replay-header-details"
                            title="Session details menu"
                        >
                            <UserRound className="h-3.5 w-3.5" strokeWidth={2.25} />
                            <span className="hidden sm:inline">Details</span>
                            <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${showHeaderDetails ? 'rotate-180' : ''}`}
                                strokeWidth={2.5}
                                aria-hidden="true"
                            />
                        </button>

                        {!isPublicShare ? (
	                            <>
	                                <button
	                                    ref={shareButtonRef}
	                                    type="button"
	                                    onClick={() => {
	                                        const next = !showShareMenu;
	                                        setShowShareMenu(next);
	                                        if (next) {
	                                            setShowHeaderDetails(false);
	                                            void refreshShareLinks();
	                                        }
	                                    }}
	                                    onMouseDown={(event) => event.preventDefault()}
	                                    className="replay-share-trigger"
	                                    aria-expanded={showShareMenu}
	                                    aria-haspopup="dialog"
	                                    aria-controls="replay-share-menu"
                                    title="Share replay"
                                >
                                    <Share2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                                    <span className="hidden sm:inline">Share</span>
                                </button>
                                {showShareMenu ? shareMenu : null}
                            </>
                        ) : null}

                        {!isPublicShare ? (
                        <div className="replay-header-session-nav grid grid-cols-2 overflow-hidden border border-slate-200 bg-slate-50 shadow-sm">
                            <button
                                onClick={() => previousSessionId && navigate(`${pathPrefix}/sessions/${previousSessionId}`)}
                                onMouseDown={(event) => event.preventDefault()}
                                disabled={!previousSessionId}
                                className={`replay-header-nav-button border-r border-slate-200 ${previousSessionId
                                    ? 'bg-white text-slate-900 hover:bg-slate-50'
                                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                                    }`}
                                aria-label="Previous session"
                                title="Previous session"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
                                <span className="hidden md:inline">Prev</span>
                            </button>
                            <button
                                onClick={() => nextSessionId && navigate(`${pathPrefix}/sessions/${nextSessionId}`)}
                                onMouseDown={(event) => event.preventDefault()}
                                disabled={!nextSessionId}
                                className={`replay-header-nav-button ${nextSessionId
                                    ? 'bg-white text-slate-900 hover:bg-slate-50'
                                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                                    }`}
                                aria-label="Next session"
                                title="Next session"
                            >
                                <span className="hidden md:inline">Next</span>
                                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
                        </div>
                        ) : null}

                        {showHeaderDetails && (
                            <div id="replay-header-details" className="replay-header-details-popover" role="menu">
                                <div className="replay-header-detail-row">
                                    <span>Started</span>
                                    <strong>{new Date(startTime).toLocaleString()}</strong>
                                </div>
                                <div className="replay-header-detail-row">
                                    <span>Device</span>
                                    <strong title={headerDeviceTitle}>{headerDeviceLabel}</strong>
                                </div>
                                <div className="replay-header-detail-row">
                                    <span>OS</span>
                                    <strong title={headerOsTitle}>{headerOsLabel}</strong>
                                </div>
                                <div className="replay-header-detail-row">
                                    <span>Location</span>
                                    <strong className="inline-flex items-center gap-1.5">
                                        <CountryFlag
                                            countryCode={geoDisplay.countryCode}
                                            countryLabel={geoDisplay.countryLabel}
                                            className="h-4"
                                            imageClassName="h-4 w-4"
                                            decorative
                                        />
                                        <span>{sessionLocationLabel}</span>
                                    </strong>
                                </div>
                                {!isPublicShare ? (
                                    <div className="replay-header-detail-row">
                                        <span>Session</span>
                                        <button
                                            type="button"
                                            onClick={copySessionId}
                                            className="replay-header-detail-copy"
                                            title={`${id} - click to copy`}
                                            aria-label={`Copy session ID: ${id}`}
                                        >
                                            <span>{id || 'Unknown'}</span>
                                            {sessionIdCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                        </button>
                                    </div>
                                ) : null}
                                {!isPublicShare ? (
                                    <div className="replay-header-detail-row">
                                        <span>User ID</span>
                                        {canCopyReplayUserId ? (
                                            <button
                                                type="button"
                                                onClick={copyReplayUserId}
                                                className="replay-header-detail-copy"
                                                title={`${replayUserIdLabel} - click to copy`}
                                                aria-label={`Copy user ID: ${replayUserIdLabel}`}
                                            >
                                                <span>{replayUserIdShown}</span>
                                                {userIdCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                            </button>
                                        ) : (
                                            <strong>{replayUserIdShown}</strong>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="replay-workbench-main mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 xl:min-h-0 xl:flex-1 xl:gap-3 xl:overflow-hidden xl:py-3">
                <div className="replay-workbench-grid grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-12 xl:gap-3">
                    <section className={`replay-theater-section flex min-w-0 max-w-full flex-col overflow-hidden border border-black bg-white shadow-neo-sm xl:h-full xl:min-h-0 ${isWebSession ? 'xl:col-span-8' : 'xl:col-span-7'}`}>
                        {!isWebSession && (
                        <div className="replay-theater-toolbar border-b border-black bg-white px-3 py-2.5 text-black sm:px-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
	                                <div className="flex min-w-0 items-center gap-2">
	                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-black bg-[#67e8f9]">
	                                        <Monitor className="h-3.5 w-3.5" />
	                                    </span>
	                                    <p className="truncate text-[11px] font-black uppercase text-black">
	                                        Replay Theater
	                                    </p>
	                                </div>
		                                <div className="replay-theater-meta dashboard-mobile-scroll flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto text-[9px] font-black uppercase text-slate-700 sm:flex-wrap sm:overflow-visible md:text-[10px]">
			                                    {playbackMode !== 'rrweb' ? (
		                                        <span className="border border-black bg-[#67e8f9] px-2 py-1 text-black">
		                                            {screenshotFrames.length > 0
		                                                ? `Frame ${Math.min(currentFrameIndex + 1, screenshotFrames.length)}/${screenshotFrames.length}`
		                                                : `${displayedFrameCount} FR`}
		                                        </span>
		                                    ) : null}
	                                    <span
                                        className="border border-black bg-[#f8fafc] px-2 py-1"
                                        title="Compressed S3 storage for this session"
                                    >
                                        {compressedStorageLabel}
                                    </span>
                                    {(() => {
                                        const visitNum = (fullSession as any)?.visitorSessionNumber;
                                        if (!visitNum) return null;
                                        return (
                                            <span className="border border-black bg-[#f8fafc] px-2 py-1">
                                                {getOrdinal(visitNum)} Visit
                                            </span>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                        )}

	                        <div className="replay-theater-stage relative border-b border-black bg-white px-3 py-5 sm:px-5 sm:py-7 xl:flex xl:min-h-0 xl:flex-1 xl:items-center xl:justify-center xl:overflow-hidden xl:px-4 xl:py-3">
	                            <div
	                                className={`mx-auto flex w-full items-center justify-center xl:h-full xl:min-h-0 ${playbackMode === 'rrweb' ? 'max-w-none' : isWebSession ? 'max-w-[1080px] xl:max-w-[1120px]' : screenshotReplayShellMaxWidthClass}`}
	                                style={replayDeviceSizingVars}
	                            >
	                                {(isReplayExpired || replayUnavailableReason || !hasRecording) ? (
	                                    <div className={`replay-device-placeholder flex w-full flex-col items-center justify-center border-2 border-dashed border-black bg-white p-6 text-center shadow-neo-sm ${isWebSession ? 'aspect-[16/10] max-w-[920px]' : 'aspect-[9/18.5] max-w-[320px]'}`}>
	                                        {isWebSession ? <MonitorSmartphone className="h-10 w-10 text-slate-400" /> : <VideoOff className="h-10 w-10 text-slate-400" />}
	                                        <p className="mt-3 text-sm font-bold text-slate-900">{isWebSession ? 'Browser Replay Not Available' : 'Replay Not Available'}</p>
	                                        {replayUnavailableReason === 'deleted' ? (
	                                            <p className="mt-2 text-xs leading-5 text-slate-600">
	                                                Visual media was removed by retention policy, but timeline events, logs, and network traces are still available.
	                                            </p>
	                                        ) : replayUnavailableReason === 'no_recording_data' ? (
	                                            <p className="mt-2 text-xs leading-5 text-slate-600">
	                                                {isWebSession
	                                                    ? 'No browser replay was successfully uploaded for this session. You can still inspect all telemetry.'
	                                                    : 'No screenshot recording was successfully uploaded for this session. You can still inspect all telemetry.'}
	                                            </p>
	                                        ) : (
	                                            <p className="mt-2 text-xs leading-5 text-slate-600">
	                                                No visual frames were uploaded for this session.
                                            </p>
                                        )}
	                                    </div>
                                ) : rrwebReplayFailed ? (
                                    <div className="flex aspect-[16/10] w-full max-w-[920px] flex-col items-center justify-center border-2 border-dashed border-black bg-white p-6 text-center shadow-neo-sm">
                                        <MonitorSmartphone className="h-10 w-10 text-slate-400" />
                                        <p className="mt-3 text-sm font-bold text-slate-900">Browser replay failed to load</p>
                                        <p className="mt-2 max-w-md text-xs leading-5 text-slate-600">
                                            Timeline, logs, and network evidence are available, but the rrweb replay segment download failed.
                                            Refreshing the replay will request a fresh manifest and signed segment URLs.
                                        </p>
                                    </div>
                                ) : playbackMode === 'rrweb' ? (
                                    <div className="replay-device-shell replay-browser-shell relative flex h-full min-h-[420px] w-full justify-center xl:min-h-0 xl:items-stretch">
                                        <div className="replay-browser-window relative flex h-full min-h-[420px] w-full flex-col overflow-hidden border border-black bg-white shadow-[0_18px_45px_rgba(15,23,42,0.12)] xl:min-h-0">
                                            {/* macOS window chrome */}
                                            {webOsChrome === 'macos' && (
                                                <div className="flex shrink-0 items-center gap-3 border-b border-black/10 bg-[#e8e8e8] px-3 py-2">
                                                    <div className="flex items-center gap-[6px]">
                                                        <span className="h-3 w-3 rounded-full bg-[#FF5F57] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]" />
                                                        <span className="h-3 w-3 rounded-full bg-[#FFBD2E] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]" />
                                                        <span className="h-3 w-3 rounded-full bg-[#28C840] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]" />
                                                    </div>
                                                    <div className="flex min-w-0 flex-1 justify-center">
                                                        <div className="flex w-full max-w-sm items-center gap-1.5 rounded bg-white/80 px-2.5 py-0.5 text-[11px] text-slate-400 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]">
                                                            <Globe className="h-3 w-3 shrink-0 text-slate-400" />
                                                            <span className="min-w-0 flex-1 truncate" title={currentReplayUrl}>{currentReplayUrl}</span>
                                                            {replayUrlCopyButton}
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2 text-[9px] font-black uppercase text-slate-400">
                                                        {webReferral && <span className="max-w-[8rem] truncate" title={webReferral}>↩ {webReferral}</span>}
                                                        {webUtm && <span className={`max-w-[8rem] truncate ${webUtm.hasUtm ? '' : 'text-slate-300'}`} title={webUtm.title}>UTM {webUtm.label}</span>}
                                                        <span title="Compressed S3 storage">{compressedStorageLabel}</span>
                                                    </div>
                                                </div>
                                            )}
                                            {/* Windows window chrome */}
                                            {webOsChrome === 'windows' && (
                                                <div className="flex shrink-0 items-center border-b border-black/10 bg-[#f3f3f3]">
                                                    <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500">
                                                        <Globe className="h-3 w-3 shrink-0 text-slate-400" />
                                                        <span className="min-w-0 flex-1 truncate" title={currentReplayUrl}>{currentReplayUrl}</span>
                                                        {replayUrlCopyButton}
                                                        {webReferral && <span className="shrink-0 text-slate-400" title={webReferral}>· ↩ {webReferral}</span>}
                                                        {webUtm && <span className={`max-w-[8rem] shrink truncate ${webUtm.hasUtm ? 'text-slate-400' : 'text-slate-300'}`} title={webUtm.title}>· UTM {webUtm.label}</span>}
                                                    </div>
                                                    <div className="shrink-0 px-3 text-[9px] font-black uppercase text-slate-400">{compressedStorageLabel}</div>
                                                    <div className="flex shrink-0 items-stretch text-slate-500">
                                                        <span className="flex h-8 w-10 items-center justify-center text-sm hover:bg-black/5">&#x2013;</span>
                                                        <span className="flex h-8 w-10 items-center justify-center text-xs hover:bg-black/5">&#x25A1;</span>
                                                        <span className="flex h-8 w-10 items-center justify-center text-sm hover:bg-[#c42b1c] hover:text-white">&#x2715;</span>
                                                    </div>
                                                </div>
                                            )}
                                            {/* Linux / other browser chrome */}
                                            {webOsChrome === 'other' && (
                                                <div className="flex shrink-0 items-center gap-3 border-b border-black/10 bg-[#f0f0f0] px-3 py-2">
                                                    <div className="flex min-w-0 flex-1 justify-center">
                                                        <div className="flex w-full max-w-sm items-center gap-1.5 rounded bg-white/80 px-2.5 py-0.5 text-[11px] text-slate-400 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]">
                                                            <Globe className="h-3 w-3 shrink-0 text-slate-400" />
                                                            <span className="min-w-0 flex-1 truncate" title={currentReplayUrl}>{currentReplayUrl}</span>
                                                            {replayUrlCopyButton}
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2 text-[9px] font-black uppercase text-slate-400">
                                                        {webReferral && <span className="max-w-[8rem] truncate" title={webReferral}>↩ {webReferral}</span>}
                                                        {webUtm && <span className={`max-w-[8rem] truncate ${webUtm.hasUtm ? '' : 'text-slate-300'}`} title={webUtm.title}>UTM {webUtm.label}</span>}
                                                        <span>{compressedStorageLabel}</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="replay-browser-viewport relative min-h-[360px] flex-1 xl:min-h-0">
                                                <WebReplayPlayer
                                                    events={compressedRrwebReplayEvents}
                                                    replayKey={id}
                                                    currentTime={currentPlaybackTime}
                                                    isPlaying={isPlaying}
                                                    playbackRate={playbackRate}
                                                    durationSeconds={webReplayDurationSeconds}
                                                    backgroundGaps={webReplayBackgroundGaps}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ) : playbackMode === 'screenshots' ? (
                                    <div className="replay-device-shell relative flex w-full justify-center xl:h-full xl:min-h-0 xl:items-center">
                                        <div className="replay-device-frame relative overflow-hidden rounded-[2rem] border border-slate-950 bg-[#070b14] p-[5px] shadow-[0_18px_45px_rgba(15,23,42,0.18)]">
                                            <div className="rounded-[1.7rem] bg-slate-900 p-[2px]">
                                                <div
                                                    className="relative overflow-hidden rounded-[1.55rem] bg-slate-900"
                                                    style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                                                >
                                                    {platform === 'android' ? (
                                                        <div className="pointer-events-none absolute left-1/2 top-2.5 z-20 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-slate-900" />
                                                    ) : (
                                                        <div className="pointer-events-none absolute left-1/2 top-2 z-20 flex h-5 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-slate-900">
                                                            <div className="mr-1.5 h-1.5 w-1.5 rounded-full bg-slate-700" />
                                                            <div className="h-2.5 w-2.5 rounded-full border border-slate-700 bg-slate-800" />
                                                        </div>
                                                    )}

                                                    {/* First frame as poster - shows immediately while canvas loads */}
                                                    {screenshotFrames[0]?.url && (
                                                        <img
                                                            src={screenshotFrames[0].url}
                                                            alt=""
                                                            loading="eager"
                                                            decoding="async"
                                                            onError={(event) => {
                                                                const fallbackUrl = screenshotFrames[0]?.proxyUrl;
                                                                if (fallbackUrl && event.currentTarget.dataset.fallbackApplied !== 'true') {
                                                                    event.currentTarget.dataset.fallbackApplied = 'true';
                                                                    event.currentTarget.src = fallbackUrl;
                                                                }
                                                            }}
                                                            className="absolute inset-0 h-full w-full object-cover"
                                                            style={{ zIndex: 0 }}
                                                        />
                                                    )}
                                                    <canvas
                                                        ref={canvasRef}
                                                        width={deviceWidth}
                                                        height={deviceHeight}
                                                        className="absolute inset-0 h-full w-full object-cover"
                                                        style={{ zIndex: 1 }}
                                                    />

                                                    {showTouchOverlay && (
                                                        <TouchOverlay
                                                            events={touchEvents}
                                                            deviceWidth={deviceWidth}
                                                            deviceHeight={deviceHeight}
                                                            currentTime={currentPlaybackRawTimestamp}
                                                            visibleWindowMs={800}
                                                        />
                                                    )}

                                                    {activeScreenshotBackgroundGap && (
                                                        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-6 text-center text-white">
                                                            <div className="border border-white/20 bg-slate-950 px-5 py-4 shadow-2xl">
                                                                <div className="text-xs font-black uppercase tracking-wide text-slate-300">App in background</div>
                                                                <div className="mt-2 text-lg font-black">Away for {formatBackgroundGapDuration(activeScreenshotBackgroundGap.durationMs)}</div>
                                                            </div>
                                                        </div>
                                                    )}


                                                    <div className="pointer-events-none absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-slate-900/30" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`replay-device-placeholder flex w-full flex-col items-center justify-center border-2 border-dashed border-black bg-white p-6 text-center shadow-neo-sm ${isWebSession ? 'aspect-[16/10] max-w-[920px]' : 'aspect-[9/18.5] max-w-[320px]'}`}>
                                        {isWebSession ? <MonitorSmartphone className="h-10 w-10 text-slate-400" /> : <VideoOff className="h-10 w-10 text-slate-400" />}
                                        <p className="mt-3 text-sm font-bold text-slate-900">{isWebSession ? 'Browser Replay Not Available' : 'Replay Not Available'}</p>
                                        <p className="mt-2 text-xs leading-5 text-slate-600">
                                            No visual frames were uploaded for this session.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {playbackMode !== 'none' ? (
                            <>
                                <div className="replay-playback-controls border-b-2 border-black bg-white px-3 py-1.5 xl:shrink-0 xl:px-4 xl:py-1">
                                    <div className="flex w-full flex-wrap items-center justify-center gap-2 overflow-visible lg:flex-nowrap lg:justify-between">
                                        {/* Primary Controls */}
                                        <div className="replay-controls-primary flex shrink-0 items-center justify-center gap-1.5 sm:justify-start">
                                            {playbackMode === 'screenshots' && (
                                                <button
                                                    onClick={() => stepFrame(-1)}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    disabled={playbackDisabled}
                                                    className={`replay-control-button hidden h-9 w-9 items-center justify-center border-2 transition xl:flex ${playbackDisabled
                                                        ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                    title="Previous frame"
                                                    aria-label="Previous frame"
                                                    data-tooltip="Previous frame"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => skip(-REPLAY_SKIP_SECONDS)}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`replay-control-button flex h-9 w-9 items-center justify-center border-2 transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                    : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                    }`}
                                                title="Back 10 seconds (Left arrow)"
                                                aria-label="Back 10 seconds"
                                                data-tooltip="Back 10 seconds"
                                            >
                                                <span className="relative flex h-5 w-5 items-center justify-center">
                                                    <RotateCcw className="h-4 w-4" />
                                                    <span className="absolute text-[8px] font-black leading-none">10</span>
                                                </span>
                                            </button>
                                            <button
                                                onClick={togglePlayPause}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`replay-control-button replay-control-button-primary flex h-11 w-11 items-center justify-center border-2 border-black text-black shadow-neo-sm transition-all ${playbackDisabled
                                                    ? 'cursor-not-allowed bg-slate-300 text-slate-200'
                                                    : isPlaying
                                                        ? 'bg-[#fde047] hover:-translate-y-0.5 hover:shadow-neo'
                                                        : 'bg-[#86efac] hover:-translate-y-0.5 hover:shadow-neo'
                                                    }`}
                                                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                                                aria-label={isPlaying ? 'Pause' : 'Play'}
                                                data-tooltip={isPlaying ? 'Pause' : 'Play'}
                                            >
                                                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                                            </button>
                                            <button
                                                onClick={() => skip(REPLAY_SKIP_SECONDS)}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`replay-control-button flex h-9 w-9 items-center justify-center border-2 transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                    : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                    }`}
                                                title="Forward 10 seconds (Right arrow)"
                                                aria-label="Forward 10 seconds"
                                                data-tooltip="Forward 10 seconds"
                                            >
                                                <span className="relative flex h-5 w-5 items-center justify-center">
                                                    <RotateCw className="h-4 w-4" />
                                                    <span className="absolute text-[8px] font-black leading-none">10</span>
                                                </span>
                                            </button>
                                            {playbackMode === 'screenshots' && (
                                                <button
                                                    onClick={() => stepFrame(1)}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    disabled={playbackDisabled}
                                                    className={`replay-control-button hidden h-9 w-9 items-center justify-center border-2 transition xl:flex ${playbackDisabled
                                                        ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                    title="Next frame"
                                                    aria-label="Next frame"
                                                    data-tooltip="Next frame"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={restart}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`replay-control-button flex h-9 w-9 items-center justify-center border-2 transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                    : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                    }`}
                                                title="Restart replay"
                                                aria-label="Restart replay"
                                                data-tooltip="Restart replay"
                                            >
                                                <RefreshCw className="h-4 w-4" />
                                            </button>
                                        </div>

                                        {/* Secondary Controls */}
                                        <div className="replay-controls-secondary flex shrink-0 flex-nowrap items-center justify-center gap-1.5 lg:justify-end">
                                            <span className="inline-flex h-8 min-w-[7.75rem] items-center justify-center border-2 border-black bg-[#f8fafc] px-2 font-mono text-[11px] font-black text-black shadow-neo-sm">
                                                <span ref={progressTimeRef}>{formatPlaybackTime(currentPlaybackTime)}</span> / {formatPlaybackTime(effectiveDuration)}
                                            </span>

                                            {playbackMode === 'screenshots' ? (
                                                <button
                                                    onClick={() => setShowTouchOverlay(!showTouchOverlay)}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    aria-pressed={showTouchOverlay}
                                                    title={showTouchOverlay ? 'Hide touch overlay' : 'Show touch overlay'}
                                                    className={`flex h-7 items-center gap-1 border-2 px-2 text-xs font-bold uppercase transition ${showTouchOverlay
                                                        ? 'border-[#2563eb] bg-white text-[#2563eb] shadow-[2px_2px_0px_0px_rgba(37,99,235,1)]'
                                                        : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                >
                                                    <Hand className={`h-3 w-3 ${showTouchOverlay ? 'text-[#2563eb]' : 'text-black'}`} />
                                                    <span className="hidden xs:inline">Touches</span>
                                                </button>
                                            ) : null}

                                            <div className="relative">
                                                <button
                                                    ref={speedButtonRef}
                                                    type="button"
                                                    onClick={toggleSpeedMenu}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    aria-haspopup="menu"
                                                    aria-expanded={showSpeedMenu}
                                                    className="flex h-7 items-center border-2 border-black bg-white px-3 font-mono text-xs font-black text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo"
                                                >
                                                    {playbackRate}x
                                                </button>

                                                {showSpeedMenu && typeof document !== 'undefined' && createPortal(
                                                    <>
                                                        <div className="fixed inset-0 z-[1190]" onClick={() => setShowSpeedMenu(false)} />
                                                        <div
                                                            role="menu"
                                                            className="fixed z-[1200] min-w-[92px] overflow-hidden border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                                                            style={{
                                                                left: speedMenuPosition?.left ?? SPEED_MENU_VIEWPORT_GAP_PX,
                                                                top: speedMenuPosition?.top ?? SPEED_MENU_VIEWPORT_GAP_PX,
                                                            }}
                                                        >
                                                            {PLAYBACK_SPEED_OPTIONS.map((rate) => (
                                                                <button
                                                                    key={rate}
                                                                    type="button"
                                                                    role="menuitemradio"
                                                                    aria-checked={playbackRate === rate}
                                                                    onClick={() => {
                                                                        setPlaybackRate(rate);
                                                                        setShowSpeedMenu(false);
                                                                    }}
                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                    className={`block w-full border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold last:border-b-0 ${playbackRate === rate
                                                                        ? 'bg-[#67e8f9] text-black font-black'
                                                                        : 'text-black hover:bg-[#ecfeff]'
                                                                        }`}
                                                                >
                                                                    {rate}x
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </>,
                                                    document.body,
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="replay-marker-toolbar select-none bg-[#f8fafc] px-3 py-2 xl:shrink-0 xl:px-4">
                                    <div className="mb-1 flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="dashboard-mobile-scroll flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto text-[10px] font-black uppercase text-black sm:flex-wrap sm:overflow-visible">
                                            {([
                                                { category: 'navigation', label: 'Nav', icon: <RouteIcon className="h-2.5 w-2.5 text-[#8b5cf6]" /> },
                                                { category: 'gesture', label: 'Gestures', icon: <Hand className="h-2.5 w-2.5 text-[#3b82f6]" /> },
                                                { category: 'rageTap', label: 'Rage', icon: <Zap className="h-2.5 w-2.5 text-[#f43f5e]" /> },
                                                { category: 'deadTap', label: 'Dead', icon: <CircleX className="h-2.5 w-2.5 text-[#64748b]" /> },
                                                { category: 'api', label: 'API', icon: <span className="h-3 w-1 rounded-full bg-[#15803d]" /> },
                                                { category: 'background', label: 'Background', icon: <span className="font-mono text-[8px] font-black leading-none text-[#db2777]">Zzz</span> },
                                            ] as Array<{ category: TimelineMarkerCategory; label: string; icon: React.ReactNode }>).map(({ category, label, icon }) => {
                                                const hidden = hiddenMarkerCategories.has(category);
                                                return (
                                                    <button
                                                        key={category}
                                                        type="button"
                                                        aria-pressed={!hidden}
                                                        title={hidden ? `Show ${label} markers` : `Hide ${label} markers`}
                                                        onClick={() => setHiddenMarkerCategories((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(category)) next.delete(category); else next.add(category);
                                                            return next;
                                                        })}
                                                        className={`flex items-center gap-0.5 border px-1.5 py-0.5 transition ${hidden
                                                            ? 'border-slate-300 bg-white text-slate-400 line-through opacity-60'
                                                            : 'border-black bg-white text-black shadow-neo-sm hover:bg-[#ecfeff]'
                                                            }`}
                                                    >
                                                        {icon}{label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <span className="hidden text-[9px] font-bold uppercase text-slate-600 sm:inline">
                                            Click bar to seek · markers to jump
                                        </span>
                                    </div>

                                    <div
                                        ref={progressRef}
                                        className="group relative mt-1 h-9 cursor-pointer touch-none select-none xl:h-8"
                                        onMouseDown={handleProgressMouseDown}
                                        onMouseMove={handleTimelineMouseMove}
                                        onMouseLeave={clearTimelineHover}
                                        onTouchStart={handleProgressTouchStart}
                                    >
                                        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full border border-slate-400 bg-slate-200" />
                                        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full">
                                            <div
                                                ref={progressFillRef}
                                                className="h-full w-full origin-left bg-slate-950 will-change-transform"
                                                // Owned imperatively by syncPlaybackChrome (60fps). A constant initial
                                                // value keeps React from overwriting it with stale state on re-render,
                                                // which previously caused the progress bar to stutter during playback.
                                                style={{ transform: 'scaleX(0)' }}
                                            />
                                        </div>

                                        {timelineMarkers.map((marker) => {
                                            const { event, clusteredCount, markerKey, percent } = marker;
                                            const color = getEventColor(event);
                                            const isFrustration = isFrustrationEvent(event);
                                            const isGestureMarker = isGestureEvent(event);
                                            const isFaultMarker = isFaultEvent(event);
                                            const isAppBackgroundMarker = isAppBackgroundEvent(event);
                                            const isRouteNavigationMarker = isRouteNavigationEvent(event);
                                            const isClustered = clusteredCount > 1;
                                            const hasFrictionInCluster = marker.counts.friction > 0;
                                            const hasRageTapInCluster = marker.counts.rageTap > 0;
                                            const hasDeadTapInCluster = marker.counts.deadTap > 0;
                                            const hasAnyFrictionInCluster = hasFrictionInCluster || hasRageTapInCluster || hasDeadTapInCluster;
                                            const hasFaultInCluster = marker.counts.fault > 0;
                                            const hasGestureInCluster = marker.counts.gesture > 0;
                                            const hasNavigationInCluster = marker.counts.navigation > 0;
                                            const shouldUseNavigationIcon = !isFrustration && !isFaultMarker && !hasAnyFrictionInCluster && !hasFaultInCluster && (isRouteNavigationMarker || hasNavigationInCluster);
                                            const shouldUseGestureIcon = !isFrustration && !isFaultMarker && !hasAnyFrictionInCluster && !hasFaultInCluster && !shouldUseNavigationIcon && (isGestureMarker || hasGestureInCluster);
                                            const isPriorityCluster = isClustered && (hasAnyFrictionInCluster || hasFaultInCluster || isFrustration || isFaultMarker);
                                            const Icon = shouldUseNavigationIcon ? RouteIcon : shouldUseGestureIcon ? Hand : getEventIcon(event);
                                            const isHovered = hoveredMarker?.markerKey === markerKey;
                                            const showIcon = isFrustration || isFaultMarker || isPriorityCluster || shouldUseGestureIcon || shouldUseNavigationIcon || isAppBackgroundMarker;
                                            const showCountBadge = isClustered && showIcon;
                                            const markerShellSize = showIcon
                                                ? 'h-6 w-6'
                                                : isClustered
                                                    ? 'h-5 min-w-5'
                                                    : isGestureMarker
                                                        ? 'h-4 w-4'
                                                        : 'h-4 w-2.5';
                                            const markerVisualSize = showIcon
                                                ? 'h-5 w-5 border-2'
                                                : isClustered
                                                    ? 'h-4 min-w-4 border px-1'
                                                    : isGestureMarker
                                                        ? 'h-2.5 w-2.5 border'
                                                        : 'h-3 w-1 border';

                                            return (
	                                                <span
	                                                    key={markerKey}
	                                                    role="button"
	                                                    tabIndex={-1}
	                                                    aria-label="Jump to this event"
	                                                    onMouseDown={(e) => {
	                                                        // Prevent the parent track's drag-seek; jump straight to the event.
	                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        handleSeekToTime(marker.time);
                                                    }}
                                                    className={`replay-timeline-marker pointer-events-auto cursor-pointer absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ${markerShellSize} ${isFrustration || hasAnyFrictionInCluster
                                                        ? 'z-30'
                                                        : isFaultMarker || hasFaultInCluster
                                                            ? 'z-[25]'
                                                            : isAppBackgroundMarker || isRouteNavigationMarker || isGestureMarker || isClustered
                                                            ? 'z-20'
                                                            : 'z-10'
                                                        }`}
                                                    style={{ left: `${percent}%` }}
                                                >
                                                    <span
                                                        className={`flex items-center justify-center rounded-full border-black text-[8px] font-black leading-none text-white transition-[box-shadow,background-color,opacity] duration-150 ease-out ${markerVisualSize} ${isFrustration || hasAnyFrictionInCluster
                                                            ? 'shadow-[0_0_0_3px_rgba(244,63,94,0.18)]'
                                                            : isFaultMarker || hasFaultInCluster || isAppBackgroundMarker
                                                                ? 'shadow-sm'
                                                                : isClustered
                                                                    ? 'opacity-95'
                                                                    : 'opacity-80'
                                                            } ${isHovered
                                                                ? 'shadow-[0_0_0_4px_rgba(15,23,42,0.16)]'
                                                                : ''
                                                            }`}
                                                        style={{ backgroundColor: color }}
                                                    >
                                                        {isAppBackgroundMarker ? (
                                                            <span className="font-mono text-[7px] font-black leading-none tracking-normal text-white">Zzz</span>
                                                        ) : showIcon ? (
                                                            <Icon className="h-3 w-3 text-white" strokeWidth={3} />
                                                        ) : isClustered ? (
                                                            <span className="px-0.5 font-mono">{formatCountCompact(clusteredCount)}</span>
                                                        ) : null}
                                                    </span>
                                                    {showCountBadge ? (
                                                        <span className="pointer-events-none absolute right-0 top-0 flex h-3 min-w-[0.75rem] items-center justify-center rounded-full border border-black bg-white px-0.5 text-[8px] font-black leading-none text-black">
                                                            {formatCountCompact(clusteredCount)}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            );
                                        })}

                                        {hoveredMarker && (
                                            <MarkerTooltip
                                                visible={true}
                                                x={hoveredMarker.x}
                                                type={hoveredMarker.clusteredCount > 1 ? 'cluster' : getTimelineMarkerType(hoveredMarker.event)}
                                                name={hoveredMarker.clusteredCount > 1
                                                    ? `${formatCountCompact(hoveredMarker.clusteredCount)} events`
                                                    : isRouteNavigationEvent(hoveredMarker.event)
                                                        ? getNavigationRouteName(hoveredMarker.event)
                                                        : getActivityEventTitle(hoveredMarker.event)}
                                                target={hoveredMarker.clusteredCount > 1
                                                    ? getTimelineMarkerCountSummary(hoveredMarker)
                                                    : isRouteNavigationEvent(hoveredMarker.event)
                                                        ? undefined
                                                    : hoveredMarker.event.targetLabel || hoveredMarker.event.properties?.targetLabel}
                                                timestamp={formatEventTime(hoveredMarker.event.timestamp)}
                                                statusCode={hoveredMarker.event.properties?.statusCode}
                                                success={hoveredMarker.event.properties?.success}
                                                duration={hoveredMarker.event.properties?.duration}
                                            />
                                        )}

	                                        {scrubPreview && !isDragging && !hoveredMarker && (
	                                            <div
	                                                className="pointer-events-none absolute bottom-full z-50 mb-2 -translate-x-1/2 flex flex-col items-center"
                                                style={{ left: `${scrubPreview.leftPercent}%` }}
                                            >
                                                {scrubPreview.frameUrl && (
                                                    <img
                                                        src={scrubPreview.frameUrl}
                                                        alt=""
                                                        loading="eager"
                                                        decoding="async"
                                                        className="mb-1 h-28 w-auto border-2 border-black bg-slate-900 object-contain shadow-neo-sm"
                                                        style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                                                    />
                                                )}
                                                <span className="border-2 border-black bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-black shadow-neo-sm">
                                                    {formatPlaybackClock(scrubPreview.time)}
                                                </span>
                                            </div>
                                        )}

                                        <div
                                            ref={progressThumbRef}
                                            className={`absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-950 shadow transition-transform ${isDragging ? 'scale-110' : 'group-hover:scale-110'
                                                }`}
                                            // left is owned imperatively by syncPlaybackChrome; constant initial value.
                                            style={{ left: '0%', willChange: 'left' }}
                                        />
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </section>


                    <section className={`replay-side-panel flex min-h-[400px] flex-col overflow-hidden border-2 border-black bg-white shadow-neo xl:h-full xl:min-h-0 ${isWebSession ? 'xl:col-span-4' : 'xl:col-span-5'}`}>
                        <div className="replay-workbench-tabs dashboard-mobile-scroll flex shrink-0 overflow-x-auto border-b-2 border-black bg-[#f8fafc] no-scrollbar">
                            <button
                                onClick={() => setActiveWorkbenchTab('timeline')}
                                className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-black uppercase transition ${activeWorkbenchTab === 'timeline' ? 'border-black bg-white text-black' : 'border-transparent text-slate-600 hover:bg-[#ecfeff] hover:text-black'}`}
                            >
                                <ListFilter className="h-4 w-4" />
                                Timeline
                            </button>
                            {canShowWorkbenchTools ? (
                                <>
                                    <button
                                        onClick={() => setActiveWorkbenchTab('console')}
                                        className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-black uppercase transition ${activeWorkbenchTab === 'console' ? 'border-black bg-white text-black' : 'border-transparent text-slate-600 hover:bg-[#ecfeff] hover:text-black'}`}
                                    >
                                        <Terminal className="h-4 w-4" />
                                        Console
                                    </button>
                                    <button
                                        onClick={() => setActiveWorkbenchTab('inspector')}
                                        className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-black uppercase transition ${activeWorkbenchTab === 'inspector' ? 'border-black bg-white text-black' : 'border-transparent text-slate-600 hover:bg-[#ecfeff] hover:text-black'}`}
                                    >
                                        <Code className="h-4 w-4" />
                                        DOM
                                    </button>
                                    <button
                                        onClick={() => setActiveWorkbenchTab('metadata')}
                                        className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-black uppercase transition ${activeWorkbenchTab === 'metadata' ? 'border-black bg-white text-black' : 'border-transparent text-slate-600 hover:bg-[#ecfeff] hover:text-black'}`}
                                    >
                                        <Database className="h-4 w-4" />
                                        Metadata
                                    </button>
                                </>
                            ) : null}
                        </div>
                        <div className="relative flex min-h-0 flex-1 flex-col bg-white">
                            {activeWorkbenchTab === 'timeline' && (
                                <div className="absolute inset-0 flex flex-col">
                                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                                        <div className="replay-panel-header flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wide">Activity Stream</p>
                                                <h3 className="text-xs font-semibold text-slate-700">All actions, logs, and failures in one timeline</h3>
                                            </div>
                                            {canShowWorkbenchTools ? (
                                            <div className="replay-panel-actions flex items-center gap-1.5">
                                                <button
                                                    onClick={copyTimelineEvents}
                                                    disabled={allTimelineEvents.length === 0}
                                                    className={`flex h-6 items-center gap-1 border px-2 text-[10px] font-semibold rounded transition ${allTimelineEvents.length === 0
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
                                                        : timelineCopied
                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                                        }`}
                                                    title={allTimelineEvents.length > 0 ? 'Copy all timeline events' : 'No events available'}
                                                >
                                                    {timelineCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                                    {timelineCopied ? 'Copied' : 'Copy'}
                                                </button>
                                                <button
                                                    onClick={downloadTimelineEvents}
                                                    disabled={allTimelineEvents.length === 0}
                                                    className={`flex h-6 items-center gap-1 border px-2 text-[10px] font-semibold rounded transition ${allTimelineEvents.length === 0
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
                                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                                        }`}
                                                    title={allTimelineEvents.length > 0 ? 'Download all timeline events' : 'No events available'}
                                                >
                                                    <Download className="h-3 w-3" />
                                                    Export
                                                </button>
                                            </div>
                                            ) : null}
                                        </div>

                                        <div className="mt-2">
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={activitySearch}
                                                    onChange={(event) => setActivitySearch(event.target.value)}
                                                    placeholder="Search events, targets, messages, or endpoints"
                                                    className="h-7 w-full border border-slate-200 rounded bg-white px-3 pr-8 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-300"
                                                />
                                                {activitySearch.trim() && (
                                                    <button
                                                        onClick={() => setActivitySearch('')}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700"
                                                        aria-label="Clear search"
                                                    >
                                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>

                                            <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
                                                {activityTabs.map((filter) => (
                                                    <button
                                                        key={filter.id}
                                                        onClick={() => setActivityFilter(filter.id)}
                                                        className={`shrink-0 border px-2 py-0.5 text-[10px] font-semibold rounded transition ${activityFilter === filter.id
                                                            ? 'border-slate-700 bg-slate-800 text-white'
                                                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                                                            }`}
                                                    >
                                                        {filter.label}
                                                        <span className="ml-1 rounded bg-slate-900/10 px-1 py-0.5 text-[9px] font-bold">
                                                            {formatCountCompact(filter.count)}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div ref={activityViewportRef} className="min-h-0 flex-1 overflow-y-auto bg-white">
                                        {filteredActivity.length === 0 ? (
                                            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-500">
                                                <AlertTriangle className="h-8 w-8 text-slate-300" />
                                                <p className="mt-2 text-sm font-semibold text-slate-700">No matching events</p>
                                                <p className="mt-1 text-xs">Try a different filter or clear the search query.</p>
                                            </div>
                                        ) : (
                                            <>
                                                {visibleActivityWindow.isWindowed && (
                                                    <div className="sticky top-0 z-10 border-b-2 border-black bg-[#67e8f9] px-3 py-2 text-[11px] font-black text-black">
                                                        Showing events {visibleActivityWindow.startIndex + 1}-{visibleActivityWindow.endIndex} of {filteredActivity.length.toLocaleString()} near playback. Search or filter to narrow the stream.
                                                    </div>
                                                )}
                                                {visibleActivityWindow.rows.map((event, localIndex) => {
                                                const index = visibleActivityWindow.startIndex + localIndex;
                                                const isNetwork = event.type === 'network_request';
                                                const isLog = isLogEvent(event);
                                                const faultMarker = getFaultMarker(event);
                                                const logLevel = getLogLevel(event);
                                                const color = getEventColor(event);
                                                const Icon = getEventIcon(event);
                                                const timeStr = formatEventTime(event.timestamp);
                                                const seekTime = eventTimestampToPlaybackSeconds(event.timestamp);
                                                const isHighlighted = index === activeActivityIndex;
                                                const title = getActivityEventTitle(event);
                                                const detail = getActivityEventDetail(event);

                                                return (
                                                    <button
                                                        key={`${event.timestamp}-${index}`}
                                                        data-activity-index={index}
                                                        onClick={() => handleSeekToTime(seekTime)}
                                                        className={`block w-full border-b border-black/10 px-3 py-2 text-left transition ${isHighlighted
                                                            ? 'border-l-4 border-black bg-[#ecfeff] shadow-[inset_0_0_0_1px_rgba(103,232,249,0.55)]'
                                                            : 'hover:bg-[#f8fafc]'
                                                            }`}
                                                    >
                                                        <div className="flex items-start gap-2.5">
                                                            <div className="mt-0.5 shrink-0">
                                                                {isNetwork ? (
                                                                    <span
                                                                        className={`inline-flex rounded border px-1 py-0.5 font-mono text-[9px] font-bold ${event.properties?.success
                                                                            ? 'border-2 border-[#15803d] bg-[#f0fdf4] text-[#166534]'
                                                                            : 'border-2 border-[#ef4444] bg-white text-[#ef4444]'
                                                                            }`}
                                                                    >
                                                                        {event.properties?.statusCode || 'ERR'}
                                                                    </span>
                                                                ) : faultMarker ? (
                                                                    <span className={`inline-flex border px-1 py-0.5 text-[9px] font-bold uppercase ${getFaultBadgeStyles(faultMarker)}`}>
                                                                        {faultMarker}
                                                                    </span>
                                                                ) : isLog ? (
                                                                    <span className={`inline-flex border px-1 py-0.5 text-[9px] font-bold uppercase ${getLogBadgeStyles(logLevel)}`}>
                                                                        {logLevel}
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex h-4 w-4 items-center justify-center border border-black" style={{ backgroundColor: color }}>
                                                                        <Icon className="h-2.5 w-2.5 text-white" />
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <p className="truncate text-[11px] font-semibold text-slate-800">{title}</p>
                                                                    <span className="shrink-0 border border-black bg-white px-1 py-0.5 font-mono text-[10px] font-bold text-black">
                                                                        {timeStr}
                                                                    </span>
                                                                </div>
                                                                {detail ? (
                                                                    <p className="mt-0.5 line-clamp-2 break-words text-xs font-medium text-slate-600">
                                                                        <HighlightedText text={detail} search={activitySearch} />
                                                                    </p>
                                                                ) : null}
                                                                {typeof event.properties?.duration === 'number' && event.properties.duration > 0 && (
                                                                    <span
                                                                        className={`mt-1 inline-flex border border-black px-1.5 py-0.5 font-mono text-[10px] font-bold ${event.properties.duration > 1000
                                                                            ? 'bg-[#fecaca] text-black'
                                                                            : event.properties.duration > 500
                                                                                ? 'bg-[#f9a8d4] text-black'
                                                                                : 'bg-white text-black'
                                                                            }`}
                                                                    >
                                                                        {event.properties.duration} ms
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                                })}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                            {canShowWorkbenchTools && activeWorkbenchTab === 'console' && (
                                <div className="absolute inset-0 flex flex-col bg-slate-950">
                                    <div className="border-b-2 border-black px-4 py-3">
                                        <div className="replay-panel-header flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-black uppercase text-[#67e8f9]">Runtime Console</p>
                                                <h3 className="truncate text-sm font-bold text-white">
                                                    {revealAllLogs ? 'Displaying all session logs' : 'Logs synced to playback timestamp'}
                                                </h3>
                                            </div>
                                            <div className="replay-panel-actions flex shrink-0 items-center gap-1.5">
                                                <span className="flex h-7 items-center rounded border border-slate-700 bg-slate-900 px-1.5 font-mono text-[10px] text-slate-300">
                                                    {terminalVisibleRows.length}/{terminalLogRows.length}
                                                </span>
                                                <button
                                                    onClick={() => setRevealAllLogs(!revealAllLogs)}
                                                    className={`flex h-7 items-center gap-1 whitespace-nowrap border px-1.5 text-[10px] font-semibold transition ${revealAllLogs
                                                        ? 'border-cyan-500 bg-cyan-600 text-white'
                                                        : 'border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-400'
                                                        }`}
                                                    title={revealAllLogs ? 'Sync to playback' : 'Show all logs in session'}
                                                >
                                                    {revealAllLogs ? <Zap className="h-3 w-3" /> : <ListFilter className="h-3 w-3" />}
                                                    {revealAllLogs ? 'SYNC' : 'SHOW ALL'}
                                                </button>
                                                <button
                                                    onClick={copyAllTerminalLogs}
                                                    disabled={terminalLogRows.length === 0}
                                                    className={`flex h-7 items-center gap-1 whitespace-nowrap border px-1.5 text-[10px] font-semibold transition ${terminalLogRows.length > 0
                                                        ? terminalCopied
                                                            ? 'border-emerald-500 bg-emerald-600 text-white'
                                                            : 'border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-400'
                                                        : 'cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500'
                                                        }`}
                                                    title="Copy all console logs (including those not yet visible at current time)"
                                                >
                                                    {terminalCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                                    {terminalCopied ? 'Copied' : 'COPY'}
                                                </button>
                                                <button
                                                    onClick={downloadAllTerminalLogs}
                                                    disabled={terminalLogRows.length === 0}
                                                    className={`flex h-7 items-center gap-1 whitespace-nowrap border px-1.5 text-[10px] font-semibold transition ${terminalLogRows.length > 0
                                                        ? 'border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-400'
                                                        : 'cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500'
                                                        }`}
                                                    title="Download all console logs"
                                                >
                                                    <Download className="h-3 w-3" />
                                                    EXPORT
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div ref={terminalViewportRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-5">
                                        {terminalVisibleRows.length === 0 ? (
                                            <p className="text-slate-500">No console logs at this playback point.</p>
                                        ) : (
                                            <div className="space-y-0.5">
                                                {terminalVisibleRows.map((row) => (
                                                    <div key={row.id} className="whitespace-pre-wrap break-words">
                                                        <span className="text-slate-500">[{formatPlaybackTime(row.relativeSeconds)}]</span>{' '}
                                                        {row.marker ? (
                                                            <span className={`font-semibold ${getFaultTerminalClass(row.marker)}`}>[{row.marker}]</span>
                                                        ) : (
                                                            <span className={`font-semibold ${getTerminalLevelClass(row.level)}`}>[{row.level.toUpperCase()}]</span>
                                                        )}{' '}
                                                        <span className="text-slate-100">{row.message}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {canShowWorkbenchTools && activeWorkbenchTab === 'inspector' && (
                                <div className="absolute inset-0 flex flex-col bg-[#f8fafc]">
                                    <div className="border-b-2 border-black bg-[#f8fafc] px-4 py-3">
                                        <div className="replay-panel-header flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[10px] font-black uppercase text-slate-600">View Inspector</p>
                                                <h3 className="text-sm font-bold text-slate-900">Hierarchy synced with playback</h3>
                                            </div>
                                            <div className="replay-panel-actions flex items-center gap-2">
                                                <button
                                                    onClick={copyDOMHierarchy}
                                                    disabled={hierarchySnapshots.length === 0}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${hierarchySnapshots.length === 0
                                                        ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                        : domCopied
                                                            ? 'border-black bg-[#86efac] text-black'
                                                            : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                    title={hierarchySnapshots.length > 0 ? 'Copy current hierarchy JSON' : 'No hierarchy data'}
                                                >
                                                    {domCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                                    {domCopied ? 'Copied' : 'COPY'}
                                                </button>
                                                <button
                                                    onClick={downloadDOMHierarchy}
                                                    disabled={hierarchySnapshots.length === 0}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${hierarchySnapshots.length === 0
                                                        ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                    title={hierarchySnapshots.length > 0 ? 'Download current hierarchy as JSON' : 'No hierarchy data'}
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    EXPORT
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="min-h-0 flex-1">
                                        {hierarchySnapshots.length > 0 ? (
                                            <DOMInspector
                                                hierarchySnapshots={hierarchySnapshots}
                                                currentTime={currentPlaybackRawTimeSeconds}
                                                sessionStartTime={fullSession?.startTime || 0}
                                                deviceWidth={deviceWidth}
                                                deviceHeight={deviceHeight}
                                                className="h-full"
                                            />
                                        ) : (
                                            <div className="flex h-full flex-col items-center justify-center bg-[#f8fafc] px-5 text-center text-slate-500">
                                                <Layers className="h-10 w-10 text-slate-300" />
                                                <p className="mt-2 text-sm font-semibold text-slate-800">Hierarchy unavailable</p>
                                                <p className="mt-1 text-xs leading-5">
                                                    This session did not include view hierarchy snapshots.
                                                    Replay, activity, and network evidence remain fully available.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {canShowWorkbenchTools && activeWorkbenchTab === 'metadata' && (
                                <div className="absolute inset-0 flex flex-col bg-[#f8fafc] overflow-auto">
                                    <div className="border-b-2 border-black bg-[#f8fafc] px-4 py-3 sticky top-0 z-10">
                                        <div className="replay-panel-header flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[10px] font-black uppercase text-slate-600">Session Metadata</p>
                                                <h3 className="text-sm font-bold text-slate-900">{isWebSession ? 'Collected properties' : 'Custom properties'}</h3>
                                            </div>
                                            <div className="replay-panel-actions flex items-center gap-2">
                                                <button
                                                    onClick={copyMetadata}
                                                    disabled={!hasMetadata}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${!hasMetadata
                                                        ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                        : metadataCopied
                                                            ? 'border-black bg-[#86efac] text-black'
                                                            : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                    title={hasMetadata ? 'Copy metadata JSON' : 'No metadata'}
                                                >
                                                    {metadataCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                                    {metadataCopied ? 'Copied' : 'COPY'}
                                                </button>
                                                <button
                                                    onClick={downloadMetadata}
                                                    disabled={!hasMetadata}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${!hasMetadata
                                                        ? 'cursor-not-allowed border-black bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-black shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                                        }`}
                                                    title={hasMetadata ? 'Download metadata JSON' : 'No metadata'}
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    EXPORT
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        {!hasMetadata ? (
                                            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
                                                <Database className="h-10 w-10 text-slate-300 mb-3" />
                                                <p className="text-sm font-semibold text-slate-800">No metadata found</p>
                                                <p className="mt-1 text-xs leading-5">
                                                    This session does not have any custom user properties associated with it.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="overflow-hidden border-2 border-black bg-white">
                                                <table className="w-full text-left text-sm text-slate-600">
                                                    <thead className="bg-[#ecfeff] text-xs font-black uppercase text-black">
                                                        <tr>
                                                            <th className="px-4 py-3 border-b-2 border-black">Key</th>
                                                            <th className="px-4 py-3 border-b-2 border-black">Value</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-200">
                                                        {Object.entries(metadata || {}).map(([key, value]) => (
                                                            <tr key={key} className="hover:bg-[#f8fafc] transition-colors">
                                                                <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-900">
                                                                    {key}
                                                                </td>
                                                                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                                                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};
export default RecordingDetail;
