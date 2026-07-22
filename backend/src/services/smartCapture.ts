import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, projects, recordingArtifacts, sessions } from '../db/client.js';
import { deleteObjectsFromProjectStorage } from '../db/s3.js';
import { logger } from '../logger.js';
import { normalizeHeatmapScreenName } from '../utils/heatmapScreens.js';
import { getFrustrationTapKind } from '../utils/mobileFrustration.js';
import { removeArtifactJobIfQueued } from './artifactBullQueue.js';
import { getTeamSubscription } from './stripeProducts.js';

export type SmartCaptureMode = 'record_all' | 'smart_capture' | 'analytics_only';
export type SmartCapturePreset = 'none' | 'high_friction' | 'onboarding_risk' | 'churn_risk' | 'checkout_risk' | 'minimum_signal';
export type SmartCaptureStatus = 'not_applicable' | 'pending' | 'kept' | 'discarded';
export type ReplayRetentionState = 'saved' | 'buffered' | 'analytics_only' | 'not_available';

export type SmartCaptureRule = {
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
};

export type SmartCaptureProjectConfig = {
    id: string;
    teamId: string;
    smartCaptureEnabled: boolean;
    smartCaptureMode: SmartCaptureMode | string;
    smartCapturePreset: SmartCapturePreset | string;
    smartCaptureRules: Array<Record<string, unknown>> | null;
    smartCaptureDecisionWindowHours: number | null;
};

export type NormalizedCaptureConfig = {
    configuredEnabled: boolean;
    decisionWindowHours: number;
    entitled: boolean;
    mode: SmartCaptureMode;
    preset: SmartCapturePreset;
    rules: SmartCaptureRule[];
};

type SmartCaptureSession = {
    id: string;
    projectId: string;
    deviceId?: string | null;
    userDisplayId?: string | null;
    anonymousHash?: string | null;
    platform?: string | null;
    appVersion?: string | null;
    deviceModel?: string | null;
    osVersion?: string | null;
    sdkVersion?: string | null;
    webReferral?: string | null;
    geoCountry?: string | null;
    geoCountryCode?: string | null;
    geoRegion?: string | null;
    geoCity?: string | null;
    startedAt: Date;
    durationSeconds?: number | null;
    events?: unknown;
    metadata?: unknown;
    smartCaptureStatus?: string | null;
    replayQuotaCountedAt?: Date | null;
};

type SmartCaptureMetrics = {
    totalEvents?: number | null;
    errorCount?: number | null;
    apiSuccessCount?: number | null;
    apiErrorCount?: number | null;
    apiTotalCount?: number | null;
    touchCount?: number | null;
    scrollCount?: number | null;
    gestureCount?: number | null;
    inputCount?: number | null;
    rageTapCount?: number | null;
    deadTapCount?: number | null;
    crashCount?: number | null;
    anrCount?: number | null;
    apiAvgResponseMs?: number | null;
    appStartupTimeMs?: number | null;
    screensVisited?: string[] | null;
    customEventCount?: number | null;
    interactionScore?: number | null;
    explorationScore?: number | null;
    uxScore?: number | null;
    networkType?: string | null;
};

export type SmartCaptureDecision = {
    status: SmartCaptureStatus;
    reason: string | null;
    ruleId: string | null;
    decidedAt: Date | null;
    shouldExposeReplay: boolean;
    shouldDiscardVisualArtifacts: boolean;
};

const DEFAULT_DECISION_WINDOW_HOURS = 168;
const MAX_DECISION_WINDOW_HOURS = 168;
const DEFAULT_CHURN_DECISION_WINDOW_HOURS = 48;
const DEFAULT_SMART_CAPTURE_BUFFER_MAX_REPLAYS = 200_000;
const DELAYED_SIGNALS = new Set(['churn_risk', 'failed_return', 'onboarding_failed_return']);
const NUMERIC_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);
const TEXT_OPERATORS = new Set(['contains', 'eq', 'neq', 'starts_with', 'ends_with', 'matches_regex', 'exists', 'not_exists']);
const SMART_CAPTURE_COLORS = new Set(['slate', 'cyan', 'emerald', 'amber', 'rose', 'violet', 'blue', 'pink']);

export async function isSmartCaptureEntitled(teamId: string): Promise<boolean> {
    try {
        const subscription = await getTeamSubscription(teamId);
        return Boolean(subscription.smartCaptureEnabled);
    } catch (err) {
        logger.warn({ err, teamId }, 'Failed to resolve Smart Capture entitlement');
        return false;
    }
}

export function normalizeSmartCaptureMode(value: unknown): SmartCaptureMode {
    return value === 'smart_capture' || value === 'analytics_only' ? value : 'record_all';
}

export function normalizeSmartCapturePreset(value: unknown): SmartCapturePreset {
    if (
        value === 'high_friction'
        || value === 'onboarding_risk'
        || value === 'churn_risk'
        || value === 'checkout_risk'
        || value === 'minimum_signal'
    ) {
        return value;
    }
    return 'none';
}

export function normalizeDecisionWindowHours(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return DEFAULT_DECISION_WINDOW_HOURS;
    return Math.min(MAX_DECISION_WINDOW_HOURS, Math.max(1, Math.floor(n)));
}

export function normalizeCaptureConfig(
    project: SmartCaptureProjectConfig,
    entitled: boolean,
): NormalizedCaptureConfig {
    const configuredEnabled = Boolean(project.smartCaptureEnabled);
    const active = configuredEnabled && entitled;
    return {
        configuredEnabled,
        decisionWindowHours: normalizeDecisionWindowHours(project.smartCaptureDecisionWindowHours),
        entitled,
        mode: active ? normalizeSmartCaptureMode(project.smartCaptureMode) : 'record_all',
        preset: normalizeSmartCapturePreset(project.smartCapturePreset),
        rules: getSmartCaptureRulesForProject(project),
    };
}

export function normalizeCaptureRate(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(100, Math.max(0, Number(n.toFixed(2))));
}

export function normalizeSmartCaptureColor(value: unknown): string {
    if (typeof value !== 'string') return 'cyan';
    const normalized = value.trim().toLowerCase();
    return SMART_CAPTURE_COLORS.has(normalized) ? normalized : 'cyan';
}

export function getSmartCaptureBufferMaxReplays(): number {
    const raw = Number(process.env.RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS);
    if (!Number.isFinite(raw)) return DEFAULT_SMART_CAPTURE_BUFFER_MAX_REPLAYS;
    return Math.max(0, Math.floor(raw));
}

export async function isSmartCaptureBufferAtLimit(teamId: string, excludeSessionId?: string): Promise<boolean> {
    const limit = getSmartCaptureBufferMaxReplays();
    if (limit <= 0) return true;

    const conditions = [
        eq(projects.teamId, teamId),
        isNull(projects.deletedAt),
        eq(sessions.replayRetentionState, 'buffered'),
        eq(sessions.replayAvailable, true),
        eq(sessions.recordingDeleted, false),
        eq(sessions.isReplayExpired, false),
    ];
    if (excludeSessionId) {
        conditions.push(ne(sessions.id, excludeSessionId));
    }

    const [row] = await db
        .select({ bufferedReplayCount: sql<number>`count(*)::int` })
        .from(sessions)
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(and(...conditions));

    return Number(row?.bufferedReplayCount ?? 0) >= limit;
}

export function normalizeSmartCaptureRule(raw: Record<string, unknown>, index = 0): SmartCaptureRule {
    const type = typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : 'signal';
    const rawCondition = typeof raw.condition === 'object' && raw.condition !== null ? raw.condition as Record<string, unknown> : undefined;
    const rawSignal = typeof raw.signal === 'string'
        ? raw.signal
        : typeof rawCondition?.signal === 'string'
            ? rawCondition.signal
            : typeof rawCondition?.metric === 'string'
                ? rawCondition.metric
                : typeof rawCondition?.attribute === 'string'
                    ? rawCondition.attribute
                    : type;
    const signal = typeof raw.signal === 'string'
        ? raw.signal.trim()
        : typeof rawCondition?.signal === 'string'
            ? rawCondition.signal.trim()
            : rawSignal.trim();
    const label = typeof raw.label === 'string' && raw.label.trim()
        ? raw.label.trim().slice(0, 120)
        : smartCaptureSignalLabel(signal || type);
    const name = typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 80)
        : label;
    const captureRate = normalizeCaptureRate(raw.captureRate ?? rawCondition?.captureRate);

    return {
        ...raw,
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 120) : `rule_${index + 1}`,
        type,
        name,
        label,
        color: normalizeSmartCaptureColor(raw.color ?? rawCondition?.color),
        enabled: raw.enabled !== false,
        immediate: DELAYED_SIGNALS.has(signal)
            ? false
            : typeof raw.immediate === 'boolean'
                ? raw.immediate
                : true,
        signal,
        condition: rawCondition,
        operator: typeof raw.operator === 'string' ? raw.operator : undefined,
        value: typeof raw.value === 'string' || typeof raw.value === 'number' || typeof raw.value === 'boolean' ? raw.value : undefined,
        windowHours: raw.windowHours === undefined ? undefined : normalizeDecisionWindowHours(raw.windowHours),
        captureRate,
    };
}

function smartCaptureRuleDisplayName(rule: SmartCaptureRule): string {
    return (typeof rule.name === 'string' && rule.name.trim() ? rule.name : rule.label).slice(0, 120);
}

export function normalizeSmartCaptureRules(rawRules: unknown): SmartCaptureRule[] {
    if (!Array.isArray(rawRules)) return [];
    return rawRules
        .slice(0, 20)
        .filter((rule): rule is Record<string, unknown> => Boolean(rule && typeof rule === 'object'))
        .map((rule, index) => normalizeSmartCaptureRule(rule, index));
}

export function getSmartCapturePresetRules(preset: SmartCapturePreset): SmartCaptureRule[] {
    switch (preset) {
        case 'high_friction':
            return [
                normalizeSmartCaptureRule({ id: 'preset_high_friction', type: 'issue', signal: 'high_friction', label: 'Rage taps, dead taps, crashes, errors, or slow APIs' }),
            ];
        case 'onboarding_risk':
            return [
                normalizeSmartCaptureRule({ id: 'preset_onboarding_friction', type: 'lifecycle', signal: 'onboarding_risk', label: 'Onboarding friction or drop-off' }),
                normalizeSmartCaptureRule({ id: 'preset_onboarding_failed_return', type: 'lifecycle', signal: 'onboarding_failed_return', label: 'Failed to return after onboarding', immediate: false, windowHours: 72 }),
            ];
        case 'churn_risk':
            return [
                normalizeSmartCaptureRule({ id: 'preset_churn_failed_return', type: 'lifecycle', signal: 'churn_risk', label: 'Pre Churn if no return after decision window', immediate: false, windowHours: DEFAULT_CHURN_DECISION_WINDOW_HOURS }),
            ];
        case 'checkout_risk':
            return [
                normalizeSmartCaptureRule({ id: 'preset_checkout_risk', type: 'conversion', signal: 'checkout_risk', label: 'Checkout, cart, or payment friction' }),
            ];
        case 'minimum_signal':
            return [
                normalizeSmartCaptureRule({ id: 'preset_minimum_duration', type: 'duration', signal: 'minimum_signal', label: 'At least 45 seconds or one strong signal', operator: 'gte', value: 45 }),
            ];
        case 'none':
        default:
            return [];
    }
}

export function getSmartCaptureRulesForProject(project: SmartCaptureProjectConfig): SmartCaptureRule[] {
    const explicitRules = normalizeSmartCaptureRules(project.smartCaptureRules);
    if (explicitRules.length > 0) return explicitRules;
    return getSmartCapturePresetRules(normalizeSmartCapturePreset(project.smartCapturePreset));
}

function smartCaptureSignalLabel(signal: string): string {
    const labels: Record<string, string> = {
        high_friction: 'High friction',
        onboarding_risk: 'Onboarding risk',
        onboarding_failed_return: 'Failed to return after onboarding',
        churn_risk: 'Pre Churn',
        failed_return: 'Failed to return',
        checkout_risk: 'Checkout risk',
        cart_abandonment: 'Cart abandonment',
        custom_event: 'Custom event',
        user_metadata: 'User metadata',
        bouncer: 'Bouncer',
        new_user: 'New users',
        early_user: 'New users',
        loyal_user: 'Loyal user',
        engagement_score: 'Engagement score',
        minimum_signal: 'Minimum signal',
        rage: 'Rage taps',
        rage_clicks: 'Rage taps',
        dead_taps: 'Dead taps',
        dead_clicks: 'Dead taps',
        errors: 'Errors',
        js_error: 'JavaScript errors',
        api_error: 'API failures',
        api_error_rate: 'API error rate',
        crashes: 'Crashes',
        anrs: 'ANRs',
        slow_api: 'Slow API calls',
        slow_start: 'Slow starts',
        url_path: 'Route or URL path',
        screen_name: 'Screen name',
        platform: 'Platform',
        device_type: 'Device type',
        browser: 'Browser',
        country: 'Country',
        plan_tier: 'Plan tier',
        utm_source: 'UTM source',
        utm_campaign: 'UTM campaign',
    };
    return labels[signal] ?? signal.replace(/[_-]+/g, ' ');
}

function numeric(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

function primitiveToString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function conditionValue(rule: SmartCaptureRule, key: string): unknown {
    return rule.condition && Object.prototype.hasOwnProperty.call(rule.condition, key)
        ? rule.condition[key]
        : undefined;
}

function ruleValue(rule: SmartCaptureRule): unknown {
    return rule.value ?? conditionValue(rule, 'value');
}

function ruleOperator(rule: SmartCaptureRule, fallback: string): string {
    const raw = rule.operator ?? primitiveToString(conditionValue(rule, 'operator')) ?? fallback;
    return raw.trim().toLowerCase();
}

function ruleThreshold(rule: SmartCaptureRule, fallback: number): number {
    const explicit = ruleValue(rule);
    const n = typeof explicit === 'number' ? explicit : Number(explicit);
    return Number.isFinite(n) ? n : fallback;
}

function conditionClauses(rule: SmartCaptureRule, key: 'all' | 'any'): Record<string, unknown>[] {
    const rawClauses = conditionValue(rule, key);
    if (!Array.isArray(rawClauses)) return [];
    return rawClauses.filter(isRecord);
}

function ruleFromConditionClause(parentRule: SmartCaptureRule, clause: Record<string, unknown>, index: number): SmartCaptureRule {
    const condition = isRecord(clause.condition)
        ? { ...clause.condition, ...(isRecord(clause.scope) ? { scope: clause.scope } : {}) }
        : clause;
    const metric = primitiveToString(condition.metric);
    const attribute = primitiveToString(condition.attribute);
    const signal = primitiveToString(clause.signal ?? condition.signal) ?? metric ?? attribute ?? parentRule.signal ?? parentRule.type;
    const type = primitiveToString(clause.type ?? condition.type) ?? (metric ? 'metric' : attribute ? 'attribute' : parentRule.type);
    const operator = primitiveToString(clause.operator ?? condition.operator);
    const value = clause.value ?? condition.value;
    const windowHours = typeof clause.windowHours === 'number' ? clause.windowHours : parentRule.windowHours;

    return {
        id: `${parentRule.id}:clause:${index}`,
        type,
        name: parentRule.name,
        label: parentRule.label,
        color: parentRule.color,
        enabled: true,
        immediate: true,
        signal,
        condition,
        operator: operator ?? undefined,
        value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined,
        windowHours,
    };
}

function compareNumber(actual: number, operator: string | undefined, expected: number): boolean {
    const op = operator && NUMERIC_OPERATORS.has(operator) ? operator : 'gte';
    switch (op) {
        case 'gt': return actual > expected;
        case 'gte': return actual >= expected;
        case 'lt': return actual < expected;
        case 'lte': return actual <= expected;
        case 'eq': return actual === expected;
        case 'neq': return actual !== expected;
        default: return actual >= expected;
    }
}

function compareText(actual: string, operator: string | undefined, expected: string): boolean {
    const op = operator && TEXT_OPERATORS.has(operator) ? operator : 'contains';
    const haystack = actual.toLowerCase();
    const needle = expected.toLowerCase();
    switch (op) {
        case 'eq': return haystack === needle;
        case 'neq': return haystack !== needle;
        case 'starts_with': return haystack.startsWith(needle);
        case 'ends_with': return haystack.endsWith(needle);
        case 'matches_regex':
            try {
                return new RegExp(expected, 'i').test(actual);
            } catch {
                return false;
            }
        case 'contains':
        default:
            return haystack.includes(needle);
    }
}

function textIncludesAny(text: string, words: string[]): boolean {
    return words.some((word) => text.includes(word));
}

function canonicalSignal(signal: string | undefined): string {
    const normalized = (signal ?? '').trim().toLowerCase();
    const aliases: Record<string, string> = {
        rage_clicks: 'rage',
        rage_taps: 'rage',
        dead_clicks: 'dead_taps',
        dead_taps: 'dead_taps',
        js_error: 'errors',
        javascript_error: 'errors',
        api_failures: 'api_error',
        api_errors: 'api_error',
        api_error_count: 'api_error',
        api_error_rate: 'api_error_rate',
        crash: 'crashes',
        anr: 'anrs',
        bounce: 'bouncer',
        bouncer: 'bouncer',
        new_users: 'new_user',
        new_user: 'new_user',
        early_user: 'new_user',
        first_time_user: 'new_user',
        loyal: 'loyal_user',
        loyalist: 'loyal_user',
        loyalty: 'loyal_user',
        engagement: 'interaction_score',
        engagement_score: 'interaction_score',
        custom_event: 'custom_event',
        event_name: 'event_name',
        user_metadata: 'user_metadata',
        route: 'url_path',
        path: 'url_path',
        screen: 'screen_name',
        screens: 'screen_name',
        country_code: 'country',
    };
    return aliases[normalized] ?? normalized;
}

function metricValue(name: string, session: SmartCaptureSession, metrics?: SmartCaptureMetrics | null): number {
    switch (canonicalSignal(name)) {
        case 'duration':
        case 'duration_seconds':
            return numeric(session.durationSeconds);
        case 'screen_count':
        case 'screens_visited':
            return Array.isArray(metrics?.screensVisited) ? metrics.screensVisited.length : 0;
        case 'total_events':
            return numeric(metrics?.totalEvents);
        case 'errors':
        case 'error_count':
            return numeric(metrics?.errorCount);
        case 'api_error':
            return numeric(metrics?.apiErrorCount);
        case 'api_success_count':
            return numeric(metrics?.apiSuccessCount);
        case 'api_total_count':
            return numeric(metrics?.apiTotalCount);
        case 'api_error_rate': {
            const total = numeric(metrics?.apiTotalCount);
            return total > 0 ? (numeric(metrics?.apiErrorCount) / total) * 100 : 0;
        }
        case 'api_success_rate': {
            const total = numeric(metrics?.apiTotalCount);
            return total > 0 ? (numeric(metrics?.apiSuccessCount) / total) * 100 : 0;
        }
        case 'slow_api':
        case 'api_avg_response_ms':
            return numeric(metrics?.apiAvgResponseMs);
        case 'rage':
        case 'rage_tap_count':
            return numeric(metrics?.rageTapCount);
        case 'dead_taps':
        case 'dead_tap_count':
            return numeric(metrics?.deadTapCount);
        case 'crashes':
        case 'crash_count':
            return numeric(metrics?.crashCount);
        case 'anrs':
        case 'anr_count':
            return numeric(metrics?.anrCount);
        case 'slow_start':
        case 'app_startup_time_ms':
            return numeric(metrics?.appStartupTimeMs);
        case 'custom_event_count':
            return numeric(metrics?.customEventCount);
        case 'touch_count':
            return numeric(metrics?.touchCount);
        case 'scroll_count':
            return numeric(metrics?.scrollCount);
        case 'gesture_count':
            return numeric(metrics?.gestureCount);
        case 'input_count':
            return numeric(metrics?.inputCount);
        case 'interaction_score':
            return numeric(metrics?.interactionScore);
        case 'exploration_score':
            return numeric(metrics?.explorationScore);
        case 'ux_score':
            return numeric(metrics?.uxScore);
        default:
            return 0;
    }
}

function sessionEventRecords(events: unknown): Record<string, unknown>[] {
    if (Array.isArray(events)) return events.filter(isRecord);
    if (!isRecord(events)) return [];

    const nestedEvents = events.events ?? events.items ?? events.records;
    return Array.isArray(nestedEvents) ? nestedEvents.filter(isRecord) : [];
}

function nestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = source[key];
    return isRecord(value) ? value : {};
}

function addEventScopeCandidate(values: string[], candidate: unknown): void {
    const raw = primitiveToString(candidate)?.trim();
    if (!raw) return;
    values.push(raw);
    const normalized = normalizeHeatmapScreenName(raw);
    if (normalized && normalized !== raw) values.push(normalized);
}

function eventScopeValues(attribute: string, event: Record<string, unknown>): string[] {
    const attr = canonicalSignal(attribute);
    const data = nestedRecord(event, 'data');
    const payload = nestedRecord(event, 'payload');
    const properties = nestedRecord(event, 'properties');
    const dataPayload = nestedRecord(data, 'payload');
    const sources = [event, data, payload, properties, dataPayload];
    const values: string[] = [];
    const urlKeys = ['href', 'url', 'location', 'route', 'path', 'pathname', 'screen', 'screenName', 'screen_name', 'routeName'];
    const screenKeys = ['screenName', 'screen_name', 'screen', 'viewId', 'viewLabel', 'name', 'route', 'routeName', 'path', 'url', 'href', 'location'];
    const keys = attr === 'url_path' ? urlKeys : screenKeys;

    for (const source of sources) {
        for (const key of keys) {
            addEventScopeCandidate(values, source[key]);
        }
    }

    return [...new Set(values)];
}

function scopeCondition(rule: SmartCaptureRule): Record<string, unknown> | null {
    const scope = conditionValue(rule, 'scope');
    return isRecord(scope) ? scope : null;
}

function eventMatchesScope(event: Record<string, unknown>, scope: Record<string, unknown>): boolean {
    const attribute = primitiveToString(scope.attribute) ?? 'screen_name';
    const operator = (primitiveToString(scope.operator) ?? 'contains').trim().toLowerCase();
    const values = eventScopeValues(attribute, event);
    if (operator === 'exists') return values.length > 0;
    if (operator === 'not_exists') return values.length === 0;

    const expected = primitiveToString(scope.value);
    if (!expected) return false;
    const normalizedExpected = normalizeHeatmapScreenName(expected) ?? expected;
    return values.some((value) => (
        compareText(value, operator, expected) || compareText(value, operator, normalizedExpected)
    ));
}

function scopedFrustrationKindForMetric(metricName: string): 'rage_tap' | 'dead_tap' | null {
    switch (canonicalSignal(metricName)) {
        case 'rage':
        case 'rage_tap_count':
            return 'rage_tap';
        case 'dead_taps':
        case 'dead_tap_count':
            return 'dead_tap';
        default:
            return null;
    }
}

function fallbackFrustrationText(event: Record<string, unknown>): string {
    const data = nestedRecord(event, 'data');
    const payload = nestedRecord(event, 'payload');
    const properties = nestedRecord(event, 'properties');
    const dataPayload = nestedRecord(data, 'payload');
    return [
        event.type,
        event.name,
        event.eventName,
        event.kind,
        event.gestureType,
        event.frustrationKind,
        data.type,
        data.source,
        payload.type,
        payload.name,
        payload.gestureType,
        payload.frustrationKind,
        properties.type,
        properties.name,
        properties.gestureType,
        properties.frustrationKind,
        dataPayload.type,
        dataPayload.name,
        dataPayload.gestureType,
        dataPayload.frustrationKind,
    ].map((value) => primitiveToString(value)?.toLowerCase()).filter(Boolean).join(' ');
}

function eventMatchesScopedMetric(event: Record<string, unknown>, metricName: string): boolean {
    const expectedKind = scopedFrustrationKindForMetric(metricName);
    if (!expectedKind) return false;

    const frustrationKind = getFrustrationTapKind(event);
    if (frustrationKind) return frustrationKind === expectedKind;

    const text = fallbackFrustrationText(event);
    return expectedKind === 'rage_tap'
        ? text.includes('rage')
        : text.includes('dead_tap') || text.includes('dead tap') || text.includes('dead_click') || text.includes('dead click');
}

function scopedMetricEventCount(rule: SmartCaptureRule, metricName: string, session: SmartCaptureSession): number | null {
    const scope = scopeCondition(rule);
    if (!scope) return null;
    if (!scopedFrustrationKindForMetric(metricName)) return 0;

    let frustrationEventCount = 0;
    let scopedEventCount = 0;
    for (const event of sessionEventRecords(session.events)) {
        if (!eventMatchesScopedMetric(event, metricName)) continue;
        frustrationEventCount += 1;
        if (eventMatchesScope(event, scope)) {
            scopedEventCount += 1;
        }
    }

    return frustrationEventCount > 0 ? scopedEventCount : null;
}

function scopeMatchesSessionAggregate(
    rule: SmartCaptureRule,
    scope: Record<string, unknown>,
    session: SmartCaptureSession,
    metrics: SmartCaptureMetrics | null | undefined,
): boolean {
    const attribute = primitiveToString(scope.attribute) ?? 'screen_name';
    return attributeMatches(
        {
            ...rule,
            condition: scope,
            operator: primitiveToString(scope.operator) ?? rule.operator,
            value: scope.value as SmartCaptureRule['value'],
        },
        attribute,
        session,
        metrics,
        buildSessionText(session, metrics),
    );
}

function metricMatches(
    rule: SmartCaptureRule,
    metricName: string,
    session: SmartCaptureSession,
    metrics: SmartCaptureMetrics | null | undefined,
    fallbackThreshold: number,
): boolean {
    const scope = scopeCondition(rule);
    const scopedCount = scopedMetricEventCount(rule, metricName, session);
    if (scopedCount !== null) {
        return compareNumber(
            scopedCount,
            ruleOperator(rule, 'gte'),
            ruleThreshold(rule, fallbackThreshold),
        );
    }

    const aggregateMatches = compareNumber(
        metricValue(metricName, session, metrics),
        ruleOperator(rule, 'gte'),
        ruleThreshold(rule, fallbackThreshold),
    );
    if (!aggregateMatches) return false;

    if (scope && scopedFrustrationKindForMetric(metricName)) {
        return scopeMatchesSessionAggregate(rule, scope, session, metrics);
    }

    return true;
}

function metadataValues(metadata: unknown, keys: string[]): string[] {
    if (!metadata || typeof metadata !== 'object') return [];
    const record = metadata as Record<string, unknown>;
    const values: string[] = [];
    for (const key of keys) {
        const direct = primitiveToString(record[key]);
        if (direct) values.push(direct);
    }
    return values;
}

function attributeValues(attribute: string, session: SmartCaptureSession, metrics?: SmartCaptureMetrics | null): string[] {
    const metadata = session.metadata;
    const screens = Array.isArray(metrics?.screensVisited) ? metrics.screensVisited : [];
    const attr = canonicalSignal(attribute);
    const values: Array<string | null | undefined> = [];

    switch (attr) {
        case 'url_path':
            values.push(
                ...metadataValues(metadata, ['webLandingRoute', 'webEntryPath', 'webEntryUrl', 'route', 'path', 'url']),
                ...screens,
            );
            break;
        case 'screen_name':
            values.push(...screens, ...metadataValues(metadata, ['screen', 'screenName', 'screen_name', 'routeName']));
            break;
        case 'platform':
            values.push(session.platform, ...metadataValues(metadata, ['platform']));
            break;
        case 'device_type':
            values.push(...metadataValues(metadata, ['deviceType', 'device_type', 'formFactor']));
            values.push(session.platform && ['ios', 'android', 'react-native', 'flutter'].includes(session.platform) ? 'mobile' : null);
            break;
        case 'browser':
            values.push(...metadataValues(metadata, ['browser', 'browserName', 'webBrowser']));
            break;
        case 'country':
            values.push(session.geoCountry, session.geoCountryCode, ...metadataValues(metadata, ['country', 'countryCode', 'geoCountry', 'geoCountryCode']));
            break;
        case 'plan_tier':
            values.push(...metadataValues(metadata, ['planTier', 'plan_tier', 'plan', 'tier', 'subscriptionPlan', 'subscriptionTier']));
            break;
        case 'utm_source':
            values.push(...metadataValues(metadata, ['utm_source', 'webAttributionSource']));
            break;
        case 'utm_campaign':
            values.push(...metadataValues(metadata, ['utm_campaign', 'webAttributionCampaign']));
            break;
        case 'app_version':
            values.push(session.appVersion, ...metadataValues(metadata, ['appVersion', 'app_version']));
            break;
        case 'sdk_version':
            values.push(session.sdkVersion, ...metadataValues(metadata, ['sdkVersion', 'sdk_version']));
            break;
        case 'device_model':
            values.push(session.deviceModel, ...metadataValues(metadata, ['deviceModel', 'model']));
            break;
        case 'os_version':
            values.push(session.osVersion, ...metadataValues(metadata, ['osVersion', 'systemVersion']));
            break;
        case 'network_type':
            values.push(metrics?.networkType, ...metadataValues(metadata, ['networkType', 'effectiveConnectionType']));
            break;
        case 'referral':
            values.push(session.webReferral, ...metadataValues(metadata, ['webReferral', 'webReferrerDomain', 'webAttributionSource']));
            break;
        default:
            values.push(...metadataValues(metadata, [attribute]));
            break;
    }

    return values.filter((value): value is string => Boolean(value));
}

function attributeMatches(
    rule: SmartCaptureRule,
    attribute: string,
    session: SmartCaptureSession,
    metrics: SmartCaptureMetrics | null | undefined,
    text: string,
): boolean {
    const values = attributeValues(attribute, session, metrics);
    const operator = ruleOperator(rule, 'contains');
    if (operator === 'exists') return values.length > 0;
    if (operator === 'not_exists') return values.length === 0;

    const expected = primitiveToString(ruleValue(rule));
    if (!expected) return false;
    if (values.some((value) => compareText(value, operator, expected))) return true;

    if (['url_path', 'screen_name', 'event_name', 'custom_event'].includes(canonicalSignal(attribute))) {
        return compareText(text, operator, expected);
    }
    return false;
}

function genericConditionMatches(
    rule: SmartCaptureRule,
    session: SmartCaptureSession,
    metrics: SmartCaptureMetrics | null | undefined,
    text: string,
): boolean {
    const metric = primitiveToString(conditionValue(rule, 'metric'));
    if (metric) {
        return metricMatches(rule, metric, session, metrics, ruleThreshold(rule, 1));
    }

    const attribute = primitiveToString(conditionValue(rule, 'attribute'));
    if (attribute) {
        return attributeMatches(rule, attribute, session, metrics, text);
    }

    return false;
}

function buildSessionText(session: SmartCaptureSession, metrics?: SmartCaptureMetrics | null): string {
    return [
        session.platform,
        session.webReferral,
        JSON.stringify(session.events ?? []),
        JSON.stringify(session.metadata ?? {}),
        ...(metrics?.screensVisited ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
}

function hasHighFrictionSignal(metrics: SmartCaptureMetrics | null | undefined, text: string): boolean {
    return numeric(metrics?.rageTapCount) > 0
        || numeric(metrics?.deadTapCount) > 0
        || numeric(metrics?.errorCount) > 0
        || numeric(metrics?.apiErrorCount) > 0
        || numeric(metrics?.crashCount) > 0
        || numeric(metrics?.anrCount) > 0
        || numeric(metrics?.apiAvgResponseMs) >= 2500
        || textIncludesAny(text, ['rage', 'dead tap', 'dead_tap', 'crash', 'anr', 'error', 'exception', 'failed request', 'slow api', 'timeout']);
}

function visitorIdentityForSession(session: SmartCaptureSession): string | null {
    return session.deviceId ?? session.anonymousHash ?? session.userDisplayId ?? null;
}

async function hasReturnedAfterSession(session: SmartCaptureSession): Promise<boolean> {
    const visitorIdentity = visitorIdentityForSession(session);
    if (!visitorIdentity) return false;

    const [laterSession] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
            eq(sessions.projectId, session.projectId),
            gt(sessions.startedAt, session.startedAt),
            sql`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId}) = ${visitorIdentity}`,
        ))
        .limit(1);

    return Boolean(laterSession);
}

async function hasMinimumVisitCount(session: SmartCaptureSession, rule: SmartCaptureRule, fallbackMinVisits = 1): Promise<boolean> {
    const minVisits = Math.max(
        1,
        Math.floor(numeric(conditionValue(rule, 'minVisits') ?? conditionValue(rule, 'visitCount') ?? conditionValue(rule, 'minVisitCount') ?? fallbackMinVisits)),
    );
    if (minVisits <= 1) return true;

    const visitorIdentity = visitorIdentityForSession(session);
    if (!visitorIdentity) return false;

    const [row] = await db
        .select({ visitCount: sql<number>`count(*)::int` })
        .from(sessions)
        .where(and(
            eq(sessions.projectId, session.projectId),
            sql`${sessions.startedAt} <= ${session.startedAt}`,
            sql`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId}) = ${visitorIdentity}`,
        ));

    return Number(row?.visitCount ?? 0) >= minVisits;
}

async function isWithinMaximumVisitCount(session: SmartCaptureSession, rule: SmartCaptureRule, fallbackMaxVisits = 3): Promise<boolean> {
    const maxVisits = Math.max(
        1,
        Math.floor(numeric(conditionValue(rule, 'maxVisits') ?? conditionValue(rule, 'sessionWindowSize') ?? conditionValue(rule, 'maxVisitCount') ?? fallbackMaxVisits)),
    );
    const visitorIdentity = visitorIdentityForSession(session);
    if (!visitorIdentity) return false;

    const [row] = await db
        .select({ visitCount: sql<number>`count(*)::int` })
        .from(sessions)
        .where(and(
            eq(sessions.projectId, session.projectId),
            sql`${sessions.startedAt} <= ${session.startedAt}`,
            sql`coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId}) = ${visitorIdentity}`,
        ));

    return Number(row?.visitCount ?? 0) <= maxVisits;
}

function isDecisionWindowElapsed(session: SmartCaptureSession, rule: SmartCaptureRule, project: SmartCaptureProjectConfig, now: Date): boolean {
    const ruleWindowHours = rule.windowHours ?? normalizeDecisionWindowHours(project.smartCaptureDecisionWindowHours);
    const elapsedMs = now.getTime() - session.startedAt.getTime();
    return elapsedMs >= ruleWindowHours * 60 * 60 * 1000;
}

function deterministicBucket(input: string): number {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 10_000;
}

function passesCaptureRate(rule: SmartCaptureRule, session: SmartCaptureSession): boolean {
    const rate = normalizeCaptureRate(rule.captureRate);
    if (rate === undefined || rate >= 100) return true;
    if (rate <= 0) return false;
    return deterministicBucket(`${rule.id}:${session.id}`) < Math.round(rate * 100);
}

async function compoundConditionMatches(
    rule: SmartCaptureRule,
    session: SmartCaptureSession,
    metrics: SmartCaptureMetrics | null | undefined,
    project: SmartCaptureProjectConfig,
    now: Date,
): Promise<boolean | null> {
    const allClauses = conditionClauses(rule, 'all');
    if (allClauses.length > 0) {
        for (const [index, clause] of allClauses.entries()) {
            if (!await ruleMatches(ruleFromConditionClause(rule, clause, index), session, metrics, project, now)) {
                return false;
            }
        }
        return true;
    }

    const anyClauses = conditionClauses(rule, 'any');
    if (anyClauses.length > 0) {
        for (const [index, clause] of anyClauses.entries()) {
            if (await ruleMatches(ruleFromConditionClause(rule, clause, index), session, metrics, project, now)) {
                return true;
            }
        }
        return false;
    }

    return null;
}

async function ruleMatches(
    rule: SmartCaptureRule,
    session: SmartCaptureSession,
    metrics: SmartCaptureMetrics | null | undefined,
    project: SmartCaptureProjectConfig,
    now: Date,
): Promise<boolean> {
    const compoundResult = await compoundConditionMatches(rule, session, metrics, project, now);
    if (compoundResult !== null) return compoundResult;

    const signal = canonicalSignal(rule.signal ?? rule.type);
    const text = buildSessionText(session, metrics);
    const scoped = Boolean(scopeCondition(rule));

    switch (signal) {
        case 'rage':
            return metricMatches(rule, 'rage', session, metrics, 1) || (!scoped && textIncludesAny(text, ['rage tap', 'rage_tap', 'rage']));
        case 'dead_taps':
            return metricMatches(rule, 'dead_taps', session, metrics, 1) || (!scoped && textIncludesAny(text, ['dead tap', 'dead_tap']));
        case 'errors':
            return metricMatches(rule, 'error_count', session, metrics, 1) || textIncludesAny(text, ['error', 'exception']);
        case 'api_error':
            return metricMatches(rule, 'api_error', session, metrics, 1) || textIncludesAny(text, ['failed request', 'api failure']);
        case 'api_error_rate':
            return metricMatches(rule, 'api_error_rate', session, metrics, 5);
        case 'crashes':
            return metricMatches(rule, 'crashes', session, metrics, 1) || textIncludesAny(text, ['crash', 'crashed']);
        case 'anrs':
            return metricMatches(rule, 'anrs', session, metrics, 1) || textIncludesAny(text, ['anr', 'frozen', 'freeze', 'hang']);
        case 'slow_api':
            return metricMatches(rule, 'slow_api', session, metrics, 2500) || textIncludesAny(text, ['slow api', 'slow request', 'timeout']);
        case 'slow_start':
            return metricMatches(rule, 'slow_start', session, metrics, 3000) || textIncludesAny(text, ['slow start', 'slow startup', 'slow launch']);
        case 'interaction_score':
            return metricMatches(rule, 'interaction_score', session, metrics, 70);
        case 'high_friction':
            return hasHighFrictionSignal(metrics, text);
        case 'checkout_risk':
            return textIncludesAny(text, ['checkout', 'cart', 'payment', 'purchase', 'order'])
                && (hasHighFrictionSignal(metrics, text) || textIncludesAny(text, ['abandon', 'drop', 'bounce', 'declined', 'failed', 'failure']));
        case 'cart_abandonment':
            return textIncludesAny(text, ['cart', 'basket', 'checkout'])
                && (hasHighFrictionSignal(metrics, text) || textIncludesAny(text, ['abandon', 'drop', 'bounce', 'left cart', 'cart_exit']));
        case 'onboarding_risk':
            return textIncludesAny(text, ['onboarding', 'signup', 'sign up', 'activation', 'tutorial'])
                && (hasHighFrictionSignal(metrics, text) || textIncludesAny(text, ['abandon', 'drop', 'bounce', 'failed', 'churn']));
        case 'bouncer':
            return numeric(session.durationSeconds) < ruleThreshold(rule, 10);
        case 'new_user':
            return isWithinMaximumVisitCount(session, rule, 3);
        case 'loyal_user':
            return hasMinimumVisitCount(session, rule, 5);
        case 'minimum_signal': {
            const duration = numeric(session.durationSeconds);
            const threshold = numeric(rule.value) || 45;
            return duration >= threshold || hasHighFrictionSignal(metrics, text);
        }
        case 'failed_return':
        case 'churn_risk':
            return isDecisionWindowElapsed(session, rule, project, now)
                && await hasMinimumVisitCount(session, rule)
                && !(await hasReturnedAfterSession(session));
        case 'onboarding_failed_return':
            return isDecisionWindowElapsed(session, rule, project, now)
                && textIncludesAny(text, ['onboarding', 'signup', 'sign up', 'activation', 'tutorial'])
                && await hasMinimumVisitCount(session, rule)
                && !(await hasReturnedAfterSession(session));
        case 'duration':
            return metricMatches(rule, 'duration', session, metrics, 45);
        case 'screen_count':
            return metricMatches(rule, 'screen_count', session, metrics, 2);
        case 'url_path':
        case 'screen_name':
        case 'platform':
        case 'device_type':
        case 'browser':
        case 'country':
        case 'plan_tier':
        case 'utm_source':
        case 'utm_campaign':
        case 'referral':
        case 'app_version':
        case 'sdk_version':
        case 'device_model':
        case 'os_version':
        case 'network_type':
            return attributeMatches(rule, signal, session, metrics, text);
        default:
            break;
    }

    if (genericConditionMatches(rule, session, metrics, text)) {
        return true;
    }

    if (rule.type === 'duration') {
        const duration = numeric(session.durationSeconds);
        const threshold = numeric(rule.value);
        return rule.operator === 'lte' ? duration <= threshold : duration >= threshold;
    }

    if (rule.type === 'event' && typeof rule.value === 'string') {
        return text.includes(rule.value.toLowerCase());
    }

    if (rule.type === 'screen' && typeof rule.value === 'string') {
        return text.includes(rule.value.toLowerCase());
    }

    return false;
}

export async function resolveSmartCaptureDecision(input: {
    project: SmartCaptureProjectConfig;
    session: SmartCaptureSession;
    metrics?: SmartCaptureMetrics | null;
    hasReplayArtifacts: boolean;
    entitled: boolean;
    canDiscardUnmatched?: boolean;
    now?: Date;
}): Promise<SmartCaptureDecision> {
    const now = input.now ?? new Date();
    const captureConfig = normalizeCaptureConfig(input.project, input.entitled);
    const mode = captureConfig.mode;

    if (!input.hasReplayArtifacts) {
        return {
            status: 'not_applicable',
            reason: 'no_visual_artifacts',
            ruleId: null,
            decidedAt: now,
            shouldExposeReplay: false,
            shouldDiscardVisualArtifacts: false,
        };
    }

    if (mode === 'record_all') {
        return {
            status: 'kept',
            reason: 'record_all',
            ruleId: null,
            decidedAt: now,
            shouldExposeReplay: true,
            shouldDiscardVisualArtifacts: false,
        };
    }

    if (mode === 'analytics_only') {
        return {
            status: 'discarded',
            reason: 'analytics_only',
            ruleId: null,
            decidedAt: now,
            shouldExposeReplay: false,
            shouldDiscardVisualArtifacts: true,
        };
    }

    const rules = captureConfig.rules.filter((rule) => rule.enabled !== false);
    if (rules.length === 0) {
        return {
            status: 'kept',
            reason: 'no_rules_configured',
            ruleId: null,
            decidedAt: now,
            shouldExposeReplay: true,
            shouldDiscardVisualArtifacts: false,
        };
    }

    const immediateRules = rules.filter((rule) => rule.immediate !== false);
    for (const rule of immediateRules) {
        if (await ruleMatches(rule, input.session, input.metrics, input.project, now) && passesCaptureRate(rule, input.session)) {
            return {
                status: 'kept',
                reason: smartCaptureRuleDisplayName(rule),
                ruleId: rule.id,
                decidedAt: now,
                shouldExposeReplay: true,
                shouldDiscardVisualArtifacts: false,
            };
        }
    }

    const delayedRules = rules.filter((rule) => rule.immediate === false);
    if (delayedRules.some((rule) => !isDecisionWindowElapsed(input.session, rule, input.project, now))) {
        return {
            status: 'pending',
            reason: 'waiting_for_decision_window',
            ruleId: delayedRules[0]?.id ?? null,
            decidedAt: null,
            shouldExposeReplay: true,
            shouldDiscardVisualArtifacts: false,
        };
    }

    for (const rule of delayedRules) {
        if (await ruleMatches(rule, input.session, input.metrics, input.project, now) && passesCaptureRate(rule, input.session)) {
            return {
                status: 'kept',
                reason: smartCaptureRuleDisplayName(rule),
                ruleId: rule.id,
                decidedAt: now,
                shouldExposeReplay: true,
                shouldDiscardVisualArtifacts: false,
            };
        }
    }

    if (input.canDiscardUnmatched === false) {
        return {
            status: 'pending',
            reason: 'waiting_for_session_evidence',
            ruleId: null,
            decidedAt: null,
            shouldExposeReplay: true,
            shouldDiscardVisualArtifacts: false,
        };
    }

    return {
        status: 'discarded',
        reason: 'no_rules_matched',
        ruleId: null,
        decidedAt: now,
        shouldExposeReplay: false,
        shouldDiscardVisualArtifacts: true,
    };
}

export async function discardSmartCaptureVisualArtifacts(sessionId: string): Promise<void> {
    const rows = await db
        .select({
            id: recordingArtifacts.id,
            kind: recordingArtifacts.kind,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
            projectId: sessions.projectId,
        })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
        .where(and(
            eq(recordingArtifacts.sessionId, sessionId),
            sql`${recordingArtifacts.kind} in ('screenshots', 'hierarchy', 'rrweb')`,
            sql`${recordingArtifacts.status} in ('pending', 'buffered', 'uploaded', 'ready')`,
        ));

    if (rows.length === 0) return;

    try {
        await deleteObjectsFromProjectStorage(
            rows[0].projectId,
            rows.map((row) => row.s3ObjectKey),
            rows.map((row) => row.endpointId),
        );
    } catch (err) {
        logger.warn({ err, sessionId, artifactCount: rows.length }, 'Smart Capture visual artifact storage purge failed; abandoning rows');
    }

    await db
        .update(recordingArtifacts)
        .set({
            status: 'abandoned',
        })
        .where(inArray(recordingArtifacts.id, rows.map((row) => row.id)));

    for (const row of rows) {
        await removeArtifactJobIfQueued(row.id, row.kind);
    }
}
