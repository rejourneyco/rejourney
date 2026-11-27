/**
 * Moments: the points in a session where something went wrong, found by fixed
 * rules over the condensed timeline. Pure and deterministic: no model, no
 * scoring, no guesses about causes.
 *
 * Rules (thresholds are the constants below):
 *   rage_tap_cluster     rage-tap rows on one screen no more than
 *                        RAGE_CLUSTER_GAP_SECONDS apart are one moment.
 *   dead_tap             every dead-tap row.
 *   failed_request       every failed network request row.
 *   slow_request         every request that took SLOW_REQUEST_MS or longer.
 *   error / crash / anr  every such row.
 *   stuck_loop           the same screen entered STUCK_LOOP_MIN_VISITS times
 *                        within STUCK_LOOP_WINDOW_SECONDS, or the same tap
 *                        target on one screen tapped STUCK_TAP_MIN_REPEATS
 *                        times within STUCK_TAP_WINDOW_SECONDS in rows that
 *                        are not rage taps.
 *   abandon_after_error  the session's last event comes no more than
 *                        ABANDON_AFTER_ERROR_SECONDS after a failed request,
 *                        error, rage tap or dead tap, and the session did not
 *                        end in a crash or ANR.
 */

import type { CondensedTimelineEvent } from './condense.js';

export const RAGE_CLUSTER_GAP_SECONDS = 5;
export const STUCK_LOOP_MIN_VISITS = 3;
export const STUCK_LOOP_WINDOW_SECONDS = 60;
export const STUCK_TAP_MIN_REPEATS = 4;
export const STUCK_TAP_WINDOW_SECONDS = 30;
export const ABANDON_AFTER_ERROR_SECONDS = 10;
/** How far back the events listed with a moment reach. */
export const MOMENT_CONTEXT_SECONDS = 10;
export const MAX_MOMENTS = 20;
export const MAX_EVENTS_BEFORE_MOMENT = 12;
export const MAX_LOGS_NEAR_MOMENT = 5;

export const MOMENT_KINDS = [
    'rage_tap_cluster',
    'dead_tap',
    'failed_request',
    'slow_request',
    'error',
    'crash',
    'anr',
    'stuck_loop',
    'abandon_after_error',
] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

export interface Moment {
    kind: MomentKind;
    /** Seconds since session start. */
    t: number;
    tEnd?: number;
    screen?: string;
    name: string;
    detail?: string;
    /** Events the moment stands for (taps in a cluster, visits in a loop). */
    count: number;
    faultId?: string;
    /** Events in the MOMENT_CONTEXT_SECONDS before the moment, oldest first. */
    before: CondensedTimelineEvent[];
    /** Log lines from MOMENT_CONTEXT_SECONDS before to 2 s after the moment. */
    logs: CondensedTimelineEvent[];
}

export interface MomentDetection {
    moments: Moment[];
    /** Moments found beyond MAX_MOMENTS and not returned. */
    dropped: number;
}

const DIRECT_KINDS: Partial<Record<CondensedTimelineEvent['type'], MomentKind>> = {
    dead_tap: 'dead_tap',
    network_error: 'failed_request',
    slow_request: 'slow_request',
    error: 'error',
    crash: 'crash',
    anr: 'anr',
};

const ABANDON_TRIGGERS = new Set<CondensedTimelineEvent['type']>(['network_error', 'error', 'rage_tap', 'dead_tap']);

function lastTime(event: CondensedTimelineEvent): number {
    return event.tEnd ?? event.t;
}

type Draft = Omit<Moment, 'before' | 'logs'>;

/** Finds the moments in a condensed timeline (ordered by time). */
export function detectMoments(events: readonly CondensedTimelineEvent[], limits: { maxMoments?: number; maxBefore?: number } = {}): MomentDetection {
    const drafts: Draft[] = [];

    // Direct rows and rage-tap clusters.
    let cluster: Draft | null = null;
    for (const event of events) {
        if (event.type === 'rage_tap') {
            if (cluster && (cluster.screen ?? '') === (event.screen ?? '') && event.t - (cluster.tEnd ?? cluster.t) <= RAGE_CLUSTER_GAP_SECONDS) {
                cluster.count += event.count;
                cluster.tEnd = lastTime(event);
            } else {
                cluster = { kind: 'rage_tap_cluster', t: event.t, tEnd: lastTime(event), screen: event.screen, name: event.name, count: event.count };
                drafts.push(cluster);
            }
            continue;
        }
        const kind = DIRECT_KINDS[event.type];
        if (!kind) continue;
        drafts.push({
            kind,
            t: event.t,
            ...(event.tEnd === undefined ? {} : { tEnd: event.tEnd }),
            screen: event.screen,
            name: event.name,
            detail: event.detail,
            count: event.count,
            faultId: event.faultId,
        });
    }

    // Stuck loop, screens: the same screen entered again and again.
    const visits = new Map<string, number[]>();
    const reportedScreens = new Set<string>();
    for (const event of events) {
        if (event.type !== 'screen') continue;
        const times = (visits.get(event.name) ?? []).filter((time) => event.t - time <= STUCK_LOOP_WINDOW_SECONDS);
        times.push(event.t);
        visits.set(event.name, times);
        if (times.length >= STUCK_LOOP_MIN_VISITS && !reportedScreens.has(event.name)) {
            reportedScreens.add(event.name);
            drafts.push({
                kind: 'stuck_loop',
                t: times[0],
                tEnd: event.t,
                screen: event.name,
                name: event.name,
                detail: `screen entered ${times.length} times in ${Math.round(event.t - times[0])} s`,
                count: times.length,
            });
        }
    }

    // Stuck loop, taps: the same target tapped over and over (not already a rage tap).
    const taps = new Map<string, Array<{ t: number; count: number }>>();
    const reportedTaps = new Set<string>();
    for (const event of events) {
        if (event.type !== 'tap' || event.name === 'tap') continue;
        const key = `${event.screen ?? ''}\u0000${event.name}`;
        const recent = (taps.get(key) ?? []).filter((tap) => lastTime(event) - tap.t <= STUCK_TAP_WINDOW_SECONDS);
        recent.push({ t: event.t, count: event.count });
        taps.set(key, recent);
        const total = recent.reduce((sum, tap) => sum + tap.count, 0);
        if (total >= STUCK_TAP_MIN_REPEATS && !reportedTaps.has(key)) {
            reportedTaps.add(key);
            drafts.push({
                kind: 'stuck_loop',
                t: recent[0].t,
                tEnd: lastTime(event),
                screen: event.screen,
                name: event.name,
                detail: `tapped ${total} times in ${Math.round(lastTime(event) - recent[0].t)} s`,
                count: total,
            });
        }
    }

    // Abandon after error: the session stops right after something failed.
    const last = events[events.length - 1];
    if (last && last.type !== 'crash' && last.type !== 'anr') {
        const end = lastTime(last);
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (end - lastTime(event) > ABANDON_AFTER_ERROR_SECONDS) break;
            if (event.type === 'crash' || event.type === 'anr') break;
            if (!ABANDON_TRIGGERS.has(event.type)) continue;
            drafts.push({
                kind: 'abandon_after_error',
                t: end,
                screen: last.screen ?? event.screen,
                name: event.name,
                detail: `session ended ${Math.round((end - lastTime(event)) * 10) / 10} s after ${event.type}`,
                count: 1,
            });
            break;
        }
    }

    drafts.sort((a, b) => a.t - b.t || MOMENT_KINDS.indexOf(a.kind) - MOMENT_KINDS.indexOf(b.kind));
    const maxMoments = limits.maxMoments ?? MAX_MOMENTS;
    const maxBefore = limits.maxBefore ?? MAX_EVENTS_BEFORE_MOMENT;
    const kept = drafts.slice(0, maxMoments);

    const moments = kept.map((draft): Moment => {
        const window = events.filter((event) => event.t >= draft.t - MOMENT_CONTEXT_SECONDS && event.t < draft.t);
        const before = window.filter((event) => event.type !== 'log').slice(-maxBefore);
        const logs = events
            .filter((event) => event.type === 'log' && event.t >= draft.t - MOMENT_CONTEXT_SECONDS && event.t <= (draft.tEnd ?? draft.t) + 2)
            .slice(-MAX_LOGS_NEAR_MOMENT);
        return { ...draft, before, logs };
    });
    return { moments, dropped: drafts.length - kept.length };
}

export interface TrimmedTimeline {
    events: CondensedTimelineEvent[];
    /** Events left out of the middle. Zero when nothing was trimmed. */
    omitted: number;
    total: number;
}

/**
 * Shortens a long timeline to at most `maxEvents` rows by dropping the middle.
 * Kept: the first `head` rows, the last `tail` rows, and for every moment the
 * rows in the MOMENT_CONTEXT_SECONDS before it up to the moment itself. If
 * that is still too many (moments all over a long session), the rows closest
 * to the start and to the end win.
 */
export function trimTimeline(
    events: readonly CondensedTimelineEvent[],
    moments: readonly Pick<Moment, 't'>[],
    limits: { maxEvents: number; head: number; tail: number },
): TrimmedTimeline {
    if (events.length <= limits.maxEvents) return { events: [...events], omitted: 0, total: events.length };
    let kept = events.filter((event, index) => {
        if (index < limits.head || index >= events.length - limits.tail) return true;
        return moments.some((moment) => event.t >= moment.t - MOMENT_CONTEXT_SECONDS && event.t <= moment.t);
    });
    if (kept.length > limits.maxEvents) {
        const front = Math.ceil(limits.maxEvents / 2);
        kept = [...kept.slice(0, front), ...kept.slice(kept.length - (limits.maxEvents - front))];
    }
    return { events: kept, omitted: events.length - kept.length, total: events.length };
}

export interface ScreenVisit {
    name: string;
    /** Seconds since session start when the screen was entered. */
    t: number;
    /** Seconds until the next screen, or until the last recorded event. Null when it cannot be told. */
    seconds: number | null;
}

/** Ordered screen visits with the time spent on each, from the timeline's screen events. */
export function screenVisits(events: readonly CondensedTimelineEvent[], maxVisits = 60): ScreenVisit[] {
    const screens = events.filter((event) => event.type === 'screen');
    const end = events.length > 0 ? lastTime(events[events.length - 1]) : null;
    return screens.slice(0, maxVisits).map((screen, index) => {
        const next = screens[index + 1]?.t ?? end;
        return { name: screen.name, t: screen.t, seconds: next === null ? null : Math.max(0, Math.round((next - screen.t) * 10) / 10) };
    });
}

export interface CommonLeadUp {
    /** Sessions the lead-up was read from. */
    sessionsSampled: number;
    /** Screens seen in the lead-up of more than half of them. */
    screens: Array<{ name: string; sessions: number }>;
    /** Event types seen in the lead-up of more than half of them. */
    eventTypes: Array<{ type: CondensedTimelineEvent['type']; sessions: number }>;
    /** Named events (type and name) seen in the lead-up of more than half of them. */
    events: Array<{ type: CondensedTimelineEvent['type']; name: string; sessions: number }>;
}

/** What the lead-ups of several sessions have in common: present in a strict majority of them. */
export function computeCommonLeadUp(leadUps: ReadonlyArray<readonly CondensedTimelineEvent[]>): CommonLeadUp {
    const n = leadUps.length;
    const screens = new Map<string, number>();
    const types = new Map<CondensedTimelineEvent['type'], number>();
    const named = new Map<string, { type: CondensedTimelineEvent['type']; name: string; sessions: number }>();
    for (const leadUp of leadUps) {
        const seenScreens = new Set<string>();
        const seenTypes = new Set<CondensedTimelineEvent['type']>();
        const seenNamed = new Map<string, { type: CondensedTimelineEvent['type']; name: string }>();
        for (const event of leadUp) {
            const screen = event.type === 'screen' ? event.name : event.screen;
            if (screen) seenScreens.add(screen);
            seenTypes.add(event.type);
            if (event.type !== 'screen') seenNamed.set(`${event.type}\u0000${event.name}`, { type: event.type, name: event.name });
        }
        for (const screen of seenScreens) screens.set(screen, (screens.get(screen) ?? 0) + 1);
        for (const type of seenTypes) types.set(type, (types.get(type) ?? 0) + 1);
        for (const [key, value] of seenNamed) named.set(key, { ...value, sessions: (named.get(key)?.sessions ?? 0) + 1 });
    }
    const majority = (sessions: number) => sessions * 2 > n;
    return {
        sessionsSampled: n,
        screens: [...screens.entries()].filter(([, sessions]) => majority(sessions)).map(([name, sessions]) => ({ name, sessions }))
            .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)).slice(0, 10),
        eventTypes: [...types.entries()].filter(([, sessions]) => majority(sessions)).map(([type, sessions]) => ({ type, sessions }))
            .sort((a, b) => b.sessions - a.sessions || a.type.localeCompare(b.type)),
        events: [...named.values()].filter((entry) => majority(entry.sessions))
            .sort((a, b) => b.sessions - a.sessions || a.type.localeCompare(b.type) || a.name.localeCompare(b.name)).slice(0, 15),
    };
}

/** The events in the `windowSeconds` up to and including second `at`, newest `maxEvents` kept. */
export function leadUpWindow(
    events: readonly CondensedTimelineEvent[],
    at: number,
    windowSeconds: number,
    maxEvents: number,
): { events: CondensedTimelineEvent[]; dropped: boolean } {
    const windowed = events.filter((event) => event.t >= Math.max(0, at - windowSeconds) && event.t <= at);
    const dropped = windowed.length > maxEvents;
    return { events: dropped ? windowed.slice(windowed.length - maxEvents) : windowed, dropped };
}
