import { config } from '../config.js';
import { getClickHouseClient, isClickHouseProductRollupsWritesEnabled } from '../db/clickhouse.js';
import { logger } from '../logger.js';
import { normalizeHeatmapScreenName } from '../utils/heatmapScreens.js';

const PRODUCT_ROLLUPS_SCHEMA_VERSION = 1;
const MAX_DIMENSION_VALUE_LENGTH = 512;
const SCREEN_TRANSITION_SEPARATOR = '\u2192';
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;

export type ProductAnalyticsBreakdowns = {
    deviceModelBreakdown?: Record<string, number> | null;
    osVersionBreakdown?: Record<string, number> | null;
    platformBreakdown?: Record<string, number> | null;
    appVersionBreakdown?: Record<string, number> | null;
    screenViewBreakdown?: Record<string, number> | null;
    screenTransitionBreakdown?: Record<string, number> | null;
    entryScreenBreakdown?: Record<string, number> | null;
    exitScreenBreakdown?: Record<string, number> | null;
    geoCountryBreakdown?: Record<string, number> | null;
    customEventBreakdown?: Record<string, number> | null;
};

export type ProductAnalyticsDailyRollupInput = ProductAnalyticsBreakdowns & {
    projectId: string;
    date: string | Date;
    totalSessions?: number | bigint | string | null;
    completedSessions?: number | bigint | string | null;
    avgDurationSeconds?: number | null;
    avgInteractionScore?: number | null;
    avgUxScore?: number | null;
    avgApiErrorRate?: number | null;
    avgApiResponseMs?: number | null;
    p50Duration?: number | null;
    p90Duration?: number | null;
    p50InteractionScore?: number | null;
    p90InteractionScore?: number | null;
    totalErrors?: number | bigint | string | null;
    totalRageTaps?: number | bigint | string | null;
    totalDeadTaps?: number | bigint | string | null;
    totalCrashes?: number | bigint | string | null;
    totalAnrs?: number | bigint | string | null;
    totalBouncers?: number | bigint | string | null;
    totalCasuals?: number | bigint | string | null;
    totalExplorers?: number | bigint | string | null;
    totalLoyalists?: number | bigint | string | null;
    totalTouches?: number | bigint | string | null;
    totalScrolls?: number | bigint | string | null;
    totalGestures?: number | bigint | string | null;
    totalInteractions?: number | bigint | string | null;
    uniqueUserCount?: number | bigint | string | null;
    source?: string;
    updatedAt?: Date;
};

export type ClickHouseAppDailyRollupRow = {
    project_id: string;
    date: string;
    total_sessions: string;
    completed_sessions: string;
    avg_duration_seconds: number | null;
    avg_interaction_score: number | null;
    avg_ux_score: number | null;
    avg_api_error_rate: number | null;
    avg_api_response_ms: number | null;
    p50_duration: number | null;
    p90_duration: number | null;
    p50_interaction_score: number | null;
    p90_interaction_score: number | null;
    total_errors: string;
    total_rage_taps: string;
    total_dead_taps: string;
    total_crashes: string;
    total_anrs: string;
    total_bouncers: string;
    total_casuals: string;
    total_explorers: string;
    total_loyalists: string;
    total_touches: string;
    total_scrolls: string;
    total_gestures: string;
    total_interactions: string;
    unique_user_count: string;
    source: string;
    schema_version: number;
    updated_at: string;
};

export type ClickHouseAppDimensionDailyRollupRow = {
    project_id: string;
    date: string;
    dimension_type: string;
    dimension_value: string;
    count: string;
    source: string;
    schema_version: number;
    updated_at: string;
};

export type ClickHouseScreenHeatmapDailyRollupRow = {
    project_id: string;
    date: string;
    screen_name: string;
    event_kind: 'touch' | 'rage_tap';
    bucket_x: number;
    bucket_y: number;
    bucket_count: string;
    screen_first_seen_ms: string;
    page_width: number;
    page_height: number;
    viewport_width: number;
    viewport_height: number;
    source: string;
    schema_version: number;
    updated_at: string;
};

export type ClickHouseDeviceUsageDailyRollupRow = {
    project_id: string;
    period: string;
    bytes_uploaded: string;
    minutes_recorded: string;
    sessions_started: string;
    request_count: string;
    source: string;
    schema_version: number;
    updated_at: string;
};

function toClickHouseDate(value: string | Date): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isFinite(parsed.getTime())) {
        throw new Error(`Invalid ClickHouse date value: ${value}`);
    }
    return parsed.toISOString().slice(0, 10);
}

function toClickHouseDateTime(value: Date = new Date()): string {
    return value.toISOString().replace('T', ' ').replace('Z', '');
}

function toNullableFloat(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toUInt64String(value: number | bigint | string | null | undefined): string {
    if (typeof value === 'bigint') return value > 0n ? value.toString() : '0';
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0';
    return Math.floor(parsed).toString();
}

function toUInt32Number(value: number | null | undefined): number {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(4294967295, Math.floor(parsed));
}

function sanitizeGenericDimensionValue(value: string): string | null {
    const redacted = value
        .replace(EMAIL_RE, '[email]')
        .replace(UUID_RE, ':id')
        .replace(LONG_HEX_RE, ':id')
        .replace(/\s+/g, ' ')
        .trim();

    if (!redacted) return null;
    return redacted.slice(0, MAX_DIMENSION_VALUE_LENGTH);
}

export function sanitizeProductDimensionValue(dimensionType: string, value: string): string | null {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;

    if (dimensionType === 'screen_transition') {
        const parts = trimmed.split(SCREEN_TRANSITION_SEPARATOR);
        if (parts.length === 2) {
            const from = sanitizeProductDimensionValue('screen', parts[0]);
            const to = sanitizeProductDimensionValue('screen', parts[1]);
            return from && to ? `${from}${SCREEN_TRANSITION_SEPARATOR}${to}` : null;
        }
    }

    if (
        dimensionType === 'screen' ||
        dimensionType === 'screen_view' ||
        dimensionType === 'entry_screen' ||
        dimensionType === 'exit_screen' ||
        trimmed.startsWith('/') ||
        /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ) {
        const normalized = normalizeHeatmapScreenName(trimmed);
        return normalized ? sanitizeGenericDimensionValue(normalized) : null;
    }

    return sanitizeGenericDimensionValue(trimmed);
}

function buildDimensionRows(params: ProductAnalyticsDailyRollupInput, date: string, updatedAt: string): ClickHouseAppDimensionDailyRollupRow[] {
    const breakdowns: Array<[keyof ProductAnalyticsBreakdowns, string]> = [
        ['deviceModelBreakdown', 'device_model'],
        ['osVersionBreakdown', 'os_version'],
        ['platformBreakdown', 'platform'],
        ['appVersionBreakdown', 'app_version'],
        ['screenViewBreakdown', 'screen_view'],
        ['screenTransitionBreakdown', 'screen_transition'],
        ['entryScreenBreakdown', 'entry_screen'],
        ['exitScreenBreakdown', 'exit_screen'],
        ['geoCountryBreakdown', 'geo_country'],
        ['customEventBreakdown', 'custom_event'],
    ];

    const rows: ClickHouseAppDimensionDailyRollupRow[] = [];
    for (const [field, dimensionType] of breakdowns) {
        const breakdown = params[field];
        if (!breakdown) continue;
        for (const [rawValue, rawCount] of Object.entries(breakdown)) {
            const count = Number(rawCount);
            if (!Number.isFinite(count) || count <= 0) continue;
            const dimensionValue = sanitizeProductDimensionValue(dimensionType, rawValue);
            if (!dimensionValue) continue;
            rows.push({
                project_id: params.projectId,
                date,
                dimension_type: dimensionType,
                dimension_value: dimensionValue,
                count: toUInt64String(count),
                source: params.source ?? 'postgres_daily_stats',
                schema_version: PRODUCT_ROLLUPS_SCHEMA_VERSION,
                updated_at: updatedAt,
            });
        }
    }
    return rows;
}

export function buildClickHouseProductAnalyticsDailyRollupRows(params: ProductAnalyticsDailyRollupInput): {
    dailyRow: ClickHouseAppDailyRollupRow;
    dimensionRows: ClickHouseAppDimensionDailyRollupRow[];
} {
    const date = toClickHouseDate(params.date);
    const updatedAt = toClickHouseDateTime(params.updatedAt);
    const dailyRow: ClickHouseAppDailyRollupRow = {
        project_id: params.projectId,
        date,
        total_sessions: toUInt64String(params.totalSessions),
        completed_sessions: toUInt64String(params.completedSessions),
        avg_duration_seconds: toNullableFloat(params.avgDurationSeconds),
        avg_interaction_score: toNullableFloat(params.avgInteractionScore),
        avg_ux_score: toNullableFloat(params.avgUxScore),
        avg_api_error_rate: toNullableFloat(params.avgApiErrorRate),
        avg_api_response_ms: toNullableFloat(params.avgApiResponseMs),
        p50_duration: toNullableFloat(params.p50Duration),
        p90_duration: toNullableFloat(params.p90Duration),
        p50_interaction_score: toNullableFloat(params.p50InteractionScore),
        p90_interaction_score: toNullableFloat(params.p90InteractionScore),
        total_errors: toUInt64String(params.totalErrors),
        total_rage_taps: toUInt64String(params.totalRageTaps),
        total_dead_taps: toUInt64String(params.totalDeadTaps),
        total_crashes: toUInt64String(params.totalCrashes),
        total_anrs: toUInt64String(params.totalAnrs),
        total_bouncers: toUInt64String(params.totalBouncers),
        total_casuals: toUInt64String(params.totalCasuals),
        total_explorers: toUInt64String(params.totalExplorers),
        total_loyalists: toUInt64String(params.totalLoyalists),
        total_touches: toUInt64String(params.totalTouches),
        total_scrolls: toUInt64String(params.totalScrolls),
        total_gestures: toUInt64String(params.totalGestures),
        total_interactions: toUInt64String(params.totalInteractions),
        unique_user_count: toUInt64String(params.uniqueUserCount),
        source: params.source ?? 'postgres_daily_stats',
        schema_version: PRODUCT_ROLLUPS_SCHEMA_VERSION,
        updated_at: updatedAt,
    };

    return {
        dailyRow,
        dimensionRows: buildDimensionRows(params, date, updatedAt),
    };
}

function parseHeatmapBucketKey(key: string): { bucketX: number; bucketY: number } | null {
    const [rawX, rawY] = key.split(',');
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return {
        bucketX: Math.round(x * 100),
        bucketY: Math.round(y * 100),
    };
}

export function buildClickHouseScreenHeatmapDailyRollupRows(params: {
    projectId: string;
    date: string | Date;
    screenName: string;
    touchBuckets?: Record<string, number> | null;
    rageTapBuckets?: Record<string, number> | null;
    screenFirstSeenMs?: number | null;
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
    source?: string;
    updatedAt?: Date;
}): ClickHouseScreenHeatmapDailyRollupRow[] {
    const screenName = sanitizeProductDimensionValue('screen', params.screenName);
    if (!screenName) return [];

    const date = toClickHouseDate(params.date);
    const updatedAt = toClickHouseDateTime(params.updatedAt);
    const base = {
        project_id: params.projectId,
        date,
        screen_name: screenName,
        screen_first_seen_ms: toUInt64String(params.screenFirstSeenMs),
        page_width: toUInt32Number(params.pageWidth),
        page_height: toUInt32Number(params.pageHeight),
        viewport_width: toUInt32Number(params.viewportWidth),
        viewport_height: toUInt32Number(params.viewportHeight),
        source: params.source ?? 'event_artifact',
        schema_version: PRODUCT_ROLLUPS_SCHEMA_VERSION,
        updated_at: updatedAt,
    };

    const rows: ClickHouseScreenHeatmapDailyRollupRow[] = [];
    const appendBuckets = (eventKind: 'touch' | 'rage_tap', buckets?: Record<string, number> | null) => {
        if (!buckets) return;
        for (const [bucketKey, rawCount] of Object.entries(buckets)) {
            const bucket = parseHeatmapBucketKey(bucketKey);
            const count = Number(rawCount);
            if (!bucket || !Number.isFinite(count) || count <= 0) continue;
            rows.push({
                ...base,
                event_kind: eventKind,
                bucket_x: bucket.bucketX,
                bucket_y: bucket.bucketY,
                bucket_count: toUInt64String(count),
            });
        }
    };

    appendBuckets('touch', params.touchBuckets);
    appendBuckets('rage_tap', params.rageTapBuckets);
    return rows;
}

export function buildClickHouseDeviceUsageDailyRollupRow(params: {
    projectId: string;
    period: string | Date;
    bytesUploaded?: number | bigint | string | null;
    minutesRecorded?: number | bigint | string | null;
    sessionsStarted?: number | bigint | string | null;
    requestCount?: number | bigint | string | null;
    source?: string;
    updatedAt?: Date;
}): ClickHouseDeviceUsageDailyRollupRow {
    return {
        project_id: params.projectId,
        period: toClickHouseDate(params.period),
        bytes_uploaded: toUInt64String(params.bytesUploaded),
        minutes_recorded: toUInt64String(params.minutesRecorded),
        sessions_started: toUInt64String(params.sessionsStarted),
        request_count: toUInt64String(params.requestCount),
        source: params.source ?? 'device_usage_increment',
        schema_version: PRODUCT_ROLLUPS_SCHEMA_VERSION,
        updated_at: toClickHouseDateTime(params.updatedAt),
    };
}

export function hasClickHouseDeviceUsageDailyRollupValue(row: ClickHouseDeviceUsageDailyRollupRow): boolean {
    return row.bytes_uploaded !== '0' ||
        row.minutes_recorded !== '0' ||
        row.sessions_started !== '0' ||
        row.request_count !== '0';
}

function clickHouseInsertSettings(deduplicationToken?: string) {
    return {
        ...(config.CLICKHOUSE_ASYNC_INSERT ? { async_insert: 1 as const, wait_for_async_insert: 1 as const } : {}),
        ...(deduplicationToken ? { insert_deduplication_token: deduplicationToken } : {}),
    };
}

export async function writeProductAnalyticsDailyRollupToClickHouse(params: {
    dailyRow: ClickHouseAppDailyRollupRow;
    dimensionRows: ClickHouseAppDimensionDailyRollupRow[];
}): Promise<void> {
    if (!isClickHouseProductRollupsWritesEnabled()) return;

    try {
        await getClickHouseClient().insert({
            table: 'app_daily_rollups',
            values: [params.dailyRow],
            format: 'JSONEachRow',
            clickhouse_settings: clickHouseInsertSettings(),
        });

        if (params.dimensionRows.length > 0) {
            await getClickHouseClient().insert({
                table: 'app_dimension_daily_rollups',
                values: params.dimensionRows,
                format: 'JSONEachRow',
                clickhouse_settings: clickHouseInsertSettings(),
            });
        }
    } catch (err) {
        logger.error({
            err,
            projectId: params.dailyRow.project_id,
            date: params.dailyRow.date,
            dimensionRowCount: params.dimensionRows.length,
        }, 'ClickHouse product analytics daily rollup insert failed');
        throw err;
    }
}

export async function writeProductAnalyticsDailyRollupInputToClickHouse(input: ProductAnalyticsDailyRollupInput): Promise<void> {
    const rows = buildClickHouseProductAnalyticsDailyRollupRows(input);
    await writeProductAnalyticsDailyRollupToClickHouse(rows);
}

export async function writeScreenHeatmapDailyRollupsToClickHouse(params: {
    artifactId?: string;
    rows: ClickHouseScreenHeatmapDailyRollupRow[];
}): Promise<void> {
    if (params.rows.length === 0) return;
    if (!isClickHouseProductRollupsWritesEnabled()) return;

    try {
        await getClickHouseClient().insert({
            table: 'screen_touch_heatmap_daily_rollups',
            values: params.rows,
            format: 'JSONEachRow',
            clickhouse_settings: clickHouseInsertSettings(params.artifactId ? `screen-heatmap:${params.artifactId}:v1` : undefined),
        });
    } catch (err) {
        logger.error({
            err,
            artifactId: params.artifactId,
            rowCount: params.rows.length,
        }, 'ClickHouse screen heatmap rollup insert failed');
        throw err;
    }
}

export async function writeDeviceUsageDailyRollupToClickHouse(row: ClickHouseDeviceUsageDailyRollupRow): Promise<void> {
    if (!hasClickHouseDeviceUsageDailyRollupValue(row)) return;
    if (!isClickHouseProductRollupsWritesEnabled()) return;

    try {
        await getClickHouseClient().insert({
            table: 'device_usage_daily_rollups',
            values: [row],
            format: 'JSONEachRow',
            clickhouse_settings: clickHouseInsertSettings(),
        });
    } catch (err) {
        logger.error({
            err,
            projectId: row.project_id,
            period: row.period,
        }, 'ClickHouse device usage rollup insert failed');
        throw err;
    }
}
