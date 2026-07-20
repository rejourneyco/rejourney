/**
 * Sessions Routes
 * 
 * Session listing, details, and dashboard stats
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { eq, and, or, inArray, gte, lt, isNull, desc, asc, sql, getTableColumns, type SQL } from 'drizzle-orm';

import { db, sessions, sessionMetrics, recordingArtifacts, projects, teamMembers, crashes, anrs, errors, replayShareLinks } from '../db/client.js';
import { gunzipSync } from 'zlib';

import {
    getSignedDownloadUrl,
    getSignedDownloadUrlForProject,
    downloadFromS3ForArtifact,
    downloadRawFromS3ForArtifact,
    getObjectSizeBytesForArtifact,
} from '../db/s3.js';
import {
    getScreenshotFrameCount,
    getSessionScreenshotFrames,
    triggerSessionScreenshotFramePrewarm,
    type ScreenshotFrameUrlMode,
} from '../services/screenshotFrames.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter, networkRateLimiter, replayShareRateLimiter, writeApiRateLimiter } from '../middleware/rateLimit.js';
import {
    sessionIdParamSchema,
    networkGroupBySchema,
    createReplayShareLinkSchema,
    replayShareIdParamSchema,
} from '../validation/sessions.js';
import { generateAnonymousName } from '../utils/anonymousName.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getRedis } from '../db/redis.js';
import { auditFromRequest } from '../services/auditLog.js';
import {
    buildReplayShareUrl,
    createOrReuseReplayShareLink,
    listReplayShareLinksForSession,
    resolveReplayShareLink,
    serializeReplayShareLink,
    touchReplayShareLink,
    type ReplayShareLinkRow,
    type ReplayShareVisibility,
} from '../services/replayShareLinks.js';
import {
    getSessionArchiveIssueFilterCondition,
    normalizeSessionArchiveIssueFilter,
    sessionArchiveIssueFilterUsesMetrics,
} from '../services/sessionArchiveFilters.js';
import { hasSuccessfulRecording } from '../services/replayAvailability.js';
import {
    deriveSessionPresentationState,
    type SessionPresentationState,
} from '../services/sessionPresentationState.js';
import {
    loadSessionWorkAggregate,
    type SessionWorkAggregate,
} from '../services/sessionEvidence.js';
import { durationSecondsForDisplay, shouldApplySuccessorSessionCap } from '../services/sessionTiming.js';
import {
    archiveKeysetMatchesRequest,
    archiveListSortNeedsMetricsJoin,
    archiveListSortSqlExpr,
    buildArchiveListKeysetCondition,
    buildArchiveTextSearchCondition,
    encodeArchiveListCursor,
    extractArchiveSortKeyFromRow,
    normalizeArchiveListSortDir,
    normalizeArchiveListSortKey,
    parseArchiveListCursor,
} from '../services/sessionArchiveListSort.js';
import { loadSuccessorSessionStartedAt } from '../services/sessionTimingQuery.js';
import { resolveAnrStackTrace } from '../services/anrStack.js';
import {
    buildSessionExportCsvRow,
    createSessionExportDateTimeFormatters,
    encodeCsvRow,
    SESSION_EXPORT_CSV_HEADERS,
} from '../services/sessionExportCsv.js';
import {
    getFirstTouchPointFromTelemetryEvent,
    getFrustrationTapKind,
    isKeyboardAreaTelemetryEvent,
    MOBILE_FRUSTRATION_COUNTS_VERSION,
    MOBILE_RAGE_TAP_THRESHOLD,
    registerTapForMobileRageInference,
    type MobileTapPoint,
} from '../utils/mobileFrustration.js';
import { shouldTrustClientFrustrationCountsForPlatform } from '../services/ingestSessionEnd.js';
import {
    recordDashboardInvestigation,
    recordProjectOwnerMilestone,
} from '../services/googleAdsConversions.js';
import { normalizeReplayEventPayload } from '../services/replayEventPayload.js';

type ScreenshotFramePayload = {
    timestamp: number;
    url: string;
    proxyUrl?: string | null;
    index: number;
};

const router = Router();

/** Archive list: omit `events` / `metadata` JSONB — they are large and unused for the table (detail API loads full rows). */
const sessionsArchiveListColumns = (() => {
    const { events: _events, metadata: _metadata, ...cols } = getTableColumns(sessions);
    return cols;
})();

/** Correlated subselect: last frame time from replay artifacts (not ingest wall clock). */
const archiveListLatestReplayEndMsSql = sql<number | null>`(
    select max(${recordingArtifacts.endTime})
    from ${recordingArtifacts}
    where ${eq(recordingArtifacts.sessionId, sessions.id)}
      and ${inArray(recordingArtifacts.kind, ['screenshots', 'hierarchy', 'rrweb'])}
)`.as('latestReplayArtifactEndMs');

/** `device_id` → `anonymous_hash` → `user_display_id` — matches how the dashboard distinguishes visitors. */
const archiveVisitorIdentitySql = sql<string>`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId})`;

/** True when a strictly later session exists for the same project + visitor (archive list LIVE badge). */
const archiveListHasNewerVisitorSessionSql = sql<boolean>`(
    EXISTS (
        SELECT 1 FROM sessions s2
        WHERE s2.project_id = ${sessions.projectId}
          AND coalesce(s2.device_id, s2.anonymous_hash, s2.user_display_id) IS NOT NULL
          AND coalesce(s2.device_id, s2.anonymous_hash, s2.user_display_id) = ${archiveVisitorIdentitySql}
          AND (
            s2.started_at > ${sessions.startedAt}
            OR (s2.started_at = ${sessions.startedAt} AND s2.id > ${sessions.id})
          )
    )
)`.as('hasNewerSessionOnVisitor');

const archiveWebReferralSql = sql<string | null>`
    nullif(coalesce(
        ${sessions.webReferral},
        ${sessions.metadata}->>'webReferral',
        ${sessions.metadata}->>'webReferrerDomain',
        ${sessions.metadata}->>'webAttributionSource'
    ), '')
`.as('webReferral');

const archiveWebLandingRouteSql = sql<string | null>`
    nullif(coalesce(
        ${sessions.metadata}->>'webLandingRoute',
        ${sessions.metadata}->>'webEntryPath'
    ), '')
`.as('webLandingRoute');

type ArchiveListSessionForFirstCheck = Pick<
    typeof sessions.$inferSelect,
    'id' | 'projectId' | 'deviceId' | 'anonymousHash' | 'userDisplayId'
>;

/**
 * Session ids that are the chronologically first row for each (project, visitor) among identities present on this page.
 */
async function resolveArchiveFirstSessionIds(rows: Array<{ session: ArchiveListSessionForFirstCheck }>): Promise<Set<string>> {
    const firstIds = new Set<string>();
    const byProject = new Map<string, Set<string>>();

    for (const { session: s } of rows) {
        const identity = s.deviceId || s.anonymousHash || s.userDisplayId;
        if (!identity) continue;
        if (!byProject.has(s.projectId)) byProject.set(s.projectId, new Set());
        byProject.get(s.projectId)!.add(identity);
    }

    for (const [projectId, identitySet] of byProject) {
        const identities = [...identitySet];
        if (identities.length === 0) continue;

        // DISTINCT ON returns exactly one row per identity — the chronologically earliest session.
        // = ANY(ARRAY[...]) works well with the sessions_visitor_identity_started_idx expression index.
        const result = await db.execute<{ id: string }>(sql`
            SELECT DISTINCT ON (coalesce(device_id, anonymous_hash, user_display_id)) id
            FROM sessions
            WHERE project_id = ${projectId}
              AND coalesce(device_id, anonymous_hash, user_display_id) = ANY(
                  ARRAY[${sql.join(identities.map((i) => sql`${i}`), sql`, `)}]
              )
            ORDER BY coalesce(device_id, anonymous_hash, user_display_id), started_at ASC, id ASC
        `);

        for (const row of result.rows) {
            firstIds.add(row.id);
        }
    }

    return firstIds;
}

/**
 * Get time range filter for queries
 */
function getTimeRangeFilter(timeRange?: string): Date | undefined {
    if (!timeRange || timeRange === 'all') return undefined;

    const now = Date.now();
    const ranges: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        '90d': 90 * 24 * 60 * 60 * 1000,
        '1y': 365 * 24 * 60 * 60 * 1000,
    };

    const ms = ranges[timeRange];
    return ms ? new Date(now - ms) : undefined;
}

type ArchiveMetadataFilter = {
    key: string;
    value?: string;
};

function parseArchiveMetadataFilters(value: unknown): ArchiveMetadataFilter[] {
    if (!value) return [];
    let rawFilters: unknown = value;
    if (typeof value === 'string') {
        try {
            rawFilters = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(rawFilters)) return [];

    return rawFilters
        .slice(0, 8)
        .map((raw: any): ArchiveMetadataFilter | null => {
            const key = typeof raw?.key === 'string' ? raw.key.trim().slice(0, 128) : '';
            if (!key) return null;
            const rawValue = raw?.value;
            const normalizedValue = rawValue === undefined || rawValue === null
                ? undefined
                : String(rawValue).trim().slice(0, 512);
            const filter: ArchiveMetadataFilter = { key };
            if (normalizedValue) filter.value = normalizedValue;
            return filter;
        })
        .filter((filter): filter is ArchiveMetadataFilter => filter !== null);
}

function buildArchiveMetadataCondition(metaKey: string, metaValue?: string): SQL | undefined {
    if (!metaKey) return undefined;

    if (metaValue !== undefined && metaValue !== '') {
        let parsedValue: any = metaValue;
        if (metaValue === 'true') parsedValue = true;
        else if (metaValue === 'false') parsedValue = false;
        else if (!isNaN(Number(metaValue))) parsedValue = Number(metaValue);
        const metadataValueCondition = parsedValue === metaValue
            ? sql`${sessions.metadata} @> ${JSON.stringify({ [metaKey]: parsedValue })}::jsonb`
            : or(
                sql`${sessions.metadata} @> ${JSON.stringify({ [metaKey]: parsedValue })}::jsonb`,
                sql`${sessions.metadata} @> ${JSON.stringify({ [metaKey]: metaValue })}::jsonb`
            );

        if (metaKey === 'webReferral') {
            const referralValue = String(metaValue).trim().slice(0, 255);
            return or(
                eq(sessions.webReferral, referralValue),
                metadataValueCondition
            );
        }
        return metadataValueCondition;
    }

    if (metaKey === 'webReferral') {
        return or(
            sql`${sessions.webReferral} IS NOT NULL AND ${sessions.webReferral} <> ''`,
            sql`${sessions.metadata} ? ${metaKey}`
        );
    }
    return sql`${sessions.metadata} ? ${metaKey}`;
}

function buildSessionArchiveBaseConditions(
    filters: {
        timeRange?: string;
        projectId?: string;
        platform?: string;
        status?: string;
        hasRecording?: string;
        metaKey?: string;
        metaValue?: string;
        metaFilters?: string;
        eventName?: string;
        date?: string;
        eventCountOp?: string;
        eventCountValue?: string;
        eventPropKey?: string;
        eventPropValue?: string;
        issueFilter?: string;
        smartCaptureStatus?: string;
        smartCaptureRuleId?: string;
        smartCaptureRuleName?: string;
        lifecyclePreset?: string;
        sessionWindowSize?: string;
        conversionPreset?: string;
        screenName?: string;
        screenOutcome?: string;
        /** Pipe-separated ordered screen path, e.g. "HomeScreen|CheckoutScreen|ConfirmationScreen" */
        screenPath?: string;
        /** Exact geo filters used by map drilldowns. */
        geoCountry?: string;
        geoCity?: string;
        /** When 'OR', filter conditions are combined with OR instead of AND */
        conditionLogic?: string;
        /** Case-insensitive substring match across id, user display, device, model, anonymous fields */
        q?: string;
    },
    accessibleProjectIds: string[]
) {
    const {
        timeRange,
        projectId,
        platform,
        status,
        hasRecording,
        metaKey,
        metaValue,
        metaFilters,
        eventName,
        date,
        eventCountOp,
        eventCountValue,
        eventPropKey,
        eventPropValue,
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
        conditionLogic,
        q,
    } = filters;

    const startedAfter = getTimeRangeFilter(timeRange);
    // Access-control and static conditions — always AND'd regardless of conditionLogic
    const baseConditions: (SQL | undefined)[] = [
        projectId ? eq(sessions.projectId, projectId) : inArray(sessions.projectId, accessibleProjectIds),
    ];
    // User-defined filter conditions — combined with AND or OR per conditionLogic
    const userFilterConditions: (SQL | undefined)[] = [];

    if (date) {
        const startOfDay = new Date(`${date}T00:00:00.000Z`);
        const endOfDay = new Date(`${date}T23:59:59.999Z`);
        userFilterConditions.push(and(gte(sessions.startedAt, startOfDay), lt(sessions.startedAt, endOfDay)));
    } else if (startedAfter) {
        userFilterConditions.push(gte(sessions.startedAt, startedAfter));
    }

    if (platform === 'mobile') {
        userFilterConditions.push(inArray(sessions.platform, ['ios', 'android']));
    } else if (platform) {
        userFilterConditions.push(eq(sessions.platform, platform));
    }
    if (status) baseConditions.push(eq(sessions.status, status));

    const recordingFilter = hasRecording;
    if (recordingFilter === 'true') {
        baseConditions.push(eq(sessions.replayAvailable, true));
        baseConditions.push(or(isNull(sessions.replayRetentionState), eq(sessions.replayRetentionState, 'saved')));
    }

    const normalizedGeoCountry = typeof geoCountry === 'string' ? geoCountry.trim() : '';
    const normalizedGeoCity = typeof geoCity === 'string' ? geoCity.trim() : '';
    if (normalizedGeoCountry) {
        userFilterConditions.push(eq(sessions.geoCountry, normalizedGeoCountry));
    }
    if (normalizedGeoCity) {
        userFilterConditions.push(eq(sessions.geoCity, normalizedGeoCity));
    }

    const metadataFilters = parseArchiveMetadataFilters(metaFilters);
    if (metaKey) metadataFilters.unshift({ key: metaKey, value: metaValue });
    for (const metadataFilter of metadataFilters) {
        userFilterConditions.push(buildArchiveMetadataCondition(metadataFilter.key, metadataFilter.value));
    }

    if (eventName) {
        if (eventPropKey && eventPropValue !== undefined && eventPropValue !== '') {
            let parsedPropValue: any = eventPropValue;
            if (eventPropValue === 'true') parsedPropValue = true;
            else if (eventPropValue === 'false') parsedPropValue = false;
            else if (!isNaN(Number(eventPropValue))) parsedPropValue = Number(eventPropValue);
            userFilterConditions.push(sql`${sessions.events} @> ${JSON.stringify([{ name: eventName, properties: { [eventPropKey]: parsedPropValue } }])}::jsonb`);
        } else if (eventPropKey) {
            userFilterConditions.push(sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${sessions.events}) AS elem
                WHERE elem->>'name' = ${eventName}
                AND elem->'properties' ? ${eventPropKey}
            )`);
        } else {
            userFilterConditions.push(sql`${sessions.events} @> ${JSON.stringify([{ name: eventName }])}::jsonb`);
        }
    } else if (eventPropKey) {
        if (eventPropValue !== undefined && eventPropValue !== '') {
            let parsedPropValue: any = eventPropValue;
            if (eventPropValue === 'true') parsedPropValue = true;
            else if (eventPropValue === 'false') parsedPropValue = false;
            else if (!isNaN(Number(eventPropValue))) parsedPropValue = Number(eventPropValue);
            userFilterConditions.push(sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${sessions.events}) AS elem
                WHERE elem->'properties' @> ${JSON.stringify({ [eventPropKey]: parsedPropValue })}::jsonb
            )`);
        } else {
            userFilterConditions.push(sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${sessions.events}) AS elem
                WHERE elem->'properties' ? ${eventPropKey}
            )`);
        }
    }

    const hasEventCountFilter = eventCountOp && eventCountValue !== undefined && eventCountValue !== '';
    const parsedEventCountValue = hasEventCountFilter ? parseInt(eventCountValue) : NaN;
    const eventCountCondition = (() => {
        if (!hasEventCountFilter || isNaN(parsedEventCountValue)) return null;
        switch (eventCountOp) {
            case 'eq': return sql`${sessionMetrics.customEventCount} = ${parsedEventCountValue}`;
            case 'gt': return sql`${sessionMetrics.customEventCount} > ${parsedEventCountValue}`;
            case 'lt': return sql`${sessionMetrics.customEventCount} < ${parsedEventCountValue}`;
            case 'gte': return sql`${sessionMetrics.customEventCount} >= ${parsedEventCountValue}`;
            case 'lte': return sql`${sessionMetrics.customEventCount} <= ${parsedEventCountValue}`;
            default: return null;
        }
    })();
    if (eventCountCondition) userFilterConditions.push(eventCountCondition);

    const normalizedIssueFilter = normalizeSessionArchiveIssueFilter(issueFilter);
    const issueFilterCondition = getSessionArchiveIssueFilterCondition(normalizedIssueFilter);
    if (issueFilterCondition) userFilterConditions.push(issueFilterCondition);

    if (smartCaptureStatus && ['not_applicable', 'pending', 'kept', 'discarded'].includes(smartCaptureStatus)) {
        userFilterConditions.push(eq(sessions.smartCaptureStatus, smartCaptureStatus));
    }
    if (smartCaptureRuleId) {
        userFilterConditions.push(eq(sessions.smartCaptureRuleId, smartCaptureRuleId));
    }
    if (smartCaptureRuleName && smartCaptureRuleName.trim()) {
        userFilterConditions.push(sql`lower(coalesce(${sessions.smartCaptureReason}, '')) like ${`%${smartCaptureRuleName.trim().toLowerCase()}%`}`);
    }

    const normalizedWindowSize = Math.min(25, Math.max(1, parseInt(sessionWindowSize || '5', 10) || 5));
    const visitorIdentity = sql`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId})`;
    if (lifecyclePreset === 'early_user') {
        userFilterConditions.push(sql`
            ${visitorIdentity} is not null
            and (
                select count(*) from sessions earlier
                where earlier.project_id = ${sessions.projectId}
                  and coalesce(earlier.device_id, earlier.anonymous_hash, earlier.user_display_id) = ${visitorIdentity}
                  and (
                    earlier.started_at < ${sessions.startedAt}
                    or (earlier.started_at = ${sessions.startedAt} and earlier.id <= ${sessions.id})
                  )
                ) <= ${normalizedWindowSize}
        `);
    } else if (lifecyclePreset === 'returning_user') {
        userFilterConditions.push(sql`
            ${visitorIdentity} is not null
            and (
                select count(*) from sessions earlier
                where earlier.project_id = ${sessions.projectId}
                  and coalesce(earlier.device_id, earlier.anonymous_hash, earlier.user_display_id) = ${visitorIdentity}
                  and (
                    earlier.started_at < ${sessions.startedAt}
                    or (earlier.started_at = ${sessions.startedAt} and earlier.id <= ${sessions.id})
                  )
            ) > ${normalizedWindowSize}
        `);
    }

    const checkoutEnteredCondition = sql`(
        ${sessions.events} @> ${JSON.stringify([{ name: 'checkout_started' }])}::jsonb
        or ${sessions.events} @> ${JSON.stringify([{ name: 'checkout_viewed' }])}::jsonb
        or ${sessions.events} @> ${JSON.stringify([{ name: 'cart_checkout_tapped' }])}::jsonb
        or exists (
            select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
            where lower(screen_name) like '%checkout%'
        )
    )`;
    const checkoutSuccessCondition = sql`(
        ${sessions.events} @> ${JSON.stringify([{ name: 'checkout_success' }])}::jsonb
        or ${sessions.events} @> ${JSON.stringify([{ name: 'purchase_completed' }])}::jsonb
        or ${sessions.events} @> ${JSON.stringify([{ name: 'order_completed' }])}::jsonb
        or exists (
            select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
            where lower(screen_name) like '%confirmation%'
               or lower(screen_name) like '%success%'
               or lower(screen_name) like '%receipt%'
               or lower(screen_name) like '%order complete%'
        )
    )`;
    if (conversionPreset === 'checkout_bounced') {
        userFilterConditions.push(and(checkoutEnteredCondition, sql`not ${checkoutSuccessCondition}`));
    } else if (conversionPreset === 'checkout_success') {
        userFilterConditions.push(and(checkoutEnteredCondition, checkoutSuccessCondition));
    }

    const normalizedScreenName = typeof screenName === 'string' ? screenName.trim() : '';
    if (normalizedScreenName) {
        const screenVisitedCondition = sql`exists (
            select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
            where lower(screen_name) = lower(${normalizedScreenName})
        )`;
        const finalScreenSql = sql`lower(coalesce((coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[]))[cardinality(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[]))], ''))`;
        if (screenOutcome === 'bounced') {
            userFilterConditions.push(and(screenVisitedCondition, sql`${finalScreenSql} = lower(${normalizedScreenName})`));
        } else if (screenOutcome === 'continued') {
            userFilterConditions.push(and(screenVisitedCondition, sql`${finalScreenSql} <> lower(${normalizedScreenName})`));
        } else {
            userFilterConditions.push(screenVisitedCondition);
        }
    }

    // Ordered screen path: steps must appear in sequence within screensVisited
    const screenPathSteps = typeof screenPath === 'string'
        ? screenPath.split('|').map((s) => s.trim()).filter(Boolean)
        : [];
    if (screenPathSteps.length >= 2) {
        const nullChecks = screenPathSteps.map((step) =>
            sql`MIN(t.idx) FILTER (WHERE lower(t.s) = lower(${step})) IS NOT NULL`
        );
        const orderChecks = screenPathSteps.slice(0, -1).map((step, i) => {
            const nextStep = screenPathSteps[i + 1];
            return sql`MIN(t.idx) FILTER (WHERE lower(t.s) = lower(${step})) < MIN(t.idx) FILTER (WHERE lower(t.s) = lower(${nextStep}))`;
        });
        const allChecks = sql.join([...nullChecks, ...orderChecks], sql` AND `);
        userFilterConditions.push(sql`(
            SELECT CASE WHEN ${allChecks} THEN true ELSE false END
            FROM unnest(COALESCE(${sessionMetrics.screensVisited}, ARRAY[]::text[])) WITH ORDINALITY AS t(s, idx)
        )`);
    }

    // Text search from the search bar is always AND'd (not part of the query builder)
    const textSearch = typeof q === 'string' ? buildArchiveTextSearchCondition(q) : null;
    if (textSearch) baseConditions.push(textSearch);

    // Combine user filter conditions with AND or OR depending on conditionLogic
    if (userFilterConditions.length > 0) {
        const filterClause = conditionLogic === 'OR'
            ? or(...userFilterConditions)
            : and(...userFilterConditions);
        if (filterClause) baseConditions.push(filterClause);
    }

    return {
        baseConditions,
        needsMetricsJoin: Boolean(
            eventCountCondition
            || sessionArchiveIssueFilterUsesMetrics(normalizedIssueFilter)
            || conversionPreset === 'checkout_bounced'
            || conversionPreset === 'checkout_success'
            || Boolean(normalizedScreenName)
            || screenPathSteps.length >= 2
        ),
    };
}

const archiveVisitorSessionNumberSql = sql<number>`(
    select count(*)::int from sessions ranked
    where ranked.project_id = ${sessions.projectId}
      and coalesce(ranked.device_id, ranked.anonymous_hash, ranked.user_display_id) is not null
      and coalesce(ranked.device_id, ranked.anonymous_hash, ranked.user_display_id) = coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId})
      and (
        ranked.started_at < ${sessions.startedAt}
        or (ranked.started_at = ${sessions.startedAt} and ranked.id <= ${sessions.id})
      )
)`.as('visitorSessionNumber');

const archiveVisitorFinalSessionNumberSql = sql<number>`(
    select count(*)::int from sessions ranked
    where ranked.project_id = ${sessions.projectId}
      and coalesce(ranked.device_id, ranked.anonymous_hash, ranked.user_display_id) is not null
      and coalesce(ranked.device_id, ranked.anonymous_hash, ranked.user_display_id) = coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId})
      and (
        ranked.started_at > ${sessions.startedAt}
        or (ranked.started_at = ${sessions.startedAt} and ranked.id >= ${sessions.id})
      )
)`.as('visitorFinalSessionNumber');

const archiveCheckoutEnteredSql = sql<boolean>`(
    ${sessions.events} @> ${JSON.stringify([{ name: 'checkout_started' }])}::jsonb
    or ${sessions.events} @> ${JSON.stringify([{ name: 'checkout_viewed' }])}::jsonb
    or ${sessions.events} @> ${JSON.stringify([{ name: 'cart_checkout_tapped' }])}::jsonb
    or exists (
        select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
        where lower(screen_name) like '%checkout%'
    )
)`.as('checkoutEntered');

const archiveCheckoutSucceededSql = sql<boolean>`(
    ${sessions.events} @> ${JSON.stringify([{ name: 'checkout_success' }])}::jsonb
    or ${sessions.events} @> ${JSON.stringify([{ name: 'purchase_completed' }])}::jsonb
    or ${sessions.events} @> ${JSON.stringify([{ name: 'order_completed' }])}::jsonb
    or exists (
        select 1 from unnest(coalesce(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_name
        where lower(screen_name) like '%confirmation%'
           or lower(screen_name) like '%success%'
           or lower(screen_name) like '%receipt%'
           or lower(screen_name) like '%order complete%'
    )
)`.as('checkoutSucceeded');

const DETAIL_FETCH_CONCURRENCY = Number(process.env.RJ_REPLAY_DETAIL_FETCH_CONCURRENCY ?? 6);
const frameModeFromEnv = (process.env.RJ_REPLAY_FRAME_URL_MODE || 'proxy').toLowerCase();
const DEFAULT_FRAME_URL_MODE: ScreenshotFrameUrlMode = frameModeFromEnv === 'signed' ? 'signed' : 'proxy';
const SESSION_CORE_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_CORE_CACHE_TTL_SECONDS ?? 300);
// Short TTL for sessions that are still being recorded/processed. Without this,
// every click on an active session re-runs the full S3 fetch pipeline, which
// is the dominant cause of multi-second /core latency for users browsing live
// or recently-ended sessions.
const SESSION_CORE_UNSTABLE_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_CORE_UNSTABLE_CACHE_TTL_SECONDS ?? 20);
const SESSION_DETAIL_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_DETAIL_CACHE_TTL_SECONDS ?? 300);
const SESSION_BOOTSTRAP_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_BOOTSTRAP_CACHE_TTL_SECONDS ?? 15);
const SESSION_REPLAY_MANIFEST_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_REPLAY_MANIFEST_CACHE_TTL_SECONDS ?? 900);
const SESSION_REPLAY_MANIFEST_UNSTABLE_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_REPLAY_MANIFEST_UNSTABLE_CACHE_TTL_SECONDS ?? 20);
const SESSION_REPLAY_MANIFEST_LOCK_TTL_SECONDS = Number(process.env.RJ_SESSION_REPLAY_MANIFEST_LOCK_TTL_SECONDS ?? 10);
const SESSION_SCREENSHOT_FRAMES_BUILDING_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_SCREENSHOT_FRAMES_BUILDING_CACHE_TTL_SECONDS ?? 2);
const SCREENSHOT_FRAME_DATA_CACHE_TTL_SECONDS = Number(process.env.RJ_SCREENSHOT_FRAME_DATA_CACHE_TTL_SECONDS ?? 600);
const SCREENSHOT_FRAME_ARCHIVE_LOCK_TTL_SECONDS = Number(process.env.RJ_SCREENSHOT_FRAME_ARCHIVE_LOCK_TTL_SECONDS ?? 20);
const SCREENSHOT_FRAME_ARCHIVE_LOCK_WAIT_MS = Number(process.env.RJ_SCREENSHOT_FRAME_ARCHIVE_LOCK_WAIT_MS ?? 5000);
const RRWEB_SEGMENT_DATA_CACHE_TTL_SECONDS = Number(process.env.RJ_RRWEB_SEGMENT_DATA_CACHE_TTL_SECONDS ?? 600);
const RRWEB_SEGMENT_DATA_CACHE_MAX_BYTES = Number(process.env.RJ_RRWEB_SEGMENT_DATA_CACHE_MAX_BYTES ?? 5_000_000);
const FRAME_AUTH_CACHE_TTL_SECONDS = Number(process.env.RJ_FRAME_AUTH_CACHE_TTL_SECONDS ?? 60);
const SESSION_BOOTSTRAP_CACHE_CONTROL = 'private, max-age=15, stale-while-revalidate=45';
const SESSION_DETAIL_CACHE_VERSION = 'v6';
// Inline-events cap for /core rrweb payload. When the total rrweb segment size
// exceeds this, the server returns segment URLs (events: []) and the dashboard
// fetches segments directly from R2 in parallel. This removes the dashboard
// pod as a bottleneck for large replays (a 50MB session can finish loading in
// the browser before the server would have even finished concatenating it).
const REPLAY_CORE_INLINE_LIMIT_BYTES = Number(process.env.RJ_REPLAY_CORE_INLINE_LIMIT_BYTES ?? 2_000_000);
// rrweb is stored as gzip-compressed JSON, but /core returns expanded JSON when
// inlining. A 1 MB artifact commonly becomes many MB in the API response, so
// use an inflate estimate when deciding whether to bypass the dashboard API.
const REPLAY_CORE_INLINE_INFLATE_FACTOR = Number(process.env.RJ_REPLAY_CORE_INLINE_INFLATE_FACTOR ?? 8);

function isStableForSessionDetailCache(session: any): boolean {
    const status = String(session?.status || '').toLowerCase();
    return Boolean(session?.endedAt)
        || status === 'ready'
        || status === 'completed'
        || status === 'failed'
        || status === 'deleted';
}

function shouldWriteSessionDetailCache(session: any, aggregate?: SessionWorkAggregate | null): boolean {
    if (!isStableForSessionDetailCache(session)) return false;
    if (aggregate?.hasPendingWork || aggregate?.hasPendingReplayWork) return false;
    return true;
}

/**
 * Returns a TTL in seconds for caching a /core response. Stable sessions get
 * the full SESSION_CORE_CACHE_TTL_SECONDS. Unstable sessions get a short TTL
 * that absorbs burst clicks (e.g. user rapidly cycling through live sessions)
 * without holding onto stale state for long.
 */
function pickSessionCoreCacheTtl(session: any, aggregate?: SessionWorkAggregate | null): number {
    if (shouldWriteSessionDetailCache(session, aggregate)) return SESSION_CORE_CACHE_TTL_SECONDS;
    return SESSION_CORE_UNSTABLE_CACHE_TTL_SECONDS;
}

function latestClientEvidenceEndMs(aggregate: SessionWorkAggregate): number | null {
    return Math.max(
        Number(aggregate.latestReplayArtifactEndMs ?? 0),
        Number(aggregate.latestEventArtifactEndMs ?? 0),
    ) || null;
}

function shouldTreatSessionAsSuperseded(
    session: { platform?: string | null },
    aggregate: SessionWorkAggregate,
    successorStartedAt: Date | null,
): boolean {
    return shouldApplySuccessorSessionCap({
        platform: session.platform,
        successorStartedAt,
        latestClientEvidenceEndMs: latestClientEvidenceEndMs(aggregate),
    });
}

function resolveFrameUrlMode(raw: unknown): ScreenshotFrameUrlMode {
    if (typeof raw !== 'string') return DEFAULT_FRAME_URL_MODE;
    const mode = raw.toLowerCase();
    if (mode === 'signed' || mode === 'proxy' || mode === 'none') return mode;
    return DEFAULT_FRAME_URL_MODE;
}

function shouldIncludeReplayFromQuery(raw: unknown): boolean {
    if (typeof raw !== 'string') return true;
    const value = raw.toLowerCase();
    return value !== 'false' && value !== '0' && value !== 'deferred' && value !== 'none';
}

type SessionDetailCacheKind = 'bootstrap' | 'core' | 'coreLite' | 'timeline' | 'hierarchy' | 'replayManifest' | 'frames';

function buildSessionDetailCacheKey(kind: SessionDetailCacheKind, sessionId: string): string {
    if (kind === 'bootstrap') return `${SESSION_DETAIL_CACHE_VERSION}:session_bootstrap:${sessionId}`;
    if (kind === 'core') return `${SESSION_DETAIL_CACHE_VERSION}:session_core:${sessionId}`;
    if (kind === 'coreLite') return `${SESSION_DETAIL_CACHE_VERSION}:session_core_lite:${sessionId}`;
    if (kind === 'replayManifest') return `${SESSION_DETAIL_CACHE_VERSION}:session_replay_manifest:${sessionId}`;
    if (kind === 'frames') return `${SESSION_DETAIL_CACHE_VERSION}:session_frames:${sessionId}`;
    return `${SESSION_DETAIL_CACHE_VERSION}:session_${kind}:${sessionId}`;
}

async function readCachedSessionDetail(kind: SessionDetailCacheKind, sessionId: string): Promise<string | null> {
    try {
        return await getRedis().get(buildSessionDetailCacheKey(kind, sessionId));
    } catch (err) {
        logger.warn({ err, kind, sessionId }, '[sessions] Failed to read session detail cache');
        return null;
    }
}

async function writeCachedSessionDetail(
    kind: SessionDetailCacheKind,
    sessionId: string,
    payload: unknown,
    ttlOverrideSeconds?: number,
): Promise<void> {
    try {
        const defaultTtl = kind === 'bootstrap'
            ? SESSION_BOOTSTRAP_CACHE_TTL_SECONDS
            : kind === 'core' || kind === 'coreLite'
                ? SESSION_CORE_CACHE_TTL_SECONDS
                : kind === 'replayManifest'
                    ? SESSION_REPLAY_MANIFEST_CACHE_TTL_SECONDS
                    : kind === 'frames'
                        ? SESSION_REPLAY_MANIFEST_CACHE_TTL_SECONDS
                : SESSION_DETAIL_CACHE_TTL_SECONDS;
        const ttl = ttlOverrideSeconds && ttlOverrideSeconds > 0 ? ttlOverrideSeconds : defaultTtl;
        await getRedis().setex(buildSessionDetailCacheKey(kind, sessionId), ttl, JSON.stringify(payload));
    } catch (err) {
        logger.warn({ err, kind, sessionId }, '[sessions] Failed to write session detail cache');
    }
}

async function writeCachedSessionDetailJson(
    kind: SessionDetailCacheKind,
    sessionId: string,
    payloadJson: string,
    ttlSeconds: number,
): Promise<void> {
    try {
        await getRedis().setex(buildSessionDetailCacheKey(kind, sessionId), ttlSeconds, payloadJson);
    } catch (err) {
        logger.warn({ err, kind, sessionId }, '[sessions] Failed to write session detail cache');
    }
}

async function sleepMs(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOrBuildCachedSessionDetailJson(
    kind: SessionDetailCacheKind,
    sessionId: string,
    builder: () => Promise<{ payload: unknown; ttlSeconds: number }>,
): Promise<{ payloadJson: string; cacheStatus: 'hit' | 'miss' | 'lock-hit' | 'wait-hit' | 'bypass' }> {
    const cached = await readCachedSessionDetail(kind, sessionId);
    if (cached) return { payloadJson: cached, cacheStatus: 'hit' };

    const redis = getRedis();
    const cacheKey = buildSessionDetailCacheKey(kind, sessionId);
    const lockKey = `${cacheKey}:lock`;
    const lockToken = randomUUID();

    let lockAcquired = false;
    try {
        const lockResult = await redis.set(lockKey, lockToken, 'EX', SESSION_REPLAY_MANIFEST_LOCK_TTL_SECONDS, 'NX');
        lockAcquired = lockResult === 'OK';
    } catch (err) {
        logger.warn({ err, kind, sessionId }, '[sessions] Failed to acquire session detail cache lock');
    }

    if (!lockAcquired) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await sleepMs(100);
            const waited = await readCachedSessionDetail(kind, sessionId);
            if (waited) return { payloadJson: waited, cacheStatus: 'wait-hit' };
        }

        const { payload, ttlSeconds } = await builder();
        const payloadJson = JSON.stringify(payload);
        await writeCachedSessionDetailJson(kind, sessionId, payloadJson, ttlSeconds);
        return { payloadJson, cacheStatus: 'bypass' };
    }

    try {
        const raced = await readCachedSessionDetail(kind, sessionId);
        if (raced) return { payloadJson: raced, cacheStatus: 'lock-hit' };

        const { payload, ttlSeconds } = await builder();
        const payloadJson = JSON.stringify(payload);
        await writeCachedSessionDetailJson(kind, sessionId, payloadJson, ttlSeconds);
        return { payloadJson, cacheStatus: 'miss' };
    } finally {
        try {
            const currentToken = await redis.get(lockKey);
            if (currentToken === lockToken) await redis.del(lockKey);
        } catch (err) {
            logger.warn({ err, kind, sessionId }, '[sessions] Failed to release session detail cache lock');
        }
    }
}

async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];
    const output: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Math.max(1, Math.min(concurrency, items.length));

    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor++;
            output[index] = await mapper(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));
    return output;
}

async function getAuthorizedSession(userId: string, sessionId: string) {
    const [sessionResult] = await db
        .select({
            session: sessions,
            metrics: sessionMetrics,
            teamId: projects.teamId,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        throw ApiError.notFound('Session not found');
    }

    const [membership] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, sessionResult.teamId), eq(teamMembers.userId, userId)))
        .limit(1);

    if (!membership) {
        throw ApiError.forbidden('No access to this session');
    }

    return {
        ...sessionResult,
        membership,
    };
}

async function getAuthorizedSessionForFrames(userId: string, sessionId: string) {
    const cacheKey = `session_frame_auth:${sessionId}:${userId}`;
    try {
        const redis = getRedis();
        const cachedProjectId = await redis.get(cacheKey);
        if (cachedProjectId) {
            const [session] = await db
                .select({
                    session: sessions,
                })
                .from(sessions)
                .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, cachedProjectId)))
                .limit(1);

            if (session) {
                return {
                    session: session.session,
                    metrics: null,
                    teamId: null,
                };
            }
        }
    } catch (err) {
        logger.warn({ err, sessionId, userId }, '[sessions] Frame auth cache lookup failed, falling back to DB');
    }

    const sessionResult = await getAuthorizedSession(userId, sessionId);

    try {
        const redis = getRedis();
        await redis.setex(
            `session_frame_auth:${sessionId}:${userId}`,
            FRAME_AUTH_CACHE_TTL_SECONDS,
            sessionResult.session.projectId
        );
    } catch (err) {
        logger.warn({ err, sessionId, userId }, '[sessions] Failed to cache frame auth projectId');
    }

    return sessionResult;
}

function canManageReplayShares(role?: string | null): boolean {
    return role === 'owner' || role === 'admin';
}

function getDashboardOrigin(req: any): string {
    const configuredOrigin = config.PUBLIC_DASHBOARD_URL?.trim();
    if (configuredOrigin) {
        try {
            return new URL(configuredOrigin).origin;
        } catch {
            return configuredOrigin.replace(/\/dashboard\/?$/i, '').replace(/\/+$/, '');
        }
    }

    const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto'].split(',')[0].trim()
        : '';
    const proto = forwardedProto || req.protocol || 'https';
    const host = req.get?.('host') || req.headers.host || 'rejourney.co';
    return `${proto}://${host}`.replace(/\/+$/, '');
}

function setPublicReplayHeaders(res: any): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
}

function buildPublicShareApiBase(shareToken: string): string {
    return `/api/session/share/replay/${encodeURIComponent(shareToken)}`;
}

function rewriteScreenshotFramesForShare(frames: ScreenshotFramePayload[] | undefined, shareToken: string): ScreenshotFramePayload[] {
    const apiBase = buildPublicShareApiBase(shareToken);
    return (frames || []).map((frame) => {
        const timestamp = Math.round(Number(frame.timestamp || 0));
        const url = `${apiBase}/frame/${timestamp}.jpg`;
        return {
            ...frame,
            url,
            proxyUrl: url,
        };
    });
}

function rewriteRrwebReplayForShare(rrwebReplay: RrwebReplayPayload | undefined, shareToken: string): RrwebReplayPayload {
    const apiBase = buildPublicShareApiBase(shareToken);
    const baseReplay = rrwebReplay || emptyRrwebReplayPayload();
    return {
        ...baseReplay,
        segments: (baseReplay.segments || []).map((segment) => {
            const artifactId = segment.artifactId;
            return {
                ...segment,
                url: null,
                proxyUrl: artifactId ? `${apiBase}/rrweb-segment/${artifactId}.json.gz` : null,
            };
        }),
    };
}

function rewriteVisualAssetsForShare<T extends { screenshotFrames?: ScreenshotFramePayload[]; rrwebReplay?: RrwebReplayPayload }>(
    payload: T,
    shareToken: string,
): T {
    return {
        ...payload,
        screenshotFrames: rewriteScreenshotFramesForShare(payload.screenshotFrames, shareToken),
        rrwebReplay: rewriteRrwebReplayForShare(payload.rrwebReplay, shareToken),
    };
}

function isReplayOnlyTimelineEvent(event: any): boolean {
    const type = String(event?.type || '').toLowerCase();
    if (!type) return false;
    if (
        type.includes('network') ||
        type.includes('console') ||
        type.includes('log') ||
        type.includes('error') ||
        type.includes('exception') ||
        type.includes('crash') ||
        type.includes('anr')
    ) {
        return false;
    }
    return (
        type.includes('navigation') ||
        type.includes('screen') ||
        type.includes('route') ||
        type.includes('touch') ||
        type.includes('tap') ||
        type.includes('gesture') ||
        type.includes('click') ||
        type.includes('scroll') ||
        type === 'app_foreground' ||
        type === 'app_background'
    );
}

function sanitizeReplayOnlyTimelineEvent(event: any): any {
    return {
        id: event?.id,
        type: event?.type,
        name: event?.name,
        label: event?.label,
        timestamp: event?.timestamp,
        screen: event?.screen,
        screenName: event?.screenName,
        path: event?.path,
        urlPath: event?.urlPath,
        gestureType: event?.gestureType,
        frustrationKind: event?.frustrationKind,
        targetLabel: event?.targetLabel,
        x: event?.x,
        y: event?.y,
        count: event?.count,
        touches: event?.touches,
    };
}

function filterTimelineForShareVisibility(timeline: any, visibility: ReplayShareVisibility): any {
    if (visibility === 'full_workbench') return timeline;
    return {
        events: (timeline.events || [])
            .filter(isReplayOnlyTimelineEvent)
            .map(sanitizeReplayOnlyTimelineEvent),
        networkRequests: [],
        crashes: [],
        anrs: [],
        deviceInfo: timeline.deviceInfo ?? null,
    };
}

function applyCoreShareVisibility(core: any, link: ReplayShareLinkRow): any {
    const visibility = link.visibility as ReplayShareVisibility;
    const sharedCore = {
        ...core,
        projectId: undefined,
        share: {
            visibility,
            expiresAt: link.expiresAt?.toISOString() ?? null,
        },
    };

    if (visibility === 'full_workbench') return sharedCore;

    return {
        ...sharedCore,
        userId: null,
        anonymousId: null,
        metadata: undefined,
        networkRequests: [],
        hierarchySnapshots: [],
        crashes: [],
        anrs: [],
    };
}

async function resolvePublicReplayShareContext(shareToken: string, options: { markAccess?: boolean } = {}) {
    const link = await resolveReplayShareLink(shareToken);
    if (!link) throw ApiError.notFound('Replay share not found');

    const [sessionResult] = await db
        .select({
            session: sessions,
            metrics: sessionMetrics,
            teamId: projects.teamId,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(and(
            eq(sessions.id, link.sessionId),
            eq(sessions.projectId, link.projectId),
            eq(projects.teamId, link.teamId),
        ))
        .limit(1);

    if (!sessionResult) throw ApiError.notFound('Replay share not found');
    if (!hasSuccessfulRecording(sessionResult.session)) {
        throw ApiError.notFound('Replay share not found');
    }

    if (options.markAccess) {
        void touchReplayShareLink(link.id).catch((err) => {
            logger.warn({ err, shareId: link.id }, '[sessions] Failed to update replay share access metadata');
        });
    }

    return {
        link,
        ...sessionResult,
    };
}

async function getReadyArtifacts(sessionId: string) {
    return db
        .select()
        .from(recordingArtifacts)
        .where(and(eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.status, 'ready')));
}

function effectiveFrustrationCountsForSession(session: any, metrics: any) {
    const rawRageTapCount = Number(metrics?.rageTapCount ?? 0) || 0;
    const rawDeadTapCount = Number(metrics?.deadTapCount ?? 0) || 0;
    const version = Number(metrics?.frustrationCountsVersion ?? 0) || 0;
    const needsCanonicalMobileCounts = metrics
        && !shouldTrustClientFrustrationCountsForPlatform(session?.platform)
        && Number(metrics?.eventsSizeBytes ?? 0) > 0
        && version < MOBILE_FRUSTRATION_COUNTS_VERSION;

    return {
        rageTapCount: needsCanonicalMobileCounts ? 0 : rawRageTapCount,
        // Legacy mobile dead-tap summaries were not the noisy keyboard source,
        // so keep them visible while the canonical repair catches up.
        deadTapCount: rawDeadTapCount,
        frustrationCountsVersion: version,
        frustrationCountsPendingRepair: Boolean(needsCanonicalMobileCounts),
    };
}

function buildMetricsPayload(session: any, metrics: any) {
    const screensVisited: string[] = Array.isArray(metrics?.screensVisited) ? metrics.screensVisited : [];
    const frustrationCounts = effectiveFrustrationCountsForSession(session, metrics);
    return metrics
        ? {
            totalEvents: metrics.totalEvents,
            touchCount: metrics.touchCount,
            scrollCount: metrics.scrollCount,
            gestureCount: metrics.gestureCount,
            inputCount: metrics.inputCount,
            navigationCount: screensVisited.length,
            errorCount: metrics.errorCount,
            rageTapCount: frustrationCounts.rageTapCount,
            deadTapCount: frustrationCounts.deadTapCount,
            frustrationCountsVersion: frustrationCounts.frustrationCountsVersion,
            frustrationCountsPendingRepair: frustrationCounts.frustrationCountsPendingRepair,
            apiSuccessCount: metrics.apiSuccessCount,
            apiErrorCount: metrics.apiErrorCount,
            apiTotalCount: metrics.apiTotalCount,
            apiAvgResponseMs: metrics.apiAvgResponseMs,
            screensVisited,
            uniqueScreensCount: new Set(screensVisited).size,
            interactionScore: metrics.interactionScore,
            explorationScore: metrics.explorationScore,
            uxScore: metrics.uxScore,
            customEventCount: metrics.customEventCount ?? 0,
            crashCount: metrics.crashCount || 0,
        }
        : null;
}

function buildSessionPresentationPayload(presentationState: SessionPresentationState) {
    return {
        effectiveStatus: presentationState.effectiveStatus,
        isLiveIngest: presentationState.isLiveIngest,
        isBackgroundProcessing: presentationState.isBackgroundProcessing,
        canOpenReplay: presentationState.canOpenReplay,
    };
}

function readSessionMetadataString(metadata: unknown, keys: string[]): string | null {
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

function buildWebContextPayload(session: any) {
    return {
        webReferral: session?.webReferral || readSessionMetadataString(session?.metadata, ['webReferral', 'webReferrerDomain', 'webAttributionSource']),
        webLandingRoute: readSessionMetadataString(session?.metadata, ['webLandingRoute', 'webEntryPath']),
    };
}

type RrwebReplaySegment = {
    artifactId?: string;
    index: number;
    startTime: number | null;
    endTime: number | null;
    eventCount: number;
    sizeBytes: number | null;
    url: string | null;
    proxyUrl?: string | null;
};

type RrwebReplayPayload = {
    events: any[];
    eventCount: number;
    segments: RrwebReplaySegment[];
    page: Record<string, unknown> | null;
    viewport: Record<string, unknown> | null;
    /**
     * 'inline' — events array is fully populated server-side (default for small sessions).
     * 'segments' — events array is empty; the dashboard must fetch each segment URL
     *              directly from R2 and concatenate. Used when total payload would
     *              exceed REPLAY_CORE_INLINE_LIMIT_BYTES so the server isn't a bottleneck.
     */
    loadMode?: 'inline' | 'segments';
};

const emptyRrwebReplayPayload = (): RrwebReplayPayload => ({
    events: [],
    eventCount: 0,
    segments: [],
    page: null,
    viewport: null,
    loadMode: 'inline',
});

function parseArtifactJson(data: Buffer, s3ObjectKey?: string | null) {
    const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
        Boolean(s3ObjectKey?.endsWith('.gz'));

    if (!isGzipped) return JSON.parse(data.toString());

    try {
        return JSON.parse(gunzipSync(data).toString());
    } catch {
        return JSON.parse(data.toString());
    }
}

async function loadRrwebReplayPayload(
    session: any,
    rrwebArtifacts: any[],
    options: { forceSegments?: boolean } = {},
): Promise<RrwebReplayPayload> {
    if (rrwebArtifacts.length === 0 || session.isReplayExpired || session.recordingDeleted) {
        return emptyRrwebReplayPayload();
    }

    const sortedArtifacts = [...rrwebArtifacts].sort((a, b) => {
        const aTime = a.startTime ?? a.timestamp ?? a.createdAt?.getTime?.() ?? 0;
        const bTime = b.startTime ?? b.timestamp ?? b.createdAt?.getTime?.() ?? 0;
        return aTime - bTime;
    });

    // Pre-compute total declared payload size from artifact metadata. If the
    // session is large enough that inlining would create a multi-MB response
    // and bottleneck the dashboard pod, we skip the S3 download entirely and
    // return signed segment URLs for the browser to fetch directly. This
    // doesn't just save bandwidth — it removes a round-trip-amplifying
    // intermediary (the dashboard pod) from the hot path.
    const totalDeclaredBytes = sortedArtifacts.reduce((sum, a) => {
        const size = Number(a.sizeBytes ?? a.declaredSizeBytes ?? 0);
        return sum + (Number.isFinite(size) && size > 0 ? size : 0);
    }, 0);
    const estimatedInlineBytes = totalDeclaredBytes > 0
        ? totalDeclaredBytes * Math.max(1, REPLAY_CORE_INLINE_INFLATE_FACTOR)
        : 0;
    const shouldSkipInline = options.forceSegments || (
        REPLAY_CORE_INLINE_LIMIT_BYTES > 0
        && (
            totalDeclaredBytes > REPLAY_CORE_INLINE_LIMIT_BYTES
            || estimatedInlineBytes > REPLAY_CORE_INLINE_LIMIT_BYTES
            || (totalDeclaredBytes === 0 && sortedArtifacts.length > 1)
        )
    );

    if (shouldSkipInline) {
        // Build segments with signed URLs only — no S3 downloads, no parsing.
        // The browser fetches segments directly from R2 in parallel, which is
        // both faster (no proxy hop) and removes the dashboard CPU bottleneck.
        const segments = await mapWithConcurrency(
            sortedArtifacts,
            DETAIL_FETCH_CONCURRENCY,
            async (artifact, index) => {
                try {
                    const url = artifact.endpointId
                        ? await getSignedDownloadUrl(artifact.endpointId, artifact.s3ObjectKey)
                        : await getSignedDownloadUrlForProject(session.projectId, artifact.s3ObjectKey);
                    return {
                        artifactId: artifact.id,
                        index,
                        startTime: artifact.startTime ?? null,
                        endTime: artifact.endTime ?? null,
                        eventCount: artifact.frameCount ?? 0,
                        sizeBytes: artifact.sizeBytes ?? artifact.declaredSizeBytes ?? null,
                        url: url ?? null,
                        proxyUrl: `/api/session/rrweb-segment/${session.id}/${artifact.id}.json.gz`,
                    } satisfies RrwebReplaySegment;
                } catch (err) {
                    logger.warn(
                        {
                            err,
                            event: 'sessions.rrweb_signed_url_failed',
                            sessionId: session.id,
                            projectId: session.projectId,
                            artifactId: artifact.id,
                        },
                        'sessions.rrweb_signed_url_failed',
                    );
                    return null;
                }
            }
        );

        const validSegments = segments.filter((s): s is NonNullable<typeof s> => s !== null);
        logger.info(
            {
                event: 'sessions.rrweb_segments_only',
                sessionId: session.id,
                segmentCount: validSegments.length,
                totalDeclaredBytes,
                estimatedInlineBytes,
                inlineLimitBytes: REPLAY_CORE_INLINE_LIMIT_BYTES,
                forceSegments: Boolean(options.forceSegments),
            },
            'sessions.rrweb_segments_only',
        );

        const segmentEventCount = validSegments.reduce((sum, s) => sum + (s.eventCount || 0), 0);
        return {
            events: [],
            eventCount: segmentEventCount,
            segments: validSegments,
            page: null,
            viewport: null,
            loadMode: 'segments',
        };
    }

    // Below-threshold path: inline events server-side (legacy behavior).
    const events: any[] = [];
    const segments: RrwebReplaySegment[] = [];
    let page: Record<string, unknown> | null = null;
    let viewport: Record<string, unknown> | null = null;

    const artifactResults = await mapWithConcurrency(
        sortedArtifacts,
        DETAIL_FETCH_CONCURRENCY,
        async (artifact, index) => {
            try {
                const [data, url] = await Promise.all([
                    downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId),
                    artifact.endpointId
                        ? getSignedDownloadUrl(artifact.endpointId, artifact.s3ObjectKey)
                        : getSignedDownloadUrlForProject(session.projectId, artifact.s3ObjectKey),
                ]);
                if (!data) return null;

                const parsed = parseArtifactJson(data, artifact.s3ObjectKey);
                const segmentEvents = Array.isArray(parsed)
                    ? parsed
                    : (Array.isArray(parsed?.events) ? parsed.events : []);

                return {
                    events: segmentEvents,
                    page: parsed?.page && typeof parsed.page === 'object' ? parsed.page : null,
                    viewport: parsed?.viewport && typeof parsed.viewport === 'object' ? parsed.viewport : null,
                    segment: {
                        artifactId: artifact.id,
                        index,
                        startTime: artifact.startTime ?? parsed?.chunkStartedAt ?? parsed?.startedAt ?? null,
                        endTime: artifact.endTime ?? parsed?.chunkEndedAt ?? null,
                        eventCount: segmentEvents.length || artifact.frameCount || 0,
                        sizeBytes: artifact.sizeBytes ?? artifact.declaredSizeBytes ?? null,
                        url: url ?? null,
                        proxyUrl: `/api/session/rrweb-segment/${session.id}/${artifact.id}.json.gz`,
                    } satisfies RrwebReplaySegment,
                };
            } catch (err) {
                logger.warn(
                    {
                        err,
                        event: 'sessions.rrweb_artifact_download_failed',
                        sessionId: session.id,
                        projectId: session.projectId,
                        artifactId: artifact.id,
                        s3ObjectKeySuffix: artifact.s3ObjectKey?.slice(-64),
                    },
                    'sessions.rrweb_artifact_download_failed',
                );
                return null;
            }
        }
    );

    for (const result of artifactResults) {
        if (!result) continue;
        if (!page && result.page) page = result.page;
        if (!viewport && result.viewport) viewport = result.viewport;
        if (result.events.length > 0) {
            events.push(...result.events);
        }
        segments.push(result.segment);
    }

    events.sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));

    return {
        events,
        eventCount: events.length,
        segments,
        page,
        viewport,
        loadMode: 'inline',
    };
}

function buildSessionBasePayload(
    session: any,
    metrics: any,
    screenshotFrames: ScreenshotFramePayload[],
    readyScreenshotArtifacts = false,
    presentationState?: SessionPresentationState,
    latestReplayEndMs: number | null = null
) {
    const hasRecording = screenshotFrames.length > 0;
    const playbackMode = hasRecording ? 'screenshots' : 'none';
    const successfulRecording = hasSuccessfulRecording(session, metrics, readyScreenshotArtifacts);
    const durationSeconds = durationSecondsForDisplay({
        ...session,
        latestReplayEndMs,
        replayAvailable: session.replayAvailable,
    });
    const sessionPresentationState = presentationState ?? deriveSessionPresentationState({
        status: session.status,
        platform: session.platform,
        replayAvailable: successfulRecording,
        recordingDeleted: session.recordingDeleted,
        isReplayExpired: session.isReplayExpired,
        lastIngestActivityAt: session.lastIngestActivityAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        hasPendingWork: false,
        hasPendingReplayWork: false,
    });

    return {
        id: session.id,
        projectId: session.projectId,
        userId: session.userDisplayId || null,
        anonymousId: session.anonymousDisplayId || session.anonymousHash,
        anonymousDisplayName: session.deviceId ? generateAnonymousName(session.deviceId) : null,
        platform: session.platform,
        appVersion: session.appVersion,
        sdkVersion: session.sdkVersion,
        hasRecording,
        playbackMode,
        deviceInfo: {
            model: session.deviceModel,
            os: session.platform,
            systemVersion: session.osVersion,
            appVersion: session.appVersion,
            sdkVersion: session.sdkVersion,
        },
        osVersion: session.osVersion,
        geoLocation: session.geoCity
            ? {
                city: session.geoCity,
                region: session.geoRegion,
                country: session.geoCountry,
                countryCode: session.geoCountryCode,
                latitude: session.geoLatitude,
                longitude: session.geoLongitude,
                timezone: session.geoTimezone,
            }
            : null,
        startTime: session.startedAt.getTime(),
        endTime: session.endedAt?.getTime(),
        duration: durationSeconds,
        backgroundTime: session.backgroundTimeSeconds ?? 0,
        playableDuration: durationSeconds,
        status: session.status,
        ...buildSessionPresentationPayload(sessionPresentationState),
        ...buildWebContextPayload(session),
        // Session-level JSONB metadata and custom events stored in the sessions table
        metadata: session.metadata,
        events: [] as any[],
        networkRequests: [] as any[],
        batches: [] as any[],
        artifactUrls: {
            events: null as string | null,
            eventsBatches: [] as string[],
        },
        screenshotFrames,
        hierarchySnapshots: [] as Array<{ timestamp: number; screenName: string | null; rootElement: any }>,
        metrics: buildMetricsPayload(session, metrics),
        crashes: [] as any[],
        anrs: [] as any[],
        retentionTier: session.retentionTier,
        retentionDays: session.retentionDays,
        recordingDeleted: session.recordingDeleted,
        recordingDeletedAt: session.recordingDeletedAt?.toISOString() ?? null,
        isReplayExpired: session.isReplayExpired,
        hasSuccessfulRecording: successfulRecording,
    };
}

async function loadScreenshotReplayBootstrap(
    session: any,
    screenshotArtifactCount: number,
    frameUrlMode: ScreenshotFrameUrlMode
) {
    const hasRecording = hasSuccessfulRecording(session);
    if (!hasRecording) {
        return {
            hasRecording: false,
            playbackMode: 'none' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: 0,
            totalSegments: 0,
        };
    }

    const screenshotFrameCount = await getScreenshotFrameCount(session.id);
    const framesResult = await getSessionScreenshotFrames(session.id, {
        urlMode: frameUrlMode,
        buildOnCacheMiss: false,
    });

    if (!framesResult) {
        triggerSessionScreenshotFramePrewarm(session.id);
        return {
            hasRecording: true,
            playbackMode: 'screenshots' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'preparing' as const,
            screenshotFrameCount,
            processedSegments: 0,
            totalSegments: screenshotArtifactCount,
        };
    }

    if (framesResult.status === 'building') {
        triggerSessionScreenshotFramePrewarm(session.id);
    }

    return {
        hasRecording: true,
        playbackMode: 'screenshots' as const,
        screenshotFrames: framesResult.frames,
        screenshotFramesStatus: framesResult.status === 'ready' ? 'ready' as const : 'preparing' as const,
        screenshotFrameCount: Math.max(screenshotFrameCount, framesResult.totalFrames),
        processedSegments: framesResult.processedSegments,
        totalSegments: framesResult.totalSegments,
    };
}

async function loadVisualReplayBootstrap(
    session: any,
    screenshotArtifactCount: number,
    rrwebArtifacts: any[],
    frameUrlMode: ScreenshotFrameUrlMode
) {
    const hasRecording = hasSuccessfulRecording(session);
    if (!hasRecording) {
        return {
            hasRecording: false,
            playbackMode: 'none' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: 0,
            totalSegments: 0,
            rrwebReplay: emptyRrwebReplayPayload(),
        };
    }

    const rrwebReplay = await loadRrwebReplayPayload(session, rrwebArtifacts);
    if (rrwebReplay.eventCount > 0 || rrwebReplay.segments.length > 0) {
        return {
            hasRecording: true,
            playbackMode: 'rrweb' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: rrwebReplay.segments.length,
            totalSegments: rrwebReplay.segments.length,
            rrwebReplay,
        };
    }

    const screenshotReplay = await loadScreenshotReplayBootstrap(session, screenshotArtifactCount, frameUrlMode);
    return {
        ...screenshotReplay,
        rrwebReplay,
    };
}

function buildDeferredVisualReplayBootstrap(
    session: any,
    screenshotArtifactCount: number,
    rrwebArtifacts: any[],
) {
    const hasRecording = hasSuccessfulRecording(session);
    if (!hasRecording) {
        return {
            hasRecording: false,
            playbackMode: 'none' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: 0,
            totalSegments: 0,
            rrwebReplay: emptyRrwebReplayPayload(),
        };
    }

    if (rrwebArtifacts.length > 0) {
        return {
            hasRecording: true,
            playbackMode: 'rrweb' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: 0,
            totalSegments: rrwebArtifacts.length,
            rrwebReplay: {
                ...emptyRrwebReplayPayload(),
                eventCount: rrwebArtifacts.reduce((sum, artifact) => sum + Number(artifact.frameCount || 0), 0),
                loadMode: 'segments' as const,
            },
        };
    }

    if (screenshotArtifactCount > 0) {
        return {
            hasRecording: true,
            playbackMode: 'screenshots' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'preparing' as const,
            screenshotFrameCount: 0,
            processedSegments: 0,
            totalSegments: screenshotArtifactCount,
            rrwebReplay: emptyRrwebReplayPayload(),
        };
    }

    return {
        hasRecording: false,
        playbackMode: 'none' as const,
        screenshotFrames: [] as ScreenshotFramePayload[],
        screenshotFramesStatus: 'none' as const,
        screenshotFrameCount: 0,
        processedSegments: 0,
        totalSegments: 0,
        rrwebReplay: emptyRrwebReplayPayload(),
    };
}

function pickReplayManifestCacheTtl(session: any, aggregate?: SessionWorkAggregate | null, screenshotFramesStatus?: string): number {
    if (screenshotFramesStatus === 'preparing') {
        return SESSION_REPLAY_MANIFEST_UNSTABLE_CACHE_TTL_SECONDS;
    }
    if (shouldWriteSessionDetailCache(session, aggregate)) {
        return SESSION_REPLAY_MANIFEST_CACHE_TTL_SECONDS;
    }
    return SESSION_REPLAY_MANIFEST_UNSTABLE_CACHE_TTL_SECONDS;
}

async function buildReplayManifestPayload(session: any, frameUrlMode: ScreenshotFrameUrlMode) {
    const [artifactsList, aggregate] = await Promise.all([
        getReadyArtifacts(session.id),
        loadSessionWorkAggregate(session.id),
    ]);
    const screenshotArtifacts = artifactsList.filter((artifact) => artifact.kind === 'screenshots');
    const rrwebArtifacts = artifactsList.filter((artifact) => artifact.kind === 'rrweb');
    const rrwebReplay = await loadRrwebReplayPayload(session, rrwebArtifacts, { forceSegments: true });
    const replayBootstrap = (rrwebReplay.eventCount > 0 || rrwebReplay.segments.length > 0)
        ? {
            hasRecording: true,
            playbackMode: 'rrweb' as const,
            screenshotFrames: [] as ScreenshotFramePayload[],
            screenshotFramesStatus: 'none' as const,
            screenshotFrameCount: 0,
            processedSegments: rrwebReplay.segments.length,
            totalSegments: rrwebReplay.segments.length,
            rrwebReplay,
        }
        : await loadVisualReplayBootstrap(
            session,
            screenshotArtifacts.length,
            rrwebArtifacts,
            frameUrlMode,
        );

    const payload = {
        hasRecording: replayBootstrap.hasRecording,
        playbackMode: replayBootstrap.playbackMode,
        screenshotFrames: replayBootstrap.screenshotFrames,
        screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
        screenshotFrameCount: replayBootstrap.screenshotFrameCount,
        screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
        screenshotFramesTotalSegments: replayBootstrap.totalSegments,
        rrwebReplay: replayBootstrap.rrwebReplay,
    };

    return {
        payload,
        ttlSeconds: pickReplayManifestCacheTtl(session, aggregate, replayBootstrap.screenshotFramesStatus),
    };
}

async function buildScreenshotFramesPayload(session: any, frameUrlMode: ScreenshotFrameUrlMode) {
    const [artifactsList, aggregate] = await Promise.all([
        getReadyArtifacts(session.id),
        loadSessionWorkAggregate(session.id),
    ]);
    const screenshotArtifacts = artifactsList.filter((artifact) => artifact.kind === 'screenshots');
    const replayBootstrap = await loadScreenshotReplayBootstrap(
        session,
        screenshotArtifacts.length,
        frameUrlMode,
    );

    const payload = {
        screenshotFrames: replayBootstrap.screenshotFrames,
        screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
        screenshotFrameCount: replayBootstrap.screenshotFrameCount,
        screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
        screenshotFramesTotalSegments: replayBootstrap.totalSegments,
    };

    return {
        payload,
        ttlSeconds: replayBootstrap.screenshotFramesStatus === 'preparing'
            ? SESSION_SCREENSHOT_FRAMES_BUILDING_CACHE_TTL_SECONDS
            : pickReplayManifestCacheTtl(session, aggregate, replayBootstrap.screenshotFramesStatus),
    };
}

async function computeSessionStats(
    session: any,
    metrics: any,
    artifactsList: any[],
    includeMissingHead: boolean
) {
    const bytesByKind: Record<string, number> = {};
    let totalBytes = 0;
    const addBytes = (kind: string, bytes: number) => {
        bytesByKind[kind] = (bytesByKind[kind] || 0) + bytes;
        totalBytes += bytes;
    };

    const artifactsMissingSize: any[] = [];
    for (const artifact of artifactsList) {
        if (typeof artifact.sizeBytes === 'number' && Number.isFinite(artifact.sizeBytes)) {
            addBytes(artifact.kind, artifact.sizeBytes);
        } else {
            artifactsMissingSize.push(artifact);
        }
    }

    if (includeMissingHead && artifactsMissingSize.length > 0) {
        const headSizes = await mapWithConcurrency(
            artifactsMissingSize,
            DETAIL_FETCH_CONCURRENCY,
            async (artifact) => {
                const size = await getObjectSizeBytesForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                return {
                    kind: artifact.kind,
                    size,
                };
            }
        );

        for (const head of headSizes) {
            if (typeof head.size === 'number' && Number.isFinite(head.size)) {
                addBytes(head.kind, head.size);
            }
        }
    }

    return {
        duration: String(session.durationSeconds ?? 0),
        durationMinutes: String(((session.durationSeconds ?? 0) / 60).toFixed(2)),
        eventCount: metrics?.totalEvents ?? 0,
        totalSizeBytes: totalBytes,
        eventsSizeBytes: bytesByKind.events || 0,
        screenshotSizeBytes: bytesByKind.screenshots || 0,
        hierarchySizeBytes: bytesByKind.hierarchy || 0,
        networkSizeBytes: bytesByKind.network || 0,
        totalSizeKB: String(totalBytes / 1024),
        eventsSizeKB: String((bytesByKind.events || 0) / 1024),
        screenshotSizeKB: String((bytesByKind.screenshots || 0) / 1024),
        hierarchySizeKB: String((bytesByKind.hierarchy || 0) / 1024),
        networkSizeKB: String((bytesByKind.network || 0) / 1024),
        networkStats: {
            total: metrics?.apiTotalCount ?? 0,
            successful: metrics?.apiSuccessCount ?? 0,
            failed: metrics?.apiErrorCount ?? 0,
            avgDuration: metrics?.apiAvgResponseMs ?? 0,
        },
    };
}

function normalizeEventsForTimeline(
    allEvents: any[],
    sessionStartMs: number,
    sessionEndMs: number
) {
    const coerceToEpochMs = (raw: unknown, fallbackMs: number): number => {
        const n = typeof raw === 'string' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
        if (!Number.isFinite(n) || n <= 0) return fallbackMs;

        if (n >= 10_000_000_000) return Math.round(n);

        const candidates = [
            Math.round(n * 1000),
            Math.round(sessionStartMs + n),
            Math.round(sessionStartMs + n * 1000),
        ];

        const minOk = sessionStartMs - 60_000;
        const maxOk = sessionEndMs + 60_000;
        for (const c of candidates) {
            if (c >= minOk && c <= maxOk) return c;
        }

        return Math.round(n * 1000);
    };

    const normalizedEvents = allEvents
        .map((e, idx) => {
            const rawType = (e?.type ?? e?.name ?? '').toString();
            const type = rawType.length > 0 ? rawType.toLowerCase() : 'unknown';
            const rawTs = e?.timestamp ?? e?.ts ?? e?.time;
            const timestamp = coerceToEpochMs(rawTs, sessionStartMs);
            const { payload, properties } = normalizeReplayEventPayload(e);

            return {
                ...e,
                id: e?.id || `evt_${idx}_${Math.random().toString(16).slice(2)}`,
                type,
                timestamp,
                payload,
                properties,
                gestureType: e?.gestureType || properties?.gestureType || payload?.gestureType || null,
                // Swift 0.2.x / RN 1.2.x native artifacts use `label` for the
                // tapped UIKit view; newer UI code reads `targetLabel`. Keep
                // both so old uploaded sessions stay searchable in new dashboards.
                targetLabel: e?.targetLabel || e?.label || properties?.targetLabel || properties?.label || payload?.targetLabel || payload?.label || null,
                touches: e?.touches || properties?.touches || payload?.touches || null,
                frustrationKind: e?.frustrationKind || properties?.frustrationKind || payload?.frustrationKind || null,
                screen:
                    e?.screen ||
                    properties?.screen ||
                    payload?.screen ||
                    properties?.screenName ||
                    payload?.screenName ||
                    e?.screenName ||
                    null,
            };
        })
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const syntheticRageTapEvents = synthesizeRageTapEventsForTimeline(normalizedEvents);
    const timelineEvents = syntheticRageTapEvents.length > 0
        ? [...normalizedEvents, ...syntheticRageTapEvents].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        : normalizedEvents;

    return { normalizedEvents: timelineEvents, coerceToEpochMs };
}

function isTapLikeTimelineEvent(event: any): boolean {
    const type = (event?.type || '').toString().toLowerCase();
    const gestureType = (event?.gestureType || event?.properties?.gestureType || event?.payload?.gestureType || '').toString().toLowerCase();

    return (type === 'touch' || type === 'tap' || type === 'click' || type === 'gesture') &&
        (gestureType === 'tap' || gestureType === 'single_tap' || gestureType === 'double_tap');
}

function synthesizeRageTapEventsForTimeline(normalizedEvents: any[]): any[] {
    const explicitRagePoints = normalizedEvents
        .filter((event) => getFrustrationTapKind(event) === 'rage_tap')
        .map((event) => getFirstTouchPointFromTelemetryEvent(event))
        .filter((point): point is MobileTapPoint => Boolean(point));

    const recentTaps: MobileTapPoint[] = [];
    const synthetic: any[] = [];

    for (const event of normalizedEvents) {
        const frustrationKind = getFrustrationTapKind(event);
        if (frustrationKind) {
            recentTaps.length = 0;
            continue;
        }
        if (!isTapLikeTimelineEvent(event)) continue;
        if (isKeyboardAreaTelemetryEvent(event)) {
            recentTaps.length = 0;
            continue;
        }

        const tap = getFirstTouchPointFromTelemetryEvent(event);
        if (!tap) continue;
        const isRageTap = registerTapForMobileRageInference(recentTaps, tap);
        if (!isRageTap) continue;

        const alreadyHasExplicitMarker = explicitRagePoints.some((point) => (
            Math.abs(point.timestamp - tap.timestamp) <= 1000 &&
            Math.hypot(point.x - tap.x, point.y - tap.y) <= 50
        ));
        if (alreadyHasExplicitMarker) continue;

        // Older Swift 0.2.x/RN 1.2.x app binaries may only have tap-only
        // artifacts. New dashboards still need a replay/timeline marker even
        // when those installed apps cannot be upgraded.
        synthetic.push({
            ...event,
            id: `inferred_rage_${event.id || synthetic.length}_${tap.timestamp}`,
            type: 'rage_tap',
            name: event.name || 'Rage Tap',
            gestureType: 'rage_tap',
            frustrationKind: 'rage_tap',
            x: tap.x,
            y: tap.y,
            count: MOBILE_RAGE_TAP_THRESHOLD,
            touches: [{ x: tap.x, y: tap.y, timestamp: tap.timestamp }],
            timestamp: tap.timestamp,
            properties: {
                ...(event.properties || {}),
                inferred: true,
                compatibility: 'mobile_tap_cluster',
                gestureType: 'rage_tap',
                frustrationKind: 'rage_tap',
                count: MOBILE_RAGE_TAP_THRESHOLD,
            },
        });
    }

    return synthetic;
}

function getFaultTextValue(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase().slice(0, 240);
}

function buildFaultDedupeSignature(event: any): string {
    const type = (event?.type ?? '').toString().toLowerCase();
    const timestamp = Number.isFinite(event?.timestamp)
        ? Math.round(Number(event.timestamp) / 250) * 250
        : 0;
    const name = getFaultTextValue(
        event?.name ??
        event?.properties?.errorName ??
        event?.properties?.exceptionName
    );
    const message = getFaultTextValue(
        event?.message ??
        event?.reason ??
        event?.properties?.message ??
        event?.properties?.reason
    );
    const stackHead = getFaultTextValue(
        ((event?.stack ??
            event?.properties?.stack ??
            event?.properties?.stackTrace ??
            event?.properties?.threadState ??
            '') as string)
            .split('\n')[0]
    );
    return `${type}|${timestamp}|${name}|${message}|${stackHead}`;
}

function mergeEventsWithFaults(normalizedEvents: any[], faultEvents: any[]) {
    const seen = new Set<string>();
    for (const event of normalizedEvents) {
        seen.add(buildFaultDedupeSignature(event));
    }

    const merged = [...normalizedEvents];
    for (const faultEvent of faultEvents) {
        const signature = buildFaultDedupeSignature(faultEvent);
        if (seen.has(signature)) continue;
        seen.add(signature);
        merged.push(faultEvent);
    }

    return merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function buildSessionFaultEvents(
    sessionCrashes: any[],
    sessionAnrs: any[],
    sessionErrors: any[],
    sessionStartMs: number,
    coerceToEpochMs: (raw: unknown, fallbackMs: number) => number
) {
    const crashEvents = sessionCrashes.map((crashRow) => {
        const timestamp = coerceToEpochMs(crashRow.timestamp?.getTime?.() ?? crashRow.timestamp, sessionStartMs);
        const properties: any = {
            crashId: crashRow.id,
            exceptionName: crashRow.exceptionName,
            reason: crashRow.reason,
            stackTrace: crashRow.stackTrace,
            status: crashRow.status,
            deviceMetadata: crashRow.deviceMetadata ?? null,
            consoleMarker: 'RJ_CRASH',
        };
        const primaryMessage = [crashRow.exceptionName || 'Crash', crashRow.reason || '']
            .filter(Boolean)
            .join(': ');
        return {
            id: `crash_evt_${crashRow.id}`,
            type: 'crash',
            timestamp,
            name: crashRow.exceptionName || 'Crash',
            message: primaryMessage || 'Crash detected',
            level: 'error',
            stack: crashRow.stackTrace || undefined,
            properties,
            payload: properties,
        };
    });

    const anrEvents = sessionAnrs.map((anrRow) => {
        const timestamp = coerceToEpochMs(anrRow.timestamp?.getTime?.() ?? anrRow.timestamp, sessionStartMs);
        const stackTrace = resolveAnrStackTrace({
            threadState: anrRow.threadState,
            deviceMetadata: anrRow.deviceMetadata,
        });
        const properties: any = {
            anrId: anrRow.id,
            durationMs: anrRow.durationMs,
            threadState: stackTrace ?? anrRow.threadState,
            stackTrace: stackTrace ?? undefined,
            status: anrRow.status,
            consoleMarker: 'RJ_ANR',
        };
        const detail = Number.isFinite(anrRow.durationMs)
            ? `ANR detected (${anrRow.durationMs} ms blocked)`
            : 'ANR detected';
        return {
            id: `anr_evt_${anrRow.id}`,
            type: 'anr',
            timestamp,
            name: 'ANR',
            message: detail,
            level: 'error',
            stack: stackTrace || undefined,
            durationMs: anrRow.durationMs,
            threadState: stackTrace ?? anrRow.threadState,
            properties,
            payload: properties,
        };
    });

    const errorEvents = sessionErrors.map((errorRow) => {
        const timestamp = coerceToEpochMs(errorRow.timestamp?.getTime?.() ?? errorRow.timestamp, sessionStartMs);
        const properties: any = {
            errorId: errorRow.id,
            errorType: errorRow.errorType,
            errorName: errorRow.errorName,
            message: errorRow.message,
            stack: errorRow.stack,
            screenName: errorRow.screenName,
            status: errorRow.status,
            consoleMarker: 'RJ_ERROR',
        };
        const name = errorRow.errorName || 'Error';
        const message = errorRow.message || 'Runtime error';
        return {
            id: `error_evt_${errorRow.id}`,
            type: 'error',
            timestamp,
            name,
            message,
            level: 'error',
            stack: errorRow.stack || undefined,
            screen: errorRow.screenName || null,
            properties,
            payload: properties,
        };
    });

    return [...crashEvents, ...anrEvents, ...errorEvents];
}

function isWebSyntheticLongTaskAnr(session: any, anrRow: any): boolean {
    const platform = String(session?.platform || session?.deviceInfo?.os || '').toLowerCase();
    if (platform !== 'web') return false;

    const threadState = String(anrRow?.threadState || anrRow?.deviceMetadata?.stack || '').toLowerCase();
    return threadState.includes('main_thread_long_task');
}

function filterDisplayAnrs(session: any, sessionAnrs: any[]) {
    return sessionAnrs.filter((anrRow) => !isWebSyntheticLongTaskAnr(session, anrRow));
}

function mapCrashRowsForPayload(sessionCrashes: any[]) {
    return sessionCrashes.map((crashRow) => ({
        id: crashRow.id,
        timestamp: crashRow.timestamp.getTime(),
        exceptionName: crashRow.exceptionName,
        reason: crashRow.reason,
        stackTrace: crashRow.stackTrace,
        status: crashRow.status,
        deviceMetadata: crashRow.deviceMetadata,
    }));
}

function mapAnrRowsForPayload(sessionAnrs: any[]) {
    return sessionAnrs.map((anrRow) => ({
        id: anrRow.id,
        timestamp: anrRow.timestamp.getTime(),
        durationMs: anrRow.durationMs,
        threadState: resolveAnrStackTrace({
            threadState: anrRow.threadState,
            deviceMetadata: anrRow.deviceMetadata,
        }),
        status: anrRow.status,
    }));
}

function maxReplayEndMsFromArtifacts(
    artifacts: Array<{ kind: string; endTime?: number | null; startTime?: number | null }>
): number | null {
    let max: number | null = null;
    for (const a of artifacts) {
        if (a.kind !== 'screenshots' && a.kind !== 'hierarchy' && a.kind !== 'rrweb') continue;
        const t = a.endTime ?? a.startTime ?? null;
        if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
            max = max === null ? t : Math.max(max, t);
        }
    }
    return max;
}

async function loadTimelinePayload(session: any, artifactsList: any[]) {
    const eventsArtifacts = artifactsList.filter((a) => a.kind === 'events');
    const networkArtifacts = artifactsList.filter((a) => a.kind === 'network');

    const [sessionCrashes, sessionAnrs, sessionErrors, parsedEventsBatches, parsedNetworkBatches] = await Promise.all([
        db.select().from(crashes).where(eq(crashes.sessionId, session.id)).orderBy(desc(crashes.timestamp)),
        db.select().from(anrs).where(eq(anrs.sessionId, session.id)).orderBy(desc(anrs.timestamp)),
        db.select().from(errors).where(eq(errors.sessionId, session.id)).orderBy(desc(errors.timestamp)),
        mapWithConcurrency(eventsArtifacts, DETAIL_FETCH_CONCURRENCY, async (artifact) => {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) return { events: [] as any[], deviceInfo: null as any };
                const parsed = parseArtifactJson(data, artifact.s3ObjectKey);
                if (Array.isArray(parsed)) return { events: parsed, deviceInfo: null as any };
                if (Array.isArray(parsed?.events)) {
                    return { events: parsed.events, deviceInfo: parsed.deviceInfo ?? null };
                }
                return { events: [] as any[], deviceInfo: parsed?.deviceInfo ?? null };
            } catch {
                return { events: [] as any[], deviceInfo: null as any };
            }
        }),
        mapWithConcurrency(networkArtifacts, DETAIL_FETCH_CONCURRENCY, async (artifact) => {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) return [] as any[];
                const parsed = JSON.parse(data.toString());
                if (Array.isArray(parsed)) return parsed;
                if (Array.isArray(parsed?.networkRequests)) return parsed.networkRequests;
                return [] as any[];
            } catch {
                return [] as any[];
            }
        }),
    ]);

    // Core Telemetry events from artifacts
    const artifactEvents = parsedEventsBatches.flatMap((batch) => batch.events);
    const timelineDeviceInfo = parsedEventsBatches
        .map((batch) => batch.deviceInfo)
        .find((deviceInfo) => deviceInfo?.screenWidth && deviceInfo?.screenHeight) ?? null;

    // Custom app-level events persisted on the session record (sessions.events JSONB).
    // These typically come from Rejourney.logEvent() and are not always included in
    // the raw telemetry artifacts, so we merge them here for the timeline.
    const sessionEventsJson: any = (session as any).events;
    const sessionEvents: any[] = Array.isArray(sessionEventsJson) ? sessionEventsJson : [];

    // Avoid double-including custom events that already exist in the artifact payloads.
    const seenCustomKeys = new Set<string>();
    for (const e of artifactEvents) {
        const type = (e?.type || '').toString().toLowerCase();
        if (type === 'custom') {
            const key = `${e.name ?? ''}|${e.timestamp ?? ''}`;
            seenCustomKeys.add(key);
        }
    }

    const extraSessionEvents: any[] = [];
    for (const e of sessionEvents) {
        const type = (e?.type || '').toString().toLowerCase();
        if (type !== 'custom') continue;
        const key = `${e.name ?? ''}|${e.timestamp ?? ''}`;
        if (seenCustomKeys.has(key)) continue;
        extraSessionEvents.push(e);
    }

    const allEvents = [...artifactEvents, ...extraSessionEvents];
    const allNetwork = parsedNetworkBatches.flat();
    const displayAnrs = filterDisplayAnrs(session, sessionAnrs);

    const sessionStartMs = session.startedAt.getTime();
    const timelineReplayEndMs = maxReplayEndMsFromArtifacts(artifactsList);
    const sessionEndMs =
        session.endedAt?.getTime()
        ?? (timelineReplayEndMs != null && timelineReplayEndMs > 0 ? timelineReplayEndMs : undefined)
        ?? session.lastIngestActivityAt?.getTime()
        ?? (sessionStartMs + ((session.durationSeconds ?? 0) * 1000));

    const { normalizedEvents, coerceToEpochMs } = normalizeEventsForTimeline(allEvents, sessionStartMs, sessionEndMs);
    const faultEvents = buildSessionFaultEvents(
        sessionCrashes,
        displayAnrs,
        sessionErrors,
        sessionStartMs,
        coerceToEpochMs
    );
    const mergedEvents = mergeEventsWithFaults(normalizedEvents, faultEvents);

    const networkRequests = [
        ...allNetwork.map((n) => ({ ...n, timestamp: n.timestamp || Date.now() })),
        ...mergedEvents.filter((e) => e.type === 'network_request' || e.type === 'api_request'),
    ]
        .map((e) => {
            const payload = e.payload || e.payloadInline || e;
            const rawUrl = payload.url || e.url || '';
            const safeUrl = (() => {
                if (!rawUrl) return null;
                try {
                    return new URL(rawUrl);
                } catch {
                    try {
                        return new URL(rawUrl, 'http://localhost');
                    } catch {
                        return null;
                    }
                }
            })();
            const requestBodySize =
                payload.requestBodySize ??
                payload.requestSize ??
                e.requestBodySize ??
                e.requestSize ??
                0;
            const responseBodySize =
                payload.responseBodySize ??
                payload.responseSize ??
                e.responseBodySize ??
                e.responseSize ??
                0;
            return {
                id: e.id || `net_${Math.random()}`,
                url: rawUrl,
                method: payload.method || e.method || 'GET',
                statusCode: payload.statusCode || e.statusCode,
                duration: payload.duration || e.duration || 0,
                success: (payload.success ?? e.success) ?? ((payload.statusCode || e.statusCode) < 400),
                timestamp: (e.timestamp || payload.timestamp) || 0,
                host: payload.urlHost || payload.host || safeUrl?.hostname || '',
                path: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                urlHost: payload.urlHost || payload.host || safeUrl?.hostname || '',
                urlPath: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                requestBodySize,
                responseBodySize,
                requestSize: requestBodySize,
                responseSize: responseBodySize,
                error: payload.error || e.error,
            };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

    return {
        events: mergedEvents,
        networkRequests,
        crashes: mapCrashRowsForPayload(sessionCrashes),
        anrs: mapAnrRowsForPayload(displayAnrs),
        deviceInfo: timelineDeviceInfo,
    };
}

async function loadHierarchyPayload(session: any, artifactsList: any[]) {
    const hierarchyArtifacts = artifactsList
        .filter((a) => a.kind === 'hierarchy')
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const snapshots = await mapWithConcurrency(
        hierarchyArtifacts,
        DETAIL_FETCH_CONCURRENCY,
        async (artifact) => {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (!data) return null;
                const parsed = (() => {
                    const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
                        artifact.s3ObjectKey.endsWith('.gz');
                    if (isGzipped) {
                        try {
                            return JSON.parse(gunzipSync(data).toString());
                        } catch {
                            return JSON.parse(data.toString());
                        }
                    }
                    return JSON.parse(data.toString());
                })();
                const rootElement = parsed.rootElement || parsed.root || parsed;
                return {
                    timestamp: artifact.timestamp || parsed.timestamp || 0,
                    screenName: parsed.screenName || null,
                    screen: parsed.screen || rootElement?.screen || null,
                    rootElement,
                };
            } catch {
                return null;
            }
        }
    );

    return snapshots
        .filter((snapshot): snapshot is { timestamp: number; screenName: string | null; rootElement: any; screen: any } => Boolean(snapshot))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

async function sendRrwebSegmentForSession(res: any, session: any, sessionId: string, rawArtifactId: string, cacheControl = 'private, max-age=300') {
    const artifactId = rawArtifactId
        .replace(/\.json\.gz$/i, '')
        .replace(/\.json$/i, '');
    const redis = getRedis();
    const cacheKey = `rrweb_segment_data:${sessionId}:${artifactId}`;

    const sendSegmentData = (data: Buffer, s3ObjectKey?: string | null) => {
        const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
            Boolean(s3ObjectKey?.endsWith('.gz'));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (isGzipped) res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Cache-Control', cacheControl);
        res.setHeader('Content-Length', String(data.length));
        return res.send(data);
    };

    const readCachedSegment = async (): Promise<Buffer | null> => {
        try {
            return await redis.getBuffer(cacheKey);
        } catch (err) {
            logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to read rrweb segment from Redis cache');
            return null;
        }
    };

    const cachedSegment = await readCachedSegment();
    if (cachedSegment) return sendSegmentData(cachedSegment);

    const [artifact] = await db
        .select()
        .from(recordingArtifacts)
        .where(and(
            eq(recordingArtifacts.id, artifactId),
            eq(recordingArtifacts.sessionId, sessionId),
            eq(recordingArtifacts.kind, 'rrweb'),
            eq(recordingArtifacts.status, 'ready'),
        ))
        .limit(1);

    if (!artifact) throw ApiError.notFound('Replay segment not found');

    const lockKey = `rrweb_segment_data_lock:${sessionId}:${artifactId}`;
    const lockToken = randomUUID();
    let lockAcquired = false;

    try {
        const result = await redis.set(lockKey, lockToken, 'EX', SESSION_REPLAY_MANIFEST_LOCK_TTL_SECONDS, 'NX');
        lockAcquired = result === 'OK';
    } catch (err) {
        logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to acquire rrweb segment cache lock');
    }

    if (!lockAcquired) {
        const waitUntil = Date.now() + 5000;
        while (Date.now() < waitUntil) {
            await sleepMs(100);
            const waitedSegment = await readCachedSegment();
            if (waitedSegment) return sendSegmentData(waitedSegment, artifact.s3ObjectKey);
        }
    }

    try {
        const data = await downloadRawFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
        if (!data) throw ApiError.notFound('Replay segment data not found in storage');

        if (data.length <= RRWEB_SEGMENT_DATA_CACHE_MAX_BYTES) {
            try {
                await redis.setex(cacheKey, RRWEB_SEGMENT_DATA_CACHE_TTL_SECONDS, data);
            } catch (err) {
                logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to cache rrweb segment data');
            }
        }

        return sendSegmentData(data, artifact.s3ObjectKey);
    } finally {
        if (lockAcquired) {
            try {
                const currentToken = await redis.get(lockKey);
                if (currentToken === lockToken) {
                    await redis.del(lockKey);
                }
            } catch (err) {
                logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to release rrweb segment cache lock');
            }
        }
    }
}

async function sendScreenshotFrameForSession(res: any, session: any, sessionId: string, rawArtifactId: string, cacheControl = 'private, max-age=300') {
    const isTimestamp = /^\d+(\.jpg)?$/.test(rawArtifactId);
    const targetTimestampMs = isTimestamp ? parseInt(rawArtifactId.replace(/\.jpg$/, ''), 10) : NaN;
    const redis = getRedis();
    let cacheKey = '';

    const sendFrameData = (data: Buffer) => {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', cacheControl);
        res.setHeader('Content-Length', String(data.length));
        return res.send(data);
    };

    const readCachedFrame = async (): Promise<Buffer | null> => {
        if (!cacheKey) return null;
        try {
            return await redis.getBuffer(cacheKey);
        } catch (err) {
            logger.warn({ err, sessionId }, '[sessions] Failed to read frame from Redis cache');
            return null;
        }
    };

    if (isTimestamp && !isNaN(targetTimestampMs)) {
        cacheKey = `screenshot_frame_data:${sessionId}:${targetTimestampMs}`;
        const cachedFrame = await readCachedFrame();
        if (cachedFrame) return sendFrameData(cachedFrame);
    }

    const [replayEndRow] = await db
        .select({ maxEnd: sql<number | null>`max(${recordingArtifacts.endTime})` })
        .from(recordingArtifacts)
        .where(and(
            eq(recordingArtifacts.sessionId, sessionId),
            inArray(recordingArtifacts.kind, ['screenshots', 'hierarchy', 'rrweb']),
            eq(recordingArtifacts.status, 'ready'),
        ));

    const sessionStartMs = session.startedAt.getTime();
    const replayEndMs = replayEndRow?.maxEnd ?? null;
    const effectiveSessionEnd = session.endedAt
        ?? (replayEndMs != null && replayEndMs > 0 ? new Date(replayEndMs) : null)
        ?? (session.lastIngestActivityAt && session.lastIngestActivityAt > session.startedAt ? session.lastIngestActivityAt : null);
    const sessionEndMs = effectiveSessionEnd ? effectiveSessionEnd.getTime() : Number.MAX_SAFE_INTEGER;
    const lowerBoundMs = Math.max(0, sessionStartMs - 30_000);
    const upperBoundMs = sessionEndMs + 120_000;

    if (!isTimestamp || isNaN(targetTimestampMs)) {
        const artifactId = rawArtifactId.replace(/\.json\.gz$/, '').replace(/\.jpg$/, '');
        const [artifact] = await db
            .select()
            .from(recordingArtifacts)
            .where(and(eq(recordingArtifacts.id, artifactId), eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.kind, 'frames')))
            .limit(1);

        if (!artifact) throw ApiError.notFound('Frame not found');

        const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
        if (!data) throw ApiError.notFound('Frame data not found in storage');
        return sendFrameData(data);
    }

    const artifacts = await db
        .select({
            id: recordingArtifacts.id,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
            startTime: recordingArtifacts.startTime,
            endTime: recordingArtifacts.endTime,
            timestamp: recordingArtifacts.timestamp,
        })
        .from(recordingArtifacts)
        .where(and(
            eq(recordingArtifacts.sessionId, sessionId),
            eq(recordingArtifacts.kind, 'screenshots'),
            eq(recordingArtifacts.status, 'ready'),
        ))
        .orderBy(recordingArtifacts.startTime, recordingArtifacts.timestamp, recordingArtifacts.createdAt);

    if (artifacts.length === 0) throw ApiError.notFound('No ready screenshot artifacts found for session');

    let bestArtifact = artifacts[0];
    for (const artifact of artifacts) {
        const artifactStartMs = artifact.startTime ?? artifact.timestamp ?? sessionStartMs;
        const artifactEndMs = artifact.endTime ?? artifactStartMs + 10_000;

        if (targetTimestampMs >= artifactStartMs && targetTimestampMs <= artifactEndMs) {
            bestArtifact = artifact;
            break;
        }
        if (artifactStartMs > targetTimestampMs) break;
        bestArtifact = artifact;
    }

    const archiveLockKey = `screenshot_frame_archive_lock:${sessionId}:${bestArtifact.id}`;
    const archiveLockToken = randomUUID();
    let archiveLockAcquired = false;

    const tryAcquireArchiveLock = async () => {
        try {
            const result = await redis.set(
                archiveLockKey,
                archiveLockToken,
                'EX',
                SCREENSHOT_FRAME_ARCHIVE_LOCK_TTL_SECONDS,
                'NX',
            );
            return result === 'OK';
        } catch (err) {
            logger.warn({ err, sessionId, artifactId: bestArtifact.id }, '[sessions] Failed to acquire screenshot archive extraction lock');
            return false;
        }
    };

    const releaseArchiveLock = async () => {
        if (!archiveLockAcquired) return;
        try {
            const currentToken = await redis.get(archiveLockKey);
            if (currentToken === archiveLockToken) {
                await redis.del(archiveLockKey);
            }
        } catch (err) {
            logger.warn({ err, sessionId, artifactId: bestArtifact.id }, '[sessions] Failed to release screenshot archive extraction lock');
        }
    };

    const extractArchiveAndCacheFrames = async (): Promise<Buffer | null> => {
        const archiveData = await downloadFromS3ForArtifact(session.projectId, bestArtifact.s3ObjectKey, bestArtifact.endpointId);
        if (!archiveData) return null;

        const { extractFramesFromArchive } = await import('../services/screenshotFrames.js');
        const frames = await extractFramesFromArchive(archiveData, sessionStartMs);

        let targetFrameData: Buffer | null = null;
        let minDiff = Number.MAX_SAFE_INTEGER;

        for (const frame of frames) {
            if (frame.timestamp < lowerBoundMs || frame.timestamp > upperBoundMs) {
                continue;
            }
            const frameCacheKey = `screenshot_frame_data:${sessionId}:${frame.timestamp}`;
            try {
                await redis.setex(frameCacheKey, SCREENSHOT_FRAME_DATA_CACHE_TTL_SECONDS, frame.data);
            } catch (err) {
                logger.warn({ err, sessionId }, '[sessions] Failed to write extracted frame to Redis cache');
            }

            const diff = Math.abs(frame.timestamp - targetTimestampMs);
            if (diff < minDiff) {
                minDiff = diff;
                targetFrameData = frame.data;
            }
        }

        return targetFrameData;
    };

    archiveLockAcquired = await tryAcquireArchiveLock();
    if (!archiveLockAcquired) {
        const waitUntil = Date.now() + SCREENSHOT_FRAME_ARCHIVE_LOCK_WAIT_MS;
        while (Date.now() < waitUntil) {
            await sleepMs(100);
            const cachedFrame = await readCachedFrame();
            if (cachedFrame) return sendFrameData(cachedFrame);
        }
        archiveLockAcquired = await tryAcquireArchiveLock();
    }

    try {
        const cachedAfterWait = await readCachedFrame();
        if (cachedAfterWait) return sendFrameData(cachedAfterWait);

        const targetFrameData = await extractArchiveAndCacheFrames();
        if (!targetFrameData) throw ApiError.notFound('Frame data not found inside archive');
        return sendFrameData(targetFrameData);
    } finally {
        await releaseArchiveLock();
    }
}

/**
 * GET /api/session/share/replay/:shareToken/core
 */
router.get(
    '/share/replay/:shareToken/core',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const shareToken = req.params.shareToken;
        const { link, session, metrics } = await resolvePublicReplayShareContext(shareToken, { markAccess: true });
        const includeReplay = shouldIncludeReplayFromQuery(req.query.includeReplay);

        const [artifactsList, aggregate, successorStartedAt] = await Promise.all([
            getReadyArtifacts(session.id),
            loadSessionWorkAggregate(session.id),
            loadSuccessorSessionStartedAt({
                sessionId: session.id,
                projectId: session.projectId,
                deviceId: session.deviceId,
                startedAt: session.startedAt,
            }),
        ]);
        const supersededByNewerVisitorSession = shouldTreatSessionAsSuperseded(session, aggregate, successorStartedAt);
        const screenshotArtifacts = artifactsList.filter((a) => a.kind === 'screenshots');
        const rrwebArtifacts = artifactsList.filter((a) => a.kind === 'rrweb');
        const [replayBootstrap, stats] = await Promise.all([
            includeReplay
                ? loadVisualReplayBootstrap(session, screenshotArtifacts.length, rrwebArtifacts, 'none')
                : Promise.resolve(buildDeferredVisualReplayBootstrap(session, screenshotArtifacts.length, rrwebArtifacts)),
            computeSessionStats(session, metrics, artifactsList, false),
        ]);

        const basePayload = buildSessionBasePayload(
            session,
            metrics,
            replayBootstrap.screenshotFrames,
            screenshotArtifacts.length > 0,
            deriveSessionPresentationState({
                status: session.status,
                platform: session.platform,
                replayAvailable: hasSuccessfulRecording(session, metrics, screenshotArtifacts.length > 0),
                recordingDeleted: session.recordingDeleted,
                isReplayExpired: session.isReplayExpired,
                lastIngestActivityAt: session.lastIngestActivityAt,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                hasPendingWork: aggregate.hasPendingWork,
                hasPendingProcessingWork: aggregate.hasPendingProcessingWork,
                hasPendingReplayWork: aggregate.hasPendingReplayWork,
                supersededByNewerVisitorSession,
            }),
            aggregate.latestReplayArtifactEndMs,
        );

        const responseBody = rewriteVisualAssetsForShare({
            ...basePayload,
            hasRecording: replayBootstrap.hasRecording,
            playbackMode: replayBootstrap.playbackMode,
            screenshotFrames: replayBootstrap.screenshotFrames,
            screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
            screenshotFrameCount: replayBootstrap.screenshotFrameCount,
            screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
            screenshotFramesTotalSegments: replayBootstrap.totalSegments,
            rrwebReplay: replayBootstrap.rrwebReplay,
            stats,
        }, shareToken);

        res.json(applyCoreShareVisibility(responseBody, link));
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/replay-manifest
 */
router.get(
    '/share/replay/:shareToken/replay-manifest',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const shareToken = req.params.shareToken;
        const { link, session } = await resolvePublicReplayShareContext(shareToken);
        const { payload } = await buildReplayManifestPayload(session, 'none');
        res.json({
            ...rewriteVisualAssetsForShare(payload, shareToken),
            share: {
                visibility: link.visibility,
                expiresAt: link.expiresAt?.toISOString() ?? null,
            },
        });
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/frames
 */
router.get(
    '/share/replay/:shareToken/frames',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const shareToken = req.params.shareToken;
        const { session } = await resolvePublicReplayShareContext(shareToken);
        const { payload } = await buildScreenshotFramesPayload(session, 'none');
        res.json({
            ...payload,
            screenshotFrames: rewriteScreenshotFramesForShare(payload.screenshotFrames, shareToken),
        });
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/timeline
 */
router.get(
    '/share/replay/:shareToken/timeline',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const { link, session } = await resolvePublicReplayShareContext(req.params.shareToken);
        const artifactsList = await getReadyArtifacts(session.id);
        const timeline = await loadTimelinePayload(session, artifactsList);
        res.json(filterTimelineForShareVisibility(timeline, link.visibility as ReplayShareVisibility));
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/hierarchy
 */
router.get(
    '/share/replay/:shareToken/hierarchy',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const { link, session } = await resolvePublicReplayShareContext(req.params.shareToken);
        if (link.visibility !== 'full_workbench') {
            res.json({ hierarchySnapshots: [] });
            return;
        }
        const artifactsList = await getReadyArtifacts(session.id);
        res.json({ hierarchySnapshots: await loadHierarchyPayload(session, artifactsList) });
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/stats
 */
router.get(
    '/share/replay/:shareToken/stats',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const { session, metrics } = await resolvePublicReplayShareContext(req.params.shareToken);
        const artifactsList = await getReadyArtifacts(session.id);
        res.json({ stats: await computeSessionStats(session, metrics, artifactsList, false) });
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/rrweb-segment/:artifactId
 */
router.get(
    '/share/replay/:shareToken/rrweb-segment/:artifactId',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const { session } = await resolvePublicReplayShareContext(req.params.shareToken);
        return sendRrwebSegmentForSession(res, session, session.id, req.params.artifactId, 'no-store');
    }),
);

/**
 * GET /api/session/share/replay/:shareToken/frame/:artifactId
 */
router.get(
    '/share/replay/:shareToken/frame/:artifactId',
    replayShareRateLimiter,
    asyncHandler(async (req, res) => {
        setPublicReplayHeaders(res);
        const { session } = await resolvePublicReplayShareContext(req.params.shareToken);
        return sendScreenshotFrameForSession(res, session, session.id, req.params.artifactId, 'no-store');
    }),
);

/**
 * GET /api/session/:id/shares
 */
router.get(
    '/:id/shares',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, teamId, membership } = await getAuthorizedSession(req.user!.id, req.params.id);
        const canManage = canManageReplayShares(membership.role);
        const shares = canManage
            ? await listReplayShareLinksForSession(session.id, getDashboardOrigin(req))
            : [];

        res.json({
            canManage,
            teamId,
            shares,
        });
    }),
);

/**
 * POST /api/session/:id/shares
 */
router.post(
    '/:id/shares',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    validate(createReplayShareLinkSchema, 'body'),
    writeApiRateLimiter,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, teamId, membership } = await getAuthorizedSession(req.user!.id, req.params.id);
        if (!canManageReplayShares(membership.role)) {
            throw ApiError.forbidden('Only team owners and admins can create unlisted replay links');
        }
        if (!hasSuccessfulRecording(session)) {
            throw ApiError.badRequest('This replay is not available for sharing');
        }

        const visibility = req.body.visibility as ReplayShareVisibility;
        const expirationPreset = req.body.expiresIn;
        const result = await createOrReuseReplayShareLink({
            sessionId: session.id,
            projectId: session.projectId,
            teamId,
            createdByUserId: req.user!.id,
            visibility,
            expirationPreset,
        });
        const origin = getDashboardOrigin(req);
        const share = serializeReplayShareLink(result.link, origin);

        if (!result.reused) {
            await auditFromRequest(req, 'replay_share_created', {
                targetType: 'replay_share',
                targetId: result.link.id,
                teamId,
                newValue: {
                    sessionId: session.id,
                    projectId: session.projectId,
                    visibility,
                    expirationPreset,
                    expiresAt: result.link.expiresAt,
                },
            });
        }

        res.status(result.reused ? 200 : 201).json({
            share,
            reused: result.reused,
            url: buildReplayShareUrl(origin, result.link.publicId),
        });
    }),
);

/**
 * DELETE /api/session/:id/shares/:shareId
 */
router.delete(
    '/:id/shares/:shareId',
    sessionAuth,
    validate(replayShareIdParamSchema, 'params'),
    writeApiRateLimiter,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, teamId, membership } = await getAuthorizedSession(req.user!.id, req.params.id);
        if (!canManageReplayShares(membership.role)) {
            throw ApiError.forbidden('Only team owners and admins can revoke unlisted replay links');
        }

        const [existing] = await db
            .select()
            .from(replayShareLinks)
            .where(and(
                eq(replayShareLinks.id, req.params.shareId),
                eq(replayShareLinks.sessionId, session.id),
                eq(replayShareLinks.teamId, teamId),
            ))
            .limit(1);

        if (!existing) throw ApiError.notFound('Replay share link not found');

        const revokedAt = existing.revokedAt ?? new Date();
        const [revoked] = await db
            .update(replayShareLinks)
            .set({
                revokedAt,
                updatedAt: revokedAt,
            })
            .where(and(
                eq(replayShareLinks.id, existing.id),
                eq(replayShareLinks.sessionId, session.id),
                eq(replayShareLinks.teamId, teamId),
            ))
            .returning();

        if (!existing.revokedAt) {
            await auditFromRequest(req, 'replay_share_revoked', {
                targetType: 'replay_share',
                targetId: existing.id,
                teamId,
                previousValue: {
                    sessionId: session.id,
                    projectId: session.projectId,
                    visibility: existing.visibility,
                    expirationPreset: existing.expirationPreset,
                    expiresAt: existing.expiresAt,
                },
                newValue: { revokedAt },
            });
        }

        res.json({
            share: serializeReplayShareLink(revoked ?? { ...existing, revokedAt }, getDashboardOrigin(req)),
        });
    }),
);

/**
 * Export sessions as CSV
 * GET /api/sessions/export
 */
router.get(
    '/export',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const {
            timeRange,
            projectId,
            platform,
            status,
            hasRecording,
            metaKey,
            metaValue,
            metaFilters,
            eventName,
            date,
            eventCountOp,
            eventCountValue,
            eventPropKey,
            eventPropValue,
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
            conditionLogic,
            q,
            sort: sortRaw,
            sortDir: sortDirRaw,
            locale,
            timeZone,
        } = req.query as any;

        const sortKey = normalizeArchiveListSortKey(sortRaw);
        const sortDir = normalizeArchiveListSortDir(sortDirRaw);
        const exportSortExpr = archiveListSortSqlExpr(sortKey);
        const exportOrderPrimary = sortDir === 'desc' ? desc(exportSortExpr) : asc(exportSortExpr);
        const exportOrderSecondary = sortDir === 'desc' ? desc(sessions.id) : asc(sessions.id);

        // Get user's accessible project IDs
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.status(404).send('No accessible projects');
            return;
        }

        const accessibleProjectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const accessibleProjectIds = accessibleProjectsList.map((p) => p.id);

        if (accessibleProjectIds.length === 0) {
            res.status(404).send('No accessible projects');
            return;
        }

        const { baseConditions } = buildSessionArchiveBaseConditions(
            {
                timeRange,
                projectId,
                platform,
                status,
                hasRecording,
                metaKey,
                metaValue,
                metaFilters,
                eventName,
                date,
                eventCountOp,
                eventCountValue,
                eventPropKey,
                eventPropValue,
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
                geoCountry: typeof req.query.geoCountry === 'string' ? req.query.geoCountry : undefined,
                geoCity: typeof req.query.geoCity === 'string' ? req.query.geoCity : undefined,
                conditionLogic,
                q: typeof q === 'string' ? q : undefined,
            },
            accessibleProjectIds
        );

        const exportDateTimeFormatters = createSessionExportDateTimeFormatters(locale, timeZone);

        // Get sessions with metrics - NO LIMIT for export
        const sessionsList = await db
            .select({
                session: { ...sessionsArchiveListColumns },
                metrics: sessionMetrics,
                latestReplayArtifactEndMs: archiveListLatestReplayEndMsSql,
                hasNewerSessionOnVisitor: archiveListHasNewerVisitorSessionSql,
                visitorSessionNumber: archiveVisitorSessionNumberSql,
                visitorFinalSessionNumber: archiveVisitorFinalSessionNumberSql,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...baseConditions))
            .orderBy(exportOrderPrimary, exportOrderSecondary);

        // Set Headers for CSV Download
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="sessions_export_${new Date().toISOString().split('T')[0]}.csv"`);

        res.write(`${encodeCsvRow(SESSION_EXPORT_CSV_HEADERS)}\n`);

        for (const {
            session: s,
            metrics: m,
            latestReplayArtifactEndMs,
            hasNewerSessionOnVisitor,
            visitorSessionNumber,
            visitorFinalSessionNumber,
        } of sessionsList) {
            const durationSec = durationSecondsForDisplay({
                ...s,
                latestReplayEndMs: latestReplayArtifactEndMs,
                replayAvailable: s.replayAvailable,
            });
            const successfulRecording = hasSuccessfulRecording(s, m, false);
            const presentationState = deriveSessionPresentationState({
                status: s.status,
                platform: s.platform,
                replayAvailable: successfulRecording,
                recordingDeleted: s.recordingDeleted,
                isReplayExpired: s.isReplayExpired,
                lastIngestActivityAt: s.lastIngestActivityAt,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                hasPendingWork: false,
                hasPendingReplayWork: false,
                supersededByNewerVisitorSession: Boolean(hasNewerSessionOnVisitor),
            });
            const anonymousDisplayName = s.deviceId ? generateAnonymousName(s.deviceId) : null;

            res.write(`${encodeCsvRow(buildSessionExportCsvRow({
                session: s,
                metrics: m,
                presentation: presentationState,
                durationSeconds: durationSec,
                successfulRecording,
                isFirstSession: visitorSessionNumber === 1,
                anonymousDisplayName,
                visitorSessionNumber,
                visitorFinalSessionNumber,
                formatters: exportDateTimeFormatters,
            }))}\n`);
        }

        res.end();
    })
);

/**
 * Get sessions list
 * GET /api/sessions
 */
router.get(
    '/',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const {
            timeRange,
            projectId,
            platform,
            status,
            limit = 50,
            offset = 0,
            cursor,
            hasRecording,
            metaKey,
            metaValue,
            metaFilters,
            eventName,
            date,
            eventCountOp,
            eventCountValue,
            eventPropKey,
            eventPropValue,
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
            conditionLogic,
            q,
            geoCountry,
            geoCity,
            sort: sortRaw,
            sortDir: sortDirRaw,
            includeTotal: includeTotalRaw,
            countOnly: countOnlyRaw,
        } = req.query as any;
        const parsedLimit = Math.min(parseInt(limit) || 50, 300); // Max 300 per request
        const includeTotal = includeTotalRaw !== 'false' && includeTotalRaw !== '0';
        const countOnly = countOnlyRaw === 'true' || countOnlyRaw === '1';
        const sortKey = normalizeArchiveListSortKey(sortRaw);
        const sortDir = normalizeArchiveListSortDir(sortDirRaw);

        // Get user's accessible project IDs
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.json({ sessions: [], nextCursor: null, hasMore: false, totalCount: 0 });
            return;
        }

        const accessibleProjectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)));

        const accessibleProjectIds = accessibleProjectsList.map((p) => p.id);

        if (accessibleProjectIds.length === 0) {
            res.json({ sessions: [], nextCursor: null, hasMore: false, totalCount: 0 });
            return;
        }

        const { baseConditions, needsMetricsJoin } = buildSessionArchiveBaseConditions(
            {
                timeRange,
                projectId,
                platform,
                status,
                hasRecording,
                metaKey,
                metaValue,
                metaFilters,
                eventName,
                date,
                eventCountOp,
                eventCountValue,
                eventPropKey,
                eventPropValue,
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
                geoCountry: typeof geoCountry === 'string' ? geoCountry : undefined,
                geoCity: typeof geoCity === 'string' ? geoCity : undefined,
                conditionLogic,
                q: typeof q === 'string' ? q : undefined,
            },
            accessibleProjectIds
        );

        const needsMetricsJoinEffective = needsMetricsJoin || archiveListSortNeedsMetricsJoin(sortKey);
        const sortExpr = archiveListSortSqlExpr(sortKey);
        const orderPrimary = sortDir === 'desc' ? desc(sortExpr) : asc(sortExpr);
        const orderSecondary = sortDir === 'desc' ? desc(sessions.id) : asc(sessions.id);

        const dataConditions = [...baseConditions];
        if (cursor) {
            const parsedCursor = parseArchiveListCursor(cursor);
            if (parsedCursor && archiveKeysetMatchesRequest(parsedCursor, sortKey, sortDir)) {
                const keysetSql = buildArchiveListKeysetCondition(sortKey, sortDir, parsedCursor);
                if (keysetSql) dataConditions.push(keysetSql);
            }
        }

        const runCountQuery = () =>
            needsMetricsJoinEffective
                ? db
                      .select({ count: sql<number>`count(*)::int` })
                      .from(sessions)
                      .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
                      .where(and(...baseConditions))
                : db
                      .select({ count: sql<number>`count(*)::int` })
                      .from(sessions)
                      .where(and(...baseConditions));

        if (countOnly) {
            const countResult = await runCountQuery();
            res.json({
                sessions: [],
                nextCursor: null,
                hasMore: false,
                totalCount: countResult[0]?.count ?? 0,
            });
            return;
        }

        // List payload: one correlated EXISTS for visitor supersession (stops false LIVE on old rows). Omit events/metadata JSONB.
        const dataQuery = db
            .select({
                session: { ...sessionsArchiveListColumns },
                metrics: sessionMetrics,
                latestReplayArtifactEndMs: archiveListLatestReplayEndMsSql,
                hasNewerSessionOnVisitor: archiveListHasNewerVisitorSessionSql,
                visitorSessionNumber: archiveVisitorSessionNumberSql,
                visitorFinalSessionNumber: archiveVisitorFinalSessionNumberSql,
                checkoutEntered: archiveCheckoutEnteredSql,
                checkoutSucceeded: archiveCheckoutSucceededSql,
                webReferral: archiveWebReferralSql,
                webLandingRoute: archiveWebLandingRouteSql,
                archiveSortKey: sortExpr.as('archive_sort_key'),
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(and(...dataConditions))
            .orderBy(orderPrimary, orderSecondary)
            .limit(parsedLimit + 1)
            .offset(cursor ? 0 : parseInt(offset) || 0);

        const [sessionsList, countRows] = includeTotal
            ? await Promise.all([dataQuery, runCountQuery()])
            : [await dataQuery, null];

        const totalCount = includeTotal ? (countRows![0]?.count ?? 0) : null;

        // Determine if there are more results
        const hasMore = sessionsList.length > parsedLimit;
        const resultSessions = hasMore ? sessionsList.slice(0, parsedLimit) : sessionsList;
        const lastListRow = resultSessions[resultSessions.length - 1];
        let nextCursor: string | null = null;
        if (hasMore && lastListRow) {
            const { kt, kn } = extractArchiveSortKeyFromRow(sortKey, {
                archiveSortKey: lastListRow.archiveSortKey,
                session: lastListRow.session,
            });
            nextCursor = encodeArchiveListCursor({
                sortKey,
                sortDir,
                id: lastListRow.session.id,
                kt,
                kn,
            });
        }

        const firstSessionIds = await resolveArchiveFirstSessionIds(resultSessions);

        // Transform to API format
        const sessionsData = resultSessions.map(
            ({ session: s, metrics: m, latestReplayArtifactEndMs, hasNewerSessionOnVisitor, visitorSessionNumber, visitorFinalSessionNumber, checkoutEntered, checkoutSucceeded, webReferral, webLandingRoute }) => {
            const durationSec = durationSecondsForDisplay({
                ...s,
                latestReplayEndMs: latestReplayArtifactEndMs,
                replayAvailable: s.replayAvailable,
            });
            const successfulRecording = hasSuccessfulRecording(s, m, false);
            /**
             * Archive list intentionally skips per-row artifact/job EXISTS (perf). Do not infer
             * pending work from `status === 'processing'` — that forced hasPendingReplayWork=true,
             * blocked shouldFinalize in deriveSessionPresentationState, and kept rows "LIVE" /
             * background-processing in the UI long after ingest went quiet.
             */
            const presentationState = deriveSessionPresentationState({
                status: s.status,
                platform: s.platform,
                replayAvailable: successfulRecording,
                recordingDeleted: s.recordingDeleted,
                isReplayExpired: s.isReplayExpired,
                lastIngestActivityAt: s.lastIngestActivityAt,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                hasPendingWork: false,
                hasPendingReplayWork: false,
                supersededByNewerVisitorSession: Boolean(hasNewerSessionOnVisitor),
            });
            const frustrationCounts = effectiveFrustrationCountsForSession(s, m);
            return {
                id: s.id,
                projectId: s.projectId,
                userId: s.userDisplayId || null,
                anonymousId: s.anonymousDisplayId || s.anonymousHash,
                deviceId: s.deviceId,
                anonymousDisplayName: s.deviceId ? generateAnonymousName(s.deviceId) : null,
                platform: s.platform,
                appVersion: s.appVersion,
                sdkVersion: s.sdkVersion,
                deviceModel: s.deviceModel,
                osVersion: s.osVersion,
                startedAt: s.startedAt.toISOString(),
                endedAt: s.endedAt?.toISOString(),
                durationSeconds: durationSec,
                backgroundTimeSeconds: s.backgroundTimeSeconds ?? 0,
                // playableDuration is now same as durationSeconds (background already excluded)
                playableDuration: durationSec,
                status: s.status,
                replayRetentionState: s.replayRetentionState,
                smartCaptureStatus: s.smartCaptureStatus,
                smartCaptureReason: s.smartCaptureReason,
                smartCaptureRuleId: s.smartCaptureRuleId,
                smartCaptureDecidedAt: s.smartCaptureDecidedAt?.toISOString() ?? null,
                ...buildSessionPresentationPayload(presentationState),
                webReferral,
                webLandingRoute,
                isFirstSession: firstSessionIds.has(s.id),
                // Metrics
                touchCount: m?.touchCount ?? 0,
                scrollCount: m?.scrollCount ?? 0,
                gestureCount: m?.gestureCount ?? 0,
                inputCount: m?.inputCount ?? 0,
                errorCount: m?.errorCount ?? 0,
                rageTapCount: frustrationCounts.rageTapCount,
                deadTapCount: frustrationCounts.deadTapCount,
                frustrationCountsVersion: frustrationCounts.frustrationCountsVersion,
                frustrationCountsPendingRepair: frustrationCounts.frustrationCountsPendingRepair,
                apiSuccessCount: m?.apiSuccessCount ?? 0,
                apiErrorCount: m?.apiErrorCount ?? 0,
                apiTotalCount: m?.apiTotalCount ?? 0,
                apiAvgResponseMs: m?.apiAvgResponseMs ?? 0,
                interactionScore: m?.interactionScore ?? 0,
                explorationScore: m?.explorationScore ?? 0,
                uxScore: m?.uxScore ?? 0,
                screensVisited: m?.screensVisited ?? [],
                customEventCount: m?.customEventCount ?? 0,
                crashCount: m?.crashCount ?? 0,
                anrCount: m?.anrCount ?? 0,
                appStartupTimeMs: m?.appStartupTimeMs ?? null,
                // Network
                networkType: m?.networkType ?? null,
                cellularGeneration: m?.cellularGeneration ?? null,
                // Geo
                geoLocation: s.geoCity
                    ? {
                        city: s.geoCity,
                        region: s.geoRegion,
                        country: s.geoCountry,
                        countryCode: s.geoCountryCode,
                        latitude: s.geoLatitude,
                        longitude: s.geoLongitude,
                        timezone: s.geoTimezone,
                    }
                    : null,
                // Retention
                retentionTier: s.retentionTier,
                retentionDays: s.retentionDays,
                recordingDeleted: s.recordingDeleted,
                recordingDeletedAt: s.recordingDeletedAt?.toISOString() ?? null,
                isReplayExpired: s.isReplayExpired,
                hasSuccessfulRecording: successfulRecording,
                visitorSessionNumber: visitorSessionNumber || null,
                visitorFinalSessionNumber: visitorFinalSessionNumber || null,
                checkoutStatus: checkoutSucceeded ? 'success' : checkoutEntered ? 'bounced' : 'none',
                // Stats
                stats: {
                    duration: String(durationSec),
                    durationMinutes: String((durationSec / 60).toFixed(2)),
                    eventCount: m?.totalEvents ?? 0,
                    screenshotSegmentCount: m?.screenshotSegmentCount ?? 0,
                    totalSizeKB: String(((m?.eventsSizeBytes ?? 0) + (m?.screenshotTotalBytes ?? 0)) / 1024),
                    eventsSizeKB: String((m?.eventsSizeBytes ?? 0) / 1024),
                    screenshotSizeKB: String((m?.screenshotTotalBytes ?? 0) / 1024),
                    networkStats: {
                        total: m?.apiTotalCount ?? 0,
                        successful: m?.apiSuccessCount ?? 0,
                        failed: m?.apiErrorCount ?? 0,
                        avgDuration: m?.apiAvgResponseMs ?? 0,
                    },
                },
            };
        });

        res.json({
            sessions: sessionsData,
            nextCursor,
            hasMore,
            totalCount,
        });
    })
);

/**
 * Get session details
 * GET /api/session/:id
 */
router.get(
    '/:id',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        // Get session with project info
        const [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
                teamId: projects.teamId,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .where(eq(sessions.id, req.params.id))
            .limit(1);

        if (!sessionResult) {
            throw ApiError.notFound('Session not found');
        }

        const session = sessionResult.session;
        const metrics = sessionResult.metrics;
        const [aggregate, successorStartedAt] = await Promise.all([
            loadSessionWorkAggregate(session.id),
            loadSuccessorSessionStartedAt({
                sessionId: session.id,
                projectId: session.projectId,
                deviceId: session.deviceId,
                startedAt: session.startedAt,
            }),
        ]);
        const supersededByNewerVisitorSession = shouldTreatSessionAsSuperseded(session, aggregate, successorStartedAt);
        const presentationState = deriveSessionPresentationState({
            status: session.status,
            platform: session.platform,
            replayAvailable: hasSuccessfulRecording(session, metrics, false),
            recordingDeleted: session.recordingDeleted,
            isReplayExpired: session.isReplayExpired,
            lastIngestActivityAt: session.lastIngestActivityAt,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            hasPendingWork: aggregate.hasPendingWork,
            hasPendingProcessingWork: aggregate.hasPendingProcessingWork,
            hasPendingReplayWork: aggregate.hasPendingReplayWork,
            supersededByNewerVisitorSession,
        });

        // Verify user has access
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, sessionResult.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('No access to this session');
        }

        // Get crashes for this session
        const sessionCrashes = await db
            .select()
            .from(crashes)
            .where(eq(crashes.sessionId, session.id))
            .orderBy(desc(crashes.timestamp));

        // Get ANRs for this session (used for timeline markers + player overlay)
        const sessionAnrs = await db
            .select()
            .from(anrs)
            .where(eq(anrs.sessionId, session.id))
            .orderBy(desc(anrs.timestamp));

        const sessionErrors = await db
            .select()
            .from(errors)
            .where(eq(errors.sessionId, session.id))
            .orderBy(desc(errors.timestamp));

        // Get recording artifacts
        const artifactsList = await db
            .select()
            .from(recordingArtifacts)
            .where(and(eq(recordingArtifacts.sessionId, session.id), eq(recordingArtifacts.status, 'ready')));

        // Get signed URLs for artifacts if not expired
        const eventsUrls: string[] = [];
        const allEvents: any[] = [];
        const allNetwork: any[] = [];
        let artifactDeviceInfo: any = null;

        const hierarchySnapshots: { timestamp: number; screenName: string | null; rootElement: any; screen?: any }[] = [];

        // Session data artifacts are loaded when present. Retention can purge all
        // artifact rows later while keeping the session row and metrics intact.
        const eventsArtifacts = artifactsList.filter((a) => a.kind === 'events');
        const hierarchyArtifacts = artifactsList.filter((a) => a.kind === 'hierarchy');
        const networkArtifacts = artifactsList.filter((a) => a.kind === 'network');
        // Screenshot artifacts only exist if recording is still retained.
        const screenshotArtifacts = (!session.isReplayExpired && !session.recordingDeleted)
            ? artifactsList.filter((a) => a.kind === 'screenshots')
            : [];
        const rrwebArtifacts = (!session.isReplayExpired && !session.recordingDeleted)
            ? artifactsList.filter((a) => a.kind === 'rrweb')
            : [];

        // Compute total storage used in S3 for this session's artifacts.
        // Prefer `recording_artifacts.size_bytes` (populated during ingest), and fall back to S3 HEAD.
        const bytesByKind: Record<string, number> = {};
        let totalBytes = 0;
        const addBytes = (kind: string, bytes: number) => {
            bytesByKind[kind] = (bytesByKind[kind] || 0) + bytes;
            totalBytes += bytes;
        };

        const artifactsMissingSize = artifactsList.filter((a) => a.sizeBytes == null);
        for (const a of artifactsList) {
            if (typeof a.sizeBytes === 'number' && Number.isFinite(a.sizeBytes)) {
                addBytes(a.kind, a.sizeBytes);
            }
        }

        // Only HEAD objects for the ones missing size_bytes (avoid downloading payloads).
        // Keep it sequential to avoid hammering MinIO in dev.
        for (const a of artifactsMissingSize) {
            const size = await getObjectSizeBytesForArtifact(session.projectId, a.s3ObjectKey, a.endpointId);
            if (typeof size === 'number' && Number.isFinite(size)) {
                addBytes(a.kind, size);
            }
        }

        // Download and parse all event artifacts that remain after retention.
        for (const artifact of eventsArtifacts) {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (data) {
                    const parsed = parseArtifactJson(data, artifact.s3ObjectKey);
                    if (parsed.events) {
                        allEvents.push(...parsed.events);
                        if (!artifactDeviceInfo && parsed.deviceInfo?.screenWidth && parsed.deviceInfo?.screenHeight) {
                            artifactDeviceInfo = parsed.deviceInfo;
                        }
                    } else if (Array.isArray(parsed)) {
                        allEvents.push(...parsed);
                    }
                }
                const url = artifact.endpointId
                    ? await getSignedDownloadUrl(artifact.endpointId, artifact.s3ObjectKey)
                    : await getSignedDownloadUrlForProject(session.projectId, artifact.s3ObjectKey);
                if (url) eventsUrls.push(url);
            } catch (err) {
                logger.warn(
                    {
                        err,
                        event: 'sessions.signed_url_or_events_artifact_failed',
                        sessionId: session.id,
                        projectId: session.projectId,
                        artifactKind: artifact.kind,
                        s3ObjectKeySuffix: artifact.s3ObjectKey?.slice(-64),
                    },
                    'sessions.signed_url_or_events_artifact_failed',
                );
            }
        }

        // Download and parse all network artifacts that remain after retention.
        for (const artifact of networkArtifacts) {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (data) {
                    const parsed = JSON.parse(data.toString());
                    if (Array.isArray(parsed)) {
                        allNetwork.push(...parsed);
                    } else if (parsed.networkRequests) { // handled just in case
                        allNetwork.push(...parsed.networkRequests);
                    }
                }
            } catch (err) {
                logger.warn(
                    {
                        err,
                        event: 'sessions.network_artifact_download_failed',
                        sessionId: session.id,
                        projectId: session.projectId,
                        artifactKind: artifact.kind,
                    },
                    'sessions.network_artifact_download_failed',
                );
            }
        }

        // Extract screenshot frames for image-based playback (mobile sessions).
        let screenshotFrames: ScreenshotFramePayload[] = [];

        logger.info({
            sessionId: session.id,
            totalScreenshotArtifacts: screenshotArtifacts.length,
            screenshotArtifactsCount: screenshotArtifacts.length,
            isReplayExpired: session.isReplayExpired,
            recordingDeleted: session.recordingDeleted,
        }, '[sessions] Screenshot extraction debug');

        if (screenshotArtifacts.length > 0 && !session.isReplayExpired && !session.recordingDeleted) {
            // Extract frames from screenshot archives
            logger.info({ sessionId: session.id }, '[sessions] Attempting to extract screenshot frames');
            const framesResult = await getSessionScreenshotFrames(session.id, { urlMode: 'none' });
            logger.info({
                sessionId: session.id,
                framesResult: framesResult ? { totalFrames: framesResult.totalFrames, cached: framesResult.cached } : null,
            }, '[sessions] Screenshot frames extraction result');
            if (framesResult && framesResult.frames.length > 0) {
                // Use proxy URLs instead of direct S3 URLs to avoid CSP issues
                // Frontend will fetch via the archive-backed frame extractor route.
                screenshotFrames = framesResult.frames.map(f => ({
                    timestamp: f.timestamp,
                    // Use relative URL that will be resolved by the API base URL
                    url: `/api/session/frame/${session.id}/${f.timestamp}`,
                    index: f.index,
                }));
            }
        }

        const rrwebReplay = await loadRrwebReplayPayload(session, rrwebArtifacts);

        // Download and embed hierarchy snapshots that remain after retention.
        hierarchyArtifacts.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        for (const artifact of hierarchyArtifacts) {
            try {
                const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
                if (data) {
                    const parsed = (() => {
                        // Check for GZip compression (magic bytes: 0x1f 0x8b) or file extension
                        const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
                            artifact.s3ObjectKey.endsWith('.gz');

                        if (isGzipped) {
                            try {
                                const decompressed = gunzipSync(data);
                                return JSON.parse(decompressed.toString());
                            } catch {
                                // Fallback to raw parsing if decompression fails (might be mislabeled)
                                return JSON.parse(data.toString());
                            }
                        }
                        return JSON.parse(data.toString());
                    })();

                    // Support both 'rootElement' (expected) and 'root' (Android SDK legacy)
                    const rootElement = parsed.rootElement || parsed.root || parsed;
                    hierarchySnapshots.push({
                        timestamp: artifact.timestamp || parsed.timestamp || 0,
                        screenName: parsed.screenName || null,
                        screen: parsed.screen || rootElement?.screen || null,
                        rootElement,
                    });
                }
            } catch {
                // Silently skip failed artifacts - they may be corrupted or missing
            }
        }

        allEvents.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
        allNetwork.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

        const eventsUrl = eventsUrls.length > 0 ? eventsUrls[0] : null;

        const sessionStartMs = session.startedAt.getTime();
        const replayEndMs = aggregate.latestReplayArtifactEndMs;
        const sessionEndMs =
            session.endedAt?.getTime()
            ?? (replayEndMs != null && replayEndMs > 0 ? replayEndMs : undefined)
            ?? session.lastIngestActivityAt?.getTime()
            ?? (sessionStartMs + ((session.durationSeconds ?? 0) * 1000));

        const coerceToEpochMs = (raw: unknown, fallbackMs: number): number => {
            const n = typeof raw === 'string' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
            if (!Number.isFinite(n) || n <= 0) return fallbackMs;

            // Already epoch millis
            if (n >= 10_000_000_000) return Math.round(n);

            // Candidates for smaller values: epoch seconds, relative ms, relative seconds
            const candidates = [
                Math.round(n * 1000),
                Math.round(sessionStartMs + n),
                Math.round(sessionStartMs + n * 1000),
            ];

            const minOk = sessionStartMs - 60_000;
            const maxOk = sessionEndMs + 60_000;
            for (const c of candidates) {
                if (c >= minOk && c <= maxOk) return c;
            }

            // Fall back to epoch seconds heuristic
            return Math.round(n * 1000);
        };

        const normalizeEvent = (e: any, idx: number) => {
            const rawType = (e?.type ?? e?.name ?? '').toString();
            const type = rawType.length > 0 ? rawType.toLowerCase() : 'unknown';

            const rawTs = e?.timestamp ?? e?.ts ?? e?.time;
            const timestamp = coerceToEpochMs(rawTs, sessionStartMs);

            // SDK payloads vary: `payload`, `payloadInline`, `details`, or `properties`.
            const { payload, properties } = normalizeReplayEventPayload(e);

            return {
                // Spread all original event fields first, then override with normalized values
                ...e,
                id: e?.id || `evt_${idx}_${Math.random().toString(16).slice(2)}`,
                type,
                timestamp,
                payload,
                properties,
                // Include gestureType for timeline color coding
                gestureType: e?.gestureType || properties?.gestureType || payload?.gestureType || null,
                // Include targetLabel for tap identification
                // Cross-compatible with native SDKs that shipped `label` before
                // the dashboard standardized on `targetLabel`.
                targetLabel: e?.targetLabel || e?.label || properties?.targetLabel || properties?.label || payload?.targetLabel || payload?.label || null,
                // Include touches for coordinate data
                touches: e?.touches || properties?.touches || payload?.touches || null,
                // Include frustration info
                frustrationKind: e?.frustrationKind || properties?.frustrationKind || payload?.frustrationKind || null,
                // Include screen info for navigation events
                screen:
                    e?.screen ||
                    properties?.screen ||
                    payload?.screen ||
                    properties?.screenName ||
                    payload?.screenName ||
                    e?.screenName ||
                    null,
            };
        };

        const normalizedEvents = allEvents
            .map((e, idx) => normalizeEvent(e, idx))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const displayAnrs = filterDisplayAnrs(session, sessionAnrs);
        const faultEvents = buildSessionFaultEvents(
            sessionCrashes,
            displayAnrs,
            sessionErrors,
            sessionStartMs,
            coerceToEpochMs
        );

        const mergedEvents = mergeEventsWithFaults(normalizedEvents, faultEvents);

        const readyScreenshotArtifacts = artifactsList.some((artifact) => artifact.kind === 'screenshots');
        const hasRrwebReplay = rrwebReplay.eventCount > 0;
        const hasRecording = hasSuccessfulRecording(session, metrics, readyScreenshotArtifacts);
        const playbackMode = hasRecording
            ? (hasRrwebReplay ? 'rrweb' : 'screenshots')
            : 'none';
        const successfulRecording = hasSuccessfulRecording(session, metrics, readyScreenshotArtifacts);
        const durationSeconds = durationSecondsForDisplay({
            ...session,
            latestReplayEndMs: aggregate.latestReplayArtifactEndMs,
            replayAvailable: session.replayAvailable,
        });

        res.json({
            id: session.id,
            projectId: session.projectId,
            userId: session.userDisplayId || null,
            anonymousId: session.anonymousDisplayId || session.anonymousHash,
            anonymousDisplayName: session.deviceId ? generateAnonymousName(session.deviceId) : null,
            platform: session.platform,
            appVersion: session.appVersion,
            sdkVersion: session.sdkVersion,
            hasRecording, // Indicates whether visual replay is available
            playbackMode, // 'rrweb', 'screenshots', or 'none' - determines which player to use
            deviceInfo: {
                model: session.deviceModel,
                os: session.platform,
                systemVersion: session.osVersion,
                appVersion: session.appVersion,
                sdkVersion: session.sdkVersion,
                ...(artifactDeviceInfo ?? {}),
            },
            osVersion: session.osVersion,
            geoLocation: session.geoCity
                ? {
                    city: session.geoCity,
                    region: session.geoRegion,
                    country: session.geoCountry,
                    countryCode: session.geoCountryCode,
                    latitude: session.geoLatitude,
                    longitude: session.geoLongitude,
                    timezone: session.geoTimezone,
                }
                : null,
            startTime: session.startedAt.getTime(),
            endTime: session.endedAt?.getTime(),
            duration: durationSeconds,
            backgroundTime: session.backgroundTimeSeconds ?? 0,
            // playableDuration is now same as durationSeconds (background already excluded at ingest time)
            playableDuration: durationSeconds,
            status: session.status,
            ...buildSessionPresentationPayload(presentationState),
            ...buildWebContextPayload(session),
            // Session-level JSONB metadata accumulated from custom "$user_property" events
            metadata: session.metadata,
            events: mergedEvents,
            networkRequests: [
                ...allNetwork.map(n => ({ ...n, timestamp: n.timestamp || Date.now() })),
                ...mergedEvents.filter((e) => e.type === 'network_request' || e.type === 'api_request')
            ].map((e) => {
                const payload = e.payload || e.payloadInline || e; // S3 network artifacts might be flat
                const rawUrl = payload.url || e.url || '';
                const safeUrl = (() => {
                    if (!rawUrl) return null;
                    try {
                        return new URL(rawUrl);
                    } catch {
                        try {
                            return new URL(rawUrl, 'http://localhost');
                        } catch {
                            return null;
                        }
                    }
                })();
                const requestBodySize =
                    payload.requestBodySize ??
                    payload.requestSize ??
                    e.requestBodySize ??
                    e.requestSize ??
                    0;
                const responseBodySize =
                    payload.responseBodySize ??
                    payload.responseSize ??
                    e.responseBodySize ??
                    e.responseSize ??
                    0;
                return {
                    id: e.id || `net_${Math.random()}`,
                    url: rawUrl,
                    method: payload.method || e.method || 'GET',
                    statusCode: payload.statusCode || e.statusCode,
                    duration: payload.duration || e.duration || 0,
                    success: (payload.success ?? e.success) ?? ((payload.statusCode || e.statusCode) < 400),
                    timestamp: (e.timestamp || payload.timestamp) || 0,
                    host: payload.urlHost || payload.host || safeUrl?.hostname || '',
                    path: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                    urlHost: payload.urlHost || payload.host || safeUrl?.hostname || '',
                    urlPath: payload.urlPath || payload.path || safeUrl?.pathname || rawUrl,
                    requestBodySize,
                    responseBodySize,
                    // Keep legacy fields for existing clients.
                    requestSize: requestBodySize,
                    responseSize: responseBodySize,
                    error: payload.error || e.error,
                };
            }).sort((a, b) => a.timestamp - b.timestamp),
            batches: [],
            artifactUrls: {
                events: eventsUrl,
                eventsBatches: eventsUrls,
            },
            // Visual capture data.
            screenshotFrames, // Array of { timestamp, url, index } for image-based playback
            rrwebReplay,
            hierarchySnapshots,
            metrics: buildMetricsPayload(session, metrics),
            crashes: mapCrashRowsForPayload(sessionCrashes),
            anrs: mapAnrRowsForPayload(displayAnrs),
            stats: {
                duration: String(session.durationSeconds ?? 0),
                durationMinutes: String(((session.durationSeconds ?? 0) / 60).toFixed(2)),
                eventCount: metrics?.totalEvents ?? 0,
                totalSizeBytes: totalBytes,
                eventsSizeBytes: bytesByKind.events || 0,
                screenshotSizeBytes: bytesByKind.screenshots || 0,
                hierarchySizeBytes: bytesByKind.hierarchy || 0,
                networkSizeBytes: bytesByKind.network || 0,
                totalSizeKB: String(totalBytes / 1024),
                eventsSizeKB: String((bytesByKind.events || 0) / 1024),
                screenshotSizeKB: String((bytesByKind.screenshots || 0) / 1024),
                hierarchySizeKB: String((bytesByKind.hierarchy || 0) / 1024),
                networkSizeKB: String((bytesByKind.network || 0) / 1024),
                networkStats: {
                    total: metrics?.apiTotalCount ?? 0,
                    successful: metrics?.apiSuccessCount ?? 0,
                    failed: metrics?.apiErrorCount ?? 0,
                    avgDuration: metrics?.apiAvgResponseMs ?? 0,
                },
            },
            retentionTier: session.retentionTier,
            retentionDays: session.retentionDays,
            recordingDeleted: session.recordingDeleted,
            recordingDeletedAt: session.recordingDeletedAt?.toISOString() ?? null,
            isReplayExpired: session.isReplayExpired,
            hasSuccessfulRecording: successfulRecording,
        });
    })
);

/**
 * Get combined session bootstrap payload for first render
 * GET /api/session/:id/bootstrap
 */
router.get(
    '/:id/bootstrap',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, metrics } = await getAuthorizedSession(req.user!.id, req.params.id);
        res.setHeader('Cache-Control', SESSION_BOOTSTRAP_CACHE_CONTROL);

        const mayReadCache = isStableForSessionDetailCache(session);
        const cached = mayReadCache ? await readCachedSessionDetail('bootstrap', session.id) : null;
        if (cached) {
            res.type('json').send(cached);
            return;
        }

        const [artifactsList, aggregate, successorStartedAt] = await Promise.all([
            getReadyArtifacts(session.id),
            loadSessionWorkAggregate(session.id),
            loadSuccessorSessionStartedAt({
                sessionId: session.id,
                projectId: session.projectId,
                deviceId: session.deviceId,
                startedAt: session.startedAt,
            }),
        ]);
        const supersededByNewerVisitorSession = shouldTreatSessionAsSuperseded(session, aggregate, successorStartedAt);

        const screenshotArtifacts = artifactsList.filter((artifact) => artifact.kind === 'screenshots');
        const rrwebArtifacts = artifactsList.filter((artifact) => artifact.kind === 'rrweb');
        const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
        const [replayBootstrap, timeline, stats] = await Promise.all([
            loadVisualReplayBootstrap(
                session,
                screenshotArtifacts.length,
                rrwebArtifacts,
                frameUrlMode,
            ),
            loadTimelinePayload(session, artifactsList),
            computeSessionStats(session, metrics, artifactsList, true),
        ]);

        const basePayload = buildSessionBasePayload(
            session,
            metrics,
            replayBootstrap.screenshotFrames,
            screenshotArtifacts.length > 0,
            deriveSessionPresentationState({
                status: session.status,
                platform: session.platform,
                replayAvailable: hasSuccessfulRecording(session, metrics, screenshotArtifacts.length > 0),
                recordingDeleted: session.recordingDeleted,
                isReplayExpired: session.isReplayExpired,
                lastIngestActivityAt: session.lastIngestActivityAt,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                hasPendingWork: aggregate.hasPendingWork,
                hasPendingProcessingWork: aggregate.hasPendingProcessingWork,
                hasPendingReplayWork: aggregate.hasPendingReplayWork,
                supersededByNewerVisitorSession,
            }),
            aggregate.latestReplayArtifactEndMs,
        );

        const core = {
            ...basePayload,
            deviceInfo: timeline.deviceInfo
                ? { ...basePayload.deviceInfo, ...timeline.deviceInfo }
                : basePayload.deviceInfo,
            hasRecording: replayBootstrap.hasRecording,
            playbackMode: replayBootstrap.playbackMode,
            screenshotFrames: replayBootstrap.screenshotFrames,
            screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
            screenshotFrameCount: replayBootstrap.screenshotFrameCount,
            screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
            screenshotFramesTotalSegments: replayBootstrap.totalSegments,
            rrwebReplay: replayBootstrap.rrwebReplay,
            stats,
        };

        const responseBody = {
            core,
            timeline,
            stats,
            hierarchyDeferred: true,
        };

        res.json(responseBody);

        if (shouldWriteSessionDetailCache(session, aggregate) && replayBootstrap.screenshotFramesStatus !== 'preparing') {
            await writeCachedSessionDetail('bootstrap', session.id, responseBody);
        }
    }),
);

/**
 * Get lightweight session payload for replay bootstrap
 * GET /api/session/:id/core
 */
router.get(
    '/:id/core',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, metrics } = await getAuthorizedSession(req.user!.id, req.params.id);
        void recordDashboardInvestigation({
            userId: req.user!.id,
            projectId: session.projectId,
            sessionId: session.id,
        }).catch((err) => {
            logger.warn({ err, sessionId: session.id }, 'Failed to record dashboard investigation milestone');
        });
        const includeReplay = shouldIncludeReplayFromQuery(req.query.includeReplay);
        const cacheKind: SessionDetailCacheKind = includeReplay ? 'core' : 'coreLite';
        // Always try cache: unstable sessions get a short TTL on write, which
        // absorbs rapid repeat clicks (the common dashboard browsing pattern).
        const cached = await readCachedSessionDetail(cacheKind, session.id);
        if (cached) {
            res.setHeader('X-Replay-Core-Cache', 'hit');
            res.type('json').send(cached);
            return;
        }

        const [artifactsList, aggregate, successorStartedAt] = await Promise.all([
            getReadyArtifacts(session.id),
            loadSessionWorkAggregate(session.id),
            loadSuccessorSessionStartedAt({
                sessionId: session.id,
                projectId: session.projectId,
                deviceId: session.deviceId,
                startedAt: session.startedAt,
            }),
        ]);
        const supersededByNewerVisitorSession = shouldTreatSessionAsSuperseded(session, aggregate, successorStartedAt);

        const screenshotArtifacts = artifactsList.filter((a) => a.kind === 'screenshots');
        const rrwebArtifacts = artifactsList.filter((a) => a.kind === 'rrweb');
        const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
        const [replayBootstrap, stats] = await Promise.all([
            includeReplay
                ? loadVisualReplayBootstrap(
                    session,
                    screenshotArtifacts.length,
                    rrwebArtifacts,
                    frameUrlMode
                )
                : Promise.resolve(buildDeferredVisualReplayBootstrap(session, screenshotArtifacts.length, rrwebArtifacts)),
            computeSessionStats(session, metrics, artifactsList, false),
        ]);

        const basePayload = buildSessionBasePayload(
            session,
            metrics,
            replayBootstrap.screenshotFrames,
            screenshotArtifacts.length > 0,
            deriveSessionPresentationState({
                status: session.status,
                platform: session.platform,
                replayAvailable: hasSuccessfulRecording(session, metrics, screenshotArtifacts.length > 0),
                recordingDeleted: session.recordingDeleted,
                isReplayExpired: session.isReplayExpired,
                lastIngestActivityAt: session.lastIngestActivityAt,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                hasPendingWork: aggregate.hasPendingWork,
                hasPendingProcessingWork: aggregate.hasPendingProcessingWork,
                hasPendingReplayWork: aggregate.hasPendingReplayWork,
                supersededByNewerVisitorSession,
            }),
            aggregate.latestReplayArtifactEndMs
        );
        const responseBody = {
            ...basePayload,
            hasRecording: replayBootstrap.hasRecording,
            playbackMode: replayBootstrap.playbackMode,
            screenshotFrames: replayBootstrap.screenshotFrames,
            screenshotFramesStatus: replayBootstrap.screenshotFramesStatus,
            screenshotFrameCount: replayBootstrap.screenshotFrameCount,
            screenshotFramesProcessedSegments: replayBootstrap.processedSegments,
            screenshotFramesTotalSegments: replayBootstrap.totalSegments,
            rrwebReplay: replayBootstrap.rrwebReplay,
            stats,
        };

        res.setHeader('X-Replay-Core-Cache', 'miss');
        res.json(responseBody);

        // Always cache. Stable sessions get the full 5-min TTL, unstable ones
        // get a short 20s TTL so repeat clicks within the burst window are
        // instant without holding onto data that may have changed.
        if (replayBootstrap.screenshotFramesStatus !== 'preparing') {
            const ttl = pickSessionCoreCacheTtl(session, aggregate);
            await writeCachedSessionDetail(cacheKind, session.id, responseBody, ttl);
        }
    })
);

/**
 * Get the visual replay manifest only (rrweb segment URLs or screenshot frame URLs).
 * GET /api/session/:id/replay-manifest
 */
router.get(
    '/:id/replay-manifest',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        void recordProjectOwnerMilestone(session.projectId, 'first_replay_viewed', {
            eventSource: 'WEB',
            metadata: { firstSessionId: session.id },
        }).catch((err) => {
            logger.warn({ err, sessionId: session.id }, 'Failed to record replay conversion milestone');
        });
        const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
        const manifestCacheScope = `${session.id}:${frameUrlMode}`;
        const { payloadJson, cacheStatus } = await getOrBuildCachedSessionDetailJson(
            'replayManifest',
            manifestCacheScope,
            () => buildReplayManifestPayload(session, frameUrlMode),
        );

        res.setHeader('X-Replay-Manifest-Cache', cacheStatus);
        res.type('json').send(payloadJson);
    })
);

/**
 * Get session timeline payload (events, network, crashes, ANRs)
 * GET /api/session/:id/timeline
 */
router.get(
    '/:id/timeline',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        const mayReadCache = isStableForSessionDetailCache(session);
        const cached = mayReadCache ? await readCachedSessionDetail('timeline', session.id) : null;
        if (cached) {
            res.type('json').send(cached);
            return;
        }

        const artifactsList = await getReadyArtifacts(session.id);
        const [timeline, aggregate] = await Promise.all([
            loadTimelinePayload(session, artifactsList),
            loadSessionWorkAggregate(session.id),
        ]);
        if (shouldWriteSessionDetailCache(session, aggregate)) {
            await writeCachedSessionDetail('timeline', session.id, timeline);
        }
        res.json(timeline);
    })
);

/**
 * Get view hierarchy payload
 * GET /api/session/:id/hierarchy
 */
router.get(
    '/:id/hierarchy',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        const mayReadCache = isStableForSessionDetailCache(session);
        const cached = mayReadCache ? await readCachedSessionDetail('hierarchy', session.id) : null;
        if (cached) {
            res.type('json').send(cached);
            return;
        }

        const artifactsList = await getReadyArtifacts(session.id);
        const hierarchySnapshots = await loadHierarchyPayload(session, artifactsList);
        const responseBody = { hierarchySnapshots };
        const aggregate = await loadSessionWorkAggregate(session.id);
        if (shouldWriteSessionDetailCache(session, aggregate)) {
            await writeCachedSessionDetail('hierarchy', session.id, responseBody);
        }
        res.json(responseBody);
    })
);

/**
 * Get screenshot frame bootstrap/progress payload
 * GET /api/session/:id/frames
 */
router.get(
    '/:id/frames',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session } = await getAuthorizedSession(req.user!.id, req.params.id);
        const frameUrlMode = resolveFrameUrlMode(req.query.frameUrlMode);
        const framesCacheScope = `${session.id}:${frameUrlMode}`;
        const { payloadJson, cacheStatus } = await getOrBuildCachedSessionDetailJson(
            'frames',
            framesCacheScope,
            () => buildScreenshotFramesPayload(session, frameUrlMode),
        );

        res.setHeader('X-Screenshot-Frames-Cache', cacheStatus);
        res.type('json').send(payloadJson);
    })
);

/**
 * Get detailed session stats (includes S3 HEAD fallback for legacy artifacts missing size_bytes)
 * GET /api/session/:id/stats
 */
router.get(
    '/:id/stats',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { session, metrics } = await getAuthorizedSession(req.user!.id, req.params.id);
        const artifactsList = await getReadyArtifacts(session.id);
        const stats = await computeSessionStats(session, metrics, artifactsList, true);
        res.json({ stats });
    })
);

/**
 * Get session network requests
 * GET /api/session/:id/network
 */
router.get(
    '/:id/network',
    sessionAuth,
    validate(sessionIdParamSchema, 'params'),
    validate(networkGroupBySchema, 'query'),
    networkRateLimiter,
    asyncHandler(async (req, res) => {
        const { groupBy } = req.query;

        const [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
                teamId: projects.teamId,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .where(eq(sessions.id, req.params.id))
            .limit(1);

        if (!sessionResult) {
            throw ApiError.notFound('Session not found');
        }

        // Verify access
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, sessionResult.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('No access to this session');
        }

        const metrics = sessionResult.metrics;

        res.json({
            sessionId: sessionResult.session.id,
            summary: {
                total: metrics?.apiTotalCount ?? 0,
                successful: metrics?.apiSuccessCount ?? 0,
                failed: metrics?.apiErrorCount ?? 0,
                avgDuration: metrics?.apiAvgResponseMs ?? 0,
            },
            groupBy: groupBy || null,
            groups: [],
        });
    })
);



/**
 * Get rrweb segment by artifact id (same-origin fallback for browsers that
 * cannot fetch signed object-storage URLs directly, usually because of CORS).
 * GET /api/session/rrweb-segment/:sessionId/:artifactId
 */
router.get(
    '/rrweb-segment/:sessionId/:artifactId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        const artifactId = req.params.artifactId
            .replace(/\.json\.gz$/i, '')
            .replace(/\.json$/i, '');

        const { session } = await getAuthorizedSessionForFrames(req.user!.id, sessionId);
        const redis = getRedis();
        const cacheKey = `rrweb_segment_data:${sessionId}:${artifactId}`;

        const sendSegmentData = (data: Buffer, s3ObjectKey?: string | null) => {
            const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
                Boolean(s3ObjectKey?.endsWith('.gz'));
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (isGzipped) res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Cache-Control', 'private, max-age=300');
            res.setHeader('Content-Length', String(data.length));
            return res.send(data);
        };

        const readCachedSegment = async (): Promise<Buffer | null> => {
            try {
                return await redis.getBuffer(cacheKey);
            } catch (err) {
                logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to read rrweb segment from Redis cache');
                return null;
            }
        };

        const cachedSegment = await readCachedSegment();
        if (cachedSegment) return sendSegmentData(cachedSegment);

        const [artifact] = await db
            .select()
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.id, artifactId),
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, 'rrweb'),
                eq(recordingArtifacts.status, 'ready'),
            ))
            .limit(1);

        if (!artifact) throw ApiError.notFound('Replay segment not found');

        const lockKey = `rrweb_segment_data_lock:${sessionId}:${artifactId}`;
        const lockToken = randomUUID();
        let lockAcquired = false;

        try {
            const result = await redis.set(lockKey, lockToken, 'EX', SESSION_REPLAY_MANIFEST_LOCK_TTL_SECONDS, 'NX');
            lockAcquired = result === 'OK';
        } catch (err) {
            logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to acquire rrweb segment cache lock');
        }

        if (!lockAcquired) {
            const waitUntil = Date.now() + 5000;
            while (Date.now() < waitUntil) {
                await sleepMs(100);
                const waitedSegment = await readCachedSegment();
                if (waitedSegment) return sendSegmentData(waitedSegment, artifact.s3ObjectKey);
            }
        }

        try {
            const data = await downloadRawFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
            if (!data) throw ApiError.notFound('Replay segment data not found in storage');

            if (data.length <= RRWEB_SEGMENT_DATA_CACHE_MAX_BYTES) {
                try {
                    await redis.setex(cacheKey, RRWEB_SEGMENT_DATA_CACHE_TTL_SECONDS, data);
                } catch (err) {
                    logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to cache rrweb segment data');
                }
            }

            return sendSegmentData(data, artifact.s3ObjectKey);
        } finally {
            if (lockAcquired) {
                try {
                    const currentToken = await redis.get(lockKey);
                    if (currentToken === lockToken) {
                        await redis.del(lockKey);
                    }
                } catch (err) {
                    logger.warn({ err, sessionId, artifactId }, '[sessions] Failed to release rrweb segment cache lock');
                }
            }
        }
    })
);

/**
 * Get frame image by timestamp (proxy)
 * GET /api/session/frame/:sessionId/:timestamp
 */
router.get(
    '/frame/:sessionId/:artifactId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId, artifactId: rawArtifactId } = req.params;

        // The parameter is now typically the timestamp, e.g. "1710000000000" or "1710000000000.jpg"
        const isTimestamp = /^\d+(\.jpg)?$/.test(rawArtifactId);
        const targetTimestampMs = isTimestamp ? parseInt(rawArtifactId.replace(/\.jpg$/, ''), 10) : NaN;

        const { session } = await getAuthorizedSessionForFrames(req.user!.id, sessionId);
        const redis = getRedis();
        let cacheKey = '';

        const sendFrameData = (data: Buffer) => {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('Content-Length', String(data.length));
            return res.send(data);
        };

        const readCachedFrame = async (): Promise<Buffer | null> => {
            if (!cacheKey) return null;
            try {
                return await redis.getBuffer(cacheKey);
            } catch (err) {
                logger.warn({ err, sessionId }, '[sessions] Failed to read frame from Redis cache');
                return null;
            }
        };

        if (isTimestamp && !isNaN(targetTimestampMs)) {
            cacheKey = `screenshot_frame_data:${sessionId}:${targetTimestampMs}`;
            const cachedFrame = await readCachedFrame();
            if (cachedFrame) return sendFrameData(cachedFrame);
        }

        const [replayEndRow] = await db
            .select({ maxEnd: sql<number | null>`max(${recordingArtifacts.endTime})` })
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, sessionId),
                inArray(recordingArtifacts.kind, ['screenshots', 'hierarchy', 'rrweb']),
                eq(recordingArtifacts.status, 'ready'),
            ));

        const sessionStartMs = session.startedAt.getTime();
        const replayEndMs = replayEndRow?.maxEnd ?? null;
        const effectiveSessionEnd = session.endedAt
            ?? (replayEndMs != null && replayEndMs > 0 ? new Date(replayEndMs) : null)
            ?? (session.lastIngestActivityAt && session.lastIngestActivityAt > session.startedAt ? session.lastIngestActivityAt : null);
        const sessionEndMs = effectiveSessionEnd ? effectiveSessionEnd.getTime() : Number.MAX_SAFE_INTEGER;
        const lowerBoundMs = Math.max(0, sessionStartMs - 30_000);
        const upperBoundMs = sessionEndMs + 120_000;

        // If it was a legacy artifact ID, act as normal S3 fetch
        if (!isTimestamp || isNaN(targetTimestampMs)) {
            const artifactId = rawArtifactId.replace(/\.json\.gz$/, '').replace(/\.jpg$/, '');
            const [artifact] = await db
                .select()
                .from(recordingArtifacts)
                .where(and(eq(recordingArtifacts.id, artifactId), eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.kind, 'frames')))
                .limit(1);

            if (!artifact) throw ApiError.notFound('Frame not found');

            const data = await downloadFromS3ForArtifact(session.projectId, artifact.s3ObjectKey, artifact.endpointId);
            if (!data) throw ApiError.notFound('Frame data not found in storage');
            
            return sendFrameData(data);
        }

        // On cache miss, fetch the screenshot archive that contains this timestamp
        const artifacts = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                endpointId: recordingArtifacts.endpointId,
                startTime: recordingArtifacts.startTime,
                endTime: recordingArtifacts.endTime,
                timestamp: recordingArtifacts.timestamp,
            })
            .from(recordingArtifacts)
            .where(
                and(
                    eq(recordingArtifacts.sessionId, sessionId),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready')
                )
            )
            .orderBy(recordingArtifacts.startTime, recordingArtifacts.timestamp, recordingArtifacts.createdAt);

        if (artifacts.length === 0) throw ApiError.notFound('No ready screenshot artifacts found for session');

        let bestArtifact = artifacts[0];
        for (const artifact of artifacts) {
            const artifactStartMs = artifact.startTime ?? artifact.timestamp ?? sessionStartMs;
            const artifactEndMs = artifact.endTime ?? artifactStartMs + 10_000;
            
            if (targetTimestampMs >= artifactStartMs && targetTimestampMs <= artifactEndMs) {
                bestArtifact = artifact;
                break;
            }
            if (artifactStartMs > targetTimestampMs) break;
            bestArtifact = artifact;
        }

        const archiveLockKey = `screenshot_frame_archive_lock:${sessionId}:${bestArtifact.id}`;
        const archiveLockToken = randomUUID();
        let archiveLockAcquired = false;

        const tryAcquireArchiveLock = async () => {
            try {
                const result = await redis.set(
                    archiveLockKey,
                    archiveLockToken,
                    'EX',
                    SCREENSHOT_FRAME_ARCHIVE_LOCK_TTL_SECONDS,
                    'NX'
                );
                return result === 'OK';
            } catch (err) {
                logger.warn({ err, sessionId, artifactId: bestArtifact.id }, '[sessions] Failed to acquire screenshot archive extraction lock');
                return false;
            }
        };

        const releaseArchiveLock = async () => {
            if (!archiveLockAcquired) return;
            try {
                const currentToken = await redis.get(archiveLockKey);
                if (currentToken === archiveLockToken) {
                    await redis.del(archiveLockKey);
                }
            } catch (err) {
                logger.warn({ err, sessionId, artifactId: bestArtifact.id }, '[sessions] Failed to release screenshot archive extraction lock');
            }
        };

        const extractArchiveAndCacheFrames = async (): Promise<Buffer | null> => {
            const archiveData = await downloadFromS3ForArtifact(session.projectId, bestArtifact.s3ObjectKey, bestArtifact.endpointId);
            if (!archiveData) return null;

            const { extractFramesFromArchive } = await import('../services/screenshotFrames.js');
            const frames = await extractFramesFromArchive(archiveData, sessionStartMs);

            let targetFrameData: Buffer | null = null;
            let minDiff = Number.MAX_SAFE_INTEGER;

            for (const frame of frames) {
                if (frame.timestamp < lowerBoundMs || frame.timestamp > upperBoundMs) {
                    continue;
                }
                const frameCacheKey = `screenshot_frame_data:${sessionId}:${frame.timestamp}`;
                try {
                    await redis.setex(frameCacheKey, SCREENSHOT_FRAME_DATA_CACHE_TTL_SECONDS, frame.data);
                } catch (err) {
                    logger.warn({ err, sessionId }, '[sessions] Failed to write extracted frame to Redis cache');
                }

                const diff = Math.abs(frame.timestamp - targetTimestampMs);
                if (diff < minDiff) {
                    minDiff = diff;
                    targetFrameData = frame.data;
                }
            }

            return targetFrameData;
        };

        archiveLockAcquired = await tryAcquireArchiveLock();
        if (!archiveLockAcquired) {
            const waitUntil = Date.now() + SCREENSHOT_FRAME_ARCHIVE_LOCK_WAIT_MS;
            while (Date.now() < waitUntil) {
                await sleepMs(100);
                const cachedFrame = await readCachedFrame();
                if (cachedFrame) return sendFrameData(cachedFrame);
            }
            archiveLockAcquired = await tryAcquireArchiveLock();
        }

        try {
            const cachedAfterWait = await readCachedFrame();
            if (cachedAfterWait) return sendFrameData(cachedAfterWait);

            const targetFrameData = await extractArchiveAndCacheFrames();
            if (!targetFrameData) throw ApiError.notFound('Frame data not found inside archive');
            return sendFrameData(targetFrameData);
        } finally {
            await releaseArchiveLock();
        }
    })
);

/**
 * Get screenshot thumbnail for a session
 * GET /api/session/thumbnail/:sessionId
 *
 * Extracts a thumbnail from screenshot archives.
 * Query params:
 *   - t: Kept for backwards compatibility (ignored for screenshot archives)
 *   - ts: Absolute timestamp in ms (epoch) - if provided, extracts frame at this time
 *   - w: Width in pixels (default: 375)
 *   - format: Ignored (responses are JPEG)
 */
router.get(
    '/thumbnail/:sessionId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        const requestStartedAt = Date.now();
        const timeOffset = parseFloat(req.query.t as string) || 0.5;
        const absoluteTimestampMs = req.query.ts ? parseInt(req.query.ts as string, 10) : null;
        const width = parseInt(req.query.w as string, 10) || 375;
        const format: 'jpeg' = 'jpeg';

        logger.info(
            {
                sessionId,
                userId: req.user!.id,
                query: req.query,
                timeOffset,
                absoluteTimestampMs,
                width,
                format,
            },
            '[sessions] Thumbnail request received'
        );

        // Verify session access
        const [session] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            logger.warn({ sessionId, userId: req.user!.id }, '[sessions] Thumbnail request session not found');
            throw ApiError.notFound('Session not found');
        }

        logger.info(
            { sessionId, projectId: session.projectId, userId: req.user!.id },
            '[sessions] Thumbnail request session resolved'
        );

        // Verify user has access to project
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map(m => m.teamId);
        if (teamIds.length === 0) {
            logger.warn({ sessionId, userId: req.user!.id }, '[sessions] Thumbnail request denied because user has no team memberships');
            throw ApiError.forbidden('Access denied');
        }

        logger.info(
            {
                sessionId,
                userId: req.user!.id,
                teamMembershipCount: teamIds.length,
                teamIds,
            },
            '[sessions] Thumbnail request team memberships resolved'
        );

        const [project] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(
                eq(projects.id, session.projectId),
                inArray(projects.teamId, teamIds)
            ))
            .limit(1);

        if (!project) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    userId: req.user!.id,
                    teamIds,
                },
                '[sessions] Thumbnail request denied because project is not accessible to user'
            );
            throw ApiError.forbidden('Access denied');
        }

        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                userId: req.user!.id,
                durationMs: Date.now() - requestStartedAt,
            },
            '[sessions] Thumbnail request authorization succeeded'
        );

        // Import thumbnail service
        const { getSessionThumbnail, getThumbnailAtTimestamp } = await import('../services/sessionThumbnail.js');

        let thumbnail: Buffer | null = null;

        // If absolute timestamp provided, use getThumbnailAtTimestamp for screen-specific frames
        if (absoluteTimestampMs && !isNaN(absoluteTimestampMs)) {
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    width,
                    format,
                },
                '[sessions] Attempting timestamped thumbnail extraction'
            );
            thumbnail = await getThumbnailAtTimestamp(sessionId, absoluteTimestampMs, {
                width,
                format,
            });
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    thumbnailFound: Boolean(thumbnail),
                    durationMs: Date.now() - requestStartedAt,
                },
                '[sessions] Timestamped thumbnail extraction finished'
            );
        }

        // Fallback to first available screenshot extraction
        if (!thumbnail) {
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    timeOffset,
                    width,
                    format,
                },
                '[sessions] Falling back to generic session thumbnail extraction'
            );
            thumbnail = await getSessionThumbnail(sessionId, {
                timeOffset,
                width,
                format,
            });
            logger.info(
                {
                    sessionId,
                    projectId: session.projectId,
                    thumbnailFound: Boolean(thumbnail),
                    durationMs: Date.now() - requestStartedAt,
                },
                '[sessions] Generic thumbnail extraction finished'
            );
        }

        if (!thumbnail) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    absoluteTimestampMs,
                    timeOffset,
                    width,
                    format,
                    durationMs: Date.now() - requestStartedAt,
                },
                '[sessions] Thumbnail request returning 404 because no thumbnail was available'
            );
            throw ApiError.notFound('No thumbnail available for this session');
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                responseBytes: thumbnail.length,
                absoluteTimestampMs,
                durationMs: Date.now() - requestStartedAt,
            },
            '[sessions] Thumbnail request succeeded'
        );
        res.send(thumbnail);
    })
);

/**
 * Get cover photo for a session (alias for thumbnail)
 * GET /api/session/cover/:sessionId
 *
 * This is a convenience endpoint used by MiniSessionCard and other components.
 * Extracts a thumbnail from the session's first screenshot archive frame.
 */
router.get(
    '/cover/:sessionId',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const { sessionId } = req.params;

        // Verify session access
        const [session] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            throw ApiError.notFound('Session not found');
        }

        // Verify user has access to project
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map(m => m.teamId);
        if (teamIds.length === 0) {
            throw ApiError.forbidden('Access denied');
        }

        const [project] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(
                eq(projects.id, session.projectId),
                inArray(projects.teamId, teamIds)
            ))
            .limit(1);

        if (!project) {
            throw ApiError.forbidden('Access denied');
        }

        // Import and use thumbnail service
        const { getSessionThumbnail } = await import('../services/sessionThumbnail.js');

        const thumbnail = await getSessionThumbnail(sessionId, {
            timeOffset: 0.5,
            width: 375,
            format: 'jpeg',
        });

        if (!thumbnail) {
            throw ApiError.notFound('No cover photo available for this session');
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
        res.send(thumbnail);
    })
);

/**
 * GET /sessions/:id/frame/:frameTimestamp
 * 
 * Proxy endpoint for screenshot frames - avoids CSP issues by serving
 * images through the API instead of direct S3 URLs.
 */
router.get(
    '/:id/frame/:frameTimestamp',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const sessionId = req.params.id;
        const frameTimestamp = req.params.frameTimestamp;

        // Verify access, then delegate to the archive-aware frame endpoint.
        await getAuthorizedSessionForFrames(req.user!.id, sessionId);
        return res.redirect(307, `/api/session/frame/${sessionId}/${frameTimestamp}`);
    })
);


export default router;
