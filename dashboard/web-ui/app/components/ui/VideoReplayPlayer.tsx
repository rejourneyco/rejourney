import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Hand,
  Volume2,
  VolumeX,
  Maximize2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { TouchOverlay, TouchEvent } from './TouchOverlay';
import { MarkerTooltip } from './MarkerTooltip';

// Types
export interface HierarchySnapshot {
  url: string;
  timestamp: number;
}

interface VideoSegment {
  url: string;
  startTime: number;
  endTime: number | null;
  frameCount: number | null;
}

interface EventMarker {
  timestamp: number;
  type: string;
  gestureType?: string;
  touches?: Array<{ x: number; y: number; force?: number }>;
  targetLabel?: string;
  frustrationKind?: string;
}

interface CrashMarker {
  id: string;
  timestamp: number;
  exceptionName: string;
  reason: string;
  status?: string;
}

interface AnrMarker {
  timestamp: number;
  durationMs?: number;
  threadState?: string;
}

interface VideoReplayPlayerProps {
  sessionId: string;
  segments: VideoSegment[];
  events?: EventMarker[];
  hierarchySnapshots?: HierarchySnapshot[];
  crashes?: CrashMarker[];
  anrs?: AnrMarker[];
  sessionStartTime: number;
  sessionEndTime?: number;
  /** Optional: playable duration in seconds (total - background time). If provided, used for timeline. */
  playableDuration?: number;
  deviceWidth?: number;
  deviceHeight?: number;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  className?: string;
}

export interface VideoReplayPlayerRef {
  seekTo: (timestamp: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
}

// Format time as MM:SS
const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const VideoReplayPlayer = forwardRef<VideoReplayPlayerRef, VideoReplayPlayerProps>(
  (
    {
      sessionId,
      segments,
      events = [],
      hierarchySnapshots,
      crashes = [],
      anrs = [],
      sessionStartTime,
      sessionEndTime,
      playableDuration: playableDurationProp,
      deviceWidth = 375,
      deviceHeight = 812,
      onTimeUpdate,
      className = '',
    },
    ref
  ) => {
    // State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isMuted, setIsMuted] = useState(true);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
    const [isBuffering, setIsBuffering] = useState(false);
    const [isInGap, setIsInGap] = useState(false); // Between segments (e.g., during background)
    const [showTouchOverlay, setShowTouchOverlay] = useState(true);
    const [touchEvents, setTouchEvents] = useState<TouchEvent[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [segmentDownloadProgress, setSegmentDownloadProgress] = useState<number | null>(null);

    // Background/termination overlay state
    const [isInBackground, setIsInBackground] = useState(false);
    const [backgroundDuration, setBackgroundDuration] = useState<number | null>(null);
    const [isTerminated, setIsTerminated] = useState(false);
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const [hoveredMarker, setHoveredMarker] = useState<any>(null);

    const [isSeeking, setIsSeeking] = useState(false);

    // Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const gapTimerRef = useRef<number | null>(null);
    const gapTargetTimeRef = useRef<number | null>(null);
    const pendingSeekTimeRef = useRef<number | null>(null);

    // Calculate session duration for the timeline
    // Priority:
    // 1. If playableDuration is provided (from backend), use it - this excludes background time
    // 2. Otherwise, calculate from video segment bounds (more accurate than session timestamps)
    // 3. Fallback to session timestamps if no segments
    const sessionDuration = useMemo(() => {
      // If backend provided playable duration, use it
      if (playableDurationProp && playableDurationProp > 0) {
        return playableDurationProp;
      }

      // Calculate from actual video segments - this is the true playable content
      if (segments.length > 0) {
        const firstSegment = segments[0];
        const lastSegment = segments[segments.length - 1];
        const firstSegmentStart = firstSegment.startTime;
        const lastSegmentEnd = lastSegment.endTime || lastSegment.startTime + 60000;

        // Total duration based on video content, accounting for gaps between segments
        // This gives us the span of time covered by video
        return (lastSegmentEnd - firstSegmentStart) / 1000;
      }

      // Fallback to session timestamps
      if (sessionEndTime && sessionStartTime) {
        return (sessionEndTime - sessionStartTime) / 1000;
      }

      return 60;
    }, [segments, sessionStartTime, sessionEndTime, playableDurationProp]);

    // Normalize events to relative timestamps
    const normalizedEvents = useMemo(() => {
      return events.map((e) => ({
        ...e,
        relativeTime: (e.timestamp - sessionStartTime) / 1000,
      }));
    }, [events, sessionStartTime]);

    // Normalize crashes
    const normalizedCrashes = useMemo(() => {
      return crashes.map((c) => ({
        ...c,
        relativeTime: (c.timestamp - sessionStartTime) / 1000,
      }));
    }, [crashes, sessionStartTime]);

    // Normalize ANRs
    const normalizedAnrs = useMemo(() => {
      return anrs.map((a) => ({
        ...a,
        relativeTime: (a.timestamp - sessionStartTime) / 1000,
      }));
    }, [anrs, sessionStartTime]);

    // Find segment for time
    const findSegmentForTime = useCallback(
      (time: number) => {
        const absoluteTime = sessionStartTime + time * 1000;
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const segmentEnd = segment.endTime || sessionEndTime || segment.startTime + 60000;
          if (absoluteTime >= segment.startTime && absoluteTime <= segmentEnd) {
            return i;
          }
        }
        return 0;
      },
      [segments, sessionStartTime, sessionEndTime]
    );

    // Seek to time
    const seekToTime = useCallback(
      (time: number) => {
        // Clear any gap timer when seeking
        if (gapTimerRef.current) {
          clearInterval(gapTimerRef.current);
          gapTimerRef.current = null;
        }
        setIsInGap(false);
        gapTargetTimeRef.current = null;
        setIsSeeking(true);

        const clampedTime = Math.max(0, Math.min(time, sessionDuration));
        const segmentIndex = findSegmentForTime(clampedTime);
        const segment = segments[segmentIndex];

        if (!segment) return;

        const segmentStartRelative = (segment.startTime - sessionStartTime) / 1000;
        const timeWithinSegment = clampedTime - segmentStartRelative;

        if (segmentIndex !== activeSegmentIndex) {
          // If changing segments, we need to wait for the new video to load
          // before we can seek. We store the pending time.
          pendingSeekTimeRef.current = Math.max(0, timeWithinSegment);
          setActiveSegmentIndex(segmentIndex);
        } else if (videoRef.current) {
          // Same segment, seek immediately
          videoRef.current.currentTime = Math.max(0, timeWithinSegment);
        }

        setCurrentTime(clampedTime);
      },
      [segments, sessionStartTime, activeSegmentIndex, findSegmentForTime, sessionDuration]
    );

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      seekTo: (timestamp: number) => {
        const relativeTime = (timestamp - sessionStartTime) / 1000;
        seekToTime(relativeTime);
      },
      play: () => {
        videoRef.current?.play();
        setIsPlaying(true);
      },
      pause: () => {
        videoRef.current?.pause();
        setIsPlaying(false);
      },
      getCurrentTime: () => currentTime,
    }));

    // Handle time update
    const handleTimeUpdate = useCallback(() => {
      if (!videoRef.current || isDragging || isSeeking) return;

      const segment = segments[activeSegmentIndex];
      if (!segment) return;

      const segmentStartRelative = (segment.startTime - sessionStartTime) / 1000;
      const newTime = segmentStartRelative + videoRef.current.currentTime;

      setCurrentTime(newTime);
      onTimeUpdate?.(newTime, sessionDuration);

      // Track background/foreground/termination state
      const currentAbsoluteTime = sessionStartTime + newTime * 1000;
      let inBackground = false;
      let backgroundStartTime: number | null = null;
      let terminated = false;

      for (const event of events) {
        if (event.timestamp > currentAbsoluteTime) break;
        const eventType = (event.type || event.gestureType || '').toLowerCase();
        const props = (event as any).properties || {};
        const lifecycleState = props.state || (event as any).state;

        // Check for background event
        const isBackgroundEvent = eventType === 'app_background' ||
          (eventType === 'app_lifecycle' && lifecycleState === 'app_background') ||
          (eventType === 'app_state' && lifecycleState === 'background');

        // Check for foreground event  
        const isForegroundEvent = eventType === 'app_foreground' ||
          (eventType === 'app_lifecycle' && lifecycleState === 'app_foreground') ||
          (eventType === 'app_state' && lifecycleState === 'active');

        // Check for termination event
        const isTerminatedEvent = eventType === 'app_terminated' ||
          (eventType === 'app_lifecycle' && lifecycleState === 'app_terminated') ||
          eventType === 'session_end' || eventType === 'session_timeout';

        if (isBackgroundEvent) {
          inBackground = true;
          backgroundStartTime = event.timestamp;
        } else if (isForegroundEvent) {
          inBackground = false;
          backgroundStartTime = null;
        }

        if (isTerminatedEvent) {
          terminated = true;
        }
      }

      // Calculate how long user will be in background
      let bgDurationSeconds: number | null = null;
      let sessionEndedInBackground = false;

      if (inBackground && backgroundStartTime !== null) {
        let foundForeground = false;
        for (const event of events) {
          if (event.timestamp <= backgroundStartTime) continue;
          const eventType = (event.type || event.gestureType || '').toLowerCase();
          const props = (event as any).properties || {};
          const lifecycleState = props.state || (event as any).state;

          const isForegroundEvent = eventType === 'app_foreground' ||
            (eventType === 'app_lifecycle' && lifecycleState === 'app_foreground') ||
            (eventType === 'app_state' && lifecycleState === 'active');
          const isTerminatedEvent = eventType === 'app_terminated' ||
            (eventType === 'app_lifecycle' && lifecycleState === 'app_terminated') ||
            eventType === 'session_end' || eventType === 'session_timeout';

          if (isForegroundEvent) {
            foundForeground = true;
            const totalBgDuration = event.timestamp - backgroundStartTime;
            const elapsedInBg = currentAbsoluteTime - backgroundStartTime;
            const remainingMs = totalBgDuration - elapsedInBg;
            bgDurationSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
            break;
          }
          if (isTerminatedEvent) {
            sessionEndedInBackground = true;
            terminated = true;
            break;
          }
        }

        // If we're in background and there's no foreground/termination event after,
        // and we're at the end of the session, show as ended
        if (!foundForeground && !sessionEndedInBackground) {
          const sessionEnd = sessionEndTime || (sessionStartTime + sessionDuration * 1000);
          if (currentAbsoluteTime >= sessionEnd - 500) {
            sessionEndedInBackground = true;
          }
        }
      }

      setIsInBackground(inBackground && !sessionEndedInBackground);
      setBackgroundDuration(bgDurationSeconds);
      setIsTerminated(terminated || sessionEndedInBackground);

      // Track keyboard visibility
      let keyboardShown = false;
      let kbHeight = 0;
      for (const event of events) {
        if (event.timestamp > currentAbsoluteTime) break;
        const eventType = (event.type || '').toLowerCase();

        if (eventType === 'keyboard_show') {
          keyboardShown = true;
          kbHeight = (event as any).keyboardHeight || (event as any).properties?.keyboardHeight || 0;
        } else if (eventType === 'keyboard_hide') {
          keyboardShown = false;
          kbHeight = 0;
        }
      }
      setIsKeyboardVisible(keyboardShown);
      setKeyboardHeight(kbHeight);

      // Update touch overlay - process events for enhanced visualization
      if (showTouchOverlay) {
        const recentTouchEvents = normalizedEvents
          .filter((e) => {
            const eventTime = e.timestamp;
            const timeDiff = currentAbsoluteTime - eventTime;
            const isGestureEvent = e.type === 'touch' || e.type === 'gesture';
            const rawTouchesArr = e.touches ?? [];
            const touchesArr = Array.isArray(rawTouchesArr) ? rawTouchesArr : [];
            return isGestureEvent && touchesArr.length > 0 && timeDiff >= 0 && timeDiff < 1000;
          })
          .map((e) => {
            const rawTouchArray = e.touches || [];
            const touchArray = Array.isArray(rawTouchArray) ? rawTouchArray : [];
            const gestureType = (e as any).gestureType || 'tap';
            const props = (e as any).properties || {};

            // ========================================================================
            // Platform Coordinate Handling (React Native iOS vs Android)
            // ========================================================================
            // Both platforms send coordinates in density-independent pixels:
            //   - iOS (RN): Uses native UIKit points
            //   - Android (RN): Raw pixels normalized to dp from TouchInterceptor
            // deviceWidth/Height also match these units, enabling unified handling.
            // ========================================================================

            // Filter valid touches
            const validTouches = touchArray
              .filter((t: any) => {
                const x = typeof t.x === 'number' ? t.x : 0;
                const y = typeof t.y === 'number' ? t.y : 0;
                return x > 5 && y > 5 && x < deviceWidth * 3 && y < deviceHeight * 3;
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
              targetLabel: (e as any).targetLabel || props.targetLabel,
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
    }, [
      segments,
      activeSegmentIndex,
      sessionStartTime,
      sessionDuration,
      onTimeUpdate,
      showTouchOverlay,
      normalizedEvents,
      isDragging,
      deviceWidth,
      deviceHeight,
      events,
      sessionStartTime,
    ]);

    // Handle segment end - check for gaps between segments
    const handleSegmentEnd = useCallback(() => {
      if (activeSegmentIndex < segments.length - 1) {
        const currentSegment = segments[activeSegmentIndex];
        const nextSegment = segments[activeSegmentIndex + 1];

        // Check if there's a gap between segments (e.g., user was in background)
        const currentSegmentEnd = currentSegment.endTime || currentSegment.startTime;
        const gap = nextSegment.startTime - currentSegmentEnd;

        if (gap > 500) { // Gap > 500ms indicates a background period
          // Start gap simulation - advance time through the gap
          setIsInGap(true);
          const gapStartTime = (currentSegmentEnd - sessionStartTime) / 1000;
          const gapEndTime = (nextSegment.startTime - sessionStartTime) / 1000;
          gapTargetTimeRef.current = gapEndTime;

          let gapCurrentTime = gapStartTime;
          const gapDuration = gapEndTime - gapStartTime;
          const tickInterval = 100; // Update every 100ms
          const timePerTick = (tickInterval / 1000) * playbackRate * 10; // Speed up gap playback 10x

          // Clear any existing timer
          if (gapTimerRef.current) {
            clearInterval(gapTimerRef.current);
          }

          gapTimerRef.current = window.setInterval(() => {
            if (!isPlaying) {
              // Paused during gap - don't advance
              return;
            }

            gapCurrentTime += timePerTick;

            if (gapCurrentTime >= gapEndTime) {
              // Gap complete - switch to next segment
              if (gapTimerRef.current) {
                clearInterval(gapTimerRef.current);
                gapTimerRef.current = null;
              }
              setIsInGap(false);
              gapTargetTimeRef.current = null;
              setActiveSegmentIndex(activeSegmentIndex + 1);
            } else {
              // Update time during gap
              setCurrentTime(gapCurrentTime);
              onTimeUpdate?.(gapCurrentTime, sessionDuration);

              // Update background/foreground state during gap
              const currentAbsoluteTime = sessionStartTime + gapCurrentTime * 1000;
              let inBackground = false;
              let backgroundStartTime: number | null = null;

              for (const event of events) {
                if (event.timestamp > currentAbsoluteTime) break;
                const eventType = (event.type || '').toLowerCase();

                if (eventType === 'app_background') {
                  inBackground = true;
                  backgroundStartTime = event.timestamp;
                } else if (eventType === 'app_foreground') {
                  inBackground = false;
                  backgroundStartTime = null;
                }
              }

              // Calculate remaining background time
              let bgDuration: number | null = null;
              if (inBackground && backgroundStartTime !== null) {
                for (const event of events) {
                  if (event.timestamp <= backgroundStartTime) continue;
                  const eventType = (event.type || '').toLowerCase();

                  if (eventType === 'app_foreground') {
                    const totalBgDuration = event.timestamp - backgroundStartTime;
                    const elapsedInBg = currentAbsoluteTime - backgroundStartTime;
                    bgDuration = Math.max(0, Math.ceil((totalBgDuration - elapsedInBg) / 1000));
                    break;
                  }
                }
              }

              setIsInBackground(inBackground);
              setBackgroundDuration(bgDuration);
            }
          }, tickInterval);
        } else {
          // No significant gap - switch to next segment immediately
          setActiveSegmentIndex(activeSegmentIndex + 1);
        }
      } else {
        setIsPlaying(false);
      }
    }, [activeSegmentIndex, segments, sessionStartTime, playbackRate, isPlaying, events, sessionDuration, onTimeUpdate]);

    // Handle loaded metadata
    const handleLoadedMetadata = useCallback(() => {
      setIsBuffering(false);
      // If we have a pending seek (e.g. from segment switch), apply it now
      if (pendingSeekTimeRef.current !== null && videoRef.current) {
        videoRef.current.currentTime = pendingSeekTimeRef.current;
        pendingSeekTimeRef.current = null;
      }
    }, []);

    // Handle seeked event
    const handleSeeked = useCallback(() => {
      setIsSeeking(false);
    }, []);

    // Handle progress click/drag
    const handleProgressInteraction = useCallback(
      (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
        if (!progressRef.current) return;

        // Blur any focused element to prevent accidental activation
        // (like the Restart button) when pressing Space later
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        const rect = progressRef.current.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const newTime = percent * sessionDuration;
        seekToTime(newTime);
      },
      [sessionDuration, seekToTime]
    );

    const handleProgressMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        setIsDragging(true);
        handleProgressInteraction(e);

        const handleMouseMove = (e: MouseEvent) => handleProgressInteraction(e);
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
        seekToTime(currentTime + seconds);
      },
      [currentTime, seekToTime]
    );

    // Restart
    const restart = useCallback(() => {
      seekToTime(0);
      if (videoRef.current) {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }, [seekToTime]);

    // Effect: Update video source with progress tracking
    useEffect(() => {
      if (!videoRef.current || !segments[activeSegmentIndex]) return;

      let cancelled = false;
      const wasPlaying = isPlaying;
      const segment = segments[activeSegmentIndex];

      async function fetchSegmentWithProgress() {
        try {
          setSegmentDownloadProgress(0);
          const res = await fetch(segment.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const contentLength = +(res.headers.get('Content-Length') || 0);
          if (!res.body) {
            videoRef.current!.src = segment.url;
            return;
          }

          const reader = res.body.getReader();
          let receivedLength = 0;
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            if (contentLength) {
              setSegmentDownloadProgress(Math.round((receivedLength / contentLength) * 100));
            }
          }

          if (cancelled) return;

          const blob = new Blob(chunks, { type: 'video/mp4' });
          const blobUrl = URL.createObjectURL(blob);

          if (videoRef.current) {
            videoRef.current.src = blobUrl;
            videoRef.current.load();
            if (wasPlaying) {
              videoRef.current.play().catch(() => { });
            }
          }

          // Cleanup blob URL when segment changes or component unmounts
          return () => {
            URL.revokeObjectURL(blobUrl);
          };
        } catch (err) {
          console.error('Failed to fetch video segment:', err);
          if (videoRef.current && !cancelled) {
            videoRef.current.src = segment.url;
          }
        } finally {
          if (!cancelled) {
            setSegmentDownloadProgress(null);
          }
        }
      }

      const cleanup = fetchSegmentWithProgress();

      return () => {
        cancelled = true;
        cleanup.then(fn => fn?.());
      };
    }, [activeSegmentIndex, segments]);

    // Effect: Playback rate
    useEffect(() => {
      if (videoRef.current) {
        videoRef.current.playbackRate = playbackRate;
      }
    }, [playbackRate]);

    // Effect: Muted
    useEffect(() => {
      if (videoRef.current) {
        videoRef.current.muted = isMuted;
      }
    }, [isMuted]);

    // Effect: Cleanup gap timer on unmount
    useEffect(() => {
      return () => {
        if (gapTimerRef.current) {
          clearInterval(gapTimerRef.current);
        }
      };
    }, []);

    // Effect: Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;

        if (isInput) return;

        switch (e.code) {
          case 'Space':
            // If the user hasn't focused a button (that would handle space natively),
            // or if we want to force Play/Pause:
            // Standard behavior: if button focused, space clicks it.
            // We'll respect that, but if body is focused (after blur), we play/pause.
            if (target.tagName !== 'BUTTON') {
              e.preventDefault();
              togglePlayPause();
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            skip(-5);
            break;
          case 'ArrowRight':
            e.preventDefault();
            skip(5);
            break;
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlayPause, skip]);

    // Progress percentage
    const progressPercent = sessionDuration > 0 ? (currentTime / sessionDuration) * 100 : 0;
    const currentAbsoluteTime = sessionStartTime + currentTime * 1000;

    return (
      <div className={`w-full ${className}`} ref={containerRef}>
        {/* Main Player Container - Neo-Brutal Style */}
        <div className="border-4 border-black bg-slate-700 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-lg overflow-hidden">
          {/* Video Area */}
          <div className="relative flex items-center justify-center py-8 px-4">
            {/* Navigation Arrow - Left */}
            {segments.length > 1 && activeSegmentIndex > 0 && (
              <button
                onClick={() => setActiveSegmentIndex(activeSegmentIndex - 1)}
                onMouseDown={(e) => e.preventDefault()}
                className="absolute left-4 z-10 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* Phone Frame */}
            <div className="relative">
              {/* Phone Glow Effect */}
              <div className="absolute -inset-4 bg-gradient-to-b from-white/5 to-transparent rounded-[3rem] blur-xl" />

              {/* Phone Body */}
              <div
                className="relative bg-slate-900 rounded-[2.5rem] p-[3px] shadow-2xl"
                style={{ width: '280px' }}
              >
                {/* Phone Inner Border */}
                <div className="bg-slate-800 rounded-[2.3rem] p-1">
                  {/* Screen Container */}
                  <div
                    className="relative bg-black rounded-[2rem] overflow-hidden"
                    style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                  >
                    {/* Dynamic Island / Notch */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-6 bg-black rounded-full z-20 flex items-center justify-center">
                      <div className="w-2 h-2 bg-slate-700 rounded-full mr-2" />
                      <div className="w-3 h-3 bg-slate-800 rounded-full ring-1 ring-slate-700" />
                    </div>

                    {/* Video Element */}
                    <video
                      ref={videoRef}
                      className="absolute inset-0 w-full h-full object-cover"
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={handleSegmentEnd}
                      onLoadedMetadata={handleLoadedMetadata}
                      onSeeked={handleSeeked}
                      onWaiting={() => setIsBuffering(true)}
                      onPlaying={() => setIsBuffering(false)}
                      playsInline
                      muted={isMuted}
                    />

                    {/* Enhanced Touch Overlay */}
                    {showTouchOverlay && (
                      <TouchOverlay
                        events={touchEvents}
                        deviceWidth={deviceWidth}
                        deviceHeight={deviceHeight}
                        currentTime={currentAbsoluteTime}
                        visibleWindowMs={800}
                      />
                    )}

                    {/* Buffering / Segment Loading */}
                    {(isBuffering || segmentDownloadProgress !== null) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-30 p-6">
                        <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin mb-4" />

                        {segmentDownloadProgress !== null ? (
                          <div className="w-full max-w-[160px]">
                            <div className="h-1.5 w-full bg-white/20 rounded-full overflow-hidden border border-white/10">
                              <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${segmentDownloadProgress}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-center text-white/70 mt-3 uppercase tracking-widest leading-relaxed">
                              Fetching from S3...<br />
                              {segmentDownloadProgress}% complete
                            </p>
                          </div>
                        ) : (
                          <p className="text-[10px] font-mono text-center text-white/70 uppercase tracking-widest">
                            Buffering...
                          </p>
                        )}
                      </div>
                    )}

                    {/* Background Overlay */}
                    {isInBackground && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
                        <svg className="w-16 h-16 text-amber-400 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <div className="text-white text-center">
                          <div className="text-lg font-medium mb-2">User put app in background</div>
                          {backgroundDuration !== null && backgroundDuration > 0 && (
                            <>
                              <div className="text-white/70 text-sm">Returning in:</div>
                              <div className="text-3xl font-bold text-amber-400 mt-2">{backgroundDuration}s</div>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Termination Overlay */}
                    {isTerminated && !isInBackground && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
                        <svg className="w-16 h-16 text-red-400 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                        </svg>
                        <div className="text-white text-center">
                          <div className="text-lg font-medium">Session Ended</div>
                          <div className="text-white/70 text-sm mt-2">App was closed or terminated</div>
                        </div>
                      </div>
                    )}

                    {/* Keyboard Overlay */}
                    {isKeyboardVisible && keyboardHeight > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-slate-200/95 backdrop-blur-sm z-20 border-t-2 border-slate-300 flex items-center justify-center"
                        style={{ height: `${(keyboardHeight / deviceHeight) * 100}%` }}
                      >
                        <div className="text-slate-600 text-xs font-medium flex items-center gap-2">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 16h12" />
                          </svg>
                          Keyboard
                        </div>
                      </div>
                    )}

                    {/* Home Indicator */}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 bg-white/30 rounded-full z-20" />
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Arrow - Right */}
            {segments.length > 1 && activeSegmentIndex < segments.length - 1 && (
              <button
                onClick={() => setActiveSegmentIndex(activeSegmentIndex + 1)}
                onMouseDown={(e) => e.preventDefault()}
                className="absolute right-4 z-10 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Controls Bar */}
          <div className="bg-slate-800 border-t-2 border-slate-600 px-4 py-3">
            {/* Progress Bar */}
            <div
              ref={progressRef}
              className="relative h-1.5 bg-slate-600 rounded-full cursor-pointer group mb-4"
              onMouseDown={handleProgressMouseDown}
            >
              {/* Buffered/Progress Fill */}
              <div
                className="absolute h-full bg-amber-400 rounded-full transition-all duration-75"
                style={{ width: `${progressPercent}%` }}
              />

              {/* Event Markers */}
              {normalizedEvents.slice(0, 100).map((event, i) => {
                const percent = (event.relativeTime / sessionDuration) * 100;
                if (percent < 0 || percent > 100) return null;

                const isFrustration = event.frustrationKind || event.type === 'frustration';
                const isTouch = event.type === 'touch' || event.type === 'gesture';

                return (
                  <div
                    key={`e-${i}`}
                    className={`absolute w-1 h-1 rounded-full transition-transform hover:scale-150 ${isFrustration ? 'bg-red-400' : isTouch ? 'bg-blue-400' : 'bg-slate-400'
                      }`}
                    style={{
                      left: `${percent}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                    onMouseEnter={() => setHoveredMarker({
                      ...event,
                      timestampStr: formatTime(event.relativeTime),
                      x: percent
                    })}
                    onMouseLeave={() => setHoveredMarker(null)}
                  />
                );
              })}

              {/* Progress Scrubber Handle */}
              <div
                className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-md border-2 border-slate-300 opacity-0 group-hover:opacity-100 transition-opacity z-20"
                style={{
                  left: `${progressPercent}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>

            {/* Marker Tooltip */}
            {hoveredMarker && (
              <MarkerTooltip
                visible={!!hoveredMarker}
                x={hoveredMarker.x}
                type={hoveredMarker.type}
                name={hoveredMarker.name}
                timestamp={hoveredMarker.timestampStr}
                target={hoveredMarker.targetLabel}
                statusCode={hoveredMarker.properties?.statusCode}
                success={hoveredMarker.properties?.success}
                duration={hoveredMarker.properties?.duration}
              />
            )}

            {/* Control Buttons */}
            <div className="flex items-center justify-between">
              {/* Left Controls */}
              <div className="flex items-center gap-1">
                {/* Restart */}
                <button
                  onClick={restart}
                  onMouseDown={(e) => e.preventDefault()}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Restart"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Skip Back */}
                <button
                  onClick={() => skip(-5)}
                  onMouseDown={(e) => e.preventDefault()}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Back 5s"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                {/* Play/Pause */}
                <button
                  onClick={togglePlayPause}
                  onMouseDown={(e) => e.preventDefault()}
                  className="w-10 h-10 bg-amber-400 hover:bg-amber-300 text-black rounded-full flex items-center justify-center transition-colors shadow-lg"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5 ml-0.5" />
                  )}
                </button>

                {/* Skip Forward */}
                <button
                  onClick={() => skip(5)}
                  onMouseDown={(e) => e.preventDefault()}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Forward 5s"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                {/* Time Display */}
                <span className="text-sm text-slate-300 font-mono ml-3 tabular-nums">
                  {formatTime(currentTime)} / {formatTime(sessionDuration)}
                </span>
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-1">
                {/* Touch Overlay Toggle */}
                <button
                  onClick={() => setShowTouchOverlay(!showTouchOverlay)}
                  onMouseDown={(e) => e.preventDefault()}
                  className={`p-2 rounded-lg transition-colors ${showTouchOverlay
                    ? 'text-emerald-400 bg-emerald-400/10'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                    }`}
                  title="Toggle touch indicators"
                >
                  <Hand className="w-4 h-4" />
                </button>

                {/* Mute Toggle */}
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  onMouseDown={(e) => e.preventDefault()}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>

                {/* Speed Control */}
                <div className="relative">
                  <button
                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                    onMouseDown={(e) => e.preventDefault()}
                    className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors font-medium flex items-center gap-1"
                  >
                    <span className="tabular-nums">{playbackRate}x</span>
                  </button>

                  {showSpeedMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowSpeedMenu(false)}
                      />
                      <div className="absolute bottom-full right-0 mb-2 bg-slate-700 border-2 border-slate-600 rounded-lg shadow-xl overflow-hidden z-50 min-w-[80px]">
                        {[0.5, 1, 1.5, 2, 4].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => {
                              setPlaybackRate(rate);
                              setShowSpeedMenu(false);
                            }}
                            className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${playbackRate === rate
                              ? 'bg-amber-400 text-black font-medium'
                              : 'text-slate-200 hover:bg-slate-600'
                              }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Fullscreen */}
                <button
                  onClick={() => containerRef.current?.requestFullscreen?.()}
                  onMouseDown={(e) => e.preventDefault()}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Fullscreen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Segment Indicator Pills */}
        {segments.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {segments.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveSegmentIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                className={`h-1.5 rounded-full transition-all ${i === activeSegmentIndex
                  ? 'w-6 bg-amber-400'
                  : 'w-1.5 bg-slate-300 hover:bg-slate-400'
                  }`}
                title={`Segment ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

VideoReplayPlayer.displayName = 'VideoReplayPlayer';

export default VideoReplayPlayer;
