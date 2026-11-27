/**
 * Condensed timeline: normalised events reduced to a small, documented set of
 * types, with times relative to session start and consecutive duplicates
 * collapsed. Pure.
 *
 * What is deliberately left out: successful network requests that were not
 * slow, typed text,
 * user-property and identity events (they carry personal data), tap
 * coordinates, raw payloads and anything an SDK sends that is not listed in
 * the mapping below as a known internal type.
 */

import { getFrustrationTapKind } from '../../utils/mobileFrustration.js';
import type { NormalizedTimelineEvent } from './normalize.js';

export const TIMELINE_EVENT_TYPES = [
    'screen',
    'tap',
    'rage_tap',
    'dead_tap',
    'input',
    'scroll',
    'network_error',
    'slow_request',
    'error',
    'crash',
    'anr',
    'custom',
    'app_state',
    'log',
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export interface CondensedTimelineEvent {
    /** Seconds since session start of the first occurrence. */
    t: number;
    type: TimelineEventType;
    /** Short label: screen name, tap target, event name, error name, or "METHOD host/path". */
    name: string;
    /** Longer text where there is some: error message, HTTP status. */
    detail?: string;
    /** Screen the event happened on, when known. */
    screen?: string;
    /** How many consecutive identical events this row stands for. */
    count: number;
    /** Seconds since session start of the last occurrence, when count > 1. */
    tEnd?: number;
    /** Id of the crash, ANR or error row behind the event, usable with get_crash_context. */
    faultId?: string;
}

const SCREEN_TYPES = new Set(['navigation', 'screen_view', 'screen_change']);
const TAP_TYPES = new Set(['touch', 'tap', 'click']);
const SCROLL_TYPES = new Set(['scroll', 'motion', 'scroll_motion', 'pan_motion']);
const INPUT_TYPES = new Set(['keyboard_typing', 'keyboard_show', 'keyboard_hide', 'input', 'text_input']);
const NETWORK_TYPES = new Set(['api_call', 'network_request', 'api_request']);
const ERROR_TYPES = new Set(['error', 'resource_error']);
const ANR_TYPES = new Set(['anr', 'ui_freeze']);
const APP_STATE_TYPES = new Set(['app_startup', 'app_foreground', 'app_background', 'app_terminated', 'session_start', 'session_end', 'gameplay']);
const LOG_TYPES = new Set(['log', 'console', 'console_log', 'console_warn', 'console_error']);
/** Known internal types that never reach the timeline. */
const DROPPED_TYPES = new Set(['user_identity_changed', 'long_task', 'unknown', 'sdk_pause', 'sdk_resume', 'heartbeat']);

function text(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const found = text(value);
        if (found) return found;
    }
    return '';
}

function field(event: any, key: string): unknown {
    return event?.[key] ?? event?.properties?.[key] ?? event?.payload?.[key];
}

/** A request that succeeded but took at least this long is reported as `slow_request`. */
export const SLOW_REQUEST_MS = 3000;

function networkLabel(event: any): { name: string; detail: string; failed: boolean; slow: boolean } {
    const method = (firstText(field(event, 'method')) || 'GET').toUpperCase();
    const rawUrl = firstText(field(event, 'url'), field(event, 'endpoint'));
    let target = rawUrl;
    try {
        const url = new URL(rawUrl);
        target = `${url.host}${url.pathname}`;
    } catch {
        // Not absolute: keep the path, drop any query string.
        const host = firstText(field(event, 'urlHost'), field(event, 'host'));
        const path = firstText(field(event, 'urlPath'), field(event, 'path'), rawUrl).split(/[?#]/)[0];
        target = `${host}${path}`;
    }
    const status = Number(field(event, 'statusCode'));
    const hasStatus = Number.isFinite(status) && status > 0;
    const success = field(event, 'success');
    const failed = success === false || (hasStatus && status >= 400);
    const errorText = firstText(field(event, 'error'), field(event, 'errorMessage'));
    const duration = Number(field(event, 'duration') ?? field(event, 'durationMs'));
    const slow = !failed && Number.isFinite(duration) && duration >= SLOW_REQUEST_MS;
    const detail = failed
        ? [hasStatus ? `status ${status}` : '', errorText].filter(Boolean).join(': ')
        : (slow ? `${Math.round(duration)} ms` : '');
    return { name: `${method} ${target}`.trim(), detail, failed, slow };
}

interface Mapped {
    type: TimelineEventType;
    name: string;
    detail?: string;
}

function mapEvent(event: NormalizedTimelineEvent): Mapped | null {
    const type = event.type;
    if (type.startsWith('$') || text(event.name).startsWith('$')) return null;
    if (DROPPED_TYPES.has(type)) return null;

    const frustration = getFrustrationTapKind(event);
    if (frustration) {
        return { type: frustration, name: firstText(event.targetLabel, event.name === 'Rage Tap' ? '' : event.name) || frustration };
    }

    if (type === 'crash') return { type: 'crash', name: firstText(event.name) || 'Crash', detail: firstText(event.message, event.reason) };
    if (ANR_TYPES.has(type)) return { type: 'anr', name: 'ANR', detail: firstText(event.message) };
    if (ERROR_TYPES.has(type)) {
        return { type: 'error', name: firstText(event.name, field(event, 'errorName')) || 'Error', detail: firstText(event.message, field(event, 'message')) };
    }
    if (SCREEN_TYPES.has(type)) {
        const screen = firstText(event.screen, event.name, field(event, 'to'), field(event, 'route'));
        return screen ? { type: 'screen', name: screen } : null;
    }
    if (NETWORK_TYPES.has(type)) {
        const label = networkLabel(event);
        if (label.failed) return { type: 'network_error', name: label.name, detail: label.detail };
        return label.slow ? { type: 'slow_request', name: label.name, detail: label.detail } : null;
    }
    if (INPUT_TYPES.has(type)) {
        // The kind of input only; never what was typed.
        return { type: 'input', name: type };
    }
    if (TAP_TYPES.has(type)) return { type: 'tap', name: firstText(event.targetLabel) || 'tap' };
    if (type === 'gesture') {
        const gesture = text(event.gestureType).toLowerCase();
        if (gesture.includes('tap') || gesture === 'long_press') return { type: 'tap', name: firstText(event.targetLabel) || gesture };
        if (/scroll|swipe|pan|fling|drag/.test(gesture)) return { type: 'scroll', name: gesture };
        return null;
    }
    if (SCROLL_TYPES.has(type)) return { type: 'scroll', name: 'scroll' };
    if (APP_STATE_TYPES.has(type)) {
        if (type === 'gameplay') return { type: 'app_state', name: `gameplay_${firstText(event.phase) || 'marker'}` };
        const duration = Number(field(event, 'durationMs'));
        return {
            type: 'app_state',
            name: type,
            detail: type === 'app_startup' && Number.isFinite(duration) && duration > 0 ? `${Math.round(duration)} ms` : undefined,
        };
    }
    if (LOG_TYPES.has(type)) {
        const level = firstText(field(event, 'level')) || (type.startsWith('console_') ? type.slice('console_'.length) : 'log');
        return { type: 'log', name: level.toLowerCase(), detail: firstText(event.message, field(event, 'message'), field(event, 'text')) };
    }
    // `custom`, and any other name an app sent: ingest stores those as custom events too.
    const name = type === 'custom' ? firstText(event.name) : type;
    return name ? { type: 'custom', name } : null;
}

function relativeSeconds(timestampMs: number, sessionStartMs: number): number {
    return Math.round(((timestampMs - sessionStartMs) / 1000) * 10) / 10;
}

export interface CondenseOptions {
    sessionStartMs: number;
    /** Keep events at or after this many seconds from session start. */
    fromSeconds?: number;
    /** Keep events at or before this many seconds from session start. */
    toSeconds?: number;
    types?: readonly TimelineEventType[];
}

/**
 * Maps, filters and collapses. The screen an event happened on is the event's
 * own screen when it has one, else the last screen seen before it.
 */
export function condenseTimeline(events: NormalizedTimelineEvent[], options: CondenseOptions): CondensedTimelineEvent[] {
    const allowed = options.types && options.types.length > 0 ? new Set<TimelineEventType>(options.types) : null;
    const condensed: CondensedTimelineEvent[] = [];
    let currentScreen = '';

    for (const event of events) {
        const mapped = mapEvent(event);
        if (!mapped) continue;
        if (mapped.type === 'screen') currentScreen = mapped.name;

        const t = relativeSeconds(event.timestamp, options.sessionStartMs);
        if (options.fromSeconds !== undefined && t < options.fromSeconds) continue;
        if (options.toSeconds !== undefined && t > options.toSeconds) continue;
        if (allowed && !allowed.has(mapped.type)) continue;

        const screen = mapped.type === 'screen' ? '' : (text(event.screen) || currentScreen);
        const faultId = typeof event.faultId === 'string' ? event.faultId : undefined;
        const detail = mapped.detail || undefined;

        const previous = condensed[condensed.length - 1];
        if (
            previous
            && !faultId
            && !previous.faultId
            && previous.type === mapped.type
            && previous.name === mapped.name
            && (previous.detail ?? '') === (detail ?? '')
            && (previous.screen ?? '') === screen
        ) {
            previous.count += 1;
            previous.tEnd = t;
            continue;
        }

        condensed.push({
            t,
            type: mapped.type,
            name: mapped.name,
            ...(detail ? { detail } : {}),
            ...(screen ? { screen } : {}),
            count: 1,
            ...(faultId ? { faultId } : {}),
        });
    }

    return condensed;
}
