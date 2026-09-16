/**
 * SDK event timeline for the research lake.
 *
 * Builds the privacy-safe per-session `sdk_events.jsonl.gz` stream from the
 * raw `recording_artifacts.kind = 'events'` objects the SDK uploads: touches,
 * gestures (including dead and rage taps), navigation, app lifecycle, network
 * requests, log levels and stability markers. Rows carry exact device-clock
 * elapsed times, logical-point coordinates, keyed (HMAC) identifiers, and the
 * artifact they came from. Raw labels, URLs, messages and identities never
 * leave this module.
 *
 * The builder is pure with respect to storage and hashing: callers inject the
 * download and hash functions so the same code serves the export workers, the
 * timeline driver, and unit tests.
 */
import { parseMaybeGzippedJson } from '../utils/gzipJson.js';
import {
    getFirstTouchPointFromTelemetryEvent,
    getFrustrationTapKind,
    isKeyboardAreaTelemetryEvent,
} from '../utils/mobileFrustration.js';
import { normalizeApiEndpointPath } from '../utils/apiEndpointNormalization.js';

export const SDK_EVENTS_FILE_NAME = 'sdk_events.jsonl.gz';
export const SDK_EVENTS_ZIP_ENTRY_NAME = 'sdk_events.jsonl';
export const SDK_EVENT_ROW_LIMIT = 250_000;
// A session with more events artifacts than this is a runaway recorder, not a
// user session; it is recorded as unavailable instead of being downloaded.
export const SDK_EVENT_ARTIFACT_MAX_COUNT = 5_000;
export const SDK_EVENT_ARTIFACT_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
// Events artifacts are typically tens of kilobytes; anything far larger is
// treated as unavailable rather than inflated in memory beside other sessions.
export const SDK_EVENT_ARTIFACT_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const SESSION_DAY_MS = 86_400_000;
const FLOW_EDGE_ACTION_WINDOW_MS = 5_000;
const BYTES_BUCKET = 1024;
const BYTES_BUCKET_MAX = 64 * 1024 * 1024;

export type SdkEventTimelineStatus = 'observed' | 'partial' | 'unavailable';

export type SdkEventType =
    | 'touch'
    | 'gesture'
    | 'navigation'
    | 'app_background'
    | 'app_foreground'
    | 'app_startup'
    | 'network_request'
    | 'log'
    | 'custom'
    | 'anr'
    | 'error'
    | 'crash'
    | 'keyboard'
    | 'input'
    | 'app_terminated'
    | 'session_end'
    | 'session_timeout'
    | 'external_url_opened'
    | 'oauth';

export type SdkEventClockRelation = 'in_session' | 'before_session_start' | 'after_24h' | 'unavailable';

export type SdkEventRow = {
    index: number;
    type: SdkEventType;
    gesture_kind: string | null;
    frustration_kind: 'dead_tap' | 'rage_tap' | null;
    elapsed_ms: number | null;
    clock_relation: SdkEventClockRelation;
    timestamp_provenance: 'device_wall_clock' | 'unavailable';
    x: number | null;
    y: number | null;
    screen_width: number | null;
    screen_height: number | null;
    x_norm_bucket: number | null;
    y_norm_bucket: number | null;
    x_cell: number | null;
    y_cell: number | null;
    target_key: string | null;
    is_keyboard_surface: boolean;
    tap_count: number | null;
    direction: string | null;
    screen_key: string | null;
    view_key: string | null;
    entering: boolean | null;
    total_background_ms: number | null;
    method: string | null;
    host_key: string | null;
    path_key: string | null;
    status_code: number | null;
    status_class: string | null;
    duration_ms: number | null;
    success: boolean | null;
    has_error_message: boolean;
    request_bytes_bucket: number | null;
    response_bytes_bucket: number | null;
    log_level: string | null;
    event_name_key: string | null;
    keyboard_action: 'show' | 'hide' | null;
    gesture_scale: number | null;
    gesture_angle: number | null;
    input_redacted: boolean | null;
    key_press_count: number | null;
    error_name_key: string | null;
    oauth_stage: 'started' | 'completed' | 'returned' | null;
    scheme_key: string | null;
    source_artifact_index: number;
    source_artifact_key: string;
    source_event_ordinal: number;
};

export type SdkEventTimelineSummary = {
    sdk_event_timeline: SdkEventTimelineStatus;
    sdk_event_artifact_count: number;
    sdk_event_artifact_missing_count: number;
    sdk_event_artifact_oversized_count: number;
    sdk_event_count: number;
    sdk_event_clock_out_of_range_count: number;
    sdk_event_unrecognized_count: number;
    sdk_event_type_counts: Record<string, number>;
    touch_timeline_present: boolean;
    navigation_timeline_present: boolean;
    lifecycle_timeline_present: boolean;
    network_timeline_present: boolean;
    sdk_event_row_limit_reached: boolean;
};

export type SdkEventTimeline = {
    rows: SdkEventRow[];
    summary: SdkEventTimelineSummary;
    warnings: string[];
};

export type SdkEventArtifact = {
    id: string;
    kind: string;
    s3ObjectKey: string | null;
    start_time: number | null;
    size_bytes?: number | null;
    declared_size_bytes?: number | null;
};

export type SdkPositionBuckets = {
    x_norm_bucket: number | null;
    y_norm_bucket: number | null;
    x_cell: number | null;
    y_cell: number | null;
};

export type SdkEventTimelineParams = {
    session: { started_at: Date; ended_at?: Date | null };
    artifacts: SdkEventArtifact[];
    projectKey: string;
    hash: (value: string, length?: number) => string;
    download: (artifact: SdkEventArtifact) => Promise<Buffer | null>;
    positionBuckets: (x: number, y: number, width: number | null, height: number | null) => SdkPositionBuckets;
    artifactConcurrency?: number;
    maxRows?: number;
    maxDecompressedBytes?: number;
};

type ParsedArtifact = {
    artifact: SdkEventArtifact;
    index: number;
    events: unknown[];
    screenWidth: number | null;
    screenHeight: number | null;
    status: 'read' | 'missing' | 'oversized';
};

const METHOD_ALLOWLIST = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const GESTURE_KINDS = new Set([
    'tap', 'double_tap', 'long_press', 'pan', 'swipe', 'scroll', 'pinch', 'rotation', 'dead_tap', 'rage_tap',
]);
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const LIFECYCLE_TYPES = new Set<string>(['app_background', 'app_foreground', 'app_startup', 'app_terminated', 'session_end', 'session_timeout']);
const SKIPPED_TYPES = new Set([
    'user_identity_changed', 'session_start', 'motion', 'scroll_motion', 'pan_motion', '$user_property',
    'device_info', 'feedback', 'user_feedback', 'redux_action', 'attribute',
]);

function lower(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function positiveInt(value: unknown): number | null {
    const parsed = finiteNumber(value);
    return parsed !== null && parsed > 0 ? Math.round(parsed) : null;
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bytesBucket(value: unknown): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed < 0) return null;
    return Math.min(BYTES_BUCKET_MAX, Math.floor(parsed / BYTES_BUCKET) * BYTES_BUCKET);
}

function deviceTimestampMs(event: Record<string, unknown>): number | null {
    const candidates = [event.timestamp, event.startTimestamp, event.ts, objectValue(event.payload)?.timestamp];
    for (const candidate of candidates) {
        const parsed = finiteNumber(candidate);
        if (parsed === null) continue;
        // Device wall clocks are epoch milliseconds. Accept epoch seconds from
        // older payloads by scaling; reject anything outside a plausible range.
        if (parsed >= 1e12 && parsed < 1e14) return Math.round(parsed);
        if (parsed >= 1e9 && parsed < 1e11) return Math.round(parsed * 1000);
    }
    return null;
}

function extractEvents(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) return parsed;
    const record = objectValue(parsed);
    if (record && Array.isArray(record.events)) return record.events;
    return [];
}

function extractScreenDimensions(parsed: unknown): { width: number | null; height: number | null } {
    const record = objectValue(parsed);
    const deviceInfo = objectValue(record?.deviceInfo) ?? objectValue(record?.device_info);
    return {
        width: positiveInt(deviceInfo?.screenWidth ?? deviceInfo?.width),
        height: positiveInt(deviceInfo?.screenHeight ?? deviceInfo?.height),
    };
}

function hostAndPath(event: Record<string, unknown>): { host: string | null; path: string | null } {
    let host = typeof event.urlHost === 'string' && event.urlHost ? event.urlHost : null;
    let path = typeof event.urlPath === 'string' && event.urlPath ? event.urlPath : null;
    const url = typeof event.url === 'string' ? event.url : '';
    if ((!host || !path) && url) {
        try {
            const parsed = new URL(url);
            host ??= parsed.hostname || null;
            path ??= parsed.pathname || null;
        } catch {
            if (!path && url.startsWith('/')) path = url.split('?')[0];
        }
    }
    return { host: host ? host.toLowerCase() : null, path };
}

function statusClass(code: number | null): string | null {
    if (code === null || code < 100 || code > 599) return null;
    return `${Math.floor(code / 100)}xx`;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

function emptyRow(index: number, type: SdkEventType, artifactIndex: number, artifactKey: string, ordinal: number): SdkEventRow {
    return {
        index,
        type,
        gesture_kind: null,
        frustration_kind: null,
        elapsed_ms: null,
        clock_relation: 'unavailable',
        timestamp_provenance: 'unavailable',
        x: null,
        y: null,
        screen_width: null,
        screen_height: null,
        x_norm_bucket: null,
        y_norm_bucket: null,
        x_cell: null,
        y_cell: null,
        target_key: null,
        is_keyboard_surface: false,
        tap_count: null,
        direction: null,
        screen_key: null,
        view_key: null,
        entering: null,
        total_background_ms: null,
        method: null,
        host_key: null,
        path_key: null,
        status_code: null,
        status_class: null,
        duration_ms: null,
        success: null,
        has_error_message: false,
        request_bytes_bucket: null,
        response_bytes_bucket: null,
        log_level: null,
        event_name_key: null,
        keyboard_action: null,
        gesture_scale: null,
        gesture_angle: null,
        input_redacted: null,
        key_press_count: null,
        error_name_key: null,
        oauth_stage: null,
        scheme_key: null,
        source_artifact_index: artifactIndex,
        source_artifact_key: artifactKey,
        source_event_ordinal: ordinal,
    };
}

function lifecycleState(event: Record<string, unknown>): SdkEventType | 'skip' {
    const state = lower(event.state);
    if (state === 'active' || state === 'app_foreground' || state === 'foreground') return 'app_foreground';
    if (state === 'background' || state === 'app_background') return 'app_background';
    if (state === 'app_terminated' || state === 'terminated') return 'app_terminated';
    return 'skip';
}

function classifyType(event: Record<string, unknown>): SdkEventType | 'skip' | 'unrecognized' {
    const type = lower(event.type);
    if (!type || type.startsWith('$') || SKIPPED_TYPES.has(type)) return 'skip';
    if (type === 'touch' || type === 'tap' || type === 'click') return 'touch';
    if (type === 'gesture' || type === 'scroll' || type === 'dead_tap' || type === 'rage_tap' || type === 'dead_click' || type === 'rage_click') return 'gesture';
    if (type === 'frustration') {
        const kind = lower(event.frustrationKind);
        return kind === 'ui_freeze' ? 'anr' : kind === 'error' ? 'error' : 'gesture';
    }
    if (type === 'navigation' || type === 'screen_view' || type === 'screen_change') return 'navigation';
    if (type === 'app_background' || type === 'app_foreground' || type === 'app_startup' || type === 'app_terminated') return type;
    if (type === 'app_state' || type === 'app_lifecycle') return lifecycleState(event);
    if (type === 'session_end' || type === 'session_timeout' || type === 'external_url_opened') return type;
    if (type === 'oauth_started' || type === 'oauth_completed' || type === 'oauth_returned') return 'oauth';
    if (type === 'api_call' || type === 'network_request') return 'network_request';
    if (type === 'log' || type === 'console_log') return 'log';
    if (type === 'anr' || type === 'long_task' || type === 'ui_freeze') return 'anr';
    if (type === 'error' || type === 'resource_error') return 'error';
    if (type === 'crash') return 'crash';
    if (type === 'keyboard_show' || type === 'keyboard_hide') return 'keyboard';
    if (type === 'keyboard_typing' || type === 'input' || type === 'text_input') return 'input';
    if (type === 'custom') return 'custom';
    return 'unrecognized';
}

function gestureKind(event: Record<string, unknown>, type: SdkEventType): string | null {
    const raw = lower(event.type);
    if (raw === 'scroll') return 'scroll';
    if (raw === 'dead_tap' || raw === 'dead_click') return 'dead_tap';
    if (raw === 'rage_tap' || raw === 'rage_click') return 'rage_tap';
    const gesture = lower(event.gestureType) || lower(objectValue(event.payload)?.gestureType) || lower(objectValue(event.properties)?.gestureType);
    if (type === 'touch' && !gesture) return 'tap';
    if (gesture === 'single_tap') return 'tap';
    if (!gesture) return type === 'gesture' ? 'other' : null;
    if (GESTURE_KINDS.has(gesture)) return gesture;
    if (gesture.includes('tap')) return 'tap';
    return 'other';
}

/**
 * Build the SDK event timeline for one session from its events artifacts.
 * Never throws for a missing or unreadable artifact; those are counted and
 * reflected in the timeline status.
 */
export async function buildSdkEventTimeline(params: SdkEventTimelineParams): Promise<SdkEventTimeline> {
    const maxRows = params.maxRows ?? SDK_EVENT_ROW_LIMIT;
    const maxDecompressed = params.maxDecompressedBytes ?? SDK_EVENT_ARTIFACT_MAX_DECOMPRESSED_BYTES;
    const startedAtMs = params.session.started_at.getTime();
    const eventArtifacts = params.artifacts
        .filter((artifact) => artifact.kind === 'events' && artifact.s3ObjectKey)
        .sort((a, b) => ((a.start_time ?? 0) - (b.start_time ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (eventArtifacts.length > SDK_EVENT_ARTIFACT_MAX_COUNT) {
        return unavailableSdkEventTimeline(params.artifacts, 'artifact_count_exceeded');
    }

    const parsed = await mapWithConcurrency(eventArtifacts, params.artifactConcurrency ?? 6, async (artifact, index): Promise<ParsedArtifact> => {
        const base: ParsedArtifact = { artifact, index, events: [], screenWidth: null, screenHeight: null, status: 'missing' };
        const declared = finiteNumber(artifact.declared_size_bytes) ?? finiteNumber(artifact.size_bytes);
        if (declared !== null && declared > SDK_EVENT_ARTIFACT_MAX_COMPRESSED_BYTES) return { ...base, status: 'oversized' };
        let data: Buffer | null = null;
        try {
            data = await params.download(artifact);
        } catch {
            data = null;
        }
        if (!data) return base;
        if (data.length > SDK_EVENT_ARTIFACT_MAX_COMPRESSED_BYTES) return { ...base, status: 'oversized' };
        try {
            const payload = await parseMaybeGzippedJson(data, artifact.s3ObjectKey);
            const events = extractEvents(payload);
            const serializedEstimate = data.length * 12;
            if (serializedEstimate > maxDecompressed && JSON.stringify(payload).length > maxDecompressed) {
                return { ...base, status: 'oversized' };
            }
            const dims = extractScreenDimensions(payload);
            return { ...base, events, screenWidth: dims.width, screenHeight: dims.height, status: 'read' };
        } catch {
            return base;
        }
    });

    const typeCounts: Record<string, number> = {};
    const rows: SdkEventRow[] = [];
    let missing = 0;
    let oversized = 0;
    let unrecognized = 0;
    let outOfRange = 0;
    let rowLimitReached = false;
    let carriedWidth: number | null = null;
    let carriedHeight: number | null = null;
    let currentScreenKey: string | null = null;

    type Pending = { row: SdkEventRow; deviceTs: number | null };
    const pending: Pending[] = [];

    for (const entry of parsed) {
        if (entry.status === 'missing') { missing += 1; continue; }
        if (entry.status === 'oversized') { oversized += 1; missing += 1; continue; }
        carriedWidth = entry.screenWidth ?? carriedWidth;
        carriedHeight = entry.screenHeight ?? carriedHeight;
        const artifactKey = params.hash(`${params.projectKey}:artifact:${entry.artifact.id}`, 20);
        entry.events.forEach((rawEvent, ordinal) => {
            const event = objectValue(rawEvent);
            if (!event) return;
            const classified = classifyType(event);
            if (classified === 'skip') return;
            if (classified === 'unrecognized') { unrecognized += 1; return; }
            const row = emptyRow(0, classified, entry.index, artifactKey, ordinal);
            const deviceTs = deviceTimestampMs(event);
            if (deviceTs !== null) {
                row.elapsed_ms = deviceTs - startedAtMs;
                row.timestamp_provenance = 'device_wall_clock';
                row.clock_relation = row.elapsed_ms < 0
                    ? 'before_session_start'
                    : row.elapsed_ms > SESSION_DAY_MS ? 'after_24h' : 'in_session';
                if (row.clock_relation !== 'in_session') outOfRange += 1;
            }
            row.screen_width = carriedWidth;
            row.screen_height = carriedHeight;

            if (classified === 'touch' || classified === 'gesture') {
                row.gesture_kind = gestureKind(event, classified);
                row.frustration_kind = getFrustrationTapKind(event);
                if (row.frustration_kind) row.gesture_kind = row.frustration_kind;
                const point = getFirstTouchPointFromTelemetryEvent(event);
                const x = point ? point.x : finiteNumber(event.x);
                const y = point ? point.y : finiteNumber(event.y);
                if (x !== null && y !== null) {
                    row.x = Math.round(x);
                    row.y = Math.round(y);
                    Object.assign(row, params.positionBuckets(x, y, carriedWidth, carriedHeight));
                }
                const label = typeof event.label === 'string' ? event.label.trim() : '';
                row.target_key = label ? params.hash(`${params.projectKey}:sdk-target:${label}`, 20) : null;
                row.is_keyboard_surface = isKeyboardAreaTelemetryEvent(event);
                row.tap_count = positiveInt(event.count);
                const direction = lower(event.direction);
                row.direction = DIRECTIONS.has(direction) ? direction : null;
                const scale = finiteNumber(event.scale);
                row.gesture_scale = scale !== null ? Math.round(scale * 1000) / 1000 : null;
                const angle = finiteNumber(event.angle);
                row.gesture_angle = angle !== null ? Math.round(angle * 1000) / 1000 : null;
            } else if (classified === 'navigation') {
                const screen = (typeof event.screen === 'string' && event.screen) || (typeof event.screenName === 'string' && event.screenName) || '';
                row.entering = booleanOrNull(event.entering);
                if (screen) {
                    const key = params.hash(`${params.projectKey}:screen:${screen}`, 20);
                    row.screen_key = key;
                    if (row.entering !== false) currentScreenKey = key;
                }
                row.view_key = typeof event.viewId === 'string' && event.viewId
                    ? params.hash(`${params.projectKey}:sdk-view:${event.viewId}`, 20)
                    : null;
            } else if (classified === 'app_foreground') {
                const background = finiteNumber(event.totalBackgroundTime);
                row.total_background_ms = background !== null && background >= 0 ? Math.round(background) : null;
            } else if (classified === 'app_startup' || classified === 'anr') {
                const duration = finiteNumber(event.durationMs ?? event.duration);
                row.duration_ms = duration !== null && duration >= 0 ? Math.round(duration) : null;
            } else if (classified === 'session_timeout') {
                const duration = finiteNumber(event.backgroundDuration);
                row.duration_ms = duration !== null && duration >= 0 ? Math.round(duration) : null;
            } else if (classified === 'error' || classified === 'crash') {
                const name = typeof event.name === 'string' ? event.name.trim() : '';
                row.error_name_key = name ? params.hash(`${params.projectKey}:error-name:${name}`, 20) : null;
            } else if (classified === 'external_url_opened') {
                const scheme = lower(event.scheme);
                row.scheme_key = scheme ? params.hash(`${params.projectKey}:url-scheme:${scheme}`, 20) : null;
            } else if (classified === 'oauth') {
                const raw = lower(event.type).replace('oauth_', '');
                row.oauth_stage = raw === 'started' || raw === 'completed' || raw === 'returned' ? raw : null;
            } else if (classified === 'input') {
                row.input_redacted = typeof event.redacted === 'boolean' ? event.redacted : (lower(event.type) === 'keyboard_typing' ? null : true);
                row.key_press_count = positiveInt(event.keyPressCount);
            } else if (classified === 'network_request') {
                const method = lower(event.method).toUpperCase();
                row.method = method ? (METHOD_ALLOWLIST.has(method) ? method : 'OTHER') : null;
                const { host, path } = hostAndPath(event);
                row.host_key = host ? params.hash(`${params.projectKey}:host:${host}`, 20) : null;
                row.path_key = path ? params.hash(`${params.projectKey}:path:${normalizeApiEndpointPath(path)}`, 20) : null;
                const status = finiteNumber(event.statusCode ?? event.status);
                row.status_code = status !== null ? Math.round(status) : null;
                row.status_class = statusClass(row.status_code);
                const duration = finiteNumber(event.duration);
                const start = finiteNumber(event.startTimestamp);
                const end = finiteNumber(event.endTimestamp);
                row.duration_ms = duration !== null && duration >= 0
                    ? Math.round(duration)
                    : start !== null && end !== null && end >= start ? Math.round(end - start) : null;
                row.success = booleanOrNull(event.success);
                row.has_error_message = typeof event.errorMessage === 'string' && event.errorMessage.length > 0;
                row.request_bytes_bucket = bytesBucket(event.requestBodySize);
                row.response_bytes_bucket = bytesBucket(event.responseBodySize);
            } else if (classified === 'log') {
                const level = lower(event.level);
                row.log_level = level ? (LOG_LEVELS.has(level) ? level : level === 'warning' ? 'warn' : 'other') : null;
            } else if (classified === 'custom') {
                const name = typeof event.name === 'string' ? event.name.trim() : '';
                row.event_name_key = name ? params.hash(`${params.projectKey}:event-name:${name}`, 20) : null;
            } else if (classified === 'keyboard') {
                row.keyboard_action = lower(event.type) === 'keyboard_show' ? 'show' : 'hide';
            }
            if (classified !== 'navigation') row.screen_key = currentScreenKey;
            pending.push({ row, deviceTs });
        });
    }

    // Stable merge across artifacts: device timestamp first, then artifact
    // order and in-artifact ordinal, so undated rows keep their upload order.
    pending.sort((a, b) => {
        const ta = a.deviceTs ?? Number.POSITIVE_INFINITY;
        const tb = b.deviceTs ?? Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        if (a.row.source_artifact_index !== b.row.source_artifact_index) return a.row.source_artifact_index - b.row.source_artifact_index;
        return a.row.source_event_ordinal - b.row.source_event_ordinal;
    });
    for (const entry of pending) {
        if (rows.length >= maxRows) { rowLimitReached = true; break; }
        entry.row.index = rows.length;
        rows.push(entry.row);
        typeCounts[entry.row.type] = (typeCounts[entry.row.type] ?? 0) + 1;
    }

    const readCount = parsed.filter((entry) => entry.status === 'read').length;
    const status: SdkEventTimelineStatus = eventArtifacts.length === 0 || readCount === 0
        ? 'unavailable'
        : missing > 0 ? 'partial' : 'observed';
    const summary: SdkEventTimelineSummary = {
        sdk_event_timeline: status,
        sdk_event_artifact_count: eventArtifacts.length,
        sdk_event_artifact_missing_count: missing,
        sdk_event_artifact_oversized_count: oversized,
        sdk_event_count: rows.length,
        sdk_event_clock_out_of_range_count: outOfRange,
        sdk_event_unrecognized_count: unrecognized,
        sdk_event_type_counts: typeCounts,
        touch_timeline_present: rows.some((row) => row.type === 'touch' || row.type === 'gesture'),
        navigation_timeline_present: rows.some((row) => row.type === 'navigation'),
        lifecycle_timeline_present: rows.some((row) => LIFECYCLE_TYPES.has(row.type)),
        network_timeline_present: rows.some((row) => row.type === 'network_request'),
        sdk_event_row_limit_reached: rowLimitReached,
    };
    return { rows, summary, warnings: sdkEventTimelineWarnings(summary) };
}

export function unavailableSdkEventTimeline(artifacts: SdkEventArtifact[], reason?: 'identifier_risk' | 'artifact_count_exceeded'): SdkEventTimeline {
    const count = artifacts.filter((artifact) => artifact.kind === 'events' && artifact.s3ObjectKey).length;
    const summary: SdkEventTimelineSummary = {
        sdk_event_timeline: 'unavailable',
        sdk_event_artifact_count: count,
        sdk_event_artifact_missing_count: count,
        sdk_event_artifact_oversized_count: 0,
        sdk_event_count: 0,
        sdk_event_clock_out_of_range_count: 0,
        sdk_event_unrecognized_count: 0,
        sdk_event_type_counts: {},
        touch_timeline_present: false,
        navigation_timeline_present: false,
        lifecycle_timeline_present: false,
        network_timeline_present: false,
        sdk_event_row_limit_reached: false,
    };
    const warnings = sdkEventTimelineWarnings(summary);
    if (reason === 'identifier_risk') warnings.push('sdk_event_timeline_identifier_risk_detected');
    if (reason === 'artifact_count_exceeded') warnings.push('sdk_event_artifact_count_exceeded');
    return { rows: [], summary, warnings };
}

export function sdkEventTimelineWarnings(summary: SdkEventTimelineSummary): string[] {
    const warnings: string[] = [];
    if (summary.sdk_event_timeline === 'unavailable') warnings.push('sdk_event_timeline_unavailable');
    if (summary.sdk_event_timeline === 'partial') warnings.push('sdk_event_artifacts_partially_unavailable');
    if (summary.sdk_event_artifact_oversized_count > 0) warnings.push('sdk_event_artifact_oversized');
    if (summary.sdk_event_row_limit_reached) warnings.push('sdk_event_row_limit_reached');
    if (summary.sdk_event_clock_out_of_range_count > 0) warnings.push('sdk_event_clock_out_of_range');
    return warnings;
}

/** Flat quality.json fields describing the timeline. */
export function sdkEventTimelineQualityFields(summary: SdkEventTimelineSummary, zipEntryPresent: boolean): Record<string, unknown> {
    return {
        sdk_event_timeline: summary.sdk_event_timeline,
        sdk_event_artifact_count: summary.sdk_event_artifact_count,
        sdk_event_artifact_missing_count: summary.sdk_event_artifact_missing_count,
        sdk_event_count: summary.sdk_event_count,
        sdk_event_clock_out_of_range_count: summary.sdk_event_clock_out_of_range_count,
        sdk_event_type_counts: summary.sdk_event_type_counts,
        touch_timeline_present: summary.touch_timeline_present,
        navigation_timeline_present: summary.navigation_timeline_present,
        lifecycle_timeline_present: summary.lifecycle_timeline_present,
        network_timeline_present: summary.network_timeline_present,
        sdk_events_zip_entry_present: zipEntryPresent,
    };
}

export type SdkFlowEdgeRow = {
    edge_index: number;
    from_screen_key: string;
    to_screen_key: string;
    action_event_index: number | null;
    action_kind: string | null;
    action_target_key: string | null;
    action_elapsed_ms: number | null;
    transition_elapsed_ms: number | null;
    transition_elapsed_ms_bucket: number | null;
    evidence_source: 'observed_navigation_event';
};

/** Screen-to-screen edges from observed navigation rows. */
export function buildSdkFlowEdges(rows: SdkEventRow[]): SdkFlowEdgeRow[] {
    const edges: SdkFlowEdgeRow[] = [];
    let previousScreen: string | null = null;
    let lastAction: SdkEventRow | null = null;
    for (const row of rows) {
        if ((row.type === 'touch' || row.type === 'gesture') && !row.is_keyboard_surface) {
            lastAction = row;
            continue;
        }
        if (row.type !== 'navigation' || row.entering === false || !row.screen_key) continue;
        if (previousScreen && previousScreen !== row.screen_key) {
            const action = lastAction && row.elapsed_ms !== null && lastAction.elapsed_ms !== null
                && row.elapsed_ms - lastAction.elapsed_ms >= 0
                && row.elapsed_ms - lastAction.elapsed_ms <= FLOW_EDGE_ACTION_WINDOW_MS
                ? lastAction
                : null;
            edges.push({
                edge_index: edges.length,
                from_screen_key: previousScreen,
                to_screen_key: row.screen_key,
                action_event_index: action ? action.index : null,
                action_kind: action ? (action.gesture_kind ?? action.type) : null,
                action_target_key: action ? action.target_key : null,
                action_elapsed_ms: action ? action.elapsed_ms : null,
                transition_elapsed_ms: row.elapsed_ms,
                transition_elapsed_ms_bucket: row.elapsed_ms === null ? null : Math.max(0, Math.floor(row.elapsed_ms / 500) * 500),
                evidence_source: 'observed_navigation_event',
            });
        }
        previousScreen = row.screen_key;
        lastAction = null;
    }
    return edges;
}

export type SdkLifecycleEvidence = {
    background_count: number;
    foreground_count: number;
    last_lifecycle_type: 'app_background' | 'app_foreground' | null;
    last_app_background_elapsed_ms: number | null;
    ended_in_background: boolean;
};

const ENDED_IN_BACKGROUND_TOLERANCE_MS = 5 * 60 * 1000;

/** Lifecycle evidence for session-end taxonomy: did the session end with the app in the background? */
export function sdkLifecycleEvidence(rows: SdkEventRow[], session: { started_at: Date; ended_at?: Date | null }): SdkLifecycleEvidence {
    let backgroundCount = 0;
    let foregroundCount = 0;
    let last: 'app_background' | 'app_foreground' | null = null;
    let lastBackgroundElapsed: number | null = null;
    for (const row of rows) {
        if (row.type === 'app_background' || row.type === 'app_terminated' || row.type === 'session_timeout') {
            backgroundCount += 1;
            last = 'app_background';
            lastBackgroundElapsed = row.elapsed_ms;
        } else if (row.type === 'app_foreground') {
            foregroundCount += 1;
            last = 'app_foreground';
        }
    }
    const sessionSpanMs = session.ended_at ? session.ended_at.getTime() - session.started_at.getTime() : null;
    const endedInBackground = last === 'app_background' && (
        sessionSpanMs === null
        || lastBackgroundElapsed === null
        || Math.abs(sessionSpanMs - lastBackgroundElapsed) <= ENDED_IN_BACKGROUND_TOLERANCE_MS
    );
    return {
        background_count: backgroundCount,
        foreground_count: foregroundCount,
        last_lifecycle_type: last,
        last_app_background_elapsed_ms: lastBackgroundElapsed,
        ended_in_background: endedInBackground,
    };
}
