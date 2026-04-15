import {
  User,
  Project,
  RecordingSession,
  SessionEvent,
  ApiCall,
  TimeRange,
  ProjectDailyStats,
  Issue,
  IssueSession
} from "~/shared/types";
import { isUuid } from "~/shared/lib/ids";
import * as demoApiData from '~/shared/data/demoApiData';
import { demoSessions } from '~/shared/data/demoData';

// Re-export types for consumers
export type { IssueSession };

/**
 * Rejourney API Service
 * 
 * Connects the web-ui dashboard to the real session data server.
 * Handles fetching, caching, and transforming session data.
 */

/**
 * Check if currently in demo mode (URL-based detection)
 * 
 * @deprecated Components should use `useDemoMode()` hook from DemoModeContext
 * or the hooks in `~/hooks/useApi.ts` instead of calling API functions directly.
 * This function exists as a fallback for SSR and non-hook contexts.
 * 
 * The proper approach:
 * - Use DemoModeProvider to wrap demo routes (sets isDemoMode: true via context)
 * - Components use useDemoMode() or useSessionsApi/useDashboardApi hooks
 * - This function is the SSR-safe fallback when context isn't available
 */
function isDemoMode(): boolean {
  if (typeof window !== 'undefined') {
    return window.location.pathname.startsWith('/demo');
  }
  return false;
}

// ... existing code ...

// Import centralized config
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';

function withDefaultHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const csrf = getCsrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  return headers;
}

function handleUnauthorized() {
  cache.clear();
  if (typeof window === 'undefined') return;

  // Never redirect to login from demo routes
  if (window.location.pathname.startsWith('/demo')) {
    return;
  }

  // Public routes that should NOT force a login redirect
  const publicPaths = new Set([
    '/',
    '/login',
    '/docs',
    '/engineering',
    '/pricing',
    '/terms-of-service',
    '/privacy-policy'
  ]);

  if (!publicPaths.has(window.location.pathname)) {
    window.location.href = '/login';
  }
}

async function fetchJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = withDefaultHeaders(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const requestInit: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };
  const method = (requestInit.method ?? 'GET').toUpperCase();
  if ((method === 'GET' || method === 'HEAD') && !requestInit.cache) {
    requestInit.cache = 'no-store';
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, requestInit);

  if (response.status === 401 || response.status === 403) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (typeof window !== 'undefined') {
      console.error('[fetchJson] API error', {
        method,
        endpoint,
        status: response.status,
        statusText: response.statusText,
        body: parsed ?? text,
      });
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof (parsed as { message: unknown }).message === 'string'
    ) {
      throw new Error((parsed as { message: string }).message);
    }
    throw new Error(`API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  if (response.status === 204) return undefined as unknown as T;
  return response.json() as Promise<T>;
}

/** True for errors that often clear after idle (stale connections, LB blips). */
function isTransientApiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === 'Unauthorized') return false;
  const msg = err.message;
  if (/Failed to fetch|NetworkError|Load failed|network error|timed out/i.test(msg)) return true;
  if (/^API error: 502\b|^API error: 503\b|^API error: 504\b/i.test(msg)) return true;
  return false;
}

async function fetchJsonWithTransientRetry<T>(
  endpoint: string,
  options: RequestInit = {},
  maxAttempts = 3
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fetchJson<T>(endpoint, options);
    } catch (e) {
      last = e;
      if (attempt === maxAttempts - 1 || !isTransientApiError(e)) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw last;
}

// Cache for API responses
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds - helps tab switching feel instant when returning
const PROJECTS_CACHE_TTL = 30000;
const WORKSPACE_CACHE_TTL = 120000; // 2 minutes - workspace rarely changes

/**
 * Fetch with caching and error handling
 */
async function fetchWithCache<T>(
  endpoint: string,
  options: RequestInit = {},
  cacheKey?: string,
  ttlMs?: number
): Promise<T> {
  const key = cacheKey || endpoint;
  const ttl = ttlMs ?? CACHE_TTL;

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }

  const data = await fetchJson<T>(endpoint, options);

  // Cache successful responses
  cache.set(key, { data, timestamp: Date.now() });

  return data as T;
}

/**
 * Clear cache for a specific key or all cache
 */
export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

export function clearCacheMatching(predicate: (key: string) => boolean): void {
  for (const key of cache.keys()) {
    if (predicate(key)) {
      cache.delete(key);
    }
  }
}

export function clearCacheByPrefixes(prefixes: string[]): void {
  if (prefixes.length === 0) return;
  clearCacheMatching((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

// =============================================================================
// Types for API Responses
// =============================================================================

export interface ApiSession {
  id: string;
  userId: string;
  hasSuccessfulRecording?: boolean;
  deviceInfo: {
    model?: string;
    manufacturer?: string;
    os?: string;
    osVersion?: string;
    screenWidth?: number;
    screenHeight?: number;
    pixelRatio?: number;
    appVersion?: string;
    locale?: string;
    timezone?: string;
  };
  geoLocation?: {
    ip?: string;
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
  startTime: number;
  endTime?: number;
  duration?: number;
  events: any[];
  networkRequests: any[];
  batches: any[];
  screenshotFrames?: Array<{
    timestamp: number;
    url: string;
    index: number;
  }>;
  screenshotFramesStatus?: 'ready' | 'preparing' | 'none';
  screenshotFrameCount?: number;
  screenshotFramesProcessedSegments?: number;
  screenshotFramesTotalSegments?: number;
  playbackMode?: 'screenshots' | 'video' | 'none';
  stats: {
    duration: string;
    durationMinutes: string;
    eventCount: number;
    screenshotSegmentCount?: number;
    totalSizeKB: string;
    kbPerMinute: string;
    eventsSizeKB: string;
    screenshotSizeKB?: string;
    networkStats: {
      total: number;
      successful: number;
      failed: number;
      avgDuration: number;
      totalBytes: number;
    };
  };
  // Metrics from SDK auto tracking
  metrics?: {
    totalEvents: number;
    touchCount: number;
    scrollCount: number;
    gestureCount: number;
    inputCount: number;
    navigationCount: number;
    errorCount: number;
    rageTapCount: number;
    apiSuccessCount: number;
    apiErrorCount: number;
    apiTotalCount: number;
    screensVisited: string[];
    uniqueScreensCount: number;
    interactionScore: number;
    explorationScore: number;
    rageTaps: number;
    customEventCount?: number;
    crashCount?: number;
  };
  effectiveStatus?: 'pending' | 'processing' | 'ready' | 'failed' | 'deleted' | 'recording' | 'error';
  isLiveIngest?: boolean;
  isBackgroundProcessing?: boolean;
  canOpenReplay?: boolean;
}

export interface ApiSessionSummary {
  id: string;
  userId: string;
  hasSuccessfulRecording?: boolean;
  deviceInfo: ApiSession['deviceInfo'];
  geoLocation?: ApiSession['geoLocation'];
  startTime: number;
  endTime?: number;
  durationSeconds?: number;
  platform?: string;
  appVersion?: string;
  deviceModel?: string;
  touchCount?: number;
  scrollCount?: number;
  gestureCount?: number;
  inputCount?: number;
  errorCount?: number;
  rageTapCount?: number;
  apiSuccessCount?: number;
  apiErrorCount?: number;
  apiTotalCount?: number;
  crashCount?: number;
  anrCount?: number;
  apiAvgResponseMs?: number;
  appStartupTimeMs?: number;
  interactionScore?: number;
  explorationScore?: number;
  screensVisited?: string[];
  funnelCompleted?: boolean;
  deepestFunnelStep?: number;
  stats: ApiSession['stats'];
  metrics?: ApiSession['metrics'];
  effectiveStatus?: ApiSession['effectiveStatus'];
  isLiveIngest?: boolean;
  isBackgroundProcessing?: boolean;
  canOpenReplay?: boolean;
}

export interface DashboardStats {
  totalSessions: number;
  avgDuration: number;
  errorRate: number;
  funnelCompletionRate: number;
  avgFunnelStep: number;
  activeUsers: number;
  activeUsersTrend: number;
  avgDurationTrend: number;
  errorRateTrend: number;
  dau?: number;
  wau?: number;
  mau?: number;
  engagementSegments?: {
    bouncers: number;
    casuals: number;
    explorers: number;
    loyalists: number;
  };
  /** Last date (YYYY-MM-DD) for which rollups are complete. Metrics exclude days after this. */
  dataCompleteThrough?: string;
}

// =============================================================================
// API Functions
// =============================================================================

/**
/**
 * Get all sessions
 */
export async function getSessions(): Promise<ApiSessionSummary[]> {
  const response = await fetchWithCache<{ sessions: ApiSessionSummary[] }>('/api/sessions');
  return response.sessions || [];
}

/**
 * Get a specific session by ID
 */
export async function getSession(sessionId: string): Promise<ApiSession> {
  // Demo mode: check for mock session
  if (isDemoMode()) {
    return demoApiData.demoFullSession as unknown as ApiSession;
  }
  return fetchWithCache<ApiSession>(`/api/session/${sessionId}`);
}

export interface ApiSessionTimeline {
  events: any[];
  networkRequests: any[];
  crashes: any[];
  anrs: any[];
}

export interface ApiSessionHierarchy {
  hierarchySnapshots: any[];
}

export interface ApiSessionStats {
  stats: ApiSession['stats'];
}

export interface ApiSessionFrames {
  screenshotFrames: Array<{
    timestamp: number;
    url: string;
    index: number;
  }>;
  screenshotFramesStatus: 'ready' | 'preparing' | 'none';
  screenshotFrameCount: number;
  screenshotFramesProcessedSegments: number;
  screenshotFramesTotalSegments: number;
}

export async function getSessionCore(
  sessionId: string,
  options?: { frameUrlMode?: 'signed' | 'proxy' | 'none' }
): Promise<ApiSession> {
  if (isDemoMode()) {
    return demoApiData.demoFullSession as unknown as ApiSession;
  }
  const params = new URLSearchParams();
  if (options?.frameUrlMode) params.set('frameUrlMode', options.frameUrlMode);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchWithCache<ApiSession>(`/api/session/${sessionId}/core${suffix}`);
}

export async function getSessionFrames(
  sessionId: string,
  options?: { frameUrlMode?: 'signed' | 'proxy' | 'none' }
): Promise<ApiSessionFrames> {
  if (isDemoMode()) {
    const demo = demoApiData.demoFullSession as any;
    return {
      screenshotFrames: demo.screenshotFrames || [],
      screenshotFramesStatus: demo.screenshotFramesStatus || 'none',
      screenshotFrameCount: demo.screenshotFrameCount || demo.screenshotFrames?.length || 0,
      screenshotFramesProcessedSegments: demo.screenshotFramesProcessedSegments || 0,
      screenshotFramesTotalSegments: demo.screenshotFramesTotalSegments || 0,
    };
  }
  const params = new URLSearchParams();
  if (options?.frameUrlMode) params.set('frameUrlMode', options.frameUrlMode);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<ApiSessionFrames>(`/api/session/${sessionId}/frames${suffix}`);
}

export async function getSessionTimeline(sessionId: string): Promise<ApiSessionTimeline> {
  if (isDemoMode()) {
    const demo = (await getSessionCore(sessionId)) as any;
    return {
      events: demo.events || [],
      networkRequests: demo.networkRequests || [],
      crashes: demo.crashes || [],
      anrs: demo.anrs || [],
    };
  }
  return fetchWithCache<ApiSessionTimeline>(`/api/session/${sessionId}/timeline`);
}

export async function getSessionHierarchy(sessionId: string): Promise<ApiSessionHierarchy> {
  if (isDemoMode()) {
    const demo = (await getSessionCore(sessionId)) as any;
    return {
      hierarchySnapshots: demo.hierarchySnapshots || [],
    };
  }
  return fetchWithCache<ApiSessionHierarchy>(`/api/session/${sessionId}/hierarchy`);
}

export async function getSessionStats(sessionId: string): Promise<ApiSessionStats> {
  if (isDemoMode()) {
    const demo = (await getSessionCore(sessionId)) as any;
    return {
      stats: demo.stats,
    };
  }
  return fetchWithCache<ApiSessionStats>(`/api/session/${sessionId}/stats`);
}

/**
 * Load real hierarchy data for demo session
 */
async function getDemoSessionWithRealHierarchy(sessionId: string): Promise<any> {
  const basePath = `/demo/${sessionId}/hierarchy`;
  const hierarchyFiles = [
    '1769127030030.json',
    '1769127030034.json'
  ];

  try {
    const hierarchySnapshots: any[] = [];

    for (const file of hierarchyFiles) {
      const response = await fetch(`${basePath}/${file}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          hierarchySnapshots.push(...data);
        }
      }
    }

    return {
      ...demoApiData.demoFullSession,
      hierarchySnapshots: hierarchySnapshots.map(snap => ({
        timestamp: snap.timestamp,
        screenName: null,
        rootElement: [snap]
      }))
    };
  } catch (err) {
    console.error('Failed to load real hierarchy for demo session:', err);
    return demoApiData.demoFullSession as unknown as ApiSession;
  }
}

/**
 * Get network requests for a session
 */
export async function getSessionNetworkRequests(
  sessionId: string,
  groupBy?: 'host' | 'path'
): Promise<any> {
  const endpoint = groupBy
    ? `/api/session/${sessionId}/network?groupBy=${groupBy}`
    : `/api/session/${sessionId}/network`;
  return fetchWithCache<any>(endpoint);
}

/**
 * Get events for a session
 */
export async function getSessionEvents(sessionId: string): Promise<any[]> {
  const session = await getSession(sessionId);
  return session.events || [];
}

/**
 * Get dashboard stats (from server endpoint)
 */
export async function getDashboardStats(projectId?: string, timeRange?: string): Promise<DashboardStats> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoDashboardStatsApi;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString();
  const endpoint = `/api/analytics/dashboard-stats${qs ? `?${qs}` : ''}`;

  return fetchWithCache<DashboardStats>(endpoint);
}
/**
 * Get dashboard stats for a specific time range
 */
export async function getDashboardStatsWithTimeRange(timeRange: string): Promise<DashboardStats> {
  return getDashboardStats(undefined, timeRange);
}

/**
 * Transform API session to web-ui RecordingSession format
 */
export function transformToRecordingSession(session: ApiSession | ApiSessionSummary): any {
  // Handle both old format (startTime as number) and new format (startedAt as ISO string)
  const startedAtValue = (session as any).startedAt || (session as any).startTime;
  const endedAtValue =
    (session as any).endedAt ||
    (session as any).endTime ||
    (session as any).explicitEndedAt;

  const startedAtMs = typeof startedAtValue === 'string'
    ? new Date(startedAtValue).getTime()
    : (startedAtValue as number);
  const endedAtMs = typeof endedAtValue === 'string'
    ? new Date(endedAtValue).getTime()
    : (endedAtValue as number);

  const startedAt = new Date(startedAtMs).toISOString();
  const endedAt =
    endedAtValue != null && Number.isFinite(endedAtMs) ? new Date(endedAtMs).toISOString() : undefined;

  const rawDuration = (session as any).durationSeconds;
  let durationSeconds =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0;

  // API may send durationSeconds: 0 while endedAt / explicitEndedAt are set (column not backfilled yet).
  if (
    (durationSeconds === 0 || rawDuration == null) &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(endedAtMs) &&
    endedAtMs > startedAtMs
  ) {
    const bg = Number((session as any).backgroundTimeSeconds ?? 0);
    const wallSec = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
    durationSeconds = Math.max(0, wallSec - bg);
  }

  if (durationSeconds === 0 && session.stats?.duration != null) {
    const parsed = parseFloat(String(session.stats.duration));
    if (Number.isFinite(parsed) && parsed > 0) {
      durationSeconds = Math.round(parsed);
    }
  }

  // Use metrics if available, otherwise calculate from stats
  const metrics = session.metrics || {
    totalEvents: session.stats?.eventCount || 0,
    touchCount: 0,
    scrollCount: 0,
    gestureCount: 0,
    inputCount: 0,
    navigationCount: 0,
    errorCount: 0,
    rageTapCount: 0,
    apiSuccessCount: session.stats?.networkStats?.successful || 0,
    apiErrorCount: session.stats?.networkStats?.failed || 0,
    apiTotalCount: session.stats?.networkStats?.total || 0,
    screensVisited: [],
    uniqueScreensCount: 0,
    interactionScore: 50,
    explorationScore: 50,
    errors: 0,
    customEventCount: 0,
    crashCount: 0,
  };

  const summary = session as any;
  const touchCount = summary.touchCount ?? metrics.touchCount ?? 0;
  const scrollCount = summary.scrollCount ?? metrics.scrollCount ?? 0;
  const gestureCount = summary.gestureCount ?? metrics.gestureCount ?? 0;
  const inputCount = summary.inputCount ?? metrics.inputCount ?? 0;
  const errorCount = summary.errorCount ?? metrics.errorCount ?? 0;
  const crashCount = summary.crashCount ?? metrics.crashCount ?? 0;
  const anrCount = summary.anrCount ?? 0;
  const apiSuccessCount = summary.apiSuccessCount ?? metrics.apiSuccessCount ?? session.stats?.networkStats?.successful ?? 0;
  const apiErrorCount = summary.apiErrorCount ?? metrics.apiErrorCount ?? session.stats?.networkStats?.failed ?? 0;
  const apiTotalCount = summary.apiTotalCount ?? metrics.apiTotalCount ?? session.stats?.networkStats?.total ?? (apiSuccessCount + apiErrorCount);
  const rageTapCount = summary.rageTapCount ?? metrics.rageTapCount ?? 0;
  const interactionScore = summary.interactionScore ?? metrics.interactionScore ?? 50;
  const explorationScore = summary.explorationScore ?? metrics.explorationScore ?? 50;

  const screensVisited = summary.screensVisited?.length
    ? summary.screensVisited
    : (metrics.screensVisited && metrics.screensVisited.length > 0
      ? metrics.screensVisited
      : []);




  return {
    id: session.id,
    projectId: (session as any).projectId || (session as any).appId || 'project_1', // Prefer projectId; fall back to legacy appId
    startedAt,
    endedAt,
    durationSeconds,
    platform: (session as any).platform || (session.deviceInfo?.os?.toLowerCase() as 'ios' | 'android') || 'ios',
    appVersion: (session as any).appVersion || session.deviceInfo?.appVersion || 'Unknown',
    deviceModel: (session as any).deviceModel || session.deviceInfo?.model || 'Unknown Device',
    osVersion: (session as any).osVersion || session.deviceInfo?.osVersion || undefined,
    userId: session.userId !== 'anonymous' ? session.userId : undefined,
    anonymousId: session.userId === 'anonymous' ? session.userId : undefined,
    anonymousDisplayName: (session as any).anonymousDisplayName || undefined,
    totalEvents: metrics.totalEvents,
    errorCount,
    crashCount,
    anrCount,
    touchCount,
    scrollCount,
    gestureCount,
    inputCount,
    apiSuccessCount,
    apiErrorCount,
    apiTotalCount,
    apiAvgResponseMs: summary.apiAvgResponseMs ?? 0,
    appStartupTimeMs: summary.appStartupTimeMs ?? undefined,
    rageTapCount,
    deadTapCount: summary.deadTapCount ?? 0,
    screensVisited,

    interactionScore,
    explorationScore,
    status: (session as any).status || 'ready',
    effectiveStatus: (session as any).effectiveStatus ?? (session as any).status ?? 'ready',
    isLiveIngest: Boolean((session as any).isLiveIngest),
    isBackgroundProcessing: Boolean((session as any).isBackgroundProcessing),
    canOpenReplay: (session as any).canOpenReplay ?? (session as any).hasSuccessfulRecording ?? false,
    // Geo data if available
    geoLocation: session.geoLocation,
    // Device ID for DAU/MAU tracking
    deviceId: (session as any).deviceId || undefined,
    // Recording deletion status
    recordingDeleted: (session as any).recordingDeleted ?? false,
    recordingDeletedAt: (session as any).recordingDeletedAt ?? null,
    retentionDays: (session as any).retentionDays ?? 14,
    customEventCount: (summary.customEventCount ?? metrics.customEventCount ?? 0),
    // Canonical replay availability flag derived from successful screenshot capture.
    hasSuccessfulRecording: (session as any).hasSuccessfulRecording ?? false,

    isReplayExpired: (session as any).isReplayExpired ?? false,
    // Network quality
    networkType: (session as any).networkType,
    cellularGeneration: (session as any).cellularGeneration,
    isConstrained: (session as any).isConstrained,
    isExpensive: (session as any).isExpensive,
  };
}

/**
 * Get sessions in web-ui format with optional time range filter
 */
export async function getRecordingSessions(timeRange?: string): Promise<any[]> {
  const endpoint = timeRange ? `/api/sessions?timeRange=${timeRange}` : '/api/sessions';
  const response = await fetchWithCache<{ sessions: ApiSessionSummary[]; nextCursor?: string; hasMore?: boolean } | ApiSessionSummary[]>(endpoint);

  const sessions = Array.isArray(response) ? response : response.sessions || [];
  return sessions.map(transformToRecordingSession);
}

export interface PaginatedSessionsResponse {
  sessions: any[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number | null;
}

/** Allowlisted archive column sorts — must match backend `ARCHIVE_LIST_SORT_KEYS`. */
export type SessionArchiveSortKey =
  | 'date'
  | 'duration'
  | 'apiResponse'
  | 'startup'
  | 'screens'
  | 'apiSuccess'
  | 'apiError'
  | 'crashes'
  | 'anrs'
  | 'errors'
  | 'rage'
  | 'network';

/** Shared query string for session archive list + count-only requests */
export type SessionArchiveQuery = {
  cursor?: string | null;
  limit?: number;
  timeRange?: string;
  projectId?: string;
  platform?: string;
  hasRecording?: boolean;
  issueFilter?:
    | 'all'
    | 'crashes'
    | 'anrs'
    | 'errors'
    | 'rage'
    | 'dead_taps'
    | 'slow_start'
    | 'slow_api'
    | 'new_user';
  metaKey?: string;
  metaValue?: string;
  eventName?: string;
  date?: string;
  eventCountOp?: string;
  eventCountValue?: string;
  eventPropKey?: string;
  eventPropValue?: string;
  /** Server-side substring search (session id, user, device, model, anonymous fields) */
  q?: string;
  sort?: SessionArchiveSortKey;
  sortDir?: 'asc' | 'desc';
  /** When false, server omits expensive count(*) — use getSessionsArchiveTotalCount for the total */
  includeTotal?: boolean;
};

function buildSessionArchiveQueryString(params: SessionArchiveQuery & { countOnly?: boolean }): string {
  const {
    cursor,
    limit = 50,
    timeRange,
    projectId,
    platform,
    hasRecording,
    issueFilter,
    metaKey,
    metaValue,
    eventName,
    date,
    eventCountOp,
    eventCountValue,
    eventPropKey,
    eventPropValue,
    q,
    sort,
    sortDir,
    includeTotal,
    countOnly,
  } = params;
  const recordingFilter = hasRecording;

  const queryParams = new URLSearchParams();
  if (countOnly) queryParams.set('countOnly', 'true');
  if (cursor) queryParams.set('cursor', cursor);
  if (limit) queryParams.set('limit', limit.toString());
  if (timeRange) queryParams.set('timeRange', timeRange);
  if (projectId) queryParams.set('projectId', projectId);
  if (platform) queryParams.set('platform', platform);
  if (recordingFilter) queryParams.set('hasRecording', 'true');
  if (issueFilter && issueFilter !== 'all') queryParams.set('issueFilter', issueFilter);
  if (metaKey) queryParams.set('metaKey', metaKey);
  if (metaValue) queryParams.set('metaValue', metaValue);
  if (eventName) queryParams.set('eventName', eventName);
  if (date) queryParams.set('date', date);
  if (eventCountOp) queryParams.set('eventCountOp', eventCountOp);
  if (eventCountValue) queryParams.set('eventCountValue', eventCountValue);
  if (eventPropKey) queryParams.set('eventPropKey', eventPropKey);
  if (eventPropValue) queryParams.set('eventPropValue', eventPropValue);
  if (q && q.trim()) queryParams.set('q', q.trim());
  if (sort) queryParams.set('sort', sort);
  if (sortDir) queryParams.set('sortDir', sortDir);
  if (includeTotal === false) queryParams.set('includeTotal', 'false');

  return queryParams.toString();
}

/**
 * Total matching rows for the same filters as the archive list (cheap to call after list without includeTotal).
 */
export async function getSessionsArchiveTotalCount(
  params: Omit<SessionArchiveQuery, 'cursor' | 'limit' | 'includeTotal'>
): Promise<number> {
  if (isDemoMode()) {
    return demoSessions.length;
  }

  const queryParams = buildSessionArchiveQueryString({ ...params, countOnly: true, limit: 1 });
  const response = await fetchJson<{ totalCount: number }>(`/api/sessions?${queryParams}`);
  return response?.totalCount ?? 0;
}

/**
 * Get sessions with cursor-based pagination for infinite scroll
 * Supports 500k+ sessions efficiently
 */
export async function getSessionsPaginated(
  params: SessionArchiveQuery
): Promise<{ sessions: any[]; nextCursor: string | null; hasMore: boolean; totalCount: number | null }> {
  // Demo mode: return static demo sessions
  if (isDemoMode()) {
    const includeTotal = params.includeTotal !== false;
    return {
      sessions: demoSessions,
      nextCursor: null,
      hasMore: false,
      totalCount: includeTotal ? demoSessions.length : null,
    };
  }

  const queryParams = buildSessionArchiveQueryString(params);
  const endpoint = `/api/sessions?${queryParams}`;

  // Don't cache paginated requests since cursor changes
  const response = await fetchJson<{
    sessions: ApiSessionSummary[];
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number | null;
  }>(endpoint);

  const sessions = (response?.sessions || []).map(transformToRecordingSession);
  return {
    sessions,
    nextCursor: response.nextCursor,
    hasMore: response.hasMore,
    totalCount: response.totalCount === null || response.totalCount === undefined ? null : response.totalCount,
  };
}

/**
 * Get a session in web-ui format
 */
export async function getRecordingSession(sessionId: string): Promise<any> {
  const session = await getSession(sessionId);
  return transformToRecordingSession(session);
}

// =============================================================================
// Real-time Updates (WebSocket support for future)
// =============================================================================

let eventSource: EventSource | null = null;
let listeners: ((sessions: ApiSessionSummary[]) => void)[] = [];

/**
 * Subscribe to session updates
 */
export function subscribeToUpdates(callback: (sessions: ApiSessionSummary[]) => void): () => void {
  listeners.push(callback);

  // Return unsubscribe function
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
}

/**
 * Refresh sessions and notify listeners
 */
export async function refreshSessions(): Promise<void> {
  clearCache('/api/sessions');
  const sessions = await getSessions();
  listeners.forEach(callback => callback(sessions));
}

// =============================================================================
// Projects API
// =============================================================================

export interface ApiProject {
  id: string;
  name: string;
  bundleId?: string;
  packageName?: string;
  teamId?: string;
  webDomain?: string;
  platforms: string[];
  publicKey: string;
  rejourneyEnabled?: boolean;
  recordingEnabled: boolean;
  sampleRate: number;
  maxRecordingMinutes?: number;
  sessionsTotal?: number;
  sessionsLast7Days?: number;
  errorsLast7Days?: number;
  errorsTotal?: number;
  crashesTotal?: number;
  anrsTotal?: number;
  apiErrorsTotal?: number;
  apiTotalCount?: number;
  rageTapTotal?: number;
  healthScore?: number;
  healthLevel?: 'excellent' | 'good' | 'fair' | 'critical';
  createdAt: string;
  updatedAt?: string;
}

export interface CreateProjectRequest {
  name: string;
  bundleId?: string;
  packageName?: string;
  teamId?: string;
  webDomain?: string;
  platforms?: string[];
  rejourneyEnabled?: boolean;
  recordingEnabled?: boolean;
  sampleRate?: number;
  maxRecordingMinutes?: number;
}

/**
 * Get all projects
 */
export async function getProjects(): Promise<ApiProject[]> {
  const data = await fetchWithCache<{ projects: ApiProject[] | ApiProject | undefined }>(
    '/api/projects',
    {},
    'projects:list',
    PROJECTS_CACHE_TTL,
  );
  const projects = data.projects;
  if (!projects) return [];
  return Array.isArray(projects) ? projects : [projects];
}

/**
 * Get available custom events and metadata for a project
 */
export async function getAvailableFilters(projectId: string): Promise<{ events: string[]; eventPropertyKeys: string[]; metadata: Record<string, string[]> }> {
  return fetchJson<{ events: string[]; eventPropertyKeys: string[]; metadata: Record<string, string[]> }>(`/api/projects/${projectId}/available-filters`);
}

/**
 * Create a new project
 */
export async function createProject(projectData: CreateProjectRequest): Promise<ApiProject> {
  const data = await fetchJson<{ project: ApiProject }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(projectData),
  });
  clearCache('projects:list');
  return data.project;
}

/**
 * Get a specific project by ID
 */
export async function getProject(projectId: string): Promise<ApiProject> {
  return fetchJson<ApiProject>(`/api/projects/${projectId}`);
}

/**
 * Update a project
 */
export async function updateProject(projectId: string, data: { name?: string; maxRecordingMinutes?: number; recordingEnabled?: boolean; rejourneyEnabled?: boolean; bundleId?: string; packageName?: string }): Promise<ApiProject> {
  const response = await fetchJson<{ project: ApiProject }>(`/api/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  clearCache('projects:list');
  return response.project;
}

/**
 * Request OTP for project deletion
 */
export async function requestProjectDeletionOtp(
  projectId: string,
  payload: { confirmText: string }
): Promise<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }> {
  return fetchJson<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }>(
    `/api/projects/${projectId}/delete-otp`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

/**
 * Delete a project
 */
export async function deleteProject(
  projectId: string,
  payload: { confirmText: string; otpCode: string }
): Promise<void> {
  await fetchJson<void>(`/api/projects/${projectId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
  clearCache('projects:list');
}



// =============================================================================
// Team Billing API (Team-Level)
// =============================================================================

export interface TeamQuota {
  teamId: string;
  sessionLimit?: number | null; // Monthly session limit
  storageCap?: number | null;
  requestCap?: number | null;
  effectiveAt?: string;
}

export interface TeamUsage {
  rejourneyEnabled?: boolean; // Added to enable Rejourney feature
  sessionsUsed: number;
  sessionLimit: number;
  /** Plan cap without promotional bonus */
  planSessionLimit?: number;
  /** Extra sessions this billing period only (not carried to the next cycle) */
  bonusSessionsActive?: number;
  sessionsRemaining: number;
  percentUsed: number;
  isAtLimit: boolean;
  isNearLimit: boolean;
}

export interface BillingPlan {
  name: string;
  displayName: string;
  sessionLimit: number;
  videoRetentionTier: number;
  videoRetentionDays: number;
  videoRetentionLabel: string;
  priceCents: number;
  isCustom?: boolean;
}

export interface TeamPlanInfo {
  planName: string;
  displayName: string;
  sessionLimit: number;
  videoRetentionTier: number;
  videoRetentionDays: number;
  videoRetentionLabel: string;
  priceCents: number;
  isCustom: boolean;
  subscriptionId?: string | null; // Stripe subscription ID (null for free plan)
  subscriptionStatus?: string | null; // 'active', 'past_due', 'canceled', etc.
  cancelAtPeriodEnd?: boolean; // True if subscription is scheduled to cancel
  scheduledPriceId?: string | null; // Price ID of scheduled plan change
  scheduledPlanName?: string | null; // Plan name of scheduled change
}

export interface TeamBillingDashboard {
  period: string;
  plan: TeamPlanInfo;
  usage: {
    sessionsUsed: number;
    sessionLimit: number;
    planSessionLimit?: number;
    bonusSessionsActive?: number;
    sessionsRemaining: number;
    percentUsed: number;
    isAtLimit: boolean;
    isNearLimit: boolean;
    storageBytes: number;
    requests: number;
  };
  billing: {
    cycleStart: string;
    cycleEnd: string;
    selfHosted: boolean;
  };
  projectCount: number;
}

// =============================================================================
// Warehouse Alerting API
// =============================================================================

export interface AlertRecipient {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AlertConnection {
  projectId: string;
  recipientId: string;
}

export interface WarehouseAlertingData {
  recipients: AlertRecipient[];
  connections: AlertConnection[];
  projectStatuses: Record<string, { enabled: boolean; hasActiveAlert: boolean }>;
}

export async function getWarehouseAlerting(): Promise<WarehouseAlertingData> {
  return fetchJson<WarehouseAlertingData>('/api/analytics/warehouse-alerting');
}

/**
 * Get team's current billing plan
 */
export async function getTeamPlan(teamId: string): Promise<TeamPlanInfo | null> {
  try {
    const res = await fetchWithCache<{ plan: TeamPlanInfo }>(
      `/api/teams/${teamId}/billing/plan`
    );
    return res.plan;
  } catch (err) {
    console.error('Failed to get team plan:', err);
    return null;
  }
}

/**
 * Plan change preview response
 */
export interface PlanChangePreview {
  currentPlan: {
    name: string;
    displayName: string;
    sessionLimit: number;
    videoRetentionTier: number;
    videoRetentionDays: number;
    videoRetentionLabel: string;
    priceCents: number;
  }; // Always present (free plan if no subscription)
  newPlan: {
    name: string;
    displayName: string;
    sessionLimit: number;
    videoRetentionTier: number;
    videoRetentionDays: number;
    videoRetentionLabel: string;
    priceCents: number;
  };
  changeType: 'upgrade' | 'downgrade' | 'same' | 'new';
  requiresPaymentMethod: boolean;
  hasPaymentMethod: boolean;
  effectiveDate: string;
  isImmediate: boolean;
  prorationInfo?: {
    daysRemaining: number;
    totalDaysInPeriod: number;
    proratedAmountCents: number;
    creditFromCurrentPlanCents: number;
    netChargeCents: number;
  };
  warnings: string[];
}

/**
 * Plan change result response
 */
export interface PlanChangeResult {
  success: boolean;
  plan: TeamPlanInfo;
  changeType: 'upgrade' | 'downgrade' | 'new';
  effectiveDate: string;
  isImmediate: boolean;
  scheduledDowngradeDate?: string;
  message: string;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
}

export interface CheckoutCompletionResponse {
  success: boolean;
  provisioned: boolean;
  subscriptionStatus: string | null;
  subscriptionId: string | null;
  customerId: string | null;
}

/**
 * Preview a plan change before confirming
 * Returns pricing details, proration info, and any warnings
 */
export async function previewPlanChange(
  teamId: string,
  planName: string
): Promise<PlanChangePreview> {
  const res = await fetchJson<PlanChangePreview>(
    `/api/teams/${teamId}/billing/plan/preview`,
    {
      method: 'POST',
      body: JSON.stringify({ planName }),
    }
  );
  return res;
}

/**
 * Confirm and execute a plan change
 * @param planName - Plan name: 'free', 'starter', 'growth', 'pro'
 * @param confirmed - Must be true to execute the change
 */
export async function confirmPlanChange(
  teamId: string,
  planName: string
): Promise<PlanChangeResult> {
  clearCache(`/api/teams/${teamId}/billing/plan`);
  clearCache(`/api/teams/${teamId}/billing/usage`);
  clearCache(`/api/teams/${teamId}/billing/dashboard`);

  const res = await fetchJson<PlanChangeResult>(
    `/api/teams/${teamId}/billing/plan`,
    {
      method: 'PUT',
      body: JSON.stringify({ planName, confirmed: true }),
    }
  );
  return res;
}

export async function createCheckoutSession(
  teamId: string,
  planName: string,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutSessionResponse> {
  return fetchJson<CheckoutSessionResponse>(
    `/api/teams/${teamId}/billing/checkout`,
    {
      method: 'POST',
      body: JSON.stringify({ planName, successUrl, cancelUrl }),
    },
  );
}

export async function completeCheckoutSession(
  teamId: string,
  sessionId: string,
): Promise<CheckoutCompletionResponse> {
  return fetchJson<CheckoutCompletionResponse>(
    `/api/teams/${teamId}/billing/checkout/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    },
  );
}

/**
 * Update team's billing plan (deprecated - use previewPlanChange + confirmPlanChange)
 * @param planName - Plan name: 'free', 'starter', 'growth', 'pro'
 */
export async function updateTeamPlan(
  teamId: string,
  planName: string
): Promise<TeamPlanInfo | null> {
  clearCache(`/api/teams/${teamId}/billing/plan`);
  clearCache(`/api/teams/${teamId}/billing/usage`);
  clearCache(`/api/teams/${teamId}/billing/dashboard`);

  try {
    const res = await fetchJson<{ plan: TeamPlanInfo } | PlanChangeResult>(
      `/api/teams/${teamId}/billing/plan`,
      {
        method: 'PUT',
        body: JSON.stringify({ planName, confirmed: true }),
      }
    );
    // Handle both old and new response formats
    if ('success' in res) {
      return res.plan;
    }
    return (res as { plan: TeamPlanInfo }).plan;
  } catch (err) {
    console.error('Failed to update team plan:', err);
    throw err;
  }
}

/**
 * Get all available billing plans
 */
export async function getAvailablePlans(): Promise<BillingPlan[]> {
  try {
    const res = await fetchWithCache<{ plans: BillingPlan[] }>('/api/billing/plans');
    return res.plans;
  } catch (err) {
    console.error('Failed to get available plans:', err);
    return [];
  }
}

/**
 * Get team billing usage for current period
 */
export async function getTeamBillingUsage(teamId: string): Promise<{
  period: string;
  usage: TeamUsage;
  quota: TeamQuota | null;
}> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return {
      period: '2024-12',
      usage: demoApiData.demoTeamUsage,
      quota: null,
    };
  }

  const res = await fetchWithCache<{
    period: string;
    usage: TeamUsage;
    quota: TeamQuota | null;
  }>(`/api/teams/${teamId}/billing/usage`);
  return res;
}

/**
 * Get team billing dashboard (summary)
 */
export async function getTeamBillingDashboard(teamId: string): Promise<TeamBillingDashboard> {
  const res = await fetchWithCache<TeamBillingDashboard>(
    `/api/teams/${teamId}/billing/dashboard`
  );
  return res;
}

// =============================================================================
// Stripe Billing API
// =============================================================================

export interface StripeStatus {
  enabled: boolean;
  selfHosted: boolean;
  hasCustomer: boolean;
  hasPaymentMethod: boolean;
  paymentFailed: boolean;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'link';
  brand?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  email?: string;
  isDefault: boolean;
}

export interface FreeTierStatus {
  freeTierSessions: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  percentUsed: number;
  isExhausted: boolean;
  currentPeriodSessions: number;
  ownedTeamCount: number;
}

/**
 * Get Stripe status for a team
 */
export async function getStripeStatus(teamId: string): Promise<StripeStatus> {
  return fetchWithCache<StripeStatus>(`/api/teams/${teamId}/billing/stripe/status`);
}

/**
 * Initialize Stripe for a team
 */
export async function setupStripeForTeam(teamId: string): Promise<{ success: boolean; customerId: string }> {
  clearCache(`/api/teams/${teamId}/billing/stripe/status`);
  return fetchJson<{ success: boolean; customerId: string }>(
    `/api/teams/${teamId}/billing/stripe/setup`,
    { method: 'POST' }
  );
}

/**
 * Get payment methods for a team
 */
export async function getPaymentMethods(teamId: string): Promise<{
  paymentMethods: PaymentMethod[];
  defaultPaymentMethodId: string | null;
}> {
  return fetchWithCache<{ paymentMethods: PaymentMethod[]; defaultPaymentMethodId: string | null }>(
    `/api/teams/${teamId}/billing/stripe/payment-methods`
  );
}

/**
 * Add a payment method to a team
 */
export async function addPaymentMethod(teamId: string, paymentMethodId: string): Promise<{ success: boolean }> {
  clearCache(`/api/teams/${teamId}/billing/stripe/payment-methods`);
  clearCache(`/api/teams/${teamId}/billing/stripe/status`);
  return fetchJson<{ success: boolean }>(
    `/api/teams/${teamId}/billing/stripe/payment-methods`,
    {
      method: 'POST',
      body: JSON.stringify({ paymentMethodId }),
    }
  );
}

/**
 * Remove a payment method from a team
 */
export async function removePaymentMethod(teamId: string, paymentMethodId: string): Promise<{ success: boolean }> {
  clearCache(`/api/teams/${teamId}/billing/stripe/payment-methods`);
  clearCache(`/api/teams/${teamId}/billing/stripe/status`);
  return fetchJson<{ success: boolean }>(
    `/api/teams/${teamId}/billing/stripe/payment-methods/${paymentMethodId}`,
    { method: 'DELETE' }
  );
}

/**
 * Create a Stripe SetupIntent for adding a payment method in-app
 */
export async function createSetupIntent(teamId: string): Promise<{ clientSecret: string }> {
  return fetchJson<{ clientSecret: string }>(
    `/api/teams/${teamId}/billing/stripe/setup-intent`,
    { method: 'POST' }
  );
}

/**
 * Create a Stripe Billing Portal session
 */
export async function createBillingPortalSession(teamId: string, returnUrl?: string): Promise<{ url: string }> {
  return fetchJson<{ url: string }>(
    `/api/teams/${teamId}/billing/stripe/portal`,
    {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    }
  );
}

/**
 * Get free tier status for current user
 */
export async function getFreeTierStatus(): Promise<FreeTierStatus> {
  return fetchWithCache<FreeTierStatus>('/api/billing/free-tier');
}

/**
 * Team session usage response
 */
export interface TeamSessionUsage {
  sessionsUsed: number;
  sessionLimit: number;
  planSessionLimit?: number;
  bonusSessionsActive?: number;
  sessionsRemaining: number;
  percentUsed: number;
  isAtLimit: boolean;
  isNearLimit: boolean;
  planName: string;
  period: string;
}

/**
 * Get team's session usage
 */
export async function getTeamSessionUsage(teamId: string): Promise<TeamSessionUsage | null> {
  try {
    const res = await fetchWithCache<{ usage: TeamSessionUsage }>(
      `/api/teams/${teamId}/billing/usage`
    );
    return res.usage;
  } catch (err) {
    console.error('Failed to get team session usage:', err);
    return null;
  }
}

// =============================================================================
// Billing Alert Settings API
// =============================================================================

export interface BillingAlertSettings {
  sessionLimit: number | null;
  sessionWarningThresholdPercent: number | null;
  sessionWarningEnabled: boolean;
  billingCycleEndDate: string;
  currentPeriod: string;
}

export interface BillingAlertRecipient {
  userId: string;
  alertType: 'session_threshold' | 'session_limit';
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface BillingAlertRecipientsResponse {
  recipients: BillingAlertRecipient[];
  owner: {
    userId: string;
    email: string;
    displayName: string | null;
  } | null;
}

/**
 * Get billing alert settings for a team
 */
export async function getBillingAlertSettings(teamId: string): Promise<BillingAlertSettings | null> {
  try {
    return fetchWithCache<BillingAlertSettings>(`/api/teams/${teamId}/billing/alert-settings`);
  } catch (err) {
    console.error('Failed to get billing alert settings:', err);
    return null;
  }
}

/**
 * Update billing alert settings for a team
 */
export async function updateBillingAlertSettings(
  teamId: string,
  settings: {
    spendingWarningThresholdCents: number | null;
    spendingWarningEnabled: boolean;
  }
): Promise<{ success: boolean }> {
  clearCache(`/api/teams/${teamId}/billing/alert-settings`);
  return fetchJson<{ success: boolean }>(
    `/api/teams/${teamId}/billing/alert-settings`,
    {
      method: 'PUT',
      body: JSON.stringify(settings),
    }
  );
}

/**
 * Get billing alert recipients for a team
 */
export async function getBillingAlertRecipients(teamId: string): Promise<BillingAlertRecipientsResponse | null> {
  try {
    return fetchWithCache<BillingAlertRecipientsResponse>(`/api/teams/${teamId}/billing/alert-recipients`);
  } catch (err) {
    console.error('Failed to get billing alert recipients:', err);
    return null;
  }
}

/**
 * Add a billing alert recipient
 */
export async function addBillingAlertRecipient(
  teamId: string,
  userId: string,
  alertType: 'session_threshold' | 'session_limit'
): Promise<{ success: boolean }> {
  clearCache(`/api/teams/${teamId}/billing/alert-recipients`);
  return fetchJson<{ success: boolean }>(
    `/api/teams/${teamId}/billing/alert-recipients`,
    {
      method: 'POST',
      body: JSON.stringify({ userId, alertType }),
    }
  );
}

/**
 * Remove a billing alert recipient
 */
export async function removeBillingAlertRecipient(
  teamId: string,
  userId: string,
  alertType: 'session_threshold' | 'session_limit'
): Promise<{ success: boolean }> {
  clearCache(`/api/teams/${teamId}/billing/alert-recipients`);
  return fetchJson<{ success: boolean }>(
    `/api/teams/${teamId}/billing/alert-recipients/${userId}/${alertType}`,
    { method: 'DELETE' }
  );
}

// =============================================================================
// GDPR Data Export API
// =============================================================================

export interface DataExportStatus {
  canExport: boolean;
  lastExportAt: string | null;
  nextExportAt: string | null;
  cooldownDays: number;
}

export interface DataExport {
  exportedAt: string;
  account: {
    email: string;
    displayName: string | null;
    createdAt: string;
    teams: Array<{ name: string | null; role: string }>;
  };
  sessionSummaries: Array<{
    id: string;
    date: string;
    platform: string | null;
    durationSeconds: number | null;
    errors: number;
    projectName: string | null;
  }>;
  metadata: {
    totalSessionsExported: number;
    exportPeriod: string;
    note: string;
  };
}

/**
 * Get data export status (canExport, cooldown info)
 */
export async function getDataExportStatus(): Promise<DataExportStatus> {
  return fetchJson<DataExportStatus>('/api/auth/export-data/status');
}

/**
 * Export user data (GDPR Right to Data Portability)
 * Rate limited to once per 30 days
 * Returns a Blob for download
 */
export async function exportUserData(): Promise<Blob> {
  const headers = withDefaultHeaders();
  headers.set('Accept', 'application/json');

  const response = await fetch(`${API_BASE_URL}/api/auth/export-data`, {
    method: 'POST',
    headers,
    credentials: 'include',
  });

  if (response.status === 401 || response.status === 403) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }

  if (response.status === 429) {
    const data = await response.json();
    throw new Error(data.message || 'Export rate limited. Please try again later.');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Export failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  return response.blob();
}
// =============================================================================
// API Keys API
// =============================================================================

export interface ApiKey {
  id: string;
  projectId: string;
  scopes: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  truncatedKey: string;
}

export interface CreatedApiKey {
  id: string;
  key: string;
  truncatedKey: string;
}

/**
 * Get API keys for a project
 */
export async function getApiKeys(projectId: string): Promise<ApiKey[]> {
  const data = await fetchJson<{ keys: ApiKey[] }>(`/api/projects/${projectId}/api-keys`);
  return data.keys;
}

/**
 * Create a new API key
 */
export async function createApiKey(projectId: string): Promise<CreatedApiKey> {
  const data = await fetchJson<{ apiKey: CreatedApiKey }>(`/api/projects/${projectId}/api-keys`, {
    method: 'POST',
  });
  return data.apiKey;
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(id: string): Promise<void> {
  await fetchJson<void>(`/api/api-keys/${id}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Crashes API
// =============================================================================

export interface ANRRecord {
  id: string;
  sessionId: string;
  projectId: string;
  timestamp: string;
  durationMs: number;
  threadState: string | null;
  deviceMetadata: {
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
    [key: string]: any;
  } | null;
  status: string;
  occurrenceCount: number;
  userCount: number;
  groupKey?: string;
}

export interface ANRDetailRecord {
  id: string;
  sessionId: string;
  projectId: string;
  timestamp: string;
  durationMs: number;
  threadState: string | null;
  deviceMetadata: {
    model?: string;
    manufacturer?: string;
    systemName?: string;
    systemVersion?: string;
    osVersion?: string;
    sdkInt?: number;
    [key: string]: any;
  } | null;
  status: string;
}

export interface CrashMetadata {
  id: string;
  sessionId: string;
  projectId: string;
  timestamp: string;
  exceptionName: string;
  reason: string;
  deviceMetadata: any;
  status: 'new' | 'investigating' | 'resolved' | 'ignored';
  occurrenceCount: number;
}

export interface CrashReport {
  id: string;
  sessionId: string;
  projectId: string;
  timestamp: string;
  exceptionName: string;
  reason: string;
  deviceMetadata?: {
    model?: string;
    systemName?: string;
    systemVersion?: string;
    identifierForVendor?: string;
    [key: string]: any;
  };
  status: 'new' | 'investigating' | 'resolved' | 'ignored';
  stackTrace?: string;
  occurrenceCount?: number;
}

/**
 * Get crashes for a project (paginated)
 */
export async function getCrashes(projectId: string, page: number = 1, limit: number = 20): Promise<{ crashes: CrashMetadata[], totalPages: number }> {
  if (isDemoMode()) {
    return { crashes: (demoApiData.demoIssuesResponse.issues as any[]).filter(i => i.issueType === 'crash'), totalPages: 1 };
  }
  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
  return fetchJson<{ crashes: CrashMetadata[], totalPages: number }>(`/api/projects/${projectId}/crashes?${params.toString()}`);
}

/**
 * Get details for a single crash
 */
export async function getCrash(projectId: string, crashId: string): Promise<CrashReport> {
  if (isDemoMode()) {
    const issue = (demoApiData.demoIssuesResponse.issues as any[]).find(i => i.id === crashId);
    return issue || (demoApiData.demoIssuesResponse.issues[0] as any);
  }
  return fetchJson<CrashReport>(`/api/projects/${projectId}/crashes/${crashId}`);
}

/**
 * Get ANRs for a project
 */
export async function getANRs(projectId: string, options?: { limit?: number; offset?: number; timeRange?: string }): Promise<{ anrs: ANRRecord[]; totalGroups?: number; totalEvents?: number }> {
  if (isDemoMode()) {
    return demoApiData.demoANRsResponse;
  }
  const params = new URLSearchParams();
  params.set('limit', String(options?.limit ?? 100));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.timeRange) params.set('timeRange', options.timeRange);
  return fetchJson<{ anrs: ANRRecord[]; totalGroups?: number; totalEvents?: number }>(`/api/projects/${projectId}/anrs?${params.toString()}`);
}

/**
 * Get details for a single ANR
 */
export async function getANR(projectId: string, anrId: string): Promise<ANRDetailRecord> {
  if (isDemoMode()) {
    return demoApiData.demoANRsResponse.anrs.find((a: any) => a.id === anrId) || demoApiData.demoANRsResponse.anrs[0];
  }
  return fetchJson<ANRDetailRecord>(`/api/projects/${projectId}/anrs/${anrId}`);
}

export interface InsightsTrends {
  daily: Array<{
    date: string;
    sessions: number;
    crashes: number;
    rageTaps: number;
    dau: number;
    mau: number;
    // NEW: Additional metrics for overview graphs
    avgApiResponseMs: number;
    apiErrorRate: number;
    avgDurationSeconds: number;
    errorCount: number;
    appVersionBreakdown: Record<string, number>;
    appVersionDauBreakdown?: Record<string, number>;
    totalApiCalls: number;
  }>;
  /** Last date (YYYY-MM-DD) for which rollups are complete. Metrics exclude days after this. */
  dataCompleteThrough?: string;
}

export interface RetentionCohortRow {
  weekStartKey: string;
  users: number;
  retention: Array<number | null>;
}

export interface RetentionCohortsResponse {
  rows: RetentionCohortRow[];
}

export interface FrictionHeatmap {
  screens: Array<{
    name: string;
    visits: number;
    rageTaps: number;
    errors: number;
    exitRate: number;
    frictionScore: number;
    // Quantitative friction metrics
    impactScore?: number;
    rageTapRatePer100?: number;
    errorRatePer100?: number;
    estimatedAffectedSessions?: number;
    primarySignal?: 'rage_taps' | 'errors' | 'exits' | 'mixed';
    confidence?: 'high' | 'medium' | 'low';
    sessionIds: string[];
    screenshotUrl: string | null;
    // Real touch coordinate hotspots for heatmap visualization
    touchHotspots?: Array<{
      x: number;      // Normalized 0-1 (left to right)
      y: number;      // Normalized 0-1 (top to bottom)
      intensity: number; // 0-1 based on touch count
      isRageTap: boolean;
    }>;
  }>;
}

/**
 * Get friction heatmap (screens ranked by issues)
 */
export async function getFrictionHeatmap(projectId?: string, timeRange?: string): Promise<FrictionHeatmap> {
  if (isDemoMode()) {
    return demoApiData.demoFrictionHeatmap;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);

  return fetchWithCache<FrictionHeatmap>(`/api/insights/friction-heatmap?${params.toString()}`);
}

/**
 * API Latency by Location response type
 */
export interface ApiLatencyByLocationResponse {
  regions: {
    country: string;
    totalRequests: number;
    avgLatencyMs: number;
    successRate: number;
    errorCount: number;
  }[];
  summary: {
    avgLatency: number;
    totalRequests: number;
  };
}

/**
 * Get API latency aggregated by geographic location
 */
export async function getApiLatencyByLocation(projectId?: string, timeRange?: string): Promise<ApiLatencyByLocationResponse> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoApiLatencyByLocation;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  return fetchWithCache<ApiLatencyByLocationResponse>(`/api/analytics/latency-by-location?${params.toString()}`);
}

/**
 * Get insights trends (for charts)
 */
export async function getInsightsTrends(projectId?: string, timeRange?: string): Promise<InsightsTrends> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoInsightsTrends;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const endpoint = `/api/insights/trends?${params.toString()}`;
  // 2 min cache - KPI cards depend on this, keep warm for snappy tab switching
  return fetchWithCache<InsightsTrends>(endpoint, {}, endpoint, 120000);
}

export async function getRetentionCohorts(projectId?: string, timeRange?: string): Promise<RetentionCohortsResponse> {
  if (isDemoMode()) {
    const weeklyActiveUsers = new Map<string, Set<string>>();
    const userFirstWeek = new Map<string, string>();

    for (const session of demoSessions) {
      const userKey = session.userId || session.anonymousId || session.anonymousDisplayName || session.deviceId;
      if (!userKey) continue;

      const startedAt = new Date(session.startedAt);
      if (Number.isNaN(startedAt.getTime())) continue;

      const utcDate = new Date(Date.UTC(
        startedAt.getUTCFullYear(),
        startedAt.getUTCMonth(),
        startedAt.getUTCDate()
      ));
      utcDate.setUTCDate(utcDate.getUTCDate() - utcDate.getUTCDay());
      const weekStartKey = utcDate.toISOString().slice(0, 10);

      if (!weeklyActiveUsers.has(weekStartKey)) {
        weeklyActiveUsers.set(weekStartKey, new Set<string>());
      }
      weeklyActiveUsers.get(weekStartKey)!.add(userKey);

      const existingFirstWeek = userFirstWeek.get(userKey);
      if (!existingFirstWeek || weekStartKey < existingFirstWeek) {
        userFirstWeek.set(userKey, weekStartKey);
      }
    }

    const weekKeys = Array.from(weeklyActiveUsers.keys()).sort((a, b) => a.localeCompare(b));
    const weekIndex = new Map(weekKeys.map((key, index) => [key, index]));
    const cohortMembers = new Map<string, Set<string>>();

    for (const [userKey, firstWeek] of userFirstWeek.entries()) {
      if (!cohortMembers.has(firstWeek)) {
        cohortMembers.set(firstWeek, new Set<string>());
      }
      cohortMembers.get(firstWeek)!.add(userKey);
    }

    return {
      rows: weekKeys
        .map((cohortWeek) => {
          const members = cohortMembers.get(cohortWeek);
          const index = weekIndex.get(cohortWeek);
          if (!members || index === undefined) return null;

          return {
            weekStartKey: cohortWeek,
            users: members.size,
            retention: Array.from({ length: 6 }, (_, offset) => {
              const targetWeek = weekKeys[index + offset];
              if (!targetWeek) return null;
              if (offset === 0) return 100;

              const activeUsers = weeklyActiveUsers.get(targetWeek);
              if (!activeUsers) return 0;

              let retained = 0;
              for (const userKey of members) {
                if (activeUsers.has(userKey)) retained += 1;
              }

              return (retained / members.size) * 100;
            }),
          };
        })
        .filter((row): row is RetentionCohortRow => Boolean(row))
        .slice(-6),
    };
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const endpoint = `/api/insights/retention-cohorts?${params.toString()}`;
  return fetchWithCache<RetentionCohortsResponse>(endpoint, {}, endpoint, 120000);
}

/**
 * Get issues for a project
 */
export async function getIssues(projectId: string, timeRange: string = '30d', searchQuery?: string, issueType?: string): Promise<{ issues: Issue[], stats: any, total: number }> {
  if (isDemoMode()) {
    return demoApiData.demoIssuesResponse;
  }

  const params = new URLSearchParams();
  params.set('projectId', projectId);
  params.set('timeRange', timeRange);
  params.set('limit', '50');
  if (searchQuery) params.set('search', searchQuery);
  if (issueType) params.set('type', issueType);

  return fetchWithCache<{ issues: Issue[], stats: any, total: number }>(`/api/general?${params.toString()}`);
}

/**
 * Get a single issue with full details
 */
export interface IssueEvent {
  id: string;
  issueId: string;
  sessionId: string | null;
  timestamp: string;
  screenName: string | null;
  userHash: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  errorMessage: string | null;
  stackTrace: string | null;
}

export interface IssueDetail extends Issue {
  shortId?: string;
  screenName?: string;
  componentName?: string;
  isHandled?: boolean;
  priority?: string;
  environment?: string;
  sampleStackTrace?: string;
  sampleDeviceModel?: string;
  sampleOsVersion?: string;
  sampleAppVersion?: string;
  recentEvents: IssueEvent[];
}

export async function getIssue(issueId: string): Promise<IssueDetail> {
  if (isDemoMode()) {
    // Return a mock issue detail from demo data
    const issue = demoApiData.demoIssuesResponse.issues.find(i => i.id === issueId)
      || demoApiData.demoIssuesResponse.issues[0];
    return {
      ...issue,
      sampleStackTrace: `java.lang.NullPointerException
    at com.shopflow.checkout.CartManager.calculateTotal(CartManager.java:156)
    at com.shopflow.checkout.CheckoutActivity.onCheckoutPressed(CheckoutActivity.java:89)
    at android.view.View.performClick(View.java:7448)`,
    } as IssueDetail;
  }

  return fetchJson<IssueDetail>(`/api/general/${issueId}`);
}

/**
 * Get sessions for a specific issue
 */
export async function getIssueSessions(issueId: string, limit: number = 6): Promise<{ sessions: IssueSession[] }> {
  if (isDemoMode()) {
    return { sessions: demoApiData.demoIssueSessions };
  }

  return fetchJson<{ sessions: IssueSession[] }>(`/api/general/${issueId}/sessions?limit=${limit}`);
}

/**
 * Sync issues for a project
 */
export async function syncIssues(projectId: string): Promise<void> {
  if (isDemoMode()) return;

  await fetchJson<void>(`/api/general/sync?projectId=${projectId}`, { method: 'POST' });
}

/**
 * Update an issue (status, priority, assignee)
 */
export async function updateIssue(issueId: string, updates: { status?: 'unresolved' | 'resolved' | 'ignored' | 'ongoing'; priority?: string; assigneeId?: string | null }): Promise<Issue> {
  if (isDemoMode()) {
    // Return a mock updated issue for demo mode
    return {} as Issue;
  }

  return fetchJson<Issue>(`/api/general/${issueId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * All-time heatmap screen data
 */
export interface AlltimeHeatmapScreen {
  name: string;
  visits: number;
  rageTaps: number;
  errors: number;
  exitRate: number;
  frictionScore: number;
  screenshotUrl: string | null;
  sessionIds?: string[];
  touchHotspots: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }>;
}
// Added sessionIds to fix lint errors in Realtime.tsx

export interface AlltimeHeatmapResponse {
  screens: AlltimeHeatmapScreen[];
  lastUpdated: string;
}

/**
 * Get all-time aggregated touch heatmap data from database.
 * Independent of time filter - shows accumulated touch patterns.
 * Cached for 5 minutes on the backend.
 */
export async function getAlltimeHeatmap(projectId?: string): Promise<AlltimeHeatmapResponse> {
  if (isDemoMode()) {
    return {
      screens: [
        {
          name: 'HomeScreen',
          visits: 4520,
          rageTaps: 89,
          errors: 12,
          exitRate: 5,
          frictionScore: 267,
          screenshotUrl: null,
          touchHotspots: [
            { x: 0.5, y: 0.25, intensity: 1.0, isRageTap: false },
            { x: 0.3, y: 0.5, intensity: 0.8, isRageTap: false },
            { x: 0.7, y: 0.5, intensity: 0.7, isRageTap: false },
            { x: 0.5, y: 0.85, intensity: 0.6, isRageTap: true },
          ],
        },
        {
          name: 'ProductScreen',
          visits: 2890,
          rageTaps: 45,
          errors: 8,
          exitRate: 12,
          frictionScore: 135,
          screenshotUrl: null,
          touchHotspots: [
            { x: 0.5, y: 0.3, intensity: 0.9, isRageTap: false },
            { x: 0.5, y: 0.7, intensity: 0.7, isRageTap: false },
            { x: 0.8, y: 0.2, intensity: 0.4, isRageTap: true },
          ],
        },
        {
          name: 'CartScreen',
          visits: 1650,
          rageTaps: 67,
          errors: 15,
          exitRate: 18,
          frictionScore: 201,
          screenshotUrl: null,
          touchHotspots: [
            { x: 0.5, y: 0.9, intensity: 1.0, isRageTap: false },
            { x: 0.3, y: 0.4, intensity: 0.5, isRageTap: true },
            { x: 0.7, y: 0.4, intensity: 0.5, isRageTap: false },
          ],
        },
        {
          name: 'SettingsScreen',
          visits: 890,
          rageTaps: 23,
          errors: 3,
          exitRate: 8,
          frictionScore: 69,
          screenshotUrl: null,
          touchHotspots: [
            { x: 0.5, y: 0.3, intensity: 0.6, isRageTap: false },
            { x: 0.5, y: 0.5, intensity: 0.5, isRageTap: false },
          ],
        },
      ],
      lastUpdated: new Date().toISOString(),
    };
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);

  return fetchWithCache<AlltimeHeatmapResponse>(`/api/insights/alltime-heatmap?${params.toString()}`);
}

// =============================================================================
// Teams API
// =============================================================================

export interface ApiTeam {
  id: string;
  ownerUserId: string;
  name?: string;
  billingPlan?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  email: string;
  displayName?: string;
  createdAt: string;
}

/**
 * Get all teams for current user
 */
export async function getTeams(): Promise<ApiTeam[]> {
  const data = await fetchJson<{ teams: ApiTeam[] }>('/api/teams');
  return data.teams || [];
}

/**
 * Get a specific team
 */
export async function getTeam(teamId: string): Promise<ApiTeam> {
  const data = await fetchJson<{ team: ApiTeam }>(`/api/teams/${teamId}`);
  return data.team;
}

/**
 * Create a new team
 */
export async function createTeam(name?: string): Promise<ApiTeam> {
  const data = await fetchJson<{ team: ApiTeam }>('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return data.team;
}

/**
 * Update team settings
 */
export async function updateTeam(teamId: string, updates: { name?: string; billingPlan?: string }): Promise<ApiTeam> {
  const data = await fetchJson<{ team: ApiTeam }>(`/api/teams/${teamId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.team;
}

export interface DeleteTeamResponse {
  success: boolean;
  deletedProjectCount: number;
  billing: {
    hadActiveSubscription: boolean;
    subscriptionCancelled: boolean;
    downgradedToFree: boolean;
    warning: string | null;
  };
}

/**
 * Request OTP for team deletion.
 */
export async function requestTeamDeletionOtp(
  teamId: string,
  payload: { confirmText: string; acknowledgeBillingDowngrade?: boolean }
): Promise<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }> {
  return fetchJson<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }>(
    `/api/teams/${teamId}/delete-otp`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

/**
 * Delete a team and all nested projects/data.
 */
export async function deleteTeam(
  teamId: string,
  payload: { confirmText: string; otpCode: string; acknowledgeBillingDowngrade?: boolean }
): Promise<DeleteTeamResponse> {
  return fetchJson<DeleteTeamResponse>(`/api/teams/${teamId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

/**
 * Get team members
 */
export async function getTeamMembers(teamId: string): Promise<ApiTeamMember[]> {
  const data = await fetchJson<{ members: ApiTeamMember[] }>(`/api/teams/${teamId}/members`);
  return data.members || [];
}

/**
 * Add a member to team (or send invitation if user doesn't exist)
 */
export async function addTeamMember(
  teamId: string,
  email: string,
  role: string = 'member'
): Promise<{ member?: ApiTeamMember; invitation?: ApiTeamInvitation; message?: string }> {
  const data = await fetchJson<{
    member?: ApiTeamMember;
    invitation?: ApiTeamInvitation;
    message?: string;
  }>(`/api/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return data;
}

/**
 * Update member role
 */
export async function updateTeamMember(teamId: string, userId: string, role: string): Promise<void> {
  await fetchJson<void>(`/api/teams/${teamId}/members`, {
    method: 'PUT',
    body: JSON.stringify({ userId, role }),
  });
}

/**
 * Remove member from team
 */
export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await fetchJson<void>(`/api/teams/${teamId}/members`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  });
}

// ===========================================================================
// Team Invitations API
// ===========================================================================

export interface ApiTeamInvitation {
  id: string;
  teamId: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  inviterEmail?: string;
  inviterName?: string;
  expired?: boolean;
  // For public invitation lookup
  teamName?: string;
  accepted?: boolean;
}

/**
 * Get pending invitations for a team
 */
export async function getTeamInvitations(teamId: string): Promise<ApiTeamInvitation[]> {
  const data = await fetchJson<{ invitations: ApiTeamInvitation[] }>(
    `/api/teams/${teamId}/invitations`
  );
  return data.invitations || [];
}

/**
 * Cancel/delete an invitation
 */
export async function cancelInvitation(teamId: string, invitationId: string): Promise<void> {
  await fetchJson<void>(`/api/teams/${teamId}/invitations/${invitationId}`, {
    method: 'DELETE',
  });
}

/**
 * Resend an invitation email
 */
export async function resendInvitation(teamId: string, invitationId: string): Promise<void> {
  await fetchJson<void>(`/api/teams/${teamId}/invitations/${invitationId}/resend`, {
    method: 'POST',
  });
}

/**
 * Get invitation details by token (for accept page)
 */
export async function getInvitationByToken(token: string): Promise<ApiTeamInvitation> {
  const data = await fetchJson<{ invitation: ApiTeamInvitation }>(
    `/api/teams/invitations/${token}`
  );
  return data.invitation;
}

/**
 * Accept an invitation
 */
export async function acceptInvitation(token: string): Promise<{ success: boolean; team?: { id: string; name?: string } }> {
  const data = await fetchJson<{ success: boolean; team?: { id: string; name?: string } }>(
    '/api/teams/invitations/accept',
    {
      method: 'POST',
      body: JSON.stringify({ token }),
    }
  );
  return data;
}

// =============================================================================
// Geographic Data API
// =============================================================================

export interface GeoSummary {
  countries: Array<{
    country: string;
    count: number;
    latitude?: number;
    longitude?: number;
    crashCount?: number;
    rageTapCount?: number;
    topCities: Array<{ city: string; count: number; latitude?: number; longitude?: number }>;
  }>;
  totalWithGeo: number;
}

export interface GeoRegionalValue {
  regions: Array<{
    country: string;
    sessions: number;
    valueSessions: number;
    valueShare: number;
    avgDurationSeconds: number;
    engagementSegments: {
      bouncers: number;
      casuals: number;
      explorers: number;
      loyalists: number;
    };
  }>;
  summary: {
    totalSessions: number;
    totalValueSessions: number;
    valueShare: number;
    avgDurationSeconds: number;
    regionCount: number;
  };
}

/**
 * Get geographic summary for map
 */
export async function getGeoSummary(projectId?: string, timeRange?: string): Promise<GeoSummary> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoGeoSummary;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:geo-summary:${projectId || 'all'}:${timeRange || 'all'}`;
  const data = await fetchWithCache<GeoSummary>(`/api/analytics/geo-summary${qs}`, {}, cacheKey);
  return data;
}

/**
 * Get value + engagement segment mix by region
 */
export async function getGeoValueByRegion(projectId?: string, timeRange?: string): Promise<GeoRegionalValue> {
  if (isDemoMode()) {
    return demoApiData.demoGeoRegionalValue;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:geo-value:${projectId || 'all'}:${timeRange || 'all'}`;
  return fetchWithCache<GeoRegionalValue>(`/api/analytics/geo-value${qs}`, {}, cacheKey);
}

// =============================================================================
// Geographic Issues (Issues by location)
// =============================================================================

export interface GeoIssueLocation {
  country: string;
  city: string;
  lat: number;
  lng: number;
  sessions: number;
  uniqueUsers: number;
  issues: {
    crashes: number;
    anrs: number;
    errors: number;
    rageTaps: number;
    apiErrors: number;
    total: number;
  };
  growthRate?: number;
}

export interface GeoIssueCountry {
  country: string;
  sessions: number;
  uniqueUsers: number;
  crashes: number;
  anrs: number;
  errors: number;
  rageTaps: number;
  apiErrors: number;
  totalIssues: number;
  issueRate: number;
}

export interface GeoIssuesSummary {
  locations: GeoIssueLocation[];
  countries: GeoIssueCountry[];
  summary: {
    totalIssues: number;
    byType: {
      crashes: number;
      anrs: number;
      errors: number;
      rageTaps: number;
      apiErrors: number;
    };
  };
}

/**
 * Get geo issues summary
 */
export async function getGeoIssues(projectId?: string, timeRange?: string): Promise<GeoIssuesSummary> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoGeoIssues;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:geo-issues:${projectId || 'all'}:${timeRange || 'all'}`;
  const data = await fetchWithCache<GeoIssuesSummary>(`/api/analytics/geo-issues${qs}`, {}, cacheKey);
  return data;
}

// =============================================================================
// Region Performance (API latency by region)
// =============================================================================

export interface RegionStats {
  code: string;
  name: string;
  avgLatencyMs: number;
  totalCalls: number;
  sessionCount: number;
}

export interface RegionPerformance {
  fastestRegions: RegionStats[];
  slowestRegions: RegionStats[];
  allRegions: RegionStats[];
}

/**
 * Get API performance by region (fastest/slowest regions)
 */
export async function getRegionPerformance(projectId: string, timeRange?: string): Promise<RegionPerformance> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoRegionPerformance;
  }

  const params = new URLSearchParams({ projectId });
  if (timeRange) params.set('timeRange', timeRange);
  const cacheKey = `analytics:region-performance:${projectId}:${timeRange || 'all'}`;
  return fetchWithCache<RegionPerformance>(`/api/analytics/region-performance?${params.toString()}`, {}, cacheKey);
}

/**
 * API Endpoint Stats interface (for API Analytics page)
 */
export interface ApiEndpointStats {
  slowestEndpoints: Array<{
    endpoint: string;
    totalCalls: number;
    totalErrors: number;
    avgLatencyMs: number;
    errorRate: number;
    statusCodeBreakdown: Record<string, number>;
    mostCommonErrorCode: string | null;
  }>;
  erroringEndpoints: Array<{
    endpoint: string;
    totalCalls: number;
    totalErrors: number;
    avgLatencyMs: number;
    errorRate: number;
    statusCodeBreakdown: Record<string, number>;
    mostCommonErrorCode: string | null;
  }>;
  allEndpoints: Array<{
    endpoint: string;
    totalCalls: number;
    totalErrors: number;
    avgLatencyMs: number;
    errorRate: number;
    statusCodeBreakdown: Record<string, number>;
    mostCommonErrorCode: string | null;
  }>;
  summary: { totalCalls: number; avgLatency: number; errorRate: number };
}

/**
 * Get API endpoint performance stats
 */
export async function getApiEndpointStats(projectId: string, timeRange?: string): Promise<ApiEndpointStats> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoApiEndpointStats;
  }

  const params = new URLSearchParams({ projectId });
  if (timeRange) params.set('timeRange', timeRange);
  const cacheKey = `analytics:api-endpoint-stats:v2:${projectId}:${timeRange || 'all'}`;
  return fetchWithCache<ApiEndpointStats>(`/api/analytics/api-endpoint-stats?${params.toString()}`, {}, cacheKey);
}

// =============================================================================
// Device Summary
// =============================================================================

export interface DeviceSummary {
  devices: Array<{ model: string; count: number; crashes: number; anrs: number; errors: number; rageTaps: number }>;
  platforms: Record<string, number>;
  appVersions: Array<{ version: string; count: number; crashes: number; anrs: number; errors: number; rageTaps: number }>;
  osVersions: Array<{ version: string; count: number; crashes: number; anrs: number; errors: number; rageTaps: number }>;
  totalSessions: number;
}

export async function getDeviceSummary(projectId?: string, timeRange?: string): Promise<DeviceSummary> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoDeviceSummary;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:device-summary:${projectId || 'all'}:${timeRange || 'all'}`;
  return fetchWithCache<DeviceSummary>(`/api/analytics/device-summary${qs}`, {}, cacheKey);
}

export interface DeviceIssueMatrix {
  matrix: Array<{
    device: string;
    version: string;
    sessions: number;
    issues: { crashes: number; anrs: number; errors: number; rageTaps: number };
    issueRate: number;
  }>;
  devices: string[];
  versions: string[];
}

export async function getDeviceIssueMatrix(projectId?: string, timeRange?: string): Promise<DeviceIssueMatrix> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    // Basic mock
    return { matrix: [], devices: [], versions: [] };
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:device-issues-matrix:${projectId || 'all'}:${timeRange || 'all'}`;
  return fetchWithCache<DeviceIssueMatrix>(`/api/analytics/device-issues-matrix${qs}`, {}, cacheKey);
}

// =============================================================================
// Journey Summary
// =============================================================================

export interface JourneySummary {
  topScreens: Array<{ screen: string; visits: number }>;
  flows: Array<{ from: string; to: string; count: number }>;
  entryPoints: Array<{ screen: string; count: number }>;
  exitPoints: Array<{ screen: string; count: number }>;
}

export async function getJourneySummary(projectId?: string, timeRange?: string): Promise<JourneySummary> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoJourneySummary;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:journey-summary:${projectId || 'all'}:${timeRange || 'all'}`;
  return fetchWithCache<JourneySummary>(`/api/analytics/journey-summary${qs}`, {}, cacheKey);
}

// =============================================================================
// Journey Observability (Observability-centric journey analysis)
// =============================================================================

export interface ObservabilityJourneySummary {
  healthSummary: {
    healthy: number;
    degraded: number;
    problematic: number;
  };
  flows: Array<{
    from: string;
    to: string;
    count: number;
    apiErrors: number;
    apiErrorRate: number;
    avgApiLatencyMs: number;
    rageTapCount: number;
    crashCount: number;
    anrCount: number;
    health: 'healthy' | 'degraded' | 'problematic';
    replayCount: number;
    sampleSessionIds?: string[];
  }>;
  problematicJourneys: Array<{
    path: string[];
    sessionCount: number;
    crashes: number;
    anrs: number;
    apiErrors: number;
    rageTaps: number;
    failureScore: number;
    sampleSessionIds: string[];
  }>;
  happyPathJourney: {
    path: string[];
    sessionCount: number;
    crashes: number;
    anrs: number;
    apiErrors: number;
    rageTaps: number;
    failureScore: number;
    health: 'healthy' | 'degraded';
    sampleSessionIds: string[];
  } | null;
  configuredHappyPath: {
    projectId: string;
    path: string[];
    targetScreen: string;
    confidence: number;
    sampleSize: number;
    updatedAt: string | null;
  } | null;
  exitAfterError: Array<{
    screen: string;
    exitCount: number;
    errorTypes: { api: number; crash: number; rage: number };
    sampleSessionIds: string[];
  }>;
  timeToFailure: {
    avgTimeBeforeFirstErrorMs: number | null;
    avgScreensBeforeCrash: number | null;
    avgInteractionsBeforeRageTap: number | null;
  };
  screenHealth: Array<{
    name: string;
    visits: number;
    health: 'healthy' | 'degraded' | 'problematic';
    crashes: number;
    anrs: number;
    apiErrors: number;
    rageTaps: number;
    replayAvailable: boolean;
  }>;
  topScreens: Array<{ screen: string; visits: number }>;
  entryPoints: Array<{ screen: string; count: number }>;
  exitPoints: Array<{ screen: string; count: number }>;
}

export async function getJourneyObservability(
  projectId?: string,
  timeRange?: string,
  mode: 'full' | 'summary' = 'full',
): Promise<ObservabilityJourneySummary> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoJourneyObservability;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  if (mode !== 'full') params.set('mode', mode);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:journey-observability:${projectId || 'all'}:${timeRange || 'all'}:${mode}`;
  return fetchWithCache<ObservabilityJourneySummary>(`/api/analytics/journey-observability${qs}`, {}, cacheKey);
}

// =============================================================================
// Growth Observability (Failure-segmented sessions and growth killers)
// =============================================================================

export interface GrowthObservability {
  sessionHealth: {
    clean: number;
    error: number;
    rage: number;
    slow: number;
    crash: number;
  };
  firstSessionSuccessRate: number;
  firstSessionStats: {
    total: number;
    clean: number;
    withCrash: number;
    withAnr: number;
    withRageTaps: number;
    withSlowApi: number;
  };
  newUserGrowth?: {
    acquiredUsers: number;
    activeUsers: number;
    acquisitionRate: number;
    returnedUsers: number;
    returnRate: number;
  };
  growthKillers: Array<{
    reason: string;
    affectedSessions: number;
    percentOfTotal: number;
    deltaVsPrevious: number;
    relatedScreen?: string;
    sampleSessionIds: string[];
  }>;
  dailyHealth: Array<{
    date: string;
    clean: number;
    error: number;
    rage: number;
    slow: number;
    crash: number;
  }>;
  customEvents?: Array<{
    name: string;
    count: number;
  }>;
}

export async function getGrowthObservability(
  projectId?: string,
  timeRange?: string,
  mode: 'full' | 'summary' = 'full',
): Promise<GrowthObservability> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoGrowthObservability;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  if (mode !== 'full') params.set('mode', mode);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:growth-observability:${projectId || 'all'}:${timeRange || 'all'}:${mode}`;
  return fetchWithCache<GrowthObservability>(`/api/analytics/growth-observability${qs}`, {}, cacheKey);
}

// =============================================================================
// Observability Deep Metrics (Sentry-style metrics derived from existing schema)
// =============================================================================

export interface ObservabilityDeepMetrics {
  dataWindow: {
    totalSessions: number;
    analyzedSessions: number;
    sampled: boolean;
    visualReplayCoverageRate: number;
    analyticsCoverageRate: number;
  };
  reliability: {
    crashFreeSessionRate: number;
    anrFreeSessionRate: number;
    errorFreeSessionRate: number;
    frustrationFreeSessionRate: number;
    degradedSessionRate: number;
    apiFailureRate: number;
    platformBreakdown?: Array<{
      platform: string;
      crashFreeSessionRate: number;
      anrFreeSessionRate: number;
    }>;
  };
  performance: {
    apiApdex: number | null;
    p50ApiResponseMs: number | null;
    p95ApiResponseMs: number | null;
    p99ApiResponseMs: number | null;
    slowApiSessionRate: number;
    p50StartupMs: number | null;
    p95StartupMs: number | null;
    slowStartupRate: number;
  };
  impact: {
    uniqueUsers: number;
    affectedUsers: number;
    affectedUserRate: number;
    issueReoccurrenceRate: number;
  };
  ingestHealth: {
    sdkUploadSuccessRate: number | null;
    sessionsWithUploadFailures: number;
    sessionsWithOfflinePersist: number;
    sessionsWithMemoryEvictions: number;
    sessionsWithCircuitBreakerOpen: number;
    sessionsWithHeavyRetries: number;
  };
  networkBreakdown: Array<{
    networkType: string;
    sessions: number;
    apiCalls: number;
    apiErrorRate: number;
    avgLatencyMs: number;
  }>;
  releaseRisk: Array<{
    version: string;
    sessions: number;
    degradedSessions: number;
    failureRate: number;
    deltaVsOverall: number;
    crashCount: number;
    anrCount: number;
    errorCount: number;
    firstSeen?: string;
    latestSeen: string;
  }>;
  evidenceSessions: Array<{
    title: string;
    description: string;
    metric: string;
    value: string;
    sessionIds: string[];
  }>;
}

export async function getObservabilityDeepMetrics(
  projectId?: string,
  timeRange?: string,
  mode: 'full' | 'summary' = 'full',
): Promise<ObservabilityDeepMetrics> {
  if (isDemoMode()) {
    return demoApiData.demoObservabilityDeepMetrics;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  if (mode !== 'full') params.set('mode', mode);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:observability-deep-metrics:${projectId || 'all'}:${timeRange || 'all'}:${mode}`;
  return fetchWithCache<ObservabilityDeepMetrics>(`/api/analytics/observability-deep-metrics${qs}`, {}, cacheKey);
}

// =============================================================================
// User Engagement Trends (unique users per segment per day)
// =============================================================================

export interface UserEngagementTrends {
  daily: Array<{
    date: string;
    bouncers: number;
    casuals: number;
    explorers: number;
    loyalists: number;
  }>;
  totals: {
    bouncers: number;
    casuals: number;
    explorers: number;
    loyalists: number;
  };
}

export async function getUserEngagementTrends(projectId?: string, timeRange?: string): Promise<UserEngagementTrends> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoUserEngagementTrends;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `analytics:user-engagement-trends:${projectId || 'all'}:${timeRange || 'all'}`;
  return fetchWithCache<UserEngagementTrends>(`/api/analytics/user-engagement-trends${qs}`, {}, cacheKey);
}

// =============================================================================
// User Segments
// =============================================================================

export interface UserSegmentsSummary {
  segments: Array<{
    name: string;
    count: number;
    color: string;
    examples: string[];
  }>;
  totalSessions: number;
}

export async function getAnalyticsUserSegments(projectId?: string, timeRange?: string): Promise<UserSegmentsSummary> {
  // Demo mode: return mock data
  if (isDemoMode()) {
    return demoApiData.demoUserSegmentsSummary;
  }

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (timeRange) params.set('timeRange', timeRange);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<UserSegmentsSummary>(`/api/analytics/user-segments${qs}`);
}

// =============================================================================
// JS Errors API
// =============================================================================

export interface JSError {
  id: string;
  sessionId: string | null;
  timestamp: string;
  errorType: string;
  errorName: string;
  message: string;
  stack: string | null;
  screenName: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  fingerprint: string | null;
  status: string;
  createdAt: string;
}

export interface ErrorsResponse {
  errors: JSError[];
  grouped: Array<{
    errorName: string;
    message: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    sampleSessionId: string | null;
  }>;
  summary: {
    total: number;
    jsErrors: number;
    promiseRejections: number;
    unhandledExceptions: number;
  };
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
}

/**
 * Get JS errors with filtering and search
 */
export async function getErrors(
  projectId: string,
  options?: {
    timeRange?: string;
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<ErrorsResponse> {
  if (isDemoMode()) {
    return demoApiData.demoErrorsResponse;
  }
  const params = new URLSearchParams({ projectId });
  if (options?.timeRange) params.set('timeRange', options.timeRange);
  if (options?.search) params.set('search', options.search);
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  return fetchJson<ErrorsResponse>(`/api/analytics/errors?${params.toString()}`);
}

/**
 * Get a single JS error by ID
 */
export async function getError(projectId: string, errorId: string): Promise<any> {
  if (isDemoMode()) {
    return demoApiData.demoErrorsResponse.errors.find((e: any) => e.id === errorId) || demoApiData.demoErrorsResponse.errors[0];
  }
  const data = await fetchJson<any>(`/api/projects/${projectId}/errors/${errorId}`);
  return data;
}

// =============================================================================
// Funnel Stats
// =============================================================================

// =============================================================================
// Workspace API (Tab State Persistence)
// =============================================================================

export interface WorkspaceTab {
  id: string;
  title: string;
  path: string;
}

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  recentlyClosed: WorkspaceTab[];
  workspaceKey: string;
}

/**
 * Get workspace state (tabs, active tab, recently closed)
 * Uses longer cache (2 min) since workspace rarely changes - avoids slow loads when switching tabs.
 */
export async function getWorkspace(
  teamId: string,
  projectId: string,
  workspaceKey: string = 'default'
): Promise<WorkspaceState> {
  if (!isUuid(teamId) || !isUuid(projectId)) {
    return {
      tabs: [],
      activeTabId: null,
      recentlyClosed: [],
      workspaceKey,
    };
  }

  const params = new URLSearchParams({ teamId, projectId, key: workspaceKey });
  const endpoint = `/api/workspace?${params.toString()}`;
  return fetchWithCache<WorkspaceState>(endpoint, {}, endpoint, WORKSPACE_CACHE_TTL);
}

/**
 * Save workspace state (tabs, active tab, recently closed)
 * Clears workspace cache so next load gets fresh data.
 */
export async function saveWorkspace(
  teamId: string,
  projectId: string,
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  recentlyClosed: WorkspaceTab[],
  workspaceKey: string = 'default'
): Promise<void> {
  if (!isUuid(teamId) || !isUuid(projectId)) {
    return;
  }

  await fetchJson<{ ok: boolean }>('/api/workspace', {
    method: 'PUT',
    body: JSON.stringify({
      teamId,
      projectId,
      tabs,
      activeTabId,
      recentlyClosed,
      workspaceKey,
    }),
  });
  // Invalidate workspace cache so next getWorkspace returns fresh data
  const params = new URLSearchParams({ teamId, projectId, key: workspaceKey });
  clearCache(`/api/workspace?${params.toString()}`);
}

/**
 * Rejourney API Service object
 */
export const api = {
  getSessions,
  getSession,
  getSessionCore,
  getSessionFrames,
  getSessionTimeline,
  getSessionHierarchy,
  getSessionStats,
  getSessionNetworkRequests,
  getSessionEvents,
  getDashboardStats,
  getDashboardStatsWithTimeRange,
  getRecordingSessions,
  getSessionsPaginated,
  getSessionsArchiveTotalCount,
  getRecordingSession,
  refreshSessions,
  subscribeToUpdates,
  getProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  getTeamBillingUsage,
  getTeamBillingDashboard,
  getStripeStatus,
  setupStripeForTeam,
  getPaymentMethods,
  addPaymentMethod,
  removePaymentMethod,
  createBillingPortalSession,
  getFreeTierStatus,
  getTeamPlan,
  updateTeamPlan,
  getAvailablePlans,
  getTeamSessionUsage,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getFrictionHeatmap,
  getApiLatencyByLocation,
  getInsightsTrends,
  getRetentionCohorts,
  getIssues,
  getIssue,
  getIssueSessions,
  syncIssues,
  updateIssue,
  getAlltimeHeatmap,
  getTeams,
  getTeam,
  getErrors,
  getError,
  getCrashes,
  getCrash,
  getANRs,
  getANR,
  getObservabilityDeepMetrics,
  getWorkspace,
  saveWorkspace,
  clearCache,
  // GDPR Data Export
  getDataExportStatus,
  exportUserData,
};

export default api;
