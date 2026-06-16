import { User, Project, RecordingSession, SessionEvent, ApiCall, Platform, TimeRange, ProjectDailyStats, Issue, IssueSession } from '~/shared/types';
import { isUuid } from '~/shared/lib/ids';
import { isPublicRoutePath } from '~/shared/lib/publicRoutePaths';
import { canOpenReplayFromSession } from '~/shared/lib/replayAvailability';
import * as demoApiData from '~/shared/data/demoApiData';
import { demoProjects, demoSessions } from '~/shared/data/demoData';
import { buildDemoHeatmapOverview, getDemoWebAttentionHeatmap } from '~/shared/data/demoHeatmapData';

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

export class ApiUnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
        super(message);
        this.name = 'ApiUnauthorizedError';
    }
}

export class ApiServiceUnavailableError extends Error {
    readonly status?: number;

    constructor(message = 'Service temporarily unavailable', status?: number) {
        super(message);
        this.name = 'ApiServiceUnavailableError';
        this.status = status;
    }
}

class ApiHttpError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(message: string, status: number, body: unknown) {
        super(message);
        this.name = 'ApiHttpError';
        this.status = status;
        this.body = body;
    }
}

type SessionProbeResult = 'authenticated' | 'unauthenticated' | 'unavailable';
let sessionProbePromise: Promise<SessionProbeResult> | null = null;

function isTransientStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 425;
}

async function probeCurrentSession(): Promise<SessionProbeResult> {
    if (typeof window === 'undefined') {
        return 'unavailable';
    }

    if (sessionProbePromise) {
        return sessionProbePromise;
    }

    sessionProbePromise = (async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/me?_=${Date.now()}`, {
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    Pragma: 'no-cache',
                },
            });

            if (response.ok) return 'authenticated';
            if (response.status === 401 || response.status === 403) return 'unauthenticated';
            return 'unavailable';
        } catch {
            return 'unavailable';
        } finally {
            sessionProbePromise = null;
        }
    })();

    return sessionProbePromise;
}

async function handleUnauthorized(endpoint: string): Promise<never> {
    if (typeof window === 'undefined') {
        throw new ApiUnauthorizedError();
    }

    // Never redirect to login from demo routes
    if (window.location.pathname.startsWith('/demo')) {
        throw new ApiUnauthorizedError();
    }

    const sessionState = await probeCurrentSession();

    if (sessionState === 'unavailable') {
        throw new ApiServiceUnavailableError('Authentication service is temporarily unavailable. Your session was not cleared.', 503);
    }

    if (sessionState === 'authenticated') {
        throw new ApiUnauthorizedError(`Unauthorized request to ${endpoint}`);
    }

    cache.clear();
    if (!isPublicRoutePath(window.location.pathname)) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}&reason=session_expired`);
    }

    throw new ApiUnauthorizedError();
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

    let response: Response;
    try {
        response = await fetch(`${API_BASE_URL}${endpoint}`, requestInit);
    } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') {
            throw error;
        }
        if (typeof window !== 'undefined') {
            console.error('[fetchJson] API network error', { method, endpoint, error });
        }
        throw new ApiServiceUnavailableError('API service is temporarily unavailable. Please try again shortly.', 503);
    }

    if (response.status === 401) {
        await handleUnauthorized(endpoint);
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
        if (isTransientStatus(response.status)) {
            const message =
                parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as { message: unknown }).message === 'string'
                    ? (parsed as { message: string }).message
                    : `API service is temporarily unavailable: ${response.status} ${response.statusText}`;
            throw new ApiServiceUnavailableError(message, response.status);
        }
        if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as { message: unknown }).message === 'string') {
            throw new ApiHttpError((parsed as { message: string }).message, response.status, parsed);
        }
        throw new ApiHttpError(`API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`, response.status, parsed ?? text);
    }

    if (response.status === 204) return undefined as unknown as T;
    return response.json() as Promise<T>;
}

/** True for errors that often clear after idle (stale connections, LB blips). */
function isTransientApiError(err: unknown): boolean {
    if (err instanceof ApiServiceUnavailableError) return true;
    if (!(err instanceof Error)) return false;
    if (err.message === 'Unauthorized') return false;
    const msg = err.message;
    if (/Failed to fetch|NetworkError|Load failed|network error|timed out/i.test(msg)) return true;
    if (/^API error: 502\b|^API error: 503\b|^API error: 504\b/i.test(msg)) return true;
    return false;
}

async function fetchJsonWithTransientRetry<T>(endpoint: string, options: RequestInit = {}, maxAttempts = 3): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fetchJson<T>(endpoint, options);
        } catch (e) {
            if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
            last = e;
            if (attempt === maxAttempts - 1 || !isTransientApiError(e)) throw e;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
    }
    throw last;
}

// Cache for API responses
const cache = new Map<string, { data: any; timestamp: number }>();
const inFlightGetRequests = new Map<string, Promise<any>>();
const CACHE_TTL = 60000; // 60 seconds - helps tab switching feel instant when returning
const PROJECTS_CACHE_TTL = 30000;
const WORKSPACE_CACHE_TTL = 120000; // 2 minutes - workspace rarely changes
const ANALYTICS_BOOTSTRAP_CACHE_TTL = 60000;
const ARCHIVE_CACHE_TTL = 30000;
const SESSION_BOOTSTRAP_CACHE_TTL = 15000;
const SESSION_DETAIL_CACHE_VERSION = 'v5';

/**
 * Fetch with caching and error handling
 */
async function fetchWithCache<T>(endpoint: string, options: RequestInit = {}, cacheKey?: string, ttlMs?: number): Promise<T> {
    const key = cacheKey || endpoint;
    const ttl = ttlMs ?? CACHE_TTL;

    // Check cache
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data as T;
    }

    const method = (options.method ?? 'GET').toUpperCase();
    const canShareInFlight = (method === 'GET' || method === 'HEAD') && !options.signal;
    if (canShareInFlight) {
        const inFlight = inFlightGetRequests.get(key);
        if (inFlight) {
            return inFlight as Promise<T>;
        }
    }

    const requestPromise = method === 'GET' || method === 'HEAD' ? fetchJsonWithTransientRetry<T>(endpoint, options) : fetchJson<T>(endpoint, options);

    if (canShareInFlight) {
        inFlightGetRequests.set(key, requestPromise);
    }

    try {
        const data = await requestPromise;
        cache.set(key, { data, timestamp: Date.now() });
        return data as T;
    } finally {
        if (canShareInFlight) {
            inFlightGetRequests.delete(key);
        }
    }
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
        systemVersion?: string;
        browser?: string;
        browserVersion?: string;
        screenWidth?: number;
        screenHeight?: number;
        pixelRatio?: number;
        appVersion?: string;
        sdkVersion?: string;
        userAgent?: string;
        networkType?: string;
        effectiveConnectionType?: string;
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
    sdkVersion?: string;
    events: any[];
    networkRequests: any[];
    batches: any[];
    screenshotFrames?: Array<{
        timestamp: number;
        url: string;
        proxyUrl?: string | null;
        index: number;
    }>;
    screenshotFramesStatus?: 'ready' | 'preparing' | 'none';
    screenshotFrameCount?: number;
    screenshotFramesProcessedSegments?: number;
    screenshotFramesTotalSegments?: number;
    playbackMode?: 'screenshots' | 'rrweb' | 'video' | 'none';
    rrwebReplay?: {
        events: any[];
        eventCount: number;
        segments: Array<{
            artifactId?: string;
            index: number;
            startTime: number | null;
            endTime: number | null;
            eventCount: number;
            sizeBytes: number | null;
            url: string | null;
            proxyUrl?: string | null;
        }>;
        page?: Record<string, unknown> | null;
        viewport?: Record<string, unknown> | null;
        loadMode?: 'inline' | 'segments';
    };
    webReferral?: string | null;
    webLandingRoute?: string | null;
    metadata?: Record<string, unknown>;
    stats: {
        duration: string;
        durationMinutes: string;
        eventCount: number;
        screenshotSegmentCount?: number;
        totalSizeBytes?: number;
        eventsSizeBytes?: number;
        screenshotSizeBytes?: number;
        hierarchySizeBytes?: number;
        networkSizeBytes?: number;
        totalSizeKB: string;
        kbPerMinute: string;
        eventsSizeKB: string;
        screenshotSizeKB?: string;
        hierarchySizeKB?: string;
        networkSizeKB?: string;
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
        apiAvgResponseMs?: number;
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
    isFirstSession?: boolean;
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
    sdkVersion?: string;
    deviceModel?: string;
    osVersion?: string;
    webReferral?: string | null;
    webLandingRoute?: string | null;
    metadata?: Record<string, unknown>;
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
    isFirstSession?: boolean;
    replayRetentionState?: 'saved' | 'buffered' | 'analytics_only' | 'not_available' | null;
    smartCaptureStatus?: 'not_applicable' | 'pending' | 'kept' | 'discarded';
    smartCaptureReason?: string | null;
    smartCaptureRuleId?: string | null;
    smartCaptureDecidedAt?: string | null;
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
        return demoApiData.getDemoFullSession(sessionId) as unknown as ApiSession;
    }
    return fetchWithCache<ApiSession>(`/api/session/${sessionId}`);
}

export interface ApiSessionTimeline {
    events: any[];
    networkRequests: any[];
    crashes: any[];
    anrs: any[];
    deviceInfo?: Record<string, any> | null;
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
        proxyUrl?: string | null;
        index: number;
    }>;
    screenshotFramesStatus: 'ready' | 'preparing' | 'none';
    screenshotFrameCount: number;
    screenshotFramesProcessedSegments: number;
    screenshotFramesTotalSegments: number;
}

export interface ApiSessionReplayManifest {
    hasRecording: boolean;
    playbackMode: 'screenshots' | 'rrweb' | 'video' | 'none';
    screenshotFrames: Array<{
        timestamp: number;
        url: string;
        proxyUrl?: string | null;
        index: number;
    }>;
    screenshotFramesStatus: 'ready' | 'preparing' | 'none';
    screenshotFrameCount: number;
    screenshotFramesProcessedSegments: number;
    screenshotFramesTotalSegments: number;
    rrwebReplay: NonNullable<ApiSession['rrwebReplay']>;
}

export interface ApiSessionBootstrapResponse {
    core: ApiSession;
    timeline: ApiSessionTimeline;
    stats: ApiSession['stats'];
    hierarchyDeferred?: boolean;
}

export type ReplayShareVisibility = 'replay_only' | 'full_workbench';
export type ReplayShareExpirationPreset = '24h' | '7d' | '30d' | '90d' | 'never';

export interface ReplayShareLink {
    id: string;
    publicId: string;
    visibility: ReplayShareVisibility;
    expirationPreset: ReplayShareExpirationPreset;
    expiresAt: string | null;
    revokedAt: string | null;
    lastAccessedAt: string | null;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    url: string;
}

export interface ReplayShareLinksResponse {
    canManage: boolean;
    teamId: string | null;
    shares: ReplayShareLink[];
}

function sharedReplayEndpoint(shareToken: string, path: string): string {
    return `/api/session/share/replay/${encodeURIComponent(shareToken)}${path}`;
}

export async function getSessionCore(
    sessionId: string,
    options?: { frameUrlMode?: 'signed' | 'proxy' | 'none'; includeReplay?: boolean; signal?: AbortSignal },
): Promise<ApiSession> {
    if (isDemoMode()) {
        return demoApiData.getDemoFullSession(sessionId) as unknown as ApiSession;
    }
    const params = new URLSearchParams();
    if (options?.frameUrlMode) params.set('frameUrlMode', options.frameUrlMode);
    if (options?.includeReplay === false) params.set('includeReplay', 'false');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return fetchWithCache<ApiSession>(`/api/session/${sessionId}/core${suffix}`, { signal: options?.signal });
}

export async function getSharedReplayCore(shareToken: string, options?: { includeReplay?: boolean; signal?: AbortSignal }): Promise<ApiSession> {
    const params = new URLSearchParams();
    if (options?.includeReplay === false) params.set('includeReplay', 'false');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return fetchWithCache<ApiSession>(
        sharedReplayEndpoint(shareToken, `/core${suffix}`),
        { signal: options?.signal },
        `shared-replay:core:${SESSION_DETAIL_CACHE_VERSION}:${shareToken}:${options?.includeReplay === false ? 'lite' : 'full'}`,
        1500,
    );
}

export async function getSessionBootstrap(sessionId: string, options?: { frameUrlMode?: 'signed' | 'proxy' | 'none' }): Promise<ApiSessionBootstrapResponse> {
    if (isDemoMode()) {
        const core = await getSessionCore(sessionId, options);
        const timeline = await getSessionTimeline(sessionId);
        return {
            core,
            timeline,
            stats: core.stats,
            hierarchyDeferred: true,
        };
    }

    const params = new URLSearchParams();
    if (options?.frameUrlMode) params.set('frameUrlMode', options.frameUrlMode);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `session:bootstrap:${SESSION_DETAIL_CACHE_VERSION}:${sessionId}:${options?.frameUrlMode || 'default'}`;
    return fetchWithCache<ApiSessionBootstrapResponse>(`/api/session/${sessionId}/bootstrap${suffix}`, {}, cacheKey, SESSION_BOOTSTRAP_CACHE_TTL);
}

export async function getSessionFrames(
    sessionId: string,
    options?: { frameUrlMode?: 'signed' | 'proxy' | 'none'; signal?: AbortSignal },
): Promise<ApiSessionFrames> {
    if (isDemoMode()) {
        const demo = demoApiData.getDemoFullSession(sessionId) as any;
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
    return fetchWithCache<ApiSessionFrames>(
        `/api/session/${sessionId}/frames${suffix}`,
        { signal: options?.signal },
        `session:frames:${SESSION_DETAIL_CACHE_VERSION}:${sessionId}:${options?.frameUrlMode || 'default'}`,
        1500,
    );
}

export async function getSharedReplayFrames(shareToken: string, options?: { signal?: AbortSignal }): Promise<ApiSessionFrames> {
    return fetchWithCache<ApiSessionFrames>(
        sharedReplayEndpoint(shareToken, '/frames'),
        { signal: options?.signal },
        `shared-replay:frames:${SESSION_DETAIL_CACHE_VERSION}:${shareToken}`,
        1500,
    );
}

export async function getSessionReplayManifest(
    sessionId: string,
    options?: { frameUrlMode?: 'signed' | 'proxy' | 'none'; signal?: AbortSignal },
): Promise<ApiSessionReplayManifest> {
    if (isDemoMode()) {
        const demo = demoApiData.getDemoFullSession(sessionId) as any;
        return {
            hasRecording: Boolean(demo.hasRecording),
            playbackMode: demo.playbackMode || 'none',
            screenshotFrames: demo.screenshotFrames || [],
            screenshotFramesStatus: demo.screenshotFramesStatus || 'none',
            screenshotFrameCount: demo.screenshotFrameCount || demo.screenshotFrames?.length || 0,
            screenshotFramesProcessedSegments: demo.screenshotFramesProcessedSegments || 0,
            screenshotFramesTotalSegments: demo.screenshotFramesTotalSegments || 0,
            rrwebReplay: demo.rrwebReplay || { events: [], eventCount: 0, segments: [], page: null, viewport: null, loadMode: 'inline' },
        };
    }

    const params = new URLSearchParams();
    if (options?.frameUrlMode) params.set('frameUrlMode', options.frameUrlMode);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `session:replay-manifest:${SESSION_DETAIL_CACHE_VERSION}:${sessionId}:${options?.frameUrlMode || 'default'}`;
    return fetchWithCache<ApiSessionReplayManifest>(
        `/api/session/${sessionId}/replay-manifest${suffix}`,
        { signal: options?.signal },
        cacheKey,
        SESSION_BOOTSTRAP_CACHE_TTL,
    );
}

export async function getSharedReplayManifest(shareToken: string, options?: { signal?: AbortSignal }): Promise<ApiSessionReplayManifest> {
    return fetchWithCache<ApiSessionReplayManifest>(
        sharedReplayEndpoint(shareToken, '/replay-manifest'),
        { signal: options?.signal },
        `shared-replay:manifest:${SESSION_DETAIL_CACHE_VERSION}:${shareToken}`,
        SESSION_BOOTSTRAP_CACHE_TTL,
    );
}

export async function getSessionTimeline(sessionId: string, options?: { signal?: AbortSignal }): Promise<ApiSessionTimeline> {
    if (isDemoMode()) {
        const demo = (await getSessionCore(sessionId)) as any;
        return {
            events: demo.events || [],
            networkRequests: demo.networkRequests || [],
            crashes: demo.crashes || [],
            anrs: demo.anrs || [],
        };
    }
    return fetchWithCache<ApiSessionTimeline>(
        `/api/session/${sessionId}/timeline`,
        { signal: options?.signal },
        `session:timeline:${SESSION_DETAIL_CACHE_VERSION}:${sessionId}`,
    );
}

export async function getSharedReplayTimeline(shareToken: string, options?: { signal?: AbortSignal }): Promise<ApiSessionTimeline> {
    return fetchWithCache<ApiSessionTimeline>(
        sharedReplayEndpoint(shareToken, '/timeline'),
        { signal: options?.signal },
        `shared-replay:timeline:${SESSION_DETAIL_CACHE_VERSION}:${shareToken}`,
    );
}

export async function getSessionHierarchy(sessionId: string, options?: { signal?: AbortSignal }): Promise<ApiSessionHierarchy> {
    if (isDemoMode()) {
        const demo = (await getSessionCore(sessionId)) as any;
        return {
            hierarchySnapshots: demo.hierarchySnapshots || [],
        };
    }
    return fetchWithCache<ApiSessionHierarchy>(
        `/api/session/${sessionId}/hierarchy`,
        { signal: options?.signal },
        `session:hierarchy:${SESSION_DETAIL_CACHE_VERSION}:${sessionId}`,
    );
}

export async function getSharedReplayHierarchy(shareToken: string, options?: { signal?: AbortSignal }): Promise<ApiSessionHierarchy> {
    return fetchWithCache<ApiSessionHierarchy>(
        sharedReplayEndpoint(shareToken, '/hierarchy'),
        { signal: options?.signal },
        `shared-replay:hierarchy:${SESSION_DETAIL_CACHE_VERSION}:${shareToken}`,
    );
}

export async function getSessionStats(sessionId: string, options?: { signal?: AbortSignal }): Promise<ApiSessionStats> {
    if (isDemoMode()) {
        const demo = (await getSessionCore(sessionId)) as any;
        return {
            stats: demo.stats,
        };
    }
    return fetchWithCache<ApiSessionStats>(
        `/api/session/${sessionId}/stats`,
        { signal: options?.signal },
        `session:stats:${SESSION_DETAIL_CACHE_VERSION}:${sessionId}`,
        SESSION_BOOTSTRAP_CACHE_TTL,
    );
}

export async function getSharedReplayStats(shareToken: string, options?: { signal?: AbortSignal }): Promise<ApiSessionStats> {
    return fetchWithCache<ApiSessionStats>(
        sharedReplayEndpoint(shareToken, '/stats'),
        { signal: options?.signal },
        `shared-replay:stats:${SESSION_DETAIL_CACHE_VERSION}:${shareToken}`,
        SESSION_BOOTSTRAP_CACHE_TTL,
    );
}

export async function getReplayShareLinks(sessionId: string): Promise<ReplayShareLinksResponse> {
    return fetchJson<ReplayShareLinksResponse>(`/api/session/${sessionId}/shares`);
}

export async function createReplayShareLink(
    sessionId: string,
    input: { visibility: ReplayShareVisibility; expiresIn: ReplayShareExpirationPreset },
): Promise<{ share: ReplayShareLink; reused: boolean; url: string }> {
    const result = await fetchJson<{ share: ReplayShareLink; reused: boolean; url: string }>(`/api/session/${sessionId}/shares`, {
        method: 'POST',
        body: JSON.stringify(input),
    });
    clearCache(`replay-shares:${sessionId}`);
    return result;
}

export async function revokeReplayShareLink(sessionId: string, shareId: string): Promise<{ share: ReplayShareLink }> {
    const result = await fetchJson<{ share: ReplayShareLink }>(`/api/session/${sessionId}/shares/${shareId}`, {
        method: 'DELETE',
    });
    clearCache(`replay-shares:${sessionId}`);
    return result;
}

/**
 * Load real hierarchy data for demo session
 */
async function getDemoSessionWithRealHierarchy(sessionId: string): Promise<any> {
    const basePath = `/demo/${sessionId}/hierarchy`;
    const hierarchyFiles = ['1769127030030.json', '1769127030034.json'];

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
            ...demoApiData.getDemoFullSession(sessionId),
            hierarchySnapshots: hierarchySnapshots.map((snap) => ({
                timestamp: snap.timestamp,
                screenName: null,
                rootElement: [snap],
            })),
        };
    } catch (err) {
        console.error('Failed to load real hierarchy for demo session:', err);
        return demoApiData.getDemoFullSession(sessionId) as unknown as ApiSession;
    }
}

/**
 * Get network requests for a session
 */
export async function getSessionNetworkRequests(sessionId: string, groupBy?: 'host' | 'path'): Promise<any> {
    const endpoint = groupBy ? `/api/session/${sessionId}/network?groupBy=${groupBy}` : `/api/session/${sessionId}/network`;
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
function normalizeApiPlatform(value: unknown, fallback?: unknown): Platform {
    const normalized = String(value || fallback || '')
        .trim()
        .toLowerCase();
    if (normalized === 'web') return 'web';
    if (normalized === 'android') return 'android';
    return 'ios';
}

function matchesPlatformFilter(value: unknown, platform?: string): boolean {
    if (!platform || platform === 'all') return true;
    const normalized = normalizeApiPlatform(value);
    if (platform === 'mobile') return normalized === 'ios' || normalized === 'android';
    return normalized === platform;
}

function readMetadataString(metadata: unknown, keys: string[]): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const record = metadata as Record<string, unknown>;
    for (const key of keys) {
        const value = record[key];
        if (value === null || value === undefined) continue;
        const normalized = String(value).trim();
        if (normalized) return normalized;
    }
    return null;
}

function toNonNegativeNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
}

function maxNonNegativeNumber(...values: unknown[]): number {
    const candidates = values.map(toNonNegativeNumber).filter((value): value is number => value !== null);
    return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function firstPositiveNumber(...values: unknown[]): number {
    for (const value of values) {
        const parsed = toNonNegativeNumber(value);
        if (parsed !== null && parsed > 0) return parsed;
    }
    return 0;
}

export function transformToRecordingSession(session: ApiSession | ApiSessionSummary): any {
    // Handle both old format (startTime as number) and new format (startedAt as ISO string)
    const startedAtValue = (session as any).startedAt || (session as any).startTime;
    const endedAtValue = (session as any).endedAt || (session as any).endTime || (session as any).explicitEndedAt;

    const startedAtMs = typeof startedAtValue === 'string' ? new Date(startedAtValue).getTime() : (startedAtValue as number);
    const endedAtMs = typeof endedAtValue === 'string' ? new Date(endedAtValue).getTime() : (endedAtValue as number);

    const startedAt = new Date(startedAtMs).toISOString();
    const endedAt = endedAtValue != null && Number.isFinite(endedAtMs) ? new Date(endedAtMs).toISOString() : undefined;

    const rawDuration = (session as any).durationSeconds;
    let durationSeconds = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0;

    // API may send durationSeconds: 0 while endedAt / explicitEndedAt are set (column not backfilled yet).
    if ((durationSeconds === 0 || rawDuration == null) && Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) && endedAtMs > startedAtMs) {
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
        apiAvgResponseMs: session.stats?.networkStats?.avgDuration || 0,
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
    const apiSuccessCount = Math.round(maxNonNegativeNumber(summary.apiSuccessCount, metrics.apiSuccessCount, session.stats?.networkStats?.successful));
    const apiErrorCount = Math.round(maxNonNegativeNumber(summary.apiErrorCount, metrics.apiErrorCount, session.stats?.networkStats?.failed));
    const apiTotalCount = Math.round(
        Math.max(maxNonNegativeNumber(summary.apiTotalCount, metrics.apiTotalCount, session.stats?.networkStats?.total), apiSuccessCount + apiErrorCount),
    );
    const rageTapCount = summary.rageTapCount ?? metrics.rageTapCount ?? 0;
    const interactionScore = summary.interactionScore ?? metrics.interactionScore ?? 50;
    const explorationScore = summary.explorationScore ?? metrics.explorationScore ?? 50;
    const metadata = (session as any).metadata;
    const webReferral = (session as any).webReferral ?? readMetadataString(metadata, ['webReferral', 'webReferrerDomain', 'webAttributionSource']);
    const webLandingRoute = (session as any).webLandingRoute ?? readMetadataString(metadata, ['webLandingRoute', 'webEntryPath']);

    const screensVisited = summary.screensVisited?.length
        ? summary.screensVisited
        : metrics.screensVisited && metrics.screensVisited.length > 0
          ? metrics.screensVisited
          : [];
    const readyReplayArtifacts = Number(session.stats?.screenshotSegmentCount ?? 0) > 0;
    const canOpenReplay = canOpenReplayFromSession(session as any, readyReplayArtifacts);

    return {
        id: session.id,
        projectId: (session as any).projectId || (session as any).appId || 'project_1', // Prefer projectId; fall back to legacy appId
        startedAt,
        endedAt,
        durationSeconds,
        platform: normalizeApiPlatform((session as any).platform, session.deviceInfo?.os),
        appVersion: (session as any).appVersion || session.deviceInfo?.appVersion || 'Unknown',
        sdkVersion: (session as any).sdkVersion || session.deviceInfo?.sdkVersion || undefined,
        deviceModel: (session as any).deviceModel || session.deviceInfo?.model || 'Unknown Device',
        osVersion: (session as any).osVersion || session.deviceInfo?.osVersion || undefined,
        webReferral,
        webLandingRoute,
        metadata,
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
        apiAvgResponseMs: firstPositiveNumber(summary.apiAvgResponseMs, metrics.apiAvgResponseMs, session.stats?.networkStats?.avgDuration),
        appStartupTimeMs: summary.appStartupTimeMs ?? undefined,
        rageTapCount,
        deadTapCount: summary.deadTapCount ?? 0,
        screensVisited,

        interactionScore,
        explorationScore,
        status: (session as any).status || 'ready',
        replayRetentionState: (session as any).replayRetentionState,
        smartCaptureStatus: (session as any).smartCaptureStatus,
        smartCaptureReason: (session as any).smartCaptureReason ?? null,
        smartCaptureRuleId: (session as any).smartCaptureRuleId ?? null,
        smartCaptureDecidedAt: (session as any).smartCaptureDecidedAt ?? null,
        effectiveStatus: (session as any).effectiveStatus ?? (session as any).status ?? 'ready',
        isLiveIngest: Boolean((session as any).isLiveIngest),
        isBackgroundProcessing: Boolean((session as any).isBackgroundProcessing),
        canOpenReplay,
        // Geo data if available
        geoLocation: session.geoLocation,
        // Device ID for DAU/MAU tracking
        deviceId: (session as any).deviceId || undefined,
        // Recording deletion status
        recordingDeleted: (session as any).recordingDeleted ?? false,
        recordingDeletedAt: (session as any).recordingDeletedAt ?? null,
        retentionDays: (session as any).retentionDays ?? 14,
        customEventCount: summary.customEventCount ?? metrics.customEventCount ?? 0,
        hasSuccessfulRecording: canOpenReplay,
        isFirstSession: Boolean((session as any).isFirstSession),
        visitorSessionNumber: (session as any).visitorSessionNumber ?? null,
        visitorFinalSessionNumber: (session as any).visitorFinalSessionNumber ?? null,
        checkoutStatus: (session as any).checkoutStatus ?? 'none',

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
    issueFilter?: 'all' | 'crashes' | 'anrs' | 'errors' | 'rage' | 'dead_taps' | 'slow_start' | 'slow_api' | 'new_user';
    smartCaptureStatus?: 'not_applicable' | 'pending' | 'kept' | 'discarded';
    smartCaptureRuleId?: string;
    smartCaptureRuleName?: string;
    lifecyclePreset?: 'early_user' | 'returning_user';
    sessionWindowSize?: number;
    conversionPreset?: 'checkout_bounced' | 'checkout_success';
    screenName?: string;
    screenOutcome?: 'bounced' | 'continued';
    /** Pipe-separated ordered screen path, e.g. "HomeScreen|CheckoutScreen|ConfirmationScreen" */
    screenPath?: string;
    /** Exact geo filters used by map drilldowns. */
    geoCountry?: string;
    geoCity?: string;
    metaKey?: string;
    metaValue?: string;
    metaFilters?: Array<{ key: string; value?: string }>;
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
    /** When 'OR', conditions are OR'd together instead of AND'd */
    conditionLogic?: 'OR';
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
        smartCaptureStatus,
        smartCaptureRuleId,
        smartCaptureRuleName,
        lifecyclePreset,
        sessionWindowSize,
        conversionPreset,
        screenName,
        screenOutcome,
        screenPath,
        geoCountry,
        geoCity,
        metaKey,
        metaValue,
        metaFilters,
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
        conditionLogic,
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
    if (smartCaptureStatus) queryParams.set('smartCaptureStatus', smartCaptureStatus);
    if (smartCaptureRuleId) queryParams.set('smartCaptureRuleId', smartCaptureRuleId);
    if (smartCaptureRuleName) queryParams.set('smartCaptureRuleName', smartCaptureRuleName);
    if (lifecyclePreset) queryParams.set('lifecyclePreset', lifecyclePreset);
    if (sessionWindowSize) queryParams.set('sessionWindowSize', String(sessionWindowSize));
    if (conversionPreset) queryParams.set('conversionPreset', conversionPreset);
    if (screenName) queryParams.set('screenName', screenName);
    if (screenName && screenOutcome) queryParams.set('screenOutcome', screenOutcome);
    if (screenPath) queryParams.set('screenPath', screenPath);
    if (geoCountry) queryParams.set('geoCountry', geoCountry);
    if (geoCity) queryParams.set('geoCity', geoCity);
    if (metaKey) queryParams.set('metaKey', metaKey);
    if (metaValue) queryParams.set('metaValue', metaValue);
    if (metaFilters?.length) queryParams.set('metaFilters', JSON.stringify(metaFilters));
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
    if (conditionLogic === 'OR') queryParams.set('conditionLogic', 'OR');

    return queryParams.toString();
}

/**
 * Total matching rows for the same filters as the archive list (cheap to call after list without includeTotal).
 */
export async function getSessionsArchiveTotalCount(params: Omit<SessionArchiveQuery, 'cursor' | 'limit' | 'includeTotal'>): Promise<number> {
    if (isDemoMode()) {
        return demoSessions.filter((session) => {
            if (params.projectId && session.projectId !== params.projectId) return false;
            if (!matchesPlatformFilter(session.platform, params.platform)) return false;
            if (params.geoCountry && session.geoLocation?.country !== params.geoCountry) return false;
            if (params.geoCity && session.geoLocation?.city !== params.geoCity) return false;
            return true;
        }).length;
    }

    const queryParams = buildSessionArchiveQueryString({ ...params, countOnly: true, limit: 1 });
    const endpoint = `/api/sessions?${queryParams}`;
    const response = await fetchWithCache<{ totalCount: number }>(endpoint, {}, `sessions:archive:count:${queryParams}`, ARCHIVE_CACHE_TTL);
    return response?.totalCount ?? 0;
}

/**
 * Get sessions with cursor-based pagination for infinite scroll
 * Supports 500k+ sessions efficiently
 */
export async function getSessionsPaginated(
    params: SessionArchiveQuery,
): Promise<{ sessions: any[]; nextCursor: string | null; hasMore: boolean; totalCount: number | null }> {
    // Demo mode: return the broad demo session pool for dashboards.
    if (isDemoMode()) {
        const includeTotal = params.includeTotal !== false;
        const filteredSessions = demoSessions.filter((session) => {
            if (params.projectId && session.projectId !== params.projectId) return false;
            if (!matchesPlatformFilter(session.platform, params.platform)) return false;
            if (params.geoCountry && session.geoLocation?.country !== params.geoCountry) return false;
            if (params.geoCity && session.geoLocation?.city !== params.geoCity) return false;
            return true;
        });
        const limit = params.limit && params.limit > 0 ? params.limit : filteredSessions.length;
        return {
            sessions: filteredSessions.slice(0, limit),
            nextCursor: null,
            hasMore: false,
            totalCount: includeTotal ? filteredSessions.length : null,
        };
    }

    const queryParams = buildSessionArchiveQueryString(params);
    const endpoint = `/api/sessions?${queryParams}`;
    const response = params.cursor
        ? await fetchJson<{
              sessions: ApiSessionSummary[];
              nextCursor: string | null;
              hasMore: boolean;
              totalCount: number | null;
          }>(endpoint)
        : await fetchWithCache<{
              sessions: ApiSessionSummary[];
              nextCursor: string | null;
              hasMore: boolean;
              totalCount: number | null;
          }>(endpoint, {}, `sessions:archive:list:${queryParams}`, ARCHIVE_CACHE_TTL);

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
        listeners = listeners.filter((l) => l !== callback);
    };
}

/**
 * Refresh sessions and notify listeners
 */
export async function refreshSessions(): Promise<void> {
    clearCache('/api/sessions');
    const sessions = await getSessions();
    listeners.forEach((callback) => callback(sessions));
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
    webDomain?: string | null;
    webAllowedDomains?: string[];
    platforms: string[];
    publicKey: string;
    rejourneyEnabled?: boolean;
    recordingEnabled: boolean;
    textInputMasking?: 'all' | 'secure_only';
    imageVideoMasking?: 'none' | 'all';
    recordingFps?: number;
    sampleRate: number;
    maxRecordingMinutes?: number;
    webMaxObservabilityMinutes?: number;
    smartCaptureEnabled?: boolean;
    smartCaptureMode?: SmartCaptureMode;
    smartCapturePreset?: SmartCapturePreset;
    smartCaptureRules?: Array<Record<string, unknown>>;
    smartCaptureDecisionWindowHours?: number;
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
    webAllowedDomains?: string[];
    platforms?: string[];
    rejourneyEnabled?: boolean;
    recordingEnabled?: boolean;
    textInputMasking?: 'all' | 'secure_only';
    imageVideoMasking?: 'none' | 'all';
    recordingFps?: number;
    sampleRate?: number;
    maxRecordingMinutes?: number;
    webMaxObservabilityMinutes?: number;
}

function demoProjectToApiProject(project: Project): ApiProject {
    return {
        ...project,
        platforms: project.platforms,
        recordingEnabled: project.recordingEnabled,
        sampleRate: project.sampleRate ?? 100,
    };
}

/**
 * Get all projects
 */
export async function getProjects(): Promise<ApiProject[]> {
    if (isDemoMode()) {
        return demoProjects.map(demoProjectToApiProject);
    }

    const data = await fetchWithCache<{ projects: ApiProject[] | ApiProject | undefined }>('/api/projects', {}, 'projects:list', PROJECTS_CACHE_TTL);
    const projects = data.projects;
    if (!projects) return [];
    return Array.isArray(projects) ? projects : [projects];
}

/**
 * Get available custom events and metadata for a project
 */
export async function getAvailableFilters(
    projectId: string,
): Promise<{ events: string[]; eventPropertyKeys: string[]; screens: string[]; metadata: Record<string, string[]> }> {
    return fetchWithCache<{ events: string[]; eventPropertyKeys: string[]; screens: string[]; metadata: Record<string, string[]> }>(
        `/api/projects/${projectId}/available-filters`,
        {},
        `projects:available-filters:${projectId}`,
        300000,
    );
}

export async function buildSessionQueryFromPrompt(projectId: string, prompt: string): Promise<{ groups: any[]; explanation: string }> {
    return fetchJson<{ groups: any[]; explanation: string }>(`/api/projects/${projectId}/query-builder`, {
        method: 'POST',
        body: JSON.stringify({ prompt }),
    });
}

export type SmartCaptureMode = 'record_all' | 'smart_capture' | 'analytics_only';
export type SmartCapturePreset = 'none' | 'high_friction' | 'onboarding_risk' | 'churn_risk' | 'checkout_risk' | 'minimum_signal';
export type SmartCaptureStatus = 'scale_only' | 'off' | 'active' | 'pending_rules';

export interface SmartCaptureRule {
    id: string;
    type: string;
    name?: string;
    label: string;
    color?: string;
    enabled?: boolean;
    immediate?: boolean;
    signal?: string;
    condition?: Record<string, unknown>;
    operator?: string;
    value?: string | number | boolean;
    windowHours?: number;
    captureRate?: number;
}

export interface SmartCaptureConfig {
    enabled: boolean;
    configuredEnabled?: boolean;
    mode: SmartCaptureMode;
    preset: SmartCapturePreset;
    rules: SmartCaptureRule[];
    effectiveRules?: SmartCaptureRule[];
    decisionWindowHours: number;
    status: SmartCaptureStatus;
    entitlement: {
        smartCaptureEnabled: boolean;
        requiredPlan: 'scale';
    };
}

export interface SmartCaptureConfigUpdate {
    enabled: boolean;
    mode: SmartCaptureMode;
    preset: SmartCapturePreset;
    rules: SmartCaptureRule[];
    decisionWindowHours: number;
}

function lockedSmartCaptureConfig(overrides: Partial<SmartCaptureConfig> = {}): SmartCaptureConfig {
    return {
        enabled: false,
        configuredEnabled: false,
        mode: 'record_all',
        preset: 'none',
        rules: [],
        effectiveRules: [],
        decisionWindowHours: 168,
        status: 'scale_only',
        entitlement: {
            smartCaptureEnabled: false,
            requiredPlan: 'scale',
        },
        ...overrides,
    };
}

function isMissingSmartCaptureRoute(error: unknown): boolean {
    const status = typeof (error as { status?: unknown } | null)?.status === 'number'
        ? (error as { status: number }).status
        : null;
    const message = error instanceof Error ? error.message : String(error);
    return status === 404 && /smart-capture/i.test(message) && /not found/i.test(message);
}

export async function getProjectSmartCaptureConfig(projectId: string): Promise<SmartCaptureConfig> {
    if (isDemoMode()) {
        return {
            configuredEnabled: true,
            enabled: true,
            mode: 'smart_capture',
            preset: 'none',
            decisionWindowHours: 168,
            rules: [
                {
                    id: 'demo-rule-1',
                    type: 'issue',
                    name: 'High friction',
                    signal: 'high_friction',
                    color: 'amber',
                    operator: 'eq',
                    label: 'High friction is detected',
                    immediate: true,
                    condition: { signal: 'high_friction' }
                }
            ],
            effectiveRules: [],
            status: 'active',
            entitlement: {
                smartCaptureEnabled: true,
                requiredPlan: 'scale',
            },
        } as unknown as SmartCaptureConfig;
    }
    try {
        return await fetchJson<SmartCaptureConfig>(`/api/projects/${projectId}/smart-capture`);
    } catch (error) {
        if (isMissingSmartCaptureRoute(error)) {
            return lockedSmartCaptureConfig();
        }
        throw error;
    }
}

export async function updateProjectSmartCaptureConfig(projectId: string, config: SmartCaptureConfigUpdate): Promise<SmartCaptureConfig> {
    if (isDemoMode()) {
        return {
            ...config,
            configuredEnabled: config.enabled,
            enabled: config.enabled,
            effectiveRules: config.rules,
            status: config.enabled ? 'active' : 'off',
            entitlement: {
                smartCaptureEnabled: true,
                requiredPlan: 'scale',
            },
        } as any;
    }
    const response = await fetchJson<SmartCaptureConfig>(`/api/projects/${projectId}/smart-capture`, {
        method: 'PUT',
        body: JSON.stringify(config),
    });
    clearCache('projects:list');
    return response;
}

export async function sendProjectSetupEmail(
    projectId: string,
    payload: { email: string; aiPrompt: string },
): Promise<{ success: boolean; message?: string }> {
    return fetchJson<{ success: boolean; message?: string }>(`/api/projects/${projectId}/setup-email`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
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
    if (isDemoMode()) {
        const project = demoProjects.find((demoProject) => demoProject.id === projectId) || demoProjects[0];
        if (!project) {
            throw new Error('Demo project not found');
        }
        return demoProjectToApiProject(project);
    }

    return fetchJson<ApiProject>(`/api/projects/${projectId}`);
}

/**
 * Update a project
 */
export async function updateProject(
    projectId: string,
    data: {
        name?: string;
        maxRecordingMinutes?: number;
        webMaxObservabilityMinutes?: number;
        sampleRate?: number;
        recordingFps?: number;
        recordingEnabled?: boolean;
        rejourneyEnabled?: boolean;
        textInputMasking?: 'all' | 'secure_only';
        imageVideoMasking?: 'none' | 'all';
        bundleId?: string;
        packageName?: string;
        webDomain?: string | null;
        webAllowedDomains?: string[] | null;
    },
): Promise<ApiProject> {
    if (isDemoMode()) {
        const project = demoProjects.find((demoProject) => demoProject.id === projectId) || demoProjects[0];
        if (!project) {
            throw new Error('Demo project not found');
        }
        return {
            ...demoProjectToApiProject(project),
            ...data,
            webDomain: data.webDomain === undefined ? project.webDomain : data.webDomain,
            webAllowedDomains: data.webAllowedDomains ?? project.webAllowedDomains,
        };
    }

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
    payload: { confirmText: string },
): Promise<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }> {
    return fetchJson<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }>(`/api/projects/${projectId}/delete-otp`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string, payload: { confirmText: string; otpCode: string }): Promise<void> {
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
    sessionLimit?: number | null; // Backward-compatible alias for monthly session replay limit.
    storageCap?: number | null;
    requestCap?: number | null;
    effectiveAt?: string;
}

export interface TeamUsage {
    rejourneyEnabled?: boolean; // Added to enable Rejourney feature
    /** Backward-compatible alias for sessionReplaysUsed. */
    sessionsUsed: number;
    sessionsCaptured?: number;
    sessionReplaysUsed?: number;
    /** Backward-compatible alias for sessionReplayLimit. */
    sessionLimit: number;
    sessionReplayLimit?: number;
    /** Plan cap without promotional bonus */
    planSessionLimit?: number;
    sessionReplayPlanLimit?: number;
    /** Extra sessions this billing period only (not carried to the next cycle) */
    bonusSessionsActive?: number;
    sessionsRemaining: number;
    sessionReplaysRemaining?: number;
    percentUsed: number;
    sessionReplayPercentUsed?: number;
    isAtLimit: boolean;
    isReplayAtLimit?: boolean;
    isNearLimit: boolean;
    isReplayNearLimit?: boolean;
}

export interface BillingPlan {
    priceId?: string;
    productId?: string;
    name: string;
    displayName: string;
    sessionLimit: number;
    sessionReplayLimit?: number;
    videoRetentionTier: number;
    videoRetentionDays: number;
    videoRetentionLabel: string;
    priceCents: number;
    interval?: 'month' | 'year';
    isCustom?: boolean;
    smartCaptureEnabled?: boolean;
}

export interface TeamPlanInfo {
    priceId?: string | null;
    productId?: string | null;
    planName: string;
    displayName: string;
    sessionLimit: number;
    sessionReplayLimit?: number;
    videoRetentionTier: number;
    videoRetentionDays: number;
    videoRetentionLabel: string;
    priceCents: number;
    interval?: 'month' | 'year';
    isCustom: boolean;
    smartCaptureEnabled?: boolean;
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
        sessionsCaptured?: number;
        sessionReplaysUsed?: number;
        sessionLimit: number;
        sessionReplayLimit?: number;
        planSessionLimit?: number;
        sessionReplayPlanLimit?: number;
        bonusSessionsActive?: number;
        sessionsRemaining: number;
        sessionReplaysRemaining?: number;
        percentUsed: number;
        sessionReplayPercentUsed?: number;
        isAtLimit: boolean;
        isReplayAtLimit?: boolean;
        isNearLimit: boolean;
        isReplayNearLimit?: boolean;
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

/**
 * Get team's current billing plan
 */
export async function getTeamPlan(teamId: string): Promise<TeamPlanInfo | null> {
    if (isDemoMode()) {
        return {
            planName: 'pro',
            displayName: 'Pro',
            sessionLimit: demoApiData.demoTeamUsage.sessionLimit,
            videoRetentionTier: 3,
            videoRetentionDays: 90,
            videoRetentionLabel: '90 days',
            priceCents: 9900,
            isCustom: false,
            smartCaptureEnabled: false,
            subscriptionId: null,
            subscriptionStatus: null,
            cancelAtPeriodEnd: false,
            scheduledPriceId: null,
            scheduledPlanName: null,
        };
    }

    if (!isUuid(teamId)) {
        return null;
    }

    try {
        const res = await fetchWithCache<{ plan: TeamPlanInfo }>(`/api/teams/${teamId}/billing/plan`);
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
        priceId?: string;
        productId?: string;
        name: string;
        displayName: string;
        sessionLimit: number;
        videoRetentionTier: number;
        videoRetentionDays: number;
        videoRetentionLabel: string;
        priceCents: number;
        interval?: 'month' | 'year';
        isCustom?: boolean;
    }; // Always present (free plan if no subscription)
    newPlan: {
        priceId?: string;
        productId?: string;
        name: string;
        displayName: string;
        sessionLimit: number;
        videoRetentionTier: number;
        videoRetentionDays: number;
        videoRetentionLabel: string;
        priceCents: number;
        interval?: 'month' | 'year';
        isCustom?: boolean;
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
    subscriptionId?: string | null;
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
export async function previewPlanChange(teamId: string, planName: string): Promise<PlanChangePreview> {
    const res = await fetchJson<PlanChangePreview>(`/api/teams/${teamId}/billing/plan/preview`, {
        method: 'POST',
        body: JSON.stringify({ planName }),
    });
    return res;
}

/**
 * Confirm and execute a plan change
 * @param planName - Plan name: 'free', 'starter', 'growth', 'pro'
 * @param confirmed - Must be true to execute the change
 */
export async function confirmPlanChange(teamId: string, planName: string): Promise<PlanChangeResult> {
    clearCache(`/api/teams/${teamId}/billing/plan`);
    clearCache(`/api/teams/${teamId}/billing/usage`);
    clearCache(`/api/teams/${teamId}/billing/dashboard`);

    const res = await fetchJson<PlanChangeResult>(`/api/teams/${teamId}/billing/plan`, {
        method: 'PUT',
        body: JSON.stringify({ planName, confirmed: true }),
    });
    return res;
}

export async function createCheckoutSession(teamId: string, planName: string, successUrl: string, cancelUrl: string): Promise<CheckoutSessionResponse> {
    return fetchJson<CheckoutSessionResponse>(`/api/teams/${teamId}/billing/checkout`, {
        method: 'POST',
        body: JSON.stringify({ planName, successUrl, cancelUrl }),
    });
}

export async function completeCheckoutSession(teamId: string, sessionId: string): Promise<CheckoutCompletionResponse> {
    return fetchJson<CheckoutCompletionResponse>(`/api/teams/${teamId}/billing/checkout/complete`, {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
    });
}

/**
 * Update team's billing plan (deprecated - use previewPlanChange + confirmPlanChange)
 * @param planName - Plan name: 'free', 'starter', 'growth', 'pro'
 */
export async function updateTeamPlan(teamId: string, planName: string): Promise<TeamPlanInfo | null> {
    clearCache(`/api/teams/${teamId}/billing/plan`);
    clearCache(`/api/teams/${teamId}/billing/usage`);
    clearCache(`/api/teams/${teamId}/billing/dashboard`);

    try {
        const res = await fetchJson<{ plan: TeamPlanInfo } | PlanChangeResult>(`/api/teams/${teamId}/billing/plan`, {
            method: 'PUT',
            body: JSON.stringify({ planName, confirmed: true }),
        });
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
    const res = await fetchWithCache<TeamBillingDashboard>(`/api/teams/${teamId}/billing/dashboard`);
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
    freeTierSessionReplays?: number;
    sessionsUsed: number;
    sessionReplaysUsed?: number;
    sessionsRemaining: number;
    sessionReplaysRemaining?: number;
    percentUsed: number;
    sessionReplayPercentUsed?: number;
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
    return fetchJson<{ success: boolean; customerId: string }>(`/api/teams/${teamId}/billing/stripe/setup`, { method: 'POST' });
}

/**
 * Get payment methods for a team
 */
export async function getPaymentMethods(teamId: string): Promise<{
    paymentMethods: PaymentMethod[];
    defaultPaymentMethodId: string | null;
}> {
    return fetchWithCache<{ paymentMethods: PaymentMethod[]; defaultPaymentMethodId: string | null }>(`/api/teams/${teamId}/billing/stripe/payment-methods`);
}

/**
 * Add a payment method to a team
 */
export async function addPaymentMethod(teamId: string, paymentMethodId: string): Promise<{ success: boolean }> {
    clearCache(`/api/teams/${teamId}/billing/stripe/payment-methods`);
    clearCache(`/api/teams/${teamId}/billing/stripe/status`);
    return fetchJson<{ success: boolean }>(`/api/teams/${teamId}/billing/stripe/payment-methods`, {
        method: 'POST',
        body: JSON.stringify({ paymentMethodId }),
    });
}

/**
 * Remove a payment method from a team
 */
export async function removePaymentMethod(teamId: string, paymentMethodId: string): Promise<{ success: boolean }> {
    clearCache(`/api/teams/${teamId}/billing/stripe/payment-methods`);
    clearCache(`/api/teams/${teamId}/billing/stripe/status`);
    return fetchJson<{ success: boolean }>(`/api/teams/${teamId}/billing/stripe/payment-methods/${paymentMethodId}`, { method: 'DELETE' });
}

/**
 * Create a Stripe SetupIntent for adding a payment method in-app
 */
export async function createSetupIntent(teamId: string): Promise<{ clientSecret: string }> {
    return fetchJson<{ clientSecret: string }>(`/api/teams/${teamId}/billing/stripe/setup-intent`, { method: 'POST' });
}

/**
 * Create a Stripe Billing Portal session
 */
export async function createBillingPortalSession(teamId: string, returnUrl?: string): Promise<{ url: string }> {
    return fetchJson<{ url: string }>(`/api/teams/${teamId}/billing/stripe/portal`, {
        method: 'POST',
        body: JSON.stringify({ returnUrl }),
    });
}

export async function createBillingPortalPlanChangeSession(
    teamId: string,
    planName: string,
    returnUrl: string,
): Promise<{ url: string }> {
    return fetchJson<{ url: string }>(`/api/teams/${teamId}/billing/stripe/portal/plan-change`, {
        method: 'POST',
        body: JSON.stringify({ planName, returnUrl }),
    });
}

// =============================================================================
// Project Revenue API
// =============================================================================

export type RevenueProvider = 'custom_events' | 'superwall' | 'revenuecat';
export type RevenueConnectionStatus = 'not_connected' | 'connected' | 'syncing' | 'error' | 'disconnected';

export interface RevenueProviderStatus {
    provider: RevenueProvider;
    label: string;
    configured: boolean;
    status: RevenueConnectionStatus;
    accountId: string | null;
    accountName: string | null;
    connectedAt: string | null;
    lastSyncStartedAt: string | null;
    lastSyncCompletedAt: string | null;
    lastSyncError: string | null;
}

export interface CustomRevenueEventConfig {
    revenueEventName: string;
    revenueAmountProperty: string;
    revenueCurrencyProperty: string;
    defaultCurrency: string;
    amountUnit: 'major' | 'minor';
    refundEventName?: string | null;
    /**
     * NOTE: Maps to 'cart_add' funnel transition in researchLake.ts.
     * By default, the Research Lake includes 'product_added_to_cart' and 'added_to_cart'
     * as regex fallback equivalencies for this funnel transition.
     */
    subscriberEventName?: string | null;
    trialStartedEventName?: string | null;
    subscriptionStartedEventName?: string | null;
    cancellationEventName?: string | null;
    conversionEventName?: string | null;
}

export interface RevenueDailyRow {
    date: string;
    currency: string;
    grossAmountCents: number;
    refundAmountCents: number;
    feeAmountCents: number;
    netAmountCents: number;
    transactionCount: number;
    refundCount: number;
    subscriberCount: number;
    trialCount: number;
    subscriptionStartCount: number;
    cancellationCount: number;
    conversionCount: number;
    customEventCounts: Record<string, number>;
}

export interface RevenueCurrencySummary {
    currency: string;
    grossAmountCents: number;
}

export interface RevenueManualEntry {
    id: string;
    date: string;
    currency: string;
    amountCents: number;
    transactionCount: number;
    note: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface RevenueSyncPreview {
    provider: RevenueProvider;
    scannedSessionCount: number;
    matchedSessionCount: number;
    matchedEventCount: number;
    revenueEventCount: number;
}

export interface RevenueOverview {
    configured: boolean;
    activeProvider: RevenueProvider | null;
    providers: RevenueProviderStatus[];
    connection: RevenueProviderStatus & {
        canManage: boolean;
    };
    customEventConfig: CustomRevenueEventConfig | null;
    syncPreview: RevenueSyncPreview | null;
    manualEntries: RevenueManualEntry[];
    currencies: RevenueCurrencySummary[];
    selectedCurrency: string | null;
    summary: {
        grossAmountCents: number;
        refundAmountCents: number;
        feeAmountCents: number;
        netAmountCents: number;
        transactionCount: number;
        refundCount: number;
        subscriberCount: number;
        trialCount: number;
        subscriptionStartCount: number;
        cancellationCount: number;
        conversionCount: number;
        previousGrossAmountCents: number | null;
        grossChangePercent: number | null;
    };
    daily: RevenueDailyRow[];
}

function buildDisconnectedRevenueProvider(provider: RevenueProvider, label: string): RevenueProviderStatus {
    return {
        provider,
        label,
        configured: true,
        status: 'not_connected',
        accountId: null,
        accountName: null,
        connectedAt: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncError: null,
    };
}

export async function getRevenueOverview(projectId: string, timeRange?: string, currency?: string | null): Promise<RevenueOverview> {
    const params = new URLSearchParams();
    if (timeRange) params.set('timeRange', timeRange);
    if (currency) params.set('currency', currency);
    const qs = params.toString();
    return fetchJson<RevenueOverview>(`/api/projects/${projectId}/revenue${qs ? `?${qs}` : ''}`);
}

export async function setRevenueSource(projectId: string, provider: RevenueProvider): Promise<{ success: boolean; provider: RevenueProvider }> {
    return fetchJson<{ success: boolean; provider: RevenueProvider }>(`/api/projects/${projectId}/revenue/source`, {
        method: 'PUT',
        body: JSON.stringify({ provider }),
    });
}

export async function syncRevenueSource(projectId: string, provider: RevenueProvider): Promise<{ success: boolean; enqueued: boolean; status: string }> {
    return fetchJson<{ success: boolean; enqueued: boolean; status: string }>(`/api/projects/${projectId}/revenue/sync`, {
        method: 'POST',
        body: JSON.stringify({ provider }),
    });
}

export async function disconnectRevenueSource(projectId: string, provider: RevenueProvider): Promise<void> {
    await fetchJson<void>(`/api/projects/${projectId}/revenue/providers/${provider}`, {
        method: 'DELETE',
    });
}

export interface AccountSettingsUpdate {
    timezone?: string | null;
}

export async function updateAccountSettings(input: AccountSettingsUpdate): Promise<{ success: boolean; user: { id: string; timezone: string | null } }> {
    return fetchJson<{ success: boolean; user: { id: string; timezone: string | null } }>('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(input),
    });
}

export async function connectSuperwallRevenue(
    projectId: string,
    input: { apiKey: string },
): Promise<{ success: boolean; connectionId: string }> {
    return fetchJson<{ success: boolean; connectionId: string }>(`/api/projects/${projectId}/revenue/superwall/connect`, {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function connectRevenueCatRevenue(
    projectId: string,
    input: { apiKey: string; revenueCatProjectId: string },
): Promise<{ success: boolean; connectionId: string }> {
    return fetchJson<{ success: boolean; connectionId: string }>(`/api/projects/${projectId}/revenue/revenuecat/connect`, {
        method: 'POST',
        body: JSON.stringify({ apiKey: input.apiKey, projectId: input.revenueCatProjectId }),
    });
}

export async function configureCustomEventRevenue(projectId: string, input: CustomRevenueEventConfig): Promise<{ success: boolean; connectionId: string }> {
    return fetchJson<{ success: boolean; connectionId: string }>(`/api/projects/${projectId}/revenue/custom-events`, {
        method: 'PUT',
        body: JSON.stringify(input),
    });
}

export async function createManualRevenueEntry(
    projectId: string,
    input: { date: string; amountCents: number; currency: string; transactionCount?: number; note?: string | null },
): Promise<{ success: boolean; entry: RevenueManualEntry }> {
    return fetchJson<{ success: boolean; entry: RevenueManualEntry }>(`/api/projects/${projectId}/revenue/manual`, {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function updateManualRevenueEntry(
    projectId: string,
    entryId: string,
    input: { date: string; amountCents: number; currency: string; transactionCount?: number; note?: string | null },
): Promise<{ success: boolean; entry: RevenueManualEntry }> {
    return fetchJson<{ success: boolean; entry: RevenueManualEntry }>(`/api/projects/${projectId}/revenue/manual/${entryId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    });
}

export async function deleteManualRevenueEntry(projectId: string, entryId: string): Promise<void> {
    await fetchJson<void>(`/api/projects/${projectId}/revenue/manual/${entryId}`, { method: 'DELETE' });
}

/**
 * Get free tier status for current user
 */
export async function getFreeTierStatus(): Promise<FreeTierStatus> {
    return fetchWithCache<FreeTierStatus>('/api/billing/free-tier');
}

/**
 * Team replay quota usage response. Captured analytics sessions are also included.
 */
export interface TeamSessionUsage {
    /** Backward-compatible alias for sessionReplaysUsed. */
    sessionsUsed: number;
    sessionsCaptured?: number;
    sessionReplaysUsed?: number;
    /** Backward-compatible alias for sessionReplayLimit. */
    sessionLimit: number;
    sessionReplayLimit?: number;
    planSessionLimit?: number;
    sessionReplayPlanLimit?: number;
    bonusSessionsActive?: number;
    sessionsRemaining: number;
    sessionReplaysRemaining?: number;
    percentUsed: number;
    sessionReplayPercentUsed?: number;
    isAtLimit: boolean;
    isReplayAtLimit?: boolean;
    isNearLimit: boolean;
    isReplayNearLimit?: boolean;
    planName: string;
    period: string;
}

/**
 * Get team's replay quota and captured-session usage
 */
export async function getTeamSessionUsage(teamId: string): Promise<TeamSessionUsage | null> {
    try {
        const res = await fetchWithCache<{ usage: TeamSessionUsage }>(`/api/teams/${teamId}/billing/usage`);
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
    sessionReplayLimit?: number | null;
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
    },
): Promise<{ success: boolean }> {
    clearCache(`/api/teams/${teamId}/billing/alert-settings`);
    return fetchJson<{ success: boolean }>(`/api/teams/${teamId}/billing/alert-settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
    });
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
    alertType: 'session_threshold' | 'session_limit',
): Promise<{ success: boolean }> {
    clearCache(`/api/teams/${teamId}/billing/alert-recipients`);
    return fetchJson<{ success: boolean }>(`/api/teams/${teamId}/billing/alert-recipients`, {
        method: 'POST',
        body: JSON.stringify({ userId, alertType }),
    });
}

/**
 * Remove a billing alert recipient
 */
export async function removeBillingAlertRecipient(
    teamId: string,
    userId: string,
    alertType: 'session_threshold' | 'session_limit',
): Promise<{ success: boolean }> {
    clearCache(`/api/teams/${teamId}/billing/alert-recipients`);
    return fetchJson<{ success: boolean }>(`/api/teams/${teamId}/billing/alert-recipients/${userId}/${alertType}`, { method: 'DELETE' });
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
        await handleUnauthorized('/api/auth/export-data');
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
    sessionId: string | null;
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
    canOpenReplay?: boolean;
    logs?: string[];
}

export interface ANRDetailRecord {
    id: string;
    sessionId: string | null;
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
    canOpenReplay?: boolean;
}

export interface CrashMetadata {
    id: string;
    sessionId: string | null;
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
    sessionId: string | null;
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
    canOpenReplay?: boolean;
}

/**
 * Get crashes for a project (paginated)
 */
export async function getCrashes(projectId: string, page: number = 1, limit: number = 20): Promise<{ crashes: CrashMetadata[]; totalPages: number }> {
    if (isDemoMode()) {
        const crashes = (demoApiData.demoCrashReports as CrashReport[]).map((crash) => ({
            id: crash.id,
            sessionId: crash.sessionId,
            projectId: crash.projectId,
            timestamp: crash.timestamp,
            exceptionName: crash.exceptionName,
            reason: crash.reason,
            deviceMetadata: crash.deviceMetadata,
            status: crash.status,
            occurrenceCount: crash.occurrenceCount || 1,
        }));
        return { crashes, totalPages: Math.max(1, Math.ceil(crashes.length / limit)) };
    }
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    return fetchJson<{ crashes: CrashMetadata[]; totalPages: number }>(`/api/projects/${projectId}/crashes?${params.toString()}`);
}

/**
 * Get details for a single crash
 */
export async function getCrash(projectId: string, crashId: string): Promise<CrashReport> {
    if (isDemoMode()) {
        const crash = (demoApiData.demoCrashReports as CrashReport[]).find((crash) => crash.id === crashId) || (demoApiData.demoCrashReports[0] as CrashReport);
        return {
            ...crash,
            canOpenReplay: crash.canOpenReplay ?? Boolean(crash.sessionId),
        };
    }
    return fetchJson<CrashReport>(`/api/projects/${projectId}/crashes/${crashId}`);
}

/**
 * Get ANRs for a project
 */
export async function getANRs(
    projectId: string,
    options?: { limit?: number; offset?: number; timeRange?: string; platform?: string },
): Promise<{ anrs: ANRRecord[]; totalGroups?: number; totalEvents?: number }> {
    if (isDemoMode()) {
        return demoApiData.demoANRsResponse;
    }
    const params = new URLSearchParams();
    params.set('limit', String(options?.limit ?? 100));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.timeRange) params.set('timeRange', options.timeRange);
    if (options?.platform && options.platform !== 'all') params.set('platform', options.platform);
    return fetchJson<{ anrs: ANRRecord[]; totalGroups?: number; totalEvents?: number }>(`/api/projects/${projectId}/anrs?${params.toString()}`);
}

/**
 * Get details for a single ANR
 */
export async function getANR(projectId: string, anrId: string): Promise<ANRDetailRecord> {
    if (isDemoMode()) {
        const anr = demoApiData.demoANRsResponse.anrs.find((a: any) => a.id === anrId) || demoApiData.demoANRsResponse.anrs[0];
        return {
            ...anr,
            canOpenReplay: anr.canOpenReplay ?? Boolean(anr.sessionId),
        };
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
        countryDauBreakdown?: Record<string, number>;
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

export interface DashboardOverviewResponse {
    trends: InsightsTrends;
    overviewObs: GrowthObservability | null;
    deepMetrics: ObservabilityDeepMetrics | null;
    engagementTrends: UserEngagementTrends | null;
    geoSummary: GeoSummary | null;
    retention: RetentionCohortsResponse;
    issues: Issue[];
    failedSections: string[];
}

export interface TopUserEntry {
    sessionCount: number;
    totalDurationSeconds: number;
    userFirstSeenAt?: string;
    latestSession: RecordingSession;
}

export interface DashboardHeavyResponse {
    sessions: RecordingSession[];
    topUsers: TopUserEntry[];
    failedSections: string[];
}

export type DashboardHeavySection = 'sessions' | 'topUsers';

export interface ApiOverviewResponse {
    endpointStats: ApiEndpointStats | null;
    regionStats: RegionPerformance | null;
    deepMetrics: ObservabilityDeepMetrics | null;
    latencyByLocation: ApiLatencyByLocationResponse | null;
    trends: InsightsTrends;
    failedSections: string[];
}

export interface DevicesOverviewResponse {
    summary: DeviceSummary | null;
    deepMetrics: ObservabilityDeepMetrics | null;
    matrix: DeviceIssueMatrix | null;
    trends: InsightsTrends;
    failedSections: string[];
}

export interface GeoOverviewResponse {
    issues: GeoIssuesSummary;
    latencyByLocation: ApiLatencyByLocationResponse;
    failedSections: string[];
}

export interface JourneysOverviewResponse {
    journey: ObservabilityJourneySummary | null;
    userEngagement: UserEngagementTrends | null;
    trends: InsightsTrends;
    failedSections: string[];
}

export type HeatmapMode = 'attention' | 'touch';

export interface HeatmapHotspot {
    x: number;
    y: number;
    intensity: number;
    isRageTap: boolean;
    kind?: 'attention' | 'touch' | 'rage';
    // Total engaged dwell (ms) across all sampled sessions for this bucket (attention maps only).
    dwellMs?: number;
    confidence?: number;
}

export interface HeatmapOverviewScreen {
    name: string;
    platform?: string | null;
    visits: number;
    rageTaps: number;
    errors: number;
    exitRate: number;
    frictionScore: number;
    screenshotUrl: string | null;
    sessionIds?: string[];
    screenFirstSeenMs?: number | null;
    touchHotspots?: HeatmapHotspot[];
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
    rangeVisits: number;
    rangeRageTaps: number;
    rangeErrors: number;
    rangeExitRate: number;
    rangeFrictionScore: number;
    rangeImpactScore: number;
    rangeRageTapRatePer100: number;
    rangeErrorRatePer100: number;
    rangeIncidentRatePer100: number;
    rangeEstimatedAffectedSessions: number;
    primarySignal: 'rage_taps' | 'errors' | 'exits' | 'mixed';
    confidence: 'high' | 'medium' | 'low';
    priority: 'critical' | 'high' | 'watch';
    evidenceSessionId: string | null;
}

export interface HeatmapIterationScreen {
    name: string;
    screenshotUrl: string | null;
    screenFirstSeenMs?: number | null;
    touchHotspots?: HeatmapHotspot[];
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
    visits: number;
    touches: number;
    rageTaps: number;
    errors: number;
    incidentRatePer100: number;
    lastSeenAt: string | null;
    evidenceSessionId: string | null;
}

export interface HeatmapIterationVersion {
    appVersion: string;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    sessions: number;
    screens: HeatmapIterationScreen[];
}

export interface HeatmapIterationSummary {
    overall: HeatmapIterationScreen[];
    versions: HeatmapIterationVersion[];
}

export interface HeatmapOverviewResponse {
    screens: HeatmapOverviewScreen[];
    screenIteration?: HeatmapIterationSummary;
    lastUpdated: string;
    failedSections: string[];
}

export interface HeatmapScreenOverviewResponse {
    screen: HeatmapOverviewScreen | null;
    failedSections: string[];
}

export interface WebAttentionHeatmapResponse {
    hotspots: HeatmapHotspot[];
    sampledSessions: number;
    avgSessionDurationMs: number | null;
    // Engaged dwell ms (summed across sampled sessions) per equal-height depth slice top→bottom.
    dwellByDepth?: number[];
    eventCount: number;
    generatedAt: string;
    confidence: 'high' | 'medium' | 'low';
    pageWidth: number | null;
    pageHeight: number | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
    reason: string | null;
    confidenceScore?: number;
    modelVersion?: string;
    signalsUsed?: string[];
}

export interface ErrorOverviewGroup {
    fingerprint: string;
    errorName: string;
    message: string;
    count: number;
    users: string[];
    firstSeen: string;
    lastOccurred: string;
    affectedDevices: Record<string, number>;
    affectedVersions: Record<string, number>;
    screens: string[];
    sampleError: {
        id: string;
        sessionId: string | null;
        timestamp: string;
        deviceModel: string | null;
        appVersion: string | null;
        stack: string | null;
        screenName: string | null;
        canOpenReplay?: boolean;
        logs?: string[];
    } | null;
}

export interface ErrorsOverviewResponse {
    groups: ErrorOverviewGroup[];
    summary: {
        issues: number;
        events: number;
        users: number;
    };
    truncated: boolean;
}

export interface CrashOverviewGroup {
    id: string;
    name: string;
    sampleCrashId: string;
    sampleSessionId: string;
    canOpenReplay?: boolean;
    count: number;
    users: string[];
    firstSeen: string;
    lastOccurred: string;
    affectedDevices: Record<string, number>;
    affectedVersions: Record<string, number>;
    logs?: string[];
}

export interface CrashesOverviewResponse {
    groups: CrashOverviewGroup[];
    summary: {
        issues: number;
        events: number;
        users: number;
    };
    truncated: boolean;
}

export interface ANRsOverviewResponse {
    anrs: ANRRecord[];
    summary: {
        issues: number;
        events: number;
        users: number;
    };
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
            x: number; // Normalized 0-1 (left to right)
            y: number; // Normalized 0-1 (top to bottom)
            intensity: number; // 0-1 based on touch count
            isRageTap: boolean;
        }>;
        pageWidth?: number | null;
        pageHeight?: number | null;
        viewportWidth?: number | null;
        viewportHeight?: number | null;
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
    locations?: {
        country: string;
        city: string;
        lat: number;
        lng: number;
        totalRequests: number;
        avgLatencyMs: number;
        successRate: number;
        errorCount: number;
    }[];
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
export async function getApiLatencyByLocation(projectId?: string, timeRange?: string, platform?: string): Promise<ApiLatencyByLocationResponse> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoApiLatencyByLocation;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/analytics/latency-by-location?${params.toString()}`;
    const cacheKey = `analytics:latency-location:${projectId || 'all'}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v5-location-cap`;
    return fetchWithCache<ApiLatencyByLocationResponse>(endpoint, {}, cacheKey);
}

/**
 * Get insights trends (for charts)
 */
export async function getInsightsTrends(projectId?: string, timeRange?: string, platform?: string): Promise<InsightsTrends> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoInsightsTrends;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/insights/trends?${params.toString()}`;
    // 2 min cache - KPI cards depend on this, keep warm for snappy tab switching
    const cacheKey = `insights:trends:${projectId || 'all'}:${timeRange || 'all'}:${normalizedPlatform || 'all'}`;
    return fetchWithCache<InsightsTrends>(endpoint, {}, cacheKey, 120000);
}

export async function getDashboardOverview(projectId?: string, timeRange?: string, platform?: string): Promise<DashboardOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const observabilityMode = normalizedPlatform ? 'full' : 'summary';
        const [trends, overviewObs, deepMetrics, engagementTrends, geoSummary, retention] = await Promise.all([
            getInsightsTrends(projectId, timeRange, normalizedPlatform),
            getGrowthObservability(projectId, timeRange === 'all' ? undefined : timeRange, observabilityMode, normalizedPlatform),
            getObservabilityDeepMetrics(projectId, timeRange === 'all' ? undefined : timeRange, observabilityMode, normalizedPlatform),
            getUserEngagementTrends(projectId, timeRange === 'all' ? undefined : timeRange, normalizedPlatform, observabilityMode),
            getGeoSummary(projectId, timeRange === 'all' ? undefined : timeRange),
            getRetentionCohorts(projectId, timeRange, normalizedPlatform),
        ]);

        return {
            trends,
            overviewObs,
            deepMetrics,
            engagementTrends,
            geoSummary,
            retention,
            issues: [],
            failedSections: [],
        };
    }

    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/general?${params.toString()}`;
    const cacheKey = `overview:general:${projectId || 'all'}:${timeRange || 'all'}:${normalizedPlatform || 'all'}`;
    return fetchWithCache<DashboardOverviewResponse>(endpoint, {}, cacheKey, 60000);
}

export async function getDashboardOverviewHeavy(
    projectId?: string,
    timeRange?: string,
    platform?: string,
    section?: DashboardHeavySection,
): Promise<DashboardHeavyResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const sessionsResponse = await getSessionsPaginated({
            projectId,
            timeRange,
            platform: normalizedPlatform,
            limit: 30,
            includeTotal: false,
        });
        return {
            sessions: (sessionsResponse.sessions || []) as RecordingSession[],
            topUsers: [],
            failedSections: [],
        };
    }

    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    if (section) params.set('section', section);
    const endpoint = `/api/overview/general/heavy?${params.toString()}`;
    const cacheKey = `overview:general:heavy:${section || 'all'}:${projectId || 'all'}:${timeRange || 'all'}:${normalizedPlatform || 'all'}`;
    return fetchWithCache<DashboardHeavyResponse>(endpoint, {}, cacheKey, 60000);
}

export async function getApiOverview(projectId: string, timeRange?: string, platform?: string): Promise<ApiOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const range = timeRange === 'all' ? undefined : timeRange;
    const trendsRange = timeRange === '24h' ? '7d' : timeRange || '30d';
    const [endpointStatsResult, trendsResult] = await Promise.allSettled([
        getApiEndpointStats(projectId, range, normalizedPlatform),
        getInsightsTrends(projectId, trendsRange, normalizedPlatform),
    ]);

    const failedSections: string[] = [];
    if (endpointStatsResult.status !== 'fulfilled') failedSections.push('endpoint stats');
    if (trendsResult.status !== 'fulfilled') failedSections.push('traffic trends');

    return {
        endpointStats: endpointStatsResult.status === 'fulfilled' ? endpointStatsResult.value : null,
        regionStats: null,
        deepMetrics: null,
        latencyByLocation: null,
        trends: trendsResult.status === 'fulfilled' ? trendsResult.value : { daily: [] },
        failedSections,
    };
}

export async function getDevicesOverview(projectId: string, timeRange?: string, platform?: string): Promise<DevicesOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const range = timeRange === 'all' ? undefined : timeRange;
        const deviceRange = timeRange === 'all' ? 'max' : timeRange;
        const trendsRange = timeRange === '24h' ? '7d' : timeRange === '7d' ? '30d' : timeRange === '30d' ? '90d' : timeRange || '30d';

        const [summary, deepMetrics, matrix, trends] = await Promise.all([
            getDeviceSummary(projectId, deviceRange, normalizedPlatform),
            getObservabilityDeepMetrics(projectId, range, 'summary', normalizedPlatform),
            getDeviceIssueMatrix(projectId, deviceRange, normalizedPlatform),
            getInsightsTrends(projectId, trendsRange, normalizedPlatform),
        ]);

        return {
            summary,
            deepMetrics,
            matrix,
            trends,
            failedSections: [],
        };
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/devices?${params.toString()}`;
    const cacheKey = `overview:devices:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}`;
    return fetchWithCache<DevicesOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getGeoOverview(projectId: string, timeRange?: string, platform?: string): Promise<GeoOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const range = timeRange === 'all' ? undefined : timeRange;
        const [issues, latencyByLocation] = await Promise.all([
            getGeoIssues(projectId, range, normalizedPlatform),
            getApiLatencyByLocation(projectId, range, normalizedPlatform),
        ]);

        return {
            issues,
            latencyByLocation,
            failedSections: [],
        };
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/geo?${params.toString()}`;
    const cacheKey = `overview:geo:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v2-location-cap`;
    return fetchWithCache<GeoOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getJourneysOverview(
    projectId: string,
    timeRange?: string,
    mode: 'summary' | 'full' = 'summary',
    platform?: string,
    appVersion?: string | null,
): Promise<JourneysOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const normalizedAppVersion = appVersion && appVersion !== 'all' ? appVersion : undefined;
    if (isDemoMode()) {
        const journeyRange = timeRange === 'all' ? undefined : timeRange;
        const trendsRange = timeRange === '24h' ? '7d' : timeRange === '7d' ? '30d' : timeRange === '30d' ? '90d' : timeRange || '30d';

        const [journey, userEngagement, trends] = await Promise.all([
            getJourneyObservability(projectId, journeyRange, mode, normalizedPlatform, normalizedAppVersion),
            getUserEngagementTrends(projectId, journeyRange, normalizedPlatform),
            getInsightsTrends(projectId, trendsRange, normalizedPlatform),
        ]);

        return {
            journey,
            userEngagement,
            trends,
            failedSections: [],
        };
    }

    if (mode === 'full') {
        const journeyRange = timeRange === 'all' ? undefined : timeRange;
        const trendsRange = timeRange === '24h' ? '7d' : timeRange === '7d' ? '30d' : timeRange === '30d' ? '90d' : timeRange || '30d';
        const [journey, userEngagement, trends] = await Promise.all([
            getJourneyObservability(projectId, journeyRange, 'full', normalizedPlatform, normalizedAppVersion),
            getUserEngagementTrends(projectId, journeyRange, normalizedPlatform),
            getInsightsTrends(projectId, trendsRange, normalizedPlatform),
        ]);
        return { journey, userEngagement, trends, failedSections: [] };
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    if (normalizedAppVersion) params.set('appVersion', normalizedAppVersion);
    const endpoint = `/api/overview/journeys?${params.toString()}`;
    const cacheKey = `overview:journeys:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:${normalizedAppVersion || 'all'}:v2`;
    return fetchWithCache<JourneysOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getHeatmapsOverview(projectId: string, timeRange?: string, platform?: string): Promise<HeatmapOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        return buildDemoHeatmapOverview();
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/heatmaps?${params.toString()}`;
    const cacheKey = `overview:heatmaps:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v10`;
    return fetchWithCache<HeatmapOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getHeatmapScreenOverview(
    projectId: string,
    screenName: string,
    timeRange?: string,
    platform?: string,
): Promise<HeatmapScreenOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const overview = await getHeatmapsOverview(projectId, timeRange, normalizedPlatform);
        return {
            screen: overview.screens.find((screen) => screen.name === screenName) || null,
            failedSections: [],
        };
    }

    const params = new URLSearchParams({ projectId, screenName });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/heatmaps/screen?${params.toString()}`;
    const cacheKey = `overview:heatmaps:screen:${projectId}:${screenName}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v7`;
    return fetchWithCache<HeatmapScreenOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getWebAttentionHeatmap(
    projectId: string,
    screenName: string,
    timeRange?: string,
    platform?: string,
    appVersion?: string | null,
): Promise<WebAttentionHeatmapResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const normalizedAppVersion = appVersion && appVersion !== 'all' ? appVersion : undefined;
    if (isDemoMode()) {
        return getDemoWebAttentionHeatmap(screenName);
    }

    const params = new URLSearchParams({ projectId, screenName });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    if (normalizedAppVersion) params.set('appVersion', normalizedAppVersion);
    const endpoint = `/api/overview/heatmaps/attention?${params.toString()}`;
    const cacheKey = `overview:heatmaps:attention:${projectId}:${screenName}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:${normalizedAppVersion || 'all'}:v6`;
    return fetchWithCache<WebAttentionHeatmapResponse>(endpoint, {}, cacheKey, 600_000);
}

export async function getErrorsOverview(projectId: string, timeRange?: string, platform?: string): Promise<ErrorsOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const response = await getErrors(projectId, { timeRange });
        const grouped = (response.grouped || []) as any[];
        const filteredGrouped = grouped.filter(
            (group) => !normalizedPlatform || matchesPlatformFilter(group.sampleError?.platform ?? group.platform, normalizedPlatform),
        );
        return {
            groups: filteredGrouped.map((group, index) => ({
                fingerprint: group.fingerprint || `${group.errorName}:${group.message}:${index}`,
                errorName: group.errorName,
                message: group.message,
                count: group.count,
                users: group.users || (group.sampleSessionId ? [group.sampleSessionId] : []),
                firstSeen: group.firstSeen,
                lastOccurred: group.lastSeen,
                affectedDevices: group.affectedDevices || {},
                affectedVersions: group.affectedVersions || {},
                screens: group.screens || [],
                sampleError: {
                    id: group.sampleError?.id || group.sampleSessionId || `demo-error-${index}`,
                    sessionId: group.sampleError?.sessionId ?? group.sampleSessionId,
                    timestamp: group.sampleError?.timestamp || group.lastSeen,
                    deviceModel: group.sampleError?.deviceModel ?? null,
                    appVersion: group.sampleError?.appVersion ?? null,
                    stack: group.sampleError?.stack ?? null,
                    screenName: group.sampleError?.screenName ?? null,
                    logs: Array.isArray(group.sampleError?.logs) ? group.sampleError.logs : [],
                    canOpenReplay: group.sampleError?.canOpenReplay ?? Boolean(group.sampleError?.sessionId ?? group.sampleSessionId),
                },
            })),
            summary: {
                issues: filteredGrouped.length,
                events: filteredGrouped.reduce((sum, group) => sum + Number(group.count || 0), 0),
                users: filteredGrouped.reduce((sum, group) => sum + (group.users?.length || (group.sampleSessionId ? 1 : 0)), 0),
            },
            truncated: false,
        };
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/errors?${params.toString()}`;
    const cacheKey = `overview:errors:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v2`;
    return fetchWithCache<ErrorsOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getCrashesOverview(projectId: string, timeRange?: string, platform?: string): Promise<CrashesOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const groups = (demoApiData.demoCrashesOverview.groups || []).filter(
            (group: any) => !normalizedPlatform || matchesPlatformFilter(group.platform, normalizedPlatform),
        );
        return {
            groups: groups.map((group: any) => ({
                ...group,
                canOpenReplay: group.canOpenReplay ?? Boolean(group.sampleSessionId),
            })),
            summary: {
                issues: groups.length,
                events: groups.reduce((sum: number, group: CrashOverviewGroup) => sum + Number(group.count || 0), 0),
                users: groups.reduce((sum: number, group: CrashOverviewGroup) => sum + (group.users?.length || 0), 0),
            },
            truncated: false,
        };
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/crashes?${params.toString()}`;
    const cacheKey = `overview:crashes:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v2`;
    return fetchWithCache<CrashesOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export async function getANRsOverview(projectId: string, timeRange?: string, platform?: string): Promise<ANRsOverviewResponse> {
    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    if (isDemoMode()) {
        const response = await getANRs(projectId, { timeRange });
        const filteredAnrs = (response.anrs || [])
            .filter(
                (anr: any) =>
                    !normalizedPlatform || matchesPlatformFilter(anr.platform ?? anr.deviceMetadata?.platform ?? anr.deviceMetadata?.os, normalizedPlatform),
            )
            .map((anr: any) => ({
                ...anr,
                canOpenReplay: anr.canOpenReplay ?? Boolean(anr.sessionId),
            }));
        return {
            anrs: filteredAnrs,
            summary: {
                issues: filteredAnrs.length,
                events: filteredAnrs.reduce((sum, anr) => sum + Number(anr.occurrenceCount || 0), 0),
                users: filteredAnrs.reduce((sum, anr) => sum + Number(anr.userCount || 0), 0),
            },
        };
    }

    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/overview/anrs?${params.toString()}`;
    const cacheKey = `overview:anrs:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v2`;
    return fetchWithCache<ANRsOverviewResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export interface ApiErrorSpikeTrendBucket {
    bucket: string;
    errorCount: number;
    totalCount: number;
    errorRate: number;
}

export interface ApiErrorSpikeRecord {
    id: string;
    detectedAt: string;
    currentRate: number;
    previousRate: number;
    percentIncrease: number | null;
    affectedSessions: number;
    trend: ApiErrorSpikeTrendBucket[];
    topEndpoints: Array<{ method: string; endpoint: string; errorCount: number }>;
    ignoredApiEndpoints?: string[];
}

export interface ApiErrorSpikesResponse {
    spikes: ApiErrorSpikeRecord[];
    ignoredApiEndpoints?: string[];
}

export async function getApiErrorSpikes(projectId: string, timeRange?: string): Promise<ApiErrorSpikesResponse> {
    if (isDemoMode()) return demoApiData.demoApiErrorSpikesResponse;
    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    const endpoint = `/api/overview/api-error-spikes?${params.toString()}`;
    const cacheKey = `overview:api-error-spikes:${projectId}:${timeRange || 'all'}:v2`;
    return fetchWithCache<ApiErrorSpikesResponse>(endpoint, {}, cacheKey, ANALYTICS_BOOTSTRAP_CACHE_TTL);
}

export interface ProjectAlertSettings {
    id: string;
    projectId: string;
    crashAlertsEnabled: boolean;
    anrAlertsEnabled: boolean;
    errorSpikeAlertsEnabled: boolean;
    apiDegradationAlertsEnabled: boolean;
    errorSpikeThresholdPercent: number;
    apiDegradationThresholdPercent: number;
    apiLatencyThresholdMs: number;
    emailRules: unknown[];
    ignoredApiEndpoints: string[];
}

export async function getProjectAlertSettings(projectId: string): Promise<ProjectAlertSettings> {
    const cacheKey = `project-alert-settings:${projectId}:v1`;
    const response = await fetchWithCache<{ settings: ProjectAlertSettings }>(
        `/api/projects/${projectId}/alert-settings`,
        {},
        cacheKey,
        CACHE_TTL,
    );
    return response.settings;
}

export async function updateProjectAlertSettings(
    projectId: string,
    settings: Partial<Pick<ProjectAlertSettings, 'ignoredApiEndpoints'>>,
): Promise<ProjectAlertSettings> {
    const cacheKey = `project-alert-settings:${projectId}:v1`;
    clearCache(cacheKey);
    clearCacheMatching((key) => key.startsWith(`overview:api-error-spikes:${projectId}:`));
    const response = await fetchJson<{ settings: ProjectAlertSettings }>(`/api/projects/${projectId}/alert-settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
    });
    return response.settings;
}

export async function getRetentionCohorts(projectId?: string, timeRange?: string, platform?: string): Promise<RetentionCohortsResponse> {
    if (isDemoMode()) {
        return demoApiData.demoRetentionCohorts;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const endpoint = `/api/insights/retention-cohorts?${params.toString()}`;
    return fetchWithCache<RetentionCohortsResponse>(endpoint, {}, endpoint, 120000);
}

/**
 * Get issues for a project
 */
export async function getIssues(
    projectId: string,
    timeRange: string = '30d',
    searchQuery?: string,
    issueType?: string,
): Promise<{ issues: Issue[]; stats: any; total: number }> {
    if (isDemoMode()) {
        return demoApiData.demoIssuesResponse;
    }

    const params = new URLSearchParams();
    params.set('projectId', projectId);
    params.set('timeRange', timeRange);
    params.set('limit', '50');
    if (searchQuery) params.set('search', searchQuery);
    if (issueType) params.set('type', issueType);

    return fetchWithCache<{ issues: Issue[]; stats: any; total: number }>(`/api/general?${params.toString()}`);
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
        const issue = demoApiData.demoIssuesResponse.issues.find((i) => i.id === issueId) || demoApiData.demoIssuesResponse.issues[0];
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
export async function updateIssue(
    issueId: string,
    updates: { status?: 'unresolved' | 'resolved' | 'ignored' | 'ongoing'; priority?: string; assigneeId?: string | null },
): Promise<Issue> {
    if (isDemoMode()) {
        // Return a mock updated issue for demo mode
        return {} as Issue;
    }

    return fetchJson<Issue>(`/api/general/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
}

// =============================================================================
// Issue Detection / Leaks
// =============================================================================

export type LeakStatus = 'queued' | 'researching' | 'ready' | 'resolved' | 'ignored' | 'budget_exhausted' | 'failed';
export type LeakSeverity = 'low' | 'medium' | 'high' | 'critical';
export type LeakContextStatus = 'queued' | 'running' | 'ready' | 'budget_exhausted' | 'failed';

export interface LeakCodePointer {
    file: string;
    line?: number;
    column?: number;
    label?: string;
}

export interface LeakSummary {
    id: string;
    shortId?: string;
    projectId: string;
    title: string;
    status: LeakStatus;
    severity: LeakSeverity;
    issueType: string;
    whyItMatters: string;
    affectedSessionsCount: number;
    affectedUsersCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    estimatedCostUsd?: number;
    contextStatus: LeakContextStatus;
    topSignals: string[];
    topCodePointer?: LeakCodePointer | null;
}

export interface LeakSignal {
    id: string;
    label: string;
    weight?: number;
    summary?: string;
}

export interface LeakEvidenceGroup {
    label: string;
    signals: LeakSignal[];
}

export interface LeakSessionReference {
    id: string;
    startedAt?: string;
    replayUrl?: string;
    signalScore?: number;
}

export interface LeakDetail extends LeakSummary {
    evidenceGroups: LeakEvidenceGroup[];
    sessions: LeakSessionReference[];
    codePointers: LeakCodePointer[];
    contextMarkdown?: string | null;
    contextMarkdownUrl?: string | null;
}

export interface LeaksResponse {
    leaks: LeakSummary[];
    stats: {
        total: number;
        ready: number;
        queued: number;
        researching: number;
        budgetExhausted: number;
        resolved: number;
    };
    nextCursor?: string | null;
}

export async function getLeaks(params: {
    cursor?: string;
    projectId: string;
    q?: string;
    severity?: string;
    status?: string;
    type?: string;
}): Promise<LeaksResponse> {
    if (isDemoMode()) {
        return demoApiData.demoLeaksResponse as LeaksResponse;
    }

    const query = new URLSearchParams();
    query.set('projectId', params.projectId);
    if (params.status) query.set('status', params.status);
    if (params.q) query.set('q', params.q);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.severity) query.set('severity', params.severity);
    if (params.type) query.set('type', params.type);
    return fetchJson<LeaksResponse>(`/api/automations/leaks?${query.toString()}`);
}

export async function getLeak(leakId: string): Promise<LeakDetail> {
    if (isDemoMode()) {
        const detail = demoApiData.demoLeakDetails.find((leak: any) => leak.id === leakId) || demoApiData.demoLeakDetails[0];
        return detail as LeakDetail;
    }

    return fetchJson<LeakDetail>(`/api/automations/leaks/${encodeURIComponent(leakId)}`);
}

export async function requestLeakContext(leakId: string): Promise<LeakDetail> {
    if (isDemoMode()) {
        return getLeak(leakId);
    }

    return fetchJson<LeakDetail>(`/api/automations/leaks/${encodeURIComponent(leakId)}/context`, {
        method: 'POST',
    });
}

export async function getLeakContextRaw(leakId: string): Promise<string> {
    if (isDemoMode()) {
        const detail = await getLeak(leakId);
        return detail.contextMarkdown || '';
    }

    const response = await fetch(`/api/automations/leaks/${encodeURIComponent(leakId)}/context/raw.md`, {
        headers: withDefaultHeaders(),
        credentials: 'include',
    });
    if (!response.ok) {
        throw new ApiServiceUnavailableError('Failed to load leak context', response.status);
    }
    return response.text();
}

export async function updateLeak(
    leakId: string,
    updates: { status?: LeakStatus },
): Promise<LeakDetail> {
    if (isDemoMode()) {
        const detail = await getLeak(leakId);
        return { ...detail, ...updates } as LeakDetail;
    }

    return fetchJson<LeakDetail>(`/api/automations/leaks/${encodeURIComponent(leakId)}`, {
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
    screenFirstSeenMs?: number | null;
    touchHotspots: HeatmapHotspot[];
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
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
    payload: { confirmText: string; acknowledgeBillingDowngrade?: boolean },
): Promise<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }> {
    return fetchJson<{ success: boolean; message: string; expiresInMinutes: number; devCode?: string }>(`/api/teams/${teamId}/delete-otp`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * Delete a team and all nested projects/data.
 */
export async function deleteTeam(
    teamId: string,
    payload: { confirmText: string; otpCode: string; acknowledgeBillingDowngrade?: boolean },
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
    role: string = 'member',
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
    const data = await fetchJson<{ invitations: ApiTeamInvitation[] }>(`/api/teams/${teamId}/invitations`);
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
    const data = await fetchJson<{ invitation: ApiTeamInvitation }>(`/api/teams/invitations/${token}`);
    return data.invitation;
}

/**
 * Accept an invitation
 */
export async function acceptInvitation(token: string): Promise<{ success: boolean; team?: { id: string; name?: string } }> {
    const data = await fetchJson<{ success: boolean; team?: { id: string; name?: string } }>('/api/teams/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
    });
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
export async function getGeoIssues(projectId?: string, timeRange?: string, platform?: string): Promise<GeoIssuesSummary> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoGeoIssues;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:geo-issues:${projectId || 'all'}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:v2-location-cap`;
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
export async function getRegionPerformance(projectId: string, timeRange?: string, platform?: string): Promise<RegionPerformance> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoRegionPerformance;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const cacheKey = `analytics:region-performance:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}`;
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
export async function getApiEndpointStats(projectId: string, timeRange?: string, platform?: string): Promise<ApiEndpointStats> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoApiEndpointStats;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams({ projectId });
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const cacheKey = `analytics:api-endpoint-stats:v2:${projectId}:${timeRange || 'all'}:${normalizedPlatform || 'all'}`;
    return fetchWithCache<ApiEndpointStats>(`/api/analytics/api-endpoint-stats?${params.toString()}`, {}, cacheKey);
}

// =============================================================================
// Device Summary
// =============================================================================

export interface DeviceSummary {
    devices: Array<{
        model: string;
        count: number;
        crashes: number;
        anrs: number;
        errors: number;
        rageTaps: number;
        avgDurationSeconds?: number;
        avgInteractionScore?: number;
        avgExplorationScore?: number;
        avgUxScore?: number;
        engagedSessions?: number;
        totalEvents?: number;
    }>;
    platforms: Record<string, number>;
    appVersions: Array<{ version: string; count: number; crashes: number; anrs: number; errors: number; rageTaps: number }>;
    osVersions: Array<{ version: string; count: number; crashes: number; anrs: number; errors: number; rageTaps: number }>;
    totalSessions: number;
}

export async function getDeviceSummary(projectId?: string, timeRange?: string, platform?: string): Promise<DeviceSummary> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoDeviceSummary;
    }

    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (platform) params.set('platform', platform);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:device-summary:${projectId || 'all'}:${timeRange || 'all'}:${platform || 'all'}`;
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

export async function getDeviceIssueMatrix(projectId?: string, timeRange?: string, platform?: string): Promise<DeviceIssueMatrix> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoDeviceIssueMatrix;
    }

    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (platform) params.set('platform', platform);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:device-issues-matrix:${projectId || 'all'}:${timeRange || 'all'}:${platform || 'all'}`;
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
    appVersions: Array<{ version: string; count: number }>;
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
    platform?: string,
    appVersion?: string | null,
): Promise<ObservabilityJourneySummary> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoJourneyObservability;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const normalizedAppVersion = appVersion && appVersion !== 'all' ? appVersion : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (mode !== 'full') params.set('mode', mode);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    if (normalizedAppVersion) params.set('appVersion', normalizedAppVersion);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:journey-observability:${projectId || 'all'}:${timeRange || 'all'}:${mode}:${normalizedPlatform || 'all'}:${normalizedAppVersion || 'all'}:v2`;
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
    dailyCustomEvents?: Array<{
        date: string;
        events: Record<string, number>;
    }>;
}

export async function getGrowthObservability(
    projectId?: string,
    timeRange?: string,
    mode: 'full' | 'summary' = 'full',
    platform?: string,
): Promise<GrowthObservability> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoGrowthObservability;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (mode !== 'full') params.set('mode', mode);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:growth-observability:${projectId || 'all'}:${timeRange || 'all'}:${mode}:${normalizedPlatform || 'all'}`;
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
    platform?: string,
): Promise<ObservabilityDeepMetrics> {
    if (isDemoMode()) {
        return demoApiData.demoObservabilityDeepMetrics;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (mode !== 'full') params.set('mode', mode);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:observability-deep-metrics:${projectId || 'all'}:${timeRange || 'all'}:${mode}:${normalizedPlatform || 'all'}`;
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

export async function getUserEngagementTrends(
    projectId?: string,
    timeRange?: string,
    platform?: string,
    mode: 'full' | 'summary' = 'full',
): Promise<UserEngagementTrends> {
    // Demo mode: return mock data
    if (isDemoMode()) {
        return demoApiData.demoUserEngagementTrends;
    }

    const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (normalizedPlatform) params.set('platform', normalizedPlatform);
    if (mode !== 'full') params.set('mode', mode);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const cacheKey = `analytics:user-engagement-trends:${projectId || 'all'}:${timeRange || 'all'}:${normalizedPlatform || 'all'}:${mode}`;
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
    },
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
        const error = demoApiData.demoErrorsResponse.errors.find((e: any) => e.id === errorId) || demoApiData.demoErrorsResponse.errors[0];
        return {
            ...error,
            canOpenReplay: error.canOpenReplay ?? Boolean(error.sessionId),
        };
    }
    const data = await fetchJson<any>(`/api/projects/${projectId}/errors/${errorId}`);
    return data;
}

// =============================================================================
// Funnel Stats
// =============================================================================

// =============================================================================
// Public Roadmap
// =============================================================================

export interface RoadmapPost {
    id: string;
    authorUserId: string | null;
    authorName: string;
    title: string;
    details: string;
    status: string;
    developerComment: string | null;
    votes: number;
    createdAt: string;
    updatedAt: string;
}

export interface RoadmapVoteResponse {
    post: RoadmapPost;
    voted: boolean;
    alreadyVoted: boolean;
}

export async function getRoadmapPosts(): Promise<RoadmapPost[]> {
    const data = await fetchJson<{ posts: RoadmapPost[] }>('/api/roadmap');
    return data.posts;
}

export async function getRoadmapVotePostIds(): Promise<string[]> {
    const data = await fetchJson<{ postIds: string[] }>('/api/roadmap/me/votes');
    return data.postIds;
}

export async function createRoadmapPost(input: { title: string; details: string }): Promise<RoadmapPost> {
    const data = await fetchJson<{ post: RoadmapPost }>('/api/roadmap', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    return data.post;
}

export async function setRoadmapVote(postId: string, voted: boolean): Promise<RoadmapVoteResponse> {
    if (!voted) {
        try {
            return await fetchJson<RoadmapVoteResponse>(`/api/roadmap/${postId}/unvote`, {
                method: 'POST',
                body: JSON.stringify({ voted: false }),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            if (!/404|not found/i.test(message)) throw err;
        }
    }

    return fetchJson<RoadmapVoteResponse>(`/api/roadmap/${postId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ voted }),
    });
}

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
export async function getWorkspace(teamId: string, projectId: string, workspaceKey: string = 'default'): Promise<WorkspaceState> {
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
    workspaceKey: string = 'default',
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
    getSessionBootstrap,
    getSessionCore,
    getSharedReplayCore,
    getSessionFrames,
    getSharedReplayFrames,
    getSessionReplayManifest,
    getSharedReplayManifest,
    getSessionTimeline,
    getSharedReplayTimeline,
    getSessionHierarchy,
    getSharedReplayHierarchy,
    getSessionStats,
    getSharedReplayStats,
    getReplayShareLinks,
    createReplayShareLink,
    revokeReplayShareLink,
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
    sendProjectSetupEmail,
    deleteProject,
    getTeamBillingUsage,
    getTeamBillingDashboard,
    getStripeStatus,
    setupStripeForTeam,
    getPaymentMethods,
    addPaymentMethod,
    removePaymentMethod,
    createBillingPortalSession,
    createBillingPortalPlanChangeSession,
    getFreeTierStatus,
    updateAccountSettings,
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
    getDashboardOverview,
    getDashboardOverviewHeavy,
    getApiOverview,
    getDevicesOverview,
    getGeoOverview,
    getJourneysOverview,
    getHeatmapsOverview,
    getHeatmapScreenOverview,
    getWebAttentionHeatmap,
    getErrorsOverview,
    getCrashesOverview,
    getANRsOverview,
    getApiErrorSpikes,
    getProjectAlertSettings,
    updateProjectAlertSettings,
    getRetentionCohorts,
    getIssues,
    getIssue,
    getIssueSessions,
    syncIssues,
    updateIssue,
    getLeaks,
    getLeak,
    requestLeakContext,
    getLeakContextRaw,
    updateLeak,
    getAlltimeHeatmap,
    getTeams,
    getTeam,
    getErrors,
    getError,
    getRoadmapPosts,
    getRoadmapVotePostIds,
    createRoadmapPost,
    setRoadmapVote,
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
