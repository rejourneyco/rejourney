/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Rejourney SDK Constants
 */

// Import version from auto-generated file (generated from package.json by scripts/generate-version.js)
import { SDK_VERSION } from './version';

export { SDK_VERSION };

/** Default configuration values */
export const DEFAULT_CONFIG = {
  enabled: true,
  captureFPS: 0.5,
  captureOnEvents: true,
  maxSessionDuration: 10 * 60 * 1000,
  maxStorageSize: 50 * 1024 * 1024,
  autoScreenTracking: true,
  autoGestureTracking: true,
  privacyOcclusion: true,
  enableCompression: true,
  inactivityThreshold: 5000,
  disableInDev: false,
  detectRageTaps: true,
  detectDeadTaps: true,
  rageTapThreshold: 3,
  rageTapTimeWindow: 1000,
  debug: false,
  autoStartRecording: true,
  collectDeviceInfo: true,
  collectGeoLocation: true,
  postNavigationDelay: 300,
  postGestureDelay: 200,
  postModalDelay: 400,
} as const;

/** Event type constants */
export const EVENT_TYPES = {
  GESTURE: 'gesture',
  SCREEN_CHANGE: 'screen_change',
  CUSTOM: 'custom',
  APP_STATE: 'app_state',
  FRUSTRATION: 'frustration',
  ERROR: 'error',
} as const;

/** Gesture type constants */
export const GESTURE_TYPES = {
  TAP: 'tap',
  DOUBLE_TAP: 'double_tap',
  LONG_PRESS: 'long_press',
  SWIPE_LEFT: 'swipe_left',
  SWIPE_RIGHT: 'swipe_right',
  SWIPE_UP: 'swipe_up',
  SWIPE_DOWN: 'swipe_down',
  PINCH: 'pinch',
  SCROLL: 'scroll',
  RAGE_TAP: 'rage_tap',
  DEAD_TAP: 'dead_tap',
} as const;

/** Playback speeds */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;

/** Capture settings */
export const CAPTURE_SETTINGS = {
  DEFAULT_FPS: 0.5,
  MIN_FPS: 0.1,
  MAX_FPS: 2,
  CAPTURE_SCALE: 0.25,
  MIN_CAPTURE_DELTA_TIME: 0.5,
} as const;

/** Memory management settings */
export const MEMORY_SETTINGS = {
  /** Maximum events to keep in memory before flushing */
  MAX_EVENTS_IN_MEMORY: 100,
  /** Memory warning threshold in MB (flush when exceeded) */
  MEMORY_WARNING_THRESHOLD_MB: 100,
  /** Enable aggressive memory cleanup during low memory */
  AGGRESSIVE_CLEANUP_ENABLED: true,
  /** Bitmap pool size for reusing bitmaps (Android) */
  BITMAP_POOL_SIZE: 3,
} as const;

/** CPU throttling settings */
export const CPU_SETTINGS = {
  /** Throttle captures when CPU usage exceeds this percentage */
  CPU_THROTTLE_THRESHOLD: 80,
  /** Minimum interval between captures when throttled (seconds) */
  THROTTLED_MIN_INTERVAL: 2.0,
  /** Skip captures when battery is below this level (0-100) */
  LOW_BATTERY_THRESHOLD: 15,
  /** Skip captures when device is thermally throttled */
  THERMAL_THROTTLE_ENABLED: true,
  /** Maximum consecutive captures before forced cooldown */
  MAX_CONSECUTIVE_CAPTURES: 10,
  /** Cooldown period after max consecutive captures (ms) */
  CAPTURE_COOLDOWN_MS: 1000,
} as const;

/** Storage management settings */
export const STORAGE_SETTINGS = {
  /** Maximum total storage for session data (bytes) */
  MAX_STORAGE_SIZE: 50 * 1024 * 1024, // 50MB
  /** Storage warning threshold - start cleanup at this level */
  STORAGE_WARNING_THRESHOLD: 0.8, // 80% of max
  /** Number of old sessions to keep */
  MAX_SESSIONS_TO_KEEP: 5,
  /** Auto-delete sessions older than this (hours) */
  SESSION_EXPIRY_HOURS: 24,
  /** Use efficient binary storage format */
  USE_BINARY_FORMAT: true,
} as const;

/** Network/Upload settings */
export const UPLOAD_SETTINGS = {
  /** Batch upload interval (ms) */
  BATCH_INTERVAL_MS: 30000, // 30 seconds
  /** Max retry attempts for failed uploads */
  MAX_RETRY_ATTEMPTS: 3,
  /** Retry delay multiplier (exponential backoff) */
  RETRY_DELAY_MULTIPLIER: 2,
  /** Initial retry delay (ms) */
  INITIAL_RETRY_DELAY_MS: 1000,
  /** Max events per upload batch */
  MAX_EVENTS_PER_BATCH: 50,
  /** Skip uploads when on cellular and battery is low */
  CELLULAR_BATTERY_AWARE: true,
} as const;

/** Privacy constants */
export const PRIVACY = {
  OCCLUSION_COLOR: '#808080',
  SENSITIVE_COMPONENT_TYPES: [
    'TextInput',
    'SecureTextEntry',
    'PasswordField',
  ],
} as const;
