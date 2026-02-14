import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import {
  Loader2,
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
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api } from '../../services/api';
import DOMInspector, { HierarchySnapshot } from '../../components/ui/DOMInspector';
import { TouchOverlay, TouchEvent } from '../../components/ui/TouchOverlay';
import { MarkerTooltip } from '../../components/ui/MarkerTooltip';
import { SessionLoadingOverlay } from '../../components/recordings/SessionLoadingOverlay';

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

  // Replay player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.5);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showTouchOverlay, setShowTouchOverlay] = useState(true);
  const [touchEvents, setTouchEvents] = useState<TouchEvent[]>([]);
  const [activitySearch, setActivitySearch] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredMarker, setHoveredMarker] = useState<any>(null);

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
      const data = await api.getSession(id);
      setFullSession(data as any);

      // Log S3 size information for debugging
      const stats = (data as any).stats;
      if (stats) {
        const totalMB = (parseFloat(stats.totalSizeKB || '0') / 1024).toFixed(2);
        const eventsMB = (parseFloat(stats.eventsSizeKB || '0') / 1024).toFixed(2);
        const screenshotMB = (parseFloat(stats.screenshotSizeKB || '0') / 1024).toFixed(2);
        const hierarchyMB = (parseFloat(stats.hierarchySizeKB || '0') / 1024).toFixed(2);
        const networkMB = (parseFloat(stats.networkSizeKB || '0') / 1024).toFixed(2);

        console.log(
          `[SESSION S3 SIZE] Session ${id}: Total=${totalMB}MB ` +
          `(events=${eventsMB}MB, network=${networkMB}MB, hierarchy=${hierarchyMB}MB, screenshots=${screenshotMB}MB)`
        );
      }

      // DEBUG: Log events received from backend to diagnose Android touch overlay issues
      const allEvents = (data as any).events || [];
      const gestureEvents = allEvents.filter((e: any) => e.type === 'touch' || e.type === 'gesture');
      console.log('[SESSION FETCH DEBUG] Total events:', allEvents.length);
      console.log('[SESSION FETCH DEBUG] Gesture/touch events:', gestureEvents.length);
      console.log('[SESSION FETCH DEBUG] Platform:', (data as any).platform, '| Device:', (data as any).deviceInfo);
      console.log('[SESSION FETCH DEBUG] Hierarchy snapshots:', ((data as any).hierarchySnapshots || []).length);

      // DEBUG: Log screenshot frames and playback mode for iOS replay debugging
      console.log('[SESSION FETCH DEBUG] Playback mode:', (data as any).playbackMode);
      console.log('[SESSION FETCH DEBUG] Screenshot frames:', ((data as any).screenshotFrames || []).length);
      if ((data as any).screenshotFrames?.length > 0) {
        console.log('[SESSION FETCH DEBUG] First screenshot frame:', (data as any).screenshotFrames[0]);
      }

      if (gestureEvents.length > 0) {
        console.log('[SESSION FETCH DEBUG] First gesture event:', JSON.stringify(gestureEvents[0], null, 2));
        // Check if touches array exists
        const withTouches = gestureEvents.filter((e: any) => (e.touches?.length > 0 || e.properties?.touches?.length > 0));
        console.log('[SESSION FETCH DEBUG] Gesture events with touches array:', withTouches.length, 'of', gestureEvents.length);
      } else {
        console.log('[SESSION FETCH DEBUG] NO gesture events found! Event types present:', [...new Set(allEvents.map((e: any) => e.type))]);
      }

      // Transform hierarchy snapshots for DOM Inspector
      // Data structure: hierarchySnapshots[].rootElement is an array, rootElement[0] contains { root, screen, screenName }
      if ((data as any).hierarchySnapshots && (data as any).hierarchySnapshots.length > 0) {
        const transformed: HierarchySnapshot[] = (data as any).hierarchySnapshots
          .map((snap: any) => {
            // rootElement can be an array (from S3 JSON) or an object
            const rootData = Array.isArray(snap.rootElement)
              ? snap.rootElement[0]
              : snap.rootElement;

            // Android sends the root node directly, while iOS wraps it in a 'root' property
            // We check for 'root' property first, then 'rootElement' (Android), 
            // then fallback to treating rootData as the root node if it looks like a valid node
            const rootNode = rootData?.root || rootData?.rootElement || (rootData && (rootData.class || rootData.type || rootData.children) ? rootData : null);

            if (!rootNode) {
              return null; // Skip invalid snapshots
            }

            return {
              timestamp: snap.timestamp || rootData.timestamp || 0,
              screen: rootData.screen || {
                width: (data as any).deviceInfo?.screenWidth || 375,
                height: (data as any).deviceInfo?.screenHeight || 812,
                scale: 3
              },
              root: rootNode,
            };
          })
          .filter((snap: any): snap is HierarchySnapshot => snap !== null)
          .sort((a: HierarchySnapshot, b: HierarchySnapshot) => a.timestamp - b.timestamp);

        setHierarchySnapshots(transformed);
      }
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
          responseBodySize: req.responseBodySize,
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

  const startTime = fullSession?.startTime || (session?.startedAt ? new Date(session.startedAt).getTime() : Date.now());
  const replayBaseTime = startTime;

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

    // Log distribution for debugging
    console.log('[DENSITY DEBUG]', {
      durationSeconds,
      bucketSize: bucketSize / 1000,
      touchEventCount: touchEventTimes.length,
      apiEventCount: apiEventTimes.length,
      touchEventTimes: touchEventTimes.slice(0, 10),
      apiEventTimes: apiEventTimes.slice(0, 10),
      touchBucketDistribution: touchBuckets.map((v, i) => v > 0 ? `[${i}]:${v}` : null).filter(Boolean),
      apiBucketDistribution: apiBuckets.map((v, i) => v > 0 ? `[${i}]:${v}` : null).filter(Boolean),
    });

    const maxTouch = Math.max(...touchBuckets, 1);
    const maxApi = Math.max(...apiBuckets, 1);

    return {
      touchDensity: touchBuckets.map(v => v / maxTouch),
      apiDensity: apiBuckets.map(v => v / maxApi),
    };
  }, [allTimelineEvents, durationSeconds, replayBaseTime]);

  // DEBUG: Log timeline calculation values
  useEffect(() => {
    if (fullSession && allTimelineEvents.length > 0) {
      const firstEvent = allTimelineEvents[0];
      const lastEvent = allTimelineEvents[allTimelineEvents.length - 1];
      console.log('[TIMELINE DEBUG]', {
        durationSeconds,
        replayBaseTime,
        startTime: fullSession.startTime,
        endTime: fullSession.endTime,
        statsDuration: fullSession.stats?.duration,
        firstEventTime: firstEvent?.timestamp,
        lastEventTime: lastEvent?.timestamp,
        firstEventRelative: firstEvent ? (firstEvent.timestamp - replayBaseTime) / 1000 : null,
        lastEventRelative: lastEvent ? (lastEvent.timestamp - replayBaseTime) / 1000 : null,
      });
    }
  }, [fullSession, allTimelineEvents, durationSeconds, replayBaseTime]);

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
      console.log('[PLAYBACK] Mode: screenshots (from server)', screenshotFrames.length, 'frames');
      return 'screenshots' as const;
    }
    if (screenshotFrames.length > 0) {
      console.log('[PLAYBACK] Mode: screenshots (auto-detect)', screenshotFrames.length, 'frames');
      return 'screenshots' as const;
    }
    console.log('[PLAYBACK] Mode: none (no recording data)');
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
        console.log(`[TOUCH OVERLAY] Estimated screen size from touch coords: ${estimatedWidth}x${estimatedHeight}`);
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
      console.log('[SCREENSHOT] Initializing playback time to first frame:', firstFrameRelativeTime);
      setCurrentPlaybackTime(Math.max(0, firstFrameRelativeTime));
    }
  }, [playbackMode, screenshotFrames, fullSession?.startTime, currentPlaybackTime, currentFrameIndex]);

  // Preload screenshot frames
  useEffect(() => {
    if (playbackMode !== 'screenshots' || screenshotFrames.length === 0) return;

    const cache = screenshotFrameCacheRef.current;

    // Preload first 20 frames immediately
    const preloadCount = Math.min(20, screenshotFrames.length);
    console.log('[SCREENSHOT] Preloading first', preloadCount, 'frames');
    for (let i = 0; i < preloadCount; i++) {
      const frame = screenshotFrames[i];
      if (!cache.has(frame.url)) {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Enable CORS for S3 presigned URLs
        img.src = frame.url;
        cache.set(frame.url, img);
      }
    }

    // Preload rest in background
    const preloadRest = () => {
      for (let i = preloadCount; i < screenshotFrames.length; i++) {
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
        console.log('[SCREENSHOT] Frame loaded:', currentFrameIndex, 'size:', img.naturalWidth, 'x', img.naturalHeight);
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

  // Format time as MM:SS
  const formatPlaybackTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
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
  const interactionsPerMinute = durationSeconds > 0 ? interactionCount / Math.max(1, durationSeconds / 60) : 0;
  const screensPerMinute = durationSeconds > 0 ? screensVisited.length / Math.max(1, durationSeconds / 60) : 0;

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

  const issueEventTimestamps = allTimelineEvents
    .filter((event) => {
      const type = (event.type || '').toLowerCase();
      const gestureType = (event.gestureType || event.properties?.gestureType || '').toLowerCase();
      if (type === 'crash' || type === 'anr' || type === 'error' || type === 'rage_tap' || type === 'dead_tap') return true;
      if (gestureType === 'rage_tap' || gestureType === 'dead_tap') return true;
      if (type === 'network_request') {
        return !(event.properties?.success ?? (event.properties?.statusCode < 400));
      }
      return false;
    })
    .map((event) => event.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= replayBaseTime);

  const firstIssueTimestamp = issueEventTimestamps.length > 0 ? Math.min(...issueEventTimestamps) : null;
  const timeToFirstIssueMs = firstIssueTimestamp !== null ? Math.max(0, firstIssueTimestamp - replayBaseTime) : null;

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
    return sum + (request.requestBodySize || 0) + (request.responseBodySize || 0);
  }, 0);

  const stabilityScore = Math.max(
    0,
    Math.min(
      100,
      100 - (
        issueSignalsPerMinute * 20 +
        apiErrorRate * 1.1 +
        Math.max(0, (apiP95LatencyMs - 400) / 35)
      )
    )
  );

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

  // Filter activity feed - also filter out empty/invalid events and apply search
  const filteredActivity = allTimelineEvents.filter((e) => {
    const type = e.type?.toLowerCase() || '';

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
    } else if (activityFilter === 'issues') {
      matchesFilter = type === 'crash' || type === 'error' || type === 'anr' || type === 'rage_tap' || type === 'dead_tap' || gestureType === 'rage_tap' || gestureType === 'dead_tap';
    } else if (activityFilter === 'dead_taps') {
      matchesFilter = type === 'dead_tap' || gestureType === 'dead_tap' || e.frustrationKind === 'dead_tap';
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

      return (
        type.includes(search) ||
        name.includes(search) ||
        target.includes(search) ||
        url.includes(search) ||
        props.includes(search) ||
        gesture.includes(search)
      );
    }

    return true;
  });

  const HighlightedText: React.FC<{ text: string; search: string }> = ({ text, search }) => {
    if (!search.trim() || !text) return <>{text}</>;
    const parts = text.split(new RegExp(`(${search})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === search.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 text-black px-0.5 rounded-sm">{part}</mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Back + Session Info */}
            <div className="flex items-center gap-4">
              <Link
                to={`${pathPrefix}/sessions`}
                className="w-9 h-9 flex items-center justify-center rounded-full border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-slate-600" />
              </Link>

              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-lg font-bold text-slate-900">
                    Session {(id || '').substring(0, 13)}...
                  </h1>
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-100 text-slate-600 rounded border border-slate-200">
                    {platform.toUpperCase()}
                  </span>
                  {appVersion && (
                    <span className="text-sm font-medium text-slate-600">v{appVersion}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(startTime).toLocaleString()}</span>
                  </div>
                  <span className="text-slate-300">•</span>
                  <span>{durationMinutes}m {durationSecs}s</span>
                  <span className="text-slate-300">•</span>
                  <span>{deviceModel}</span>
                </div>
              </div>
            </div>

            {/* Right: Badges */}
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-full border border-slate-200">
                {isNewUser ? 'New User' : `Returning User (${totalVisits} visits)`}
              </span>

              {screensVisited.length > 0 && (
                <span className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white rounded-full border-2 border-slate-300">
                  {screensVisited.length} Screens
                </span>
              )}

              {networkRequests.length > 0 && (
                <span className="px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-full border-2 border-amber-200">
                  {networkRequests.length} API Calls
                </span>
              )}

              {rageTapCount > 0 && (
                <span className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 rounded-full border-2 border-red-200">
                  {rageTapCount} Rage Taps
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inferred Session Metrics */}
      <div className="max-w-[1920px] mx-auto px-4 pt-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="flex flex-col gap-1.5 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Session Insights (Inferred)</h2>
              <p className="text-xs text-slate-500">
                Computed directly from this replay&apos;s events, network requests, crashes, and ANRs.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              Better triage: understand reliability, responsiveness, and user friction at a glance.
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Stability Score</span>
                <AlertCircle className="w-3.5 h-3.5" />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${stabilityScore < 60 ? 'text-red-600' : stabilityScore < 80 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {stabilityScore.toFixed(0)}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Blend of issue intensity, API failure rate, and p95 latency.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>API Error Rate</span>
                <Globe className="w-3.5 h-3.5" />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${apiErrorRate > 8 ? 'text-red-600' : apiErrorRate > 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {apiErrorRate.toFixed(1)}%
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {failedRequestCount.toLocaleString()} failed of {networkRequests.length.toLocaleString()} requests.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>API p95 Latency</span>
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${apiP95LatencyMs > 1000 ? 'text-red-600' : apiP95LatencyMs > 500 ? 'text-amber-600' : 'text-slate-900'}`}>
                {apiP95LatencyMs > 0 ? `${Math.round(apiP95LatencyMs)} ms` : 'N/A'}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Latency experienced by the slowest 5% of API calls.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Time To First Issue</span>
                <AlertTriangle className="w-3.5 h-3.5" />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${timeToFirstIssueMs !== null && timeToFirstIssueMs < 10000 ? 'text-red-600' : 'text-slate-900'}`}>
                {timeToFirstIssueMs === null ? 'No issue' : formatPlaybackTime(timeToFirstIssueMs / 1000)}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Time from replay start to first failure signal or API error.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Interaction Rate</span>
                <MousePointer2 className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{interactionsPerMinute.toFixed(1)}/min</div>
              <p className="mt-1 text-[11px] text-slate-500">
                {interactionCount.toLocaleString()} touches, scrolls, and gestures captured.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Screen Pace</span>
                <Monitor className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{screensPerMinute.toFixed(2)}/min</div>
              <p className="mt-1 text-[11px] text-slate-500">{screensVisited.length.toLocaleString()} unique screens visited.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Startup Latency</span>
                <Smartphone className="w-3.5 h-3.5" />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${inferredStartupMs !== null && inferredStartupMs > 2000 ? 'text-amber-600' : 'text-slate-900'}`}>
                {inferredStartupMs !== null ? `${Math.round(inferredStartupMs)} ms` : 'N/A'}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">App startup metric or first meaningful interaction fallback.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Network Payload</span>
                <Layers className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{formatBytesToHuman(totalPayloadBytes)}</div>
              <p className="mt-1 text-[11px] text-slate-500">Approximate request + response bytes in this replay.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left Column: Session Activity */}
          <div className="lg:col-span-3 order-2 lg:order-1">
            <div className="bg-white border border-slate-200 shadow-sm h-[750px] flex flex-col overflow-hidden rounded-xl">
              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-200 flex-shrink-0 bg-slate-50/70">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm text-slate-900">
                    Session Activity
                  </h3>
                  <button
                    onClick={() => {
                      setIsSearching(!isSearching);
                      if (isSearching) setActivitySearch('');
                    }}
                    className={`p-1 rounded transition-colors ${isSearching ? 'bg-slate-900 text-white' : 'hover:bg-slate-200 text-slate-500'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                </div>

                {isSearching && (
                  <div className="mb-3 relative">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search events, labels, values..."
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 placeholder:text-slate-400"
                      value={activitySearch}
                      onChange={(e) => setActivitySearch(e.target.value)}
                    />
                    {activitySearch && (
                      <button
                        onClick={() => setActivitySearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-black"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}

                {/* Filter Tabs */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'navigation', label: 'Nav' },
                    { id: 'touches', label: 'Taps' },
                    { id: 'network', label: 'API' },
                    { id: 'dead_taps', label: 'Dead' },
                    { id: 'issues', label: 'Issues' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setActivityFilter(filter.id)}
                      className={`
                        px-2 py-1 text-[11px] font-medium rounded-md border transition-colors
                        ${activityFilter === filter.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }
                      `}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Activity Feed */}
              <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50/50">
                {filteredActivity.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                    <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-xs font-medium">No activity found</span>
                  </div>
                ) : (
                  <div>
                    {filteredActivity.map((event, i) => {
                      const isNetwork = event.type === 'network_request';
                      const color = getEventColor(event);
                      const Icon = getEventIcon(event);
                      const timeStr = formatEventTime(event.timestamp);
                      const isHighlighted = Math.abs((event.timestamp - replayBaseTime) / 1000 - currentPlaybackTime) < 1;

                      return (
                        <div
                          key={i}
                          className={`
                            group px-3 py-2 border-b border-slate-100 hover:bg-white transition-all cursor-pointer
                            ${isHighlighted ? 'bg-amber-50 border-l-4 border-l-amber-500' : 'border-l-4 border-l-transparent hover:border-l-slate-400'}
                          `}
                          onClick={() => handleSeekToTime(Math.max(0, (event.timestamp - replayBaseTime) / 1000))}
                        >
                          <div className="flex items-start gap-2">
                            {/* Icon */}
                            <div className="mt-0.5 flex-shrink-0">
                              {isNetwork ? (
                                <div
                                  className={`
                                    px-1 py-0.5 text-[8px] font-semibold font-mono rounded border
                                    ${event.properties?.success ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}
                                  `}
                                >
                                  {event.properties?.statusCode || 'ERR'}
                                </div>
                              ) : (
                                <div
                                  className="w-4 h-4 rounded flex items-center justify-center border border-slate-200"
                                  style={{ backgroundColor: color }}
                                >
                                  <Icon className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-semibold text-slate-700">
                                  {isNetwork
                                    ? event.name
                                    : (event.type === 'gesture' || event.type === 'touch')
                                      ? (event.gestureType || event.properties?.gestureType || event.type).replace(/_/g, ' ')
                                      : event.type.replace(/_/g, ' ')}
                                </span>
                                {(event.frustrationKind === 'dead_tap' || event.gestureType === 'dead_tap') && (
                                  <span className="text-[9px] font-medium px-1 py-0.5 bg-stone-100 text-stone-700 border border-stone-300 rounded">Dead Tap</span>
                                )}
                                <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-100 px-1 py-0.5 border border-slate-200">
                                  {timeStr}
                                </span>
                              </div>

                              <div className="mt-1 flex flex-col gap-0.5">
                                <div className="text-xs font-medium text-slate-800 break-words leading-tight">
                                  <HighlightedText
                                    text={event.targetLabel || event.properties?.targetLabel || event.name || (event as any).screen || (event.gestureType && event.type === 'gesture' ? event.gestureType.replace(/_/g, ' ') : event.type)}
                                    search={activitySearch}
                                  />
                                </div>
                                {isNetwork && (
                                  <div className="text-[10px] font-bold text-slate-500 break-all font-mono leading-tight">
                                    <HighlightedText text={(event.properties?.urlPath || event.properties?.url || '').substring(0, 80)} search={activitySearch} />
                                  </div>
                                )}
                              </div>

                              {typeof event.properties?.duration === 'number' && event.properties.duration > 0 && (
                                <span className={`
                                      inline-block text-[9px] font-bold font-mono px-1 py-0.5 rounded
                                      ${event.properties.duration > 1000
                                    ? 'bg-red-100 text-red-700'
                                    : event.properties.duration > 500
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }
                                    `}>
                                  {event.properties.duration}ms
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Center Column: Replay Player */}
          <div className="lg:col-span-5 order-1 lg:order-2">
            <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
              {/* Replay Area */}
              <div className="relative flex items-center justify-center py-6 px-4 bg-slate-50">
                {/* Navigation Arrow - Left (Previous Session) */}
                {sessions.length > 1 && (
                  <button
                    onClick={() => {
                      const sortedSessions = [...sessions].sort((a, b) =>
                        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
                      );
                      const idx = sortedSessions.findIndex((s) => s.id === id);
                      if (idx > 0) {
                        navigate(`${pathPrefix}/sessions/${sortedSessions[idx - 1].id}`);
                      }
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute left-4 z-10 w-10 h-10 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-center text-slate-800 transition-colors shadow-sm"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}

                {(isReplayExpired || replayUnavailableReason) ? (
                  <div className="w-[280px] aspect-[9/19.5] flex flex-col items-center justify-center text-slate-400 bg-slate-100 rounded-[2rem] px-4">
                    <VideoOff className="w-12 h-12 mb-3 opacity-40" />
                    <p className="font-semibold text-sm text-center">Replay Unavailable</p>
                    {replayUnavailableReason === 'deleted' ? (
                      <>
                        <p className="text-xs text-slate-400 mt-1 text-center">
                          Replay media was automatically deleted after the retention period
                        </p>
                        <p className="text-[10px] text-slate-300 mt-2 text-center">
                          Session data (events, timeline, network) is still available below
                        </p>
                      </>
                    ) : replayUnavailableReason === 'not_promoted' ? (
                      <>
                        <p className="text-xs text-slate-400 mt-1 text-center">
                          No replay was captured for this session
                        </p>
                        <p className="text-[10px] text-slate-300 mt-2 text-center">
                          Only high-value sessions (crashes, errors, rage taps) keep replay media
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1 text-center">Recording has expired</p>
                    )}
                  </div>
                ) : hasRecording ? (
                  <div className="relative">
                    {/* Playback Mode Indicator */}
                    <div className="absolute -top-6 left-0 right-0 flex justify-center z-10">
                      <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-800/80 rounded text-[10px] text-white/80">
                        <ImageIcon className="w-3 h-3" />
                        <span>{screenshotFrames.length} frames</span>
                      </div>
                    </div>

                    {/* Phone Body */}
                    <div
                      className="relative bg-slate-900 rounded-[2.5rem] p-[3px] shadow-xl"
                      style={{ width: '280px' }}
                    >
                      <div className="bg-slate-800 rounded-[2.3rem] p-1">
                        <div
                          className="relative bg-white rounded-[2rem] overflow-hidden"
                          style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                        >
                          {/* Device Camera/Notch */}
                          {platform === 'android' ? (
                            // Android Pinhole Camera
                            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-4 h-4 bg-black rounded-full z-20" />
                          ) : (
                            // iOS Dynamic Island
                            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-6 bg-black rounded-full z-20 flex items-center justify-center">
                              <div className="w-2 h-2 bg-slate-700 rounded-full mr-2" />
                              <div className="w-3 h-3 bg-slate-800 rounded-full ring-1 ring-slate-700" />
                            </div>
                          )}

                          <canvas
                            ref={canvasRef}
                            width={deviceWidth}
                            height={deviceHeight}
                            className="absolute inset-0 w-full h-full object-cover bg-slate-100"
                          />

                          {/* Enhanced Touch Overlay */}
                          {showTouchOverlay && (
                            <TouchOverlay
                              events={touchEvents}
                              deviceWidth={deviceWidth}
                              deviceHeight={deviceHeight}
                              currentTime={(fullSession?.startTime || 0) + currentPlaybackTime * 1000}
                              visibleWindowMs={800}
                            />
                          )}

                          {/* Home Indicator */}
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 bg-black/30 rounded-full z-20" />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-[280px] aspect-[9/19.5] flex flex-col items-center justify-center text-slate-400 bg-slate-100 rounded-[2rem]">
                    <VideoOff className="w-12 h-12 mb-3 opacity-40" />
                    <p className="font-semibold text-sm">No Recording</p>
                    <p className="text-xs text-slate-400 mt-1">Analytics available below</p>
                  </div>
                )}

                {/* Navigation Arrow - Right (Next Session) */}
                {sessions.length > 1 && (
                  <button
                    onClick={() => {
                      const sortedSessions = [...sessions].sort((a, b) =>
                        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
                      );
                      const idx = sortedSessions.findIndex((s) => s.id === id);
                      if (idx < sortedSessions.length - 1) {
                        navigate(`${pathPrefix}/sessions/${sortedSessions[idx + 1].id}`);
                      }
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute right-4 z-10 w-10 h-10 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-center text-slate-800 transition-colors shadow-sm"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Unified Timeline */}
              <div className="border-t border-slate-200 bg-white">
                {/* Timeline Header */}
                <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200 bg-slate-50/80">
                  <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full"></div>
                      <span>Touches</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></div>
                      <span>API</span>
                    </div>
                    {(fullSession?.crashes?.length || 0) > 0 && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
                        <span>Crash</span>
                      </div>
                    )}
                  </div>

                  {/* Touch Overlay Toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowTouchOverlay(!showTouchOverlay)}
                      onMouseDown={(e) => e.preventDefault()}
                      className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase border rounded-md transition-colors ${showTouchOverlay
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      title="Toggle touch indicators"
                    >
                      <Hand className="w-3.5 h-3.5" />
                      <span>Touches</span>
                    </button>
                  </div>
                </div>

                {/* Density Visualization */}
                <div className="px-4 pt-3">
                  <svg viewBox="0 0 1000 50" preserveAspectRatio="none" className="w-full h-12">
                    <defs>
                      <linearGradient id="touchGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
                      </linearGradient>
                      <linearGradient id="apiGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>

                    {/* Touch Area */}
                    {densityData.touchDensity.length > 0 && (
                      <>
                        <path
                          fill="url(#touchGradLight)"
                          d={`M0,48 ${densityData.touchDensity.map((v, i) => {
                            const x = (i / (densityData.touchDensity.length - 1)) * 1000;
                            const y = 45 - v * 40;
                            return `L${x},${y}`;
                          }).join(' ')} L1000,48 Z`}
                        />
                        <polyline
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={densityData.touchDensity.map((v, i) => {
                            const x = (i / (densityData.touchDensity.length - 1)) * 1000;
                            const y = 45 - v * 40;
                            return `${x},${y}`;
                          }).join(' ')}
                        />
                      </>
                    )}

                    {/* API Area */}
                    {densityData.apiDensity.length > 0 && (
                      <>
                        <path
                          fill="url(#apiGradLight)"
                          d={`M0,48 ${densityData.apiDensity.map((v, i) => {
                            const x = (i / (densityData.apiDensity.length - 1)) * 1000;
                            const y = 45 - v * 40;
                            return `L${x},${y}`;
                          }).join(' ')} L1000,48 Z`}
                        />
                        <polyline
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={densityData.apiDensity.map((v, i) => {
                            const x = (i / (densityData.apiDensity.length - 1)) * 1000;
                            const y = 45 - v * 40;
                            return `${x},${y}`;
                          }).join(' ')}
                        />
                      </>
                    )}
                  </svg>
                </div>

                {/* Progress Bar with Event Markers */}
                <div
                  ref={progressRef}
                  className="relative h-6 mx-4 cursor-pointer group"
                  onMouseDown={handleProgressMouseDown}
                >
                  {/* Track */}
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 bg-slate-200 rounded-full">
                    {/* Progress Fill */}
                    <div
                      className="absolute h-full bg-blue-500 rounded-full transition-all duration-75"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>

                  {/* Activity Markers (mirrors Session Activity list) */}
                  {filteredActivity.map((event, i) => {
                    const time = (event.timestamp - replayBaseTime) / 1000;
                    if (time < 0 || durationSeconds <= 0) return null;
                    const percent = Math.min(100, Math.max(0, (time / durationSeconds) * 100));
                    const color = getEventColor(event);
                    const isFrustration = event.frustrationKind || event.type === 'rage_tap' || event.gestureType === 'dead_tap';
                    const isNetwork = event.type === 'network_request';
                    const eventLabel = isNetwork
                      ? `${event.name || 'API'} ${event.properties?.urlPath || event.properties?.url || ''}`.trim()
                      : (event.type === 'gesture' || event.type === 'touch')
                        ? (event.gestureType || event.properties?.gestureType || event.type).replace(/_/g, ' ')
                        : event.type.replace(/_/g, ' ');
                    const tooltipText = `${eventLabel} • ${formatEventTime(event.timestamp)}`;

                    return (
                      <div
                        key={`a-${i}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          handleSeekToTime(Math.max(0, time));
                        }}
                        onMouseEnter={() => setHoveredMarker({ ...event, x: percent })}
                        onMouseLeave={() => setHoveredMarker(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSeekToTime(Math.max(0, time));
                          }
                        }}
                        className={`absolute rounded-full transition-all group/marker focus:outline-none focus:ring-2 focus:ring-black/30 cursor-pointer ${isFrustration ? 'w-2 h-2 z-20' : 'w-1.5 h-1.5 z-10'
                          } ${hoveredMarker === event ? 'scale-[2] shadow-[0_0_10px_rgba(0,0,0,0.5)]' : 'hover:scale-150'}`}
                        style={{
                          left: `${percent}%`,
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: color,
                        }}
                        aria-label={tooltipText}
                      />
                    );
                  })}

                  {/* Enhanced Tooltip Integration */}
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

                  {/* Scrubber Handle */}
                  <div
                    className="absolute w-4 h-4 bg-white rounded-full shadow-md border-2 border-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      left: `${progressPercent}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                </div>

                {/* Controls Bar */}
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/80">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={restart}
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-300 rounded-md transition-colors"
                      title="Restart"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => skip(-5)}
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-300 rounded-md transition-colors"
                      title="Back 5s"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    <button
                      onClick={togglePlayPause}
                      onMouseDown={(e) => e.preventDefault()}
                      className={`w-12 h-12 border rounded-full flex items-center justify-center transition-colors shadow-sm ${isPlaying ? 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                        }`}
                      disabled={!hasRecording || isReplayExpired || Boolean(replayUnavailableReason)}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5" />
                      ) : (
                        <Play className="w-5 h-5 ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={() => skip(5)}
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-300 rounded-md transition-colors"
                      title="Forward 5s"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>

                    {/* Time Display */}
                    <span className="text-sm font-mono font-semibold text-slate-800 tabular-nums ml-2 bg-white px-2 py-1 border border-slate-300 rounded">
                      {formatPlaybackTime(currentPlaybackTime)} / {formatPlaybackTime(effectiveDuration)}
                    </span>

                    {/* Speed Control */}
                    <div className="relative ml-2">
                      <button
                        onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                        onMouseDown={(e) => e.preventDefault()}
                        className="px-2 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors"
                      >
                        {playbackRate}x
                      </button>

                      {showSpeedMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setShowSpeedMenu(false)}
                          />
                          <div className="absolute bottom-full right-0 mb-2 bg-white border border-slate-200 shadow-lg rounded-lg overflow-hidden z-50 min-w-[80px]">
                            {[0.5, 1, 1.5, 2, 4].map((rate) => (
                              <button
                                key={rate}
                                onClick={() => {
                                  setPlaybackRate(rate);
                                  setShowSpeedMenu(false);
                                }}
                                onMouseDown={(e) => e.preventDefault()}
                                className={`w-full px-3 py-2 text-xs font-medium text-left transition-colors border-b border-slate-100 last:border-b-0 ${playbackRate === rate
                                  ? 'bg-blue-50 text-blue-700'
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

            </div>
          </div>

          {/* Right Column: DOM Inspector */}
          <div className="lg:col-span-4 order-3">
            <div className="bg-white border border-slate-200 shadow-sm h-[750px] max-h-[80vh] rounded-xl overflow-hidden flex flex-col">
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
                <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50">
                  <Layers className="w-12 h-12 mb-4 opacity-30" />
                  <p className="font-bold text-sm">No View Hierarchy</p>
                  <p className="text-xs mt-2 text-center px-8">
                    View hierarchy data will appear here when available.
                    <br />
                    It is captured on-demand to optimize performance.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div >
  );
};

export default RecordingDetail;
