/**
 * Rejourney SDK Types
 * Session recording and replay for React Native
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface RejourneyConfig {
  /** 
   * Public route key for authentication (required)
   * Get this from your Rejourney dashboard at https://rejourney.co
   * @example 'pk_live_xxxxxxxxxxxx'
   */
  publicRouteKey?: string;
  /** Project ID (UUID) required for ingest + auth */
  projectId?: string;
  /** iOS bundle identifier (for  verification) */
  bundleId?: string;
  /** Android package name (for  verification) */
  packageName?: string;

  /** Enable or disable recording (default: true) */
  enabled?: boolean;
  /** Visual capture FPS (default: 1 = capture every 1000ms) */
  captureFPS?: number;
  /** Maximum session duration in milliseconds (default: 30 minutes) */
  maxSessionDuration?: number;
  /** Maximum storage size in bytes (default: 50MB) */
  maxStorageSize?: number;
  /** Enable automatic screen name detection with React Navigation (default: true) */
  autoScreenTracking?: boolean;
  /** Enable automatic gesture detection (default: true) */
  autoGestureTracking?: boolean;
  /** Enable privacy occlusion for text inputs (default: true) */
  privacyOcclusion?: boolean;
  /** Enable compression for stored sessions (default: true) */
  enableCompression?: boolean;
  /** Skip captures during inactivity longer than this (ms) (default: 5000) */
  inactivityThreshold?: number;
  /** Disable recording in development mode (default: false) */
  disableInDev?: boolean;
  /** Enable rage tap detection (default: true) */
  detectRageTaps?: boolean;
  /** Rage tap threshold - number of taps in quick succession (default: 3) */
  rageTapThreshold?: number;
  /** Rage tap time window in ms (default: 1000) */
  rageTapTimeWindow?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  autoStartRecording?: boolean;
  /** API URL for session uploads (default: https://api.rejourney.co) */
  apiUrl?: string;
  /** Collect detailed device information (default: true) */
  collectDeviceInfo?: boolean;
  /** Collect IP address and geolocation data (default: true) */
  collectGeoLocation?: boolean;
  /** Delay after navigation before capturing (ms) - allows animations to complete (default: 300) */
  postNavigationDelay?: number;
  /** Delay after gestures/taps before capturing (ms) - shows result not animation (default: 200) */
  postGestureDelay?: number;
  /** Delay after modals/alerts before capturing (ms) - ensures full render (default: 400) */
  postModalDelay?: number;

  // ========================================================================
  // Authentication Callbacks
  // ========================================================================

  /**
   * Callback fired when device authentication fails with a security error.
   * This occurs when:
   * - Bundle ID mismatch (403): App's bundle ID doesn't match project configuration
   * - Project not found (404): Invalid project key
   * 
   * When this fires, recording is automatically stopped to prevent data accumulation.
   * Use this to notify users or log the issue.
   * 
   * @param error - Error details including code, message, and domain
   */
  onAuthError?: (error: { code: number; message: string; domain: string }) => void;

  // ========================================================================
  // Network Interception Options
  // ========================================================================

  /** 
   * Automatically intercept and log all network requests (fetch & XHR) (default: true)
   * When enabled, API calls are automatically tracked without any code changes.
   */
  autoTrackNetwork?: boolean;
  /** 
   * URLs to ignore when tracking network requests.
   * Useful for excluding analytics, logging, or other non-essential requests.
   * Can be strings (substring match) or RegExp patterns.
   * The dashboard URL is always ignored automatically.
   * @example ['analytics.google.com', /\.segment\.com/]
   */
  networkIgnoreUrls?: (string | RegExp)[];
  /**
   * Whether to capture request/response body sizes (default: true)
   * Disable if you want minimal network tracking overhead.
   */
  networkCaptureSizes?: boolean;
  /** 
   * Automatically intercept console.log, console.warn, and console.error and include them in session recordings.
   * Useful for debugging sessions. Capped at 1,000 logs per session. (default: true)
   */
  trackConsoleLogs?: boolean;
}
export type GestureType =
  | 'tap'
  | 'double_tap'
  | 'long_press'
  | 'force_touch'
  | 'swipe_left'
  | 'swipe_right'
  | 'swipe_up'
  | 'swipe_down'
  | 'pinch'
  | 'pinch_in'
  | 'pinch_out'
  | 'pan_up'
  | 'pan_down'
  | 'pan_left'
  | 'pan_right'
  | 'rotate_cw'
  | 'rotate_ccw'
  | 'scroll'
  | 'scroll_up'
  | 'scroll_down'
  | 'two_finger_tap'
  | 'three_finger_gesture'
  | 'multi_touch'
  | 'keyboard_tap'
  | 'rage_tap';

export type EventType =
  | 'gesture'
  | 'screen_change'
  | 'custom'
  | 'app_state'
  | 'app_lifecycle'
  | 'keyboard_show'
  | 'keyboard_hide'
  | 'keyboard_typing'
  | 'oauth_started'
  | 'oauth_completed'
  | 'oauth_returned'
  | 'external_url_opened'
  | 'session_start'
  | 'session_timeout'
  | 'frustration'
  | 'error';

export interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
  /** Force/pressure of the touch (0-1, for force touch/3D Touch) */
  force?: number;
}

export interface GestureEvent {
  type: 'gesture';
  gestureType: GestureType;
  timestamp: number;
  /** Touch coordinates */
  touches: TouchPoint[];
  /** Duration of the gesture in ms */
  duration?: number;
  /** Velocity for swipes */
  velocity?: { x: number; y: number };
  /** Scale for pinch gestures */
  scale?: number;
  /** Rotation angle in degrees (for rotation gestures) */
  rotation?: number;
  /** Max force applied (for force touch) */
  maxForce?: number;
  /** Number of fingers used */
  touchCount?: number;
  /** Target component identifier if available */
  targetId?: string;
  /** Accessibility label of target */
  targetLabel?: string;
}

export interface ScreenChangeEvent {
  type: 'screen_change';
  timestamp: number;
  /** Screen/route name */
  screenName: string;
  /** Previous screen name */
  previousScreenName?: string;
  /** Screen parameters */
  params?: Record<string, unknown>;
}

export interface CustomEvent {
  type: 'custom';
  timestamp: number;
  /** Event name */
  name: string;
  /** Event properties */
  properties?: Record<string, unknown>;
}

export interface AppStateEvent {
  type: 'app_state';
  timestamp: number;
  /** App state: active, background, inactive */
  state: 'active' | 'background' | 'inactive';
}

export interface AppLifecycleEvent {
  type: 'app_lifecycle';
  timestamp: number;
  /** Lifecycle state */
  state: 'app_foreground' | 'app_background' | 'app_terminated';
  /** Duration app was in background when returning to foreground (ms) */
  backgroundDuration?: number;
}

export interface KeyboardEvent {
  type: 'keyboard_show' | 'keyboard_hide';
  timestamp: number;
}

export interface KeyboardTypingEvent {
  type: 'keyboard_typing';
  timestamp: number;
  /** Number of key presses (content not captured for privacy) */
  keyPressCount: number;
}

export interface OAuthEvent {
  type: 'oauth_started' | 'oauth_completed' | 'oauth_returned';
  timestamp: number;
  /** OAuth provider name */
  provider?: string;
  /** OAuth URL scheme */
  scheme?: string;
  /** Whether OAuth was successful (for completed event) */
  success?: boolean;
}

export interface ExternalURLEvent {
  type: 'external_url_opened';
  timestamp: number;
  /** URL scheme that was opened */
  scheme: string;
}

export interface SessionTimeoutEvent {
  type: 'session_timeout';
  timestamp: number;
  /** Duration app was in background (ms) */
  backgroundDuration: number;
  /** Timeout threshold that was exceeded (ms) */
  timeoutThreshold: number;
  /** Reason for the timeout */
  reason: 'background_timeout';
}

export interface SessionStartEvent {
  type: 'session_start';
  timestamp: number;
  /** Previous session ID if this session was started due to timeout */
  previousSessionId?: string;
  /** Duration app was in background before new session (ms) */
  backgroundDuration?: number;
  /** Reason for starting new session */
  reason?: 'resumed_after_background_timeout' | 'user_initiated' | 'auto_start';
}

export interface FrustrationEvent {
  type: 'frustration';
  timestamp: number;
  /** Frustration type */
  frustrationKind: 'rage_tap' | 'ui_freeze' | 'error';
  /** Additional details */
  details?: Record<string, unknown>;
}

export interface ErrorEvent {
  type: 'error';
  timestamp: number;
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Error type/name */
  name?: string;
}

export interface NetworkRequestEvent {
  type: 'network_request';
  /** Unique request ID for correlating request/response */
  requestId: string;
  /** Timestamp when request started */
  timestamp: number;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  /** Request URL (may be truncated for efficiency) */
  url: string;
  /** URL path only (without domain, for grouping) */
  urlPath: string;
  /** URL domain/host */
  urlHost: string;
  /** Request headers (filtered for privacy, optional) */
  requestHeaders?: Record<string, string>;
  /** Request body size in bytes (not the actual body for privacy) */
  requestBodySize?: number;
  /** Content type of request */
  requestContentType?: string;
  /** HTTP status code (0 if request failed) */
  statusCode: number;
  /** Response headers (filtered for privacy, optional) */
  responseHeaders?: Record<string, string>;
  /** Response body size in bytes */
  responseBodySize?: number;
  /** Content type of response */
  responseContentType?: string;
  /** Duration of the request in ms */
  duration: number;
  /** Timestamp when response was received */
  endTimestamp: number;
  /** Whether the request succeeded (statusCode 2xx or 3xx) */
  success: boolean;
  /** Error message if request failed */
  errorMessage?: string;
  /** Whether this was a cached response */
  cached?: boolean;
  /** Screen where the request was initiated (if known) */
  screenName?: string;
}

export type SessionEvent =
  | GestureEvent
  | ScreenChangeEvent
  | CustomEvent
  | AppStateEvent
  | AppLifecycleEvent
  | KeyboardEvent
  | KeyboardTypingEvent
  | OAuthEvent
  | ExternalURLEvent
  | SessionTimeoutEvent
  | SessionStartEvent
  | FrustrationEvent
  | ErrorEvent
  | NetworkRequestEvent;

export interface GeoLocation {
  /** IP address */
  ip: string;
  /** Country name */
  country?: string;
  /** Country code (ISO 3166-1 alpha-2) */
  countryCode?: string;
  /** Region/State */
  region?: string;
  /** City */
  city?: string;
  /** Latitude */
  latitude?: number;
  /** Longitude */
  longitude?: number;
  /** Timezone */
  timezone?: string;
}

export interface DeviceInfo {
  /** Device model */
  model: string;
  /** Device manufacturer */
  manufacturer?: string;
  /** OS name */
  os: 'ios' | 'android';
  /** OS version */
  osVersion: string;
  /** Screen width */
  screenWidth: number;
  /** Screen height */
  screenHeight: number;
  /** Pixel density */
  pixelRatio: number;
  /** App version */
  appVersion?: string;
  /** App bundle/package ID */
  appId?: string;
  /** Device locale */
  locale?: string;
  /** Device timezone */
  timezone?: string;
  /** Total device memory (MB) */
  totalMemory?: number;
}

export interface SessionMetadata {
  /** Unique session ID */
  sessionId: string;
  /** User identity if set */
  userId?: string;
  /** Session start timestamp */
  startTime: number;
  /** Session end timestamp */
  endTime?: number;
  /** Session duration in ms */
  duration?: number;
  /** Device information */
  deviceInfo: DeviceInfo;
  /** Geolocation information */
  geoLocation?: GeoLocation;
  /** Number of events in session */
  eventCount: number;
  /** Total storage size in bytes */
  storageSize: number;
  /** Session tags */
  tags?: string[];
  /** SDK version */
  sdkVersion: string;
  /** Whether session is complete */
  isComplete: boolean;
}

export interface SessionData {
  /** Session metadata */
  metadata: SessionMetadata;
  /** Session events */
  events: SessionEvent[];
}

export interface SessionSummary {
  sessionId: string;
  userId?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  eventCount: number;
  storageSize: number;
  isComplete: boolean;
  filePath: string;
}

export interface ReplayState {
  /** Current playback position in ms from session start */
  currentTime: number;
  /** Is currently playing */
  isPlaying: boolean;
  /** Playback speed multiplier */
  speed: 0.5 | 1 | 2 | 4;
  /** Session duration */
  duration: number;
  /** Events at or near current time */
  activeEvents: SessionEvent[];
}

export interface ReplayControls {
  play: () => void;
  pause: () => void;
  seek: (timeMs: number) => void;
  setSpeed: (speed: 0.5 | 1 | 2 | 4) => void;
  skipInactivity: () => void;
  nextEvent: () => void;
  previousEvent: () => void;
}

export interface ReplayProps {
  /** Session ID to replay */
  sessionId: string;
  /** Auto-play on mount (default: false) */
  autoPlay?: boolean;
  /** Show controls (default: true) */
  showControls?: boolean;
  /** Show event markers on timeline (default: true) */
  showEventMarkers?: boolean;
  /** Show gesture overlays (default: true) */
  showGestureOverlays?: boolean;
  /** Initial playback speed (default: 1) */
  initialSpeed?: 0.5 | 1 | 2 | 4;
  /** Callback when playback ends */
  onEnd?: () => void;
  /** Callback when playback state changes */
  onStateChange?: (state: ReplayState) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Container style */
  style?: object;
}

export interface RejourneyNativeModule {
  /** Initialize the native SDK */
  initialize(config: RejourneyConfig): Promise<void>;
  /** Start recording session */
  startRecording(): Promise<string>;
  /** Stop recording session */
  stopRecording(): Promise<void>;
  /** Log a gesture event */
  logGesture(event: Omit<GestureEvent, 'type'>): Promise<void>;
  /** Set privacy occlusion for a view */
  setOccluded(viewTag: number, occluded: boolean): Promise<void>;
  /** Get device info */
  getDeviceInfo(): Promise<DeviceInfo>;
  /** Get all sessions */
  getSessions(): Promise<SessionSummary[]>;
  /** Get session data */
  getSessionData(sessionId: string): Promise<SessionData>;
  /** Delete a session */
  deleteSession(sessionId: string): Promise<void>;
  /** Delete all sessions */
  deleteAllSessions(): Promise<void>;
  /** Export session as shareable file */
  exportSession(sessionId: string): Promise<string>;
  /** Get current recording state */
  isRecording(): Promise<boolean>;
  /** Get storage usage */
  getStorageUsage(): Promise<{ used: number; max: number }>;
}

export interface RejourneyAPI {
  /** SDK version */
  readonly version: string;
  /** Internal method to start recording session (called by startRejourney) */
  _startSession(): Promise<boolean>;
  /** Internal method to stop recording session (called by stopRejourney) */
  _stopSession(): Promise<void>;
  /** Log a custom event */
  logEvent(name: string, properties?: Record<string, unknown>): void;
  /** Set user identity for session correlation */
  setUserIdentity(userId: string): void;
  /** Clear user identity */
  clearUserIdentity(): void;
  /** Tag current screen */
  tagScreen(screenName: string, params?: Record<string, unknown>): void;
  /** Mark a view as sensitive (will be occluded in recording) */
  setOccluded(viewRef: { current: any }, occluded?: boolean): void;
  /** Add a tag to current session */
  addSessionTag(tag: string): void;
  /** Mark a visual change that should be captured */
  markVisualChange(reason: string, importance?: 'low' | 'medium' | 'high' | 'critical'): Promise<boolean>;
  /** Report scroll event for timeline correlation */
  onScroll(scrollOffset: number): Promise<void>;
  /** Notify SDK that an OAuth flow is starting */
  onOAuthStarted(provider: string): Promise<boolean>;
  /** Notify SDK that an OAuth flow has completed */
  onOAuthCompleted(provider: string, success: boolean): Promise<boolean>;
  /** Notify SDK that an external URL is being opened */
  onExternalURLOpened(urlScheme: string): Promise<boolean>;
  /** 
   * Log a network request for API call timeline tracking.
   * This is a low-priority, efficient way to track API calls during session replay.
   * 
   * @param request - Network request details
   * @example
   * ```typescript
   * Rejourney.logNetworkRequest({
   *   request Id: 'req_123',
   *   method: 'POST',
   *   url: 'https://api.example.com/users',
   *   statusCode: 201,
   *   duration: 234,
   *   requestBodySize: 156,
   *   responseBodySize: 512,
   * });
   * ```
   */
  logNetworkRequest(request: NetworkRequestParams): void;
  /** Get all recorded sessions */
  getSessions(): Promise<SessionSummary[]>;
  /** Get session data for replay */
  getSessionData(sessionId: string): Promise<SessionData>;
  /** Delete a session */
  deleteSession(sessionId: string): Promise<void>;
  /** Delete all sessions */
  deleteAllSessions(): Promise<void>;
  /** Export session for sharing */
  exportSession(sessionId: string): Promise<string>;
  /** Check if currently recording */
  isRecording(): Promise<boolean>;
  /** Get storage usage */
  getStorageUsage(): Promise<{ used: number; max: number }>;

  /** 
   * Log customer feedback (e.g. from an in-app survey or NPS widget).
   * 
   * @param rating - Numeric rating (e.g. 1 to 5)
   * @param message - Associated feedback text or comment
   */
  logFeedback(rating: number, message: string): void;

  /** 
   * Get SDK telemetry metrics for observability

   * Returns metrics about SDK health including upload success rates,
   * retry attempts, circuit breaker events, and memory pressure.
   */
  getSDKMetrics(): Promise<SDKMetrics>;

  /**
   * Trigger a debug ANR (Dev only)
   * Blocks the main thread for the specified duration
   */
  debugTriggerANR(durationMs: number): void;

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
  maskView(nativeID: string): void;

  /**
   * Unmask a view by its nativeID prop
   * 
   * Removes the mask from a view that was previously masked with maskView().
   * 
   * @param nativeID - The nativeID prop of the view to unmask
   */
  unmaskView(nativeID: string): void;
}

/**
 * SDK telemetry metrics for observability
 */
export interface SDKMetrics {
  uploadSuccessCount: number;
  uploadFailureCount: number;
  retryAttemptCount: number;
  circuitBreakerOpenCount: number;
  memoryEvictionCount: number;
  offlinePersistCount: number;
  sessionStartCount: number;
  crashCount: number;
  uploadSuccessRate: number;
  avgUploadDurationMs: number;
  currentQueueDepth: number;
  lastUploadTime: number | null;
  lastRetryTime: number | null;
  totalBytesUploaded: number;
  totalBytesEvicted: number;
}

/**
 * Parameters for logging a network request
 */
export interface NetworkRequestParams {
  /** Unique request ID (optional, will be auto-generated if not provided) */
  requestId?: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  /** Full request URL */
  url: string;
  /** HTTP status code (0 if request failed/aborted) */
  statusCode: number;
  /** Request duration in milliseconds */
  duration: number;
  /** Timestamp when request started (optional, defaults to endTimestamp - duration) */
  startTimestamp?: number;
  /** Timestamp when response was received (optional, defaults to Date.now()) */
  endTimestamp?: number;
  /** Request body size in bytes (optional) */
  requestBodySize?: number;
  /** Response body size in bytes (optional) */
  responseBodySize?: number;
  /** Request content type (optional) */
  requestContentType?: string;
  /** Response content type (optional) */
  responseContentType?: string;
  /** Error message if request failed (optional) */
  errorMessage?: string;
  /** Whether response was from cache (optional) */
  cached?: boolean;
  /** Whether the request was successful (2xx/3xx status) */
  success?: boolean;
}

export interface UseRejourneyResult {
  /** Whether SDK is initialized */
  isInitialized: boolean;
  /** Whether currently recording */
  isRecording: boolean;
  /** Current session ID */
  currentSessionId: string | null;
  /** Start recording */
  startRecording: () => Promise<string>;
  /** Stop recording */
  stopRecording: () => Promise<void>;
  /** Log custom event */
  logEvent: (name: string, properties?: Record<string, unknown>) => void;
  /** Error if any */
  error: Error | null;
}

export interface UseReplayResult {
  /** Replay state */
  state: ReplayState;
  /** Replay controls */
  controls: ReplayControls;
  /** Session data */
  session: SessionData | null;
  /** Loading state */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
}
