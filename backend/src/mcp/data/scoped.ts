/**
 * The scoped data layer: the one place MCP reads tenant data (§6.2 "one choke
 * point").
 *
 * Rules every function here follows:
 *   - It takes the `McpContext` and adds `project_id IN (ctx.allowedProjectIds)`
 *     to its own query. A project id from the caller only narrows that set.
 *   - Something outside the grant gives the same answer as something that does
 *     not exist (`null`, or simply absent from a list).
 *   - Every query is bounded: by project, by a time range or a primary key, and
 *     by a row limit. Lists page by keyset. Counts stop at `COUNT_CAP`.
 *   - It returns plain objects built field by field. Storage keys, endpoint
 *     ids, raw device ids, coordinates and whole rows never leave this module.
 *
 * Tools receive an `McpScopedData` and never import a database client.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
    anrs,
    crashes,
    errors,
    issueEvents,
    issues,
    projects,
    sessionMetrics,
    sessions,
} from '../../db/schema.js';
import { resolveAnrStackTrace } from '../../services/anrStack.js';
import { canOpenReplayFromSessionFields } from '../../services/replayAvailability.js';
import { resolveStoredOrDerivedSessionDurationSeconds } from '../../services/sessionTiming.js';
import type { ArtifactReader } from '../artifacts/reader.js';
import type { McpContext } from '../context.js';
import {
    buildFaultEvents,
    filterDisplayAnrs,
    mergeEventsWithFaults,
    normalizeTimelineEvents,
    selectExtraCustomSessionEvents,
} from '../timeline/normalize.js';
import type { McpDb } from './db.js';

import {
    COUNT_CAP,
    FAULT_SUMMARY_BREAKDOWN_ROWS,
    FAULT_SUMMARY_EXAMPLES_PER_GROUP,
    FAULT_SUMMARY_GROUPS,
    FAULT_SUMMARY_SAMPLE_ROWS,
    FAULT_SUMMARY_SCAN_CAP,
    FRICTION_EXAMPLES_PER_GROUP,
    FRICTION_KINDS,
    FRICTION_SESSION_SCAN_CAP,
    FRICTION_THRESHOLDS,
    HEALTH_SESSION_SCAN_CAP,
    MAX_DIGEST_SESSIONS,
} from './types.js';
import type {
    CappedCount,
    FaultBreakdownRow,
    FaultDetail,
    FrictionGroup,
    FrictionKind,
    IssueDetail,
    IssueSummary,
    McpScopedData,
    SessionBundle,
    SessionDetail,
    SessionDigest,
    SessionFault,
    SessionFilter,
    SessionSummary,
    TimeRange,
} from './types.js';

// --- Limits private to the implementation ----------------------------------------

/** Issues considered when ranking top issues for a range. */
const HEALTH_ISSUE_CANDIDATES = 200;
const FAULT_ROWS_PER_SESSION = 200;
const SCREENS_PER_SESSION = 100;
const MAX_TIMELINE_SOURCE_EVENTS = 20_000;
/** Sessions whose timelines one call may read together. */
const MAX_BUNDLE_SESSIONS = 8;
/** Time allowed for fetching event files in one call, across all its sessions. */
const ARTIFACT_READ_BUDGET_MS = 9_000;
/**
 * How far around an instant a windowed read reaches. Much wider than the
 * lead-up shown, so the screen the user was on is usually inside it; the part
 * that must be there is the lead-up itself.
 */
const LEAD_UP_READ_BEFORE_MS = 300_000;
const LEAD_UP_READ_AFTER_MS = 10_000;
const LEAD_UP_NEEDED_BEFORE_MS = 40_000;

// --- Helpers --------------------------------------------------------------------

/** The project filter every query carries. `null` means "nothing can match". */
function projectScope(ctx: McpContext, column: AnyPgColumn, projectId?: string): SQL | null {
    if (ctx.allowedProjectIds.length === 0) return null;
    if (projectId !== undefined && !ctx.allowedProjectIds.includes(projectId)) return null;
    const allowed = inArray(column, [...ctx.allowedProjectIds]);
    return projectId === undefined ? allowed : and(allowed, eq(column, projectId))!;
}

/** Short stable stand-in for a raw device id. Scoped to the project so it cannot be joined across apps. */
export function hashDeviceId(projectId: string, deviceId: string | null | undefined): string | null {
    if (typeof deviceId !== 'string' || deviceId.trim() === '') return null;
    return createHash('sha256').update(`${projectId}\u0000${deviceId}`).digest('hex').slice(0, 12);
}

function iso(value: Date): string {
    return value.toISOString();
}

function number(value: unknown): number {
    const parsed = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function timestampKeySql(column: typeof sessions.startedAt | typeof issues.lastSeen): SQL<string> {
    return sql<string>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
}

const savedReplaySql = sql`(${sessions.replayAvailable} = true AND coalesce(${sessions.replayRetentionState}, 'saved') = 'saved')`;

/**
 * Same predicates as the dashboard's session archive
 * (`buildSessionArchiveBaseConditions` and `getSessionArchiveIssueFilterCondition`),
 * limited to the filters MCP offers.
 */
function sessionFilterConditions(ctx: McpContext, filter: SessionFilter): SQL[] | null {
    const scope = projectScope(ctx, sessions.projectId, filter.projectId);
    if (!scope) return null;
    const conditions: SQL[] = [
        scope,
        gte(sessions.startedAt, filter.range.from),
        lt(sessions.startedAt, filter.range.to),
    ];

    if (filter.platform === 'mobile') conditions.push(inArray(sessions.platform, ['ios', 'android']));
    else if (filter.platform) conditions.push(eq(sessions.platform, filter.platform));

    if (filter.appVersion) conditions.push(eq(sessions.appVersion, filter.appVersion));
    if (filter.userId) conditions.push(eq(sessions.userDisplayId, filter.userId));

    if (filter.country) {
        const country = filter.country.trim();
        conditions.push(
            /^[A-Za-z]{2}$/.test(country)
                ? eq(sessions.geoCountryCode, country.toUpperCase())
                : eq(sessions.geoCountry, country),
        );
    }

    if (filter.screenName) {
        conditions.push(sql`exists (
            select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
            where lower(screen_name) = lower(${filter.screenName.trim()})
        )`);
    }

    // Containment, served by the jsonb_path_ops GIN index. Key-existence tests are not offered.
    if (filter.customEventName) {
        conditions.push(sql`${sessions.events} @> ${JSON.stringify([{ name: filter.customEventName }])}::jsonb`);
    }

    switch (filter.issueType) {
        case 'crash':
            conditions.push(sql`coalesce(${sessionMetrics.crashCount}, 0) > 0`);
            break;
        case 'anr':
            conditions.push(sql`coalesce(${sessionMetrics.anrCount}, 0) > 0`);
            break;
        case 'error':
            conditions.push(sql`coalesce(${sessionMetrics.errorCount}, 0) > 0`);
            break;
        case 'rage_tap':
            conditions.push(sql`coalesce(${sessionMetrics.rageTapCount}, 0) > 3`);
            break;
        case 'dead_tap':
            conditions.push(sql`coalesce(${sessionMetrics.deadTapCount}, 0) > 0`);
            break;
        case 'slow_start':
            conditions.push(sql`coalesce(${sessionMetrics.appStartupTimeMs}, 0) > 3000`);
            break;
        default:
            break;
    }

    if (filter.hasReplay === true) conditions.push(savedReplaySql);
    else if (filter.hasReplay === false) conditions.push(sql`NOT ${savedReplaySql}`);

    return conditions;
}

const sessionSummaryColumns = {
    id: sessions.id,
    projectId: sessions.projectId,
    startedAt: sessions.startedAt,
    startedAtKey: timestampKeySql(sessions.startedAt),
    endedAt: sessions.endedAt,
    lastIngestActivityAt: sessions.lastIngestActivityAt,
    durationSeconds: sessions.durationSeconds,
    backgroundTimeSeconds: sessions.backgroundTimeSeconds,
    platform: sessions.platform,
    appVersion: sessions.appVersion,
    deviceModel: sessions.deviceModel,
    userDisplayId: sessions.userDisplayId,
    geoCountry: sessions.geoCountry,
    replayAvailable: sessions.replayAvailable,
    replayRetentionState: sessions.replayRetentionState,
    recordingDeleted: sessions.recordingDeleted,
    isReplayExpired: sessions.isReplayExpired,
    replayQuotaBillingExhausted: sessions.replayQuotaBillingExhausted,
    smartCaptureStatus: sessions.smartCaptureStatus,
    screenCount: sql<number>`coalesce(cardinality(${sessionMetrics.screensVisited}), 0)::int`,
    crashCount: sessionMetrics.crashCount,
    anrCount: sessionMetrics.anrCount,
    errorCount: sessionMetrics.errorCount,
    rageTapCount: sessionMetrics.rageTapCount,
    deadTapCount: sessionMetrics.deadTapCount,
};

interface SessionSummaryRow {
    id: string;
    projectId: string;
    startedAt: Date;
    startedAtKey: string;
    endedAt: Date | null;
    lastIngestActivityAt: Date | null;
    durationSeconds: number | null;
    backgroundTimeSeconds: number | null;
    platform: string | null;
    appVersion: string | null;
    deviceModel: string | null;
    userDisplayId: string | null;
    geoCountry: string | null;
    replayAvailable: boolean | null;
    replayRetentionState: string | null;
    recordingDeleted: boolean | null;
    isReplayExpired: boolean | null;
    replayQuotaBillingExhausted: boolean | null;
    smartCaptureStatus: string | null;
    screenCount: number | null;
    crashCount: number | null;
    anrCount: number | null;
    errorCount: number | null;
    rageTapCount: number | null;
    deadTapCount: number | null;
}

function durationOf(row: Pick<SessionSummaryRow, 'durationSeconds' | 'startedAt' | 'endedAt' | 'lastIngestActivityAt' | 'backgroundTimeSeconds'>): number {
    return Math.max(0, Math.round(resolveStoredOrDerivedSessionDurationSeconds({
        durationSeconds: row.durationSeconds,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        lastIngestActivityAt: row.lastIngestActivityAt,
        backgroundTimeSeconds: row.backgroundTimeSeconds,
    })));
}

function toSessionSummary(row: SessionSummaryRow): SessionSummary {
    return {
        id: row.id,
        projectId: row.projectId,
        startedAt: iso(row.startedAt),
        durationSeconds: durationOf(row),
        platform: row.platform,
        appVersion: row.appVersion,
        deviceModel: row.deviceModel,
        country: row.geoCountry,
        userId: row.userDisplayId,
        screenCount: number(row.screenCount),
        crashes: number(row.crashCount),
        anrs: number(row.anrCount),
        errors: number(row.errorCount),
        rageTaps: number(row.rageTapCount),
        deadTaps: number(row.deadTapCount),
        hasReplay: canOpenReplayFromSessionFields(row),
    };
}

function replayUnavailableReason(row: SessionSummaryRow): string | null {
    if (canOpenReplayFromSessionFields(row)) return null;
    if (row.recordingDeleted) return 'deleted';
    if (row.isReplayExpired) return 'expired';
    if (row.replayQuotaBillingExhausted) return 'quota_exhausted';
    if (row.smartCaptureStatus === 'discarded') return 'discarded_by_smart_capture';
    if (row.replayRetentionState && row.replayRetentionState !== 'saved') return 'not_saved';
    return 'not_recorded';
}

function sortedCounts(value: unknown, limit: number): Array<{ name: string; count: number }> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
        .map(([name, count]) => ({ name, count: number(count) }))
        .filter((entry) => entry.name.length > 0 && entry.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);
}

function customEventCounts(events: unknown, limit: number): Array<{ name: string; count: number }> {
    if (!Array.isArray(events)) return [];
    const counts = new Map<string, number>();
    for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        const record = event as Record<string, unknown>;
        const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
        if (type === 'gameplay' || type.startsWith('$')) continue;
        const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : (type !== 'custom' ? type : '');
        if (!name || name.startsWith('$')) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);
}

/** Days (`YYYY-MM-DD`, UTC) covered by a range, for summing `issues.daily_events`. */
function eventsInRange(dailyEvents: unknown, range: TimeRange): number {
    if (!dailyEvents || typeof dailyEvents !== 'object') return 0;
    const fromDay = iso(range.from).slice(0, 10);
    const toDay = iso(new Date(range.to.getTime() - 1)).slice(0, 10);
    let total = 0;
    for (const [day, count] of Object.entries(dailyEvents as Record<string, unknown>)) {
        if (day >= fromDay && day <= toDay) total += number(count);
    }
    return total;
}

const issueSummaryColumns = {
    id: issues.id,
    projectId: issues.projectId,
    shortId: issues.shortId,
    issueType: issues.issueType,
    title: issues.title,
    subtitle: issues.subtitle,
    culprit: issues.culprit,
    screenName: issues.screenName,
    status: issues.status,
    priority: issues.priority,
    isHandled: issues.isHandled,
    firstSeen: issues.firstSeen,
    lastSeen: issues.lastSeen,
    lastSeenKey: timestampKeySql(issues.lastSeen),
    eventCount: issues.eventCount,
    userCount: issues.userCount,
    events24h: issues.events24h,
};

interface IssueSummaryRow {
    id: string;
    projectId: string;
    shortId: string;
    issueType: string;
    title: string;
    subtitle: string | null;
    culprit: string | null;
    screenName: string | null;
    status: string;
    priority: string | null;
    isHandled: boolean | null;
    firstSeen: Date;
    lastSeen: Date;
    lastSeenKey: string;
    eventCount: bigint | number;
    userCount: number;
    events24h: number;
}

function toIssueSummary(row: IssueSummaryRow): IssueSummary {
    return {
        id: row.id,
        projectId: row.projectId,
        shortId: row.shortId,
        type: row.issueType,
        title: row.title,
        subtitle: row.subtitle,
        culprit: row.culprit,
        screenName: row.screenName,
        status: row.status,
        priority: row.priority,
        isHandled: row.isHandled,
        firstSeen: iso(row.firstSeen),
        lastSeen: iso(row.lastSeen),
        eventCount: number(row.eventCount),
        userCount: number(row.userCount),
        events24h: number(row.events24h),
    };
}

/** The dashboard hides ANR issues that are really web long-task markers. Same predicate as `routes/issues.ts`. */
const notWebLongTaskIssue = sql`NOT (
    ${issues.issueType} = 'anr'
    AND lower(coalesce(${issues.sampleStackTrace}, '')) LIKE '%main_thread_long_task%'
)`;

function metadataText(metadata: unknown, ...keys: string[]): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    for (const key of keys) {
        const value = (metadata as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/**
 * `(select count(*) from (select 1 from <table> where ... limit cap + 1))`
 * as one scalar subquery. The table name is one of three literals; ids and
 * times are bind parameters.
 */
function cappedFaultCountSql(ctx: McpContext, table: 'crashes' | 'anrs' | 'errors', projectId: string, range: TimeRange): SQL<number> {
    const allowed = sql.join(ctx.allowedProjectIds.map((id) => sql`${id}::uuid`), sql`, `);
    return sql<number>`(
        select count(*)::int from (
            select 1 from ${sql.raw(table)} f
            where f.project_id in (${allowed})
              and f.project_id = ${projectId}::uuid
              and f."timestamp" >= ${range.from.toISOString()}::timestamp
              and f."timestamp" < ${range.to.toISOString()}::timestamp
            limit ${COUNT_CAP + 1}
        ) capped_faults
    )`;
}

function toCappedCount(value: unknown): CappedCount {
    const n = number(value);
    return n > COUNT_CAP ? { count: COUNT_CAP, capped: true } : { count: n, capped: false };
}

// --- Implementation -------------------------------------------------------------

export interface ScopedDataOptions {
    artifacts: ArtifactReader;
}

export function createScopedData(db: McpDb, options: ScopedDataOptions): McpScopedData {
    /** `inner` is a select already limited to cap + 1 rows. */
    async function cappedCount(inner: { as(alias: string): any }): Promise<CappedCount> {
        const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(inner.as('capped'));
        return toCappedCount(row?.n);
    }

    function countSessions(conditions: SQL[]): Promise<CappedCount> {
        return cappedCount(
            db
                .select({ one: sql<number>`1`.as('one') })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(...conditions))
                .limit(COUNT_CAP + 1),
        );
    }

    async function loadSessionRows(ctx: McpContext, sessionIds: readonly string[]) {
        const scope = projectScope(ctx, sessions.projectId);
        if (!scope || sessionIds.length === 0) return [];
        return db
            .select({
                ...sessionSummaryColumns,
                status: sessions.status,
                osVersion: sessions.osVersion,
                sdkVersion: sessions.sdkVersion,
                deviceId: sessions.deviceId,
                anonymousHash: sessions.anonymousHash,
                geoCity: sessions.geoCity,
                geoCountryCode: sessions.geoCountryCode,
                rawEventsDeletedAt: sessions.rawEventsDeletedAt,
                events: sessions.events,
                screensVisited: sessionMetrics.screensVisited,
                totalEvents: sessionMetrics.totalEvents,
                touchCount: sessionMetrics.touchCount,
                scrollCount: sessionMetrics.scrollCount,
                gestureCount: sessionMetrics.gestureCount,
                inputCount: sessionMetrics.inputCount,
                customEventCount: sessionMetrics.customEventCount,
                apiTotalCount: sessionMetrics.apiTotalCount,
                apiErrorCount: sessionMetrics.apiErrorCount,
                apiAvgResponseMs: sessionMetrics.apiAvgResponseMs,
                appStartupTimeMs: sessionMetrics.appStartupTimeMs,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
            .where(and(inArray(sessions.id, [...sessionIds]), scope))
            .limit(sessionIds.length);
    }

    type SessionRow = Awaited<ReturnType<typeof loadSessionRows>>[number];

    async function loadSessionRow(ctx: McpContext, sessionId: string): Promise<SessionRow | null> {
        return (await loadSessionRows(ctx, [sessionId]))[0] ?? null;
    }

    function toSessionDetail(row: SessionRow): SessionDetail {
        const screens = Array.isArray(row.screensVisited) ? row.screensVisited.filter((screen): screen is string => typeof screen === 'string') : [];
        return {
            ...toSessionSummary(row),
            endedAt: row.endedAt ? iso(row.endedAt) : null,
            status: row.status,
            osVersion: row.osVersion,
            sdkVersion: row.sdkVersion,
            deviceHash: hashDeviceId(row.projectId, row.deviceId),
            isAnonymous: !row.userDisplayId,
            city: row.geoCity,
            countryCode: row.geoCountryCode,
            screens: screens.slice(0, SCREENS_PER_SESSION),
            screensTruncated: screens.length > SCREENS_PER_SESSION,
            metrics: {
                totalEvents: number(row.totalEvents),
                touches: number(row.touchCount),
                scrolls: number(row.scrollCount),
                gestures: number(row.gestureCount),
                inputs: number(row.inputCount),
                customEvents: number(row.customEventCount),
                apiTotal: number(row.apiTotalCount),
                apiErrors: number(row.apiErrorCount),
                apiAvgResponseMs: Math.round(number(row.apiAvgResponseMs)),
                appStartupMs: row.appStartupTimeMs === null || row.appStartupTimeMs === undefined ? null : Math.round(number(row.appStartupTimeMs)),
            },
            replayUnavailableReason: replayUnavailableReason(row),
        };
    }

    /**
     * Sessions with their timelines, for one id or a few. Two round trips,
     * side by side, however many ids: the session rows, and their crash, ANR
     * and error rows as one UNION ALL (each branch carries the project filter
     * itself, so it does not wait for the sessions). Then one artifact read
     * per session that was found, all of them side by side and inside one
     * time budget: a session whose files are slow to fetch comes back marked
     * partial instead of failing the call.
     *
     * `aroundMs` narrows a session's read to the event files near one instant
     * (the lead-up to a crash), which is a handful of files however long the
     * session ran.
     */
    async function loadBundles(ctx: McpContext, sessionIds: readonly string[], aroundMs?: ReadonlyMap<string, number>): Promise<Map<string, SessionBundle>> {
        const bundles = new Map<string, SessionBundle>();
        const ids = [...new Set(sessionIds)].slice(0, MAX_BUNDLE_SESSIONS);
        if (ids.length === 0 || ctx.allowedProjectIds.length === 0) return bundles;

        const nullText = sql<string | null>`null::text`;
        const faultsQuery = unionAll(
            db
                .select({
                    kind: sql<string>`'crash'`.as('kind'),
                    id: crashes.id,
                    sessionId: sql<string | null>`${crashes.sessionId}`.as('session_id'),
                    timestamp: crashes.timestamp,
                    name: sql<string | null>`${crashes.exceptionName}`.as('name'),
                    message: sql<string | null>`${crashes.reason}`.as('message'),
                    stack: sql<string | null>`${crashes.stackTrace}`.as('stack'),
                    screenName: nullText.as('screen_name'),
                    durationMs: sql<number | null>`null::int`.as('duration_ms'),
                    deviceStack: nullText.as('device_stack'),
                })
                .from(crashes)
                .where(and(projectScope(ctx, crashes.projectId)!, inArray(crashes.sessionId, ids)))
                .orderBy(desc(crashes.timestamp))
                .limit(FAULT_ROWS_PER_SESSION * ids.length),
            db
                .select({
                    kind: sql<string>`'anr'`.as('kind'),
                    id: anrs.id,
                    sessionId: sql<string | null>`${anrs.sessionId}`.as('session_id'),
                    timestamp: anrs.timestamp,
                    name: nullText.as('name'),
                    message: nullText.as('message'),
                    stack: sql<string | null>`${anrs.threadState}`.as('stack'),
                    screenName: nullText.as('screen_name'),
                    durationMs: sql<number | null>`${anrs.durationMs}`.as('duration_ms'),
                    // The only part of the ANR's device metadata the timeline reads.
                    deviceStack: sql<string | null>`(${anrs.deviceMetadata}->>'stack')`.as('device_stack'),
                })
                .from(anrs)
                .where(and(projectScope(ctx, anrs.projectId)!, inArray(anrs.sessionId, ids)))
                .orderBy(desc(anrs.timestamp))
                .limit(FAULT_ROWS_PER_SESSION * ids.length),
            db
                .select({
                    kind: sql<string>`'error'`.as('kind'),
                    id: errors.id,
                    sessionId: sql<string | null>`${errors.sessionId}`.as('session_id'),
                    timestamp: errors.timestamp,
                    name: sql<string | null>`${errors.errorName}`.as('name'),
                    message: sql<string | null>`${errors.message}`.as('message'),
                    stack: sql<string | null>`${errors.stack}`.as('stack'),
                    screenName: sql<string | null>`${errors.screenName}`.as('screen_name'),
                    durationMs: sql<number | null>`null::int`.as('duration_ms'),
                    deviceStack: nullText.as('device_stack'),
                })
                .from(errors)
                .where(and(projectScope(ctx, errors.projectId)!, inArray(errors.sessionId, ids)))
                .orderBy(desc(errors.timestamp))
                .limit(FAULT_ROWS_PER_SESSION * ids.length),
        );
        const [rows, faultRows] = await Promise.all([loadSessionRows(ctx, ids), faultsQuery]);

        const readStartedAt = performance.now();
        const loaded = await Promise.all(rows.map(async (row): Promise<SessionBundle> => {
            const own = faultRows.filter((fault) => fault.sessionId === row.id);
            const crashRows = own
                .filter((fault) => fault.kind === 'crash')
                .map((fault) => ({ id: fault.id, timestamp: fault.timestamp, exceptionName: fault.name, reason: fault.message, stackTrace: fault.stack }));
            const anrRows = filterDisplayAnrs(
                row.platform,
                own
                    .filter((fault) => fault.kind === 'anr')
                    .map((fault) => ({
                        id: fault.id,
                        timestamp: fault.timestamp,
                        durationMs: fault.durationMs === null ? null : number(fault.durationMs),
                        threadState: fault.stack,
                        deviceMetadata: fault.deviceStack ? { stack: fault.deviceStack } : null,
                    })),
            );
            const errorRows = own
                .filter((fault) => fault.kind === 'error')
                .map((fault) => ({
                    id: fault.id,
                    timestamp: fault.timestamp,
                    errorType: null,
                    errorName: fault.name,
                    message: fault.message,
                    stack: fault.stack,
                    screenName: fault.screenName,
                }));

            // The recorded event stream. The project id passed on is the one read
            // from the session row, which the grant filter already matched.
            const artifactEvents: unknown[] = [];
            let batches = 0;
            let capReached = false;
            const ref = { projectId: row.projectId, sessionId: row.id };
            const around = aroundMs?.get(row.id);
            const window = around === undefined
                ? undefined
                : { fromMs: around - LEAD_UP_READ_BEFORE_MS, toMs: around + LEAD_UP_READ_AFTER_MS, needFromMs: around - LEAD_UP_NEEDED_BEFORE_MS };
            if (!row.rawEventsDeletedAt) {
                // What is left of the shared budget, so the sessions together stay inside it.
                const budgetMs = Math.max(0, ARTIFACT_READ_BUDGET_MS - (performance.now() - readStartedAt));
                for await (const batch of options.artifacts.readEventBatches(ref, { signal: ctx.signal, window, budgetMs })) {
                    batches += 1;
                    if (batch.capReached) capReached = true;
                    for (const event of batch.events) {
                        if (artifactEvents.length >= MAX_TIMELINE_SOURCE_EVENTS) {
                            capReached = true;
                            break;
                        }
                        artifactEvents.push(event);
                    }
                    if (capReached) break;
                }
            }

            // A windowed read that found nothing says only that the window is
            // empty; ask whether the session has a recorded stream at all.
            let hasStream = batches > 0;
            if (!hasStream && window && !row.rawEventsDeletedAt && options.artifacts.hasEvents) {
                hasStream = await options.artifacts.hasEvents(ref);
            }

            const sessionStartMs = row.startedAt.getTime();
            const durationSeconds = durationOf(row);
            const sessionEndMs = row.endedAt?.getTime()
                ?? row.lastIngestActivityAt?.getTime()
                ?? (sessionStartMs + durationSeconds * 1000);

            const allEvents = [...artifactEvents, ...selectExtraCustomSessionEvents(artifactEvents, row.events)];
            const { normalizedEvents, coerceToEpochMs } = normalizeTimelineEvents(allEvents, sessionStartMs, sessionEndMs);
            const faultEvents = buildFaultEvents(crashRows, anrRows, errorRows, sessionStartMs, coerceToEpochMs);

            const faults: SessionFault[] = [
                ...crashRows.map((fault) => ({ id: fault.id, type: 'crash' as const, occurredAtMs: fault.timestamp.getTime(), name: fault.exceptionName || 'Crash', message: fault.reason, stackTrace: fault.stackTrace, screenName: null, durationMs: null })),
                ...anrRows.map((fault) => ({
                    id: fault.id,
                    type: 'anr' as const,
                    occurredAtMs: fault.timestamp.getTime(),
                    name: 'Application Not Responding',
                    message: fault.durationMs === null ? null : `Main thread blocked for ${fault.durationMs} ms`,
                    stackTrace: resolveAnrStackTrace({ threadState: fault.threadState, deviceMetadata: fault.deviceMetadata }),
                    screenName: null,
                    durationMs: fault.durationMs,
                })),
                ...errorRows.map((fault) => ({ id: fault.id, type: 'error' as const, occurredAtMs: fault.timestamp.getTime(), name: fault.errorName || 'Error', message: fault.message, stackTrace: fault.stack, screenName: fault.screenName, durationMs: null })),
            ].sort((left, right) => left.occurredAtMs - right.occurredAtMs);

            return {
                session: toSessionDetail(row),
                customEvents: customEventCounts(row.events, 20),
                faults,
                timeline: {
                    sessionId: row.id,
                    projectId: row.projectId,
                    sessionStartMs,
                    durationSeconds,
                    events: mergeEventsWithFaults(normalizedEvents, faultEvents),
                    eventStream: row.rawEventsDeletedAt ? 'expired' : capReached ? 'partial' : hasStream ? 'ok' : 'none',
                },
            };
        }));
        for (const bundle of loaded) bundles.set(bundle.session.id, bundle);
        return bundles;
    }

    return {
        async listProjects(ctx) {
            const scope = projectScope(ctx, projects.id);
            if (!scope) return [];
            const rows = await db
                .select({
                    id: projects.id,
                    name: projects.name,
                    platform: projects.platform,
                    bundleId: projects.bundleId,
                    packageName: projects.packageName,
                    webDomain: projects.webDomain,
                })
                .from(projects)
                .where(and(scope, eq(projects.teamId, ctx.teamId), sql`${projects.deletedAt} IS NULL`))
                .orderBy(projects.name, projects.id)
                .limit(ctx.allowedProjectIds.length);

            return rows.map((row) => {
                const platforms = new Set<string>();
                if (row.platform) platforms.add(row.platform);
                if (row.bundleId) platforms.add('ios');
                if (row.packageName) platforms.add('android');
                if (row.webDomain) platforms.add('web');
                return { id: row.id, name: row.name, platforms: [...platforms].sort() };
            });
        },

        async getProjectHealth(ctx, input) {
            const sessionScope = projectScope(ctx, sessions.projectId, input.projectId);
            if (!sessionScope) return null;
            const { range } = input;

            // Query 1: session totals over the most recent rows in the range (at
            // most the scan cap), plus the three capped fault counts as scalar
            // subqueries, so the whole summary is one round trip.
            const scanned = db
                .select({
                    crashCount: sessionMetrics.crashCount,
                    anrCount: sessionMetrics.anrCount,
                    errorCount: sessionMetrics.errorCount,
                })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(sessionScope, gte(sessions.startedAt, range.from), lt(sessions.startedAt, range.to)))
                .orderBy(desc(sessions.startedAt))
                .limit(HEALTH_SESSION_SCAN_CAP + 1)
                .as('scanned');
            const totalsQuery = db
                .select({
                    total: sql<number>`count(*)::int`,
                    withCrash: sql<number>`count(*) filter (where coalesce(${scanned.crashCount}, 0) > 0)::int`,
                    withAnr: sql<number>`count(*) filter (where coalesce(${scanned.anrCount}, 0) > 0)::int`,
                    withError: sql<number>`count(*) filter (where coalesce(${scanned.errorCount}, 0) > 0)::int`,
                    crashes: cappedFaultCountSql(ctx, 'crashes', input.projectId, range),
                    anrs: cappedFaultCountSql(ctx, 'anrs', input.projectId, range),
                    errors: cappedFaultCountSql(ctx, 'errors', input.projectId, range),
                })
                .from(scanned);

            // Query 2: issues seen during the range, ranked by their events inside it.
            const issuesQuery = db
                .select({ ...issueSummaryColumns, dailyEvents: issues.dailyEvents })
                .from(issues)
                .where(
                    and(
                        projectScope(ctx, issues.projectId, input.projectId)!,
                        notWebLongTaskIssue,
                        gte(issues.lastSeen, range.from),
                        lt(issues.firstSeen, range.to),
                    ),
                )
                .orderBy(desc(issues.lastSeen), desc(issues.id))
                .limit(HEALTH_ISSUE_CANDIDATES);

            const [[totals], issueRows] = await Promise.all([totalsQuery, issuesQuery]);
            const topIssues = issueRows
                .map((row) => ({ ...toIssueSummary(row), eventsInRange: eventsInRange(row.dailyEvents, range) }))
                .sort((a, b) => b.eventsInRange - a.eventsInRange || b.eventCount - a.eventCount || a.id.localeCompare(b.id))
                .slice(0, 5);

            const scannedTotal = number(totals?.total);
            const capped = scannedTotal > HEALTH_SESSION_SCAN_CAP;
            const withCrash = number(totals?.withCrash);
            return {
                projectId: input.projectId,
                sessions: { count: capped ? HEALTH_SESSION_SCAN_CAP : scannedTotal, capped },
                sessionsWithCrash: withCrash,
                sessionsWithAnr: number(totals?.withAnr),
                sessionsWithError: number(totals?.withError),
                crashFreeSessionRate: scannedTotal > 0 ? Math.round((1 - withCrash / scannedTotal) * 10_000) / 10_000 : null,
                crashes: toCappedCount(totals?.crashes),
                anrs: toCappedCount(totals?.anrs),
                errors: toCappedCount(totals?.errors),
                topIssues,
            };
        },

        async findFriction(ctx, filter) {
            const scope = projectScope(ctx, sessions.projectId, filter.projectId);
            if (!scope) return null;
            const { range } = filter;
            const previousFrom = new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime()));

            // The sessions of the range and of the equal period before it, newest
            // first, each with a flag per friction kind computed from its counters.
            // Read once (see query 1 below).
            const conditions: SQL[] = [scope, gte(sessions.startedAt, previousFrom), lt(sessions.startedAt, range.to)];
            if (filter.platform === 'mobile') conditions.push(inArray(sessions.platform, ['ios', 'android']));
            else if (filter.platform) conditions.push(eq(sessions.platform, filter.platform));
            if (filter.appVersion) conditions.push(eq(sessions.appVersion, filter.appVersion));
            if (filter.screenName) {
                conditions.push(sql`exists (
                    select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
                    where lower(screen_name) = lower(${filter.screenName.trim()})
                )`);
            }
            const T = FRICTION_THRESHOLDS;
            const hadError = sql`(coalesce(${sessionMetrics.errorCount}, 0) > 0 or coalesce(${sessionMetrics.apiErrorCount}, 0) > 0)`;
            const flagSql: Record<FrictionKind, SQL> = {
                rage_taps: sql`coalesce(${sessionMetrics.rageTapCount}, 0) > ${T.rageTapsMoreThan}`,
                dead_taps: sql`coalesce(${sessionMetrics.deadTapCount}, 0) >= ${T.deadTapsAtLeast}`,
                api_errors: sql`coalesce(${sessionMetrics.apiErrorCount}, 0) >= ${T.apiErrorsAtLeast}`,
                slow_start: sql`coalesce(${sessionMetrics.appStartupTimeMs}, 0) > ${T.slowStartMs}`,
                slow_api: sql`coalesce(${sessionMetrics.apiAvgResponseMs}, 0) > ${T.slowApiAvgMs}`,
                error_burst: sql`coalesce(${sessionMetrics.errorCount}, 0) >= ${T.errorBurstAtLeast}`,
                crash: sql`coalesce(${sessionMetrics.crashCount}, 0) > 0`,
                anr: sql`coalesce(${sessionMetrics.anrCount}, 0) > 0`,
                short_session_after_error: sql`(${sessions.durationSeconds} is not null and ${sessions.durationSeconds} < ${T.shortSessionSeconds} and ${hadError})`,
            };
            const flagColumn = (kind: FrictionKind) => `k_${kind}`;
            const base = db
                .select({
                    id: sessions.id,
                    isCurrent: sql<boolean>`(${sessions.startedAt} >= ${range.from.toISOString()}::timestamp)`.as('is_current'),
                    appVersion: sessions.appVersion,
                    platform: sessions.platform,
                    // The person key of services/personIdentity.ts, without its device-to-user merge.
                    personKey: sql<string>`coalesce(
                        nullif(trim(${sessions.userDisplayId}), ''),
                        nullif(trim(${sessions.anonymousHash}), ''),
                        nullif(trim(${sessions.anonymousDisplayId}), ''),
                        nullif(trim(${sessions.deviceId}), ''),
                        ${sessions.id}
                    )`.as('person_key'),
                    ...Object.fromEntries(FRICTION_KINDS.map((kind) => [flagColumn(kind), sql<boolean>`(${flagSql[kind]})`.as(flagColumn(kind))])),
                })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(...conditions))
                .orderBy(desc(sessions.startedAt))
                .limit(FRICTION_SESSION_SCAN_CAP + 1);
            const flag = (kind: FrictionKind) => sql.raw(`"base"."${flagColumn(kind)}"`);
            const current = sql.raw('"base"."is_current"');
            const named = (kind: string, suffix = '') => sql.raw(`"${kind}${suffix}"`);

            // Query 1: one read of those sessions feeds three results, each a
            // branch of one UNION ALL carrying its rows as JSON: the totals for
            // both periods with distinct people, the affected sessions per app
            // version and platform, and example sessions per kind picked by a
            // stable hash of the session id (not "worst first").
            const kindList = sql.join(FRICTION_KINDS.map((kind) => sql`case when ${flag(kind)} then ${kind}::text end`), sql`, `);
            const totalColumns = sql.join(
                FRICTION_KINDS.flatMap((kind) => [
                    sql`count(*) filter (where ${current} and ${flag(kind)})::int as ${named(kind, '__current')}`,
                    sql`count(*) filter (where not ${current} and ${flag(kind)})::int as ${named(kind, '__previous')}`,
                    sql`count(distinct "base"."person_key") filter (where ${current} and ${flag(kind)})::int as ${named(kind, '__users')}`,
                ]),
                sql`, `,
            );
            const versionColumns = sql.join(FRICTION_KINDS.map((kind) => sql`count(*) filter (where ${flag(kind)})::int as ${named(kind)}`), sql`, `);
            const scanQuery = db
                .select({ part: sql<string>`r.part`, data: sql<Record<string, unknown>>`r.data` })
                .from(sql`(
                    with base as materialized (${base})
                    select 'totals'::text as part, to_jsonb(t) as data from (
                        select count(*)::int as "scanned",
                               count(*) filter (where ${current})::int as "current",
                               count(*) filter (where not ${current})::int as "previous",
                               ${totalColumns}
                        from base
                    ) t
                    union all
                    select 'version'::text, to_jsonb(v) from (
                        select "base"."app_version" as "appVersion", "base"."platform" as "platform", ${versionColumns}
                        from base where ${current}
                        group by "base"."app_version", "base"."platform"
                        limit 200
                    ) v
                    union all
                    select 'example'::text, to_jsonb(e) from (
                        select ranked.session_id as "id", ranked.kind as "kind" from (
                            select exploded.session_id, exploded.kind,
                                   row_number() over (partition by exploded.kind order by md5(exploded.session_id) collate "C", exploded.session_id) as position
                            from (
                                select "base"."id" as session_id, unnest(array_remove(array[${kindList}], null)) as kind
                                from base where ${current}
                            ) exploded
                        ) ranked
                        where ranked.position <= ${FRICTION_EXAMPLES_PER_GROUP}
                        limit ${FRICTION_KINDS.length * FRICTION_EXAMPLES_PER_GROUP}
                    ) e
                ) as r`);

            // Query 2: where error rows concentrate. Errors are per-event rows
            // with a screen, unlike the per-session counters above.
            const errorConditions: SQL[] = [
                projectScope(ctx, errors.projectId, filter.projectId)!,
                gte(errors.timestamp, range.from),
                lt(errors.timestamp, range.to),
            ];
            if (filter.appVersion) errorConditions.push(eq(errors.appVersion, filter.appVersion));
            if (filter.screenName) errorConditions.push(sql`lower(${errors.screenName}) = lower(${filter.screenName.trim()})`);
            const recentErrors = db
                .select({ screenName: errors.screenName })
                .from(errors)
                .where(and(...errorConditions))
                .orderBy(desc(errors.timestamp))
                .limit(COUNT_CAP)
                .as('recent_errors');
            const errorScreensQuery = db
                .select({ screenName: sql<string | null>`"recent_errors"."screen_name"`, events: sql<number>`count(*)::int` })
                .from(recentErrors)
                .groupBy(sql`"recent_errors"."screen_name"`)
                .orderBy(sql`count(*) desc`, sql`"recent_errors"."screen_name"`)
                .limit(50);

            // Query 3: the issues behind the crash, ANR and error groups.
            const issuesQuery = db
                .select({ ...issueSummaryColumns, dailyEvents: issues.dailyEvents })
                .from(issues)
                .where(
                    and(
                        projectScope(ctx, issues.projectId, filter.projectId)!,
                        notWebLongTaskIssue,
                        inArray(issues.issueType, ['crash', 'anr', 'error']),
                        gte(issues.lastSeen, range.from),
                        lt(issues.firstSeen, range.to),
                    ),
                )
                .orderBy(desc(issues.lastSeen), desc(issues.id))
                .limit(HEALTH_ISSUE_CANDIDATES);

            const [scanRows, errorScreenRows, issueRows] = await Promise.all([scanQuery, errorScreensQuery, issuesQuery]);
            // jsonb arrives parsed from node-postgres and as text from some drivers.
            const part = (name: string) => scanRows
                .filter((row) => row.part === name)
                .map((row) => (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>);
            const totalsRecord = part('totals')[0] ?? {};
            const versionRows = part('version');
            const exampleRows = part('example') as Array<{ id: string; kind: string }>;

            const groups: FrictionGroup[] = FRICTION_KINDS.map((kind) => ({
                kind,
                sessionsAffected: number(totalsRecord[`${kind}__current`]),
                previousSessionsAffected: number(totalsRecord[`${kind}__previous`]),
                usersAffected: number(totalsRecord[`${kind}__users`]),
                versions: versionRows
                    .map((row) => ({
                        appVersion: typeof row.appVersion === 'string' ? row.appVersion : null,
                        platform: typeof row.platform === 'string' ? row.platform : null,
                        sessions: number(row[kind]),
                    }))
                    .filter((row) => row.sessions > 0)
                    .sort((a, b) => b.sessions - a.sessions || String(a.appVersion).localeCompare(String(b.appVersion)) || String(a.platform).localeCompare(String(b.platform)))
                    .slice(0, 5),
                exampleSessionIds: exampleRows.filter((row) => row.kind === kind).map((row) => row.id),
            }))
                .filter((group) => group.sessionsAffected > 0)
                .sort((a, b) => b.sessionsAffected - a.sessionsAffected || FRICTION_KINDS.indexOf(a.kind) - FRICTION_KINDS.indexOf(b.kind));

            return {
                projectId: filter.projectId,
                sessionsInRange: number(totalsRecord.current),
                previousSessionsInRange: number(totalsRecord.previous),
                capped: number(totalsRecord.scanned) > FRICTION_SESSION_SCAN_CAP,
                previousRangeComplete: number(totalsRecord.scanned) <= FRICTION_SESSION_SCAN_CAP,
                // Newest first: once a session of the previous period was reached, the range was read whole.
                rangeComplete: number(totalsRecord.scanned) <= FRICTION_SESSION_SCAN_CAP || number(totalsRecord.previous) > 0,
                groups,
                errorScreens: errorScreenRows.slice(0, 5).map((row) => ({ screenName: row.screenName, events: number(row.events) })),
                errorEventsCounted: errorScreenRows.reduce((sum, row) => sum + number(row.events), 0),
                topIssues: issueRows
                    .map((row) => ({ ...toIssueSummary(row), eventsInRange: eventsInRange(row.dailyEvents, range) }))
                    .sort((a, b) => b.eventsInRange - a.eventsInRange || b.eventCount - a.eventCount || a.id.localeCompare(b.id))
                    .slice(0, 12),
            };
        },

        async searchSessions(ctx, filter, page) {
            const conditions = sessionFilterConditions(ctx, filter);
            if (!conditions) return null;

            const pageConditions = [...conditions];
            if (page.after) {
                pageConditions.push(
                    sql`(${sessions.startedAt}, ${sessions.id}) < (${page.after.startedAtKey}::timestamp, ${page.after.id})`,
                );
            }
            const pageQuery: Promise<SessionSummaryRow[]> = db
                .select(sessionSummaryColumns)
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(...pageConditions))
                .orderBy(desc(sessions.startedAt), desc(sessions.id))
                .limit(page.limit + 1);

            // Two independent reads, one round trip each.
            const [rows, total] = await Promise.all([pageQuery, countSessions(conditions)]);
            const kept = rows.slice(0, page.limit);
            return {
                sessions: kept.map(toSessionSummary),
                keys: kept.map((row) => ({ startedAtKey: row.startedAtKey, id: row.id })),
                hasMore: rows.length > page.limit,
                total,
            };
        },

        async sampleSessions(ctx, filter, sample) {
            const conditions = sessionFilterConditions(ctx, filter);
            if (!conditions) return null;
            const population = await countSessions(conditions);
            if (population.count === 0) return { sessions: [], population };

            // A session's position in the sample is a hash of its id and the seed.
            // The `size` smallest hashes are a uniform sample without replacement.
            // Rows above a hash threshold are discarded before the sort, so only a
            // few multiples of `size` rows are ever sorted, not the whole range.
            const hash = sql<string>`(md5(${sessions.id} || ':' || ${String(sample.seed)}) collate "C")`;
            let fraction = Math.min(1, (sample.size * 4) / population.count);
            let rows: SessionSummaryRow[] = [];
            for (let attempt = 0; attempt < 4; attempt += 1) {
                const sampleConditions = [...conditions];
                if (fraction < 1) {
                    const threshold = Math.floor(fraction * 0xffffffff).toString(16).padStart(8, '0');
                    sampleConditions.push(sql`${hash} < ${threshold}`);
                }
                rows = await db
                    .select(sessionSummaryColumns)
                    .from(sessions)
                    .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                    .where(and(...sampleConditions))
                    .orderBy(hash, sessions.id)
                    .limit(sample.size);
                if (rows.length >= sample.size || fraction >= 1) break;
                fraction = attempt === 2 ? 1 : Math.min(1, fraction * 4);
            }

            return { sessions: rows.map(toSessionSummary), population };
        },

        async getSession(ctx, sessionId) {
            const row = await loadSessionRow(ctx, sessionId);
            return row ? toSessionDetail(row) : null;
        },

        async getSessionDigests(ctx, sessionIds) {
            const scope = projectScope(ctx, sessions.projectId);
            const ids = [...new Set(sessionIds)].slice(0, MAX_DIGEST_SESSIONS);
            if (!scope || ids.length === 0) return [];

            // Query 1: the sessions.
            const sessionsQuery = db
                .select({
                    ...sessionSummaryColumns,
                    events: sessions.events,
                    screensVisited: sessionMetrics.screensVisited,
                    apiErrorCount: sessionMetrics.apiErrorCount,
                })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(scope, inArray(sessions.id, ids)))
                .limit(ids.length);

            // Query 2: their errors, crashes and ANRs grouped by session, as one
            // UNION ALL. Each branch carries the project filter itself, so it can
            // run alongside query 1 instead of waiting for it.
            const faultsQuery = unionAll(
                db
                    .select({
                        sessionId: sql<string | null>`${crashes.sessionId}`.as('session_id'),
                        kind: sql<string>`'crash'`.as('kind'),
                        name: sql<string>`${crashes.exceptionName}`.as('name'),
                        message: sql<string>`left(coalesce(${crashes.reason}, ''), 200)`.as('message'),
                        count: sql<number>`count(*)::int`.as('count'),
                    })
                    .from(crashes)
                    .where(and(projectScope(ctx, crashes.projectId)!, inArray(crashes.sessionId, ids)))
                    .groupBy(crashes.sessionId, crashes.exceptionName, sql`left(coalesce(${crashes.reason}, ''), 200)`)
                    .limit(ids.length * 10),
                db
                    .select({
                        sessionId: sql<string | null>`${anrs.sessionId}`.as('session_id'),
                        kind: sql<string>`'anr'`.as('kind'),
                        name: sql<string>`'ANR'`.as('name'),
                        message: sql<string>`''`.as('message'),
                        count: sql<number>`count(*)::int`.as('count'),
                    })
                    .from(anrs)
                    .where(and(projectScope(ctx, anrs.projectId)!, inArray(anrs.sessionId, ids)))
                    .groupBy(anrs.sessionId)
                    .limit(ids.length),
                db
                    .select({
                        sessionId: sql<string | null>`${errors.sessionId}`.as('session_id'),
                        kind: sql<string>`'error'`.as('kind'),
                        name: sql<string>`${errors.errorName}`.as('name'),
                        message: sql<string>`left(${errors.message}, 200)`.as('message'),
                        count: sql<number>`count(*)::int`.as('count'),
                    })
                    .from(errors)
                    .where(and(projectScope(ctx, errors.projectId)!, inArray(errors.sessionId, ids)))
                    .groupBy(errors.sessionId, errors.errorName, sql`left(${errors.message}, 200)`)
                    .limit(ids.length * 40),
            );

            const [rows, faultRows] = await Promise.all([sessionsQuery, faultsQuery]);
            if (rows.length === 0) return [];

            const topErrors = new Map<string, SessionDigest['topErrors']>();
            for (const row of faultRows) {
                if (!row.sessionId || (row.kind !== 'crash' && row.kind !== 'anr' && row.kind !== 'error')) continue;
                const list = topErrors.get(row.sessionId) ?? [];
                list.push({ kind: row.kind, name: row.name, message: row.message ?? '', count: number(row.count) });
                topErrors.set(row.sessionId, list);
            }

            const kindRank = { crash: 0, anr: 1, error: 2 } as const;
            const byId = new Map(rows.map((row) => [row.id, row]));
            // Same order as asked for, so a cursor over the id list is stable.
            return ids.flatMap((id) => {
                const row = byId.get(id);
                if (!row) return [];
                const screens = Array.isArray(row.screensVisited) ? row.screensVisited.filter((screen): screen is string => typeof screen === 'string') : [];
                const digest: SessionDigest = {
                    id: row.id,
                    startedAt: iso(row.startedAt),
                    durationSeconds: durationOf(row),
                    platform: row.platform,
                    appVersion: row.appVersion,
                    screens: screens.slice(0, 20),
                    screensTruncated: screens.length > 20,
                    customEvents: customEventCounts(row.events, 15),
                    friction: {
                        rageTaps: number(row.rageTapCount),
                        deadTaps: number(row.deadTapCount),
                        crashes: number(row.crashCount),
                        anrs: number(row.anrCount),
                        errors: number(row.errorCount),
                        apiErrors: number(row.apiErrorCount),
                    },
                    topErrors: (topErrors.get(row.id) ?? [])
                        .sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || b.count - a.count || a.name.localeCompare(b.name))
                        .slice(0, 5),
                };
                return [digest];
            });
        },

        async getSessionTimeline(ctx, sessionId, read) {
            const around = read?.aroundMs === undefined ? undefined : new Map([[sessionId, read.aroundMs]]);
            return (await loadBundles(ctx, [sessionId], around)).get(sessionId)?.timeline ?? null;
        },

        async getSessionBundles(ctx, sessionIds, read) {
            return [...(await loadBundles(ctx, sessionIds, read?.aroundMs)).values()];
        },

        async listIssues(ctx, filter, page) {
            const scope = projectScope(ctx, issues.projectId, filter.projectId);
            if (!scope) return null;
            const conditions: SQL[] = [
                scope,
                notWebLongTaskIssue,
                gte(issues.lastSeen, filter.range.from),
                lt(issues.lastSeen, filter.range.to),
            ];
            if (filter.type) conditions.push(eq(issues.issueType, filter.type));
            if (filter.status) conditions.push(eq(issues.status, filter.status));

            const pageConditions = [...conditions];
            if (page.after) {
                pageConditions.push(sql`(${issues.lastSeen}, ${issues.id}) < (${page.after.lastSeenKey}::timestamp, ${page.after.id}::uuid)`);
            }
            const pageQuery: Promise<IssueSummaryRow[]> = db
                .select(issueSummaryColumns)
                .from(issues)
                .where(and(...pageConditions))
                .orderBy(desc(issues.lastSeen), desc(issues.id))
                .limit(page.limit + 1);
            const [rows, total] = await Promise.all([
                pageQuery,
                cappedCount(db.select({ one: sql<number>`1`.as('one') }).from(issues).where(and(...conditions)).limit(COUNT_CAP + 1)),
            ]);

            const kept = rows.slice(0, page.limit);
            return {
                issues: kept.map(toIssueSummary),
                keys: kept.map((row) => ({ lastSeenKey: row.lastSeenKey, id: row.id })),
                hasMore: rows.length > page.limit,
                total,
            };
        },

        async getIssue(ctx, issueId) {
            const scope = projectScope(ctx, issues.projectId);
            if (!scope) return null;
            const issueQuery = db
                .select({
                    ...issueSummaryColumns,
                    environment: issues.environment,
                    componentName: issues.componentName,
                    sampleSessionId: issues.sampleSessionId,
                    sampleStackTrace: issues.sampleStackTrace,
                    sampleDeviceModel: issues.sampleDeviceModel,
                    sampleOsVersion: issues.sampleOsVersion,
                    sampleAppVersion: issues.sampleAppVersion,
                    affectedVersions: issues.affectedVersions,
                    affectedDevices: issues.affectedDevices,
                    dailyEvents: issues.dailyEvents,
                })
                .from(issues)
                .where(and(eq(issues.id, issueId), scope, notWebLongTaskIssue))
                .limit(1);

            // Recent occurrences, side by side with the issue itself. The join
            // repeats the grant filter on the issue and keeps only sessions in
            // the issue's own project.
            const eventsQuery = db
                .select({
                    sessionId: sessions.id,
                    timestamp: issueEvents.timestamp,
                    appVersion: issueEvents.appVersion,
                    deviceModel: issueEvents.deviceModel,
                    osVersion: issueEvents.osVersion,
                })
                .from(issueEvents)
                .innerJoin(issues, eq(issues.id, issueEvents.issueId))
                .innerJoin(sessions, and(eq(sessions.id, issueEvents.sessionId), eq(sessions.projectId, issues.projectId)))
                .where(and(eq(issueEvents.issueId, issueId), scope, notWebLongTaskIssue))
                .orderBy(desc(issueEvents.timestamp))
                .limit(20);

            const [[row], eventRows] = await Promise.all([issueQuery, eventsQuery]);
            if (!row) return null;

            const sampleSessions: IssueDetail['sampleSessions'] = [];
            const seen = new Set<string>();
            for (const event of eventRows) {
                if (seen.has(event.sessionId) || sampleSessions.length >= 5) continue;
                seen.add(event.sessionId);
                sampleSessions.push({
                    sessionId: event.sessionId,
                    occurredAtMs: event.timestamp.getTime(),
                    appVersion: event.appVersion,
                    deviceModel: event.deviceModel,
                });
            }
            if (sampleSessions.length === 0 && row.sampleSessionId) {
                const [sample] = await db
                    .select({ id: sessions.id })
                    .from(sessions)
                    .where(and(eq(sessions.id, row.sampleSessionId), projectScope(ctx, sessions.projectId, row.projectId)!))
                    .limit(1);
                if (sample) {
                    sampleSessions.push({ sessionId: sample.id, occurredAtMs: row.lastSeen.getTime(), appVersion: row.sampleAppVersion, deviceModel: row.sampleDeviceModel });
                }
            }

            return {
                ...toIssueSummary(row),
                environment: row.environment,
                componentName: row.componentName,
                stackTrace: row.sampleStackTrace,
                sampleDevice: { model: row.sampleDeviceModel, osVersion: row.sampleOsVersion, appVersion: row.sampleAppVersion },
                affectedVersions: sortedCounts(row.affectedVersions, 10),
                affectedDevices: sortedCounts(row.affectedDevices, 10),
                sampleSessions,
                recentOccurrences: eventRows.map((event) => ({
                    sessionId: event.sessionId,
                    occurredAtMs: event.timestamp.getTime(),
                    appVersion: event.appVersion,
                    deviceModel: event.deviceModel,
                    osVersion: event.osVersion,
                })),
                dailyEvents: Object.entries((row.dailyEvents ?? {}) as Record<string, unknown>)
                    .map(([day, count]) => ({ day, count: number(count) }))
                    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.day) && entry.count > 0)
                    .sort((a, b) => a.day.localeCompare(b.day))
                    .slice(-30),
            };
        },

        async summarizeFaults(ctx, filter) {
            if (!projectScope(ctx, sessions.projectId, filter.projectId)) return null;
            const { range } = filter;
            const allowed = sql.join(ctx.allowedProjectIds.map((id) => sql`${id}::uuid`), sql`, `);
            const metadata = (...keys: string[]) => sql.join(keys.map((key) => sql`t.device_metadata->>${key}`), sql`, `);
            const anrStack = sql`coalesce(nullif(t.thread_state, ''), t.device_metadata->>'stack', '')`;
            // Per table: where the row is, how it is grouped and what describes it.
            const shape = {
                crash: {
                    table: sql.raw('crashes'),
                    signature: sql`coalesce(t.fingerprint, md5(t.exception_name || '|' || left(coalesce(t.reason, ''), 120)))`,
                    name: sql`t.exception_name`,
                    detail: sql`left(coalesce(t.reason, ''), 300)`,
                    screen: sql`null::text`,
                    device: sql`coalesce(${metadata('model', 'deviceModel')}, s.device_model)`,
                    os: sql`coalesce(${metadata('systemVersion', 'osVersion')}, s.os_version)`,
                    app: sql`coalesce(${metadata('appVersion')}, s.app_version)`,
                    duration: sql`null::int`,
                    extra: sql`true`,
                },
                anr: {
                    table: sql.raw('anrs'),
                    signature: sql`md5(left(${anrStack}, 400))`,
                    name: sql`'ANR'::text`,
                    detail: sql`left(${anrStack}, 300)`,
                    screen: sql`null::text`,
                    device: sql`coalesce(${metadata('model', 'deviceModel')}, s.device_model)`,
                    os: sql`coalesce(${metadata('systemVersion', 'osVersion')}, s.os_version)`,
                    app: sql`coalesce(${metadata('appVersion')}, s.app_version)`,
                    duration: sql`t.duration_ms`,
                    // Web long tasks are stored as ANRs and are not shown as such anywhere.
                    extra: sql`not (lower(coalesce(s.platform, '')) = 'web' and lower(${anrStack}) like '%main_thread_long_task%')`,
                },
                error: {
                    table: sql.raw('errors'),
                    signature: sql`coalesce(t.fingerprint, md5(t.error_name || '|' || left(t.message, 120)))`,
                    name: sql`t.error_name`,
                    detail: sql`left(t.message, 300)`,
                    screen: sql`t.screen_name`,
                    device: sql`coalesce(t.device_model, s.device_model)`,
                    os: sql`coalesce(t.os_version, s.os_version)`,
                    app: sql`coalesce(t.app_version, s.app_version)`,
                    duration: sql`null::int`,
                    extra: sql`true`,
                },
            }[filter.type];

            const filters: SQL[] = [shape.extra];
            if (filter.platform === 'mobile') filters.push(sql`lower(s.platform) in ('ios', 'android')`);
            else if (filter.platform) filters.push(sql`lower(s.platform) = ${filter.platform}`);
            if (filter.appVersion) filters.push(sql`${shape.app} = ${filter.appVersion}`);

            const breakdown = (dimension: string, column: string, limit: number) => sql`(
                select ${dimension}::text as dim, ${sql.raw(column)}::text as key, count(*)::int as n, count(distinct session_id)::int as sessions,
                       null::text as name, null::text as detail, null::text as first_seen, null::text as last_seen,
                       null::text as fault_ids, null::text as session_ids, null::text as fault_times, null::int as p50, null::int as p90, null::int as dmax
                from f where ${sql.raw(column)} is not null and ${sql.raw(column)} <> ''
                group by ${sql.raw(column)} order by count(*) desc, ${sql.raw(column)} limit ${limit}
            )`;
            const stamp = (expression: SQL) => sql`to_char(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
            const examples = (expression: SQL) => sql`array_to_string((array_agg(${expression} order by ts desc, id))[1:${FAULT_SUMMARY_EXAMPLES_PER_GROUP}], ',')`;

            // One round trip: the newest rows of the range, read once, then every
            // breakdown as a branch of one UNION ALL over that set. The session join
            // carries the project filter too, as in getFault.
            const rows = await db
                .select({
                    dim: sql<string>`r.dim`,
                    key: sql<string | null>`r.key`,
                    n: sql<number>`r.n`,
                    sessions: sql<number>`r.sessions`,
                    name: sql<string | null>`r.name`,
                    detail: sql<string | null>`r.detail`,
                    firstSeen: sql<string | null>`r.first_seen`,
                    lastSeen: sql<string | null>`r.last_seen`,
                    faultIds: sql<string | null>`r.fault_ids`,
                    sessionIds: sql<string | null>`r.session_ids`,
                    faultTimes: sql<string | null>`r.fault_times`,
                    p50: sql<number | null>`r.p50`,
                    p90: sql<number | null>`r.p90`,
                    dmax: sql<number | null>`r.dmax`,
                })
                .from(sql`(
                    with f as materialized (
                        select t.id, t.session_id, t."timestamp" as ts,
                               ${shape.signature} as sig, ${shape.name} as name, ${shape.detail} as detail, ${shape.screen} as screen,
                               ${shape.device} as device_model, ${shape.os} as os_version, ${shape.app} as app_version,
                               lower(s.platform) as platform, ${shape.duration} as duration_ms
                        from ${shape.table} t
                        left join sessions s on s.id = t.session_id and s.project_id = t.project_id
                        where t.project_id in (${allowed})
                          and t.project_id = ${filter.projectId}::uuid
                          and t."timestamp" >= ${range.from.toISOString()}::timestamp
                          and t."timestamp" < ${range.to.toISOString()}::timestamp
                          and ${sql.join(filters, sql` and `)}
                        order by t."timestamp" desc
                        limit ${FAULT_SUMMARY_SCAN_CAP + 1}
                    )
                    select 'total'::text as dim, count(distinct sig)::text as key, count(*)::int as n, count(distinct session_id)::int as sessions,
                           null::text as name, null::text as detail, null::text as first_seen, null::text as last_seen,
                           null::text as fault_ids, null::text as session_ids, null::text as fault_times,
                           (percentile_disc(0.5) within group (order by duration_ms))::int as p50,
                           (percentile_disc(0.9) within group (order by duration_ms))::int as p90,
                           max(duration_ms)::int as dmax
                    from f
                    union all (
                        select 'group', sig, count(*)::int, count(distinct session_id)::int, max(name), max(detail),
                               ${stamp(sql`min(ts)`)}, ${stamp(sql`max(ts)`)},
                               ${examples(sql`id::text`)}, ${examples(sql`coalesce(session_id, '')`)},
                               ${examples(sql`(extract(epoch from ts) * 1000)::bigint::text`)},
                               null::int, null::int, null::int
                        from f group by sig order by count(*) desc, sig limit ${FAULT_SUMMARY_GROUPS}
                    )
                    union all ${breakdown('app_version', 'app_version', FAULT_SUMMARY_BREAKDOWN_ROWS)}
                    union all ${breakdown('platform', 'platform', FAULT_SUMMARY_BREAKDOWN_ROWS)}
                    union all ${breakdown('os_version', 'os_version', FAULT_SUMMARY_BREAKDOWN_ROWS)}
                    union all ${breakdown('device', 'device_model', FAULT_SUMMARY_BREAKDOWN_ROWS)}
                    union all ${breakdown('screen', 'screen', FAULT_SUMMARY_BREAKDOWN_ROWS)}
                    union all (
                        select 'day', to_char(ts, 'YYYY-MM-DD'), count(*)::int, count(distinct session_id)::int,
                               null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::int, null::int, null::int
                        from f group by to_char(ts, 'YYYY-MM-DD') order by to_char(ts, 'YYYY-MM-DD') desc limit 100
                    )
                    union all (
                        select 'sample', sig, 1, 1, name, detail, null::text, null::text,
                               id::text, session_id, (extract(epoch from ts) * 1000)::bigint::text, null::int, null::int, null::int
                        from f where session_id is not null
                        order by md5(id::text) collate "C", id limit ${FAULT_SUMMARY_SAMPLE_ROWS}
                    )
                ) as r`);

            const of = (dim: string) => rows.filter((row) => row.dim === dim);
            const total = of('total')[0];
            const scanned = number(total?.n);
            const groupRows = of('group');

            // Second round trip, only for crashes and errors: issues carry the same
            // fingerprint as their rows. ANR issues are keyed differently.
            const signatures = filter.type === 'anr' ? [] : groupRows.map((row) => row.key).filter((key): key is string => typeof key === 'string' && key.length > 0);
            const issueRows = signatures.length === 0
                ? []
                : await db
                    .select({ id: issues.id, fingerprint: issues.fingerprint })
                    .from(issues)
                    .where(and(projectScope(ctx, issues.projectId, filter.projectId)!, inArray(issues.fingerprint, signatures), eq(issues.issueType, filter.type)))
                    .limit(signatures.length);
            const issueBySignature = new Map(issueRows.map((row) => [row.fingerprint, row.id]));

            const split = (value: string | null) => (value ? value.split(',') : []);
            const breakdownRows = (dim: string): FaultBreakdownRow[] => of(dim).map((row) => ({ name: row.key ?? '', count: number(row.n), sessions: number(row.sessions) }));
            return {
                projectId: filter.projectId,
                type: filter.type,
                total: { count: Math.min(scanned, FAULT_SUMMARY_SCAN_CAP), capped: scanned > FAULT_SUMMARY_SCAN_CAP },
                sessions: number(total?.sessions),
                groupCount: number(total?.key),
                groups: groupRows.map((row) => {
                    const faultIds = split(row.faultIds);
                    const sessionIds = split(row.sessionIds);
                    const times = split(row.faultTimes);
                    return {
                        signature: row.key ?? '',
                        name: row.name ?? '',
                        detail: row.detail && row.detail.trim() !== '' ? row.detail : null,
                        count: number(row.n),
                        sessions: number(row.sessions),
                        firstSeen: row.firstSeen ?? '',
                        lastSeen: row.lastSeen ?? '',
                        issueId: issueBySignature.get(row.key ?? '') ?? null,
                        examples: faultIds.map((faultId, index) => ({ faultId, sessionId: sessionIds[index] || null, occurredAtMs: number(times[index]) })),
                    };
                }),
                durationMs: filter.type === 'anr' && scanned > 0 ? { p50: number(total?.p50), p90: number(total?.p90), max: number(total?.dmax) } : null,
                byAppVersion: breakdownRows('app_version'),
                byPlatform: breakdownRows('platform'),
                byOsVersion: breakdownRows('os_version'),
                byDevice: breakdownRows('device'),
                byScreen: breakdownRows('screen'),
                daily: of('day').map((row) => ({ day: row.key ?? '', count: number(row.n), sessions: number(row.sessions) })).reverse(),
                sample: of('sample').flatMap((row) => (row.faultIds && row.sessionIds
                    ? [{ faultId: row.faultIds, sessionId: row.sessionIds, occurredAtMs: number(row.faultTimes), name: row.name ?? '', detail: row.detail && row.detail.trim() !== '' ? row.detail : null }]
                    : [])),
            };
        },

        async getFault(ctx, faultId, type) {
            if (ctx.allowedProjectIds.length === 0) return null;
            const sessionColumns = {
                joinedSessionId: sessions.id,
                sessionPlatform: sessions.platform,
                sessionDeviceModel: sessions.deviceModel,
                sessionOsVersion: sessions.osVersion,
                sessionAppVersion: sessions.appVersion,
                sessionSdkVersion: sessions.sdkVersion,
                replayAvailable: sessions.replayAvailable,
                replayRetentionState: sessions.replayRetentionState,
                recordingDeleted: sessions.recordingDeleted,
                isReplayExpired: sessions.isReplayExpired,
                replayQuotaBillingExhausted: sessions.replayQuotaBillingExhausted,
                smartCaptureStatus: sessions.smartCaptureStatus,
            };
            type SessionSide = {
                sessionPlatform: string | null;
                sessionDeviceModel: string | null;
                sessionOsVersion: string | null;
                sessionAppVersion: string | null;
                sessionSdkVersion: string | null;
                replayAvailable: boolean | null;
            };
            // Event metadata wins over the session's values, as in `routes/crashes.ts`.
            const device = (row: SessionSide, metadata: unknown, own?: { model?: string | null; osVersion?: string | null; appVersion?: string | null }) => ({
                platform: metadataText(metadata, 'platform') ?? row.sessionPlatform,
                model: own?.model ?? metadataText(metadata, 'model', 'deviceModel') ?? row.sessionDeviceModel,
                osVersion: own?.osVersion ?? metadataText(metadata, 'systemVersion', 'osVersion') ?? row.sessionOsVersion,
                appVersion: own?.appVersion ?? metadataText(metadata, 'appVersion') ?? row.sessionAppVersion,
                sdkVersion: metadataText(metadata, 'sdkVersion') ?? row.sessionSdkVersion,
            });
            // The session join carries the project filter too: a fault whose session
            // sits in another project (which should not happen) shows no session data.
            const sessionJoin = (sessionIdColumn: AnyPgColumn, projectColumn: AnyPgColumn) =>
                and(eq(sessions.id, sessionIdColumn), eq(sessions.projectId, projectColumn));

            const loadCrash = async (): Promise<FaultDetail | null> => {
                const [row] = await db
                    .select({ fault: {
                        id: crashes.id,
                        projectId: crashes.projectId,
                        sessionId: crashes.sessionId,
                        timestamp: crashes.timestamp,
                        exceptionName: crashes.exceptionName,
                        reason: crashes.reason,
                        stackTrace: crashes.stackTrace,
                        deviceMetadata: crashes.deviceMetadata,
                        status: crashes.status,
                    }, ...sessionColumns })
                    .from(crashes)
                    .leftJoin(sessions, sessionJoin(crashes.sessionId, crashes.projectId))
                    .where(and(eq(crashes.id, faultId), projectScope(ctx, crashes.projectId)!))
                    .limit(1);
                if (!row) return null;
                return {
                    id: row.fault.id,
                    type: 'crash',
                    projectId: row.fault.projectId,
                    sessionId: row.joinedSessionId,
                    occurredAt: iso(row.fault.timestamp),
                    occurredAtMs: row.fault.timestamp.getTime(),
                    name: row.fault.exceptionName,
                    message: row.fault.reason,
                    status: row.fault.status,
                    screenName: null,
                    durationMs: null,
                    stackTrace: row.fault.stackTrace,
                    device: device(row, row.fault.deviceMetadata),
                    sessionHasReplay: canOpenReplayFromSessionFields(row),
                };
            };

            const loadAnr = async (): Promise<FaultDetail | null> => {
                const [row] = await db
                    .select({ fault: {
                        id: anrs.id,
                        projectId: anrs.projectId,
                        sessionId: anrs.sessionId,
                        timestamp: anrs.timestamp,
                        durationMs: anrs.durationMs,
                        threadState: anrs.threadState,
                        deviceMetadata: anrs.deviceMetadata,
                        status: anrs.status,
                    }, ...sessionColumns })
                    .from(anrs)
                    .leftJoin(sessions, sessionJoin(anrs.sessionId, anrs.projectId))
                    .where(and(eq(anrs.id, faultId), projectScope(ctx, anrs.projectId)!))
                    .limit(1);
                if (!row) return null;
                return {
                    id: row.fault.id,
                    type: 'anr',
                    projectId: row.fault.projectId,
                    sessionId: row.joinedSessionId,
                    occurredAt: iso(row.fault.timestamp),
                    occurredAtMs: row.fault.timestamp.getTime(),
                    name: 'Application Not Responding',
                    message: `Main thread blocked for ${row.fault.durationMs} ms`,
                    status: row.fault.status,
                    screenName: null,
                    durationMs: row.fault.durationMs,
                    stackTrace: resolveAnrStackTrace({ threadState: row.fault.threadState, deviceMetadata: row.fault.deviceMetadata }),
                    device: device(row, row.fault.deviceMetadata),
                    sessionHasReplay: canOpenReplayFromSessionFields(row),
                };
            };

            const loadError = async (): Promise<FaultDetail | null> => {
                const [row] = await db
                    .select({ fault: {
                        id: errors.id,
                        projectId: errors.projectId,
                        sessionId: errors.sessionId,
                        timestamp: errors.timestamp,
                        errorName: errors.errorName,
                        message: errors.message,
                        stack: errors.stack,
                        screenName: errors.screenName,
                        deviceModel: errors.deviceModel,
                        osVersion: errors.osVersion,
                        appVersion: errors.appVersion,
                        status: errors.status,
                    }, ...sessionColumns })
                    .from(errors)
                    .leftJoin(sessions, sessionJoin(errors.sessionId, errors.projectId))
                    .where(and(eq(errors.id, faultId), projectScope(ctx, errors.projectId)!))
                    .limit(1);
                if (!row) return null;
                return {
                    id: row.fault.id,
                    type: 'error',
                    projectId: row.fault.projectId,
                    sessionId: row.joinedSessionId,
                    occurredAt: iso(row.fault.timestamp),
                    occurredAtMs: row.fault.timestamp.getTime(),
                    name: row.fault.errorName,
                    message: row.fault.message,
                    status: row.fault.status,
                    screenName: row.fault.screenName,
                    durationMs: null,
                    stackTrace: row.fault.stack,
                    device: device(row, null, { model: row.fault.deviceModel, osVersion: row.fault.osVersion, appVersion: row.fault.appVersion }),
                    sessionHasReplay: canOpenReplayFromSessionFields(row),
                };
            };

            // One primary-key read when the type is known; otherwise the three
            // tables are tried side by side, not one after another.
            if (type === 'crash') return loadCrash();
            if (type === 'anr') return loadAnr();
            if (type === 'error') return loadError();
            const [crash, anr, error] = await Promise.all([loadCrash(), loadAnr(), loadError()]);
            return crash ?? anr ?? error;
        },
    };
}
