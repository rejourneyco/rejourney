/**
 * Screenshot Replay Player
 * 
 * Image-based session replay player that cycles through screenshot frames
 * for realistic stop-motion video effect. Falls back to video playback
 * when screenshot frames are not available.
 * 
 * Features:
 * - Canvas-based rendering for smooth playback
 * - Timeline scrubbing with instant frame preview
 * - Touch event overlay synchronized with frames
 * - Keyboard/ANR/crash markers on timeline
 * - Playback speed control (0.5x - 4x)
 * - Background/termination overlays
 */

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
  RotateCcw,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Film,
} from 'lucide-react';
import { TouchOverlay, TouchEvent } from './TouchOverlay';

// ============================================================================
// Types
// ============================================================================

export interface ScreenshotFrame {
  timestamp: number;
  url: string;
  index: number;
}

export interface VideoSegment {
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

export interface ScreenshotReplayPlayerProps {
  sessionId: string;
  /** Screenshot frames for image-based playback (primary) */
  screenshotFrames?: ScreenshotFrame[];
  /** Video segments for video-based playback (fallback) */
  videoSegments?: VideoSegment[];
  /** Playback mode hint from backend */
  playbackMode?: 'screenshots' | 'video' | 'none';
  events?: EventMarker[];
  crashes?: CrashMarker[];
  anrs?: AnrMarker[];
  sessionStartTime: number;
  sessionEndTime?: number;
  playableDuration?: number;
  deviceWidth?: number;
  deviceHeight?: number;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  className?: string;
}

export interface ScreenshotReplayPlayerRef {
  seekTo: (timestamp: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
}

// ============================================================================
// Utilities
// ============================================================================

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// ============================================================================
// Screenshot Playback Engine
// ============================================================================

interface FrameCache {
  [url: string]: HTMLImageElement;
}

function useScreenshotPlayback(
  frames: ScreenshotFrame[],
  sessionStartTime: number,
  sessionDuration: number,
  playbackRate: number,
  isPlaying: boolean,
  setIsPlaying: (playing: boolean) => void,
  onFrameChange: (frameIndex: number, timestamp: number) => void
) {
  const frameCache = useRef<FrameCache>({});
  const currentFrameIndex = useRef(0);
  const lastUpdateTime = useRef(0);
  const animationFrameId = useRef<number | null>(null);

  // Master playback clock (ref) to ensure monotonic progression
  const playbackTimeRef = useRef(0);

  // Sync ref with external current time if needed (e.g. on mount or after seeking)
  useEffect(() => {
    if (!isPlaying) {
      const frame = frames[currentFrameIndex.current];
      if (frame) {
        playbackTimeRef.current = (frame.timestamp - sessionStartTime) / 1000;
      }
    }
  }, [isPlaying, frames, sessionStartTime]);

  // Preload frames
  useEffect(() => {
    if (frames.length === 0) return;

    // Preload first 10 frames immediately
    const preloadCount = Math.min(10, frames.length);
    for (let i = 0; i < preloadCount; i++) {
      const frame = frames[i];
      if (!frameCache.current[frame.url]) {
        const img = new Image();
        img.src = frame.url;
        frameCache.current[frame.url] = img;
      }
    }

    // Preload rest in background
    const preloadRest = () => {
      for (let i = preloadCount; i < frames.length; i++) {
        const frame = frames[i];
        if (!frameCache.current[frame.url]) {
          const img = new Image();
          img.src = frame.url;
          frameCache.current[frame.url] = img;
        }
      }
    };

    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(preloadRest);
    } else {
      setTimeout(preloadRest, 100);
    }
  }, [frames]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying || frames.length === 0) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      return;
    }

    lastUpdateTime.current = performance.now();

    const tick = (now: number) => {
      const deltaSec = ((now - lastUpdateTime.current) / 1000) * playbackRate;
      lastUpdateTime.current = now;

      // Advance playback time using our master clock
      playbackTimeRef.current += deltaSec;

      // Target timestamp for frame selection
      const targetTimestamp = sessionStartTime + playbackTimeRef.current * 1000;

      // Robust frame selection: Binary search for the closest frame at or before targetTimestamp
      let left = 0;
      let right = frames.length - 1;
      let targetIdx = 0;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (frames[mid].timestamp <= targetTimestamp) {
          targetIdx = mid;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      if (targetIdx !== currentFrameIndex.current) {
        currentFrameIndex.current = targetIdx;
        onFrameChange(targetIdx, frames[targetIdx].timestamp);
      }

      // Check if reached absolute end of session
      if (playbackTimeRef.current >= sessionDuration) {
        setIsPlaying(false);
        playbackTimeRef.current = sessionDuration;
        onFrameChange(frames.length - 1, sessionStartTime + sessionDuration * 1000);
        return;
      }

      animationFrameId.current = requestAnimationFrame(tick);
    };

    animationFrameId.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isPlaying, frames, playbackRate, onFrameChange, sessionStartTime, sessionDuration, setIsPlaying]);

  const seekToFrame = useCallback((index: number) => {
    const safeIdx = Math.max(0, Math.min(index, frames.length - 1));
    currentFrameIndex.current = safeIdx;
    if (frames[safeIdx]) {
      playbackTimeRef.current = (frames[safeIdx].timestamp - sessionStartTime) / 1000;
      onFrameChange(safeIdx, frames[safeIdx].timestamp);
    }
  }, [frames, onFrameChange, sessionStartTime]);

  const seekToTimestamp = useCallback((timestamp: number) => {
    // Binary search for closest frame
    let left = 0;
    let right = frames.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right + 1) / 2);
      if (frames[mid].timestamp <= timestamp) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }

    seekToFrame(left);
  }, [frames, seekToFrame]);

  const getImage = useCallback((url: string): HTMLImageElement | null => {
    return frameCache.current[url] || null;
  }, []);

  return {
    seekToFrame,
    seekToTimestamp,
    getImage,
    currentIndex: currentFrameIndex.current,
  };
}

// ============================================================================
// Main Component
// ============================================================================

export const ScreenshotReplayPlayer = forwardRef<
  ScreenshotReplayPlayerRef,
  ScreenshotReplayPlayerProps
>((props, ref) => {
  const {
    sessionId,
    screenshotFrames: screenshotFramesProp = [],
    videoSegments: videoSegmentsProp = [],
    playbackMode: playbackModeHint,
    events = [],
    crashes = [],
    anrs = [],
    sessionStartTime,
    sessionEndTime,
    playableDuration: playableDurationProp,
    deviceWidth = 375,
    deviceHeight = 812,
    onTimeUpdate,
    className = '',
  } = props;

  const screenshotFrames = useMemo(() => {
    return [...screenshotFramesProp].sort((a, b) => a.timestamp - b.timestamp);
  }, [screenshotFramesProp]);

  const videoSegments = useMemo(() => {
    return [...videoSegmentsProp].sort((a, b) => a.startTime - b.startTime);
  }, [videoSegmentsProp]);

  // Determine actual playback mode
  const playbackMode = useMemo(() => {
    if (playbackModeHint === 'screenshots' && screenshotFrames.length > 0) {
      return 'screenshots';
    }
    if (playbackModeHint === 'video' && videoSegments.length > 0) {
      return 'video';
    }
    // Auto-detect
    if (screenshotFrames.length > 0) return 'screenshots';
    if (videoSegments.length > 0) return 'video';
    return 'none';
  }, [playbackModeHint, screenshotFrames, videoSegments]);

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isInBackground, setIsInBackground] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [touchEvents, setTouchEvents] = useState<TouchEvent[]>([]);
  const [showTouchOverlay, setShowTouchOverlay] = useState(true);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Calculate session duration
  const sessionDuration = useMemo(() => {
    if (playableDurationProp && playableDurationProp > 0) {
      return playableDurationProp;
    }

    if (playbackMode === 'screenshots' && screenshotFrames.length > 0) {
      const lastFrame = screenshotFrames[screenshotFrames.length - 1];
      // Duration is from session start to last frame
      return (lastFrame.timestamp - sessionStartTime) / 1000;
    }

    if (playbackMode === 'video' && videoSegments.length > 0) {
      const firstSegment = videoSegments[0];
      const lastSegment = videoSegments[videoSegments.length - 1];
      const lastEnd = lastSegment.endTime || lastSegment.startTime + 60000;
      return (lastEnd - firstSegment.startTime) / 1000;
    }

    if (sessionEndTime && sessionStartTime) {
      return (sessionEndTime - sessionStartTime) / 1000;
    }

    return 60;
  }, [playbackMode, screenshotFrames, videoSegments, sessionStartTime, sessionEndTime, playableDurationProp]);

  // Frame change handler
  const handleFrameChange = useCallback((frameIndex: number, timestamp: number) => {
    setCurrentFrameIndex(frameIndex);
    const relativeTime = (timestamp - sessionStartTime) / 1000;
    setCurrentTime(relativeTime);
    onTimeUpdate?.(relativeTime, sessionDuration);

    // Draw frame to canvas
    if (canvasRef.current && screenshotFrames[frameIndex]) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvasRef.current!.width, canvasRef.current!.height);
        };
        img.src = screenshotFrames[frameIndex].url;
      }
    }

    // Update touch overlay
    if (showTouchOverlay) {
      const absoluteTime = timestamp;
      const recentTouches: TouchEvent[] = events
        .filter((e) => {
          const timeDiff = absoluteTime - e.timestamp;
          const isTouch = e.type === 'touch' || e.type === 'gesture';
          return isTouch && e.touches && e.touches.length > 0 && timeDiff >= 0 && timeDiff < 1000;
        })
        .map((e, idx) => {
          const touches = e.touches || [];
          return {
            id: `touch-${e.timestamp}-${idx}`,
            timestamp: e.timestamp,
            gestureType: e.gestureType || 'tap',
            touches: touches.map((t) => ({
              x: t.x,
              y: t.y,
              timestamp: e.timestamp,
              force: t.force,
            })),
            targetLabel: e.targetLabel,
          };
        });
      setTouchEvents(recentTouches);
    }

    // Check background/termination state
    let inBackground = false;
    let terminated = false;
    for (const event of events) {
      if (event.timestamp > timestamp) break;
      const eventType = (event.type || '').toLowerCase();
      if (eventType === 'app_background') inBackground = true;
      else if (eventType === 'app_foreground') inBackground = false;
      if (eventType === 'app_terminated' || eventType === 'session_end') terminated = true;
    }
    setIsInBackground(inBackground);
    setIsTerminated(terminated);
  }, [sessionStartTime, sessionDuration, screenshotFrames, events, showTouchOverlay, onTimeUpdate]);

  // Screenshot playback hook
  const screenshotPlayback = useScreenshotPlayback(
    screenshotFrames,
    sessionStartTime,
    sessionDuration,
    playbackRate,
    isPlaying && playbackMode === 'screenshots',
    setIsPlaying,
    handleFrameChange
  );

  // Seek to time (seconds relative to session start)
  const seekToTime = useCallback((time: number) => {
    const clampedTime = Math.max(0, Math.min(time, sessionDuration));
    setCurrentTime(clampedTime);

    if (playbackMode === 'screenshots') {
      const targetTimestamp = sessionStartTime + clampedTime * 1000;
      screenshotPlayback.seekToTimestamp(targetTimestamp);
    } else if (playbackMode === 'video' && videoRef.current) {
      // For video mode, find correct segment and seek
      const absoluteTime = sessionStartTime + clampedTime * 1000;
      for (let i = 0; i < videoSegments.length; i++) {
        const segment = videoSegments[i];
        const segmentEnd = segment.endTime || sessionEndTime || segment.startTime + 60000;
        if (absoluteTime >= segment.startTime && absoluteTime <= segmentEnd) {
          const segmentOffset = (absoluteTime - segment.startTime) / 1000;
          videoRef.current.currentTime = segmentOffset;
          break;
        }
      }
    }
  }, [playbackMode, sessionStartTime, sessionDuration, screenshotPlayback, videoSegments, sessionEndTime]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    seekTo: (timestamp: number) => {
      const relativeTime = (timestamp - sessionStartTime) / 1000;
      seekToTime(relativeTime);
    },
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    getCurrentTime: () => currentTime,
  }));

  // Play/pause toggle
  const togglePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // Skip forward/backward
  const skip = useCallback((seconds: number) => {
    seekToTime(currentTime + seconds);
  }, [currentTime, seekToTime]);

  // Restart
  const restart = useCallback(() => {
    seekToTime(0);
    setIsPlaying(true);
  }, [seekToTime]);

  // Progress bar interaction
  const handleProgressInteraction = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!progressRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const targetTime = percent * sessionDuration;

    seekToTime(targetTime);
  }, [sessionDuration, seekToTime]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [handleProgressInteraction]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      switch (e.code) {
        case 'Space':
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

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, skip]);

  // Draw initial frame
  useEffect(() => {
    if (playbackMode === 'screenshots' && screenshotFrames.length > 0 && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvasRef.current!.width, canvasRef.current!.height);
        };
        img.src = screenshotFrames[0].url;
      }
    }
  }, [playbackMode, screenshotFrames]);

  // Video time update handler
  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current || playbackMode !== 'video') return;

    // Calculate relative time from video position
    const videoTime = videoRef.current.currentTime;
    const segment = videoSegments[0]; // Simplified - assumes single segment
    if (segment) {
      const absoluteTime = segment.startTime + videoTime * 1000;
      const relativeTime = (absoluteTime - sessionStartTime) / 1000;
      setCurrentTime(relativeTime);
      onTimeUpdate?.(relativeTime, sessionDuration);
    }
  }, [playbackMode, videoSegments, sessionStartTime, sessionDuration, onTimeUpdate]);

  // Aspect ratio calculation
  const aspectRatio = deviceHeight / deviceWidth;

  // Calculate progress percentage
  const progressPercent = sessionDuration > 0 ? (currentTime / sessionDuration) * 100 : 0;

  // Speed options
  const speedOptions = [0.5, 1, 1.5, 2, 4];

  // Render nothing if no playback mode
  if (playbackMode === 'none') {
    return (
      <div className={`flex items-center justify-center bg-gray-900 rounded-lg ${className}`} style={{ aspectRatio: `${deviceWidth}/${deviceHeight}` }}>
        <div className="text-center text-gray-400">
          <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No recording available</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
      {/* Playback mode indicator */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 bg-black/50 rounded text-xs text-white/70">
        {playbackMode === 'screenshots' ? (
          <>
            <ImageIcon className="w-3 h-3" />
            <span>Screenshots ({screenshotFrames.length} frames)</span>
          </>
        ) : (
          <>
            <Film className="w-3 h-3" />
            <span>Video ({videoSegments.length} segments)</span>
          </>
        )}
      </div>

      {/* Main display area */}
      <div className="relative w-full" style={{ paddingTop: `${aspectRatio * 100}%` }}>
        <div className="absolute inset-0">
          {playbackMode === 'screenshots' ? (
            <canvas
              ref={canvasRef}
              width={deviceWidth}
              height={deviceHeight}
              className="w-full h-full object-contain bg-gray-900"
            />
          ) : (
            <video
              ref={videoRef}
              className="w-full h-full object-contain bg-gray-900"
              muted
              playsInline
              onTimeUpdate={handleVideoTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              src={videoSegments[0]?.url}
            />
          )}

          {/* Touch overlay */}
          {showTouchOverlay && touchEvents.length > 0 && (
            <TouchOverlay
              events={touchEvents}
              deviceWidth={deviceWidth}
              deviceHeight={deviceHeight}
              currentTime={sessionStartTime + currentTime * 1000}
            />
          )}

          {/* Background overlay */}
          {isInBackground && !isTerminated && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center text-white">
                <div className="text-lg font-medium">App in Background</div>
              </div>
            </div>
          )}

          {/* Terminated overlay */}
          {isTerminated && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center text-white">
                <div className="text-lg font-medium">Session Ended</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4">
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-2 bg-white/20 rounded cursor-pointer mb-3"
          onMouseDown={handleProgressMouseDown}
        >
          {/* Progress fill */}
          <div
            className="absolute left-0 top-0 h-full bg-blue-500 rounded"
            style={{ width: `${progressPercent}%` }}
          />

          {/* Crash markers */}
          {crashes.map((crash, i) => {
            const crashTime = (crash.timestamp - sessionStartTime) / 1000;
            const crashPercent = (crashTime / sessionDuration) * 100;
            return (
              <div
                key={`crash-${i}`}
                className="absolute top-0 h-full w-1 bg-red-500"
                style={{ left: `${crashPercent}%` }}
                title={`Crash: ${crash.exceptionName}`}
              />
            );
          })}

          {/* ANR markers */}
          {anrs.map((anr, i) => {
            const anrTime = (anr.timestamp - sessionStartTime) / 1000;
            const anrPercent = (anrTime / sessionDuration) * 100;
            return (
              <div
                key={`anr-${i}`}
                className="absolute top-0 h-full w-1 bg-purple-500"
                style={{ left: `${anrPercent}%` }}
                title="ANR"
              />
            );
          })}

          {/* Scrubber handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg"
            style={{ left: `calc(${progressPercent}% - 8px)` }}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={restart}
              className="p-2 hover:bg-white/10 rounded transition-colors"
              title="Restart"
            >
              <RotateCcw className="w-5 h-5 text-white" />
            </button>

            <button
              onClick={() => skip(-10)}
              className="p-2 hover:bg-white/10 rounded transition-colors"
              title="Back 10s"
            >
              <SkipBack className="w-5 h-5 text-white" />
            </button>

            <button
              onClick={togglePlayPause}
              className="p-3 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 text-white" />
              ) : (
                <Play className="w-6 h-6 text-white" />
              )}
            </button>

            <button
              onClick={() => skip(10)}
              className="p-2 hover:bg-white/10 rounded transition-colors"
              title="Forward 10s"
            >
              <SkipForward className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Time display */}
          <div className="text-white text-sm font-mono">
            {formatTime(currentTime)} / {formatTime(sessionDuration)}
          </div>

          {/* Speed control */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-white text-sm"
            >
              {playbackRate}x
            </button>

            {showSpeedMenu && (
              <div className="absolute bottom-full right-0 mb-2 bg-gray-800 rounded shadow-lg py-1">
                {speedOptions.map((speed) => (
                  <button
                    key={speed}
                    onClick={() => {
                      setPlaybackRate(speed);
                      setShowSpeedMenu(false);
                      if (videoRef.current) {
                        videoRef.current.playbackRate = speed;
                      }
                    }}
                    className={`block w-full px-4 py-1 text-left text-sm hover:bg-white/10 ${playbackRate === speed ? 'text-blue-400' : 'text-white'
                      }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Frame counter (screenshots mode) */}
      {playbackMode === 'screenshots' && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 rounded text-xs text-white/70">
          Frame {currentFrameIndex + 1} / {screenshotFrames.length}
        </div>
      )}
    </div>
  );
});

ScreenshotReplayPlayer.displayName = 'ScreenshotReplayPlayer';

export default ScreenshotReplayPlayer;
