/**
 * Timeline event normalisation, ported from `routes/sessions.ts` so the MCP
 * server reads the same events the dashboard timeline shows without importing
 * the route (which pulls in the whole API).
 *
 * Ported functions and their source:
 *   normalizeTimelineEvents        <- normalizeEventsForTimeline
 *   synthesizeRageTapEvents        <- synthesizeRageTapEventsForTimeline
 *   buildFaultEvents               <- buildSessionFaultEvents
 *   mergeEventsWithFaults          <- mergeEventsWithFaults / buildFaultDedupeSignature
 *   selectExtraCustomSessionEvents <- the custom-event merge inside loadTimelinePayload
 *   filterDisplayAnrs              <- filterDisplayAnrs / isWebSyntheticLongTaskAnr
 *
 * One deliberate difference: an event without an id gets a deterministic id
 * (`evt_<index>`) where the route appends a random suffix, so results are
 * stable between calls and cursors stay valid.
 *
 * Everything here is pure: no database, no storage, no clock.
 */

import { resolveAnrStackTrace } from '../../services/anrStack.js';
import { normalizeReplayEventPayload } from '../../services/replayEventPayload.js';
import { isGameplayTelemetryEvent } from '../../utils/gameplayIntervals.js';
import {
    MOBILE_RAGE_TAP_THRESHOLD,
    getFirstTouchPointFromTelemetryEvent,
    getFrustrationTapKind,
    isKeyboardAreaTelemetryEvent,
    registerTapForMobileRageInference,
} from '../../utils/mobileFrustration.js';
import type { MobileTapPoint } from '../../utils/mobileFrustration.js';

export type RawEvent = any;

export interface NormalizedTimelineEvent {
    [key: string]: any;
    id: string;
    type: string;
    /** Epoch milliseconds. */
    timestamp: number;
    payload: any;
    properties: any | null;
    gestureType: string | null;
    targetLabel: string | null;
    touches: any[] | null;
    frustrationKind: string | null;
    screen: string | null;
}

export type TimestampCoercer = (raw: unknown, fallbackMs: number) => number;

/**
 * SDKs have sent timestamps as epoch milliseconds, epoch seconds, and
 * milliseconds or seconds since session start. Pick the reading that lands
 * inside the session (with a minute of slack either side).
 */
export function createTimestampCoercer(sessionStartMs: number, sessionEndMs: number): TimestampCoercer {
    return (raw, fallbackMs) => {
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
        for (const candidate of candidates) {
            if (candidate >= minOk && candidate <= maxOk) return candidate;
        }

        return Math.round(n * 1000);
    };
}

function isTapLikeTimelineEvent(event: any): boolean {
    const type = (event?.type || '').toString().toLowerCase();
    const gestureType = (event?.gestureType || event?.properties?.gestureType || event?.payload?.gestureType || '').toString().toLowerCase();

    return (type === 'touch' || type === 'tap' || type === 'click' || type === 'gesture') &&
        (gestureType === 'tap' || gestureType === 'single_tap' || gestureType === 'double_tap');
}

/**
 * Older SDKs upload plain taps only. Three nearby taps within a second become
 * an inferred rage-tap marker, unless the SDK already sent an explicit one for
 * the same spot and moment.
 */
export function synthesizeRageTapEvents(normalizedEvents: NormalizedTimelineEvent[]): NormalizedTimelineEvent[] {
    const explicitRagePoints = normalizedEvents
        .filter((event) => getFrustrationTapKind(event) === 'rage_tap')
        .map((event) => getFirstTouchPointFromTelemetryEvent(event))
        .filter((point): point is MobileTapPoint => Boolean(point));

    const recentTaps: MobileTapPoint[] = [];
    const synthetic: NormalizedTimelineEvent[] = [];

    for (const event of normalizedEvents) {
        const frustrationKind = getFrustrationTapKind(event);
        if (frustrationKind) {
            recentTaps.length = 0;
            continue;
        }
        if (!isTapLikeTimelineEvent(event)) continue;
        if (event?.rageEligible === false || event?.properties?.rageEligible === false || event?.payload?.rageEligible === false) {
            recentTaps.length = 0;
            continue;
        }
        if (isGameplayTelemetryEvent(event)) {
            recentTaps.length = 0;
            continue;
        }
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

export function normalizeTimelineEvents(
    allEvents: RawEvent[],
    sessionStartMs: number,
    sessionEndMs: number,
): { normalizedEvents: NormalizedTimelineEvent[]; coerceToEpochMs: TimestampCoercer } {
    const coerceToEpochMs = createTimestampCoercer(sessionStartMs, sessionEndMs);

    const normalizedEvents: NormalizedTimelineEvent[] = allEvents
        .map((e, idx) => {
            const rawType = (e?.type ?? e?.name ?? '').toString();
            const type = rawType.length > 0 ? rawType.toLowerCase() : 'unknown';
            const rawTs = e?.timestamp ?? e?.ts ?? e?.time;
            const timestamp = coerceToEpochMs(rawTs, sessionStartMs);
            const { payload, properties } = normalizeReplayEventPayload(e);

            return {
                ...e,
                id: e?.id || `evt_${idx}`,
                type,
                timestamp,
                payload,
                properties,
                gestureType: e?.gestureType || properties?.gestureType || payload?.gestureType || null,
                // Swift 0.2.x / RN 1.2.x native artifacts use `label` for the
                // tapped view; newer ones use `targetLabel`. Read both.
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

    const syntheticRageTapEvents = synthesizeRageTapEvents(normalizedEvents);
    const timelineEvents = syntheticRageTapEvents.length > 0
        ? [...normalizedEvents, ...syntheticRageTapEvents].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        : normalizedEvents;

    return { normalizedEvents: timelineEvents, coerceToEpochMs };
}

// --- Faults (rows of crashes / anrs / errors) merged into the timeline -------------

export interface CrashFaultRow {
    id: string;
    timestamp: Date | number;
    exceptionName: string | null;
    reason: string | null;
    stackTrace: string | null;
}

export interface AnrFaultRow {
    id: string;
    timestamp: Date | number;
    durationMs: number | null;
    threadState: string | null;
    deviceMetadata: unknown;
}

export interface ErrorFaultRow {
    id: string;
    timestamp: Date | number;
    errorType: string | null;
    errorName: string | null;
    message: string | null;
    stack: string | null;
    screenName: string | null;
}

/** Web sessions record long main-thread tasks as ANR rows; the dashboard does not show them as ANRs. */
export function filterDisplayAnrs<Row extends { threadState?: unknown; deviceMetadata?: any }>(
    platform: string | null | undefined,
    anrRows: Row[],
): Row[] {
    if (String(platform || '').toLowerCase() !== 'web') return anrRows;
    return anrRows.filter((row) => {
        const threadState = String(row?.threadState || row?.deviceMetadata?.stack || '').toLowerCase();
        return !threadState.includes('main_thread_long_task');
    });
}

function rowTimestamp(value: Date | number): unknown {
    return value instanceof Date ? value.getTime() : value;
}

export function buildFaultEvents(
    crashRows: CrashFaultRow[],
    anrRows: AnrFaultRow[],
    errorRows: ErrorFaultRow[],
    sessionStartMs: number,
    coerceToEpochMs: TimestampCoercer,
): NormalizedTimelineEvent[] {
    const base = { payload: null, properties: null, gestureType: null, targetLabel: null, touches: null, frustrationKind: null, screen: null };

    const crashEvents = crashRows.map((row) => {
        const primaryMessage = [row.exceptionName || 'Crash', row.reason || ''].filter(Boolean).join(': ');
        return {
            ...base,
            id: `crash_evt_${row.id}`,
            faultId: row.id,
            type: 'crash',
            timestamp: coerceToEpochMs(rowTimestamp(row.timestamp), sessionStartMs),
            name: row.exceptionName || 'Crash',
            message: primaryMessage || 'Crash detected',
            level: 'error',
            stack: row.stackTrace || undefined,
        };
    });

    const anrEvents = anrRows.map((row) => {
        const stackTrace = resolveAnrStackTrace({ threadState: row.threadState, deviceMetadata: row.deviceMetadata });
        const detail = Number.isFinite(row.durationMs)
            ? `ANR detected (${row.durationMs} ms blocked)`
            : 'ANR detected';
        return {
            ...base,
            id: `anr_evt_${row.id}`,
            faultId: row.id,
            type: 'anr',
            timestamp: coerceToEpochMs(rowTimestamp(row.timestamp), sessionStartMs),
            name: 'ANR',
            message: detail,
            level: 'error',
            stack: stackTrace || undefined,
            durationMs: row.durationMs,
        };
    });

    const errorEvents = errorRows.map((row) => ({
        ...base,
        id: `error_evt_${row.id}`,
        faultId: row.id,
        type: 'error',
        timestamp: coerceToEpochMs(rowTimestamp(row.timestamp), sessionStartMs),
        name: row.errorName || 'Error',
        message: row.message || 'Runtime error',
        level: 'error',
        stack: row.stack || undefined,
        screen: row.screenName || null,
    }));

    return [...crashEvents, ...anrEvents, ...errorEvents];
}

function faultText(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase().slice(0, 240);
}

/** Type, time rounded to 250 ms, name, message and first stack line. */
export function faultDedupeSignature(event: any): string {
    const type = (event?.type ?? '').toString().toLowerCase();
    const timestamp = Number.isFinite(event?.timestamp)
        ? Math.round(Number(event.timestamp) / 250) * 250
        : 0;
    const name = faultText(event?.name ?? event?.properties?.errorName ?? event?.properties?.exceptionName);
    const message = faultText(event?.message ?? event?.reason ?? event?.properties?.message ?? event?.properties?.reason);
    const stackHead = faultText(
        ((event?.stack ??
            event?.properties?.stack ??
            event?.properties?.stackTrace ??
            event?.properties?.threadState ??
            '') as string)
            .toString()
            .split('\n')[0],
    );
    return `${type}|${timestamp}|${name}|${message}|${stackHead}`;
}

/** Adds fault rows the artifact events do not already contain, then re-sorts by time. */
export function mergeEventsWithFaults(
    normalizedEvents: NormalizedTimelineEvent[],
    faultEvents: NormalizedTimelineEvent[],
): NormalizedTimelineEvent[] {
    const seen = new Set<string>();
    for (const event of normalizedEvents) seen.add(faultDedupeSignature(event));

    const merged = [...normalizedEvents];
    for (const faultEvent of faultEvents) {
        const signature = faultDedupeSignature(faultEvent);
        if (seen.has(signature)) continue;
        seen.add(signature);
        merged.push(faultEvent);
    }

    return merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/**
 * Custom events stored on the session row (`sessions.events`) that the
 * artifact events do not already contain, keyed by name and timestamp.
 */
export function selectExtraCustomSessionEvents(artifactEvents: RawEvent[], sessionEvents: unknown): RawEvent[] {
    const stored: RawEvent[] = Array.isArray(sessionEvents) ? sessionEvents : [];
    const seenCustomKeys = new Set<string>();
    for (const e of artifactEvents) {
        const type = (e?.type || '').toString().toLowerCase();
        if (type === 'custom') seenCustomKeys.add(`${e.name ?? ''}|${e.timestamp ?? ''}`);
    }

    const extra: RawEvent[] = [];
    for (const e of stored) {
        const type = (e?.type || '').toString().toLowerCase();
        if (type !== 'custom') continue;
        const key = `${e.name ?? ''}|${e.timestamp ?? ''}`;
        if (seenCustomKeys.has(key)) continue;
        extra.push(e);
    }
    return extra;
}
