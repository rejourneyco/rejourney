import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import {
    ArrowLeft,
    ChevronRight,
    ChevronLeft,
    VideoOff,
    Clock,
    Smartphone,
    Monitor,
    Zap,
    MousePointer2,
    Globe,
    AlertCircle,
    Navigation,
    Hand,
    AlertTriangle,
    Play,
    Pause,
    SkipBack,
    SkipForward,
    RotateCcw,
    Layers,
    Image as ImageIcon,
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
} from 'lucide-react';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { api } from '~/shared/api/client';
import DOMInspector, { HierarchySnapshot } from '~/shared/ui/core/DOMInspector';
import { TouchOverlay, TouchEvent as OverlayTouchEvent } from '~/shared/ui/core/TouchOverlay';
import { MarkerTooltip } from '~/shared/ui/core/MarkerTooltip';
import { SessionLoadingOverlay, SessionLoadingOverlayProps } from '~/features/app/sessions/shared/SessionLoadingOverlay';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';

// ============================================================================
// Types
// ============================================================================

interface SessionEvent {
    id?: string;
    type: string;
    name?: string;
    timestamp: number;
    properties?: Record<string, any>;
    payload?: Record<string, any>;
    screen?: string;
    gestureType?: string;
    frustrationKind?: string;
    targetLabel?: string;
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
    userId: string;
    hasRecording?: boolean;
    /** 'screenshots' | 'none' - determines playback mode */
    playbackMode?: 'screenshots' | 'none';
    deviceInfo: {
        model?: string;
        systemName?: string;
        systemVersion?: string;
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
        index: number;
    }[];
    screenshotFramesStatus?: 'ready' | 'preparing' | 'none';
    screenshotFrameCount?: number;
    screenshotFramesProcessedSegments?: number;
    screenshotFramesTotalSegments?: number;
    hierarchySnapshots?: {
        timestamp: number;
        screenName: string | null;
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
        totalSizeKB?: string;
        eventsSizeKB?: string;
        screenshotSizeKB?: string;
        screenshotSegmentCount?: number;
    };
    screenCount?: number;
    screensVisited?: string[];
}

// ============================================================================
// Event Styling
// ============================================================================

const EVENT_COLORS = {
    error: '#ef4444',
    apiError: '#ef4444',
    rageTap: '#f43f5e',
    deadTap: '#94a3b8',
    crash: '#b91c1c',
    anr: '#a855f7',
    apiSuccess: '#22c55e',
    tap: '#3b82f6',
    scroll: '#3b82f6',
    gesture: '#3b82f6',
    swipe: '#3b82f6',
    pinch: '#3b82f6',
    pan: '#3b82f6',
    rotation: '#ec4899',
    appBackground: '#f59e0b',
    appForeground: '#10b981',
    sessionStart: '#06b6d4',
    navigation: '#8b5cf6',
    deviceInfo: '#64748b',
    log: '#2563eb',
    custom: '#8b5cf6',
    default: '#6b7280',
} as const;

const getEventColor = (event: SessionEvent): string => {
    const type = event.type?.toLowerCase() || '';
    const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();

    if (event.frustrationKind === 'dead_tap' || type === 'dead_tap') return EVENT_COLORS.deadTap;
    if (event.frustrationKind || type === 'rage_tap') return EVENT_COLORS.rageTap;
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
    const type = event.type?.toLowerCase() || '';
    const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();

    if (type === 'crash' || type === 'error' || type === 'anr') return AlertCircle;
    if (type === 'network_request') return Globe;
    if (isLogEvent(event)) return FileText;
    if (type === 'navigation' || type === 'screen_view') return Navigation;
    if (type === 'app_foreground' || type === 'app_background') return Play;
    if (type === 'device_info') return Smartphone;
    if (type === 'custom') return Star;
    if (type === 'dead_tap' || event.frustrationKind === 'dead_tap') return MousePointer2;
    if (type === 'rage_tap' || event.frustrationKind) return Zap;
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
    const type = (event.type || '').toLowerCase();
    const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
    if (type === 'crash' || type === 'anr') return 5;
    if (type === 'error' || event.frustrationKind || type === 'rage_tap' || type === 'dead_tap') return 4;
    if (type === 'network_request' && !(event.properties?.success ?? true)) return 3;
    if (type === 'navigation' || type === 'screen_view') return 2;
    if (gestureType.includes('tap') || type === 'tap' || type === 'touch' || type === 'gesture') return 1;
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

const formatBytesToHuman = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${kb.toFixed(1)} KB`;
};

const formatCountCompact = (count: number): string => {
    if (!Number.isFinite(count)) return '0';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(Math.round(count));
};

const formatPlaybackClock = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
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
    return 'bg-orange-100 text-orange-700 border-orange-300';
};

const getFaultTerminalClass = (marker: 'CRASH' | 'ANR' | 'ERROR'): string => {
    if (marker === 'CRASH') return 'text-red-300';
    if (marker === 'ANR') return 'text-violet-300';
    return 'text-orange-300';
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

/** One-line summary for timeline export (all event types). */
const formatTimelineEventForExport = (event: SessionEvent): string => {
    const isoTime = new Date(event.timestamp).toISOString();
    const marker = getFaultMarker(event);
    const isLog = isLogEvent(event);
    const isNetwork = (event.type || '').toLowerCase() === 'network_request';
    const level = marker || (isLog ? getLogLevel(event).toUpperCase() : '');
    const typeLabel = isNetwork
        ? (event.name || event.properties?.method || 'REQUEST')
        : marker
            ? `Fault ${marker}`
            : isLog
                ? `Console ${level}`
                : event.type === 'custom'
                    ? event.name || 'Custom'
                    : (event.type || 'event').replace(/_/g, ' ');
    const summary = marker
        ? getFaultConsoleSummary(event)
        : isLog || isNetwork
            ? formatConsoleMessage(event)
            : event.targetLabel ||
              event.properties?.targetLabel ||
              event.properties?.urlPath ||
              event.name ||
              event.screen ||
              JSON.stringify(event.properties || {});
    const stack = getEventStackTrace(event);
    const message = stack ? `${summary}\n${stack}` : summary;
    return `[${isoTime}] [${typeLabel}] ${message}`;
};

const isFeedbackType = (type: string): boolean =>
    type === 'feedback' || type === 'user_feedback';

const getLogBadgeStyles = (level: string): string => {
    if (level === 'error') return 'bg-red-50 text-red-700 border-red-200';
    if (level === 'warn' || level === 'warning') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-blue-50 text-blue-700 border-blue-200';
};

const getTerminalLevelClass = (level: string): string => {
    if (level === 'error') return 'text-red-300';
    if (level === 'warn' || level === 'warning') return 'text-amber-300';
    return 'text-emerald-300';
};

type InsightLevel = 'good' | 'warning' | 'critical' | 'neutral';

const INSIGHT_LEVEL_STYLES: Record<InsightLevel, { badge: string; value: string; bar: string }> = {
    good: {
        badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        value: 'text-emerald-700',
        bar: 'bg-emerald-500',
    },
    warning: {
        badge: 'border-amber-200 bg-amber-50 text-amber-700',
        value: 'text-amber-700',
        bar: 'bg-amber-500',
    },
    critical: {
        badge: 'border-red-200 bg-red-50 text-red-700',
        value: 'text-red-700',
        bar: 'bg-red-500',
    },
    neutral: {
        badge: 'border-slate-200 bg-slate-100 text-slate-600',
        value: 'text-slate-800',
        bar: 'bg-slate-500',
    },
};

const PLAYBACK_STATE_COMMIT_INTERVAL_MS = 250;
const STARTUP_FRAME_PRELOAD_COUNT = 10;
const FRAME_PRELOAD_LOOKAHEAD_COUNT = 45;
const FRAME_PRELOAD_LOOKBEHIND_COUNT = 3;
const FRAME_CACHE_RETAIN_BEHIND_COUNT = 90;
const FRAME_CACHE_RETAIN_AHEAD_COUNT = 120;
const FRAME_CACHE_PRUNE_THRESHOLD = 240;
const MAX_TIMELINE_MARKERS = 900;
const MAX_ACTIVITY_ROWS = 900;

// ============================================================================
// Main Component
// ============================================================================

export const RecordingDetail: React.FC<{ sessionId?: string }> = ({ sessionId }) => {
    const { sessionId: paramId } = useParams<{ sessionId: string }>();
    const id = sessionId || paramId;
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const isDemoReplay = pathPrefix === '/demo';

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
    const [isTimelineLoading, setIsTimelineLoading] = useState(true);
    const [isHierarchyLoading, setIsHierarchyLoading] = useState(true);
    const [isStatsLoading, setIsStatsLoading] = useState(true);
    const [isFramesLoading, setIsFramesLoading] = useState(false);
    const [activityFilter, setActivityFilter] = useState<string>('all');
    const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);
    const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<'timeline' | 'console' | 'inspector' | 'metadata'>('timeline');
    const [revealAllLogs, setRevealAllLogs] = useState(false);

    // Replay player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1.5);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showTouchOverlay, setShowTouchOverlay] = useState(true);
    const [touchEvents, setTouchEvents] = useState<OverlayTouchEvent[]>([]);
    const [activitySearch, setActivitySearch] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredMarker, setHoveredMarker] = useState<any>(null);
    const [terminalCopied, setTerminalCopied] = useState(false);
    const [timelineCopied, setTimelineCopied] = useState(false);
    const [domCopied, setDomCopied] = useState(false);
    const [metadataCopied, setMetadataCopied] = useState(false);
    const [userIdCopied, setUserIdCopied] = useState(false);

    // DOM Inspector state
    const [hierarchySnapshots, setHierarchySnapshots] = useState<HierarchySnapshot[]>([]);

    // Screenshot playback state
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const screenshotFrameCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const screenshotAnimationRef = useRef<number | null>(null);
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
    const framePollTimeoutRef = useRef<number | null>(null);

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
        currentFrameIndexRef.current = currentFrameIndex;
    }, [currentFrameIndex]);

    // Get basic session from context
    const session: any = null;
    const sessions: any[] = [];

    // Fetch full session data
    const fetchFullSession = useCallback(async () => {
        if (!id) return;
        const requestId = activeReplayRequestRef.current + 1;
        activeReplayRequestRef.current = requestId;

        if (framePollTimeoutRef.current) {
            window.clearTimeout(framePollTimeoutRef.current);
            framePollTimeoutRef.current = null;
        }

        try {
            setIsCoreLoading(true);
            setIsTimelineLoading(true);
            setIsHierarchyLoading(true);
            setIsStatsLoading(true);
            setIsFramesLoading(false);
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
                            screen: rootData.screen || {
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

            const coreMark = `replay_core_${id}`;
            if (typeof performance !== 'undefined') performance.mark(coreMark);

            const scheduleFramePoll = (delayMs: number) => {
                if (framePollTimeoutRef.current) {
                    window.clearTimeout(framePollTimeoutRef.current);
                }

                framePollTimeoutRef.current = window.setTimeout(async () => {
                    try {
                        const framesResult = await api.getSessionFrames(id, { frameUrlMode: 'proxy' });
                        if (activeReplayRequestRef.current !== requestId) return;

                        setFullSession((prev) => {
                            if (!prev || prev.id !== id) return prev;
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
                        if (activeReplayRequestRef.current !== requestId) return;
                        console.error('Failed to fetch session frames:', err);
                        setIsFramesLoading(true);
                        scheduleFramePoll(2000);
                    }
                }, delayMs);
            };

            try {
                const bootstrapResult = await api.getSessionBootstrap(id, { frameUrlMode: 'proxy' });
                if (activeReplayRequestRef.current !== requestId) return;

                if (typeof performance !== 'undefined') {
                    performance.measure(`replay:getSessionBootstrap:${id}`, coreMark);
                }

                setFullSession({
                    ...(bootstrapResult.core as any),
                    events: bootstrapResult.timeline.events || [],
                    networkRequests: bootstrapResult.timeline.networkRequests || [],
                    crashes: bootstrapResult.timeline.crashes || [],
                    anrs: bootstrapResult.timeline.anrs || [],
                    stats: bootstrapResult.stats || bootstrapResult.core.stats,
                } as any);
                const preparingFrames =
                    bootstrapResult.core.playbackMode === 'screenshots' &&
                    bootstrapResult.core.screenshotFramesStatus === 'preparing';
                setIsFramesLoading(preparingFrames);
                if (preparingFrames) {
                    scheduleFramePoll(0);
                }
            } catch (err) {
                if (activeReplayRequestRef.current !== requestId) return;
                console.error('Failed to fetch session core:', err);
            } finally {
                if (activeReplayRequestRef.current === requestId) {
                    setIsCoreLoading(false);
                    setIsTimelineLoading(false);
                    setIsStatsLoading(false);
                }
            }

            window.requestAnimationFrame(() => {
                void api.getSessionHierarchy(id)
                    .then((hierarchyResult) => {
                        if (activeReplayRequestRef.current !== requestId) return;
                        setFullSession((prev) => {
                            if (!prev || prev.id !== id) return prev;
                            const next: any = {
                                ...prev,
                                hierarchySnapshots: hierarchyResult.hierarchySnapshots || [],
                            };
                            setHierarchySnapshots(transformHierarchySnapshots(next.hierarchySnapshots, next));
                            return next;
                        });
                    })
                    .catch((err) => {
                        if (activeReplayRequestRef.current !== requestId) return;
                        console.error('Failed to fetch session hierarchy:', err);
                    })
                    .finally(() => {
                        if (activeReplayRequestRef.current === requestId) {
                            setIsHierarchyLoading(false);
                        }
                    });
            });
        } catch (err) {
            console.error('Failed to fetch session:', err);
        }
    }, [id]);

    useEffect(() => {
        fetchFullSession();
    }, [fetchFullSession]);

    useEffect(() => {
        return () => {
            if (framePollTimeoutRef.current) {
                window.clearTimeout(framePollTimeoutRef.current);
                framePollTimeoutRef.current = null;
            }
        };
    }, []);

    // Detect rage taps for touch overlay and timeline
    // This detects 3+ taps in same area within 1.5s as rage taps
    const detectedRageTaps = useMemo(() => {
        const sessionEvents = fullSession?.events || [];
        const taps = sessionEvents.filter(e =>
            e.type === 'gesture' && (e.gestureType === 'tap' || e.gestureType === 'double_tap')
        );
        const rageTaps: SessionEvent[] = [];

        for (let i = 0; i < taps.length; i++) {
            const current = taps[i];
            const rawCurrentTouches = current.touches || current.properties?.touches || [];
            const currentTouches = Array.isArray(rawCurrentTouches) ? rawCurrentTouches : [];
            const currentPos = currentTouches[0] || { x: 0, y: 0 };
            let count = 1;

            for (let j = i + 1; j < taps.length; j++) {
                const next = taps[j];
                if (next.timestamp - current.timestamp > 1500) break;
                const rawNextTouches = next.touches || next.properties?.touches || [];
                const nextTouches = Array.isArray(rawNextTouches) ? rawNextTouches : [];
                const nextPos = nextTouches[0] || { x: 0, y: 0 };
                const dist = Math.sqrt(Math.pow(nextPos.x - currentPos.x, 2) + Math.pow(nextPos.y - currentPos.y, 2));
                if (dist <= 50) count++;
            }

            if (count >= 3) {
                rageTaps.push({ ...current, type: 'rage_tap', frustrationKind: 'rage_tap' });
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

        // Last event time - critical for ensuring all events fit on timeline
        if (allTimelineEvents.length > 0) {
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

    // Density chart data - MUST be before early returns
    const densityData = useMemo(() => {
        if (durationSeconds <= 0) return { touchDensity: [], apiDensity: [] };

        const bucketCount = 40;
        const bucketSize = (durationSeconds * 1000) / bucketCount;
        const touchBuckets = Array(bucketCount).fill(0);
        const apiBuckets = Array(bucketCount).fill(0);

        // DEBUG: Track bucket distribution
        const touchEventTimes: number[] = [];
        const apiEventTimes: number[] = [];

        allTimelineEvents.forEach((e) => {
            const elapsed = e.timestamp - replayBaseTime;
            const idx = Math.min(Math.floor(elapsed / bucketSize), bucketCount - 1);
            if (idx < 0) return;

            const type = e.type?.toLowerCase() || '';
            const gestureType = (e.gestureType || e.properties?.gestureType || '').toLowerCase();

            if (type === 'network_request') {
                apiBuckets[idx]++;
                apiEventTimes.push(elapsed / 1000);
            } else if (
                type === 'gesture' || type === 'tap' || type === 'touch' || type === 'scroll' ||
                type === 'input' || // Include keyboard input in interaction density
                gestureType.includes('tap') || gestureType.includes('scroll')
            ) {
                touchBuckets[idx]++;
                touchEventTimes.push(elapsed / 1000);
            }
        });

        // Density buckets for visualization

        const maxTouch = Math.max(...touchBuckets, 1);
        const maxApi = Math.max(...apiBuckets, 1);

        return {
            touchDensity: touchBuckets.map(v => v / maxTouch),
            apiDensity: apiBuckets.map(v => v / maxApi),
        };
    }, [allTimelineEvents, durationSeconds, replayBaseTime]);


    // Screenshot frames (primary playback mode for iOS)
    // Normalize timestamps to be relative to session start time.
    // Also filter out frames that fall outside the session window —
    // cross-session frame leakage can cause frames from a previous
    // session to appear, producing flickering during playback.
    const screenshotFrames = useMemo(() => {
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

    const visualReplayPreparing = Boolean(
        fullSession?.playbackMode === 'screenshots' &&
        (fullSession?.screenshotFramesStatus === 'preparing' || isFramesLoading) &&
        screenshotFrames.length === 0
    );

    const displayedFrameCount = Math.max(
        screenshotFrames.length,
        fullSession?.screenshotFrameCount || 0
    );
    const replayPreparationProgressPercent =
        fullSession?.screenshotFramesTotalSegments && fullSession.screenshotFramesTotalSegments > 0
            ? Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        ((fullSession?.screenshotFramesProcessedSegments || 0) /
                            fullSession.screenshotFramesTotalSegments) * 100
                    )
                )
            )
            : null;
    const secondaryDataLoading = isTimelineLoading || isHierarchyLoading || isStatsLoading;

    // Determine playback mode (screenshot-only)
    const playbackMode = useMemo(() => {
        if (fullSession?.playbackMode === 'screenshots' && (screenshotFrames.length > 0 || visualReplayPreparing)) {
            return 'screenshots' as const;
        }
        if (screenshotFrames.length > 0) {
            return 'screenshots' as const;
        }
        return 'none' as const;
    }, [fullSession?.playbackMode, screenshotFrames, visualReplayPreparing]);

    // Has any visual recording?
    const hasRecording = playbackMode !== 'none' || visualReplayPreparing;

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
        if (platform === 'android') {
            return { width: 1080, height: 2400 }; // Common Android resolution
        }
        return { width: 375, height: 812 }; // iPhone X/11/12/13/14 default
    }, [fullSession, hierarchySnapshots]);

    const deviceWidth = inferredDimensions.width;
    const deviceHeight = inferredDimensions.height;

    const syncPlaybackChrome = useCallback((timeSeconds: number) => {
        const safeDuration = Math.max(0, durationSeconds);
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
    }, [durationSeconds]);

    useEffect(() => {
        syncPlaybackChrome(currentPlaybackTime);
    }, [currentPlaybackTime, syncPlaybackChrome]);

    const ensureScreenshotFrameImage = useCallback((
        frame: { url?: string } | undefined,
        fetchPriority: 'high' | 'low' | 'auto' = 'auto'
    ): HTMLImageElement | null => {
        if (!frame?.url) return null;

        const cache = screenshotFrameCacheRef.current;
        const cachedImg = cache.get(frame.url);
        if (cachedImg) return cachedImg;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        try {
            (img as any).fetchPriority = fetchPriority;
        } catch {
            // fetchPriority is a best-effort browser hint.
        }
        img.src = frame.url;
        cache.set(frame.url, img);
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
        const lookaheadCount = Math.min(
            160,
            Math.max(FRAME_PRELOAD_LOOKAHEAD_COUNT, Math.ceil(FRAME_PRELOAD_LOOKAHEAD_COUNT * playbackRate))
        );
        const startIndex = Math.max(0, centerIndex - FRAME_PRELOAD_LOOKBEHIND_COUNT);
        const endIndex = Math.min(
            screenshotFrames.length - 1,
            centerIndex + lookaheadCount
        );

        for (let index = startIndex; index <= endIndex; index++) {
            ensureScreenshotFrameImage(screenshotFrames[index], fetchPriority);
        }

        const cache = screenshotFrameCacheRef.current;
        if (cache.size > FRAME_CACHE_PRUNE_THRESHOLD) {
            const retainStart = Math.max(0, centerIndex - FRAME_CACHE_RETAIN_BEHIND_COUNT);
            const retainEnd = Math.min(
                screenshotFrames.length - 1,
                centerIndex + FRAME_CACHE_RETAIN_AHEAD_COUNT
            );
            const retainedUrls = new Set<string>();
            for (let index = retainStart; index <= retainEnd; index++) {
                retainedUrls.add(screenshotFrames[index].url);
            }
            for (const url of cache.keys()) {
                if (!retainedUrls.has(url)) {
                    cache.delete(url);
                }
            }
        }
    }, [ensureScreenshotFrameImage, playbackRate, screenshotFrames]);

    // Handle progress click/drag for screenshot playback
    const handleProgressInteraction = useCallback(
        (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
            if (!progressRef.current) return;

            const rect = progressRef.current.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

            if (screenshotFrames.length === 0) return;
            const newTime = percent * durationSeconds;
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
        [durationSeconds, screenshotFrames, syncPlaybackChrome, warmScreenshotFramesAround]
    );

    const handleProgressMouseDown = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            setIsDragging(true);
            handleProgressInteraction(e);

            const handleMouseMove = (ev: MouseEvent) => handleProgressInteraction(ev);
            const handleMouseUp = () => {
                setIsDragging(false);
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
            setIsDragging(true);
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
                document.removeEventListener('touchmove', handleTouchMove);
                document.removeEventListener('touchend', handleTouchEnd);
            };
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);
        },
        [handleProgressInteraction]
    );

    // Toggle play/pause for screenshot playback
    const togglePlayPause = useCallback(() => {
        if (isPlaying) {
            setCurrentPlaybackTime(currentPlaybackTimeRef.current);
            syncPlaybackChrome(currentPlaybackTimeRef.current);
            lastPlaybackUiUpdateRef.current = performance.now();
        }

        // The screenshot animation effect handles the actual playback.
        setIsPlaying((playing) => !playing);
    }, [isPlaying, syncPlaybackChrome]);

    // Skip in screenshot playback
    const skip = useCallback(
        (seconds: number) => {
            if (screenshotFrames.length === 0) return;
            const targetTime = Math.max(0, Math.min(currentPlaybackTimeRef.current + seconds, durationSeconds));
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
        [screenshotFrames, durationSeconds, syncPlaybackChrome, warmScreenshotFramesAround]
    );

    // Restart screenshot playback
    const restart = useCallback(() => {
        if (screenshotFrames.length === 0) return;
        setCurrentFrameIndex(0);
        setCurrentPlaybackTime(0);
        currentPlaybackTimeRef.current = 0;
        currentFrameIndexRef.current = 0;
        lastPlaybackUiUpdateRef.current = performance.now();
        syncPlaybackChrome(0);
        warmScreenshotFramesAround(0, 'high');
        setIsPlaying(true);
    }, [screenshotFrames, syncPlaybackChrome, warmScreenshotFramesAround]);

    // Effect: Keyboard shortcut for play/pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input/textarea
            if (e.target !== document.body) return;
            if (playbackMode !== 'screenshots') return;

            if (e.code === 'Space') {
                e.preventDefault();
                togglePlayPause();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                skip(-5);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                skip(5);
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
        syncPlaybackChrome(0);
    }, [id]);

    // Preload screenshot frames
    useEffect(() => {
        if (playbackMode !== 'screenshots' || screenshotFrames.length === 0) return;

        lastPreloadCenterIndexRef.current = -1;

        // Preload a small startup window immediately so opening replay paints fast.
        const preloadCount = Math.min(STARTUP_FRAME_PRELOAD_COUNT, screenshotFrames.length);
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
    }, [ensureScreenshotFrameImage, playbackMode, screenshotFrames, warmScreenshotFramesAround]);

    // Update touch overlay for screenshot playback mode
    useEffect(() => {
        if (playbackMode !== 'screenshots' || !fullSession || !showTouchOverlay) {
            return;
        }

        const sessionStartTime = fullSession.startTime || 0;
        const currentAbsoluteTime = sessionStartTime + currentPlaybackTime * 1000;
        const screenWidth = fullSession.deviceInfo?.screenWidth || 375;
        const screenHeight = fullSession.deviceInfo?.screenHeight || 812;

        const recentTouchEvents = (fullSession.events || [])
            .filter((e) => {
                const eventTime = e.timestamp;
                const timeDiff = currentAbsoluteTime - eventTime;
                const isGestureEvent = e.type === 'touch' || e.type === 'gesture';
                const rawTouchesArr = e.touches ?? e.properties?.touches ?? [];
                const touchesArr = Array.isArray(rawTouchesArr) ? rawTouchesArr : [];
                // Use wider window for gesture events (swipe/scroll need more time to be visible)
                const maxAge = (e.type === 'gesture') ? 1500 : 1000;
                return isGestureEvent && touchesArr.length > 0 && timeDiff >= 0 && timeDiff < maxAge;
            })
            .map((e) => {
                const rawTouchArray = e.touches || e.properties?.touches || [];
                const touchArray = Array.isArray(rawTouchArray) ? rawTouchArray : [];
                let gestureType = e.gestureType || e.properties?.gestureType || 'tap';
                const props = e.properties || {};

                // Check if this is a rage tap
                const isRageTapEvent = detectedRageTaps.some(rt =>
                    Math.abs(rt.timestamp - e.timestamp) < 100
                );
                if (isRageTapEvent && gestureType.includes('tap')) {
                    gestureType = 'rage_tap';
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
                    targetLabel: e.targetLabel || props.targetLabel,
                    duration: props.duration || (e as any).duration,
                    velocity: props.velocity || (e as any).velocity,
                    maxForce: props.maxForce || (e as any).maxForce,
                    touchCount: validTouches.length,
                } as OverlayTouchEvent;
            })
            .filter((e): e is OverlayTouchEvent => e !== null);

        setTouchEvents(recentTouchEvents);
    }, [playbackMode, fullSession, currentPlaybackTime, showTouchOverlay, detectedRageTaps]);

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
            return;
        }

        lastFrameTimeRef.current = performance.now();
        lastPlaybackUiUpdateRef.current = lastFrameTimeRef.current;
        syncPlaybackChrome(currentPlaybackTimeRef.current);
        warmScreenshotFramesAround(currentFrameIndexRef.current, 'low');

        const tick = (now: number) => {
            const deltaSec = ((now - lastFrameTimeRef.current) / 1000) * playbackRate;
            lastFrameTimeRef.current = now;

            // Advance current playback time using our master clock (ref)
            const nextPlaybackTime = currentPlaybackTimeRef.current + deltaSec;
            currentPlaybackTimeRef.current = nextPlaybackTime;
            syncPlaybackChrome(nextPlaybackTime);

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

            if (targetIdx !== currentFrameIndexRef.current) {
                currentFrameIndexRef.current = targetIdx;
                drawScreenshotFrame(targetIdx);
                warmScreenshotFramesAround(targetIdx, 'low');
            }

            // Check if reached absolute end of session
            if (nextPlaybackTime >= durationSeconds) {
                setIsPlaying(false);
                setCurrentPlaybackTime(durationSeconds);
                setCurrentFrameIndex(currentFrameIndexRef.current);
                currentPlaybackTimeRef.current = durationSeconds;
                lastPlaybackUiUpdateRef.current = now;
                syncPlaybackChrome(durationSeconds);
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
        durationSeconds,
        drawScreenshotFrame,
        syncPlaybackChrome,
        warmScreenshotFramesAround,
    ]);

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
        const clampedTime = Math.max(0, Math.min(time, durationSeconds));
        seekToScreenshotFrame(clampedTime);
    }, [seekToScreenshotFrame, durationSeconds]);

    const formatPlaybackTime = formatPlaybackClock;

    // Progress percentage
    const effectiveDuration = durationSeconds;
    const progressPercent = effectiveDuration > 0 ? (currentPlaybackTime / effectiveDuration) * 100 : 0;

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
            const type = (event.type || '').toLowerCase();
            if (!isFeedbackType(type)) counts.all++;
            const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
            if (type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background') {
                counts.navigation++;
            }
            if (type === 'tap' || type === 'touch' || type === 'gesture' || gestureType.includes('tap')) {
                counts.touches++;
            }
            if (type === 'network_request') {
                counts.network++;
            }
            if (
                type === 'crash' ||
                type === 'error' ||
                type === 'anr' ||
                type === 'rage_tap' ||
                type === 'dead_tap' ||
                gestureType === 'rage_tap' ||
                gestureType === 'dead_tap'
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
            const type = e.type?.toLowerCase() || '';

            if (isFeedbackType(type)) return false;

            if (type === 'error') {
                const hasContent = e.name || e.properties?.message || e.properties?.reason || e.properties?.errorMessage;
                if (!hasContent) return false;
            }

            if (type === 'network_request') {
                const hasUrl = e.properties?.url || e.properties?.urlPath;
                if (!hasUrl) return false;
            }

            const gestureType = (e.gestureType || e.properties?.gestureType || '').toLowerCase();
            let matchesFilter = true;

            if (activityFilter === 'navigation') {
                matchesFilter = type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background';
            } else if (activityFilter === 'touches') {
                matchesFilter = type === 'tap' || type === 'touch' || type === 'gesture' || gestureType.includes('tap');
            } else if (activityFilter === 'network') {
                matchesFilter = type === 'network_request';
            } else if (activityFilter === 'logs') {
                matchesFilter = isLogEvent(e);
            } else if (activityFilter === 'issues') {
                matchesFilter = type === 'crash' || type === 'error' || type === 'anr' || type === 'rage_tap' || type === 'dead_tap' || gestureType === 'rage_tap' || gestureType === 'dead_tap';
            }

            if (!matchesFilter) return false;
            if (!normalizedSearch) return true;

            const name = (e.name || '').toLowerCase();
            const target = (e.targetLabel || e.properties?.targetLabel || '').toLowerCase();
            const url = (e.properties?.url || e.properties?.urlPath || '').toLowerCase();
            const props = JSON.stringify(e.properties || {}).toLowerCase();
            const message = (e.message || e.properties?.message || '').toLowerCase();

            return (
                type.includes(normalizedSearch) ||
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
        const playbackTimestamp = replayBaseTime + currentPlaybackTime * 1000;
        let left = 0;
        let right = filteredActivity.length - 1;
        let result = -1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if ((filteredActivity[mid]?.timestamp || 0) <= playbackTimestamp) {
                result = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return result >= 0 ? result : 0;
    }, [filteredActivity, currentPlaybackTime, replayBaseTime]);

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
        if (filteredActivity.length <= MAX_TIMELINE_MARKERS || durationSeconds <= 0) {
            return filteredActivity.map((event, index) => ({ event, sourceIndex: index, clusteredCount: 1 }));
        }

        const buckets = new Map<number, { event: SessionEvent; sourceIndex: number; priority: number; clusteredCount: number }>();
        filteredActivity.forEach((event, index) => {
            const time = (event.timestamp - replayBaseTime) / 1000;
            if (time < 0) return;
            const bucket = Math.max(
                0,
                Math.min(MAX_TIMELINE_MARKERS - 1, Math.floor((time / durationSeconds) * MAX_TIMELINE_MARKERS))
            );
            const priority = getTimelineMarkerPriority(event);
            const existing = buckets.get(bucket);
            if (!existing || priority > existing.priority) {
                buckets.set(bucket, {
                    event,
                    sourceIndex: index,
                    priority,
                    clusteredCount: (existing?.clusteredCount || 0) + 1,
                });
            } else {
                existing.clusteredCount += 1;
            }
        });

        return Array.from(buckets.values()).sort((a, b) => a.sourceIndex - b.sourceIndex);
    }, [durationSeconds, filteredActivity, replayBaseTime]);

    // Auto-scrolling of the activity list is intentionally disabled so the main
    // page scroll remains stable while the replay is playing. The active event
    // is still highlighted via styling, but we no longer change scrollTop
    // programmatically here.
    useEffect(() => {
        if (activeWorkbenchTab !== 'timeline') return;
        if (activeActivityIndex < 0) return;
        // no-op
    }, [activeWorkbenchTab, activeActivityIndex]);

    // ========================================================================
    // EARLY RETURNS (after all hooks)
    // ========================================================================

    // Only block the full page while the core session bootstrap is still missing.
    if (isCoreLoading && !fullSession) {
        return (
            <SessionLoadingOverlay
                isCoreLoading={isCoreLoading}
                isTimelineLoading={isTimelineLoading}
                isHierarchyLoading={isHierarchyLoading}
                isStatsLoading={isStatsLoading}
                isFramesLoading={isFramesLoading || visualReplayPreparing}
                framesProcessed={(fullSession as FullSession | null)?.screenshotFramesProcessedSegments}
                framesTotal={(fullSession as FullSession | null)?.screenshotFramesTotalSegments}
            />
        );
    }

    if (!session && !fullSession) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-transparent">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500">Session not found</p>
                </div>
            </div>
        );
    }

    // ========================================================================
    // REMAINING COMPUTED VALUES (after early returns, no hooks)
    // ========================================================================

    const durationMinutes = Math.floor(durationSeconds / 60);
    const durationSecs = Math.floor(durationSeconds % 60);

    const deviceModel = fullSession?.deviceInfo?.model || session?.deviceModel || 'Unknown';
    const platform = fullSession?.deviceInfo?.systemName?.toLowerCase() || session?.platform || 'ios';
    const appVersion = fullSession?.deviceInfo?.appVersion || session?.appVersion || '';
    const geoLocation = fullSession?.geoLocation || fullSession?.geoInfo || session?.geoLocation || null;
    const geoDisplay = formatGeoDisplay(geoLocation);
    const sessionLocationWithFlag = `${geoDisplay.flagEmoji} ${geoDisplay.fullLabel}`;

    const rawReplayUserId = (fullSession?.userId ?? '').trim();
    const anonymousFallback = ((fullSession as any)?.anonymousDisplayName as string | undefined)?.trim() || '';
    const replayUserIdCopyValue =
        rawReplayUserId && rawReplayUserId.toLowerCase() !== 'anonymous'
            ? rawReplayUserId
            : anonymousFallback;
    const replayUserIdLabel = replayUserIdCopyValue || 'Anonymous';
    const replayUserIdShown =
        replayUserIdLabel.length > 7 ? `${replayUserIdLabel.slice(0, 7)}…` : replayUserIdLabel;
    const canCopyReplayUserId = Boolean(replayUserIdCopyValue);

    // Calculate metrics
    const metrics = fullSession?.metrics || {};
    const rageTapCount =
        metrics.rageTapCount ??
        fullSession?.rageTapCount ??
        session?.rageTapCount ??
        detectedRageTaps.length ??
        0;

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
        const type = (event.type || '').toLowerCase();
        const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
        return (
            type === 'tap' ||
            type === 'touch' ||
            type === 'gesture' ||
            type === 'scroll' ||
            type === 'input' ||
            gestureType.includes('tap') ||
            gestureType.includes('scroll') ||
            gestureType.includes('swipe') ||
            gestureType.includes('pan')
        );
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
            const type = (event.type || '').toLowerCase();
            const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
            return (
                type === 'tap' ||
                type === 'touch' ||
                type === 'gesture' ||
                type === 'scroll' ||
                type === 'input' ||
                gestureType.includes('tap') ||
                gestureType.includes('scroll') ||
                gestureType.includes('swipe') ||
                gestureType.includes('pan')
            );
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
        const elapsed = Math.max(0, (timestamp - replayBaseTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = Math.floor(elapsed % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Recording availability checks
    const recordingDeleted = (fullSession as any)?.recordingDeleted || session?.recordingDeleted || false;
    const hasSuccessfulRecording =
        (fullSession as any)?.hasSuccessfulRecording
        ?? (session as any)?.hasSuccessfulRecording
        ?? false;
    const isReplayExpired = (fullSession as any)?.isReplayExpired || session?.isReplayExpired || recordingDeleted;
    // Determine the reason why replay is unavailable (if it is)
    const replayUnavailableReason: 'deleted' | 'no_recording_data' | null =
        recordingDeleted ? 'deleted' :
            !hasSuccessfulRecording ? 'no_recording_data' :
                null;
    const playbackDisabled = !hasRecording || visualReplayPreparing || isReplayExpired || Boolean(replayUnavailableReason);
    const sortedSessions = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const currentSessionIndex = sortedSessions.findIndex((item) => item.id === id);
    const previousSessionId = currentSessionIndex > 0 ? sortedSessions[currentSessionIndex - 1]?.id : null;
    const nextSessionId = currentSessionIndex >= 0 && currentSessionIndex < sortedSessions.length - 1
        ? sortedSessions[currentSessionIndex + 1]?.id
        : null;

    const HighlightedText: React.FC<{ text: string; search: string }> = ({ text, search }) => {
        if (!search.trim() || !text) return <>{text}</>;
        const normalizedSearch = search.trim().toLowerCase();
        const escaped = escapeRegExp(search.trim());
        const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
        return (
            <>
                {parts.map((part, i) =>
                    part.toLowerCase() === normalizedSearch ? (
                        <mark key={i} className="bg-yellow-200 text-slate-900 px-0.5 rounded-sm">{part}</mark>
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
        const absoluteTime = (fullSession?.startTime || 0) + currentPlaybackTime * 1000;
        const currentHierarchy = hierarchySnapshots.reduce((prev, curr) =>
            Math.abs(curr.timestamp - absoluteTime) < Math.abs(prev.timestamp - absoluteTime) ? curr : prev
            , hierarchySnapshots[0]);

        if (!currentHierarchy) return;

        const file = new Blob([JSON.stringify(currentHierarchy, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-${(id || 'unknown').slice(0, 16)}-dom-${Math.round(currentPlaybackTime)}s.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const copyDOMHierarchy = async () => {
        const absoluteTime = (fullSession?.startTime || 0) + currentPlaybackTime * 1000;
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

    const metadata = (fullSession as any)?.metadata as Record<string, unknown> | undefined;
    const hasMetadata = metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0;
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

    return (
        <div className="min-h-screen bg-transparent">
            <div className="border-b border-slate-200 bg-white md:sticky md:top-0 md:z-40">
                <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <button
                            onClick={handleBackClick}
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
                            aria-label="Back to sessions"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>

                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="truncate text-sm font-semibold uppercase tracking-wide text-black sm:text-base md:text-lg">Replay Workbench</h1>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="rounded-md border border-sky-200 bg-[#5dadec]/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-black md:text-[10px]">
                                        {platform.toUpperCase()}
                                    </span>
                                    {appVersion && (
                                        <span className="rounded-md border border-slate-200 bg-[#f4f4f5] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide font-mono text-black md:text-[10px]">
                                            v{appVersion}
                                        </span>
                                    )}
                                    <span className="max-w-[120px] truncate rounded-md border border-slate-200 bg-[#f4f4f5] px-2 py-0.5 font-mono text-[9px] font-semibold text-black md:max-w-full md:text-[10px]">
                                        {(id || '').slice(0, 20)}
                                    </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                {canCopyReplayUserId ? (
                                    <button
                                        type="button"
                                        onClick={copyReplayUserId}
                                        className="inline-flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-[#f4f4f5] px-2 py-0.5 text-left transition hover:bg-white"
                                        title={`${replayUserIdLabel} — click to copy`}
                                        aria-label={`Copy user ID: ${replayUserIdLabel}`}
                                    >
                                        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-600 md:text-[10px]">
                                            UID
                                        </span>
                                        <span className="font-mono text-[9px] font-semibold text-black md:text-[10px]">{replayUserIdShown}</span>
                                        <span className="shrink-0 text-slate-500" aria-hidden>
                                            {userIdCopied ? (
                                                <Check className="h-3 w-3 text-emerald-600" strokeWidth={2.25} />
                                            ) : (
                                                <Copy className="h-3 w-3" strokeWidth={2.25} />
                                            )}
                                        </span>
                                    </button>
                                ) : (
                                    <span
                                        className="inline-flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-[#f4f4f5] px-2 py-0.5"
                                        title={replayUserIdLabel}
                                    >
                                        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-600 md:text-[10px]">
                                            UID
                                        </span>
                                        <span className="font-mono text-[9px] font-semibold text-black md:text-[10px]">{replayUserIdShown}</span>
                                    </span>
                                )}
                                </div>
                            </div>

                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600 md:text-[11px]">
                                <div className="flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span>{new Date(startTime).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Smartphone className="h-3.5 w-3.5" />
                                    <span>{deviceModel}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5" />
                                    <span className="truncate">{sessionLocationWithFlag}</span>
                                </div>
                                <span className="font-mono font-semibold text-slate-700">
                                    {durationMinutes}m {durationSecs.toString().padStart(2, '0')}s
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => previousSessionId && navigate(`${pathPrefix}/sessions/${previousSessionId}`)}
                            onMouseDown={(event) => event.preventDefault()}
                            disabled={!previousSessionId}
                            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold shadow-sm transition ${previousSessionId
                                ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                }`}
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            Prev
                        </button>
                        <button
                            onClick={() => nextSessionId && navigate(`${pathPrefix}/sessions/${nextSessionId}`)}
                            onMouseDown={(event) => event.preventDefault()}
                            disabled={!nextSessionId}
                            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold shadow-sm transition ${nextSessionId
                                ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                }`}
                        >
                            Next
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <span className={`rounded-lg border px-3 py-1 text-xs font-bold ${sessionRiskStyle.badge}`}>
                            {sessionRiskLabel}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <section className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-7">
                        <div className="border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Replay Theater</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-200 md:text-[10px]">
                                    {secondaryDataLoading ? (
                                        <span className="rounded border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-cyan-100">
                                            Syncing
                                        </span>
                                    ) : null}
                                    <span className="rounded border border-white/20 bg-white/10 px-2 py-1">
                                        {displayedFrameCount} FR
                                    </span>
                                    <span className="rounded border border-white/20 bg-white/10 px-2 py-1">{allTimelineEvents.length} EV</span>
                                    <span className="rounded border border-white/20 bg-white/10 px-2 py-1">
                                        {visualReplayPreparing
                                            ? 'Preparing'
                                            : playbackMode === 'screenshots'
                                                ? 'Visual'
                                                : 'No Visual'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="relative border-b border-slate-200 bg-slate-50 px-3 py-4 sm:px-6 sm:py-6">
                            <div className="mx-auto flex w-full max-w-[420px] items-center justify-center">
                                {(isReplayExpired || replayUnavailableReason || !hasRecording) ? (
                                    <div className="flex aspect-[9/18.5] w-full max-w-[320px] flex-col items-center justify-center border-2 border-dashed border-black bg-[#f4f4f5] p-6 text-center">
                                        <VideoOff className="h-10 w-10 text-slate-400" />
                                        <p className="mt-3 text-sm font-bold text-slate-900">Replay Not Available</p>
                                        {replayUnavailableReason === 'deleted' ? (
                                            <p className="mt-2 text-xs leading-5 text-slate-600">
                                                Visual media was removed by retention policy, but timeline events, logs, and network traces are still available.
                                            </p>
                                        ) : replayUnavailableReason === 'no_recording_data' ? (
                                            <p className="mt-2 text-xs leading-5 text-slate-600">
                                                No screenshot recording was successfully uploaded for this session. You can still inspect all telemetry.
                                            </p>
                                        ) : (
                                            <p className="mt-2 text-xs leading-5 text-slate-600">
                                                No visual frames were uploaded for this session.
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <div className="absolute -top-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                                            <ImageIcon className="h-3 w-3" />
                                            <span>Frame {Math.min(currentFrameIndex + 1, screenshotFrames.length)}/{screenshotFrames.length}</span>
                                        </div>

                                        <div className="relative w-[320px] max-w-[78vw] rounded-[2.8rem] border border-slate-700 bg-slate-950 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.25)]">
                                            <div className="rounded-[2.3rem] bg-slate-900 p-1.5">
                                                <div
                                                    className="relative overflow-hidden rounded-[2rem] bg-slate-900"
                                                    style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                                                >
                                                    {visualReplayPreparing && (
                                                        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/80 px-6 text-center text-slate-100">
                                                            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/80 bg-emerald-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200 shadow-[0_0_20px_rgba(34,197,94,0.45)] animate-pulse">
                                                                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" aria-hidden />
                                                                Live
                                                            </span>
                                                            <RefreshCw className="mt-4 h-8 w-8 animate-spin text-emerald-300" />
                                                            <p className="mt-4 text-sm font-semibold text-white">Preparing visual replay</p>
                                                            <p className="mt-2 text-xs leading-5 text-slate-300">
                                                                Timeline, logs, and network are ready. Frames appear here as soon as processing finishes.
                                                            </p>
                                                            {replayPreparationProgressPercent !== null ? (
                                                                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                                                                    {replayPreparationProgressPercent}% complete
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    )}

                                                    {platform === 'android' ? (
                                                        <div className="pointer-events-none absolute left-1/2 top-3 z-20 h-4 w-4 -translate-x-1/2 rounded-full bg-slate-900" />
                                                    ) : (
                                                        <div className="pointer-events-none absolute left-1/2 top-2 z-20 flex h-6 w-20 -translate-x-1/2 items-center justify-center rounded-full bg-slate-900">
                                                            <div className="mr-2 h-2 w-2 rounded-full bg-slate-700" />
                                                            <div className="h-3 w-3 rounded-full border border-slate-700 bg-slate-800" />
                                                        </div>
                                                    )}

                                                    {/* First frame as poster - shows immediately while canvas loads */}
                                                    {screenshotFrames[0]?.url && (
                                                        <img
                                                            src={screenshotFrames[0].url}
                                                            alt=""
                                                            loading="eager"
                                                            decoding="async"
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
                                                            currentTime={(fullSession?.startTime || 0) + currentPlaybackTime * 1000}
                                                            visibleWindowMs={800}
                                                        />
                                                    )}

                                                    <div className="pointer-events-none absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-slate-900/30" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {playbackMode === 'screenshots' ? (
                            <>
                                <div className="border-b border-slate-200 bg-white px-3 py-3 sm:px-6 sm:py-4">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                        {/* Primary Controls */}
                                        <div className="flex items-center justify-center gap-2 sm:justify-start">
                                            <button
                                                onClick={restart}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`flex h-10 w-10 items-center justify-center border-2 transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                    : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                    }`}
                                                title="Restart"
                                            >
                                                <RotateCcw className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => skip(-5)}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`flex h-10 w-10 items-center justify-center border-2 transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                    : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                    }`}
                                                title="Back 5s"
                                            >
                                                <SkipBack className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={togglePlayPause}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`flex h-12 w-12 items-center justify-center rounded-full border text-white shadow-sm transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-slate-300 bg-slate-300 text-slate-200'
                                                    : isPlaying
                                                        ? 'border-amber-300 bg-amber-500 hover:bg-amber-600'
                                                        : 'border-cyan-500 bg-cyan-600 hover:bg-cyan-700'
                                                    }`}
                                                title={isPlaying ? 'Pause' : 'Play'}
                                            >
                                                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
                                            </button>
                                            <button
                                                onClick={() => skip(5)}
                                                onMouseDown={(event) => event.preventDefault()}
                                                disabled={playbackDisabled}
                                                className={`flex h-10 w-10 items-center justify-center border-2 transition ${playbackDisabled
                                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                    : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                    }`}
                                                title="Forward 5s"
                                            >
                                                <SkipForward className="h-4 w-4" />
                                            </button>
                                        </div>

                                        {/* Secondary Controls */}
                                        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                                            <span className="inline-flex items-center rounded-lg border border-slate-200 bg-[#f4f4f5] px-3 py-2 font-mono text-xs font-semibold text-black">
                                                <span ref={progressTimeRef}>{formatPlaybackTime(currentPlaybackTime)}</span> / {formatPlaybackTime(effectiveDuration)}
                                            </span>

                                            <button
                                                onClick={() => setShowTouchOverlay(!showTouchOverlay)}
                                                onMouseDown={(event) => event.preventDefault()}
                                                className={`flex h-10 items-center gap-1.5 border-2 px-3 text-xs font-bold uppercase transition ${showTouchOverlay
                                                    ? 'border-[#5dadec] bg-[#5dadec] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                    : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                    }`}
                                            >
                                                <Hand className="h-3.5 w-3.5" />
                                                <span className="hidden xs:inline">Touches</span>
                                            </button>

                                            <div className="relative">
                                                <button
                                                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    className="flex h-10 items-center border-2 border-black bg-white px-4 font-mono text-xs font-bold text-slate-700 transition hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                                >
                                                    {playbackRate}x
                                                </button>

                                                {showSpeedMenu && (
                                                    <>
                                                        <div className="fixed inset-0 z-40" onClick={() => setShowSpeedMenu(false)} />
                                                        <div className="absolute bottom-full right-0 z-50 mb-2 min-w-[92px] overflow-hidden border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:bottom-auto sm:top-full sm:mt-2">
                                                            {[0.5, 1, 1.5, 2, 4].map((rate) => (
                                                                <button
                                                                    key={rate}
                                                                    onClick={() => {
                                                                        setPlaybackRate(rate);
                                                                        setShowSpeedMenu(false);
                                                                    }}
                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                    className={`block w-full border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold last:border-b-0 ${playbackRate === rate
                                                                        ? 'bg-[#5dadec]/10 text-black font-bold'
                                                                        : 'text-black hover:bg-[#f4f4f5]'
                                                                        }`}
                                                                >
                                                                    {rate}x
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-[#f4f4f5] px-3 py-3 sm:px-6">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wide text-black">
                                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />Touches</span>
                                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />API</span>
                                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Issues</span>
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                            Drag timeline or click markers to seek
                                        </span>
                                    </div>

                                    <svg viewBox="0 0 1000 50" preserveAspectRatio="none" className="h-11 w-full">
                                        <defs>
                                            <linearGradient id="touchGradNew" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
                                            </linearGradient>
                                            <linearGradient id="apiGradNew" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.08" />
                                            </linearGradient>
                                        </defs>

                                        {densityData.touchDensity.length > 0 && (
                                            <>
                                                <path
                                                    fill="url(#touchGradNew)"
                                                    d={`M0,48 ${densityData.touchDensity
                                                        .map((value, index) => {
                                                            const x = (index / (densityData.touchDensity.length - 1)) * 1000;
                                                            const y = 45 - value * 38;
                                                            return `L${x},${y}`;
                                                        })
                                                        .join(' ')} L1000,48 Z`}
                                                />
                                                <polyline
                                                    fill="none"
                                                    stroke="#3b82f6"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    points={densityData.touchDensity
                                                        .map((value, index) => {
                                                            const x = (index / (densityData.touchDensity.length - 1)) * 1000;
                                                            const y = 45 - value * 38;
                                                            return `${x},${y}`;
                                                        })
                                                        .join(' ')}
                                                />
                                            </>
                                        )}

                                        {densityData.apiDensity.length > 0 && (
                                            <>
                                                <path
                                                    fill="url(#apiGradNew)"
                                                    d={`M0,48 ${densityData.apiDensity
                                                        .map((value, index) => {
                                                            const x = (index / (densityData.apiDensity.length - 1)) * 1000;
                                                            const y = 45 - value * 38;
                                                            return `L${x},${y}`;
                                                        })
                                                        .join(' ')} L1000,48 Z`}
                                                />
                                                <polyline
                                                    fill="none"
                                                    stroke="#10b981"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    points={densityData.apiDensity
                                                        .map((value, index) => {
                                                            const x = (index / (densityData.apiDensity.length - 1)) * 1000;
                                                            const y = 45 - value * 38;
                                                            return `${x},${y}`;
                                                        })
                                                        .join(' ')}
                                                />
                                            </>
                                        )}
                                    </svg>

                                    <div
                                        ref={progressRef}
                                        className="group relative mt-1 h-10 cursor-pointer touch-none"
                                        onMouseDown={handleProgressMouseDown}
                                        onTouchStart={handleProgressTouchStart}
                                    >
                                        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 bg-gray-200 border border-black" />
                                        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden">
                                            <div
                                                ref={progressFillRef}
                                                className="h-full w-full origin-left bg-[#5dadec] will-change-transform"
                                                style={{ transform: `scaleX(${progressPercent / 100})` }}
                                            />
                                        </div>

                                        {timelineMarkers.map(({ event, sourceIndex, clusteredCount }) => {
                                            const time = (event.timestamp - replayBaseTime) / 1000;
                                            if (time < 0 || durationSeconds <= 0) return null;
                                            const percent = Math.min(100, Math.max(0, (time / durationSeconds) * 100));
                                            const markerKey = `marker-${sourceIndex}-${event.timestamp}`;
                                            const color = getEventColor(event);
                                            const isFrustration =
                                                event.frustrationKind || event.type === 'rage_tap' || event.gestureType === 'dead_tap';
                                            const isClustered = clusteredCount > 1;

                                            return (
                                                <div
                                                    key={markerKey}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`absolute top-1/2 -translate-y-1/2 cursor-pointer rounded-full transition ${isFrustration ? 'z-20 h-2.5 w-2.5' : isClustered ? 'z-10 h-2.5 w-2.5' : 'z-10 h-2 w-2'
                                                        } ${hoveredMarker?.markerKey === markerKey
                                                            ? 'scale-150 shadow-[0_0_0_4px_rgba(15,23,42,0.15)]'
                                                            : 'hover:scale-125'
                                                        }`}
                                                    style={{ left: `${percent}%`, backgroundColor: color, opacity: isClustered ? 0.88 : 1 }}
                                                    onClick={(eventClick) => {
                                                        eventClick.currentTarget.blur();
                                                        handleSeekToTime(Math.max(0, time));
                                                    }}
                                                    onMouseEnter={() => setHoveredMarker({ markerKey, clusteredCount, ...event, x: percent })}
                                                    onMouseLeave={() => setHoveredMarker(null)}
                                                    onKeyDown={(eventKey) => {
                                                        if (eventKey.key === 'Enter' || eventKey.key === ' ') {
                                                            eventKey.preventDefault();
                                                            handleSeekToTime(Math.max(0, time));
                                                        }
                                                    }}
                                                />
                                            );
                                        })}

                                        {hoveredMarker && (
                                            <MarkerTooltip
                                                visible={true}
                                                x={hoveredMarker.x}
                                                type={hoveredMarker.type || 'gesture'}
                                                name={hoveredMarker.name}
                                                target={hoveredMarker.targetLabel || hoveredMarker.properties?.targetLabel}
                                                timestamp={formatEventTime(hoveredMarker.timestamp)}
                                                statusCode={hoveredMarker.properties?.statusCode}
                                                success={hoveredMarker.properties?.success}
                                                duration={hoveredMarker.properties?.duration}
                                            />
                                        )}

                                        <div
                                            ref={progressThumbRef}
                                            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-[#5dadec] shadow transition-transform ${isDragging ? 'scale-110' : 'group-hover:scale-105'
                                                }`}
                                            style={{ left: `${progressPercent}%`, willChange: 'left' }}
                                        />
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </section>


                    <section className="flex min-h-[400px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-5 xl:min-h-[580px]">
                        <div className="flex shrink-0 overflow-x-auto border-b border-slate-200 bg-white no-scrollbar">
                            <button
                                onClick={() => setActiveWorkbenchTab('timeline')}
                                className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'timeline' ? 'border-black bg-white text-black font-mono font-bold' : 'border-transparent text-gray-500 hover:text-black font-mono hover:bg-gray-50'}`}
                            >
                                <ListFilter className="h-4 w-4" />
                                Timeline
                            </button>
                            <button
                                onClick={() => setActiveWorkbenchTab('console')}
                                className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'console' ? 'border-black bg-white text-black font-mono font-bold' : 'border-transparent text-gray-500 hover:text-black font-mono hover:bg-gray-50'}`}
                            >
                                <Terminal className="h-4 w-4" />
                                Console
                            </button>
                            <button
                                onClick={() => setActiveWorkbenchTab('inspector')}
                                className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'inspector' ? 'border-black bg-white text-black font-mono font-bold' : 'border-transparent text-gray-500 hover:text-black font-mono hover:bg-gray-50'}`}
                            >
                                <Code className="h-4 w-4" />
                                DOM
                            </button>
                            <button
                                onClick={() => setActiveWorkbenchTab('metadata')}
                                className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'metadata' ? 'border-black bg-white text-black font-mono font-bold' : 'border-transparent text-gray-500 hover:text-black font-mono hover:bg-gray-50'}`}
                            >
                                <Database className="h-4 w-4" />
                                Metadata
                            </button>
                        </div>
                        <div className="relative flex min-h-0 flex-1 flex-col bg-white">
                            {activeWorkbenchTab === 'timeline' && (
                                <div className="absolute inset-0 flex flex-col">
                                    <div className="border-b-2 border-black bg-white px-4 py-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Activity Stream</p>
                                                <h3 className="text-sm font-bold text-slate-900">All actions, logs, and failures in one timeline</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={copyTimelineEvents}
                                                    disabled={allTimelineEvents.length === 0}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${allTimelineEvents.length === 0
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                        : timelineCopied
                                                            ? 'border-emerald-500 bg-emerald-600 text-white'
                                                            : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                        }`}
                                                    title={allTimelineEvents.length > 0 ? 'Copy all timeline events' : 'No events available'}
                                                >
                                                    {timelineCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                                    {timelineCopied ? 'Copied' : 'COPY'}
                                                </button>
                                                <button
                                                    onClick={downloadTimelineEvents}
                                                    disabled={allTimelineEvents.length === 0}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${allTimelineEvents.length === 0
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                        }`}
                                                    title={allTimelineEvents.length > 0 ? 'Download all timeline events' : 'No events available'}
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    EXPORT
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-3">
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={activitySearch}
                                                    onChange={(event) => setActivitySearch(event.target.value)}
                                                    placeholder="Search events, targets, messages, or endpoints"
                                                    className="h-9 w-full border-2 border-black rounded-none bg-white px-3 pr-8 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/20"
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

                                            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                                                {activityTabs.map((filter) => (
                                                    <button
                                                        key={filter.id}
                                                        onClick={() => setActivityFilter(filter.id)}
                                                        className={`shrink-0 border-2 px-2 py-1 text-[11px] font-semibold transition ${activityFilter === filter.id
                                                            ? 'border-black bg-black text-white'
                                                            : 'border-black bg-white text-slate-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                                            }`}
                                                    >
                                                        {filter.label}
                                                        <span className="ml-1 rounded bg-slate-900/10 px-1 py-0.5 text-[10px] font-bold">
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
                                                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-cyan-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
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
                                                const seekTime = Math.max(0, (event.timestamp - replayBaseTime) / 1000);
                                                const isHighlighted = index === activeActivityIndex;
                                                const title = isNetwork
                                                    ? `${event.name || event.properties?.method || 'API Request'}`
                                                    : faultMarker
                                                        ? `Fault ${faultMarker}`
                                                        : isLog
                                                            ? `Console ${logLevel}`
                                                            : event.type === 'custom'
                                                                ? event.name || 'Custom Event'
                                                                : event.type.replace(/_/g, ' ');
                                                const detail = faultMarker
                                                    ? getFaultConsoleSummary(event)
                                                    : isLog
                                                        ? event.message || event.properties?.message || event.name || 'Console message'
                                                        : event.targetLabel ||
                                                        event.properties?.targetLabel ||
                                                        event.properties?.urlPath ||
                                                        event.name ||
                                                        event.screen ||
                                                        JSON.stringify(event.properties || {});

                                                return (
                                                    <button
                                                        key={`${event.timestamp}-${index}`}
                                                        data-activity-index={index}
                                                        onClick={() => handleSeekToTime(seekTime)}
                                                        className={`block w-full border-b border-slate-100 px-3 py-2 text-left transition ${isHighlighted
                                                            ? 'bg-[#5dadec]/10 border-l-2 border-[#5dadec]'
                                                            : 'hover:bg-gray-100'
                                                            }`}
                                                    >
                                                        <div className="flex items-start gap-2.5">
                                                            <div className="mt-0.5 shrink-0">
                                                                {isNetwork ? (
                                                                    <span
                                                                        className={`inline-flex rounded border px-1 py-0.5 font-mono text-[9px] font-bold ${event.properties?.success
                                                                            ? 'border-2 border-[#34d399] bg-white text-[#34d399]'
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
                                                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-200" style={{ backgroundColor: color }}>
                                                                        <Icon className="h-2.5 w-2.5 text-white" />
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <p className="truncate text-[11px] font-semibold text-slate-800">{title}</p>
                                                                    <span className="shrink-0 bg-[#f4f4f5] border border-gray-300 px-1 py-0.5 font-mono text-[10px] font-bold text-black">
                                                                        {timeStr}
                                                                    </span>
                                                                </div>
                                                                <p className="mt-0.5 line-clamp-2 break-words text-xs font-medium text-slate-600">
                                                                    <HighlightedText text={String(detail)} search={activitySearch} />
                                                                </p>
                                                                {typeof event.properties?.duration === 'number' && event.properties.duration > 0 && (
                                                                    <span
                                                                        className={`mt-1 inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${event.properties.duration > 1000
                                                                            ? 'bg-red-100 text-red-700'
                                                                            : event.properties.duration > 500
                                                                                ? 'bg-amber-100 text-amber-700'
                                                                                : 'bg-[#f4f4f5] text-black border border-gray-300'
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
                            {activeWorkbenchTab === 'console' && (
                                <div className="absolute inset-0 flex flex-col bg-slate-950">
                                    <div className="border-b border-slate-700 px-4 py-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Runtime Console</p>
                                                <h3 className="truncate text-sm font-bold text-white">
                                                    {revealAllLogs ? 'Displaying all session logs' : 'Logs synced to playback timestamp'}
                                                </h3>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                <span className="flex h-7 items-center rounded border border-slate-700 bg-slate-900 px-1.5 font-mono text-[10px] text-slate-300">
                                                    {terminalVisibleRows.length}/{terminalLogRows.length}
                                                </span>
                                                <button
                                                    onClick={() => setRevealAllLogs(!revealAllLogs)}
                                                    className={`flex h-7 items-center gap-1 whitespace-nowrap border px-1.5 text-[10px] font-semibold transition ${revealAllLogs
                                                        ? 'border-cyan-500 bg-cyan-600 text-white'
                                                        : 'border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-400'
                                                        }`}
                                                    title={revealAllLogs ? 'Sync to playback' : 'Reveal all logs in session'}
                                                >
                                                    {revealAllLogs ? <Zap className="h-3 w-3" /> : <ListFilter className="h-3 w-3" />}
                                                    {revealAllLogs ? 'SYNC' : 'ALL LOGS'}
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
                            {activeWorkbenchTab === 'inspector' && (
                                <div className="absolute inset-0 flex flex-col bg-[#f4f4f5]">
                                    <div className="border-b-2 border-black bg-[#f4f4f5] px-4 py-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">View Inspector</p>
                                                <h3 className="text-sm font-bold text-slate-900">Hierarchy synced with playback</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={copyDOMHierarchy}
                                                    disabled={hierarchySnapshots.length === 0}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${hierarchySnapshots.length === 0
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                        : domCopied
                                                            ? 'border-emerald-500 bg-emerald-600 text-white'
                                                            : 'border-black bg-white text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
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
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
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
                                                currentTime={currentPlaybackTime}
                                                sessionStartTime={fullSession?.startTime || 0}
                                                deviceWidth={fullSession?.deviceInfo?.screenWidth || 375}
                                                deviceHeight={fullSession?.deviceInfo?.screenHeight || 812}
                                                className="h-full"
                                            />
                                        ) : (
                                            <div className="flex h-full flex-col items-center justify-center bg-[#f4f4f5] px-5 text-center text-slate-500">
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
                            {activeWorkbenchTab === 'metadata' && (
                                <div className="absolute inset-0 flex flex-col bg-[#f4f4f5] overflow-auto">
                                    <div className="border-b-2 border-black bg-[#f4f4f5] px-4 py-3 sticky top-0 z-10">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Session Metadata</p>
                                                <h3 className="text-sm font-bold text-slate-900">Custom properties</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={copyMetadata}
                                                    disabled={!hasMetadata}
                                                    className={`flex h-8 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold transition ${!hasMetadata
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                        : metadataCopied
                                                            ? 'border-emerald-500 bg-emerald-600 text-white'
                                                            : 'border-black bg-white text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
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
                                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                                        : 'border-black bg-white text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
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
                                        {!(fullSession as any)?.metadata || Object.keys((fullSession as any).metadata).length === 0 ? (
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
                                                    <thead className="bg-[#f4f4f5] text-xs font-semibold uppercase tracking-wider text-black font-mono">
                                                        <tr>
                                                            <th className="px-4 py-3 border-b-2 border-black">Key</th>
                                                            <th className="px-4 py-3 border-b-2 border-black">Value</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-200">
                                                        {Object.entries((fullSession as any).metadata).map(([key, value]) => (
                                                            <tr key={key} className="hover:bg-[#f4f4f5] transition-colors">
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
