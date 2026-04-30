/**
 * Projects Routes
 * 
 * Project CRUD and attestation config
 */

import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { eq, and, inArray, isNull, sql, desc } from 'drizzle-orm';
import { db, projects, teamMembers, sessions, sessionMetrics, teams, alertSettings, alertRecipients, appDailyStats, appAllTimeStats } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { sessionAuth, requireProjectAccess, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import {
    dashboardRateLimiter,
    queryBuilderIpRateLimiter,
    queryBuilderProjectRateLimiter,
    queryBuilderUserRateLimiter,
    writeApiRateLimiter,
} from '../middleware/rateLimit.js';
import {
    createProjectSchema,
    updateProjectSchema,
    projectIdParamSchema,
    requestDeleteProjectOtpSchema,
    deleteProjectSchema,
} from '../validation/projects.js';
import { auditFromRequest, buildAuditFieldChanges } from '../services/auditLog.js';
import { hardDeleteProject } from '../services/deletion.js';
import { sendDeletionOtp, verifyDeletionOtp } from '../services/deleteOtp.js';
import {
    assertNoDuplicateContentSpam,
    enforceNewAccountActionLimit,
} from '../services/abuseDetection.js';

function getProjectPlatforms(project: { bundleId?: string | null; packageName?: string | null; platform?: string | null }): string[] {
    const platforms: string[] = [];
    if (project.bundleId) platforms.push('ios');
    if (project.packageName) platforms.push('android');
    if (platforms.length === 0 && project.platform) platforms.push(project.platform);
    return platforms;
}

function getProjectAuditState(project: {
    name: string;
    teamId: string;
    bundleId?: string | null;
    packageName?: string | null;
    webDomain?: string | null;
    rejourneyEnabled?: boolean | null;
    recordingEnabled?: boolean | null;
    sampleRate?: number | null;
    maxRecordingMinutes?: number | null;
}): Record<string, unknown> {
    return {
        name: project.name,
        teamId: project.teamId,
        bundleId: project.bundleId ?? null,
        packageName: project.packageName ?? null,
        webDomain: project.webDomain ?? null,
        rejourneyEnabled: project.rejourneyEnabled ?? null,
        recordingEnabled: project.recordingEnabled ?? null,
        sampleRate: project.sampleRate ?? null,
        maxRecordingMinutes: project.maxRecordingMinutes ?? null,
    };
}

const router = Router();
const PROJECT_LIST_CACHE_TTL_SECONDS = Number(process.env.RJ_PROJECT_LIST_CACHE_TTL_SECONDS ?? 60);
const QUERY_BUILDER_MAX_PROMPT_LENGTH = 500;
const QUERY_BUILDER_TIMEOUT_MS = Number(process.env.RJ_QUERY_BUILDER_TIMEOUT_MS ?? 15000);

type AvailableProjectFilters = {
    events: string[];
    eventPropertyKeys: string[];
    screens: string[];
    metadata: Record<string, string[]>;
};

type QueryBuilderProjectContext = {
    name: string;
    platform: string | null;
    bundleId: string | null;
    packageName: string | null;
    webDomain: string | null;
    sampleRate: number;
    recordingEnabled: boolean;
    rejourneyEnabled: boolean;
    maxRecordingMinutes: number;
};

type CountOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
type QueryBuilderIssueFilter = 'crashes' | 'anrs' | 'errors' | 'rage' | 'dead_taps' | 'slow_start' | 'slow_api';
type QueryBuilderTimeRange = '24h' | '7d' | '30d' | '90d' | '1y';

type QueryBuilderCondition =
    | { id: string; type: 'issue'; issueFilter: QueryBuilderIssueFilter }
    | { id: string; type: 'date'; mode: 'exact' | 'range'; date?: string; timeRange?: QueryBuilderTimeRange }
    | { id: string; type: 'screen'; screenName: string; screenOutcome?: 'bounced' | 'continued'; screenVisitCountOp?: CountOp; screenVisitCountValue?: string }
    | { id: string; type: 'event'; eventName: string; eventCountOp?: CountOp; eventCountValue?: string; eventPropKey?: string; eventPropValue?: string }
    | { id: string; type: 'metadata'; metaKey: string; metaValue?: string }
    | { id: string; type: 'lifecycle'; preset: 'early_user' | 'returning_user'; sessionWindowSize?: number; returnedCountOp?: CountOp; returnedCountValue?: string }
    | { id: string; type: 'conversion'; preset: 'checkout_bounced' | 'checkout_success' }
    | { id: string; type: 'platform'; platform: 'ios' | 'android' }
    | { id: string; type: 'journey'; steps: string[] };

type QueryBuilderGroup = {
    id: string;
    conditions: QueryBuilderCondition[];
};

const VALID_ISSUE_FILTERS = new Set(['crashes', 'anrs', 'errors', 'rage', 'dead_taps', 'slow_start', 'slow_api']);
const VALID_TIME_RANGES = new Set(['24h', '7d', '30d', '90d', '1y']);
const VALID_COUNT_OPS = new Set(['eq', 'gt', 'lt', 'gte', 'lte']);

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function canonicalizeQueryLabel(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/\b(screen|page|view|route|tab)\b/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

function findAllowedValue(value: unknown, allowed: string[]): string | null {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    const exact = allowed.find((candidate) => candidate === normalized);
    if (exact) return exact;
    const lower = normalized.toLowerCase();
    const caseInsensitive = allowed.find((candidate) => candidate.toLowerCase() === lower);
    if (caseInsensitive) return caseInsensitive;
    const canonical = canonicalizeQueryLabel(normalized);
    if (!canonical) return null;
    return allowed.find((candidate) => canonicalizeQueryLabel(candidate) === canonical) ?? null;
}

function sanitizeCountOp(value: unknown): CountOp | undefined {
    const op = normalizeString(value);
    return VALID_COUNT_OPS.has(op) ? op as CountOp : undefined;
}

function sanitizePositiveIntString(value: unknown): string | undefined {
    const n = typeof value === 'number' ? value : Number(normalizeString(value));
    if (!Number.isFinite(n) || n < 1) return undefined;
    return String(Math.floor(n));
}

function inferScreenOutcomeFromPrompt(prompt: string): 'bounced' | 'continued' | undefined {
    const normalized = prompt.toLowerCase();
    if (/\b(continued|continues|went on|moved on|navigated away from|proceeded|proceeds|next step|moved forward|completed|succeeded|success)\b/.test(normalized)) {
        return 'continued';
    }
    if (/\b(left|leave|leaves|leaving|exited|exit|exits|dropped off|drop off|dropoff|drop-off|abandoned|abandon|bounced|bounce|failed|fail|fails|failure|unsuccessful|couldn'?t|could not|can't|cant|unable to|didn'?t complete|did not complete|churn|churned|churning|pre[-\s]?churn|prechurn)\b/.test(normalized)) {
        return 'bounced';
    }
    if (/\btried\b[\s\S]{0,80}\bbut\b/.test(normalized)) {
        return 'bounced';
    }
    return undefined;
}

function inferTimeRangeFromPrompt(prompt: string): QueryBuilderTimeRange | undefined {
    const normalized = prompt.toLowerCase();
    if (/\b(today|last 24 ?h|past 24 ?h|24 hours?)\b/.test(normalized)) return '24h';
    if (/\b(last|past)\s+(week|7 days?)\b|\b7d\b/.test(normalized)) return '7d';
    if (/\b(last|past)\s+(month|30 days?)\b|\b30d\b/.test(normalized)) return '30d';
    if (/\b(last|past)\s+(quarter|90 days?)\b|\b90d\b/.test(normalized)) return '90d';
    if (/\b(last|past)\s+(year|12 months?)\b|\b1y\b/.test(normalized)) return '1y';
    return undefined;
}

function inferIssueFromPrompt(prompt: string): QueryBuilderIssueFilter | undefined {
    const normalized = prompt.toLowerCase();
    if (/\b(crash|crashes|crashed)\b/.test(normalized)) return 'crashes';
    if (/\b(anr|frozen|freeze|hang|hung)\b/.test(normalized)) return 'anrs';
    if (/\b(rage tap|rage taps|rage)\b/.test(normalized)) return 'rage';
    if (/\b(dead tap|dead taps)\b/.test(normalized)) return 'dead_taps';
    if (/\b(slow start|slow startup|startup slow|launch slow|slow launch)\b/.test(normalized)) return 'slow_start';
    if (/\b(slow api|slow request|slow requests|slow network|api latency)\b/.test(normalized)) return 'slow_api';
    if (/\b(error|errors|exception|exceptions|failed request|request failed|api failed|api failure|bug|bugs)\b/.test(normalized)) return 'errors';
    return undefined;
}

function inferPlatformFromPrompt(prompt: string): 'ios' | 'android' | undefined {
    const normalized = prompt.toLowerCase();
    if (/\b(ios|iphone|ipad|apple)\b/.test(normalized)) return 'ios';
    if (/\b(android|pixel|samsung)\b/.test(normalized)) return 'android';
    return undefined;
}

function inferLifecycleFromPrompt(prompt: string): 'early_user' | 'returning_user' | undefined {
    const normalized = prompt.toLowerCase();
    if (/\b(new user|new users|first time|first-time|first session|first few sessions|onboarding|just joined|recent signup)\b/.test(normalized)) return 'early_user';
    if (/\b(returning|repeat user|repeat users|came back|loyal|churned users who returned|reactivated|winback|came back after)\b/.test(normalized)) return 'returning_user';
    return undefined;
}

function inferConversionFromPrompt(prompt: string): 'checkout_bounced' | 'checkout_success' | undefined {
    const normalized = prompt.toLowerCase();
    const mentionsCheckout = /\b(checkout|cart|payment|purchase|order)\b/.test(normalized);
    if (!mentionsCheckout) return undefined;
    if (/\b(success|successful|completed|complete|purchased|paid|converted|conversion|placed order|order placed)\b/.test(normalized)) return 'checkout_success';
    if (/\b(left|leave|exited|exit|dropped off|drop off|dropoff|drop-off|abandoned|abandon|bounced|bounce|failed|failure|payment failed|card declined)\b/.test(normalized)) return 'checkout_bounced';
    return undefined;
}

function sanitizeQueryBuilderCondition(raw: any, filters: AvailableProjectFilters, prompt: string): QueryBuilderCondition | null {
    if (!raw || typeof raw !== 'object') return null;
    const type = normalizeString(raw.type);

    switch (type) {
        case 'issue': {
            const issueFilter = normalizeString(raw.issueFilter);
            if (!VALID_ISSUE_FILTERS.has(issueFilter)) return null;
            return { id: randomUUID(), type: 'issue', issueFilter: issueFilter as QueryBuilderIssueFilter };
        }
        case 'date': {
            const mode = normalizeString(raw.mode);
            if (mode === 'exact') {
                const date = normalizeString(raw.date);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
                return { id: randomUUID(), type: 'date', mode: 'exact', date };
            }
            const timeRange = normalizeString(raw.timeRange);
            if (!VALID_TIME_RANGES.has(timeRange)) return null;
            return { id: randomUUID(), type: 'date', mode: 'range', timeRange: timeRange as QueryBuilderTimeRange };
        }
        case 'screen': {
            const screenName = findAllowedValue(raw.screenName, filters.screens);
            if (!screenName) return null;
            const screenOutcomeRaw = normalizeString(raw.screenOutcome);
            const screenOutcome = screenOutcomeRaw === 'bounced' || screenOutcomeRaw === 'continued'
                ? screenOutcomeRaw
                : inferScreenOutcomeFromPrompt(prompt);
            const screenVisitCountOp = sanitizeCountOp(raw.screenVisitCountOp);
            const screenVisitCountValue = screenVisitCountOp ? sanitizePositiveIntString(raw.screenVisitCountValue) : undefined;
            return { id: randomUUID(), type: 'screen', screenName, screenOutcome, screenVisitCountOp, screenVisitCountValue };
        }
        case 'event': {
            const eventName = findAllowedValue(raw.eventName, filters.events);
            if (!eventName) return null;
            const eventCountOp = sanitizeCountOp(raw.eventCountOp);
            const eventCountValue = eventCountOp ? sanitizePositiveIntString(raw.eventCountValue) : undefined;
            const eventPropKey = findAllowedValue(raw.eventPropKey, filters.eventPropertyKeys) ?? undefined;
            const eventPropValue = eventPropKey ? normalizeString(raw.eventPropValue) || undefined : undefined;
            return { id: randomUUID(), type: 'event', eventName, eventCountOp, eventCountValue, eventPropKey, eventPropValue };
        }
        case 'metadata': {
            const metaKey = findAllowedValue(raw.metaKey, Object.keys(filters.metadata));
            if (!metaKey) return null;
            const knownValue = findAllowedValue(raw.metaValue, filters.metadata[metaKey] ?? []);
            const typedValue = normalizeString(raw.metaValue);
            return { id: randomUUID(), type: 'metadata', metaKey, metaValue: knownValue ?? (typedValue || undefined) };
        }
        case 'lifecycle': {
            const preset = normalizeString(raw.preset);
            if (preset !== 'early_user' && preset !== 'returning_user') return null;
            const rawWindowSize = Number(raw.sessionWindowSize);
            const sessionWindowSize = Number.isFinite(rawWindowSize)
                ? Math.min(25, Math.max(1, Math.floor(rawWindowSize)))
                : 5;
            const returnedCountOp = preset === 'returning_user' ? sanitizeCountOp(raw.returnedCountOp) : undefined;
            const returnedCountValue = returnedCountOp ? sanitizePositiveIntString(raw.returnedCountValue) : undefined;
            return { id: randomUUID(), type: 'lifecycle', preset, sessionWindowSize, returnedCountOp, returnedCountValue };
        }
        case 'conversion': {
            const preset = normalizeString(raw.preset);
            if (preset !== 'checkout_bounced' && preset !== 'checkout_success') return null;
            return { id: randomUUID(), type: 'conversion', preset };
        }
        case 'platform': {
            const requestedPlatform = inferPlatformFromPrompt(prompt);
            if (!requestedPlatform) return null;
            const platform = normalizeString(raw.platform).toLowerCase();
            if (platform !== requestedPlatform) return null;
            return { id: randomUUID(), type: 'platform', platform: requestedPlatform };
        }
        case 'journey': {
            const rawSteps: unknown[] = Array.isArray(raw.steps) ? raw.steps : [];
            const steps = rawSteps
                .map((step) => findAllowedValue(step, filters.screens))
                .filter((step): step is string => Boolean(step));
            const uniqueOrderedSteps = steps.filter((step, index) => index === 0 || step !== steps[index - 1]);
            if (uniqueOrderedSteps.length < 2) return null;
            return { id: randomUUID(), type: 'journey', steps: uniqueOrderedSteps.slice(0, 6) };
        }
        default:
            return null;
    }
}

function sanitizeQueryBuilderGroups(rawGroups: unknown, filters: AvailableProjectFilters, prompt: string): QueryBuilderGroup[] {
    const groups: unknown[] = Array.isArray(rawGroups) ? rawGroups : [];
    const sanitized = groups.slice(0, 4).map((rawGroup: any) => {
        const rawConditions: unknown[] = Array.isArray(rawGroup?.conditions) ? rawGroup.conditions : [];
        const conditions = rawConditions
            .slice(0, 8)
            .map((condition) => sanitizeQueryBuilderCondition(condition, filters, prompt))
            .filter((condition): condition is QueryBuilderCondition => Boolean(condition));
        return { id: randomUUID(), conditions };
    }).filter((group) => group.conditions.length > 0);

    return sanitized.length > 0 ? sanitized : [{ id: randomUUID(), conditions: [] }];
}

function conditionExists(groups: QueryBuilderGroup[], type: QueryBuilderCondition['type']): boolean {
    return groups.some((group) => group.conditions.some((condition) => condition.type === type));
}

function addToFirstGroup(groups: QueryBuilderGroup[], condition: QueryBuilderCondition): QueryBuilderGroup[] {
    const [first, ...rest] = groups.length > 0 ? groups : [{ id: randomUUID(), conditions: [] }];
    return [{ ...first, conditions: [...first.conditions, condition] }, ...rest];
}

function findMentionedAllowedValue(prompt: string, allowed: string[]): string | null {
    const normalizedPrompt = canonicalizeQueryLabel(prompt);
    if (!normalizedPrompt) return null;
    const matches = allowed
        .map((candidate) => ({ candidate, canonical: canonicalizeQueryLabel(candidate) }))
        .filter(({ canonical }) => canonical.length >= 2 && normalizedPrompt.includes(canonical))
        .sort((a, b) => b.canonical.length - a.canonical.length);
    return matches[0]?.candidate ?? null;
}

function dedupeConditions(conditions: QueryBuilderCondition[]): QueryBuilderCondition[] {
    const byKey = new Map<string, QueryBuilderCondition>();

    for (const condition of conditions) {
        const key = (() => {
            switch (condition.type) {
                case 'screen':
                    return `screen:${condition.screenName.toLowerCase()}`;
                case 'event':
                    return `event:${condition.eventName.toLowerCase()}:${condition.eventPropKey ?? ''}:${condition.eventPropValue ?? ''}`;
                case 'metadata':
                    return `metadata:${condition.metaKey.toLowerCase()}:${condition.metaValue ?? ''}`;
                case 'journey':
                    return `journey:${condition.steps.join('|').toLowerCase()}`;
                default:
                    return condition.type;
            }
        })();

        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, condition);
            continue;
        }

        if (existing.type === 'screen' && condition.type === 'screen') {
            byKey.set(key, {
                ...existing,
                screenOutcome: existing.screenOutcome ?? condition.screenOutcome,
                screenVisitCountOp: existing.screenVisitCountOp ?? condition.screenVisitCountOp,
                screenVisitCountValue: existing.screenVisitCountValue ?? condition.screenVisitCountValue,
            });
        }
    }

    return [...byKey.values()];
}

function dedupeQueryBuilderGroups(groups: QueryBuilderGroup[]): QueryBuilderGroup[] {
    return groups
        .map((group) => ({ ...group, conditions: dedupeConditions(group.conditions) }))
        .filter((group) => group.conditions.length > 0);
}

function describeQueryBuilderCondition(condition: QueryBuilderCondition): string {
    switch (condition.type) {
        case 'issue': {
            const labels: Record<QueryBuilderIssueFilter, string> = {
                crashes: 'sessions with crashes',
                anrs: 'sessions with ANRs',
                errors: 'sessions with errors',
                rage: 'sessions with rage taps',
                dead_taps: 'sessions with dead taps',
                slow_start: 'sessions with slow starts',
                slow_api: 'sessions with slow API calls',
            };
            return labels[condition.issueFilter] ?? `sessions with ${condition.issueFilter}`;
        }
        case 'date':
            if (condition.mode === 'exact') return `sessions on ${condition.date}`;
            return `sessions from ${condition.timeRange}`;
        case 'screen':
            if (condition.screenOutcome === 'bounced') {
                return `visited ${condition.screenName} and left before another screen`;
            }
            if (condition.screenOutcome === 'continued') {
                return `visited ${condition.screenName} and continued to another screen`;
            }
            return `visited ${condition.screenName}`;
        case 'event':
            return `triggered ${condition.eventName}`;
        case 'metadata':
            return condition.metaValue
                ? `metadata ${condition.metaKey} is ${condition.metaValue}`
                : `metadata includes ${condition.metaKey}`;
        case 'lifecycle':
            return condition.preset === 'early_user' ? 'early users' : 'returning users';
        case 'conversion':
            return condition.preset === 'checkout_success' ? 'completed checkout' : 'left checkout';
        case 'platform':
            return `on ${condition.platform === 'ios' ? 'iOS' : 'Android'}`;
        case 'journey':
            return `followed ${condition.steps.join(' to ')}`;
    }
}

function describeQueryBuilderGroups(groups: QueryBuilderGroup[]): string {
    const nonEmpty = groups.filter((group) => group.conditions.length > 0);
    if (nonEmpty.length === 0) return '';

    const descriptions = nonEmpty
        .map((group) => group.conditions.map(describeQueryBuilderCondition).join(' and '))
        .filter(Boolean);
    if (descriptions.length === 0) return '';

    return `Find sessions where ${descriptions.join(' or ')}.`;
}

function enrichQueryBuilderGroups(groups: QueryBuilderGroup[], filters: AvailableProjectFilters, prompt: string): QueryBuilderGroup[] {
    let next = groups.length > 0 ? groups : [{ id: randomUUID(), conditions: [] }];
    const inferredOutcome = inferScreenOutcomeFromPrompt(prompt);

    if (inferredOutcome) {
        next = next.map((group) => ({
            ...group,
            conditions: group.conditions.map((condition) =>
                condition.type === 'screen'
                    ? { ...condition, screenOutcome: inferredOutcome }
                    : condition
            ),
        }));
    }

    if (!conditionExists(next, 'date')) {
        const timeRange = inferTimeRangeFromPrompt(prompt);
        if (timeRange) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'date', mode: 'range', timeRange });
        }
    }

    if (!conditionExists(next, 'issue')) {
        const issueFilter = inferIssueFromPrompt(prompt);
        if (issueFilter) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'issue', issueFilter });
        }
    }

    if (!conditionExists(next, 'platform')) {
        const platform = inferPlatformFromPrompt(prompt);
        if (platform) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'platform', platform });
        }
    }

    if (!conditionExists(next, 'lifecycle')) {
        const preset = inferLifecycleFromPrompt(prompt);
        if (preset) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'lifecycle', preset, sessionWindowSize: 5 });
        }
    }

    if (!conditionExists(next, 'conversion')) {
        const preset = inferConversionFromPrompt(prompt);
        if (preset) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'conversion', preset });
        }
    }

    if (!conditionExists(next, 'screen') && !conditionExists(next, 'journey')) {
        const screenName = findMentionedAllowedValue(prompt, filters.screens);
        if (screenName) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'screen', screenName, screenOutcome: inferredOutcome });
        }
    }

    if (!conditionExists(next, 'event')) {
        const eventName = findMentionedAllowedValue(prompt, filters.events);
        if (eventName) {
            next = addToFirstGroup(next, { id: randomUUID(), type: 'event', eventName });
        }
    }

    if (!conditionExists(next, 'metadata')) {
        const metadataKeys = Object.keys(filters.metadata);
        const metaKey = findMentionedAllowedValue(prompt, metadataKeys);
        if (metaKey) {
            const metaValue = findMentionedAllowedValue(prompt, filters.metadata[metaKey] ?? []) ?? undefined;
            next = addToFirstGroup(next, { id: randomUUID(), type: 'metadata', metaKey, metaValue });
        }
    }

    return dedupeQueryBuilderGroups(next);
}

async function loadAvailableProjectFilters(projectId: string): Promise<AvailableProjectFilters> {
    const eventsQuery = await db.execute(sql`
        SELECT DISTINCT elem->>'name' as event_name
        FROM ${sessions}, jsonb_array_elements(events) as elem
        WHERE project_id = ${projectId} AND elem->>'name' IS NOT NULL
        LIMIT 1000
    `);

    const metadataQuery = await db.execute(sql`
        SELECT DISTINCT key as meta_key, value as meta_value
        FROM ${sessions}, jsonb_each_text(metadata)
        WHERE project_id = ${projectId}
        LIMIT 1000
    `);

    const screensQuery = await db.execute(sql`
        SELECT DISTINCT screen_name
        FROM ${sessions}
        INNER JOIN ${sessionMetrics} ON ${sessionMetrics.sessionId} = ${sessions.id}
        CROSS JOIN LATERAL unnest(COALESCE(${sessionMetrics.screensVisited}, ARRAY[]::text[])) as screen_names(screen_name)
        WHERE ${sessions.projectId} = ${projectId}
          AND screen_name IS NOT NULL
          AND screen_name <> ''
        ORDER BY screen_name
        LIMIT 500
    `);

    const eventPropsQuery = await db.execute(sql`
        SELECT DISTINCT kv.key as prop_key
        FROM ${sessions},
             jsonb_array_elements(events) as elem,
             jsonb_each(COALESCE(elem->'properties', '{}'::jsonb)) as kv(key, value)
        WHERE project_id = ${projectId}
        LIMIT 500
    `);

    const availableEvents = Array.isArray(eventsQuery)
        ? eventsQuery.map((row: any) => row.event_name as string).filter(Boolean)
        : (eventsQuery as any).rows?.map((row: any) => row.event_name as string).filter(Boolean) || [];
    const availableScreens = Array.isArray(screensQuery)
        ? screensQuery.map((row: any) => row.screen_name as string).filter(Boolean)
        : (screensQuery as any).rows?.map((row: any) => row.screen_name as string).filter(Boolean) || [];
    const eventPropertyKeys = Array.isArray(eventPropsQuery)
        ? eventPropsQuery.map((row: any) => row.prop_key as string).filter(Boolean)
        : (eventPropsQuery as any).rows?.map((row: any) => row.prop_key as string).filter(Boolean) || [];

    const availableMetadata: Record<string, string[]> = {};
    const metaRows = Array.isArray(metadataQuery) ? metadataQuery : (metadataQuery as any).rows || [];
    metaRows.forEach((row: any) => {
        const key = row.meta_key as string;
        const value = row.meta_value as string;
        if (key && value) {
            if (!availableMetadata[key]) availableMetadata[key] = [];
            availableMetadata[key].push(value);
        }
    });

    return {
        events: availableEvents,
        eventPropertyKeys,
        screens: availableScreens,
        metadata: availableMetadata,
    };
}

async function loadQueryBuilderProjectContext(projectId: string): Promise<QueryBuilderProjectContext | null> {
    const [project] = await db
        .select({
            name: projects.name,
            platform: projects.platform,
            bundleId: projects.bundleId,
            packageName: projects.packageName,
            webDomain: projects.webDomain,
            sampleRate: projects.sampleRate,
            recordingEnabled: projects.recordingEnabled,
            rejourneyEnabled: projects.rejourneyEnabled,
            maxRecordingMinutes: projects.maxRecordingMinutes,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    return project ?? null;
}

function buildGeminiGenerateContentUrl(model: string): string {
    const normalizedModel = model.startsWith('models/') ? model.slice('models/'.length) : model;
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

function extractGeminiOutputText(payload: any): string {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        for (const part of parts) {
            if (typeof part?.text === 'string') {
                return part.text;
            }
        }
    }
    return '';
}

function buildQueryBuilderPrompt(input: {
    prompt: string;
    filters: AvailableProjectFilters;
    project: QueryBuilderProjectContext | null;
    today: string;
}): string {
    return JSON.stringify({
        task: 'Convert the user request into a project-aware session archive query. Conditions inside one group are ANDed. Multiple groups are ORed.',
        today: input.today,
        userRequest: input.prompt,
        projectSetup: input.project,
        availableQueryContext: {
            screensOrPages: input.filters.screens.slice(0, 300),
            events: input.filters.events.slice(0, 300),
            eventPropertyKeys: input.filters.eventPropertyKeys.slice(0, 200),
            metadataKeys: Object.keys(input.filters.metadata).slice(0, 200),
            metadataValuesByKey: Object.fromEntries(
                Object.entries(input.filters.metadata)
                    .slice(0, 100)
                    .map(([key, values]) => [key, values.slice(0, 50)])
            ),
        },
        allowedConditionTypes: {
            issue: ['crashes', 'anrs', 'errors', 'rage', 'dead_taps', 'slow_start', 'slow_api'],
            date: ['range: 24h, 7d, 30d, 90d, 1y', 'exact: YYYY-MM-DD'],
            platform: ['ios', 'android'],
            lifecycle: ['early_user', 'returning_user'],
            conversion: ['checkout_bounced', 'checkout_success'],
            screen: 'screenName must come from screensOrPages',
            event: 'eventName must come from events',
            metadata: 'metaKey must come from metadataKeys',
            journey: 'steps must come from screensOrPages in visit order',
        },
        outputRules: [
            'Return only query conditions that are supported by the allowed condition types.',
            'Use project setup only as context. Never add a platform condition unless the user explicitly says iOS, iPhone, iPad, Apple, Android, Pixel, or Samsung.',
            'Every condition must be directly requested by the user. Do not add filters just because they are common, likely, or present in project setup.',
            'Prefer the smallest accurate query. Do not duplicate the same screen, page, event, metadata, platform, issue, lifecycle, conversion, or journey condition.',
            'Use available app-specific screens/pages, events, metadata keys, and event properties exactly as provided.',
            'If the user says page, route, view, or screen, match it to screensOrPages.',
            'Infer intent from synonyms and paraphrases, not only exact words.',
            'For screen/page outcome: map left/exited/dropped/abandoned/bounced/failed/churned/pre-churn/could-not-complete to screenOutcome=bounced.',
            'For screen/page outcome: map continued/proceeded/moved-forward/completed/succeeded to screenOutcome=continued.',
            'When user intent is failure at checkout/payment/cart/order, prefer conversion preset checkout_bounced.',
            'When user intent is successful checkout/payment/cart/order completion, prefer conversion preset checkout_success.',
            'When user asks for crashes, hangs/freezes, rage taps, dead taps, slow startup, slow API, errors/exceptions/failed API requests, map to the matching issue filter.',
            'When user asks for new/first-time/onboarding users, map to lifecycle early_user.',
            'When user asks for returning/reactivated/came-back users, map to lifecycle returning_user.',
            'If the user asks for alternatives, represent them as multiple groups.',
            'If the request is too vague or impossible with the provided values, return an empty groups array and a concise explanation.',
        ],
        commonExamples: [
            {
                input: 'users who left at the home page',
                output: [{ type: 'screen', screenName: 'matching Home screen/page', screenOutcome: 'bounced' }],
            },
            {
                input: 'users likely to churn after visiting pricing page',
                output: [{ type: 'screen', screenName: 'matching Pricing screen/page', screenOutcome: 'bounced' }],
            },
            {
                input: 'users who failed adding a post',
                output: [{ type: 'screen', screenName: 'matching Add-post screen/page', screenOutcome: 'bounced' }],
            },
            {
                input: 'user that failed to add post',
                output: [{ type: 'screen', screenName: 'matching Add-post screen/page', screenOutcome: 'bounced' }],
            },
            {
                input: 'users who continued after login',
                output: [{ type: 'screen', screenName: 'matching Login screen/page', screenOutcome: 'continued' }],
            },
            {
                input: 'users who completed checkout successfully',
                output: [{ type: 'conversion', preset: 'checkout_success' }],
            },
            {
                input: 'payment failed at checkout',
                output: [{ type: 'conversion', preset: 'checkout_bounced' }],
            },
            {
                input: 'iOS crashes in the last week',
                output: [
                    { type: 'platform', platform: 'ios' },
                    { type: 'issue', issueFilter: 'crashes' },
                    { type: 'date', mode: 'range', timeRange: '7d' },
                ],
            },
            {
                input: 'rage taps on checkout',
                output: [
                    { type: 'issue', issueFilter: 'rage' },
                    { type: 'screen', screenName: 'matching Checkout screen/page' },
                ],
            },
            {
                input: 'checkout dropoffs',
                output: [{ type: 'conversion', preset: 'checkout_bounced' }],
            },
            {
                input: 'new users on android',
                output: [
                    { type: 'lifecycle', preset: 'early_user' },
                    { type: 'platform', platform: 'android' },
                ],
            },
            {
                input: 'users with plan pro',
                output: [{ type: 'metadata', metaKey: 'matching plan metadata key', metaValue: 'matching pro value' }],
            },
            {
                input: 'new users hitting errors this week',
                output: [
                    { type: 'lifecycle', preset: 'early_user' },
                    { type: 'issue', issueFilter: 'errors' },
                    { type: 'date', mode: 'range', timeRange: '7d' },
                ],
            },
        ],
    });
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function computeHealthScore(input: {
    sessionsTotal: number;
    errorsTotal: number;
    crashesTotal: number;
    anrsTotal: number;
    avgUxScoreAllTime: number;
    avgApiErrorRateAllTime: number;
    rageTapTotal: number;
}): number {
    if (input.sessionsTotal <= 0) return 60;
    const hasAnyMetricSignal = (
        input.avgUxScoreAllTime > 0
        || input.errorsTotal > 0
        || input.crashesTotal > 0
        || input.anrsTotal > 0
        || input.avgApiErrorRateAllTime > 0
        || input.rageTapTotal > 0
    );
    if (!hasAnyMetricSignal) return 65;

    const sessionsCount = Math.max(1, input.sessionsTotal);
    const errorRate = input.errorsTotal / sessionsCount;
    const crashAnrRate = (input.crashesTotal + input.anrsTotal) / sessionsCount;
    const rageTapRate = input.rageTapTotal / sessionsCount;
    const apiErrorRate = Math.max(0, Number(input.avgApiErrorRateAllTime || 0));

    const uxScore = input.avgUxScoreAllTime > 0 ? input.avgUxScoreAllTime : 70;
    const reliabilityScore = clamp(100 - (errorRate * 120), 0, 100);
    const stabilityScore = clamp(100 - (crashAnrRate * 250), 0, 100);
    const apiReliabilityScore = input.avgApiErrorRateAllTime > 0
        ? clamp(100 - (apiErrorRate * 140), 0, 100)
        : 85;
    const interactionStabilityScore = clamp(100 - (rageTapRate * 160), 0, 100);

    const score = (
        (uxScore * 0.35)
        + (reliabilityScore * 0.2)
        + (stabilityScore * 0.25)
        + (apiReliabilityScore * 0.15)
        + (interactionStabilityScore * 0.05)
    );

    return Math.round(clamp(score, 0, 100));
}

function buildProjectListCacheKey(userId: string): string {
    return `projects:list:user:${userId}:v2`;
}

async function invalidateProjectListCacheForTeam(teamId: string | null | undefined): Promise<void> {
    if (!teamId) return;

    try {
        const members = await db
            .select({ userId: teamMembers.userId })
            .from(teamMembers)
            .where(eq(teamMembers.teamId, teamId));
        const userIds = Array.from(new Set(members.map((member) => member.userId).filter(Boolean)));
        if (userIds.length === 0) return;

        const redis = getRedis();
        await redis.del(...userIds.map(buildProjectListCacheKey));
    } catch (err) {
        logger.warn({ err, teamId }, 'Failed to invalidate project list cache');
    }
}

function getHealthLevel(score: number): 'excellent' | 'good' | 'fair' | 'critical' {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    return 'critical';
}

/**
 * Get all projects for user
 * GET /api/projects
 */
router.get(
    '/',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const redis = getRedis();
        const cacheKey = buildProjectListCacheKey(req.user!.id);

        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                res.json(JSON.parse(cached));
                return;
            }
        } catch (err) {
            logger.warn({ err, userId: req.user!.id }, 'Failed to read project list cache');
        }

        // Get user's teams
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.json({ projects: [] });
            return;
        }

        // Get projects for those teams
        const projectsList = await db
            .select()
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)))
            .orderBy(desc(projects.createdAt));

        if (projectsList.length === 0) {
            res.json({ projects: [] });
            return;
        }

        const projectIds = projectsList.map((project) => project.id);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
        sevenDaysAgo.setUTCHours(0, 0, 0, 0);
        const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

        const [allTimeRows, dailyRows] = await Promise.all([
            db
                .select({
                    projectId: appAllTimeStats.projectId,
                    totalSessions: appAllTimeStats.totalSessions,
                    totalErrors: appAllTimeStats.totalErrors,
                    avgUxScore: appAllTimeStats.avgUxScore,
                    avgApiErrorRate: appAllTimeStats.avgApiErrorRate,
                    totalRageTaps: appAllTimeStats.totalRageTaps,
                })
                .from(appAllTimeStats)
                .where(inArray(appAllTimeStats.projectId, projectIds)),
            db
                .select({
                    projectId: appDailyStats.projectId,
                    date: appDailyStats.date,
                    totalSessions: appDailyStats.totalSessions,
                    totalErrors: appDailyStats.totalErrors,
                    totalCrashes: appDailyStats.totalCrashes,
                    totalAnrs: appDailyStats.totalAnrs,
                    totalRageTaps: appDailyStats.totalRageTaps,
                })
                .from(appDailyStats)
                .where(inArray(appDailyStats.projectId, projectIds)),
        ]);

        const allTimeByProject = new Map(allTimeRows.map((row) => [row.projectId, row]));
        const aggregatesByProject = new Map<string, {
            sessionsLast7Days: number;
            errorsLast7Days: number;
            crashesTotal: number;
            anrsTotal: number;
            rageTapTotal: number;
        }>();

        for (const row of dailyRows) {
            const projectAggregate = aggregatesByProject.get(row.projectId) ?? {
                sessionsLast7Days: 0,
                errorsLast7Days: 0,
                crashesTotal: 0,
                anrsTotal: 0,
                rageTapTotal: 0,
            };
            if (row.date >= sevenDaysAgoStr) {
                projectAggregate.sessionsLast7Days += Number(row.totalSessions || 0);
                projectAggregate.errorsLast7Days += Number(row.totalErrors || 0);
            }
            projectAggregate.crashesTotal += Number(row.totalCrashes || 0);
            projectAggregate.anrsTotal += Number(row.totalAnrs || 0);
            projectAggregate.rageTapTotal += Number(row.totalRageTaps || 0);
            aggregatesByProject.set(row.projectId, projectAggregate);
        }

        const projectStats = projectsList.map((project) => {
            const allTimeMetrics = allTimeByProject.get(project.id);
            const dailyAggregate = aggregatesByProject.get(project.id);

            const sessionsTotal = Number(allTimeMetrics?.totalSessions ?? 0);
            const sessionsLast7Days = Number(dailyAggregate?.sessionsLast7Days ?? 0);
            const errorsLast7Days = Number(dailyAggregate?.errorsLast7Days ?? 0);
            const errorsTotal = Number(allTimeMetrics?.totalErrors ?? 0);
            const crashesTotal = Number(dailyAggregate?.crashesTotal ?? 0);
            const anrsTotal = Number(dailyAggregate?.anrsTotal ?? 0);
            const avgUxScoreAllTime = Number(allTimeMetrics?.avgUxScore ?? 0);
            const avgApiErrorRateAllTime = Number(allTimeMetrics?.avgApiErrorRate ?? 0);
            const rageTapTotal = Number(dailyAggregate?.rageTapTotal ?? allTimeMetrics?.totalRageTaps ?? 0);
            const healthScore = computeHealthScore({
                sessionsTotal,
                errorsTotal,
                crashesTotal,
                anrsTotal,
                avgUxScoreAllTime,
                avgApiErrorRateAllTime,
                rageTapTotal,
            });
            const healthLevel = getHealthLevel(healthScore);

            return {
                ...project,
                platforms: getProjectPlatforms(project),
                sessionsTotal,
                sessionsLast7Days,
                errorsLast7Days,
                errorsTotal,
                crashesTotal,
                anrsTotal,
                avgUxScoreAllTime,
                apiErrorsTotal: 0,
                apiTotalCount: 0,
                rageTapTotal,
                healthScore,
                healthLevel,
            };
        });

        const responseBody = { projects: projectStats };

        try {
            await redis.set(cacheKey, JSON.stringify(responseBody), 'EX', PROJECT_LIST_CACHE_TTL_SECONDS);
        } catch (err) {
            logger.warn({ err, userId: req.user!.id }, 'Failed to write project list cache');
        }

        res.json(responseBody);
    })
);

/**
 * Create a new project
 * POST /api/projects
 */
router.post(
    '/',
    sessionAuth,
    writeApiRateLimiter,
    dashboardRateLimiter,
    validate(createProjectSchema),
    asyncHandler(async (req, res) => {
        const data = req.body;

        // Get default team if not specified
        let teamId = data.teamId;
        if (!teamId) {
            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.userId, req.user!.id), eq(teamMembers.role, 'owner')))
                .limit(1);

            if (!membership) {
                throw ApiError.badRequest('No team found. Please create a team first.');
            }
            teamId = membership.teamId;
        } else {
            // Verify user has access to the team
            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.user!.id)))
                .limit(1);

            if (!membership) {
                throw ApiError.forbidden('No access to this team');
            }
        }

        await enforceNewAccountActionLimit({
            userId: req.user!.id,
            action: 'project_create',
        });

        await assertNoDuplicateContentSpam({
            actorId: req.user!.id,
            action: 'project_create',
            contentParts: [data.name, data.webDomain],
            targetId: teamId,
        });

        // Generate public key for SDK (with collision-safe retry)
        const MAX_KEY_RETRIES = 3;
        let project: any;
        for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
            const publicKey = `rj_${randomBytes(16).toString('hex')}`;
            try {
                [project] = await db.insert(projects).values({
                    name: data.name,
                    teamId,
                    bundleId: data.bundleId,
                    packageName: data.packageName,
                    webDomain: data.webDomain,
                    platform: data.platforms?.[0],
                    publicKey,
                    rejourneyEnabled: data.rejourneyEnabled ?? true,
                    recordingEnabled: data.recordingEnabled ?? true,
                    sampleRate: data.sampleRate ?? 100,
                    maxRecordingMinutes: data.maxRecordingMinutes ?? 10,
                }).returning();
                break; // Success
            } catch (err: any) {
                // Unique constraint violation on public_key — retry with a new key
                if (err.code === '23505' && err.constraint?.includes('public_key')) {
                    logger.warn({ attempt }, 'Public key collision detected, retrying');
                    if (attempt === MAX_KEY_RETRIES - 1) {
                        throw ApiError.internal('Failed to generate unique project key after retries');
                    }
                    continue;
                }
                throw err; // Re-throw other errors
            }
        }

        logger.info({ projectId: project.id, userId: req.user!.id }, 'Project created');

        await invalidateProjectListCacheForTeam(teamId);

        // Create default alert settings for the project
        await db.insert(alertSettings).values({
            projectId: project.id,
            crashAlertsEnabled: true,
            anrAlertsEnabled: true,
            errorSpikeAlertsEnabled: true,
            apiDegradationAlertsEnabled: true,
            errorSpikeThresholdPercent: 50,
            apiDegradationThresholdPercent: 100,
            apiLatencyThresholdMs: 3000,
        });

        // Add team owners as default alert recipients (max 5)
        const owners = await db
            .select({ userId: teamMembers.userId })
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner')))
            .limit(5);

        for (const { userId } of owners) {
            await db.insert(alertRecipients).values({
                projectId: project.id,
                userId,
            });
        }

        if (owners.length > 0) {
            logger.info({ projectId: project.id, ownerCount: owners.length }, 'Added team owners as default alert recipients');
        }

        // Audit log
        await auditFromRequest(req, 'project_created', {
            targetType: 'project',
            targetId: project.id,
            teamId,
            newValue: getProjectAuditState(project),
            metadata: {
                createdWithExplicitTeam: data.teamId !== undefined,
            },
        });

        res.status(201).json({
            project: {
                ...project,
                platforms: getProjectPlatforms(project),
            },
        });
    })
);

/**
 * Get project by ID
 * GET /api/projects/:id
 */
router.get(
    '/:id',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, req.params.id))
            .limit(1);

        if (!project || project.deletedAt) {
            throw ApiError.notFound('Project not found');
        }

        res.json({
            ...project,
            platforms: getProjectPlatforms(project),
        });
    })
);

/**
 * Update project
 * PUT /api/projects/:id
 */
router.put(
    '/:id',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(updateProjectSchema),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        const data = req.body;

        // Fetch current project to check existing values
        const [currentProject] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, req.params.id))
            .limit(1);

        if (!currentProject) {
            throw ApiError.notFound('Project not found');
        }

        // If changing team, verify access to new team
        if (data.teamId) {
            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, req.user!.id)))
                .limit(1);

            if (!membership || !['owner', 'admin'].includes(membership.role)) {
                throw ApiError.forbidden('Admin access required to move project');
            }
        }

        if (
            data.name !== undefined ||
            data.webDomain !== undefined ||
            data.bundleId !== undefined ||
            data.packageName !== undefined
        ) {
            await assertNoDuplicateContentSpam({
                actorId: req.user!.id,
                action: 'project_update',
                contentParts: [
                    data.name,
                    typeof data.webDomain === 'string' ? data.webDomain : null,
                ],
                targetId: req.params.id,
            });
        }

        // Build update object, only including fields that should be updated
        const updateData: Record<string, any> = {
            updatedAt: new Date(),
        };

        // Only include fields that are explicitly provided
        if (data.name !== undefined) updateData.name = data.name;
        if (data.teamId !== undefined) updateData.teamId = data.teamId;
        if (data.bundleId !== undefined) updateData.bundleId = data.bundleId;
        if (data.packageName !== undefined) updateData.packageName = data.packageName;
        if (data.webDomain !== undefined) updateData.webDomain = data.webDomain;
        if (data.rejourneyEnabled !== undefined) updateData.rejourneyEnabled = data.rejourneyEnabled;
        if (data.recordingEnabled !== undefined) updateData.recordingEnabled = data.recordingEnabled;
        if (data.sampleRate !== undefined) updateData.sampleRate = data.sampleRate;
        if (data.maxRecordingMinutes !== undefined) updateData.maxRecordingMinutes = data.maxRecordingMinutes;

        const [project] = await db.update(projects)
            .set(updateData)
            .where(eq(projects.id, req.params.id))
            .returning();

        const shouldInvalidateConfig =
            data.sampleRate !== undefined ||
            data.maxRecordingMinutes !== undefined ||
            data.recordingEnabled !== undefined ||
            data.rejourneyEnabled !== undefined;

        if (shouldInvalidateConfig) {
            try {
                await getRedis().del(`sdk:config:${project.publicKey}`);
            } catch {
                // ignore cache errors
            }
        }

        await Promise.all([
            invalidateProjectListCacheForTeam(currentProject.teamId),
            data.teamId && data.teamId !== currentProject.teamId
                ? invalidateProjectListCacheForTeam(data.teamId)
                : Promise.resolve(),
        ]);

        logger.info({ projectId: project.id, userId: req.user!.id }, 'Project updated');

        const changes = buildAuditFieldChanges(
            getProjectAuditState(currentProject),
            getProjectAuditState(project),
        );
        if (changes.changedFields.length > 0) {
            await auditFromRequest(req, 'project_updated', {
                targetType: 'project',
                targetId: project.id,
                teamId: currentProject.teamId,
                previousValue: changes.previousValue,
                newValue: changes.newValue,
                metadata: {
                    changedFields: changes.changedFields,
                    newTeamId: project.teamId,
                    previousTeamId: currentProject.teamId,
                },
            });
        }

        res.json({
            project: {
                ...project,
                platforms: getProjectPlatforms(project),
            },
        });
    })
);

/**
 * Send project deletion OTP
 * POST /api/projects/:id/delete-otp
 */
router.post(
    '/:id/delete-otp',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(requestDeleteProjectOtpSchema),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.id;
        const { confirmText } = req.body;

        const [projectResult] = await db
            .select({
                project: projects,
                ownerUserId: teams.ownerUserId,
            })
            .from(projects)
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectResult) {
            throw ApiError.notFound('Project not found');
        }

        if (projectResult.ownerUserId !== req.user!.id) {
            throw ApiError.forbidden('Only the team owner can delete projects');
        }

        const expectedConfirmText =
            projectResult.project.name && projectResult.project.name.trim().length > 0
                ? projectResult.project.name
                : projectResult.project.id;
        if (confirmText !== expectedConfirmText) {
            throw ApiError.badRequest(
                `Confirmation text must match project ${projectResult.project.name ? 'name' : 'ID'} exactly`
            );
        }

        const otpResult = await sendDeletionOtp({
            scope: 'project',
            resourceId: projectResult.project.id,
            userId: req.user!.id,
            userEmail: req.user!.email,
        });

        res.json({
            success: true,
            message: 'OTP sent to your email. Enter it to confirm project deletion.',
            expiresInMinutes: otpResult.expiresInMinutes,
            ...(otpResult.devCode ? { devCode: otpResult.devCode } : {}),
        });
    })
);

/**
 * Delete project (hard delete, OTP confirmed)
 * DELETE /api/projects/:id
 */
router.delete(
    '/:id',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(deleteProjectSchema),
    asyncHandler(async (req, res) => {
        const projectId = req.params.id;
        const { confirmText, otpCode } = req.body;

        const [projectResult] = await db
            .select({
                project: projects,
                ownerUserId: teams.ownerUserId,
            })
            .from(projects)
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectResult) {
            throw ApiError.notFound('Project not found');
        }

        if (projectResult.ownerUserId !== req.user!.id) {
            throw ApiError.forbidden('Only the team owner can delete projects');
        }

        const expectedConfirmText =
            projectResult.project.name && projectResult.project.name.trim().length > 0
                ? projectResult.project.name
                : projectResult.project.id;
        if (confirmText !== expectedConfirmText) {
            throw ApiError.badRequest(
                `Confirmation text must match project ${projectResult.project.name ? 'name' : 'ID'} exactly`
            );
        }

        await verifyDeletionOtp({
            scope: 'project',
            resourceId: projectResult.project.id,
            userId: req.user!.id,
            code: otpCode,
        });

        await hardDeleteProject({
            id: projectResult.project.id,
            teamId: projectResult.project.teamId,
            name: projectResult.project.name,
            publicKey: projectResult.project.publicKey,
        });

        try {
            await getRedis().del(`sdk:config:${projectResult.project.publicKey}`);
        } catch {
            // ignore cache errors
        }

        await invalidateProjectListCacheForTeam(projectResult.project.teamId);

        logger.info({ projectId, userId: req.user!.id }, 'Project deleted (hard delete)');

        // Audit log
        await auditFromRequest(req, 'project_deleted', {
            targetType: 'project',
            targetId: projectId,
            teamId: projectResult.project.teamId,
            previousValue: { name: projectResult.project.name, teamId: projectResult.project.teamId },
            newValue: { hardDeleted: true, otpConfirmed: true, deletedByRole: 'owner' },
        });

        res.json({ success: true });
    })
);

/**
 * Build a session archive query from natural language
 * POST /api/projects/:id/query-builder
 */
router.post(
    '/:id/query-builder',
    sessionAuth,
    queryBuilderIpRateLimiter,
    queryBuilderUserRateLimiter,
    queryBuilderProjectRateLimiter,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        const prompt = normalizeString(req.body?.prompt);
        if (!prompt) {
            throw ApiError.badRequest('Describe what you want to filter by.');
        }
        if (prompt.length > QUERY_BUILDER_MAX_PROMPT_LENGTH) {
            throw ApiError.badRequest(`Filter description must be ${QUERY_BUILDER_MAX_PROMPT_LENGTH} characters or fewer.`);
        }
        if (!config.QUERY_BUILDER_KEY) {
            throw ApiError.serviceUnavailable('AI query builder is not configured.');
        }

        const [filters, projectContext] = await Promise.all([
            loadAvailableProjectFilters(req.params.id),
            loadQueryBuilderProjectContext(req.params.id),
        ]);
        const today = new Date().toISOString().slice(0, 10);
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), QUERY_BUILDER_TIMEOUT_MS);
        let response: Response;
        try {
            response = await fetch(buildGeminiGenerateContentUrl(config.QUERY_BUILDER_MODEL), {
                method: 'POST',
                signal: abortController.signal,
                headers: {
                    'x-goog-api-key': config.QUERY_BUILDER_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [
                            {
                                text: 'You translate product analytics query requests into a small JSON object. Use project setup and observed screens/pages/events/metadata as context. Do not invent screen names, page names, event names, metadata keys, or event property keys.',
                            },
                        ],
                    },
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    text: buildQueryBuilderPrompt({
                                        prompt,
                                        filters,
                                        project: projectContext,
                                        today,
                                    }),
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 700,
                        responseMimeType: 'application/json',
                        responseJsonSchema: {
                            type: 'object',
                            properties: {
                                explanation: { type: 'string' },
                                groups: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            conditions: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        type: { type: 'string' },
                                                        issueFilter: { type: 'string' },
                                                        mode: { type: 'string' },
                                                        date: { type: 'string' },
                                                        timeRange: { type: 'string' },
                                                        screenName: { type: 'string' },
                                                        screenOutcome: { type: 'string' },
                                                        screenVisitCountOp: { type: 'string' },
                                                        screenVisitCountValue: { type: 'string' },
                                                        eventName: { type: 'string' },
                                                        eventCountOp: { type: 'string' },
                                                        eventCountValue: { type: 'string' },
                                                        eventPropKey: { type: 'string' },
                                                        eventPropValue: { type: 'string' },
                                                        metaKey: { type: 'string' },
                                                        metaValue: { type: 'string' },
                                                        preset: { type: 'string' },
                                                        sessionWindowSize: { type: 'integer' },
                                                        returnedCountOp: { type: 'string' },
                                                        returnedCountValue: { type: 'string' },
                                                        platform: { type: 'string' },
                                                        steps: {
                                                            type: 'array',
                                                            items: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                            required: ['explanation', 'groups'],
                            propertyOrdering: ['explanation', 'groups'],
                        },
                    },
                }),
            });
        } catch (err) {
            logger.warn({ err }, 'Query builder Gemini request did not complete');
            throw ApiError.serviceUnavailable('AI query builder request failed.');
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            logger.warn({ status: response.status, body }, 'Query builder Gemini request failed');
            throw ApiError.serviceUnavailable('AI query builder request failed.');
        }

        const aiPayload = await response.json();
        const outputText = extractGeminiOutputText(aiPayload);
        let parsed: any;
        try {
            parsed = JSON.parse(outputText);
        } catch (err) {
            logger.warn({ err, outputText }, 'Query builder Gemini returned invalid JSON');
            throw ApiError.serviceUnavailable('AI query builder returned an invalid response.');
        }

        const groups = enrichQueryBuilderGroups(
            sanitizeQueryBuilderGroups(parsed?.groups, filters, prompt),
            filters,
            prompt
        );
        const explanation = describeQueryBuilderGroups(groups) || normalizeString(parsed?.explanation) || 'Built a query from your description.';

        res.json({
            groups,
            explanation,
        });
    })
);
/**
 * Get available custom events and metadata keys/values for a project
 * GET /api/projects/:id/available-filters
 */
router.get(
    '/:id/available-filters',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        res.json(await loadAvailableProjectFilters(req.params.id));
    })
);

export default router;
