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
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api } from '../../services/api';
import DOMInspector, { HierarchySnapshot } from '../../components/ui/DOMInspector';
import { TouchOverlay, TouchEvent } from '../../components/ui/TouchOverlay';

// ============================================================================
// Types
// ============================================================================

interface VideoSegment {
  url: string;
  startTime: number;
  endTime: number | null;
  frameCount: number | null;
}

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
  videoSegments?: {
    url: string;
    startTime: number;
    endTime: number | null;
    frameCount: number | null;
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
    videoSizeKB?: string;
    videoSegmentCount?: number;
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
  rageTap: '#dc2626',
  crash: '#b91c1c',
  anr: '#a855f7',
  apiSuccess: '#22c55e',
  tap: '#3b82f6',
  scroll: '#5dadec',
  gesture: '#10b981',
  swipe: '#06b6d4',
  pinch: '#14b8a6',
  pan: '#8b5cf6',
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
  if (type === 'rage_tap' || event.frustrationKind) return Zap;
  if (gestureType.includes('tap') || type === 'tap' || type === 'touch') return Hand;
  if (gestureType.includes('scroll') || type === 'scroll') return MousePointer2;

  return Monitor;
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

  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.5);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showTouchOverlay, setShowTouchOverlay] = useState(true);
  const [touchEvents, setTouchEvents] = useState<TouchEvent[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // DOM Inspector state
  const [hierarchySnapshots, setHierarchySnapshots] = useState<HierarchySnapshot[]>([]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);

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
        const videoMB = (parseFloat(stats.videoSizeKB || '0') / 1024).toFixed(2);
        const hierarchyMB = (parseFloat(stats.hierarchySizeKB || '0') / 1024).toFixed(2);
        const networkMB = (parseFloat(stats.networkSizeKB || '0') / 1024).toFixed(2);

        console.log(
          `[SESSION S3 SIZE] Session ${id}: Total=${totalMB}MB ` +
          `(events=${eventsMB}MB, network=${networkMB}MB, hierarchy=${hierarchyMB}MB, video=${videoMB}MB)`
        );
      }

      // DEBUG: Log events received from backend to diagnose Android touch overlay issues
      const allEvents = (data as any).events || [];
      const gestureEvents = allEvents.filter((e: any) => e.type === 'touch' || e.type === 'gesture');
      console.log('[SESSION FETCH DEBUG] Total events:', allEvents.length);
      console.log('[SESSION FETCH DEBUG] Gesture/touch events:', gestureEvents.length);
      console.log('[SESSION FETCH DEBUG] Platform:', (data as any).platform, '| Device:', (data as any).deviceInfo);
      console.log('[SESSION FETCH DEBUG] Hierarchy snapshots:', ((data as any).hierarchySnapshots || []).length);
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
          .filter((snap: any): snap is HierarchySnapshot => snap !== null);

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

  // Detect rage taps - placed before handleTimeUpdate so it can be used in touch overlay
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

  // Handle playback time updates
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || isDragging || isSeeking || !fullSession?.videoSegments) return;

    const segments = fullSession.videoSegments;
    const segment = segments[activeSegmentIndex];
    if (!segment) return;

    const sessionStartTime = fullSession.startTime;
    const segmentStartRelative = (segment.startTime - sessionStartTime) / 1000;
    const newTime = segmentStartRelative + videoRef.current.currentTime;

    setCurrentPlaybackTime(newTime);

    // Update touch overlay - process events for enhanced visualization
    if (showTouchOverlay) {
      const currentAbsoluteTime = sessionStartTime + newTime * 1000;

      // DEBUG: Log all gesture events to diagnose Android touch overlay issues
      const allGestureEvents = (fullSession.events || []).filter((e) =>
        e.type === 'touch' || e.type === 'gesture'
      );

      // Log once per video playback start (when newTime is near 0)
      if (newTime < 0.5 && allGestureEvents.length > 0) {
        console.log('[TOUCH OVERLAY DEBUG] Total gesture events:', allGestureEvents.length);
        console.log('[TOUCH OVERLAY DEBUG] First gesture event:', JSON.stringify(allGestureEvents[0], null, 2));
        console.log('[TOUCH OVERLAY DEBUG] Device dimensions:', {
          screenWidth: fullSession.deviceInfo?.screenWidth,
          screenHeight: fullSession.deviceInfo?.screenHeight,
        });

        // Count events with/without touches array
        const withTouches = allGestureEvents.filter(e => {
          const rawArr = e.touches ?? e.properties?.touches ?? [];
          const arr = Array.isArray(rawArr) ? rawArr : [];
          return arr.length > 0;
        });
        console.log('[TOUCH OVERLAY DEBUG] Events with touches array:', withTouches.length, 'of', allGestureEvents.length);
        if (withTouches.length > 0) {
          console.log('[TOUCH OVERLAY DEBUG] First event with touches:', JSON.stringify(withTouches[0], null, 2));
        }
      }

      const recentTouchEvents = (fullSession.events || [])
        .filter((e) => {
          const eventTime = e.timestamp;
          const timeDiff = currentAbsoluteTime - eventTime;
          const isGestureEvent = e.type === 'touch' || e.type === 'gesture';
          const rawTouchesArr = e.touches ?? e.properties?.touches ?? [];
          const touchesArr = Array.isArray(rawTouchesArr) ? rawTouchesArr : [];
          return isGestureEvent && touchesArr.length > 0 && timeDiff >= 0 && timeDiff < 1000;
        })
        .map((e) => {
          const rawTouchArray = e.touches || e.properties?.touches || [];
          // Defensive check: ensure touchArray is actually an array (Android may sometimes send non-array)
          const touchArray = Array.isArray(rawTouchArray) ? rawTouchArray : [];
          let gestureType = e.gestureType || e.properties?.gestureType || 'tap';
          const props = e.properties || {};

          // Check if this event is part of a detected rage tap sequence
          // Use the same detection logic as the timeline (detectedRageTaps)
          const isRageTapEvent = detectedRageTaps.some(rt =>
            Math.abs(rt.timestamp - e.timestamp) < 100 // Within 100ms
          );
          if (isRageTapEvent && gestureType.includes('tap')) {
            gestureType = 'rage_tap';
          }


          // ========================================================================
          // Platform Coordinate Handling (React Native iOS vs Android)
          // ========================================================================
          // Both platforms now send coordinates in density-independent pixels:
          //   - iOS (RN): Uses native UIKit points (already density-independent)
          //   - Android (RN): Touch coords from TouchInterceptor are normalized to dp
          //                   (raw pixels / displayDensity), and screenWidth/Height
          //                   are also sent in dp units from UploadManager.
          //
          // This means the coordinate system is unified across platforms:
          //   touch.x / deviceWidth * 100 = correct percentage position
          // ========================================================================
          const screenWidth = fullSession.deviceInfo?.screenWidth || 375;
          const screenHeight = fullSession.deviceInfo?.screenHeight || 812;

          // Filter valid touches
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
    } else {
      setTouchEvents([]);
    }
  }, [fullSession, activeSegmentIndex, showTouchOverlay, isDragging, detectedRageTaps]);

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

  // Note: detectedRageTaps is now defined earlier (before handleTimeUpdate)
  // for use in the touch overlay. This reference is kept for the timeline.

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
  // 2. Otherwise, calculate from video segments, session end, or events
  const durationSeconds = useMemo(() => {
    // If backend provided playable duration, use it - this is the most accurate
    if (fullSession?.playableDuration && fullSession.playableDuration > 0) {
      return fullSession.playableDuration;
    }

    const sessionStart = fullSession?.startTime || 0;
    if (!sessionStart) return session?.durationSeconds || 0;

    // Collect all possible end times
    const candidates: number[] = [];

    // Video segment end time - use actual video content bounds
    if (fullSession?.videoSegments && fullSession.videoSegments.length > 0) {
      const firstSegment = fullSession.videoSegments[0];
      const lastSegment = fullSession.videoSegments[fullSession.videoSegments.length - 1];
      const firstSegmentStart = firstSegment.startTime;
      const segmentEndTime = lastSegment.endTime || lastSegment.startTime;
      // Use video content span, not wall clock time
      if (segmentEndTime > firstSegmentStart) {
        candidates.push((segmentEndTime - firstSegmentStart) / 1000);
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

    allTimelineEvents.forEach((e) => {
      const elapsed = e.timestamp - replayBaseTime;
      const idx = Math.min(Math.floor(elapsed / bucketSize), bucketCount - 1);
      if (idx < 0) return;

      const type = e.type?.toLowerCase() || '';
      const gestureType = (e.gestureType || e.properties?.gestureType || '').toLowerCase();

      if (type === 'network_request') {
        apiBuckets[idx]++;
      } else if (
        type === 'gesture' || type === 'tap' || type === 'touch' || type === 'scroll' ||
        gestureType.includes('tap') || gestureType.includes('scroll')
      ) {
        touchBuckets[idx]++;
      }
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
        videoSegments: fullSession.videoSegments?.map(s => ({
          startTime: s.startTime,
          endTime: s.endTime,
          startRelative: (s.startTime - (fullSession.startTime || 0)) / 1000,
          endRelative: s.endTime ? (s.endTime - (fullSession.startTime || 0)) / 1000 : null,
        })),
      });
    }
  }, [fullSession, allTimelineEvents, durationSeconds, replayBaseTime]);

  // Video segments
  const segments = useMemo(() => fullSession?.videoSegments || [], [fullSession?.videoSegments]);

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

  // Find segment for time
  const findSegmentForTime = useCallback(
    (time: number) => {
      if (!fullSession?.videoSegments) return 0;
      const absoluteTime = (fullSession.startTime || 0) + time * 1000;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentEnd = segment.endTime || fullSession.endTime || segment.startTime + 60000;
        if (absoluteTime >= segment.startTime && absoluteTime <= segmentEnd) {
          return i;
        }
      }
      return 0;
    },
    [segments, fullSession]
  );

  // Seek to time
  const seekToTime = useCallback(
    (time: number) => {
      if (!fullSession?.videoSegments || segments.length === 0) return;

      const clampedTime = Math.max(0, Math.min(time, durationSeconds));
      const segmentIndex = findSegmentForTime(clampedTime);
      const segment = segments[segmentIndex];

      if (!segment) return;

      const segmentStartRelative = (segment.startTime - (fullSession.startTime || 0)) / 1000;
      const timeWithinSegment = clampedTime - segmentStartRelative;

      if (segmentIndex !== activeSegmentIndex) {
        pendingSeekTimeRef.current = Math.max(0, timeWithinSegment);
        setActiveSegmentIndex(segmentIndex);
      } else if (videoRef.current) {
        setIsSeeking(true);
        videoRef.current.currentTime = Math.max(0, timeWithinSegment);
      }

      setCurrentPlaybackTime(clampedTime);
    },
    [segments, fullSession, activeSegmentIndex, findSegmentForTime, durationSeconds]
  );

  // Handle progress click/drag
  const handleProgressInteraction = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (!progressRef.current) return;

      const rect = progressRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = percent * durationSeconds;
      seekToTime(newTime);
    },
    [durationSeconds, seekToTime]
  );

  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setIsDragging(true);
      handleProgressInteraction(e);

      const handleMouseMove = (ev: MouseEvent) => handleProgressInteraction(ev);
      const handleMouseUp = () => {
        setIsDragging(false);
        setIsSeeking(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [handleProgressInteraction]
  );

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  // Skip
  const skip = useCallback(
    (seconds: number) => {
      seekToTime(currentPlaybackTime + seconds);
    },
    [currentPlaybackTime, seekToTime]
  );

  // Restart
  const restart = useCallback(() => {
    seekToTime(0);
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  }, [seekToTime]);

  // Handle segment end
  const handleSegmentEnd = useCallback(() => {
    if (activeSegmentIndex < segments.length - 1) {
      setActiveSegmentIndex(activeSegmentIndex + 1);
    } else {
      setIsPlaying(false);
    }
  }, [activeSegmentIndex, segments.length]);

  // Effect: Update video source
  useEffect(() => {
    if (videoRef.current && segments[activeSegmentIndex]) {
      const segment = segments[activeSegmentIndex];
      const newUrl = segment.url;

      // Check if URL is effectively the same to avoid reload
      const currentSrc = videoRef.current.currentSrc || videoRef.current.src;
      if (currentSrc && currentSrc.includes(newUrl)) {
        return;
      }

      const wasPlaying = isPlaying;
      videoRef.current.src = newUrl;
      videoRef.current.load();
      if (wasPlaying) {
        videoRef.current.play().catch(() => { });
      }
    }
  }, [activeSegmentIndex, segments]); // Removed isPlaying to prevent reset on toggle

  // Effect: Playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

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

  // Format time as MM:SS
  const formatVideoTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Progress percentage
  const progressPercent = durationSeconds > 0 ? (currentPlaybackTime / durationSeconds) * 100 : 0;

  // ========================================================================
  // EARLY RETURNS (after all hooks)
  // ========================================================================

  // Loading state
  if (!session && !fullSession) {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            <span className="text-sm font-medium text-slate-500">Loading session...</span>
          </div>
        </div>
      );
    }
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
  const rageTapCount = metrics.rageTapCount || session?.rageTapCount || detectedRageTaps.length || 0;
  const screensVisited = fullSession?.screensVisited || metrics.screensVisited || session?.screensVisited || [];

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

  // Filter activity feed - also filter out empty/invalid events
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

    if (activityFilter === 'all') return true;

    const gestureType = (e.gestureType || e.properties?.gestureType || '').toLowerCase();

    if (activityFilter === 'navigation') {
      return type === 'navigation' || type === 'screen_view' || type === 'app_foreground' || type === 'app_background';
    }
    if (activityFilter === 'touches') {
      return type === 'tap' || type === 'touch' || type === 'gesture' || gestureType.includes('tap');
    }
    if (activityFilter === 'network') {
      return type === 'network_request';
    }
    if (activityFilter === 'issues') {
      return type === 'crash' || type === 'error' || type === 'anr' || type === 'rage_tap';
    }
    return true;
  });

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

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left Column: Session Activity */}
          <div className="lg:col-span-3 order-2 lg:order-1">
            <div className="bg-white border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] h-[750px] flex flex-col overflow-hidden rounded-lg">
              {/* Header */}
              <div className="px-4 py-3 border-b-4 border-black flex-shrink-0 bg-slate-50">
                <h3 className="font-black text-sm text-black uppercase tracking-tight mb-2">
                  Session Activity
                </h3>

                {/* Filter Tabs */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'navigation', label: 'Nav' },
                    { id: 'touches', label: 'Taps' },
                    { id: 'network', label: 'API' },
                    { id: 'issues', label: 'Issues' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setActivityFilter(filter.id)}
                      className={`
                        px-2 py-1 text-[9px] font-black uppercase tracking-wide border-2 border-black transition-all
                        ${activityFilter === filter.id
                          ? 'bg-black text-white shadow-none translate-x-[1px] translate-y-[1px]'
                          : 'bg-white text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]'
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
                    <span className="text-xs font-bold uppercase">No activity found</span>
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
                            ${isHighlighted ? 'bg-amber-50 border-l-4 border-l-amber-500' : 'border-l-4 border-l-transparent hover:border-l-black'}
                          `}
                          onClick={() => seekToTime(Math.max(0, (event.timestamp - replayBaseTime) / 1000))}
                        >
                          <div className="flex items-start gap-2">
                            {/* Icon */}
                            <div className="mt-0.5 flex-shrink-0">
                              {isNetwork ? (
                                <div
                                  className={`
                                    px-1 py-0.5 text-[8px] font-black font-mono border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]
                                    ${event.properties?.success ? 'bg-emerald-400 text-black' : 'bg-red-500 text-white'}
                                  `}
                                >
                                  {event.properties?.statusCode || 'ERR'}
                                </div>
                              ) : (
                                <div
                                  className="w-4 h-4 rounded flex items-center justify-center border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                  style={{ backgroundColor: color }}
                                >
                                  <Icon className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-black uppercase tracking-tight text-black">
                                  {isNetwork ? event.name : event.type.replace(/_/g, ' ')}
                                </span>
                                <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-100 px-1 py-0.5 border border-slate-200">
                                  {timeStr}
                                </span>
                              </div>

                              {isNetwork ? (
                                <div className="space-y-0.5">
                                  <div className="text-[10px] text-slate-500 font-mono truncate">
                                    {event.properties?.urlPath || event.properties?.url}
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
                              ) : (
                                <div className="text-[10px] text-slate-500 truncate">
                                  {event.screen && (
                                    <span className="bg-slate-200 px-1 py-0.5 text-[8px] font-black text-black uppercase mr-1">
                                      {event.screen}
                                    </span>
                                  )}
                                  {event.targetLabel && (
                                    <span className="text-slate-600">{event.targetLabel}</span>
                                  )}
                                  {event.properties?.reason && (
                                    <span className="text-red-500 font-medium">{event.properties.reason}</span>
                                  )}
                                </div>
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

          {/* Center Column: Video Player */}
          <div className="lg:col-span-5 order-1 lg:order-2">
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-lg overflow-hidden">
              {/* Video Area */}
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
                    className="absolute left-4 z-10 w-10 h-10 bg-white hover:bg-slate-100 border-3 border-black flex items-center justify-center text-black transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}

                {(isReplayExpired || replayUnavailableReason) ? (
                  <div className="w-[280px] aspect-[9/19.5] flex flex-col items-center justify-center text-slate-400 bg-slate-100 rounded-[2rem] px-4">
                    <VideoOff className="w-12 h-12 mb-3 opacity-40" />
                    <p className="font-semibold text-sm text-center">Video Replay Unavailable</p>
                    {replayUnavailableReason === 'deleted' ? (
                      <>
                        <p className="text-xs text-slate-400 mt-1 text-center">
                          Video was automatically deleted after the retention period
                        </p>
                        <p className="text-[10px] text-slate-300 mt-2 text-center">
                          Session data (events, timeline, network) is still available below
                        </p>
                      </>
                    ) : replayUnavailableReason === 'not_promoted' ? (
                      <>
                        <p className="text-xs text-slate-400 mt-1 text-center">
                          No video was recorded for this session
                        </p>
                        <p className="text-[10px] text-slate-300 mt-2 text-center">
                          Only high-value sessions (crashes, errors, rage taps) have video
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1 text-center">Recording has expired</p>
                    )}
                  </div>
                ) : segments.length > 0 ? (
                  <div className="relative">
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

                          {/* Video Element */}
                          <video
                            ref={videoRef}
                            className="absolute inset-0 w-full h-full object-cover"
                            onTimeUpdate={handleTimeUpdate}
                            onEnded={handleSegmentEnd}
                            onLoadedMetadata={() => {
                              setIsBuffering(false);
                              if (pendingSeekTimeRef.current !== null && videoRef.current) {
                                videoRef.current.currentTime = pendingSeekTimeRef.current;
                                pendingSeekTimeRef.current = null;
                              }
                            }}
                            onSeeked={() => setIsSeeking(false)}
                            onWaiting={() => setIsBuffering(true)}
                            onPlaying={() => setIsBuffering(false)}
                            playsInline
                            muted
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

                          {/* Buffering */}
                          {isBuffering && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-30">
                              <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                            </div>
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
                    className="absolute right-4 z-10 w-10 h-10 bg-white hover:bg-slate-100 border-3 border-black flex items-center justify-center text-black transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Unified Timeline */}
              <div className="border-t-4 border-black bg-white">
                {/* Timeline Header */}
                <div className="px-4 py-2 flex items-center justify-between border-b-2 border-black bg-slate-50">
                  <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-wide text-black">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 bg-blue-500 border-2 border-black"></div>
                      <span>Touches</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 bg-emerald-500 border-2 border-black"></div>
                      <span>API</span>
                    </div>
                    {(fullSession?.crashes?.length || 0) > 0 && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-red-500 border-2 border-black"></div>
                        <span>Crash</span>
                      </div>
                    )}
                  </div>

                  {/* Touch Overlay Toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowTouchOverlay(!showTouchOverlay)}
                      onMouseDown={(e) => e.preventDefault()}
                      className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-black uppercase border-2 border-black transition-all ${showTouchOverlay
                        ? 'bg-blue-400 text-black shadow-none translate-x-[2px] translate-y-[2px]'
                        : 'bg-white text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]'
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
                    const isFrustration = event.frustrationKind || event.type === 'rage_tap';
                    const isNetwork = event.type === 'network_request';
                    const eventLabel = isNetwork
                      ? `${event.name || 'API'} ${event.properties?.urlPath || event.properties?.url || ''}`.trim()
                      : event.type.replace(/_/g, ' ');
                    const tooltipText = `${eventLabel} • ${formatEventTime(event.timestamp)}`;

                    return (
                      <div
                        key={`a-${i}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          seekToTime(Math.max(0, time));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            seekToTime(Math.max(0, time));
                          }
                        }}
                        className={`absolute rounded-full transition-transform hover:scale-150 focus:outline-none focus:ring-2 focus:ring-black/30 cursor-pointer ${isFrustration ? 'w-2 h-2' : 'w-1.5 h-1.5'
                          }`}
                        style={{
                          left: `${percent}%`,
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: color,
                        }}
                        title={tooltipText}
                        aria-label={tooltipText}
                      />
                    );
                  })}

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
                <div className="px-4 py-3 border-t-4 border-black bg-slate-50">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={restart}
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-2 text-slate-500 hover:text-black hover:bg-white border-2 border-transparent hover:border-black rounded transition-all"
                      title="Restart"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => skip(-5)}
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-2 text-slate-500 hover:text-black hover:bg-white border-2 border-transparent hover:border-black rounded transition-all"
                      title="Back 5s"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    <button
                      onClick={togglePlayPause}
                      onMouseDown={(e) => e.preventDefault()}
                      className={`w-12 h-12 border-4 border-black rounded-full flex items-center justify-center transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] ${isPlaying ? 'bg-amber-400 text-black' : 'bg-emerald-400 text-black'
                        }`}
                      disabled={segments.length === 0}
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
                      className="p-2 text-slate-500 hover:text-black hover:bg-white border-2 border-transparent hover:border-black rounded transition-all"
                      title="Forward 5s"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>

                    {/* Time Display */}
                    <span className="text-sm font-mono font-bold text-black tabular-nums ml-2 bg-white px-2 py-1 border-2 border-black">
                      {formatVideoTime(currentPlaybackTime)} / {formatVideoTime(durationSeconds)}
                    </span>

                    {/* Speed Control */}
                    <div className="relative ml-2">
                      <button
                        onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                        onMouseDown={(e) => e.preventDefault()}
                        className="px-2 py-1 text-xs font-black text-black bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                      >
                        {playbackRate}x
                      </button>

                      {showSpeedMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setShowSpeedMenu(false)}
                          />
                          <div className="absolute bottom-full right-0 mb-2 bg-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden z-50 min-w-[80px]">
                            {[0.5, 1, 1.5, 2, 4].map((rate) => (
                              <button
                                key={rate}
                                onClick={() => {
                                  setPlaybackRate(rate);
                                  setShowSpeedMenu(false);
                                }}
                                onMouseDown={(e) => e.preventDefault()}
                                className={`w-full px-3 py-2 text-xs font-bold text-left transition-colors border-b-2 border-black last:border-b-0 ${playbackRate === rate
                                  ? 'bg-amber-400 text-black'
                                  : 'text-black hover:bg-slate-100'
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

              {/* Segment Indicator Pills */}
              {segments.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 py-3 border-t-2 border-black">
                  {segments.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveSegmentIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      className={`h-2 border-2 border-black transition-all ${i === activeSegmentIndex
                        ? 'w-6 bg-amber-400'
                        : 'w-2 bg-slate-200 hover:bg-slate-300'
                        }`}
                      title={`Segment ${i + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: DOM Inspector */}
          <div className="lg:col-span-4 order-3">
            <div className="bg-white border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] h-[750px] max-h-[80vh] rounded-lg overflow-hidden flex flex-col">
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
    </div>
  );
};

export default RecordingDetail;