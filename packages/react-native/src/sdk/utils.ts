/**
 * Rejourney Utility Functions
 * 
 * IMPORTANT: This file uses lazy loading for react-native imports to avoid
 * "PlatformConstants could not be found" errors on RN 0.81+.
 */

import type { TouchPoint, GestureType } from '../types';

// Lazy-loaded Platform module
let _Platform: typeof import('react-native').Platform | null = null;

function getPlatform(): typeof import('react-native').Platform | null {
  if (_Platform) return _Platform;
  try {
    const RN = require('react-native');
    _Platform = RN.Platform;
    return _Platform;
  } catch {
    return null;
  }
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${randomPart}`;
}

/**
 * Generate a session ID
 */
export function generateSessionId(): string {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]?.replace(/-/g, '') ?? '';
  const timeStr = date.toTimeString().split(' ')[0]?.replace(/:/g, '') ?? '';
  const random = Math.random().toString(36).substring(2, 6);
  return `session_${dateStr}_${timeStr}_${random}`;
}

/**
 * Get current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return __DEV__;
}

/**
 * Check platform
 */
export function isIOS(): boolean {
  const platform = getPlatform();
  return platform?.OS === 'ios';
}

export function isAndroid(): boolean {
  const platform = getPlatform();
  return platform?.OS === 'android';
}

/**
 * Calculate distance between two points
 */
export function distance(p1: TouchPoint, p2: TouchPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate velocity between two points
 */
export function velocity(p1: TouchPoint, p2: TouchPoint): { x: number; y: number } {
  const dt = p2.timestamp - p1.timestamp;
  if (dt === 0) return { x: 0, y: 0 };
  return {
    x: (p2.x - p1.x) / dt,
    y: (p2.y - p1.y) / dt,
  };
}

/**
 * Determine gesture type from touch points
 */
export function classifyGesture(
  touches: TouchPoint[],
  duration: number
): GestureType {
  if (touches.length < 2) {
    if (duration > 500) return 'long_press';
    return 'tap';
  }

  const first = touches[0];
  const last = touches[touches.length - 1];

  if (!first || !last) return 'tap';

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dist = distance(first, last);

  // If very little movement, it's a tap
  if (dist < 10) {
    if (duration > 500) return 'long_press';
    return 'tap';
  }

  // Determine swipe direction
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX > absY) {
    return dx > 0 ? 'swipe_right' : 'swipe_left';
  } else {
    return dy > 0 ? 'swipe_down' : 'swipe_up';
  }
}

/**
 * Throttle function execution
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const currentTime = now();
    if (currentTime - lastCall >= delay) {
      lastCall = currentTime;
      fn(...args);
    }
  };
}

/**
 * Debounce function execution
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format duration to human readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format timestamp to readable time
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Create a simple hash of a string
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Log levels for controlling verbosity.
 * 
 * Default behavior minimizes log pollution for integrators:
 * - Release/Production: SILENT (no logs)
 * - Development: ERROR (only critical issues)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Logger with production-aware log levels.
 * 
 * Designed to minimize log pollution for integrators:
 * - Production/Release: SILENT (completely silent, no logs)
 * - Development/Debug: ERROR (only critical errors)
 * 
 * Only essential lifecycle logs (init success, session start/end) bypass
 * these levels via dedicated methods.
 */
class Logger {
  private prefix = '[Rejourney]';


  /**
   * Minimum log level to display.
   * 
   * Defaults to SILENT to avoid polluting integrator's console.
   * SDK developers can adjust this for internal debugging.
   * 
   * Note: In production builds, this should remain SILENT.
   * The native layers handle build-type detection automatically.
   */
  private minimumLogLevel: LogLevel = typeof __DEV__ !== 'undefined' && __DEV__
    ? LogLevel.ERROR
    : LogLevel.SILENT;

  /**
   * Set the minimum log level. Logs below this level will be suppressed.
   * SDK developers can use this for internal debugging.
   */
  setLogLevel(level: LogLevel): void {
    this.minimumLogLevel = level;
  }

  setDebugMode(enabled: boolean): void {
    this.minimumLogLevel = enabled
      ? LogLevel.DEBUG
      : typeof __DEV__ !== 'undefined' && __DEV__
        ? LogLevel.ERROR
        : LogLevel.SILENT;
  }

  /** Log a debug message - SDK internal use only */
  debug(...args: any[]): void {
    if (this.minimumLogLevel <= LogLevel.DEBUG) {
      console.log(this.prefix, ...args);
    }
  }

  /** Log an info message - SDK internal use only */
  info(...args: any[]): void {
    if (this.minimumLogLevel <= LogLevel.INFO) {
      console.info(this.prefix, ...args);
    }
  }

  /** Log a warning message */
  warn(...args: any[]): void {
    if (this.minimumLogLevel <= LogLevel.WARNING) {
      if (this.minimumLogLevel <= LogLevel.DEBUG) {
        // Explicit Debug Mode: Show YellowBox
        console.warn(this.prefix, ...args);
      } else {
        // Default Dev Mode: Log to console only, avoid YellowBox
        console.log(this.prefix, '[WARN]', ...args);
      }
    }
  }

  /** Log an error message */
  error(...args: any[]): void {
    if (this.minimumLogLevel <= LogLevel.ERROR) {
      if (this.minimumLogLevel <= LogLevel.DEBUG) {
        // Explicit Debug Mode: Show RedBox
        console.error(this.prefix, ...args);
      } else {
        // Default Dev Mode: Log to console only, avoid RedBox
        console.log(this.prefix, '[ERROR]', ...args);
      }
    }
  }

  notice(...args: any[]): void {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info(this.prefix, ...args);
    }
  }

  /**
   * Log SDK initialization success.
   * Only shown in development builds - this is the minimal "SDK started" log.
   */
  logInitSuccess(version: string): void {
    this.notice(`✓ SDK initialized (v${version})`);
  }

  /**
   * Log SDK initialization failure.
   * Always shown - this is a critical error.
   */
  logInitFailure(reason: string): void {
    console.error(this.prefix, `✗ Initialization failed: ${reason}`);
  }

  /**
   * Log session start.
   * Only shown in development builds.
   */
  logSessionStart(sessionId: string): void {
    this.notice(`Session started: ${sessionId}`);
  }

  /**
   * Log session end.
   * Only shown in development builds.
   */
  logSessionEnd(sessionId: string): void {
    this.notice(`Session ended: ${sessionId}`);
  }

  logObservabilityStart(): void {
    this.notice('💧 Starting Rejourney observability');
  }

  logRecordingStart(): void {
    this.notice('Starting recording');
  }

  logRecordingRemoteDisabled(): void {
    this.notice('Recording disabled by remote toggle');
  }

  logInvalidProjectKey(): void {
    this.notice('Invalid project API key');
  }

  logPackageMismatch(): void {
    this.notice('Bundle ID / package name mismatch');
  }

  /**
   * Log network request details
   */
  logNetworkRequest(request: { method?: string; url?: string; statusCode?: number; duration?: number; error?: string }): void {
    const statusIcon = request.error || (request.statusCode && request.statusCode >= 400) ? '🔴' : '🟢';
    const method = request.method || 'GET';
    // Shorten URL to just path if possible
    let url = request.url || '';
    try {
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        url = urlObj.pathname;
      }
    } catch {
      // Keep full URL if parsing fails
    }

    const duration = request.duration ? `(${Math.round(request.duration)}ms)` : '';
    const status = request.statusCode ? `${request.statusCode}` : 'ERR';

    this.notice(`${statusIcon} [NET] ${status} ${method} ${url} ${duration} ${request.error ? `Error: ${request.error}` : ''}`);
  }

  /**
   * Log frustration event (rage taps, etc)
   */
  logFrustration(kind: string): void {
    this.notice(`🤬 Frustration detected: ${kind}`);
  }

  /**
   * Log error captured by SDK
   */
  logError(message: string): void {
    this.notice(`X Error captured: ${message}`);
  }

  /**
   * Log lifecycle event (Background/Foreground)
   * Visible in development builds.
   */
  logLifecycleEvent(event: string): void {
    this.notice(`🔄 Lifecycle: ${event}`);
  }

  /**
   * Log upload statistics
   */
  logUploadStats(metrics: { uploadSuccessCount: number; uploadFailureCount: number; totalBytesUploaded: number }): void {
    const success = metrics.uploadSuccessCount;
    const failed = metrics.uploadFailureCount;
    const bytes = formatBytes(metrics.totalBytesUploaded);

    // Always show in dev mode for reassurance, even if 0
    this.notice(`📡 Upload Stats: ${success} success, ${failed} failed (${bytes} uploaded)`);
  }
}

export const logger = new Logger();
