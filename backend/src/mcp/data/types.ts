/**
 * Shapes and limits of the scoped data layer. No database imports: tools may
 * import this file, never `scoped.ts`.
 */

import type { McpContext } from '../context.js';
import type { NormalizedTimelineEvent } from '../timeline/normalize.js';

// --- Limits ---------------------------------------------------------------------

/** Counts stop here; one more row means "10,000+". */
export const COUNT_CAP = 10_000;
/** Sessions scanned for the health summary before it reports a capped sample. */
export const HEALTH_SESSION_SCAN_CAP = 250_000;
export const MAX_DIGEST_SESSIONS = 50;

// --- Shapes returned to tools ----------------------------------------------------

export interface TimeRange {
    from: Date;
    /** Exclusive. */
    to: Date;
}

export const SESSION_ISSUE_TYPES = ['crash', 'anr', 'error', 'rage_tap', 'dead_tap', 'slow_start'] as const;
export type SessionIssueType = (typeof SESSION_ISSUE_TYPES)[number];
export const SESSION_PLATFORMS = ['ios', 'android', 'web', 'mobile'] as const;
export type SessionPlatformFilter = (typeof SESSION_PLATFORMS)[number];

export interface SessionFilter {
    projectId: string;
    range: TimeRange;
    platform?: SessionPlatformFilter;
    appVersion?: string;
    userId?: string;
    screenName?: string;
    country?: string;
    customEventName?: string;
    issueType?: SessionIssueType;
    hasReplay?: boolean;
}

export interface CappedCount {
    count: number;
    /** True when at least `count + 1` rows match. */
    capped: boolean;
}

export interface ProjectSummary {
    id: string;
    name: string;
    platforms: string[];
}

export interface SessionSummary {
    id: string;
    projectId: string;
    startedAt: string;
    durationSeconds: number;
    platform: string | null;
    appVersion: string | null;
    deviceModel: string | null;
    country: string | null;
    userId: string | null;
    screenCount: number;
    crashes: number;
    anrs: number;
    errors: number;
    rageTaps: number;
    deadTaps: number;
    hasReplay: boolean;
}

export interface SessionCursorKey {
    /** `started_at` with microseconds, as text. */
    startedAtKey: string;
    id: string;
}

export interface SessionPage {
    sessions: SessionSummary[];
    /** Keyset position of each returned row, same order. */
    keys: SessionCursorKey[];
    hasMore: boolean;
    total: CappedCount;
}

export interface SessionSample {
    sessions: SessionSummary[];
    population: CappedCount;
}

export interface SessionDetail extends SessionSummary {
    endedAt: string | null;
    status: string;
    osVersion: string | null;
    sdkVersion: string | null;
    deviceHash: string | null;
    isAnonymous: boolean;
    city: string | null;
    countryCode: string | null;
    screens: string[];
    screensTruncated: boolean;
    metrics: {
        totalEvents: number;
        touches: number;
        scrolls: number;
        gestures: number;
        inputs: number;
        customEvents: number;
        apiTotal: number;
        apiErrors: number;
        apiAvgResponseMs: number;
        appStartupMs: number | null;
    };
    replayUnavailableReason: string | null;
}

export interface SessionDigest {
    id: string;
    startedAt: string;
    durationSeconds: number;
    platform: string | null;
    appVersion: string | null;
    screens: string[];
    screensTruncated: boolean;
    customEvents: Array<{ name: string; count: number }>;
    friction: { rageTaps: number; deadTaps: number; crashes: number; anrs: number; errors: number; apiErrors: number };
    topErrors: Array<{ kind: 'error' | 'crash' | 'anr'; name: string; message: string; count: number }>;
}

export interface SessionTimelineSource {
    sessionId: string;
    projectId: string;
    sessionStartMs: number;
    durationSeconds: number;
    /** Normalised, merged with fault rows and stored custom events, oldest first. */
    events: NormalizedTimelineEvent[];
    /** 'ok', or why the recorded event stream is missing or incomplete. */
    eventStream: 'ok' | 'none' | 'expired' | 'partial';
}

export interface SessionFault {
    id: string;
    type: FaultType;
    occurredAtMs: number;
    name: string;
    message: string | null;
    stackTrace: string | null;
    screenName: string | null;
    durationMs: number | null;
}

/** One session with everything needed to explain it. */
export interface SessionBundle {
    session: SessionDetail;
    timeline: SessionTimelineSource;
    /** Crash, ANR and error rows of the session, oldest first. */
    faults: SessionFault[];
    customEvents: Array<{ name: string; count: number }>;
}

export interface IssueSummary {
    id: string;
    projectId: string;
    shortId: string;
    type: string;
    title: string;
    subtitle: string | null;
    culprit: string | null;
    screenName: string | null;
    status: string;
    priority: string | null;
    isHandled: boolean | null;
    firstSeen: string;
    lastSeen: string;
    eventCount: number;
    userCount: number;
    events24h: number;
}

export interface IssueCursorKey {
    lastSeenKey: string;
    id: string;
}

export interface IssuePage {
    issues: IssueSummary[];
    keys: IssueCursorKey[];
    hasMore: boolean;
    total: CappedCount;
}

export interface IssueFilter {
    projectId: string;
    range: TimeRange;
    type?: string;
    status?: string;
}

export interface IssueDetail extends IssueSummary {
    environment: string | null;
    componentName: string | null;
    stackTrace: string | null;
    sampleDevice: { model: string | null; osVersion: string | null; appVersion: string | null };
    affectedVersions: Array<{ name: string; count: number }>;
    affectedDevices: Array<{ name: string; count: number }>;
    sampleSessions: Array<{ sessionId: string; occurredAtMs: number; appVersion: string | null; deviceModel: string | null }>;
    /** Up to 20 most recent occurrences that still have a readable session. */
    recentOccurrences: Array<{ sessionId: string; occurredAtMs: number; appVersion: string | null; deviceModel: string | null; osVersion: string | null }>;
    /** Events per UTC day, oldest first, at most the last 30 days with events. */
    dailyEvents: Array<{ day: string; count: number }>;
}

export const FAULT_TYPES = ['crash', 'anr', 'error'] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

export interface FaultDetail {
    id: string;
    type: FaultType;
    projectId: string;
    sessionId: string | null;
    occurredAt: string;
    occurredAtMs: number;
    name: string;
    message: string | null;
    status: string;
    screenName: string | null;
    durationMs: number | null;
    stackTrace: string | null;
    device: {
        platform: string | null;
        model: string | null;
        osVersion: string | null;
        appVersion: string | null;
        sdkVersion: string | null;
    };
    sessionHasReplay: boolean;
}

export interface ProjectHealth {
    projectId: string;
    sessions: CappedCount;
    sessionsWithCrash: number;
    sessionsWithAnr: number;
    sessionsWithError: number;
    /** Null when no sessions were counted. */
    crashFreeSessionRate: number | null;
    crashes: CappedCount;
    anrs: CappedCount;
    errors: CappedCount;
    topIssues: Array<IssueSummary & { eventsInRange: number }>;
}

// --- Friction ---------------------------------------------------------------------

export const FRICTION_KINDS = [
    'rage_taps',
    'dead_taps',
    'api_errors',
    'slow_start',
    'slow_api',
    'error_burst',
    'crash',
    'anr',
    'short_session_after_error',
] as const;
export type FrictionKind = (typeof FRICTION_KINDS)[number];

/**
 * When a session counts towards a friction kind. The first four match the
 * dashboard's session filters (and `search_sessions`), so a group can be
 * opened as a list.
 */
export const FRICTION_THRESHOLDS = {
    /** rage_taps: more than this many rage taps in the session. */
    rageTapsMoreThan: 3,
    /** dead_taps: at least this many dead taps. */
    deadTapsAtLeast: 1,
    /** api_errors: at least this many failed API calls. */
    apiErrorsAtLeast: 1,
    /** slow_start: app start-up took longer than this. */
    slowStartMs: 3000,
    /** slow_api: the session's average API response took longer than this. */
    slowApiAvgMs: 1000,
    /** error_burst: at least this many errors in one session. */
    errorBurstAtLeast: 3,
    /** short_session_after_error: an error or failed API call, in a session shorter than this. */
    shortSessionSeconds: 30,
} as const;

/** Sessions scanned (newest first, both periods together) before the report says it is capped. */
export const FRICTION_SESSION_SCAN_CAP = 200_000;
export const FRICTION_MAX_RANGE_DAYS = 30;
export const FRICTION_EXAMPLES_PER_GROUP = 5;

export interface FrictionGroup {
    kind: FrictionKind;
    sessionsAffected: number;
    previousSessionsAffected: number;
    /** Distinct people among the affected sessions (user id, else anonymous id, else device, else the session). */
    usersAffected: number;
    versions: Array<{ appVersion: string | null; platform: string | null; sessions: number }>;
    exampleSessionIds: string[];
}

export interface FrictionReport {
    projectId: string;
    /** Sessions in the range that match the filters: the denominator. */
    sessionsInRange: number;
    previousSessionsInRange: number;
    /** True when the scan cap was reached: older sessions were not counted. */
    capped: boolean;
    /**
     * The scan runs newest first over the range and then the period before it,
     * so the cap cuts the previous period first. False here means that period's
     * counts cover only its most recent sessions.
     */
    previousRangeComplete: boolean;
    /** False when even the range itself was cut by the cap. */
    rangeComplete: boolean;
    groups: FrictionGroup[];
    /** Screens with the most error rows in the range. */
    errorScreens: Array<{ screenName: string | null; events: number }>;
    errorEventsCounted: number;
    /** The crash, ANR and error issues with the most events in the range. */
    topIssues: Array<IssueSummary & { eventsInRange: number }>;
}

export interface FrictionFilter {
    projectId: string;
    range: TimeRange;
    platform?: SessionPlatformFilter;
    appVersion?: string;
    screenName?: string;
}

/** Fault rows read, newest first, for one breakdown. */
export const FAULT_SUMMARY_SCAN_CAP = 50_000;
export const FAULT_SUMMARY_GROUPS = 12;
export const FAULT_SUMMARY_EXAMPLES_PER_GROUP = 2;
export const FAULT_SUMMARY_BREAKDOWN_ROWS = 10;
/** Rows drawn, by a stable hash, as candidates for reading the lead-up. */
export const FAULT_SUMMARY_SAMPLE_ROWS = 40;
/** Sessions whose lead-up is read when asked for. */
export const FAULT_SUMMARY_LEAD_UP_SESSIONS = 8;

export interface FaultSummaryFilter {
    projectId: string;
    type: FaultType;
    range: TimeRange;
    platform?: SessionPlatformFilter;
    appVersion?: string;
}

export interface FaultBreakdownRow {
    name: string;
    count: number;
    sessions: number;
}

export interface FaultGroup {
    /** Stored fingerprint, or a hash of the name and the start of the message or stack. */
    signature: string;
    name: string;
    /** Start of the message (crash, error) or of the stack (ANR). */
    detail: string | null;
    count: number;
    sessions: number;
    firstSeen: string;
    lastSeen: string;
    /** The grouped issue with the same fingerprint, when there is one. */
    issueId: string | null;
    examples: Array<{ faultId: string; sessionId: string | null; occurredAtMs: number }>;
}

export interface FaultSummary {
    projectId: string;
    type: FaultType;
    /** Rows read. When capped, everything below describes the most recent rows only. */
    total: { count: number; capped: boolean };
    sessions: number;
    /** Distinct signatures among the rows read. */
    groupCount: number;
    groups: FaultGroup[];
    /** ANRs only: how long the main thread was blocked. */
    durationMs: { p50: number; p90: number; max: number } | null;
    byAppVersion: FaultBreakdownRow[];
    byPlatform: FaultBreakdownRow[];
    byOsVersion: FaultBreakdownRow[];
    byDevice: FaultBreakdownRow[];
    /** Errors only: crashes and ANRs carry no screen. */
    byScreen: FaultBreakdownRow[];
    /** Rows per UTC day, oldest first. */
    daily: Array<{ day: string; count: number; sessions: number }>;
    /**
     * A stable pseudo-random draw from all rows read (by a hash of the row id),
     * so large groups appear in proportion. Only rows that still have a session.
     */
    sample: Array<{ faultId: string; sessionId: string; occurredAtMs: number; name: string; detail: string | null }>;
}

export interface McpScopedData {
    /**
     * Crash, ANR or error rows of one project and range, grouped by signature
     * and broken down by version, platform, OS, device, screen and day. Works
     * from the rows themselves, so it covers faults that belong to no issue.
     */
    summarizeFaults(ctx: McpContext, filter: FaultSummaryFilter): Promise<FaultSummary | null>;
    /** Friction groups for a project and range, with the previous equal period for comparison. */
    findFriction(ctx: McpContext, filter: FrictionFilter): Promise<FrictionReport | null>;
    listProjects(ctx: McpContext): Promise<ProjectSummary[]>;
    getProjectHealth(ctx: McpContext, input: { projectId: string; range: TimeRange }): Promise<ProjectHealth | null>;
    searchSessions(ctx: McpContext, filter: SessionFilter, page: { limit: number; after?: SessionCursorKey }): Promise<SessionPage | null>;
    sampleSessions(ctx: McpContext, filter: SessionFilter, sample: { size: number; seed: number }): Promise<SessionSample | null>;
    getSession(ctx: McpContext, sessionId: string): Promise<SessionDetail | null>;
    getSessionDigests(ctx: McpContext, sessionIds: readonly string[]): Promise<SessionDigest[]>;
    /**
     * `aroundMs` reads only the recorded events near that instant (five minutes
     * before to ten seconds after): enough for a lead-up, not a whole timeline.
     */
    getSessionTimeline(ctx: McpContext, sessionId: string, read?: { aroundMs?: number }): Promise<SessionTimelineSource | null>;
    /**
     * Up to eight sessions with their timelines and fault rows; ids that cannot be read are absent.
     * `aroundMs` maps a session id to the instant its read is narrowed to, as above.
     */
    getSessionBundles(ctx: McpContext, sessionIds: readonly string[], read?: { aroundMs?: ReadonlyMap<string, number> }): Promise<SessionBundle[]>;
    listIssues(ctx: McpContext, filter: IssueFilter, page: { limit: number; after?: IssueCursorKey }): Promise<IssuePage | null>;
    getIssue(ctx: McpContext, issueId: string): Promise<IssueDetail | null>;
    getFault(ctx: McpContext, faultId: string, type?: FaultType): Promise<FaultDetail | null>;
}
