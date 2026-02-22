/**
 * Rejourney - Session Recording and Replay SDK for React Native
 * 
 * Captures user interactions, gestures, and screen states for replay and analysis.
 * 
 * Just call initRejourney() - everything else is automatic!
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-APACHE for full terms.
 * 
 * @example
 * ```typescript
 * import { initRejourney } from 'rejourney';
 * 
 * // Initialize the SDK with your public key - that's it!
 * initRejourney('pk_live_xxxxxxxxxxxx');
 * 
 * // Or with options:
 * initRejourney('pk_live_xxxxxxxxxxxx', { debug: true });
 * ```
 */

// =============================================================================
// CRITICAL: Safe Module Loading for React Native 0.81+
// =============================================================================
// 
// On React Native 0.81+ with New Architecture (Bridgeless), importing from 
// 'react-native' at module load time can fail with "PlatformConstants could 
// not be found" because the TurboModule runtime may not be fully initialized.
//
// This wrapper ensures that all react-native imports happen after the runtime
// is ready, by catching any initialization errors and deferring actual SDK 
// operations until initRejourney() is called.
// =============================================================================

// Module load confirmation - this runs when the module is first imported

// SDK disabled flag - set to true if we detect runtime issues
let _sdkDisabled = false;

// Type-only imports are safe - they're erased at compile time
import type {
  RejourneyConfig,
  RejourneyAPI,
  SessionSummary,
  SessionData,
  NetworkRequestParams,
  SDKMetrics,
} from './types';
import type { Spec } from './NativeRejourney';

// SDK version is safe - no react-native imports
import { SDK_VERSION } from './sdk/constants';

// =============================================================================
// Lazy Module Loading
// =============================================================================
// All modules that import from 'react-native' are loaded lazily to avoid
// accessing TurboModuleRegistry before it's ready.

let _reactNativeLoaded = false;
let _RN: typeof import('react-native') | null = null;

function getReactNative(): typeof import('react-native') | null {
  if (_sdkDisabled) return null;
  if (_reactNativeLoaded) return _RN;

  try {
    _RN = require('react-native');
    _reactNativeLoaded = true;
    return _RN;
  } catch (error: any) {
    getLogger().warn('Failed to load react-native:', error?.message || error);
    _sdkDisabled = true;
    return null;
  }
}

let _logger: typeof import('./sdk/utils').logger | null = null;

function getLogger() {
  if (_logger) return _logger;
  if (_sdkDisabled) {
    return {
      debug: () => { },
      info: console.log.bind(console, '[Rejourney]'),
      warn: console.warn.bind(console, '[Rejourney]'),
      error: console.error.bind(console, '[Rejourney]'),
      logSessionStart: () => { },
      logSessionEnd: () => { },
      logInitSuccess: () => { },
      logInitFailure: () => { },
      setLogLevel: () => { },
      setDebugMode: () => { },
      logObservabilityStart: () => { },
      logRecordingStart: () => { },
      logRecordingRemoteDisabled: () => { },
      logInvalidProjectKey: () => { },
      logPackageMismatch: () => { },
      logNetworkRequest: () => { },
      logFrustration: () => { },
      logError: () => { },
      logUploadStats: () => { },
      logLifecycleEvent: () => { },
    };
  }

  try {
    const utils = require('./sdk/utils');
    _logger = utils.logger;
    return _logger!;
  } catch (error: any) {
    console.warn('[Rejourney] Failed to load logger:', error?.message || error);
    // Return fallback logger with working info
    return {
      debug: () => { },
      info: console.log.bind(console, '[Rejourney]'),
      warn: console.warn.bind(console, '[Rejourney]'),
      error: console.error.bind(console, '[Rejourney]'),
      logSessionStart: () => { },
      logSessionEnd: () => { },
      logInitSuccess: () => { },
      logInitFailure: () => { },
      setLogLevel: () => { },
      setDebugMode: () => { },
      logObservabilityStart: () => { },
      logRecordingStart: () => { },
      logRecordingRemoteDisabled: () => { },
      logInvalidProjectKey: () => { },
      logPackageMismatch: () => { },
      logNetworkRequest: () => { },
      logFrustration: () => { },
      logError: () => { },
      logUploadStats: () => { },
      logLifecycleEvent: () => { },
    };
  }
}

// Lazy-loaded network interceptor
let _networkInterceptor: {
  initNetworkInterceptor: typeof import('./sdk/networkInterceptor').initNetworkInterceptor;
  disableNetworkInterceptor: typeof import('./sdk/networkInterceptor').disableNetworkInterceptor;
} | null = null;

function getNetworkInterceptor() {
  if (_sdkDisabled) return { initNetworkInterceptor: () => { }, disableNetworkInterceptor: () => { } };
  if (_networkInterceptor) return _networkInterceptor;

  try {
    _networkInterceptor = require('./sdk/networkInterceptor');
    return _networkInterceptor!;
  } catch (error: any) {
    getLogger().warn('Failed to load network interceptor:', error?.message || error);
    return { initNetworkInterceptor: () => { }, disableNetworkInterceptor: () => { } };
  }
}

// Lazy-loaded auto tracking module
let _autoTracking: {
  initAutoTracking: typeof import('./sdk/autoTracking').initAutoTracking;
  cleanupAutoTracking: typeof import('./sdk/autoTracking').cleanupAutoTracking;
  trackScroll: typeof import('./sdk/autoTracking').trackScroll;
  trackScreen: typeof import('./sdk/autoTracking').trackScreen;
  trackAPIRequest: typeof import('./sdk/autoTracking').trackAPIRequest;
  notifyStateChange: typeof import('./sdk/autoTracking').notifyStateChange;
  getSessionMetrics: typeof import('./sdk/autoTracking').getSessionMetrics;
  resetMetrics: typeof import('./sdk/autoTracking').resetMetrics;
  collectDeviceInfo: typeof import('./sdk/autoTracking').collectDeviceInfo;
  ensurePersistentAnonymousId: typeof import('./sdk/autoTracking').ensurePersistentAnonymousId;
} | null = null;

// No-op auto tracking for when SDK is disabled
const noopAutoTracking = {
  initAutoTracking: () => { },
  cleanupAutoTracking: () => { },
  trackScroll: () => { },
  trackScreen: () => { },
  trackAPIRequest: () => { },
  notifyStateChange: () => { },
  getSessionMetrics: () => ({}),
  resetMetrics: () => { },
  collectDeviceInfo: async () => ({} as any),
  ensurePersistentAnonymousId: async () => 'anonymous',
};

function getAutoTracking() {
  if (_sdkDisabled) return noopAutoTracking;
  if (_autoTracking) return _autoTracking;

  try {
    _autoTracking = require('./sdk/autoTracking');
    return _autoTracking!;
  } catch (error: any) {
    getLogger().warn('Failed to load auto tracking:', error?.message || error);
    return noopAutoTracking;
  }
}

// State
let _isInitialized = false;
let _isRecording = false;
let _initializationFailed = false;
let _metricsInterval: ReturnType<typeof setInterval> | null = null;
let _appStateSubscription: { remove: () => void } | null = null;
let _authErrorSubscription: { remove: () => void } | null = null;
let _currentAppState: string = 'active'; // Default to active, will be updated on init
let _userIdentity: string | null = null;

// Scroll throttling - reduce native bridge calls from 60fps to at most 10/sec
let _lastScrollTime: number = 0;
let _lastScrollOffset: number = 0;
const SCROLL_THROTTLE_MS = 100;

// Helper to save/load user identity
// NOW HANDLED NATIVELY - No-op on JS side to avoid unnecessary bridge calls
async function persistUserIdentity(_identity: string | null): Promise<void> {
  // Native module handles persistence automatically in setUserIdentity
}

async function loadPersistedUserIdentity(): Promise<string | null> {
  try {
    const nativeModule = getRejourneyNative();
    if (!nativeModule) return null;

    // NATIVE STORAGE: Read directly from SharedPreferences/NSUserDefaults
    return await nativeModule.getUserIdentity();
  } catch {
    return null;
  }
}

let _storedConfig: RejourneyConfig | null = null;

// Remote config from backend - controls sample rate and enable/disable
interface RemoteConfig {
  projectId: string;
  rejourneyEnabled: boolean;
  recordingEnabled: boolean;
  sampleRate: number;
  maxRecordingMinutes: number;
  billingBlocked?: boolean;
  billingReason?: string;
}

// Result type for fetchRemoteConfig - distinguishes network errors from access denial
type ConfigFetchResult =
  | { status: 'success'; config: RemoteConfig }
  | { status: 'network_error' }  // Proceed with defaults (fail-open)
  | { status: 'access_denied'; httpStatus: number };  // Abort recording (fail-closed)

let _remoteConfig: RemoteConfig | null = null;
let _sessionSampledOut: boolean = false; // True = telemetry only, no visual replay capture

/**
 * Fetch project configuration from backend
 * This determines sample rate, enabled state, and other server-side settings
 */
async function fetchRemoteConfig(apiUrl: string, publicKey: string): Promise<ConfigFetchResult> {
  try {
    const RN = getReactNative();
    const platform = RN?.Platform?.OS || 'unknown';

    // Read actual bundleId/packageName from native module instead of hardcoding
    let bundleId: string | undefined;
    let packageName: string | undefined;
    try {
      const nativeModule = getRejourneyNative();
      if (nativeModule) {
        const deviceInfo = await nativeModule.getDeviceInfo() as Record<string, any>;
        if (platform === 'ios' && deviceInfo?.bundleId && deviceInfo.bundleId !== 'unknown') {
          bundleId = deviceInfo.bundleId;
        } else if (platform === 'android' && deviceInfo?.bundleId && deviceInfo.bundleId !== 'unknown') {
          packageName = deviceInfo.bundleId; // Android returns packageName as bundleId
        }
      }
    } catch {
      // If we can't get device info, skip bundle validation headers
      getLogger().debug('Could not read bundleId from native module');
    }

    const headers: Record<string, string> = {
      'x-public-key': publicKey,
      'x-platform': platform,
    };
    if (bundleId) headers['x-bundle-id'] = bundleId;
    if (packageName) headers['x-package-name'] = packageName;

    const response = await fetch(`${apiUrl}/api/sdk/config`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      // 401/403/404 = access denied (invalid key, project disabled, deleted, etc) - STOP recording
      // Other errors (500, etc) = server issue - treat as network error, proceed with defaults
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        getLogger().warn(`Access denied (${response.status}) - recording disabled`);
        return { status: 'access_denied', httpStatus: response.status };
      }
      getLogger().warn(`Config fetch failed: ${response.status}`);
      return { status: 'network_error' };
    }

    const config = await response.json();
    getLogger().debug('Remote config:', JSON.stringify(config));
    return { status: 'success', config: config as RemoteConfig };
  } catch (error) {
    // Network timeout, no connectivity, etc - proceed with defaults
    getLogger().warn('Failed to fetch remote config:', error);
    return { status: 'network_error' };
  }
}

/**
 * Determine if this session should be sampled (recorded)
 * Returns true if recording should proceed, false if sampled out
 */
function shouldRecordSession(sampleRate: number): boolean {
  // sampleRate is 0-100 (percentage)
  if (sampleRate >= 100) return true;
  if (sampleRate <= 0) return false;

  const randomValue = Math.random() * 100;
  return randomValue < sampleRate;
}

// Lazy-loaded native module reference
// We don't access TurboModuleRegistry at module load time to avoid
// "PlatformConstants could not be found" errors on RN 0.81+
let _rejourneyNative: Spec | null | undefined = undefined;
let _nativeModuleLogged = false;
let _runtimeReady = false;

/**
 * Check if the React Native runtime is ready for native module access.
 * This prevents crashes on RN 0.81+ where accessing modules too early fails.
 */
function isRuntimeReady(): boolean {
  if (_runtimeReady) return true;

  try {
    const RN = require('react-native');
    if (RN.NativeModules) {
      _runtimeReady = true;
      return true;
    }
  } catch {
    // Runtime not ready yet
  }
  return false;
}

/**
 * Get the native Rejourney module lazily.
 * 
 * This function defers access to TurboModuleRegistry/NativeModules until
 * the first time it's actually needed. This is critical for React Native 0.81+
 * where accessing TurboModuleRegistry at module load time can fail because
 * PlatformConstants and other core modules aren't yet initialized.
 * 
 * The function caches the result after the first call.
 */
function getRejourneyNative(): Spec | null {
  // Return cached result if already resolved
  if (_rejourneyNative !== undefined) {
    return _rejourneyNative;
  }

  // Check if runtime is ready before attempting to access native modules
  if (!isRuntimeReady()) {
    getLogger().debug('Rejourney: Runtime not ready, deferring native module access');
    return null;
  }

  try {
    const RN = require('react-native');
    const { NativeModules, TurboModuleRegistry } = RN;

    // Track how the module was loaded
    let loadedVia: 'TurboModules' | 'NativeModules' | 'none' = 'none';
    let nativeModule: Spec | null = null;

    // Try TurboModuleRegistry first (New Architecture)
    if (TurboModuleRegistry && typeof TurboModuleRegistry.get === 'function') {
      try {
        nativeModule = TurboModuleRegistry.get('Rejourney');
        if (nativeModule) {
          loadedVia = 'TurboModules';
        }
      } catch (turboError) {
        // TurboModuleRegistry.get failed, will try NativeModules
        getLogger().debug('TurboModuleRegistry.get failed:', turboError);
      }
    }

    // Fall back to NativeModules (Old Architecture / Interop Layer)
    if (!nativeModule && NativeModules) {
      nativeModule = NativeModules.Rejourney ?? null;
      if (nativeModule) {
        loadedVia = 'NativeModules';
      }
    }

    _rejourneyNative = nativeModule;

    // Log which method was used to load the module
    if (_rejourneyNative && !_nativeModuleLogged) {
      _nativeModuleLogged = true;

      // More accurate detection based on actual load method
      if (loadedVia === 'TurboModules') {
        getLogger().debug('Using New Architecture (TurboModules/JSI)');
      } else if (loadedVia === 'NativeModules') {
        // Check if we're in interop mode (New Arch with bridge fallback)
        const hasTurboProxy = !!(global as any).__turboModuleProxy;
        if (hasTurboProxy) {
          getLogger().debug('Using New Architecture (Interop Layer)');
        } else {
          getLogger().debug('Using Old Architecture (Bridge)');
        }
      }
    }
  } catch (error) {
    getLogger().warn('Rejourney: Failed to access native modules:', error);
    _rejourneyNative = null;
  }

  if (_rejourneyNative === undefined) {
    _rejourneyNative = null;
  }

  return _rejourneyNative;
}

/**
 * Safely call a native method with error handling
 * Never throws - logs errors and returns gracefully
 */
async function safeNativeCall<T>(
  methodName: string,
  fn: () => Promise<T>,
  defaultValue: T
): Promise<T> {
  const nativeModule = getRejourneyNative();
  if (!nativeModule || _initializationFailed) {
    return defaultValue;
  }
  try {
    return await fn();
  } catch (error) {
    getLogger().error(`Rejourney.${methodName} failed:`, error);
    return defaultValue;
  }
}

/**
 * Safely call a synchronous native method with error handling
 * Never throws - logs errors and returns gracefully
 */
function safeNativeCallSync<T>(
  methodName: string,
  fn: () => T,
  defaultValue: T
): T {
  const nativeModule = getRejourneyNative();
  if (!nativeModule || _initializationFailed) {
    return defaultValue;
  }
  try {
    return fn();
  } catch (error) {
    getLogger().error(`Rejourney.${methodName} failed:`, error);
    return defaultValue;
  }
}

/**
 * Main Rejourney API (Internal)
 */
const Rejourney: RejourneyAPI = {
  /**
   * SDK Version
   */
  version: SDK_VERSION,
  /**
   * Internal method to start recording session
   * Called by startRejourney() after user consent
   */
  async _startSession(): Promise<boolean> {
    getLogger().debug('_startSession() entered');

    if (!_storedConfig) {
      throw new Error('SDK not initialized. Call initRejourney() first.');
    }

    const nativeModule = getRejourneyNative();
    if (!nativeModule) {
      // Common causes:
      // - startRejourney() called too early (RN runtime not ready yet)
      // - native module not linked (pods/gradle/autolinking issue)
      getLogger().warn('Native module not available - cannot start recording');
      return false;
    }

    getLogger().debug('Native module found, checking if already recording...');

    if (_isRecording) {
      getLogger().warn('Recording already started');
      return false;
    }

    try {
      const apiUrl = _storedConfig.apiUrl || 'https://api.rejourney.co';
      const publicKey = _storedConfig.publicRouteKey || '';

      // =========================================================
      // STEP 1: Fetch remote config from backend
      // This determines if recording is enabled and at what rate
      // =========================================================
      const configResult = await fetchRemoteConfig(apiUrl, publicKey);

      // =========================================================
      // CASE 0: Access denied (401/403) - abort immediately
      // This means project disabled, invalid key, etc - HARD STOP
      // =========================================================
      if (configResult.status === 'access_denied') {
        getLogger().info(`Recording disabled - access denied (${configResult.httpStatus})`);
        return false;
      }

      // For success, extract the config; for network_error, proceed with null
      _remoteConfig = configResult.status === 'success' ? configResult.config : null;

      if (_remoteConfig) {
        // =========================================================
        // CASE 1: Rejourney completely disabled - abort early, nothing captured
        // This is the most performant case - no native calls made
        // =========================================================
        if (!_remoteConfig.rejourneyEnabled) {
          getLogger().logRecordingRemoteDisabled();
          getLogger().info('Rejourney disabled by project settings - no data captured');
          return false;
        }

        // =========================================================
        // CASE 2: Billing blocked - abort early, nothing captured
        // =========================================================
        if (_remoteConfig.billingBlocked) {
          getLogger().warn(`Recording blocked: ${_remoteConfig.billingReason || 'billing issue'}`);
          return false;
        }

        // =========================================================
        // CASE 3: Session sampled out - CONTINUE but disable REPLAY only
        // Telemetry, events, and crash tracking still work
        // =========================================================
        _sessionSampledOut = !shouldRecordSession(_remoteConfig.sampleRate ?? 100);
        if (_sessionSampledOut) {
          getLogger().info(`Session sampled out (rate: ${_remoteConfig.sampleRate}%) - telemetry only, no visual replay capture`);
        }

        // =========================================================
        // CASE 4: recordingEnabled=false in dashboard - telemetry only
        // Effective recording = dashboard setting AND not sampled out
        // =========================================================
        const effectiveRecordingEnabled = _remoteConfig.recordingEnabled && !_sessionSampledOut;

        // Pass config to native - this controls visual capture on/off
        await nativeModule.setRemoteConfig(
          _remoteConfig.rejourneyEnabled,
          effectiveRecordingEnabled,
          _remoteConfig.sampleRate,
          _remoteConfig.maxRecordingMinutes
        );
      } else {
        // Network error (not access denied) - proceed with defaults
        // This is "fail-open" behavior for temporary network issues
        getLogger().debug('Remote config unavailable (network issue), proceeding with defaults');
      }

      const deviceId = await getAutoTracking().ensurePersistentAnonymousId();

      if (!_userIdentity) {
        _userIdentity = await loadPersistedUserIdentity();
      }

      const userId = _userIdentity || deviceId;
      getLogger().debug(`userId=${userId.substring(0, 8)}...`);

      const result = await nativeModule.startSession(userId, apiUrl, publicKey);
      getLogger().debug('Native startSession returned:', JSON.stringify(result));

      if (!result?.success) {
        const reason = result?.error || 'Native startSession returned success=false';
        if (/disabled|blocked|not enabled/i.test(reason)) {
          getLogger().logRecordingRemoteDisabled();
        }
        getLogger().error('Native startSession failed:', reason);
        return false;
      }

      _isRecording = true;
      getLogger().debug(`✅ Session started: ${result.sessionId}`);
      getLogger().logSessionStart(result.sessionId);
      // Start polling for upload stats in dev mode
      if (__DEV__) {
        _metricsInterval = setInterval(async () => {
          if (!_isRecording) {
            if (_metricsInterval) clearInterval(_metricsInterval);
            return;
          }
          try {
            const native = getRejourneyNative();
            if (native) {
              const metrics = await native.getSDKMetrics();
              if (metrics) {
                getLogger().logUploadStats(metrics);
              }
            }
          } catch (e) {
            getLogger().debug('Failed to fetch metrics:', e);
          }
        }, 10000); // Poll more frequently in dev (10s) for better feedback
      }

      getAutoTracking().initAutoTracking(
        {
          rageTapThreshold: _storedConfig?.rageTapThreshold ?? 3,
          rageTapTimeWindow: _storedConfig?.rageTapTimeWindow ?? 500,
          rageTapRadius: 50,
          trackJSErrors: true,
          trackPromiseRejections: true,
          trackReactNativeErrors: true,
          trackConsoleLogs: _storedConfig?.trackConsoleLogs ?? true,
          collectDeviceInfo: _storedConfig?.collectDeviceInfo !== false,
        },
        {
          // Rage tap callback - log as frustration event
          onRageTap: (count: number, x: number, y: number) => {
            this.logEvent('frustration', {
              frustrationKind: 'rage_tap',
              tapCount: count,
              x,
              y,
            });
            getLogger().logFrustration(`Rage tap (${count} taps)`);
          },
          // Error callback - log as error event
          onError: (error: { message: string; stack?: string; name?: string }) => {
            this.logEvent('error', {
              message: error.message,
              stack: error.stack,
              name: error.name,
            });
            getLogger().logError(error.message);
          },
          onScreen: (_screenName: string, _previousScreen?: string) => {
          },
        }
      );

      if (_storedConfig?.collectDeviceInfo !== false) {
        try {
          const deviceInfo = await getAutoTracking().collectDeviceInfo();
          this.logEvent('device_info', deviceInfo as unknown as Record<string, unknown>);
        } catch (deviceError) {
          getLogger().warn('Failed to collect device info:', deviceError);
        }
      }

      if (_storedConfig?.autoTrackNetwork !== false) {
        try {
          // JS-level fetch/XHR patching is the primary mechanism for capturing network
          // calls within React Native. Native interceptors (RejourneyURLProtocol on iOS,
          // RejourneyNetworkInterceptor on Android) are supplementary — they capture
          // native-originated HTTP calls that bypass JS fetch(), but cannot intercept
          // RN's own networking since it creates its NSURLSession/OkHttpClient at init time.
          const ignoreUrls: (string | RegExp)[] = [
            apiUrl,
            '/api/sdk/config',
            '/api/ingest/presign',
            '/api/ingest/batch/complete',
            '/api/ingest/session/end',
            ...(_storedConfig?.networkIgnoreUrls || []),
          ];

          getNetworkInterceptor().initNetworkInterceptor(
            (request: NetworkRequestParams) => {
              getAutoTracking().trackAPIRequest(
                request.success || false,
                request.statusCode,
                request.duration || 0,
                request.responseBodySize || 0
              );
              Rejourney.logNetworkRequest(request);
            },
            {
              ignoreUrls,
              captureSizes: _storedConfig?.networkCaptureSizes !== false,
            }
          );

        } catch (networkError) {
          getLogger().warn('Failed to setup network interception:', networkError);
        }
      }


      return true;
    } catch (error) {
      getLogger().error('Failed to start recording:', error);
      _isRecording = false;
      return false;
    }
  },

  /**
   * Stop the current recording session
   */
  async _stopSession(): Promise<void> {
    if (!_isRecording) {
      getLogger().warn('No active recording to stop');
      return;
    }

    try {
      const metrics = getAutoTracking().getSessionMetrics();
      this.logEvent('session_metrics', metrics as unknown as Record<string, unknown>);

      getNetworkInterceptor().disableNetworkInterceptor();
      getAutoTracking().cleanupAutoTracking();
      getAutoTracking().resetMetrics();

      await safeNativeCall('stopSession', () => getRejourneyNative()!.stopSession(), undefined);

      if (_metricsInterval) {
        clearInterval(_metricsInterval);
        _metricsInterval = null;
      }

      _isRecording = false;
      getLogger().logSessionEnd('current');
    } catch (error) {
      getLogger().error('Failed to stop recording:', error);
    }
  },

  /**
   * Log a custom event
   * 
   * @param name - Event name
   * @param properties - Optional event properties
   * @example
   * Rejourney.logEvent('button_click', { buttonId: 'submit' });
   */
  logEvent(name: string, properties?: Record<string, unknown>): void {
    safeNativeCallSync(
      'logEvent',
      () => {
        getRejourneyNative()!.logEvent(name, properties || {}).catch(() => { });
      },
      undefined
    );
  },

  /**
   * Set user identity for session correlation
   * Associates current and future sessions with a user ID
   * 
   * @param userId - User identifier (e.g., email, username, or internal ID)
   * @example
   * Rejourney.setUserIdentity('user_12345');
   * Rejourney.setUserIdentity('john@example.com');
   */
  setUserIdentity(userId: string): void {
    _userIdentity = userId;
    persistUserIdentity(userId).catch(() => { });

    if (_isRecording && getRejourneyNative()) {
      safeNativeCallSync(
        'setUserIdentity',
        () => {
          getRejourneyNative()!.setUserIdentity(userId).catch(() => { });
        },
        undefined
      );
    }
  },

  /**
   * Clear user identity
   * Removes user association from future sessions
   */
  clearUserIdentity(): void {
    _userIdentity = null;
    persistUserIdentity(null).catch(() => { });

    if (_isRecording && getRejourneyNative()) {
      safeNativeCallSync(
        'setUserIdentity',
        () => {
          getRejourneyNative()!.setUserIdentity('anonymous').catch(() => { });
        },
        undefined
      );
    }
  },

  /**
   * Tag the current screen
   * 
   * @param screenName - Screen name
   * @param params - Optional screen parameters
   */
  tagScreen(screenName: string, _params?: Record<string, unknown>): void {
    getAutoTracking().trackScreen(screenName);
    getAutoTracking().notifyStateChange();

    safeNativeCallSync(
      'tagScreen',
      () => {
        getRejourneyNative()!.screenChanged(screenName).catch(() => { });
      },
      undefined
    );
  },

  /**
   * Mark a view as sensitive (will be occluded in recordings)
   * 
   * @param viewRef - React ref to the view
   * @param occluded - Whether to occlude (default: true)
   */
  setOccluded(_viewRef: { current: any }, _occluded: boolean = true): void {
    // No-op - occlusion handled automatically by native module
  },

  /**
   * Add a tag to the current session
   * 
   * @param tag - Tag string
   */
  addSessionTag(tag: string): void {
    this.logEvent('session_tag', { tag });
  },

  /**
   * Get all recorded sessions
   * 
   * @returns Array of session summaries (always empty - sessions on dashboard server)
   */
  async getSessions(): Promise<SessionSummary[]> {
    return [];
  },

  /**
   * Get session data for replay
   * 
   * @param sessionId - Session ID
   * @returns Session data (not implemented - use dashboard server)
   */
  async getSessionData(_sessionId: string): Promise<SessionData> {
    // Return empty session data - actual data should be fetched from dashboard server
    getLogger().warn('getSessionData not implemented - fetch from dashboard server');
    return {
      metadata: {
        sessionId: _sessionId,
        startTime: 0,
        endTime: 0,
        duration: 0,
        deviceInfo: { model: '', os: 'ios', osVersion: '', screenWidth: 0, screenHeight: 0, pixelRatio: 1 },
        eventCount: 0,
        storageSize: 0,
        sdkVersion: SDK_VERSION,
        isComplete: false,
      },
      events: [],
    };
  },

  /**
   * Delete a session
   * 
   * @param sessionId - Session ID
   */
  async deleteSession(_sessionId: string): Promise<void> {
    // No-op - session deletion handled by dashboard server
  },

  /**
   * Delete all sessions
   */
  async deleteAllSessions(): Promise<void> {
    // No-op - session deletion handled by dashboard server
  },

  /**
   * Export session for sharing
   * 
   * @param sessionId - Session ID
   * @returns Path to export file (not implemented)
   */
  async exportSession(_sessionId: string): Promise<string> {
    getLogger().warn('exportSession not implemented - export from dashboard server');
    return '';
  },

  /**
   * Check if currently recording
   * 
   * @returns Whether recording is active
   */
  async isRecording(): Promise<boolean> {
    return _isRecording;
  },

  /**
   * Get storage usage
   * 
   * @returns Storage usage info (always 0 - storage on dashboard server)
   */
  async getStorageUsage(): Promise<{ used: number; max: number }> {
    return { used: 0, max: 0 };
  },



  /**
   * Mark a visual change that should be captured
   * 
   * Use this when your app changes in a visually significant way that should be captured,
   * like showing a success message, updating a cart badge, or displaying an error.
   * 
   * @param reason - Description of what changed (e.g., 'cart_updated', 'error_shown')
   * @param importance - How important is this change? 'low', 'medium', 'high', or 'critical'
   * 
   * @example
   * ```typescript
   * // Mark that an error was shown (high importance)
   * await Rejourney.markVisualChange('checkout_error', 'high');
   * 
   * // Mark that a cart badge updated (medium importance)
   * await Rejourney.markVisualChange('cart_badge_update', 'medium');
   * ```
   */
  async markVisualChange(
    reason: string,
    importance: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<boolean> {
    return safeNativeCall(
      'markVisualChange',
      async () => {
        await getRejourneyNative()!.markVisualChange(reason, importance);
        return true;
      },
      false
    );
  },

  /**
   * Report a scroll event for visual replay timing
   * 
   * Call this from your ScrollView's onScroll handler to improve scroll capture.
   * The SDK captures visual replay frames continuously, and this helps log scroll events
   * for timeline correlation during replay.
   * 
   * @param scrollOffset - Current scroll offset (vertical or horizontal)
   * 
   * @example
   * ```typescript
   * <ScrollView
   *   onScroll={(e) => {
   *     Rejourney.onScroll(e.nativeEvent.contentOffset.y);
   *   }}
   *   scrollEventThrottle={16}
   * >
   *   {content}
   * </ScrollView>
   * ```
   */
  async onScroll(scrollOffset: number): Promise<void> {
    // Throttle scroll events to reduce native bridge traffic
    // Scroll events can fire at 60fps, but we only need ~10/sec for smooth replay
    const now = Date.now();
    const offsetDelta = Math.abs(scrollOffset - _lastScrollOffset);

    // Only forward to native if enough time passed OR significant scroll distance
    if (now - _lastScrollTime < SCROLL_THROTTLE_MS && offsetDelta < 50) {
      return;
    }

    _lastScrollTime = now;
    _lastScrollOffset = scrollOffset;

    // Track scroll for metrics
    getAutoTracking().trackScroll();

    await safeNativeCall(
      'onScroll',
      () => getRejourneyNative()!.onScroll(scrollOffset),
      undefined
    );
  },

  /**
   * Notify the SDK that an OAuth flow is starting
   * 
   * Call this before opening an OAuth URL (e.g., before opening Safari for Google/Apple sign-in).
   * This captures the current screen and marks the session as entering an OAuth flow.
   * 
   * @param provider - The OAuth provider name (e.g., 'google', 'apple', 'facebook')
   * 
   * @example
   * ```typescript
   * // Before opening OAuth URL
   * await Rejourney.onOAuthStarted('google');
   * await WebBrowser.openAuthSessionAsync(authUrl);
   * ```
   */
  async onOAuthStarted(provider: string): Promise<boolean> {
    return safeNativeCall(
      'onOAuthStarted',
      async () => {
        await getRejourneyNative()!.onOAuthStarted(provider);
        return true;
      },
      false
    );
  },

  /**
   * Notify the SDK that an OAuth flow has completed
   * 
   * Call this after the user returns from an OAuth flow (successful or not).
   * This captures the result screen and logs the OAuth outcome.
   * 
   * @param provider - The OAuth provider name (e.g., 'google', 'apple', 'facebook')
   * @param success - Whether the OAuth flow was successful
   * 
   * @example
   * ```typescript
   * // After OAuth returns
   * const result = await WebBrowser.openAuthSessionAsync(authUrl);
   * await Rejourney.onOAuthCompleted('google', result.type === 'success');
   * ```
   */
  async onOAuthCompleted(provider: string, success: boolean): Promise<boolean> {
    return safeNativeCall(
      'onOAuthCompleted',
      async () => {
        await getRejourneyNative()!.onOAuthCompleted(provider, success);
        return true;
      },
      false
    );
  },

  /**
   * Notify the SDK that an external URL is being opened
   * 
   * Call this when your app opens an external URL (browser, maps, phone, etc.).
   * This is automatically detected for app lifecycle events, but you can use this
   * for more granular tracking.
   * 
   * @param urlScheme - The URL scheme being opened (e.g., 'https', 'tel', 'maps')
   * 
   * @example
   * ```typescript
   * // Before opening external URL
   * await Rejourney.onExternalURLOpened('https');
   * Linking.openURL('https://example.com');
   * ```
   */
  async onExternalURLOpened(urlScheme: string): Promise<boolean> {
    return safeNativeCall(
      'onExternalURLOpened',
      async () => {
        await getRejourneyNative()!.onExternalURLOpened(urlScheme);
        return true;
      },
      false
    );
  },

  /**
   * Log a network request for API call timeline tracking
   * 
   * This is a low-priority, efficient way to track API calls during session replay.
   * Network requests are stored separately and displayed in a collapsible timeline
   * in the dashboard for easy correlation with user actions.
   * 
   * @param request - Network request parameters
   * 
   * @example
   * ```typescript
   * // After a fetch completes
   * const startTime = Date.now();
   * const response = await fetch('https://api.example.com/users', {
   *   method: 'POST',
   *   body: JSON.stringify(userData),
   * });
   * 
   * Rejourney.logNetworkRequest({
   *   method: 'POST',
   *   url: 'https://api.example.com/users',
   *   statusCode: response.status,
   *   duration: Date.now() - startTime,
   *   requestBodySize: JSON.stringify(userData).length,
   *   responseBodySize: (await response.text()).length,
   * });
   * ```
   */
  logNetworkRequest(request: NetworkRequestParams): void {
    safeNativeCallSync(
      'logNetworkRequest',
      () => {
        // Parse URL for efficient storage and grouping
        let urlPath = request.url;
        let urlHost = '';
        try {
          const parsedUrl = new URL(request.url);
          urlHost = parsedUrl.host;
          urlPath = parsedUrl.pathname + parsedUrl.search;
        } catch {
          // If URL parsing fails, use the full URL as path
        }

        const endTimestamp = request.endTimestamp || Date.now();
        const startTimestamp = request.startTimestamp || (endTimestamp - request.duration);
        const success = request.statusCode >= 200 && request.statusCode < 400;

        // Create the network request event
        const networkEvent = {
          type: 'network_request',
          requestId: request.requestId || `req_${startTimestamp}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: startTimestamp,
          method: request.method,
          url: request.url.length > 500 ? request.url.substring(0, 500) : request.url, // Truncate long URLs
          urlPath,
          urlHost,
          statusCode: request.statusCode,
          duration: request.duration,
          endTimestamp,
          success,
          requestBodySize: request.requestBodySize,
          responseBodySize: request.responseBodySize,
          requestContentType: request.requestContentType,
          responseContentType: request.responseContentType,
          errorMessage: request.errorMessage,
          cached: request.cached,
        };

        getRejourneyNative()!.logEvent('network_request', networkEvent).catch(() => { });
      },
      undefined
    );
  },

  /**
   * Log customer feedback (e.g. from an in-app survey or NPS widget).
   * 
   * @param rating - Numeric rating (e.g. 1 to 5)
   * @param message - Associated feedback text or comment
   */
  logFeedback(rating: number, message: string): void {
    safeNativeCallSync(
      'logFeedback',
      () => {
        const feedbackEvent = {
          type: 'feedback',
          timestamp: Date.now(),
          rating,
          message,
        };
        getRejourneyNative()!.logEvent('feedback', feedbackEvent).catch(() => { });
      },
      undefined
    );
  },

  /**
   * Get SDK telemetry metrics for observability
   * 
   * Returns metrics about SDK health including upload success rates,
   * retry attempts, circuit breaker events, and memory pressure.
   * 
   * @returns SDK telemetry metrics
   * 
   * @example
   * ```typescript
   * const metrics = await Rejourney.getSDKMetrics();
   * console.log(`Upload success rate: ${(metrics.uploadSuccessRate * 100).toFixed(1)}%`);
   * console.log(`Circuit breaker opens: ${metrics.circuitBreakerOpenCount}`);
   * ```
   */
  async getSDKMetrics(): Promise<SDKMetrics> {
    return safeNativeCall(
      'getSDKMetrics',
      () => getRejourneyNative()!.getSDKMetrics(),
      {
        uploadSuccessCount: 0,
        uploadFailureCount: 0,
        retryAttemptCount: 0,
        circuitBreakerOpenCount: 0,
        memoryEvictionCount: 0,
        offlinePersistCount: 0,
        sessionStartCount: 0,
        crashCount: 0,
        uploadSuccessRate: 1.0,
        avgUploadDurationMs: 0,
        currentQueueDepth: 0,
        lastUploadTime: null,
        lastRetryTime: null,
        totalBytesUploaded: 0,
        totalBytesEvicted: 0,
      }
    );
  },

  /**
   * Trigger a debug ANR (Dev only)
   * Blocks the main thread for the specified duration
   */
  debugTriggerANR(durationMs: number): void {
    if (__DEV__) {
      safeNativeCallSync(
        'debugTriggerANR',
        () => {
          getRejourneyNative()!.debugTriggerANR(durationMs);
        },
        undefined
      );
    } else {
      getLogger().warn('debugTriggerANR is only available in development mode');
    }
  },

  /**
   * Mask a view by its nativeID prop (will be occluded in recordings)
   * 
   * Use this to mask any sensitive content that isn't a text input.
   * The view must have a `nativeID` prop set.
   * 
   * @param nativeID - The nativeID prop of the view to mask
   * @example
   * ```tsx
   * // In your component
   * <View nativeID="sensitiveCard">...</View>
   * 
   * // To mask it
   * Rejourney.maskView('sensitiveCard');
   * ```
   */
  maskView(nativeID: string): void {
    safeNativeCallSync(
      'maskView',
      () => {
        getRejourneyNative()!.maskViewByNativeID(nativeID).catch(() => { });
      },
      undefined
    );
  },

  /**
   * Unmask a view by its nativeID prop
   * 
   * Removes the mask from a view that was previously masked with maskView().
   * 
   * @param nativeID - The nativeID prop of the view to unmask
   */
  unmaskView(nativeID: string): void {
    safeNativeCallSync(
      'unmaskView',
      () => {
        getRejourneyNative()!.unmaskViewByNativeID(nativeID).catch(() => { });
      },
      undefined
    );
  },
};

/**
 * Handle app state changes for automatic session management
 * - Pauses recording when app goes to background
 * - Resumes recording when app comes back to foreground
 * - Cleans up properly when app is terminated
 */
function handleAppStateChange(nextAppState: string): void {
  if (!_isInitialized || _initializationFailed) return;

  try {
    if (_currentAppState.match(/active/) && nextAppState === 'background') {
      // App going to background - native module handles this automatically
      getLogger().logLifecycleEvent('App moving to background');
    } else if (_currentAppState.match(/inactive|background/) && nextAppState === 'active') {
      // App coming back to foreground
      getLogger().logLifecycleEvent('App returning to foreground');
    }
    _currentAppState = nextAppState;
  } catch (error) {
    getLogger().warn('Error handling app state change:', error);
  }
}

/**
 * Setup automatic lifecycle management
 * Handles cleanup when the app unmounts or goes to background
 */
function setupLifecycleManagement(): void {
  if (_sdkDisabled) return;

  const RN = getReactNative();
  if (!RN) return;

  if (_appStateSubscription) {
    _appStateSubscription.remove();
    _appStateSubscription = null;
  }

  try {
    _currentAppState = RN.AppState.currentState || 'active';
    _appStateSubscription = RN.AppState.addEventListener('change', handleAppStateChange);
    setupAuthErrorListener();

    getLogger().debug('Lifecycle management enabled');
  } catch (error) {
    getLogger().warn('Failed to setup lifecycle management:', error);
  }
}

/**
 * Setup listener for authentication errors from native module
 * This handles security errors like bundle ID mismatch
 */
function setupAuthErrorListener(): void {
  if (_sdkDisabled) return;

  const RN = getReactNative();
  if (!RN) return;

  if (_authErrorSubscription) {
    _authErrorSubscription.remove();
    _authErrorSubscription = null;
  }

  try {
    const nativeModule = getRejourneyNative();
    if (nativeModule) {
      const maybeAny = nativeModule as any;
      const hasEventEmitterHooks =
        typeof maybeAny?.addListener === 'function' && typeof maybeAny?.removeListeners === 'function';

      const eventEmitter = hasEventEmitterHooks
        ? new RN.NativeEventEmitter(maybeAny)
        : new RN.NativeEventEmitter();

      _authErrorSubscription = eventEmitter.addListener(
        'rejourneyAuthError',
        (error: { code: number; message: string; domain: string }) => {
          getLogger().error('Authentication error from native:', error);

          if (error?.code === 403) {
            getLogger().logPackageMismatch();
          } else if (error?.code === 404) {
            getLogger().logInvalidProjectKey();
          }

          _isRecording = false;

          if (_storedConfig?.onAuthError) {
            try {
              _storedConfig.onAuthError(error);
            } catch (callbackError) {
              getLogger().warn('Error in onAuthError callback:', callbackError);
            }
          }
        }
      );
    }
  } catch (error) {
    getLogger().debug('Auth error listener not available:', error);
  }
}

/**
 * Cleanup lifecycle management
 */
function cleanupLifecycleManagement(): void {
  if (_appStateSubscription) {
    _appStateSubscription.remove();
    _appStateSubscription = null;
  }
  if (_authErrorSubscription) {
    _authErrorSubscription.remove();
    _authErrorSubscription = null;
  }
}

/**
 * Initialize Rejourney SDK - STEP 1 of 3
 * 
 * This sets up the SDK, handles attestation, and prepares for recording,
 * but does NOT start recording automatically. Call startRejourney() after
 * obtaining user consent to begin recording.
 * 
 * @param publicRouteKey - Your public route key from the Rejourney dashboard
 * @param options - Optional configuration options
 * 
 * @example
 * ```typescript
 * import { initRejourney, startRejourney } from 'rejourney';
 * 
 * // Step 1: Initialize SDK (safe to call on app start)
 * initRejourney('pk_live_xxxxxxxxxxxx');
 * 
 * // Step 2: After obtaining user consent
 * startRejourney();
 * 
 * // With options
 * initRejourney('pk_live_xxxxxxxxxxxx', {
 *   debug: true,
 *   apiUrl: 'https://api.yourdomain.com',
 *   projectId: 'your-project-id',
 * });
 * ```
 */
export function initRejourney(
  publicRouteKey: string,
  options?: Omit<RejourneyConfig, 'publicRouteKey'>
): void {
  if (!publicRouteKey || typeof publicRouteKey !== 'string') {
    getLogger().warn('Rejourney: Invalid public route key provided. SDK will be disabled.');
    _initializationFailed = true;
    return;
  }

  _storedConfig = {
    ...options,
    publicRouteKey,
  };

  if (options?.debug) {
    getLogger().setDebugMode(true);
    const nativeModule = getRejourneyNative();
    if (nativeModule) {
      nativeModule.setDebugMode(true).catch(() => { });
    }
  }

  _isInitialized = true;

  (async () => {
    try {
      setupLifecycleManagement();
      getLogger().logObservabilityStart();
      getLogger().logInitSuccess(SDK_VERSION);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      getLogger().logInitFailure(reason);
      _initializationFailed = true;
      _isInitialized = false;
    }
  })();
}

/**
 * Start recording - STEP 2 of 3 (call after user consent)
 * 
 * Begins session recording. Call this after obtaining user consent for recording.
 * 
 * @example
 * ```typescript
 * import { initRejourney, startRejourney } from 'rejourney';
 * 
 * initRejourney('pk_live_xxxxxxxxxxxx');
 * 
 * // After user accepts consent dialog
 * startRejourney();
 * ```
 */
export function startRejourney(): void {
  getLogger().debug('startRejourney() called');

  if (!_isInitialized) {
    getLogger().warn('Not initialized - call initRejourney() first');
    return;
  }

  if (_initializationFailed) {
    getLogger().warn('Initialization failed - cannot start recording');
    return;
  }

  getLogger().logRecordingStart();
  getLogger().debug('Starting session...');

  (async () => {
    try {
      const started = await Rejourney._startSession();
      if (started) {
        getLogger().debug('✅ Recording started successfully');
      } else {
        getLogger().warn('Recording not started');
      }
    } catch (error) {
      getLogger().error('Failed to start recording:', error);
    }
  })();
}

/**
 * Stop recording and cleanup all resources.
 * 
 * Note: This is usually not needed as the SDK handles cleanup automatically.
 * Only call this if you want to explicitly stop recording.
 */
export function stopRejourney(): void {
  try {
    cleanupLifecycleManagement();
    Rejourney._stopSession();
    _isRecording = false;
    getLogger().debug('Rejourney stopped');
  } catch (error) {
    getLogger().warn('Error stopping Rejourney:', error);
  }
}

export default Rejourney;

export * from './types';

export {
  trackTap,
  trackScroll,
  trackGesture,
  trackInput,
  trackScreen,
  captureError,
  getSessionMetrics,
} from './sdk/autoTracking';

export { trackNavigationState, useNavigationTracking } from './sdk/autoTracking';

export { LogLevel } from './sdk/utils';

/**
 * Configure SDK log verbosity.
 * 
 * By default, the SDK logs minimally to avoid polluting your app's console:
 * - Production/Release: SILENT (no logs at all)
 * - Development/Debug: Only critical errors shown
 * 
 * Essential lifecycle events (init success, session start/end) are automatically
 * logged in debug builds only - you don't need to configure anything.
 * 
 * Use this function only if you need to troubleshoot SDK behavior.
 * 
 * @param level - Minimum log level to display
 * 
 * @example
 * ```typescript
 * import { setLogLevel, LogLevel } from 'rejourney';
 * 
 * // Enable verbose logging for SDK debugging (not recommended for regular use)
 * setLogLevel(LogLevel.DEBUG);
 * 
 * // Show warnings and errors (for troubleshooting)
 * setLogLevel(LogLevel.WARNING);
 * 
 * // Silence all logs (default behavior in production)
 * setLogLevel(LogLevel.SILENT);
 * ```
 */
export function setLogLevel(level: number): void {
  getLogger().setLogLevel(level);
}

export { Mask } from './components/Mask';
