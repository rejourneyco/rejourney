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
 * Rejourney Auto Tracking Module
 * 
 * Automatic tracking features that work with just init() - no additional code needed.
 * This module handles:
 * - Rage tap detection
 * - Error tracking (JS + React Native)
 * - Session metrics aggregation
 * - Device info collection
 * - Anonymous ID generation
 * - Funnel/screen tracking
 * - Score calculations
 * 
 * IMPORTANT: This file uses lazy loading for react-native imports to avoid
 * "PlatformConstants could not be found" errors on RN 0.81+.
 */

import type {
  DeviceInfo,
  ErrorEvent,
} from '../types';
import { logger } from './utils';

// Lazy-loaded React Native modules
let _RN: typeof import('react-native') | null = null;

function getRN(): typeof import('react-native') | null {
  if (_RN) return _RN;
  try {
    _RN = require('react-native');
    return _RN;
  } catch {
    return null;
  }
}

function getPlatform() {
  return getRN()?.Platform;
}

function getDimensions() {
  return getRN()?.Dimensions;
}



function getRejourneyNativeModule() {
  const RN = getRN();
  if (!RN) return null;

  const { TurboModuleRegistry, NativeModules } = RN;
  let nativeModule = null;

  if (TurboModuleRegistry && typeof TurboModuleRegistry.get === 'function') {
    try {
      nativeModule = TurboModuleRegistry.get('Rejourney');
    } catch {
      // Ignore
    }
  }

  if (!nativeModule && NativeModules) {
    nativeModule = NativeModules.Rejourney ?? null;
  }

  return nativeModule;
}

type OnErrorEventHandler = ((
  event: Event | string,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error
) => boolean | void) | null;

interface PromiseRejectionEvent {
  reason?: any;
  promise?: Promise<any>;
}

const _globalThis = globalThis as typeof globalThis & {
  onerror?: OnErrorEventHandler;
  addEventListener?: (type: string, handler: (event: any) => void) => void;
  removeEventListener?: (type: string, handler: (event: any) => void) => void;
  ErrorUtils?: {
    getGlobalHandler: () => ((error: Error, isFatal: boolean) => void) | undefined;
    setGlobalHandler: (handler: (error: Error, isFatal: boolean) => void) => void;
  };
};

export interface TapEvent {
  x: number;
  y: number;
  timestamp: number;
  targetId?: string;
}

export interface SessionMetrics {
  totalEvents: number;
  touchCount: number;
  scrollCount: number;
  gestureCount: number;
  inputCount: number;
  navigationCount: number;
  errorCount: number;
  rageTapCount: number;
  deadTapCount: number;
  apiSuccessCount: number;
  apiErrorCount: number;
  apiTotalCount: number;
  netTotalDurationMs: number;
  netTotalBytes: number;
  screensVisited: string[];
  uniqueScreensCount: number;

  interactionScore: number;
  explorationScore: number;
  uxScore: number;
}

export interface AutoTrackingConfig {
  rageTapThreshold?: number;
  rageTapTimeWindow?: number;
  rageTapRadius?: number;
  trackJSErrors?: boolean;
  trackPromiseRejections?: boolean;
  trackReactNativeErrors?: boolean;
  trackConsoleLogs?: boolean;
  collectDeviceInfo?: boolean;
  maxSessionDurationMs?: number;
  detectDeadTaps?: boolean;
}

let isInitialized = false;
let config: AutoTrackingConfig = {};

const recentTaps: TapEvent[] = [];
let tapHead = 0;
let tapCount = 0;
const MAX_RECENT_TAPS = 10;

let metrics: SessionMetrics = createEmptyMetrics();
let sessionStartTime: number = 0;
let maxSessionDurationMs: number = 10 * 60 * 1000;
let currentScreen = '';
let screensVisited: string[] = [];

let anonymousId: string | null = null;
let anonymousIdPromise: Promise<string> | null = null;

let onRageTapDetected: ((count: number, x: number, y: number) => void) | null = null;
let onErrorCaptured: ((error: ErrorEvent) => void) | null = null;
let onScreenChange: ((screenName: string, previousScreen?: string) => void) | null = null;


/**
 * Mark a tap as handled.
 * No-op — kept for API compatibility. Dead tap detection is now native-side.
 */
export function markTapHandled(): void {
  // No-op: dead tap detection is handled natively in TelemetryPipeline
}
// ========== End Dead Tap Detection ==========

let originalErrorHandler: ((error: Error, isFatal: boolean) => void) | undefined;
let originalOnError: OnErrorEventHandler | null = null;
let originalOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let originalConsoleError: ((...args: any[]) => void) | null = null;
let _promiseRejectionTrackingDisable: (() => void) | null = null;

/**
 * Initialize auto tracking features
 * Called automatically by Rejourney.init() - no user action needed
 */
export function initAutoTracking(
  trackingConfig: AutoTrackingConfig,
  callbacks: {
    onRageTap?: (count: number, x: number, y: number) => void;
    onError?: (error: ErrorEvent) => void;
    onScreen?: (screenName: string, previousScreen?: string) => void;
  } = {}
): void {
  if (isInitialized) return;

  config = {
    rageTapThreshold: 3,
    rageTapTimeWindow: 500,
    rageTapRadius: 50,
    trackJSErrors: true,
    trackPromiseRejections: true,
    trackReactNativeErrors: true,
    trackConsoleLogs: true,
    collectDeviceInfo: true,
    maxSessionDurationMs: trackingConfig.maxSessionDurationMs,
    ...trackingConfig,
  };

  sessionStartTime = Date.now();
  setMaxSessionDurationMinutes(
    trackingConfig.maxSessionDurationMs
      ? trackingConfig.maxSessionDurationMs / 60000
      : undefined
  );

  onRageTapDetected = callbacks.onRageTap || null;
  onErrorCaptured = callbacks.onError || null;
  onScreenChange = callbacks.onScreen || null;
  setupErrorTracking();
  if (config.trackConsoleLogs) {
    setupConsoleTracking();
  }
  setupNavigationTracking();
  loadAnonymousId().then(id => {
    anonymousId = id;
  });

  isInitialized = true;
}

/**
 * Cleanup auto tracking features
 */
export function cleanupAutoTracking(): void {
  if (!isInitialized) return;

  restoreErrorHandlers();
  restoreConsoleHandlers();
  cleanupNavigationTracking();

  // Reset state
  tapHead = 0;
  tapCount = 0;
  consoleLogCount = 0;
  metrics = createEmptyMetrics();
  screensVisited = [];
  currentScreen = '';
  sessionStartTime = 0;
  maxSessionDurationMs = 10 * 60 * 1000;
  isInitialized = false;
}

/**
 * Track a tap event for rage tap detection
 * Called automatically from touch interceptor
 */
export function trackTap(tap: TapEvent): void {
  if (!isInitialized) return;

  const now = Date.now();

  const insertIndex = (tapHead + tapCount) % MAX_RECENT_TAPS;
  if (tapCount < MAX_RECENT_TAPS) {
    recentTaps[insertIndex] = { ...tap, timestamp: now };
    tapCount++;
  } else {
    recentTaps[tapHead] = { ...tap, timestamp: now };
    tapHead = (tapHead + 1) % MAX_RECENT_TAPS;
  }
  const windowStart = now - (config.rageTapTimeWindow || 500);
  while (tapCount > 0) {
    const oldestTap = recentTaps[tapHead];
    if (oldestTap && oldestTap.timestamp < windowStart) {
      tapHead = (tapHead + 1) % MAX_RECENT_TAPS;
      tapCount--;
    } else {
      break;
    }
  }

  detectRageTap();
  metrics.touchCount++;
  metrics.totalEvents++;
  // Dead tap detection is now handled natively in TelemetryPipeline
}

/**
 * Detect if recent taps form a rage tap pattern
 */
function detectRageTap(): void {
  const threshold = config.rageTapThreshold || 3;
  const radius = config.rageTapRadius || 50;

  if (tapCount < threshold) return;
  const tapsToCheck: TapEvent[] = [];
  for (let i = 0; i < threshold; i++) {
    const idx = (tapHead + tapCount - threshold + i) % MAX_RECENT_TAPS;
    tapsToCheck.push(recentTaps[idx]!);
  }

  let centerX = 0;
  let centerY = 0;
  for (const tap of tapsToCheck) {
    centerX += tap.x;
    centerY += tap.y;
  }
  centerX /= tapsToCheck.length;
  centerY /= tapsToCheck.length;

  let allWithinRadius = true;
  for (const tap of tapsToCheck) {
    const dx = tap.x - centerX;
    const dy = tap.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > radius) {
      allWithinRadius = false;
      break;
    }
  }

  if (allWithinRadius) {
    metrics.rageTapCount++;
    tapHead = 0;
    tapCount = 0;

    // Notify callback
    if (onRageTapDetected) {
      onRageTapDetected(threshold, centerX, centerY);
    }
  }
}

/**
 * Notify that a state change occurred (navigation, modal, etc.)
 * Kept for API compatibility
 */
export function notifyStateChange(): void {
  // No-op: dead tap detection is handled natively in TelemetryPipeline
}

/**
 * Setup automatic error tracking
 */
function setupErrorTracking(): void {
  if (config.trackReactNativeErrors !== false) {
    setupReactNativeErrorHandler();
  }

  if (config.trackJSErrors !== false && typeof _globalThis !== 'undefined') {
    setupJSErrorHandler();
  }

  if (config.trackPromiseRejections !== false && typeof _globalThis !== 'undefined') {
    setupPromiseRejectionHandler();
  }
}

/**
 * Setup React Native ErrorUtils handler
 *
 * CRITICAL FIX: For fatal errors, we delay calling the original handler by 500ms
 * to give the React Native bridge time to flush the logEvent('error') call to the
 * native TelemetryPipeline. Without this delay, the error event is queued on the
 * JS→native bridge but the app crashes (via originalErrorHandler) before the bridge
 * flushes, so the error is lost. Crashes are captured separately by native crash
 * handlers, but the corresponding JS error record was never making it to the backend.
 */
function setupReactNativeErrorHandler(): void {
  try {
    const ErrorUtils = _globalThis.ErrorUtils;
    if (!ErrorUtils) return;

    originalErrorHandler = ErrorUtils.getGlobalHandler();

    ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
      trackError({
        type: 'error',
        timestamp: Date.now(),
        message: error.message || String(error),
        stack: error.stack,
        name: error.name || 'Error',
      });

      if (originalErrorHandler) {
        if (isFatal) {
          // For fatal errors, delay the original handler so the native bridge
          // has time to deliver the error event to TelemetryPipeline before
          // the app terminates. 500ms is enough for the bridge to flush.
          setTimeout(() => {
            originalErrorHandler!(error, isFatal);
          }, 500);
        } else {
          originalErrorHandler(error, isFatal);
        }
      }
    });
  } catch {
    // Ignore
  }
}

/**
 * Setup global JS error handler
 */
function setupJSErrorHandler(): void {
  if (typeof _globalThis.onerror !== 'undefined') {
    originalOnError = _globalThis.onerror;

    _globalThis.onerror = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      trackError({
        type: 'error',
        timestamp: Date.now(),
        message: typeof message === 'string' ? message : 'Unknown error',
        stack: error?.stack || `${source}:${lineno}:${colno}`,
        name: error?.name || 'Error',
      });

      if (originalOnError) {
        return originalOnError(message, source, lineno, colno, error);
      }
      return false;
    };
  }
}

/**
 * Setup unhandled promise rejection handler
 *
 * React Native's Hermes engine does NOT support the web-standard
 * globalThis.addEventListener('unhandledrejection', ...) API.
 * We use two complementary strategies:
 *
 * 1. React Native's built-in promise rejection tracking polyfill
 *    (promise/setimmediate/rejection-tracking) — fires for all
 *    unhandled rejections, including those that never hit ErrorUtils.
 *
 * 2. console.error interception — newer RN versions (0.73+) report
 *    unhandled promise rejections via console.error with a recognizable
 *    prefix. We intercept these as a fallback.
 *
 * 3. Web API fallback — for non-RN environments (e.g., testing in a browser).
 */
function setupPromiseRejectionHandler(): void {
  let rnTrackingSetUp = false;

  // Strategy 1: RN-specific promise rejection tracking polyfill
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tracking = require('promise/setimmediate/rejection-tracking');
    if (tracking && typeof tracking.enable === 'function') {
      tracking.enable({
        allRejections: true,
        onUnhandled: (_id: number, error: any) => {
          trackError({
            type: 'error',
            timestamp: Date.now(),
            message: error?.message || String(error) || 'Unhandled Promise Rejection',
            stack: error?.stack,
            name: error?.name || 'UnhandledRejection',
          });
        },
        onHandled: () => { /* no-op */ },
      });
      _promiseRejectionTrackingDisable = () => {
        try { tracking.disable(); } catch { /* ignore */ }
      };
      rnTrackingSetUp = true;
    }
  } catch {
    // Polyfill not available — fall through to other strategies
  }

  // Strategy 2: Intercept console.error for promise rejection messages
  // Newer RN versions log "Possible Unhandled Promise Rejection" via console.error
  if (!rnTrackingSetUp && typeof console !== 'undefined' && console.error) {
    originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      // Detect RN-style promise rejection messages
      const firstArg = args[0];
      if (
        typeof firstArg === 'string' &&
        firstArg.includes('Possible Unhandled Promise Rejection')
      ) {
        const error = args[1];
        trackError({
          type: 'error',
          timestamp: Date.now(),
          message: error?.message || String(error) || firstArg,
          stack: error?.stack,
          name: error?.name || 'UnhandledRejection',
        });
      }
      // Always call through to original console.error
      if (originalConsoleError) {
        originalConsoleError.apply(console, args);
      }
    };
  }

  // Strategy 3: Web API fallback (works in browser-based testing, not in RN Hermes)
  if (!rnTrackingSetUp && typeof _globalThis.addEventListener !== 'undefined') {
    const handler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      trackError({
        type: 'error',
        timestamp: Date.now(),
        message: reason?.message || String(reason) || 'Unhandled Promise Rejection',
        stack: reason?.stack,
        name: reason?.name || 'UnhandledRejection',
      });
    };

    originalOnUnhandledRejection = handler;
    _globalThis.addEventListener!('unhandledrejection', handler);
  }
}

/**
 * Restore original error handlers
 */
function restoreErrorHandlers(): void {
  if (originalErrorHandler) {
    try {
      const ErrorUtils = _globalThis.ErrorUtils;
      if (ErrorUtils) {
        ErrorUtils.setGlobalHandler(originalErrorHandler);
      }
    } catch {
      // Ignore
    }
    originalErrorHandler = undefined;
  }

  if (originalOnError !== null) {
    _globalThis.onerror = originalOnError;
    originalOnError = null;
  }

  // Restore promise rejection tracking
  if (_promiseRejectionTrackingDisable) {
    _promiseRejectionTrackingDisable();
    _promiseRejectionTrackingDisable = null;
  }

  if (originalConsoleError) {
    console.error = originalConsoleError;
    originalConsoleError = null;
  }

  if (originalOnUnhandledRejection && typeof _globalThis.removeEventListener !== 'undefined') {
    _globalThis.removeEventListener!('unhandledrejection', originalOnUnhandledRejection);
    originalOnUnhandledRejection = null;
  }
}

/**
 * Track an error
 */
function trackError(error: ErrorEvent): void {
  metrics.errorCount++;
  metrics.totalEvents++;

  if (onErrorCaptured) {
    onErrorCaptured(error);
  }
}

/**
 * Manually track an error (for API errors, etc.)
 */
export function captureError(
  message: string,
  stack?: string,
  name?: string
): void {
  trackError({
    type: 'error',
    timestamp: Date.now(),
    message,
    stack,
    name: name || 'Error',
  });
}

let originalConsoleLog: ((...args: any[]) => void) | null = null;
let originalConsoleWarn: ((...args: any[]) => void) | null = null;

// Cap console logs to prevent flooding the event pipeline
const MAX_CONSOLE_LOGS_PER_SESSION = 1000;
let consoleLogCount = 0;

/**
 * Setup console tracking to capture log statements
 */
function setupConsoleTracking(): void {
  if (typeof console === 'undefined') return;

  if (!originalConsoleLog) originalConsoleLog = console.log;
  if (!originalConsoleWarn) originalConsoleWarn = console.warn;

  const createConsoleInterceptor = (level: 'log' | 'warn' | 'error', originalFn: (...args: any[]) => void) => {
    return (...args: any[]) => {
      try {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n...` : ''}`;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }).join(' ');

        // Prevent infinite loops, ignore internal noise, and enforce per-session cap
        if (
          consoleLogCount < MAX_CONSOLE_LOGS_PER_SESSION &&
          !message.includes('[Rejourney]') &&
          !message.includes('Possible Unhandled Promise Rejection')
        ) {
          consoleLogCount++;
          const nativeModule = getRejourneyNativeModule();
          if (nativeModule) {
            const logEvent = {
              type: 'log',
              timestamp: Date.now(),
              level,
              message: message.length > 2000 ? message.substring(0, 2000) + '...' : message,
            };
            nativeModule.logEvent('log', logEvent).catch(() => { });
          }
        }
      } catch {
        // Ignore any errors during interception
      }

      if (originalFn) {
        originalFn.apply(console, args);
      }
    };
  };

  console.log = createConsoleInterceptor('log', originalConsoleLog!);
  console.warn = createConsoleInterceptor('warn', originalConsoleWarn!);

  const currentConsoleError = console.error;
  if (!originalConsoleError) originalConsoleError = currentConsoleError;
  console.error = createConsoleInterceptor('error', currentConsoleError);
}

/**
 * Restore console standard functions
 */
function restoreConsoleHandlers(): void {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  if (originalConsoleWarn) {
    console.warn = originalConsoleWarn;
    originalConsoleWarn = null;
  }
  // Note: console.error is restored in restoreErrorHandlers via originalConsoleError
}

let navigationPollingInterval: ReturnType<typeof setInterval> | null = null;
let lastDetectedScreen = '';
let navigationSetupDone = false;
let navigationPollingErrors = 0;
const MAX_POLLING_ERRORS = 10; // Stop polling after 10 consecutive errors

/**
 * Track a navigation state change from React Navigation.
 * 
 * For bare React Native apps using @react-navigation/native.
 * Just add this to your NavigationContainer's onStateChange prop.
 * 
 * @example
 * ```tsx
 * import { trackNavigationState } from 'rejourney';
 * 
 * <NavigationContainer onStateChange={trackNavigationState}>
 *   ...
 * </NavigationContainer>
 * ```
 */
export function trackNavigationState(state: any): void {
  if (!state?.routes) return;

  try {
    const { normalizeScreenName } = require('./navigation');

    const findActiveScreen = (navState: any): string | null => {
      if (!navState?.routes) return null;
      const index = navState.index ?? navState.routes.length - 1;
      const route = navState.routes[index];
      if (!route) return null;
      if (route.state) return findActiveScreen(route.state);
      return normalizeScreenName(route.name || 'Unknown');
    };

    const screenName = findActiveScreen(state);
    if (screenName && screenName !== lastDetectedScreen) {
      lastDetectedScreen = screenName;
      trackScreen(screenName);
    }
  } catch {
    // Ignore
  }
}

/**
 * React hook for navigation tracking.
 * 
 * Returns props to spread on NavigationContainer that will:
 * 1. Track the initial screen on mount (via onReady)
 * 2. Track all subsequent navigations (via onStateChange)
 * 
 * This is the RECOMMENDED approach for bare React Native apps.
 * 
 * @example
 * ```tsx
 * import { useNavigationTracking } from 'rejourney';
 * import { NavigationContainer } from '@react-navigation/native';
 * 
 * function App() {
 *   const navigationTracking = useNavigationTracking();
 *   
 *   return (
 *     <NavigationContainer {...navigationTracking}>
 *       <RootNavigator />
 *     </NavigationContainer>
 *   );
 * }
 * ```
 */
export function useNavigationTracking() {
  const React = require('react');
  const { createNavigationContainerRef } = require('@react-navigation/native');

  const navigationRef = React.useRef(createNavigationContainerRef());

  const onReady = React.useCallback(() => {
    try {
      const currentRoute = navigationRef.current?.getCurrentRoute?.();
      if (currentRoute?.name) {
        const { normalizeScreenName } = require('./navigation');
        const screenName = normalizeScreenName(currentRoute.name);
        if (screenName && screenName !== lastDetectedScreen) {
          lastDetectedScreen = screenName;
          trackScreen(screenName);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  return {
    ref: navigationRef.current,
    onReady,
    onStateChange: trackNavigationState,
  };
}

/**
 * Setup automatic Expo Router tracking
 * 
 * For Expo apps using expo-router - works automatically.
 * For bare React Native apps - use trackNavigationState instead.
 */
function setupNavigationTracking(): void {
  if (navigationSetupDone) return;
  navigationSetupDone = true;

  if (__DEV__) {
    logger.debug('Setting up navigation tracking...');
  }

  let attempts = 0;
  const maxAttempts = 5;

  const trySetup = () => {
    attempts++;
    if (__DEV__) {
      logger.debug('Navigation setup attempt', attempts, 'of', maxAttempts);
    }

    const success = trySetupExpoRouter();

    if (success) {
      if (__DEV__) {
        logger.debug('Expo Router setup: SUCCESS on attempt', attempts);
      }
    } else if (attempts < maxAttempts) {
      const delay = 200 * attempts;
      if (__DEV__) {
        logger.debug('Expo Router not ready, retrying in', delay, 'ms');
      }
      setTimeout(trySetup, delay);
    } else {
      if (__DEV__) {
        logger.debug('Expo Router setup: FAILED after', maxAttempts, 'attempts');
        logger.debug('For manual navigation tracking, use trackNavigationState() on your NavigationContainer');
      }
    }
  };

  setTimeout(trySetup, 200);
}

/**
   * Set up Expo Router auto-tracking by polling the internal router store
   * 
   * Supports both expo-router v3 (store.rootState) and v6+ (store.state, store.navigationRef)
   */
function trySetupExpoRouter(): boolean {
  try {
    const expoRouter = require('expo-router');
    const router = expoRouter.router;

    if (!router) {
      if (__DEV__) {
        logger.debug('Expo Router: router object not found');
      }
      return false;
    }

    if (__DEV__) {
      logger.debug('Expo Router: Setting up navigation tracking');
    }

    const { normalizeScreenName, getScreenNameFromPath } = require('./navigation');

    navigationPollingInterval = setInterval(() => {
      try {
        let state = null;
        let stateSource = '';
        if (typeof router.getState === 'function') {
          state = router.getState();
          stateSource = 'router.getState()';
        } else if ((router as any).rootState) {
          state = (router as any).rootState;
          stateSource = 'router.rootState';
        }

        if (!state) {
          try {
            const storeModule = require('expo-router/build/global-state/router-store');
            if (storeModule?.store) {
              state = storeModule.store.state;
              if (state) stateSource = 'store.state';

              if (!state && storeModule.store.navigationRef?.current) {
                state = storeModule.store.navigationRef.current.getRootState?.();
                if (state) stateSource = 'navigationRef.getRootState()';
              }

              if (!state) {
                state = storeModule.store.rootState || storeModule.store.initialState;
                if (state) stateSource = 'store.rootState/initialState';
              }
            }
          } catch {
            // Ignore
          }
        }

        if (!state) {
          try {
            const imperative = require('expo-router/build/imperative-api');
            if (imperative?.router) {
              state = imperative.router.getState?.();
              if (state) stateSource = 'imperative-api';
            }
          } catch {
            // Ignore
          }
        }

        if (state) {
          navigationPollingErrors = 0;
          navigationPollingErrors = 0;
          const screenName = extractScreenNameFromRouterState(state, getScreenNameFromPath, normalizeScreenName);
          if (screenName && screenName !== lastDetectedScreen) {
            if (__DEV__) {
              logger.debug('Screen changed:', lastDetectedScreen, '->', screenName, `(source: ${stateSource})`);
            }
            lastDetectedScreen = screenName;
            trackScreen(screenName);
          }
        } else {
          navigationPollingErrors++;
          if (__DEV__ && navigationPollingErrors === 1) {
            logger.debug('Expo Router: Could not get navigation state');
          }
          if (navigationPollingErrors >= MAX_POLLING_ERRORS) {
            cleanupNavigationTracking();
          }
        }
      } catch (e) {
        navigationPollingErrors++;
        if (__DEV__ && navigationPollingErrors === 1) {
          logger.debug('Expo Router polling error:', e);
        }
        if (navigationPollingErrors >= MAX_POLLING_ERRORS) {
          cleanupNavigationTracking();
        }
      }
    }, 500);

    return true;
  } catch (e) {
    if (__DEV__) {
      logger.debug('Expo Router not available:', e);
    }
    return false;
  }
}

/**
 * Extract screen name from Expo Router navigation state
 * 
 * Handles complex nested structures like Drawer → Tabs → Stack
 * by recursively accumulating segments from each navigation level.
 */
function extractScreenNameFromRouterState(
  state: any,
  getScreenNameFromPath: (path: string, segments: string[]) => string,
  normalizeScreenName: (name: string) => string,
  accumulatedSegments: string[] = []
): string | null {
  if (!state?.routes) return null;

  const route = state.routes[state.index ?? state.routes.length - 1];
  if (!route) return null;

  const newSegments = [...accumulatedSegments, route.name];

  if (route.state) {
    return extractScreenNameFromRouterState(
      route.state,
      getScreenNameFromPath,
      normalizeScreenName,
      newSegments
    );
  }

  const cleanSegments = newSegments.filter(s => !s.startsWith('(') && !s.endsWith(')'));

  if (cleanSegments.length === 0) {
    for (let i = newSegments.length - 1; i >= 0; i--) {
      const seg = newSegments[i];
      if (seg && !seg.startsWith('(') && !seg.endsWith(')')) {
        cleanSegments.push(seg);
        break;
      }
    }
  }

  const pathname = '/' + cleanSegments.join('/');
  return getScreenNameFromPath(pathname, newSegments);
}

/**
 * Cleanup navigation tracking
 */
function cleanupNavigationTracking(): void {
  if (navigationPollingInterval) {
    clearInterval(navigationPollingInterval);
    navigationPollingInterval = null;
  }
  navigationSetupDone = false;
  lastDetectedScreen = '';
  navigationPollingErrors = 0;
}

/**
 * Track a screen view
 * This updates JS metrics AND notifies the native module to send to backend
 */
export function trackScreen(screenName: string): void {
  if (!isInitialized) {
    if (__DEV__) {
      logger.debug('trackScreen called but not initialized, screen:', screenName);
    }
    return;
  }

  const previousScreen = currentScreen;
  currentScreen = screenName;
  screensVisited.push(screenName);

  const uniqueScreens = new Set(screensVisited);
  metrics.uniqueScreensCount = uniqueScreens.size;
  metrics.navigationCount++;
  metrics.totalEvents++;

  if (__DEV__) {
    logger.debug('trackScreen:', screenName, '(total screens:', metrics.uniqueScreensCount, ')');
  }

  if (onScreenChange) {
    onScreenChange(screenName, previousScreen);
  }

  try {
    const RejourneyNative = getRejourneyNativeModule();
    if (RejourneyNative?.screenChanged) {
      if (__DEV__) {
        logger.debug('Notifying native screenChanged:', screenName);
      }
      RejourneyNative.screenChanged(screenName).catch((e: Error) => {
        if (__DEV__) {
          logger.debug('Native screenChanged error:', e);
        }
      });
    } else if (__DEV__) {
      logger.debug('Native screenChanged method not available');
    }
  } catch (e) {
    if (__DEV__) {
      logger.debug('trackScreen native call error:', e);
    }
  }
}

/**
 * Track an API request with timing data
 */
export function trackAPIRequest(
  success: boolean,
  _statusCode: number,
  durationMs: number = 0,
  responseBytes: number = 0
): void {
  if (!isInitialized) return;

  metrics.apiTotalCount++;

  if (durationMs > 0) {
    metrics.netTotalDurationMs += durationMs;
  }
  if (responseBytes > 0) {
    metrics.netTotalBytes += responseBytes;
  }

  if (success) {
    metrics.apiSuccessCount++;
  } else {
    metrics.apiErrorCount++;
    metrics.errorCount++;
  }
}

/**
 * Create empty metrics object
 */
function createEmptyMetrics(): SessionMetrics {
  return {
    totalEvents: 0,
    touchCount: 0,
    scrollCount: 0,
    gestureCount: 0,
    inputCount: 0,
    navigationCount: 0,
    errorCount: 0,
    rageTapCount: 0,
    deadTapCount: 0,
    apiSuccessCount: 0,
    apiErrorCount: 0,
    apiTotalCount: 0,
    netTotalDurationMs: 0,
    netTotalBytes: 0,
    screensVisited: [],
    uniqueScreensCount: 0,
    interactionScore: 100,
    explorationScore: 100,
    uxScore: 100,
  };
}

/**
 * Track a scroll event
 */
export function trackScroll(): void {
  if (!isInitialized) return;
  metrics.scrollCount++;
  metrics.totalEvents++;
}

/**
 * Track a gesture event
 */
export function trackGesture(): void {
  if (!isInitialized) return;
  metrics.gestureCount++;
  metrics.totalEvents++;
}

/**
 * Track an input event (keyboard)
 */
export function trackInput(): void {
  if (!isInitialized) return;
  metrics.inputCount++;
  metrics.totalEvents++;
}

/**
 * Get current session metrics
 */
export function getSessionMetrics(): SessionMetrics & { netAvgDurationMs: number } {
  calculateScores();

  const netAvgDurationMs = metrics.apiTotalCount > 0
    ? Math.round(metrics.netTotalDurationMs / metrics.apiTotalCount)
    : 0;

  return {
    ...metrics,
    screensVisited: [...screensVisited],
    netAvgDurationMs,
  };
}

/**
 * Calculate session scores
 */
function calculateScores(): void {
  const totalInteractions =
    metrics.touchCount +
    metrics.scrollCount +
    metrics.gestureCount +
    metrics.inputCount;

  const avgInteractions = 50;
  metrics.interactionScore = Math.min(100, Math.round((totalInteractions / avgInteractions) * 100));

  const avgScreens = 5;
  metrics.explorationScore = Math.min(100, Math.round((metrics.uniqueScreensCount / avgScreens) * 100));

  let uxScore = 100;

  uxScore -= Math.min(30, metrics.errorCount * 15);

  uxScore -= Math.min(24, metrics.rageTapCount * 8);

  uxScore -= Math.min(16, metrics.deadTapCount * 4);

  uxScore -= Math.min(20, metrics.apiErrorCount * 10);

  if (metrics.uniqueScreensCount >= 3) {
    uxScore += 5;
  }

  metrics.uxScore = Math.max(0, Math.min(100, uxScore));
}

/**
 * Reset metrics for new session
 */
export function resetMetrics(): void {
  metrics = createEmptyMetrics();
  screensVisited = [];
  currentScreen = '';
  tapHead = 0;
  tapCount = 0;
  sessionStartTime = Date.now();
}

export function setMaxSessionDurationMinutes(minutes?: number): void {
  const clampedMinutes = Math.min(10, Math.max(1, minutes ?? 10));
  maxSessionDurationMs = clampedMinutes * 60 * 1000;
}
export function hasExceededMaxSessionDuration(): boolean {
  if (!sessionStartTime) return false;
  return Date.now() - sessionStartTime >= maxSessionDurationMs;
}

export function getRemainingSessionDurationMs(): number {
  if (!sessionStartTime) return maxSessionDurationMs;
  const remaining = maxSessionDurationMs - (Date.now() - sessionStartTime);
  return Math.max(0, remaining);
}

/**
 * Collect device information
 */
/**
 * Collect device information
 */
export async function collectDeviceInfo(): Promise<DeviceInfo> {
  const Dimensions = getDimensions();
  const Platform = getPlatform();

  let width = 0, height = 0, scale = 1;

  if (Dimensions) {
    const windowDims = Dimensions.get('window');
    const screenDims = Dimensions.get('screen');
    width = windowDims?.width || 0;
    height = windowDims?.height || 0;
    scale = screenDims?.scale || 1;
  }

  // Basic JS-side info
  let locale: string | undefined;
  let timezone: string | undefined;

  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    locale = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    // Ignore
  }

  // Get native info
  const nativeModule = getRejourneyNativeModule();
  let nativeInfo: any = {};

  if (nativeModule && nativeModule.getDeviceInfo) {
    try {
      nativeInfo = await nativeModule.getDeviceInfo();
    } catch (e) {
      if (__DEV__) {
        console.warn('[Rejourney] Failed to get native device info:', e);
      }
    }
  }

  return {
    model: nativeInfo.model || 'Unknown',
    manufacturer: nativeInfo.brand,
    os: (Platform?.OS || 'ios') as 'ios' | 'android',
    osVersion: nativeInfo.systemVersion || Platform?.Version?.toString() || 'Unknown',
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
    pixelRatio: scale,
    appVersion: nativeInfo.appVersion,
    appId: nativeInfo.bundleId,
    locale: locale,
    timezone: timezone,
  };
}

/**
 * Generate a persistent anonymous ID
 */
function generateAnonymousId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `anon_${timestamp}_${random}`;
}

/**
 * Get the anonymous ID (synchronous - returns generated ID immediately)
 */
export function getAnonymousId(): string {
  if (!anonymousId) {
    anonymousId = generateAnonymousId();
  }
  return anonymousId;
}

/**
 * Ensure a stable, persisted anonymous/device ID is available.
 * Returns the stored ID if present, otherwise generates and persists one.
 */
export async function ensurePersistentAnonymousId(): Promise<string> {
  if (anonymousId) return anonymousId;
  if (!anonymousIdPromise) {
    anonymousIdPromise = (async () => {
      const id = await loadAnonymousId();
      anonymousId = id;
      return id;
    })();
  }
  return anonymousIdPromise;
}

/**
 * Load anonymous ID from persistent storage
 * Call this at app startup for best results
 */
export async function loadAnonymousId(): Promise<string> {
  const nativeModule = getRejourneyNativeModule();
  if (nativeModule && nativeModule.getUserIdentity) {
    try {
      return await nativeModule.getUserIdentity() || generateAnonymousId();
    } catch {
      return generateAnonymousId();
    }
  }
  return generateAnonymousId();
}

/**
 * Set a custom anonymous ID
 */
export function setAnonymousId(id: string): void {
  anonymousId = id;
}

export default {
  init: initAutoTracking,
  cleanup: cleanupAutoTracking,
  trackTap,
  trackScroll,
  trackGesture,
  trackInput,
  trackScreen,
  trackAPIRequest,
  captureError,
  getMetrics: getSessionMetrics,
  resetMetrics,
  collectDeviceInfo,
  getAnonymousId,
  setAnonymousId,
  markTapHandled,
};
