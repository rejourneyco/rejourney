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
    MapPin,
    Download,
    FileText,
    ListFilter,
    Terminal,
    Code,
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api } from '../../services/api';
import DOMInspector, { HierarchySnapshot } from '../../components/ui/DOMInspector';
import { TouchOverlay, TouchEvent } from '../../components/ui/TouchOverlay';
import { MarkerTooltip } from '../../components/ui/MarkerTooltip';
import { SessionLoadingOverlay } from '../../components/recordings/SessionLoadingOverlay';
import { formatGeoDisplay } from '../../utils/geoDisplay';

// ============================================================================
// Types
// ============================================================================

interface SessionEvent {
    type: string;
    name?: string;
    timestamp: number;
    properties?: Record<string, any>;
    screen?: string;
    gestureType?: string;
    frustrationKind?: string;
    targetLabel?: string;
    touches?: Array<{ x: number; y: number; force?: number }>;
    level?: 'log' | 'warn' | 'error' | string;
    message?: string;
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
        status?: string;
    }[];
    anrs?: {
        timestamp: number;
        durationMs?: number;
        threadState?: string;
    }[];
    metrics?: {
        touchCount?: number;
        scrollCount?: number;
        gestureCount?: number;
        errorCount?: number;
        rageTapCount?: number;
        screensVisited?: string[];
        uxScore?: number;
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
    uxScore?: number;
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

const getLogLevel = (event: SessionEvent): string => {
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
    return (
        type === 'log' ||
        type === 'console_log' ||
        type === 'console' ||
        type === 'console.warn' ||
        type === 'console.error'
    );
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

// ============================================================================
// Main Component
// ============================================================================

export const RecordingDetail: React.FC<{ sessionId?: string }> = ({ sessionId }) => {
    const { sessionId: paramId } = useParams<{ sessionId: string }>();
    const id = sessionId || paramId;
    const { sessions } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    // State
    const [fullSession, setFullSession] = useState<FullSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activityFilter, setActivityFilter] = useState<string>('all');
    const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);
    const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<'timeline' | 'console' | 'inspector'>('timeline');

    // Replay player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1.5);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showTouchOverlay, setShowTouchOverlay] = useState(true);
    const [touchEvents, setTouchEvents] = useState<TouchEvent[]>([]);
    const [activitySearch, setActivitySearch] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredMarker, setHoveredMarker] = useState<any>(null);
    const [terminalCopied, setTerminalCopied] = useState(false);

    // DOM Inspector state
    const [hierarchySnapshots, setHierarchySnapshots] = useState<HierarchySnapshot[]>([]);

    // Screenshot playback state
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const screenshotFrameCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const screenshotAnimationRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number>(0);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const terminalViewportRef = useRef<HTMLDivElement>(null);

    // Ref-based playback state to avoid stale closures in animation loop
    const currentPlaybackTimeRef = useRef<number>(0);
    const currentFrameIndexRef = useRef<number>(0);

    // Sync refs with state for external interactions (like seeking)
    useEffect(() => {
        currentPlaybackTimeRef.current = currentPlaybackTime;
    }, [currentPlaybackTime]);

    useEffect(() => {
        currentFrameIndexRef.current = currentFrameIndex;
    }, [currentFrameIndex]);

    // Get basic session from context
    const session = sessions.find((s) => s.id === id);

    // Fetch full session data
    const fetchFullSession = useCallback(async () => {
        if (!id) return;
        try {
            setIsLoading(true);
            setHierarchySnapshots([]);
            // Use proxied frame URLs to avoid browser access issues with internal/private S3 endpoints.
            const coreData = await api.getSessionCore(id, { frameUrlMode: 'proxy' });
            setFullSession(coreData as any);
            setIsLoading(false);

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

            // Load heavier replay data after first paint.
            const [timelineResult, hierarchyResult, statsResult] = await Promise.allSettled([
                api.getSessionTimeline(id),
                api.getSessionHierarchy(id),
                api.getSessionStats(id),
            ]);

            setFullSession((prev) => {
                if (!prev || prev.id !== id) return prev;
                const next: any = { ...prev };

                if (timelineResult.status === 'fulfilled') {
                    next.events = timelineResult.value.events || [];
                    next.networkRequests = timelineResult.value.networkRequests || [];
                    next.crashes = timelineResult.value.crashes || [];
                    next.anrs = timelineResult.value.anrs || [];
                }

                if (hierarchyResult.status === 'fulfilled') {
                    next.hierarchySnapshots = hierarchyResult.value.hierarchySnapshots || [];
                    setHierarchySnapshots(transformHierarchySnapshots(next.hierarchySnapshots, next));
                }

                if (statsResult.status === 'fulfilled') {
                    next.stats = statsResult.value.stats || next.stats;
                }

                return next;
            });
        } catch (err) {
            console.error('Failed to fetch session:', err);
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    useEffect(() => {
        fetchFullSession();
    }, [fetchFullSession]);

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
            type: 'crash',
            name: c.exceptionName || 'Crash',
            timestamp: c.timestamp,
            properties: { exceptionName: c.exceptionName, reason: c.reason, crashId: c.id },
        }));
    }, [fullSession]);

    // All timeline events sorted
    const allTimelineEvents = useMemo(() => {
        return [...events, ...networkEventsForTimeline, ...detectedRageTaps, ...crashEvents]
            .sort((a, b) => a.timestamp - b.timestamp);
    }, [events, networkEventsForTimeline, detectedRageTaps, crashEvents]);

    const replayBaseTime = fullSession?.startTime || (session?.startedAt ? new Date(session.startedAt).getTime() : Date.now());
    const startTime = replayBaseTime;

    const logEvents = useMemo(() => allTimelineEvents.filter((event) => isLogEvent(event)), [allTimelineEvents]);

    const terminalLogRows = useMemo(() => {
        return logEvents
            .map((event, index) => {
                const relativeSeconds = Math.max(0, (event.timestamp - replayBaseTime) / 1000);
                const level = getLogLevel(event);
                const rawMessage = event.message || event.properties?.message || event.name;
                const message = rawMessage
                    ? String(rawMessage)
                    : JSON.stringify(event.properties || {});
                return {
                    id: `${event.timestamp}-${index}`,
                    timestamp: event.timestamp,
                    relativeSeconds,
                    level,
                    message,
                    line: `[${formatPlaybackClock(relativeSeconds)}] [${level.toUpperCase()}] ${message}`,
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);
    }, [logEvents, replayBaseTime]);

    const visibleTerminalLogRows = useMemo(
        () => terminalLogRows.filter((entry) => entry.relativeSeconds <= currentPlaybackTime + 0.05),
        [terminalLogRows, currentPlaybackTime]
    );

    const terminalVisibleRows = useMemo(
        () => visibleTerminalLogRows.slice(-250),
        [visibleTerminalLogRows]
    );

    const visibleTerminalLogText = useMemo(
        () => visibleTerminalLogRows.map((entry) => entry.line).join('\n'),
        [visibleTerminalLogRows]
    );

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
    // Normalize timestamps to be relative to session start time
    const screenshotFrames = useMemo(() => {
        const rawFrames = fullSession?.screenshotFrames || [];
        if (rawFrames.length === 0 || !fullSession?.startTime) return [];

        const sessionStart = fullSession.startTime;
        return rawFrames
            .map((f, idx) => ({
                ...f,
                // relativeTime is seconds from session start (for playback)
                relativeTime: (f.timestamp - sessionStart) / 1000,
            }))
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((f, idx) => ({ ...f, index: idx }));
    }, [fullSession?.screenshotFrames, fullSession?.startTime]);

    // Determine playback mode
    const playbackMode = useMemo(() => {
        if (fullSession?.playbackMode === 'screenshots' && screenshotFrames.length > 0) {
            return 'screenshots' as const;
        }
        if (screenshotFrames.length > 0) {
            return 'screenshots' as const;
        }
        return 'none' as const;
    }, [fullSession?.playbackMode, screenshotFrames]);

    // Has any visual recording?
    const hasRecording = playbackMode !== 'none';

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

    // Handle progress click/drag for screenshot playback
    const handleProgressInteraction = useCallback(
        (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
            if (!progressRef.current) return;

            const rect = progressRef.current.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

            if (screenshotFrames.length === 0) return;
            const newTime = percent * durationSeconds;
            // Binary search for closest frame by relativeTime
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
            setCurrentPlaybackTime(screenshotFrames[left].relativeTime);
        },
        [durationSeconds, screenshotFrames]
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

    // Toggle play/pause for screenshot playback
    const togglePlayPause = useCallback(() => {
        // The screenshot animation effect handles the actual playback.
        setIsPlaying(!isPlaying);
    }, [isPlaying]);

    // Skip in screenshot playback
    const skip = useCallback(
        (seconds: number) => {
            if (screenshotFrames.length === 0) return;
            const targetTime = Math.max(0, Math.min(currentPlaybackTime + seconds, durationSeconds));
            // Binary search for closest frame by relativeTime
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
            setCurrentPlaybackTime(screenshotFrames[idx].relativeTime);
        },
        [currentPlaybackTime, screenshotFrames, durationSeconds]
    );

    // Restart screenshot playback
    const restart = useCallback(() => {
        if (screenshotFrames.length === 0) return;
        setCurrentFrameIndex(0);
        setCurrentPlaybackTime(0); // relativeTime of first frame is always 0
        setIsPlaying(true);
    }, [screenshotFrames]);

    // Effect: Keyboard shortcut for play/pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input/textarea
            if (e.target !== document.body) return;

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
    }, [togglePlayPause, skip]);

    // ============================================================================
    // Screenshot Playback Effects
    // ============================================================================

    // Initialize currentPlaybackTime when screenshot mode loads
    useEffect(() => {
        if (playbackMode !== 'screenshots' || screenshotFrames.length === 0) return;
        if (!fullSession?.startTime) return;

        // Set initial playback time to the first frame's relative time
        const firstFrameRelativeTime = (screenshotFrames[0].timestamp - fullSession.startTime) / 1000;
        // Only initialize if we haven't moved from the default 0 yet
        if (currentPlaybackTime === 0 && currentFrameIndex === 0) {

            setCurrentPlaybackTime(Math.max(0, firstFrameRelativeTime));
        }
    }, [playbackMode, screenshotFrames, fullSession?.startTime, currentPlaybackTime, currentFrameIndex]);

    // Preload screenshot frames
    useEffect(() => {
        if (playbackMode !== 'screenshots' || screenshotFrames.length === 0) return;

        const cache = screenshotFrameCacheRef.current;

        // Preload only a small startup window to reduce open latency.
        const preloadCount = Math.min(8, screenshotFrames.length);

        for (let i = 0; i < preloadCount; i++) {
            const frame = screenshotFrames[i];
            if (!cache.has(frame.url)) {
                const img = new Image();
                img.crossOrigin = 'anonymous'; // Enable CORS for S3 presigned URLs
                img.src = frame.url;
                cache.set(frame.url, img);
            }
        }

        // Preload a bounded background window for smoother scrubbing without flooding the network.
        const preloadRest = () => {
            const maxBackgroundPreload = Math.min(screenshotFrames.length, 120);
            for (let i = preloadCount; i < maxBackgroundPreload; i++) {
                const frame = screenshotFrames[i];
                if (!cache.has(frame.url)) {
                    const img = new Image();
                    img.crossOrigin = 'anonymous'; // Enable CORS for S3 presigned URLs
                    img.src = frame.url;
                    cache.set(frame.url, img);
                }
            }
        };

        if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(preloadRest);
        } else {
            setTimeout(preloadRest, 100);
        }
    }, [playbackMode, screenshotFrames]);

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
                } as TouchEvent;
            })
            .filter((e): e is TouchEvent => e !== null);

        setTouchEvents(recentTouchEvents);
    }, [playbackMode, fullSession, currentPlaybackTime, showTouchOverlay, detectedRageTaps]);

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

        const tick = (now: number) => {
            const deltaSec = ((now - lastFrameTimeRef.current) / 1000) * playbackRate;
            lastFrameTimeRef.current = now;

            // Advance current playback time using our master clock (ref)
            const nextPlaybackTime = currentPlaybackTimeRef.current + deltaSec;
            currentPlaybackTimeRef.current = nextPlaybackTime;

            // Batch state updates to minimize re-renders while keeping UI in sync
            setCurrentPlaybackTime(nextPlaybackTime);

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
                setCurrentFrameIndex(targetIdx);
            }

            // Check if reached absolute end of session
            if (nextPlaybackTime >= durationSeconds) {
                setIsPlaying(false);
                setCurrentPlaybackTime(durationSeconds);
                currentPlaybackTimeRef.current = durationSeconds;
                return;
            }

            screenshotAnimationRef.current = requestAnimationFrame(tick);
        };

        screenshotAnimationRef.current = requestAnimationFrame(tick);

        return () => {
            if (screenshotAnimationRef.current) {
                cancelAnimationFrame(screenshotAnimationRef.current);
            }
        };
    }, [playbackMode, isPlaying, screenshotFrames, playbackRate, durationSeconds]);

    // Draw current screenshot frame to canvas
    useEffect(() => {
        if (playbackMode !== 'screenshots' || !canvasRef.current || screenshotFrames.length === 0) {
            return;
        }

        const frame = screenshotFrames[currentFrameIndex];
        if (!frame) {
            return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const cache = screenshotFrameCacheRef.current;
        const cachedImg = cache.get(frame.url);

        if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
            ctx.drawImage(cachedImg, 0, 0, canvas.width, canvas.height);
        } else {
            const img = new Image();
            img.crossOrigin = 'anonymous'; // Enable CORS for S3 presigned URLs
            img.onload = () => {

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                cache.set(frame.url, img);
            };
            img.onerror = (err) => {
                console.error('[SCREENSHOT] Frame load error:', currentFrameIndex, frame.url, err);
            };
            img.src = frame.url;
        }
    }, [playbackMode, screenshotFrames, currentFrameIndex]);

    // Seek to frame by relativeTime (for screenshot mode)
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
        setCurrentPlaybackTime(screenshotFrames[left].relativeTime);
    }, [screenshotFrames]);

    // Seek helper used by timeline and activity interactions
    const handleSeekToTime = useCallback((time: number) => {
        seekToScreenshotFrame(time);
    }, [seekToScreenshotFrame]);

    const formatPlaybackTime = formatPlaybackClock;

    // Progress percentage
    const effectiveDuration = durationSeconds;
    const progressPercent = effectiveDuration > 0 ? (currentPlaybackTime / effectiveDuration) * 100 : 0;

    // ========================================================================
    // EARLY RETURNS (after all hooks)
    // ========================================================================

    // Loading state
    if (isLoading) {
        return <SessionLoadingOverlay />;
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

    // User visit count
    const userIdentifier = session?.deviceId || session?.userId || session?.anonymousId || fullSession?.userId;
    const userSessions = userIdentifier
        ? sessions.filter(s => s.deviceId === userIdentifier || s.userId === userIdentifier || s.anonymousId === userIdentifier)
        : [];
    const totalVisits = userSessions.length;
    const isNewUser = totalVisits <= 1;

    const formatEventTime = (timestamp: number) => {
        const elapsed = Math.max(0, (timestamp - replayBaseTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = Math.floor(elapsed % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Recording availability checks
    const recordingDeleted = (fullSession as any)?.recordingDeleted || session?.recordingDeleted || false;
    const replayPromoted = (fullSession as any)?.replayPromoted || session?.replayPromoted || false;
    const isReplayExpired = (fullSession as any)?.isReplayExpired || session?.isReplayExpired || recordingDeleted;
    // Determine the reason why replay is unavailable (if it is)
    const replayUnavailableReason: 'deleted' | 'not_promoted' | null =
        recordingDeleted ? 'deleted' :
            !replayPromoted ? 'not_promoted' :
                null;
    const playbackDisabled = !hasRecording || isReplayExpired || Boolean(replayUnavailableReason);
    const sortedSessions = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const currentSessionIndex = sortedSessions.findIndex((item) => item.id === id);
    const previousSessionId = currentSessionIndex > 0 ? sortedSessions[currentSessionIndex - 1]?.id : null;
    const nextSessionId = currentSessionIndex >= 0 && currentSessionIndex < sortedSessions.length - 1
        ? sortedSessions[currentSessionIndex + 1]?.id
        : null;

    const activityTabs = [
        {
            id: 'all',
            label: 'All',
            count: allTimelineEvents.filter((event) => !isFeedbackType((event.type || '').toLowerCase())).length,
        },
        {
            id: 'navigation',
            label: 'Navigation',
            count: allTimelineEvents.filter((event) => {
                const type = (event.type || '').toLowerCase();
                return type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background';
            }).length,
        },
        {
            id: 'touches',
            label: 'Touches',
            count: allTimelineEvents.filter((event) => {
                const type = (event.type || '').toLowerCase();
                const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
                return type === 'tap' || type === 'touch' || type === 'gesture' || gestureType.includes('tap');
            }).length,
        },
        { id: 'network', label: 'Network', count: allTimelineEvents.filter((event) => (event.type || '').toLowerCase() === 'network_request').length },
        { id: 'logs', label: 'Logs', count: logEvents.length },
        {
            id: 'issues',
            label: 'Issues',
            count: allTimelineEvents.filter((event) => {
                const type = (event.type || '').toLowerCase();
                const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
                return (
                    type === 'crash' ||
                    type === 'error' ||
                    type === 'anr' ||
                    type === 'rage_tap' ||
                    type === 'dead_tap' ||
                    gestureType === 'rage_tap' ||
                    gestureType === 'dead_tap'
                );
            }).length,
        },
    ];

    // Filter activity feed - also filter out empty/invalid events and apply search
    const filteredActivity = allTimelineEvents.filter((e) => {
        const type = e.type?.toLowerCase() || '';

        if (isFeedbackType(type)) return false;

        // Filter out empty error events that have no useful information
        if (type === 'error') {
            const hasContent = e.name || e.properties?.message || e.properties?.reason || e.properties?.errorMessage;
            if (!hasContent) return false;
        }

        // Filter out network requests with no URL or path to display
        if (type === 'network_request') {
            const hasUrl = e.properties?.url || e.properties?.urlPath;
            if (!hasUrl) return false;
        }

        // Apply activity filter (tabs)
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

        // Apply search filter
        if (activitySearch.trim()) {
            const search = activitySearch.toLowerCase();
            const name = (e.name || '').toLowerCase();
            const target = (e.targetLabel || e.properties?.targetLabel || '').toLowerCase();
            const url = (e.properties?.url || e.properties?.urlPath || '').toLowerCase();
            const props = JSON.stringify(e.properties || {}).toLowerCase();
            const gesture = gestureType.toLowerCase();
            const message = (e.message || e.properties?.message || '').toLowerCase();

            return (
                type.includes(search) ||
                name.includes(search) ||
                target.includes(search) ||
                url.includes(search) ||
                props.includes(search) ||
                gesture.includes(search) ||
                message.includes(search)
            );
        }

        return true;
    });

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

    const downloadSessionLogs = () => {
        if (logEvents.length === 0) return;

        const lines = logEvents.map((event) => {
            const isoTime = new Date(event.timestamp).toISOString();
            const level = getLogLevel(event).toUpperCase();
            const message =
                event.message ||
                event.properties?.message ||
                event.name ||
                JSON.stringify(event.properties || {});
            return `[${isoTime}] [${level}] ${message}`;
        });

        const file = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-${(id || 'unknown').slice(0, 16)}-logs.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const copyVisibleTerminalLogs = async () => {
        if (!visibleTerminalLogText.trim()) return;
        try {
            await navigator.clipboard.writeText(visibleTerminalLogText);
            setTerminalCopied(true);
        } catch {
            setTerminalCopied(false);
        }
    };

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e2e8f0_0%,_#f8fafc_35%,_#f0fdfa_100%)] bg-transparent">
            <div className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <Link
                            to={`${pathPrefix}/sessions`}
                            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
                            aria-label="Back to sessions"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Link>

                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="truncate text-lg font-semibold text-slate-950">Replay Workbench</h1>
                                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-cyan-700">
                                    {platform.toUpperCase()}
                                </span>
                                {appVersion && (
                                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                                        v{appVersion}
                                    </span>
                                )}
                                <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                                    {(id || '').slice(0, 20)}
                                </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
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
                            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${previousSessionId
                                    ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
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
                            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${nextSessionId
                                    ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
                                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                }`}
                        >
                            Next
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            {isNewUser ? 'New Visitor' : `${totalVisits} Visits`}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${sessionRiskStyle.badge}`}>
                            {sessionRiskLabel}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm xl:col-span-7">
                        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-900 px-4 py-3 text-white">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Replay Theater</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                                    <span className="rounded border border-white/20 bg-white/10 px-2 py-1">{screenshotFrames.length} frames</span>
                                    <span className="rounded border border-white/20 bg-white/10 px-2 py-1">{allTimelineEvents.length} events</span>
                                    <span className="rounded border border-white/20 bg-white/10 px-2 py-1">{playbackMode === 'screenshots' ? 'Image Replay' : 'No Visual Replay'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="relative border-b border-slate-200 bg-[linear-gradient(135deg,_rgba(15,23,42,0.03)_0%,_rgba(6,182,212,0.08)_100%)] px-4 py-6 sm:px-6">
                            <div className="mx-auto flex w-full max-w-[420px] items-center justify-center">
                                {(isReplayExpired || replayUnavailableReason || !hasRecording) ? (
                                    <div className="flex aspect-[9/18.5] w-full max-w-[320px] flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-slate-300 bg-white p-6 text-center">
                                        <VideoOff className="h-10 w-10 text-slate-400" />
                                        <p className="mt-3 text-sm font-bold text-slate-900">Replay Not Available</p>
                                        {replayUnavailableReason === 'deleted' ? (
                                            <p className="mt-2 text-xs leading-5 text-slate-600">
                                                Visual media was removed by retention policy, but timeline events, logs, and network traces are still available.
                                            </p>
                                        ) : replayUnavailableReason === 'not_promoted' ? (
                                            <p className="mt-2 text-xs leading-5 text-slate-600">
                                                This session was not promoted for replay capture. You can still inspect all telemetry.
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

                                        <div className="relative w-[320px] max-w-[80vw] rounded-[2.8rem] border border-slate-700 bg-slate-950 p-2 shadow-[0_22px_55px_rgba(15,23,42,0.35)]">
                                            <div className="rounded-[2.3rem] bg-slate-900 p-1.5">
                                                <div
                                                    className="relative overflow-hidden rounded-[2rem] bg-white"
                                                    style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                                                >
                                                    {platform === 'android' ? (
                                                        <div className="pointer-events-none absolute left-1/2 top-3 z-20 h-4 w-4 -translate-x-1/2 rounded-full bg-slate-900" />
                                                    ) : (
                                                        <div className="pointer-events-none absolute left-1/2 top-2 z-20 flex h-6 w-20 -translate-x-1/2 items-center justify-center rounded-full bg-slate-900">
                                                            <div className="mr-2 h-2 w-2 rounded-full bg-slate-700" />
                                                            <div className="h-3 w-3 rounded-full border border-slate-700 bg-slate-800" />
                                                        </div>
                                                    )}

                                                    <canvas
                                                        ref={canvasRef}
                                                        width={deviceWidth}
                                                        height={deviceHeight}
                                                        className="absolute inset-0 h-full w-full bg-slate-100 object-cover"
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

                        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={restart}
                                    onMouseDown={(event) => event.preventDefault()}
                                    disabled={playbackDisabled}
                                    className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${playbackDisabled
                                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
                                        }`}
                                    title="Restart"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => skip(-5)}
                                    onMouseDown={(event) => event.preventDefault()}
                                    disabled={playbackDisabled}
                                    className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${playbackDisabled
                                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
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
                                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                                </button>
                                <button
                                    onClick={() => skip(5)}
                                    onMouseDown={(event) => event.preventDefault()}
                                    disabled={playbackDisabled}
                                    className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${playbackDisabled
                                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
                                        }`}
                                    title="Forward 5s"
                                >
                                    <SkipForward className="h-4 w-4" />
                                </button>

                                <div className="ml-auto flex items-center gap-2">
                                    <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700">
                                        {formatPlaybackTime(currentPlaybackTime)} / {formatPlaybackTime(effectiveDuration)}
                                    </span>

                                    <button
                                        onClick={() => setShowTouchOverlay(!showTouchOverlay)}
                                        onMouseDown={(event) => event.preventDefault()}
                                        className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${showTouchOverlay
                                                ? 'border-cyan-600 bg-cyan-600 text-white'
                                                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
                                            }`}
                                    >
                                        <Hand className="h-3.5 w-3.5" />
                                        Touches
                                    </button>

                                    <div className="relative">
                                        <button
                                            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                                            onMouseDown={(event) => event.preventDefault()}
                                            className="flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
                                        >
                                            {playbackRate}x
                                        </button>

                                        {showSpeedMenu && (
                                            <>
                                                <div className="fixed inset-0 z-40" onClick={() => setShowSpeedMenu(false)} />
                                                <div className="absolute right-0 top-full z-50 mt-2 min-w-[92px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                                                    {[0.5, 1, 1.5, 2, 4].map((rate) => (
                                                        <button
                                                            key={rate}
                                                            onClick={() => {
                                                                setPlaybackRate(rate);
                                                                setShowSpeedMenu(false);
                                                            }}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-xs font-semibold last:border-b-0 ${playbackRate === rate
                                                                    ? 'bg-cyan-50 text-cyan-700'
                                                                    : 'text-slate-700 hover:bg-slate-50'
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

                        <div className="bg-slate-50/90 px-4 py-3 sm:px-6">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />Touches</span>
                                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />API</span>
                                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Issues</span>
                                </div>
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
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
                                className="group relative mt-1 h-8 cursor-pointer"
                                onMouseDown={handleProgressMouseDown}
                            >
                                <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-300" />
                                <div
                                    className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-cyan-600"
                                    style={{ width: `${progressPercent}%` }}
                                />

                                {filteredActivity.map((event, index) => {
                                    const time = (event.timestamp - replayBaseTime) / 1000;
                                    if (time < 0 || durationSeconds <= 0) return null;
                                    const percent = Math.min(100, Math.max(0, (time / durationSeconds) * 100));
                                    const markerKey = `marker-${index}-${event.timestamp}`;
                                    const color = getEventColor(event);
                                    const isFrustration =
                                        event.frustrationKind || event.type === 'rage_tap' || event.gestureType === 'dead_tap';

                                    return (
                                        <div
                                            key={markerKey}
                                            role="button"
                                            tabIndex={0}
                                            className={`absolute top-1/2 -translate-y-1/2 cursor-pointer rounded-full transition ${isFrustration ? 'z-20 h-2.5 w-2.5' : 'z-10 h-2 w-2'
                                                } ${hoveredMarker?.markerKey === markerKey
                                                    ? 'scale-150 shadow-[0_0_0_4px_rgba(15,23,42,0.15)]'
                                                    : 'hover:scale-125'
                                                }`}
                                            style={{ left: `${percent}%`, backgroundColor: color }}
                                            onClick={(eventClick) => {
                                                eventClick.currentTarget.blur();
                                                handleSeekToTime(Math.max(0, time));
                                            }}
                                            onMouseEnter={() => setHoveredMarker({ markerKey, ...event, x: percent })}
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
                                    className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-600 bg-white shadow transition ${isDragging ? 'scale-110' : 'group-hover:scale-105'
                                        }`}
                                    style={{ left: `${progressPercent}%` }}
                                />
                            </div>
                        </div>
                    </section>

                    
                <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm xl:col-span-5 min-h-[580px]">
                        <div className="flex shrink-0 border-b border-slate-200 bg-slate-50">
                            <button
                                onClick={() => setActiveWorkbenchTab('timeline')}
                                className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'timeline' ? 'border-cyan-600 bg-white text-cyan-700 shadow-[0_2px_10px_rgba(0,0,0,0.02)]' : 'border-transparent text-slate-500 hover:bg-slate-100/50 hover:text-slate-700'}`}
                            >
                                <ListFilter className="h-4 w-4" />
                                Timeline
                            </button>
                            <button
                                onClick={() => setActiveWorkbenchTab('console')}
                                className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'console' ? 'border-cyan-600 bg-white text-cyan-700 shadow-[0_2px_10px_rgba(0,0,0,0.02)]' : 'border-transparent text-slate-500 hover:bg-slate-100/50 hover:text-slate-700'}`}
                            >
                                <Terminal className="h-4 w-4" />
                                Console
                            </button>
                            <button
                                onClick={() => setActiveWorkbenchTab('inspector')}
                                className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${activeWorkbenchTab === 'inspector' ? 'border-cyan-600 bg-white text-cyan-700 shadow-[0_2px_10px_rgba(0,0,0,0.02)]' : 'border-transparent text-slate-500 hover:bg-slate-100/50 hover:text-slate-700'}`}
                            >
                                <Code className="h-4 w-4" />
                                DOM
                            </button>
                        </div>
                        <div className="relative flex min-h-0 flex-1 flex-col bg-white">
                            {activeWorkbenchTab === 'timeline' && (
                                <div className="absolute inset-0 flex flex-col">
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Activity Stream</p>
                                    <h3 className="text-sm font-bold text-slate-900">All actions, logs, and failures in one timeline</h3>
                                </div>
                                <button
                                    onClick={downloadSessionLogs}
                                    disabled={logEvents.length === 0}
                                    className={`flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition ${logEvents.length === 0
                                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
                                        }`}
                                    title={logEvents.length > 0 ? 'Download session logs' : 'No logs available'}
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Export logs
                                </button>
                            </div>

                            <div className="mt-3">
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={activitySearch}
                                        onChange={(event) => setActivitySearch(event.target.value)}
                                        placeholder="Search events, targets, messages, or endpoints"
                                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 pr-8 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
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
                                            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${activityFilter === filter.id
                                                    ? 'border-slate-900 bg-slate-900 text-white'
                                                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900'
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

                        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
                            {filteredActivity.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-500">
                                    <AlertTriangle className="h-8 w-8 text-slate-300" />
                                    <p className="mt-2 text-sm font-semibold text-slate-700">No matching events</p>
                                    <p className="mt-1 text-xs">Try a different filter or clear the search query.</p>
                                </div>
                            ) : (
                                filteredActivity.map((event, index) => {
                                    const isNetwork = event.type === 'network_request';
                                    const isLog = isLogEvent(event);
                                    const logLevel = getLogLevel(event);
                                    const color = getEventColor(event);
                                    const Icon = getEventIcon(event);
                                    const timeStr = formatEventTime(event.timestamp);
                                    const seekTime = Math.max(0, (event.timestamp - replayBaseTime) / 1000);
                                    const isHighlighted = Math.abs(seekTime - currentPlaybackTime) < 0.75;
                                    const title = isNetwork
                                        ? `${event.name || event.properties?.method || 'API Request'}`
                                        : isLog
                                            ? `Console ${logLevel}`
                                            : event.type.replace(/_/g, ' ');
                                    const detail = isLog
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
                                            onClick={() => handleSeekToTime(seekTime)}
                                            className={`block w-full border-b border-slate-100 px-3 py-2 text-left transition ${isHighlighted
                                                    ? 'bg-cyan-50 ring-1 ring-inset ring-cyan-200'
                                                    : 'hover:bg-slate-50'
                                                }`}
                                        >
                                            <div className="flex items-start gap-2.5">
                                                <div className="mt-0.5 shrink-0">
                                                    {isNetwork ? (
                                                        <span
                                                            className={`inline-flex rounded border px-1 py-0.5 font-mono text-[9px] font-bold ${event.properties?.success
                                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                                    : 'border-red-200 bg-red-50 text-red-700'
                                                                }`}
                                                        >
                                                            {event.properties?.statusCode || 'ERR'}
                                                        </span>
                                                    ) : isLog ? (
                                                        <span className={`inline-flex rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${getLogBadgeStyles(logLevel)}`}>
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
                                                        <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] font-bold text-slate-500">
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
                                                                        : 'bg-slate-100 text-slate-600'
                                                                }`}
                                                        >
                                                            {event.properties.duration} ms
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                            </div>
                            )}
                            {activeWorkbenchTab === 'console' && (
                                <div className="absolute inset-0 flex flex-col bg-slate-950">
                        <div className="border-b border-slate-800 px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Runtime Console</p>
                                    <h3 className="text-sm font-bold text-white">Logs synced to playback timestamp</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-300">
                                        {terminalVisibleRows.length}/{terminalLogRows.length}
                                    </span>
                                    <button
                                        onClick={copyVisibleTerminalLogs}
                                        disabled={!visibleTerminalLogText.trim()}
                                        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${visibleTerminalLogText.trim()
                                                ? terminalCopied
                                                    ? 'border-emerald-500 bg-emerald-600 text-white'
                                                    : 'border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-400'
                                                : 'cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500'
                                            }`}
                                    >
                                        {terminalCopied ? 'Copied' : 'Copy visible'}
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
                                            <span className={`font-semibold ${getTerminalLevelClass(row.level)}`}>[{row.level.toUpperCase()}]</span>{' '}
                                            <span className="text-slate-100">{row.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                            </div>
                            )}
                            {activeWorkbenchTab === 'inspector' && (
                                <div className="absolute inset-0 flex flex-col bg-slate-50">
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">View Inspector</p>
                            <h3 className="text-sm font-bold text-slate-900">Hierarchy synced with playback</h3>
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
                                <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-5 text-center text-slate-500">
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
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};
export default RecordingDetail;
